"""Rebuild the empirical artifacts for the Market Field paper.

The script deliberately separates representational diagnostics from trading
performance. It downloads adjusted daily OHLCV data, exercises the production
calculation engine, checks prefix invariance and deterministic state learning,
and writes only derived summaries/figures into the paper package. Raw provider
responses are cached locally but ignored by Git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
import yfinance as yf


PAPER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.market_weather import build_market_weather  # noqa: E402
from app.services import market_weather_research as market_weather_research_module  # noqa: E402
from app.services.option_field_context import build_option_field_context  # noqa: E402


START_DATE = "2018-01-01"
END_DATE_EXCLUSIVE = "2026-07-22"
AS_OF_DATE = "2026-07-21"
SYMBOLS = ("SPY", "QQQ", "IWM", "TLT", "GLD", "USO", "VNQ", "BTC-USD")
PRIMARY_SOURCE_PATHS = (
    Path("backend/app/services/market_weather.py"),
    Path("backend/app/services/market_weather_research.py"),
    Path("backend/app/services/market_weather_context.py"),
    Path("backend/app/services/option_field_context.py"),
    Path("docs/papers/market-field/scripts/generate_assets.py"),
)
PRIMARY_ARTIFACT_PATHS = (
    Path("docs/papers/market-field/results/asset_summary.csv"),
    Path("docs/papers/market-field/results/validation_summary.json"),
    Path("docs/papers/market-field/results/representation_baseline.csv"),
    Path("docs/papers/market-field/results/representation_window_stability.csv"),
    Path("docs/papers/market-field/results/entropy_dictionary_sensitivity.csv"),
    Path("docs/papers/market-field/results/bibliography_audit.csv"),
    Path("docs/papers/market-field/results/bibliography_audit_notes.md"),
    Path("docs/papers/market-field/results/build_receipt.json"),
    Path("docs/papers/market-field/tables/asset_summary.tex"),
    Path("docs/papers/market-field/tables/representation_comparison.tex"),
    Path("docs/papers/market-field/tables/validation_summary.tex"),
    Path("docs/papers/market-field/figures/system_overview.pdf"),
    Path("docs/papers/market-field/figures/system_overview.png"),
    Path("docs/papers/market-field/figures/spy_field_phase.pdf"),
    Path("docs/papers/market-field/figures/spy_field_phase.png"),
    Path("docs/papers/market-field/figures/synthetic_diagnostics.pdf"),
    Path("docs/papers/market-field/figures/synthetic_diagnostics.png"),
    Path("docs/papers/market-field/figures/calibration_rates.pdf"),
    Path("docs/papers/market-field/figures/calibration_rates.png"),
    Path("docs/papers/market-field/figures/representation_sensitivity.pdf"),
    Path("docs/papers/market-field/figures/representation_sensitivity.png"),
)
PREFIX_CHANNELS = (
    "pressure",
    "velocity",
    "acceleration",
    "jerk",
    "snap",
    "scale_gradient",
    "scale_curvature",
    "mixed_derivative",
    "cascade_velocity",
    "propagation_strength",
    "permutation_entropy",
)

BLUE = "#2F6B9A"
BLUE_DARK = "#173F5F"
BLUE_LIGHT = "#A9C7DB"
ORANGE = "#D98324"
ORANGE_DARK = "#8C4B12"
GOLD = "#C6A33B"
INK = "#1F2937"
MUTED = "#667085"
GRID = "#D7DEE7"
PAPER = "#FBFCFE"
FIELD_CMAP = LinearSegmentedColormap.from_list(
    "market_field",
    [ORANGE_DARK, ORANGE, "#F4F1EA", BLUE_LIGHT, BLUE_DARK],
    N=256,
)


def _json_default(value: object) -> object:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    raise TypeError(f"Cannot serialize {type(value)!r}")


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=_json_default) + "\n",
        encoding="utf-8",
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json_sha256(payload: object) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _git_worktree_state() -> dict[str, object]:
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    porcelain = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    status_paths = [
        {"status": line[:2], "path": line[3:]}
        for line in porcelain
        if len(line) >= 4
    ]
    return {
        "head": head,
        "dirty": bool(status_paths),
        "status_paths": status_paths,
    }


def _dependency_versions() -> dict[str, str]:
    packages = ("matplotlib", "numpy", "pandas", "scipy", "yfinance")
    versions: dict[str, str] = {}
    for package in packages:
        try:
            versions[package] = version(package)
        except PackageNotFoundError:
            versions[package] = "not-installed"
    return versions


def _primary_run_core(started_at_utc: str) -> dict[str, object]:
    missing = [str(path) for path in PRIMARY_SOURCE_PATHS if not (REPO_ROOT / path).is_file()]
    if missing:
        raise RuntimeError(f"Primary provenance sources are missing: {missing}")
    return {
        "schema_version": "market_field_primary_run_receipt_v1",
        "started_at_utc": started_at_utc,
        "git": _git_worktree_state(),
        "backend_sources_sha256": {
            path.as_posix(): _sha256_file(REPO_ROOT / path)
            for path in PRIMARY_SOURCE_PATHS[:-1]
        },
        "generator": {
            "path": PRIMARY_SOURCE_PATHS[-1].as_posix(),
            "sha256": _sha256_file(REPO_ROOT / PRIMARY_SOURCE_PATHS[-1]),
        },
        "runtime": {
            "python": platform.python_version(),
            "python_implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "dependencies": _dependency_versions(),
        },
    }


def _history_hash(frame: pd.DataFrame) -> str:
    canonical = frame[["Open", "High", "Low", "Close", "Volume"]].to_csv(
        date_format="%Y-%m-%dT%H:%M:%SZ",
        float_format="%.10g",
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _normalize_history(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise RuntimeError("Market-data provider returned no observations.")
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index, errors="coerce", utc=True)
    normalized = normalized[normalized.index.notna()]
    normalized = normalized[~normalized.index.duplicated(keep="last")].sort_index()
    required = ["Open", "High", "Low", "Close", "Volume"]
    missing = [column for column in required if column not in normalized.columns]
    if missing:
        raise RuntimeError(f"Market-data response is missing {missing}.")
    normalized = normalized[required].apply(pd.to_numeric, errors="coerce")
    normalized["Volume"] = normalized["Volume"].fillna(0.0)
    normalized = normalized.dropna(subset=["Open", "High", "Low", "Close"])
    if len(normalized) < 180:
        raise RuntimeError(f"Only {len(normalized)} usable observations were returned.")
    return normalized


def load_history(symbol: str, *, refresh: bool, offline: bool) -> tuple[pd.DataFrame, str]:
    cache_path = PAPER_ROOT / "cache" / f"{symbol.replace('-', '_')}.csv"
    if cache_path.exists() and not refresh:
        cached = pd.read_csv(cache_path, index_col=0)
        return _normalize_history(cached), "local_cache"
    if offline:
        raise RuntimeError(f"Offline mode requested but {cache_path.name} is unavailable.")
    history = yf.Ticker(symbol).history(
        start=START_DATE,
        end=END_DATE_EXCLUSIVE,
        auto_adjust=True,
        actions=False,
    )
    normalized = _normalize_history(history)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    normalized.to_csv(cache_path, date_format="%Y-%m-%dT%H:%M:%SZ")
    return normalized, "yahoo_finance_via_yfinance"


def _lexicon_hash(lexicon: dict[str, Any]) -> str:
    encoded = json.dumps(lexicon, sort_keys=True, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _synthetic_frame(returns: np.ndarray, *, start: str = "2020-01-01") -> pd.DataFrame:
    close = 100.0 * np.exp(np.cumsum(returns))
    open_price = np.r_[close[0], close[:-1]]
    high = np.maximum(open_price, close) * 1.002
    low = np.minimum(open_price, close) * 0.998
    return pd.DataFrame(
        {
            "Open": open_price,
            "High": high,
            "Low": low,
            "Close": close,
            "Volume": np.full(len(close), 1_000_000.0),
        },
        index=pd.bdate_range(start, periods=len(close), tz="UTC"),
    )


def _synthetic_diagnostics() -> tuple[dict[str, Any], dict[str, Any]]:
    observation_count = 800
    reversal_index = 400
    returns = np.r_[
        np.full(reversal_index, 0.0010),
        np.full(observation_count - reversal_index, -0.0015),
    ]
    reversal_frame = _synthetic_frame(returns)
    reversal_field = build_market_weather(
        reversal_frame,
        include_retrospective_research=False,
    )
    pressure = np.asarray(reversal_field["channels"]["pressure"], dtype=float)
    horizons = np.asarray(reversal_field["horizons"], dtype=int)
    threshold = -0.05
    delays: list[int] = []
    for row in pressure:
        crossings = np.flatnonzero(row[reversal_index:] < threshold)
        delays.append(int(crossings[0]) if len(crossings) else observation_count - reversal_index)
    propagation_rho = float(spearmanr(horizons, delays).statistic)

    trend_returns = np.full(700, 0.0007) + 0.0001 * np.sin(np.arange(700) / 7.0)
    chop_returns = (
        0.003 * np.where(np.arange(700) % 2 == 0, 1.0, -1.0)
        + 0.0002 * np.sin(np.arange(700) / 3.0)
    )
    segment_metrics: dict[str, dict[str, float]] = {}
    for label, segment_returns in (("Organized trend", trend_returns), ("Alternating chop", chop_returns)):
        field = build_market_weather(
            _synthetic_frame(segment_returns),
            include_retrospective_research=False,
        )
        channel = field["channels"]
        strata_rows = field["research"]["strata"]["series"][-200:]
        segment_metrics[label] = {
            "mean_abs_pressure": float(np.mean(np.abs(np.asarray(channel["pressure"])[:, -200:]))),
            "structure": float(np.mean([row["structure"] for row in strata_rows])),
            "information": float(np.mean([row["information"] for row in strata_rows])),
            "permutation_entropy": float(
                np.mean(np.asarray(channel["permutation_entropy"])[:, -200:])
            ),
        }

    summary = {
        "reversal_index": reversal_index,
        "pressure_threshold": threshold,
        "horizons": horizons.tolist(),
        "crossing_delays_bars": delays,
        "horizon_delay_spearman_rho": propagation_rho,
        "segment_metrics": segment_metrics,
    }
    payload = {
        "frame": reversal_frame,
        "field": reversal_field,
        "pressure": pressure,
        "horizons": horizons,
        "summary": summary,
    }
    return summary, payload


def _analyze_assets(
    histories: dict[str, pd.DataFrame],
) -> tuple[pd.DataFrame, dict[str, dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    fields: dict[str, dict[str, Any]] = {}
    prefix_comparisons = 0
    prefix_violations = 0
    prefix_max_abs_difference = 0.0
    deterministic_matches = 0
    deterministic_hashes: dict[str, str] = {}
    input_rows_received = 0
    input_rows_used = 0
    input_price_rows_dropped = 0

    for symbol, history in histories.items():
        full = build_market_weather(history)
        fields[symbol] = full
        input_quality = full["input_quality"]
        input_rows_received += int(input_quality["rows_received"])
        input_rows_used += int(input_quality["rows_used"])
        input_price_rows_dropped += int(input_quality["rows_received"]) - int(input_quality["rows_used"])
        lexicon = full["research"]["lexicon"]
        repeated = build_market_weather(history)["research"]["lexicon"]
        first_hash = _lexicon_hash(lexicon)
        second_hash = _lexicon_hash(repeated)
        deterministic_hashes[symbol] = first_hash
        deterministic_matches += int(first_hash == second_hash)

        training = lexicon["training_split"]
        evaluation = lexicon["evaluation_sequence"]
        supported = [row for row in evaluation if row.get("distance_tail_score") is not None]
        outside_count = sum(bool(row.get("outside_learned_range")) for row in supported)
        transition_count = sum(
            evaluation[index]["state_id"] != evaluation[index - 1]["state_id"]
            for index in range(1, len(evaluation))
        )
        rows.append(
            {
                "symbol": symbol,
                "bars": len(full["dates"]),
                "start": pd.Timestamp(full["dates"][0]).date().isoformat(),
                "end": pd.Timestamp(full["dates"][-1]).date().isoformat(),
                "forms": int(training["archetype_count"]),
                "fit_silhouette": float(training["fit_mean_silhouette"]),
                "evaluation_bars": len(evaluation),
                "tail_supported_bars": len(supported),
                "outside_range_count": outside_count,
                "outside_range_rate": outside_count / len(supported) if supported else np.nan,
                "transitions_per_100_bars": (
                    100.0 * transition_count / max(1, len(evaluation) - 1)
                ),
            }
        )

        live_full = build_market_weather(
            history,
            include_retrospective_research=False,
        )
        full_date_indexes = {date: index for index, date in enumerate(live_full["dates"])}
        cuts = sorted(
            {
                max(120, len(history) // 3),
                len(history) // 2,
                (2 * len(history)) // 3,
                len(history) - 50,
            }
        )
        for cut in cuts:
            prefix = build_market_weather(
                history.iloc[:cut],
                include_retrospective_research=False,
            )
            prefix_endpoint = prefix["dates"][-1]
            full_endpoint_index = full_date_indexes[prefix_endpoint]
            for channel_name in PREFIX_CHANNELS:
                full_values = np.asarray(live_full["channels"][channel_name], dtype=float)[:, full_endpoint_index]
                prefix_values = np.asarray(prefix["channels"][channel_name], dtype=float)[:, -1]
                differences = np.abs(full_values - prefix_values)
                prefix_comparisons += int(differences.size)
                prefix_violations += int(np.count_nonzero(differences))
                prefix_max_abs_difference = max(
                    prefix_max_abs_difference,
                    float(np.max(differences)),
                )

    summary_frame = pd.DataFrame(rows)
    supported_total = int(summary_frame["tail_supported_bars"].sum())
    outside_total = int(summary_frame["outside_range_count"].sum())
    validation = {
        "prefix_invariance": {
            "symbols": len(histories),
            "channels": len(PREFIX_CHANNELS),
            "serialized_value_comparisons": prefix_comparisons,
            "nonzero_differences": prefix_violations,
            "maximum_absolute_difference": prefix_max_abs_difference,
            "precision": "API serialization rounded to 1e-4",
        },
        "determinism": {
            "exact_lexicon_matches": deterministic_matches,
            "symbols": len(histories),
            "sha256_by_symbol": deterministic_hashes,
        },
        "distance_tail": {
            "supported_evaluation_bars": supported_total,
            "outside_range_bars": outside_total,
            "pooled_outside_range_rate": outside_total / supported_total if supported_total else None,
            "cutoff": 0.05,
            "coverage_guarantee": False,
            "asset_rate_min": float(summary_frame["outside_range_rate"].min()),
            "asset_rate_max": float(summary_frame["outside_range_rate"].max()),
        },
        "input_quality": {
            "rows_received": input_rows_received,
            "rows_used": input_rows_used,
            "price_rows_dropped": input_price_rows_dropped,
        },
        "codebook_gate": {
            "nontrivial_codebooks": int((summary_frame["forms"] > 1).sum()),
            "single_form_fallbacks": int((summary_frame["forms"] == 1).sum()),
            "symbols": len(summary_frame),
        },
    }
    return summary_frame, fields, validation


def _adjusted_rand_index(left: Sequence[str], right: Sequence[str]) -> float | None:
    """Return label-invariant partition agreement without a sklearn dependency."""
    if len(left) != len(right) or len(left) < 2:
        return None
    left_levels = {value: index for index, value in enumerate(sorted(set(left)))}
    right_levels = {value: index for index, value in enumerate(sorted(set(right)))}
    contingency = np.zeros((len(left_levels), len(right_levels)), dtype=int)
    for left_value, right_value in zip(left, right):
        contingency[left_levels[left_value], right_levels[right_value]] += 1

    def choose_two(values: np.ndarray) -> float:
        return float(np.sum(values * (values - 1) / 2.0))

    sum_cells = choose_two(contingency)
    sum_rows = choose_two(contingency.sum(axis=1))
    sum_columns = choose_two(contingency.sum(axis=0))
    total_pairs = len(left) * (len(left) - 1) / 2.0
    expected = (sum_rows * sum_columns / total_pairs) if total_pairs else 0.0
    maximum = 0.5 * (sum_rows + sum_columns)
    denominator = maximum - expected
    if abs(denominator) <= 1e-12:
        return 1.0 if list(left) == list(right) else 0.0
    return float((sum_cells - expected) / denominator)


def _single_horizon_baseline_features(history: pd.DataFrame) -> np.ndarray:
    """Build a cheap causal 24-bar EMA/path/variation/volume baseline."""
    epsilon = 1e-9
    close = history["Close"].astype(float)
    high = history["High"].astype(float)
    low = history["Low"].astype(float)
    volume = history["Volume"].astype(float).where(lambda values: values >= 0.0)
    midpoint = (high + low) / 2.0
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr24 = true_range.rolling(24, min_periods=1).mean()
    ema12 = midpoint.ewm(
        span=12,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    ema24 = midpoint.ewm(
        span=24,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()

    def signed_bound(values: pd.Series) -> pd.Series:
        finite = values.replace([np.inf, -np.inf], np.nan).fillna(0.0)
        return finite / (1.0 + finite.abs())

    ema_displacement = signed_bound((ema12 - ema24) / atr24.clip(lower=epsilon))
    ema_change = ema24.diff().fillna(0.0)
    ema_change_scale = ema_change.abs().ewm(
        span=13,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    ema_slope = signed_bound(ema_change / ema_change_scale.clip(lower=epsilon))

    path = midpoint.diff().abs().rolling(24, min_periods=1).sum()
    displacement = midpoint - midpoint.shift(24)
    path_efficiency = (
        displacement.abs() / path.clip(lower=epsilon)
    ).clip(0.0, 1.0) * np.sign(displacement.fillna(0.0))

    returns = np.log(close.clip(lower=epsilon)).diff().fillna(0.0)
    realized_variation = np.sqrt(
        returns.pow(2).rolling(24, min_periods=1).sum()
    )
    variation_baseline = realized_variation.ewm(
        span=48,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    variation_ratio = signed_bound(
        np.log((realized_variation + epsilon) / (variation_baseline + epsilon))
    )

    rolling_volume = volume.rolling(24, min_periods=1).mean()
    volume_baseline = rolling_volume.ewm(
        span=48,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    volume_ratio = signed_bound(
        np.log((rolling_volume + epsilon) / (volume_baseline + epsilon))
    )
    return np.nan_to_num(
        np.column_stack(
            [
                ema_displacement.to_numpy(dtype=float),
                ema_slope.to_numpy(dtype=float),
                path_efficiency.to_numpy(dtype=float),
                variation_ratio.to_numpy(dtype=float),
                volume_ratio.to_numpy(dtype=float),
            ]
        ),
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )


def _evaluate_equal_weight_codebook(
    values: np.ndarray,
    dates: Sequence[str],
    *,
    requested_warmup_bars: int = 128,
) -> dict[str, Any]:
    """Apply the production chronology and codebook gate to an alternate vector."""
    count = len(values)
    evaluation_start = max(5, min(int(count * 0.60), count - 6))
    fit_start = min(
        max(0, requested_warmup_bars),
        max(0, evaluation_start - 40),
    )
    pre_evaluation_bars = evaluation_start - fit_start
    desired_calibration_bars = max(20, pre_evaluation_bars // 3)
    calibration_bars = min(
        desired_calibration_bars,
        max(0, pre_evaluation_bars - 20),
    )
    calibration_start = evaluation_start - calibration_bars
    standardized, _, _ = market_weather_research_module._robust_standardize(
        values,
        fit_start,
        calibration_start,
    )
    metric_values = standardized / np.sqrt(max(1, values.shape[1]))
    raw_centroids, minimum_form_support = (
        market_weather_research_module._select_supported_centroids(
            metric_values[fit_start:calibration_start],
            max_clusters=5,
        )
    )
    cluster_order = sorted(
        range(len(raw_centroids)),
        key=lambda index: tuple(np.round(raw_centroids[index], 10).tolist()) + (index,),
    )
    centroids = raw_centroids[np.asarray(cluster_order, dtype=int)]
    distance_matrix = np.stack(
        [
            np.sum(np.square(metric_values - centroid), axis=1)
            for centroid in centroids
        ],
        axis=1,
    )
    assignments = np.argmin(distance_matrix, axis=1)
    nearest_distance = np.sqrt(np.min(distance_matrix, axis=1))
    fit_silhouette = market_weather_research_module._mean_silhouette(
        metric_values[fit_start:calibration_start],
        assignments[fit_start:calibration_start],
        len(centroids),
    )
    calibration_distances_by_state = {
        state: nearest_distance[
            np.flatnonzero(assignments[calibration_start:evaluation_start] == state)
            + calibration_start
        ]
        for state in range(len(centroids))
    }
    sequence: list[dict[str, object]] = []
    for index in range(evaluation_start, count):
        state = int(assignments[index])
        reference = calibration_distances_by_state[state]
        tail_rank = market_weather_research_module._empirical_distance_tail_score(
            float(nearest_distance[index]),
            reference,
        )
        sequence.append(
            {
                "date": dates[index],
                "state_id": f"B.{state + 1:03d}",
                "tail_rank": tail_rank,
                "tail_support": int(np.sum(np.isfinite(reference))),
                "extreme_tail": (
                    tail_rank < market_weather_research_module.DISTANCE_TAIL_CUTOFF
                    if tail_rank is not None
                    else None
                ),
            }
        )
    supported = [row for row in sequence if row["tail_rank"] is not None]
    state_ids = [str(row["state_id"]) for row in sequence]
    transitions = sum(
        left != right
        for left, right in zip(state_ids, state_ids[1:])
    )
    return {
        "forms": len(centroids),
        "features": int(values.shape[1]),
        "requested_warmup_bars": int(requested_warmup_bars),
        "fit_silhouette": float(fit_silhouette),
        "minimum_form_support": int(minimum_form_support),
        "fit_bars": int(calibration_start - fit_start),
        "calibration_bars": int(evaluation_start - calibration_start),
        "evaluation_bars": int(count - evaluation_start),
        "tail_supported_bars": len(supported),
        "tail_rate": (
            sum(bool(row["extreme_tail"]) for row in supported) / len(supported)
            if supported
            else np.nan
        ),
        "transitions_per_100_bars": (
            100.0 * transitions / max(1, len(sequence) - 1)
        ),
        "sequence": sequence,
    }


def _production_codebook_summary(field: dict[str, Any]) -> dict[str, Any]:
    lexicon = field["research"]["lexicon"]
    split = lexicon["training_split"]
    sequence = lexicon["evaluation_sequence"]
    supported = [row for row in sequence if row.get("distance_tail_score") is not None]
    state_ids = [str(row["state_id"]) for row in sequence]
    transitions = sum(left != right for left, right in zip(state_ids, state_ids[1:]))
    return {
        "forms": int(split["archetype_count"]),
        "features": 15,
        "requested_warmup_bars": int(split["requested_warmup_bars"]),
        "fit_silhouette": float(split["fit_mean_silhouette"]),
        "minimum_form_support": int(split["minimum_form_support"]),
        "fit_bars": int(split["fit_bars"]),
        "calibration_bars": int(split["calibration_bars"]),
        "evaluation_bars": int(split["evaluation_bars"]),
        "tail_supported_bars": len(supported),
        "tail_rate": (
            sum(bool(row["outside_learned_range"]) for row in supported) / len(supported)
            if supported
            else np.nan
        ),
        "transitions_per_100_bars": (
            100.0 * transitions / max(1, len(sequence) - 1)
        ),
        "sequence": sequence,
    }


def _build_with_entropy_window(
    history: pd.DataFrame,
    entropy_window: int,
) -> dict[str, Any]:
    """Recompute the complete production field with one entropy-window ablation."""
    original = market_weather_research_module.rolling_permutation_entropy

    def configured_entropy(
        values: np.ndarray,
        order: int = 3,
        window: int = 24,
    ) -> np.ndarray:
        del window
        return original(values, order=order, window=entropy_window)

    market_weather_research_module.rolling_permutation_entropy = configured_entropy
    try:
        return build_market_weather(history)
    finally:
        market_weather_research_module.rolling_permutation_entropy = original


def _sequence_ari(
    reference: Sequence[dict[str, object]],
    candidate: Sequence[dict[str, object]],
) -> tuple[float | None, int]:
    reference_by_date = {
        str(row["date"]): str(row["state_id"])
        for row in reference
    }
    candidate_by_date = {
        str(row["date"]): str(row["state_id"])
        for row in candidate
    }
    dates = sorted(set(reference_by_date) & set(candidate_by_date))
    return (
        _adjusted_rand_index(
            [reference_by_date[date] for date in dates],
            [candidate_by_date[date] for date in dates],
        ),
        len(dates),
    )


def _representation_checks(
    histories: dict[str, pd.DataFrame],
    fields: dict[str, dict[str, Any]],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Compare v1 with a cheap baseline and propagate entropy sensitivity downstream."""
    comparison_rows: list[dict[str, Any]] = []
    full_sequences: dict[str, Sequence[dict[str, object]]] = {}
    baseline_sequences: dict[str, Sequence[dict[str, object]]] = {}
    for symbol, history in histories.items():
        production = _production_codebook_summary(fields[symbol])
        baseline = _evaluate_equal_weight_codebook(
            _single_horizon_baseline_features(history),
            [pd.Timestamp(value).isoformat() for value in history.index],
            requested_warmup_bars=int(production["requested_warmup_bars"]),
        )
        full_sequences[symbol] = production["sequence"]
        baseline_sequences[symbol] = baseline["sequence"]
        for representation, summary in (
            ("market_field_v1", production),
            ("single_horizon_baseline", baseline),
        ):
            comparison_rows.append(
                {
                    "symbol": symbol,
                    "representation": representation,
                    **{
                        key: value
                        for key, value in summary.items()
                        if key != "sequence"
                    },
                }
            )
    comparison = pd.DataFrame(comparison_rows)

    stability_rows: list[dict[str, Any]] = []
    spy_history = histories["SPY"]
    for fraction in (0.70, 0.85):
        cutoff = int(round(len(spy_history) * fraction))
        production_prefix = _production_codebook_summary(
            build_market_weather(spy_history.iloc[:cutoff])
        )
        baseline_prefix = _evaluate_equal_weight_codebook(
            _single_horizon_baseline_features(spy_history.iloc[:cutoff]),
            [pd.Timestamp(value).isoformat() for value in spy_history.index[:cutoff]],
            requested_warmup_bars=int(production_prefix["requested_warmup_bars"]),
        )
        for representation, reference, candidate in (
            (
                "market_field_v1",
                full_sequences["SPY"],
                production_prefix["sequence"],
            ),
            (
                "single_horizon_baseline",
                baseline_sequences["SPY"],
                baseline_prefix["sequence"],
            ),
        ):
            ari, overlap = _sequence_ari(reference, candidate)
            stability_rows.append(
                {
                    "representation": representation,
                    "prefix_fraction": fraction,
                    "prefix_bars": cutoff,
                    "prefix_forms": int(candidate["forms"])
                    if isinstance(candidate, dict) and "forms" in candidate
                    else (
                        int(production_prefix["forms"])
                        if representation == "market_field_v1"
                        else int(baseline_prefix["forms"])
                    ),
                    "full_forms": int(
                        comparison.loc[
                            (comparison["symbol"] == "SPY")
                            & (comparison["representation"] == representation),
                            "forms",
                        ].iloc[0]
                    ),
                    "overlap_bars": overlap,
                    "adjusted_rand_index": ari,
                }
            )
    stability = pd.DataFrame(stability_rows)

    entropy_rows: list[dict[str, Any]] = []
    entropy_fields: dict[int, dict[str, Any]] = {
        window: _build_with_entropy_window(spy_history, window)
        for window in (8, 12, 24, 48, 96)
    }
    reference = _production_codebook_summary(entropy_fields[24])
    reference_information = np.asarray(
        [
            row["information"]
            for row in entropy_fields[24]["research"]["strata"]["series"]
        ],
        dtype=float,
    )
    for window, field in entropy_fields.items():
        summary = _production_codebook_summary(field)
        information = np.asarray(
            [row["information"] for row in field["research"]["strata"]["series"]],
            dtype=float,
        )
        finite = np.isfinite(reference_information) & np.isfinite(information)
        information_correlation = (
            float(np.corrcoef(reference_information[finite], information[finite])[0, 1])
            if int(np.sum(finite)) >= 3
            and float(np.std(reference_information[finite])) > 1e-12
            and float(np.std(information[finite])) > 1e-12
            else np.nan
        )
        assignment_ari, overlap = _sequence_ari(
            reference["sequence"],
            summary["sequence"],
        )
        entropy_rows.append(
            {
                "symbol": "SPY",
                "entropy_window_patterns": window,
                "information_correlation_vs_window24": information_correlation,
                "forms": int(summary["forms"]),
                "fit_silhouette": float(summary["fit_silhouette"]),
                "assignment_ari_vs_window24": assignment_ari,
                "assignment_overlap_bars": overlap,
                "tail_supported_bars": int(summary["tail_supported_bars"]),
                "tail_rate": float(summary["tail_rate"]),
                "transitions_per_100_bars": float(
                    summary["transitions_per_100_bars"]
                ),
            }
        )
    entropy = pd.DataFrame(entropy_rows).sort_values("entropy_window_patterns")

    summary = {
        "baseline_definition": {
            "horizon_bars": 24,
            "features": [
                "EMA12-minus-EMA24 normalized by ATR24",
                "EMA24 bounded causal slope",
                "signed 24-bar path efficiency",
                "24-bar realized-variation ratio to causal EWM48",
                "24-bar mean-volume ratio to causal EWM48",
            ],
            "shared_with_market_field": (
                "Chronological split, proper-fit robust scaling, equal total metric "
                "weight, deterministic farthest-first k-means, 5%/20-bar support "
                "gate, 0.25 silhouette gate, held-out state-conditional calibration "
                "distance, and evaluation chronology."
            ),
        },
        "market_field_nontrivial_codebooks": int(
            np.sum(
                (comparison["representation"] == "market_field_v1")
                & (comparison["forms"] > 1)
            )
        ),
        "baseline_nontrivial_codebooks": int(
            np.sum(
                (comparison["representation"] == "single_horizon_baseline")
                & (comparison["forms"] > 1)
            )
        ),
        "market_field_median_fit_silhouette": float(
            comparison.loc[
                comparison["representation"] == "market_field_v1",
                "fit_silhouette",
            ].median()
        ),
        "baseline_median_fit_silhouette": float(
            comparison.loc[
                comparison["representation"] == "single_horizon_baseline",
                "fit_silhouette",
            ].median()
        ),
        "spy_window_stability": stability.to_dict(orient="records"),
        "spy_entropy_dictionary_sensitivity": entropy.to_dict(orient="records"),
        "claim_scope": (
            "Unsupervised representation diagnostics only; no predictive, economic, "
            "or natural-state claim."
        ),
    }
    return comparison, stability, entropy, summary


