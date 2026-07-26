from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import pandas as pd


HERE = Path(__file__).resolve().parent
PAPER_ROOT = HERE.parent


def find_repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "backend").is_dir() and (candidate / "frontend").is_dir():
            return candidate
    raise RuntimeError(f"Could not locate repository root from {start}")


REPO_ROOT = find_repo_root(HERE)
BACKEND_ROOT = REPO_ROOT / "backend"
for import_path in (BACKEND_ROOT, HERE):
    if str(import_path) not in sys.path:
        sys.path.insert(0, str(import_path))

from app.services import market_weather as market_weather_module  # noqa: E402
from app.services import market_weather_research as market_weather_research_module  # noqa: E402
from app.services.market_weather import (  # noqa: E402
    MarketWeatherSettings,
    build_market_weather,
)
from evaluation_core import (  # noqa: E402
    FIELD_FEATURES,
    MODEL_SPECS,
    build_outcome_frame,
    build_paired_bootstrap_comparisons,
    canonical_json_sha256,
    canonical_ohlcv_sha256,
    change_point_feature_frame,
    fit_predict_all_targets,
    generate_prequential_splits,
    hmm_observation_frame,
    normalize_history,
    parse_target_column,
    summarize_case_accounting,
    summarize_prediction_metrics,
    technical_feature_frame,
)


DEFAULT_PROTOCOL_PATH = HERE / "protocol_v0.json"
DEFAULT_RESULTS_DIR = HERE / "results"
PRIMARY_CACHE_DIR = PAPER_ROOT / "cache"
FIELD_HORIZONS = tuple(range(12, 50, 2))
SOURCE_PATHS = (
    Path("backend/app/services/market_weather.py"),
    Path("backend/app/services/market_weather_research.py"),
    Path("backend/app/services/market_weather_context.py"),
    Path("docs/papers/market-field/evaluation/evaluation_core.py"),
    Path("docs/papers/market-field/evaluation/evaluate_prequential.py"),
    Path("docs/papers/market-field/evaluation/protocol_v0.json"),
)
DEPENDENCIES = ("numpy", "pandas", "scipy")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(
            payload,
            indent=2,
            sort_keys=True,
            default=_json_default,
        )
        + "\n",
        encoding="utf-8",
    )


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value)!r}")


def write_csv(path: Path, frame: pd.DataFrame) -> None:
    kwargs: dict[str, Any] = {
        "index": False,
        "float_format": "%.10g",
        "lineterminator": "\n",
    }
    if path.suffix == ".gz":
        kwargs["compression"] = {
            "method": "gzip",
            "compresslevel": 9,
            "mtime": 0,
        }
    frame.to_csv(path, **kwargs)


