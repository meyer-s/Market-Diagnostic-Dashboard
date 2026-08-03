from __future__ import annotations

from datetime import date, timedelta
from typing import Optional, Sequence

import pandas as pd

from app.services.market_data.provider import OptionChainFrame, OptionRight, UnderlyingQuote


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        today = date.today()
        self.near_expiry = (today + timedelta(days=30)).isoformat()
        self.far_expiry = (today + timedelta(days=81)).isoformat()
        self.expiries = [self.near_expiry, self.far_expiry]
        self.strikes = [90.0, 95.0, 100.0, 105.0, 110.0]

    def quote(self, symbol: str) -> UnderlyingQuote:
        return UnderlyingQuote(symbol=symbol.upper(), last=100.0, close=99.0, source=self.name)

    def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
        idx = pd.date_range("2025-01-01", periods=days, freq="B")
        close = pd.Series(100.0, index=idx)
        return pd.DataFrame(
            {
                "Open": close,
                "High": close + 1,
                "Low": close - 1,
                "Close": close,
                "Volume": 1_000_000,
            },
            index=idx,
        )

    def option_expirations(self, symbol: str) -> list[str]:
        return list(self.expiries)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        return list(self.strikes)

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        strike_values = list(strikes) if strikes is not None else self.option_strikes(symbol, expiry)

        def frame(side: str) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {
                        "contractSymbol": f"{symbol}-{expiry}-{side}-{strike}",
                        "strike": float(strike),
                        "bid": 2.0,
                        "ask": 2.2,
                        "lastPrice": 2.1,
                        "volume": 100,
                        "openInterest": 1000,
                        "impliedVolatility": 0.35,
                        "lastTradeDate": pd.Timestamp.now(tz="UTC"),
                        "right": side,
                        "quoteSource": self.name,
                    }
                    for strike in strike_values
                ]
            )

        calls = frame("CALL") if right in ("ALL", "CALL") else pd.DataFrame()
        puts = frame("PUT") if right in ("ALL", "PUT") else pd.DataFrame()
        observed_at = pd.Timestamp.now(tz="UTC").isoformat()
        return OptionChainFrame(
            symbol=symbol.upper(),
            expiry=expiry,
            calls=calls,
            puts=puts,
            source=self.name,
            quote_source=self.name,
            observed_at=observed_at,
            retrieved_at=observed_at,
        )
