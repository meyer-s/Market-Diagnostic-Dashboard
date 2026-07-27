from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from typing import Mapping, Sequence

import pandas as pd

from app.services.market_weather import (
    MarketWeatherSettings,
    build_market_weather,
    normalize_market_history,
)
from app.services.market_weather_history_cache import get_or_refresh_market_weather_history


PAIR_SCHEMA_VERSION = "market_field_pair_v1"
PAIR_ALIGNMENT_VERSION = "pair_alignment_v1"
PAIR_NORMALIZATION_VERSION = "native_and_fixed_proper_fit_relative_v1"
MINIMUM_SHARED_OBSERVATIONS = 20
BETA_LOOKBACK = 60
BETA_MINIMUM_PRIOR_RETURNS = 20
BETA_MINIMUM_BENCHMARK_STD = 1e-7
BETA_MAX_ABSOLUTE = 25.0

_DXY_ALIASES = {"DXY", "^DXY", "DX-Y.NYB"}
_DXY_PROVIDER_SYMBOL = "DX-Y.NYB"
_DXY_UNSUPPORTED_TIMEFRAMES = {"1h", "2h", "4h"}


@dataclass(frozen=True)
class PairSymbol:
    requested_symbol: str
    canonical_symbol: str
    provider_symbol: str
    provider_override: str | None
    instrument_kind: str


@dataclass(frozen=True)
class PairLeg:
    symbol: PairSymbol
    analysis: dict[str, object]
    data_source: str
    history_cache: dict[str, object]
    full_precision_price_rows: dict[str, dict[str, object]] | None = None


_COORDINATES: tuple[dict[str, str], ...] = (
    {"id": "pressure", "label": "Pressure", "family": "pressure_state", "unit": "bounded signed", "polarity": "signed"},
    {"id": "velocity", "label": "Pressure change", "family": "pressure_state", "unit": "bounded signed", "polarity": "signed"},
    {"id": "acceleration", "label": "Acceleration", "family": "pressure_state", "unit": "bounded signed", "polarity": "signed"},
    {"id": "jerk", "label": "Jerk", "family": "pressure_state", "unit": "bounded signed", "polarity": "signed"},
    {"id": "snap", "label": "Snap", "family": "pressure_state", "unit": "bounded signed", "polarity": "signed"},
    {"id": "structure", "label": "Structure", "family": "field_transform", "unit": "0–1 score", "polarity": "descriptive"},
    {"id": "kinematics", "label": "Kinematics", "family": "field_transform", "unit": "0–1 score", "polarity": "descriptive"},
    {"id": "geometry", "label": "Geometry", "family": "field_transform", "unit": "0–1 score", "polarity": "descriptive"},
    {"id": "information", "label": "Information", "family": "field_transform", "unit": "0–1 score", "polarity": "descriptive"},
    {"id": "propagation", "label": "Propagation", "family": "field_transform", "unit": "0–1 score", "polarity": "descriptive"},
    {"id": "cascade_bias", "label": "Cascade bias", "family": "field_transform", "unit": "bounded signed", "polarity": "signed"},
    {"id": "scaling_exponent", "label": "Scaling exponent", "family": "field_transform", "unit": "log-horizon slope", "polarity": "descriptive"},
    {"id": "volatility_carrier", "label": "Volatility vs baseline", "family": "ohlcv_carrier", "unit": "0–1 causal-baseline level", "polarity": "unsigned"},
    {"id": "participation_carrier", "label": "Participation vs baseline", "family": "ohlcv_carrier", "unit": "0–1 causal-baseline level", "polarity": "unsigned"},
    {"id": "liquidity_stress_carrier", "label": "Liquidity stress vs baseline", "family": "ohlcv_carrier", "unit": "0–1 causal-baseline level", "polarity": "lower_is_less_stressed"},
)

_DERIVATIVE_IDS = {"pressure", "velocity", "acceleration", "jerk", "snap"}
_STRATA_IDS = {
    "structure",
    "kinematics",
    "geometry",
    "information",
    "propagation",
    "cascade_bias",
    "scaling_exponent",
}
_CARRIER_KEYS = {
    "volatility_carrier": "realized_volatility",
    "participation_carrier": "participation",
    "liquidity_stress_carrier": "liquidity_stress",
}
_COVERAGE_IDS = {
    "volatility_carrier": "realized_volatility_carrier",
}