def _benchmark_option_snapshots(histories: dict[str, pd.DataFrame]) -> dict[str, Any]:
    durations_ms: list[float] = []
    payload_sizes: list[int] = []
    states: dict[str, str] = {}
    observed_at = datetime(2026, 7, 22, 15, 0, tzinfo=timezone.utc)
    for symbol, history in histories.items():
        compact_history = history.tail(365)
        build_option_field_context(
            compact_history,
            option_type="call",
            observed_at=observed_at,
            data_source="yahoo_finance_via_yfinance",
        )
        payload: dict[str, Any] = {}
        for _ in range(10):
            started = time.perf_counter()
            payload = build_option_field_context(
                compact_history,
                option_type="call",
                observed_at=observed_at,
                data_source="yahoo_finance_via_yfinance",
            )
            durations_ms.append((time.perf_counter() - started) * 1000.0)
            payload_sizes.append(
                len(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            )
        states[symbol] = str(payload["classification"]["path_state"])
    return {
        "runs": len(durations_ms),
        "symbols": len(histories),
        "bars_per_snapshot": 365,
        "median_ms": float(np.median(durations_ms)),
        "p95_ms": float(np.quantile(durations_ms, 0.95)),
        "maximum_ms": float(np.max(durations_ms)),
        "median_payload_bytes": int(np.median(payload_sizes)),
        "maximum_payload_bytes": int(np.max(payload_sizes)),
        "rank_influence": 0.0,
        "automated_execution_enabled": False,
        "call_aligned_state_by_symbol": states,
        "environment_note": "Single-process local Windows benchmark; excludes data retrieval.",
    }


def _style_axes(axis: plt.Axes, *, grid_axis: str = "y") -> None:
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color(GRID)
    axis.tick_params(colors=MUTED, labelsize=8)
    if grid_axis:
        axis.grid(axis=grid_axis, color=GRID, linewidth=0.6, alpha=0.7)
        axis.set_axisbelow(True)


def _save_figure(figure: plt.Figure, name: str) -> None:
    figure.patch.set_facecolor(PAPER)
    figure.savefig(PAPER_ROOT / "figures" / f"{name}.pdf", bbox_inches="tight")
    figure.savefig(PAPER_ROOT / "figures" / f"{name}.png", dpi=220, bbox_inches="tight")
    plt.close(figure)


def _plot_system_overview() -> None:
    figure, axis = plt.subplots(figsize=(10.5, 3.0))
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.axis("off")
    boxes = [
        (0.015, 0.38, 0.135, 0.30, "Completed\nOHLCV bars", BLUE_LIGHT),
        (0.18, 0.38, 0.145, 0.30, "Horizon surface\n$P(h,t)$", "#DCE9F2"),
        (0.355, 0.38, 0.145, 0.30, "Time/scale\nderivatives", "#E9EDF3"),
        (0.53, 0.38, 0.145, 0.30, "Strata, carriers,\nprior boundaries", "#F3E8D8"),
        (0.705, 0.38, 0.13, 0.30, "Translation +\npath state", "#F7EDD1"),
        (0.865, 0.38, 0.12, 0.30, "Immutable\noutcome ledger", "#E4E8EE"),
    ]
    for x, y, width, height, label, color in boxes:
        patch = FancyBboxPatch(
            (x, y),
            width,
            height,
            boxstyle="round,pad=0.012,rounding_size=0.02",
            linewidth=1.0,
            edgecolor=INK,
            facecolor=color,
        )
        axis.add_patch(patch)
        axis.text(x + width / 2, y + height / 2, label, ha="center", va="center", color=INK, fontsize=9)
    for index in range(len(boxes) - 1):
        left = boxes[index]
        right = boxes[index + 1]
        arrow = FancyArrowPatch(
            (left[0] + left[2] + 0.006, 0.53),
            (right[0] - 0.006, 0.53),
            arrowstyle="-|>",
            mutation_scale=11,
            linewidth=1.2,
            color=BLUE_DARK,
        )
        axis.add_patch(arrow)
    axis.annotate(
        "fit only",
        xy=(0.765, 0.70),
        xytext=(0.765, 0.82),
        ha="center",
        va="center",
        fontsize=8,
        color=ORANGE_DARK,
        arrowprops={"arrowstyle": "-|>", "color": ORANGE_DARK, "lw": 1.0},
    )
    axis.text(
        0.50,
        0.17,
        "Forward outcomes never fit the field or codebook; option context remains shadow-only with rank influence 0.",
        ha="center",
        va="center",
        fontsize=9,
        color=MUTED,
    )
    axis.set_title("Causal computation and prospective evaluation boundary", loc="left", color=INK, fontsize=12, weight="bold")
    _save_figure(figure, "system_overview")


def _plot_spy_field_phase(spy_field: dict[str, Any]) -> None:
    dates = pd.to_datetime(spy_field["dates"], utc=True)
    close = np.asarray([row["close"] for row in spy_field["price"]], dtype=float)
    horizons = np.asarray(spy_field["horizons"], dtype=float)
    pressure = np.asarray(spy_field["channels"]["pressure"], dtype=float)
    derivative_rows = spy_field["research"]["derivative_series"]
    aggregate_pressure = np.asarray([row["pressure"] for row in derivative_rows], dtype=float)
    aggregate_velocity = np.asarray([row["velocity"] for row in derivative_rows], dtype=float)

    recent_field = 504
    recent_scope = 252
    field_dates = dates[-recent_field:]
    figure = plt.figure(figsize=(10.6, 6.7))
    grid = figure.add_gridspec(3, 1, height_ratios=[0.85, 1.35, 1.25], hspace=0.34)

    price_axis = figure.add_subplot(grid[0])
    price_axis.plot(field_dates, close[-recent_field:], color=INK, linewidth=1.4)
    price_axis.set_ylabel("Adjusted close", color=MUTED, fontsize=8)
    price_axis.set_title("SPY price and causal horizon field", loc="left", fontsize=11, color=INK, weight="bold")
    price_axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=7))
    price_axis.xaxis.set_major_formatter(mdates.ConciseDateFormatter(price_axis.xaxis.get_major_locator()))
    _style_axes(price_axis)

    field_axis = figure.add_subplot(grid[1])
    date_numbers = mdates.date2num(field_dates.to_pydatetime())
    image = field_axis.imshow(
        pressure[:, -recent_field:],
        aspect="auto",
        origin="lower",
        interpolation="bilinear",
        extent=[date_numbers[0], date_numbers[-1], horizons[0], horizons[-1]],
        cmap=FIELD_CMAP,
        norm=TwoSlopeNorm(vmin=-0.55, vcenter=0.0, vmax=0.55),
    )
    field_axis.xaxis_date()
    field_axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=7))
    field_axis.xaxis.set_major_formatter(mdates.ConciseDateFormatter(field_axis.xaxis.get_major_locator()))
    field_axis.set_ylabel("Horizon (bars)", color=MUTED, fontsize=8)
    field_axis.set_title("Signed pressure surface; orange is negative, blue is positive", loc="left", fontsize=9, color=INK)
    field_axis.tick_params(colors=MUTED, labelsize=8)
    colorbar = figure.colorbar(image, ax=field_axis, pad=0.012, fraction=0.025)
    colorbar.set_label("Pressure", fontsize=8, color=MUTED)
    colorbar.ax.tick_params(labelsize=7, colors=MUTED)

    scope_axis = figure.add_subplot(grid[2])
    scope_pressure = aggregate_pressure[-recent_scope:]
    scope_velocity = aggregate_velocity[-recent_scope:]
    progress = np.linspace(0.1, 1.0, recent_scope)
    for index in range(1, recent_scope):
        color = plt.cm.Blues(0.25 + 0.65 * progress[index])
        scope_axis.plot(
            scope_pressure[index - 1 : index + 1],
            scope_velocity[index - 1 : index + 1],
            color=color,
            linewidth=1.15,
            alpha=0.85,
        )
    scope_axis.scatter(scope_pressure[0], scope_velocity[0], s=30, facecolor=PAPER, edgecolor=BLUE_DARK, label="Window start")
    scope_axis.scatter(scope_pressure[-1], scope_velocity[-1], s=55, marker="D", color=ORANGE, edgecolor=INK, linewidth=0.5, label="Current")
    for archetype in spy_field["research"]["lexicon"]["archetypes"]:
        centroid = archetype["centroid"]
        scope_axis.scatter(
            centroid["pressure"],
            centroid["velocity"],
            s=75,
            marker="X",
            facecolor=GOLD,
            edgecolor=INK,
            linewidth=0.7,
        )
        scope_axis.annotate(
            archetype["id"],
            (centroid["pressure"], centroid["velocity"]),
            xytext=(5, 4),
            textcoords="offset points",
            fontsize=8,
            color=INK,
        )
    scope_axis.axhline(0.0, color=GRID, linewidth=0.8, linestyle="--")
    scope_axis.axvline(0.0, color=GRID, linewidth=0.8, linestyle="--")
    scope_axis.set_xlabel("Aggregate pressure", color=MUTED, fontsize=8)
    scope_axis.set_ylabel("Pressure change", color=MUTED, fontsize=8)
    scope_axis.set_title("Engineered pressure--change trajectory; newer segments are darker", loc="left", fontsize=9, color=INK)
    scope_axis.legend(frameon=False, fontsize=7, loc="best")
    _style_axes(scope_axis, grid_axis="both")

    figure.text(
        0.01,
        0.005,
        f"Adjusted daily data, {field_dates[0].date()} to {field_dates[-1].date()}. The scope is a measured trajectory, not an attractor test.",
        fontsize=7.5,
        color=MUTED,
    )
    _save_figure(figure, "spy_field_phase")


