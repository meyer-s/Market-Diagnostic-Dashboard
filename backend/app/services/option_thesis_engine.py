from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import json
import math
import re
from typing import Any, Iterable, Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.models.option_decision_learning import (
    OptionModelRegistry,
    OptionPositionMandate,
    OptionRiskPolicy,
    OptionThesisAssessment,
)
from app.services.options_review_window import ReviewWindow, compute_decision_window, parse_review_window


GRADER_VERSION = "thesis_rules_v2"
FEATURE_SCHEMA_VERSION = "option_thesis_features_v2"
MODEL_KEY = "option_thesis_grader"
FIELD_SHADOW_MODEL_VERSION = "thesis_rules_v2_market_field_shadow_v1"
FIELD_SHADOW_FEATURE_SCHEMA_VERSION = "option_market_field_features_v1"

_CATALYST_TERMS = (
    "earnings",
    "guidance",
    "fda",
    "regulatory",
    "ruling",
    "takeover",
    "acquisition",
    "merger",
    "launch",
    "investor day",
)


def _finite(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _clean(value: object) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def json_dumps(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def json_loads(value: object, default: Any) -> Any:
    if not value:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def _add_weekdays(anchor: date, sessions: int) -> date:
    cursor = anchor
    remaining = max(0, int(sessions))
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return cursor


def technical_snapshot_from_frame(frame: object) -> dict[str, object]:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        return {}
    normalized = frame.copy()
    normalized.columns = [str(column).lower() for column in normalized.columns]
    if "close" not in normalized.columns:
        return {}

    closes = pd.to_numeric(normalized["close"], errors="coerce").dropna()
    if closes.empty:
        return {}
    highs = pd.to_numeric(normalized.get("high", closes), errors="coerce")
    lows = pd.to_numeric(normalized.get("low", closes), errors="coerce")
    volumes = pd.to_numeric(normalized.get("volume", pd.Series(dtype=float)), errors="coerce")

    def last_sma(window: int) -> Optional[float]:
        if len(closes) < window:
            return None
        return _finite(closes.rolling(window).mean().iloc[-1])

    def slope(window: int) -> Optional[float]:
        if len(closes) < window + 5:
            return None
        series = closes.rolling(window).mean().dropna()
        if len(series) < 5:
            return None
        prior = _finite(series.iloc[-5])
        current = _finite(series.iloc[-1])
        return ((current / prior) - 1.0) * 100.0 if current is not None and prior else None

    delta = closes.diff()
    gains = delta.clip(lower=0).rolling(14).mean()
    losses = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gains / losses.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))

    ema12 = closes.ewm(span=12, adjust=False).mean()
    ema26 = closes.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()

    atr = None
    if len(closes) >= 15 and len(highs) == len(normalized) and len(lows) == len(normalized):
        high_low = highs - lows
        high_close = (highs - pd.to_numeric(normalized["close"], errors="coerce").shift()).abs()
        low_close = (lows - pd.to_numeric(normalized["close"], errors="coerce").shift()).abs()
        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        atr = _finite(true_range.rolling(14).mean().iloc[-1])

    current = _finite(closes.iloc[-1])
    recent20 = normalized.tail(20)
    support = _finite(pd.to_numeric(recent20.get("low"), errors="coerce").min()) if "low" in recent20 else None
    resistance = _finite(pd.to_numeric(recent20.get("high"), errors="coerce").max()) if "high" in recent20 else None
    volume_vs_20 = None
    if len(volumes.dropna()) >= 2:
        avg_volume = _finite(volumes.tail(20).mean())
        latest_volume = _finite(volumes.iloc[-1])
        if avg_volume:
            volume_vs_20 = latest_volume / avg_volume if latest_volume is not None else None

    return {
        "price": current,
        "sma20": last_sma(20),
        "sma50": last_sma(50),
        "sma200": last_sma(200),
        "sma20_slope_pct": slope(20),
        "sma50_slope_pct": slope(50),
        "rsi14": _finite(rsi.iloc[-1]) if not rsi.empty else None,
        "macd": _finite(macd.iloc[-1]),
        "macd_signal": _finite(signal.iloc[-1]),
        "macd_hist": _finite((macd - signal).iloc[-1]),
        "atr14": atr,
        "atr14_pct": (atr / current * 100.0) if atr is not None and current else None,
        "support20": support,
        "resistance20": resistance,
        "volume_vs_20d": volume_vs_20,
        "observations": int(len(closes)),
    }


def ensure_default_risk_policy(db: Session) -> OptionRiskPolicy:
    policy = db.query(OptionRiskPolicy).order_by(OptionRiskPolicy.policy_version.desc()).first()
    if policy is not None:
        return policy
    policy = OptionRiskPolicy(
        policy_version=1,
        name="Draft tracked-options guardrails",
        active=False,
        approval_status="draft",
        max_single_position_premium_pct=30.0,
        max_directional_premium_pct=75.0,
        max_expiry_bucket_premium_pct=45.0,
        max_option_spread_pct=25.0,
        min_dte_for_add=21,
        settings_json=json_dumps(
            {
                "basis": "tracked_option_premium",
                "note": "Draft defaults do not authorize additions until confirmed.",
            }
        ),
    )
    db.add(policy)
    db.flush()
    return policy


def ensure_model_registry(db: Session) -> OptionModelRegistry:
    champion = (
        db.query(OptionModelRegistry)
        .filter(
            OptionModelRegistry.model_key == MODEL_KEY,
            OptionModelRegistry.model_version == GRADER_VERSION,
        )
        .first()
    )
    if champion is None:
        champion = OptionModelRegistry(
            model_key=MODEL_KEY,
            model_version=GRADER_VERSION,
            model_status="champion",
            feature_schema_version=FEATURE_SCHEMA_VERSION,
            sample_count=0,
            metrics_json=json_dumps({"mode": "deterministic_shadow", "live_outcomes": 0}),
            promotion_gates_json=json_dumps(
                {
                    "minimum_independent_trade_cycles": 100,
                    "minimum_new_cycles_before_retrain": 25,
                    "automatic_promotion": False,
                }
            ),
        )
        db.add(champion)

    field_challenger = (
        db.query(OptionModelRegistry)
        .filter(
            OptionModelRegistry.model_key == MODEL_KEY,
            OptionModelRegistry.model_version == FIELD_SHADOW_MODEL_VERSION,
        )
        .first()
    )
    if field_challenger is None:
        field_challenger = OptionModelRegistry(
            model_key=MODEL_KEY,
            model_version=FIELD_SHADOW_MODEL_VERSION,
            model_status="challenger",
            feature_schema_version=FIELD_SHADOW_FEATURE_SCHEMA_VERSION,
            sample_count=0,
            metrics_json=json_dumps(
                {
                    "mode": "advisory_shadow",
                    "live_outcomes": 0,
                    "rank_influence": 0.0,
                    "automated_execution_enabled": False,
                }
            ),
            promotion_gates_json=json_dumps(
                {
                    "minimum_independent_trade_cycles": 100,
                    "minimum_new_cycles_before_retrain": 25,
                    "incremental_out_of_sample_value_required": True,
                    "automatic_promotion": False,
                }
            ),
        )
        db.add(field_challenger)
    db.flush()
    return champion