def canonical_pair_symbol(symbol: str) -> PairSymbol:
    requested = str(symbol or "").strip().upper()
    if requested in _DXY_ALIASES:
        return PairSymbol(
            requested_symbol=requested,
            canonical_symbol="DXY",
            provider_symbol=_DXY_PROVIDER_SYMBOL,
            provider_override="yahoo",
            instrument_kind="index",
        )
    return PairSymbol(
        requested_symbol=requested,
        canonical_symbol=requested,
        provider_symbol=requested,
        provider_override=None,
        instrument_kind="security_or_index",
    )


def validate_pair_alignment(
    target_symbol: PairSymbol,
    benchmark_symbol: PairSymbol,
    timeframe: str,
) -> None:
    identity_control = (
        target_symbol.canonical_symbol == benchmark_symbol.canonical_symbol
        and target_symbol.provider_symbol == benchmark_symbol.provider_symbol
    )
    if (
        not identity_control
        and "DXY" in {target_symbol.canonical_symbol, benchmark_symbol.canonical_symbol}
        and timeframe in _DXY_UNSUPPORTED_TIMEFRAMES
    ):
        raise ValueError(
            "alignment_unsupported: DXY comparisons at 1h, 2h, and 4h are "
            "disabled because the provider bar anchors are not demonstrably "
            "compatible. Choose 1m, 5m, 15m, 30m, 1D, or 1W."
        )


def build_pair_leg(
    *,
    provider: object,
    symbol: PairSymbol,
    timeframe: str,
    requested_bars: int,
    horizons: Sequence[int],
    settings: MarketWeatherSettings,
) -> PairLeg:
    history_result = get_or_refresh_market_weather_history(
        provider,
        symbol.provider_symbol,
        timeframe,
        bars=requested_bars,
        minimum_rows=max(60, max(int(value) for value in horizons) + 1),
    )
    normalized_history, _input_quality = normalize_market_history(
        history_result.frame,
        minimum_bars=1,
    )
    analysis = build_market_weather(
        normalized_history,
        horizons=horizons,
        settings=settings,
    )
    return PairLeg(
        symbol=symbol,
        analysis=analysis,
        data_source=history_result.metadata.data_source,
        history_cache=history_result.metadata.to_dict(),
        full_precision_price_rows=_frame_price_rows(
            normalized_history,
            timeframe,
        ),
    )