def _plot_synthetic_diagnostics(payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    pressure = payload["pressure"]
    horizons = payload["horizons"]
    reversal_index = int(summary["reversal_index"])
    delays = np.asarray(summary["crossing_delays_bars"], dtype=float)
    window = slice(reversal_index - 40, reversal_index + 100)

    figure, axes = plt.subplots(1, 3, figsize=(11.0, 3.45), gridspec_kw={"width_ratios": [1.25, 0.9, 1.15]})

    heat_axis = axes[0]
    heat = heat_axis.imshow(
        pressure[:, window],
        aspect="auto",
        origin="lower",
        interpolation="nearest",
        extent=[-40, 99, horizons[0], horizons[-1]],
        cmap=FIELD_CMAP,
        norm=TwoSlopeNorm(vmin=-0.55, vcenter=0.0, vmax=0.55),
    )
    heat_axis.axvline(0, color=INK, linestyle="--", linewidth=1.0)
    heat_axis.set_xlabel("Bars from reversal", fontsize=8, color=MUTED)
    heat_axis.set_ylabel("Horizon (bars)", fontsize=8, color=MUTED)
    heat_axis.set_title("A  Synthetic reversal field", loc="left", fontsize=9, color=INK, weight="bold")
    heat_axis.tick_params(labelsize=7, colors=MUTED)
    colorbar = figure.colorbar(heat, ax=heat_axis, fraction=0.04, pad=0.03)
    colorbar.ax.tick_params(labelsize=6, colors=MUTED)

    delay_axis = axes[1]
    delay_axis.plot(delays, horizons, color=BLUE_DARK, linewidth=1.4)
    delay_axis.scatter(delays, horizons, color=BLUE, edgecolor=INK, linewidth=0.35, s=23)
    delay_axis.set_xlabel("Threshold delay (bars)", fontsize=8, color=MUTED)
    delay_axis.set_ylabel("Horizon (bars)", fontsize=8, color=MUTED)
    delay_axis.set_title("B  Front propagation", loc="left", fontsize=9, color=INK, weight="bold")
    delay_axis.text(
        0.04,
        0.94,
        rf"Spearman $\rho={summary['horizon_delay_spearman_rho']:.3f}$",
        transform=delay_axis.transAxes,
        va="top",
        fontsize=7.5,
        color=MUTED,
    )
    _style_axes(delay_axis, grid_axis="both")

    comparison_axis = axes[2]
    metric_keys = ("mean_abs_pressure", "structure", "information", "permutation_entropy")
    labels = (r"Mean $|P|$", "Structure", "Information", "Perm. entropy")
    trend = [summary["segment_metrics"]["Organized trend"][key] for key in metric_keys]
    chop = [summary["segment_metrics"]["Alternating chop"][key] for key in metric_keys]
    positions = np.arange(len(metric_keys))
    width = 0.36
    comparison_axis.bar(positions - width / 2, trend, width, color=BLUE, edgecolor=INK, linewidth=0.45, label="Trend")
    comparison_axis.bar(positions + width / 2, chop, width, color=ORANGE, edgecolor=INK, linewidth=0.45, hatch="//", label="Chop")
    comparison_axis.set_xticks(positions, labels, rotation=22, ha="right")
    comparison_axis.set_ylim(0.0, 1.0)
    comparison_axis.set_title("C  Controlled state contrast", loc="left", fontsize=9, color=INK, weight="bold")
    comparison_axis.legend(frameon=False, fontsize=7, loc="upper right")
    _style_axes(comparison_axis)

    figure.suptitle("Synthetic diagnostics isolate scale propagation and state separation", x=0.01, ha="left", fontsize=11, color=INK, weight="bold")
    figure.text(
        0.01,
        -0.01,
        "Deterministic OHLCV constructions; these tests validate representation behavior, not return predictability.",
        fontsize=7.5,
        color=MUTED,
    )
    _save_figure(figure, "synthetic_diagnostics")


def _plot_calibration_rates(asset_summary: pd.DataFrame) -> None:
    ordered = asset_summary.sort_values("outside_range_rate", ascending=True)
    values = ordered["outside_range_rate"].to_numpy(dtype=float) * 100.0
    figure, axis = plt.subplots(figsize=(7.2, 3.7))
    bars = axis.barh(ordered["symbol"], values, color=BLUE, edgecolor=INK, linewidth=0.45)
    axis.axvline(5.0, color=GOLD, linestyle="--", linewidth=1.5, label="5% descriptive cutoff")
    for bar, (_, row) in zip(bars, ordered.iterrows(), strict=True):
        axis.text(
            bar.get_width() + 0.18,
            bar.get_y() + bar.get_height() / 2,
            f"{bar.get_width():.1f}% (n={int(row['tail_supported_bars']):,})",
            va="center",
            fontsize=7.3,
            color=INK,
        )
    axis.set_xlim(0, max(12.0, float(values.max()) + 2.4))
    axis.set_xlabel("Evaluation bars in the upper calibration-distance tail (%)", fontsize=8, color=MUTED)
    axis.set_title("State-conditional distance-tail diagnostics by asset", loc="left", fontsize=11, color=INK, weight="bold")
    axis.legend(frameon=False, fontsize=7, loc="lower right")
    _style_axes(axis, grid_axis="x")
    figure.text(
        0.01,
        -0.02,
        "Chronological fit/calibration/evaluation splits. Bars overlap in time and are not exchangeable; the cutoff has no coverage guarantee.",
        fontsize=7.3,
        color=MUTED,
    )
    _save_figure(figure, "calibration_rates")


def _plot_representation_sensitivity(
    comparison: pd.DataFrame,
    stability: pd.DataFrame,
    entropy: pd.DataFrame,
) -> None:
    figure, axes = plt.subplots(
        1,
        3,
        figsize=(11.0, 3.55),
        gridspec_kw={"width_ratios": [1.25, 0.95, 1.0]},
    )

    silhouette_axis = axes[0]
    pivot = comparison.pivot(
        index="symbol",
        columns="representation",
        values="fit_silhouette",
    ).sort_index()
    positions = np.arange(len(pivot))
    for position, (_, row) in zip(positions, pivot.iterrows(), strict=True):
        silhouette_axis.plot(
            [
                row["single_horizon_baseline"],
                row["market_field_v1"],
            ],
            [position, position],
            color=GRID,
            linewidth=1.2,
            zorder=1,
        )
    silhouette_axis.scatter(
        pivot["single_horizon_baseline"],
        positions,
        s=34,
        facecolor=PAPER,
        edgecolor=ORANGE_DARK,
        linewidth=1.2,
        label="24-bar baseline",
        zorder=2,
    )
    silhouette_axis.scatter(
        pivot["market_field_v1"],
        positions,
        s=38,
        color=BLUE,
        edgecolor=INK,
        linewidth=0.4,
        marker="D",
        label="Market Field",
        zorder=3,
    )
    silhouette_axis.set_yticks(positions, pivot.index)
    silhouette_axis.set_xlabel("Proper-fit mean silhouette", fontsize=8, color=MUTED)
    silhouette_axis.set_title(
        "A  Same clustering gate",
        loc="left",
        fontsize=9,
        color=INK,
        weight="bold",
    )
    silhouette_axis.legend(frameon=False, fontsize=7, loc="lower right")
    _style_axes(silhouette_axis, grid_axis="x")

    stability_axis = axes[1]
    stability_pivot = stability.pivot(
        index="prefix_fraction",
        columns="representation",
        values="adjusted_rand_index",
    )
    stability_positions = np.arange(len(stability_pivot))
    width = 0.34
    stability_axis.bar(
        stability_positions - width / 2,
        stability_pivot["market_field_v1"],
        width,
        color=BLUE,
        edgecolor=INK,
        linewidth=0.45,
        label="Market Field",
    )
    stability_axis.bar(
        stability_positions + width / 2,
        stability_pivot["single_horizon_baseline"],
        width,
        facecolor=PAPER,
        edgecolor=ORANGE_DARK,
        linewidth=1.0,
        hatch="//",
        label="24-bar baseline",
    )
    stability_axis.set_xticks(
        stability_positions,
        [f"{int(value * 100)}% prefix" for value in stability_pivot.index],
    )
    stability_axis.set_ylim(-0.05, 1.05)
    stability_axis.set_ylabel("SPY assignment ARI", fontsize=8, color=MUTED)
    stability_axis.set_title(
        "B  Window stability",
        loc="left",
        fontsize=9,
        color=INK,
        weight="bold",
    )
    stability_axis.legend(frameon=False, fontsize=6.8, loc="upper left")
    _style_axes(stability_axis)

    entropy_axis = axes[2]
    entropy_axis.plot(
        entropy["entropy_window_patterns"],
        entropy["assignment_ari_vs_window24"],
        color=BLUE_DARK,
        linewidth=1.5,
        marker="o",
        markersize=4.5,
    )
    entropy_axis.axvline(
        24,
        color=GOLD,
        linestyle="--",
        linewidth=1.1,
        label="v1 window",
    )
    for row in entropy.itertuples(index=False):
        entropy_axis.annotate(
            f"{int(row.forms)}F",
            (row.entropy_window_patterns, row.assignment_ari_vs_window24),
            xytext=(0, 7),
            textcoords="offset points",
            ha="center",
            fontsize=6.8,
            color=MUTED,
        )
    entropy_axis.set_xscale("log", base=2)
    entropy_axis.set_xticks([8, 12, 24, 48, 96], ["8", "12", "24", "48", "96"])
    entropy_axis.set_ylim(-0.05, 1.08)
    entropy_axis.set_xlabel("Entropy window (pattern instances)", fontsize=8, color=MUTED)
    entropy_axis.set_ylabel("SPY assignment ARI vs window 24", fontsize=8, color=MUTED)
    entropy_axis.set_title(
        "C  Downstream entropy sensitivity",
        loc="left",
        fontsize=9,
        color=INK,
        weight="bold",
    )
    entropy_axis.legend(frameon=False, fontsize=7, loc="lower right")
    _style_axes(entropy_axis, grid_axis="both")

    figure.suptitle(
        "Representation baseline and downstream entropy sensitivity",
        x=0.01,
        ha="left",
        fontsize=11,
        color=INK,
        weight="bold",
    )
    figure.text(
        0.01,
        -0.02,
        "Same cached daily histories and chronological codebook gate. "
        "ARI is label-invariant overlap agreement; these are unsupervised diagnostics, not forecasts.",
        fontsize=7.3,
        color=MUTED,
    )
    _save_figure(figure, "representation_sensitivity")


def _write_asset_table(asset_summary: pd.DataFrame) -> None:
    lines = [
        r"\begin{tabular}{lrrrrr}",
        r"\toprule",
        r"Asset & Bars & Forms & Silhouette & Tail $n$ & Outside (\%) \\",
        r"\midrule",
    ]
    for row in asset_summary.itertuples(index=False):
        lines.append(
            f"{row.symbol} & {row.bars:,} & {row.forms:d} & {row.fit_silhouette:.3f} & "
            f"{row.tail_supported_bars:,} & {100.0 * row.outside_range_rate:.1f} \\\\"
        )
    supported = int(asset_summary["tail_supported_bars"].sum())
    outside = int(asset_summary["outside_range_count"].sum())
    lines.extend(
        [
            r"\midrule",
            f"Pooled & {int(asset_summary['bars'].sum()):,} & -- & -- & {supported:,} & {100.0 * outside / supported:.1f} \\\\"
            if supported
            else r"Pooled & -- & -- & -- & 0 & -- \\",
            r"\bottomrule",
            r"\end{tabular}",
        ]
    )
    (PAPER_ROOT / "tables" / "asset_summary.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_representation_table(
    comparison: pd.DataFrame,
    stability: pd.DataFrame,
    entropy: pd.DataFrame,
) -> None:
    lines = [
        r"\begin{tabular}{lrrrr}",
        r"\toprule",
        r"Variant & Multi-Form & Silhouette & ARI & Tail (\%) \\",
        r"\midrule",
        r"\multicolumn{5}{l}{\emph{Panel A: eight-asset representation comparison}} \\",
    ]
    labels = {
        "market_field_v1": "Market Field v1",
        "single_horizon_baseline": "24-bar baseline",
    }
    for representation in ("market_field_v1", "single_horizon_baseline"):
        selected = comparison[comparison["representation"] == representation]
        selected_stability = stability[
            stability["representation"] == representation
        ].sort_values("prefix_fraction")
        stability_text = "/".join(
            f"{value:.2f}"
            for value in selected_stability["adjusted_rand_index"].to_numpy(dtype=float)
        )
        lines.append(
            f"{labels[representation]} & {int((selected['forms'] > 1).sum())}/"
            f"{len(selected)} & {selected['fit_silhouette'].median():.3f} & "
            f"{stability_text} & {100.0 * selected['tail_rate'].median():.1f} \\\\"
        )
    lines.extend(
        [
            r"\midrule",
            r"\multicolumn{5}{l}{\emph{Panel B: SPY entropy-window ablation}} \\",
        ]
    )
    for row in entropy.itertuples(index=False):
        lines.append(
            f"$H$ window {int(row.entropy_window_patterns)} & {int(row.forms)} & "
            f"{row.fit_silhouette:.3f} & {row.assignment_ari_vs_window24:.3f} & "
            f"{100.0 * row.tail_rate:.1f} \\\\"
        )
    lines.extend(
        [
            r"\bottomrule",
            r"\end{tabular}",
        ]
    )
    (PAPER_ROOT / "tables" / "representation_comparison.tex").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )


