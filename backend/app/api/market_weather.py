from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response

from app.services.market_data.factory import get_market_data_provider
from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.market_weather_analysis_cache import (
    get_market_weather_analysis_cache,
    get_or_compute_market_weather_analysis,
)
from app.services.market_weather_context import build_market_weather_context
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
