from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
import math
from numbers import Real
import os
import re
from threading import Lock
import time as time_lib
from types import SimpleNamespace
from typing import Any, Dict, Literal, Optional

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Query, Request
import traceback
from pydantic import BaseModel, ConfigDict, Field

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.api.secret_options_security import (
    SecretOptionsAuditRoute,
    require_secret_options_access,
    secret_options_access_payload,
    set_secret_options_audit_change,
)
from app.models.option_positions import OptionPosition
from app.models.option_position_reviews import OptionPositionReview
from app.models.closed_positions import ClosedPosition
from app.models.option_trade_reminders import OptionTradeReminder
from app.models.options_alerts import OptionAlertEvent
from app.models.option_sweep_runs import OptionSweepRun
from app.models.option_training_outcomes import OptionTrainingOutcome
from app.models.option_decision_learning import (
    OptionDecisionOutcome,
    OptionPositionEvent,
    OptionPositionMandate,
    OptionRiskPolicy,
    OptionThesisAssessment,
    OptionTradeOutcome,
)
from app.models.stock_projection_snapshot import StockProjectionSnapshot
from app.services.market_data.factory import get_market_data_provider
from app.services.market_data.provider import MarketDataProvider
from app.services.option_field_context import build_option_field_context
from app.services.options_quotes import option_quote_from_row
from app.services.options_review_window import ReviewWindow, compute_review_window, parse_review_window
from app.services.options_opportunity import (
    OPPORTUNITY_MODEL_VERSION,
    compute_opportunity_score,
    event_opportunity_signal_fields,
    opportunity_fields_from_event,
    opportunity_grade,
)
from app.services.option_trade_reminders import (
    skip_trade_sell_reminder,
    sync_trade_sell_reminder,
)
from app.services.optionality_clusters import build_optionality_cluster_payload
from app.services.option_sweep_runs import (
    build_scanner_run_detail,
    build_scanner_summary,
    request_stop_dashboard_sweep,
    start_dashboard_sweep,
)
from app.services.option_scanner_exposure import (
    ScannerImpressionReplayConflict,
    record_scanner_impressions,
)
from app.services.discord_sweep_universe import resolve_sweep_universe
from app.services.stock_price_cache import get_or_refresh_daily_frame
from app.services.option_thesis_engine import (
    build_actionable_decision_window,
    build_assessment_payload,
    confirm_mandate_from_review,
    ensure_model_registry,
    get_or_create_mandate,
    json_dumps,
    json_loads,
    latest_risk_policy,
    persist_assessment,
    rebase_continuation_condition,
    serialize_assessment,
    serialize_mandate,
    serialize_risk_policy,
    technical_snapshot_from_frame,
)
from app.services.option_decision_learning import (
    backfill_trade_outcomes,
    create_trade_outcome,
    learning_summary,
    mature_decision_outcomes,
    record_position_event,
    serialize_decision_outcome,
    serialize_position_event,
    serialize_trade_outcome,
)
from app.utils.db_helpers import get_db_session
from app.services.greeks_calculator import (
    black_scholes_price,
    calculate_greeks,
    implied_volatility,
    generate_delta_gamma_curve,
    generate_theta_curve
)

router = APIRouter(
    prefix="/secret/options",
    tags=["SecretOptions"],
    dependencies=[Depends(require_secret_options_access)],
    route_class=SecretOptionsAuditRoute,
)

_POSITION_METRICS_CACHE: Dict[tuple[object, ...], tuple[float, Dict[str, object]]] = {}
_POSITION_METRICS_CACHE_LOCK = Lock()
_POSITION_METRICS_REFRESH_LOCK = Lock()
_POSITION_METRICS_REFRESH_IN_PROGRESS = False
_POSITION_METRICS_REFRESH_PROGRESS: Dict[str, object] = {
    "total": 0,
    "completed": 0,
    "current_position_id": None,
    "current_symbol": None,
    "target_position_ids": [],
    "completed_position_ids": [],
}
_POSITION_METRICS_REFRESH_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="option-position-cache-refresh",
)
_POSITION_INDEX_MEMBERSHIP_CACHE: tuple[
    float,
    Dict[str, set[str]],
    list[str],
] | None = None
_POSITION_INDEX_MEMBERSHIP_CACHE_LOCK = Lock()
_POSITION_INDEX_MEMBERSHIP_SUCCESS_TTL_SECONDS = 6 * 60 * 60
_POSITION_INDEX_MEMBERSHIP_FAILURE_TTL_SECONDS = 10 * 60

_POSITION_INDEX_UNIVERSES = (
    ("SP500", "SPY", "S&P 500"),
    ("RUSSELL2000", "R2K", "Russell 2000"),
)

# Risk-free rate configuration (can be adjusted based on current T-bill rates)
RISK_FREE_RATE = 0.0425  # 4.25% - adjust as needed


@router.get("/access")
def get_secret_options_access(request: Request):
    """Validate the current Secret Options session without loading portfolio data."""

    return secret_options_access_payload(request)


