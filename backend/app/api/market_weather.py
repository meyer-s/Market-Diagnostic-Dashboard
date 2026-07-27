from __future__ import annotations

import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Mapping

from fastapi import APIRouter, HTTPException, Query, Response

from app.services.market_data.factory import get_market_data_provider
from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.market_weather_analysis_cache import (
    get_market_weather_analysis_cache,
    get_or_compute_market_weather_analysis,
)
from app.services.market_weather_context import build_market_weather_context
from app.services.market_weather_comparison import (
    PairLeg,
    PairSymbol,
    build_market_weather_comparison,
    build_pair_leg,
    canonical_pair_symbol,
    validate_pair_alignment,
)
from app.services.market_weather_history_cache import (
    MarketWeatherHistoryCacheMetadata,
    get_or_refresh_market_weather_history,
    market_weather_history_ttl_seconds,
)
from app.services.market_weather_research import scope_market_state_lexicon


router = APIRouter()
logger = logging.getLogger(__name__)
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.^=/\-]{1,20}$")
TIMEFRAME_ALIASES = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "60m": "1h",
    "2h": "2h",
    "4h": "4h",
    "1d": "1D",
    "1w": "1W",
    "1wk": "1W",
}
TIMEFRAME_LABELS = {
    "1m": "1 minute",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "2h": "2 hours",
    "4h": "4 hours",
    "1D": "1 day",
    "1W": "1 week",
}
MAX_HORIZON_ROWS = 120
MAX_FIELD_CELLS = 120_000
DEFAULT_ANALYSIS_CACHE_MAX_CELLS = 60_000
PAIR_RUNTIME_SCHEMA_VERSION = "market_field_pair_runtime_v1"


def _analysis_cache_max_cells() -> int:
    raw_value = os.getenv(
        "MARKET_WEATHER_ANALYSIS_CACHE_MAX_CELLS",
        str(DEFAULT_ANALYSIS_CACHE_MAX_CELLS),
    )
    try:
        return max(0, int(raw_value))
    except (TypeError, ValueError):
        logger.warning(
            "invalid MARKET_WEATHER_ANALYSIS_CACHE_MAX_CELLS=%r; using %s",
            raw_value,
            DEFAULT_ANALYSIS_CACHE_MAX_CELLS,
        )
        return DEFAULT_ANALYSIS_CACHE_MAX_CELLS


def _source_for(provider: object, method: str) -> str:
    resolver = getattr(provider, "source_for", None)
    if callable(resolver):
        return str(resolver(method))
    return str(getattr(provider, "name", "unknown"))


