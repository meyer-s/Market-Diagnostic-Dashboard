from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import desc

from app.models.option_sweep_runs import OptionSweepRun
from app.models.options_alerts import OptionAlertEvent
from app.services.discord_sweep_universe import (
    SUPPORTED_SWEEP_UNIVERSES,
    canonical_universe_key,
    resolve_sweep_universe,
)
from app.services.optionality_clusters import classify_optionality_symbol
from app.services.option_decision_learning import (
    build_learning_influence_context,
    evaluate_option_learning_influence,
    learning_summary,
    rebase_option_learning_evaluation,
)
from app.services.option_field_context import option_field_context_from_event
from app.services.option_scanner_exposure import (
    build_rank_snapshot_payload,
    persist_rank_snapshot,
    serialize_rank_snapshot,
    snapshot_for_run,
)
from app.services.options_opportunity import OPPORTUNITY_MODEL_VERSION, compute_opportunity_score, opportunity_grade
from app.services.options_review_window import parse_review_window
from app.services.options_alerts import _send_webhook
from app.services.scanner_repeat_evidence import (
    load_scanner_repeat_evidence_context,
    position_match_for_event,
    record_scanner_recurrence_events_for_run,
)
from app.utils.db_helpers import get_db_session
from maintenance_scripts.options_chain_sweep import _scan_tickers
from maintenance_scripts.options_chain_sweep import _sweep_market_data_provider_key


ACTIVE_STATUSES = {"queued", "running"}
STALE_SWEEP_PROGRESS_MINUTES = float(os.getenv("OPTION_SWEEP_STALE_MINUTES", "30"))
_DASHBOARD_SWEEP_CONTROLS: dict[int, threading.Event] = {}
_DASHBOARD_SWEEP_CONTROLS_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


def _csv_symbols(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [part.strip().upper() for part in value.split(",") if part.strip()]


def _source_summary(hit_details: list[dict[str, Any]]) -> str:
    counts: Counter[str] = Counter()
    for detail in hit_details:
        selected = detail.get("selected_contract") or {}
        source = selected.get("data_source") or detail.get("data_source") or "unknown"
        quote_source = selected.get("quote_source") or detail.get("quote_source")
        label = f"{source}/{quote_source}" if quote_source and quote_source != source else str(source)
        counts[label] += 1
    return ", ".join(f"{source}: {count}" for source, count in counts.most_common())


def _serialize_run(run: OptionSweepRun) -> dict[str, object]:
    return {
        "id": run.id,
        "universe_key": run.universe_key,
        "universe_label": run.universe_label,
        "threshold": run.threshold,
        "trigger_source": run.trigger_source,
        "status": run.status,
        "total_symbols": run.total_symbols,
        "scanned_symbols": run.scanned_symbols,
        "hits": run.hits,
        "errors": run.errors,
        "rate_limit_errors": run.rate_limit_errors,
        "hit_symbols": _csv_symbols(run.hit_symbols),
        "notes": run.notes,
        "last_event": run.last_event,
        "last_symbol": run.last_symbol,
        "last_error": run.last_error,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }


def _review_window_payload(event: OptionAlertEvent) -> dict[str, object]:
    min_hold = event.review_min_hold_days
    max_hold = event.review_max_hold_days
    basis = event.review_window_basis
    if not (isinstance(min_hold, int) and isinstance(max_hold, int) and max_hold >= min_hold > 0):
        parsed = parse_review_window(event.message)
        if parsed:
            min_hold = parsed.min_hold_days
            max_hold = parsed.max_hold_days
            basis = parsed.basis
    return {
        "min_hold_days": min_hold,
        "max_hold_days": max_hold,
        "basis": basis,
    }


def _stored_learning_evaluation(event: OptionAlertEvent) -> Optional[dict[str, object]]:
    raw = getattr(event, "learning_influence_json", None)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) and payload.get("point_in_time_receipt") is True else None


def _run_last_seen(run: OptionSweepRun) -> Optional[datetime]:
    return run.updated_at or run.started_at


def _register_dashboard_sweep(run_id: int, stop_event: threading.Event) -> None:
    with _DASHBOARD_SWEEP_CONTROLS_LOCK:
        _DASHBOARD_SWEEP_CONTROLS[run_id] = stop_event


def _clear_dashboard_sweep(run_id: int, stop_event: threading.Event) -> None:
    with _DASHBOARD_SWEEP_CONTROLS_LOCK:
        if _DASHBOARD_SWEEP_CONTROLS.get(run_id) is stop_event:
            _DASHBOARD_SWEEP_CONTROLS.pop(run_id, None)


def _dashboard_sweep_control(run_id: int) -> Optional[threading.Event]:
    with _DASHBOARD_SWEEP_CONTROLS_LOCK:
        return _DASHBOARD_SWEEP_CONTROLS.get(run_id)


def expire_stale_sweep_runs(stale_after_hours: Optional[float] = None) -> int:
    """Close abandoned queued/running rows so stale state cannot block new scans."""
    if stale_after_hours is None:
        cutoff = datetime.utcnow() - timedelta(minutes=max(5.0, STALE_SWEEP_PROGRESS_MINUTES))
    else:
        cutoff = datetime.utcnow() - timedelta(hours=max(0.25, float(stale_after_hours)))
    marked = 0
    with get_db_session() as db:
        latest_run = (
            db.query(OptionSweepRun)
            .order_by(desc(OptionSweepRun.started_at), desc(OptionSweepRun.id))
            .first()
        )
        runs = (
            db.query(OptionSweepRun)
            .filter(OptionSweepRun.status.in_(list(ACTIVE_STATUSES)))
            .all()
        )
        now = datetime.utcnow()
        for run in runs:
            last_seen = _run_last_seen(run)
            superseded = (
                latest_run is not None
                and latest_run.id != run.id
                and latest_run.started_at is not None
                and run.started_at is not None
                and latest_run.started_at > run.started_at
            )
            if not superseded and last_seen is not None and last_seen >= cutoff:
                continue
            run.status = "stale"
            run.last_event = "stale"
            if superseded:
                run.last_error = f"Marked stale because scanner run #{latest_run.id} started later."
            else:
                progress_label = last_seen.isoformat() if last_seen else "an unknown time"
                run.last_error = f"Marked stale after no scanner progress since {progress_label}."
            if run.completed_at is None:
                run.completed_at = now
            run.updated_at = now
            db.add(run)
            marked += 1
        if marked:
            db.commit()
    return marked


