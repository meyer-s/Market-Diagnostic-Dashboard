from __future__ import annotations

from datetime import date, datetime, timedelta
import math
from typing import Any, Callable, Iterable, Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.models.closed_positions import ClosedPosition
from app.models.options_alerts import OptionAlertEvent
from app.models.option_decision_learning import (
    OptionDecisionOutcome,
    OptionModelRegistry,
    OptionPositionEvent,
    OptionPositionMandate,
    OptionThesisAssessment,
    OptionTradeOutcome,
)
from app.models.option_position_reviews import OptionPositionReview
from app.models.option_positions import OptionPosition
from app.models.stock_price_bar import StockPriceBar
from app.services.greeks_calculator import black_scholes_price
from app.services.option_thesis_engine import GRADER_VERSION, json_dumps, json_loads


OUTCOME_MODEL_VERSION = "decision_outcomes_v2_field_shadow"
RISK_FREE_RATE = 0.0425
DECISION_SESSION_HORIZONS = (1, 3, 5, 10)


def _scanner_recurrence_attribution(db: Session, position_id: Optional[int]) -> dict[str, object]:
    if position_id is None:
        return {
            "cohort": "no_repeat",
            "replacement_cohort": "no_replacement_signal",
            "event_count": 0,
            "classifications": [],
            "replacement_recommendations": [],
            "event_ids": [],
            "scanner_event_ids": [],
        }
    rows = (
        db.query(OptionPositionEvent)
        .filter(
            OptionPositionEvent.position_id == position_id,
            OptionPositionEvent.event_type == "scanner_recurrence",
        )
        .order_by(OptionPositionEvent.event_at.asc(), OptionPositionEvent.id.asc())
        .all()
    )
    details = [json_loads(row.details_json, {}) for row in rows]
    classifications = sorted(
        {
            str(detail.get("classification"))
            for detail in details
            if isinstance(detail, dict) and detail.get("classification")
        }
    )
    replacement_recommendations = sorted(
        {
            str(replacement.get("recommendation"))
            for detail in details
            if isinstance(detail, dict)
            for replacement in [detail.get("replacement_decision")]
            if isinstance(replacement, dict) and replacement.get("recommendation")
        }
    )
    if "contract_drift" in classifications:
        cohort = "contract_drift_seen"
    elif "strengthened" in classifications:
        cohort = "strengthened_seen"
    elif rows:
        cohort = "repeat_seen"
    else:
        cohort = "no_repeat"
    if "convexity_harvest_candidate" in replacement_recommendations:
        replacement_cohort = "convexity_harvest_seen"
    elif "roll_out_candidate" in replacement_recommendations:
        replacement_cohort = "roll_candidate_seen"
    elif "rescue_roll_rejected" in replacement_recommendations:
        replacement_cohort = "rescue_roll_rejected_seen"
    elif "watch_replacement" in replacement_recommendations:
        replacement_cohort = "replacement_watch_seen"
    elif replacement_recommendations:
        replacement_cohort = "other_replacement_signal"
    else:
        replacement_cohort = "no_replacement_signal"
    scanner_event_ids = sorted(
        {
            int(row.related_alert_event_id)
            for row in rows
            if row.related_alert_event_id is not None
        }
    )
    return {
        "cohort": cohort,
        "replacement_cohort": replacement_cohort,
        "event_count": len(rows),
        "classifications": classifications,
        "replacement_recommendations": replacement_recommendations,
        "event_ids": [row.id for row in rows],
        "scanner_event_ids": scanner_event_ids,
    }


def _compact_market_field(value: object) -> Optional[dict[str, object]]:
    """Keep the point-in-time field evidence needed for outcome cohorts.

    The scanner and assessment snapshots are already immutable. Outcome rows
    retain a compact copy so later model/schema changes cannot silently rewrite
    the evidence that existed at the decision boundary.
    """
    if not isinstance(value, dict):
        return None
    classification = value.get("classification")
    if not isinstance(classification, dict):
        classification = {}
    quality = value.get("quality")
    if not isinstance(quality, dict):
        quality = {}
    if not quality.get("available", value.get("available", True)):
        return None
    return {
        key: value.get(key)
        for key in (
            "schema_version",
            "model_version",
            "mode",
            "computed_at",
            "observed_at",
            "as_of_bar",
            "timeframe",
            "option_type",
            "data_source",
            "completed_bars",
            "excluded_incomplete_bars",
            "quality",
            "direction",
            "strata",
            "carriers",
            "price_action",
            "hypotheses",
            "classification",
            "signals",
            "shadow_only",
            "rank_influence",
        )
        if key in value
    }


