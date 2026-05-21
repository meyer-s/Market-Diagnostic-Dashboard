from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, Optional


def compute_weighted_composite(
    scores_by_code: Dict[str, Optional[float]],
    weights_by_code: Dict[str, float],
    *,
    timestamps_by_code: Optional[Dict[str, Optional[datetime]]] = None,
    as_of: Optional[datetime] = None,
    freshness_horizons_by_code: Optional[Dict[str, int]] = None,
    core_codes: Optional[Iterable[str]] = None,
) -> dict:
    current_time = as_of or datetime.utcnow()
    freshness = freshness_horizons_by_code or {}
    core_code_set = set(core_codes or [])
    expected_codes = sorted(weights_by_code.keys())
    missing_codes = sorted(code for code in expected_codes if scores_by_code.get(code) is None)
    stale_codes = sorted(
        code
        for code in expected_codes
        if (
            scores_by_code.get(code) is not None
            and timestamps_by_code
            and timestamps_by_code.get(code) is not None
            and freshness.get(code) is not None
            and (current_time - timestamps_by_code[code]).days > freshness[code]
        )
    )
    available_scores = {
        code: score for code, score in scores_by_code.items() if score is not None
    }
    if not available_scores:
        return {
            "composite_score": None,
            "weights_used": {},
            "coverage_ratio": 0.0,
            "core_coverage_ratio": 0.0,
            "missing_codes": missing_codes,
            "stale_codes": stale_codes,
            "included_codes": [],
            "expected_codes": expected_codes,
            "confidence": "LOW",
            "state": "UNKNOWN",
        }

    total_weight = sum(weights_by_code.get(code, 0.0) for code in available_scores)
    if total_weight == 0:
        return {
            "composite_score": None,
            "weights_used": {},
            "coverage_ratio": 0.0,
            "core_coverage_ratio": 0.0,
            "missing_codes": missing_codes,
            "stale_codes": stale_codes,
            "included_codes": sorted(available_scores.keys()),
            "expected_codes": expected_codes,
            "confidence": "LOW",
            "state": "UNKNOWN",
        }

    weights_used = {
        code: weights_by_code.get(code, 0.0) / total_weight
        for code in available_scores
    }
    composite = sum(available_scores[code] * weights_used[code] for code in available_scores)
    coverage_ratio = round(len(available_scores) / len(expected_codes), 4) if expected_codes else 0.0
    core_expected = [code for code in expected_codes if code in core_code_set]
    core_available = [code for code in available_scores if code in core_code_set]
    core_coverage_ratio = round(len(core_available) / len(core_expected), 4) if core_expected else 1.0
    missing_core = [code for code in core_expected if code not in core_available]
    stale_core = [code for code in stale_codes if code in core_code_set]

    if core_coverage_ratio < 0.75:
        state = "UNKNOWN"
        confidence = "LOW"
    elif composite >= 70:
        state = "GREEN"
        confidence = "HIGH"
    elif composite >= 40:
        state = "YELLOW"
        confidence = "MEDIUM"
    else:
        state = "RED"
        confidence = "MEDIUM"

    if missing_core or stale_core:
        confidence = "LOW"
    elif stale_codes or coverage_ratio < 0.85:
        confidence = "MEDIUM" if confidence == "HIGH" else confidence

    return {
        "composite_score": composite,
        "weights_used": weights_used,
        "coverage_ratio": coverage_ratio,
        "core_coverage_ratio": core_coverage_ratio,
        "missing_codes": missing_codes,
        "stale_codes": stale_codes,
        "included_codes": sorted(available_scores.keys()),
        "expected_codes": expected_codes,
        "confidence": confidence,
        "state": state,
    }