def _set_run_status(
    run_id: int,
    *,
    status: Optional[str] = None,
    total_symbols: Optional[int] = None,
    scanned_symbols: Optional[int] = None,
    hits: Optional[int] = None,
    errors: Optional[int] = None,
    rate_limit_errors: Optional[int] = None,
    hit_symbols: Optional[list[str]] = None,
    notes: Optional[list[str] | str] = None,
    last_event: Optional[str] = None,
    last_symbol: Optional[str] = None,
    last_error: Optional[str] = None,
    completed: bool = False,
) -> None:
    with get_db_session() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == run_id).first()
        if not run:
            return
        if status is not None:
            run.status = status
        if total_symbols is not None:
            run.total_symbols = max(0, int(total_symbols))
        if scanned_symbols is not None:
            run.scanned_symbols = max(0, int(scanned_symbols))
        if hits is not None:
            run.hits = max(0, int(hits))
        if errors is not None:
            run.errors = max(0, int(errors))
        if rate_limit_errors is not None:
            run.rate_limit_errors = max(0, int(rate_limit_errors))
        if hit_symbols is not None:
            run.hit_symbols = ",".join(symbol.upper() for symbol in hit_symbols if symbol)
        if notes is not None:
            run.notes = " | ".join(notes) if isinstance(notes, list) else str(notes)
        if last_event is not None:
            run.last_event = last_event
        if last_symbol is not None:
            run.last_symbol = last_symbol
        if last_error is not None:
            run.last_error = last_error[:2000]
        if completed:
            run.completed_at = datetime.utcnow()
        run.updated_at = datetime.utcnow()
        db.add(run)
        db.commit()