def build_market_weather_comparison(
    *,
    target: PairLeg,
    benchmark: PairLeg,
    timeframe: str,
    visible_bars: int,
) -> dict[str, object]:
    """Compare two independently constructed fields on explicitly shared rows.

    The function never interpolates or carries observations. Daily and weekly
    payloads use their serialized session date. Intraday payloads require the
    exact same timestamp: timezone-aware timestamps are normalized to UTC,
    while naive provider/cache timestamps retain their exact serialized value
    and are explicitly reported as timezone-unavailable.
    """

    validate_pair_alignment(target.symbol, benchmark.symbol, timeframe)
    _require_same_recipe(target.analysis, benchmark.analysis)

    target_rows = target.full_precision_price_rows or _analysis_rows(
        target.analysis,
        timeframe,
    )
    benchmark_rows = benchmark.full_precision_price_rows or _analysis_rows(
        benchmark.analysis,
        timeframe,
    )
    all_common_keys = sorted(set(target_rows) & set(benchmark_rows))
    if len(all_common_keys) < MINIMUM_SHARED_OBSERVATIONS:
        raise ValueError(
            "insufficient_shared_history: "
            f"{len(all_common_keys)} exact shared observations are available; "
            f"{MINIMUM_SHARED_OBSERVATIONS} are required. No nearest-neighbor "
            "join or forward fill was applied."
        )
    common_keys = all_common_keys[-visible_bars:]
    visible_start_key = common_keys[0]
    common_key_set = set(common_keys)
    target_dropped_count = sum(
        key >= visible_start_key and key not in common_key_set
        for key in target_rows
    )
    benchmark_dropped_count = sum(
        key >= visible_start_key and key not in common_key_set
        for key in benchmark_rows
    )
    target_latest_key = max(target_rows)
    benchmark_latest_key = max(benchmark_rows)
    latest_common_key = common_keys[-1]
    target_tail_drops = sum(key > latest_common_key for key in target_rows)
    benchmark_tail_drops = sum(key > latest_common_key for key in benchmark_rows)

    target_values = _coordinate_values(target.analysis, timeframe)
    benchmark_values = _coordinate_values(benchmark.analysis, timeframe)
    target_support = _coordinate_support(target.analysis, timeframe)
    benchmark_support = _coordinate_support(benchmark.analysis, timeframe)
    target_fit = _proper_fit_reference(target.analysis)
    benchmark_fit = _proper_fit_reference(benchmark.analysis)
    target_evaluation_start = _evaluation_start_key(target.analysis, timeframe)
    benchmark_evaluation_start = _evaluation_start_key(benchmark.analysis, timeframe)

    coordinates: list[dict[str, object]] = []
    supported_cells = 0
    total_cells = len(common_keys) * len(_COORDINATES)
    for spec in _COORDINATES:
        coordinate_id = spec["id"]
        series: list[dict[str, object]] = []
        for key in common_keys:
            target_value = _finite_or_none(target_values.get(coordinate_id, {}).get(key))
            benchmark_value = _finite_or_none(benchmark_values.get(coordinate_id, {}).get(key))
            target_is_supported = bool(target_support.get(coordinate_id, {}).get(key, False))
            benchmark_is_supported = bool(benchmark_support.get(coordinate_id, {}).get(key, False))
            both_supported = (
                target_is_supported
                and benchmark_is_supported
                and target_value is not None
                and benchmark_value is not None
            )
            if both_supported:
                supported_cells += 1
            native_difference = (
                _rounded(target_value - benchmark_value)
                if both_supported
                else None
            )

            context_eligible = (
                both_supported
                and target_evaluation_start is not None
                and benchmark_evaluation_start is not None
                and key >= target_evaluation_start
                and key >= benchmark_evaluation_start
            )
            target_context = _proper_fit_value(
                target_value,
                target_fit.get(coordinate_id),
            ) if context_eligible else None
            benchmark_context = _proper_fit_value(
                benchmark_value,
                benchmark_fit.get(coordinate_id),
            ) if context_eligible else None
            context_difference = (
                _rounded(target_context - benchmark_context)
                if target_context is not None and benchmark_context is not None
                else None
            )
            series.append(
                {
                    "date": _display_date(
                        key,
                        target_rows[key]["date"],
                        timeframe,
                    ),
                    "target": target_value,
                    "benchmark": benchmark_value,
                    "target_context": target_context,
                    "benchmark_context": benchmark_context,
                    "native_difference": native_difference,
                    "context_difference": context_difference,
                    "target_supported": target_is_supported,
                    "benchmark_supported": benchmark_is_supported,
                    "pair_supported": both_supported,
                }
            )

        latest = series[-1]
        coordinates.append(
            {
                **spec,
                "latest": {
                    key: latest[key]
                    for key in (
                        "target",
                        "benchmark",
                        "target_context",
                        "benchmark_context",
                        "native_difference",
                        "context_difference",
                        "target_supported",
                        "benchmark_supported",
                        "pair_supported",
                    )
                },
                "series": series,
            }
        )

    price_series, beta_summary = _relative_price_series(
        common_keys=common_keys,
        target_rows=target_rows,
        benchmark_rows=benchmark_rows,
        timeframe=timeframe,
    )
    comparison_hash = _comparison_hash(
        target=target,
        benchmark=benchmark,
        timeframe=timeframe,
        common_keys=common_keys,
    )
    session_compatibility = _session_compatibility(
        target.symbol,
        benchmark.symbol,
    )
    target_analysis_hash = _analysis_hash(target.analysis)
    benchmark_analysis_hash = _analysis_hash(benchmark.analysis)
    target_latest_close = _finite_or_none(target_rows[common_keys[-1]]["close"])
    benchmark_latest_close = _finite_or_none(benchmark_rows[common_keys[-1]]["close"])
    target_latest_returned_close = _finite_or_none(
        target_rows[target_latest_key]["close"]
    )
    benchmark_latest_returned_close = _finite_or_none(
        benchmark_rows[benchmark_latest_key]["close"]
    )
    active_return_pct = _finite_or_none(price_series[-1]["active_return"])
    context_gap_direction = _gap_direction(coordinates)
    intraday_timezone_aware = (
        timeframe not in {"1D", "1W"}
        and pd.Timestamp(common_keys[-1]).tzinfo is not None
    )

    overlap_note = (
        "Daily/weekly rows are joined by serialized session date."
        if timeframe in {"1D", "1W"}
        else (
            "Intraday rows use exact UTC-normalized timestamps."
            if intraday_timezone_aware
            else (
                "Intraday rows use exact serialized timestamps; timezone "
                "metadata is unavailable, so session compatibility is not certified."
            )
        )
    )
    overlap_note += " No nearest-neighbor join, interpolation, or carry-forward is used."
    identity_control = (
        target.symbol.canonical_symbol == benchmark.symbol.canonical_symbol
        and target_analysis_hash == benchmark_analysis_hash
    )

    return {
        "schema_version": PAIR_SCHEMA_VERSION,
        "semantic_revision": target.analysis.get("semantic_revision"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target": _leg_payload(
            target,
            latest_aligned_close=target_latest_close,
            latest_returned_close=target_latest_returned_close,
        ),
        "benchmark": _leg_payload(
            benchmark,
            latest_aligned_close=benchmark_latest_close,
            latest_returned_close=benchmark_latest_returned_close,
        ),
        "comparison_hash": comparison_hash,
        "timeframe": timeframe,
        "overlap": {
            "common_observations": len(common_keys),
            "start": _display_date(common_keys[0], target_rows[common_keys[0]]["date"], timeframe),
            "end": _display_date(common_keys[-1], target_rows[common_keys[-1]]["date"], timeframe),
            "target_dropped": target_dropped_count,
            "benchmark_dropped": benchmark_dropped_count,
            "target_unmatched_after_latest_aligned": target_tail_drops,
            "benchmark_unmatched_after_latest_aligned": benchmark_tail_drops,
            "target_latest_returned_at": _display_date(
                target_latest_key,
                target_rows[target_latest_key]["date"],
                timeframe,
            ),
            "benchmark_latest_returned_at": _display_date(
                benchmark_latest_key,
                benchmark_rows[benchmark_latest_key]["date"],
                timeframe,
            ),
            "latest_aligned_at": _display_date(
                common_keys[-1],
                target_rows[common_keys[-1]]["date"],
                timeframe,
            ),
            "support_fraction": _rounded(supported_cells / max(1, total_cells), 6),
            "session_compatible": (
                True if session_compatibility == "compatible"
                else False if session_compatibility == "incompatible"
                else None
            ),
            "session_compatibility": session_compatibility,
            "alignment_supported": True,
            "alignment_status": "identity_control" if identity_control else "aligned",
            "alignment_rule": (
                "serialized_session_date"
                if timeframe in {"1D", "1W"}
                else (
                    "exact_utc_timestamp"
                    if intraday_timezone_aware
                    else "exact_serialized_timestamp_timezone_unavailable"
                )
            ),
            "note": overlap_note,
        },
        "relative_progress": {
            "latest_target_close": target_latest_close,
            "latest_benchmark_close": benchmark_latest_close,
            "active_return_pct": active_return_pct,
            "beta_adjusted_return_pct": beta_summary["cumulative_residual_pct"],
            "beta": beta_summary["latest_beta"],
            "beta_status": beta_summary["status"],
            "lookback_bars": beta_summary["lookback_bars"],
            "gap_direction": context_gap_direction,
        },
        "coordinates": coordinates,
        "price_series": price_series,
        "provenance": {
            "target_analysis_hash": target_analysis_hash,
            "benchmark_analysis_hash": benchmark_analysis_hash,
            "comparison_hash": comparison_hash,
            "target_requested_symbol": target.symbol.requested_symbol,
            "target_canonical_symbol": target.symbol.canonical_symbol,
            "target_provider_symbol": target.symbol.provider_symbol,
            "benchmark_requested_symbol": benchmark.symbol.requested_symbol,
            "benchmark_canonical_symbol": benchmark.symbol.canonical_symbol,
            "benchmark_provider_symbol": benchmark.symbol.provider_symbol,
            "alignment_contract": PAIR_ALIGNMENT_VERSION,
            "normalization_contract": PAIR_NORMALIZATION_VERSION,
            "component_recipe_hash": _recipe_hash(target.analysis),
            "ordered_pair": True,
            "identity_control": identity_control,
            "note": (
                "The ordered receipt binds both component analyses, alignment "
                "keys, and normalization contract. It proves calculation "
                "identity, not provider completeness or economic validity."
            ),
        },
        "cache": {
            "target_history": target.history_cache,
            "benchmark_history": benchmark.history_cache,
        },
        "authority": {
            "mode": "research_display_only",
            "scanner_weight": 0.0,
            "option_learning_weight": 0.0,
            "veto": False,
            "sizing": False,
            "execution": False,
        },
        "caveats": [
            "A higher field coordinate is not inherently better and does not identify a winner.",
            "Native differences require source-observed, full-dependency support on both legs.",
            "Context differences use each leg's fixed proper-fit median and robust scale and appear only on common evaluation timestamps.",
            "Relative price and the prior-return beta residual are separate economic context; neither changes a field coordinate or Form.",
            "Provider adjustment, currency, timezone, and trading-session conventions can limit comparability.",
            "The endpoint uses provider/cache rows as returned and does not independently certify that the latest bar is exchange-complete.",
            "Pair v1 has no scanner, learning-canary, veto, verdict, sizing, or execution authority.",
        ],
    }