def _is_finite_number(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _json_safe(value: Any) -> Any:
    """Convert non-finite live-market values to JSON-safe nulls."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, Real):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


class OptionPositionCreate(BaseModel):
    trade_date: str
    account: Optional[str] = None
    action: Optional[str] = None
    contracts: int
    symbol: str
    expiration: str
    strike: float
    option_type: str
    fill_price: float
    total_cost: float
    underlying_at_entry: Optional[float] = None
    estimated_delta: Optional[float] = None
    shares_equivalent: Optional[int] = None
    dte_at_entry: Optional[int] = None
    underlying_reference: Optional[float] = None
    source_event_id: Optional[int] = None


class ClosePositionRequest(BaseModel):
    exit_price: float
    close_date: Optional[str] = None
    notes: Optional[str] = None


class ClosedPositionUpdate(BaseModel):
    trade_date: str
    close_date: str
    account: Optional[str] = None
    contracts: int
    symbol: str
    expiration: str
    strike: float
    option_type: str
    fill_price: float
    exit_price: float
    total_cost: float
    underlying_at_entry: Optional[float] = None
    underlying_at_exit: Optional[float] = None
    notes: Optional[str] = None


class ScannerRunRequest(BaseModel):
    universe_key: str = "SP500"
    threshold: float = 30.0


class ScannerImpressionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_impression_id: str = Field(
        min_length=16,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )
    exposure_type: Literal[
        "ranking_rendered",
        "candidate_visible",
        "candidate_detail_opened",
        "market_field_link_clicked",
        "trade_prefill_opened",
    ]
    event_id: Optional[int] = Field(default=None, gt=0)
    client_occurred_at: Optional[datetime] = None
    visibility_ratio: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    visible_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    metadata: Dict[str, str | int | float | bool | None] = Field(
        default_factory=dict,
        max_length=12,
    )


class ScannerImpressionBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot_id: int = Field(gt=0)
    page_session_id: str = Field(min_length=16, max_length=128)
    exposures: list[ScannerImpressionCreate] = Field(min_length=1, max_length=50)


class OptionPositionReviewCreate(BaseModel):
    review_date: Optional[str] = None
    selected_assessment_id: Optional[int] = None
    trade_role: Optional[str] = None
    original_thesis: Optional[str] = None
    contract_thesis: Optional[str] = None
    expected_path: Optional[str] = None
    catalyst: Optional[str] = None
    confirmation_condition: Optional[str] = None
    invalidation_condition: Optional[str] = None
    risk_budget: Optional[float] = None
    evidence_since_last: Optional[str] = None
    thesis_status: Optional[str] = None
    fresh_entry_answer: Optional[str] = None
    portfolio_fit: Optional[str] = None
    data_quality_notes: Optional[str] = None
    verdict: Optional[str] = None
    target_contracts: Optional[int] = None
    quality: Optional[str] = None
    urgency: Optional[str] = None
    confidence: Optional[str] = None
    continuation_condition: Optional[str] = None
    next_review_date: Optional[str] = None
    decision_deadline: Optional[str] = None
    decision_notes: Optional[str] = None
    override_reason: Optional[str] = None
    threshold_approval_status: str = "draft"


class OptionRiskPolicyCreate(BaseModel):
    name: str = "Tracked options risk policy"
    active: bool = True
    approval_status: str = "approved"
    portfolio_capital: Optional[float] = None
    default_trade_risk_budget: Optional[float] = None
    max_single_position_premium_pct: Optional[float] = 30.0
    max_directional_premium_pct: Optional[float] = 75.0
    max_expiry_bucket_premium_pct: Optional[float] = 45.0
    max_option_spread_pct: Optional[float] = 25.0
    min_dte_for_add: Optional[int] = 21


class OptionLifecycleEventCreate(BaseModel):
    event_type: str
    event_at: Optional[str] = None
    quantity_after: Optional[int] = None
    execution_price: Optional[float] = None
    notes: Optional[str] = None


class OptionTradeOutcomeFeedback(BaseModel):
    process_quality: Optional[str] = None
    primary_lesson: Optional[str] = None
    thesis_result: Optional[str] = None
    contract_result: Optional[str] = None
    timing_result: Optional[str] = None
    sizing_result: Optional[str] = None
    portfolio_result: Optional[str] = None
    entry_execution_result: Optional[str] = None
    exit_discipline_result: Optional[str] = None
    event_result: Optional[str] = None
    review_discipline: Optional[str] = None


# Old Greeks functions removed - now using greeks_calculator module


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _nullable_equals(column: Any, value: Any) -> Any:
    return column.is_(None) if value is None else column == value


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_SETUP_RE = re.compile(r"Setup\s*:\s*1x\s+(?:ATM|optimized)\s+(CALL|PUT)", re.IGNORECASE)
_CONTRACT_RE = re.compile(
    r"Contract\s*:\s*(\d{4}-\d{2}-\d{2})\s+([0-9]+(?:\.[0-9]+)?)\s+(CALL|PUT)",
    re.IGNORECASE,
)
_HOLD_RE = re.compile(r"Hold\s*:\s*(\d+)\s*trading\s*days", re.IGNORECASE)
_PREMIUM_RE = re.compile(r"Est\s+Prem\s*:\s*\$\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
_TWENTY_DAY_RETURN_RE = re.compile(r"\b20d\s+return\s+([+-]?\d+(?:\.\d+)?)%", re.IGNORECASE)


def _training_hold_days_from_return(value: float) -> int:
    magnitude = abs(float(value))
    if magnitude >= 12:
        return 7
    if magnitude >= 8:
        return 10
    if magnitude >= 4:
        return 14
    if magnitude >= 1.5:
        return 21
    return 28


def _extract_training_return(plain: str) -> Optional[float]:
    horizon_patterns = (
        # Markdown legacy format: - **1m**: Bearish (-6.6%)
        r"\b1m\b\**\s*:\s*[A-Za-z+\-\s]+\(([+-]?\d+(?:\.\d+)?)%\)",
        # ANSI compact format: 1m +26.6%
        r"\b1m\b\s+([+-]?\d+(?:\.\d+)?)%",
    )
    for pattern in horizon_patterns:
        match = re.search(pattern, plain, re.IGNORECASE)
        if match:
            return float(match.group(1))

    match = _TWENTY_DAY_RETURN_RE.search(plain)
    if match:
        return float(match.group(1))
    return None


def _infer_training_option_type(plain: str) -> Optional[str]:
    for raw_line in plain.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()
        if "direction hint" in lower:
            if "calls" in lower or "bullish" in lower:
                return "call"
            if "puts" in lower or "bearish" in lower:
                return "put"
        if re.search(r"\bbias\s*:", lower):
            if "bullish" in lower:
                return "call"
            if "bearish" in lower:
                return "put"
        if re.match(r"[-* ]*\*\*(?:short-term\s+)?bullish\*\*", line, re.IGNORECASE):
            return "call"
        if re.match(r"[-* ]*\*\*(?:short-term\s+)?bearish\*\*", line, re.IGNORECASE):
            return "put"
    return None


def _strip_ansi(value: Optional[str]) -> str:
    if not value:
        return ""
    return _ANSI_RE.sub("", value)


def _is_exceptional_training_event(event: OptionAlertEvent) -> bool:
    if event.iv_percentile is None:
        return False
    iv_percentile = float(event.iv_percentile)
    spread_ok = (
        event.iv30 is not None
        and event.hv30 is not None
        and float(event.iv30) - float(event.hv30) <= -4.0
    )
    edr_ok = event.avg_edr is not None and float(event.avg_edr) <= 35.0
    return iv_percentile <= 5.0 or (iv_percentile <= 10.0 and (spread_ok or edr_ok))


def _has_green_marker_event(event: OptionAlertEvent) -> bool:
    plain = _strip_ansi(event.message)
    if not plain:
        return False
    marker_tokens = ("🟢", "🟩", ":green_circle:")
    return any(token in plain for token in marker_tokens)


def _is_training_candidate_event(event: OptionAlertEvent, include_green_marker: bool) -> bool:
    if _is_exceptional_training_event(event):
        return True
    if include_green_marker and _has_green_marker_event(event):
        return True
    return False


def _linked_trade_payload(position: OptionPosition | ClosedPosition, kind: str) -> Dict[str, object]:
    return {
        "kind": kind,
        "id": position.id,
        "trade_date": position.trade_date,
        "symbol": position.symbol.upper(),
        "option_type": position.option_type.lower() if position.option_type else None,
        "expiration": position.expiration,
        "strike": position.strike,
        "fill_price": position.fill_price,
        "source_event_id": position.source_event_id,
    }


def _collect_linked_trades_by_event_id(db, cutoff_day: date) -> Dict[int, list[Dict[str, object]]]:
    linked: Dict[int, list[Dict[str, object]]] = {}
    open_positions = (
        db.query(OptionPosition)
        .filter(
            OptionPosition.source_event_id.isnot(None),
            OptionPosition.trade_date >= cutoff_day,
        )
        .all()
    )
    closed_positions = (
        db.query(ClosedPosition)
        .filter(
            ClosedPosition.source_event_id.isnot(None),
            ClosedPosition.trade_date >= cutoff_day,
        )
        .all()
    )
    for position in open_positions:
        linked.setdefault(int(position.source_event_id), []).append(_linked_trade_payload(position, "open"))
    for position in closed_positions:
        linked.setdefault(int(position.source_event_id), []).append(_linked_trade_payload(position, "closed"))
    return linked


def _best_linked_trade_for_event(
    event: OptionAlertEvent,
    linked_trades: list[Dict[str, object]],
) -> Optional[Dict[str, object]]:
    if not linked_trades:
        return None
    if not event.triggered_at:
        return sorted(linked_trades, key=lambda item: str(item.get("trade_date") or ""))[0]
    event_day = event.triggered_at.date()
    return min(
        linked_trades,
        key=lambda item: abs(((item.get("trade_date") or event_day) - event_day).days),
    )


def _compute_training_outcome_for_linked_event(
    event: OptionAlertEvent,
    linked_trade: Dict[str, object],
) -> Optional[Dict[str, object]]:
    recipe = _extract_training_recipe(event.message)
    hold_days = recipe.get("hold_days")
    if not isinstance(hold_days, int) or hold_days <= 0:
        return None
    review_min_hold_days = getattr(event, "review_min_hold_days", None) or recipe.get("review_min_hold_days")
    review_max_hold_days = getattr(event, "review_max_hold_days", None) or recipe.get("review_max_hold_days") or hold_days
    if not isinstance(review_min_hold_days, int) or review_min_hold_days <= 0:
        review_min_hold_days = max(1, min(hold_days, round(hold_days * 0.4)))
    if not isinstance(review_max_hold_days, int) or review_max_hold_days < review_min_hold_days:
        review_max_hold_days = hold_days

    option_type = (
        event.selected_option_type
        or linked_trade.get("option_type")
        or recipe.get("option_type")
    )
    if not option_type:
        return None
    option_type = str(option_type).lower()
    contract_expiry = event.selected_expiry or linked_trade.get("expiration") or recipe.get("contract_expiry")
    if isinstance(contract_expiry, date):
        contract_expiry = contract_expiry.isoformat()
    contract_strike = event.selected_strike
    if contract_strike is None:
        contract_strike = linked_trade.get("strike") or recipe.get("contract_strike")
    selected_premium = event.selected_premium
    if selected_premium is None:
        selected_premium = linked_trade.get("fill_price") or recipe.get("est_premium")

    synthetic_message = "\n".join(
        [
            event.message or "",
            f"Setup: 1x optimized {option_type.upper()}",
            (
                f"Contract: {contract_expiry} {float(contract_strike):.2f} {option_type.upper()}"
                if contract_expiry and contract_strike is not None
                else ""
            ),
            f"Review Window: {review_min_hold_days}-{review_max_hold_days} trading days",
            f"Hold: {review_max_hold_days} trading days",
            f"Est Prem: ${float(selected_premium):.2f}" if selected_premium is not None else "",
        ]
    )
    event_for_compute = SimpleNamespace(
        id=event.id,
        symbol=event.symbol,
        triggered_at=event.triggered_at,
        iv30=event.iv30,
        hv30=event.hv30,
        selected_option_type=option_type,
        selected_expiry=contract_expiry,
        selected_strike=float(contract_strike) if contract_strike is not None else None,
        selected_premium=float(selected_premium) if selected_premium is not None else None,
        review_min_hold_days=review_min_hold_days,
        review_max_hold_days=review_max_hold_days,
        review_window_basis=getattr(event, "review_window_basis", None),
        message=synthetic_message,
    )
    trigger_day = event.triggered_at.date() if event.triggered_at else date.today()
    days = max(30, (date.today() - trigger_day).days + 14)
    history = get_or_refresh_daily_frame(event.symbol, days=days)
    return _compute_training_outcome(event_for_compute, history=history)


def _collect_training_outcomes(
    lookback_days: int,
    limit: int,
    include_green_marker: bool,
    include_linked: bool,
    force_recompute: bool,
    *,
    materialize: bool = True,
) -> dict[str, object]:
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    cutoff_day = cutoff.date()
    with get_db_session() as db:
        linked_trades_by_event_id = (
            _collect_linked_trades_by_event_id(db, cutoff_day) if include_linked else {}
        )
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= cutoff)
            .order_by(OptionAlertEvent.triggered_at.desc())
            .limit(limit)
            .all()
        )
        events_by_id = {event.id: event for event in events}
        missing_linked_event_ids = [
            event_id for event_id in linked_trades_by_event_id.keys() if event_id not in events_by_id
        ]
        if missing_linked_event_ids:
            linked_events = (
                db.query(OptionAlertEvent)
                .filter(
                    OptionAlertEvent.id.in_(missing_linked_event_ids),
                    OptionAlertEvent.triggered_at >= cutoff,
                )
                .all()
            )
            for event in linked_events:
                events_by_id[event.id] = event
        events = sorted(
            events_by_id.values(),
            key=lambda event: event.triggered_at or datetime.min,
            reverse=True,
        )

        candidate_events = [
            event
            for event in events
            if _is_training_candidate_event(event, include_green_marker)
            or event.id in linked_trades_by_event_id
        ]
        existing_rows = (
            db.query(OptionTrainingOutcome)
            .filter(OptionTrainingOutcome.event_id.in_([event.id for event in candidate_events]))
            .all()
            if candidate_events
            else []
        )
        rows_by_event_id = {row.event_id: row for row in existing_rows}

        if materialize:
            for event in candidate_events:
                row = rows_by_event_id.get(event.id)
                needs_compute = _training_outcome_needs_compute(row)
                if not force_recompute and not needs_compute:
                    continue

                if row is None:
                    row = OptionTrainingOutcome(
                        event_id=event.id,
                        symbol=event.symbol.upper(),
                        triggered_at=event.triggered_at,
                        status="pending",
                        compute_status="pending",
                        computed_at=datetime.utcnow(),
                    )
                    db.add(row)
                    rows_by_event_id[event.id] = row

                try:
                    linked_trade = _best_linked_trade_for_event(
                        event,
                        linked_trades_by_event_id.get(event.id, []),
                    )
                    outcome = (
                        _compute_training_outcome_for_linked_event(event, linked_trade)
                        if linked_trade is not None
                        else _compute_training_outcome_with_cache(event)
                    )
                    if outcome:
                        _apply_training_outcome_payload(row, event, outcome)
                    else:
                        raise ValueError("Training outcome could not be computed from event recipe or price history.")
                except Exception as exc:
                    _mark_training_outcome_error(row, event, exc)

            db.commit()
        outcomes = [
            {
                **_training_outcome_payload(rows_by_event_id[event.id]),
                **_opportunity_rank_payload_for_event(event),
            }
            for event in candidate_events
            if event.id in rows_by_event_id and rows_by_event_id[event.id].compute_status == "ok"
        ]

    outcomes.sort(key=lambda row: str(row.get("triggered_at") or ""), reverse=True)

    matured = [row for row in outcomes if row.get("status") == "matured"]
    matured_option_returns = [
        float(row["option_return_pct_est"])
        for row in matured
        if row.get("option_return_pct_est") is not None
    ]
    matured_option_pnl = [
        float(row["option_pnl_per_contract_est"])
        for row in matured
        if row.get("option_pnl_per_contract_est") is not None
    ]
    winners = [value for value in matured_option_returns if value > 0]

    green_marker_total = sum(1 for event in candidate_events if _has_green_marker_event(event))

    summary = {
        "sample_size": len(outcomes),
        "matured": len(matured),
        "pending": len(outcomes) - len(matured),
        "win_rate_pct": (len(winners) / len(matured_option_returns) * 100.0) if matured_option_returns else None,
        "avg_option_return_pct": (sum(matured_option_returns) / len(matured_option_returns)) if matured_option_returns else None,
        "total_option_pnl_per_contract": sum(matured_option_pnl) if matured_option_pnl else None,
        "include_green_marker": include_green_marker,
        "include_linked": include_linked,
        "force_recompute": force_recompute,
        "lookback_days": lookback_days,
        "event_limit": limit,
        "candidate_events": len(candidate_events),
        "green_marker_rows": green_marker_total,
        "linked_event_rows": sum(1 for event in candidate_events if event.id in linked_trades_by_event_id),
    }

    return {
        "outcomes": outcomes,
        "summary": summary,
    }


def _extract_training_recipe(message: Optional[str]) -> Dict[str, Optional[float | int | str]]:
    plain = _strip_ansi(message)
    setup_match = _SETUP_RE.search(plain)
    contract_match = _CONTRACT_RE.search(plain)
    hold_match = _HOLD_RE.search(plain)
    premium_match = _PREMIUM_RE.search(plain)
    review_window = parse_review_window(plain)

    option_type = setup_match.group(1).lower() if setup_match else None
    contract_expiry = contract_match.group(1) if contract_match else None
    contract_strike = float(contract_match.group(2)) if contract_match else None
    contract_type = contract_match.group(3).lower() if contract_match else None
    if option_type is None:
        option_type = contract_type
    if option_type is None:
        option_type = _infer_training_option_type(plain)
    hold_days = review_window.max_hold_days if review_window else int(hold_match.group(1)) if hold_match else None
    if hold_days is None:
        trend_return = _extract_training_return(plain)
        hold_days = _training_hold_days_from_return(trend_return) if trend_return is not None else None
    min_hold_days = review_window.min_hold_days if review_window else (
        max(1, min(hold_days, round(hold_days * 0.4))) if isinstance(hold_days, int) else None
    )
    est_premium = float(premium_match.group(1)) if premium_match else None

    return {
        "option_type": option_type,
        "contract_expiry": contract_expiry,
        "contract_strike": contract_strike,
        "review_min_hold_days": min_hold_days,
        "review_max_hold_days": hold_days,
        "hold_days": hold_days,
        "est_premium": est_premium,
    }


def _compute_training_outcome(
    event: OptionAlertEvent,
    history: Optional[pd.DataFrame] = None,
) -> Optional[Dict[str, object]]:
    recipe = _extract_training_recipe(event.message)
    option_type = event.selected_option_type or recipe.get("option_type")
    hold_days = recipe.get("hold_days")
    review_min_hold_days = getattr(event, "review_min_hold_days", None) or recipe.get("review_min_hold_days")
    review_max_hold_days = getattr(event, "review_max_hold_days", None) or recipe.get("review_max_hold_days") or hold_days

    if not option_type or not isinstance(hold_days, int) or hold_days <= 0:
        return None
    if not isinstance(review_min_hold_days, int) or review_min_hold_days <= 0:
        review_min_hold_days = max(1, min(hold_days, round(hold_days * 0.4)))
    if not isinstance(review_max_hold_days, int) or review_max_hold_days < review_min_hold_days:
        review_max_hold_days = hold_days

    trigger_day = event.triggered_at.date() if event.triggered_at else date.today()
    start_day = trigger_day - timedelta(days=7)
    # Use completed sessions only so outcomes do not drift intraday.
    # yfinance `end` is exclusive, so `end=today` includes up to yesterday.
    end_day = date.today()

    if history is None:
        stock = yf.Ticker(event.symbol)
        history = stock.history(start=start_day.isoformat(), end=end_day.isoformat())
    if history is None or history.empty or "Close" not in history.columns:
        return None

    close = history["Close"].dropna()
    if close.empty:
        return None

    index = pd.to_datetime(close.index)
    if getattr(index, "tz", None) is not None:
        index = index.tz_localize(None)
    daily = pd.DataFrame({"close": close.to_numpy()}, index=index.normalize())
    daily = daily[~daily.index.duplicated(keep="last")]

    entry_candidates = daily.index[daily.index.date >= trigger_day]
    if len(entry_candidates) == 0:
        fallback_entry_price = float(close.iloc[-1])
        recommended_exit_date = trigger_day + timedelta(days=hold_days)
        elapsed_calendar_days = (date.today() - trigger_day).days
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "review_min_hold_days": review_min_hold_days,
            "review_max_hold_days": review_max_hold_days,
            "hold_days": hold_days,
            "entry_date": trigger_day.isoformat(),
            "exit_date": None,
            "entry_underlying": fallback_entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": event.selected_premium if event.selected_premium is not None else recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    entry_date = entry_candidates[0]
    entry_idx = daily.index.get_loc(entry_date)
    entry_price = float(daily.iloc[entry_idx]["close"])

    recommended_exit_date = entry_date.date() + timedelta(days=hold_days)
    elapsed_calendar_days = (date.today() - entry_date.date()).days

    # Real-world exit model for the training modal:
    # once the hold window has passed, settle on the most recent trading close
    # on or before the recommended calendar exit date. This is deterministic
    # and does not change on subsequent refreshes.
    if date.today() < recommended_exit_date:
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "review_min_hold_days": review_min_hold_days,
            "review_max_hold_days": review_max_hold_days,
            "hold_days": hold_days,
            "entry_date": entry_date.date().isoformat(),
            "exit_date": None,
            "entry_underlying": entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    eligible_exit_dates = daily.index[
        (daily.index.date >= entry_date.date())
        & (daily.index.date <= recommended_exit_date)
    ]
    if len(eligible_exit_dates) == 0:
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "review_min_hold_days": review_min_hold_days,
            "review_max_hold_days": review_max_hold_days,
            "hold_days": hold_days,
            "entry_date": entry_date.date().isoformat(),
            "exit_date": None,
            "entry_underlying": entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    exit_date = eligible_exit_dates[-1]
    exit_idx = daily.index.get_loc(exit_date)
    realized_hold_days = (exit_date.date() - entry_date.date()).days

    exit_price = float(daily.iloc[exit_idx]["close"])

    directional_multiplier = 1.0 if option_type == "call" else -1.0
    underlying_directional_return_pct = ((exit_price - entry_price) / entry_price) * 100.0 * directional_multiplier

    sigma = float(event.iv30) / 100.0 if event.iv30 is not None else None
    if sigma is None or sigma <= 0:
        sigma = float(event.hv30) / 100.0 if event.hv30 is not None else 0.30
    sigma = max(0.08, min(2.0, sigma))

    est_premium_raw = event.selected_premium if event.selected_premium is not None else recipe.get("est_premium")
    if isinstance(est_premium_raw, (int, float)) and est_premium_raw > 0:
        entry_option_price = float(est_premium_raw)
    else:
        entry_option_price = max(0.35, entry_price * 0.012)

    contract_strike_raw = event.selected_strike if event.selected_strike is not None else recipe.get("contract_strike")
    strike = (
        float(contract_strike_raw)
        if isinstance(contract_strike_raw, (int, float)) and contract_strike_raw > 0
        else entry_price
    )

    contract_expiry_raw = event.selected_expiry or recipe.get("contract_expiry")
    contract_expiry = _parse_date(str(contract_expiry_raw)) if contract_expiry_raw else None
    if contract_expiry:
        remaining_dte = max(1, (contract_expiry - exit_date.date()).days)
    else:
        initial_dte = max(30, hold_days + 14)
        remaining_dte = max(1, initial_dte - hold_days)

    exit_option_price = black_scholes_price(
        S=exit_price,
        K=strike,
        T=remaining_dte / 365.0,
        r=RISK_FREE_RATE,
        sigma=sigma,
        option_type=option_type,
    )
    option_return_pct = ((exit_option_price - entry_option_price) / entry_option_price) * 100.0 if entry_option_price else None
    option_pnl_contract = (exit_option_price - entry_option_price) * 100.0

    return {
        "event_id": event.id,
        "symbol": event.symbol,
        "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
        "option_type": option_type,
        "contract_expiry": contract_expiry.isoformat() if contract_expiry else None,
        "contract_strike": strike,
        "review_min_hold_days": review_min_hold_days,
        "review_max_hold_days": review_max_hold_days,
        "hold_days": hold_days,
        "entry_date": entry_date.date().isoformat(),
        "exit_date": exit_date.date().isoformat(),
        "entry_underlying": entry_price,
        "exit_underlying": exit_price,
        "underlying_directional_return_pct": underlying_directional_return_pct,
        "entry_option_price_est": entry_option_price,
        "exit_option_price_est": exit_option_price,
        "option_return_pct_est": option_return_pct,
        "option_pnl_per_contract_est": option_pnl_contract,
        "recommended_exit_date": recommended_exit_date.isoformat(),
        "hold_days_realized": realized_hold_days,
        "days_elapsed_calendar": elapsed_calendar_days,
        "status": "matured",
    }


def _event_confidence_for_trade(trade_date: date, triggered_at: datetime) -> float:
    day_delta = (trade_date - triggered_at.date()).days
    if day_delta == 0:
        return 1.0
    if day_delta == 1:
        return 0.92
    if day_delta == 2:
        return 0.84
    if 3 <= day_delta <= 7:
        return max(0.55, 0.82 - 0.06 * (day_delta - 2))
    if -1 <= day_delta < 0:
        return 0.6
    return 0.35


def _resolve_signal_attribution(
    db,
    symbol: str,
    trade_date: date,
    explicit_event_id: Optional[int] = None,
) -> Dict[str, object]:
    if explicit_event_id is not None:
        event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == explicit_event_id).first()
        if event and event.symbol.upper() == symbol.upper() and event.triggered_at:
            confidence = _event_confidence_for_trade(trade_date, event.triggered_at)
            return {
                "source_event_id": event.id,
                "source_triggered_at": event.triggered_at,
                "source_match_method": "manual_event_id",
                "source_match_confidence": confidence,
                "source_match_notes": "Manually linked by event id.",
            }

    symbol_upper = symbol.upper()
    window_start = datetime.combine(trade_date - timedelta(days=2), time.min)
    window_end = datetime.combine(trade_date + timedelta(days=1), time.max)
    candidates = (
        db.query(OptionAlertEvent)
        .filter(
            OptionAlertEvent.symbol == symbol_upper,
            OptionAlertEvent.triggered_at.isnot(None),
            OptionAlertEvent.triggered_at >= window_start,
            OptionAlertEvent.triggered_at <= window_end,
        )
        .order_by(OptionAlertEvent.triggered_at.desc())
        .all()
    )

    method = "symbol+trade_date_window"
    if not candidates:
        fallback_start = datetime.combine(trade_date - timedelta(days=21), time.min)
        candidates = (
            db.query(OptionAlertEvent)
            .filter(
                OptionAlertEvent.symbol == symbol_upper,
                OptionAlertEvent.triggered_at.isnot(None),
                OptionAlertEvent.triggered_at >= fallback_start,
                OptionAlertEvent.triggered_at <= datetime.combine(trade_date, time.max),
            )
            .order_by(OptionAlertEvent.triggered_at.desc())
            .all()
        )
        method = "symbol+fallback_21d"
    if not candidates:
        return {
            "source_event_id": None,
            "source_triggered_at": None,
            "source_match_method": "no_match",
            "source_match_confidence": 0.0,
            "source_match_notes": "No matching sweep event found for symbol/date.",
        }

    best = max(
        candidates,
        key=lambda event: _event_confidence_for_trade(trade_date, event.triggered_at),
    )
    confidence = _event_confidence_for_trade(trade_date, best.triggered_at)
    day_delta = (trade_date - best.triggered_at.date()).days

    return {
        "source_event_id": best.id,
        "source_triggered_at": best.triggered_at,
        "source_match_method": method,
        "source_match_confidence": confidence,
        "source_match_notes": f"Matched by symbol and proximity ({day_delta} day delta).",
    }


def _read_only_risk_policy(db) -> OptionRiskPolicy | SimpleNamespace:
    """Return persisted policy state or an unpersisted draft preview for GETs."""

    policy = (
        db.query(OptionRiskPolicy)
        .filter(OptionRiskPolicy.active.is_(True))
        .order_by(OptionRiskPolicy.policy_version.desc())
        .first()
    )
    if policy is None:
        policy = db.query(OptionRiskPolicy).order_by(OptionRiskPolicy.policy_version.desc()).first()
    if policy is not None:
        return policy
    return SimpleNamespace(
        id=None,
        policy_version=1,
        name="Draft tracked-options guardrails",
        active=False,
        approval_status="draft",
        portfolio_capital=None,
        default_trade_risk_budget=None,
        max_single_position_premium_pct=30.0,
        max_directional_premium_pct=75.0,
        max_expiry_bucket_premium_pct=45.0,
        max_option_spread_pct=25.0,
        min_dte_for_add=21,
        settings_json=json_dumps(
            {
                "basis": "tracked_option_premium",
                "note": "Unpersisted preview; approve a policy with the write endpoint.",
            }
        ),
        effective_from=date.today(),
    )


def _resolve_option_row(
    provider: MarketDataProvider,
    symbol: str,
    expiration: date,
    option_type: str,
    strike: float,
) -> Optional[pd.Series]:
    try:
        side = "CALL" if option_type.lower() == "call" else "PUT"
        try:
            available_strikes = provider.option_strikes(symbol, expiration.isoformat())
            strikes = sorted(available_strikes, key=lambda value: abs(float(value) - float(strike)))[:3]
        except Exception:
            strikes = [float(strike)]
        chain = provider.option_chain(
            symbol,
            expiration.isoformat(),
            right=side,
            strikes=strikes or [float(strike)],
        )
    except Exception:
        return None
    frame = chain.calls if side == "CALL" else chain.puts
    if frame is None or frame.empty or "strike" not in frame.columns:
        return None
    frame = frame.dropna(subset=["strike"])
    if frame.empty:
        return None
    frame = frame.copy()
    frame["strike_delta"] = (frame["strike"] - strike).abs()
    row = frame.sort_values("strike_delta").iloc[0].copy()
    row["dataSource"] = chain.source
    if chain.quote_source and ("quoteSource" not in row or pd.isna(row.get("quoteSource"))):
        row["quoteSource"] = chain.quote_source
    return row


def _quote_payload_from_row(row: Optional[pd.Series]) -> Dict[str, object]:
    quote = option_quote_from_row(row)
    return {
        "bid": quote.get("bid"),
        "ask": quote.get("ask"),
        "last": quote.get("last"),
        "mid": quote.get("mid"),
        "spread": quote.get("spread"),
        "spread_pct": quote.get("spread_pct"),
        "volume": quote.get("volume"),
        "open_interest": quote.get("open_interest"),
        "implied_volatility": quote.get("implied_volatility"),
        "last_trade_at": quote.get("last_trade_date"),
        "data_source": quote.get("data_source"),
        "quote_source": quote.get("quote_source"),
        "quality": quote.get("quality"),
    }


def _market_data_for_symbol(provider: MarketDataProvider, symbol: str) -> Dict[str, object]:
    try:
        quote = provider.quote(symbol)
    except Exception as exc:
        return {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "last_updated": datetime.utcnow().isoformat(),
            "data_source": getattr(provider, "name", "unknown"),
            "quote_source": None,
            "error": str(exc),
        }
    current = quote.price
    previous = quote.close
    change = current - previous if current is not None and previous is not None else None
    change_pct = (change / previous) * 100 if previous else None
    return {
        "current_price": current,
        "previous_close": previous,
        "change": change,
        "change_percent": change_pct,
        "last_updated": datetime.utcnow().isoformat(),
        "data_source": quote.source or provider.name,
        "quote_source": quote.quote_source,
    }


def _empty_position_metrics(error: Optional[str] = None) -> Dict[str, object]:
    field_context = build_option_field_context(
        None,
        option_type=None,
        observed_at=datetime.utcnow(),
        data_source=None,
        timeframe="1D",
        strategy_scope="single_leg",
    )
    field_quality = field_context.get("quality")
    if isinstance(field_quality, dict):
        warnings = list(field_quality.get("warnings") or [])
        warnings.append("position_metrics_unavailable")
        field_quality["warnings"] = list(dict.fromkeys(str(item) for item in warnings))
    payload: Dict[str, object] = {
        "market": {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "implied_volatility": None,
            "last_updated": datetime.utcnow().isoformat(),
            "data_source": None,
            "quote_source": None,
        },
        "option_price": None,
        "option_price_source": None,
        "quote": {
            "bid": None,
            "ask": None,
            "last": None,
            "mid": None,
            "spread": None,
            "spread_pct": None,
            "volume": None,
            "open_interest": None,
            "implied_volatility": None,
            "last_trade_at": None,
            "data_source": None,
            "quote_source": None,
            "quality": "missing",
        },
        "volatility": None,
        "volatility_source": None,
        "hv30": None,
        "volatility_signal": _empty_volatility_signal(),
        "opportunity": None,
        "technical_snapshot": {},
        "field_context": field_context,
        "dte": None,
        "greeks": None,
        "pnl": {
            "dollar": None,
            "percent": None,
            "source": None,
        },
    }
    if error:
        payload["error"] = error
    return payload


def _as_percent_vol(value: object) -> Optional[float]:
    if value is None or not _is_finite_number(value):
        return None
    numeric = float(value)
    if numeric <= 0:
        return None
    if numeric <= 5:
        numeric *= 100
    return round(numeric, 2)


def _pct_point_change(current: object, entry: object) -> Optional[float]:
    if current is None or entry is None:
        return None
    if not _is_finite_number(current) or not _is_finite_number(entry):
        return None
    return round(float(current) - float(entry), 2)


def _iv_hv_spread(iv30: object, hv30: object) -> Optional[float]:
    return _pct_point_change(iv30, hv30)


def _vol_trend_state(change: Optional[float], threshold: float = 1.0) -> str:
    if change is None:
        return "unknown"
    if change >= threshold:
        return "expanding"
    if change <= -threshold:
        return "contracting"
    return "stable"


def _empty_volatility_signal(error: Optional[str] = None) -> Dict[str, object]:
    payload: Dict[str, object] = {
        "entry": None,
        "current": {
            "iv30": None,
            "hv30": None,
            "iv_hv_spread": None,
            "iv_percentile": None,
            "avg_edr": None,
            "contract_iv": None,
            "data_source": None,
            "quote_source": None,
            "pricing_basis": None,
            "expiries_scanned": None,
            "as_of": datetime.utcnow().isoformat(),
        },
        "trend": {
            "iv30_change": None,
            "hv30_change": None,
            "iv_hv_spread_change": None,
            "iv_percentile_change": None,
            "avg_edr_change": None,
            "contract_iv_change": None,
            "algorithm_state": "unknown",
            "contract_iv_state": "unknown",
            "value_state": "unknown",
            "headline": "Volatility baseline unavailable",
        },
    }
    if error:
        payload["error"] = error
    return payload


def _compute_volatility_signal(
    position: OptionPosition,
    provider: MarketDataProvider,
    market: Dict[str, object],
    quote: Dict[str, object],
    hv30: Optional[float],
    include_chain_snapshot: bool = False,
) -> Dict[str, object]:
    current_contract_iv = _as_percent_vol(quote.get("implied_volatility"))
    signal = _empty_volatility_signal()
    signal["current"]["contract_iv"] = current_contract_iv
    signal["current"]["hv30"] = round(float(hv30), 2) if hv30 is not None and _is_finite_number(hv30) else None

    source_event_id = getattr(position, "source_event_id", None)
    entry_event = None
    if source_event_id is not None:
        try:
            with get_db_session() as db:
                entry_event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == source_event_id).first()
        except Exception:
            entry_event = None

    if entry_event is not None:
        entry_iv30 = round(float(entry_event.iv30), 2) if _is_finite_number(entry_event.iv30) else None
        entry_hv30 = round(float(entry_event.hv30), 2) if _is_finite_number(entry_event.hv30) else None
        signal["entry"] = {
            "event_id": entry_event.id,
            "triggered_at": entry_event.triggered_at.isoformat() if entry_event.triggered_at else None,
            "iv30": entry_iv30,
            "hv30": entry_hv30,
            "iv_hv_spread": _iv_hv_spread(entry_iv30, entry_hv30),
            "iv_percentile": round(float(entry_event.iv_percentile), 1) if _is_finite_number(entry_event.iv_percentile) else None,
            "avg_edr": round(float(entry_event.avg_edr), 2) if _is_finite_number(entry_event.avg_edr) else None,
            "contract_iv": _as_percent_vol(entry_event.selected_implied_volatility),
        }

    spot = market.get("current_price") or position.underlying_reference or position.underlying_at_entry
    current_metrics: Dict[str, object] = {}
    if include_chain_snapshot and source_event_id is not None and spot and _is_finite_number(spot) and float(spot) > 0:
        try:
            current_metrics = compute_optionality_metrics(
                provider,
                position.symbol,
                float(spot),
                hv30,
                max_expiries=3,
                strike_thresholds=[0.08, 0.15],
            )
        except Exception as exc:
            signal["error"] = str(exc)
            current_metrics = {}

    current_iv30 = current_metrics.get("iv30")
    current_hv30 = current_metrics.get("hv30", hv30)
    current_iv_percentile = current_metrics.get("iv_percentile")
    current_avg_edr = current_metrics.get("avg_edr")
    current_spread = _iv_hv_spread(current_iv30, current_hv30)

    signal["current"] = {
        **signal["current"],
        "iv30": round(float(current_iv30), 2) if _is_finite_number(current_iv30) else None,
        "hv30": round(float(current_hv30), 2) if _is_finite_number(current_hv30) else signal["current"]["hv30"],
        "iv_hv_spread": current_spread,
        "iv_percentile": round(float(current_iv_percentile), 1) if _is_finite_number(current_iv_percentile) else None,
        "avg_edr": round(float(current_avg_edr), 2) if _is_finite_number(current_avg_edr) else None,
        "contract_iv": current_contract_iv,
        "data_source": current_metrics.get("data_source"),
        "quote_source": current_metrics.get("quote_source"),
        "pricing_basis": current_metrics.get("pricing_basis"),
        "expiries_scanned": current_metrics.get("expiries_scanned"),
        "as_of": datetime.utcnow().isoformat(),
    }

    entry = signal.get("entry") or {}
    iv30_change = _pct_point_change(signal["current"].get("iv30"), entry.get("iv30"))
    hv30_change = _pct_point_change(signal["current"].get("hv30"), entry.get("hv30"))
    spread_change = _pct_point_change(signal["current"].get("iv_hv_spread"), entry.get("iv_hv_spread"))
    iv_percentile_change = _pct_point_change(signal["current"].get("iv_percentile"), entry.get("iv_percentile"))
    avg_edr_change = _pct_point_change(signal["current"].get("avg_edr"), entry.get("avg_edr"))
    contract_iv_change = _pct_point_change(signal["current"].get("contract_iv"), entry.get("contract_iv"))
    contract_state = _vol_trend_state(contract_iv_change)
    algorithm_state = _vol_trend_state(spread_change)
    value_state = contract_state if contract_state != "unknown" else algorithm_state

    if contract_iv_change is not None:
        headline = f"Contract IV {contract_state} {contract_iv_change:+.1f} pts"
    elif spread_change is not None:
        headline = f"IV/HV spread {algorithm_state} {spread_change:+.1f} pts"
    elif signal["current"].get("iv30") is not None and signal["current"].get("hv30") is not None:
        headline = "Current IV/HV computed"
    else:
        headline = "Volatility baseline unavailable"

    signal["trend"] = {
        "iv30_change": iv30_change,
        "hv30_change": hv30_change,
        "iv_hv_spread_change": spread_change,
        "iv_percentile_change": iv_percentile_change,
        "avg_edr_change": avg_edr_change,
        "contract_iv_change": contract_iv_change,
        "algorithm_state": algorithm_state,
        "contract_iv_state": contract_state,
        "value_state": value_state,
        "headline": headline,
    }
    return signal


def _score_payload_for_event(event: OptionAlertEvent) -> Dict[str, object]:
    selected_fields = event_opportunity_signal_fields(event)
    score = compute_opportunity_score(
        iv_percentile=event.iv_percentile,
        iv30=event.iv30,
        hv30=event.hv30,
        avg_edr=event.avg_edr,
        selected_spread_pct=event.selected_spread_pct,
        selected_open_interest=event.selected_open_interest,
        selected_volume=event.selected_volume,
        selected_reward_risk=selected_fields.get("selected_reward_risk"),
        selected_convexity_profit_pct=selected_fields.get("selected_convexity_profit_pct"),
        selected_convexity_probability_itm=selected_fields.get("selected_convexity_probability_itm"),
        selected_contract_score=selected_fields.get("selected_contract_score"),
    )
    if event.opportunity_score is not None and _is_finite_number(event.opportunity_score):
        score["base_score"] = round(float(event.opportunity_score), 2)
        score["grade"] = event.opportunity_grade or opportunity_grade(float(event.opportunity_score))
    return score


def _opportunity_rank_payload_for_event(
    event: Optional[OptionAlertEvent],
    *,
    prefix: str = "opportunity",
) -> Dict[str, object]:
    score_key = f"{prefix}_score"
    grade_key = f"{prefix}_grade"
    rank_key = f"{prefix}_rank_score"
    model_key = f"{prefix}_model_version"
    if event is None:
        return {
            score_key: None,
            grade_key: None,
            rank_key: None,
            model_key: OPPORTUNITY_MODEL_VERSION,
        }

    score = _score_payload_for_event(event)
    base_score = score.get("base_score")
    rank_score = score.get("rank_score")
    return {
        score_key: round(float(base_score), 2) if _is_finite_number(base_score) else None,
        grade_key: score.get("grade"),
        rank_key: round(float(rank_score), 2) if _is_finite_number(rank_score) else None,
        model_key: OPPORTUNITY_MODEL_VERSION,
    }


def _compute_position_opportunity_signal(
    position: OptionPosition,
    quote: Dict[str, object],
    volatility_signal: Dict[str, object],
) -> Optional[Dict[str, object]]:
    source_event_id = getattr(position, "source_event_id", None)
    if source_event_id is None:
        return None

    try:
        with get_db_session() as db:
            event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == source_event_id).first()
    except Exception as exc:
        return {"error": str(exc), "entry": None, "current": None}

    if event is None:
        return {
            "error": f"Scanner event {source_event_id} not found.",
            "entry": None,
            "current": None,
        }

    selected_fields = event_opportunity_signal_fields(event)
    entry_score = _score_payload_for_event(event)
    current = volatility_signal.get("current") or {}
    current_iv30 = current.get("iv30") or current.get("contract_iv") or event.iv30
    current_hv30 = current.get("hv30") or event.hv30
    current_iv_percentile = current.get("iv_percentile") or event.iv_percentile
    current_avg_edr = current.get("avg_edr") or event.avg_edr
    current_score = compute_opportunity_score(
        iv_percentile=current_iv_percentile,
        iv30=current_iv30,
        hv30=current_hv30,
        avg_edr=current_avg_edr,
        selected_spread_pct=quote.get("spread_pct") if quote.get("spread_pct") is not None else event.selected_spread_pct,
        selected_open_interest=quote.get("open_interest") if quote.get("open_interest") is not None else event.selected_open_interest,
        selected_volume=quote.get("volume") if quote.get("volume") is not None else event.selected_volume,
        selected_reward_risk=selected_fields.get("selected_reward_risk"),
        selected_convexity_profit_pct=selected_fields.get("selected_convexity_profit_pct"),
        selected_convexity_probability_itm=selected_fields.get("selected_convexity_probability_itm"),
        selected_contract_score=selected_fields.get("selected_contract_score"),
    )
    entry_base = float(entry_score.get("base_score") or 0.0)
    current_base = float(current_score.get("base_score") or 0.0)
    score_change = round(current_base - entry_base, 2)
    if score_change >= 3:
        headline = f"Rank improving {score_change:+.1f}"
    elif score_change <= -3:
        headline = f"Rank fading {score_change:+.1f}"
    else:
        headline = "Rank stable"

    return {
        "event_id": event.id,
        "model_version": OPPORTUNITY_MODEL_VERSION,
        "computed_for_date": date.today().isoformat(),
        "cadence": "daily_on_refresh",
        "basis": "current quote, current HV30, linked scanner setup",
        "entry": {
            "score": entry_score.get("base_score"),
            "rank_score": entry_score.get("rank_score"),
            "grade": entry_score.get("grade"),
            "components": entry_score.get("components"),
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
        },
        "current": {
            "score": current_score.get("base_score"),
            "rank_score": current_score.get("rank_score"),
            "grade": current_score.get("grade"),
            "components": current_score.get("components"),
            "reasons": current_score.get("reasons"),
        },
        "score_change": score_change,
        "headline": headline,
    }


def _compute_position_metrics(
    position: OptionPosition,
    provider: Optional[MarketDataProvider] = None,
    include_chain_snapshot: bool = False,
) -> Dict[str, object]:
    provider = provider or get_market_data_provider()
    market = _market_data_for_symbol(provider, position.symbol)

    option_row = _resolve_option_row(
        provider,
        position.symbol,
        position.expiration,
        position.option_type,
        position.strike,
    )
    quote = _quote_payload_from_row(option_row)
    implied_vol = None
    option_price = None
    option_price_source = None
    iv_source = None
    
    if option_row is not None:
        # Try to get IV from option chain
        implied_vol = option_row.get("impliedVolatility")
        if pd.notna(implied_vol) and _is_finite_number(implied_vol):
            implied_vol = float(implied_vol)
            iv_source = "chain"
        else:
            implied_vol = None
        
        # Get option price (prefer mid, fallback to last)
        last_price = option_row.get("lastPrice")
        bid = option_row.get("bid")
        ask = option_row.get("ask")
        
        if (
            pd.notna(bid)
            and pd.notna(ask)
            and _is_finite_number(bid)
            and _is_finite_number(ask)
            and bid > 0
            and ask > 0
        ):
            option_price = float(bid + ask) / 2.0
            option_price_source = "mid"
        elif pd.notna(last_price) and _is_finite_number(last_price) and last_price > 0:
            option_price = float(last_price)
            option_price_source = "last"

    # Get historical volatility as fallback
    try:
        hist = provider.daily_bars(position.symbol, days=180)
    except Exception:
        hist = None
    try:
        hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
    except Exception:
        hv30 = None
    technical_snapshot = technical_snapshot_from_frame(hist)
    field_context = build_option_field_context(
        hist,
        option_type=position.option_type,
        position_action=getattr(position, "action", None),
        strategy_scope="single_leg",
        observed_at=_parse_market_timestamp(market.get("last_updated")),
        data_source=(
            str(market.get("data_source"))
            if market.get("data_source")
            else str(getattr(provider, "name", "unknown"))
        ),
        timeframe="1D",
    )
    
    # Entry/reference spot remains useful for Greeks and decision context when
    # the live underlying quote is temporarily unavailable. It must not,
    # however, be mistaken for a current price when estimating P&L.
    market_spot = market.get("current_price")
    spot = market_spot or position.underlying_reference or position.underlying_at_entry
    
    # Determine volatility to use
    volatility = None

    # Priority 1: invert from current quoted option price if available. This
    # keeps Greeks consistent with the premium shown on the options page.
    if option_price is not None and spot and spot > 0:
        dte = max((position.expiration - date.today()).days, 0)
        T = max(dte, 0) / 365.0
        if T > 0:
            inverted_iv = implied_volatility(
                option_price,
                spot,
                position.strike,
                T,
                RISK_FREE_RATE,
                position.option_type
            )
            if inverted_iv is not None:
                volatility = inverted_iv
                iv_source = f"inverted ({option_price_source})"

    # Priority 2: Chain IV (but only if realistic - between 10% and 500%).
    if volatility is None and implied_vol is not None and 0.10 <= implied_vol <= 5.0:
        volatility = implied_vol
        iv_source = "chain"

    # Priority 3: Historical volatility. compute_historical_volatility returns
    # percent units, while Black-Scholes expects decimal volatility.
    if volatility is None and hv30 is not None and _is_finite_number(hv30):
        volatility = float(hv30) / 100.0
        iv_source = "historical"
    
    # If still no volatility, try a default
    if volatility is None:
        volatility = 0.30  # 30% default
        iv_source = "default"
    
    volatility_source = iv_source
    volatility_signal = _compute_volatility_signal(
        position,
        provider,
        market,
        quote,
        hv30,
        include_chain_snapshot=include_chain_snapshot,
    )
    opportunity_signal = _compute_position_opportunity_signal(position, quote, volatility_signal)

    dte = max((position.expiration - date.today()).days, 0)
    time_to_expiry = max(dte, 0) / 365.0
    
    greeks = None
    if (
        spot
        and _is_finite_number(spot)
        and volatility
        and _is_finite_number(volatility)
        and time_to_expiry > 0
    ):
        greeks = calculate_greeks(
            spot,
            position.strike,
            time_to_expiry,
            RISK_FREE_RATE,
            volatility,
            position.option_type,
        )

    pnl_source = None
    pnl_dollar = None
    pnl_percent = None
    if option_price is not None:
        pnl_source = "option_price"
        pnl_dollar = (option_price - position.fill_price) * position.contracts * 100

    if pnl_dollar is not None and position.total_cost:
        pnl_percent = pnl_dollar / position.total_cost * 100

    return {
        "market": {
            **market,
            "implied_volatility": implied_vol,  # Original chain IV if available
        },
        "option_price": option_price,
        "option_price_source": option_price_source,
        "quote": quote,
        "volatility": volatility,
        "volatility_source": volatility_source,
        "hv30": hv30,
        "volatility_signal": volatility_signal,
        "opportunity": opportunity_signal,
        "technical_snapshot": technical_snapshot,
        "field_context": field_context,
        "dte": dte,
        "greeks": greeks,
        "pnl": {
            "dollar": pnl_dollar,
            "percent": pnl_percent,
            "source": pnl_source,
        },
    }


def _position_evaluation_window(db: Any, position: OptionPosition) -> Dict[str, object]:
    empty = {
        "evaluation_min_hold_days": None,
        "evaluation_hold_days": None,
        "evaluation_start_date": None,
        "evaluation_due_date": None,
        "evaluation_decision_deadline": None,
        "evaluation_source": None,
        "evaluation_window_basis": None,
    }
    position_id = getattr(position, "id", None)
    if position_id is not None:
        latest_review = (
            db.query(OptionPositionReview)
            .filter(OptionPositionReview.position_id == position_id)
            .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
            .first()
        )
        if latest_review and latest_review.next_review_date:
            hold_days = max((latest_review.next_review_date - latest_review.review_date).days, 1)
            return {
                "evaluation_min_hold_days": 1,
                "evaluation_hold_days": hold_days,
                "evaluation_start_date": latest_review.review_date.isoformat(),
                "evaluation_due_date": latest_review.next_review_date.isoformat(),
                "evaluation_decision_deadline": (
                    latest_review.decision_deadline.isoformat() if latest_review.decision_deadline else None
                ),
                "evaluation_source": "decision_review",
                "evaluation_window_basis": (
                    latest_review.continuation_condition
                    or f"decision review #{latest_review.review_sequence}: {latest_review.verdict}"
                ),
            }

    source_event_id = getattr(position, "source_event_id", None)
    if source_event_id is None:
        return empty

    reminder = None
    if position_id is not None:
        reminder = (
            db.query(OptionTradeReminder)
            .filter(OptionTradeReminder.position_id == position_id)
            .first()
        )
    if reminder and reminder.hold_days:
        min_hold_days = reminder.min_hold_days or max(1, min(reminder.hold_days, round(reminder.hold_days * 0.4)))
        anchor = reminder.reminder_date - timedelta(days=reminder.hold_days)
        return {
            "evaluation_min_hold_days": min_hold_days,
            "evaluation_hold_days": reminder.hold_days,
            "evaluation_start_date": (anchor + timedelta(days=min_hold_days)).isoformat(),
            "evaluation_due_date": reminder.reminder_date.isoformat() if reminder.reminder_date else None,
            "evaluation_source": "sell_reminder",
            "evaluation_window_basis": "linked sell reminder",
        }

    event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == source_event_id).first()
    if not event:
        return empty

    recipe = _extract_training_recipe(event.message)
    field_min_hold_days = getattr(event, "review_min_hold_days", None)
    field_max_hold_days = getattr(event, "review_max_hold_days", None)
    if isinstance(field_min_hold_days, int) and isinstance(field_max_hold_days, int) and field_max_hold_days >= field_min_hold_days > 0:
        review_window = ReviewWindow(
            min_hold_days=field_min_hold_days,
            max_hold_days=field_max_hold_days,
            basis=getattr(event, "review_window_basis", None) or "scanner event fields",
        )
    else:
        parsed_window = parse_review_window(event.message)
        review_window = parsed_window or (
            ReviewWindow(
                min_hold_days=int(recipe["review_min_hold_days"]),
                max_hold_days=int(recipe["hold_days"]),
                basis="scanner event recipe",
            )
            if isinstance(recipe.get("review_min_hold_days"), int) and isinstance(recipe.get("hold_days"), int)
            else None
        )
    if review_window is None:
        return empty

    anchor = event.triggered_at.date() if event.triggered_at else position.trade_date
    return {
        "evaluation_min_hold_days": review_window.min_hold_days,
        "evaluation_hold_days": review_window.max_hold_days,
        "evaluation_start_date": (anchor + timedelta(days=review_window.min_hold_days)).isoformat(),
        "evaluation_due_date": (anchor + timedelta(days=review_window.max_hold_days)).isoformat(),
        "evaluation_source": "scanner_event",
        "evaluation_window_basis": review_window.basis,
    }


def _serialize_position(
    position: OptionPosition,
    evaluation_window: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    return {
        "id": position.id,
        "trade_date": position.trade_date.isoformat(),
        "account": position.account,
        "action": position.action,
        "contracts": position.contracts,
        "symbol": position.symbol,
        "expiration": position.expiration.isoformat(),
        "strike": position.strike,
        "option_type": position.option_type,
        "fill_price": position.fill_price,
        "total_cost": position.total_cost,
        "underlying_at_entry": position.underlying_at_entry,
        "estimated_delta": position.estimated_delta,
        "shares_equivalent": position.shares_equivalent,
        "dte_at_entry": position.dte_at_entry,
        "underlying_reference": position.underlying_reference,
        "source_event_id": position.source_event_id,
        "source_triggered_at": (
            position.source_triggered_at.isoformat() if position.source_triggered_at else None
        ),
        "source_match_method": position.source_match_method,
        "source_match_confidence": position.source_match_confidence,
        "source_match_notes": position.source_match_notes,
        **(evaluation_window or {
            "evaluation_min_hold_days": None,
            "evaluation_hold_days": None,
            "evaluation_start_date": None,
            "evaluation_due_date": None,
            "evaluation_source": None,
            "evaluation_window_basis": None,
        }),
    }


def _position_index_membership_catalog() -> tuple[Dict[str, set[str]], list[str]]:
    """Return cached index constituents without delaying the core positions payload."""
    global _POSITION_INDEX_MEMBERSHIP_CACHE

    now = time_lib.monotonic()
    with _POSITION_INDEX_MEMBERSHIP_CACHE_LOCK:
        cached = _POSITION_INDEX_MEMBERSHIP_CACHE
        if cached is not None:
            cached_at, catalog, errors = cached
            ttl = (
                _POSITION_INDEX_MEMBERSHIP_FAILURE_TTL_SECONDS
                if errors
                else _POSITION_INDEX_MEMBERSHIP_SUCCESS_TTL_SECONDS
            )
            if now - cached_at < ttl:
                return catalog, errors

        catalog: Dict[str, set[str]] = {}
        errors: list[str] = []
        for universe_key, _short_label, _long_label in _POSITION_INDEX_UNIVERSES:
            try:
                universe = resolve_sweep_universe(universe_key)
                catalog[universe_key] = {
                    str(symbol).strip().upper()
                    for symbol in universe.tickers
                    if str(symbol).strip()
                }
            except Exception as exc:
                errors.append(f"{universe_key}: {exc}")
        _POSITION_INDEX_MEMBERSHIP_CACHE = (now, catalog, errors)
        return catalog, errors


def _position_row_context_payload(db, positions: list[OptionPosition]) -> Dict[str, object]:
    event_ids = {
        int(position.source_event_id)
        for position in positions
        if position.source_event_id is not None
    }
    events = (
        db.query(OptionAlertEvent).filter(OptionAlertEvent.id.in_(event_ids)).all()
        if event_ids
        else []
    )
    events_by_id = {int(event.id): event for event in events}
    run_ids = {
        int(event.sweep_run_id)
        for event in events
        if event.sweep_run_id is not None
    }
    runs = (
        db.query(OptionSweepRun).filter(OptionSweepRun.id.in_(run_ids)).all()
        if run_ids
        else []
    )
    runs_by_id = {int(run.id): run for run in runs}
    membership_catalog, membership_errors = _position_index_membership_catalog()
    if membership_errors and membership_catalog:
        membership_status = "partial"
    elif membership_errors:
        membership_status = "unavailable"
    else:
        membership_status = "complete"

    contexts: Dict[str, object] = {}
    for position in positions:
        symbol = str(position.symbol or "").strip().upper()
        memberships = [
            {
                "key": universe_key,
                "label": short_label,
                "name": long_label,
            }
            for universe_key, short_label, long_label in _POSITION_INDEX_UNIVERSES
            if symbol in membership_catalog.get(universe_key, set())
        ]
        event = events_by_id.get(int(position.source_event_id)) if position.source_event_id is not None else None
        run = (
            runs_by_id.get(int(event.sweep_run_id))
            if event is not None and event.sweep_run_id is not None
            else None
        )
        scan = None
        if event is not None:
            scan = {
                "event_id": event.id,
                "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
                "sweep_run_id": event.sweep_run_id,
                "universe_key": run.universe_key if run is not None else None,
                "universe_label": run.universe_label if run is not None else None,
                "opportunity_score": event.opportunity_score,
                "opportunity_grade": event.opportunity_grade,
                "model_version": event.opportunity_model_version,
                "selected_expiry": event.selected_expiry,
                "selected_dte": event.selected_dte,
                "selected_strike": event.selected_strike,
                "selected_option_type": event.selected_option_type,
                "selected_premium": event.selected_premium,
                "selected_convexity_profit_pct": event.selected_convexity_profit_pct,
                "selected_convexity_probability_itm": event.selected_convexity_probability_itm,
            }
        contexts[str(position.id)] = {
            "position_id": position.id,
            "symbol": symbol,
            "index_memberships": memberships,
            "membership_status": membership_status,
            "linked_trade": position.source_event_id is not None,
            "source_match_method": position.source_match_method,
            "source_match_confidence": position.source_match_confidence,
            "source_match_notes": position.source_match_notes,
            "scan": scan,
        }

    return {
        "contexts_by_position": contexts,
        "membership_status": membership_status,
        "membership_as_of": datetime.utcnow().isoformat(),
    }


def _serialize_closed_position(
    position: ClosedPosition,
    source_event: Optional[OptionAlertEvent] = None,
) -> Dict[str, object]:
    return {
        "id": position.id,
        "source_position_id": position.source_position_id,
        "symbol": position.symbol,
        "option_type": position.option_type,
        "strike": position.strike,
        "expiration": position.expiration.isoformat(),
        "contracts": position.contracts,
        "trade_date": position.trade_date.isoformat(),
        "close_date": position.close_date.isoformat(),
        "fill_price": position.fill_price,
        "exit_price": position.exit_price,
        "total_cost": position.total_cost,
        "total_proceeds": position.total_proceeds,
        "dollar_pnl": position.dollar_pnl,
        "percent_pnl": position.percent_pnl,
        "underlying_at_entry": position.underlying_at_entry,
        "underlying_at_exit": position.underlying_at_exit,
        "account": position.account,
        "notes": position.notes,
        "source_event_id": position.source_event_id,
        "source_triggered_at": (
            position.source_triggered_at.isoformat() if position.source_triggered_at else None
        ),
        "source_match_method": position.source_match_method,
        "source_match_confidence": position.source_match_confidence,
        "source_match_notes": position.source_match_notes,
        **_opportunity_rank_payload_for_event(source_event, prefix="source_opportunity"),
    }


_REVIEW_TRADE_ROLES = {
    "unclassified",
    "catalyst",
    "trend",
    "mean_reversion",
    "long_term_thesis",
    "hedge",
    "income",
}
_REVIEW_THESIS_STATES = {
    "unassessed",
    "strengthened",
    "intact",
    "weakened",
    "broken",
    "no_longer_relevant",
}
_REVIEW_FRESH_ENTRY_ANSWERS = {
    "unassessed",
    "yes",
    "yes_smaller",
    "conditional",
    "no_underlying_valid",
    "no_thesis_invalid",
}
_REVIEW_VERDICTS = {
    "manual_review",
    "hold",
    "conditional_hold",
    "reduce",
    "close",
    "replacement_candidate",
    "add_eligible",
}
_REVIEW_QUALITY = {"unrated", "green", "yellow", "red"}
_REVIEW_URGENCY = {"low", "medium", "high", "critical"}
_REVIEW_CONFIDENCE = {"low", "medium", "high"}


def _clean_review_text(value: Optional[str]) -> Optional[str]:
    cleaned = value.strip() if value else ""
    return cleaned or None


def _parse_review_date(value: Optional[str], field_name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return _parse_date(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} must use YYYY-MM-DD.") from exc


def _parse_market_timestamp(value: object) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except ValueError:
        return None


def _position_review_snapshot(position: OptionPosition, metrics: Dict[str, object]) -> Dict[str, object]:
    market = metrics.get("market") if isinstance(metrics.get("market"), dict) else {}
    quote = metrics.get("quote") if isinstance(metrics.get("quote"), dict) else {}
    pnl = metrics.get("pnl") if isinstance(metrics.get("pnl"), dict) else {}
    greeks = metrics.get("greeks") if isinstance(metrics.get("greeks"), dict) else {}
    option_price = metrics.get("option_price")
    safe_option_price = float(option_price) if _is_finite_number(option_price) else None
    return {
        "underlying_price_snapshot": (
            float(market.get("current_price")) if _is_finite_number(market.get("current_price")) else None
        ),
        "option_price_snapshot": safe_option_price,
        "remaining_capital_snapshot": (
            safe_option_price * position.contracts * 100 if safe_option_price is not None else None
        ),
        "pnl_dollar_snapshot": (
            float(pnl.get("dollar")) if _is_finite_number(pnl.get("dollar")) else None
        ),
        "pnl_percent_snapshot": (
            float(pnl.get("percent")) if _is_finite_number(pnl.get("percent")) else None
        ),
        "dte_snapshot": int(metrics["dte"]) if _is_finite_number(metrics.get("dte")) else None,
        "delta_snapshot": (
            float(greeks.get("delta")) if _is_finite_number(greeks.get("delta")) else None
        ),
        "theta_snapshot": (
            float(greeks.get("theta")) if _is_finite_number(greeks.get("theta")) else None
        ),
        "implied_volatility_snapshot": (
            float(quote.get("implied_volatility"))
            if _is_finite_number(quote.get("implied_volatility"))
            else float(metrics.get("volatility"))
            if _is_finite_number(metrics.get("volatility"))
            else None
        ),
        "quote_quality_snapshot": _clean_review_text(str(quote.get("quality") or "")),
        "market_data_as_of": _parse_market_timestamp(market.get("last_updated")),
    }


def _serialize_position_review(review: OptionPositionReview) -> Dict[str, object]:
    return {
        "id": review.id,
        "position_id": review.position_id,
        "supersedes_review_id": review.supersedes_review_id,
        "review_sequence": review.review_sequence,
        "review_date": review.review_date.isoformat(),
        "review_type": review.review_type,
        "selected_assessment_id": review.selected_assessment_id,
        "decision_source": review.decision_source,
        "human_override": review.human_override,
        "override_reason": review.override_reason,
        "threshold_approval_status": review.threshold_approval_status,
        "symbol": review.symbol,
        "expiration": review.expiration.isoformat(),
        "strike": review.strike,
        "option_type": review.option_type,
        "contracts_snapshot": review.contracts_snapshot,
        "trade_role": review.trade_role,
        "original_thesis": review.original_thesis,
        "contract_thesis": review.contract_thesis,
        "expected_path": review.expected_path,
        "catalyst": review.catalyst,
        "confirmation_condition": review.confirmation_condition,
        "invalidation_condition": review.invalidation_condition,
        "risk_budget": review.risk_budget,
        "evidence_since_last": review.evidence_since_last,
        "thesis_status": review.thesis_status,
        "fresh_entry_answer": review.fresh_entry_answer,
        "portfolio_fit": review.portfolio_fit,
        "data_quality_notes": review.data_quality_notes,
        "verdict": review.verdict,
        "target_contracts": review.target_contracts,
        "quality": review.quality,
        "urgency": review.urgency,
        "confidence": review.confidence,
        "continuation_condition": review.continuation_condition,
        "next_review_date": review.next_review_date.isoformat() if review.next_review_date else None,
        "decision_deadline": review.decision_deadline.isoformat() if review.decision_deadline else None,
        "decision_notes": review.decision_notes,
        "snapshot": {
            "underlying_price": review.underlying_price_snapshot,
            "option_price": review.option_price_snapshot,
            "remaining_capital": review.remaining_capital_snapshot,
            "pnl_dollar": review.pnl_dollar_snapshot,
            "pnl_percent": review.pnl_percent_snapshot,
            "dte": review.dte_snapshot,
            "delta": review.delta_snapshot,
            "theta": review.theta_snapshot,
            "implied_volatility": review.implied_volatility_snapshot,
            "quote_quality": review.quote_quality_snapshot,
            "market_data_as_of": review.market_data_as_of.isoformat() if review.market_data_as_of else None,
        },
        "created_at": review.created_at.isoformat() if review.created_at else None,
    }


def _serialize_position_review_window(review: OptionPositionReview) -> Dict[str, object]:
    """Compact review history used by the portfolio rails."""
    return {
        "id": review.id,
        "position_id": review.position_id,
        "review_sequence": review.review_sequence,
        "review_date": review.review_date.isoformat(),
        "next_review_date": review.next_review_date.isoformat() if review.next_review_date else None,
        "decision_deadline": review.decision_deadline.isoformat() if review.decision_deadline else None,
    }


def _position_review_status(
    review: Optional[OptionPositionReview],
    position: OptionPosition,
    *,
    today: Optional[date] = None,
) -> Dict[str, object]:
    as_of = today or date.today()
    if review is None:
        return {
            "window_status": "unreviewed",
            "review_due": True,
            "decision_deadline_missed": False,
            "additions_blocked": True,
            "addition_blockers": ["No decision mandate or review has been recorded."],
            "warnings": [],
            "missing_mandate_fields": [
                "original thesis",
                "contract thesis",
                "confirmation condition",
                "invalidation condition",
                "decision deadline",
            ],
        }

    missing_mandate_fields = [
        label
        for label, value in (
            ("original thesis", review.original_thesis),
            ("contract thesis", review.contract_thesis),
            ("confirmation condition", review.confirmation_condition),
            ("invalidation condition", review.invalidation_condition),
            ("decision deadline", review.decision_deadline),
        )
        if not value
    ]
    review_due = bool(review.next_review_date and review.next_review_date <= as_of)
    deadline_missed = bool(review.decision_deadline and review.decision_deadline < as_of)
    if deadline_missed:
        window_status = "decision_overdue"
    elif review.next_review_date and review.next_review_date < as_of:
        window_status = "review_overdue"
    elif review.next_review_date == as_of:
        window_status = "review_due"
    elif review.next_review_date:
        window_status = "scheduled"
    else:
        window_status = "unscheduled"

    blockers = []
    if missing_mandate_fields:
        blockers.append("Trade mandate is incomplete.")
    if review.option_price_snapshot is None or review.underlying_price_snapshot is None:
        blockers.append("The review lacks a complete live price snapshot.")
    if review.thesis_status in {"broken", "no_longer_relevant"}:
        blockers.append("The latest review says the thesis is no longer valid.")
    if deadline_missed:
        blockers.append("The active decision deadline has passed.")
    if review.risk_budget is not None and position.total_cost > review.risk_budget:
        blockers.append("Recorded position cost exceeds the latest risk budget.")

    warnings = []
    if review.verdict == "close" and review.target_contracts != 0:
        warnings.append("Close verdict does not target zero contracts.")
    if review.verdict == "reduce" and review.target_contracts >= position.contracts:
        warnings.append("Reduce verdict does not target fewer contracts than the current position.")
    if review.verdict in {"hold", "conditional_hold"} and review.target_contracts != position.contracts:
        warnings.append("Hold verdict and target size differ from the current position.")
    if review.verdict == "add_eligible" and review.target_contracts <= position.contracts:
        warnings.append("Add-eligible verdict does not target more contracts than the current position.")
    if review.verdict == "replacement_candidate" and review.target_contracts != 0:
        warnings.append("A replacement candidate should close this contract before evaluating a new one.")
    if review.next_review_date and review.decision_deadline and review.next_review_date > review.decision_deadline:
        warnings.append("The next review is scheduled after the decision deadline.")

    return {
        "window_status": window_status,
        "review_due": review_due,
        "decision_deadline_missed": deadline_missed,
        "additions_blocked": bool(blockers),
        "addition_blockers": blockers,
        "warnings": warnings,
        "missing_mandate_fields": missing_mandate_fields,
    }


def _generate_position_assessment(
    db: Any,
    position: OptionPosition,
    metrics: Dict[str, object],
    *,
    trigger: str,
    force: bool = False,
) -> tuple[OptionPositionMandate, OptionThesisAssessment, OptionRiskPolicy]:
    source_event = (
        db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
        if position.source_event_id is not None
        else None
    )
    mandate = get_or_create_mandate(db, position, source_event)
    latest_review = (
        db.query(OptionPositionReview)
        .filter(OptionPositionReview.position_id == position.id)
        .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
        .first()
    )
    policy = latest_risk_policy(db)
    ensure_model_registry(db)
    projection_row = (
        db.query(StockProjectionSnapshot)
        .filter(StockProjectionSnapshot.symbol == position.symbol)
        .first()
    )
    latest_assessment = (
        db.query(OptionThesisAssessment)
        .filter(OptionThesisAssessment.position_id == position.id)
        .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
        .first()
    )
    payload = build_assessment_payload(
        position=position,
        metrics=metrics,
        mandate=mandate,
        latest_review=latest_review,
        portfolio_positions=db.query(OptionPosition).all(),
        risk_policy=policy,
        source_event=source_event,
        projection_payload=projection_row.payload if projection_row is not None else None,
    )
    assessment = persist_assessment(
        db,
        position=position,
        mandate=mandate,
        payload=payload,
        trigger=trigger,
        force=force,
    )
    if latest_assessment is None or assessment.id != latest_assessment.id:
        record_position_event(
            db,
            position_id=position.id,
            event_type="assessed",
            related_assessment_id=assessment.id,
            quantity_before=position.contracts,
            quantity_after=position.contracts,
            total_cost_before=position.total_cost,
            total_cost_after=position.total_cost,
            details={
                "trigger": trigger,
                "grader_version": assessment.grader_version,
                "proposed_verdict": assessment.proposed_verdict,
                "shadow_only": True,
            },
        )
    return mandate, assessment, policy


def _assessment_to_review_defaults(
    position: OptionPosition,
    mandate: OptionPositionMandate,
    assessment: OptionThesisAssessment,
    suggested_window: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    thesis_map = {
        "strengthening": "strengthened",
        "intact": "intact",
        "watch": "weakened",
        "impaired": "weakened",
        "broken": "broken",
        "retired": "no_longer_relevant",
    }
    if assessment.proposed_verdict == "hold" and assessment.contract_status == "attractive":
        fresh_entry = "yes"
    elif assessment.proposed_verdict == "reduce":
        fresh_entry = "yes_smaller"
    elif assessment.proposed_verdict == "conditional_hold":
        fresh_entry = "conditional"
    elif assessment.company_thesis_status in {"broken", "retired"}:
        fresh_entry = "no_thesis_invalid"
    else:
        fresh_entry = "no_underlying_valid"
    axes = json_loads(assessment.axis_results_json, {})
    portfolio = axes.get("portfolio_fit", {}) if isinstance(axes, dict) else {}
    missing = json_loads(assessment.missing_inputs_json, [])
    next_review_default = (
        suggested_window.get("next_review_date")
        if suggested_window is not None
        else assessment.next_review_date.isoformat() if assessment.next_review_date else None
    )
    decision_deadline_default = (
        suggested_window.get("decision_deadline")
        if suggested_window is not None
        else assessment.decision_deadline.isoformat() if assessment.decision_deadline else None
    )
    continuation_default = (
        suggested_window.get("continuation_condition")
        if suggested_window is not None and suggested_window.get("continuation_condition")
        else assessment.continuation_condition
    )
    return {
        "selected_assessment_id": assessment.id,
        "review_date": date.today().isoformat(),
        "trade_role": mandate.trade_role,
        "original_thesis": mandate.original_thesis,
        "contract_thesis": mandate.contract_thesis,
        "expected_path": mandate.expected_path,
        "catalyst": mandate.catalyst,
        "confirmation_condition": mandate.confirmation_condition,
        "invalidation_condition": mandate.invalidation_condition,
        "risk_budget": mandate.risk_budget,
        "evidence_since_last": "\n".join(json_loads(assessment.reasons_json, [])[:3]),
        "thesis_status": thesis_map.get(assessment.company_thesis_status, "unassessed"),
        "fresh_entry_answer": fresh_entry,
        "portfolio_fit": (
            f"{assessment.portfolio_fit_status.replace('_', ' ').title()}; "
            f"same-direction premium {portfolio.get('direction_share_pct'):.1f}% of tracked premium."
            if isinstance(portfolio.get("direction_share_pct"), (int, float))
            else assessment.portfolio_fit_status.replace("_", " ").title()
        ),
        "data_quality_notes": (
            f"Missing or unapproved: {', '.join(missing)}" if missing else "Point-in-time data inputs are complete."
        ),
        "verdict": assessment.proposed_verdict,
        "target_contracts": assessment.proposed_target_contracts,
        "quality": assessment.quality,
        "urgency": assessment.urgency,
        "confidence": assessment.confidence,
        "continuation_condition": continuation_default,
        "next_review_date": next_review_default,
        "decision_deadline": decision_deadline_default,
        "decision_notes": "Automatic assessment accepted as a shadow recommendation; no order was submitted.",
        "threshold_approval_status": mandate.threshold_approval_status,
        "current_contracts": position.contracts,
    }


def _find_duplicate_open_position(
    db: Any,
    *,
    trade_date: date,
    account: Optional[str],
    action: Optional[str],
    contracts: int,
    symbol: str,
    expiration: date,
    strike: float,
    option_type: str,
    fill_price: float,
    total_cost: float,
    exclude_id: Optional[int] = None,
) -> Optional[OptionPosition]:
    query = db.query(OptionPosition).filter(
        OptionPosition.trade_date == trade_date,
        _nullable_equals(OptionPosition.account, account),
        _nullable_equals(OptionPosition.action, action),
        OptionPosition.contracts == contracts,
        OptionPosition.symbol == symbol,
        OptionPosition.expiration == expiration,
        OptionPosition.strike == strike,
        OptionPosition.option_type == option_type,
        OptionPosition.fill_price == fill_price,
        OptionPosition.total_cost == total_cost,
    )
    if exclude_id is not None:
        query = query.filter(OptionPosition.id != exclude_id)
    return query.first()


def _find_duplicate_closed_position(
    db: Any,
    *,
    trade_date: date,
    close_date: date,
    account: Optional[str],
    contracts: int,
    symbol: str,
    expiration: date,
    strike: float,
    option_type: str,
    fill_price: float,
    exit_price: float,
    total_cost: float,
    exclude_id: Optional[int] = None,
) -> Optional[ClosedPosition]:
    query = db.query(ClosedPosition).filter(
        ClosedPosition.trade_date == trade_date,
        ClosedPosition.close_date == close_date,
        _nullable_equals(ClosedPosition.account, account),
        ClosedPosition.contracts == contracts,
        ClosedPosition.symbol == symbol,
        ClosedPosition.expiration == expiration,
        ClosedPosition.strike == strike,
        ClosedPosition.option_type == option_type,
        ClosedPosition.fill_price == fill_price,
        ClosedPosition.exit_price == exit_price,
        ClosedPosition.total_cost == total_cost,
    )
    if exclude_id is not None:
        query = query.filter(ClosedPosition.id != exclude_id)
    return query.first()


_TRAINING_RETRY_AFTER = timedelta(hours=6)


def _parse_iso_date(value: object) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return _parse_date(str(value))


def _training_outcome_payload(row: OptionTrainingOutcome) -> Dict[str, object]:
    today = date.today()
    days_elapsed = row.days_elapsed_calendar
    if row.entry_date is not None and row.status == "pending":
        days_elapsed = (today - row.entry_date).days

    return {
        "event_id": row.event_id,
        "symbol": row.symbol,
        "triggered_at": row.triggered_at.isoformat() if row.triggered_at else None,
        "option_type": row.option_type,
        "contract_expiry": row.contract_expiry.isoformat() if row.contract_expiry else None,
        "contract_strike": row.contract_strike,
        "review_min_hold_days": row.review_min_hold_days,
        "review_max_hold_days": row.review_max_hold_days,
        "hold_days": row.hold_days,
        "entry_date": row.entry_date.isoformat() if row.entry_date else None,
        "exit_date": row.exit_date.isoformat() if row.exit_date else None,
        "entry_underlying": row.entry_underlying,
        "exit_underlying": row.exit_underlying,
        "underlying_directional_return_pct": row.underlying_directional_return_pct,
        "entry_option_price_est": row.entry_option_price_est,
        "exit_option_price_est": row.exit_option_price_est,
        "option_return_pct_est": row.option_return_pct_est,
        "option_pnl_per_contract_est": row.option_pnl_per_contract_est,
        "recommended_exit_date": row.recommended_exit_date.isoformat() if row.recommended_exit_date else None,
        "hold_days_realized": row.hold_days_realized,
        "days_elapsed_calendar": days_elapsed,
        "status": row.status,
    }


def _apply_training_outcome_payload(
    row: OptionTrainingOutcome,
    event: OptionAlertEvent,
    outcome: Dict[str, object],
) -> None:
    now = datetime.utcnow()
    row.event_id = event.id
    row.symbol = str(outcome.get("symbol") or event.symbol).upper()
    row.triggered_at = event.triggered_at
    row.option_type = str(outcome["option_type"]) if outcome.get("option_type") else None
    row.contract_expiry = _parse_iso_date(outcome.get("contract_expiry"))
    row.contract_strike = (
        float(outcome["contract_strike"]) if outcome.get("contract_strike") is not None else None
    )
    row.hold_days = int(outcome["hold_days"]) if outcome.get("hold_days") is not None else None
    row.review_min_hold_days = (
        int(outcome["review_min_hold_days"]) if outcome.get("review_min_hold_days") is not None else None
    )
    row.review_max_hold_days = (
        int(outcome["review_max_hold_days"]) if outcome.get("review_max_hold_days") is not None else row.hold_days
    )
    row.entry_date = _parse_iso_date(outcome.get("entry_date"))
    row.exit_date = _parse_iso_date(outcome.get("exit_date"))
    row.recommended_exit_date = _parse_iso_date(outcome.get("recommended_exit_date"))
    row.hold_days_realized = (
        int(outcome["hold_days_realized"]) if outcome.get("hold_days_realized") is not None else None
    )
    row.days_elapsed_calendar = (
        int(outcome["days_elapsed_calendar"]) if outcome.get("days_elapsed_calendar") is not None else None
    )
    row.entry_underlying = (
        float(outcome["entry_underlying"]) if outcome.get("entry_underlying") is not None else None
    )
    row.exit_underlying = (
        float(outcome["exit_underlying"]) if outcome.get("exit_underlying") is not None else None
    )
    row.underlying_directional_return_pct = (
        float(outcome["underlying_directional_return_pct"])
        if outcome.get("underlying_directional_return_pct") is not None
        else None
    )
    row.entry_option_price_est = (
        float(outcome["entry_option_price_est"]) if outcome.get("entry_option_price_est") is not None else None
    )
    row.exit_option_price_est = (
        float(outcome["exit_option_price_est"]) if outcome.get("exit_option_price_est") is not None else None
    )
    row.option_return_pct_est = (
        float(outcome["option_return_pct_est"]) if outcome.get("option_return_pct_est") is not None else None
    )
    row.option_pnl_per_contract_est = (
        float(outcome["option_pnl_per_contract_est"])
        if outcome.get("option_pnl_per_contract_est") is not None
        else None
    )
    row.status = str(outcome.get("status") or "pending")
    row.compute_status = "ok"
    row.compute_error = None
    row.computed_at = now
    row.updated_at = now
    if row.created_at is None:
        row.created_at = now


def _mark_training_outcome_error(
    row: OptionTrainingOutcome,
    event: OptionAlertEvent,
    error: Exception,
) -> None:
    recipe = _extract_training_recipe(event.message)
    now = datetime.utcnow()
    row.event_id = event.id
    row.symbol = event.symbol.upper()
    row.triggered_at = event.triggered_at
    row.option_type = event.selected_option_type or recipe.get("option_type")
    row.contract_expiry = _parse_iso_date(event.selected_expiry or recipe.get("contract_expiry"))
    contract_strike = event.selected_strike if event.selected_strike is not None else recipe.get("contract_strike")
    row.contract_strike = float(contract_strike) if isinstance(contract_strike, (int, float)) else None
    hold_days = recipe.get("hold_days")
    row.hold_days = int(hold_days) if isinstance(hold_days, int) else None
    review_min_hold_days = getattr(event, "review_min_hold_days", None) or recipe.get("review_min_hold_days")
    review_max_hold_days = getattr(event, "review_max_hold_days", None) or recipe.get("review_max_hold_days")
    row.review_min_hold_days = int(review_min_hold_days) if isinstance(review_min_hold_days, int) else None
    row.review_max_hold_days = int(review_max_hold_days) if isinstance(review_max_hold_days, int) else row.hold_days
    row.status = "error"
    row.compute_status = "error"
    row.compute_error = f"{type(error).__name__}: {str(error)[:450]}"
    row.computed_at = now
    row.updated_at = now
    if row.created_at is None:
        row.created_at = now


def _training_outcome_needs_compute(row: Optional[OptionTrainingOutcome]) -> bool:
    if row is None:
        return True
    if row.compute_status == "error":
        return datetime.utcnow() - row.computed_at >= _TRAINING_RETRY_AFTER
    if row.status == "pending" and row.recommended_exit_date and date.today() >= row.recommended_exit_date:
        return True
    return False


def _compute_training_outcome_with_cache(event: OptionAlertEvent) -> Optional[Dict[str, object]]:
    trigger_day = event.triggered_at.date() if event.triggered_at else date.today()
    days = max(30, (date.today() - trigger_day).days + 14)
    history = get_or_refresh_daily_frame(event.symbol, days=days)
    return _compute_training_outcome(event, history=history)


def _position_metrics_cache_key(position: OptionPosition) -> tuple[object, ...]:
    """Include every persisted field so edits cannot reuse incompatible metrics."""
    return tuple(
        getattr(position, column.name, None)
        for column in OptionPosition.__table__.columns
    )


def _position_metrics_snapshot(position: OptionPosition) -> SimpleNamespace:
    """Detach scalar position data before a background refresh outlives its DB session."""
    return SimpleNamespace(
        **{
            column.name: getattr(position, column.name, None)
            for column in OptionPosition.__table__.columns
        }
    )


def _compute_position_metrics_safely(
    position: Any,
    provider: MarketDataProvider,
) -> Dict[str, object]:
    try:
        return _compute_position_metrics(position, provider)
    except Exception as perr:
        # A failed symbol must not prevent the rest of the book from
        # rendering. The empty payload also exposes the error to the
        # existing data-quality UI.
        traceback.print_exc()
        return _empty_position_metrics(str(perr))


def _compute_position_metrics_batch(
    positions: list[Any],
    provider: Optional[MarketDataProvider] = None,
) -> Dict[int, Dict[str, object]]:
    if not positions:
        return {}
    market_provider = provider or get_market_data_provider()
    metrics_by_position_index: Dict[int, Dict[str, object]] = {}
    for position_index, position in enumerate(positions):
        metrics_by_position_index[position_index] = _compute_position_metrics_safely(
            position,
            market_provider,
        )
    return metrics_by_position_index


def _position_metrics_cache_ttl_seconds() -> float:
    try:
        return max(float(os.getenv("OPTION_POSITIONS_CACHE_TTL_SECONDS", "30")), 0.0)
    except ValueError:
        return 30.0


def _position_metrics_refresh_delay_seconds() -> float:
    try:
        return max(
            min(float(os.getenv("OPTION_POSITIONS_REFRESH_DELAY_SECONDS", "0.25")), 5.0),
            0.0,
        )
    except ValueError:
        return 0.25


def _position_metrics_refreshing() -> bool:
    with _POSITION_METRICS_REFRESH_LOCK:
        return _POSITION_METRICS_REFRESH_IN_PROGRESS


def _position_metrics_refresh_progress() -> Dict[str, object]:
    with _POSITION_METRICS_REFRESH_LOCK:
        return {
            **_POSITION_METRICS_REFRESH_PROGRESS,
            "target_position_ids": list(
                _POSITION_METRICS_REFRESH_PROGRESS["target_position_ids"]
            ),
            "completed_position_ids": list(
                _POSITION_METRICS_REFRESH_PROGRESS["completed_position_ids"]
            ),
        }


def _schedule_position_metrics_refresh(positions: list[Any]) -> bool:
    global _POSITION_METRICS_REFRESH_IN_PROGRESS
    if not positions:
        return False
    snapshots = [_position_metrics_snapshot(position) for position in positions]
    target_position_ids = [
        int(position.id)
        for position in snapshots
        if getattr(position, "id", None) is not None
    ]
    with _POSITION_METRICS_REFRESH_LOCK:
        if _POSITION_METRICS_REFRESH_IN_PROGRESS:
            return False
        _POSITION_METRICS_REFRESH_IN_PROGRESS = True
        _POSITION_METRICS_REFRESH_PROGRESS.update(
            {
                "total": len(snapshots),
                "completed": 0,
                "current_position_id": None,
                "current_symbol": None,
                "target_position_ids": target_position_ids,
                "completed_position_ids": [],
            }
        )

    def refresh() -> None:
        global _POSITION_METRICS_REFRESH_IN_PROGRESS
        refreshed_cache_keys: list[tuple[object, ...]] = []
        try:
            market_provider = get_market_data_provider()
            refresh_delay = _position_metrics_refresh_delay_seconds()
            for position_index, position in enumerate(snapshots):
                position_id = getattr(position, "id", None)
                with _POSITION_METRICS_REFRESH_LOCK:
                    _POSITION_METRICS_REFRESH_PROGRESS.update(
                        {
                            "current_position_id": position_id,
                            "current_symbol": getattr(position, "symbol", None),
                        }
                    )

                metrics = _compute_position_metrics_safely(position, market_provider)
                cache_key = _position_metrics_cache_key(position)
                refreshed_cache_keys.append(cache_key)
                with _POSITION_METRICS_CACHE_LOCK:
                    _POSITION_METRICS_CACHE[cache_key] = (
                        time_lib.monotonic(),
                        metrics,
                    )

                with _POSITION_METRICS_REFRESH_LOCK:
                    completed_ids = _POSITION_METRICS_REFRESH_PROGRESS[
                        "completed_position_ids"
                    ]
                    if position_id is not None:
                        completed_ids.append(int(position_id))
                    _POSITION_METRICS_REFRESH_PROGRESS.update(
                        {
                            "completed": position_index + 1,
                            "current_position_id": None,
                            "current_symbol": None,
                        }
                    )

                if refresh_delay > 0 and position_index < len(snapshots) - 1:
                    time_lib.sleep(refresh_delay)

            # Normalize timestamps at completion so the earliest sequential
            # result cannot become stale merely because later symbols were slow.
            refreshed_at = time_lib.monotonic()
            with _POSITION_METRICS_CACHE_LOCK:
                for cache_key in refreshed_cache_keys:
                    cached = _POSITION_METRICS_CACHE.get(cache_key)
                    if cached is not None:
                        _POSITION_METRICS_CACHE[cache_key] = (refreshed_at, cached[1])
        except Exception:
            traceback.print_exc()
        finally:
            with _POSITION_METRICS_REFRESH_LOCK:
                _POSITION_METRICS_REFRESH_IN_PROGRESS = False
                _POSITION_METRICS_REFRESH_PROGRESS.update(
                    {
                        "current_position_id": None,
                        "current_symbol": None,
                    }
                )

    try:
        _POSITION_METRICS_REFRESH_EXECUTOR.submit(refresh)
    except RuntimeError:
        with _POSITION_METRICS_REFRESH_LOCK:
            _POSITION_METRICS_REFRESH_IN_PROGRESS = False
            _POSITION_METRICS_REFRESH_PROGRESS.update(
                {
                    "current_position_id": None,
                    "current_symbol": None,
                }
            )
        return False
    return True


@router.get("/positions")
def get_positions(refresh: bool = Query(False)):
    try:
        with get_db_session() as db:
            positions = db.query(OptionPosition).order_by(OptionPosition.trade_date.desc()).all()
            cache_keys = [_position_metrics_cache_key(position) for position in positions]
            valid_cache_keys = set(cache_keys)
            now = time_lib.monotonic()
            cache_ttl = _position_metrics_cache_ttl_seconds()

            with _POSITION_METRICS_CACHE_LOCK:
                for cache_key in list(_POSITION_METRICS_CACHE):
                    if cache_key not in valid_cache_keys:
                        _POSITION_METRICS_CACHE.pop(cache_key, None)
                missing_indices = [
                    position_index
                    for position_index, cache_key in enumerate(cache_keys)
                    if cache_key not in _POSITION_METRICS_CACHE
                ]

            # A new or edited position has no compatible snapshot, so compute
            # only those misses before returning. Established positions render
            # from their last complete snapshot immediately.
            if missing_indices:
                missing_positions = [positions[position_index] for position_index in missing_indices]
                computed = _compute_position_metrics_batch(missing_positions)
                computed_at = time_lib.monotonic()
                with _POSITION_METRICS_CACHE_LOCK:
                    for batch_index, position_index in enumerate(missing_indices):
                        _POSITION_METRICS_CACHE[cache_keys[position_index]] = (
                            computed_at,
                            computed[batch_index],
                        )

            with _POSITION_METRICS_CACHE_LOCK:
                cache_entries = [_POSITION_METRICS_CACHE[cache_key] for cache_key in cache_keys]

            stale_indices = (
                list(range(len(positions)))
                if refresh
                else [
                    position_index
                    for position_index, (cached_at, _metrics) in enumerate(cache_entries)
                    if now - cached_at >= cache_ttl
                ]
            )
            refresh_started = _schedule_position_metrics_refresh(
                [positions[position_index] for position_index in stale_indices]
            )
            refresh_in_progress = refresh_started or _position_metrics_refreshing()
            refresh_progress = _position_metrics_refresh_progress()
            metrics_by_position_index = {
                position_index: metrics
                for position_index, (_cached_at, metrics) in enumerate(cache_entries)
            }

            payload = []
            for position_index, position in enumerate(positions):
                payload.append(
                    {
                        "position": _serialize_position(position, _position_evaluation_window(db, position)),
                        "metrics": metrics_by_position_index[position_index],
                    }
                )
            cache_age_seconds = max(
                (max(now - cached_at, 0.0) for cached_at, _metrics in cache_entries),
                default=0.0,
            )
            return _json_safe(
                {
                    "positions": payload,
                    "metrics_cache": {
                        "status": "stale" if stale_indices or refresh_in_progress else "fresh",
                        "age_seconds": round(cache_age_seconds, 1),
                        "refresh_in_progress": refresh_in_progress,
                        "refresh_progress": refresh_progress,
                    },
                }
            )
    except Exception as exc:
        # Log traceback to server logs for debugging
        traceback.print_exc()
        # Return a useful message to the caller to aid debugging (temporary)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}")


@router.get("/position-row-context")
def get_position_row_context():
    """Load index membership and linked scanner provenance after critical row data."""
    try:
        with get_db_session() as db:
            positions = db.query(OptionPosition).order_by(OptionPosition.trade_date.desc()).all()
            return _json_safe(_position_row_context_payload(db, positions))
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to load position row context: {exc}")


@router.get("/optionality-clusters")
def get_optionality_clusters(
    lookback_days: int = Query(45, ge=7, le=365),
    bucket_days: int = Query(7, ge=1, le=30),
    min_hits: int = Query(1, ge=1, le=10),
):
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    with get_db_session() as db:
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= cutoff)
            .order_by(OptionAlertEvent.triggered_at.desc())
            .all()
        )
        return _json_safe(
            build_optionality_cluster_payload(
                events,
                lookback_days=lookback_days,
                bucket_days=bucket_days,
                min_hits=min_hits,
            )
        )


@router.get("/scanner-summary")
def get_scanner_summary(
    lookback_days: int = Query(45, ge=7, le=3650),
    run_limit: int = Query(8, ge=1, le=50),
):
    return _json_safe(build_scanner_summary(lookback_days=lookback_days, run_limit=run_limit))


@router.post("/scanner-run")
def run_scanner_from_dashboard(http_request: Request, payload: ScannerRunRequest):
    try:
        result = _json_safe(
            {
                "status": "queued",
                "run": start_dashboard_sweep(
                    payload.universe_key,
                    payload.threshold,
                ),
            }
        )
        run_payload = result.get("run") if isinstance(result, dict) else None
        run_id = run_payload.get("id") if isinstance(run_payload, dict) else None
        set_secret_options_audit_change(
            http_request,
            object_type="scanner_run",
            object_id=run_id,
            after=run_payload,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/scanner-run/{run_id}")
def get_scanner_run(run_id: int):
    try:
        return _json_safe(build_scanner_run_detail(run_id))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/scanner-impressions")
def create_scanner_impressions(
    payload: ScannerImpressionBatch,
    http_request: Request,
):
    actor = str(
        getattr(http_request.state, "secret_options_actor", "anonymous")
    )
    request_id = str(
        getattr(http_request.state, "secret_options_request_id", "")
    )
    try:
        with get_db_session() as db:
            result = record_scanner_impressions(
                db,
                snapshot_id=payload.snapshot_id,
                page_session_id=payload.page_session_id,
                actor=actor,
                request_id=request_id,
                exposures=[
                    exposure.model_dump()
                    for exposure in payload.exposures
                ],
            )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ScannerImpressionReplayConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    set_secret_options_audit_change(
        http_request,
        object_type="scanner_impression_batch",
        object_id=payload.snapshot_id,
        after=result,
    )
    return result


@router.post("/scanner-run/{run_id}/stop")
def stop_scanner_run(run_id: int, http_request: Request):
    try:
        try:
            existing = _json_safe(build_scanner_run_detail(run_id))
            before = existing.get("run") if isinstance(existing, dict) else existing
        except LookupError:
            before = {"id": run_id, "status": "unknown"}
        result = _json_safe(request_stop_dashboard_sweep(run_id))
        set_secret_options_audit_change(
            http_request,
            object_type="scanner_run",
            object_id=run_id,
            before=before,
            after=result,
        )
        return result
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/positions")
def create_position(http_request: Request, payload: OptionPositionCreate):
    with get_db_session() as db:
        trade_date = _parse_date(payload.trade_date)
        expiration = _parse_date(payload.expiration)
        symbol = payload.symbol.upper()
        option_type = payload.option_type.lower()
        duplicate = _find_duplicate_open_position(
            db,
            trade_date=trade_date,
            account=payload.account,
            action=payload.action,
            contracts=payload.contracts,
            symbol=symbol,
            expiration=expiration,
            strike=payload.strike,
            option_type=option_type,
            fill_price=payload.fill_price,
            total_cost=payload.total_cost,
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate open position already exists as trade #{duplicate.id}.",
            )
        attribution = _resolve_signal_attribution(
            db,
            symbol,
            trade_date,
            explicit_event_id=payload.source_event_id,
        )
        position = OptionPosition(
            trade_date=trade_date,
            account=payload.account,
            action=payload.action,
            contracts=payload.contracts,
            symbol=symbol,
            expiration=expiration,
            strike=payload.strike,
            option_type=option_type,
            fill_price=payload.fill_price,
            total_cost=payload.total_cost,
            underlying_at_entry=payload.underlying_at_entry,
            estimated_delta=payload.estimated_delta,
            shares_equivalent=payload.shares_equivalent,
            dte_at_entry=payload.dte_at_entry,
            underlying_reference=payload.underlying_reference,
            source_event_id=attribution["source_event_id"],
            source_triggered_at=attribution["source_triggered_at"],
            source_match_method=attribution["source_match_method"],
            source_match_confidence=attribution["source_match_confidence"],
            source_match_notes=attribution["source_match_notes"],
        )
        db.add(position)
        db.flush()
        source_event = (
            db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
            if position.source_event_id is not None
            else None
        )
        mandate = get_or_create_mandate(
            db,
            position,
            source_event,
            capture_kind="captured_at_entry",
        )
        record_position_event(
            db,
            position_id=position.id,
            event_type="opened",
            quantity_before=0,
            quantity_after=position.contracts,
            execution_price=position.fill_price,
            total_cost_before=0.0,
            total_cost_after=position.total_cost,
            details={"mandate_id": mandate.id, "source_event_id": position.source_event_id},
        )
        sync_trade_sell_reminder(db, position)
        db.commit()
        db.refresh(position)
        serialized = _serialize_position(position, _position_evaluation_window(db, position))
        set_secret_options_audit_change(
            http_request,
            object_type="position",
            object_id=position.id,
            after=serialized,
        )
        return _json_safe({"position": serialized})


@router.put("/positions/{position_id}")
def update_position(position_id: int, http_request: Request, payload: OptionPositionCreate):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        quantity_before = position.contracts
        total_cost_before = position.total_cost
        prior_snapshot = _serialize_position(position)
        trade_date = _parse_date(payload.trade_date)
        expiration = _parse_date(payload.expiration)
        symbol = payload.symbol.upper()
        option_type = payload.option_type.lower()
        duplicate = _find_duplicate_open_position(
            db,
            trade_date=trade_date,
            account=payload.account,
            action=payload.action,
            contracts=payload.contracts,
            symbol=symbol,
            expiration=expiration,
            strike=payload.strike,
            option_type=option_type,
            fill_price=payload.fill_price,
            total_cost=payload.total_cost,
            exclude_id=position_id,
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate open position already exists as trade #{duplicate.id}.",
            )
        attribution = _resolve_signal_attribution(
            db,
            symbol,
            trade_date,
            explicit_event_id=payload.source_event_id,
        )

        position.trade_date = trade_date
        position.account = payload.account
        position.action = payload.action
        position.contracts = payload.contracts
        position.symbol = symbol
        position.expiration = expiration
        position.strike = payload.strike
        position.option_type = option_type
        position.fill_price = payload.fill_price
        position.total_cost = payload.total_cost
        position.underlying_at_entry = payload.underlying_at_entry
        position.estimated_delta = payload.estimated_delta
        position.shares_equivalent = payload.shares_equivalent
        position.dte_at_entry = payload.dte_at_entry
        position.underlying_reference = payload.underlying_reference
        position.source_event_id = attribution["source_event_id"]
        position.source_triggered_at = attribution["source_triggered_at"]
        position.source_match_method = attribution["source_match_method"]
        position.source_match_confidence = attribution["source_match_confidence"]
        position.source_match_notes = attribution["source_match_notes"]
        event_type = (
            "resized_up"
            if payload.contracts > quantity_before
            else "resized_down"
            if payload.contracts < quantity_before
            else "edited"
        )
        inferred_execution_price = None
        if payload.contracts > quantity_before and payload.total_cost > total_cost_before:
            inferred_execution_price = (
                (payload.total_cost - total_cost_before)
                / ((payload.contracts - quantity_before) * 100)
            )
        record_position_event(
            db,
            position_id=position.id,
            event_type=event_type,
            source="dashboard_edit",
            quantity_before=quantity_before,
            quantity_after=payload.contracts,
            execution_price=inferred_execution_price,
            total_cost_before=total_cost_before,
            total_cost_after=payload.total_cost,
            details={
                "prior_position": prior_snapshot,
                "execution_price_inferred": inferred_execution_price is not None,
            },
        )
        sync_trade_sell_reminder(db, position)

        db.commit()
        db.refresh(position)
        serialized = _serialize_position(position, _position_evaluation_window(db, position))
        set_secret_options_audit_change(
            http_request,
            object_type="position",
            object_id=position.id,
            before=prior_snapshot,
            after=serialized,
        )
        return _json_safe({"position": serialized})


@router.get("/decision-review-windows")
def get_decision_review_windows():
    """Return every stored review window in one compact portfolio-level payload."""
    with get_db_session() as db:
        reviews = (
            db.query(OptionPositionReview)
            .join(OptionPosition, OptionPosition.id == OptionPositionReview.position_id)
            .order_by(
                OptionPositionReview.position_id.asc(),
                OptionPositionReview.review_sequence.desc(),
                OptionPositionReview.id.desc(),
            )
            .all()
        )
        windows_by_position: Dict[str, list[Dict[str, object]]] = {}
        for review in reviews:
            windows_by_position.setdefault(str(review.position_id), []).append(
                _serialize_position_review_window(review)
            )
        return _json_safe(
            {
                "position_count": len(windows_by_position),
                "window_count": len(reviews),
                "windows_by_position": windows_by_position,
            }
        )


@router.get("/positions/{position_id}/decision-reviews")
def get_position_decision_reviews(position_id: int):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        reviews = (
            db.query(OptionPositionReview)
            .filter(OptionPositionReview.position_id == position_id)
            .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
            .all()
        )
        latest = reviews[0] if reviews else None
        return _json_safe(
            {
                "position_id": position_id,
                "review_count": len(reviews),
                "latest_review": _serialize_position_review(latest) if latest else None,
                "status": _position_review_status(latest, position),
                "history": [_serialize_position_review(review) for review in reviews],
            }
        )


def _assessment_response(
    db: Any,
    position: OptionPosition,
    mandate: OptionPositionMandate,
    assessment: OptionThesisAssessment,
    policy: OptionRiskPolicy,
) -> Dict[str, object]:
    source_event = (
        db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
        if position.source_event_id is not None
        else None
    )
    latest_review = (
        db.query(OptionPositionReview)
        .filter(OptionPositionReview.position_id == position.id)
        .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
        .first()
    )
    effective_verdict = latest_review.verdict if latest_review is not None else assessment.proposed_verdict
    effective_urgency = latest_review.urgency if latest_review is not None else assessment.urgency
    suggested_window = build_actionable_decision_window(
        position=position,
        mandate=mandate,
        source_event=source_event,
        verdict=effective_verdict,
        urgency=effective_urgency,
        contract_status=assessment.contract_status,
        as_of=date.today(),
    )
    suggested_window["source_assessment_id"] = assessment.id
    suggested_window["decision_source"] = "latest_review" if latest_review is not None else "automatic_assessment"
    suggested_window["verdict"] = effective_verdict
    suggested_window["urgency"] = effective_urgency
    suggested_window["continuation_condition"] = rebase_continuation_condition(
        latest_review.continuation_condition if latest_review is not None else assessment.continuation_condition,
        deadline=suggested_window["decision_deadline"],
        verdict=effective_verdict,
    )
    active_next_review = latest_review.next_review_date if latest_review is not None else assessment.next_review_date
    active_deadline = latest_review.decision_deadline if latest_review is not None else assessment.decision_deadline
    suggested_window["rebased"] = bool(
        (active_next_review and active_next_review <= date.today())
        or (active_deadline and active_deadline < date.today())
    )
    history = (
        db.query(OptionThesisAssessment)
        .filter(OptionThesisAssessment.position_id == position.id)
        .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
        .limit(20)
        .all()
    )
    return {
        "position_id": position.id,
        "mandate": serialize_mandate(mandate),
        "assessment": serialize_assessment(assessment),
        "suggested_window": suggested_window,
        "review_defaults": _assessment_to_review_defaults(position, mandate, assessment, suggested_window),
        "risk_policy": serialize_risk_policy(policy),
        "history": [serialize_assessment(row) for row in history],
        "automated_execution_enabled": False,
        "execution_note": "GET reads the latest persisted snapshot; POST refreshes and records one. Neither endpoint submits an order.",
    }


@router.get("/positions/{position_id}/thesis-assessment")
def get_position_thesis_assessment(position_id: int):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        assessment = (
            db.query(OptionThesisAssessment)
            .filter(OptionThesisAssessment.position_id == position_id)
            .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
            .first()
        )
        if assessment is not None:
            mandate = (
                db.query(OptionPositionMandate)
                .filter(OptionPositionMandate.id == assessment.mandate_id)
                .first()
            )
            if mandate is None:
                raise HTTPException(
                    status_code=409,
                    detail="The persisted assessment references a missing mandate; refresh it with the write endpoint.",
                )
            policy = _read_only_risk_policy(db)
        else:
            raise HTTPException(
                status_code=404,
                detail="No thesis assessment has been recorded; create one with POST /positions/{position_id}/thesis-assessment.",
            )
        response = _assessment_response(db, position, mandate, assessment, policy)
        return _json_safe(response)


@router.post("/positions/{position_id}/thesis-assessment")
def refresh_position_thesis_assessment(
    http_request: Request,
    position_id: int,
    force: bool = Query(True),
):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        try:
            metrics = _compute_position_metrics(position, get_market_data_provider())
        except Exception as exc:
            metrics = _empty_position_metrics(str(exc))
        mandate, assessment, policy = _generate_position_assessment(
            db,
            position,
            metrics,
            trigger="manual_refresh",
            force=force,
        )
        response = _assessment_response(db, position, mandate, assessment, policy)
        db.commit()
        set_secret_options_audit_change(
            http_request,
            object_type="thesis_assessment",
            object_id=assessment.id,
            after=serialize_assessment(assessment),
        )
        return _json_safe(response)


@router.post("/thesis-assessments/refresh-due")
def refresh_due_thesis_assessments(
    http_request: Request,
    limit: int = Query(100, ge=1, le=500),
):
    with get_db_session() as db:
        positions = db.query(OptionPosition).order_by(OptionPosition.id.asc()).limit(limit).all()
        provider = get_market_data_provider()
        refreshed = []
        errors = []
        for position in positions:
            try:
                metrics = _compute_position_metrics(position, provider)
                mandate, assessment, policy = _generate_position_assessment(
                    db,
                    position,
                    metrics,
                    trigger="batch_refresh",
                    force=True,
                )
                refreshed.append(
                    {
                        "position_id": position.id,
                        "symbol": position.symbol,
                        "assessment": serialize_assessment(assessment),
                        "mandate_confirmation_status": mandate.confirmation_status,
                        "risk_policy_version": policy.policy_version,
                    }
                )
            except Exception as exc:
                errors.append({"position_id": position.id, "symbol": position.symbol, "error": str(exc)})
        db.commit()
        response = {
            "checked": len(positions),
            "refreshed": refreshed,
            "errors": errors,
            "automated_execution_enabled": False,
        }
        set_secret_options_audit_change(
            http_request,
            object_type="thesis_assessment_batch",
            object_id="refresh-due",
            after={
                "checked": len(positions),
                "refreshed": len(refreshed),
                "errors": len(errors),
                "limit": limit,
            },
        )
        return _json_safe(response)


@router.get("/positions/{position_id}/lifecycle-events")
def get_position_lifecycle_events(position_id: int):
    with get_db_session() as db:
        rows = (
            db.query(OptionPositionEvent)
            .filter(OptionPositionEvent.position_id == position_id)
            .order_by(OptionPositionEvent.event_at.desc(), OptionPositionEvent.id.desc())
            .all()
        )
        if not rows and not db.query(OptionPosition).filter(OptionPosition.id == position_id).first():
            raise HTTPException(status_code=404, detail="Position not found")
        return _json_safe({"position_id": position_id, "events": [serialize_position_event(row) for row in rows]})


@router.post("/positions/{position_id}/lifecycle-events")
def create_position_lifecycle_event(
    position_id: int,
    http_request: Request,
    payload: OptionLifecycleEventCreate,
):
    allowed = {"add", "partial_close", "reduce", "close_execution", "adjustment"}
    if payload.event_type not in allowed:
        raise HTTPException(status_code=422, detail=f"Invalid event_type. Expected one of: {', '.join(sorted(allowed))}.")
    if payload.quantity_after is not None and payload.quantity_after < 0:
        raise HTTPException(status_code=422, detail="quantity_after cannot be negative.")
    if payload.execution_price is not None and payload.execution_price < 0:
        raise HTTPException(status_code=422, detail="execution_price cannot be negative.")
    event_at = None
    if payload.event_at:
        try:
            event_at = datetime.fromisoformat(payload.event_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="event_at must be ISO-8601.") from exc
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        quantity_after = payload.quantity_after if payload.quantity_after is not None else position.contracts
        row = record_position_event(
            db,
            position_id=position.id,
            event_type=payload.event_type,
            event_at=event_at,
            source="manual_execution_log",
            quantity_before=position.contracts,
            quantity_after=quantity_after,
            execution_price=payload.execution_price,
            total_cost_before=position.total_cost,
            total_cost_after=None,
            details={
                "notes": _clean_review_text(payload.notes),
                "position_mutated": False,
                "instruction": "Use the position edit/close workflow to reconcile current size.",
            },
        )
        db.commit()
        serialized_event = serialize_position_event(row)
        set_secret_options_audit_change(
            http_request,
            object_type="position_event",
            object_id=row.id,
            after=serialized_event,
        )
        return _json_safe(
            {
                "event": serialized_event,
                "position_mutated": False,
                "automated_execution_enabled": False,
            }
        )


@router.get("/risk-policy")
def get_option_risk_policy():
    with get_db_session() as db:
        policy = _read_only_risk_policy(db)
        return _json_safe({"risk_policy": serialize_risk_policy(policy)})


@router.post("/risk-policy")
def create_option_risk_policy(http_request: Request, payload: OptionRiskPolicyCreate):
    if payload.approval_status not in {"draft", "approved", "retired"}:
        raise HTTPException(status_code=422, detail="approval_status must be draft, approved, or retired.")
    for name in (
        "portfolio_capital",
        "default_trade_risk_budget",
        "max_single_position_premium_pct",
        "max_directional_premium_pct",
        "max_expiry_bucket_premium_pct",
        "max_option_spread_pct",
    ):
        value = getattr(payload, name)
        if value is not None and value <= 0:
            raise HTTPException(status_code=422, detail=f"{name} must be greater than zero.")
    if payload.min_dte_for_add is not None and payload.min_dte_for_add < 0:
        raise HTTPException(status_code=422, detail="min_dte_for_add cannot be negative.")
    with get_db_session() as db:
        latest = db.query(OptionRiskPolicy).order_by(OptionRiskPolicy.policy_version.desc()).first()
        prior_policy = serialize_risk_policy(latest) if latest is not None else None
        policy = OptionRiskPolicy(
            policy_version=(latest.policy_version + 1) if latest else 1,
            name=payload.name.strip() or "Tracked options risk policy",
            active=payload.active,
            approval_status=payload.approval_status,
            portfolio_capital=payload.portfolio_capital,
            default_trade_risk_budget=payload.default_trade_risk_budget,
            max_single_position_premium_pct=payload.max_single_position_premium_pct,
            max_directional_premium_pct=payload.max_directional_premium_pct,
            max_expiry_bucket_premium_pct=payload.max_expiry_bucket_premium_pct,
            max_option_spread_pct=payload.max_option_spread_pct,
            min_dte_for_add=payload.min_dte_for_add,
            settings_json=json_dumps(
                {
                    "basis": "tracked_option_premium",
                    "approved_by": "dashboard_user" if payload.approval_status == "approved" else None,
                    "automated_execution_enabled": False,
                }
            ),
        )
        db.add(policy)
        db.commit()
        db.refresh(policy)
        serialized_policy = serialize_risk_policy(policy)
        set_secret_options_audit_change(
            http_request,
            object_type="risk_policy",
            object_id=policy.id,
            before=prior_policy,
            after=serialized_policy,
        )
        return _json_safe({"risk_policy": serialized_policy})


@router.get("/learning-summary")
def get_option_learning_summary():
    with get_db_session() as db:
        result = learning_summary(db)
        return _json_safe(result)


@router.post("/learning-outcomes/backfill")
def backfill_option_learning_outcomes(
    http_request: Request,
    limit: int = Query(1000, ge=1, le=5000),
    mature_decisions: bool = Query(True),
):
    with get_db_session() as db:
        ensure_model_registry(db)
        trade_result = backfill_trade_outcomes(db, limit=limit)
        decision_result = (
            mature_decision_outcomes(
                db,
                history_loader=lambda symbol: get_or_refresh_daily_frame(symbol, days=730),
                limit=limit,
            )
            if mature_decisions
            else {"inserted": 0, "skipped": 0, "errors": 0}
        )
        summary = learning_summary(db)
        db.commit()
        response = {
            "trade_outcomes": trade_result,
            "decision_outcomes": decision_result,
            "summary": summary,
            "automated_model_promotion": False,
            "automated_execution_enabled": False,
        }
        set_secret_options_audit_change(
            http_request,
            object_type="learning_outcome_batch",
            object_id="backfill",
            after={
                "limit": limit,
                "mature_decisions": mature_decisions,
                "trade_outcomes": trade_result,
                "decision_outcomes": decision_result,
            },
        )
        return _json_safe(response)


@router.post("/positions/{position_id}/decision-reviews")
def create_position_decision_review(
    position_id: int,
    http_request: Request,
    payload: OptionPositionReviewCreate,
):
    if payload.threshold_approval_status not in {"draft", "approved"}:
        raise HTTPException(status_code=422, detail="threshold_approval_status must be draft or approved.")
    if payload.target_contracts is not None and payload.target_contracts < 0:
        raise HTTPException(status_code=422, detail="target_contracts cannot be negative.")
    if payload.risk_budget is not None and payload.risk_budget <= 0:
        raise HTTPException(status_code=422, detail="risk_budget must be greater than zero.")

    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        latest = (
            db.query(OptionPositionReview)
            .filter(OptionPositionReview.position_id == position_id)
            .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
            .first()
        )
        try:
            metrics = _compute_position_metrics(position, get_market_data_provider())
        except Exception as exc:
            metrics = _empty_position_metrics(str(exc))

        assessment = None
        if payload.selected_assessment_id is not None:
            assessment = (
                db.query(OptionThesisAssessment)
                .filter(OptionThesisAssessment.id == payload.selected_assessment_id)
                .first()
            )
            if assessment is None or assessment.position_id != position.id:
                raise HTTPException(status_code=422, detail="selected_assessment_id does not belong to this position.")
            mandate = (
                db.query(OptionPositionMandate)
                .filter(OptionPositionMandate.id == assessment.mandate_id)
                .first()
            )
            if mandate is None:
                mandate = get_or_create_mandate(db, position)
        else:
            mandate, assessment, _ = _generate_position_assessment(
                db,
                position,
                metrics,
                trigger="review_prefill",
            )

        source_event = (
            db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
            if position.source_event_id is not None
            else None
        )
        suggested_window = build_actionable_decision_window(
            position=position,
            mandate=mandate,
            source_event=source_event,
            verdict=assessment.proposed_verdict,
            urgency=assessment.urgency,
            contract_status=assessment.contract_status,
            as_of=date.today(),
        )
        suggested_window["continuation_condition"] = rebase_continuation_condition(
            assessment.continuation_condition,
            deadline=suggested_window["decision_deadline"],
            verdict=assessment.proposed_verdict,
        )
        defaults = _assessment_to_review_defaults(position, mandate, assessment, suggested_window)

        def chosen(field_name: str) -> object:
            value = getattr(payload, field_name)
            return defaults.get(field_name) if value is None else value

        resolved = {
            field_name: chosen(field_name)
            for field_name in (
                "trade_role",
                "original_thesis",
                "contract_thesis",
                "expected_path",
                "catalyst",
                "confirmation_condition",
                "invalidation_condition",
                "risk_budget",
                "evidence_since_last",
                "thesis_status",
                "fresh_entry_answer",
                "portfolio_fit",
                "data_quality_notes",
                "verdict",
                "target_contracts",
                "quality",
                "urgency",
                "confidence",
                "continuation_condition",
                "next_review_date",
                "decision_deadline",
                "decision_notes",
            )
        }
        choices = (
            ("trade_role", resolved["trade_role"], _REVIEW_TRADE_ROLES),
            ("thesis_status", resolved["thesis_status"], _REVIEW_THESIS_STATES),
            ("fresh_entry_answer", resolved["fresh_entry_answer"], _REVIEW_FRESH_ENTRY_ANSWERS),
            ("verdict", resolved["verdict"], _REVIEW_VERDICTS),
            ("quality", resolved["quality"], _REVIEW_QUALITY),
            ("urgency", resolved["urgency"], _REVIEW_URGENCY),
            ("confidence", resolved["confidence"], _REVIEW_CONFIDENCE),
        )
        for field_name, value, allowed in choices:
            if value not in allowed:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid {field_name}. Expected one of: {', '.join(sorted(allowed))}.",
                )

        target_contracts = int(resolved["target_contracts"])
        if target_contracts < 0:
            raise HTTPException(status_code=422, detail="target_contracts cannot be negative.")
        review_date = _parse_review_date(payload.review_date, "review_date") or date.today()
        next_review_date = _parse_review_date(str(resolved["next_review_date"] or ""), "next_review_date")
        decision_deadline = _parse_review_date(str(resolved["decision_deadline"] or ""), "decision_deadline")
        scheduling_anchor = max(review_date, date.today())
        resolved_verdict = str(resolved["verdict"])
        terminal_decision = resolved_verdict in {"close", "replacement_candidate"}
        if terminal_decision and payload.next_review_date is None:
            next_review_date = None
        if terminal_decision and payload.decision_deadline is None:
            decision_deadline = review_date
        if not terminal_decision and next_review_date is None:
            raise HTTPException(status_code=422, detail="next_review_date is required for an open-position decision.")
        if not terminal_decision and decision_deadline is None:
            raise HTTPException(status_code=422, detail="decision_deadline is required for an open-position decision.")
        if next_review_date is not None and next_review_date <= scheduling_anchor:
            raise HTTPException(status_code=422, detail="next_review_date must be after today and the review date.")
        if not terminal_decision and decision_deadline is not None and decision_deadline <= scheduling_anchor:
            raise HTTPException(status_code=422, detail="decision_deadline must be after today and the review date.")
        if terminal_decision and decision_deadline is not None and decision_deadline != review_date:
            raise HTTPException(status_code=422, detail="A close or replacement decision has zero recommended hold; use the review date as its deadline.")
        if next_review_date is not None and decision_deadline is not None and next_review_date > decision_deadline:
            raise HTTPException(status_code=422, detail="next_review_date cannot be after decision_deadline.")
        if not terminal_decision and decision_deadline is not None and decision_deadline > position.expiration:
            raise HTTPException(status_code=422, detail="decision_deadline cannot be after the contract expiration.")
        decision_override = (
            resolved["verdict"] != assessment.proposed_verdict
            or target_contracts != assessment.proposed_target_contracts
        )
        mandate_fields = (
            "trade_role",
            "original_thesis",
            "contract_thesis",
            "expected_path",
            "catalyst",
            "confirmation_condition",
            "invalidation_condition",
            "risk_budget",
        )
        mandate_override = any(
            getattr(payload, field_name) is not None
            and getattr(payload, field_name) != getattr(mandate, field_name)
            for field_name in mandate_fields
        )
        human_override = (
            "decision_and_mandate"
            if decision_override and mandate_override
            else "decision"
            if decision_override
            else "mandate"
            if mandate_override
            else "none"
        )
        decision_source = "human_override" if human_override != "none" else "human_confirmed_auto"
        snapshot = _position_review_snapshot(position, metrics)
        review = OptionPositionReview(
            position_id=position.id,
            supersedes_review_id=latest.id if latest else None,
            review_sequence=(latest.review_sequence + 1) if latest else 1,
            review_date=review_date,
            review_type="reassessment" if latest else "mandate",
            selected_assessment_id=assessment.id,
            decision_source=decision_source,
            human_override=human_override,
            override_reason=_clean_review_text(payload.override_reason),
            threshold_approval_status=payload.threshold_approval_status,
            symbol=position.symbol,
            expiration=position.expiration,
            strike=position.strike,
            option_type=position.option_type,
            contracts_snapshot=position.contracts,
            trade_role=str(resolved["trade_role"]),
            original_thesis=_clean_review_text(str(resolved["original_thesis"] or "")),
            contract_thesis=_clean_review_text(str(resolved["contract_thesis"] or "")),
            expected_path=_clean_review_text(str(resolved["expected_path"] or "")),
            catalyst=_clean_review_text(str(resolved["catalyst"] or "")),
            confirmation_condition=_clean_review_text(str(resolved["confirmation_condition"] or "")),
            invalidation_condition=_clean_review_text(str(resolved["invalidation_condition"] or "")),
            risk_budget=float(resolved["risk_budget"]) if resolved["risk_budget"] is not None else None,
            evidence_since_last=_clean_review_text(str(resolved["evidence_since_last"] or "")),
            thesis_status=str(resolved["thesis_status"]),
            fresh_entry_answer=str(resolved["fresh_entry_answer"]),
            portfolio_fit=_clean_review_text(str(resolved["portfolio_fit"] or "")),
            data_quality_notes=_clean_review_text(str(resolved["data_quality_notes"] or "")),
            verdict=str(resolved["verdict"]),
            target_contracts=target_contracts,
            quality=str(resolved["quality"]),
            urgency=str(resolved["urgency"]),
            confidence=str(resolved["confidence"]),
            continuation_condition=_clean_review_text(str(resolved["continuation_condition"] or "")),
            next_review_date=next_review_date,
            decision_deadline=decision_deadline,
            decision_notes=_clean_review_text(str(resolved["decision_notes"] or "")),
            **snapshot,
        )
        db.add(review)
        db.flush()
        confirmed_mandate = confirm_mandate_from_review(db, position, review)
        record_position_event(
            db,
            position_id=position.id,
            event_type="reviewed",
            related_review_id=review.id,
            related_assessment_id=assessment.id,
            quantity_before=position.contracts,
            quantity_after=target_contracts,
            total_cost_before=position.total_cost,
            total_cost_after=position.total_cost if target_contracts == position.contracts else None,
            details={
                "verdict": review.verdict,
                "decision_source": decision_source,
                "human_override": human_override,
                "order_submitted": False,
            },
        )
        db.commit()
        db.refresh(review)
        status = _position_review_status(review, position)
        set_secret_options_audit_change(
            http_request,
            object_type="position_review",
            object_id=review.id,
            before=_serialize_position_review(latest) if latest is not None else None,
            after=_serialize_position_review(review),
        )
        return _json_safe(
            {
                "review": _serialize_position_review(review),
                "assessment": serialize_assessment(assessment),
                "mandate": serialize_mandate(confirmed_mandate),
                "status": status,
                "recorded_with_warnings": bool(status["warnings"] or status["addition_blockers"]),
                "automated_execution_enabled": False,
            }
        )


@router.get("/greeks/{position_id}")
def get_position_greeks(
    position_id: int,
    price_range_pct: float = Query(0.3, ge=0.05, le=1.0),
    time_range_days: int = Query(60, ge=5, le=365),
):
    """
    Get detailed Greeks curves for a position.
    
    Returns:
        - price_curve: delta and gamma vs underlying price
        - theta_curve: theta vs days to expiry
        - current_greeks: Greeks at current spot price
        - model_info: Information about the model and parameters used
    """
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        try:
            metrics = _compute_position_metrics(position)
        except Exception as exc:
            metrics = _empty_position_metrics(str(exc))
        spot = metrics["market"].get("current_price") or position.underlying_reference or position.underlying_at_entry
        volatility = metrics.get("volatility")
        dte = metrics.get("dte") or 0
        
        if not spot or not volatility or dte <= 0:
            return {
                "price_curve": [],
                "theta_curve": [],
                "current_greeks": None,
                "model_info": {
                    "error": metrics.get("error") or "Insufficient data for Greeks calculation",
                    "spot_price": spot,
                    "volatility": volatility,
                    "dte": dte,
                }
            }

        T = dte / 365.0
        
        # Generate price curves (delta and gamma)
        price_curve = generate_delta_gamma_curve(
            K=position.strike,
            T=T,
            r=RISK_FREE_RATE,
            sigma=volatility,
            option_type=position.option_type,
            current_price=spot,
            price_range_pct=price_range_pct,
            num_points=51
        )
        
        # Generate theta curve (from current DTE down to 1 day)
        max_days = min(time_range_days, max(dte, 1))
        theta_curve = generate_theta_curve(
            S=spot,
            K=position.strike,
            r=RISK_FREE_RATE,
            sigma=volatility,
            option_type=position.option_type,
            current_dte=max_days,
            min_days=1
        )
        
        # Current Greeks
        current_greeks = metrics.get("greeks")

        return _json_safe({
            "price_curve": price_curve,
            "theta_curve": theta_curve,
            "current_greeks": current_greeks,
            "model_info": {
                "model": "Black-Scholes (European)",
                "risk_free_rate": RISK_FREE_RATE,
                "volatility": volatility,
                "volatility_source": metrics.get("volatility_source"),
                "spot_price": spot,
                "dte": dte,
                "units": {
                    "delta": "per 1 share",
                    "gamma": "per $1 move per share",
                    "theta": "per day per contract (100 shares)",
                    "vega": "per 1 vol point per contract"
                }
            }
        })


@router.delete("/positions/{position_id}")
def close_position(
    position_id: int,
    http_request: Request,
    payload: ClosePositionRequest,
):
    """
    Close a position by moving it to closed_position table and deleting from active positions.
    Calculates P/L and tracks historical performance.
    """
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        prior_position = _serialize_position(position)
        
        # Calculate P/L
        total_proceeds = payload.exit_price * position.contracts * 100
        dollar_pnl = total_proceeds - position.total_cost
        percent_pnl = (dollar_pnl / position.total_cost) * 100 if position.total_cost else 0
        close_date = _parse_date(payload.close_date) if payload.close_date else date.today()
        duplicate = _find_duplicate_closed_position(
            db,
            trade_date=position.trade_date,
            close_date=close_date,
            account=position.account,
            contracts=position.contracts,
            symbol=position.symbol,
            expiration=position.expiration,
            strike=position.strike,
            option_type=position.option_type,
            fill_price=position.fill_price,
            exit_price=payload.exit_price,
            total_cost=position.total_cost,
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate closed position already exists as trade #{duplicate.id}.",
            )
        
        # Get current underlying price
        market = _market_data_for_symbol(get_market_data_provider(), position.symbol)
        underlying_at_exit = market.get("current_price")
        
        # Create closed position record
        closed = ClosedPosition(
            source_position_id=position.id,
            source_position_snapshot_json=json_dumps(prior_position),
            symbol=position.symbol,
            option_type=position.option_type,
            strike=position.strike,
            expiration=position.expiration,
            contracts=position.contracts,
            trade_date=position.trade_date,
            fill_price=position.fill_price,
            total_cost=position.total_cost,
            underlying_at_entry=position.underlying_at_entry,
            close_date=close_date,
            exit_price=payload.exit_price,
            total_proceeds=total_proceeds,
            underlying_at_exit=underlying_at_exit,
            dollar_pnl=dollar_pnl,
            percent_pnl=percent_pnl,
            account=position.account,
            notes=payload.notes,
            source_event_id=position.source_event_id,
            source_triggered_at=position.source_triggered_at,
            source_match_method=position.source_match_method,
            source_match_confidence=position.source_match_confidence,
            source_match_notes=position.source_match_notes,
        )
        db.add(closed)
        db.flush()
        record_position_event(
            db,
            position_id=position.id,
            closed_position_id=closed.id,
            event_type="closed",
            quantity_before=position.contracts,
            quantity_after=0,
            execution_price=payload.exit_price,
            total_cost_before=position.total_cost,
            total_cost_after=0.0,
            details={"close_date": close_date.isoformat(), "notes": payload.notes},
        )
        trade_outcome = create_trade_outcome(db, closed)
        skip_trade_sell_reminder(db, position.id, "Position was closed before the reminder fired.")
        
        # Delete active position
        db.delete(position)
        db.commit()
        set_secret_options_audit_change(
            http_request,
            object_type="position",
            object_id=position_id,
            before=prior_position,
            after={
                "id": position_id,
                "closed_position_id": closed.id,
                "status": "closed",
            },
        )
        
        return _json_safe({
            "message": "Position closed successfully",
            "closed_position_id": closed.id,
            "symbol": closed.symbol,
            "learning_outcome": serialize_trade_outcome(trade_outcome),
            "pnl": {
                "dollar": dollar_pnl,
                "percent": percent_pnl,
                "total_proceeds": total_proceeds
            }
        })


@router.post("/closed-positions/{closed_position_id}/restore")
def restore_closed_position(closed_position_id: int, http_request: Request):
    """Reverse an accidental close while preserving an append-only lifecycle trail."""
    with get_db_session() as db:
        closed = (
            db.query(ClosedPosition)
            .filter(ClosedPosition.id == closed_position_id)
            .with_for_update()
            .first()
        )
        if not closed:
            raise HTTPException(status_code=404, detail="Closed position not found")
        if closed.source_position_id is None:
            raise HTTPException(
                status_code=409,
                detail="This trade was added directly to P/L history and has no open position to restore.",
            )
        if (
            db.query(OptionPosition)
            .filter(OptionPosition.id == closed.source_position_id)
            .first()
            is not None
        ):
            raise HTTPException(
                status_code=409,
                detail=f"Open position #{closed.source_position_id} already exists.",
            )

        prior_closed = _serialize_closed_position(closed, None)
        snapshot = json_loads(closed.source_position_snapshot_json, {})
        if not isinstance(snapshot, dict):
            snapshot = {}

        def snapshot_float(field: str, fallback: Optional[float]) -> Optional[float]:
            value = snapshot.get(field)
            return float(value) if _is_finite_number(value) else fallback

        def snapshot_int(field: str, fallback: Optional[int]) -> Optional[int]:
            value = snapshot_float(field, None)
            return int(value) if value is not None else fallback

        def snapshot_date(field: str, fallback: date) -> date:
            value = snapshot.get(field)
            if isinstance(value, str):
                try:
                    return date.fromisoformat(value)
                except ValueError:
                    pass
            return fallback

        def snapshot_datetime(
            field: str,
            fallback: Optional[datetime],
        ) -> Optional[datetime]:
            value = snapshot.get(field)
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value)
                except ValueError:
                    pass
            return fallback

        trade_date = snapshot_date("trade_date", closed.trade_date)
        expiration = snapshot_date("expiration", closed.expiration)
        contracts = snapshot_int("contracts", closed.contracts) or closed.contracts
        symbol = str(snapshot.get("symbol") or closed.symbol).strip().upper()
        option_type = str(snapshot.get("option_type") or closed.option_type).strip().lower()
        strike = snapshot_float("strike", closed.strike) or closed.strike
        fill_price = snapshot_float("fill_price", closed.fill_price) or closed.fill_price
        total_cost = snapshot_float("total_cost", closed.total_cost)
        if total_cost is None:
            total_cost = closed.total_cost
        account = snapshot.get("account") if "account" in snapshot else closed.account
        action = snapshot.get("action") if "action" in snapshot else "Buy to Open"

        duplicate = _find_duplicate_open_position(
            db,
            trade_date=trade_date,
            account=account,
            action=action,
            contracts=contracts,
            symbol=symbol,
            expiration=expiration,
            strike=strike,
            option_type=option_type,
            fill_price=fill_price,
            total_cost=total_cost,
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"Matching open position already exists as trade #{duplicate.id}.",
            )

        restored = OptionPosition(
            id=closed.source_position_id,
            trade_date=trade_date,
            account=account,
            action=action,
            contracts=contracts,
            symbol=symbol,
            expiration=expiration,
            strike=strike,
            option_type=option_type,
            fill_price=fill_price,
            total_cost=total_cost,
            underlying_at_entry=snapshot_float(
                "underlying_at_entry",
                closed.underlying_at_entry,
            ),
            estimated_delta=snapshot_float("estimated_delta", None),
            shares_equivalent=snapshot_int("shares_equivalent", None),
            dte_at_entry=snapshot_int(
                "dte_at_entry",
                (expiration - trade_date).days,
            ),
            underlying_reference=snapshot_float(
                "underlying_reference",
                closed.underlying_at_entry,
            ),
            source_event_id=snapshot_int("source_event_id", closed.source_event_id),
            source_triggered_at=snapshot_datetime(
                "source_triggered_at",
                closed.source_triggered_at,
            ),
            source_match_method=(
                snapshot.get("source_match_method")
                if "source_match_method" in snapshot
                else closed.source_match_method
            ),
            source_match_confidence=snapshot_float(
                "source_match_confidence",
                closed.source_match_confidence,
            ),
            source_match_notes=(
                snapshot.get("source_match_notes")
                if "source_match_notes" in snapshot
                else closed.source_match_notes
            ),
        )
        db.add(restored)
        db.flush()

        trade_outcomes = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id == closed.id)
            .all()
        )
        for outcome in trade_outcomes:
            outcome.outcome_status = "reversed"
        decision_outcomes = (
            db.query(OptionDecisionOutcome)
            .filter(OptionDecisionOutcome.closed_position_id == closed.id)
            .all()
        )
        for outcome in decision_outcomes:
            outcome.closed_position_id = None

        record_position_event(
            db,
            position_id=restored.id,
            closed_position_id=closed.id,
            event_type="close_reversed",
            quantity_before=0,
            quantity_after=restored.contracts,
            execution_price=closed.exit_price,
            total_cost_before=0.0,
            total_cost_after=restored.total_cost,
            details={
                "reason": "operator_undo",
                "restored_from_closed_position_id": closed.id,
                "learning_outcomes_reversed": len(trade_outcomes),
            },
        )
        sync_trade_sell_reminder(db, restored)
        db.delete(closed)
        db.commit()
        db.refresh(restored)
        serialized = _serialize_position(
            restored,
            _position_evaluation_window(db, restored),
        )
        set_secret_options_audit_change(
            http_request,
            object_type="position",
            object_id=restored.id,
            before=prior_closed,
            after={
                **serialized,
                "status": "restored",
                "closed_position_id": closed_position_id,
                "learning_outcomes_reversed": len(trade_outcomes),
            },
        )
        return _json_safe(
            {
                "message": f"{restored.symbol} was restored to open positions.",
                "position": serialized,
                "closed_position_id": closed_position_id,
                "learning_outcomes_reversed": len(trade_outcomes),
            }
        )


@router.get("/closed-positions")
def get_closed_positions(
    limit: int = Query(100, ge=1, le=500),
    symbol: Optional[str] = None
):
    """
    Get closed positions history with P/L information.
    """
    with get_db_session() as db:
        query = db.query(ClosedPosition).order_by(ClosedPosition.close_date.desc())
        
        if symbol:
            query = query.filter(ClosedPosition.symbol == symbol.upper())
        
        closed_positions = query.limit(limit).all()
        event_ids = sorted(
            {
                int(pos.source_event_id)
                for pos in closed_positions
                if pos.source_event_id is not None
            }
        )
        source_events = (
            db.query(OptionAlertEvent).filter(OptionAlertEvent.id.in_(event_ids)).all()
            if event_ids
            else []
        )
        source_events_by_id = {event.id: event for event in source_events}
        closed_ids = [position.id for position in closed_positions]
        outcome_rows = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id.in_(closed_ids))
            .order_by(
                OptionTradeOutcome.closed_position_id.asc(),
                OptionTradeOutcome.outcome_version.desc(),
                OptionTradeOutcome.id.desc(),
            )
            .all()
            if closed_ids
            else []
        )
        outcomes_by_closed_id: Dict[int, OptionTradeOutcome] = {}
        for outcome in outcome_rows:
            outcomes_by_closed_id.setdefault(outcome.closed_position_id, outcome)
        
        results = []
        for pos in closed_positions:
            serialized = _serialize_closed_position(pos, source_events_by_id.get(pos.source_event_id))
            serialized["learning_outcome"] = serialize_trade_outcome(outcomes_by_closed_id.get(pos.id))
            results.append(serialized)
        
        # Calculate summary stats
        total_pnl = sum(pos.dollar_pnl for pos in closed_positions)
        winning_trades = sum(1 for pos in closed_positions if pos.dollar_pnl > 0)
        total_trades = len(closed_positions)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        attributed = [pos for pos in closed_positions if pos.source_event_id is not None]
        attributed_total = len(attributed)
        attributed_winners = sum(1 for pos in attributed if pos.dollar_pnl > 0)
        attributed_pnl = sum(pos.dollar_pnl for pos in attributed)
        attributed_win_rate = (attributed_winners / attributed_total * 100) if attributed_total else 0
        
        return _json_safe({
            "closed_positions": results,
            "summary": {
                "total_pnl": total_pnl,
                "total_trades": total_trades,
                "winning_trades": winning_trades,
                "losing_trades": total_trades - winning_trades,
                "win_rate": win_rate,
                "attributed_trades": attributed_total,
                "attributed_winning_trades": attributed_winners,
                "attributed_total_pnl": attributed_pnl,
                "attributed_win_rate": attributed_win_rate,
            }
        })


@router.get("/closed-positions/{closed_position_id}/learning")
def get_closed_position_learning(closed_position_id: int):
    with get_db_session() as db:
        closed = db.query(ClosedPosition).filter(ClosedPosition.id == closed_position_id).first()
        if not closed:
            raise HTTPException(status_code=404, detail="Closed position not found")
        outcomes = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id == closed_position_id)
            .order_by(OptionTradeOutcome.outcome_version.desc(), OptionTradeOutcome.id.desc())
            .all()
        )
        decision_rows = []
        if closed.source_position_id is not None:
            decision_rows = (
                db.query(OptionDecisionOutcome)
                .filter(OptionDecisionOutcome.position_id == closed.source_position_id)
                .order_by(OptionDecisionOutcome.target_date.desc(), OptionDecisionOutcome.id.desc())
                .all()
            )
        return _json_safe(
            {
                "closed_position_id": closed_position_id,
                "source_position_id": closed.source_position_id,
                "latest_trade_outcome": serialize_trade_outcome(outcomes[0]) if outcomes else None,
                "trade_outcome_history": [serialize_trade_outcome(row) for row in outcomes],
                "decision_outcomes": [serialize_decision_outcome(row) for row in decision_rows],
            }
        )


@router.post("/closed-positions/{closed_position_id}/learning-feedback")
def create_closed_position_learning_feedback(
    closed_position_id: int,
    http_request: Request,
    payload: OptionTradeOutcomeFeedback,
):
    allowed = {
        "process_quality": {"good_process", "mixed_process", "weak_process"},
        "primary_lesson": {
            "contract_selection",
            "review_discipline",
            "position_sizing",
            "timing",
            "portfolio_concentration",
            "entry_execution",
            "exit_discipline",
            "unpredictable_event",
            "thesis_selection",
            "sound_decision_unfavorable_outcome",
            "no_single_dominant_error",
        },
        "thesis_result": {"supported", "not_supported", "inconclusive"},
        "contract_result": {
            "worked",
            "underlying_right_contract_wrong",
            "timing_or_contract_unresolved",
            "failed_with_thesis",
        },
        "timing_result": {"adequate", "too_slow_for_contract", "late_exit", "unclear"},
        "sizing_result": {"over_recorded_budget", "within_recorded_budget", "budget_unknown"},
        "portfolio_result": {"concentration_present", "acceptable", "unknown"},
        "entry_execution_result": {"good", "poor", "unverified"},
        "exit_discipline_result": {"aligned", "late", "different_from_plan", "unreviewed"},
        "event_result": {"catalyst_worked", "catalyst_failed_or_unconfirmed", "not_catalyst", "unknown"},
        "review_discipline": {"unreviewed", "closed_after_deadline", "reviewed_before_close"},
    }
    overrides = {
        key: value
        for key, value in payload.model_dump().items()
        if value is not None
    }
    if not overrides:
        raise HTTPException(status_code=422, detail="Provide at least one learning classification.")
    for key, value in overrides.items():
        if value not in allowed[key]:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid {key}. Expected one of: {', '.join(sorted(allowed[key]))}.",
            )
    with get_db_session() as db:
        closed = db.query(ClosedPosition).filter(ClosedPosition.id == closed_position_id).first()
        if not closed:
            raise HTTPException(status_code=404, detail="Closed position not found")
        prior_outcome = (
            db.query(OptionTradeOutcome)
            .filter(OptionTradeOutcome.closed_position_id == closed_position_id)
            .order_by(OptionTradeOutcome.outcome_version.desc(), OptionTradeOutcome.id.desc())
            .first()
        )
        prior_serialized = serialize_trade_outcome(prior_outcome) if prior_outcome else None
        outcome = create_trade_outcome(db, closed, force=True, human_overrides=overrides)
        db.commit()
        set_secret_options_audit_change(
            http_request,
            object_type="trade_outcome",
            object_id=outcome.id,
            before=prior_serialized,
            after=serialize_trade_outcome(outcome),
        )
        return _json_safe(
            {
                "learning_outcome": serialize_trade_outcome(outcome),
                "previous_versions_preserved": True,
            }
        )


@router.put("/closed-positions/{closed_position_id}")
def update_closed_position(
    closed_position_id: int,
    http_request: Request,
    payload: ClosedPositionUpdate,
):
    with get_db_session() as db:
        position = db.query(ClosedPosition).filter(ClosedPosition.id == closed_position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Closed position not found")
        prior_position = _serialize_closed_position(position, None)

        trade_date = _parse_date(payload.trade_date)
        close_date = _parse_date(payload.close_date)
        expiration = _parse_date(payload.expiration)
        symbol = payload.symbol.upper()
        option_type = payload.option_type.lower()
        duplicate = _find_duplicate_closed_position(
            db,
            trade_date=trade_date,
            close_date=close_date,
            account=payload.account,
            contracts=payload.contracts,
            symbol=symbol,
            expiration=expiration,
            strike=payload.strike,
            option_type=option_type,
            fill_price=payload.fill_price,
            exit_price=payload.exit_price,
            total_cost=payload.total_cost,
            exclude_id=closed_position_id,
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate closed position already exists as trade #{duplicate.id}.",
            )

        total_proceeds = payload.exit_price * payload.contracts * 100
        dollar_pnl = total_proceeds - payload.total_cost
        percent_pnl = (dollar_pnl / payload.total_cost) * 100 if payload.total_cost else 0

        position.trade_date = trade_date
        position.close_date = close_date
        position.account = payload.account
        position.contracts = payload.contracts
        position.symbol = symbol
        position.expiration = expiration
        position.strike = payload.strike
        position.option_type = option_type
        position.fill_price = payload.fill_price
        position.exit_price = payload.exit_price
        position.total_cost = payload.total_cost
        position.total_proceeds = total_proceeds
        position.dollar_pnl = dollar_pnl
        position.percent_pnl = percent_pnl
        position.underlying_at_entry = payload.underlying_at_entry
        position.underlying_at_exit = payload.underlying_at_exit
        position.notes = payload.notes

        learning_outcome = create_trade_outcome(db, position, force=True)
        db.commit()
        db.refresh(position)
        source_event = (
            db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
            if position.source_event_id is not None
            else None
        )
        serialized = _serialize_closed_position(position, source_event)
        serialized["learning_outcome"] = serialize_trade_outcome(learning_outcome)
        set_secret_options_audit_change(
            http_request,
            object_type="closed_position",
            object_id=position.id,
            before=prior_position,
            after=serialized,
        )
        return _json_safe({"closed_position": serialized})


@router.delete("/closed-positions/{closed_position_id}")
def delete_closed_position(closed_position_id: int, http_request: Request):
    with get_db_session() as db:
        position = db.query(ClosedPosition).filter(ClosedPosition.id == closed_position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Closed position not found")
        prior_position = _serialize_closed_position(position, None)

        db.delete(position)
        db.commit()
        set_secret_options_audit_change(
            http_request,
            object_type="closed_position",
            object_id=closed_position_id,
            before=prior_position,
            after={"id": closed_position_id, "status": "deleted"},
        )
        return {"message": "Closed position deleted successfully"}


@router.post("/attribution/backfill")
def backfill_signal_attribution(
    http_request: Request,
    limit: int = Query(1000, ge=1, le=10000),
):
    """
    Backfill signal attribution for existing open/closed positions that do not
    yet have a linked sweep event.
    """
    with get_db_session() as db:
        open_positions = (
            db.query(OptionPosition)
            .filter(OptionPosition.source_event_id.is_(None))
            .order_by(OptionPosition.trade_date.desc())
            .limit(limit)
            .all()
        )
        closed_positions = (
            db.query(ClosedPosition)
            .filter(ClosedPosition.source_event_id.is_(None))
            .order_by(ClosedPosition.trade_date.desc())
            .limit(limit)
            .all()
        )

        open_linked = 0
        closed_linked = 0

        for position in open_positions:
            attribution = _resolve_signal_attribution(db, position.symbol, position.trade_date)
            position.source_event_id = attribution["source_event_id"]
            position.source_triggered_at = attribution["source_triggered_at"]
            position.source_match_method = attribution["source_match_method"]
            position.source_match_confidence = attribution["source_match_confidence"]
            position.source_match_notes = attribution["source_match_notes"]
            if position.source_event_id is not None:
                open_linked += 1

        for position in closed_positions:
            attribution = _resolve_signal_attribution(db, position.symbol, position.trade_date)
            position.source_event_id = attribution["source_event_id"]
            position.source_triggered_at = attribution["source_triggered_at"]
            position.source_match_method = attribution["source_match_method"]
            position.source_match_confidence = attribution["source_match_confidence"]
            position.source_match_notes = attribution["source_match_notes"]
            if position.source_event_id is not None:
                closed_linked += 1

        db.commit()
        response = {
            "open_positions_checked": len(open_positions),
            "open_positions_linked": open_linked,
            "closed_positions_checked": len(closed_positions),
            "closed_positions_linked": closed_linked,
        }
        set_secret_options_audit_change(
            http_request,
            object_type="signal_attribution_batch",
            object_id="backfill",
            after={**response, "limit": limit},
        )
        return _json_safe(response)


def _apply_event_opportunity_fields(event: OptionAlertEvent, force: bool = False) -> bool:
    fields = opportunity_fields_from_event(event)
    changed = False
    for key, value in fields.items():
        if force or getattr(event, key, None) is None:
            setattr(event, key, value)
            changed = True
    return changed


def _selected_dte_for_review(event: OptionAlertEvent) -> Optional[int]:
    if isinstance(event.selected_dte, int) and event.selected_dte > 0:
        return event.selected_dte
    expiry = _parse_iso_date(event.selected_expiry)
    if expiry is None:
        return None
    anchor = event.triggered_at.date() if event.triggered_at else date.today()
    dte = (expiry - anchor).days
    return dte if dte > 0 else None


def _computed_review_window_for_event(event: OptionAlertEvent) -> Optional[ReviewWindow]:
    recipe = _extract_training_recipe(event.message)
    base_hold_days = recipe.get("hold_days")
    if not isinstance(base_hold_days, int) or base_hold_days <= 0:
        return None
    trend_return = _extract_training_return(_strip_ansi(event.message))
    return compute_review_window(
        base_hold_days=base_hold_days,
        iv30=event.iv30,
        hv30=event.hv30,
        iv_percentile=event.iv_percentile,
        avg_edr=event.avg_edr,
        trend_return=trend_return,
        selected_dte=_selected_dte_for_review(event),
    )


def _apply_review_window_to_event(event: OptionAlertEvent, review_window: ReviewWindow, force: bool = False) -> bool:
    changed = False
    updates = {
        "review_min_hold_days": review_window.min_hold_days,
        "review_max_hold_days": review_window.max_hold_days,
        "review_window_basis": review_window.basis,
    }
    for key, value in updates.items():
        if force or getattr(event, key, None) != value:
            setattr(event, key, value)
            changed = True
    return changed


def _linked_review_backfill_event_ids(db: Any, cutoff_day: date, limit: int) -> list[int]:
    event_ids: set[int] = set()
    for (event_id,) in (
        db.query(OptionPosition.source_event_id)
        .filter(
            OptionPosition.source_event_id.isnot(None),
            OptionPosition.trade_date >= cutoff_day,
        )
        .all()
    ):
        event_ids.add(int(event_id))
    for (event_id,) in (
        db.query(ClosedPosition.source_event_id)
        .filter(
            ClosedPosition.source_event_id.isnot(None),
            ClosedPosition.trade_date >= cutoff_day,
        )
        .all()
    ):
        event_ids.add(int(event_id))
    for (event_id,) in (
        db.query(OptionTrainingOutcome.event_id)
        .filter(OptionTrainingOutcome.triggered_at >= datetime.combine(cutoff_day, time.min))
        .all()
    ):
        event_ids.add(int(event_id))
    return sorted(event_ids)[:limit]


def _backfill_review_windows(
    *,
    lookback_days: int = 3650,
    limit: int = 5000,
    linked_only: bool = True,
    force: bool = False,
    recompute_training: bool = True,
    dry_run: bool = False,
) -> Dict[str, object]:
    cutoff_day = date.today() - timedelta(days=lookback_days)
    cutoff_dt = datetime.combine(cutoff_day, time.min)
    with get_db_session() as db:
        if linked_only:
            event_ids = _linked_review_backfill_event_ids(db, cutoff_day, limit)
            events = (
                db.query(OptionAlertEvent)
                .filter(OptionAlertEvent.id.in_(event_ids))
                .order_by(OptionAlertEvent.triggered_at.desc(), OptionAlertEvent.id.desc())
                .all()
                if event_ids
                else []
            )
        else:
            events = (
                db.query(OptionAlertEvent)
                .filter(OptionAlertEvent.triggered_at >= cutoff_dt)
                .order_by(OptionAlertEvent.triggered_at.desc(), OptionAlertEvent.id.desc())
                .limit(limit)
                .all()
            )

        event_by_id = {int(event.id): event for event in events}
        updated_events = 0
        skipped_no_recipe = 0
        samples: list[Dict[str, object]] = []
        for event in events:
            review_window = _computed_review_window_for_event(event)
            if review_window is None:
                skipped_no_recipe += 1
                continue
            before = {
                "min": event.review_min_hold_days,
                "max": event.review_max_hold_days,
            }
            changed = force or before["min"] != review_window.min_hold_days or before["max"] != review_window.max_hold_days
            if changed:
                updated_events += 1
                if not dry_run:
                    _apply_review_window_to_event(event, review_window, force=True)
                    db.add(event)
                if len(samples) < 20:
                    samples.append(
                        {
                            "event_id": event.id,
                            "symbol": event.symbol,
                            "before": before,
                            "after": {
                                "min": review_window.min_hold_days,
                                "max": review_window.max_hold_days,
                                "basis": review_window.basis,
                            },
                        }
                    )

        reminder_updates = 0
        event_id_list = list(event_by_id.keys())
        open_positions = (
            db.query(OptionPosition)
            .filter(
                OptionPosition.source_event_id.in_(event_id_list),
                OptionPosition.source_event_id.isnot(None),
            )
            .all()
            if event_by_id
            else []
        )
        if not dry_run:
            for position in open_positions:
                before = (
                    db.query(OptionTradeReminder)
                    .filter(OptionTradeReminder.position_id == position.id)
                    .first()
                )
                before_pair = (before.min_hold_days, before.hold_days) if before else None
                reminder = sync_trade_sell_reminder(db, position)
                after_pair = (reminder.min_hold_days, reminder.hold_days) if reminder else None
                if before_pair != after_pair:
                    reminder_updates += 1

        linked_trades_by_event_id = _collect_linked_trades_by_event_id(db, cutoff_day)
        training_rows = (
            db.query(OptionTrainingOutcome)
            .filter(OptionTrainingOutcome.event_id.in_(event_id_list))
            .all()
            if event_by_id
            else []
        )
        recomputed_training = 0
        stamped_training = 0
        failed_training = 0
        if not dry_run:
            for row in training_rows:
                event = event_by_id.get(int(row.event_id))
                if event is None:
                    continue
                if recompute_training:
                    linked_trade = _best_linked_trade_for_event(event, linked_trades_by_event_id.get(int(event.id), []))
                    try:
                        outcome = (
                            _compute_training_outcome_for_linked_event(event, linked_trade)
                            if linked_trade
                            else _compute_training_outcome_with_cache(event)
                        )
                        if outcome:
                            _apply_training_outcome_payload(row, event, outcome)
                            db.add(row)
                            recomputed_training += 1
                        else:
                            failed_training += 1
                    except Exception as exc:
                        _mark_training_outcome_error(row, event, exc)
                        db.add(row)
                        failed_training += 1
                else:
                    row.review_min_hold_days = event.review_min_hold_days
                    row.review_max_hold_days = event.review_max_hold_days
                    db.add(row)
                    stamped_training += 1

            db.commit()

    return {
        "checked_events": len(events),
        "updated_events": updated_events,
        "skipped_no_recipe": skipped_no_recipe,
        "open_positions_checked": len(open_positions),
        "reminders_updated": reminder_updates,
        "training_rows_checked": len(training_rows),
        "training_rows_recomputed": recomputed_training,
        "training_rows_stamped": stamped_training,
        "training_rows_failed": failed_training,
        "lookback_days": lookback_days,
        "limit": limit,
        "linked_only": linked_only,
        "force": force,
        "recompute_training": recompute_training,
        "dry_run": dry_run,
        "samples": samples,
    }


def _trade_outcome_stats(rows: list[Dict[str, object]]) -> Dict[str, object]:
    count = len(rows)
    pnl_values = [
        float(row["dollar_pnl"])
        for row in rows
        if row.get("dollar_pnl") is not None and _is_finite_number(row.get("dollar_pnl"))
    ]
    pct_values = [
        float(row["percent_pnl"])
        for row in rows
        if row.get("percent_pnl") is not None and _is_finite_number(row.get("percent_pnl"))
    ]
    winners = [value for value in pnl_values if value > 0]
    return {
        "count": count,
        "total_pnl": round(sum(pnl_values), 2) if pnl_values else 0.0,
        "avg_pnl": round(sum(pnl_values) / len(pnl_values), 2) if pnl_values else None,
        "avg_percent_pnl": round(sum(pct_values) / len(pct_values), 2) if pct_values else None,
        "win_rate_pct": round(len(winners) / len(pnl_values) * 100.0, 2) if pnl_values else None,
    }


@router.post("/opportunity-scores/backfill")
def backfill_opportunity_scores(
    http_request: Request,
    lookback_days: int = Query(3650, ge=30, le=3650),
    limit: int = Query(5000, ge=1, le=20000),
    force: bool = Query(False),
):
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    with get_db_session() as db:
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= cutoff)
            .order_by(OptionAlertEvent.triggered_at.desc())
            .limit(limit)
            .all()
        )
        updated = 0
        for event in events:
            if _apply_event_opportunity_fields(event, force=force):
                updated += 1
                db.add(event)
        db.commit()
    response = {
        "checked": len(events),
        "updated": updated,
        "lookback_days": lookback_days,
        "force": force,
        "model_version": OPPORTUNITY_MODEL_VERSION,
    }
    set_secret_options_audit_change(
        http_request,
        object_type="opportunity_score_batch",
        object_id="backfill",
        after={**response, "limit": limit},
    )
    return _json_safe(response)


@router.post("/review-windows/backfill")
def backfill_review_windows(
    http_request: Request,
    lookback_days: int = Query(3650, ge=30, le=3650),
    limit: int = Query(5000, ge=1, le=20000),
    linked_only: bool = Query(True),
    force: bool = Query(False),
    recompute_training: bool = Query(True),
    dry_run: bool = Query(False),
):
    """
    Backfill computed min/max review windows onto historical sweep events, then
    refresh linked reminders and evaluated training outcomes from those windows.
    """
    response = _backfill_review_windows(
        lookback_days=lookback_days,
        limit=limit,
        linked_only=linked_only,
        force=force,
        recompute_training=recompute_training,
        dry_run=dry_run,
    )
    set_secret_options_audit_change(
        http_request,
        object_type="review_window_batch",
        object_id="backfill",
        after=response,
    )
    return _json_safe(response)


@router.get("/opportunity-backtest")
def get_opportunity_backtest(
    lookback_days: int = Query(1825, ge=30, le=3650),
    threshold: float = Query(50.0, ge=0, le=100),
    limit: int = Query(1000, ge=1, le=5000),
):
    cutoff_day = date.today() - timedelta(days=lookback_days)
    with get_db_session() as db:
        closed_positions = (
            db.query(ClosedPosition)
            .filter(ClosedPosition.close_date >= cutoff_day)
            .order_by(ClosedPosition.close_date.desc(), ClosedPosition.id.desc())
            .limit(limit)
            .all()
        )
        event_ids = sorted(
            {
                int(position.source_event_id)
                for position in closed_positions
                if position.source_event_id is not None
            }
        )
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.id.in_(event_ids))
            .all()
            if event_ids
            else []
        )
        events_by_id = {event.id: event for event in events}

    rows: list[Dict[str, object]] = []
    unscored = 0
    for position in closed_positions:
        event = events_by_id.get(position.source_event_id)
        if event is None:
            unscored += 1
            continue
        score = _score_payload_for_event(event)
        score_value = float(score.get("base_score") or 0.0)
        selected = score_value >= threshold
        rows.append(
            {
                "closed_position_id": position.id,
                "event_id": event.id,
                "symbol": position.symbol,
                "option_type": position.option_type,
                "trade_date": position.trade_date.isoformat(),
                "close_date": position.close_date.isoformat(),
                "dollar_pnl": position.dollar_pnl,
                "percent_pnl": position.percent_pnl,
                "score": round(score_value, 2),
                "rank_score": score.get("rank_score"),
                "grade": score.get("grade"),
                "selected_by_model": selected,
                "components": score.get("components"),
            }
        )

    selected_rows = [row for row in rows if row.get("selected_by_model")]
    excluded_rows = [row for row in rows if not row.get("selected_by_model")]
    all_stats = _trade_outcome_stats(rows)
    selected_stats = _trade_outcome_stats(selected_rows)
    excluded_stats = _trade_outcome_stats(excluded_rows)
    avoided_loss = -sum(
        float(row["dollar_pnl"])
        for row in excluded_rows
        if row.get("dollar_pnl") is not None and float(row["dollar_pnl"]) < 0
    )
    left_on_table = sum(
        float(row["dollar_pnl"])
        for row in excluded_rows
        if row.get("dollar_pnl") is not None and float(row["dollar_pnl"]) > 0
    )
    grade_buckets: Dict[str, list[Dict[str, object]]] = {}
    for row in rows:
        grade_buckets.setdefault(str(row.get("grade") or "n/a"), []).append(row)

    return _json_safe(
        {
            "threshold": threshold,
            "lookback_days": lookback_days,
            "model_version": OPPORTUNITY_MODEL_VERSION,
            "summary": {
                "closed_positions_checked": len(closed_positions),
                "scored_trades": len(rows),
                "unscored_trades": unscored,
                "all_trades": all_stats,
                "model_selected": selected_stats,
                "model_excluded": excluded_stats,
                "avg_percent_delta_vs_all": (
                    round(float(selected_stats["avg_percent_pnl"]) - float(all_stats["avg_percent_pnl"]), 2)
                    if selected_stats.get("avg_percent_pnl") is not None
                    and all_stats.get("avg_percent_pnl") is not None
                    else None
                ),
                "avoided_loss_from_excluded": round(avoided_loss, 2),
                "excluded_winners_left_on_table": round(left_on_table, 2),
                "grade_buckets": {
                    grade: _trade_outcome_stats(bucket_rows)
                    for grade, bucket_rows in sorted(grade_buckets.items())
                },
            },
            "rows": sorted(rows, key=lambda row: (float(row["score"]), row["close_date"]), reverse=True)[:200],
        }
    )


@router.get("/training-outcomes")
def get_training_outcomes(
    lookback_days: int = Query(365, ge=30, le=1825),
    limit: int = Query(200, ge=1, le=1000),
    include_green_marker: bool = Query(True),
    include_linked: bool = Query(True),
):
    """
    Evaluate exceptional scanner training examples by holding for the
    suggested horizon and estimating option outcomes.
    """
    payload = _collect_training_outcomes(
        lookback_days=lookback_days,
        limit=limit,
        include_green_marker=include_green_marker,
        include_linked=include_linked,
        force_recompute=False,
        materialize=False,
    )
    return _json_safe(payload)


@router.post("/training-outcomes/backfill")
def backfill_training_outcomes(
    http_request: Request,
    lookback_days: int = Query(3650, ge=30, le=3650),
    limit: int = Query(5000, ge=1, le=10000),
    include_green_marker: bool = Query(True),
    include_linked: bool = Query(True),
    force_recompute: bool = Query(False),
):
    """
    Recompute historical scanner training outcomes from old discord/trigger events,
    including green-marker events when requested.
    """
    payload = _collect_training_outcomes(
        lookback_days=lookback_days,
        limit=limit,
        include_green_marker=include_green_marker,
        include_linked=include_linked,
        force_recompute=force_recompute,
    )
    set_secret_options_audit_change(
        http_request,
        object_type="training_outcome_batch",
        object_id="backfill",
        after={
            "summary": payload.get("summary"),
            "outcome_count": len(payload.get("outcomes") or []),
        },
    )
    return _json_safe(payload)