def create_sweep_run(
    *,
    universe_key: str,
    universe_label: str,
    threshold: float,
    trigger_source: str,
    total_symbols: int = 0,
    notes: Optional[list[str]] = None,
    status: str = "queued",
) -> OptionSweepRun:
    with get_db_session() as db:
        run = OptionSweepRun(
            universe_key=universe_key,
            universe_label=universe_label,
            threshold=threshold,
            trigger_source=trigger_source,
            status=status,
            total_symbols=total_symbols,
            scanned_symbols=0,
            hits=0,
            errors=0,
            rate_limit_errors=0,
            notes=" | ".join(notes or []),
            started_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return run


def update_sweep_run_from_progress(run_id: Optional[int], payload: dict[str, Any]) -> None:
    if not run_id:
        return
    event = str(payload.get("event") or "progress")
    status = "running"
    completed = False
    if event == "cancelled":
        status = "stopped"
        completed = True
    elif event == "finished":
        status = "completed"
        completed = True
    elif event == "error":
        status = "running"

    _set_run_status(
        run_id,
        status=status,
        scanned_symbols=int(payload.get("scanned") or 0),
        total_symbols=int(payload.get("total_expected") or 0),
        hits=int(payload.get("hits") or 0),
        errors=int(payload.get("errors") or 0),
        rate_limit_errors=int(payload.get("rate_limit_errors") or 0),
        hit_symbols=payload.get("hit_symbols") if isinstance(payload.get("hit_symbols"), list) else None,
        last_event=event,
        last_symbol=str(payload.get("symbol") or "") or None,
        last_error=str(payload.get("error") or "") or None,
        completed=completed,
    )


def finish_sweep_run(
    run_id: Optional[int],
    *,
    status: str,
    total_symbols: int,
    hits: int,
    hit_symbols: list[str],
    hit_details: Optional[list[dict[str, Any]]] = None,
) -> None:
    if not run_id:
        return
    details = _source_summary(hit_details or [])
    _set_run_status(
        run_id,
        status=status,
        total_symbols=total_symbols,
        scanned_symbols=total_symbols,
        hits=hits,
        hit_symbols=hit_symbols,
        last_event=status,
        notes=details or None,
        completed=True,
    )
    # The alert row is the source of truth; finalization backfills the
    # append-only position journal idempotently in case immediate persistence
    # was interrupted.
    with get_db_session() as db:
        record_scanner_recurrence_events_for_run(db, int(run_id))
        db.commit()
    _finalize_rank_snapshot_safely(int(run_id))


def fail_sweep_run(run_id: Optional[int], error: str) -> None:
    if not run_id:
        return
    _set_run_status(
        run_id,
        status="error",
        last_event="error",
        last_error=error,
        completed=True,
    )
    _finalize_rank_snapshot_safely(int(run_id))


def _dashboard_pause_seconds(total_tickers: int, provider_key: str) -> float:
    default_pause = 0.2
    if total_tickers > 2000:
        default_pause = 0.02
    elif total_tickers > 1000:
        default_pause = 0.05
    if provider_key == "ibkr":
        default_pause = float(os.getenv("IBKR_SWEEP_PAUSE_SECONDS", "0.25"))
    return float(os.getenv("DISCORD_SWEEP_PAUSE_SECONDS", default_pause))


def _dashboard_progress_callback(run_id: int, label: str, status_every: int, status_min_seconds: float):
    started_at = time.monotonic()
    state = {"last_status_at": started_at, "last_status_scanned": 0}

    def _callback(payload: dict[str, Any]) -> None:
        update_sweep_run_from_progress(run_id, payload)
        event = payload.get("event")
        scanned = int(payload.get("scanned") or 0)
        total_expected = int(payload.get("total_expected") or 0)
        hits = int(payload.get("hits") or 0)
        errors = int(payload.get("errors") or 0)
        rate_limit_errors = int(payload.get("rate_limit_errors") or 0)
        now = time.monotonic()

        if event == "rate_limit":
            symbol = payload.get("symbol") or "unknown"
            retry_after = float(payload.get("retry_after_seconds") or 0)
            _send_webhook(
                "Options sweep status: market data provider may be throttling requests. "
                f"Last symbol: {symbol}. Scanned {scanned}/{total_expected}; hits {hits}; "
                f"errors {errors}; waiting {retry_after:.0f}s."
            )
            return

        if event != "progress" or scanned <= 0 or status_every <= 0:
            return
        scanned_delta = scanned - state["last_status_scanned"]
        time_delta = now - state["last_status_at"]
        if scanned_delta < status_every and time_delta < status_min_seconds:
            return
        state["last_status_at"] = now
        state["last_status_scanned"] = scanned
        percent = (scanned / total_expected * 100) if total_expected else 0
        content = f"Options sweep progress: {label} {scanned}/{total_expected} ({percent:.0f}%). Hits: {hits}. Errors: {errors}."
        if rate_limit_errors:
            content += f" Market-data warnings: {rate_limit_errors}."
        _send_webhook(content)

    return _callback


def _run_dashboard_sweep(run_id: int, universe_key: str, threshold: float, stop_event: threading.Event) -> None:
    try:
        universe = resolve_sweep_universe(universe_key)
        tickers = universe.tickers
        label = universe.label
        if not tickers:
            message = f"Failed to fetch tickers for {label}."
            fail_sweep_run(run_id, message)
            _send_webhook(f":warning: Options sweep aborted. {message}")
            return

        provider_name = _sweep_market_data_provider_key()
        pause_seconds = _dashboard_pause_seconds(len(tickers), provider_name)
        status_every = int(os.getenv("DISCORD_SWEEP_STATUS_EVERY_TICKERS", "100"))
        status_min_seconds = float(os.getenv("DISCORD_SWEEP_STATUS_MIN_SECONDS", "60"))
        rate_limit_backoff_seconds = float(
            os.getenv(
                "DISCORD_SWEEP_RATE_LIMIT_BACKOFF_SECONDS",
                os.getenv("IBKR_TRANSIENT_RETRY_SECONDS", "5"),
            )
        )
        rate_limit_backoff_multiplier = float(os.getenv("DISCORD_SWEEP_RATE_LIMIT_BACKOFF_MULTIPLIER", "2"))
        rate_limit_backoff_max_seconds = float(os.getenv("DISCORD_SWEEP_RATE_LIMIT_BACKOFF_MAX_SECONDS", "600"))
        rate_limit_max_retries = int(
            os.getenv(
                "DISCORD_SWEEP_RATE_LIMIT_MAX_RETRIES",
                os.getenv("IBKR_TRANSIENT_MAX_RETRIES", "1"),
            )
        )
        _set_run_status(
            run_id,
            status="running",
            total_symbols=len(tickers),
            notes=universe.notes,
            last_event="started",
        )
        _send_webhook(
            f":mag: Dashboard options sweep started. {label} Tickers: {len(tickers)} "
            f"Threshold: {threshold:.1f}% Data: {provider_name} Pause: {pause_seconds:.2f}s."
        )

        hits_result = _scan_tickers(
            tickers,
            label,
            threshold,
            None,
            pause_seconds=pause_seconds,
            capture_hit_symbols=True,
            capture_hit_details=True,
            progress_callback=_dashboard_progress_callback(run_id, label, status_every, status_min_seconds),
            should_stop=stop_event.is_set,
            rate_limit_backoff_seconds=rate_limit_backoff_seconds,
            rate_limit_backoff_multiplier=rate_limit_backoff_multiplier,
            rate_limit_backoff_max_seconds=rate_limit_backoff_max_seconds,
            rate_limit_max_retries=rate_limit_max_retries,
            market_data_provider=provider_name,
            sweep_run_id=run_id,
        )
        hits = 0
        hit_symbols: list[str] = []
        hit_details: list[dict[str, Any]] = []
        if isinstance(hits_result, tuple):
            if len(hits_result) == 3:
                hits, hit_symbols, hit_details = hits_result
            else:
                hits, hit_symbols = hits_result
        else:
            hits = int(hits_result or 0)
        finish_sweep_run(
            run_id,
            status="stopped" if stop_event.is_set() else "completed",
            total_symbols=len(tickers),
            hits=int(hits),
            hit_symbols=hit_symbols,
            hit_details=hit_details,
        )
        details = ""
        if hit_symbols:
            preview = ", ".join(hit_symbols[:12])
            details = f" Hit symbols: {preview}{'' if len(hit_symbols) <= 12 else f' (+{len(hit_symbols) - 12} more)'}."
        status_label = "stopped" if stop_event.is_set() else "finished"
        _send_webhook(f":white_check_mark: Dashboard options sweep {status_label}. {label} scanned {len(tickers)}. Hits: {hits}.{details}")
    except Exception as exc:
        fail_sweep_run(run_id, str(exc))
        _send_webhook(f":warning: Dashboard options sweep failed. {universe_key}: {exc}")
    finally:
        _clear_dashboard_sweep(run_id, stop_event)


def start_dashboard_sweep(
    universe_key: str,
    threshold: float,
    *,
    trigger_source: str = "dashboard",
) -> dict[str, object]:
    canonical = canonical_universe_key(universe_key)
    if not canonical:
        supported = ", ".join(SUPPORTED_SWEEP_UNIVERSES.keys())
        raise ValueError(f"Unsupported universe '{universe_key}'. Supported: {supported}")

    threshold = max(1.0, min(99.0, float(threshold)))
    expire_stale_sweep_runs()
    with get_db_session() as db:
        active = (
            db.query(OptionSweepRun)
            .filter(
                OptionSweepRun.status.in_(list(ACTIVE_STATUSES)),
            )
            .order_by(OptionSweepRun.started_at.desc())
            .first()
        )
        if active:
            raise RuntimeError(
                f"{active.universe_label} sweep #{active.id} is already {active.status}."
            )

    run = create_sweep_run(
        universe_key=canonical,
        universe_label=SUPPORTED_SWEEP_UNIVERSES[canonical],
        threshold=threshold,
        trigger_source=trigger_source.strip().lower() or "dashboard",
        status="queued",
    )
    stop_event = threading.Event()
    _register_dashboard_sweep(run.id, stop_event)
    thread = threading.Thread(target=_run_dashboard_sweep, args=(run.id, canonical, threshold, stop_event), daemon=True)
    thread.start()
    return _serialize_run(run)


def request_stop_dashboard_sweep(run_id: int) -> dict[str, object]:
    expire_stale_sweep_runs()
    with get_db_session() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == run_id).first()
        if run is None:
            raise LookupError(f"Scanner run #{run_id} was not found.")
        if run.status not in ACTIVE_STATUSES:
            return {
                "stopped": False,
                "message": f"Scanner run #{run_id} is already {run.status}.",
                "run": _serialize_run(run),
            }

    control = _dashboard_sweep_control(run_id)
    if control is not None:
        control.set()
        _set_run_status(
            run_id,
            last_event="stop_requested",
            last_error="Stop requested from dashboard.",
        )
        message = f"Stop requested for scanner run #{run_id}."
    else:
        _set_run_status(
            run_id,
            status="stopped",
            last_event="stopped",
            last_error="Stop requested, but no local scanner thread was registered.",
            completed=True,
        )
        _finalize_rank_snapshot_safely(int(run_id))
        message = f"Scanner run #{run_id} was marked stopped."

    with get_db_session() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == run_id).first()
        return {
            "stopped": True,
            "message": message,
            "run": _serialize_run(run),
        }