def latest_risk_policy(db: Session) -> OptionRiskPolicy:
    active = (
        db.query(OptionRiskPolicy)
        .filter(OptionRiskPolicy.active.is_(True))
        .order_by(OptionRiskPolicy.policy_version.desc())
        .first()
    )
    return active or ensure_default_risk_policy(db)


def _event_role(message: str) -> str:
    lowered = message.lower()
    if any(term in lowered for term in _CATALYST_TERMS):
        return "catalyst"
    if "mean reversion" in lowered or "oversold" in lowered or "overbought" in lowered:
        return "mean_reversion"
    if "trend" in lowered or "momentum" in lowered or "breakout" in lowered:
        return "trend"
    return "unclassified"


def _short_event_context(message: str) -> Optional[str]:
    clean = re.sub(r"[`*_#>-]", " ", message or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean[:420] or None


def _mandate_deadline(position: object, source_event: object | None) -> date:
    trade_date = getattr(position, "trade_date", date.today()) or date.today()
    expiration = getattr(position, "expiration", trade_date + timedelta(days=45))
    max_hold = getattr(source_event, "review_max_hold_days", None) if source_event is not None else None
    if not isinstance(max_hold, int) or max_hold <= 0:
        max_hold = 14
    proposed = _add_weekdays(trade_date, max_hold)
    expiration_buffer = expiration - timedelta(days=14)
    return min(proposed, expiration_buffer) if expiration_buffer >= trade_date else proposed


def _initial_review_window(
    position: object,
    mandate: OptionPositionMandate,
    source_event: object | None,
) -> ReviewWindow:
    source_message = str(getattr(source_event, "message", "") or "")
    parsed = parse_review_window(source_message)
    max_hold = getattr(source_event, "review_max_hold_days", None) if source_event is not None else None
    min_hold = getattr(source_event, "review_min_hold_days", None) if source_event is not None else None
    if not isinstance(max_hold, int) or max_hold <= 0:
        max_hold = parsed.max_hold_days if parsed is not None else None
    if not isinstance(max_hold, int) or max_hold <= 0:
        trade_date = getattr(position, "trade_date", None)
        mandate_deadline = getattr(mandate, "decision_deadline", None)
        if isinstance(trade_date, date) and isinstance(mandate_deadline, date) and mandate_deadline > trade_date:
            max_hold = max(1, (mandate_deadline - trade_date).days)
        else:
            max_hold = 14
    if not isinstance(min_hold, int) or min_hold <= 0:
        min_hold = parsed.min_hold_days if parsed is not None else max(1, round(max_hold * 0.4))
    min_hold = max(1, min(int(min_hold), int(max_hold)))
    basis = str(getattr(source_event, "review_window_basis", "") or "").strip()
    if not basis:
        basis = parsed.basis if parsed is not None else "reconstructed mandate window"
    return ReviewWindow(min_hold_days=min_hold, max_hold_days=int(max_hold), basis=basis)


def build_actionable_decision_window(
    *,
    position: object,
    mandate: OptionPositionMandate,
    source_event: object | None,
    verdict: str,
    urgency: str,
    contract_status: str,
    as_of: date,
) -> dict[str, object]:
    initial_window = _initial_review_window(position, mandate, source_event)
    expiration = getattr(position, "expiration", as_of)
    if not isinstance(expiration, date):
        expiration = as_of
    schedule = compute_decision_window(
        as_of=as_of,
        expiration=expiration,
        initial_window=initial_window,
        verdict=verdict,
        urgency=urgency,
        contract_status=contract_status,
    )
    return {
        "as_of_date": as_of,
        "next_review_date": schedule.next_review_date,
        "decision_deadline": schedule.decision_deadline,
        "next_review_sessions": schedule.next_review_sessions,
        "max_hold_sessions": schedule.max_hold_sessions,
        "original_min_hold_days": schedule.original_min_hold_days,
        "original_max_hold_days": schedule.original_max_hold_days,
        "basis": schedule.basis,
    }


def rebase_continuation_condition(
    condition: object,
    *,
    deadline: date,
    verdict: str,
) -> str:
    normalized_verdict = str(verdict or "").lower()
    if normalized_verdict in {"close", "replacement_candidate"}:
        return f"Do not hold this exact contract beyond {deadline.isoformat()}."
    text = _clean(condition)
    if not text:
        return f"Require new confirming evidence before {deadline.isoformat()}."
    rebased = re.sub(r"\b20\d{2}-\d{2}-\d{2}\b", deadline.isoformat(), text)
    if deadline.isoformat() not in rebased:
        rebased = f"{rebased.rstrip('.')} by {deadline.isoformat()}."
    return rebased


def build_reconstructed_mandate(position: object, source_event: object | None = None) -> dict[str, object]:
    option_type = str(getattr(position, "option_type", "call") or "call").lower()
    bullish = option_type == "call"
    direction_word = "appreciate" if bullish else "decline"
    reference = _finite(
        getattr(position, "underlying_at_entry", None)
        or getattr(position, "underlying_reference", None)
    )
    source_message = str(getattr(source_event, "message", "") or "")
    role = _event_role(source_message)
    deadline = _mandate_deadline(position, source_event)
    confirm_level = reference * (1.02 if bullish else 0.98) if reference else None
    invalidation_level = reference * (0.96 if bullish else 1.04) if reference else None
    source_date = getattr(source_event, "triggered_at", None)
    source_context = _short_event_context(source_message)

    thesis = (
        f"The underlying should {direction_word} during the source signal's decision window."
        if source_event is not None
        else f"The underlying should {direction_word} enough for the long {option_type} to justify continued premium at risk."
    )
    if source_context:
        thesis = f"{thesis} Source context: {source_context}"

    expiration = getattr(position, "expiration", None)
    strike = _finite(getattr(position, "strike", None))
    contract_thesis = (
        f"The {expiration.isoformat() if expiration else 'selected'} ${strike:.2f} {option_type} was chosen to express the directional view before time decay overwhelms the expected move."
        if strike is not None
        else f"The selected {option_type} was intended to express the directional view within the available time window."
    )
    confirmation = (
        f"Draft: underlying closes {'above' if bullish else 'below'} ${confirm_level:.2f} before {deadline.isoformat()}."
        if confirm_level is not None
        else f"Draft: directional progress is visible before {deadline.isoformat()}."
    )
    invalidation = (
        f"Draft: underlying closes {'below' if bullish else 'above'} ${invalidation_level:.2f}, or the decision deadline passes without progress."
        if invalidation_level is not None
        else "Draft: the decision deadline passes without directional progress."
    )
    return {
        "capture_kind": "reconstructed",
        "confirmation_status": "draft",
        "source_event_id": getattr(source_event, "id", None),
        "source_kind": "scanner_event" if source_event is not None else "position_record",
        "source_confidence": "high" if source_event is not None else "medium",
        "threshold_origin": "system_draft",
        "threshold_approval_status": "draft",
        "trade_role": role,
        "original_thesis": thesis,
        "contract_thesis": contract_thesis,
        "expected_path": (
            f"Make directional progress from the entry reference and reach confirmation before {deadline.isoformat()}; do not rely on recovery to the original debit."
        ),
        "catalyst": (
            f"Source scanner event {source_date.isoformat()}" if source_date is not None else "No confirmed catalyst captured"
        ),
        "confirmation_condition": confirmation,
        "invalidation_condition": invalidation,
        "decision_deadline": deadline,
        "risk_budget": _finite(getattr(position, "total_cost", None)),
        "thresholds": {
            "confirmation_underlying": round(confirm_level, 4) if confirm_level is not None else None,
            "invalidation_underlying": round(invalidation_level, 4) if invalidation_level is not None else None,
            "origin": "system_draft",
            "approval_status": "draft",
        },
        "source_snapshot": {
            "position_id": getattr(position, "id", None),
            "symbol": getattr(position, "symbol", None),
            "trade_date": getattr(position, "trade_date", None),
            "entry_underlying": reference,
            "source_event_id": getattr(source_event, "id", None),
            "source_triggered_at": source_date,
        },
    }


def get_or_create_mandate(
    db: Session,
    position: object,
    source_event: object | None = None,
    *,
    capture_kind: str = "reconstructed",
) -> OptionPositionMandate:
    latest = (
        db.query(OptionPositionMandate)
        .filter(OptionPositionMandate.position_id == getattr(position, "id"))
        .order_by(OptionPositionMandate.mandate_version.desc(), OptionPositionMandate.id.desc())
        .first()
    )
    if latest is not None:
        return latest
    payload = build_reconstructed_mandate(position, source_event)
    payload["capture_kind"] = capture_kind
    mandate = OptionPositionMandate(
        position_id=getattr(position, "id"),
        mandate_version=1,
        captured_at=datetime.utcnow(),
        capture_kind=str(payload["capture_kind"]),
        confirmation_status=str(payload["confirmation_status"]),
        source_event_id=payload["source_event_id"],
        source_kind=str(payload["source_kind"]),
        source_confidence=str(payload["source_confidence"]),
        threshold_origin=str(payload["threshold_origin"]),
        threshold_approval_status=str(payload["threshold_approval_status"]),
        trade_role=str(payload["trade_role"]),
        original_thesis=_clean(payload["original_thesis"]),
        contract_thesis=_clean(payload["contract_thesis"]),
        expected_path=_clean(payload["expected_path"]),
        catalyst=_clean(payload["catalyst"]),
        confirmation_condition=_clean(payload["confirmation_condition"]),
        invalidation_condition=_clean(payload["invalidation_condition"]),
        decision_deadline=payload["decision_deadline"],
        risk_budget=_finite(payload["risk_budget"]),
        thresholds_json=json_dumps(payload["thresholds"]),
        source_snapshot_json=json_dumps(payload["source_snapshot"]),
    )
    db.add(mandate)
    db.flush()
    return mandate


def confirm_mandate_from_review(db: Session, position: object, review: object) -> OptionPositionMandate:
    latest = (
        db.query(OptionPositionMandate)
        .filter(OptionPositionMandate.position_id == getattr(position, "id"))
        .order_by(OptionPositionMandate.mandate_version.desc(), OptionPositionMandate.id.desc())
        .first()
    )
    same_content = bool(
        latest
        and latest.confirmation_status == "confirmed"
        and latest.trade_role == getattr(review, "trade_role", None)
        and latest.original_thesis == getattr(review, "original_thesis", None)
        and latest.contract_thesis == getattr(review, "contract_thesis", None)
        and latest.confirmation_condition == getattr(review, "confirmation_condition", None)
        and latest.invalidation_condition == getattr(review, "invalidation_condition", None)
        and latest.decision_deadline == getattr(review, "decision_deadline", None)
    )
    if same_content:
        return latest
    threshold_status = getattr(review, "threshold_approval_status", None) or "draft"
    mandate = OptionPositionMandate(
        position_id=getattr(position, "id"),
        supersedes_mandate_id=latest.id if latest else None,
        mandate_version=(latest.mandate_version + 1) if latest else 1,
        captured_at=datetime.utcnow(),
        capture_kind="user_confirmed",
        confirmation_status="confirmed",
        source_event_id=getattr(position, "source_event_id", None),
        source_kind="decision_review",
        source_confidence="high",
        threshold_origin=("approved_monitoring_rule" if threshold_status == "approved" else "user_confirmed_draft"),
        threshold_approval_status=threshold_status,
        trade_role=getattr(review, "trade_role", "unclassified"),
        original_thesis=getattr(review, "original_thesis", None),
        contract_thesis=getattr(review, "contract_thesis", None),
        expected_path=getattr(review, "expected_path", None),
        catalyst=getattr(review, "catalyst", None),
        confirmation_condition=getattr(review, "confirmation_condition", None),
        invalidation_condition=getattr(review, "invalidation_condition", None),
        decision_deadline=getattr(review, "decision_deadline", None),
        risk_budget=_finite(getattr(review, "risk_budget", None)),
        thresholds_json=(latest.thresholds_json if latest else "{}"),
        source_snapshot_json=json_dumps(
            {
                "review_id": getattr(review, "id", None),
                "review_date": getattr(review, "review_date", None),
                "threshold_approval_status": threshold_status,
            }
        ),
    )
    db.add(mandate)
    db.flush()
    return mandate


def serialize_mandate(mandate: OptionPositionMandate | None) -> Optional[dict[str, object]]:
    if mandate is None:
        return None
    return {
        "id": mandate.id,
        "position_id": mandate.position_id,
        "supersedes_mandate_id": mandate.supersedes_mandate_id,
        "mandate_version": mandate.mandate_version,
        "captured_at": mandate.captured_at.isoformat() if mandate.captured_at else None,
        "capture_kind": mandate.capture_kind,
        "confirmation_status": mandate.confirmation_status,
        "source_event_id": mandate.source_event_id,
        "source_kind": mandate.source_kind,
        "source_confidence": mandate.source_confidence,
        "threshold_origin": mandate.threshold_origin,
        "threshold_approval_status": mandate.threshold_approval_status,
        "trade_role": mandate.trade_role,
        "original_thesis": mandate.original_thesis,
        "contract_thesis": mandate.contract_thesis,
        "expected_path": mandate.expected_path,
        "catalyst": mandate.catalyst,
        "confirmation_condition": mandate.confirmation_condition,
        "invalidation_condition": mandate.invalidation_condition,
        "decision_deadline": mandate.decision_deadline.isoformat() if mandate.decision_deadline else None,
        "risk_budget": mandate.risk_budget,
        "thresholds": json_loads(mandate.thresholds_json, {}),
        "source_snapshot": json_loads(mandate.source_snapshot_json, {}),
    }


def _projection_snapshot(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        return {}
    projections = payload.get("projections") if isinstance(payload.get("projections"), dict) else {}
    preferred = projections.get("3M") or projections.get("3m") or next(iter(projections.values()), {})
    if not isinstance(preferred, dict):
        preferred = {}
    fundamentals = payload.get("fundamentals") if isinstance(payload.get("fundamentals"), dict) else {}

    def series_values(key: str) -> list[float]:
        row = fundamentals.get(key) if isinstance(fundamentals, dict) else None
        series = row.get("series") if isinstance(row, dict) else None
        values = []
        for point in series if isinstance(series, list) else []:
            value = _finite(point.get("value")) if isinstance(point, dict) else None
            if value is not None:
                values.append(value)
        return values

    revenue_yoy = series_values("revenue_yoy") or series_values("revenue_yoy_annual")
    eps = series_values("eps") or series_values("eps_annual")
    free_cash_flow = series_values("free_cash_flow") or series_values("free_cash_flow_annual")
    fundamental_signals: list[int] = []
    if revenue_yoy:
        fundamental_signals.append(1 if revenue_yoy[-1] >= 2 else -1 if revenue_yoy[-1] <= -2 else 0)
    if len(eps) >= 2:
        fundamental_signals.append(1 if eps[-1] > eps[-2] else -1 if eps[-1] < eps[-2] else 0)
    if len(free_cash_flow) >= 2:
        fundamental_signals.append(
            1 if free_cash_flow[-1] > free_cash_flow[-2] else -1 if free_cash_flow[-1] < free_cash_flow[-2] else 0
        )
    fundamental_score = sum(fundamental_signals)
    fundamental_status = (
        "strengthening"
        if fundamental_score >= 2
        else "weakening"
        if fundamental_score <= -2
        else "mixed"
        if fundamental_signals
        else "unavailable"
    )
    return {
        "as_of": payload.get("as_of_date") or payload.get("created_at"),
        "conviction": preferred.get("conviction"),
        "composite_score": preferred.get("composite_score") or preferred.get("score"),
        "direction": preferred.get("direction") or preferred.get("bias"),
        "target_price": preferred.get("target_price") or preferred.get("price_target"),
        "fundamental_status": fundamental_status,
        "fundamental_signal_count": len(fundamental_signals),
        "fundamental_score": fundamental_score if fundamental_signals else None,
        "revenue_yoy_latest": revenue_yoy[-1] if revenue_yoy else None,
        "eps_latest": eps[-1] if eps else None,
        "free_cash_flow_latest": free_cash_flow[-1] if free_cash_flow else None,
        "data_warnings": payload.get("data_warnings") or [],
    }


def _directional_return(option_type: str, current: Optional[float], entry: Optional[float]) -> Optional[float]:
    if current is None or not entry:
        return None
    raw = (current / entry - 1.0) * 100.0
    return raw if option_type == "call" else -raw


def _technical_direction_score(option_type: str, technical: dict[str, object]) -> int:
    multiplier = 1 if option_type == "call" else -1
    score = 0
    price = _finite(technical.get("price"))
    sma20 = _finite(technical.get("sma20") or technical.get("sma_20"))
    sma50 = _finite(technical.get("sma50") or technical.get("sma_50"))
    slope20 = _finite(technical.get("sma20_slope_pct"))
    nested_rsi = technical.get("rsi") if isinstance(technical.get("rsi"), dict) else {}
    nested_macd = technical.get("macd") if isinstance(technical.get("macd"), dict) else {}
    rsi = _finite(technical.get("rsi14") or nested_rsi.get("current"))
    macd_hist = _finite(technical.get("macd_hist") or nested_macd.get("histogram"))
    if price is not None and sma20 is not None:
        score += multiplier if price >= sma20 else -multiplier
    if sma20 is not None and sma50 is not None:
        score += multiplier if sma20 >= sma50 else -multiplier
    if slope20 is not None:
        score += multiplier if slope20 >= 0 else -multiplier
    if rsi is not None:
        score += multiplier if rsi >= 52 else -multiplier if rsi <= 48 else 0
    if macd_hist is not None:
        score += multiplier if macd_hist >= 0 else -multiplier
    return max(-5, min(5, score))


_FIELD_PATH_STATES = {"supportive", "fading", "contradictory", "mixed", "unavailable"}
_URGENCY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _nested_mapping(payload: object, key: str) -> dict[str, object]:
    if not isinstance(payload, dict):
        return {}
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _market_structure_axis(field_context: object) -> dict[str, object]:
    context = field_context if isinstance(field_context, dict) else {}
    direction = _nested_mapping(context, "direction")
    strata = _nested_mapping(context, "strata")
    price_action = _nested_mapping(context, "price_action")
    classification = _nested_mapping(context, "classification")
    hypotheses = _nested_mapping(context, "hypotheses")
    signals = _nested_mapping(context, "signals")
    quality = context.get("quality")
    quality_mapping = quality if isinstance(quality, dict) else {}
    available = bool(quality_mapping.get("available", context.get("available")))
    path_state = str(
        classification.get("path_state")
        or signals.get("path_state")
        or "unavailable"
    ).strip().lower()
    if not available or path_state not in _FIELD_PATH_STATES:
        path_state = "unavailable"
    geometry_shock = bool(
        hypotheses.get("geometry_disorder_shock", signals.get("geometry_disorder_shock"))
    )
    exhaustion = bool(
        hypotheses.get("kinematic_exhaustion", signals.get("kinematic_exhaustion"))
    )
    eventfulness = str(classification.get("eventfulness") or "").strip().lower()
    transition_elevated = eventfulness in {"elevated", "high", "shock", "exhaustion"}
    transition_risk = (
        "elevated"
        if available and (geometry_shock or exhaustion or transition_elevated)
        else "normal"
        if available
        else "unavailable"
    )
    if isinstance(quality, dict):
        quality_label = str(
            quality.get("status")
            or quality.get("label")
            or quality.get("data_quality_status")
            or "unknown"
        )
    else:
        quality_label = str(quality or "unknown")
    return {
        "status": path_state,
        "advisory": True,
        "rank_influence": 0.0,
        "available": available,
        "schema_version": context.get("schema_version"),
        "timeframe": context.get("timeframe"),
        "as_of_bar": context.get("as_of_bar"),
        "quality": quality_label,
        "aligned_pressure": _finite(
            direction.get("option_aligned_pressure", direction.get("aligned_pressure"))
        ),
        "aligned_velocity": _finite(
            direction.get("option_aligned_velocity", direction.get("aligned_velocity"))
        ),
        "structure": _finite(strata.get("structure")),
        "kinematics": _finite(strata.get("kinematics")),
        "geometry": _finite(strata.get("geometry")),
        "information": _finite(strata.get("information")),
        "propagation": _finite(strata.get("propagation")),
        "cascade_bias": _finite(strata.get("cascade_bias")),
        "transition_risk": transition_risk,
        "boundary_state": price_action.get("state"),
        "support_distance_atr": _finite(price_action.get("support_distance_atr")),
        "resistance_distance_atr": _finite(price_action.get("resistance_distance_atr")),
        "familiarity": "not_scored",
        "familiarity_reason": "Stable cross-review familiarity is not available from the advisory snapshot.",
        "signals": {
            "organized_expansion": bool(
                hypotheses.get("organized_expansion", signals.get("organized_expansion"))
            ),
            "longward_cascade": bool(
                hypotheses.get("longward_cascade", signals.get("longward_cascade"))
            ),
            "geometry_disorder_shock": geometry_shock,
            "kinematic_exhaustion": exhaustion,
        },
    }


def _lower_confidence(confidence: str) -> str:
    return {"high": "medium", "medium": "low"}.get(confidence, confidence)


def _at_least_urgency(current: str, minimum: str) -> str:
    return minimum if _URGENCY_RANK.get(current, 0) < _URGENCY_RANK[minimum] else current


def _market_structure_fact(axis: dict[str, object]) -> str:
    if not axis.get("available"):
        return "Causal Market Field context is unavailable; it did not influence the verdict or target size."
    fragments = [f"Underlying path is {str(axis['status']).replace('_', ' ')}"]
    pressure = _finite(axis.get("aligned_pressure"))
    velocity = _finite(axis.get("aligned_velocity"))
    propagation = _finite(axis.get("propagation"))
    if pressure is not None:
        fragments.append(f"direction-adjusted pressure {pressure:+.2f}")
    if velocity is not None:
        fragments.append(f"direction-adjusted velocity {velocity:+.2f}")
    if propagation is not None:
        fragments.append(f"propagation {propagation:.2f}")
    boundary = str(axis.get("boundary_state") or "").replace("_", " ").strip()
    if boundary:
        fragments.append(f"price is in a {boundary} state")
    return "; ".join(fragments) + ". Advisory path evidence only; verdict and size rules remain unchanged."


def build_assessment_payload(
    *,
    position: object,
    metrics: dict[str, object],
    mandate: OptionPositionMandate,
    latest_review: object | None,
    portfolio_positions: Iterable[object],
    risk_policy: OptionRiskPolicy,
    source_event: object | None = None,
    projection_payload: object = None,
    as_of: Optional[datetime] = None,
) -> dict[str, object]:
    as_of_dt = as_of or datetime.utcnow()
    as_of_date = as_of_dt.date()
    option_type = str(getattr(position, "option_type", "call") or "call").lower()
    contracts = int(getattr(position, "contracts", 0) or 0)
    market = metrics.get("market") if isinstance(metrics.get("market"), dict) else {}
    quote = metrics.get("quote") if isinstance(metrics.get("quote"), dict) else {}
    pnl = metrics.get("pnl") if isinstance(metrics.get("pnl"), dict) else {}
    greeks = metrics.get("greeks") if isinstance(metrics.get("greeks"), dict) else {}
    technical = metrics.get("technical_snapshot") if isinstance(metrics.get("technical_snapshot"), dict) else {}
    field_context = metrics.get("field_context") if isinstance(metrics.get("field_context"), dict) else {}
    market_structure = _market_structure_axis(field_context)
    projection = _projection_snapshot(projection_payload)

    spot = _finite(market.get("current_price"))
    entry_underlying = _finite(
        getattr(position, "underlying_at_entry", None)
        or getattr(position, "underlying_reference", None)
    )
    option_price = _finite(metrics.get("option_price"))
    dte = int(metrics.get("dte")) if _finite(metrics.get("dte")) is not None else None
    volatility = _finite(metrics.get("volatility"))
    if volatility is not None and volatility > 5:
        volatility /= 100.0
    directional_return = _directional_return(option_type, spot, entry_underlying)
    technical_score = _technical_direction_score(option_type, technical)

    mandate_deadline = mandate.decision_deadline
    deadline_missed = bool(mandate_deadline and mandate_deadline < as_of_date)
    if directional_return is None:
        path_status = "unknown"
    elif directional_return >= 5:
        path_status = "ahead"
    elif directional_return >= 0:
        path_status = "on_track"
    elif directional_return > -4 and not deadline_missed:
        path_status = "behind"
    else:
        path_status = "failed"

    human_status = getattr(latest_review, "thesis_status", None)
    human_map = {
        "strengthened": "strengthening",
        "intact": "intact",
        "weakened": "watch",
        "broken": "broken",
        "no_longer_relevant": "retired",
    }
    if human_status in human_map:
        company_status = human_map[human_status]
        company_status_source = "latest_human_review"
    else:
        fundamental_status = projection.get("fundamental_status")
        company_status_source = "automatic_fundamental_snapshot"
        if fundamental_status == "strengthening":
            company_status = "strengthening"
        elif fundamental_status == "weakening":
            company_status = "impaired" if path_status == "failed" else "watch"
        elif fundamental_status == "mixed":
            company_status = "watch"
        else:
            company_status = "unverified"
            company_status_source = "insufficient_company_evidence"

    strike = _finite(getattr(position, "strike", None))
    spread_pct = _finite(quote.get("spread_pct"))
    if spot is not None and strike is not None:
        otm_pct = ((strike - spot) / spot * 100.0) if option_type == "call" else ((spot - strike) / spot * 100.0)
    else:
        otm_pct = None
    expected_move_pct = volatility * math.sqrt(max(dte or 0, 0) / 365.0) * 100.0 if volatility and dte else None
    contract_reasons: list[str] = []
    if dte is not None and dte <= 0:
        contract_status = "nonviable"
        contract_reasons.append("The contract has expired or has no remaining time value.")
    elif otm_pct is not None and expected_move_pct and otm_pct > expected_move_pct:
        contract_status = "nonviable"
        contract_reasons.append("The remaining out-of-the-money distance exceeds the volatility-implied move.")
    elif dte is not None and dte <= 14:
        contract_status = "marginal"
        contract_reasons.append("Less than fifteen days remain, so path and timing risk are high.")
    elif otm_pct is not None and expected_move_pct and otm_pct > expected_move_pct * 0.6:
        contract_status = "marginal"
        contract_reasons.append("The contract needs a large share of the remaining implied move.")
    elif spread_pct is not None and spread_pct > 35:
        contract_status = "marginal"
        contract_reasons.append("The current bid/ask spread materially weakens execution quality.")
    else:
        contract_status = "attractive"
        contract_reasons.append("Remaining time, moneyness and execution inputs do not trigger a contract veto.")

    portfolio_rows = list(portfolio_positions)
    total_premium = sum(max(0.0, _finite(getattr(row, "total_cost", None)) or 0.0) for row in portfolio_rows)
    position_premium = max(0.0, _finite(getattr(position, "total_cost", None)) or 0.0)
    same_direction = sum(
        max(0.0, _finite(getattr(row, "total_cost", None)) or 0.0)
        for row in portfolio_rows
        if str(getattr(row, "option_type", "")).lower() == option_type
    )
    expiry_month = getattr(position, "expiration", as_of_date).strftime("%Y-%m")
    same_expiry = sum(
        max(0.0, _finite(getattr(row, "total_cost", None)) or 0.0)
        for row in portfolio_rows
        if getattr(row, "expiration", as_of_date).strftime("%Y-%m") == expiry_month
    )
    position_share = position_premium / total_premium * 100.0 if total_premium else None
    direction_share = same_direction / total_premium * 100.0 if total_premium else None
    expiry_share = same_expiry / total_premium * 100.0 if total_premium else None
    policy_active = bool(risk_policy.active and risk_policy.approval_status == "approved")
    portfolio_breaches: list[str] = []
    if policy_active:
        if risk_policy.max_single_position_premium_pct is not None and position_share is not None and position_share > risk_policy.max_single_position_premium_pct:
            portfolio_breaches.append("single_position_premium")
        if risk_policy.max_directional_premium_pct is not None and direction_share is not None and direction_share > risk_policy.max_directional_premium_pct:
            portfolio_breaches.append("directional_premium")
        if risk_policy.max_expiry_bucket_premium_pct is not None and expiry_share is not None and expiry_share > risk_policy.max_expiry_bucket_premium_pct:
            portfolio_breaches.append("expiry_bucket_premium")
    if portfolio_breaches:
        portfolio_status = "over_budget"
    elif (direction_share is not None and direction_share >= 80) or (position_share is not None and position_share >= 35):
        portfolio_status = "crowded"
    else:
        portfolio_status = "acceptable"

    missing_inputs: list[str] = []
    if spot is None:
        missing_inputs.append("current underlying price")
    if option_price is None:
        missing_inputs.append("current executable option value")
    if quote.get("bid") is None or quote.get("ask") is None:
        missing_inputs.append("two-sided option quote")
    if not technical:
        missing_inputs.append("current technical history")
    if not projection:
        missing_inputs.append("current projection/fundamental snapshot")
    elif projection.get("fundamental_status") == "unavailable":
        missing_inputs.append("current fundamental evidence")
    if mandate.confirmation_status != "confirmed":
        missing_inputs.append("user-confirmed original mandate")
    if not policy_active:
        missing_inputs.append("approved portfolio risk policy")
    if risk_policy.portfolio_capital is None:
        missing_inputs.append("portfolio capital/NAV")

    blocking_missing = spot is None or dte is None
    if blocking_missing:
        data_quality = "stop"
    elif missing_inputs:
        data_quality = "degraded"
    else:
        data_quality = "complete"

    risk_budget_breached = bool(mandate.risk_budget is not None and position_premium > mandate.risk_budget + 0.01)
    marginal_for_portfolio = (
        company_status in {"watch", "impaired", "broken", "retired"}
        or path_status in {"behind", "failed", "unknown"}
        or contract_status in {"marginal", "nonviable"}
        or data_quality == "stop"
    )
    vetoes: list[dict[str, object]] = []
    if blocking_missing:
        vetoes.append({"code": "data_incomplete", "hard": True, "detail": "Current underlying price or DTE is unavailable."})
    if company_status in {"broken", "retired"}:
        vetoes.append({"code": "thesis_invalid", "hard": True, "detail": "The latest confirmed human review says the company thesis is no longer valid."})
    if dte is not None and dte <= 0:
        vetoes.append({"code": "expired", "hard": True, "detail": "The contract has expired."})
    if deadline_missed and path_status == "failed":
        vetoes.append({"code": "decision_deadline_failed", "hard": True, "detail": "The decision deadline passed without the required progress."})
    if contract_status == "nonviable":
        vetoes.append({"code": "contract_nonviable", "hard": True, "detail": contract_reasons[0]})
    if risk_budget_breached:
        vetoes.append({"code": "risk_budget_breached", "hard": True, "detail": "Recorded premium exceeds the active mandate risk budget."})
    if portfolio_breaches:
        vetoes.append(
            {
                "code": "portfolio_policy_breach",
                "hard": marginal_for_portfolio,
                "detail": (
                    f"Approved policy breaches: {', '.join(portfolio_breaches)}. "
                    + ("This position is marginal, so it is a reduction candidate." if marginal_for_portfolio else "Stronger positions are preserved while weaker marginal positions are reduced first.")
                ),
            }
        )

    if data_quality == "stop":
        security_readiness = "not_decision_grade"
    elif company_status in {"broken", "impaired", "retired", "unverified"}:
        security_readiness = "re_underwrite"
    elif missing_inputs:
        security_readiness = "conditional"
    else:
        security_readiness = "ready"

    hard_codes = {str(item["code"]) for item in vetoes if item.get("hard")}
    if "thesis_invalid" in hard_codes or "expired" in hard_codes:
        verdict = "close"
    elif "contract_nonviable" in hard_codes and company_status in {"strengthening", "intact", "watch"}:
        verdict = "replacement_candidate"
    elif hard_codes & {"decision_deadline_failed", "risk_budget_breached", "portfolio_policy_breach"}:
        verdict = "reduce"
    elif data_quality == "stop":
        verdict = "manual_review"
    elif company_status == "unverified":
        verdict = "manual_review"
    elif company_status == "impaired":
        verdict = "reduce"
    elif portfolio_status == "over_budget" and marginal_for_portfolio:
        verdict = "reduce"
    elif portfolio_status in {"over_budget", "crowded"}:
        verdict = "conditional_hold"
    elif path_status in {"behind", "failed"} or contract_status == "marginal":
        verdict = "conditional_hold"
    else:
        verdict = "hold"

    if verdict in {"close", "replacement_candidate"}:
        target = 0
    elif verdict == "reduce":
        target = max(0, contracts // 2)
        if contracts > 1 and target == contracts:
            target = contracts - 1
    else:
        target = contracts
    target_min = max(0, target - 1) if verdict == "reduce" else target
    target_max = min(contracts, target + 1) if verdict == "reduce" else target

    if verdict in {"close", "replacement_candidate"} or company_status in {"broken", "retired"}:
        quality = "red"
    elif verdict in {"reduce", "conditional_hold", "manual_review"}:
        quality = "yellow"
    else:
        quality = "green"
    if dte is not None and dte <= 7 or deadline_missed:
        urgency = "critical"
    elif dte is not None and dte <= 21 or verdict in {"reduce", "close", "replacement_candidate"}:
        urgency = "high"
    elif verdict == "conditional_hold":
        urgency = "medium"
    else:
        urgency = "low"
    if data_quality == "complete" and mandate.confirmation_status == "confirmed":
        confidence = "high"
    elif data_quality == "stop":
        confidence = "low"
    else:
        confidence = "medium"
    field_status = str(market_structure.get("status") or "unavailable")
    field_transition = market_structure.get("transition_risk") == "elevated"
    if market_structure.get("available") and (field_status in {"fading", "contradictory"} or field_transition):
        # This is a challenger-only advisory adjustment. It can make the next
        # human review sooner or make the grade less confident, but it cannot
        # change the hard-veto tree, verdict, or target contracts above.
        confidence = _lower_confidence(confidence)
        urgency = _at_least_urgency(
            urgency,
            "high" if field_status == "contradictory" or field_transition else "medium",
        )

    decision_window = build_actionable_decision_window(
        position=position,
        mandate=mandate,
        source_event=source_event,
        verdict=verdict,
        urgency=urgency,
        contract_status=contract_status,
        as_of=as_of_date,
    )
    next_review = decision_window["next_review_date"]
    decision_deadline = decision_window["decision_deadline"]
    continuation = rebase_continuation_condition(
        mandate.confirmation_condition,
        deadline=decision_deadline,
        verdict=verdict,
    )

    reasons = []
    if company_status_source == "latest_human_review":
        reasons.append(f"Company thesis is {company_status.replace('_', ' ')} based on the latest human review.")
    elif company_status_source == "automatic_fundamental_snapshot":
        reasons.append(
            f"Company thesis is {company_status.replace('_', ' ')} from {projection.get('fundamental_signal_count', 0)} current fundamental signals; price action is evaluated separately."
        )
    else:
        reasons.append("Company thesis is unverified because current business evidence is unavailable; technical price action is not treated as thesis proof.")
    reasons.extend(contract_reasons[:1])
    if market_structure.get("available"):
        reasons.append(_market_structure_fact(market_structure))
    if portfolio_status != "acceptable":
        reasons.append(f"Portfolio fit is {portfolio_status.replace('_', ' ')}; same-direction premium is {direction_share:.1f}% of the tracked book." if direction_share is not None else f"Portfolio fit is {portfolio_status.replace('_', ' ')}.")
    elif direction_share is not None:
        reasons.append(f"This direction represents {direction_share:.1f}% of tracked option premium.")
    if data_quality != "complete":
        reasons.append(f"Confidence is limited by {len(missing_inputs)} missing or unapproved inputs.")

    remaining_capital = option_price * contracts * 100.0 if option_price is not None else None
    input_snapshot = {
        "position": {
            "id": getattr(position, "id", None),
            "symbol": getattr(position, "symbol", None),
            "option_type": option_type,
            "strike": strike,
            "expiration": getattr(position, "expiration", None),
            "contracts": contracts,
            "total_cost": position_premium,
            "entry_underlying": entry_underlying,
        },
        "market": {
            "underlying_price": spot,
            "option_price": option_price,
            "remaining_capital": remaining_capital,
            "pnl_dollar": _finite(pnl.get("dollar")),
            "pnl_percent": _finite(pnl.get("percent")),
            "dte": dte,
            "volatility": volatility,
            "bid": _finite(quote.get("bid")),
            "ask": _finite(quote.get("ask")),
            "spread_pct": spread_pct,
            "quote_quality": quote.get("quality"),
            "delta": _finite(greeks.get("delta")),
            "theta_per_day_per_contract": _finite(greeks.get("theta")),
            "market_data_as_of": market.get("last_updated"),
            "market_data_source": market.get("data_source"),
        },
        # Persist the current held-contract opportunity read so later scanner
        # hits can compare a proposed replacement with today's held contract
        # without re-fetching every option chain on the scanner page.
        "opportunity": metrics.get("opportunity"),
        "path": {
            "directional_return_pct": directional_return,
            "mandate_deadline": mandate_deadline,
            "deadline_missed": deadline_missed,
        },
        "decision_window": decision_window,
        "contract": {
            "otm_pct": otm_pct,
            "expected_move_pct": expected_move_pct,
        },
        "technical": technical,
        "field_context": field_context,
        "projection": projection,
        "portfolio": {
            "tracked_premium": total_premium,
            "position_share_pct": position_share,
            "same_direction_share_pct": direction_share,
            "same_expiry_share_pct": expiry_share,
        },
        "risk_policy": {
            "id": risk_policy.id,
            "version": risk_policy.policy_version,
            "active": risk_policy.active,
            "approval_status": risk_policy.approval_status,
        },
        "mandate": serialize_mandate(mandate),
        "source_event_id": getattr(source_event, "id", None),
    }
    axes = {
        "company_thesis": {
            "status": company_status,
            "source": company_status_source,
            "fundamental_status": projection.get("fundamental_status"),
            "fundamental_score": projection.get("fundamental_score"),
        },
        "path_timing": {
            "status": path_status,
            "directional_return_pct": directional_return,
            "technical_direction_score": technical_score,
        },
        "market_structure": market_structure,
        "exact_contract": {
            "status": contract_status,
            "otm_pct": otm_pct,
            "expected_move_pct": expected_move_pct,
        },
        "portfolio_fit": {
            "status": portfolio_status,
            "position_share_pct": position_share,
            "direction_share_pct": direction_share,
            "expiry_share_pct": expiry_share,
        },
        "data_quality": {"status": data_quality, "missing_inputs": missing_inputs},
    }
    evidence = [
        {
            "evidence_id": "price_path",
            "source_type": "market_data",
            "as_of": market.get("last_updated") or as_of_dt.isoformat(),
            "signal": path_status,
            "fact": f"Directional underlying return since entry is {directional_return:.2f}%." if directional_return is not None else "Directional return could not be computed.",
        },
        {
            "evidence_id": "technical_state",
            "source_type": "price_history",
            "as_of": as_of_dt.isoformat(),
            "signal": "supportive" if technical_score >= 2 else "adverse" if technical_score <= -2 else "mixed",
            "fact": f"Directional technical score is {technical_score:+d}; it informs path and timing, not business-thesis truth.",
        },
        {
            "evidence_id": "market_field_path",
            "source_type": "causal_market_field",
            "as_of": market_structure.get("as_of_bar") or field_context.get("computed_at") or as_of_dt.isoformat(),
            "signal": field_status,
            "fact": _market_structure_fact(market_structure),
            "advisory": True,
            "rank_influence": 0.0,
        },
        {
            "evidence_id": "fundamental_state",
            "source_type": "cached_stock_fundamentals",
            "as_of": projection.get("as_of") or as_of_dt.isoformat(),
            "signal": projection.get("fundamental_status") or "unavailable",
            "fact": (
                f"Fundamental score is {projection.get('fundamental_score'):+d} across {projection.get('fundamental_signal_count')} signals."
                if isinstance(projection.get("fundamental_score"), int)
                else "Current fundamental signals are unavailable."
            ),
        },
        {
            "evidence_id": "contract_viability",
            "source_type": "option_quote_and_model",
            "as_of": market.get("last_updated") or as_of_dt.isoformat(),
            "signal": contract_status,
            "fact": contract_reasons[0],
        },
    ]
    stable_input = json_dumps({"inputs": input_snapshot, "axes": axes, "vetoes": vetoes, "verdict": verdict, "target": target})
    return {
        "as_of": as_of_dt,
        "grader_version": FIELD_SHADOW_MODEL_VERSION if market_structure.get("available") else GRADER_VERSION,
        "feature_schema_version": (
            FIELD_SHADOW_FEATURE_SCHEMA_VERSION if market_structure.get("available") else FEATURE_SCHEMA_VERSION
        ),
        "input_hash": hashlib.sha256(stable_input.encode("utf-8")).hexdigest(),
        "data_quality_status": data_quality,
        "company_thesis_status": company_status,
        "security_thesis_readiness": security_readiness,
        "path_status": path_status,
        "contract_status": contract_status,
        "portfolio_fit_status": portfolio_status,
        "proposed_verdict": verdict,
        "proposed_target_contracts": target,
        "target_contracts_min": target_min,
        "target_contracts_max": target_max,
        "quality": quality,
        "urgency": urgency,
        "confidence": confidence,
        "continuation_condition": continuation,
        "next_review_date": next_review,
        "decision_deadline": decision_deadline,
        "vetoes": vetoes,
        "reasons": reasons[:4],
        "missing_inputs": missing_inputs,
        "input_snapshot": input_snapshot,
        "axis_results": axes,
        "evidence": evidence,
    }


def persist_assessment(
    db: Session,
    *,
    position: object,
    mandate: OptionPositionMandate,
    payload: dict[str, object],
    trigger: str,
    force: bool = False,
) -> OptionThesisAssessment:
    latest = (
        db.query(OptionThesisAssessment)
        .filter(OptionThesisAssessment.position_id == getattr(position, "id"))
        .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
        .first()
    )
    as_of = payload["as_of"]
    if (
        latest is not None
        and not force
        and latest.input_hash == payload["input_hash"]
        and latest.as_of.date() == as_of.date()
    ):
        return latest
    assessment = OptionThesisAssessment(
        position_id=getattr(position, "id"),
        mandate_id=mandate.id,
        supersedes_assessment_id=latest.id if latest else None,
        trigger=trigger,
        as_of=as_of,
        grader_version=str(payload["grader_version"]),
        feature_schema_version=str(payload["feature_schema_version"]),
        input_hash=str(payload["input_hash"]),
        data_quality_status=str(payload["data_quality_status"]),
        company_thesis_status=str(payload["company_thesis_status"]),
        security_thesis_readiness=str(payload["security_thesis_readiness"]),
        path_status=str(payload["path_status"]),
        contract_status=str(payload["contract_status"]),
        portfolio_fit_status=str(payload["portfolio_fit_status"]),
        proposed_verdict=str(payload["proposed_verdict"]),
        proposed_target_contracts=int(payload["proposed_target_contracts"]),
        target_contracts_min=int(payload["target_contracts_min"]),
        target_contracts_max=int(payload["target_contracts_max"]),
        quality=str(payload["quality"]),
        urgency=str(payload["urgency"]),
        confidence=str(payload["confidence"]),
        continuation_condition=_clean(payload.get("continuation_condition")),
        next_review_date=payload.get("next_review_date"),
        decision_deadline=payload.get("decision_deadline"),
        vetoes_json=json_dumps(payload["vetoes"]),
        reasons_json=json_dumps(payload["reasons"]),
        missing_inputs_json=json_dumps(payload["missing_inputs"]),
        input_snapshot_json=json_dumps(payload["input_snapshot"]),
        axis_results_json=json_dumps(payload["axis_results"]),
        evidence_json=json_dumps(payload["evidence"]),
    )
    db.add(assessment)
    db.flush()
    return assessment


def serialize_assessment(assessment: OptionThesisAssessment | None) -> Optional[dict[str, object]]:
    if assessment is None:
        return None
    return {
        "id": assessment.id,
        "position_id": assessment.position_id,
        "mandate_id": assessment.mandate_id,
        "supersedes_assessment_id": assessment.supersedes_assessment_id,
        "trigger": assessment.trigger,
        "as_of": assessment.as_of.isoformat() if assessment.as_of else None,
        "grader_version": assessment.grader_version,
        "feature_schema_version": assessment.feature_schema_version,
        "data_quality_status": assessment.data_quality_status,
        "company_thesis_status": assessment.company_thesis_status,
        "security_thesis_readiness": assessment.security_thesis_readiness,
        "path_status": assessment.path_status,
        "contract_status": assessment.contract_status,
        "portfolio_fit_status": assessment.portfolio_fit_status,
        "proposed_verdict": assessment.proposed_verdict,
        "proposed_target_contracts": assessment.proposed_target_contracts,
        "target_contracts_min": assessment.target_contracts_min,
        "target_contracts_max": assessment.target_contracts_max,
        "quality": assessment.quality,
        "urgency": assessment.urgency,
        "confidence": assessment.confidence,
        "continuation_condition": assessment.continuation_condition,
        "next_review_date": assessment.next_review_date.isoformat() if assessment.next_review_date else None,
        "decision_deadline": assessment.decision_deadline.isoformat() if assessment.decision_deadline else None,
        "vetoes": json_loads(assessment.vetoes_json, []),
        "reasons": json_loads(assessment.reasons_json, []),
        "missing_inputs": json_loads(assessment.missing_inputs_json, []),
        "input_snapshot": json_loads(assessment.input_snapshot_json, {}),
        "axis_results": json_loads(assessment.axis_results_json, {}),
        "evidence": json_loads(assessment.evidence_json, []),
        "created_at": assessment.created_at.isoformat() if assessment.created_at else None,
    }


def serialize_risk_policy(policy: OptionRiskPolicy) -> dict[str, object]:
    return {
        "id": policy.id,
        "policy_version": policy.policy_version,
        "name": policy.name,
        "active": policy.active,
        "approval_status": policy.approval_status,
        "portfolio_capital": policy.portfolio_capital,
        "default_trade_risk_budget": policy.default_trade_risk_budget,
        "max_single_position_premium_pct": policy.max_single_position_premium_pct,
        "max_directional_premium_pct": policy.max_directional_premium_pct,
        "max_expiry_bucket_premium_pct": policy.max_expiry_bucket_premium_pct,
        "max_option_spread_pct": policy.max_option_spread_pct,
        "min_dte_for_add": policy.min_dte_for_add,
        "settings": json_loads(policy.settings_json, {}),
        "effective_from": policy.effective_from.isoformat() if policy.effective_from else None,
    }
