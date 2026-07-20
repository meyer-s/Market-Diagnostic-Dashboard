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


def _quarterly(values: list[float], start: str = "2024-01-01") -> pd.Series:
    dates = pd.date_range(start=start, periods=len(values), freq="QS")
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
    assert data["stability_score"] == 100.0 - data["composite_score"]
    assert data["stability_history"]
    assert data["stability_history"][-1]["value"] == round(100.0 - data["composite_history"][-1]["value"], 2)
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


def test_calculate_commercial_real_estate_separates_property_types_and_credit(monkeypatch) -> None:
    rei._COMMERCIAL_CACHE.clear()

    def proxy_fetch(days: int):
        assert days == rei.COMMERCIAL_LONG_CONTEXT_DAYS
        group_slopes = {
            "office": -0.08,
            "industrial": 0.08,
            "retail": 0.04,
            "multifamily": -0.01,
            "digital": 0.12,
        }
        series_map = {
            proxy.code: _series([100 + i * group_slopes[proxy.group] for i in range(180)])
            for proxy in rei.COMMERCIAL_REAL_ESTATE_PROXIES
        }
        availability = [
            {
                "code": proxy.code,
                "name": proxy.name,
                "group": proxy.group,
                "status": "ok",
                "ticker": proxy.ticker,
                "points": len(series_map[proxy.code]),
            }
            for proxy in rei.COMMERCIAL_REAL_ESTATE_PROXIES
        ]
        return series_map, availability, []

    def fred_fetch(days: int):
        assert days == 365
        return {
            "cre_price_yoy": _quarterly([-8.0, -6.0, -4.0, -2.0, 0.5, 1.5, 2.5, 3.5]),
            "cre_price_level": _quarterly([100, 99, 98, 97, 98, 99, 101, 103]),
            "cre_loans": _monthly([2900 + i * 8 for i in range(18)]),
            "cre_delinquency": _quarterly([0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]),
            "treasury_10y": _series([4.0 + i * 0.002 for i in range(180)]),
            "credit_spread": _series([3.5 - i * 0.001 for i in range(180)]),
            "nonres_rent_ppi": _monthly([120 + i * 0.4 for i in range(18)]),
            "rent_cpi_index": _monthly([330 + i * 0.7 for i in range(18)]),
            "office_construction": _monthly([95 - i * 0.8 for i in range(18)]),
            "office_professional_employment": _monthly([100 + i * 0.4 for i in range(18)]),
            "office_financial_employment": _monthly([100 + i * 0.2 for i in range(18)]),
            "office_information_employment": _monthly([100 - i * 0.1 for i in range(18)]),
            "industrial_construction": _monthly([120 + i * 1.2 for i in range(18)]),
            "industrial_production": _monthly([100 + i * 0.3 for i in range(18)]),
            "retail_construction": _monthly([80 + i * 0.2 for i in range(18)]),
            "retail_sales": _monthly([700 + i * 3 for i in range(18)]),
            "multifamily_starts": _monthly([480 - i * 4 for i in range(18)]),
            "multifamily_permits": _monthly([500 - i * 3 for i in range(18)]),
            "multifamily_completions": _monthly([420 + i * 2 for i in range(18)]),
            "multifamily_vacancy": _quarterly([6.5, 6.4, 6.3, 6.2, 6.1, 6.0, 5.9, 5.8]),
            "multifamily_price_level": _quarterly([100, 101, 102, 103, 105, 107, 109, 112]),
            "digital_power_construction": _monthly([135 + i * 1.5 for i in range(18)]),
            "digital_demand_employment": _monthly([100 + i * 0.8 for i in range(18)]),
        }, []

    monkeypatch.setattr(rei, "fetch_commercial_proxy_data", proxy_fetch)
    monkeypatch.setattr(rei, "fetch_commercial_fred_context", fred_fetch)
    monkeypatch.setattr(rei, "datetime", type("FixedDatetime", (), {"utcnow": staticmethod(lambda: datetime(2026, 5, 12))}))

    data = rei.calculate_commercial_real_estate(days=365)

    assert data["regime_label"]
    assert 0 <= data["pressure_score"] <= 100
    assert data["stability_score"] == 100.0 - data["pressure_score"]
    assert {group["group"] for group in data["groups"]} == {
        "office",
        "industrial",
        "retail",
        "multifamily",
        "digital",
    }
    assert len(data["symbols"]) == len(rei.COMMERCIAL_REAL_ESTATE_PROXIES)
    assert data["property_type_history"]
    assert data["metrics"]["cre_loan_growth_yoy"] is not None
    assert data["metrics"]["cre_delinquency_delta_1y"] is not None
    assert {factor["key"] for factor in data["factors"]} == {
        "listed_property_types",
        "loan_performance",
        "property_prices",
        "funding_backdrop",
    }
    assert "Office" in data["summary"]
    assert data["macro"]["cre_price_yoy"]
    assert data["availability"]["available_count"] == data["availability"]["total_configured"]
    assert set(data["sector_context"]) == {
        "office",
        "industrial",
        "retail",
        "multifamily",
        "digital",
    }
    assert data["sector_context"]["office"]["demand_supply"]["demand_index"]
    assert data["sector_context"]["multifamily"]["supply"]["series"][0]["data"]
    assert data["sector_context"]["multifamily"]["price"]["property_price_index"]
    assert data["sector_context"]["industrial"]["price"]["listed_index"]
    assert data["sector_context"]["digital"]["coverage"].startswith("Proxy")


def test_commercial_long_group_history_is_monthly_and_chained() -> None:
    dates = pd.date_range(start="2024-01-01", periods=100, freq="D")
    early = pd.Series([100 + index for index in range(100)], index=dates, dtype="float64")
    later_dates = dates[50:]
    later = pd.Series([100 + index * 0.5 for index in range(50)], index=later_dates, dtype="float64")
    symbol_data = {
        "BXP": {"group": "office"},
        "VNO": {"group": "office"},
    }

    history = rei._build_commercial_long_group_history(
        {"BXP": early, "VNO": later},
        symbol_data,
    )
    office_points = [point for point in history if point.get("office") is not None]

    assert len(office_points) == 4
    assert len({point["date"][:7] for point in office_points}) == len(office_points)
    assert office_points[-1]["office"] > office_points[-2]["office"]
