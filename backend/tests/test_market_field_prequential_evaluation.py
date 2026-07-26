from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
EVALUATION_DIR = (
    REPO_ROOT / "docs" / "papers" / "market-field" / "evaluation"
)
if str(EVALUATION_DIR) not in sys.path:
    sys.path.insert(0, str(EVALUATION_DIR))

import evaluation_core as core  # noqa: E402


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _history(count: int = 1000) -> pd.DataFrame:
    index = pd.bdate_range("2020-01-01", periods=count, tz="UTC")
    returns = 0.0003 + 0.0015 * np.sin(np.arange(count) / 17.0)
    close = 100.0 * np.exp(np.cumsum(returns))
    open_price = np.r_[close[0], close[:-1]]
    high = np.maximum(open_price, close) * 1.004
    low = np.minimum(open_price, close) * 0.996
    volume = 1_000_000.0 + 100_000.0 * np.cos(np.arange(count) / 13.0)
    return pd.DataFrame(
        {
            "Open": open_price,
            "High": high,
            "Low": low,
            "Close": close,
            "Volume": volume,
        },
        index=index,
    )


def _split(count: int = 1000) -> core.PrequentialSplit:
    return core.generate_prequential_splits(
        count,
        feature_warmup_bars=128,
        minimum_proper_fit_bars=504,
        fit_calibration_purge_bars=20,
        calibration_bars=252,
        calibration_test_embargo_bars=20,
        origin_step_bars=20,
    )[0]