@router.get("/market-weather/analyze")
def analyze_market_weather(
    response: Response,
    symbol: str = Query("SPY", min_length=1, max_length=20),
    timeframe: str = Query("1D", min_length=2, max_length=4),
    bars: int = Query(504, ge=60, le=5000),
    horizon_min: int = Query(12, ge=4, le=100),
    horizon_max: int = Query(48, ge=8, le=160),
    horizon_step: int = Query(2, ge=1, le=12),
    state_smoothing: int = Query(5, ge=1, le=20),
    cross_horizon_blend: float = Query(0.32, ge=0.0, le=1.0),
    renderer_time_blur: int = Query(3, ge=1, le=20),
    renderer_spatial_blend: float = Query(0.42, ge=0.0, le=1.0),
    edge_gain: float = Query(1.35, ge=0.25, le=4.0),
    reflectivity_compression: float = Query(4.0, ge=0.25, le=12.0),
    contour_bands: int = Query(7, ge=3, le=16),
) -> dict[str, object]:
    normalized_symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(normalized_symbol):
        raise HTTPException(status_code=400, detail="Ticker contains unsupported characters.")
    normalized_timeframe = TIMEFRAME_ALIASES.get(timeframe.strip().lower())
    if normalized_timeframe is None:
        supported = ", ".join(TIMEFRAME_LABELS)
        raise HTTPException(status_code=400, detail=f"Unsupported timeframe. Choose one of: {supported}.")
    if horizon_max <= horizon_min:
        raise HTTPException(status_code=400, detail="horizon_max must be greater than horizon_min.")
    horizons = list(range(horizon_min, horizon_max + 1, horizon_step))
    if len(horizons) > MAX_HORIZON_ROWS:
        raise HTTPException(status_code=400, detail=f"Choose at most {MAX_HORIZON_ROWS} horizon rows.")
    if len(horizons) * bars > MAX_FIELD_CELLS:
        raise HTTPException(
            status_code=400,
            detail=f"Requested field is too large. Choose at most {MAX_FIELD_CELLS:,} horizon-by-time cells.",
        )

    settings = MarketWeatherSettings(
        state_smoothing=state_smoothing,
        cross_horizon_blend=cross_horizon_blend,
        renderer_time_blur=renderer_time_blur,
        renderer_spatial_blend=renderer_spatial_blend,
        edge_gain=edge_gain,
        reflectivity_compression=reflectivity_compression,
        contour_bands=contour_bands,
    )
    provider = get_market_data_provider()
    requested_bars = bars + max(72, horizon_max * 2)
    field_cells = len(horizons) * bars
    max_cacheable_cells = _analysis_cache_max_cells()
    history_ttl_seconds = market_weather_history_ttl_seconds(normalized_timeframe)
    retain_analysis = (
        max_cacheable_cells > 0
        and field_cells <= max_cacheable_cells
    )
    cache_key = (
        "market-weather-analysis-v1",
        id(provider),
        normalized_symbol,
        normalized_timeframe,
        bars,
        tuple(horizons),
        settings,
    )
    try:
        cached_analysis = get_or_compute_market_weather_analysis(
            cache_key,
            lambda: _compute_market_weather_analysis(
                provider=provider,
                normalized_symbol=normalized_symbol,
                normalized_timeframe=normalized_timeframe,
                bars=bars,
                requested_bars=requested_bars,
                horizons=horizons,
                settings=settings,
            ),
            retain=retain_analysis,
            ttl_seconds=history_ttl_seconds,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Market data could not be loaded: {exc}") from exc

    result = cached_analysis.value
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Market analysis cache returned an invalid payload.")

    cache_payload = dict(result.get("cache") or {})
    analysis_cache = get_market_weather_analysis_cache()
    cache_payload["analysis"] = {
        "status": cached_analysis.status,
        "retained": cached_analysis.retained,
        "scope": "per_worker",
        "ttl_seconds": min(analysis_cache.ttl_seconds, history_ttl_seconds),
        "configured_ttl_seconds": analysis_cache.ttl_seconds,
        "max_entries": analysis_cache.max_entries,
        "field_cells": field_cells,
        "max_cacheable_cells": max_cacheable_cells,
    }
    result["cache"] = cache_payload

    history_payload = cache_payload.get("history") or {}
    history_origin_status = str(history_payload.get("status") or "unknown")
    if cached_analysis.status == "miss":
        history_access = history_origin_status
        provider_called_this_request = bool(history_payload.get("provider_called"))
    elif cached_analysis.status == "wait":
        history_access = "coalesced"
        provider_called_this_request = False
    else:
        history_access = "not_checked"
        provider_called_this_request = False
    cache_payload["request"] = {
        "history_access": history_access,
        "provider_called": provider_called_this_request,
    }
    result["cache"] = cache_payload

    response.headers["X-Market-Weather-Analysis-Cache"] = cached_analysis.status
    response.headers["X-Market-Weather-History-Cache"] = history_access
    response.headers["X-Market-Weather-History-Origin"] = history_origin_status
    browser_max_age = min(30, max(0, history_ttl_seconds))
    response.headers["Cache-Control"] = (
        f"private, max-age={browser_max_age}, must-revalidate"
    )
    return result


@router.get("/market-weather/compare")
def compare_market_weather(
    response: Response,
    target_symbol: str = Query("SPY", min_length=1, max_length=20),
    benchmark_symbol: str = Query("QQQ", min_length=1, max_length=20),
    timeframe: str = Query("1D", min_length=2, max_length=4),
    bars: int = Query(504, ge=60, le=5000),
    horizon_min: int = Query(12, ge=4, le=100),
    horizon_max: int = Query(48, ge=8, le=160),
    horizon_step: int = Query(2, ge=1, le=12),
    state_smoothing: int = Query(5, ge=1, le=20),
    cross_horizon_blend: float = Query(0.32, ge=0.0, le=1.0),
    renderer_time_blur: int = Query(3, ge=1, le=20),
    renderer_spatial_blend: float = Query(0.42, ge=0.0, le=1.0),
    edge_gain: float = Query(1.35, ge=0.25, le=4.0),
    reflectivity_compression: float = Query(4.0, ge=0.25, le=12.0),
    contour_bands: int = Query(7, ge=3, le=16),
) -> dict[str, object]:
    request_started = time.perf_counter()
    normalized_target = target_symbol.strip().upper()
    normalized_benchmark = benchmark_symbol.strip().upper()
    for label, symbol in (
        ("Target", normalized_target),
        ("Benchmark", normalized_benchmark),
    ):
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise HTTPException(
                status_code=400,
                detail=f"{label} ticker contains unsupported characters.",
            )
    normalized_timeframe = TIMEFRAME_ALIASES.get(timeframe.strip().lower())
    if normalized_timeframe is None:
        supported = ", ".join(TIMEFRAME_LABELS)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported timeframe. Choose one of: {supported}.",
        )
    if horizon_max <= horizon_min:
        raise HTTPException(
            status_code=400,
            detail="horizon_max must be greater than horizon_min.",
        )
    horizons = list(range(horizon_min, horizon_max + 1, horizon_step))
    if len(horizons) > MAX_HORIZON_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"Choose at most {MAX_HORIZON_ROWS} horizon rows.",
        )
    pair_field_cells = 2 * len(horizons) * bars
    if pair_field_cells > 2 * MAX_FIELD_CELLS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Requested pair is too large. Choose at most "
                f"{2 * MAX_FIELD_CELLS:,} total horizon-by-time cells."
            ),
        )

    target = canonical_pair_symbol(normalized_target)
    benchmark = canonical_pair_symbol(normalized_benchmark)
    try:
        validate_pair_alignment(target, benchmark, normalized_timeframe)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    settings = MarketWeatherSettings(
        state_smoothing=state_smoothing,
        cross_horizon_blend=cross_horizon_blend,
        renderer_time_blur=renderer_time_blur,
        renderer_spatial_blend=renderer_spatial_blend,
        edge_gain=edge_gain,
        reflectivity_compression=reflectivity_compression,
        contour_bands=contour_bands,
    )
    default_provider = (
        get_market_data_provider()
        if target.provider_override is None or benchmark.provider_override is None
        else None
    )
    yahoo_provider = (
        get_market_data_provider("yahoo")
        if target.provider_override == "yahoo" or benchmark.provider_override == "yahoo"
        else None
    )

    def provider_for(symbol: object) -> object:
        provider_override = getattr(symbol, "provider_override", None)
        if provider_override == "yahoo":
            if yahoo_provider is None:
                raise RuntimeError("Yahoo provider was not initialized.")
            return yahoo_provider
        if default_provider is None:
            raise RuntimeError("Default market-data provider was not initialized.")
        return default_provider

    target_provider = provider_for(target)
    benchmark_provider = provider_for(benchmark)
    requested_bars = bars + max(72, horizon_max * 2)
    history_ttl_seconds = market_weather_history_ttl_seconds(normalized_timeframe)
    max_cacheable_cells = _analysis_cache_max_cells()
    retain_analysis = (
        max_cacheable_cells > 0
        and pair_field_cells <= 2 * max_cacheable_cells
    )
    cache_key = (
        "market-weather-comparison-v1",
        id(target_provider),
        id(benchmark_provider),
        target.requested_symbol,
        target.canonical_symbol,
        target.provider_symbol,
        benchmark.requested_symbol,
        benchmark.canonical_symbol,
        benchmark.provider_symbol,
        normalized_timeframe,
        bars,
        tuple(horizons),
        settings,
    )
    setup_ms = _elapsed_ms(request_started)
    cache_timings_ms: dict[str, float] = {}
    build_stages_ms: dict[str, float] = {}
    build_flags: dict[str, object] = {}
    build_ms: float | None = None

    def compute_comparison() -> dict[str, object]:
        nonlocal build_ms
        build_started = time.perf_counter()
        try:
            return _compute_market_weather_comparison(
                target_provider=target_provider,
                benchmark_provider=benchmark_provider,
                target=target,
                benchmark=benchmark,
                normalized_timeframe=normalized_timeframe,
                visible_bars=bars,
                requested_bars=requested_bars,
                horizons=horizons,
                settings=settings,
                runtime_stages_ms=build_stages_ms,
                runtime_flags=build_flags,
            )
        finally:
            build_ms = _elapsed_ms(build_started)

    try:
        cached_comparison = get_or_compute_market_weather_analysis(
            cache_key,
            compute_comparison,
            retain=retain_analysis,
            ttl_seconds=history_ttl_seconds,
            timings_ms=cache_timings_ms,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Relative market data could not be loaded: {exc}",
        ) from exc

    result = cached_comparison.value
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=500,
            detail="Relative market analysis cache returned an invalid payload.",
        )
    prepare_started = time.perf_counter()
    cache_payload = dict(result.get("cache") or {})
    target_history = cache_payload.get("target_history") or {}
    benchmark_history = cache_payload.get("benchmark_history") or {}
    history_statuses = [
        str(payload.get("status") or "unknown")
        for payload in (target_history, benchmark_history)
        if isinstance(payload, dict)
    ]
    history_origin = ",".join(history_statuses) if history_statuses else "unknown"
    provider_called = (
        cached_comparison.status == "miss"
        and any(
            bool(payload.get("provider_called"))
            for payload in (target_history, benchmark_history)
            if isinstance(payload, dict)
        )
    )
    analysis_cache = get_market_weather_analysis_cache()
    cache_payload["analysis"] = {
        "status": cached_comparison.status,
        "retained": cached_comparison.retained,
        "scope": "per_worker",
        "ttl_seconds": min(analysis_cache.ttl_seconds, history_ttl_seconds),
        "configured_ttl_seconds": analysis_cache.ttl_seconds,
        "max_entries": analysis_cache.max_entries,
        "field_cells": pair_field_cells,
        "max_cacheable_cells": 2 * max_cacheable_cells,
    }
    cache_payload["request"] = {
        "history_access": (
            history_origin
            if cached_comparison.status == "miss"
            else "coalesced"
            if cached_comparison.status == "wait"
            else "not_checked"
        ),
        "provider_called": provider_called,
    }
    result["cache"] = cache_payload

    response.headers["X-Market-Weather-Comparison-Cache"] = cached_comparison.status
    response.headers["X-Market-Weather-History-Cache"] = (
        history_origin
        if cached_comparison.status == "miss"
        else "coalesced"
        if cached_comparison.status == "wait"
        else "not_checked"
    )
    frozen_receipt = result.get("frozen_receipt")
    if isinstance(frozen_receipt, dict):
        receipt_hash = str(frozen_receipt.get("receipt_hash") or "")
        if receipt_hash:
            response.headers["X-Market-Weather-Receipt-Hash"] = receipt_hash
    browser_max_age = min(30, max(0, history_ttl_seconds))
    response.headers["Cache-Control"] = (
        f"private, max-age={browser_max_age}, must-revalidate"
    )
    response_prepare_ms = _elapsed_ms(prepare_started)
    response_ready_ms = _elapsed_ms(request_started)
    runtime_payload = _pair_runtime_payload(
        cache_status=cached_comparison.status,
        retained=cached_comparison.retained,
        setup_ms=setup_ms,
        cache_timings_ms=cache_timings_ms,
        build_ms=build_ms,
        build_stages_ms=build_stages_ms,
        build_flags=build_flags,
        response_prepare_ms=response_prepare_ms,
        response_ready_ms=response_ready_ms,
    )
    result["runtime"] = runtime_payload
    runtime_response = runtime_payload.get("response")
    if isinstance(runtime_response, dict):
        runtime_response["handler_to_response_ready_ms"] = _timing_value(
            _elapsed_ms(request_started)
        )
    response.headers["X-Market-Weather-Runtime-Schema"] = (
        PAIR_RUNTIME_SCHEMA_VERSION
    )
    response.headers["Server-Timing"] = _pair_server_timing(runtime_payload)
    return result


