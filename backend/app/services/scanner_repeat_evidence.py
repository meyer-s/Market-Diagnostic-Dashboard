from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
import json
import math
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.option_decision_learning import OptionPositionEvent, OptionThesisAssessment
from app.models.option_position_reviews import OptionPositionReview
from app.models.option_positions import OptionPosition
from app.models.options_alerts import OptionAlertEvent
from app.services.options_opportunity import compute_opportunity_score


MATERIAL_BASE_SCORE_DELTA = 5.0
CONTRADICTING_BASE_SCORE_DELTA = -8.0


@dataclass(frozen=True)
class ScannerRepeatEvidenceContext:
    positions_by_symbol: dict[str, tuple[OptionPosition, ...]]
    events_by_symbol: dict[str, tuple[OptionAlertEvent, ...]]
    latest_decision_by_position: dict[int, dict[str, object]]


def _finite(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _symbol(value: object) -> str:
    return str(value or "").strip().upper()


def _option_type(value: object) -> str:
    return str(value or "").strip().lower()


def _expiry(value: object) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _event_key(event: OptionAlertEvent) -> tuple[datetime, int]:
    return event.triggered_at or datetime.min, int(event.id or 0)


def _same_contract(event: OptionAlertEvent, position: OptionPosition) -> bool:
    event_expiry = _expiry(event.selected_expiry)
    event_strike = _finite(event.selected_strike)
    position_strike = _finite(position.strike)
    return bool(
        event_expiry is not None
        and event_expiry == position.expiration
        and event_strike is not None
        and position_strike is not None
        and abs(event_strike - position_strike) <= 0.005
        and _option_type(event.selected_option_type) == _option_type(position.option_type)
    )


def _contract_comparison_available(event: OptionAlertEvent) -> bool:
    return bool(
        _expiry(event.selected_expiry) is not None
        and _finite(event.selected_strike) is not None
        and _option_type(event.selected_option_type) in {"call", "put"}
    )


def _event_is_after_entry(event: OptionAlertEvent, position: OptionPosition) -> bool:
    if (
        position.source_event_id is not None
        and event.id is not None
        and int(event.id) <= int(position.source_event_id)
    ):
        return False
    if event.triggered_at is not None and event.triggered_at.date() < position.trade_date:
        return False
    return True


def _occurrence_key(event: OptionAlertEvent) -> tuple[str, int]:
    if event.sweep_run_id is not None:
        return "sweep_run", int(event.sweep_run_id)
    return "event", int(event.id or 0)


def _event_base_score(event: OptionAlertEvent) -> Optional[float]:
    stored = _finite(event.opportunity_score)
    if stored is not None:
        return round(stored, 2)
    score = compute_opportunity_score(
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
    )
    return _finite(score.get("base_score"))


def _event_spread(event: OptionAlertEvent) -> Optional[float]:
    iv = _finite(event.iv30)
    hv = _finite(event.hv30)
    return None if iv is None or hv is None else iv - hv


def _contract_snapshot(event: OptionAlertEvent) -> dict[str, object]:
    return {
        "expiry": event.selected_expiry,
        "strike": _finite(event.selected_strike),
        "option_type": _option_type(event.selected_option_type) or None,
        "premium": _finite(event.selected_premium),
        "dte": event.selected_dte,
    }


def _held_contract_snapshot(position: OptionPosition) -> dict[str, object]:
    return {
        "expiry": position.expiration.isoformat() if position.expiration else None,
        "strike": _finite(position.strike),
        "option_type": _option_type(position.option_type) or None,
    }


def _metric_delta(
    metric: str,
    label: str,
    previous: object,
    current: object,
    *,
    minimum: float,
    higher_is_better: bool,
) -> Optional[dict[str, object]]:
    previous_value = _finite(previous)
    current_value = _finite(current)
    if previous_value is None or current_value is None:
        return None
    delta = current_value - previous_value
    if abs(delta) < minimum:
        return None
    favorable = delta > 0 if higher_is_better else delta < 0
    return {
        "metric": metric,
        "label": label,
        "previous": round(previous_value, 2),
        "current": round(current_value, 2),
        "delta": round(delta, 2),
        "direction": "favorable" if favorable else "unfavorable",
    }


def _meaningful_deltas(
    event: OptionAlertEvent,
    previous: Optional[OptionAlertEvent],
) -> list[dict[str, object]]:
    if previous is None:
        return []
    candidates = [
        _metric_delta(
            "base_score",
            "Base score",
            _event_base_score(previous),
            _event_base_score(event),
            minimum=0.5,
            higher_is_better=True,
        ),
        _metric_delta(
            "contract_score",
            "Contract score",
            previous.selected_contract_score,
            event.selected_contract_score,
            minimum=0.25,
            higher_is_better=True,
        ),
        _metric_delta(
            "reward_risk",
            "Reward / risk",
            previous.selected_reward_risk,
            event.selected_reward_risk,
            minimum=0.1,
            higher_is_better=True,
        ),
        _metric_delta(
            "iv_hv_spread",
            "IV / HV spread",
            _event_spread(previous),
            _event_spread(event),
            minimum=0.75,
            higher_is_better=False,
        ),
        _metric_delta(
            "spread_pct",
            "Bid / ask spread",
            previous.selected_spread_pct,
            event.selected_spread_pct,
            minimum=1.0,
            higher_is_better=False,
        ),
        _metric_delta(
            "open_interest",
            "Open interest",
            previous.selected_open_interest,
            event.selected_open_interest,
            minimum=25.0,
            higher_is_better=True,
        ),
    ]
    # Stable priority keeps the concise three-item UI deterministic. The base
    # score leads because it explicitly excludes the recurrence bonus.
    return [delta for delta in candidates if delta is not None][:3]


def _numeric_deltas(
    event: OptionAlertEvent,
    previous: Optional[OptionAlertEvent],
) -> dict[str, Optional[float]]:
    if previous is None:
        return {
            "base_score": None,
            "contract_score": None,
            "reward_risk": None,
            "iv_hv_spread": None,
            "spread_pct": None,
            "open_interest": None,
        }

    def difference(current: object, prior: object) -> Optional[float]:
        current_value = _finite(current)
        previous_value = _finite(prior)
        if current_value is None or previous_value is None:
            return None
        return round(current_value - previous_value, 2)

    return {
        "base_score": difference(_event_base_score(event), _event_base_score(previous)),
        "contract_score": difference(event.selected_contract_score, previous.selected_contract_score),
        "reward_risk": difference(event.selected_reward_risk, previous.selected_reward_risk),
        "iv_hv_spread": difference(_event_spread(event), _event_spread(previous)),
        "spread_pct": difference(event.selected_spread_pct, previous.selected_spread_pct),
        "open_interest": difference(event.selected_open_interest, previous.selected_open_interest),
    }


def _format_delta_summary(deltas: list[dict[str, object]]) -> str:
    if not deltas:
        return "No material evidence change since the previous matching scan."
    parts = []
    for delta in deltas:
        amount = _finite(delta.get("delta")) or 0.0
        parts.append(f"{delta['label']} {amount:+.1f}")
    return "; ".join(parts)


def _position_distance(event: OptionAlertEvent, position: OptionPosition) -> tuple[int, float, int]:
    event_expiry = _expiry(event.selected_expiry)
    expiry_distance = abs((event_expiry - position.expiration).days) if event_expiry else 100000
    event_strike = _finite(event.selected_strike)
    position_strike = _finite(position.strike)
    strike_distance = (
        abs(event_strike - position_strike)
        if event_strike is not None and position_strike is not None
        else 100000.0
    )
    type_penalty = 0 if _option_type(event.selected_option_type) == _option_type(position.option_type) else 1
    return type_penalty * 100000 + expiry_distance, strike_distance, -int(position.id or 0)


def load_scanner_repeat_evidence_context(
    db: Session,
    *,
    events: Iterable[OptionAlertEvent],
) -> ScannerRepeatEvidenceContext:
    event_list = list(events)
    symbols = sorted({_symbol(event.symbol) for event in event_list if _symbol(event.symbol)})
    if not symbols:
        return ScannerRepeatEvidenceContext({}, {}, {})

    positions = (
        db.query(OptionPosition)
        .filter(OptionPosition.symbol.in_(symbols), OptionPosition.contracts > 0)
        .order_by(OptionPosition.symbol.asc(), OptionPosition.trade_date.asc(), OptionPosition.id.asc())
        .all()
    )
    positions_by_symbol: dict[str, list[OptionPosition]] = defaultdict(list)
    for position in positions:
        positions_by_symbol[_symbol(position.symbol)].append(position)

    held_symbols = sorted(positions_by_symbol)
    if not held_symbols:
        return ScannerRepeatEvidenceContext({}, {}, {})
    earliest_trade_at = datetime.combine(
        min(position.trade_date for position in positions),
        datetime.min.time(),
    )
    source_event_ids = [
        int(position.source_event_id)
        for position in positions
        if position.source_event_id is not None
    ]
    history_floor = OptionAlertEvent.triggered_at >= earliest_trade_at
    history_filter = (
        or_(history_floor, OptionAlertEvent.id.in_(source_event_ids))
        if source_event_ids
        else history_floor
    )

    historical_events = (
        db.query(OptionAlertEvent)
        .filter(
            OptionAlertEvent.symbol.in_(held_symbols),
            history_filter,
        )
        .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
        .all()
    )
    events_by_symbol: dict[str, list[OptionAlertEvent]] = defaultdict(list)
    for historical in historical_events:
        events_by_symbol[_symbol(historical.symbol)].append(historical)

    position_ids = [int(position.id) for position in positions if position.id is not None]
    latest_decisions: dict[int, dict[str, object]] = {}
    if position_ids:
        latest_review_ids = (
            select(func.max(OptionPositionReview.id))
            .where(OptionPositionReview.position_id.in_(position_ids))
            .group_by(OptionPositionReview.position_id)
        )
        reviews = (
            db.query(OptionPositionReview)
            .filter(OptionPositionReview.id.in_(latest_review_ids))
            .all()
        )
        for review in reviews:
            latest_decisions[int(review.position_id)] = {
                "source": "review",
                "id": review.id,
                "verdict": review.verdict,
                "target_contracts": review.target_contracts,
            }
        latest_assessment_ids = (
            select(func.max(OptionThesisAssessment.id))
            .where(OptionThesisAssessment.position_id.in_(position_ids))
            .group_by(OptionThesisAssessment.position_id)
        )
        assessments = (
            db.query(OptionThesisAssessment)
            .filter(OptionThesisAssessment.id.in_(latest_assessment_ids))
            .all()
        )
        for assessment in assessments:
            existing = latest_decisions.get(int(assessment.position_id))
            if existing and existing.get("source") == "review":
                continue
            latest_decisions[int(assessment.position_id)] = {
                "source": "assessment",
                "id": assessment.id,
                "verdict": assessment.proposed_verdict,
                "target_contracts": assessment.proposed_target_contracts,
            }

    return ScannerRepeatEvidenceContext(
        positions_by_symbol={key: tuple(value) for key, value in positions_by_symbol.items()},
        events_by_symbol={key: tuple(value) for key, value in events_by_symbol.items()},
        latest_decision_by_position=latest_decisions,
    )


def _prior_events(
    event: OptionAlertEvent,
    position: OptionPosition,
    historical_events: Iterable[OptionAlertEvent],
    *,
    exact_contract: bool,
) -> list[OptionAlertEvent]:
    current_key = _event_key(event)
    current_occurrence = _occurrence_key(event)
    eligible = []
    occurrences: dict[tuple[str, int], OptionAlertEvent] = {}
    for candidate in historical_events:
        if candidate.id == event.id or _event_key(candidate) >= current_key:
            continue
        if _occurrence_key(candidate) == current_occurrence:
            continue
        if not _event_is_after_entry(candidate, position):
            continue
        if exact_contract and not _same_contract(candidate, position):
            continue
        occurrences[_occurrence_key(candidate)] = candidate
    eligible.extend(occurrences.values())
    eligible.sort(key=_event_key)
    return eligible


def _decision_conflict(
    positions: Iterable[OptionPosition],
    decisions: dict[int, dict[str, object]],
) -> Optional[dict[str, object]]:
    for position in positions:
        decision = decisions.get(int(position.id))
        if not decision:
            continue
        target = decision.get("target_contracts")
        verdict = str(decision.get("verdict") or "")
        target_is_lower = isinstance(target, int) and target < int(position.contracts or 0)
        if verdict in {"close", "reduce", "replacement_candidate"} or target_is_lower:
            return decision
    return None


def position_match_for_event(
    event: OptionAlertEvent,
    context: ScannerRepeatEvidenceContext,
) -> Optional[dict[str, object]]:
    symbol = _symbol(event.symbol)
    positions = [
        position
        for position in context.positions_by_symbol.get(symbol, ())
        if _event_is_after_entry(event, position)
    ]
    if not positions:
        return None
    contract_comparison_available = _contract_comparison_available(event)
    exact_positions = [position for position in positions if _same_contract(event, position)]
    match_type = "exact_contract" if exact_positions else "same_symbol"
    matched_positions = exact_positions or [min(positions, key=lambda row: _position_distance(event, row))]
    primary = matched_positions[0]
    history = context.events_by_symbol.get(symbol, ())
    prior = _prior_events(event, primary, history, exact_contract=bool(exact_positions))
    source_baseline = None
    if exact_positions and primary.source_event_id is not None:
        source_baseline = next(
            (
                candidate
                for candidate in history
                if candidate.id == primary.source_event_id and _same_contract(candidate, primary)
            ),
            None,
        )
    previous = prior[-1] if prior else source_baseline
    recurrence_count = len(prior) + 1
    current_base_score = _event_base_score(event)
    previous_base_score = _event_base_score(previous) if previous else None
    base_score_delta = (
        round(current_base_score - previous_base_score, 2)
        if current_base_score is not None and previous_base_score is not None
        else None
    )
    deltas = _meaningful_deltas(event, previous)
    numeric_deltas = _numeric_deltas(event, previous)
    conflict = _decision_conflict(matched_positions, context.latest_decision_by_position)
    if match_type == "same_symbol" and not contract_comparison_available:
        classification = "still_qualifies"
        delta_summary = (
            "The scanner repeated this held symbol, but contract fields are "
            "incomplete; contract drift is unavailable."
        )
    elif match_type == "same_symbol" and _option_type(event.selected_option_type) != _option_type(primary.option_type):
        classification = "contradiction"
        delta_summary = (
            f"Scanner direction is {_option_type(event.selected_option_type)} while the held contract is "
            f"{_option_type(primary.option_type)}."
        )
    elif match_type == "same_symbol":
        classification = "contract_drift"
        held = _held_contract_snapshot(primary)
        selected = _contract_snapshot(event)
        delta_summary = (
            f"Scanner selected {selected.get('expiry') or 'unknown expiry'} "
            f"${selected.get('strike') or 0:g} {selected.get('option_type') or 'option'}; "
            f"held contract is {held.get('expiry') or 'unknown expiry'} "
            f"${held.get('strike') or 0:g} {held.get('option_type') or 'option'}."
        )
    elif conflict:
        classification = "portfolio_conflict"
        delta_summary = (
            f"Scanner repeated, but the latest {conflict.get('source')} calls for "
            f"{conflict.get('verdict')} to {conflict.get('target_contracts')} contracts."
        )
    else:
        favorable = sum(1 for delta in deltas if delta.get("direction") == "favorable")
        unfavorable = sum(1 for delta in deltas if delta.get("direction") == "unfavorable")
        if base_score_delta is not None and (
            base_score_delta <= CONTRADICTING_BASE_SCORE_DELTA
            or (base_score_delta <= -3.0 and unfavorable >= 2)
        ):
            classification = "contradiction"
        elif base_score_delta is not None and (
            base_score_delta >= MATERIAL_BASE_SCORE_DELTA
            or (base_score_delta >= 0 and favorable >= 2)
        ):
            classification = "strengthened"
        else:
            classification = "still_qualifies"
        delta_summary = (
            _format_delta_summary(deltas)
            if previous is not None
            else "First recorded scanner match while this exact contract is held."
        )

    previous_payload = None
    if previous is not None:
        previous_payload = {
            "event_id": previous.id,
            "triggered_at": previous.triggered_at.isoformat() if previous.triggered_at else None,
            "base_score": previous_base_score,
            "selected_contract": _contract_snapshot(previous),
            "baseline_kind": (
                "entry_source"
                if source_baseline is not None and previous.id == source_baseline.id
                else "recurrence"
            ),
        }

    return {
        "match_type": match_type,
        "classification": classification,
        "position_id": primary.id,
        "position_ids": [position.id for position in matched_positions],
        "contracts": sum(int(position.contracts or 0) for position in matched_positions),
        "held_contracts": sum(int(position.contracts or 0) for position in matched_positions),
        "recurrence_count": recurrence_count,
        "repeat_count": recurrence_count,
        "recurrence_scope": "exact_contract" if exact_positions else "symbol",
        "contract_comparison_status": "available" if contract_comparison_available else "unavailable",
        "current_base_score": current_base_score,
        "previous_base_score": previous_base_score,
        "base_score_delta": base_score_delta,
        "previous_matching_scanner_hit": previous_payload,
        "previous_event_id": previous.id if previous is not None else None,
        "delta_summary": delta_summary,
        "deltas": numeric_deltas,
        "material_deltas": deltas,
        "held_contract": _held_contract_snapshot(primary),
        "selected_contract": _contract_snapshot(event),
        "assessment_refresh_recommended": bool(
            match_type == "exact_contract"
            and classification in {"strengthened", "contradiction", "portfolio_conflict"}
        ),
        "automated_add_enabled": False,
    }


def _append_recurrence_events(
    db: Session,
    event: OptionAlertEvent,
    context: ScannerRepeatEvidenceContext,
    existing_keys: set[tuple[int, int]],
) -> list[OptionPositionEvent]:
    positions = context.positions_by_symbol.get(_symbol(event.symbol), ())
    inserted: list[OptionPositionEvent] = []
    for position in positions:
        key = int(position.id), int(event.id)
        if key in existing_keys:
            continue
        per_position_context = ScannerRepeatEvidenceContext(
            positions_by_symbol={_symbol(event.symbol): (position,)},
            events_by_symbol=context.events_by_symbol,
            latest_decision_by_position=context.latest_decision_by_position,
        )
        payload = position_match_for_event(event, per_position_context)
        if payload is None:
            continue
        details = {
            "scanner_event_id": event.id,
            "sweep_run_id": event.sweep_run_id,
            **payload,
            "position_ids": [position.id],
            "position_mutated": False,
            "decision_dates_mutated": False,
        }
        row = OptionPositionEvent(
            position_id=position.id,
            event_type="scanner_recurrence",
            event_at=event.triggered_at or datetime.utcnow(),
            source="scanner",
            related_alert_event_id=event.id,
            quantity_before=position.contracts,
            quantity_after=position.contracts,
            total_cost_before=position.total_cost,
            total_cost_after=position.total_cost,
            details_json=json.dumps(details, sort_keys=True, default=str),
        )
        db.add(row)
        inserted.append(row)
        existing_keys.add(key)
    return inserted


def record_scanner_recurrence_events(db: Session, event: OptionAlertEvent) -> list[OptionPositionEvent]:
    """Append position lifecycle evidence for one persisted scanner event.

    The caller owns the transaction. Idempotency is keyed by the stable scanner
    event id plus position id; this function never changes the live position or
    any review/deadline dates.
    """
    if event.id is None:
        db.flush()
    if event.id is None:
        return []
    context = load_scanner_repeat_evidence_context(db, events=[event])
    existing_keys = {
        (int(position_id), int(alert_event_id))
        for position_id, alert_event_id in (
            db.query(
                OptionPositionEvent.position_id,
                OptionPositionEvent.related_alert_event_id,
            )
            .filter(
                OptionPositionEvent.event_type == "scanner_recurrence",
                OptionPositionEvent.related_alert_event_id == event.id,
            )
            .all()
        )
        if alert_event_id is not None
    }
    inserted = _append_recurrence_events(db, event, context, existing_keys)
    db.flush()
    return inserted


def record_scanner_recurrence_events_for_run(db: Session, run_id: int) -> int:
    events = (
        db.query(OptionAlertEvent)
        .filter(OptionAlertEvent.sweep_run_id == run_id)
        .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
        .all()
    )
    if not events:
        return 0
    event_ids = [int(event.id) for event in events if event.id is not None]
    existing_keys = {
        (int(position_id), int(alert_event_id))
        for position_id, alert_event_id in (
            db.query(
                OptionPositionEvent.position_id,
                OptionPositionEvent.related_alert_event_id,
            )
            .filter(
                OptionPositionEvent.event_type == "scanner_recurrence",
                OptionPositionEvent.related_alert_event_id.in_(event_ids),
            )
            .all()
        )
        if alert_event_id is not None
    }
    context = load_scanner_repeat_evidence_context(db, events=events)
    inserted_rows: list[OptionPositionEvent] = []
    for event in events:
        if event.id is not None:
            inserted_rows.extend(_append_recurrence_events(db, event, context, existing_keys))
    db.flush()
    return len(inserted_rows)