def _analysis_rows(
    analysis: Mapping[str, object],
    timeframe: str,
) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    prices = analysis.get("price")
    if not isinstance(prices, list):
        return result
    for row in prices:
        if not isinstance(row, Mapping):
            continue
        date = str(row.get("date") or "")
        key = _alignment_key(date, timeframe)
        if key is None:
            continue
        result[key] = {"date": date, "close": row.get("close")}
    return result


def _frame_price_rows(
    frame: pd.DataFrame,
    timeframe: str,
) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    if "close" not in frame.columns:
        return result
    for timestamp, value in frame["close"].items():
        serialized = pd.Timestamp(timestamp).isoformat()
        key = _alignment_key(serialized, timeframe)
        close = _finite_or_none(value)
        if key is None or close is None or close <= 0:
            continue
        result[key] = {"date": serialized, "close": close}
    return result


def _coordinate_values(
    analysis: Mapping[str, object],
    timeframe: str,
) -> dict[str, dict[str, float | None]]:
    research = analysis.get("research")
    if not isinstance(research, Mapping):
        return {}
    result: dict[str, dict[str, float | None]] = {
        spec["id"]: {} for spec in _COORDINATES
    }

    derivative_rows = research.get("derivative_series")
    if isinstance(derivative_rows, list):
        _copy_rows(result, derivative_rows, _DERIVATIVE_IDS, timeframe)

    strata = research.get("strata")
    if isinstance(strata, Mapping):
        strata_rows = strata.get("series")
        if isinstance(strata_rows, list):
            _copy_rows(result, strata_rows, _STRATA_IDS, timeframe)

    carriers = research.get("carriers")
    if isinstance(carriers, Mapping):
        carrier_rows = carriers.get("series")
        if isinstance(carrier_rows, list):
            for row in carrier_rows:
                if not isinstance(row, Mapping):
                    continue
                key = _alignment_key(str(row.get("date") or ""), timeframe)
                if key is None:
                    continue
                for coordinate_id, carrier_key in _CARRIER_KEYS.items():
                    result[coordinate_id][key] = _finite_or_none(row.get(carrier_key))
    return result


