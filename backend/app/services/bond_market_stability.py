from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

from app.services.analytics import compute_z_scores, map_z_to_score
from app.services.ingestion.fred_client import FredClient
from app.utils.data_helpers import find_common_dates, series_to_dict


def _align_series(values_by_date: Dict[str, float], dates: List[str], fallback: float) -> List[float]:
    aligned: list[float] = []
    current = fallback
    for day in dates:
        if day in values_by_date and values_by_date[day] is not None:
            current = values_by_date[day]
        aligned.append(float(current))
    return aligned


def _component_scores(values: List[float], *, invert: bool = False, lookback: int = 252) -> List[float]:
    adjusted = compute_z_scores(values, lookback=min(lookback, len(values)))
    if invert:
        adjusted = [-score for score in adjusted]
    return [map_z_to_score(score) for score in adjusted]


async def build_bond_market_stability_history(
    *,
    start_date: str,
    fred_client: FredClient | None = None,
) -> List[Dict[str, Any]]:
    fred = fred_client or FredClient()
    components = {
        "hy_oas": await fred.fetch_series("BAMLH0A0HYM2", start_date=start_date),
        "ig_oas": await fred.fetch_series("BAMLC0A0CM", start_date=start_date),
        "dgs10": await fred.fetch_series("DGS10", start_date=start_date),
        "dgs2": await fred.fetch_series("DGS2", start_date=start_date),
        "dgs3mo": await fred.fetch_series("DGS3MO", start_date=start_date),
        "dgs30": await fred.fetch_series("DGS30", start_date=start_date),
        "dgs5": await fred.fetch_series("DGS5", start_date=start_date),
    }

    hy_oas = series_to_dict(components["hy_oas"])
    ig_oas = series_to_dict(components["ig_oas"])
    dgs10 = series_to_dict(components["dgs10"])
    dgs2 = series_to_dict(components["dgs2"])
    dgs3mo = series_to_dict(components["dgs3mo"])
    dgs30 = series_to_dict(components["dgs30"])
    dgs5 = series_to_dict(components["dgs5"])

    if not dgs10 or not dgs2 or not dgs3mo:
        return []

    common_dates = find_common_dates(hy_oas, ig_oas, dgs10, dgs2, dgs3mo)
    if dgs30 and dgs5:
        with_long_end = find_common_dates(hy_oas, ig_oas, dgs10, dgs2, dgs3mo, dgs30, dgs5)
        if with_long_end:
            common_dates = with_long_end
    if len(common_dates) < 30:
        return []

    hy_vals = _align_series(hy_oas, common_dates, float(next(iter(hy_oas.values()))))
    ig_vals = _align_series(ig_oas, common_dates, float(next(iter(ig_oas.values()))))
    dgs10_vals = np.array([dgs10[d] for d in common_dates], dtype=float)
    dgs2_vals = np.array([dgs2[d] for d in common_dates], dtype=float)
    dgs3mo_vals = np.array([dgs3mo[d] for d in common_dates], dtype=float)

    credit_scores = [
        (hy + ig) / 2.0
        for hy, ig in zip(_component_scores(hy_vals), _component_scores(ig_vals))
    ]

    curve_10y2y = [float(d10 - d2) for d10, d2 in zip(dgs10_vals, dgs2_vals)]
    curve_10y3m = [float(d10 - d3m) for d10, d3m in zip(dgs10_vals, dgs3mo_vals)]
    curve_30y5y = None
    if dgs30 and dgs5 and all(day in dgs30 and day in dgs5 for day in common_dates):
        curve_30y5y = [float(dgs30[day] - dgs5[day]) for day in common_dates]
        average_curve = [
            (curve_10y2y[idx] + curve_10y3m[idx] + curve_30y5y[idx]) / 3.0
            for idx in range(len(common_dates))
        ]
    else:
        average_curve = [
            (curve_10y2y[idx] + curve_10y3m[idx]) / 2.0
            for idx in range(len(common_dates))
        ]
    curve_scores = _component_scores(average_curve, invert=True)

    def _roc(values: np.ndarray, periods: int = 63) -> List[float]:
        result = [0.0] * len(values)
        for idx in range(periods, len(values)):
            result[idx] = float(values[idx] - values[idx - periods])
        return result

    roc_2y = _roc(dgs2_vals)
    roc_10y = _roc(dgs10_vals)
    momentum_scores = _component_scores(
        [(a + b) / 2.0 for a, b in zip(roc_2y, roc_10y)]
    )

    treasury_vol: list[float] = []
    window = 20
    for idx in range(len(dgs10_vals)):
        history = dgs10_vals[max(0, idx - window + 1) : idx + 1]
        if len(history) <= 1:
            treasury_vol.append(0.0)
            continue
        treasury_vol.append(float(np.std(np.abs(np.diff(history)), ddof=0)))
    vol_scores = _component_scores(treasury_vol)

    weights = {"credit": 0.44, "curve": 0.23, "momentum": 0.17, "volatility": 0.16}
    history: list[Dict[str, Any]] = []
    for idx, date in enumerate(common_dates):
        composite_stress = (
            credit_scores[idx] * weights["credit"]
            + curve_scores[idx] * weights["curve"]
            + momentum_scores[idx] * weights["momentum"]
            + vol_scores[idx] * weights["volatility"]
        )
        history.append(
            {
                "date": date,
                "credit_spread_stress": {
                    "hy_oas": hy_vals[idx],
                    "ig_oas": ig_vals[idx],
                    "stress_score": credit_scores[idx],
                    "stability_score": 100.0 - credit_scores[idx],
                    "weight": weights["credit"],
                    "contribution": credit_scores[idx] * weights["credit"],
                },
                "yield_curve_stress": {
                    "spread_10y2y": curve_10y2y[idx],
                    "spread_10y3m": curve_10y3m[idx],
                    "spread_30y5y": curve_30y5y[idx] if curve_30y5y else None,
                    "stress_score": curve_scores[idx],
                    "stability_score": 100.0 - curve_scores[idx],
                    "weight": weights["curve"],
                    "contribution": curve_scores[idx] * weights["curve"],
                },
                "rates_momentum_stress": {
                    "roc_2y": roc_2y[idx],
                    "roc_10y": roc_10y[idx],
                    "stress_score": momentum_scores[idx],
                    "stability_score": 100.0 - momentum_scores[idx],
                    "weight": weights["momentum"],
                    "contribution": momentum_scores[idx] * weights["momentum"],
                },
                "treasury_volatility_stress": {
                    "calculated_volatility": treasury_vol[idx],
                    "stress_score": vol_scores[idx],
                    "stability_score": 100.0 - vol_scores[idx],
                    "weight": weights["volatility"],
                    "contribution": vol_scores[idx] * weights["volatility"],
                },
                "composite": {
                    "stress_score": composite_stress,
                    "stability_score": 100.0 - composite_stress,
                },
            }
        )
    return history