def _ranked_opportunity_from_event(
    event: OptionAlertEvent,
    *,
    symbol_recent_hits: int = 1,
    symbol_total_hits: int = 1,
    group_recent_hits: int = 1,
) -> dict[str, object]:
    symbol = str(event.symbol or "").strip().upper()
    classification = classify_optionality_symbol(symbol)
    spread = None
    if event.iv30 is not None and event.hv30 is not None:
        spread = float(event.iv30) - float(event.hv30)
    score_payload = compute_opportunity_score(
        iv_percentile=event.iv_percentile,
        iv30=event.iv30,
        hv30=event.hv30,
        avg_edr=event.avg_edr,
        selected_spread_pct=event.selected_spread_pct,
        selected_open_interest=event.selected_open_interest,
        selected_volume=event.selected_volume,
        selected_reward_risk=event.selected_reward_risk,
        selected_convexity_profit_pct=event.selected_convexity_profit_pct,
        selected_convexity_probability_itm=event.selected_convexity_probability_itm,
        selected_contract_score=event.selected_contract_score,
        symbol_recent_hits=symbol_recent_hits,
        symbol_total_hits=symbol_total_hits,
        group_recent_hits=group_recent_hits,
    )
    rank_score = float(score_payload["rank_score"])
    base_score = float(event.opportunity_score) if event.opportunity_score is not None else float(score_payload["base_score"])
    triggered_at = event.triggered_at
    return {
        "event_id": event.id,
        "symbol": symbol,
        "triggered_at": triggered_at.isoformat() if triggered_at else None,
        "group": classification.group,
        "sector": classification.sector,
        "score": round(rank_score, 2),
        "base_score": round(base_score, 2),
        "grade": score_payload.get("grade") or opportunity_grade(rank_score),
        "model_version": event.opportunity_model_version or OPPORTUNITY_MODEL_VERSION,
        "components": score_payload.get("components") or {},
        "reasons": score_payload.get("reasons") or [],
        "message": event.message,
        "iv_percentile": event.iv_percentile,
        "iv30": event.iv30,
        "hv30": event.hv30,
        "iv_hv_spread": spread,
        "avg_edr": event.avg_edr,
        "field_context": option_field_context_from_event(event),
        "learning_evaluation": _stored_learning_evaluation(event),
        "review_window": _review_window_payload(event),
        "selected_contract": {
            "expiry": event.selected_expiry,
            "dte": event.selected_dte,
            "strike": event.selected_strike,
            "option_type": event.selected_option_type,
            "premium": event.selected_premium,
            "price_source": event.selected_price_source,
            "bid": event.selected_bid,
            "ask": event.selected_ask,
            "last": event.selected_last,
            "spread_pct": event.selected_spread_pct,
            "open_interest": event.selected_open_interest,
            "volume": event.selected_volume,
            "implied_volatility": event.selected_implied_volatility,
            "last_trade_at": event.selected_last_trade_at,
            "contract_score": event.selected_contract_score,
            "reward_risk": event.selected_reward_risk,
            "convexity_profit_pct": event.selected_convexity_profit_pct,
            "convexity_probability_itm": event.selected_convexity_probability_itm,
            "planned_loss_pct": event.selected_planned_loss_pct,
            "target_profit_pct": event.selected_target_profit_pct,
        },
    }