def _copy_rows(
    destination: dict[str, dict[str, float | None]],
    rows: Sequence[object],
    coordinate_ids: set[str],
    timeframe: str,
) -> None:
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        key = _alignment_key(str(row.get("date") or ""), timeframe)
        if key is None:
            continue
        for coordinate_id in coordinate_ids:
            destination[coordinate_id][key] = _finite_or_none(row.get(coordinate_id))


def _coordinate_support(
    analysis: Mapping[str, object],
    timeframe: str,
) -> dict[str, dict[str, bool]]:
    values = _coordinate_values(analysis, timeframe)
    dates = analysis.get("dates")
    if not isinstance(dates, list):
        dates = []
    date_keys = [
        key
        for value in dates
        if (key := _alignment_key(str(value), timeframe)) is not None
    ]
    coverage = (
        analysis.get("research", {})
        if isinstance(analysis.get("research"), Mapping)
        else {}
    )
    coverage = coverage.get("initialization_coverage") if isinstance(coverage, Mapping) else None
    features = coverage.get("features") if isinstance(coverage, Mapping) else None
    feature_map = {
        str(row.get("id")): row
        for row in features
        if isinstance(row, Mapping)
    } if isinstance(features, list) else {}

    special_validity: dict[str, dict[str, bool]] = {}
    research = analysis.get("research")
    if isinstance(research, Mapping):
        scaling_reference = research.get("scaling_reference")
        if isinstance(scaling_reference, Mapping):
            series = scaling_reference.get("series")
            if isinstance(series, list):
                special_validity["scaling_exponent"] = {
                    key: bool(row.get("valid"))
                    for row in series
                    if isinstance(row, Mapping)
                    and (key := _alignment_key(str(row.get("date") or ""), timeframe)) is not None
                }
        carriers = research.get("carriers")
        ratios = carriers.get("ratios") if isinstance(carriers, Mapping) else None
        ratio_series = ratios.get("series") if isinstance(ratios, Mapping) else None
        if isinstance(ratio_series, list):
            for coordinate_id, carrier_key in _CARRIER_KEYS.items():
                special_validity[coordinate_id] = {
                    key: _finite_or_none(row.get(carrier_key)) is not None
                    for row in ratio_series
                    if isinstance(row, Mapping)
                    and (key := _alignment_key(str(row.get("date") or ""), timeframe)) is not None
                }

    result: dict[str, dict[str, bool]] = {}
    for spec in _COORDINATES:
        coordinate_id = spec["id"]
        feature = feature_map.get(_COVERAGE_IDS.get(coordinate_id, coordinate_id))
        first_supported = (
            _alignment_key(
                str(feature.get("first_full_dependency_support_at") or ""),
                timeframe,
            )
            if isinstance(feature, Mapping)
            else None
        )
        validity = special_validity.get(coordinate_id)
        result[coordinate_id] = {
            key: bool(
                first_supported is not None
                and key >= first_supported
                and _finite_or_none(values.get(coordinate_id, {}).get(key)) is not None
                and (validity is None or validity.get(key, False))
            )
            for key in date_keys
        }
    return result