def _assessment_market_field(assessment: Optional[OptionThesisAssessment]) -> Optional[dict[str, object]]:
    if assessment is None:
        return None
    snapshot = json_loads(assessment.input_snapshot_json, {})
    if not isinstance(snapshot, dict):
        return None
    candidates: list[object] = [
        snapshot.get("field_context"),
        snapshot.get("market_field"),
    ]
    market = snapshot.get("market")
    if isinstance(market, dict):
        candidates.extend((market.get("field_context"), market.get("market_field")))
    for candidate in candidates:
        compact = _compact_market_field(candidate)
        if compact is not None:
            return compact
    return None


def _event_market_field(
    db: Session,
    event_id: Optional[int],
) -> tuple[Optional[dict[str, object]], Optional[int]]:
    if event_id is None:
        return None, None
    event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == event_id).first()
    if event is None:
        return None, None
    raw = json_loads(getattr(event, "field_context_json", None), {})
    return _compact_market_field(raw), event.id


def _position_entry_market_field(
    db: Session,
    closed: ClosedPosition,
) -> tuple[Optional[dict[str, object]], Optional[int]]:
    event_id = closed.source_event_id
    if event_id is None and closed.source_position_id is not None:
        position = (
            db.query(OptionPosition)
            .filter(OptionPosition.id == closed.source_position_id)
            .first()
        )
        if position is not None:
            event_id = position.source_event_id
    return _event_market_field(db, event_id)


def _market_field_cohort(value: Optional[dict[str, object]]) -> str:
    if not isinstance(value, dict):
        return "unavailable"
    classification = value.get("classification")
    if not isinstance(classification, dict):
        classification = value.get("signals")
    if not isinstance(classification, dict):
        return "unavailable"
    state = str(classification.get("path_state") or "").strip().lower()
    return state if state in {"supportive", "fading", "contradictory", "mixed"} else "unavailable"


