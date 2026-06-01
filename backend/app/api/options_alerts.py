from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models.options_alerts import OptionAlertEvent, OptionAlertWatch
from app.services.options_alerts import run_options_alert_scan
from app.utils.db_helpers import get_db_session

router = APIRouter()


class WatchRequest(BaseModel):
    symbol: str = Field(..., min_length=1)
    iv_percentile_max: Optional[float] = 20.0
    cooldown_minutes: Optional[int] = 1440
    active: bool = True


@router.get("/options-alerts/watchlist")
def list_watchlist():
    with get_db_session() as db:
        watches = db.query(OptionAlertWatch).order_by(OptionAlertWatch.symbol.asc()).all()
        return [
            {
                "id": watch.id,
                "symbol": watch.symbol,
                "iv_percentile_max": watch.iv_percentile_max,
                "cooldown_minutes": watch.cooldown_minutes,
                "active": watch.active,
                "last_triggered_at": watch.last_triggered_at.isoformat() if watch.last_triggered_at else None,
            }
            for watch in watches
        ]


@router.post("/options-alerts/watchlist")
def upsert_watchlist(payload: WatchRequest):
    symbol = payload.symbol.upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol is required.")
    with get_db_session() as db:
        existing = db.query(OptionAlertWatch).filter(OptionAlertWatch.symbol == symbol).first()
        if existing:
            existing.iv_percentile_max = payload.iv_percentile_max
            existing.cooldown_minutes = payload.cooldown_minutes
            existing.active = payload.active
            existing.updated_at = datetime.utcnow()
            db.add(existing)
            db.commit()
            return {"status": "updated", "id": existing.id}

        watch = OptionAlertWatch(
            symbol=symbol,
            iv_percentile_max=payload.iv_percentile_max,
            cooldown_minutes=payload.cooldown_minutes,
            active=payload.active,
        )
        db.add(watch)
        db.commit()
        return {"status": "created", "id": watch.id}


@router.delete("/options-alerts/watchlist/{watch_id}")
def delete_watch(watch_id: int):
    with get_db_session() as db:
        watch = db.query(OptionAlertWatch).filter(OptionAlertWatch.id == watch_id).first()
        if not watch:
            raise HTTPException(status_code=404, detail="Watch entry not found.")
        db.delete(watch)
        db.commit()
        return {"status": "deleted"}


@router.get("/options-alerts/events")
def list_events(limit: int = 50):
    with get_db_session() as db:
        events = (
            db.query(OptionAlertEvent)
            .order_by(OptionAlertEvent.triggered_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": event.id,
                "symbol": event.symbol,
                "triggered_at": event.triggered_at.isoformat(),
                "iv30": event.iv30,
                "hv30": event.hv30,
                "iv_percentile": event.iv_percentile,
                "avg_edr": event.avg_edr,
                "selected_contract": {
                    "expiry": event.selected_expiry,
                    "dte": event.selected_dte,
                    "strike": event.selected_strike,
                    "option_type": event.selected_option_type,
                    "premium": event.selected_premium,
                    "price_source": event.selected_price_source,
                    "bid": event.selected_bid,
                    "ask": event.selected_ask,
                    "last": event.selected_last,
                    "spread_pct": event.selected_spread_pct,
                    "volume": event.selected_volume,
                    "open_interest": event.selected_open_interest,
                    "implied_volatility": event.selected_implied_volatility,
                    "last_trade_at": event.selected_last_trade_at,
                },
                "message": event.message,
                "delivered": event.delivered,
                "delivery_channel": event.delivery_channel,
                "delivery_error": event.delivery_error,
            }
            for event in events
        ]


@router.post("/options-alerts/run")
def run_alert_scan():
    return run_options_alert_scan()
