from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence

import pandas as pd
import yfinance as yf

from app.services.market_data.date_utils import expiry_to_iso, parse_option_expiry
from app.services.market_data.provider import OptionChainFrame, OptionRight, UnderlyingQuote


class YahooProvider:
    name = "yahoo"

    def quote(self, symbol: str) -> UnderlyingQuote:
        stock = yf.Ticker(symbol)
        history = stock.history(period="5d")
        close = (
            history["Close"].dropna()
            if history is not None and not history.empty and "Close" in history.columns
            else pd.Series(dtype=float)
        )
        last = float(close.iloc[-1]) if not close.empty else None
        previous = float(close.iloc[-2]) if len(close) >= 2 else last
        return UnderlyingQuote(symbol=symbol.upper(), last=last, close=previous, source=self.name)

    def daily_bars(
        self,
        symbol: str,
        days: int = 365,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        period = "1y" if days <= 365 else "2y" if days <= 730 else "5y"
        return yf.Ticker(symbol).history(period=period, auto_adjust=True).tail(days)

    def historical_bars(
        self,
        symbol: str,
        timeframe: str,
        bars: int = 500,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        canonical = _canonical_timeframe(timeframe)
        requested_bars = max(1, int(bars))
        interval, period = _yahoo_history_request(canonical, requested_bars)
        frame = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=True)
        if frame is None or frame.empty:
            return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        if canonical in {"2h", "4h"}:
            frame = _resample_session_bars(frame, 2 if canonical == "2h" else 4)
        return frame.tail(requested_bars)

    def option_expirations(self, symbol: str) -> list[str]:
        expiries = yf.Ticker(symbol).options or []
        parsed = [parse_option_expiry(exp) for exp in expiries]
        return sorted(exp.isoformat() for exp in parsed if exp is not None)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        chain = yf.Ticker(symbol).option_chain(expiry_to_iso(expiry))
        values: set[float] = set()
        for frame in (chain.calls, chain.puts):
            if frame is not None and not frame.empty and "strike" in frame.columns:
                values.update(float(value) for value in frame["strike"].dropna().tolist())
        return sorted(values)

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        iso_expiry = expiry_to_iso(expiry)
        chain = yf.Ticker(symbol).option_chain(iso_expiry)
        calls = chain.calls.copy() if chain.calls is not None else pd.DataFrame()
        puts = chain.puts.copy() if chain.puts is not None else pd.DataFrame()
        if strikes is not None:
            strike_set = {float(s) for s in strikes}
            if not calls.empty and "strike" in calls.columns:
                calls = calls[calls["strike"].astype(float).isin(strike_set)].copy()
            if not puts.empty and "strike" in puts.columns:
                puts = puts[puts["strike"].astype(float).isin(strike_set)].copy()
        if right == "CALL":
            puts = pd.DataFrame()
        elif right == "PUT":
            calls = pd.DataFrame()
        retrieved_at = datetime.now(timezone.utc).isoformat()
        return OptionChainFrame(
            symbol=symbol.upper(),
            expiry=iso_expiry,
            calls=calls,
            puts=puts,
            source=self.name,
            quote_source=self.name,
            # Yahoo does not expose a chain-level bid/ask observation timestamp.
            observed_at=None,
            retrieved_at=retrieved_at,
        )


def _canonical_timeframe(timeframe: str) -> str:
    aliases = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "60m": "1h",
        "2h": "2h",
        "4h": "4h",
        "1d": "1D",
        "1w": "1W",
        "1wk": "1W",
    }
    normalized = str(timeframe).strip().lower()
    if normalized not in aliases:
        raise ValueError(f"Unsupported historical timeframe: {timeframe}")
    return aliases[normalized]


def _yahoo_history_request(timeframe: str, bars: int) -> tuple[str, str]:
    if timeframe == "1m":
        return "1m", "5d"
    if timeframe in {"5m", "15m", "30m"}:
        return timeframe, "60d"
    if timeframe in {"1h", "2h", "4h"}:
        return "60m", "2y"
    if timeframe == "1D":
        period = "1y" if bars <= 252 else "2y" if bars <= 504 else "5y" if bars <= 1260 else "10y"
        return "1d", period
    period = "2y" if bars <= 104 else "5y" if bars <= 260 else "10y"
    return "1wk", period


def _resample_session_bars(frame: pd.DataFrame, group_size: int) -> pd.DataFrame:
    """Build 2h/4h bars without allowing an overnight gap into a bucket."""
    if frame is None or frame.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    working = frame.copy()
    if working.index.tz is None:
        working.index = working.index.tz_localize("America/New_York")
    else:
        working.index = working.index.tz_convert("America/New_York")
    working = working.between_time("09:30", "15:59")
    pieces: list[pd.DataFrame] = []
    for session_date, session_frame in working.groupby(working.index.date, sort=True):
        session_frame = session_frame.sort_index()
        session_open = pd.Timestamp(session_date, tz="America/New_York") + pd.Timedelta(hours=9, minutes=30)
        bucket = pd.Series(
            ((session_frame.index - session_open).total_seconds() // (group_size * 60 * 60)).astype(int),
            index=session_frame.index,
        )
        aggregated = session_frame.groupby(bucket).agg(
            Open=("Open", "first"),
            High=("High", "max"),
            Low=("Low", "min"),
            Close=("Close", "last"),
            Volume=("Volume", "sum"),
        )
        aggregated.index = pd.DatetimeIndex(
            [session_open + pd.Timedelta(hours=group_size * int(bucket_id)) for bucket_id in aggregated.index]
        )
        pieces.append(aggregated)
    if not pieces:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    return pd.concat(pieces).sort_index()
