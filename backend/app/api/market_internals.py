from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Tuple

import pandas as pd
import yfinance as yf
from fastapi import APIRouter

router = APIRouter()

_CACHE_TTL_SECONDS = 300
_cached_payload: dict | None = None
_cached_at: datetime | None = None

NASDAQ_PROXY = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "NFLX", "AMD",
    "CSCO", "ADBE", "PEP", "COST", "TMUS", "INTC", "QCOM", "AMGN", "INTU", "TXN",
]

NYSE_PROXY = [
    "JPM", "BAC", "WFC", "GS", "MS", "XOM", "CVX", "JNJ", "PG", "KO",
    "MCD", "HD", "CAT", "GE", "IBM", "BA", "UNH", "PFE", "VZ", "T",
]


def _extract_close_volume(downloaded: pd.DataFrame) -> Tuple[pd.DataFrame | None, pd.DataFrame | None]:
    if downloaded is None or downloaded.empty:
        return None, None

    if isinstance(downloaded.columns, pd.MultiIndex):
        level0 = downloaded.columns.get_level_values(0)
        level1 = downloaded.columns.get_level_values(1)
        if "Close" in level0 and "Volume" in level0:
            return downloaded["Close"], downloaded["Volume"]
        if "Close" in level1 and "Volume" in level1:
            swapped = downloaded.swaplevel(axis=1)
            return swapped["Close"], swapped["Volume"]
        return None, None

    has_close = "Close" in downloaded.columns
    has_volume = "Volume" in downloaded.columns
    if not has_close or not has_volume:
        return None, None

    close = pd.DataFrame({"SINGLE": downloaded["Close"]})
    volume = pd.DataFrame({"SINGLE": downloaded["Volume"]})
    return close, volume


def _compute_bucket(symbols: List[str], label: str) -> Dict[str, object]:
    tickers = " ".join(symbols)
    data = yf.download(
        tickers=tickers,
        period="1y",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="column",
    )

    close_frame, volume_frame = _extract_close_volume(data)
    if close_frame is None or volume_frame is None:
        return {
            "label": label,
            "advancing": 0,
            "declining": 0,
            "advancing_pct": 0.0,
            "declining_pct": 0.0,
            "volume_advancing": 0.0,
            "volume_declining": 0.0,
            "volume_advancing_pct": 0.0,
            "volume_declining_pct": 0.0,
            "new_highs": 0,
            "new_lows": 0,
            "new_highs_pct": 0.0,
            "new_lows_pct": 0.0,
            "universe_size": len(symbols),
        }

    advancing = 0
    declining = 0
    volume_adv = 0.0
    volume_dec = 0.0
    new_highs = 0
    new_lows = 0

    def _get_series(frame: pd.DataFrame, symbol: str) -> pd.Series:
        if symbol in frame.columns:
            return frame[symbol]
        if "SINGLE" in frame.columns and len(symbols) == 1:
            return frame["SINGLE"]
        return pd.Series(dtype=float)

    for symbol in symbols:
        close_series = _get_series(close_frame, symbol).dropna()
        volume_series = _get_series(volume_frame, symbol).dropna()
        if len(close_series) < 3:
            continue

        current = float(close_series.iloc[-1])
        previous = float(close_series.iloc[-2])
        latest_volume = float(volume_series.iloc[-1]) if len(volume_series) else 0.0

        if current > previous:
            advancing += 1
            volume_adv += max(latest_volume, 0.0)
        elif current < previous:
            declining += 1
            volume_dec += max(latest_volume, 0.0)

        lookback = close_series.tail(252)
        if len(lookback) >= 20:
            max_52w = float(lookback.max())
            min_52w = float(lookback.min())
            if current >= max_52w * 0.999:
                new_highs += 1
            if current <= min_52w * 1.001:
                new_lows += 1

    active = max(advancing + declining, 1)
    volume_total = max(volume_adv + volume_dec, 1.0)
    hl_total = max(new_highs + new_lows, 1)

    return {
        "label": label,
        "advancing": advancing,
        "declining": declining,
        "advancing_pct": (advancing / active) * 100.0,
        "declining_pct": (declining / active) * 100.0,
        "volume_advancing": volume_adv,
        "volume_declining": volume_dec,
        "volume_advancing_pct": (volume_adv / volume_total) * 100.0,
        "volume_declining_pct": (volume_dec / volume_total) * 100.0,
        "new_highs": new_highs,
        "new_lows": new_lows,
        "new_highs_pct": (new_highs / hl_total) * 100.0,
        "new_lows_pct": (new_lows / hl_total) * 100.0,
        "universe_size": len(symbols),
    }


@router.get("/market-internals/overview")
def get_market_internals_overview() -> Dict[str, object]:
    global _cached_payload, _cached_at

    now = datetime.utcnow()
    if _cached_payload and _cached_at and (now - _cached_at).total_seconds() < _CACHE_TTL_SECONDS:
        return _cached_payload

    nasdaq = _compute_bucket(NASDAQ_PROXY, "NASDAQ Proxy")
    nyse = _compute_bucket(NYSE_PROXY, "NYSE Proxy")

    combined_adv = nasdaq["advancing"] + nyse["advancing"]
    combined_dec = nasdaq["declining"] + nyse["declining"]
    combined_volume_adv = nasdaq["volume_advancing"] + nyse["volume_advancing"]
    combined_volume_dec = nasdaq["volume_declining"] + nyse["volume_declining"]
    combined_highs = nasdaq["new_highs"] + nyse["new_highs"]
    combined_lows = nasdaq["new_lows"] + nyse["new_lows"]

    breadth_total = max(combined_adv + combined_dec, 1)
    volume_total = max(combined_volume_adv + combined_volume_dec, 1.0)
    hl_total = max(combined_highs + combined_lows, 1)

    payload = {
        "as_of": now.isoformat(),
        "composite": {
            "advancing": combined_adv,
            "declining": combined_dec,
            "advancing_pct": (combined_adv / breadth_total) * 100.0,
            "declining_pct": (combined_dec / breadth_total) * 100.0,
            "volume_advancing": combined_volume_adv,
            "volume_declining": combined_volume_dec,
            "volume_advancing_pct": (combined_volume_adv / volume_total) * 100.0,
            "volume_declining_pct": (combined_volume_dec / volume_total) * 100.0,
            "new_highs": combined_highs,
            "new_lows": combined_lows,
            "new_highs_pct": (combined_highs / hl_total) * 100.0,
            "new_lows_pct": (combined_lows / hl_total) * 100.0,
            "universe_size": len(NASDAQ_PROXY) + len(NYSE_PROXY),
        },
        "exchanges": {
            "nasdaq": nasdaq,
            "nyse": nyse,
        },
    }

    _cached_payload = payload
    _cached_at = now
    return payload
