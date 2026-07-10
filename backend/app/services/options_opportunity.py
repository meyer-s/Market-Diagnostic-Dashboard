from __future__ import annotations

import json
from math import log10
import re
from typing import Any, Optional


OPPORTUNITY_MODEL_VERSION = "heuristic_v1"
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_REWARD_RISK_RE = re.compile(r"Reward/Risk\s*:\s*([0-9]+(?:\.[0-9]+)?)R?", re.IGNORECASE)
_HUMP_EXIT_RE = re.compile(r"Hump\s+Exit\s*:[^\n]*\(([+-]?[0-9]+(?:\.[0-9]+)?)%\)", re.IGNORECASE)
_HUMP_PROB_RE = re.compile(r"Hump\s+Prob\s*:\s*ITM\s*([0-9]+(?:\.[0-9]+)?)%", re.IGNORECASE)
_RISK_CUT_RE = re.compile(r"Risk\s+Cut\s*:[^\n]*\(-?([0-9]+(?:\.[0-9]+)?)%\)", re.IGNORECASE)
_BASE_TGT_RE = re.compile(r"Base\s+Tgt\s*:\s*opt\s*\$?\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
_EST_PREM_RE = re.compile(r"Est\s+Prem\s*:\s*\$?\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:
        return None
    return result


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), digits)


