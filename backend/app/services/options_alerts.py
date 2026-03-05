import os
import json
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

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


def _send_webhook(
    message: str,
    image_url: Optional[str] = None,
    embed_title: Optional[str] = None,
    embed_url: Optional[str] = None,
) -> tuple[bool, Optional[str], Optional[str]]:
    webhook_url = os.getenv("OPTIONS_ALERT_WEBHOOK_URL")
    discord_url = os.getenv("OPTIONS_ALERT_DISCORD_WEBHOOK")

    if not webhook_url and not discord_url:
        return False, None, "No webhook configured"

    try:
        if discord_url:
            payload: dict = {"content": message}
            if image_url:
                embed = {
                    "title": embed_title or "MACD Snapshot",
                    "image": {"url": image_url},
                    "color": 0x2F80ED,
                }
                if embed_url:
                    embed["url"] = embed_url
                    embed["description"] = f"[Open in Stock Analyzer]({embed_url})"
                payload["embeds"] = [
                    embed
                ]
            if embed_url:
                payload["components"] = [
                    {
                        "type": 1,
                        "components": [
                            {
                                "type": 2,
                                "style": 5,
                                "label": "Open in Stock Analyzer",
                                "url": embed_url,
                            }
                        ],
                    }
                ]

            # Try full payload first, then gracefully degrade if Discord rejects components/embeds.
            variants: list[dict] = [payload]
            if payload.get("components"):
                no_components = dict(payload)
                no_components.pop("components", None)
                variants.append(no_components)
            variants.append({"content": message})

            last_response = None
            for candidate in variants:
                response = requests.post(discord_url, json=candidate, timeout=10)
                last_response = response
                if response.status_code < 400:
                    return True, "discord", None

            detail = (
                f"status={last_response.status_code} body={last_response.text[:240]}"
                if last_response is not None
                else "unknown discord webhook failure"
            )
            return False, None, detail
        payload = {"content": message}
        response = requests.post(webhook_url, json=payload, timeout=10)
        if response.status_code >= 400:
            detail = f"status={response.status_code} body={response.text[:240]}"
            return False, None, detail
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


