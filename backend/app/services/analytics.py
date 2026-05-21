from __future__ import annotations

from typing import Iterable, List, Sequence

import numpy as np


def compute_rolling_z_scores(
    values: Sequence[float],
    lookback: int = 252,
    min_periods: int = 30,
) -> List[float]:
    arr = np.array(values, dtype=float)
    if len(arr) == 0:
        return []

    z_scores: list[float] = []
    for idx in range(len(arr)):
        start = max(0, idx - lookback + 1)
        window = arr[start : idx + 1]
        if len(window) < min_periods:
            window = arr[: idx + 1]
        mean = float(window.mean()) if len(window) else 0.0
        std = float(window.std(ddof=0)) if len(window) else 0.0
        if std == 0:
            z_scores.append(0.0)
        else:
            z_scores.append(float((arr[idx] - mean) / std))
    return z_scores


def compute_z_scores(values: Sequence[float], lookback: int = 252) -> List[float]:
    return compute_rolling_z_scores(values, lookback=lookback)


def direction_adjusted(z_scores: Sequence[float], direction: int) -> List[float]:
    return [(-z if direction == 1 else z) for z in z_scores]


def map_z_to_score(z: float) -> float:
    if z <= -2:
        return 0.0
    if z >= 2:
        return 100.0
    return round(((z + 2.0) / 4.0) * 100.0, 2)


def classify_state(score: float, thresholds: tuple[float, float]) -> str:
    green_max, yellow_max = thresholds
    if score < green_max:
        return "RED"
    if score < yellow_max:
        return "YELLOW"
    return "GREEN"


def normalize_series(raw_values: Sequence[float], direction: int = 1, lookback: int = 252) -> List[float]:
    z_scores = compute_rolling_z_scores(raw_values, lookback=lookback)
    return direction_adjusted(z_scores, direction)


def score_series(z_scores: Iterable[float]) -> List[float]:
    return [map_z_to_score(z) for z in z_scores]


def classify_series(scores: Iterable[float], green_max: float, yellow_max: float) -> List[str]:
    return [classify_state(score, (green_max, yellow_max)) for score in scores]
