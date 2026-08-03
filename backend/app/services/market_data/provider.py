from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Protocol, Sequence

import pandas as pd

OptionRight = Literal["CALL", "PUT", "ALL"]


@dataclass(frozen=True)
class UnderlyingQuote:
    symbol: str
    last: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    close: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    volume: Optional[float] = None
    source: str = "unknown"
    quote_source: Optional[str] = None
    observed_at: Optional[str] = None

    @property
    def mid(self) -> Optional[float]:
        if self.bid and self.ask and self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2.0
        return None

    @property
    def price(self) -> Optional[float]:
        return self.last or self.mid or self.close


@dataclass(frozen=True)
class OptionChainFrame:
    symbol: str
    expiry: str
    calls: pd.DataFrame
    puts: pd.DataFrame
    source: str
    quote_source: Optional[str] = None
    # Snapshot-level quote timing. This is intentionally distinct from an
    # individual contract's last trade timestamp.
    observed_at: Optional[str] = None
    retrieved_at: Optional[str] = None


class MarketDataProvider(Protocol):
    name: str

    def quote(self, symbol: str) -> UnderlyingQuote:
        ...

    def daily_bars(
        self,
        symbol: str,
        days: int = 365,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        ...

    def historical_bars(
        self,
        symbol: str,
        timeframe: str,
        bars: int = 500,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        """Return OHLCV history at a canonical market-weather timeframe."""
        ...

    def option_expirations(self, symbol: str) -> list[str]:
        """Return ISO dates: YYYY-MM-DD."""
        ...

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        """`expiry` is ISO YYYY-MM-DD."""
        ...

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        """Return normalized calls/puts frames using the internal option schema."""
        ...
