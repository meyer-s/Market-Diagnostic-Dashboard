from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.services.ingestion.fred_client import FredClientError
from app.services.market_psychology import get_rates_spread_dashboard, get_weather_market_correlation

router = APIRouter(prefix="/research", tags=["Research"])


@router.get("/weather-market")
async def weather_market(
    days: int = Query(365, ge=90, le=12000),
    window: int = Query(30, ge=1, le=180),
    calendar_year: int | None = Query(None, ge=2000, le=datetime.utcnow().year),
    start_date: str | None = Query(None, description="Optional ISO start date override for an exact visible-range fetch."),
    end_date: str | None = Query(None, description="Optional ISO end date override for an exact visible-range fetch."),
    granularity: str = Query("auto", description="History granularity: auto, day, week, or month."),
    force_refresh: bool = Query(False, description="Bypass cache and recompute payload."),
):
    try:
        return await get_weather_market_correlation(
            days=days,
            window=window,
            calendar_year=calendar_year,
            start_date=start_date,
            end_date=end_date,
            granularity=granularity,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FredClientError as exc:
        raise HTTPException(status_code=503, detail=f"Weather-market data unavailable: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Weather-market calculation failed: {exc}") from exc


@router.get("/rates-spread")
async def rates_spread(
    days: int = Query(365, ge=90, le=1825),
    allow_proxies: bool = Query(False, description="Allow fallback proxy series when direct series are unavailable."),
    force_refresh: bool = Query(False, description="Bypass cache and recompute payload."),
):
    try:
        return await get_rates_spread_dashboard(days=days, allow_proxies=allow_proxies, force_refresh=force_refresh)
    except FredClientError as exc:
        return {
            "days": days,
            "allow_proxies": allow_proxies,
            "status": "unavailable",
            "reason": str(exc),
            "series_meta": None,
            "latest": None,
            "history": [],
            "radar_snapshot": [],
            "from_cache": False,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Rates spread calculation failed: {exc}") from exc
