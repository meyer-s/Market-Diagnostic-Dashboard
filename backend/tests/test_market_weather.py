from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import market_weather as market_weather_api
from app.services import market_weather_research
from app.services.market_data.provider import UnderlyingQuote
from app.services.market_weather import (
    MarketWeatherSettings,
    _ewm_rows as field_ewm_rows,
    build_market_weather,
)
from app.services.market_weather_analysis_cache import reset_market_weather_analysis_cache
from app.services.market_weather_history_cache import (
    MarketWeatherHistoryCacheMetadata,
    MarketWeatherHistoryResult,
)
from app.services.market_weather_research import (
    SCALING_NEGATIVE_TOLERANCE,
    _build_lexicon_motifs,
    _ewm_rows as research_ewm_rows,
    _log_horizon_scaling_exponent,
    _rolling_realized_volatility,
    _scaling_reference_quality,
    _select_supported_centroids,
)


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


def _direct_test_history(
    provider: object,
    symbol: str,
    timeframe: str,
    bars: int = 500,
    *,
    minimum_rows: int = 60,
    **_kwargs: object,
) -> MarketWeatherHistoryResult:
    if timeframe == "1D" and callable(getattr(provider, "daily_bars", None)):
        method = "daily_bars"
        frame = provider.daily_bars(symbol, days=bars)
    else:
        method = "historical_bars"
        history_fetcher = getattr(provider, method)
        frame = history_fetcher(symbol, timeframe, bars=bars)
    source_resolver = getattr(provider, "source_for", None)
    source = (
        str(source_resolver(method))
        if callable(source_resolver)
        else str(getattr(provider, "name", "test"))
    )
    metadata = MarketWeatherHistoryCacheMetadata(
        status="refreshed",
        symbol=symbol,
        timeframe=timeframe,
        storage_interval=timeframe.lower(),
        requested_rows=bars,
        minimum_rows=min(bars, minimum_rows),
        returned_rows=len(frame),
        cached_rows_before=0,
        fetched_rows=len(frame),
        inserted_rows=len(frame),
        provider_called=True,
        stale=False,
        refresh_reason="test_direct",
        ttl_seconds=0,
        age_seconds=0.0,
        last_updated_at=None,
        data_source=source,
    )
    return MarketWeatherHistoryResult(frame=frame, metadata=metadata)


@pytest.fixture(autouse=True)
def _isolate_market_weather_api_caches(monkeypatch: pytest.MonkeyPatch):
    reset_market_weather_analysis_cache()
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "0")
    monkeypatch.setattr(
        market_weather_api,
        "get_or_refresh_market_weather_history",
        _direct_test_history,
    )
    yield
    reset_market_weather_analysis_cache()


def test_ewm_missing_row_contract_is_explicit_and_shared() -> None:
    values = np.asarray([[1.0, np.nan, 3.0]])
    # pandas 2.2.3, pinned in production: the missing observation advances the
    # absolute position while ignore_na=False; the post-gap value is 7/3.
    expected = np.asarray([[1.0, 1.0, 7.0 / 3.0]])

    np.testing.assert_allclose(field_ewm_rows(values, span=3), expected)
    np.testing.assert_allclose(research_ewm_rows(values, span=3), expected)


