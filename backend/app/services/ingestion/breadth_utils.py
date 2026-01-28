from __future__ import annotations

from typing import List

from app.services.analytics_stub import normalize_series


def compute_breadth_composite_z(
    ratio_values: List[float],
    lookback: int,
    trend_window: int = 30,
    level_weight: float = 0.65,
    trend_weight: float = 0.35,
    direction: int = -1,
) -> List[float]:
    if not ratio_values:
        return []

    trend_change = []
    for i in range(len(ratio_values)):
        if i < trend_window:
            trend_change.append(0.0)
        else:
            trend_change.append(ratio_values[i] - ratio_values[i - trend_window])

    level_norm = normalize_series(ratio_values, direction=direction, lookback=lookback)
    trend_norm = normalize_series(trend_change, direction=direction, lookback=lookback)

    return [
        (level_weight * level_norm[i]) + (trend_weight * trend_norm[i])
        for i in range(len(ratio_values))
    ]
