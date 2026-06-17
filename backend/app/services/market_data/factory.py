from __future__ import annotations

import os
from typing import Optional, Sequence

import pandas as pd

from app.services.market_data.ibkr_cli_provider import IbkrCliProvider
from app.services.market_data.provider import MarketDataProvider, OptionChainFrame, OptionRight, UnderlyingQuote
from app.services.market_data.yahoo_provider import YahooProvider


class FallbackMarketDataProvider:
    def __init__(self, primary: MarketDataProvider, fallback: MarketDataProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = getattr(primary, "name", "primary")

    def quote(self, symbol: str) -> UnderlyingQuote:
        try:
            return self.primary.quote(symbol)
        except Exception:
            return self.fallback.quote(symbol)

    def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
        try:
            return self.primary.daily_bars(symbol, days=days)
        except Exception:
            return self.fallback.daily_bars(symbol, days=days)

    def option_expirations(self, symbol: str) -> list[str]:
        try:
            return self.primary.option_expirations(symbol)
        except Exception:
            return self.fallback.option_expirations(symbol)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        try:
            return self.primary.option_strikes(symbol, expiry)
        except Exception:
            return self.fallback.option_strikes(symbol, expiry)

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        try:
            return self.primary.option_chain(symbol, expiry, right=right, strikes=strikes)
        except Exception:
            return self.fallback.option_chain(symbol, expiry, right=right, strikes=strikes)


def get_market_data_provider() -> MarketDataProvider:
    provider = os.getenv("MARKET_DATA_PROVIDER", "yahoo").strip().lower()
    if provider == "ibkr":
        primary: MarketDataProvider = IbkrCliProvider()
        fallback = os.getenv("MARKET_DATA_FALLBACK_PROVIDER", "").strip().lower()
        if fallback == "yahoo":
            return FallbackMarketDataProvider(primary, YahooProvider())
        return primary
    if provider == "yahoo":
        return YahooProvider()
    raise ValueError(f"Unsupported MARKET_DATA_PROVIDER={provider!r}")