def test_market_weather_returns_dense_finite_horizon_by_time_channels() -> None:
    result = build_market_weather(_history(), horizons=range(12, 50, 2))

    assert result["semantic_revision"] == "1.3"
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
    assert len(result["research"]["carriers"]["ratios"]["series"]) == 420
    assert "1.0 means equal" in result["research"]["carriers"]["ratios"]["baseline"]
    assert all(
        np.isfinite(value) and value >= 0.0
        for value in result["research"]["carriers"]["ratios"]["latest"].values()
    )
    assert len(result["research"]["relationship_atlas"]) == 4
    assert result["history_context"]["status"] == "complete"
    assert result["history_context"]["warmup_complete"] is True
    assert result["history_context"]["minimum_observed_window_bars"] == 49
    assert result["history_context"]["minimum_valid_bars"] == 60
    assert result["history_context"]["minimum_required_bars"] == 60
    assert result["history_context"]["minimum_input_bars"] == 60
    assert result["history_context"]["minimum_input_satisfied"] is True
    assert result["history_context"]["initialization_target_bars"] == 96
    assert result["history_context"]["initialization_target_covered"] is True
    assert result["history_context"]["initialization_status"] == "target_covered"
    assert "not an EWM convergence guarantee" in result["history_context"]["initialization_note"]
    assert result["input_quality"]["status"] == "valid"
    assert len(result["research"]["structure_components"]["series"]) == 420
    assert len(result["research"]["scaling_reference"]["series"]) == 420
    assert result["research"]["scaling_reference"]["exact_arithmetic_contract"] == {
        "nonnegative": True,
        "floating_point_tolerance": SCALING_NEGATIVE_TOLERANCE,
        "defensive_storage_bounds": [-2.0, 2.0],
        "violation_status": "invalid",
        "note": result["research"]["scaling_reference"]["exact_arithmetic_contract"]["note"],
    }
    coverage = result["research"]["initialization_coverage"]
    assert coverage == result["history_context"]["state_vector_coverage"]
    assert coverage["schema_version"] == "market_field_coordinate_coverage_v1"
    assert coverage["coordinate_count"] == 15
    assert coverage["analysis_bars"] == 420
    assert coverage["maximum_horizon_bars"] == 48
    assert coverage["initialization_target_bars"] == 96
    assert coverage["initialization_target_covered"] is True
    assert coverage["all_latest_measured"] is True
    assert coverage["all_latest_rolling_depth_support"] is True
    assert coverage["all_latest_full_dependency_support"] is True
    assert coverage["coverage_is_convergence"] is False
    assert [row["id"] for row in coverage["features"]] == [
        "pressure",
        "velocity",
        "acceleration",
        "jerk",
        "snap",
        "structure",
        "kinematics",
        "geometry",
        "information",
        "propagation",
        "cascade_bias",
        "scaling_exponent",
        "realized_volatility_carrier",
        "participation_carrier",
        "liquidity_stress_carrier",
    ]
    assert all(row["latest_measured"] is True for row in coverage["features"])
    assert all(row["latest_computable"] is True for row in coverage["features"])
    assert all(row["latest_internal_finite"] is True for row in coverage["features"])
    assert all(
        row["latest_full_dependency_support"] is True
        for row in coverage["features"]
    )
    assert all(row["initialization_target_covered"] is True for row in coverage["features"])
    assert all(row["status"] == "target_covered" for row in coverage["features"])
    assert all(row["retained_prefix_bars"] == 420 for row in coverage["features"])
    assert all(
        row["minimum_rolling_support_satisfied"] is True
        and row["bars_needed_to_minimum_rolling_support"] == 0
        for row in coverage["features"]
    )
    features_by_id = {row["id"]: row for row in coverage["features"]}
    for row in coverage["features"]:
        assert row["first_computable_index"] == 0
        assert row["first_rolling_depth_support_index"] == (
            row["minimum_rolling_support_bars"] - 1
        )
        assert row["first_full_dependency_support_index"] == (
            row["minimum_rolling_support_bars"] - 1
        )
        assert row["first_measured_index"] == (
            row["minimum_rolling_support_bars"] - 1
        )
    assert (
        features_by_id["snap"]["minimum_rolling_support_bars"]
        > features_by_id["pressure"]["minimum_rolling_support_bars"]
    )
    assert features_by_id["pressure"]["required_inputs"] == [
        "open",
        "high",
        "low",
        "close",
    ]
    assert features_by_id["participation_carrier"]["required_inputs"] == [
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]
    assert features_by_id["liquidity_stress_carrier"]["required_inputs"] == [
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]
    assert "not a numerical-convergence certificate" in coverage["note"]

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


def test_scaling_reference_rejects_materially_negative_exponents() -> None:
    exponent = np.asarray([-0.2, 0.25, -SCALING_NEGATIVE_TOLERANCE / 2.0, 0.35])
    realized_volatility = np.ones((3, len(exponent)), dtype=float)
    per_horizon = np.tile(exponent, (3, 1))
    # A positive aggregate cannot hide a pointwise contract violation.
    per_horizon[0, 1] = -0.1

    valid, reason, reported = _scaling_reference_quality(
        exponent,
        realized_volatility,
        per_horizon,
    )

    assert valid.tolist() == [False, False, True, True]
    assert reason.tolist() == [
        "negative_exponent_violates_exact_arithmetic_contract",
        "negative_exponent_violates_exact_arithmetic_contract",
        None,
        None,
    ]
    assert reported.tolist() == [-0.2, 0.25, 0.0, 0.35]


