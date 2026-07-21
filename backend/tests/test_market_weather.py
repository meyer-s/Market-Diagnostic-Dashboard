from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import market_weather as market_weather_api
from app.services.market_data.provider import UnderlyingQuote
from app.services.market_weather import MarketWeatherSettings, build_market_weather


def _history(count: int = 420) -> pd.DataFrame:
    index = pd.date_range("2024-01-02", periods=count, freq="B")
    phase = np.linspace(0.0, 18.0, count)
    close = 100.0 + np.linspace(0.0, 22.0, count) + 4.0 * np.sin(phase) + 1.2 * np.sin(phase * 3.1)
    return pd.DataFrame(
        {
            "Open": close - 0.35,
            "High": close + 1.15,
            "Low": close - 1.05,
            "Close": close,
            "Volume": 1_000_000 + np.arange(count) * 250,
        },
        index=index,
    )


def test_market_weather_returns_dense_finite_horizon_by_time_channels() -> None:
    result = build_market_weather(_history(), horizons=range(12, 50, 2))

    assert result["orientation"] == "horizon_by_time"
    assert len(result["horizons"]) == 19
    assert len(result["dates"]) == 420
    assert len(result["price"]) == 420
    assert result["summary"]["regime"]
    assert len(result["latest_profile"]) == 19
    assert result["summary"]["permutation_entropy"] >= 0.0
    assert len(result["research"]["derivative_series"]) == 420
    assert len(result["research"]["strata"]["series"]) == 420
    assert len(result["research"]["carriers"]["series"]) == 420
    assert len(result["research"]["relationship_atlas"]) == 4

    for matrix in result["channels"].values():
        values = np.asarray(matrix)
        assert values.shape == (19, 420)
        assert np.isfinite(values).all()

    for name in (
        "structural_strength",
        "boundary_energy",
        "coherence",
        "entropy",
        "persistence",
        "confidence",
        "expansion",
        "contraction",
        "reflectivity",
        "convection",
        "permutation_entropy",
        "propagation_strength",
    ):
        values = np.asarray(result["channels"][name])
        assert values.min() >= 0.0
        assert values.max() <= 1.0


def test_market_weather_has_no_future_leak() -> None:
    history = _history()
    cutoff = 310
    settings = MarketWeatherSettings()
    prefix = build_market_weather(history.iloc[:cutoff], horizons=range(12, 50, 2), settings=settings)
    complete = build_market_weather(history, horizons=range(12, 50, 2), settings=settings)

    assert prefix["dates"][-1] == complete["dates"][cutoff - 1]
    for name in prefix["channels"]:
        prefix_values = np.asarray(prefix["channels"][name])[:, -1]
        complete_values = np.asarray(complete["channels"][name])[:, cutoff - 1]
        np.testing.assert_allclose(prefix_values, complete_values, atol=1e-4)

    for section in ("derivative_series",):
        prefix_row = prefix["research"][section][-1]
        complete_row = complete["research"][section][cutoff - 1]
        assert prefix_row == complete_row
    for section in ("strata", "carriers"):
        prefix_row = prefix["research"][section]["series"][-1]
        complete_row = complete["research"][section]["series"][cutoff - 1]
        assert prefix_row == complete_row


def test_market_weather_log_horizon_geometry_is_resolution_stable() -> None:
    sparse = build_market_weather(_history(), horizons=range(12, 49, 2))
    dense = build_market_weather(_history(), horizons=range(12, 49))

    assert abs(sparse["summary"]["coherence"] - dense["summary"]["coherence"]) < 0.03
    for key in ("structure", "kinematics", "geometry", "information", "propagation"):
        sparse_value = sparse["research"]["strata"]["latest"][key]
        dense_value = dense["research"]["strata"]["latest"][key]
        assert abs(sparse_value - dense_value) < 0.04


def test_relationship_atlas_separates_live_features_from_future_outcome_evaluation() -> None:
    result = build_market_weather(_history(), horizons=range(12, 50, 2))
    research = result["research"]

    assert research["validation"]["design"].startswith("Chronological 60/40")
    assert research["validation"]["multiple_testing_adjusted"] is False
    assert all(item["sample_size"] >= 0 for item in research["relationship_atlas"])
    assert all("not significance tests" in item["method"] for item in research["relationship_atlas"])


def test_market_weather_rejects_insufficient_history() -> None:
    with pytest.raises(ValueError, match="At least 60 daily bars"):
        build_market_weather(_history(40))


def test_market_weather_api_keeps_valid_field_when_live_quote_fails(monkeypatch) -> None:
    class BarsOnlyProvider:
        name = "test-bars"

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            return _history(days)

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            return _history(bars)

        def quote(self, symbol: str) -> UnderlyingQuote:
            raise RuntimeError("quote feed unavailable")

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: BarsOnlyProvider())
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get("/market-weather/analyze?symbol=SPY&timeframe=15m&bars=252")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available_bars"] == 252
    assert payload["timeframe"] == "15m"
    assert payload["bar_size"] == "15 minutes"
    assert payload["quote"]["source"] == "test-bars"
    assert payload["quote"]["price"] == payload["price"][-1]["close"]


def test_market_weather_api_supports_high_resolution_fields(monkeypatch) -> None:
    class HighResolutionProvider:
        name = "test-bars"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            return _history(bars)

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name)

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: HighResolutionProvider())
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/analyze?symbol=SPY&timeframe=1D&bars=750&horizon_min=8&horizon_max=64&horizon_step=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["horizons"]) == 57
    assert payload["available_bars"] == 750
    assert len(payload["channels"]["pressure"]) == 57
    assert len(payload["channels"]["pressure"][0]) == 750


def test_market_weather_api_rejects_excessive_field_size() -> None:
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/analyze?symbol=SPY&timeframe=1D&bars=5000&horizon_min=4&horizon_max=120&horizon_step=1"
    )

    assert response.status_code == 400
    assert "field is too large" in response.json()["detail"]


@pytest.mark.parametrize("timeframe", ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W"])
def test_market_weather_api_accepts_every_supported_timeframe(monkeypatch, timeframe: str) -> None:
    calls: list[tuple[str, int]] = []

    class MultiTimeframeProvider:
        name = "ibkr-test"

        def historical_bars(self, symbol: str, requested_timeframe: str, bars: int = 500) -> pd.DataFrame:
            calls.append((requested_timeframe, bars))
            return _history(bars)

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name, quote_source="delayed")

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: MultiTimeframeProvider())
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(f"/market-weather/analyze?symbol=SPY&timeframe={timeframe}&bars=120")

    assert response.status_code == 200
    assert response.json()["timeframe"] == timeframe
    assert response.json()["available_bars"] == 120
    assert calls == [(timeframe, 216)]