def _attach_learning_evaluations(
    opportunities: list[dict[str, Any]],
    context: dict[str, object],
) -> dict[str, object]:
    for opportunity in opportunities:
        stored_evaluation = opportunity.get("learning_evaluation")
        if isinstance(stored_evaluation, dict) and stored_evaluation.get("point_in_time_receipt") is True:
            opportunity["learning_evaluation"] = rebase_option_learning_evaluation(
                stored_evaluation,
                champion_score=float(opportunity.get("score") or 0.0),
            )
        else:
            evaluation = evaluate_option_learning_influence(
                context,
                champion_score=float(opportunity.get("score") or 0.0),
                field_context=(
                    opportunity.get("field_context")
                    if isinstance(opportunity.get("field_context"), dict)
                    else None
                ),
                position_match=(
                    opportunity.get("position_match")
                    if isinstance(opportunity.get("position_match"), dict)
                    else None
                ),
                contract_context=(
                    opportunity.get("selected_contract")
                    if isinstance(opportunity.get("selected_contract"), dict)
                    else None
                ),
            )
            evaluation["status"] = "legacy_shadow_only"
            evaluation["applied_score"] = evaluation["champion_score"]
            evaluation["applied_weight"] = 0.0
            evaluation["live_canary_active"] = False
            evaluation["point_in_time_receipt"] = False
            reasons = list(evaluation.get("reasons") or [])
            reasons.append(
                "Legacy event: no point-in-time learning receipt was captured, so live weight is disabled."
            )
            evaluation["reasons"] = reasons
            opportunity["learning_evaluation"] = evaluation

    champion_order = sorted(
        opportunities,
        key=lambda row: (
            float((row.get("learning_evaluation") or {}).get("champion_score") or 0.0),
            row.get("triggered_at") or "",
            int(row.get("event_id") or 0),
        ),
        reverse=True,
    )
    counterfactual_order = sorted(
        opportunities,
        key=lambda row: (
            float((row.get("learning_evaluation") or {}).get("counterfactual_score") or 0.0),
            row.get("triggered_at") or "",
            int(row.get("event_id") or 0),
        ),
        reverse=True,
    )
    applied_order = sorted(
        opportunities,
        key=lambda row: (
            float((row.get("learning_evaluation") or {}).get("applied_score") or 0.0),
            row.get("triggered_at") or "",
            int(row.get("event_id") or 0),
        ),
        reverse=True,
    )
    champion_ranks = {id(row): index for index, row in enumerate(champion_order, start=1)}
    counterfactual_ranks = {id(row): index for index, row in enumerate(counterfactual_order, start=1)}
    applied_ranks = {id(row): index for index, row in enumerate(applied_order, start=1)}
    reorder_count = 0
    applied_reorder_count = 0
    applied_count = 0
    applied_weights: list[float] = []
    for opportunity in opportunities:
        evaluation = opportunity["learning_evaluation"]
        champion_rank = champion_ranks[id(opportunity)]
        counterfactual_rank = counterfactual_ranks[id(opportunity)]
        applied_rank = applied_ranks[id(opportunity)]
        evaluation["champion_rank"] = champion_rank
        evaluation["counterfactual_rank"] = counterfactual_rank
        evaluation["rank_delta"] = champion_rank - counterfactual_rank
        evaluation["rank_changed"] = champion_rank != counterfactual_rank
        evaluation["applied_rank"] = applied_rank
        evaluation["applied_rank_delta"] = champion_rank - applied_rank
        evaluation["applied_rank_changed"] = champion_rank != applied_rank
        reorder_count += int(champion_rank != counterfactual_rank)
        applied_reorder_count += int(champion_rank != applied_rank)
        applied_weight = float(evaluation.get("applied_weight") or 0.0)
        applied_count += int(applied_weight > 0)
        applied_weights.append(applied_weight)
        opportunity["score"] = float(evaluation.get("applied_score") or 0.0)
        opportunity["grade"] = opportunity_grade(float(opportunity["score"]))
        opportunity["ranking_model_version"] = str(evaluation.get("version") or "")

    family_names = sorted(
        {
            str(family)
            for opportunity in opportunities
            for family in (
                (opportunity.get("learning_evaluation") or {}).get("family_attribution") or {}
            )
        }
    )
    family_rank_changes: dict[str, int] = {}
    for family in family_names:
        without_family_order = sorted(
            opportunities,
            key=lambda row: (
                float((row.get("learning_evaluation") or {}).get("applied_score") or 0.0)
                - float(
                    (
                        (
                            (row.get("learning_evaluation") or {}).get("family_attribution")
                            or {}
                        ).get(family)
                        or {}
                    ).get("applied_score_delta")
                    or 0.0
                ),
                row.get("triggered_at") or "",
                int(row.get("event_id") or 0),
            ),
            reverse=True,
        )
        ranks_without_family = {
            id(row): index
            for index, row in enumerate(without_family_order, start=1)
        }
        changed = 0
        for opportunity in opportunities:
            evaluation = opportunity["learning_evaluation"]
            attribution = evaluation.get("family_attribution")
            if not isinstance(attribution, dict):
                continue
            family_row = attribution.get(family)
            if not isinstance(family_row, dict):
                continue
            rank_without_family = ranks_without_family[id(opportunity)]
            applied_rank = int(evaluation.get("applied_rank") or rank_without_family)
            rank_delta = rank_without_family - applied_rank
            family_row["rank_without_family"] = rank_without_family
            family_row["applied_rank"] = applied_rank
            family_row["applied_rank_delta"] = rank_delta
            family_row["applied_rank_changed"] = rank_delta != 0
            changed += int(rank_delta != 0)
        family_rank_changes[family] = changed

    policy = {
        key: value
        for key, value in context.items()
        if key != "families"
    }
    policy["evaluated_opportunities"] = len(opportunities)
    policy["counterfactual_rank_changes"] = reorder_count
    policy["applied_opportunities"] = applied_count
    policy["applied_rank_changes"] = applied_reorder_count
    policy["observed_max_applied_weight"] = round(max(applied_weights, default=0.0), 4)
    policy["observed_mean_applied_weight"] = round(
        sum(applied_weights) / len(applied_weights),
        4,
    ) if applied_weights else 0.0
    policy["family_applied_rank_changes"] = family_rank_changes
    policy["direct_market_field_rank_weight"] = 0.0
    policy["market_field_influence_path"] = "indirect_outcome_learning_canary"
    policy["actual_order_unchanged"] = applied_reorder_count == 0
    return policy


