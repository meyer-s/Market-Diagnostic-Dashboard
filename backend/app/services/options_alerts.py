import os
import os
from datetime import datetime, timedelta
from typing import Optional

import yfinance as yf
import pandas as pd
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


def _is_iv_data_valid(iv30: Optional[float], hv30: Optional[float], iv_percentile: Optional[float]) -> bool:
    if iv30 is None or iv30 <= 1:
        return False
    if iv_percentile is not None and iv_percentile == 0 and (hv30 or 0) > 10:
        return False
    return True


def _compute_option_bias(
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float],
    avg_edr: Optional[float],
) -> tuple[str, list[str]]:
    votes: list[str] = []

    if iv30 is not None and hv30 is not None:
        spread = iv30 - hv30
        if spread > 5:
            votes.append("EXPENSIVE:IV_SPREAD")
        elif spread < -5:
            votes.append("CHEAP:IV_SPREAD")
        else:
            votes.append("FAIR:IV_SPREAD")

    if iv_percentile is not None:
        if iv_percentile > 70:
            votes.append("EXPENSIVE:IV_PCTL")
        elif iv_percentile < 30:
            votes.append("CHEAP:IV_PCTL")
        else:
            votes.append("FAIR:IV_PCTL")

    if avg_edr is not None:
        if avg_edr > 60:
            votes.append("EXPENSIVE:EDR")
        elif avg_edr < 40:
            votes.append("CHEAP:EDR")
        else:
            votes.append("FAIR:EDR")

    if not votes:
        return "UNKNOWN", votes

    tally = {"CHEAP": 0, "FAIR": 0, "EXPENSIVE": 0}
    for vote in votes:
        bias = vote.split(":")[0]
        tally[bias] += 1

    sorted_votes = sorted(tally.items(), key=lambda item: item[1], reverse=True)
    if len(sorted_votes) > 1 and sorted_votes[0][1] == sorted_votes[1][1]:
        return "FAIR", votes
    return sorted_votes[0][0], votes


def _build_alert_reason(
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float],
    threshold: Optional[float],
    bias: Optional[str],
    votes: Optional[list[str]],
) -> str:
    reasons = []
    if bias:
        reasons.append(f"{bias} consensus")
    if votes:
        reasons.append(", ".join(votes))
    if iv_percentile is not None:
        limit = threshold if threshold is not None else 0
        reasons.append(f"IV percentile {iv_percentile:.1f}% <= {limit:.1f}%")
    if iv30 is not None and hv30 is not None:
        spread = iv30 - hv30
        if spread < 0:
            reasons.append(f"IV30 below HV30 by {abs(spread):.1f} pts")
    if not reasons and iv_percentile is not None:
        reasons.append(f"IV percentile {iv_percentile:.1f}%")
    return "; ".join(reasons) if reasons else "Low IV percentile"


def _direction_hint(history: Optional[pd.DataFrame]) -> tuple[str, str]:
    if history is None or history.empty:
        return "Neutral", "Insufficient price history"
    close = history.get("Close")
    if close is None:
        return "Neutral", "Missing close data"
    close = close.dropna()
    if len(close) < 10:
        return "Neutral", "Limited price history"

    current = float(close.iloc[-1])
    window = 50 if len(close) >= 50 else 20
    ma = close.rolling(window).mean().iloc[-1]
    ma_value = float(ma) if pd.notna(ma) else None

    ret_window = 20 if len(close) >= 21 else 5
    if len(close) >= ret_window + 1:
        ret = (current / float(close.iloc[-(ret_window + 1)]) - 1) * 100
    else:
        ret = 0.0

    if ma_value is not None and current > ma_value and ret > 2:
        return "Calls", f"{ret_window}d return +{ret:.1f}%, price above {window}D MA"
    if ma_value is not None and current < ma_value and ret < -2:
        return "Puts", f"{ret_window}d return {ret:.1f}%, price below {window}D MA"
    return "Neutral", f"{ret_window}d return {ret:.1f}%"


def _format_value(value: Optional[float], digits: int = 1) -> str:
    return f"{value:.{digits}f}" if value is not None else "n/a"


def _format_alert_message(
    label: str,
    symbol: str,
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    reason: str,
    direction: str,
    direction_reason: str,
    threshold: Optional[float],
) -> str:
    threshold_text = _format_value(threshold, 1) if threshold is not None else "n/a"
    lines = [
        f"**Options Alert - {label}**",
        f"`{symbol}`",
        f"- IV percentile: **{_format_value(iv_percentile, 1)}%** (threshold {threshold_text}%)",
        f"- IV30 / HV30 / EDR: {_format_value(iv30, 2)} / {_format_value(hv30, 2)} / {_format_value(avg_edr, 2)}%",
        f"- Reason: {reason}",
        f"- Direction hint: **{direction}** ({direction_reason})",
    ]
    return "\n".join(lines)


def _should_trigger(watch: OptionAlertWatch, iv_percentile: Optional[float], bias: str) -> bool:
    if iv_percentile is None:
        return False
    if not watch.active:
        return False
    if bias != "CHEAP":
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
                iv30 = metrics.get("iv30")
                avg_edr = metrics.get("avg_edr")

                if not _is_iv_data_valid(iv30, hv30, iv_percentile):
                    continue

                bias, votes = _compute_option_bias(iv30, hv30, iv_percentile, avg_edr)
                if not _should_trigger(watch, iv_percentile, bias):
                    continue

                reason = _build_alert_reason(
                    iv30,
                    hv30,
                    iv_percentile,
                    watch.iv_percentile_max,
                    bias,
                    votes,
                )
                direction, direction_reason = _direction_hint(hist)
                if watch.last_triggered_at:
                    cooldown = timedelta(minutes=watch.cooldown_minutes or 0)
                    if datetime.utcnow() - watch.last_triggered_at < cooldown:
                        continue

                message = _format_alert_message(
                    "Watchlist",
                    symbol,
                    iv_percentile,
                    iv30,
                    metrics.get("hv30"),
                    avg_edr,
                    reason,
                    direction,
                    direction_reason,
                    watch.iv_percentile_max,
                )

                delivered, channel, error = _send_webhook(message)
                event = OptionAlertEvent(
                    symbol=symbol,
                    iv30=iv30,
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