def opportunity_grade(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    if score >= 85:
        return "A+"
    if score >= 75:
        return "A"
    if score >= 65:
        return "B"
    if score >= 50:
        return "C"
    return "Watch"


def selected_contract_signal_fields(selected_contract: Optional[dict[str, Any]]) -> dict[str, object]:
    if not selected_contract:
        return {}
    return {
        "selected_contract_score": selected_contract.get("score"),
        "selected_reward_risk": selected_contract.get("reward_risk"),
        "selected_convexity_profit_pct": selected_contract.get("convexity_profit_pct"),
        "selected_convexity_probability_itm": selected_contract.get("convexity_probability_itm"),
        "selected_planned_loss_pct": selected_contract.get("planned_loss_pct"),
        "selected_target_profit_pct": selected_contract.get("target_profit_pct"),
    }


def extract_opportunity_signals_from_message(message: Optional[str]) -> dict[str, object]:
    if not message:
        return {}
    plain = _ANSI_RE.sub("", message)
    fields: dict[str, object] = {}

    reward_match = _REWARD_RISK_RE.search(plain)
    if reward_match:
        fields["selected_reward_risk"] = _to_float(reward_match.group(1))

    hump_match = _HUMP_EXIT_RE.search(plain)
    if hump_match:
        fields["selected_convexity_profit_pct"] = _to_float(hump_match.group(1))

    probability_match = _HUMP_PROB_RE.search(plain)
    if probability_match:
        probability_pct = _to_float(probability_match.group(1))
        fields["selected_convexity_probability_itm"] = (
            probability_pct / 100.0 if probability_pct is not None else None
        )

    loss_match = _RISK_CUT_RE.search(plain)
    if loss_match:
        fields["selected_planned_loss_pct"] = _to_float(loss_match.group(1))

    target_match = _BASE_TGT_RE.search(plain)
    premium_match = _EST_PREM_RE.search(plain)
    if target_match and premium_match:
        target = _to_float(target_match.group(1))
        premium = _to_float(premium_match.group(1))
        if target is not None and premium is not None and premium > 0:
            fields["selected_target_profit_pct"] = ((target / premium) - 1.0) * 100.0

    return {key: value for key, value in fields.items() if value is not None}


def event_opportunity_signal_fields(event: Any) -> dict[str, object]:
    message_fields = extract_opportunity_signals_from_message(getattr(event, "message", None))
    fields = {
        "selected_contract_score": getattr(event, "selected_contract_score", None),
        "selected_reward_risk": getattr(event, "selected_reward_risk", None),
        "selected_convexity_profit_pct": getattr(event, "selected_convexity_profit_pct", None),
        "selected_convexity_probability_itm": getattr(event, "selected_convexity_probability_itm", None),
        "selected_planned_loss_pct": getattr(event, "selected_planned_loss_pct", None),
        "selected_target_profit_pct": getattr(event, "selected_target_profit_pct", None),
    }
    for key, value in message_fields.items():
        if fields.get(key) is None:
            fields[key] = value
    return fields


def opportunity_fields_from_event(event: Any) -> dict[str, object]:
    selected_fields = event_opportunity_signal_fields(event)
    score = compute_opportunity_score(
        iv_percentile=getattr(event, "iv_percentile", None),
        iv30=getattr(event, "iv30", None),
        hv30=getattr(event, "hv30", None),
        avg_edr=getattr(event, "avg_edr", None),
        selected_spread_pct=getattr(event, "selected_spread_pct", None),
        selected_open_interest=getattr(event, "selected_open_interest", None),
        selected_volume=getattr(event, "selected_volume", None),
        selected_reward_risk=selected_fields.get("selected_reward_risk"),
        selected_convexity_profit_pct=selected_fields.get("selected_convexity_profit_pct"),
        selected_convexity_probability_itm=selected_fields.get("selected_convexity_probability_itm"),
        selected_contract_score=selected_fields.get("selected_contract_score"),
    )
    return {
        **selected_fields,
        "opportunity_score": score["base_score"],
        "opportunity_grade": opportunity_grade(float(score["base_score"])),
        "opportunity_model_version": OPPORTUNITY_MODEL_VERSION,
        "opportunity_components": json.dumps(score, sort_keys=True),
    }


def compute_opportunity_score(
    *,
    iv_percentile: Any = None,
    iv30: Any = None,
    hv30: Any = None,
    avg_edr: Any = None,
    selected_spread_pct: Any = None,
    selected_open_interest: Any = None,
    selected_volume: Any = None,
    selected_reward_risk: Any = None,
    selected_convexity_profit_pct: Any = None,
    selected_convexity_probability_itm: Any = None,
    selected_contract_score: Any = None,
    symbol_recent_hits: int = 0,
    symbol_total_hits: int = 0,
    group_recent_hits: int = 0,
) -> dict[str, object]:
    """Build an explainable cross-hit opportunity score.

    The model is intentionally decomposed so later ML calibration can tune the
    component weights without changing the stored input contract.
    """
    iv_pct = _to_float(iv_percentile)
    iv = _to_float(iv30)
    hv = _to_float(hv30)
    edr = _to_float(avg_edr)
    spread_pct = _to_float(selected_spread_pct)
    open_interest = _to_float(selected_open_interest)
    volume = _to_float(selected_volume)
    reward_risk = _to_float(selected_reward_risk)
    convexity_profit_pct = _to_float(selected_convexity_profit_pct)
    convexity_probability = _to_float(selected_convexity_probability_itm)
    contract_score_raw = _to_float(selected_contract_score)

    cheapness = 45.0 if iv_pct is None else _clamp((30.0 - iv_pct) / 30.0 * 100.0)

    spread_edge = None
    if iv is not None and hv is not None:
        spread_edge = _clamp((hv - iv) / 20.0 * 100.0)
    edr_edge = None if edr is None else _clamp((55.0 - edr) / 35.0 * 100.0)
    edge_inputs = [value for value in (spread_edge, edr_edge) if value is not None]
    volatility_edge = sum(edge_inputs) / len(edge_inputs) if edge_inputs else 45.0

    rr_score = None if reward_risk is None else _clamp(reward_risk / 2.0 * 100.0)
    convexity_score = None if convexity_profit_pct is None else _clamp(convexity_profit_pct / 100.0 * 100.0)
    probability_score = (
        None
        if convexity_probability is None
        else _clamp((convexity_probability - 0.35) / 0.30 * 100.0)
    )
    contract_model_score = None if contract_score_raw is None else _clamp((contract_score_raw + 2.0) / 8.0 * 100.0)
    contract_inputs = [
        value
        for value in (rr_score, convexity_score, probability_score, contract_model_score)
        if value is not None
    ]
    contract_quality = sum(contract_inputs) / len(contract_inputs) if contract_inputs else 45.0

    spread_quality = None if spread_pct is None else _clamp(100.0 - (spread_pct / 45.0 * 100.0))
    liquidity_quality = None
    if open_interest is not None or volume is not None:
        liquidity_quality = _clamp(log10(max(0.0, open_interest or 0.0) + max(0.0, volume or 0.0) + 10.0) / 4.0 * 100.0)
    execution_inputs = [value for value in (spread_quality, liquidity_quality) if value is not None]
    execution_quality = sum(execution_inputs) / len(execution_inputs) if execution_inputs else 50.0

    recurrence = _clamp(
        min(max(int(symbol_recent_hits or 0), 0), 4) * 18.0
        + min(max(int(symbol_total_hits or 0) - 1, 0), 5) * 4.0
        + min(max(int(group_recent_hits or 0) - int(symbol_recent_hits or 0), 0), 6) * 3.0
    )

    base_score = (
        cheapness * 0.30
        + volatility_edge * 0.28
        + contract_quality * 0.27
        + execution_quality * 0.15
    )
    rank_score = _clamp(base_score + recurrence * 0.12)

    components = {
        "cheapness": _round(cheapness),
        "volatility_edge": _round(volatility_edge),
        "contract_quality": _round(contract_quality),
        "execution_quality": _round(execution_quality),
        "recurrence": _round(recurrence),
    }
    inputs = {
        "iv_percentile": _round(iv_pct),
        "iv30": _round(iv),
        "hv30": _round(hv),
        "avg_edr": _round(edr),
        "selected_spread_pct": _round(spread_pct),
        "selected_open_interest": _round(open_interest, 0),
        "selected_volume": _round(volume, 0),
        "selected_reward_risk": _round(reward_risk),
        "selected_convexity_profit_pct": _round(convexity_profit_pct),
        "selected_convexity_probability_itm": _round(convexity_probability, 4),
        "selected_contract_score": _round(contract_score_raw),
        "symbol_recent_hits": int(symbol_recent_hits or 0),
        "symbol_total_hits": int(symbol_total_hits or 0),
        "group_recent_hits": int(group_recent_hits or 0),
    }
    reasons = []
    if iv_pct is not None:
        reasons.append(f"IV pct {iv_pct:.1f}")
    if iv is not None and hv is not None:
        reasons.append(f"IV/HV {iv - hv:+.1f} pts")
    if reward_risk is not None:
        reasons.append(f"RR {reward_risk:.2f}")
    if convexity_profit_pct is not None:
        reasons.append(f"convexity {convexity_profit_pct:.0f}%")
    if symbol_recent_hits:
        reasons.append(f"{int(symbol_recent_hits)} recent symbol hits")

    return {
        "model_version": OPPORTUNITY_MODEL_VERSION,
        "base_score": round(base_score, 2),
        "rank_score": round(rank_score, 2),
        "grade": opportunity_grade(rank_score),
        "components": components,
        "inputs": inputs,
        "reasons": reasons[:5],
    }


def opportunity_event_fields(
    *,
    iv_percentile: Any = None,
    iv30: Any = None,
    hv30: Any = None,
    avg_edr: Any = None,
    selected_contract: Optional[dict[str, Any]] = None,
) -> dict[str, object]:
    selected_fields = selected_contract_signal_fields(selected_contract)
    score = compute_opportunity_score(
        iv_percentile=iv_percentile,
        iv30=iv30,
        hv30=hv30,
        avg_edr=avg_edr,
        selected_spread_pct=(selected_contract or {}).get("spread_pct"),
        selected_open_interest=(selected_contract or {}).get("open_interest"),
        selected_volume=(selected_contract or {}).get("volume"),
        selected_reward_risk=selected_fields.get("selected_reward_risk"),
        selected_convexity_profit_pct=selected_fields.get("selected_convexity_profit_pct"),
        selected_convexity_probability_itm=selected_fields.get("selected_convexity_probability_itm"),
        selected_contract_score=selected_fields.get("selected_contract_score"),
    )
    return {
        **selected_fields,
        "opportunity_score": score["base_score"],
        "opportunity_grade": opportunity_grade(float(score["base_score"])),
        "opportunity_model_version": OPPORTUNITY_MODEL_VERSION,
        "opportunity_components": json.dumps(score, sort_keys=True),
    }
