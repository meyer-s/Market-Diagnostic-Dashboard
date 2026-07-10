from __future__ import annotations

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
from app.services.options_opportunity import OPPORTUNITY_MODEL_VERSION, compute_opportunity_score, opportunity_grade
from app.services.options_alerts import _send_webhook
from app.utils.db_helpers import get_db_session
from maintenance_scripts.options_chain_sweep import _scan_tickers


ACTIVE_STATUSES = {"queued", "running"}


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


def _dashboard_pause_seconds(total_tickers: int) -> float:
    default_pause = 0.2
    if total_tickers > 2000:
        default_pause = 0.02
    elif total_tickers > 1000:
        default_pause = 0.05
    if os.getenv("MARKET_DATA_PROVIDER", "yahoo").strip().lower() == "ibkr":
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


def _run_dashboard_sweep(run_id: int, universe_key: str, threshold: float) -> None:
    try:
        universe = resolve_sweep_universe(universe_key)
        tickers = universe.tickers
        label = universe.label
        if not tickers:
            message = f"Failed to fetch tickers for {label}."
            fail_sweep_run(run_id, message)
            _send_webhook(f":warning: Options sweep aborted. {message}")
            return

        pause_seconds = _dashboard_pause_seconds(len(tickers))
        provider_name = os.getenv("MARKET_DATA_PROVIDER", "yahoo").strip().lower() or "yahoo"
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
            rate_limit_backoff_seconds=rate_limit_backoff_seconds,
            rate_limit_backoff_multiplier=rate_limit_backoff_multiplier,
            rate_limit_backoff_max_seconds=rate_limit_backoff_max_seconds,
            rate_limit_max_retries=rate_limit_max_retries,
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
            status="completed",
            total_symbols=len(tickers),
            hits=int(hits),
            hit_symbols=hit_symbols,
            hit_details=hit_details,
        )
        details = ""
        if hit_symbols:
            preview = ", ".join(hit_symbols[:12])
            details = f" Hit symbols: {preview}{'' if len(hit_symbols) <= 12 else f' (+{len(hit_symbols) - 12} more)'}."
        _send_webhook(f":white_check_mark: Dashboard options sweep finished. {label} scanned {len(tickers)}. Hits: {hits}.{details}")
    except Exception as exc:
        fail_sweep_run(run_id, str(exc))
        _send_webhook(f":warning: Dashboard options sweep failed. {universe_key}: {exc}")


def start_dashboard_sweep(universe_key: str, threshold: float) -> dict[str, object]:
    canonical = canonical_universe_key(universe_key)
    if not canonical:
        supported = ", ".join(SUPPORTED_SWEEP_UNIVERSES.keys())
        raise ValueError(f"Unsupported universe '{universe_key}'. Supported: {supported}")

    threshold = max(1.0, min(99.0, float(threshold)))
    stale_cutoff = datetime.utcnow() - timedelta(hours=12)
    with get_db_session() as db:
        active = (
            db.query(OptionSweepRun)
            .filter(
                OptionSweepRun.status.in_(list(ACTIVE_STATUSES)),
                OptionSweepRun.started_at >= stale_cutoff,
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
        trigger_source="dashboard",
        status="queued",
    )
    thread = threading.Thread(target=_run_dashboard_sweep, args=(run.id, canonical, threshold), daemon=True)
    thread.start()
    return _serialize_run(run)


def build_scanner_summary(lookback_days: int = 45, run_limit: int = 8, event_limit: int = 2000) -> dict[str, object]:
    lookback_days = max(1, min(3650, int(lookback_days or 45)))
    run_limit = max(1, min(50, int(run_limit or 8)))
    event_limit = max(10, min(5000, int(event_limit or 500)))
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
            "avg_hit_rate": avg_hit_rate,
        },
        "top_symbols": top_symbols[:12],
        "ranked_opportunities": ranked_opportunities[:12],
        "runs": run_rows,
        "supported_universes": [
            {"key": key, "label": label}
            for key, label in SUPPORTED_SWEEP_UNIVERSES.items()
        ],
    }
