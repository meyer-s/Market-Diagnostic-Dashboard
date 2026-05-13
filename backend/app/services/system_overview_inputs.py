from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.services.agriculture_index import calculate_composite_index
from app.services.energy_index import calculate_energy_index
from app.services.real_estate_index import calculate_real_estate_index

logger = logging.getLogger(__name__)

_PAGE_INPUTS: List[Dict[str, Any]] = [
    {
        "code": "AGRICULTURE_STABILITY",
        "name": "Agriculture Stability",
        "source": "DERIVED",
        "source_symbol": "AGRICULTURE_OVERVIEW",
        "category": "market_page",
        "direction": -1,
        "lookback_days_for_z": 365,
        "threshold_green_max": 40.0,
        "threshold_yellow_max": 70.0,
        "weight": 0.6,
        "metadata": {
            "description": "Agriculture Stability summarizes crop leadership, macro pressure, cross-market confirmation, and participation into one 0-100 stability read.",
            "relevance": "Agriculture reacts early to growth, inflation, weather, and input-cost shifts, so it adds a real-economy layer to the system overview without trying to steer the whole model.",
            "impact": "Falling agriculture stability usually points to weaker participation and tighter macro conditions across grains and softs, while rising stability suggests broader resilience.",
            "scoring": "Higher is better. This input uses the agriculture page stability score directly and carries a lighter 0.6 weight because crop markets matter for inflation and real activity, but they are not the main driver of broad-market regime by themselves.",
            "typical_range": "Above 70 is stable, 40 to 69 is mixed, and below 40 is stressed.",
        },
    },
    {
        "code": "ENERGY_STABILITY",
        "name": "Energy Stability",
        "source": "DERIVED",
        "source_symbol": "ENERGY_OVERVIEW",
        "category": "market_page",
        "direction": -1,
        "lookback_days_for_z": 365,
        "threshold_green_max": 40.0,
        "threshold_yellow_max": 70.0,
        "weight": 0.8,
        "metadata": {
            "description": "Energy Stability condenses traditional energy, alternative energy, supply-demand pressure, and fuel-cost transmission into one market-level balance score.",
            "relevance": "Energy conditions feed inflation, growth, and risk appetite, so this input helps the system overview register whether commodity-linked stress is broadening or easing.",
            "impact": "Weak energy stability often shows up through tighter supply, rising fuel pressure, or deteriorating market leadership. Strong readings suggest the complex is absorbing those pressures cleanly.",
            "scoring": "Higher is better. This input uses the energy page composite score directly and carries a medium 0.8 weight because energy shocks can change inflation and growth quickly, but they still overlap with bond, liquidity, and sentiment channels already in the model.",
            "typical_range": "Above 70 is stable, 40 to 69 is mixed, and below 40 is stressed.",
        },
    },
    {
        "code": "REAL_ESTATE_STABILITY",
        "name": "Real Estate Stability",
        "source": "DERIVED",
        "source_symbol": "REAL_ESTATE_OVERVIEW",
        "category": "market_page",
        "direction": -1,
        "lookback_days_for_z": 365,
        "threshold_green_max": 40.0,
        "threshold_yellow_max": 70.0,
        "weight": 1.0,
        "metadata": {
            "description": "Real Estate Stability captures housing and REIT conditions, financing transmission, affordability, and supply balance as one top-level stability input.",
            "relevance": "Real estate is a rate-sensitive bridge between credit conditions and the real economy, so it adds a direct read on whether financing stress is spilling into demand.",
            "impact": "Weak real-estate stability usually means financing or affordability is constraining activity. Stronger readings suggest the market is absorbing rates without broad deterioration.",
            "scoring": "Higher is better. This input converts the real-estate page pressure composite to stability using 100 minus pressure and keeps a full 1.0 weight because housing, rates, credit transmission, and property demand sit much closer to the core cause of broad-market regime shifts.",
            "typical_range": "Above 70 is stable, 40 to 69 is mixed, and below 40 is stressed.",
        },
    },
]

_PAGE_INPUTS_BY_CODE = {entry["code"]: entry for entry in _PAGE_INPUTS}


def _clamp_score(score: Optional[float]) -> Optional[float]:
    if score is None:
        return None
    return round(max(0.0, min(100.0, float(score))), 2)


def score_to_state(score: Optional[float]) -> str:
    if score is None:
        return "UNKNOWN"
    if score >= 70.0:
        return "GREEN"
    if score >= 40.0:
        return "YELLOW"
    return "RED"


def is_page_input(code: str) -> bool:
    return code in _PAGE_INPUTS_BY_CODE


def list_page_input_basic_metadata() -> List[Dict[str, Any]]:
    return [
        {key: value for key, value in entry.items() if key != "metadata"}
        for entry in _PAGE_INPUTS
    ]


