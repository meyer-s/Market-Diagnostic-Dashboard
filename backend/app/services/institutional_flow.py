from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean
from typing import Any

import pandas as pd
import yfinance as yf


SECTOR_SYMBOLS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]
METAL_SYMBOLS = ["GLD", "SLV", "PPLT", "PALL", "GDX", "SIL"]
CRYPTO_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"]
DEFAULT_STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"]
LIQUID_STOCK_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "BRK-B", "JPM",
    "XOM", "V", "WMT", "LLY", "ORCL", "NFLX", "COST", "KO", "AMD", "DIS",
    "PLTR", "INTC", "BAC", "PFE", "CSCO", "CRM", "UBER", "QCOM", "ADBE", "NKE",
]


@dataclass
class FlowConfig:
    lookback_days: int = 120
    rolling_window: int = 20
    z_threshold: float = 2.0


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _extract_symbol_frame(raw: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame()

    if isinstance(raw.columns, pd.MultiIndex):
        if symbol not in raw.columns.get_level_values(0):
            return pd.DataFrame()
        frame = raw[symbol].copy()
    else:
        frame = raw.copy()

    expected_cols = ["Open", "High", "Low", "Close", "Volume"]
    for col in expected_cols:
        if col not in frame.columns:
            frame[col] = None

    frame = frame[expected_cols].dropna(subset=["Close", "Volume"])
    if frame.empty:
        return pd.DataFrame()

    frame.index = pd.to_datetime(frame.index, errors="coerce")
    frame = frame[frame.index.notna()]
    return frame.sort_index()


def _classify_side(clv: float, price_change: float) -> str:
    if clv >= 0.2 and price_change >= 0:
        return "buy"
    if clv <= -0.2 and price_change <= 0:
        return "sell"
    return "neutral"


def _build_events(df: pd.DataFrame, config: FlowConfig) -> list[dict[str, Any]]:
    frame = df.copy()
    frame["vol_avg"] = frame["Volume"].rolling(config.rolling_window).mean()
    frame["vol_std"] = frame["Volume"].rolling(config.rolling_window).std(ddof=0)
    frame["volume_z"] = (frame["Volume"] - frame["vol_avg"]) / frame["vol_std"]
    frame["price_change"] = frame["Close"].pct_change().fillna(0.0)
    range_size = (frame["High"] - frame["Low"]).replace(0, pd.NA)
    frame["clv"] = ((frame["Close"] - frame["Low"]) - (frame["High"] - frame["Close"])) / range_size
    frame["clv"] = frame["clv"].fillna(0.0).clip(-1, 1)
    frame["notional"] = frame["Close"] * frame["Volume"]

    triggered = frame[frame["volume_z"] >= config.z_threshold].copy()
    if triggered.empty:
        return []

    events: list[dict[str, Any]] = []
    for idx, row in triggered.iterrows():
        clv = float(row["clv"])
        price_change = float(row["price_change"])
        side = _classify_side(clv, price_change)
        signal_strength = float(row["volume_z"]) * abs(clv)
        events.append(
            {
                "date": idx.date().isoformat(),
                "price": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]),
                "volume_z": round(float(row["volume_z"]), 2),
                "clv": round(clv, 3),
                "price_change_pct": round(price_change * 100, 2),
                "notional": round(float(row["notional"]), 2),
                "side": side,
                "strength": round(signal_strength, 2),
            }
        )

    return events


def _weighted_level(events: list[dict[str, Any]]) -> float | None:
    if not events:
        return None
    weighted_sum = sum(event["price"] * event["notional"] for event in events)
    total_weight = sum(event["notional"] for event in events)
    if total_weight <= 0:
        return None
    return weighted_sum / total_weight


def detect_flow_events_from_frame(df: pd.DataFrame, lookback_days: int = 120) -> list[dict[str, Any]]:
    config = FlowConfig(lookback_days=max(60, min(lookback_days, 365)))
    if df is None or df.empty:
        return []
    frame = df.copy().tail(config.lookback_days)
    if len(frame) < config.rolling_window + 1:
        return []
    return _build_events(frame, config)