def test_scaling_construction_is_nonnegative_for_nested_windows_and_zero_for_one_horizon() -> None:
    rng = np.random.default_rng(20260722)
    close = pd.Series(100.0 * np.exp(np.cumsum(rng.normal(0.0002, 0.012, 480))))
    horizons = [4, 7, 12, 20, 33, 55]
    realized = _rolling_realized_volatility(close, horizons)
    exponent = _log_horizon_scaling_exponent(realized, horizons)

    assert float(np.min(exponent)) >= -SCALING_NEGATIVE_TOLERANCE
    np.testing.assert_array_equal(
        _log_horizon_scaling_exponent(realized[[0]], [horizons[0]]),
        np.zeros_like(realized[[0]]),
    )


def test_scaling_construction_rejects_unsorted_or_repeated_horizons() -> None:
    realized = np.ones((3, 8), dtype=float)

    with pytest.raises(ValueError, match="strictly increasing"):
        _log_horizon_scaling_exponent(realized, [4, 4, 8])
    with pytest.raises(ValueError, match="strictly increasing"):
        _log_horizon_scaling_exponent(realized, [8, 4, 12])


def test_impossible_scaling_value_cannot_influence_learned_outputs(monkeypatch) -> None:
    original = market_weather_research._log_horizon_scaling_exponent

    def inject_contract_violation(realized_volatility, horizons):
        values = original(realized_volatility, horizons)
        values[0, len(values[0]) // 2] = -0.25
        return values

    monkeypatch.setattr(
        market_weather_research,
        "_log_horizon_scaling_exponent",
        inject_contract_violation,
    )

    research = build_market_weather(_history(), horizons=range(12, 50, 2))["research"]

    assert research["relationship_atlas"] == []
    assert research["validation"] == {
        "included": False,
        "reason": "scaling_exponent_quality_failure",
        "invalid_bars": 1,
    }
    assert research["lexicon"] == {
        "included": False,
        "reason": "scaling_exponent_quality_failure",
        "invalid_bars": 1,
    }
    invalid_rows = [row for row in research["scaling_reference"]["series"] if not row["valid"]]
    assert any(
        row["reason"] == "negative_exponent_violates_exact_arithmetic_contract"
        for row in invalid_rows
    )


def test_initialization_target_never_falls_below_minimum_input() -> None:
    result = build_market_weather(_history(60), horizons=[8, 12])
    context = result["history_context"]

    assert context["minimum_input_bars"] == 60
    assert context["minimum_input_satisfied"] is True
    assert context["initialization_target_bars"] == 60
    assert context["initialization_target_covered"] is True
    assert context["initialization_status"] == "target_covered"


def test_sixty_bar_coverage_separates_finite_startup_from_full_support() -> None:
    result = build_market_weather(_history(60), horizons=range(12, 50, 2))
    coverage = result["research"]["initialization_coverage"]
    features = {row["id"]: row for row in coverage["features"]}

    assert coverage["analysis_bars"] == 60
    assert coverage["initialization_target_bars"] == 96
    assert coverage["initialization_target_covered"] is False
    assert coverage["all_latest_rolling_depth_support"] is True
    assert coverage["all_latest_full_dependency_support"] is True
    assert coverage["all_latest_measured"] is True

    for coordinate, minimum_support in (
        ("pressure", 49),
        ("snap", 53),
        ("scaling_exponent", 49),
        ("realized_volatility_carrier", 49),
        ("participation_carrier", 48),
        ("liquidity_stress_carrier", 49),
    ):
        row = features[coordinate]
        assert row["minimum_rolling_support_bars"] == minimum_support
        assert row["first_computable_index"] == 0
        assert row["first_rolling_depth_support_index"] == minimum_support - 1
        assert row["first_full_dependency_support_index"] == minimum_support - 1
        assert row["first_measured_index"] == minimum_support - 1
        assert row["rolling_depth_support_observations"] == 60 - minimum_support + 1
        assert row["full_dependency_support_observations"] == 60 - minimum_support + 1
        assert row["measured_observations"] == 60 - minimum_support + 1
        assert row["latest_full_dependency_support"] is True
        assert row["latest_measured"] is True
        assert row["status"] == "provisional"


def test_analysis_identity_hashes_separate_recipe_from_normalized_input() -> None:
    history = _history(120)
    same = history.rename(columns=str.lower).sort_index(ascending=False)
    first = build_market_weather(
        history,
        horizons=[8, 12],
        include_retrospective_research=False,
    )["provenance"]
    repeated = build_market_weather(
        same,
        horizons=[8, 12],
        include_retrospective_research=False,
    )["provenance"]

    assert first["schema_version"] == "market_field_analysis_identity_v1"
    assert first["scope"] == "recipe_and_normalized_input_identity"
    assert first["provider_truth_verified"] is False
    assert "not correctness" in first["note"]
    assert "provider immutability" in first["note"]
    assert first["input_schema"] == "normalized_ohlcv_float_hex_v1"
    assert first["recipe_hash"] == repeated["recipe_hash"]
    assert first["input_hash"] == repeated["input_hash"]
    assert first["analysis_hash"] == repeated["analysis_hash"]
    assert all(
        len(first[key]) == 64 and set(first[key]) <= set("0123456789abcdef")
        for key in ("recipe_hash", "input_hash", "analysis_hash")
    )

    changed_input = history.copy()
    changed_input.iloc[-1, changed_input.columns.get_loc("Close")] += 0.01
    input_variant = build_market_weather(
        changed_input,
        horizons=[8, 12],
        include_retrospective_research=False,
    )["provenance"]
    assert input_variant["recipe_hash"] == first["recipe_hash"]
    assert input_variant["input_hash"] != first["input_hash"]
    assert input_variant["analysis_hash"] != first["analysis_hash"]

    recipe_variant = build_market_weather(
        history,
        horizons=[8, 12, 16],
        include_retrospective_research=False,
    )["provenance"]
    assert recipe_variant["input_hash"] == first["input_hash"]
    assert recipe_variant["recipe_hash"] != first["recipe_hash"]
    assert recipe_variant["analysis_hash"] != first["analysis_hash"]
    assert "data_source" not in first


def test_volume_dependent_ratios_are_unavailable_without_positive_volume() -> None:
    history = _history().drop(columns=["Volume"])

    result = build_market_weather(history, horizons=range(12, 50, 2))
    carriers = result["research"]["carriers"]

    assert carriers["availability"] == {
        "realized_volatility": True,
        "participation": False,
        "liquidity_stress": False,
        "available_volume_observations": 0,
        "positive_volume_observations": 0,
        "volume_coverage": 0.0,
    }
    assert np.isfinite(carriers["ratios"]["latest"]["realized_volatility"])
    assert carriers["ratios"]["latest"]["participation"] is None
    assert carriers["ratios"]["latest"]["liquidity_stress"] is None
    assert all(point["participation"] is None for point in carriers["ratios"]["series"])
    assert all(point["liquidity_stress"] is None for point in carriers["ratios"]["series"])
    assert carriers["latest"]["participation"] == 0.5
    assert carriers["latest"]["liquidity_stress"] == 0.5
    assert result["input_quality"]["volume"]["available"] is False
    assert result["input_quality"]["volume"]["coverage"] == 0.0
    assert all(point["volume"] is None for point in result["price"])
    coverage = {
        row["id"]: row
        for row in result["research"]["initialization_coverage"]["features"]
    }
    assert coverage["realized_volatility_carrier"]["latest_measured"] is True
    for coordinate in ("participation_carrier", "liquidity_stress_carrier"):
        assert coverage[coordinate]["latest_measured"] is False
        assert coverage[coordinate]["latest_rolling_depth_support"] is True
        assert coverage[coordinate]["latest_full_dependency_support"] is False
        assert coverage[coordinate]["latest_source_observed"] is False
        assert coverage[coordinate]["latest_internal_finite"] is True
        assert coverage[coordinate]["first_computable_index"] == 0
        assert coverage[coordinate]["first_rolling_depth_support_index"] == (
            coverage[coordinate]["minimum_rolling_support_bars"] - 1
        )
        assert coverage[coordinate]["first_full_dependency_support_index"] is None
        assert coverage[coordinate]["full_dependency_support_observations"] == 0
        assert coverage[coordinate]["first_measured_index"] is None
        assert coverage[coordinate]["first_source_observed_index"] is None
        assert coverage[coordinate]["source_observed_observations"] == 0
        assert coverage[coordinate]["measured_observations"] == 0
        assert coverage[coordinate]["latest_uses_neutral_placeholder"] is True
        assert coverage[coordinate]["status"] == "unavailable"


def test_mixed_invalid_volume_is_excluded_without_losing_participation_signal() -> None:
    history = _history(140)
    history.iloc[20, history.columns.get_loc("Volume")] = np.nan
    history.iloc[40, history.columns.get_loc("Volume")] = -1.0
    history.iloc[60, history.columns.get_loc("Volume")] = np.inf

    result = build_market_weather(history, horizons=range(12, 50, 2))
    carriers = result["research"]["carriers"]
    quality = result["input_quality"]["volume"]

    assert quality["available_observations"] == 137
    assert quality["invalid_observations"] == 3
    assert quality["coverage"] == pytest.approx(137 / 140, abs=1e-6)
    assert carriers["availability"]["participation"] is True
    assert carriers["availability"]["liquidity_stress"] is True
    assert carriers["availability"]["available_volume_observations"] == 137
    assert carriers["ratios"]["latest"]["participation"] is not None
    assert carriers["ratios"]["latest"]["liquidity_stress"] is not None
    assert result["price"][20]["volume"] is None
    assert result["price"][40]["volume"] is None
    assert result["price"][60]["volume"] is None


def test_all_invalid_volume_values_remain_unavailable() -> None:
    history = _history(120)
    history["Volume"] = np.full(len(history), np.nan)

    result = build_market_weather(history, horizons=range(12, 50, 2))
    carriers = result["research"]["carriers"]
    quality = result["input_quality"]["volume"]

    assert quality["available"] is False
    assert quality["carrier_usable"] is False
    assert quality["available_observations"] == 0
    assert quality["invalid_observations"] == 120
    assert quality["coverage"] == 0.0
    assert carriers["availability"]["participation"] is False
    assert carriers["availability"]["liquidity_stress"] is False
    assert carriers["ratios"]["latest"]["participation"] is None
    assert carriers["ratios"]["latest"]["liquidity_stress"] is None
    assert carriers["latest"]["participation"] == 0.5
    assert carriers["latest"]["liquidity_stress"] == 0.5


def test_trailing_missing_volume_becomes_unavailable_not_false_low_participation() -> None:
    history = _history(140)
    history.iloc[-60:, history.columns.get_loc("Volume")] = np.nan

    result = build_market_weather(history, horizons=range(12, 50, 2))
    carriers = result["research"]["carriers"]
    quality = result["input_quality"]["volume"]

    assert quality["available_observations"] == 80
    assert quality["invalid_observations"] == 60
    assert quality["coverage"] == pytest.approx(80 / 140, abs=1e-6)
    assert carriers["availability"]["participation"] is False
    assert carriers["availability"]["liquidity_stress"] is False
    assert carriers["ratios"]["latest"]["participation"] is None
    assert carriers["ratios"]["latest"]["liquidity_stress"] is None
    assert carriers["latest"]["participation"] == 0.5
    assert carriers["latest"]["liquidity_stress"] == 0.5
    assert result["price"][-1]["volume"] is None


def test_market_weather_drops_invalid_ohlc_and_reports_input_quality() -> None:
    history = _history(65)
    changed_index = history.index.astype(object).tolist()
    changed_index[0] = pd.NaT
    history.index = changed_index
    history.iloc[1, history.columns.get_loc("Open")] = np.inf
    history.iloc[2, history.columns.get_loc("Close")] = 0.0
    history.iloc[3, history.columns.get_loc("High")] = history.iloc[3]["Low"] - 1.0
    history.iloc[4, history.columns.get_loc("Volume")] = -1.0

    result = build_market_weather(history, horizons=range(12, 50, 2))
    quality = result["input_quality"]

    assert len(result["dates"]) == 61
    assert quality["status"] == "limited"
    assert quality["rows_received"] == 65
    assert quality["rows_used"] == 61
    assert quality["dropped"] == {
        "bad_timestamp": 1,
        "nonfinite_ohlc": 1,
        "nonpositive_ohlc": 1,
        "inconsistent_ohlc": 1,
        "duplicate_timestamp": 0,
    }
    assert quality["volume"]["invalid_observations"] == 1
    assert quality["volume"]["available_observations"] == 60
    assert "invalid_price_rows_dropped" in quality["warnings"]


def test_market_weather_accepts_epsilon_ohlc_noise_but_rejects_real_inconsistency() -> None:
    history = _history(64)
    first_close = float(history.iloc[0]["Close"])
    second_open = float(history.iloc[1]["Open"])
    history.iloc[0, history.columns.get_loc("High")] = np.nextafter(first_close, -np.inf)
    history.iloc[1, history.columns.get_loc("Low")] = np.nextafter(second_open, np.inf)
    history.iloc[2, history.columns.get_loc("High")] = float(history.iloc[2]["Close"]) - 1e-5

    result = build_market_weather(history, horizons=range(12, 50, 2))

    assert result["input_quality"]["dropped"]["inconsistent_ohlc"] == 1
    assert result["input_quality"]["rows_used"] == 63
    assert result["dates"][0] == pd.Timestamp(history.index[0]).isoformat()
    assert result["dates"][1] == pd.Timestamp(history.index[1]).isoformat()
    assert pd.Timestamp(history.index[2]).isoformat() not in result["dates"]


def test_flat_field_exposes_component_baselines_and_degenerate_scaling() -> None:
    history = _history(120)
    history.loc[:, ["Open", "High", "Low", "Close"]] = 100.0
    result = build_market_weather(history, horizons=range(12, 50, 2))

    components = result["research"]["structure_components"]
    scaling = result["research"]["scaling_reference"]
    assert components["latest"] == {
        "activity": 0.0,
        "horizon_agreement": 1.0,
        "trend_agreement_composite": 0.42,
        "display_organization": 0.68,
    }
    assert components["changes_v1_state_vector"] is False
    assert scaling["stationary_finite_variance_reference"] == 0.5
    assert scaling["latest_exponent"] == 0.0
    assert scaling["latest_excess"] is None
    assert scaling["valid"] is False
    assert scaling["reason"] == "zero_realized_variance"


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
    assert (
        prefix["research"]["carriers"]["ratios"]["series"][-1]
        == complete["research"]["carriers"]["ratios"]["series"][cutoff - 1]
    )


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
    assert all(feature["fit_median"] == feature["calibration_median"] for feature in first["features"])
    assert all(
        feature["fit_robust_scale"] == feature["calibration_robust_scale"]
        for feature in first["features"]
    )
    assert first["distance_metric"]["deprecated_aliases"]["calibration_median"] == "fit_median"
    archetype_count = len(first["archetypes"])
    assert 1 <= archetype_count <= 5
    assert archetype_count == first["training_split"]["archetype_count"]
    assert len({item["id"] for item in first["archetypes"]}) == archetype_count
    assert len({item["token"] for item in first["archetypes"]}) == archetype_count
    assert len({item["signature"] for item in first["archetypes"]}) == archetype_count
    assert all(item["id"].startswith("F.") for item in first["archetypes"])
    assert all(
        item["fit_count"] >= first["training_split"]["minimum_form_support"]
        for item in first["archetypes"]
    )
    assert first["training_split"]["minimum_form_support"] >= 20
    assert first["training_split"]["calibration_independent_from_fit"] is True
    assert first["training_split"]["fit_end_index"] < first["training_split"]["calibration_start_index"]
    assert first["training_split"]["calibration_start_index"] < int(len(_history()) * 0.60)
    if archetype_count > 1:
        assert (
            first["training_split"]["fit_mean_silhouette"]
            >= first["training_split"]["minimum_mean_silhouette"]
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


def test_market_state_lexicon_learns_prototypes_and_grammar_from_proper_fit_only() -> None:
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


def test_market_state_distance_reference_is_held_out_from_model_fit() -> None:
    history = _history()
    baseline = build_market_weather(history, horizons=range(12, 50, 2))["research"]["lexicon"]
    calibration_start = baseline["training_split"]["calibration_start_index"]
    evaluation_start = baseline["training_split"]["evaluation_start_index"]
    changed_calibration = history.copy()
    ramp = np.linspace(0.0, 125.0, evaluation_start - calibration_start)
    for column in ("Open", "High", "Low", "Close"):
        changed_calibration.iloc[
            calibration_start:evaluation_start,
            changed_calibration.columns.get_loc(column),
        ] += ramp
    changed_calibration.iloc[
        calibration_start:evaluation_start,
        changed_calibration.columns.get_loc("Volume"),
    ] *= 4.0

    changed = build_market_weather(
        changed_calibration,
        horizons=range(12, 50, 2),
    )["research"]["lexicon"]

    assert baseline["features"] == changed["features"]
    assert baseline["training_split"] == changed["training_split"]
    assert baseline["grammar"] == changed["grammar"]
    for key in ("id", "token", "signature", "centroid", "fit_count"):
        assert [item[key] for item in baseline["archetypes"]] == [
            item[key] for item in changed["archetypes"]
        ]


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
        assert item["resonance_index"] == item["match"]
        assert item["calibration_distance_tail_rank"] == item["distance_tail_score"]
        assert item["calibration_distance_support"] == item["distance_tail_support"]
        assert item["calibration_distance_scope"] == item["distance_tail_scope"]
        assert item["in_extreme_calibration_distance_tail"] == item["outside_learned_range"]
        if item["distance_tail_score"] is None:
            assert item["distance_tail_support"] < lexicon["distance_metric"]["minimum_distance_tail_support"]
            assert item["distance_tail_scope"] == "unavailable"
            assert item["outside_learned_range"] is None
        else:
            assert np.isfinite(item["distance_tail_score"])
            assert 0.0 < item["distance_tail_score"] <= 1.0
            assert item["distance_tail_support"] >= lexicon["distance_metric"]["minimum_distance_tail_support"]
            assert item["distance_tail_scope"] == "state_conditional"
            assert item["outside_learned_range"] is (
                item["distance_tail_score"] < lexicon["distance_metric"]["outside_range_cutoff"]
            )
    assert all(np.isfinite(value) for value in lexicon["current"].values() if isinstance(value, float))
    current = lexicon["current"]
    assert current["resonance_index"] == current["match"]
    assert current["calibration_distance_tail_rank"] == current["distance_tail_score"]
    assert current["calibration_distance_support"] == current["distance_tail_support"]
    assert current["calibration_distance_scope"] == current["distance_tail_scope"]
    assert current["in_extreme_calibration_distance_tail"] == current["outside_learned_range"]
    if current["distance_tail_score"] is None:
        assert current["distance_tail_support"] < lexicon["distance_metric"]["minimum_distance_tail_support"]
        assert current["distance_tail_scope"] == "unavailable"
        assert current["outside_learned_range"] is None
    else:
        assert 0.0 < current["distance_tail_score"] <= 1.0
        assert current["distance_tail_support"] >= lexicon["distance_metric"]["minimum_distance_tail_support"]
        assert current["distance_tail_scope"] == "state_conditional"
        assert current["outside_learned_range"] is (
            current["distance_tail_score"] < lexicon["distance_metric"]["outside_range_cutoff"]
        )
    assert lexicon["distance_metric"]["coverage_guarantee"] is False
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
    assert lexicon["archetypes"][0]["fit_count"] == lexicon["training_split"]["fit_bars"]
    assert lexicon["archetypes"][0]["calibration_count"] == lexicon["training_split"]["calibration_bars"]
    assert lexicon["grammar"]["state_ids"] == ["F.001"]
    assert lexicon["training_split"]["warmup_complete"] is False


def test_market_state_distance_tail_is_unavailable_below_same_state_support_floor() -> None:
    lexicon = build_market_weather(
        _history(60),
        horizons=range(12, 50, 2),
    )["research"]["lexicon"]

    assert lexicon["training_split"]["calibration_bars"] < 20
    assert lexicon["current"]["distance_tail_score"] is None
    assert lexicon["current"]["outside_learned_range"] is None
    assert lexicon["current"]["distance_tail_scope"] == "unavailable"
    assert all(point["distance_tail_score"] is None for point in lexicon["evaluation_sequence"])


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
    assert payload["cache"]["analysis"]["status"] == "miss"
    assert payload["cache"]["history"]["status"] == "refreshed"
    assert payload["cache"]["request"] == {
        "history_access": "refreshed",
        "provider_called": True,
    }
    assert response.headers["x-market-weather-analysis-cache"] == "miss"
    assert response.headers["x-market-weather-history-cache"] == "refreshed"
    assert response.headers["x-market-weather-history-origin"] == "refreshed"


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
    assert payload["semantic_revision"] == "1.3"
    assert payload["history_context"]["requested_visible_bars"] == 750
    assert payload["history_context"]["visible_bars"] == 750
    assert payload["history_context"]["analysis_bars"] == 878
    assert payload["history_context"]["warmup_buffer_requested"] == 128
    assert payload["history_context"]["warmup_buffer_received"] == 128
    assert len(payload["research"]["structure_components"]["series"]) == 750
    assert len(payload["research"]["scaling_reference"]["series"]) == 750
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
    carriers = payload["research"]["carriers"]
    assert len(carriers["series"]) == 60
    assert len(carriers["ratios"]["series"]) == 60
    assert [point["date"] for point in carriers["ratios"]["series"]] == payload["dates"]


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
    assert calls == [(timeframe, 216), ("1D", 1095)]


def test_market_weather_api_reuses_complete_analysis(monkeypatch) -> None:
    daily_calls: list[int] = []
    quote_calls = 0

    class CountingProvider:
        name = "counting"

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            daily_calls.append(days)
            return _history(days)

        def quote(self, symbol: str) -> UnderlyingQuote:
            nonlocal quote_calls
            quote_calls += 1
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name)

    provider = CountingProvider()
    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: provider)
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "2")
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_TTL_SECONDS", "120")
    reset_market_weather_analysis_cache()

    app = FastAPI()
    app.include_router(market_weather_api.router)
    client = TestClient(app)
    endpoint = (
        "/market-weather/analyze?symbol=SPY&timeframe=1D&bars=60"
        "&horizon_min=4&horizon_max=8&horizon_step=2"
    )
    first = client.get(endpoint)
    second = client.get(endpoint)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers["x-market-weather-analysis-cache"] == "miss"
    assert second.headers["x-market-weather-analysis-cache"] == "hit"
    assert first.headers["x-market-weather-history-cache"] == "refreshed"
    assert second.headers["x-market-weather-history-cache"] == "not_checked"
    assert second.headers["x-market-weather-history-origin"] == "refreshed"
    assert second.json()["cache"]["analysis"]["status"] == "hit"
    assert second.json()["cache"]["analysis"]["retained"] is True
    assert second.json()["cache"]["analysis"]["ttl_seconds"] == 120
    assert second.json()["cache"]["request"] == {
        "history_access": "not_checked",
        "provider_called": False,
    }
    assert second.json()["cache"]["history"]["provider_called"] is True
    assert daily_calls == [132, 1095]
    assert quote_calls == 1


