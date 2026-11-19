from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from math import isfinite
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


METHOD_VERSION = "daily_price_volume_v2"


def price_volume_method() -> dict[str, Any]:
    return {
        "name": METHOD_VERSION,
        "description": "Daily volume outliers relative to the prior 20 observed bars, classified by close location and daily price change.",
        "note": "Signed turnover is positive-bar turnover minus negative-bar turnover on flagged days. It does not identify investors, trade initiation, or net fund flows. Reference prices are turnover-weighted flagged closes, not trading targets.",
        "direct_institutional_tape": False,
        "source": "Yahoo Finance daily OHLCV via yfinance",
        "turnover_units": "Crypto Volume is already USD turnover; stock and ETF turnover is estimated as close × share volume.",
        "bar_timing": "Latest provider daily bars may include an unfinished session. Provider dates and refresh time are shown separately.",
    }


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        result = float(value)
        return result if isfinite(result) else None
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


def prepare_price_volume_frame(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy()
    for column in ["High", "Low", "Close", "Volume"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.replace([float("inf"), float("-inf")], float("nan")).dropna(subset=["High", "Low", "Close", "Volume"])
    frame.index = pd.to_datetime(frame.index, errors="coerce")
    frame = frame[frame.index.notna()]
    frame = frame[(frame["Close"] > 0) & (frame["Volume"] >= 0) & (frame["High"] >= frame["Low"])]
    frame = frame.sort_index()
    return frame[~frame.index.duplicated(keep="last")]


def _window(df: pd.DataFrame, config: FlowConfig, end: date | None = None) -> tuple[date, date]:
    end = end or (df.index[-1].date() if not df.empty else datetime.now(timezone.utc).date())
    return end - timedelta(days=config.lookback_days - 1), end


def _build_events(df: pd.DataFrame, config: FlowConfig, *, volume_in_usd: bool = False, end: date | None = None) -> list[dict[str, Any]]:
    frame = df.copy()
    baseline = frame["Volume"].shift(1).rolling(config.rolling_window)
    frame["vol_avg"] = baseline.mean()
    frame["vol_std"] = baseline.std(ddof=0)
    frame["volume_z"] = (frame["Volume"] - frame["vol_avg"]) / frame["vol_std"].replace(0, float("nan"))
    frame["price_change"] = frame["Close"].pct_change().fillna(0.0)
    range_size = (frame["High"] - frame["Low"]).replace(0, float("nan"))
    frame["clv"] = ((frame["Close"] - frame["Low"]) - (frame["High"] - frame["Close"])) / range_size
    frame["clv"] = frame["clv"].fillna(0.0).clip(-1, 1)
    frame["notional"] = frame["Volume"] if volume_in_usd else frame["Close"] * frame["Volume"]

    start, finish = _window(frame, config, end)
    triggered = frame[(frame["volume_z"] >= config.z_threshold) & (frame.index.date >= start) & (frame.index.date <= finish)].copy()
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


def detect_flow_events_from_frame(df: pd.DataFrame, lookback_days: int = 120, *, symbol: str = "") -> list[dict[str, Any]]:
    config = FlowConfig(lookback_days=max(60, min(lookback_days, 365)))
    if df is None or df.empty:
        return []
    frame = prepare_price_volume_frame(df)
    if len(frame) < config.rolling_window + 1:
        return []
    return _build_events(frame, config, volume_in_usd=symbol.upper().endswith("-USD"))


def summarize_flow_events(events: list[dict[str, Any]], latest_price: float | None = None) -> dict[str, Any]:
    buys = [event for event in events if event["side"] == "buy"]
    sells = [event for event in events if event["side"] == "sell"]

    buy_notional = sum(event["notional"] for event in buys)
    sell_notional = sum(event["notional"] for event in sells)
    net_flow = buy_notional - sell_notional

    buy_level = _weighted_level(buys)
    sell_level = _weighted_level(sells)
    neutral_notional = sum(event["notional"] for event in events if event["side"] == "neutral")
    total_notional = buy_notional + sell_notional + neutral_notional
    pressure = "positive" if net_flow > 0 else "negative" if net_flow < 0 else "mixed"
    pct_to_buy = ((buy_level - latest_price) / latest_price * 100) if latest_price and buy_level else None
    pct_to_sell = ((sell_level - latest_price) / latest_price * 100) if latest_price and sell_level else None

    return {
        "pressure": pressure,
        "positive_reference_price": round(buy_level, 4) if buy_level is not None else None,
        "negative_reference_price": round(sell_level, 4) if sell_level is not None else None,
        "change_to_positive_reference_pct": round(pct_to_buy, 2) if pct_to_buy is not None else None,
        "change_to_negative_reference_pct": round(pct_to_sell, 2) if pct_to_sell is not None else None,
        "positive_turnover_usd": round(buy_notional, 2),
        "negative_turnover_usd": round(sell_notional, 2),
        "neutral_turnover_usd": round(neutral_notional, 2),
        "total_turnover_usd": round(total_notional, 2),
        "signed_turnover_usd": round(net_flow, 2),
        "pressure_balance_pct": round(net_flow / total_notional * 100, 2) if total_notional else 0.0,
        "mean_volume_z": round(mean(event["volume_z"] for event in events), 2) if events else None,
        "latest_event_date": max((event["date"] for event in events), default=None),
        "event_count": len(events),
    }


def _build_flow_timeline(events: list[dict[str, Any]], start: date | None = None, end: date | None = None, frame: pd.DataFrame | None = None) -> list[dict[str, Any]]:
    if start is None or end is None:
        if not events:
            return []
        start = date.fromisoformat(min(event["date"] for event in events))
        end = date.fromisoformat(max(event["date"] for event in events))
    monday = start - timedelta(days=start.weekday())
    grouped = {}
    while monday <= end:
        key = monday.isoformat()
        grouped[key] = {
            "bucket": key, "positive_turnover_usd": 0.0, "negative_turnover_usd": 0.0,
            "neutral_turnover_usd": 0.0, "positive_events": 0, "negative_events": 0,
            "neutral_events": 0, "observed_bars": 0,
        }
        monday += timedelta(days=7)
    if frame is not None:
        for timestamp in frame.index:
            observed = timestamp.date()
            if start <= observed <= end:
                key = (observed - timedelta(days=observed.weekday())).isoformat()
                grouped[key]["observed_bars"] += 1
    for event in events:
        event_date = date.fromisoformat(event["date"])
        key = (event_date - timedelta(days=event_date.weekday())).isoformat()
        if key not in grouped:
            continue
        direction = {"buy": "positive", "sell": "negative"}.get(event["side"], "neutral")
        grouped[key][f"{direction}_turnover_usd"] += event["notional"]
        grouped[key][f"{direction}_events"] += 1
    for bucket in grouped.values():
        bucket["signed_turnover_usd"] = round(bucket["positive_turnover_usd"] - bucket["negative_turnover_usd"], 2)
        bucket["total_turnover_usd"] = round(sum(bucket[f"{side}_turnover_usd"] for side in ["positive", "negative", "neutral"]), 2)
        for side in ["positive", "negative", "neutral"]:
            bucket[f"{side}_turnover_usd"] = round(bucket[f"{side}_turnover_usd"], 2)
    return list(grouped.values())


def build_price_volume_signal(symbol: str, frame: pd.DataFrame, lookback_days: int = 120, *, end: date | None = None) -> dict[str, Any]:
    config = FlowConfig(lookback_days=max(60, min(lookback_days, 365)))
    cleaned = prepare_price_volume_frame(frame) if frame is not None and not frame.empty else pd.DataFrame()
    start, finish = _window(cleaned, config, end)
    # Retain pre-window observations for the baseline; every asset shares calendar bounds.
    cleaned = cleaned[cleaned.index.date <= finish] if not cleaned.empty else cleaned
    window_frame = cleaned[cleaned.index.date >= start] if not cleaned.empty else cleaned
    events = _build_events(cleaned, config, volume_in_usd=symbol.upper().endswith("-USD"), end=finish) if not cleaned.empty else []
    latest_price = _to_float(cleaned["Close"].iloc[-1]) if not cleaned.empty else None
    latest_date = cleaned.index[-1].date() if not cleaned.empty else None
    baseline_count = int((cleaned.index.date < start).sum()) if not cleaned.empty else 0
    prior_std = cleaned["Volume"].shift(1).rolling(config.rolling_window).std(ddof=0) if not cleaned.empty else pd.Series(dtype=float)
    eligible = int(((prior_std > 0) & (prior_std.index.date >= start)).sum()) if not cleaned.empty else 0
    return {
        **summarize_flow_events(events, latest_price),
        "symbol": symbol,
        "status": "ok" if eligible else "insufficient_data",
        "latest_price": latest_price,
        "latest_bar_date": latest_date.isoformat() if latest_date else None,
        "bar_age_calendar_days": (finish - latest_date).days if latest_date else None,
        "window_start": start.isoformat(), "window_end": finish.isoformat(),
        "observed_bars": len(window_frame), "baseline_bars": min(baseline_count, config.rolling_window),
        "eligible_bars": eligible,
        "volume_unit": "USD" if symbol.upper().endswith("-USD") else "shares",
        "flow_timeline": _build_flow_timeline(events, start, finish, cleaned),
        "recent_events": sorted(events, key=lambda event: event["date"], reverse=True)[:8],
        "event_history": events,
    }


def _build_signal(symbol: str, name: str, category: str, frame: pd.DataFrame, config: FlowConfig, end: date | None = None) -> dict[str, Any]:
    result = build_price_volume_signal(symbol, frame, config.lookback_days, end=end)
    result.pop("event_history")
    return {**result, "name": name, "category": category}


def _download_universe(symbols: list[str], period: str = "2y") -> pd.DataFrame:
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
    generated_at = datetime.now(timezone.utc)

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
            result = _build_signal(symbol=symbol, name=name, category=category, frame=frame, config=config, end=generated_at.date())
            results.append(result)
            if result["status"] == "ok":
                all_results.append(result)
        grouped_results[category] = results

    # Compare normalized directional balance, with event count and recency exposed.
    def leaders(direction: str) -> list[dict[str, Any]]:
        return sorted(
            [item for item in all_results if item["pressure"] == direction],
            key=lambda item: (abs(item["pressure_balance_pct"]), item["event_count"]), reverse=True,
        )[:10]

    return {
        "as_of": generated_at.isoformat(),
        "method": {
            **price_volume_method(),
            "thresholds": {"volume_z_min": config.z_threshold, "rolling_window_bars": config.rolling_window, "lookback_calendar_days": config.lookback_days},
            "window_start": (generated_at.date() - timedelta(days=config.lookback_days - 1)).isoformat(),
            "window_end": generated_at.date().isoformat(),
        },
        "groups": grouped_results,
        "leaders": {"positive": leaders("positive"), "negative": leaders("negative")},
        "stock_selection": {
            "mode": stock_selection_mode, "symbols": selected_stock_symbols,
            "count": len(selected_stock_symbols), "candidate_count": len(stock_selection_pool),
            "note": "Selected by latest close × volume from a fixed candidate basket; not a market-wide ranking.",
        },
    }
