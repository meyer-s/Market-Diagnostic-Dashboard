from fastapi import APIRouter, HTTPException, Query

from app.services.ingestion.fred_client import FredClientError
from app.services.market_psychology import get_rates_spread_dashboard, get_weather_market_correlation

router = APIRouter(prefix="/research", tags=["Research"])


@router.get("/weather-market")
async def weather_market(
    days: int = Query(365, ge=90, le=1825),
    window: int = Query(30, ge=20, le=120),
    force_refresh: bool = Query(False, description="Bypass cache and recompute payload."),
):
    try:
        return await get_weather_market_correlation(days=days, window=window, force_refresh=force_refresh)
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
        raise HTTPException(status_code=503, detail=f"Rates spread data unavailable: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Rates spread calculation failed: {exc}") from exc
