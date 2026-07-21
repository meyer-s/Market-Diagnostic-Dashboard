from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import market_weather as market_weather_api
from app.services.market_data.provider import UnderlyingQuote
from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.market_weather_research import _build_lexicon_motifs, _select_supported_centroids


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


def test_market_state_lexicon_is_deterministic_and_has_a_stable_schema() -> None:
    first = build_market_weather(_history(), horizons=range(12, 50, 2))["research"]["lexicon"]
    second = build_market_weather(_history(), horizons=range(12, 50, 2))["research"]["lexicon"]

    assert first == second
    assert first["model"] == "Market State Lexicon"
    assert first["version"] == "0.1.0"
    assert first["training_split"]["evaluation_outcomes_used_for_training"] is False
    assert len(first["features"]) == 15
    archetype_count = len(first["archetypes"])
    assert 1 <= archetype_count <= 5
    assert archetype_count == first["training_split"]["archetype_count"]
    assert len({item["id"] for item in first["archetypes"]}) == archetype_count
    assert len({item["token"] for item in first["archetypes"]}) == archetype_count
    assert len({item["signature"] for item in first["archetypes"]}) == archetype_count
    assert all(item["id"].startswith("F.") for item in first["archetypes"])
    assert all(
        item["calibration_count"] >= first["training_split"]["minimum_form_support"]
        for item in first["archetypes"]
    )
    assert len(first["evaluation_sequence"]) == first["training_split"]["evaluation_bars"]
    assert first["current"]["state_id"] in first["grammar"]["state_ids"]
    assert "published market taxonomy" in first["description"]
    assert sum(first["distance_metric"]["family_weights"].values()) == pytest.approx(1.0)
    for family in first["distance_metric"]["family_weights"]:
        family_total = sum(
            item["distance_weight"] for item in first["features"] if item["family"] == family
        )
        assert family_total == pytest.approx(1.0 / 3.0, abs=1e-6)


def test_market_state_lexicon_learns_prototypes_and_grammar_from_calibration_only() -> None:
    history = _history()
    evaluation_start = int(len(history) * 0.60)
    changed_evaluation = history.copy()
    ramp = np.linspace(0.0, 75.0, len(history) - evaluation_start)
    for column in ("Open", "High", "Low", "Close"):
        changed_evaluation.iloc[evaluation_start:, changed_evaluation.columns.get_loc(column)] += ramp
    changed_evaluation.iloc[evaluation_start:, changed_evaluation.columns.get_loc("Volume")] *= 3.0

    baseline = build_market_weather(history, horizons=range(12, 50, 2))["research"]["lexicon"]
    changed = build_market_weather(changed_evaluation, horizons=range(12, 50, 2))["research"]["lexicon"]

    assert baseline["training_split"] == changed["training_split"]
    assert baseline["features"] == changed["features"]
    assert [item["id"] for item in baseline["archetypes"]] == [
        item["id"] for item in changed["archetypes"]
    ]
    assert [item["token"] for item in baseline["archetypes"]] == [
        item["token"] for item in changed["archetypes"]
    ]
    assert [item["centroid"] for item in baseline["archetypes"]] == [
        item["centroid"] for item in changed["archetypes"]
    ]
    assert baseline["grammar"] == changed["grammar"]


def test_market_state_lexicon_probabilities_and_scores_are_finite() -> None:
    lexicon = build_market_weather(_history(), horizons=range(12, 50, 2))["research"]["lexicon"]

    for row_index, row in enumerate(lexicon["grammar"]["probabilities"]):
        assert sum(row) == pytest.approx(1.0, abs=1e-6)
        assert np.isfinite(row).all()
        if len(row) == 1:
            assert row == [1.0]
        else:
            assert row[row_index] == 0.0
            assert all(value > 0.0 for index, value in enumerate(row) if index != row_index)
    for item in lexicon["evaluation_sequence"]:
        assert np.isfinite(item["match"])
        assert np.isfinite(item["novelty"])
        assert np.isfinite(item["transition_surprise"])
        assert 0.0 <= item["match"] <= 1.0
        assert 0.0 <= item["novelty"] <= 1.0
    assert all(np.isfinite(value) for value in lexicon["current"].values() if isinstance(value, float))
    for motif in lexicon["motifs"]:
        assert motif["id"].startswith("P.")
        assert 2 <= motif["length"] <= 4
        assert motif["count"] >= 2
        assert len(motif["states"]) == motif["length"]
        assert motif["outcome_anchor"] == "entry_into_final_form"

    for likely in lexicon["grammar"]["likely_next"]:
        assert likely["support"] >= 0
        if not likely["reliable"]:
            assert likely["to_state"] is None
            assert likely["to_token"] is None
            assert likely["probability"] is None