def _apply_rank_display_order(
    opportunities: list[dict[str, Any]],
) -> None:
    opportunities.sort(
        key=lambda row: (
            int(
                (row.get("learning_evaluation") or {}).get("applied_rank")
                or 10**9
            ),
            row.get("triggered_at") or "",
            int(row.get("event_id") or 0),
        )
    )
    for display_ordinal, opportunity in enumerate(opportunities, start=1):
        evaluation = opportunity.get("learning_evaluation") or {}
        opportunity["display_ordinal"] = display_ordinal
        for field in (
            "champion_rank",
            "counterfactual_rank",
            "applied_rank",
            "champion_score",
            "counterfactual_score",
            "applied_score",
            "applied_weight",
        ):
            opportunity[field] = evaluation.get(field)


def _apply_frozen_rank_snapshot(
    opportunities: list[dict[str, Any]],
    snapshot: dict[str, object],
) -> list[dict[str, Any]]:
    candidates = snapshot.get("candidates")
    if not isinstance(candidates, list):
        return opportunities
    by_event_id = {
        int(opportunity["event_id"]): opportunity
        for opportunity in opportunities
        if opportunity.get("event_id") is not None
    }
    frozen: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            event_id = int(candidate["event_id"])
        except (KeyError, TypeError, ValueError):
            continue
        opportunity = by_event_id.get(event_id)
        if opportunity is None:
            continue
        evaluation = opportunity.get("learning_evaluation")
        if not isinstance(evaluation, dict):
            evaluation = {}
            opportunity["learning_evaluation"] = evaluation
        for field in (
            "champion_rank",
            "counterfactual_rank",
            "applied_rank",
            "champion_score",
            "counterfactual_score",
            "applied_score",
            "applied_weight",
        ):
            if field in candidate:
                evaluation[field] = candidate.get(field)
                opportunity[field] = candidate.get(field)
        opportunity["scan_ordinal"] = candidate.get("scan_ordinal")
        opportunity["display_ordinal"] = candidate.get("display_ordinal")
        if candidate.get("ranking_model_version"):
            opportunity["ranking_model_version"] = candidate["ranking_model_version"]
        if candidate.get("applied_score") is not None:
            opportunity["score"] = float(candidate["applied_score"])
            opportunity["grade"] = opportunity_grade(float(opportunity["score"]))
        frozen.append(opportunity)
    return frozen


def build_scanner_run_detail(
    run_id: int,
    *,
    include_ranking_snapshot: bool = True,
) -> dict[str, object]:
    expire_stale_sweep_runs()
    with get_db_session() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == run_id).first()
        if run is None:
            raise LookupError(f"Scanner run #{run_id} was not found.")

        symbols = _csv_symbols(run.hit_symbols)
        events: list[OptionAlertEvent] = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.sweep_run_id == run_id)
            .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
            .all()
        )
        if symbols and run.started_at:
            window_start = run.started_at - timedelta(minutes=5)
            window_end = (run.completed_at or run.updated_at or datetime.utcnow()) + timedelta(minutes=10)
            if not events:
                events = (
                    db.query(OptionAlertEvent)
                    .filter(
                        OptionAlertEvent.symbol.in_(symbols),
                        OptionAlertEvent.triggered_at >= window_start,
                        OptionAlertEvent.triggered_at <= window_end,
                    )
                    .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
                    .all()
                )
        elif run.hits and run.started_at and not events:
            window_start = run.started_at - timedelta(minutes=5)
            window_end = (run.completed_at or run.updated_at or datetime.utcnow()) + timedelta(minutes=10)
            legacy_query = db.query(OptionAlertEvent).filter(
                OptionAlertEvent.triggered_at >= window_start,
                OptionAlertEvent.triggered_at <= window_end,
            )
            if run.universe_label:
                legacy_query = legacy_query.filter(OptionAlertEvent.message.ilike(f"%{run.universe_label}%"))
            events = (
                legacy_query
                .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
                .limit(max(int(run.hits or 0), 25))
                .all()
            )
        repeat_context = load_scanner_repeat_evidence_context(db, events=events)
        learning_context = build_learning_influence_context(learning_summary(db))
        serialized_run = _serialize_run(run)
        serialized_snapshot = (
            serialize_rank_snapshot(snapshot_for_run(db, run_id))
            if include_ranking_snapshot
            else None
        )

    if not symbols:
        symbols = []
        for event in events:
            symbol = str(event.symbol or "").strip().upper()
            if symbol and symbol not in symbols:
                symbols.append(symbol)

    symbol_order = {symbol: index for index, symbol in enumerate(symbols)}
    filtered_events = [
        event
        for event in events
        if not symbol_order or str(event.symbol or "").strip().upper() in symbol_order
    ]
    symbol_counts = Counter(str(event.symbol or "").strip().upper() for event in filtered_events)
    group_counts: Counter[str] = Counter()
    for event in filtered_events:
        symbol = str(event.symbol or "").strip().upper()
        group_counts[classify_optionality_symbol(symbol).group] += 1

    opportunities = []
    for event in filtered_events:
        opportunity = _ranked_opportunity_from_event(
            event,
            symbol_recent_hits=symbol_counts[str(event.symbol or "").strip().upper()],
            symbol_total_hits=symbol_counts[str(event.symbol or "").strip().upper()],
            group_recent_hits=group_counts[classify_optionality_symbol(str(event.symbol or "").strip().upper()).group],
        )
        opportunity["position_match"] = position_match_for_event(event, repeat_context)
        opportunities.append(opportunity)
    opportunities.sort(
        key=lambda row: (
            symbol_order.get(str(row["symbol"]), len(symbol_order)),
            row.get("triggered_at") or "",
            int(row["event_id"]),
        )
    )
    for scan_ordinal, opportunity in enumerate(opportunities, start=1):
        opportunity["scan_ordinal"] = scan_ordinal
    learning_policy = _attach_learning_evaluations(opportunities, learning_context)
    _apply_rank_display_order(opportunities)
    if serialized_snapshot is not None:
        opportunities = _apply_frozen_rank_snapshot(
            opportunities,
            serialized_snapshot,
        )
        frozen_policy = serialized_snapshot.get("learning_policy")
        if isinstance(frozen_policy, dict):
            learning_policy = frozen_policy
    return {
        "run": serialized_run,
        "hit_count": max(int(serialized_run.get("hits") or 0), len(symbols), len(opportunities)),
        "matched_event_count": len(opportunities),
        "hits": opportunities,
        "learning_policy": learning_policy,
        "ranking_snapshot": serialized_snapshot,
    }