def _proper_fit_reference(
    analysis: Mapping[str, object],
) -> dict[str, tuple[float, float]]:
    research = analysis.get("research")
    lexicon = research.get("lexicon") if isinstance(research, Mapping) else None
    features = lexicon.get("features") if isinstance(lexicon, Mapping) else None
    if not isinstance(features, list):
        return {}
    result: dict[str, tuple[float, float]] = {}
    for row in features:
        if not isinstance(row, Mapping):
            continue
        coordinate_id = str(row.get("id") or "")
        center = _finite_or_none(row.get("fit_median"))
        scale = _finite_or_none(row.get("fit_robust_scale"))
        if center is not None and scale is not None and scale > 1e-12:
            result[coordinate_id] = (center, scale)
    return result


def _evaluation_start_key(
    analysis: Mapping[str, object],
    timeframe: str,
) -> str | None:
    research = analysis.get("research")
    lexicon = research.get("lexicon") if isinstance(research, Mapping) else None
    split = lexicon.get("training_split") if isinstance(lexicon, Mapping) else None
    if not isinstance(split, Mapping):
        return None
    return _alignment_key(str(split.get("evaluation_start") or ""), timeframe)


def _proper_fit_value(
    value: float | None,
    reference: tuple[float, float] | None,
) -> float | None:
    if value is None or reference is None:
        return None
    center, scale = reference
    return _rounded((value - center) / scale)