def get_page_input_codes() -> List[str]:
    return [entry["code"] for entry in _PAGE_INPUTS]


def get_page_input_weights() -> Dict[str, float]:
    return {entry["code"]: float(entry["weight"]) for entry in _PAGE_INPUTS}


def _build_status(definition: Dict[str, Any], score: Optional[float], timestamp: Optional[str]) -> Optional[Dict[str, Any]]:
    clamped = _clamp_score(score)
    if clamped is None or not timestamp:
        return None
    return {
        "code": definition["code"],
        "name": definition["name"],
        "weight": definition["weight"],
        "raw_value": clamped,
        "score": clamped,
        "state": score_to_state(clamped),
        "timestamp": timestamp,
    }


def _get_agriculture_status(days: int) -> Optional[Dict[str, Any]]:
    data = calculate_composite_index(days=max(days, 90))
    return _build_status(_PAGE_INPUTS_BY_CODE["AGRICULTURE_STABILITY"], data.get("stability_score"), data.get("as_of"))


def _get_energy_status(days: int) -> Optional[Dict[str, Any]]:
    data = calculate_energy_index(days=max(days, 90))
    return _build_status(_PAGE_INPUTS_BY_CODE["ENERGY_STABILITY"], data.get("composite_score"), data.get("as_of"))


def _get_real_estate_status(days: int) -> Optional[Dict[str, Any]]:
    data = calculate_real_estate_index(days=max(days, 90))
    pressure = data.get("composite_score")
    stability = None if pressure is None else 100.0 - float(pressure)
    return _build_status(_PAGE_INPUTS_BY_CODE["REAL_ESTATE_STABILITY"], stability, data.get("as_of"))


_STATUS_BUILDERS = {
    "AGRICULTURE_STABILITY": _get_agriculture_status,
    "ENERGY_STABILITY": _get_energy_status,
    "REAL_ESTATE_STABILITY": _get_real_estate_status,
}


def get_page_input_statuses(days: int = 365) -> List[Dict[str, Any]]:
    statuses: List[Dict[str, Any]] = []
    for code, builder in _STATUS_BUILDERS.items():
        try:
            status = builder(days)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to build overview input %s: %s", code, exc)
            continue
        if status:
            statuses.append(status)
    return statuses


def _history_point(date_value: str, score: Optional[float]) -> Optional[Dict[str, Any]]:
    clamped = _clamp_score(score)
    if clamped is None or not date_value:
        return None
    return {
        "timestamp": f"{date_value}T00:00:00",
        "raw_value": clamped,
        "score": clamped,
        "state": score_to_state(clamped),
    }


def _get_agriculture_history(days: int) -> List[Dict[str, Any]]:
    data = calculate_composite_index(days=max(days, 90))
    history = data.get("component_history", [])
    points = [_history_point(item.get("date", ""), item.get("stability_score")) for item in history]
    return [point for point in points if point is not None]


def _get_energy_history(days: int) -> List[Dict[str, Any]]:
    data = calculate_energy_index(days=max(days, 90))
    history = data.get("composite_history", [])
    points = [_history_point(item.get("date", ""), item.get("value")) for item in history]
    return [point for point in points if point is not None]


def _get_real_estate_history(days: int) -> List[Dict[str, Any]]:
    data = calculate_real_estate_index(days=max(days, 90))
    history = data.get("composite_history", [])
    points = [
        _history_point(item.get("date", ""), None if item.get("value") is None else 100.0 - float(item.get("value")))
        for item in history
    ]
    return [point for point in points if point is not None]


_HISTORY_BUILDERS = {
    "AGRICULTURE_STABILITY": _get_agriculture_history,
    "ENERGY_STABILITY": _get_energy_history,
    "REAL_ESTATE_STABILITY": _get_real_estate_history,
}


def get_page_input_history(code: str, days: int = 365) -> List[Dict[str, Any]]:
    builder = _HISTORY_BUILDERS.get(code)
    if builder is None:
        return []
    try:
        return builder(days)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to build history for overview input %s: %s", code, exc)
        return []


def get_page_input_detail(code: str, days: int = 365) -> Optional[Dict[str, Any]]:
    definition = _PAGE_INPUTS_BY_CODE.get(code)
    if definition is None:
        return None

    latest = next((item for item in get_page_input_statuses(days=days) if item["code"] == code), None)
    payload: Dict[str, Any] = {
        **{key: value for key, value in definition.items() if key != "metadata"},
        "metadata": definition["metadata"],
        "has_data": latest is not None,
    }
    if latest is not None:
        payload["latest"] = {
            "timestamp": latest["timestamp"],
            "raw_value": latest["raw_value"],
            "normalized_value": latest["score"],
            "score": latest["score"],
            "state": latest["state"],
        }
    return payload