def _elapsed_ms(started_at: float) -> float:
    return max(0.0, (time.perf_counter() - started_at) * 1000.0)


def _timing_value(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0 or not math.isfinite(number):
        return None
    return round(number, 3)


def _timing_map(values: Mapping[str, object]) -> dict[str, float]:
    return {
        str(key): timing
        for key, value in values.items()
        if (timing := _timing_value(value)) is not None
    }


def _pair_runtime_payload(
    *,
    cache_status: str,
    retained: bool,
    setup_ms: float,
    cache_timings_ms: Mapping[str, object],
    build_ms: float | None,
    build_stages_ms: Mapping[str, object],
    build_flags: Mapping[str, object],
    response_prepare_ms: float,
    response_ready_ms: float,
) -> dict[str, object]:
    """Describe measured backend work for this response.

    The handler returns one JSON document, so framework JSON encoding, gzip,
    transfer, and browser chart readiness occur after this measurement
    boundary. They are deliberately reported as unavailable rather than
    represented by synthetic progressive stages.
    """
    normalized_build_ms = _timing_value(build_ms)
    return {
        "schema_version": PAIR_RUNTIME_SCHEMA_VERSION,
        "architecture": "single_response",
        "cache": {
            "status": cache_status,
            "retained": retained,
            "stages_ms": _timing_map(cache_timings_ms),
        },
        "build": {
            "executed_this_request": normalized_build_ms is not None,
            "total_ms": normalized_build_ms,
            "stages_ms": _timing_map(build_stages_ms),
            "benchmark_leg_reused": (
                bool(build_flags.get("benchmark_leg_reused"))
                if "benchmark_leg_reused" in build_flags
                else None
            ),
        },
        "response": {
            "request_setup_ms": _timing_value(setup_ms),
            "metadata_and_headers_ms": _timing_value(response_prepare_ms),
            "handler_to_response_ready_ms": _timing_value(response_ready_ms),
            "framework_json_serialization_ms": None,
            "compression_and_transfer_ms": None,
        },
        "boundaries": {
            "cache_lookup": (
                "Per-worker analysis-cache lock, expiry, LRU lookup, and "
                "single-flight ownership decision."
            ),
            "build": (
                "Executed only by the miss owner. Leg history stages cover "
                "provider/persistent-history access; leg field stages cover "
                "normalization and field construction; pair assembly covers "
                "alignment, relative paths, coordinate comparison, summary, "
                "and compact receipt construction."
            ),
            "response_ready": (
                "Measured immediately before endpoint return. FastAPI JSON "
                "serialization, middleware compression, network transfer, "
                "and frontend rendering are outside this boundary."
            ),
        },
    }


def _pair_server_timing(runtime: Mapping[str, object]) -> str:
    cache = runtime.get("cache")
    build = runtime.get("build")
    response = runtime.get("response")
    cache_payload = cache if isinstance(cache, Mapping) else {}
    build_payload = build if isinstance(build, Mapping) else {}
    response_payload = response if isinstance(response, Mapping) else {}
    cache_stages = cache_payload.get("stages_ms")
    cache_stage_payload = cache_stages if isinstance(cache_stages, Mapping) else {}
    build_stages = build_payload.get("stages_ms")
    build_stage_payload = build_stages if isinstance(build_stages, Mapping) else {}

    metrics: list[str] = []

    def append_metric(name: str, value: object, description: str) -> None:
        duration = _timing_value(value)
        if duration is not None:
            metrics.append(f'{name};dur={duration:.3f};desc="{description}"')

    append_metric(
        "pair-setup",
        response_payload.get("request_setup_ms"),
        "request validation and setup",
    )
    append_metric(
        "pair-cache-lookup",
        cache_stage_payload.get("lookup"),
        f'analysis cache {str(cache_payload.get("status") or "unknown")}',
    )
    append_metric(
        "pair-cache-wait",
        cache_stage_payload.get("wait"),
        "single-flight wait",
    )
    append_metric(
        "pair-cache-copy",
        cache_stage_payload.get("copy"),
        "cache value isolation",
    )
    append_metric(
        "pair-build",
        build_payload.get("total_ms"),
        "pair construction on this request",
    )
    history_ms = sum(
        timing
        for key in ("target_history", "benchmark_history")
        if (timing := _timing_value(build_stage_payload.get(key))) is not None
    )
    field_ms = sum(
        timing
        for key in ("target_field", "benchmark_field")
        if (timing := _timing_value(build_stage_payload.get(key))) is not None
    )
    if any(key.endswith("_history") for key in build_stage_payload):
        append_metric("pair-history", history_ms, "history access on build path")
    if any(key.endswith("_field") for key in build_stage_payload):
        append_metric("pair-fields", field_ms, "field construction on build path")
    append_metric(
        "pair-assembly",
        build_stage_payload.get("pair_assembly"),
        "alignment summary and receipt assembly",
    )
    append_metric(
        "pair-prepare",
        response_payload.get("metadata_and_headers_ms"),
        "response metadata and headers",
    )
    append_metric(
        "pair-ready",
        response_payload.get("handler_to_response_ready_ms"),
        "handler start to response-ready boundary",
    )
    return ", ".join(metrics)


def _compute_market_weather_comparison(
    *,
    target_provider: object,
    benchmark_provider: object,
    target: PairSymbol,
    benchmark: PairSymbol,
    normalized_timeframe: str,
    visible_bars: int,
    requested_bars: int,
    horizons: list[int],
    settings: MarketWeatherSettings,
    runtime_stages_ms: dict[str, float] | None = None,
    runtime_flags: dict[str, object] | None = None,
) -> dict[str, object]:
    target_leg = build_pair_leg(
        provider=target_provider,
        symbol=target,
        timeframe=normalized_timeframe,
        requested_bars=requested_bars,
        horizons=horizons,
        settings=settings,
        runtime_stages_ms=runtime_stages_ms,
        runtime_prefix="target",
    )
    if (
        target_provider is benchmark_provider
        and getattr(target, "provider_symbol", None)
        == getattr(benchmark, "provider_symbol", None)
    ):
        if runtime_flags is not None:
            runtime_flags["benchmark_leg_reused"] = True
        benchmark_leg = PairLeg(
            symbol=benchmark,
            analysis=target_leg.analysis,
            data_source=target_leg.data_source,
            history_cache=dict(target_leg.history_cache),
            full_precision_price_rows=target_leg.full_precision_price_rows,
        )
    else:
        benchmark_leg = build_pair_leg(
            provider=benchmark_provider,
            symbol=benchmark,
            timeframe=normalized_timeframe,
            requested_bars=requested_bars,
            horizons=horizons,
            settings=settings,
            runtime_stages_ms=runtime_stages_ms,
            runtime_prefix="benchmark",
        )
        if runtime_flags is not None:
            runtime_flags["benchmark_leg_reused"] = False
    assembly_started = time.perf_counter()
    comparison = build_market_weather_comparison(
        target=target_leg,
        benchmark=benchmark_leg,
        timeframe=normalized_timeframe,
        visible_bars=visible_bars,
    )
    if runtime_stages_ms is not None:
        runtime_stages_ms["pair_assembly"] = _elapsed_ms(assembly_started)
    return comparison


def _compute_market_weather_analysis(
    *,
    provider: object,
    normalized_symbol: str,
    normalized_timeframe: str,
    bars: int,
    requested_bars: int,
    horizons: list[int],
    settings: MarketWeatherSettings,
) -> dict[str, object]:
    history_result = get_or_refresh_market_weather_history(
        provider,
        normalized_symbol,
        normalized_timeframe,
        bars=requested_bars,
        minimum_rows=60,
    )
    history = history_result.frame
    bars_source = history_result.metadata.data_source
    result = build_market_weather(history, horizons=horizons, settings=settings)

    analysis_bars = len(result["dates"])
    latest_close = float(result["price"][-1]["close"])
    quote_payload: dict[str, object] = {
        "price": latest_close,
        "source": bars_source,
        "quote_source": None,
        "observed_at": None,
    }
    try:
        quote = provider.quote(normalized_symbol)
        quote_source = quote.source or _source_for(provider, "quote")
        quote_payload = {
            "price": quote.price if quote.price is not None else latest_close,
            "source": quote_source,
            "quote_source": quote.quote_source,
            "observed_at": quote.observed_at,
        }
    except Exception:
        # A quote outage should not discard a valid, fully computed historical field.
        pass

    available = len(result["dates"])
    if available > bars:
        start = available - bars
        result["dates"] = result["dates"][start:]
        result["price"] = result["price"][start:]
        result["channels"] = {
            name: [row[start:] for row in matrix]
            for name, matrix in result["channels"].items()
        }
        research = result.get("research")
        if isinstance(research, dict):
            research["derivative_series"] = research.get("derivative_series", [])[start:]
            strata = research.get("strata")
            if isinstance(strata, dict):
                strata["series"] = strata.get("series", [])[start:]
            structure_components = research.get("structure_components")
            if isinstance(structure_components, dict):
                structure_components["series"] = structure_components.get("series", [])[start:]
            scaling_reference = research.get("scaling_reference")
            if isinstance(scaling_reference, dict):
                scaling_reference["series"] = scaling_reference.get("series", [])[start:]
            carriers = research.get("carriers")
            if isinstance(carriers, dict):
                carriers["series"] = carriers.get("series", [])[start:]
                ratios = carriers.get("ratios")
                if isinstance(ratios, dict):
                    ratios["series"] = ratios.get("series", [])[start:]
            lexicon = research.get("lexicon")
            if isinstance(lexicon, dict):
                research["lexicon"] = scope_market_state_lexicon(
                    lexicon,
                    visible_dates=result["dates"],
                    visible_close=[point["close"] for point in result["price"]],
                    source_start_index=start,
                )

    research = result.get("research")
    daily_cache_metadata: MarketWeatherHistoryCacheMetadata | None = None
    if isinstance(research, dict):
        daily_history = history if normalized_timeframe == "1D" and len(history) >= 500 else None
        if daily_history is not None:
            daily_cache_metadata = history_result.metadata
        if daily_history is None:
            try:
                daily_result = get_or_refresh_market_weather_history(
                    provider,
                    normalized_symbol,
                    "1D",
                    bars=1095,
                    minimum_rows=500,
                )
                daily_history = daily_result.frame
                daily_cache_metadata = daily_result.metadata
            except Exception:
                daily_history = None
        try:
            research["context"] = build_market_weather_context(
                symbol=normalized_symbol,
                selected_frame=history,
                daily_frame=daily_history,
                visible_dates=result["dates"],
            )
        except Exception as exc:  # noqa: BLE001
            # Context is deliberately supplementary. A cache/table outage must
            # never discard the core price-derived field.
            research["context"] = {
                "version": "shadow_context_v1",
                "mode": "shadow_only",
                "field_influence": "none",
                "description": "The context layer could not be built; the learned field remains valid and unchanged.",
                "error": str(exc),
            }

    history_context = result.get("history_context")
    if isinstance(history_context, dict):
        history_context.update(
            {
                "requested_visible_bars": bars,
                "visible_bars": len(result["dates"]),
                "analysis_bars": analysis_bars,
                "warmup_buffer_requested": requested_bars - bars,
                "warmup_buffer_received": max(0, analysis_bars - len(result["dates"])),
            }
        )

    provenance = result.get("provenance")
    if isinstance(provenance, dict):
        provenance.update(
            {
                "symbol": normalized_symbol,
                "timeframe": normalized_timeframe,
                "history_data_source": bars_source,
                "history_cache_status": history_result.metadata.status,
                "history_storage_interval": history_result.metadata.storage_interval,
                "visible_start": result["dates"][0],
                "visible_end": result["dates"][-1],
                "bar_completion_rule": (
                    "Provider and persistent-cache history rows are used as returned. "
                    "The endpoint does not independently certify exchange-session completion."
                ),
            }
        )

    result.update(
        {
            "symbol": normalized_symbol,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_source": bars_source,
            "quote": quote_payload,
            "timeframe": normalized_timeframe,
            "bar_size": TIMEFRAME_LABELS[normalized_timeframe],
            "requested_bars": bars,
            "available_bars": len(result["dates"]),
            "coverage_start": result["dates"][0],
            "coverage_end": result["dates"][-1],
            "methodology": {
                "causal": True,
                "description": f"Each live field cell uses only current and prior {TIMEFRAME_LABELS[normalized_timeframe]} bars on a log-horizon coordinate; no centered windows or future values.",
                "research_status": "Experimental diagnostic. Field outcomes and shadow context relationships use chronological holdouts; neither is a forecast or trading signal.",
            },
            "cache": {
                "history": history_result.metadata.to_dict(),
                "daily_context": (
                    daily_cache_metadata.to_dict()
                    if daily_cache_metadata is not None
                    else None
                ),
            },
        }
    )
    return result