def _finite(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _add_weekdays(anchor: date, sessions: int) -> date:
    cursor = anchor
    remaining = max(0, sessions)
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return cursor


def record_position_event(
    db: Session,
    *,
    position_id: int,
    event_type: str,
    event_at: Optional[datetime] = None,
    source: str = "dashboard",
    closed_position_id: Optional[int] = None,
    related_review_id: Optional[int] = None,
    related_assessment_id: Optional[int] = None,
    related_alert_event_id: Optional[int] = None,
    quantity_before: Optional[int] = None,
    quantity_after: Optional[int] = None,
    execution_price: Optional[float] = None,
    total_cost_before: Optional[float] = None,
    total_cost_after: Optional[float] = None,
    details: Optional[dict[str, object]] = None,
) -> OptionPositionEvent:
    row = OptionPositionEvent(
        position_id=position_id,
        closed_position_id=closed_position_id,
        event_type=event_type,
        event_at=event_at or datetime.utcnow(),
        source=source,
        related_review_id=related_review_id,
        related_assessment_id=related_assessment_id,
        related_alert_event_id=related_alert_event_id,
        quantity_before=quantity_before,
        quantity_after=quantity_after,
        execution_price=execution_price,
        total_cost_before=total_cost_before,
        total_cost_after=total_cost_after,
        details_json=json_dumps(details or {}),
    )
    db.add(row)
    db.flush()
    return row


def serialize_position_event(row: OptionPositionEvent) -> dict[str, object]:
    return {
        "id": row.id,
        "position_id": row.position_id,
        "closed_position_id": row.closed_position_id,
        "event_type": row.event_type,
        "event_at": row.event_at.isoformat() if row.event_at else None,
        "source": row.source,
        "related_review_id": row.related_review_id,
        "related_assessment_id": row.related_assessment_id,
        "related_alert_event_id": row.related_alert_event_id,
        "quantity_before": row.quantity_before,
        "quantity_after": row.quantity_after,
        "execution_price": row.execution_price,
        "total_cost_before": row.total_cost_before,
        "total_cost_after": row.total_cost_after,
        "details": json_loads(row.details_json, {}),
    }


def decision_horizons(review: OptionPositionReview) -> list[tuple[str, date]]:
    rows = [(f"{sessions}_sessions", _add_weekdays(review.review_date, sessions)) for sessions in DECISION_SESSION_HORIZONS]
    if review.decision_deadline:
        rows.append(("decision_deadline", review.decision_deadline))
    if review.expiration:
        rows.append(("expiration", review.expiration))
    deduped: list[tuple[str, date]] = []
    seen: set[tuple[str, date]] = set()
    for row in rows:
        if row not in seen:
            deduped.append(row)
            seen.add(row)
    return deduped


def _cached_underlying_close(db: Session, symbol: str, target: date) -> tuple[Optional[date], Optional[float]]:
    start = datetime.combine(target, datetime.min.time())
    end = datetime.combine(target + timedelta(days=7), datetime.max.time())
    row = (
        db.query(StockPriceBar)
        .filter(
            StockPriceBar.symbol == symbol,
            StockPriceBar.interval == "1d",
            StockPriceBar.timestamp >= start,
            StockPriceBar.timestamp <= end,
        )
        .order_by(StockPriceBar.timestamp.asc())
        .first()
    )
    if row is None:
        return None, None
    return row.timestamp.date(), _finite(row.close)


def _frame_underlying_close(frame: object, target: date) -> tuple[Optional[date], Optional[float]]:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        return None, None
    normalized = frame.copy()
    normalized.columns = [str(column).lower() for column in normalized.columns]
    if "close" not in normalized.columns:
        return None, None
    index = pd.to_datetime(normalized.index, errors="coerce")
    normalized = normalized.assign(_date=index.date)
    eligible = normalized[normalized["_date"] >= target]
    if eligible.empty:
        return None, None
    first = eligible.iloc[0]
    return first["_date"], _finite(first["close"])


def _option_value_at_outcome(review: OptionPositionReview, spot: float, outcome_date: date) -> tuple[Optional[float], str]:
    if outcome_date >= review.expiration:
        intrinsic = max(spot - review.strike, 0.0) if review.option_type == "call" else max(review.strike - spot, 0.0)
        return intrinsic, "expiration_intrinsic"
    volatility = _finite(review.implied_volatility_snapshot)
    if volatility is not None and volatility > 5:
        volatility /= 100.0
    if volatility is None or volatility <= 0:
        return None, "underlying_only"
    dte = max((review.expiration - outcome_date).days, 0)
    if dte <= 0:
        return None, "underlying_only"
    return (
        black_scholes_price(
            spot,
            review.strike,
            dte / 365.0,
            RISK_FREE_RATE,
            volatility,
            review.option_type,
        ),
        "black_scholes_constant_iv",
    )


def _decision_value(verdict: str, option_return: Optional[float], target: int, current: int) -> Optional[float]:
    if option_return is None:
        return None
    if verdict in {"close", "replacement_candidate"}:
        return -option_return
    if verdict == "reduce":
        reduction_fraction = max(0.0, min(1.0, (current - target) / current)) if current else 0.0
        return -option_return * reduction_fraction
    if verdict in {"hold", "conditional_hold", "add_eligible"}:
        held_fraction = target / current if current else 1.0
        return option_return * held_fraction
    return None


def mature_decision_outcomes(
    db: Session,
    *,
    today: Optional[date] = None,
    history_loader: Optional[Callable[[str], object]] = None,
    limit: int = 500,
) -> dict[str, int]:
    as_of = today or date.today()
    reviews = (
        db.query(OptionPositionReview)
        .order_by(OptionPositionReview.review_date.asc(), OptionPositionReview.id.asc())
        .limit(limit)
        .all()
    )
    inserted = 0
    skipped = 0
    errors = 0
    history_cache: dict[str, object] = {}
    for review in reviews:
        for horizon, target_date in decision_horizons(review):
            if target_date > as_of:
                continue
            existing = (
                db.query(OptionDecisionOutcome)
                .filter(
                    OptionDecisionOutcome.review_id == review.id,
                    OptionDecisionOutcome.evaluation_horizon == horizon,
                    OptionDecisionOutcome.status == "matured",
                )
                .order_by(OptionDecisionOutcome.id.desc())
                .first()
            )
            if existing is not None:
                skipped += 1
                continue
            try:
                outcome_date, outcome_spot = _cached_underlying_close(db, review.symbol, target_date)
                if outcome_spot is None and history_loader is not None:
                    if review.symbol not in history_cache:
                        history_cache[review.symbol] = history_loader(review.symbol)
                    outcome_date, outcome_spot = _frame_underlying_close(history_cache[review.symbol], target_date)
                if outcome_spot is None or outcome_date is None:
                    errors += 1
                    continue

                decision_spot = _finite(review.underlying_price_snapshot)
                directional_return = None
                if decision_spot:
                    raw = (outcome_spot / decision_spot - 1.0) * 100.0
                    directional_return = raw if review.option_type == "call" else -raw
                option_outcome, method = _option_value_at_outcome(review, outcome_spot, outcome_date)
                option_entry = _finite(review.option_price_snapshot)
                option_return = (
                    (option_outcome / option_entry - 1.0) * 100.0
                    if option_outcome is not None and option_entry
                    else None
                )
                incremental = _decision_value(
                    review.verdict,
                    option_return,
                    review.target_contracts,
                    review.contracts_snapshot,
                )
                assessment = None
                if review.selected_assessment_id:
                    assessment = db.query(OptionThesisAssessment).filter(OptionThesisAssessment.id == review.selected_assessment_id).first()
                recommended = assessment.proposed_verdict if assessment else None
                decision_field = _assessment_market_field(assessment)
                aligned = recommended is not None and recommended == review.verdict
                process_quality = "aligned_with_shadow" if aligned else "independent_or_override"
                if incremental is None:
                    outcome_quality = "unrated"
                elif incremental > 2:
                    outcome_quality = "helpful"
                elif incremental < -2:
                    outcome_quality = "harmful"
                else:
                    outcome_quality = "neutral"
                row = OptionDecisionOutcome(
                    review_id=review.id,
                    position_id=review.position_id,
                    evaluation_horizon=horizon,
                    target_date=target_date,
                    outcome_date=outcome_date,
                    status="matured",
                    decided_verdict=review.verdict,
                    recommended_verdict=recommended,
                    contracts_at_decision=review.contracts_snapshot,
                    target_contracts=review.target_contracts,
                    underlying_price_at_decision=decision_spot,
                    underlying_price_outcome=outcome_spot,
                    option_price_at_decision=option_entry,
                    option_price_outcome=option_outcome,
                    underlying_directional_return_pct=directional_return,
                    option_return_pct=option_return,
                    incremental_value_pct=incremental,
                    valuation_method=method,
                    process_quality=process_quality,
                    outcome_quality=outcome_quality,
                    attribution_json=json_dumps(
                        {
                            "mode": "counterfactual_small-trader_price_path",
                            "actual_execution_verified": False,
                            "review_decision": review.verdict,
                            "shadow_recommendation": recommended,
                            "market_field": {
                                "source": "selected_assessment",
                                "assessment_id": assessment.id if assessment else None,
                                "cohort": _market_field_cohort(decision_field),
                                "snapshot": decision_field,
                                "rank_influence": 0.0,
                            },
                            "model_version": OUTCOME_MODEL_VERSION,
                        }
                    ),
                )
                db.add(row)
                inserted += 1
            except Exception:
                errors += 1
    db.flush()
    return {"inserted": inserted, "skipped": skipped, "errors": errors}


def create_trade_outcome(
    db: Session,
    closed: ClosedPosition,
    *,
    force: bool = False,
    human_overrides: Optional[dict[str, str]] = None,
) -> OptionTradeOutcome:
    latest = (
        db.query(OptionTradeOutcome)
        .filter(OptionTradeOutcome.closed_position_id == closed.id)
        .order_by(OptionTradeOutcome.outcome_version.desc(), OptionTradeOutcome.id.desc())
        .first()
    )
    if latest is not None and not force and not human_overrides:
        return latest
    position_id = closed.source_position_id
    review = None
    if position_id is not None:
        review = (
            db.query(OptionPositionReview)
            .filter(OptionPositionReview.position_id == position_id)
            .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
            .first()
        )
    mandate = None
    assessment = None
    if position_id is not None:
        mandate = (
            db.query(OptionPositionMandate)
            .filter(OptionPositionMandate.position_id == position_id)
            .order_by(OptionPositionMandate.mandate_version.desc(), OptionPositionMandate.id.desc())
            .first()
        )
        assessment = (
            db.query(OptionThesisAssessment)
            .filter(OptionThesisAssessment.position_id == position_id)
            .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
            .first()
        )

    entry_underlying = _finite(closed.underlying_at_entry)
    exit_underlying = _finite(closed.underlying_at_exit)
    directional_return = None
    if entry_underlying and exit_underlying is not None:
        raw = (exit_underlying / entry_underlying - 1.0) * 100.0
        directional_return = raw if closed.option_type == "call" else -raw
    thesis_result = (
        "supported" if directional_return is not None and directional_return > 1
        else "not_supported" if directional_return is not None and directional_return < -1
        else "inconclusive"
    )
    financial_outcome = "profitable" if closed.dollar_pnl > 0 else "unprofitable" if closed.dollar_pnl < 0 else "flat"
    if financial_outcome == "profitable":
        contract_result = "worked"
    elif thesis_result == "supported":
        contract_result = "underlying_right_contract_wrong"
    elif thesis_result == "inconclusive":
        contract_result = "timing_or_contract_unresolved"
    else:
        contract_result = "failed_with_thesis"

    if review is None:
        decision_alignment = "no_recorded_review"
        review_discipline = "unreviewed"
    else:
        target_close = review.verdict in {"close", "replacement_candidate"} or review.target_contracts == 0
        target_reduce = review.verdict == "reduce" or review.target_contracts < review.contracts_snapshot
        if target_close or target_reduce:
            decision_alignment = "aligned_with_latest_decision"
        else:
            decision_alignment = "different_from_latest_decision"
        if review.decision_deadline and closed.close_date > review.decision_deadline:
            review_discipline = "closed_after_deadline"
        else:
            review_discipline = "reviewed_before_close"

    over_budget = bool(mandate and mandate.risk_budget is not None and closed.total_cost > mandate.risk_budget + 0.01)
    sizing_result = "over_recorded_budget" if over_budget else "within_recorded_budget" if mandate and mandate.risk_budget else "budget_unknown"
    assessment_axes = json_loads(assessment.axis_results_json, {}) if assessment else {}
    portfolio_status = (
        (assessment_axes.get("portfolio_fit") or {}).get("status")
        if isinstance(assessment_axes, dict)
        else None
    )
    portfolio_result = (
        "concentration_present"
        if portfolio_status in {"crowded", "over_budget"}
        else "acceptable"
        if portfolio_status == "acceptable"
        else "unknown"
    )
    if review_discipline == "closed_after_deadline":
        timing_result = "late_exit"
    elif thesis_result == "supported" and financial_outcome == "unprofitable":
        timing_result = "too_slow_for_contract"
    elif financial_outcome == "profitable":
        timing_result = "adequate"
    else:
        timing_result = "unclear"
    entry_execution_result = "unverified"
    if review is None:
        exit_discipline_result = "unreviewed"
    elif review_discipline == "closed_after_deadline":
        exit_discipline_result = "late"
    elif decision_alignment == "aligned_with_latest_decision":
        exit_discipline_result = "aligned"
    else:
        exit_discipline_result = "different_from_plan"
    if mandate is None:
        event_result = "unknown"
    elif mandate.trade_role != "catalyst":
        event_result = "not_catalyst"
    elif thesis_result == "supported":
        event_result = "catalyst_worked"
    else:
        event_result = "catalyst_failed_or_unconfirmed"
    if review_discipline == "unreviewed":
        process_quality = "weak_process"
    elif decision_alignment == "aligned_with_latest_decision" and not over_budget:
        process_quality = "good_process"
    else:
        process_quality = "mixed_process"

    if review_discipline in {"unreviewed", "closed_after_deadline"}:
        primary_lesson = "review_discipline"
    elif portfolio_result == "concentration_present" and financial_outcome == "unprofitable":
        primary_lesson = "portfolio_concentration"
    elif contract_result == "underlying_right_contract_wrong":
        primary_lesson = "contract_selection"
    elif timing_result in {"too_slow_for_contract", "late_exit"}:
        primary_lesson = "timing"
    elif over_budget:
        primary_lesson = "position_sizing"
    elif thesis_result == "not_supported":
        primary_lesson = "thesis_selection"
    elif process_quality == "good_process" and financial_outcome == "unprofitable":
        primary_lesson = "sound_decision_unfavorable_outcome"
    else:
        primary_lesson = "no_single_dominant_error"

    overrides = human_overrides or {}
    process_quality = overrides.get("process_quality", process_quality)
    primary_lesson = overrides.get("primary_lesson", primary_lesson)
    thesis_result = overrides.get("thesis_result", thesis_result)
    contract_result = overrides.get("contract_result", contract_result)
    timing_result = overrides.get("timing_result", timing_result)
    sizing_result = overrides.get("sizing_result", sizing_result)
    portfolio_result = overrides.get("portfolio_result", portfolio_result)
    entry_execution_result = overrides.get("entry_execution_result", entry_execution_result)
    exit_discipline_result = overrides.get("exit_discipline_result", exit_discipline_result)
    event_result = overrides.get("event_result", event_result)
    review_discipline = overrides.get("review_discipline", review_discipline)
    scanner_recurrence = _scanner_recurrence_attribution(db, position_id)
    entry_field, entry_field_event_id = _position_entry_market_field(db, closed)
    assessment_field = _assessment_market_field(assessment)
    field_cohort = _market_field_cohort(entry_field or assessment_field)

    row = OptionTradeOutcome(
        closed_position_id=closed.id,
        source_position_id=position_id,
        supersedes_outcome_id=latest.id if latest else None,
        outcome_version=(latest.outcome_version + 1) if latest else 1,
        outcome_status="human_corrected" if overrides else "complete",
        process_quality=process_quality,
        financial_outcome=financial_outcome,
        primary_lesson=primary_lesson,
        decision_alignment=decision_alignment,
        thesis_result=thesis_result,
        contract_result=contract_result,
        timing_result=timing_result,
        sizing_result=sizing_result,
        portfolio_result=portfolio_result,
        entry_execution_result=entry_execution_result,
        exit_discipline_result=exit_discipline_result,
        event_result=event_result,
        review_discipline=review_discipline,
        metrics_json=json_dumps(
            {
                "dollar_pnl": closed.dollar_pnl,
                "percent_pnl": closed.percent_pnl,
                "days_held": (closed.close_date - closed.trade_date).days,
                "directional_underlying_return_pct": directional_return,
                "contracts": closed.contracts,
                "premium_at_risk": closed.total_cost,
                "scanner_recurrence_cohort": scanner_recurrence["cohort"],
                "scanner_recurrence_count": scanner_recurrence["event_count"],
                "scanner_replacement_cohort": scanner_recurrence["replacement_cohort"],
                "market_field_entry_cohort": field_cohort,
            }
        ),
        attribution_json=json_dumps(
            {
                "review_id": review.id if review else None,
                "mandate_id": mandate.id if mandate else None,
                "assessment_id": assessment.id if assessment else None,
                "actual_trade_outcome": True,
                "scanner_recurrence": scanner_recurrence,
                "market_field": {
                    "entry_event_id": entry_field_event_id,
                    "entry_snapshot": entry_field,
                    "latest_assessment_id": assessment.id if assessment else None,
                    "latest_assessment_snapshot": assessment_field,
                    "cohort_basis": "entry_snapshot" if entry_field else "latest_assessment_fallback",
                    "cohort": field_cohort,
                    "rank_influence": 0.0,
                },
                "human_overrides": overrides,
            }
        ),
        model_version=OUTCOME_MODEL_VERSION,
    )
    db.add(row)
    db.flush()
    return row


def serialize_trade_outcome(row: OptionTradeOutcome | None) -> Optional[dict[str, object]]:
    if row is None:
        return None
    return {
        "id": row.id,
        "closed_position_id": row.closed_position_id,
        "source_position_id": row.source_position_id,
        "supersedes_outcome_id": row.supersedes_outcome_id,
        "outcome_version": row.outcome_version,
        "outcome_status": row.outcome_status,
        "process_quality": row.process_quality,
        "financial_outcome": row.financial_outcome,
        "primary_lesson": row.primary_lesson,
        "decision_alignment": row.decision_alignment,
        "thesis_result": row.thesis_result,
        "contract_result": row.contract_result,
        "timing_result": row.timing_result,
        "sizing_result": row.sizing_result,
        "portfolio_result": row.portfolio_result,
        "entry_execution_result": row.entry_execution_result,
        "exit_discipline_result": row.exit_discipline_result,
        "event_result": row.event_result,
        "review_discipline": row.review_discipline,
        "metrics": json_loads(row.metrics_json, {}),
        "attribution": json_loads(row.attribution_json, {}),
        "model_version": row.model_version,
        "computed_at": row.computed_at.isoformat() if row.computed_at else None,
    }


def backfill_trade_outcomes(db: Session, limit: int = 1000) -> dict[str, int]:
    closed_rows = db.query(ClosedPosition).order_by(ClosedPosition.close_date.asc()).limit(limit).all()
    created = 0
    skipped = 0
    for closed in closed_rows:
        existing = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id == closed.id)
            .first()
        )
        if existing:
            skipped += 1
            continue
        create_trade_outcome(db, closed)
        created += 1
    db.flush()
    return {"created": created, "skipped": skipped}


