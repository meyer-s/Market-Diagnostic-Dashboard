from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query

from app.services.institutional_flow import build_institutional_flow_overview


router = APIRouter(prefix="/flow-signals", tags=["InstitutionalFlow"])

_CACHE_TTL_SECONDS = 300
_cached_payload: tuple[float, dict] | None = None


def _parse_stock_symbols(stocks: Optional[str]) -> list[str] | None:
    if not stocks:
        return None
    values = [item.strip().upper() for item in stocks.split(",")]
    return [item for item in values if item]


@router.get("/overview")
def get_flow_signal_overview(
    stocks: Optional[str] = Query(
        default=None,
        description="Optional comma-separated stock symbols. Example: AAPL,MSFT,NVDA",
    ),
    lookback_days: int = Query(default=120, ge=60, le=365),
    refresh: bool = Query(default=False, description="Bypass cache and force data refresh."),
):
    global _cached_payload

    stock_symbols = _parse_stock_symbols(stocks)
    cache_key = f"{','.join(stock_symbols or [])}|{lookback_days}"

    now_ts = datetime.utcnow().timestamp()

    if not refresh and _cached_payload:
        cached_at, payload = _cached_payload
        if payload.get("cache_key") == cache_key and (now_ts - cached_at) <= _CACHE_TTL_SECONDS:
            return payload

    payload = build_institutional_flow_overview(
        stock_symbols=stock_symbols,
        lookback_days=lookback_days,
    )
    payload["cache_key"] = cache_key
    payload["cached_at"] = datetime.utcnow().isoformat()

    _cached_payload = (now_ts, payload)
    return payload