def summarize_flow_events(events: list[dict[str, Any]], latest_price: float | None = None) -> dict[str, Any]:
    buys = [event for event in events if event["side"] == "buy"]
    sells = [event for event in events if event["side"] == "sell"]

    buy_notional = sum(event["notional"] for event in buys)
    sell_notional = sum(event["notional"] for event in sells)
    net_flow = buy_notional - sell_notional

    buy_level = _weighted_level(buys)
    sell_level = _weighted_level(sells)
    avg_strength = mean([event["strength"] for event in events]) if events else 0.0
    confidence = min(100.0, avg_strength * 22.0)

    if net_flow > 0 and confidence >= 35:
        signal = "accumulation"
    elif net_flow < 0 and confidence >= 35:
        signal = "distribution"
    else:
        signal = "neutral"

    pct_to_buy = ((latest_price - buy_level) / buy_level * 100) if latest_price and buy_level else None
    pct_to_sell = ((sell_level - latest_price) / latest_price * 100) if latest_price and sell_level else None

    return {
        "signal": signal,
        "confidence": round(confidence, 1),
        "buy_cluster_level": round(buy_level, 4) if buy_level is not None else None,
        "sell_cluster_level": round(sell_level, 4) if sell_level is not None else None,
        "distance_to_buy_pct": round(pct_to_buy, 2) if pct_to_buy is not None else None,
        "distance_to_sell_pct": round(pct_to_sell, 2) if pct_to_sell is not None else None,
        "buy_notional_usd": round(buy_notional, 2),
        "sell_notional_usd": round(sell_notional, 2),
        "net_flow_usd": round(net_flow, 2),
        "event_count": len(events),
    }


