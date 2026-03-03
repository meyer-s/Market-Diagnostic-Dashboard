import os
from datetime import datetime, timedelta
from typing import Optional

import yfinance as yf
import pandas as pd
import requests

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.models.options_alerts import OptionAlertWatch, OptionAlertEvent
from app.utils.db_helpers import get_db_session

ESC = "\u001b"
ANSI_RESET = f"{ESC}[0m"
HORIZON_WINDOWS = {
    "1m": 21,
    "3m": 63,
    "6m": 126,
    "1y+": 252,
}


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


def _compute_horizon_bias(
    history: Optional[pd.DataFrame],
) -> tuple[dict[str, str], dict[str, Optional[float]]]:
    if history is None or history.empty:
        return {}, {}
    close = history.get("Close")
    if close is None:
        return {}, {}
    close = close.dropna()
    if close.empty:
        return {}, {}

    current = float(close.iloc[-1])
    labels: dict[str, str] = {}
    returns: dict[str, Optional[float]] = {}

    for horizon, window in HORIZON_WINDOWS.items():
        if len(close) <= window:
            labels[horizon] = "n/a"
            returns[horizon] = None
            continue
        past = float(close.iloc[-(window + 1)])
        if past == 0:
            labels[horizon] = "n/a"
            returns[horizon] = None
            continue
        ret = (current / past - 1) * 100
        returns[horizon] = round(ret, 1)
        labels[horizon] = "Bullish" if ret >= 0 else "Bearish"

    return labels, returns


def _format_horizon_lines(
    labels: Optional[dict[str, str]],
    returns: Optional[dict[str, Optional[float]]],
) -> list[str]:
    if not labels:
        return []
    returns = returns or {}
    lines = []
    for horizon in HORIZON_WINDOWS.keys():
        label = labels.get(horizon, "n/a")
        ret_val = returns.get(horizon)
        ret_text = f"{ret_val:+.1f}%" if ret_val is not None else "n/a"
        lines.append(f"- **{horizon}**: {label} ({ret_text})")
    return lines


def _format_horizon_summary(labels: Optional[dict[str, str]]) -> str:
    if not labels:
        return "n/a"
    parts = []
    for horizon in HORIZON_WINDOWS.keys():
        label = labels.get(horizon)
        if not label or label == "n/a":
            parts.append(f"{horizon} n/a")
        else:
            parts.append(f"{horizon} {label}")
    return " | ".join(parts)


def _format_value(value: Optional[float], digits: int = 1) -> str:
    return f"{value:.{digits}f}" if value is not None else "n/a"


def _ansi(text: str, color: int, fmt: int = 1) -> str:
    return f"{ESC}[{fmt};{color}m{text}{ANSI_RESET}"


def _bias_color(bias: str) -> int:
    code = (bias or "").upper()
    if code == "CHEAP":
        return 32
    if code == "EXPENSIVE":
        return 31
    if code == "FAIR":
        return 33
    return 30


def _direction_color(direction: str) -> int:
    code = (direction or "").lower()
    if code == "calls":
        return 32
    if code == "puts":
        return 31
    return 33


def _percentile_gauge(value: Optional[float], width: int = 12) -> str:
    if value is None:
        return "[" + ("." * width) + "]"
    clipped = max(0.0, min(100.0, float(value)))
    filled = int(round((clipped / 100.0) * width))
    return "[" + ("#" * filled) + ("." * (width - filled)) + "]"


