import os
from datetime import datetime, timedelta
from typing import Optional

import yfinance as yf
import requests

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.models.options_alerts import OptionAlertWatch, OptionAlertEvent
from app.utils.db_helpers import get_db_session


def _get_current_price(stock: yf.Ticker) -> Optional[float]:
    history = stock.history(period="3mo")
    if history is None or history.empty:
        return None
    close = history["Close"].dropna()
    if close.empty:
        return None
    return float(close.iloc[-1])


def _send_webhook(message: str) -> tuple[bool, Optional[str], Optional[str]]:
    webhook_url = os.getenv("OPTIONS_ALERT_WEBHOOK_URL")
    discord_url = os.getenv("OPTIONS_ALERT_DISCORD_WEBHOOK")

    if not webhook_url and not discord_url:
        return False, None, "No webhook configured"

    payload = {"content": message}
    try:
        if discord_url:
            response = requests.post(discord_url, json=payload, timeout=10)
            response.raise_for_status()
            return True, "discord", None
        response = requests.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        return True, "webhook", None
    except Exception as exc:
        return False, None, str(exc)


def _should_trigger(watch: OptionAlertWatch, iv_percentile: Optional[float]) -> bool:
    if iv_percentile is None:
        return False
    if not watch.active:
        return False
    return iv_percentile <= (watch.iv_percentile_max or 0)


def run_options_alert_scan() -> dict:
    results = {"checked": 0, "triggered": 0, "errors": 0}
    with get_db_session() as db:
        watches = db.query(OptionAlertWatch).filter(OptionAlertWatch.active.is_(True)).all()

        for watch in watches:
            results["checked"] += 1
            symbol = watch.symbol.upper()
            try:
                stock = yf.Ticker(symbol)
                current_price = _get_current_price(stock)
                if current_price is None:
                    continue

                hist = stock.history(period="6mo")
                hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
                metrics = compute_optionality_metrics(stock, current_price, hv30)
                iv_percentile = metrics.get("iv_percentile")

                if not _should_trigger(watch, iv_percentile):
                    continue

                if watch.last_triggered_at:
                    cooldown = timedelta(minutes=watch.cooldown_minutes or 0)
                    if datetime.utcnow() - watch.last_triggered_at < cooldown:
                        continue

                message = (
                    f"Options alert: {symbol} IV percentile {iv_percentile}% "
                    f"(IV30 {metrics.get('iv30')}, HV30 {metrics.get('hv30')}, "
                    f"EDR {metrics.get('avg_edr')})"
                )

                delivered, channel, error = _send_webhook(message)
                event = OptionAlertEvent(
                    symbol=symbol,
                    iv30=metrics.get("iv30"),
                    hv30=metrics.get("hv30"),
                    iv_percentile=iv_percentile,
                    avg_edr=metrics.get("avg_edr"),
                    message=message,
                    delivered=delivered,
                    delivery_channel=channel,
                    delivery_error=error,
                )
                db.add(event)
                watch.last_triggered_at = datetime.utcnow()
                db.add(watch)
                db.commit()
                results["triggered"] += 1
            except Exception:
                results["errors"] += 1
                db.rollback()
    return results