def _sparkline(values: list[float]) -> str:
    blocks = "▁▂▃▄▅▆▇█"
    if not values:
        return "n/a"
    max_abs = max(abs(value) for value in values)
    if max_abs < 1e-9:
        mid = blocks[len(blocks) // 2]
        return "".join(_ansi(mid, 33, fmt=1) for _ in values)

    out: list[str] = []
    for value in values:
        # Zero-centered scaling: 0.0 maps to 50% height.
        pct = (value + max_abs) / (2 * max_abs)
        pct = max(0.0, min(1.0, pct))
        idx = int(round(pct * (len(blocks) - 1)))
        idx = max(0, min(len(blocks) - 1, idx))
        bar = blocks[idx]
        color = 31 if pct < 0.5 else 32 if pct > 0.5 else 33
        out.append(_ansi(bar, color, fmt=1))
    return "".join(out)


def _compute_weekly_macd_bundle_norm(
    history: Optional[pd.DataFrame],
    points: int = 24,
) -> dict[str, list[float]]:
    if history is None or history.empty:
        return {}
    close = history.get("Close")
    if close is None:
        return {}
    close = close.dropna()
    if close.empty:
        return {}

    weekly = close.resample("W-FRI").last().dropna()
    if len(weekly) < 30:
        return {}

    ema_fast = weekly.ewm(span=12, adjust=False).mean()
    ema_slow = weekly.ewm(span=26, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal = macd.ewm(span=9, adjust=False).mean()
    histo = macd - signal

    range_window = weekly.tail(52)
    prange = float(range_window.max() - range_window.min()) if not range_window.empty else 0.0
    if prange <= 0:
        return {}

    scale = 100.0 / prange
    macd_norm = (macd * scale).tail(points)
    signal_norm = (signal * scale).tail(points)
    histo_norm = (histo * scale).tail(points)
    return {
        "macd": [float(value) for value in macd_norm.tolist()],
        "signal": [float(value) for value in signal_norm.tolist()],
        "hist": [float(value) for value in histo_norm.tolist()],
    }


def _compute_weekly_macd_series_norm(
    history: Optional[pd.DataFrame],
    points: int = 24,
) -> list[float]:
    return _compute_weekly_macd_bundle_norm(history, points=points).get("hist", [])


def _compute_weekly_macd_oscillator(history: Optional[pd.DataFrame]) -> tuple[Optional[float], str]:
    series = _compute_weekly_macd_series_norm(history, points=24)
    if not series:
        return None, "n/a"
    latest = float(series[-1])
    spark_values = series[-16:] if len(series) >= 16 else series
    return latest, _sparkline(spark_values)


def _build_macd_chart_image_url(history: Optional[pd.DataFrame], symbol: str) -> Optional[str]:
    bundle = _compute_weekly_macd_bundle_norm(history, points=24)
    macd_series = bundle.get("macd", [])
    signal_series = bundle.get("signal", [])
    hist_series = bundle.get("hist", [])
    if len(hist_series) < 8 or len(macd_series) != len(signal_series) or len(signal_series) != len(hist_series):
        return None

    last = hist_series[-1]
    title_suffix = "Bullish" if last > 0 else "Bearish" if last < 0 else "Neutral"
    labels = [str(i - len(hist_series) + 1) for i in range(len(hist_series))]
    hist_colors = ["rgba(16,185,129,0.62)" if value >= 0 else "rgba(239,68,68,0.62)" for value in hist_series]
    chart_config = {
        "type": "bar",
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "type": "bar",
                    "label": "Histogram",
                    "data": hist_series,
                    "backgroundColor": hist_colors,
                    "borderWidth": 0,
                    "barPercentage": 0.9,
                    "categoryPercentage": 0.95,
                    "order": 3,
                },
                {
                    "type": "line",
                    "label": "MACD",
                    "data": macd_series,
                    "borderColor": "#38bdf8",
                    "borderWidth": 2,
                    "pointRadius": 0,
                    "tension": 0.25,
                    "fill": False,
                    "order": 1,
                },
                {
                    "type": "line",
                    "label": "Signal",
                    "data": signal_series,
                    "borderColor": "#94a3b8",
                    "borderWidth": 2,
                    "pointRadius": 0,
                    "tension": 0.25,
                    "borderDash": [6, 4],
                    "fill": False,
                    "order": 2,
                },
            ],
        },
        "options": {
            "layout": {"padding": {"top": 8, "right": 12, "bottom": 8, "left": 12}},
            "plugins": {
                "legend": {
                    "display": True,
                    "position": "top",
                    "align": "end",
                    "labels": {"color": "#cbd5e1"},
                },
                "title": {
                    "display": True,
                    "text": f"{symbol} MACD 1W / 52W ({title_suffix})",
                    "color": "#cbd5e1",
                    "font": {"size": 14, "weight": "bold"},
                    "padding": {"bottom": 12},
                },
            },
            "scales": {
                "x": {
                    "display": False,
                    "grid": {"display": False},
                    "ticks": {"display": False},
                },
                "y": {
                    "grid": {"color": "rgba(148,163,184,0.18)", "borderDash": [4, 4]},
                    "ticks": {"color": "#94a3b8", "maxTicksLimit": 5},
                    "title": {"display": True, "text": "% of 52W range", "color": "#cbd5e1"},
                },
            },
        },
    }
    encoded = quote(json.dumps(chart_config, separators=(",", ":")), safe="")
    return (
        "https://quickchart.io/chart"
        "?width=900&height=420&devicePixelRatio=2&backgroundColor=%230b1220"
        f"&c={encoded}"
    )


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


