from __future__ import annotations

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

    def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
        period = "1y" if days <= 365 else "2y" if days <= 730 else "5y"
        return yf.Ticker(symbol).history(period=period).tail(days)

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
        return OptionChainFrame(
            symbol=symbol.upper(),
            expiry=iso_expiry,
            calls=calls,
            puts=puts,
            source=self.name,
        )
