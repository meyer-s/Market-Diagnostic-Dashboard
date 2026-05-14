from __future__ import annotations

import pandas as pd

from app.services import energy_index as energy


def _series(values: list[float], start: str = "2025-01-01") -> pd.Series:
    dates = pd.date_range(start=start, periods=len(values), freq="D")
    return pd.Series(values, index=dates, dtype="float64")


def test_energy_stability_falls_when_large_directional_move_increases_pressure(monkeypatch) -> None:
    energy._CACHE.clear()

    calm = _series([100 + 0.05 * i for i in range(220)])
    shock = _series([100 + 0.05 * i for i in range(180)] + [110 + 0.7 * i for i in range(40)])

    def futures_fetch(days: int):
        assert days == 365
        series_map = {
            "CL": shock,
            "BZ": shock * 1.01,
            "NG": shock * 0.7,
            "RB": shock * 0.02,
            "HO": shock * 0.021,
            "EH": calm * 0.015,
            "ZL": calm * 0.4,
        }
        availability = [
            {"code": code, "name": code, "group": "test", "status": "ok", "ticker": code, "points": len(series)}
            for code, series in series_map.items()
        ]
        return series_map, availability, []

    monkeypatch.setattr(energy, "fetch_energy_futures_data", futures_fetch)
    monkeypatch.setattr(energy, "fetch_alt_energy_data", lambda days: {})
    monkeypatch.setattr(energy, "fetch_fred_prices", lambda days: {})

    data = energy.calculate_energy_index(days=365)

    assert data["composite_score"] > 50
    assert data["stability_score"] < 50
    assert data["stability_score"] < data["composite_score"]
    assert data["stability_history"]
