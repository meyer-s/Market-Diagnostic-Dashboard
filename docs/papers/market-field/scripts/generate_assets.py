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
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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
from app.services.option_field_context import build_option_field_context  # noqa: E402


START_DATE = "2018-01-01"
END_DATE_EXCLUSIVE = "2026-07-22"
AS_OF_DATE = "2026-07-21"
SYMBOLS = ("SPY", "QQQ", "IWM", "TLT", "GLD", "USO", "VNQ", "BTC-USD")
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

    for symbol, history in histories.items():
        full = build_market_weather(history)
        fields[symbol] = full
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
                "bars": len(history),
                "start": history.index[0].date().isoformat(),
                "end": history.index[-1].date().isoformat(),
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
            for channel_name in PREFIX_CHANNELS:
                full_values = np.asarray(live_full["channels"][channel_name], dtype=float)[:, cut - 1]
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
        },
        "codebook_gate": {
            "nontrivial_codebooks": int((summary_frame["forms"] > 1).sum()),
            "single_form_fallbacks": int((summary_frame["forms"] == 1).sum()),
            "symbols": len(summary_frame),
        },
    }
    return summary_frame, fields, validation


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

    figure.suptitle("Synthetic diagnostics isolate causal scale propagation and state separation", x=0.01, ha="left", fontsize=11, color=INK, weight="bold")
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
    axis.set_xlabel("Evaluation bars outside learned range (%)", fontsize=8, color=MUTED)
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
        f"Distance-tail diagnostic & {100.0 * tail['pooled_outside_range_rate']:.1f}\\% pooled & "
        r"Near the 5\% cutoff in aggregate, but heterogeneous and non-exchangeable. \\",
        f"Codebook support gate & {codebook['nontrivial_codebooks']}/{codebook['symbols']} multi-Form & "
        r"Weak separation falls back to one Form instead of inventing states. \\",
        f"Compact snapshot & {benchmark['median_ms']:.1f} ms median; {benchmark['median_payload_bytes']:,} bytes & "
        r"Local compute-only benchmark; ranking and execution remain disabled. \\",
        r"\bottomrule",
        r"\end{tabular}",
    ]
    (PAPER_ROOT / "tables" / "validation_summary.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Ignore local raw-data cache.")
    parser.add_argument("--offline", action="store_true", help="Require local cached market data.")
    args = parser.parse_args()

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
    synthetic_summary, synthetic_payload = _synthetic_diagnostics()
    benchmark = _benchmark_option_snapshots(histories)

    asset_summary.to_csv(PAPER_ROOT / "results" / "asset_summary.csv", index=False)
    _write_json(
        PAPER_ROOT / "results" / "validation_summary.json",
        {
            "paper_as_of": AS_OF_DATE,
            "market_data": source_manifest,
            "validation": validation,
            "synthetic": synthetic_summary,
            "option_snapshot_benchmark": benchmark,
        },
    )
    _write_asset_table(asset_summary)
    _write_validation_table(validation, synthetic_summary, benchmark)
    _plot_system_overview()
    _plot_spy_field_phase(fields["SPY"])
    _plot_synthetic_diagnostics(synthetic_payload)
    _plot_calibration_rates(asset_summary)

    receipt = {
        "status": "ok",
        "paper_as_of": AS_OF_DATE,
        "assets": len(asset_summary),
        "derived_rows": int(asset_summary["evaluation_bars"].sum()),
        "prefix_comparisons": validation["prefix_invariance"]["serialized_value_comparisons"],
        "figures": sorted(path.name for path in (PAPER_ROOT / "figures").glob("*.pdf")),
        "tables": sorted(path.name for path in (PAPER_ROOT / "tables").glob("*.tex")),
    }
    _write_json(PAPER_ROOT / "results" / "build_receipt.json", receipt)
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