def git_context() -> dict[str, Any]:
    def command(*arguments: str) -> tuple[int, str, str]:
        completed = subprocess.run(
            ["git", *arguments],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        return (
            completed.returncode,
            completed.stdout.strip(),
            completed.stderr.strip(),
        )

    head_code, head, head_error = command("rev-parse", "HEAD")
    branch_code, branch, branch_error = command("branch", "--show-current")
    status_code, status, status_error = command(
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
    )
    entries = status.splitlines() if status_code == 0 and status else []
    return {
        "head": head if head_code == 0 else None,
        "branch": branch if branch_code == 0 else None,
        "dirty": bool(entries) if status_code == 0 else None,
        "status_entries": entries,
        "errors": [
            error
            for code, error in (
                (head_code, head_error),
                (branch_code, branch_error),
                (status_code, status_error),
            )
            if code != 0 and error
        ],
        "identity_rule": (
            "Per-file hashes, the protocol hash, and canonical input hashes identify "
            "this development run. Git HEAD alone is not an evaluated-source identity "
            "when the tree is dirty."
        ),
    }


def dependency_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for dependency in DEPENDENCIES:
        try:
            versions[dependency] = importlib.metadata.version(dependency)
        except importlib.metadata.PackageNotFoundError:
            versions[dependency] = None
    return versions


def source_hashes() -> dict[str, str]:
    return {
        path.as_posix(): sha256_file(REPO_ROOT / path)
        for path in SOURCE_PATHS
    }


def load_protocol(path: Path) -> dict[str, Any]:
    protocol = json.loads(path.read_text(encoding="utf-8"))
    if protocol.get("protocol_status") != "retrospective_development_dry_run":
        raise RuntimeError("This runner accepts only the development-dry-run protocol.")
    boundary = protocol.get("claim_boundary", {})
    prohibited = (
        bool(boundary.get("decision_eligible"))
        or bool(boundary.get("performance_claim_permitted"))
        or bool(boundary.get("preregistration_claim_permitted"))
        or bool(boundary.get("options_economics_evaluated"))
    )
    if prohibited:
        raise RuntimeError("Protocol claim boundary is incompatible with this runner.")
    if protocol.get("input_snapshot", {}).get("fresh_fetch_allowed") is not False:
        raise RuntimeError("Development evaluation must fail closed instead of fetching.")
    return protocol


def load_frozen_histories(
    protocol: Mapping[str, Any],
) -> tuple[dict[str, pd.DataFrame], list[dict[str, Any]]]:
    histories: dict[str, pd.DataFrame] = {}
    manifest_rows: list[dict[str, Any]] = []
    expected_end = str(
        protocol["input_snapshot"]["expected_last_observation"]
    )
    holdout_start = str(protocol["prospective_holdout"]["not_before_market_date"])
    for spec in protocol["input_snapshot"]["datasets"]:
        symbol = str(spec["symbol"])
        path = PRIMARY_CACHE_DIR / str(spec["cache_file"])
        if not path.is_file():
            raise FileNotFoundError(
                f"Retained input {path} is missing. This development run never refetches."
            )
        history = normalize_history(pd.read_csv(path, index_col=0))
        digest = canonical_ohlcv_sha256(history)
        if len(history) != int(spec["rows"]):
            raise RuntimeError(
                f"{symbol} row count changed: {len(history)} != {spec['rows']}"
            )
        if digest != str(spec["canonical_ohlcv_sha256"]):
            raise RuntimeError(f"{symbol} canonical OHLCV hash changed.")
        last_date = history.index[-1].date().isoformat()
        if last_date != expected_end:
            raise RuntimeError(
                f"{symbol} last observation changed: {last_date} != {expected_end}"
            )
        if last_date >= holdout_start:
            raise RuntimeError(
                f"{symbol} development input reaches reserved holdout {holdout_start}."
            )
        histories[symbol] = history
        manifest_rows.append(
            {
                "dataset_id": f"{symbol.lower().replace('-', '_')}_1d",
                "symbol": symbol,
                "timeframe": "1D",
                "rows": len(history),
                "first_observation": history.index[0].isoformat(),
                "last_observation": history.index[-1].isoformat(),
                "canonical_ohlcv_sha256": digest,
                "source_path": str(path.relative_to(REPO_ROOT)).replace("\\", "/"),
                "fresh_fetch_used": False,
                "prospective_holdout_excluded": True,
            }
        )
    return histories, manifest_rows


def _full_precision_value(value: Any, digits: int = 4) -> float | None:
    del digits
    if value is None or not np.isfinite(float(value)):
        return None
    return float(value)


def build_field_feature_frame(history: pd.DataFrame) -> pd.DataFrame:
    """Extract the causal 15D formula-v1 vector without response-only rounding."""
    original_matrix_serializer = market_weather_module._rounded_matrix
    original_scalar_serializer = market_weather_research_module._rounded
    market_weather_module._rounded_matrix = lambda values: np.nan_to_num(  # type: ignore[assignment]
        values,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    ).tolist()
    market_weather_research_module._rounded = _full_precision_value  # type: ignore[assignment]
    try:
        field = build_market_weather(
            history,
            horizons=FIELD_HORIZONS,
            settings=MarketWeatherSettings(),
            include_retrospective_research=False,
            include_history_payload=False,
        )
    finally:
        market_weather_module._rounded_matrix = original_matrix_serializer  # type: ignore[assignment]
        market_weather_research_module._rounded = original_scalar_serializer  # type: ignore[assignment]

    derivative = pd.DataFrame(field["research"]["derivative_series"])
    strata = pd.DataFrame(field["research"]["strata"]["series"])
    carriers = pd.DataFrame(field["research"]["carriers"]["series"])
    rows = len(history)
    if not (len(derivative) == len(strata) == len(carriers) == rows):
        raise RuntimeError("Market Field research series do not align with input history.")
    feature_frame = pd.DataFrame(
        {
            "pressure": derivative["pressure"].to_numpy(dtype=float),
            "velocity": derivative["velocity"].to_numpy(dtype=float),
            "acceleration": derivative["acceleration"].to_numpy(dtype=float),
            "jerk": derivative["jerk"].to_numpy(dtype=float),
            "snap": derivative["snap"].to_numpy(dtype=float),
            "structure": strata["structure"].to_numpy(dtype=float),
            "kinematics": strata["kinematics"].to_numpy(dtype=float),
            "geometry": strata["geometry"].to_numpy(dtype=float),
            "information": strata["information"].to_numpy(dtype=float),
            "propagation": strata["propagation"].to_numpy(dtype=float),
            "cascade_bias": strata["cascade_bias"].to_numpy(dtype=float),
            "scaling_exponent": strata["scaling_exponent"].to_numpy(dtype=float),
            "realized_volatility": carriers["realized_volatility"].to_numpy(
                dtype=float
            ),
            "participation": carriers["participation"].to_numpy(dtype=float),
            "liquidity_stress": carriers["liquidity_stress"].to_numpy(
                dtype=float
            ),
        },
        index=history.index,
    )
    if tuple(feature_frame.columns) != FIELD_FEATURES:
        raise AssertionError("Extracted Market Field feature order changed.")
    return feature_frame.replace([np.inf, -np.inf], np.nan)


def _synthetic_history(
    returns: np.ndarray,
    *,
    volume: np.ndarray | None = None,
) -> pd.DataFrame:
    returns = np.asarray(returns, dtype=float)
    close = 100.0 * np.exp(np.cumsum(returns))
    open_price = np.r_[close[0], close[:-1]]
    high = np.maximum(open_price, close) * 1.003
    low = np.minimum(open_price, close) * 0.997
    if volume is None:
        volume = np.full(len(close), 1_000_000.0)
    return pd.DataFrame(
        {
            "Open": open_price,
            "High": high,
            "Low": low,
            "Close": close,
            "Volume": np.asarray(volume, dtype=float),
        },
        index=pd.bdate_range("2020-01-01", periods=len(close), tz="UTC"),
    )


def synthetic_reference_checks(seed: int) -> pd.DataFrame:
    """Run seeded construction checks, separately from outcome evaluation."""
    rng = np.random.default_rng(int(seed))
    count = 800
    iid = rng.normal(0.0, 0.008, count)
    ar1 = np.zeros(count, dtype=float)
    innovations = rng.normal(0.0, 0.004, count)
    for index in range(1, count):
        ar1[index] = 0.75 * ar1[index - 1] + innovations[index]
    alternating = np.where(np.arange(count) % 2 == 0, 0.006, -0.006)
    volatility_shift = np.r_[
        rng.normal(0.0, 0.002, count // 2),
        rng.normal(0.0, 0.018, count - count // 2),
    ]
    missing_volume_returns = rng.normal(0.0, 0.006, count)
    missing_volume = np.full(count, 1_000_000.0)
    missing_volume[::4] = np.nan
    missing_volume[::9] = 0.0
    scenarios = {
        "iid_gaussian_random_walk": (
            _synthetic_history(iid),
            "seeded iid Gaussian log increments",
        ),
        "ar1_returns": (
            _synthetic_history(ar1),
            "AR(1) log returns with phi=0.75",
        ),
        "alternating_returns": (
            _synthetic_history(alternating),
            "deterministic alternating +/-0.006 log returns",
        ),
        "volatility_shift": (
            _synthetic_history(volatility_shift),
            "log-return sigma changes from 0.002 to 0.018 at bar 400",
        ),
        "missing_volume_path": (
            _synthetic_history(
                missing_volume_returns,
                volume=missing_volume,
            ),
            "volume missing every fourth bar and zero every ninth bar",
        ),
    }
    rows: list[dict[str, Any]] = []
    prefix_count = 600
    for scenario, (history, construction) in scenarios.items():
        full = build_field_feature_frame(history)
        prefix = build_field_feature_frame(history.iloc[:prefix_count])
        endpoint_error = float(
            np.nanmax(
                np.abs(
                    full.iloc[prefix_count - 1].to_numpy(dtype=float)
                    - prefix.iloc[-1].to_numpy(dtype=float)
                )
            )
        )
        numeric = full.to_numpy(dtype=float)
        rows.append(
            {
                "scenario": scenario,
                "construction": construction,
                "bars": len(history),
                "seed": int(seed),
                "finite_field_share": float(np.mean(np.isfinite(numeric))),
                "finite_pressure_state_share": float(
                    np.mean(
                        np.isfinite(
                            full[
                                [
                                    "pressure",
                                    "velocity",
                                    "acceleration",
                                    "jerk",
                                    "snap",
                                ]
                            ].to_numpy(dtype=float)
                        )
                    )
                ),
                "finite_carrier_share": float(
                    np.mean(
                        np.isfinite(
                            full[
                                [
                                    "realized_volatility",
                                    "participation",
                                    "liquidity_stress",
                                ]
                            ].to_numpy(dtype=float)
                        )
                    )
                ),
                "prefix_endpoint_max_abs_error": endpoint_error,
                "material_negative_scaling_exponent_count": int(
                    np.sum(
                        full["scaling_exponent"].to_numpy(dtype=float)
                        < -1e-10
                    )
                ),
                "mean_absolute_pressure": float(
                    np.nanmean(np.abs(full["pressure"].to_numpy(dtype=float)))
                ),
                "median_structure": float(
                    np.nanmedian(full["structure"].to_numpy(dtype=float))
                ),
                "median_realized_volatility_carrier": float(
                    np.nanmedian(
                        full["realized_volatility"].to_numpy(dtype=float)
                    )
                ),
                "construction_check_only": True,
                "performance_claim_evaluated": False,
            }
        )
    return pd.DataFrame(rows).sort_values("scenario").reset_index(drop=True)


def split_audit_rows(
    *,
    dataset_id: str,
    history: pd.DataFrame,
    splits: list[Any],
    maximum_horizon: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for split in splits:
        fit_latest_label_end = split.fit_end - 1 + maximum_horizon
        calibration_latest_label_end = (
            split.calibration_end - 1 + maximum_horizon
        )
        rows.append(
            {
                "dataset_id": dataset_id,
                "split_id": split.split_id,
                "fit_start_index": split.fit_start,
                "fit_end_exclusive": split.fit_end,
                "fit_rows": split.fit_end - split.fit_start,
                "fit_start_date": history.index[split.fit_start].isoformat(),
                "fit_end_date": history.index[split.fit_end - 1].isoformat(),
                "fit_latest_label_end_index": fit_latest_label_end,
                "fit_labels_end_before_calibration": (
                    fit_latest_label_end < split.calibration_start
                ),
                "purge_bars": split.purge_bars,
                "calibration_start_index": split.calibration_start,
                "calibration_end_exclusive": split.calibration_end,
                "calibration_rows": (
                    split.calibration_end - split.calibration_start
                ),
                "calibration_start_date": history.index[
                    split.calibration_start
                ].isoformat(),
                "calibration_end_date": history.index[
                    split.calibration_end - 1
                ].isoformat(),
                "calibration_latest_label_end_index": (
                    calibration_latest_label_end
                ),
                "calibration_labels_end_before_origin": (
                    calibration_latest_label_end < split.origin
                ),
                "embargo_bars": split.embargo_bars,
                "origin_index": split.origin,
                "origin_date": history.index[split.origin].isoformat(),
                "chronology_valid": (
                    fit_latest_label_end < split.calibration_start
                    and calibration_latest_label_end < split.origin
                ),
            }
        )
    return rows


def evaluate_dataset(
    *,
    symbol: str,
    history: pd.DataFrame,
    protocol: Mapping[str, Any],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    dataset_id = f"{symbol.lower().replace('-', '_')}_1d"
    field_features = build_field_feature_frame(history)
    technical_features = technical_feature_frame(history)
    change_point_features = change_point_feature_frame(history)
    hmm_features = hmm_observation_frame(history)
    horizons = [
        int(value)
        for value in protocol["outcomes"]["horizons_bars"]
    ]
    outcomes = build_outcome_frame(
        history,
        direction=field_features["pressure"].to_numpy(dtype=float),
        horizons=horizons,
    )
    chronology = protocol["chronology"]
    splits = generate_prequential_splits(
        len(history),
        feature_warmup_bars=int(chronology["feature_warmup_bars"]),
        minimum_proper_fit_bars=int(
            chronology["minimum_proper_fit_bars"]
        ),
        fit_calibration_purge_bars=int(
            chronology["fit_calibration_purge_bars"]
        ),
        calibration_bars=int(chronology["calibration_bars"]),
        calibration_test_embargo_bars=int(
            chronology["calibration_test_embargo_bars"]
        ),
        origin_step_bars=int(chronology["origin_step_bars"]),
    )
    model_config = protocol["models"]
    hmm_config = model_config["gaussian_hmm"]
    rows: list[dict[str, Any]] = []
    for split in splits:
        actual = outcomes.iloc[split.origin].to_numpy(dtype=float)
        for model_id in protocol["models"]["ids"]:
            fitted = fit_predict_all_targets(
                model_id=str(model_id),
                split=split,
                field_features=field_features,
                technical_features=technical_features,
                outcomes=outcomes,
                ridge_alpha=float(model_config["ridge_alpha"]),
                minimum_model_fit_rows=int(
                    model_config["minimum_model_fit_rows"]
                ),
                minimum_dictionary_state_outcomes=int(
                    model_config["minimum_dictionary_state_outcomes"]
                ),
                interval_calibration_quantile=float(
                    model_config["interval_calibration_quantile"]
                ),
                change_point_features=change_point_features,
                hmm_features=hmm_features,
                hmm_maximum_iterations=int(
                    hmm_config["maximum_em_iterations"]
                ),
                hmm_variance_floor=float(
                    hmm_config["variance_floor"]
                ),
            )
            predictions = np.asarray(fitted["predictions"], dtype=float)
            radii = np.asarray(fitted["interval_radius"], dtype=float)
            target_reasons = list(fitted["target_reasons"])
            fit_rows_by_target = np.asarray(
                fitted["fit_rows_by_target"],
                dtype=int,
            )
            calibration_rows_by_target = np.asarray(
                fitted["calibration_rows_by_target"],
                dtype=int,
            )
            for target_index, target_name in enumerate(outcomes.columns):
                outcome, horizon = parse_target_column(target_name)
                predicted = float(predictions[target_index])
                observed = float(actual[target_index])
                radius = float(radii[target_index])
                target_reason = target_reasons[target_index]
                if (
                    fitted["status"] != "ok"
                    or target_reason is not None
                    or not np.isfinite(predicted)
                ):
                    status = "model_unavailable"
                    reason = str(
                        target_reason
                        or fitted.get("reason")
                        or "nonfinite_model_prediction"
                    )
                elif not np.isfinite(observed):
                    status = "outcome_not_yet_observable"
                    if split.origin + horizon >= len(history):
                        reason = (
                            "forward_horizon_extends_beyond_frozen_snapshot"
                        )
                    else:
                        reason = "origin_direction_zero_or_unavailable"
                else:
                    status = "scored"
                    reason = ""
                interval_supported = (
                    np.isfinite(predicted) and np.isfinite(radius)
                )
                rows.append(
                    {
                        "dataset_id": dataset_id,
                        "symbol": symbol,
                        "timeframe": "1D",
                        "split_id": split.split_id,
                        "origin_index": split.origin,
                        "origin_date": history.index[
                            split.origin
                        ].isoformat(),
                        "model_id": model_id,
                        "outcome": outcome,
                        "horizon_bars": horizon,
                        "prediction": (
                            predicted if np.isfinite(predicted) else np.nan
                        ),
                        "actual": (
                            observed if np.isfinite(observed) else np.nan
                        ),
                        "interval_lower_90": (
                            predicted - radius
                            if interval_supported
                            else np.nan
                        ),
                        "interval_upper_90": (
                            predicted + radius
                            if interval_supported
                            else np.nan
                        ),
                        "status": status,
                        "reason": reason,
                        "fit_rows": int(
                            fit_rows_by_target[target_index]
                        ),
                        "calibration_rows": int(
                            calibration_rows_by_target[target_index]
                        ),
                        "assigned_state": fitted["assigned_state"],
                        "archetype_count": fitted["archetype_count"],
                        "model_iterations": fitted["model_iterations"],
                        "model_converged": fitted["model_converged"],
                        "decision_eligible": False,
                        "interpretation": (
                            "retrospective_development_diagnostic"
                        ),
                    }
                )
    splits_frame = pd.DataFrame(
        split_audit_rows(
            dataset_id=dataset_id,
            history=history,
            splits=splits,
            maximum_horizon=max(horizons),
        )
    )
    return pd.DataFrame(rows), splits_frame


def enforce_artifact_bounds(
    protocol: Mapping[str, Any],
    *,
    predictions: pd.DataFrame,
    bootstrap: pd.DataFrame,
    accounting: pd.DataFrame,
) -> None:
    bounds = protocol["artifact_bounds"]
    actual = {
        "prediction_rows_maximum": len(predictions),
        "bootstrap_rows_maximum": len(bootstrap),
        "case_accounting_rows_maximum": len(accounting),
    }
    for key, count in actual.items():
        if count > int(bounds[key]):
            raise RuntimeError(
                f"Artifact bound {key} exceeded: {count} > {bounds[key]}"
            )


def build_summary(
    *,
    protocol: Mapping[str, Any],
    input_manifest: pd.DataFrame,
    predictions: pd.DataFrame,
    splits: pd.DataFrame,
    metrics: pd.DataFrame,
    accounting: pd.DataFrame,
    comparisons: pd.DataFrame,
    synthetic: pd.DataFrame,
) -> dict[str, Any]:
    status_counts = {
        str(key): int(value)
        for key, value in predictions["status"].value_counts().items()
    }
    chronology_valid = (
        bool(splits["chronology_valid"].all()) if len(splits) else False
    )
    accounting_total = int(accounting["cases"].sum())
    return {
        "schema_version": "market_field_prequential_development_summary_v0",
        "protocol_status": protocol["protocol_status"],
        "claim_boundary": dict(protocol["claim_boundary"]),
        "datasets": len(input_manifest),
        "completed_input_bars": int(input_manifest["rows"].sum()),
        "origins": int(
            predictions[["dataset_id", "origin_index"]]
            .drop_duplicates()
            .shape[0]
        ),
        "models": int(predictions["model_id"].nunique()),
        "outcomes": int(predictions["outcome"].nunique()),
        "horizons": int(predictions["horizon_bars"].nunique()),
        "prediction_case_rows": len(predictions),
        "status_counts": status_counts,
        "accounting_partitions_all_prediction_rows": (
            accounting_total == len(predictions)
        ),
        "split_rows": len(splits),
        "all_split_chronologies_valid": chronology_valid,
        "metric_rows": len(metrics),
        "paired_bootstrap_rows": len(comparisons),
        "primary_family_rows": int(
            np.sum(
                comparisons["family_id"] == "primary_development_family"
            )
        )
        if len(comparisons)
        else 0,
        "synthetic_reference_checks": {
            "scenarios": len(synthetic),
            "all_prefix_invariant_at_1e_12": bool(
                (
                    synthetic["prefix_endpoint_max_abs_error"]
                    <= 1e-12
                ).all()
            ),
            "material_negative_scaling_exponent_count": int(
                synthetic[
                    "material_negative_scaling_exponent_count"
                ].sum()
            ),
            "performance_claim_evaluated": False,
        },
        "prospective_holdout": dict(protocol["prospective_holdout"]),
        "runtime_location": "results/run_receipt.json",
        "result_interpretation": (
            "The generated numeric outputs are a retrospective dry run of the "
            "evaluation machinery. They are not a preregistered result, performance "
            "claim, trading signal, or option-economics study."
        ),
    }


def build_receipt(
    *,
    started_at_utc: str,
    completed_at_utc: str,
    protocol_path: Path,
    input_manifest: pd.DataFrame,
    artifacts: list[Path],
    source_hashes_at_start: Mapping[str, str],
    elapsed_seconds: float,
) -> dict[str, Any]:
    sources = source_hashes()
    changed_during_run = sorted(
        path
        for path in set(source_hashes_at_start).union(sources)
        if source_hashes_at_start.get(path) != sources.get(path)
    )
    artifact_entries = [
        {
            "path": str(path.relative_to(HERE)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in artifacts
    ]
    deterministic_core = {
        "protocol_sha256": sha256_file(protocol_path),
        "input_sha256": {
            str(row.symbol): str(row.canonical_ohlcv_sha256)
            for row in input_manifest.itertuples(index=False)
        },
        "source_sha256": sources,
        "artifact_sha256": {
            entry["path"]: entry["sha256"]
            for entry in artifact_entries
        },
    }
    return {
        "schema_version": "market_field_prequential_development_receipt_v0",
        "started_at_utc": started_at_utc,
        "completed_at_utc": completed_at_utc,
        "elapsed_seconds": float(elapsed_seconds),
        "git": git_context(),
        "protocol": {
            "path": str(protocol_path.relative_to(REPO_ROOT)).replace("\\", "/"),
            "sha256": sha256_file(protocol_path),
            "status": "retrospective_development_dry_run",
        },
        "inputs": input_manifest.to_dict(orient="records"),
        "sources": {
            "sha256_at_start": dict(source_hashes_at_start),
            "sha256_at_completion": sources,
            "changed_during_run": changed_during_run,
            "stable_for_run": not changed_during_run,
        },
        "environment": {
            "python": platform.python_version(),
            "python_implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "dependencies": dependency_versions(),
        },
        "generated_artifacts": artifact_entries,
        "deterministic_core_sha256": canonical_json_sha256(
            deterministic_core
        ),
        "receipt_self_hash_excluded": True,
        "claim_boundary": {
            "decision_eligible": False,
            "performance_claim_permitted": False,
            "preregistration_claim_permitted": False,
            "options_economics_evaluated": False,
        },
    }


def run(
    *,
    protocol_path: Path = DEFAULT_PROTOCOL_PATH,
    results_dir: Path = DEFAULT_RESULTS_DIR,
) -> dict[str, Any]:
    started_at_utc = utc_now()
    started = time.perf_counter()
    protocol = load_protocol(protocol_path)
    source_hashes_at_start = source_hashes()
    results_dir.mkdir(parents=True, exist_ok=True)
    histories, input_rows = load_frozen_histories(protocol)
    input_manifest = pd.DataFrame(input_rows).sort_values("symbol").reset_index(
        drop=True
    )

    prediction_frames: list[pd.DataFrame] = []
    split_frames: list[pd.DataFrame] = []
    for symbol, history in histories.items():
        prediction_frame, split_frame = evaluate_dataset(
            symbol=symbol,
            history=history,
            protocol=protocol,
        )
        prediction_frames.append(prediction_frame)
        split_frames.append(split_frame)
    predictions = pd.concat(prediction_frames, ignore_index=True).sort_values(
        [
            "dataset_id",
            "origin_index",
            "model_id",
            "outcome",
            "horizon_bars",
        ]
    ).reset_index(drop=True)
    splits = pd.concat(split_frames, ignore_index=True).sort_values(
        ["dataset_id", "origin_index"]
    ).reset_index(drop=True)
    metrics = summarize_prediction_metrics(predictions)
    accounting = summarize_case_accounting(predictions)
    dependence = protocol["dependence"]
    multiplicity = protocol["multiplicity"]
    primary_family = dict(multiplicity["primary_development_family"])
    comparisons = build_paired_bootstrap_comparisons(
        predictions,
        comparator_model=str(primary_family["comparator"]),
        replications=int(dependence["replications"]),
        mean_block_length=float(dependence["mean_block_origins"]),
        confidence=float(dependence["confidence"]),
        base_seed=int(dependence["seed"]),
        primary_family=primary_family,
        secondary_planned_count=int(
            multiplicity[
                "secondary_development_family_planned_hypotheses"
            ]
        ),
    )
    synthetic = synthetic_reference_checks(int(dependence["seed"]))
    enforce_artifact_bounds(
        protocol,
        predictions=predictions,
        bootstrap=comparisons,
        accounting=accounting,
    )
    elapsed_seconds = time.perf_counter() - started
    summary = build_summary(
        protocol=protocol,
        input_manifest=input_manifest,
        predictions=predictions,
        splits=splits,
        metrics=metrics,
        accounting=accounting,
        comparisons=comparisons,
        synthetic=synthetic,
    )

    artifact_frames = {
        "input_manifest.csv": input_manifest,
        "split_audit.csv": splits,
        "development_predictions.csv.gz": predictions,
        "development_metric_summary.csv": metrics,
        "unsupported_case_accounting.csv": accounting,
        "paired_bootstrap_and_multiplicity.csv": comparisons,
        "synthetic_reference_checks.csv": synthetic,
    }
    artifact_paths: list[Path] = []
    for filename, frame in artifact_frames.items():
        path = results_dir / filename
        write_csv(path, frame)
        artifact_paths.append(path)
    summary_path = results_dir / "summary.json"
    write_json(summary_path, summary)
    artifact_paths.append(summary_path)
    receipt = build_receipt(
        started_at_utc=started_at_utc,
        completed_at_utc=utc_now(),
        protocol_path=protocol_path,
        input_manifest=input_manifest,
        artifacts=artifact_paths,
        source_hashes_at_start=source_hashes_at_start,
        elapsed_seconds=elapsed_seconds,
    )
    receipt_path = results_dir / "run_receipt.json"
    write_json(receipt_path, receipt)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Run the development-only Market Field prequential protocol against "
            "the retained paper caches. This command never fetches data."
        )
    )
    parser.add_argument(
        "--protocol",
        type=Path,
        default=DEFAULT_PROTOCOL_PATH,
    )
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=DEFAULT_RESULTS_DIR,
    )
    arguments = parser.parse_args()
    summary = run(
        protocol_path=arguments.protocol.resolve(),
        results_dir=arguments.results_dir.resolve(),
    )
    print(json.dumps(summary, indent=2, sort_keys=True, default=_json_default))


if __name__ == "__main__":
    main()
