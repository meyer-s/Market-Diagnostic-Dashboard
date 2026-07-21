from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.services.market_data.factory import get_market_data_provider
from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.market_weather_research import scope_market_state_lexicon


router = APIRouter()
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


def _source_for(provider: object, method: str) -> str:
    resolver = getattr(provider, "source_for", None)
    if callable(resolver):
        return str(resolver(method))
    return str(getattr(provider, "name", "unknown"))


@router.get("/market-weather/analyze")
def analyze_market_weather(
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
    try:
        history_fetcher = getattr(provider, "historical_bars", None)
        if callable(history_fetcher):
            history = history_fetcher(normalized_symbol, normalized_timeframe, bars=requested_bars)
            bars_source = _source_for(provider, "historical_bars")
        elif normalized_timeframe == "1D":
            history = provider.daily_bars(normalized_symbol, days=requested_bars)
            bars_source = _source_for(provider, "daily_bars")
        else:
            raise ValueError(f"The configured provider does not support {normalized_timeframe} bars.")
        result = build_market_weather(history, horizons=horizons, settings=settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Market data could not be loaded: {exc}") from exc

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
            carriers = research.get("carriers")
            if isinstance(carriers, dict):
                carriers["series"] = carriers.get("series", [])[start:]
            lexicon = research.get("lexicon")
            if isinstance(lexicon, dict):
                research["lexicon"] = scope_market_state_lexicon(
                    lexicon,
                    visible_dates=result["dates"],
                    visible_close=[point["close"] for point in result["price"]],
                    source_start_index=start,
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
                "research_status": "Experimental diagnostic. Relationship cards are chronological holdout summaries, not forecasts, significance tests, or trading signals.",
            },
        }
    )
    return result
