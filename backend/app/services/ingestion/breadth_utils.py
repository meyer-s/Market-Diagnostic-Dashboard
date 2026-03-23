from __future__ import annotations

import bisect
from typing import Dict, List, Optional, Tuple

from app.services.analytics_stub import normalize_series

SECTOR_TICKERS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLV", "XLY", "XLU"]

MA_WINDOW = 50       # days for above-MA participation check
RETURN_WINDOW = 20   # trading days for sector return breadth


def compute_sector_breadth_series(
    sector_price_dicts: Dict[str, Dict[str, float]],
    common_dates: List[str],
) -> Tuple[List[float], List[float]]:
    """
    For each date in common_dates, compute two metrics across all available sector ETFs:

    participation_vals  — fraction of sectors with price above their 50-day MA (0–1)
    return_breadth_vals — fraction of sectors with a positive 20-day price return (0–1)

    Returns (participation_vals, return_breadth_vals), each aligned to common_dates.
    """
    # Pre-sort each sector's dates for fast bisect lookups
    sector_sorted: Dict[str, Tuple[List[str], List[Optional[float]]]] = {}
    for ticker, price_dict in sector_price_dicts.items():
        dates_sorted = sorted(price_dict.keys())
        vals = [price_dict[d] for d in dates_sorted]
        sector_sorted[ticker] = (dates_sorted, vals)

    participation_vals: List[float] = []
    return_breadth_vals: List[float] = []

    for date in common_dates:
        above_ma = 0
        positive_ret = 0
        counted_ma = 0
        counted_ret = 0

        for ticker, (dates, vals) in sector_sorted.items():
            # Find the index of the most recent available date <= current date
            idx = bisect.bisect_right(dates, date) - 1
            if idx < 0:
                continue
            current_price = vals[idx]
            if current_price is None:
                continue

            # --- 50-day MA participation ---
            start_ma = max(0, idx - MA_WINDOW + 1)
            ma_prices = [v for v in vals[start_ma : idx + 1] if v is not None]
            if len(ma_prices) >= 10:
                ma_50 = sum(ma_prices) / len(ma_prices)
                if current_price > ma_50:
                    above_ma += 1
                counted_ma += 1

            # --- 20-day return breadth ---
            if idx >= RETURN_WINDOW:
                past_price = vals[idx - RETURN_WINDOW]
                if past_price is not None and past_price > 0:
                    if current_price > past_price:
                        positive_ret += 1
                    counted_ret += 1

        participation_vals.append(above_ma / counted_ma if counted_ma > 0 else 0.5)
        return_breadth_vals.append(positive_ret / counted_ret if counted_ret > 0 else 0.5)

    return participation_vals, return_breadth_vals


def compute_breadth_composite(
    ratio_values: List[float],
    participation_values: List[float],
    return_breadth_values: List[float],
    lookback: int,
    trend_window: int = 30,
    rsp_weight: float = 0.35,
    participation_weight: float = 0.40,
    breadth_weight: float = 0.25,
    direction: int = -1,
) -> List[float]:
    """
    3-component breadth composite:
      • RSP/SPY ratio (35%)  — equal-weight vs cap-weight participation
      • Sector participation (40%) — % of 11 SPDR sectors above their 50-day MA
      • Sector return breadth (25%) — % of sectors with a positive 20-day return

    All three are normalized to 0-100 via z-score before blending.
    direction=-1 means higher values → healthier → higher stability score.
    """
    n = len(ratio_values)
    if n == 0:
        return []

    # RSP/SPY: level + 30-day trend blend
    trend_change = [0.0] * trend_window + [
        ratio_values[i] - ratio_values[i - trend_window]
        for i in range(trend_window, n)
    ]
    rsp_level = normalize_series(ratio_values, direction=direction, lookback=lookback)
    rsp_trend = normalize_series(trend_change, direction=direction, lookback=lookback)
    rsp_component = [0.65 * rsp_level[i] + 0.35 * rsp_trend[i] for i in range(n)]

    # Pad shorter sector series to n if needed (shouldn't happen but guard anyway)
    part = list(participation_values) + [0.5] * max(0, n - len(participation_values))
    brdth = list(return_breadth_values) + [0.5] * max(0, n - len(return_breadth_values))

    part_norm = normalize_series(part[:n], direction=direction, lookback=lookback)
    brdth_norm = normalize_series(brdth[:n], direction=direction, lookback=lookback)

    return [
        rsp_weight * rsp_component[i]
        + participation_weight * part_norm[i]
        + breadth_weight * brdth_norm[i]
        for i in range(n)
    ]


# Keep the old function as an alias for any callers not yet updated
def compute_breadth_composite_z(
    ratio_values: List[float],
    lookback: int,
    trend_window: int = 30,
    level_weight: float = 0.65,
    trend_weight: float = 0.35,
    direction: int = -1,
) -> List[float]:
    n = len(ratio_values)
    if n == 0:
        return []
    trend_change = [0.0] * trend_window + [
        ratio_values[i] - ratio_values[i - trend_window]
        for i in range(trend_window, n)
    ]
    level_norm = normalize_series(ratio_values, direction=direction, lookback=lookback)
    trend_norm = normalize_series(trend_change, direction=direction, lookback=lookback)
    return [level_weight * level_norm[i] + trend_weight * trend_norm[i] for i in range(n)]