def _feature_frames(
    index: pd.DatetimeIndex,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(19)
    field = pd.DataFrame(
        rng.normal(size=(len(index), len(core.FIELD_FEATURES))),
        index=index,
        columns=core.FIELD_FEATURES,
    )
    technical = pd.DataFrame(
        rng.normal(size=(len(index), len(core.TECHNICAL_FEATURES))),
        index=index,
        columns=core.TECHNICAL_FEATURES,
    )
    return field, technical


def test_protocol_is_development_only_and_reserves_holdout() -> None:
    protocol = json.loads(
        (EVALUATION_DIR / "protocol_v0.json").read_text(encoding="utf-8")
    )
    assert protocol["protocol_status"] == "retrospective_development_dry_run"
    assert protocol["claim_boundary"] == {
        "decision_eligible": False,
        "performance_claim_permitted": False,
        "preregistration_claim_permitted": False,
        "options_economics_evaluated": False,
        "purpose": protocol["claim_boundary"]["purpose"],
    }
    assert protocol["input_snapshot"]["fresh_fetch_allowed"] is False
    assert protocol["prospective_holdout"]["status"] == "reserved_not_evaluated"
    assert (
        protocol["input_snapshot"]["expected_last_observation"]
        < protocol["prospective_holdout"]["not_before_market_date"]
    )
    assert (
        protocol["multiplicity"][
            "secondary_development_family_planned_hypotheses"
        ]
        == (
            (len(protocol["models"]["ids"]) - 1)
            * len(protocol["outcomes"]["definitions"])
            * len(protocol["outcomes"]["horizons_bars"])
            * len(protocol["input_snapshot"]["datasets"])
            - protocol["multiplicity"]["primary_development_family"][
                "planned_hypotheses"
            ]
        )
    )


def test_outcomes_are_future_only_and_exact() -> None:
    history = pd.DataFrame(
        {
            "Open": [100.0, 102.0, 99.0, 105.0],
            "High": [101.0, 104.0, 103.0, 108.0],
            "Low": [99.0, 98.0, 97.0, 101.0],
            "Close": [100.0, 102.0, 99.0, 105.0],
            "Volume": [10.0, 10.0, 10.0, 10.0],
        },
        index=pd.date_range("2026-01-01", periods=4, tz="UTC"),
    )
    outcomes = core.build_outcome_frame(
        history,
        direction=[1.0, -1.0, 0.0, 1.0],
        horizons=[2],
    )
    assert outcomes.iloc[0]["forward_return__h2"] == pytest.approx(-0.01)
    expected_rv = np.sqrt(
        np.log(102.0 / 100.0) ** 2 + np.log(99.0 / 102.0) ** 2
    )
    assert outcomes.iloc[0]["forward_realized_variation__h2"] == pytest.approx(
        expected_rv
    )
    assert outcomes.iloc[0][
        "pressure_aligned_maximum_adverse_excursion__h2"
    ] == pytest.approx(-0.03)
    assert outcomes.iloc[1][
        "pressure_aligned_maximum_adverse_excursion__h2"
    ] == pytest.approx(1.0 - 108.0 / 102.0)
    assert np.isnan(
        outcomes.iloc[2][
            "pressure_aligned_maximum_adverse_excursion__h2"
        ]
    )
    assert np.isnan(outcomes.iloc[-1]["forward_return__h2"])


def test_ohlc_boundary_validation_accepts_only_roundoff_tolerance() -> None:
    history = _history(5)
    history.iloc[2, history.columns.get_loc("High")] = (
        history.iloc[2]["Close"] - 2e-14
    )
    assert len(core.normalize_history(history)) == 5
    history.iloc[2, history.columns.get_loc("High")] = (
        min(history.iloc[2]["Open"], history.iloc[2]["Close"]) - 0.01
    )
    with pytest.raises(ValueError, match="invalid price"):
        core.normalize_history(history)


def test_split_purge_and_embargo_cover_maximum_label_horizon() -> None:
    splits = core.generate_prequential_splits(
        2148,
        feature_warmup_bars=128,
        minimum_proper_fit_bars=504,
        fit_calibration_purge_bars=20,
        calibration_bars=252,
        calibration_test_embargo_bars=20,
        origin_step_bars=20,
    )
    assert splits
    assert splits[0].origin == 924
    assert all(
        split.fit_end - 1 + 20 < split.calibration_start
        for split in splits
    )
    assert all(
        split.calibration_end - 1 + 20 < split.origin
        for split in splits
    )
    assert all(
        right.origin - left.origin == 20
        for left, right in zip(splits, splits[1:])
    )


def test_split_generation_fails_closed_on_invalid_parameters() -> None:
    with pytest.raises(ValueError, match="positive"):
        core.generate_prequential_splits(
            1000,
            feature_warmup_bars=128,
            minimum_proper_fit_bars=504,
            fit_calibration_purge_bars=20,
            calibration_bars=252,
            calibration_test_embargo_bars=20,
            origin_step_bars=0,
        )
    assert (
        core.generate_prequential_splits(
            900,
            feature_warmup_bars=128,
            minimum_proper_fit_bars=504,
            fit_calibration_purge_bars=20,
            calibration_bars=252,
            calibration_test_embargo_bars=20,
            origin_step_bars=20,
        )
        == []
    )


def test_family_ablation_dimensions_and_weights() -> None:
    assert len(core.FIELD_FEATURES) == 15
    assert len(core.MODEL_SPECS["market_field_minus_pressure_state"]["features"]) == 10
    assert len(core.MODEL_SPECS["market_field_minus_field_transform"]["features"]) == 8
    assert len(core.MODEL_SPECS["market_field_minus_ohlcv_carrier"]["features"]) == 12
    weights = core.field_metric_weights(core.FIELD_FEATURES)
    assert weights.sum() == pytest.approx(1.0)
    for family, features in core.FIELD_FEATURE_FAMILIES.items():
        del family
        indexes = [core.FIELD_FEATURES.index(feature) for feature in features]
        assert weights[indexes].sum() == pytest.approx(1.0 / 3.0)
    assert core.MODEL_SPECS["causal_change_point_ridge"]["features"] == (
        core.CHANGE_POINT_FEATURES
    )
    assert core.MODEL_SPECS["gaussian_hmm_2state"]["features"] == (
        core.HMM_OBSERVATION_FEATURES
    )


def test_change_point_and_hmm_observations_are_prefix_invariant() -> None:
    history = _history(260)
    for builder in (
        core.change_point_feature_frame,
        core.hmm_observation_frame,
    ):
        full = builder(history)
        prefix = builder(history.iloc[:220])
        assert np.allclose(
            full.iloc[219].to_numpy(dtype=float),
            prefix.iloc[-1].to_numpy(dtype=float),
            rtol=0.0,
            atol=1e-12,
        )


def test_gaussian_hmm_is_deterministic_and_causally_filtered() -> None:
    observations = core.hmm_observation_frame(_history(500)).to_numpy(
        dtype=float
    )
    center, scale = core.robust_fit_scale(observations[:400])
    standardized = (observations - center) / scale
    first = core.fit_diagonal_gaussian_hmm(
        standardized[:400],
        maximum_iterations=8,
        variance_floor=1e-4,
    )
    second = core.fit_diagonal_gaussian_hmm(
        standardized[:400],
        maximum_iterations=8,
        variance_floor=1e-4,
    )
    for key in (
        "means",
        "variances",
        "initial_probability",
        "transition_probability",
    ):
        assert np.allclose(first[key], second[key], rtol=0.0, atol=1e-12)
    full_probabilities = core.filter_diagonal_gaussian_hmm(
        standardized,
        first,
    )
    prefix_probabilities = core.filter_diagonal_gaussian_hmm(
        standardized[:450],
        first,
    )
    assert np.allclose(
        full_probabilities[:450],
        prefix_probabilities,
        rtol=0.0,
        atol=1e-12,
    )
    assert np.allclose(
        full_probabilities.sum(axis=1),
        1.0,
        rtol=0.0,
        atol=1e-12,
    )


def test_fit_only_hmm_baseline_produces_target_local_predictions() -> None:
    history = _history()
    field, technical = _feature_frames(history.index)
    outcomes = core.build_outcome_frame(
        history,
        direction=field["pressure"],
        horizons=[1, 5, 20],
    )
    result = core.fit_predict_all_targets(
        model_id="gaussian_hmm_2state",
        split=_split(),
        field_features=field,
        technical_features=technical,
        change_point_features=core.change_point_feature_frame(history),
        hmm_features=core.hmm_observation_frame(history),
        outcomes=outcomes,
        ridge_alpha=1.0,
        minimum_model_fit_rows=40,
        minimum_dictionary_state_outcomes=20,
        interval_calibration_quantile=0.9,
        hmm_maximum_iterations=8,
        hmm_variance_floor=1e-4,
    )
    assert result["status"] == "ok"
    assert result["archetype_count"] == 2
    assert 1 <= result["model_iterations"] <= 8
    assert result["model_converged"] in {True, False}
    assert result["target_reasons"] == [None] * len(outcomes.columns)
    assert np.isfinite(result["predictions"]).all()


def test_ridge_prediction_cannot_see_suffix_or_calibration_mutations() -> None:
    history = _history()
    field, technical = _feature_frames(history.index)
    outcomes = core.build_outcome_frame(
        history,
        direction=field["pressure"],
        horizons=[1, 5, 20],
    )
    split = _split()
    baseline = core.fit_predict_all_targets(
        model_id="market_field_raw_ridge",
        split=split,
        field_features=field,
        technical_features=technical,
        outcomes=outcomes,
        ridge_alpha=1.0,
        minimum_model_fit_rows=40,
        minimum_dictionary_state_outcomes=20,
        interval_calibration_quantile=0.9,
    )
    mutated_field = field.copy()
    mutated_outcomes = outcomes.copy()
    mutated_field.iloc[split.calibration_start :] *= 1_000_000.0
    mutated_field.iloc[split.origin] = field.iloc[split.origin]
    mutated_outcomes.iloc[split.calibration_start :] *= -500.0
    candidate = core.fit_predict_all_targets(
        model_id="market_field_raw_ridge",
        split=split,
        field_features=mutated_field,
        technical_features=technical,
        outcomes=mutated_outcomes,
        ridge_alpha=1.0,
        minimum_model_fit_rows=40,
        minimum_dictionary_state_outcomes=20,
        interval_calibration_quantile=0.9,
    )
    assert np.allclose(
        baseline["predictions"],
        candidate["predictions"],
        rtol=0.0,
        atol=1e-12,
    )
    assert not np.allclose(
        baseline["interval_radius"],
        candidate["interval_radius"],
        equal_nan=True,
    )


def test_dictionary_abstains_instead_of_using_unconditional_mean() -> None:
    history = _history()
    field, technical = _feature_frames(history.index)
    outcomes = core.build_outcome_frame(
        history,
        direction=field["pressure"],
        horizons=[1, 5, 20],
    )
    result = core.fit_predict_all_targets(
        model_id="market_field_dictionary",
        split=_split(),
        field_features=field,
        technical_features=technical,
        outcomes=outcomes,
        ridge_alpha=1.0,
        minimum_model_fit_rows=40,
        minimum_dictionary_state_outcomes=10_000,
        interval_calibration_quantile=0.9,
    )
    assert result["status"] == "ok"
    assert set(result["target_reasons"]) == {
        "insufficient_dictionary_state_outcomes"
    }
    assert np.isnan(result["predictions"]).all()


def test_missing_one_target_does_not_remove_other_target_fit_rows() -> None:
    history = _history()
    field, technical = _feature_frames(history.index)
    outcomes = core.build_outcome_frame(
        history,
        direction=field["pressure"],
        horizons=[1, 5, 20],
    )
    split = _split()
    outcomes.iloc[
        split.fit_start : split.fit_end : 3,
        outcomes.columns.get_loc(
            "pressure_aligned_maximum_adverse_excursion__h20"
        ),
    ] = np.nan
    result = core.fit_predict_all_targets(
        model_id="market_field_raw_ridge",
        split=split,
        field_features=field,
        technical_features=technical,
        outcomes=outcomes,
        ridge_alpha=1.0,
        minimum_model_fit_rows=40,
        minimum_dictionary_state_outcomes=20,
        interval_calibration_quantile=0.9,
    )
    target_counts = dict(
        zip(result["target_columns"], result["fit_rows_by_target"])
    )
    assert target_counts["forward_return__h20"] == (
        split.fit_end - split.fit_start
    )
    assert target_counts[
        "pressure_aligned_maximum_adverse_excursion__h20"
    ] < target_counts["forward_return__h20"]
    assert np.isfinite(result["predictions"]).all()


def test_stationary_bootstrap_is_seeded_bounded_and_contiguous() -> None:
    first = core.stationary_bootstrap_indices(
        25,
        mean_block_length=1e12,
        rng=np.random.default_rng(7),
    )
    second = core.stationary_bootstrap_indices(
        25,
        mean_block_length=1e12,
        rng=np.random.default_rng(7),
    )
    assert np.array_equal(first, second)
    assert np.all((first >= 0) & (first < 25))
    assert np.all(first[1:] == (first[:-1] + 1) % 25)


def test_stationary_bootstrap_constant_interval_is_degenerate() -> None:
    result = core.stationary_bootstrap_mean(
        [0.25] * 30,
        replications=99,
        mean_block_length=5,
        confidence=0.95,
        seed=17,
    )
    assert result["estimate"] == pytest.approx(0.25)
    assert result["lower"] == pytest.approx(0.25)
    assert result["upper"] == pytest.approx(0.25)
    assert result["two_sided_centered_p"] == pytest.approx(0.01)


def test_bh_and_holm_match_known_vectors_and_keep_planned_denominator() -> None:
    p_values = [0.01, 0.04, 0.03]
    assert core.adjust_benjamini_hochberg(p_values).tolist() == pytest.approx(
        [0.03, 0.04, 0.04]
    )
    assert core.adjust_holm(p_values).tolist() == pytest.approx(
        [0.03, 0.06, 0.06]
    )
    with_missing = [0.01, None]
    bh = core.adjust_benjamini_hochberg(
        with_missing,
        planned_count=4,
    )
    holm = core.adjust_holm(with_missing, planned_count=4)
    assert bh[0] == pytest.approx(0.04)
    assert holm[0] == pytest.approx(0.04)
    assert np.isnan(bh[1]) and np.isnan(holm[1])


def test_case_accounting_partitions_every_candidate() -> None:
    predictions = pd.DataFrame(
        [
            {
                "dataset_id": "spy_1d",
                "symbol": "SPY",
                "timeframe": "1D",
                "model_id": "naive_zero",
                "outcome": "forward_return",
                "horizon_bars": 5,
                "status": status,
                "reason": reason,
            }
            for status, reason in (
                ("scored", ""),
                ("outcome_not_yet_observable", "sample_end"),
                ("model_unavailable", "support"),
            )
        ]
    )
    accounting = core.summarize_case_accounting(predictions)
    assert accounting["cases"].sum() == len(predictions)
    assert set(accounting["status"]) == {
        "scored",
        "outcome_not_yet_observable",
        "model_unavailable",
    }


def test_technical_baseline_matches_primary_paper_generator() -> None:
    generator = _load_module(
        "market_field_generate_assets_for_test",
        REPO_ROOT
        / "docs"
        / "papers"
        / "market-field"
        / "scripts"
        / "generate_assets.py",
    )
    history = _history(180)
    expected = generator._single_horizon_baseline_features(history)
    actual = core.technical_feature_frame(history).to_numpy(dtype=float)
    assert np.allclose(actual, expected, rtol=0.0, atol=1e-12)


def test_field_feature_extraction_is_prefix_invariant() -> None:
    runner = _load_module(
        "market_field_prequential_runner_for_test",
        EVALUATION_DIR / "evaluate_prequential.py",
    )
    history = _history(260)
    full = runner.build_field_feature_frame(history)
    prefix = runner.build_field_feature_frame(history.iloc[:220])
    assert np.allclose(
        full.iloc[219].to_numpy(dtype=float),
        prefix.iloc[-1].to_numpy(dtype=float),
        rtol=0.0,
        atol=1e-12,
    )


def test_seeded_synthetic_checks_are_separate_and_prefix_invariant() -> None:
    runner = _load_module(
        "market_field_prequential_runner_synthetic_test",
        EVALUATION_DIR / "evaluate_prequential.py",
    )
    first = runner.synthetic_reference_checks(20260726)
    second = runner.synthetic_reference_checks(20260726)
    pd.testing.assert_frame_equal(first, second)
    assert set(first["scenario"]) == {
        "iid_gaussian_random_walk",
        "ar1_returns",
        "alternating_returns",
        "volatility_shift",
        "missing_volume_path",
    }
    assert first["construction_check_only"].all()
    assert not first["performance_claim_evaluated"].any()
    assert (first["prefix_endpoint_max_abs_error"] <= 1e-12).all()
    assert first["material_negative_scaling_exponent_count"].sum() == 0


def test_deterministic_gzip_writer_repeats_bytes(tmp_path: Path) -> None:
    runner = _load_module(
        "market_field_prequential_runner_writer_test",
        EVALUATION_DIR / "evaluate_prequential.py",
    )
    path = tmp_path / "rows.csv.gz"
    frame = pd.DataFrame({"a": [1, 2], "b": [0.25, np.nan]})
    runner.write_csv(path, frame)
    first = path.read_bytes()
    runner.write_csv(path, frame)
    assert path.read_bytes() == first