def _relative_price_series(
    *,
    common_keys: Sequence[str],
    target_rows: Mapping[str, Mapping[str, object]],
    benchmark_rows: Mapping[str, Mapping[str, object]],
    timeframe: str,
) -> tuple[list[dict[str, object]], dict[str, float | int | None]]:
    target_close = [float(target_rows[key]["close"]) for key in common_keys]
    benchmark_close = [float(benchmark_rows[key]["close"]) for key in common_keys]
    if any(
        not math.isfinite(value) or value <= 0
        for value in (*target_close, *benchmark_close)
    ):
        raise ValueError(
            "invalid_relative_price: aligned closes must be finite and strictly positive."
        )
    target_base = target_close[0]
    benchmark_base = benchmark_close[0]
    target_returns = [
        math.log(target_close[index] / target_close[index - 1])
        for index in range(1, len(target_close))
    ]
    benchmark_returns = [
        math.log(benchmark_close[index] / benchmark_close[index - 1])
        for index in range(1, len(benchmark_close))
    ]

    betas: list[float | None] = [None]
    cumulative_residual: float | None = None
    cumulative_residuals: list[float | None] = [None]
    for point_index in range(1, len(common_keys)):
        prior_end = point_index - 1
        prior_start = max(0, prior_end - BETA_LOOKBACK)
        prior_target = target_returns[prior_start:prior_end]
        prior_benchmark = benchmark_returns[prior_start:prior_end]
        beta = _beta(prior_target, prior_benchmark)
        betas.append(beta)
        if beta is None:
            cumulative_residual = None
            cumulative_residuals.append(None)
            continue
        residual = target_returns[point_index - 1] - beta * benchmark_returns[point_index - 1]
        cumulative_residual = residual if cumulative_residual is None else cumulative_residual + residual
        cumulative_residuals.append(cumulative_residual)

    rows: list[dict[str, object]] = []
    for index, key in enumerate(common_keys):
        relative_index = 100.0 * (
            (target_close[index] / target_base)
            / (benchmark_close[index] / benchmark_base)
        )
        rows.append(
            {
                "date": _display_date(key, str(target_rows[key]["date"]), timeframe),
                "target_close": _rounded(target_close[index], 8),
                "benchmark_close": _rounded(benchmark_close[index], 8),
                "relative_index": _rounded(relative_index, 6),
                "active_return": _rounded(relative_index - 100.0, 6),
                "prior_return_beta": _rounded(betas[index], 6),
                "beta_adjusted_cumulative_return": (
                    _rounded((math.exp(cumulative_residuals[index]) - 1.0) * 100.0, 6)
                    if cumulative_residuals[index] is not None
                    else None
                ),
            }
        )
    latest_beta = betas[-1]
    latest_residual = cumulative_residuals[-1]
    return rows, {
        "latest_beta": _rounded(latest_beta, 6),
        "cumulative_residual_pct": (
            _rounded((math.exp(latest_residual) - 1.0) * 100.0, 6)
            if latest_residual is not None
            else None
        ),
        "lookback_bars": min(BETA_LOOKBACK, max(0, len(common_keys) - 2)),
        "status": "available" if latest_beta is not None else "unavailable",
    }


def _beta(target_returns: Sequence[float], benchmark_returns: Sequence[float]) -> float | None:
    if (
        len(target_returns) < BETA_MINIMUM_PRIOR_RETURNS
        or len(target_returns) != len(benchmark_returns)
    ):
        return None
    target_mean = sum(target_returns) / len(target_returns)
    benchmark_mean = sum(benchmark_returns) / len(benchmark_returns)
    variance = sum((value - benchmark_mean) ** 2 for value in benchmark_returns)
    benchmark_std = math.sqrt(variance / len(benchmark_returns))
    if benchmark_std < BETA_MINIMUM_BENCHMARK_STD:
        return None
    covariance = sum(
        (target - target_mean) * (benchmark - benchmark_mean)
        for target, benchmark in zip(target_returns, benchmark_returns, strict=True)
    )
    beta = covariance / variance
    if not math.isfinite(beta) or abs(beta) > BETA_MAX_ABSOLUTE:
        return None
    return beta


