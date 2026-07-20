from __future__ import annotations

from datetime import date, datetime
import math
from typing import Any, Optional


REPLACEMENT_MODEL_VERSION = "replacement_rules_v1"

# These gates deliberately require a material improvement before contract drift
# becomes a replacement candidate. Closed-trade learning may later calibrate the
# thresholds, but it must not silently rewrite them from a small sample.
FRESH_ENTRY_SCORE_FLOOR = 50.0
MATERIAL_SCORE_EDGE = 10.0
MIN_DTE_EXTENSION = 14
MAX_EXECUTABLE_SPREAD_PCT = 25.0
WINNER_HARVEST_PNL_PCT = 10.0
LOSING_POSITION_PNL_PCT = -5.0
MIN_CONVEXITY_PROFIT_PCT = 40.0
MIN_CONVEXITY_PROBABILITY = 0.40


def _finite(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _date(value: object) -> Optional[date]:
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


def _nested(payload: object, *path: str) -> object:
    current = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _contract_label(option_type: str, strike: Optional[float], expiry: Optional[date]) -> str:
    type_label = option_type.upper() if option_type else "OPTION"
    strike_label = f" ${strike:g}" if strike is not None else ""
    expiry_label = f" · {expiry.isoformat()}" if expiry is not None else ""
    return f"{type_label}{strike_label}{expiry_label}"


def _gate(key: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"key": key, "label": label, "status": status, "detail": detail}


def _structure(
    *,
    option_type: str,
    held_expiry: Optional[date],
    held_strike: Optional[float],
    candidate_expiry: Optional[date],
    candidate_strike: Optional[float],
) -> dict[str, str]:
    if held_expiry is None or candidate_expiry is None:
        expiry_direction = "unknown"
    elif candidate_expiry > held_expiry:
        expiry_direction = "out"
    elif candidate_expiry < held_expiry:
        expiry_direction = "in"
    else:
        expiry_direction = "same"

    if held_strike is None or candidate_strike is None:
        strike_direction = "unknown"
    elif candidate_strike > held_strike + 0.005:
        strike_direction = "up"
    elif candidate_strike < held_strike - 0.005:
        strike_direction = "down"
    else:
        strike_direction = "same"

    if strike_direction in {"same", "unknown"}:
        directional_hurdle = strike_direction
    elif (option_type == "call" and strike_direction == "up") or (
        option_type == "put" and strike_direction == "down"
    ):
        directional_hurdle = "higher"
    else:
        directional_hurdle = "lower"

    if expiry_direction == "out":
        label = {
            "up": "Up and out",
            "down": "Down and out",
            "same": "Straight out",
        }.get(strike_direction, "Later-dated replacement")
    elif expiry_direction == "same":
        label = "Same-expiry strike switch" if strike_direction != "same" else "Same contract"
    elif expiry_direction == "in":
        label = "Shorter-dated switch"
    else:
        label = "Contract comparison incomplete"

    return {
        "expiry_direction": expiry_direction,
        "strike_direction": strike_direction,
        "directional_hurdle": directional_hurdle,
        "label": label,
    }


def classify_option_replacement(
    *,
    position: object,
    event: object,
    candidate_score: Optional[float],
    held_baseline_score: Optional[float],
    repeat_count: int,
    latest_assessment: Optional[dict[str, object]] = None,
    latest_decision: Optional[dict[str, object]] = None,
) -> dict[str, object]:
    """Classify a same-symbol scanner contract as decision support.

    This function never treats a roll as a continuation of the original trade.
    A qualified result still means close/journal the held leg, then underwrite a
    new position. It also never marks a result implementation-ready because the
    scanner payload is not a live executable two-leg quote.
    """

    held_option_type = str(getattr(position, "option_type", "") or "").strip().lower()
    candidate_option_type = str(getattr(event, "selected_option_type", "") or "").strip().lower()
    held_expiry = _date(getattr(position, "expiration", None))
    candidate_expiry = _date(getattr(event, "selected_expiry", None))
    held_strike = _finite(getattr(position, "strike", None))
    candidate_strike = _finite(getattr(event, "selected_strike", None))
    event_at = _date(getattr(event, "triggered_at", None)) or date.today()
    structure = _structure(
        option_type=held_option_type,
        held_expiry=held_expiry,
        held_strike=held_strike,
        candidate_expiry=candidate_expiry,
        candidate_strike=candidate_strike,
    )

    snapshot = (
        latest_assessment.get("input_snapshot", {})
        if isinstance(latest_assessment, dict)
        else {}
    )
    held_current_score = _finite(_nested(snapshot, "opportunity", "current", "score"))
    held_score = held_current_score if held_current_score is not None else _finite(held_baseline_score)
    candidate_score_value = _finite(candidate_score)
    score_edge = (
        round(candidate_score_value - held_score, 2)
        if candidate_score_value is not None and held_score is not None
        else None
    )

    held_pnl_pct = _finite(_nested(snapshot, "market", "pnl_percent"))
    held_spread_pct = _finite(_nested(snapshot, "market", "spread_pct"))
    held_delta = _finite(_nested(snapshot, "market", "delta"))
    held_theta = _finite(_nested(snapshot, "market", "theta_per_day_per_contract"))
    held_contract_status = (
        str(latest_assessment.get("contract_status") or "unknown")
        if isinstance(latest_assessment, dict)
        else "unknown"
    )
    company_status = (
        str(latest_assessment.get("company_thesis_status") or "unknown")
        if isinstance(latest_assessment, dict)
        else "unknown"
    )
    path_status = (
        str(latest_assessment.get("path_status") or "unknown")
        if isinstance(latest_assessment, dict)
        else "unknown"
    )
    latest_verdict = str((latest_decision or {}).get("verdict") or "unknown")
    target_contracts = (latest_decision or {}).get("target_contracts")

    held_dte = max((held_expiry - event_at).days, 0) if held_expiry else None
    candidate_dte = _finite(getattr(event, "selected_dte", None))
    if candidate_dte is None and candidate_expiry is not None:
        candidate_dte = float(max((candidate_expiry - event_at).days, 0))
    dte_extension = (
        round(candidate_dte - held_dte, 0)
        if candidate_dte is not None and held_dte is not None
        else None
    )
    strike_change = (
        round(candidate_strike - held_strike, 4)
        if candidate_strike is not None and held_strike is not None
        else None
    )

    candidate_spread_pct = _finite(getattr(event, "selected_spread_pct", None))
    candidate_premium = _finite(getattr(event, "selected_premium", None))
    candidate_reward_risk = _finite(getattr(event, "selected_reward_risk", None))
    candidate_convexity_profit = _finite(getattr(event, "selected_convexity_profit_pct", None))
    candidate_convexity_probability = _finite(
        getattr(event, "selected_convexity_probability_itm", None)
    )
    candidate_contract_score = _finite(getattr(event, "selected_contract_score", None))

    candidate_liquid = (
        candidate_spread_pct is not None
        and candidate_spread_pct <= MAX_EXECUTABLE_SPREAD_PCT
    )
    held_liquid = held_spread_pct is not None and held_spread_pct <= MAX_EXECUTABLE_SPREAD_PCT
    score_qualifies = candidate_score_value is not None and candidate_score_value >= FRESH_ENTRY_SCORE_FLOOR
    edge_qualifies = score_edge is not None and score_edge >= MATERIAL_SCORE_EDGE
    persistent = repeat_count >= 2
    sufficiently_later = dte_extension is not None and dte_extension >= MIN_DTE_EXTENSION
    convexity_supported = bool(
        candidate_convexity_profit is not None
        and candidate_convexity_probability is not None
        and candidate_convexity_profit >= MIN_CONVEXITY_PROFIT_PCT
        and candidate_convexity_probability >= MIN_CONVEXITY_PROBABILITY
    )

    gates: list[dict[str, str]] = []
    gates.append(
        _gate(
            "structure",
            "Structure",
            "pass" if sufficiently_later else "fail",
            f"{structure['label']}; {int(dte_extension):+d} calendar days"
            if dte_extension is not None
            else f"{structure['label']}; expiry comparison unavailable",
        )
    )
    gates.append(
        _gate(
            "fresh_entry",
            "Fresh-entry edge",
            "pass" if score_qualifies and edge_qualifies else "watch" if score_qualifies else "fail",
            (
                f"Candidate {candidate_score_value:.1f}; held {held_score:.1f}; edge {score_edge:+.1f}"
                if candidate_score_value is not None and held_score is not None and score_edge is not None
                else f"Candidate {candidate_score_value:.1f}; held score unavailable"
                if candidate_score_value is not None
                else "Candidate score unavailable"
            ),
        )
    )
    gates.append(
        _gate(
            "persistence",
            "Scanner persistence",
            "pass" if persistent else "watch",
            f"{repeat_count} post-entry scanner occurrence{'s' if repeat_count != 1 else ''}",
        )
    )
    execution_status = (
        "pass"
        if candidate_liquid and held_liquid
        else "fail"
        if candidate_spread_pct is not None and candidate_spread_pct > MAX_EXECUTABLE_SPREAD_PCT
        else "watch"
    )
    execution_bits = []
    execution_bits.append(
        f"held {held_spread_pct:.1f}%" if held_spread_pct is not None else "held spread missing"
    )
    execution_bits.append(
        f"candidate {candidate_spread_pct:.1f}%"
        if candidate_spread_pct is not None
        else "candidate spread missing"
    )
    gates.append(_gate("execution", "Two-leg execution", execution_status, " · ".join(execution_bits)))
    gates.append(
        _gate(
            "convexity",
            "Convexity harvest",
            "pass" if convexity_supported else "watch",
            (
                f"{candidate_convexity_profit:.0f}% modeled harvest · "
                f"{candidate_convexity_probability * 100:.0f}% ITM probability"
                if candidate_convexity_profit is not None and candidate_convexity_probability is not None
                else "Candidate convexity inputs incomplete"
            ),
        )
    )

    missing_inputs = ["live two-leg quote", "candidate delta/gamma/theta/vega", "catalyst alignment"]
    if held_current_score is None:
        missing_inputs.append("fresh held-contract score")
    if held_pnl_pct is None:
        missing_inputs.append("fresh held-contract P/L")
    if held_spread_pct is None:
        missing_inputs.append("fresh held-contract spread")
    if candidate_spread_pct is None:
        missing_inputs.append("candidate spread")

    status = "watch"
    recommendation = "watch_replacement"
    action = "compare"
    label = "Watch replacement"
    summary = "The scanner prefers a different contract, but the replacement has not cleared every gate."

    direction_changed = bool(
        held_option_type
        and candidate_option_type
        and held_option_type != candidate_option_type
    )
    thesis_invalid = company_status in {"broken", "retired"}
    portfolio_reduction = bool(
        latest_verdict in {"close", "reduce"}
        or (
            latest_verdict != "replacement_candidate"
            and isinstance(target_contracts, int)
            and target_contracts < int(getattr(position, "contracts", 0) or 0)
        )
    )
    losing_higher_hurdle = bool(
        held_pnl_pct is not None
        and held_pnl_pct <= LOSING_POSITION_PNL_PCT
        and structure["directional_hurdle"] == "higher"
    )
    harvest_setup = bool(
        held_pnl_pct is not None
        and held_pnl_pct >= WINNER_HARVEST_PNL_PCT
        and structure["directional_hurdle"] == "higher"
        and sufficiently_later
        and score_qualifies
        and persistent
        and candidate_liquid
        and convexity_supported
        and (score_edge is None or score_edge >= -3.0)
    )
    roll_out_setup = bool(
        sufficiently_later
        and structure["directional_hurdle"] in {"same", "lower"}
        and score_qualifies
        and edge_qualifies
        and persistent
        and candidate_liquid
        and not thesis_invalid
        and not portfolio_reduction
        and (
            held_contract_status in {"marginal", "nonviable"}
            or (held_dte is not None and held_dte <= 21)
            or latest_verdict == "replacement_candidate"
        )
    )

    if direction_changed:
        status = "rejected"
        recommendation = "direction_change"
        action = "none"
        label = "Not a roll"
        summary = "The scanner changed option direction; this is a new thesis, not a replacement."
    elif structure["expiry_direction"] == "in":
        status = "rejected"
        recommendation = "shorter_dated_switch"
        action = "none"
        label = "Shorter-dated switch"
        summary = "The candidate removes time instead of extending the decision horizon."
    elif structure["expiry_direction"] == "same":
        status = "watch"
        recommendation = "strike_switch"
        action = "compare"
        label = "Strike-switch review"
        summary = "This changes strike exposure without extending the expiry; evaluate it as a fresh contract switch."
    elif thesis_invalid:
        status = "rejected"
        recommendation = "no_replacement"
        action = "none"
        label = "No replacement"
        summary = "The latest company-thesis assessment is invalid; more time does not repair the thesis."
    elif portfolio_reduction and latest_verdict != "replacement_candidate":
        status = "rejected"
        recommendation = "portfolio_reduction_conflict"
        action = "none"
        label = "Reduction takes priority"
        summary = "The active decision calls for less exposure, so the scanner hit is evidence—not permission to re-add it."
    elif losing_higher_hurdle:
        status = "rejected"
        recommendation = "rescue_roll_rejected"
        action = "none"
        label = "Rescue roll rejected"
        summary = "The held contract is losing and the proposed strike raises the directional hurdle; extra time alone is insufficient."
    elif harvest_setup:
        status = "candidate"
        recommendation = "convexity_harvest_candidate"
        action = "partial_replace"
        label = "Convexity-harvest candidate"
        summary = "A winning position may fund a smaller up-and-out replacement while retaining convex upside."
    elif roll_out_setup:
        status = "candidate"
        recommendation = "roll_out_candidate"
        action = "replace_after_close"
        label = "Roll-out candidate"
        summary = "The later contract materially improves the fresh-entry score without increasing the directional hurdle."
    elif not score_qualifies:
        status = "rejected"
        recommendation = "candidate_below_entry_floor"
        action = "none"
        label = "Replacement rejected"
        summary = "The scanner contract does not clear the minimum fresh-entry score."
    elif candidate_spread_pct is not None and not candidate_liquid:
        status = "rejected"
        recommendation = "execution_rejected"
        action = "none"
        label = "Execution rejects roll"
        summary = "The candidate spread is too wide for the expected edge to be trusted."
    elif not persistent or not edge_qualifies or not sufficiently_later:
        status = "watch"
        recommendation = "watch_replacement"
        action = "compare"
        label = "Watch replacement"
        summary = "The candidate is directionally compatible, but persistence, score improvement, or time extension is not yet material."

    confidence = "medium" if held_current_score is not None and candidate_spread_pct is not None else "low"
    if status == "candidate" and not held_liquid:
        status = "watch"
        recommendation = "watch_replacement"
        action = "compare"
        label = "Watch replacement"
        summary = "The contract comparison is promising, but the held-leg execution cost is missing or too wide."

    return {
        "model_version": REPLACEMENT_MODEL_VERSION,
        "status": status,
        "recommendation": recommendation,
        "action": action,
        "label": label,
        "summary": summary,
        "confidence": confidence,
        "implementation_ready": False,
        "thresholds": {
            "fresh_entry_score_floor": FRESH_ENTRY_SCORE_FLOOR,
            "material_score_edge": MATERIAL_SCORE_EDGE,
            "minimum_dte_extension": MIN_DTE_EXTENSION,
            "maximum_spread_pct": MAX_EXECUTABLE_SPREAD_PCT,
            "winner_harvest_pnl_pct": WINNER_HARVEST_PNL_PCT,
        },
        "structure": structure,
        "comparison": {
            "held": {
                "position_id": getattr(position, "id", None),
                "contract": _contract_label(held_option_type, held_strike, held_expiry),
                "expiry": held_expiry.isoformat() if held_expiry else None,
                "strike": held_strike,
                "option_type": held_option_type or None,
                "dte": held_dte,
                "score": held_score,
                "score_source": "latest_assessment" if held_current_score is not None else "entry_scanner",
                "pnl_pct": held_pnl_pct,
                "spread_pct": held_spread_pct,
                "delta": held_delta,
                "theta_per_day_per_contract": held_theta,
                "contract_status": held_contract_status,
                "path_status": path_status,
                "verdict": latest_verdict,
            },
            "candidate": {
                "event_id": getattr(event, "id", None),
                "contract": _contract_label(candidate_option_type, candidate_strike, candidate_expiry),
                "expiry": candidate_expiry.isoformat() if candidate_expiry else None,
                "strike": candidate_strike,
                "option_type": candidate_option_type or None,
                "dte": int(candidate_dte) if candidate_dte is not None else None,
                "score": candidate_score_value,
                "premium": candidate_premium,
                "spread_pct": candidate_spread_pct,
                "reward_risk": candidate_reward_risk,
                "contract_score": candidate_contract_score,
                "convexity_profit_pct": candidate_convexity_profit,
                "convexity_probability_itm": candidate_convexity_probability,
            },
            "change": {
                "dte": int(dte_extension) if dte_extension is not None else None,
                "strike": strike_change,
                "score": score_edge,
            },
        },
        "gates": gates,
        "missing_inputs": missing_inputs,
        "journal_rule": (
            "Close and journal the held contract first. Any replacement is a new trade "
            "with its own mandate, size, review window and decision deadline."
        ),
        "automated_execution_enabled": False,
    }
