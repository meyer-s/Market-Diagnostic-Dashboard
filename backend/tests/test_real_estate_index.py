from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from app.services import real_estate_index as rei


def _series(values: list[float], start: str = "2025-01-01") -> pd.Series:
    dates = pd.date_range(start=start, periods=len(values), freq="D")
    return pd.Series(values, index=dates, dtype="float64")


def _monthly(values: list[float], start: str = "2024-01-01") -> pd.Series:
    dates = pd.date_range(start=start, periods=len(values), freq="MS")
    return pd.Series(values, index=dates, dtype="float64")


def test_equity_pressure_score_inverts_listed_proxy_returns() -> None:
    rising = {"5d": 3.0, "20d": 6.0, "60d": 10.0, "120d": 14.0}
    falling = {"5d": -3.0, "20d": -6.0, "60d": -10.0, "120d": -14.0}

    assert rei.equity_pressure_score(rising) < 50
    assert rei.equity_pressure_score(falling) > 50
    assert rei.equity_pressure_score(falling) > rei.equity_pressure_score(rising)


def test_calculate_real_estate_index_uses_relative_factor_evidence(monkeypatch) -> None:
    rei._CACHE.clear()

    def proxy_fetch(days: int):
        assert days == 365
        down = _series([100 - i * 0.18 for i in range(180)])
        flat = _series([100 + i * 0.01 for i in range(180)])
        series_map = {
            "XHB": down,
            "ITB": down * 0.98,
            "VNQ": flat,
            "IYR": flat * 1.01,
            "XLRE": flat * 0.99,
            "KRE": down * 0.95,
            "MBB": flat,
            "REM": down * 0.90,
        }
        availability = [
            {"code": code, "name": code, "group": "test", "status": "ok", "ticker": code, "points": len(series)}
            for code, series in series_map.items()
        ]
        return series_map, availability, []

    def fred_fetch(days: int):
        assert days == 365
        fred = {
            "mortgage_rate_30y": _series([6.1 + i * 0.01 for i in range(180)]),
            "treasury_10y": _series([4.0 + i * 0.002 for i in range(180)]),
            "credit_spread": _series([3.2 + i * 0.004 for i in range(180)]),
            "housing_starts": _monthly([1500, 1490, 1475, 1450, 1430, 1410, 1390, 1370, 1360, 1340, 1330, 1310]),
            "building_permits": _monthly([1520, 1510, 1500, 1480, 1460, 1440, 1420, 1400, 1380, 1360, 1340, 1320]),
            "completions": _monthly([1400, 1405, 1410, 1400, 1390, 1385, 1375, 1360, 1350, 1340, 1335, 1330]),
            "shelter_cpi_yoy": _monthly([5.5, 5.4, 5.3, 5.2, 5.1, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5, 4.4]),
            "shelter_cpi_index": _monthly([300 + i for i in range(12)]),
            "rent_cpi_yoy": _monthly([6.1, 6.0, 5.9, 5.8, 5.7, 5.5, 5.4, 5.2, 5.0, 4.9, 4.8, 4.7]),
            "rent_cpi_index": _monthly([340 + i * 0.8 for i in range(12)]),
            "housing_cpi_yoy": _monthly([4.8, 4.7, 4.7, 4.6, 4.5, 4.3, 4.2, 4.0, 3.9, 3.8, 3.7, 3.6]),
            "housing_cpi_index": _monthly([280 + i * 0.7 for i in range(12)]),
            "median_housing_cpi_index": _monthly([3.9, 3.8, 3.8, 3.7, 3.6, 3.5, 3.5, 3.4, 3.3, 3.2, 3.2, 3.1]),
            "new_home_sales": _monthly([620, 628, 636, 644, 652, 660, 668, 676, 684, 692, 700, 708]),
            "new_home_sales_yoy": _monthly([1.5, 2.1, 2.5, 3.0, 3.6, 4.1, 4.4, 4.8, 5.2, 5.8, 6.2, 6.8]),
        }
        return fred, []

    monkeypatch.setattr(rei, "fetch_real_estate_proxy_data", proxy_fetch)
    monkeypatch.setattr(rei, "fetch_fred_context", fred_fetch)
    monkeypatch.setattr(rei, "datetime", type("FixedDatetime", (), {"utcnow": staticmethod(lambda: datetime(2026, 5, 12))}))

    data = rei.calculate_real_estate_index(days=365)

    assert data["composite_score"] > 50
    assert data["factors"]
    assert any(factor["key"] == "financing_pressure" for factor in data["factors"])
    assert "pts above" in data["summary"]
    assert "30Y mortgage rates" in data["summary"]
    assert "buyer demand" in data["summary"]
    assert data["metrics"]["mortgage_rate_delta_26w"] is not None
    assert data["metrics"]["new_home_sales_yoy"] is not None
    assert data["context"]["rent_cpi"]
    assert data["context"]["housing_cpi"]
    assert data["context"]["median_housing_cpi"]
    assert data["context"]["new_home_sales"]