def _gap_direction(coordinates: Sequence[Mapping[str, object]]) -> str:
    # Use the same supported coordinate intersection at both endpoints so a
    # feature becoming available/unavailable cannot masquerade as separation.
    family_pairs: dict[str, list[tuple[float, float]]] = {}
    observed_families: set[str] = set()
    for coordinate in coordinates:
        family = str(coordinate.get("family") or "")
        if family:
            observed_families.add(family)
        series = coordinate.get("series")
        if not isinstance(series, list) or len(series) < 6:
            continue
        latest_row = series[-1]
        previous_row = series[-6]
        if not isinstance(latest_row, Mapping) or not isinstance(previous_row, Mapping):
            continue
        latest_value = _finite_or_none(latest_row.get("context_difference"))
        previous_value = _finite_or_none(previous_row.get("context_difference"))
        if latest_value is None or previous_value is None:
            continue
        family_pairs.setdefault(family, []).append((latest_value, previous_value))
    if not observed_families or set(family_pairs) != observed_families:
        return "unavailable"

    latest_family_means = [
        sum(abs(latest) for latest, _previous in pairs) / len(pairs)
        for pairs in family_pairs.values()
    ]
    previous_family_means = [
        sum(abs(previous) for _latest, previous in pairs) / len(pairs)
        for pairs in family_pairs.values()
    ]
    latest = sum(latest_family_means) / len(latest_family_means)
    previous = sum(previous_family_means) / len(previous_family_means)
    tolerance = max(0.05, previous * 0.05)
    if latest > previous + tolerance:
        return "widening"
    if latest < previous - tolerance:
        return "converging"
    return "mixed"


def _session_compatibility(
    target: PairSymbol,
    benchmark: PairSymbol,
) -> str:
    if target.canonical_symbol == benchmark.canonical_symbol:
        return "compatible"
    return "unknown"


def _require_same_recipe(
    target_analysis: Mapping[str, object],
    benchmark_analysis: Mapping[str, object],
) -> None:
    if _recipe_hash(target_analysis) != _recipe_hash(benchmark_analysis):
        raise ValueError(
            "recipe_mismatch: both fields must use the same semantic revision, "
            "horizon grid, and settings."
        )


def _leg_payload(
    leg: PairLeg,
    *,
    latest_aligned_close: float | None,
    latest_returned_close: float | None,
) -> dict[str, object]:
    return {
        "symbol": leg.symbol.canonical_symbol,
        "requested_symbol": leg.symbol.requested_symbol,
        "provider_symbol": leg.symbol.provider_symbol,
        "instrument_kind": leg.symbol.instrument_kind,
        "analysis_hash": _analysis_hash(leg.analysis),
        "data_source": leg.data_source,
        # Retain the early Pair-v1 alias while making its alignment semantics
        # explicit for new consumers.
        "latest_close": latest_aligned_close,
        "latest_aligned_close": latest_aligned_close,
        "latest_returned_close": latest_returned_close,
    }


def _comparison_hash(
    *,
    target: PairLeg,
    benchmark: PairLeg,
    timeframe: str,
    common_keys: Sequence[str],
) -> str:
    return _canonical_sha256(
        {
            "schema_version": PAIR_SCHEMA_VERSION,
            "target": {
                "canonical_symbol": target.symbol.canonical_symbol,
                "provider_symbol": target.symbol.provider_symbol,
                "analysis_hash": _analysis_hash(target.analysis),
            },
            "benchmark": {
                "canonical_symbol": benchmark.symbol.canonical_symbol,
                "provider_symbol": benchmark.symbol.provider_symbol,
                "analysis_hash": _analysis_hash(benchmark.analysis),
            },
            "timeframe": timeframe,
            "alignment_contract": PAIR_ALIGNMENT_VERSION,
            "normalization_contract": PAIR_NORMALIZATION_VERSION,
            "common_keys_hash": _canonical_sha256(list(common_keys)),
        }
    )


def _analysis_hash(analysis: Mapping[str, object]) -> str:
    provenance = analysis.get("provenance")
    return str(provenance.get("analysis_hash") or "") if isinstance(provenance, Mapping) else ""


def _recipe_hash(analysis: Mapping[str, object]) -> str:
    provenance = analysis.get("provenance")
    return str(provenance.get("recipe_hash") or "") if isinstance(provenance, Mapping) else ""


def _alignment_key(value: str, timeframe: str) -> str | None:
    if not value:
        return None
    try:
        timestamp = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(timestamp):
        return None
    if timeframe in {"1D", "1W"}:
        return timestamp.date().isoformat()
    if timestamp.tzinfo is None:
        return timestamp.isoformat()
    timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat()


def _display_date(key: str, _original: str, _timeframe: str) -> str:
    return key


def _finite_or_none(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _rounded(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _canonical_sha256(payload: object) -> str:
    encoded = json.dumps(
        payload,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