def serialize_decision_outcome(row: OptionDecisionOutcome) -> dict[str, object]:
    return {
        "id": row.id,
        "review_id": row.review_id,
        "position_id": row.position_id,
        "closed_position_id": row.closed_position_id,
        "evaluation_horizon": row.evaluation_horizon,
        "target_date": row.target_date.isoformat(),
        "outcome_date": row.outcome_date.isoformat() if row.outcome_date else None,
        "status": row.status,
        "decided_verdict": row.decided_verdict,
        "recommended_verdict": row.recommended_verdict,
        "underlying_directional_return_pct": row.underlying_directional_return_pct,
        "option_return_pct": row.option_return_pct,
        "incremental_value_pct": row.incremental_value_pct,
        "valuation_method": row.valuation_method,
        "process_quality": row.process_quality,
        "outcome_quality": row.outcome_quality,
        "attribution": json_loads(row.attribution_json, {}),
    }


def learning_summary(db: Session) -> dict[str, object]:
    reviews = db.query(OptionPositionReview).count()
    assessments = db.query(OptionThesisAssessment).count()
    closed = db.query(ClosedPosition).count()
    latest_outcomes: list[OptionTradeOutcome] = []
    for closed_id in [row[0] for row in db.query(OptionTradeOutcome.closed_position_id).distinct().all()]:
        latest = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id == closed_id)
            .order_by(OptionTradeOutcome.outcome_version.desc(), OptionTradeOutcome.id.desc())
            .first()
        )
        if latest:
            latest_outcomes.append(latest)
    decisions = db.query(OptionDecisionOutcome).filter(OptionDecisionOutcome.status == "matured").all()

    def counts(values: Iterable[str]) -> dict[str, int]:
        result: dict[str, int] = {}
        for value in values:
            result[value] = result.get(value, 0) + 1
        return result

    decision_values = [row.incremental_value_pct for row in decisions if row.incremental_value_pct is not None]
    helpful = sum(1 for value in decision_values if value > 2)
    harmful = sum(1 for value in decision_values if value < -2)
    actual_cycles = len(latest_outcomes)
    minimum_cycles = 100
    models = db.query(OptionModelRegistry).order_by(OptionModelRegistry.created_at.asc()).all()
    recurrence_cohorts: dict[str, dict[str, object]] = {}
    replacement_cohorts: dict[str, dict[str, object]] = {}
    field_cohorts: dict[str, dict[str, object]] = {}
    for outcome in latest_outcomes:
        metrics = json_loads(outcome.metrics_json, {})
        attribution = json_loads(outcome.attribution_json, {})
        recurrence = attribution.get("scanner_recurrence") if isinstance(attribution, dict) else None
        if not isinstance(recurrence, dict):
            recurrence = _scanner_recurrence_attribution(db, outcome.source_position_id)
        cohort = (
            str(recurrence.get("cohort"))
            if isinstance(recurrence, dict) and recurrence.get("cohort")
            else str(metrics.get("scanner_recurrence_cohort") or "no_repeat")
        )
        row = recurrence_cohorts.setdefault(
            cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        row["sample_count"] = int(row["sample_count"]) + 1
        financial_outcome = str(outcome.financial_outcome or "flat")
        row[financial_outcome] = int(row.get(financial_outcome, 0)) + 1
        percent_pnl = _finite(metrics.get("percent_pnl")) if isinstance(metrics, dict) else None
        if percent_pnl is not None:
            values = row["percent_pnl_values"]
            if isinstance(values, list):
                values.append(percent_pnl)
        replacement_cohort = (
            str(recurrence.get("replacement_cohort"))
            if isinstance(recurrence, dict) and recurrence.get("replacement_cohort")
            else str(metrics.get("scanner_replacement_cohort") or "no_replacement_signal")
        )
        replacement_row = replacement_cohorts.setdefault(
            replacement_cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        replacement_row["sample_count"] = int(replacement_row["sample_count"]) + 1
        replacement_row[financial_outcome] = int(replacement_row.get(financial_outcome, 0)) + 1
        if percent_pnl is not None:
            replacement_values = replacement_row["percent_pnl_values"]
            if isinstance(replacement_values, list):
                replacement_values.append(percent_pnl)
        field_attribution = attribution.get("market_field") if isinstance(attribution, dict) else None
        field_cohort = (
            str(field_attribution.get("cohort"))
            if isinstance(field_attribution, dict) and field_attribution.get("cohort")
            else str(metrics.get("market_field_entry_cohort") or "unavailable")
        )
        if field_cohort not in {"supportive", "fading", "contradictory", "mixed"}:
            field_cohort = "unavailable"
        field_row = field_cohorts.setdefault(
            field_cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        field_row["sample_count"] = int(field_row["sample_count"]) + 1
        field_row[financial_outcome] = int(field_row.get(financial_outcome, 0)) + 1
        if percent_pnl is not None:
            field_values = field_row["percent_pnl_values"]
            if isinstance(field_values, list):
                field_values.append(percent_pnl)
    recurrence_outcomes = {}
    for cohort in ("no_repeat", "repeat_seen", "strengthened_seen", "contract_drift_seen"):
        row = recurrence_cohorts.get(
            cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        values = row.pop("percent_pnl_values")
        recurrence_outcomes[cohort] = {
            **row,
            "average_percent_pnl": round(sum(values) / len(values), 2) if values else None,
        }
    replacement_outcomes = {}
    for cohort in (
        "no_replacement_signal",
        "replacement_watch_seen",
        "rescue_roll_rejected_seen",
        "roll_candidate_seen",
        "convexity_harvest_seen",
        "other_replacement_signal",
    ):
        row = replacement_cohorts.get(
            cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        values = row.pop("percent_pnl_values")
        replacement_outcomes[cohort] = {
            **row,
            "average_percent_pnl": round(sum(values) / len(values), 2) if values else None,
        }
    field_outcomes = {}
    for cohort in ("supportive", "fading", "contradictory", "mixed", "unavailable"):
        row = field_cohorts.get(
            cohort,
            {
                "sample_count": 0,
                "profitable": 0,
                "unprofitable": 0,
                "flat": 0,
                "percent_pnl_values": [],
            },
        )
        values = row.pop("percent_pnl_values")
        field_outcomes[cohort] = {
            **row,
            "average_percent_pnl": round(sum(values) / len(values), 2) if values else None,
        }
    return {
        "sample": {
            "open_review_records": reviews,
            "automatic_assessments": assessments,
            "actual_closed_trades": closed,
            "classified_trade_cycles": actual_cycles,
            "matured_decision_horizons": len(decisions),
        },
        "trade_outcomes": {
            "process_quality": counts(row.process_quality for row in latest_outcomes),
            "primary_lessons": counts(row.primary_lesson for row in latest_outcomes),
            "contract_results": counts(row.contract_result for row in latest_outcomes),
            "timing_results": counts(row.timing_result for row in latest_outcomes),
            "portfolio_results": counts(row.portfolio_result for row in latest_outcomes),
            "exit_discipline_results": counts(row.exit_discipline_result for row in latest_outcomes),
        },
        "decision_outcomes": {
            "helpful": helpful,
            "harmful": harmful,
            "neutral_or_unrated": len(decisions) - helpful - harmful,
            "average_incremental_value_pct": (
                round(sum(decision_values) / len(decision_values), 2) if decision_values else None
            ),
            "modeled_and_actual_are_separate": True,
        },
        "scanner_recurrence_outcomes": {
            "cohorts": recurrence_outcomes,
            "actual_closed_trades_only": True,
            "minimum_sample_before_comparison": 20,
            "automatic_weight_changes": False,
        },
        "scanner_replacement_outcomes": {
            "cohorts": replacement_outcomes,
            "actual_closed_trades_only": True,
            "minimum_sample_before_comparison": 20,
            "automatic_weight_changes": False,
        },
        "market_field_outcomes": {
            "cohorts": field_outcomes,
            "actual_closed_trades_only": True,
            "point_in_time_snapshot_required": True,
            "minimum_sample_before_comparison": 20,
            "rank_influence": 0.0,
            "automatic_weight_changes": False,
        },
        "promotion_readiness": {
            "minimum_independent_trade_cycles": minimum_cycles,
            "current_independent_trade_cycles": actual_cycles,
            "remaining_cycles": max(0, minimum_cycles - actual_cycles),
            "learned_review_model_allowed": actual_cycles >= minimum_cycles,
            "automatic_promotion": False,
            "status": "data_collection" if actual_cycles < minimum_cycles else "challenger_eligible",
        },
        "models": [
            {
                "model_key": row.model_key,
                "model_version": row.model_version,
                "model_status": row.model_status,
                "feature_schema_version": row.feature_schema_version,
                "sample_count": row.sample_count,
                "metrics": json_loads(row.metrics_json, {}),
                "promotion_gates": json_loads(row.promotion_gates_json, {}),
            }
            for row in models
        ],
        "guardrails": {
            "champion_changes_require_manual_promotion": True,
            "retrain_after_minimum_new_cycles": 25,
            "time_ordered_validation_required": True,
            "synthetic_outcomes_must_not_mix_with_actual_trade_labels": True,
            "automated_execution_enabled": False,
        },
        "grader_version": GRADER_VERSION,
        "outcome_model_version": OUTCOME_MODEL_VERSION,
    }