def finalize_terminal_rank_snapshot(run_id: int) -> dict[str, object]:
    """Freeze one terminal run's displayed candidate order without a GET write."""

    detail = build_scanner_run_detail(
        int(run_id),
        include_ranking_snapshot=False,
    )
    payload = build_rank_snapshot_payload(
        detail["run"],
        detail["hits"],
        detail.get("learning_policy") or {},
    )
    with get_db_session() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == int(run_id)).first()
        if run is None:
            raise LookupError(f"Scanner run #{run_id} was not found.")
        snapshot, _created = persist_rank_snapshot(db, run, payload)
        return serialize_rank_snapshot(snapshot) or {}


def _finalize_rank_snapshot_safely(run_id: int) -> None:
    try:
        finalize_terminal_rank_snapshot(int(run_id))
    except Exception:
        logger.exception(
            "Failed to persist terminal scanner rank snapshot for run %s.",
            run_id,
        )


def build_scanner_summary(lookback_days: int = 45, run_limit: int = 8, event_limit: int = 2000) -> dict[str, object]:
    lookback_days = max(1, min(3650, int(lookback_days or 45)))
    run_limit = max(1, min(50, int(run_limit or 8)))
    event_limit = max(10, min(5000, int(event_limit or 500)))
    stale_runs_marked = expire_stale_sweep_runs()
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    recent_cutoff = datetime.utcnow() - timedelta(days=7)

    with get_db_session() as db:
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= cutoff)
            .order_by(desc(OptionAlertEvent.triggered_at))
            .limit(event_limit)
            .all()
        )
        runs = (
            db.query(OptionSweepRun)
            .order_by(desc(OptionSweepRun.started_at), desc(OptionSweepRun.id))
            .limit(run_limit)
            .all()
        )
        repeat_context = load_scanner_repeat_evidence_context(db, events=events)
        learning_context = build_learning_influence_context(learning_summary(db))

    by_symbol: dict[str, dict[str, Any]] = {}
    event_records: list[dict[str, Any]] = []
    group_recent_counts: Counter[str] = Counter()
    delivered = 0
    failed = 0
    latest_event_at = None
    for event in events:
        symbol = str(event.symbol or "").strip().upper()
        if not symbol:
            continue
        triggered_at = event.triggered_at
        if triggered_at and (latest_event_at is None or triggered_at > latest_event_at):
            latest_event_at = triggered_at
        if event.delivered:
            delivered += 1
        else:
            failed += 1
        classification = classify_optionality_symbol(symbol)
        spread = None
        if event.iv30 is not None and event.hv30 is not None:
            spread = float(event.iv30) - float(event.hv30)
        if triggered_at and triggered_at >= recent_cutoff:
            group_recent_counts[classification.group] += 1
        event_records.append(
            {
                "event": event,
                "symbol": symbol,
                "classification": classification,
                "triggered_at": triggered_at,
                "iv_hv_spread": spread,
            }
        )
        row = by_symbol.setdefault(
            symbol,
            {
                "symbol": symbol,
                "hits": 0,
                "recent_hits": 0,
                "latest_triggered_at": None,
                "group": classification.group,
                "sector": classification.sector,
                "_iv_percentiles": [],
                "_spreads": [],
                "_opportunity_scores": [],
            },
        )
        row["hits"] += 1
        if triggered_at and triggered_at >= recent_cutoff:
            row["recent_hits"] += 1
        if triggered_at and (row["latest_triggered_at"] is None or triggered_at > row["latest_triggered_at"]):
            row["latest_triggered_at"] = triggered_at
        if event.iv_percentile is not None:
            row["_iv_percentiles"].append(float(event.iv_percentile))
        if spread is not None:
            row["_spreads"].append(spread)
        if event.opportunity_score is not None:
            row["_opportunity_scores"].append(float(event.opportunity_score))

    top_symbols = []
    for row in by_symbol.values():
        iv_values = row.pop("_iv_percentiles")
        spread_values = row.pop("_spreads")
        opportunity_values = row.pop("_opportunity_scores")
        row["avg_iv_percentile"] = round(sum(iv_values) / len(iv_values), 2) if iv_values else None
        row["avg_iv_hv_spread"] = round(sum(spread_values) / len(spread_values), 2) if spread_values else None
        row["avg_opportunity_score"] = (
            round(sum(opportunity_values) / len(opportunity_values), 2) if opportunity_values else None
        )
        row["latest_triggered_at"] = (
            row["latest_triggered_at"].isoformat() if row["latest_triggered_at"] else None
        )
        top_symbols.append(row)
    top_symbols.sort(
        key=lambda row: (
            int(row["recent_hits"]),
            int(row["hits"]),
            row["latest_triggered_at"] or "",
        ),
        reverse=True,
    )

    ranked_by_symbol: dict[str, dict[str, Any]] = {}
    for record in event_records:
        event = record["event"]
        symbol = record["symbol"]
        row = by_symbol.get(symbol)
        if not row:
            continue
        classification = record["classification"]
        score_payload = compute_opportunity_score(
            iv_percentile=event.iv_percentile,
            iv30=event.iv30,
            hv30=event.hv30,
            avg_edr=event.avg_edr,
            selected_spread_pct=event.selected_spread_pct,
            selected_open_interest=event.selected_open_interest,
            selected_volume=event.selected_volume,
            selected_reward_risk=event.selected_reward_risk,
            selected_convexity_profit_pct=event.selected_convexity_profit_pct,
            selected_convexity_probability_itm=event.selected_convexity_probability_itm,
            selected_contract_score=event.selected_contract_score,
            symbol_recent_hits=int(row["recent_hits"]),
            symbol_total_hits=int(row["hits"]),
            group_recent_hits=group_recent_counts[classification.group],
        )
        base_score = float(event.opportunity_score) if event.opportunity_score is not None else float(score_payload["base_score"])
        rank_score = float(score_payload["rank_score"])
        triggered_at = record["triggered_at"]
        opportunity = {
            "event_id": event.id,
            "symbol": symbol,
            "triggered_at": triggered_at.isoformat() if triggered_at else None,
            "group": classification.group,
            "sector": classification.sector,
            "score": rank_score,
            "base_score": round(base_score, 2),
            "grade": score_payload.get("grade") or opportunity_grade(rank_score),
            "model_version": event.opportunity_model_version or OPPORTUNITY_MODEL_VERSION,
            "components": score_payload.get("components") or {},
            "reasons": score_payload.get("reasons") or [],
            "iv_percentile": event.iv_percentile,
            "iv30": event.iv30,
            "hv30": event.hv30,
            "iv_hv_spread": record["iv_hv_spread"],
            "avg_edr": event.avg_edr,
            "field_context": option_field_context_from_event(event),
            "learning_evaluation": _stored_learning_evaluation(event),
            "review_window": _review_window_payload(event),
            "selected_contract": {
                "expiry": event.selected_expiry,
                "dte": event.selected_dte,
                "strike": event.selected_strike,
                "option_type": event.selected_option_type,
                "premium": event.selected_premium,
                "spread_pct": event.selected_spread_pct,
                "open_interest": event.selected_open_interest,
                "volume": event.selected_volume,
                "implied_volatility": event.selected_implied_volatility,
                "contract_score": event.selected_contract_score,
                "reward_risk": event.selected_reward_risk,
                "convexity_profit_pct": event.selected_convexity_profit_pct,
                "convexity_probability_itm": event.selected_convexity_probability_itm,
            },
            "position_match": position_match_for_event(event, repeat_context),
        }
        current = ranked_by_symbol.get(symbol)
        if (
            current is None
            or rank_score > float(current["score"])
            or (
                rank_score == float(current["score"])
                and (opportunity["triggered_at"] or "") > (current.get("triggered_at") or "")
            )
        ):
            ranked_by_symbol[symbol] = opportunity

    ranked_opportunities = sorted(
        ranked_by_symbol.values(),
        key=lambda row: (float(row["score"]), row.get("triggered_at") or ""),
        reverse=True,
    )
    learning_policy = _attach_learning_evaluations(ranked_opportunities, learning_context)
    ranked_opportunities.sort(
        key=lambda row: (float(row["score"]), row.get("triggered_at") or ""),
        reverse=True,
    )

    run_rows = [_serialize_run(run) for run in runs]
    completed_runs = [run for run in runs if run.completed_at is not None]
    avg_hit_rate = None
    if completed_runs:
        total_scanned = sum(int(run.total_symbols or run.scanned_symbols or 0) for run in completed_runs)
        total_hits = sum(int(run.hits or 0) for run in completed_runs)
        avg_hit_rate = round((total_hits / total_scanned) * 100, 2) if total_scanned else None

    return {
        "lookback_days": lookback_days,
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "event_count": len(events),
            "symbol_count": len(by_symbol),
            "delivered": delivered,
            "failed": failed,
            "latest_event_at": latest_event_at.isoformat() if latest_event_at else None,
            "runs_returned": len(run_rows),
            "active_runs": sum(1 for run in runs if run.status in ACTIVE_STATUSES),
            "stale_runs_marked": stale_runs_marked,
            "avg_hit_rate": avg_hit_rate,
        },
        "top_symbols": top_symbols[:12],
        "ranked_opportunities": ranked_opportunities[:12],
        "learning_policy": learning_policy,
        "runs": run_rows,
        "supported_universes": [
            {"key": key, "label": label}
            for key, label in SUPPORTED_SWEEP_UNIVERSES.items()
        ],
    }