def _build_flow_timeline(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not events:
        return []

    grouped: dict[str, dict[str, Any]] = {}
    for event in events:
        event_dt = datetime.fromisoformat(event["date"])
        bucket_dt = event_dt - timedelta(days=event_dt.weekday())
        bucket_key = bucket_dt.date().isoformat()

        bucket = grouped.setdefault(
            bucket_key,
            {
                "bucket": bucket_key,
                "buy_notional_usd": 0.0,
                "sell_notional_usd": 0.0,
                "neutral_notional_usd": 0.0,
                "buy_events": 0,
                "sell_events": 0,
                "neutral_events": 0,
            },
        )

        side = event["side"]
        notional = float(event["notional"])
        if side == "buy":
            bucket["buy_notional_usd"] += notional
            bucket["buy_events"] += 1
        elif side == "sell":
            bucket["sell_notional_usd"] += notional
            bucket["sell_events"] += 1
        else:
            bucket["neutral_notional_usd"] += notional
            bucket["neutral_events"] += 1

    timeline = []
    for bucket_key in sorted(grouped.keys()):
        bucket = grouped[bucket_key]
        net_flow = bucket["buy_notional_usd"] - bucket["sell_notional_usd"]
        total_notional = bucket["buy_notional_usd"] + bucket["sell_notional_usd"] + bucket["neutral_notional_usd"]
        timeline.append(
            {
                "bucket": bucket_key,
                "buy_notional_usd": round(bucket["buy_notional_usd"], 2),
                "sell_notional_usd": round(bucket["sell_notional_usd"], 2),
                "neutral_notional_usd": round(bucket["neutral_notional_usd"], 2),
                "net_flow_usd": round(net_flow, 2),
                "total_notional_usd": round(total_notional, 2),
                "buy_events": bucket["buy_events"],
                "sell_events": bucket["sell_events"],
                "neutral_events": bucket["neutral_events"],
            }
        )

    return timeline


def _build_signal(symbol: str, name: str, category: str, frame: pd.DataFrame, config: FlowConfig) -> dict[str, Any]:
    if frame.empty or len(frame) < config.rolling_window + 1:
        return {
            "symbol": symbol,
            "name": name,
            "category": category,
            "status": "insufficient_data",
            "signal": "neutral",
            "confidence": 0.0,
            "latest_price": None,
            "buy_cluster_level": None,
            "sell_cluster_level": None,
            "net_flow_usd": None,
            "recent_events": [],
        }

    events = _build_events(frame.tail(config.lookback_days), config)
    buys = [event for event in events if event["side"] == "buy"]
    sells = [event for event in events if event["side"] == "sell"]

    buy_notional = sum(event["notional"] for event in buys)
    sell_notional = sum(event["notional"] for event in sells)
    net_flow = buy_notional - sell_notional

    buy_level = _weighted_level(buys)
    sell_level = _weighted_level(sells)

    avg_strength = mean([event["strength"] for event in events]) if events else 0.0
    confidence = min(100.0, avg_strength * 22.0)

    if net_flow > 0 and confidence >= 35:
        signal = "accumulation"
    elif net_flow < 0 and confidence >= 35:
        signal = "distribution"
    else:
        signal = "neutral"

    latest_price = _to_float(frame["Close"].iloc[-1])
    pct_to_buy = ((latest_price - buy_level) / buy_level * 100) if latest_price and buy_level else None
    pct_to_sell = ((sell_level - latest_price) / latest_price * 100) if latest_price and sell_level else None

    return {
        "symbol": symbol,
        "name": name,
        "category": category,
        "status": "ok",
        "signal": signal,
        "confidence": round(confidence, 1),
        "latest_price": round(latest_price, 4) if latest_price is not None else None,
        "buy_cluster_level": round(buy_level, 4) if buy_level is not None else None,
        "sell_cluster_level": round(sell_level, 4) if sell_level is not None else None,
        "distance_to_buy_pct": round(pct_to_buy, 2) if pct_to_buy is not None else None,
        "distance_to_sell_pct": round(pct_to_sell, 2) if pct_to_sell is not None else None,
        "buy_notional_usd": round(buy_notional, 2),
        "sell_notional_usd": round(sell_notional, 2),
        "net_flow_usd": round(net_flow, 2),
        "event_count": len(events),
        "flow_timeline": _build_flow_timeline(events),
        "recent_events": sorted(events, key=lambda event: event["date"], reverse=True)[:8],
    }


def _download_universe(symbols: list[str], period: str = "9mo") -> pd.DataFrame:
    if not symbols:
        return pd.DataFrame()

    return yf.download(
        tickers=" ".join(symbols),
        period=period,
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="ticker",
    )


def _select_top_close_volume_stocks(raw_data: pd.DataFrame, candidates: list[str], top_n: int = 10) -> list[str]:
    ranked: list[tuple[str, float]] = []
    for symbol in candidates:
        frame = _extract_symbol_frame(raw_data, symbol)
        if frame.empty:
            continue

        latest = frame.iloc[-1]
        close_px = _to_float(latest.get("Close"))
        volume = _to_float(latest.get("Volume"))
        if close_px is None or volume is None:
            continue

        ranked.append((symbol, close_px * volume))

    ranked.sort(key=lambda item: item[1], reverse=True)
    return [symbol for symbol, _ in ranked[:top_n]]


def build_institutional_flow_overview(stock_symbols: list[str] | None = None, lookback_days: int = 120) -> dict[str, Any]:
    config = FlowConfig(lookback_days=max(60, min(lookback_days, 365)))

    requested_stocks = [symbol.strip().upper() for symbol in (stock_symbols or []) if symbol.strip()]
    stock_selection_mode = "manual" if requested_stocks else "auto_top_close_volume"

    stock_selection_pool = requested_stocks if requested_stocks else LIQUID_STOCK_UNIVERSE

    selection_universe = {
        "sectors": [(symbol, symbol) for symbol in SECTOR_SYMBOLS],
        "metals": [(symbol, symbol) for symbol in METAL_SYMBOLS],
        "crypto": [(symbol, symbol.replace("-USD", "")) for symbol in CRYPTO_SYMBOLS],
        "stocks": [(symbol, symbol) for symbol in stock_selection_pool[:30]],
    }

    all_symbols: list[str] = []
    for items in selection_universe.values():
        all_symbols.extend([symbol for symbol, _ in items])

    raw_data = _download_universe(sorted(set(all_symbols)))

    selected_stock_symbols = (
        requested_stocks[:25]
        if requested_stocks
        else _select_top_close_volume_stocks(raw_data, stock_selection_pool, top_n=10)
    )
    if not selected_stock_symbols:
        selected_stock_symbols = DEFAULT_STOCK_SYMBOLS[:10]

    universe = {
        "sectors": [(symbol, symbol) for symbol in SECTOR_SYMBOLS],
        "metals": [(symbol, symbol) for symbol in METAL_SYMBOLS],
        "crypto": [(symbol, symbol.replace("-USD", "")) for symbol in CRYPTO_SYMBOLS],
        "stocks": [(symbol, symbol) for symbol in selected_stock_symbols],
    }

    grouped_results: dict[str, list[dict[str, Any]]] = {}
    all_results: list[dict[str, Any]] = []

    for category, items in universe.items():
        results = []
        for symbol, name in items:
            frame = _extract_symbol_frame(raw_data, symbol)
            result = _build_signal(symbol=symbol, name=name, category=category, frame=frame, config=config)
            results.append(result)
            if result["status"] == "ok":
                all_results.append(result)
        grouped_results[category] = results

    leaders_acc = sorted(
        [item for item in all_results if item["signal"] == "accumulation"],
        key=lambda item: (item["confidence"], item["net_flow_usd"]),
        reverse=True,
    )[:10]
    leaders_dist = sorted(
        [item for item in all_results if item["signal"] == "distribution"],
        key=lambda item: (item["confidence"], abs(item["net_flow_usd"])),
        reverse=True,
    )[:10]

    return {
        "as_of": datetime.utcnow().isoformat(),
        "method": {
            "name": "clustered_volume_proxy",
            "description": "High-volume bar clustering with close-location bias as a dark-pool proxy.",
            "thresholds": {
                "volume_z_min": config.z_threshold,
                "rolling_window_days": config.rolling_window,
                "lookback_days": config.lookback_days,
            },
            "note": "This is a proxy for institutional flow and not a direct ATS/TRF dark-pool tape.",
        },
        "groups": grouped_results,
        "leaders": {
            "accumulation": leaders_acc,
            "distribution": leaders_dist,
        },
        "stock_selection": {
            "mode": stock_selection_mode,
            "symbols": selected_stock_symbols,
            "count": len(selected_stock_symbols),
        },
    }
