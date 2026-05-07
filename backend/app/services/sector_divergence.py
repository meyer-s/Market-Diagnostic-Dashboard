from __future__ import annotations

from typing import Iterable

DEFENSIVE_SECTORS = ["XLU", "XLP", "XLV"]
CYCLICAL_SECTORS = ["XLE", "XLF", "XLK", "XLY"]


def compute_alignment_score(system_state: str | None, spread: float) -> float:
    """Map defensive-vs-cyclical spread into a 0-100 alignment score.

    RED regimes prefer defensive leadership, GREEN regimes prefer cyclical
    leadership, and YELLOW regimes reward balance while penalizing extreme bias.
    """
    state = (system_state or "YELLOW").upper()
    if state == "RED":
        score = 50 + spread
    elif state == "GREEN":
        score = 50 - spread
    else:
        score = 70 - (abs(spread) * 1.2)
    return max(0.0, min(100.0, score))


def split_defensive_cyclical_scores(values: Iterable[object]) -> tuple[list[float], list[float]]:
    defensive_scores: list[float] = []
    cyclical_scores: list[float] = []
    for value in values:
        symbol = getattr(value, "sector_symbol", None)
        score_total = getattr(value, "score_total", None)
        if score_total is None:
            continue
        if symbol in DEFENSIVE_SECTORS:
            defensive_scores.append(float(score_total))
        elif symbol in CYCLICAL_SECTORS:
            cyclical_scores.append(float(score_total))
    return defensive_scores, cyclical_scores


def compute_breadth_counts(by_horizon: dict[str, list[dict[str, float | str | int]]]) -> dict[str, int]:
    data_3m = by_horizon.get("3m", [])
    improving = 0
    deteriorating = 0
    for sector in data_3m:
        symbol = sector["symbol"]
        score_3m = float(sector["score"])
        score_6m = float(next((s["score"] for s in by_horizon.get("6m", []) if s["symbol"] == symbol), score_3m))
        score_12m = float(next((s["score"] for s in by_horizon.get("12m", []) if s["symbol"] == symbol), score_3m))
        if score_3m < score_6m < score_12m:
            improving += 1
        elif score_3m > score_6m > score_12m:
            deteriorating += 1
    return {
        "improving": improving,
        "deteriorating": deteriorating,
        "stable": max(0, len(data_3m) - improving - deteriorating),
    }