def test_market_state_lexicon_does_not_fabricate_forms_from_a_flat_field() -> None:
    history = _history(120)
    history.loc[:, "Open"] = 100.0
    history.loc[:, "High"] = 100.0
    history.loc[:, "Low"] = 100.0
    history.loc[:, "Close"] = 100.0
    history.loc[:, "Volume"] = 1_000_000

    lexicon = build_market_weather(history, horizons=range(12, 50, 2))["research"]["lexicon"]

    assert lexicon["training_split"]["archetype_count"] == 1
    assert len(lexicon["archetypes"]) == 1
    assert lexicon["archetypes"][0]["calibration_count"] == lexicon["training_split"]["calibration_bars"]
    assert lexicon["grammar"]["state_ids"] == ["F.001"]
    assert lexicon["training_split"]["warmup_complete"] is False


def test_market_state_lexicon_merges_forms_inside_one_identity_cell() -> None:
    calibration = np.vstack(
        [
            np.full((20, 15), 0.01),
            np.full((20, 15), 0.10),
        ]
    )

    centroids, _ = _select_supported_centroids(calibration, max_clusters=5)

    assert len(centroids) == 1


def test_market_state_phrase_outcomes_start_when_the_final_form_is_entered() -> None:
    motifs = _build_lexicon_motifs(
        assignments=np.asarray([0, 0, 1, 1, 0, 0, 1, 1]),
        evaluation_start=0,
        close=np.asarray([100.0, 101.0, 102.0, 204.0, 205.0, 206.0, 207.0, 414.0, 415.0]),
        state_ids=["F.001", "F.002"],
        state_tokens=["Ranu", "Seki"],
        forward_bars=1,
    )

    phrase = next(item for item in motifs if item["states"] == ["F.001", "F.002"])
    assert phrase["outcome_anchor"] == "entry_into_final_form"
    assert phrase["outcome"]["sample_size"] == 2
    assert phrase["outcome"]["mean_return"] == pytest.approx(1.0)


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
    sequence = payload["research"]["lexicon"]["evaluation_sequence"]
    assert sequence
    assert all(point["date"] in payload["dates"] for point in sequence)
    assert all(0 <= point["index"] < payload["available_bars"] for point in sequence)
    assert payload["research"]["lexicon"]["training_split"]["sequence_scope"] == "visible_response_window"


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
    sequence = payload["research"]["lexicon"]["evaluation_sequence"]
    assert all(point["date"] in payload["dates"] for point in sequence)
    assert all(0 <= point["index"] < payload["available_bars"] for point in sequence)
    assert payload["research"]["lexicon"]["training_split"]["warmup_complete"] is True


def test_market_weather_api_scopes_extreme_buffered_lexicon_to_visible_bars(monkeypatch) -> None:
    class BufferedProvider:
        name = "test-bars"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            return _history(bars)

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name)

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: BufferedProvider())
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/analyze?symbol=SPY&timeframe=1h&bars=60&horizon_min=4&horizon_max=160&horizon_step=4"
    )

    assert response.status_code == 200
    payload = response.json()
    sequence = payload["research"]["lexicon"]["evaluation_sequence"]
    assert payload["available_bars"] == 60
    assert sequence
    assert all(point["date"] in payload["dates"] for point in sequence)
    assert all(0 <= point["index"] < 60 for point in sequence)


def test_market_weather_api_caps_flat_form_age_to_the_visible_response(monkeypatch) -> None:
    class FlatProvider:
        name = "test-bars"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            history = _history(bars)
            history.loc[:, ["Open", "High", "Low", "Close"]] = 100.0
            history.loc[:, "Volume"] = 1_000_000
            return history

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=100.0, source=self.name)

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: FlatProvider())
    app = FastAPI()
    app.include_router(market_weather_api.router)
    payload = TestClient(app).get(
        "/market-weather/analyze?symbol=SPY&timeframe=1D&bars=252"
    ).json()

    current = payload["research"]["lexicon"]["current"]
    assert current["age_bars"] == 252
    assert current["age_truncated"] is True
    assert current["transition_in_visible_window"] is False


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