def _write_validation_table(
    validation: dict[str, Any],
    synthetic: dict[str, Any],
    benchmark: dict[str, Any],
) -> None:
    prefix = validation["prefix_invariance"]
    determinism = validation["determinism"]
    tail = validation["distance_tail"]
    codebook = validation["codebook_gate"]
    lines = [
        r"\begin{tabular}{p{0.30\linewidth}p{0.23\linewidth}p{0.39\linewidth}}",
        r"\toprule",
        r"Diagnostic & Result & Interpretation \\",
        r"\midrule",
        f"Prefix invariance & {prefix['serialized_value_comparisons']:,} comparisons, {prefix['nonzero_differences']} mismatches & "
        r"No future-bar dependence detected at $10^{-4}$ API precision. \\",
        f"Deterministic dictionary & {determinism['exact_lexicon_matches']}/{determinism['symbols']} exact reruns & "
        r"Fixed inputs yield byte-identical versioned lexicons. \\",
        f"Synthetic propagation & $\\rho={synthetic['horizon_delay_spearman_rho']:.3f}$ & "
        r"Longer horizons cross the reversal threshold later by construction. \\",
        f"Distance-tail diagnostic & {100.0 * tail['asset_rate_min']:.1f}--{100.0 * tail['asset_rate_max']:.1f}\\% by asset & "
        r"State-conditional empirical ranks are heterogeneous and non-exchangeable. \\",
        f"Codebook support gate & {codebook['nontrivial_codebooks']}/{codebook['symbols']} multi-Form & "
        r"Multi-Form solutions appear only when the declared metric, support, and silhouette gates pass. \\",
        f"Compact snapshot & {benchmark['median_ms']:.1f} ms median; {benchmark['median_payload_bytes']:,} bytes & "
        r"Local compute-only benchmark; ranking and execution remain disabled. \\",
        r"\bottomrule",
        r"\end{tabular}",
    ]
    (PAPER_ROOT / "tables" / "validation_summary.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    started_at_utc = _utc_now()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Ignore local raw-data cache.")
    parser.add_argument("--offline", action="store_true", help="Require local cached market data.")
    args = parser.parse_args()
    run_core = _primary_run_core(started_at_utc)
    run_core["invocation"] = {
        "offline": bool(args.offline),
        "refresh": bool(args.refresh),
    }
    provenance_core_sha256 = _canonical_json_sha256(run_core)

    for directory in ("cache", "figures", "results", "tables"):
        (PAPER_ROOT / directory).mkdir(parents=True, exist_ok=True)

    histories: dict[str, pd.DataFrame] = {}
    source_manifest: list[dict[str, Any]] = []
    for symbol in SYMBOLS:
        history, source_mode = load_history(symbol, refresh=args.refresh, offline=args.offline)
        histories[symbol] = history
        source_manifest.append(
            {
                "symbol": symbol,
                "source": source_mode,
                "requested_start": START_DATE,
                "requested_end_exclusive": END_DATE_EXCLUSIVE,
                "first_observation": history.index[0].isoformat(),
                "last_observation": history.index[-1].isoformat(),
                "rows": len(history),
                "adjustment": "Yahoo auto_adjust=True",
                "canonical_ohlcv_sha256": _history_hash(history),
            }
        )

    asset_summary, fields, validation = _analyze_assets(histories)
    representation, representation_stability, entropy_sensitivity, representation_summary = (
        _representation_checks(histories, fields)
    )
    synthetic_summary, synthetic_payload = _synthetic_diagnostics()
    benchmark = _benchmark_option_snapshots(histories)

    asset_summary.to_csv(PAPER_ROOT / "results" / "asset_summary.csv", index=False)
    representation.to_csv(
        PAPER_ROOT / "results" / "representation_baseline.csv",
        index=False,
    )
    representation_stability.to_csv(
        PAPER_ROOT / "results" / "representation_window_stability.csv",
        index=False,
    )
    entropy_sensitivity.to_csv(
        PAPER_ROOT / "results" / "entropy_dictionary_sensitivity.csv",
        index=False,
    )
    _write_json(
        PAPER_ROOT / "results" / "validation_summary.json",
        {
            "paper_as_of": AS_OF_DATE,
            "market_data": source_manifest,
            "validation": validation,
            "representation_comparison": representation_summary,
            "synthetic": synthetic_summary,
            "option_snapshot_benchmark": benchmark,
        },
    )
    _write_asset_table(asset_summary)
    _write_representation_table(
        representation,
        representation_stability,
        entropy_sensitivity,
    )
    _write_validation_table(validation, synthetic_summary, benchmark)
    _plot_system_overview()
    _plot_spy_field_phase(fields["SPY"])
    _plot_synthetic_diagnostics(synthetic_payload)
    _plot_calibration_rates(asset_summary)
    _plot_representation_sensitivity(
        representation,
        representation_stability,
        entropy_sensitivity,
    )

    receipt = {
        "status": "ok",
        "paper_as_of": AS_OF_DATE,
        "assets": len(asset_summary),
        "derived_rows": int(asset_summary["evaluation_bars"].sum()),
        "prefix_comparisons": validation["prefix_invariance"]["serialized_value_comparisons"],
        "figures": sorted(path.name for path in (PAPER_ROOT / "figures").glob("*.pdf")),
        "tables": sorted(path.name for path in (PAPER_ROOT / "tables").glob("*.tex")),
        "primary_run_receipt": "primary_run_receipt.json",
        "provenance_core_sha256": provenance_core_sha256,
    }
    _write_json(PAPER_ROOT / "results" / "build_receipt.json", receipt)

    missing_artifacts = [
        path.as_posix()
        for path in PRIMARY_ARTIFACT_PATHS
        if not (REPO_ROOT / path).is_file()
    ]
    if missing_artifacts:
        raise RuntimeError(f"Primary generated artifacts are missing: {missing_artifacts}")
    artifact_hashes = {
        path.as_posix(): _sha256_file(REPO_ROOT / path)
        for path in PRIMARY_ARTIFACT_PATHS
    }
    primary_run_receipt = {
        **run_core,
        "ended_at_utc": _utc_now(),
        "provenance_core_sha256": provenance_core_sha256,
        "artifacts": {
            "count": len(artifact_hashes),
            "sha256": artifact_hashes,
        },
    }
    _write_json(
        PAPER_ROOT / "results" / "primary_run_receipt.json",
        primary_run_receipt,
    )
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