def _compute_weekly_macd_oscillator(history: Optional[pd.DataFrame]) -> tuple[Optional[float], str]:
    if history is None or history.empty:
        return None, "[........|........]"
    close = history.get("Close")
    if close is None:
        return None, "[........|........]"
    close = close.dropna()
    if close.empty:
        return None, "[........|........]"

    weekly = close.resample("W-FRI").last().dropna()
    if len(weekly) < 30:
        return None, "[........|........]"

    ema_fast = weekly.ewm(span=12, adjust=False).mean()
    ema_slow = weekly.ewm(span=26, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal = macd.ewm(span=9, adjust=False).mean()
    histo = macd - signal
    current_histo = float(histo.iloc[-1])

    range_window = weekly.tail(52)
    prange = float(range_window.max() - range_window.min()) if not range_window.empty else 0.0
    if prange <= 0:
        return None, "[........|........]"

    osc_pct = (current_histo / prange) * 100
    bar = _macd_bar(osc_pct)
    return osc_pct, bar


def _macd_bar(osc_pct: Optional[float], span_pct: float = 3.0) -> str:
    width = 8
    if osc_pct is None:
        return "[........|........]"
    clipped = max(-span_pct, min(span_pct, float(osc_pct)))
    steps = int(round((abs(clipped) / span_pct) * width))
    left = ["."] * width
    right = ["."] * width
    if clipped >= 0:
        for i in range(steps):
            right[i] = ">"
    else:
        for i in range(steps):
            left[width - 1 - i] = "<"
    return "[" + "".join(left) + "|" + "".join(right) + "]"


def _horizon_compact_text(returns: Optional[dict[str, Optional[float]]]) -> str:
    if not returns:
        return "1m n/a  3m n/a  6m n/a  1y+ n/a"
    parts: list[str] = []
    for horizon in HORIZON_WINDOWS.keys():
        value = returns.get(horizon)
        if value is None:
            parts.append(f"{horizon} n/a")
        else:
            parts.append(f"{horizon} {value:+.1f}%")
    return "  ".join(parts)


def _format_alert_message(
    label: str,
    symbol: str,
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    bias: str,
    votes: list[str],
    reason: str,
    direction: str,
    direction_reason: str,
    threshold: Optional[float],
    horizon_labels: Optional[dict[str, str]] = None,
    horizon_returns: Optional[dict[str, Optional[float]]] = None,
    history: Optional[pd.DataFrame] = None,
) -> str:
    threshold_text = _format_value(threshold, 1) if threshold is not None else "n/a"
    direction_label = "NEUTRAL"
    if direction.lower() == "calls":
        direction_label = "BULLISH"
    elif direction.lower() == "puts":
        direction_label = "BEARISH"

    votes_text = ", ".join(votes) if votes else "n/a"
    gauge = _percentile_gauge(iv_percentile)
    macd_osc_pct, macd_bar = _compute_weekly_macd_oscillator(history)
    macd_text = f"{macd_osc_pct:+.2f}%" if macd_osc_pct is not None else "n/a"

    bias_colored = _ansi(bias, _bias_color(bias))
    direction_colored = _ansi(direction_label, _direction_color(direction))
    macd_color = _direction_color("calls" if (macd_osc_pct or 0) > 0 else "puts" if (macd_osc_pct or 0) < 0 else "neutral")
    macd_colored = _ansi(macd_text, macd_color)

    header = f"SCAN HIT {symbol} - {label}"
    detail_line = (
        f"IV30 { _format_value(iv30, 2) }  HV30 { _format_value(hv30, 2) }  EDR { _format_value(avg_edr, 2) }"
    )
    horizons_line = _horizon_compact_text(horizon_returns)

    ansi_lines = [
        _ansi(header, 36),
        f"MISPRICING   {bias_colored}   IV% {_format_value(iv_percentile, 1)} <= {threshold_text} {gauge}",
        f"VOL SNAP     {detail_line}",
        f"DIRECTION    {direction_colored}   {direction_reason}",
        f"MACD 1W/52W  {macd_colored}  {macd_bar}",
        f"HORIZONS     {horizons_line}",
    ]

    lines = [
        "```ansi",
        *ansi_lines,
        "```",
        f"Reason: {reason}",
        f"Votes: {votes_text}",
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

                hist = stock.history(period="1y")
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
                horizon_labels, horizon_returns = _compute_horizon_bias(hist)
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
                    bias,
                    votes,
                    reason,
                    direction,
                    direction_reason,
                    watch.iv_percentile_max,
                    horizon_labels,
                    horizon_returns,
                    hist,
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