def _wrap_text(text: str, width: int = 64, indent: str = "  ") -> list[str]:
    if not text:
        return [f"{indent}n/a"]
    words = text.split()
    lines: list[str] = []
    current = indent
    for word in words:
        candidate = f"{current} {word}" if current.strip() else f"{indent}{word}"
        if len(candidate) > width and current != indent:
            lines.append(current)
            current = f"{indent}{word}"
        else:
            current = candidate
    lines.append(current)
    return lines


def _compact_votes(votes: list[str]) -> str:
    if not votes:
        return "n/a"
    mapping = {
        "CHEAP:IV_SPREAD": "IV<HV",
        "EXPENSIVE:IV_SPREAD": "IV>HV",
        "FAIR:IV_SPREAD": "IV~HV",
        "CHEAP:IV_PCTL": "Low IV pct",
        "EXPENSIVE:IV_PCTL": "High IV pct",
        "FAIR:IV_PCTL": "Mid IV pct",
        "CHEAP:EDR": "Low EDR",
        "EXPENSIVE:EDR": "High EDR",
        "FAIR:EDR": "Mid EDR",
    }
    return " | ".join(mapping.get(vote, vote) for vote in votes)


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
    analyzer_url: Optional[str] = None,
) -> str:
    threshold_text = _format_value(threshold, 1) if threshold is not None else "n/a"
    direction_label = "NEUTRAL"
    if direction.lower() == "calls":
        direction_label = "BULLISH"
    elif direction.lower() == "puts":
        direction_label = "BEARISH"

    macd_osc_pct, macd_spark = _compute_weekly_macd_oscillator(history)
    macd_text = f"{macd_osc_pct:+.2f}%" if macd_osc_pct is not None else "n/a"
    bias_colored = _ansi(bias, _bias_color(bias))
    direction_colored = _ansi(direction_label, _direction_color(direction))
    macd_color = _direction_color(
        "calls" if (macd_osc_pct or 0) > 0 else "puts" if (macd_osc_pct or 0) < 0 else "neutral"
    )
    macd_colored = _ansi(macd_text, macd_color)

    headline = f"{symbol} - {label}"
    horizons = _horizon_compact_text(horizon_returns)
    direction_lines = _wrap_text(direction_reason, width=66, indent="    ")

    ansi_lines = [
        _ansi(headline, 36),
        "────────────────────────────────────────────────────────",
        "",
        _ansi("MISPRICING", 37),
        f"  Consensus : {bias_colored}",
        f"  IV Pctl   : {_format_value(iv_percentile, 1)}% (<= {threshold_text}%)",
        f"  IV/HV/EDR : {_format_value(iv30, 2)} / {_format_value(hv30, 2)} / {_format_value(avg_edr, 2)}",
        "",
        _ansi("DIRECTION", 37),
        f"  Bias      : {direction_colored}",
        *direction_lines,
        "",
        _ansi("MACD 1W (Normalized by 52W Range)", 37),
        f"  Oscillator: {macd_colored}",
        f"  Sparkline : {macd_spark}",
        "",
        _ansi("HORIZONS", 37),
        f"  {horizons}",
    ]

    lines = ["```ansi", *ansi_lines, "```"]
    return "\n".join(lines)


def _build_stock_analyzer_url(symbol: str) -> str:
    base = (
        os.getenv("STOCK_ANALYZER_BASE_URL")
        or os.getenv("FRONTEND_BASE_URL")
        or "https://marketdiagnostictool.com"
    ).strip()
    base = base.rstrip("/")
    normalized = quote((symbol or "").strip().upper(), safe="")
    return f"{base}/stock-analysis/{normalized}?symbol={normalized}"


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
                analyzer_url = _build_stock_analyzer_url(symbol)

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
                    analyzer_url=analyzer_url,
                )
                chart_url = _build_macd_chart_image_url(hist, symbol)

                delivered, channel, error = _send_webhook(
                    message,
                    image_url=chart_url,
                    embed_title=f"{symbol} MACD Snapshot",
                    embed_url=analyzer_url,
                )
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
