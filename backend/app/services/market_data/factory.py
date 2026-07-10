from __future__ import annotations

import logging
import os
import time
from typing import Optional, Sequence

import pandas as pd

from app.services.market_data.ibkr_cli_provider import IbkrCliProvider
from app.services.market_data.provider import MarketDataProvider, OptionChainFrame, OptionRight, UnderlyingQuote
from app.services.market_data.yahoo_provider import YahooProvider

logger = logging.getLogger(__name__)


class FallbackMarketDataProvider:
    def __init__(self, primary: MarketDataProvider, fallback: MarketDataProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = getattr(primary, "name", "primary")
        self._primary_disabled_until = 0.0
        self._primary_cooldown_seconds = float(os.getenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60"))
        self._primary_slow_seconds = float(os.getenv("MARKET_DATA_PRIMARY_SLOW_SECONDS", "5"))

    def _primary_available(self) -> bool:
        return time.monotonic() >= self._primary_disabled_until

    def _disable_primary(self, method: str, reason: str, exc: Exception | None = None) -> None:
        if self._primary_cooldown_seconds <= 0:
            return
        self._primary_disabled_until = time.monotonic() + self._primary_cooldown_seconds
        logger.warning(
            "market_data_primary_disabled",
            extra={
                "primary": getattr(self.primary, "name", "primary"),
                "fallback": getattr(self.fallback, "name", "fallback"),
                "method": method,
                "reason": reason,
                "cooldown_seconds": self._primary_cooldown_seconds,
                "error": str(exc) if exc else None,
            },
        )

    def _call(self, method: str, *args, **kwargs):
        if not self._primary_available():
            return getattr(self.fallback, method)(*args, **kwargs)

        started = time.monotonic()
        try:
            result = getattr(self.primary, method)(*args, **kwargs)
        except Exception as exc:
            self._disable_primary(method, "exception", exc)
            return getattr(self.fallback, method)(*args, **kwargs)

        elapsed = time.monotonic() - started
        if self._primary_slow_seconds > 0 and elapsed > self._primary_slow_seconds:
            self._disable_primary(method, f"slow_{elapsed:.2f}s")
        return result

    def quote(self, symbol: str) -> UnderlyingQuote:
        return self._call("quote", symbol)

    def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
        return self._call("daily_bars", symbol, days=days)

    def option_expirations(self, symbol: str) -> list[str]:
        return self._call("option_expirations", symbol)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        return self._call("option_strikes", symbol, expiry)

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        return self._call("option_chain", symbol, expiry, right=right, strikes=strikes)


def get_market_data_provider(provider_override: Optional[str] = None) -> MarketDataProvider:
    provider = (provider_override or os.getenv("MARKET_DATA_PROVIDER", "yahoo")).strip().lower()
    if provider == "ibkr":
        primary: MarketDataProvider = IbkrCliProvider()
        fallback = os.getenv("MARKET_DATA_FALLBACK_PROVIDER", "").strip().lower()
        if fallback == "yahoo":
            return FallbackMarketDataProvider(primary, YahooProvider())
        return primary
    if provider == "yahoo":
        return YahooProvider()
    raise ValueError(f"Unsupported MARKET_DATA_PROVIDER={provider!r}")