def test_market_weather_api_bounds_analysis_ttl_to_history_freshness(monkeypatch) -> None:
    class IntradayProvider:
        name = "intraday"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            return _history(bars)

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            return _history(days)

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name)

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: IntradayProvider())
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "1")
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_TTL_SECONDS", "120")
    monkeypatch.setenv("MARKET_WEATHER_HISTORY_TTL_1M_SECONDS", "17")
    reset_market_weather_analysis_cache()

    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/analyze?symbol=SPY&timeframe=1m&bars=60"
        "&horizon_min=4&horizon_max=8&horizon_step=2"
    )

    assert response.status_code == 200
    analysis_cache = response.json()["cache"]["analysis"]
    assert analysis_cache["ttl_seconds"] == 17
    assert analysis_cache["configured_ttl_seconds"] == 120
    assert analysis_cache["retained"] is True
    assert response.headers["cache-control"] == "private, max-age=17, must-revalidate"


def test_market_weather_api_does_not_retain_oversized_fields(monkeypatch) -> None:
    daily_calls: list[int] = []

    class CountingProvider:
        name = "counting"

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            daily_calls.append(days)
            return _history(days)

        def quote(self, symbol: str) -> UnderlyingQuote:
            return UnderlyingQuote(symbol=symbol, last=125.0, source=self.name)

    provider = CountingProvider()
    monkeypatch.setattr(market_weather_api, "get_market_data_provider", lambda: provider)
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "1")
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_CELLS", "100")
    reset_market_weather_analysis_cache()

    app = FastAPI()
    app.include_router(market_weather_api.router)
    client = TestClient(app)
    endpoint = (
        "/market-weather/analyze?symbol=SPY&timeframe=1D&bars=60"
        "&horizon_min=4&horizon_max=8&horizon_step=2"
    )
    first = client.get(endpoint)
    second = client.get(endpoint)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers["x-market-weather-analysis-cache"] == "miss"
    assert second.headers["x-market-weather-analysis-cache"] == "miss"
    assert first.json()["cache"]["analysis"]["retained"] is False
    assert first.json()["cache"]["analysis"]["field_cells"] == 180
    assert first.json()["cache"]["analysis"]["max_cacheable_cells"] == 100
    assert daily_calls == [132, 1095, 132, 1095]
