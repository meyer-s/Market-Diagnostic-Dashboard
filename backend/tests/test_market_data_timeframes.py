from __future__ import annotations

import pandas as pd
import pytest

from app.services.market_data.ibkr_cli_provider import (
    HISTORICAL_BAR_SPECS,
    _canonical_timeframe as canonical_ibkr_timeframe,
    _ibkr_end_before,
)
from app.services.market_data.factory import FallbackMarketDataProvider
from app.services.market_data.yahoo_provider import (
    _canonical_timeframe as canonical_yahoo_timeframe,
    _resample_session_bars,
    _yahoo_history_request,
)


EXPECTED_IBKR_SIZES = {
    "1m": "1 min",
    "5m": "5 mins",
    "15m": "15 mins",
    "30m": "30 mins",
    "1h": "1 hour",
    "2h": "2 hours",
    "4h": "4 hours",
    "1D": "1 day",
    "1W": "1 week",
}


def test_all_market_weather_timeframes_map_to_ibkr_bar_sizes() -> None:
    assert {timeframe: spec[0] for timeframe, spec in HISTORICAL_BAR_SPECS.items()} == EXPECTED_IBKR_SIZES
    for timeframe in EXPECTED_IBKR_SIZES:
        assert canonical_ibkr_timeframe(timeframe) == timeframe
        assert canonical_yahoo_timeframe(timeframe) == timeframe


def test_timeframe_aliases_are_normalized() -> None:
    assert canonical_ibkr_timeframe("60m") == "1h"
    assert canonical_ibkr_timeframe("1wk") == "1W"
    assert canonical_yahoo_timeframe("1d") == "1D"
    with pytest.raises(ValueError, match="Unsupported historical timeframe"):
        canonical_ibkr_timeframe("3m")


def test_ibkr_pagination_end_is_utc_and_strictly_before_prior_bar() -> None:
    timestamp = pd.Timestamp("2026-07-21T14:30:00-04:00")
    assert _ibkr_end_before(timestamp) == "20260721 18:29:59 UTC"


def test_yahoo_uses_hourly_source_bars_for_two_and_four_hour_fields() -> None:
    assert _yahoo_history_request("2h", 250) == ("60m", "2y")
    assert _yahoo_history_request("4h", 250) == ("60m", "2y")


def test_session_resampling_never_mixes_overnight_bars() -> None:
    index = pd.to_datetime(
        [
            "2026-07-20 09:30", "2026-07-20 10:30", "2026-07-20 11:30", "2026-07-20 12:30",
            "2026-07-21 09:30", "2026-07-21 10:30", "2026-07-21 11:30", "2026-07-21 12:30",
        ]
    )
    frame = pd.DataFrame(
        {
            "Open": [100, 101, 102, 103, 110, 111, 112, 113],
            "High": [101, 102, 103, 104, 111, 112, 113, 114],
            "Low": [99, 100, 101, 102, 109, 110, 111, 112],
            "Close": [100.5, 101.5, 102.5, 103.5, 110.5, 111.5, 112.5, 113.5],
            "Volume": [10] * 8,
        },
        index=index,
    )

    result = _resample_session_bars(frame, 4)

    assert len(result) == 2
    assert result.iloc[0]["Open"] == 100
    assert result.iloc[0]["Close"] == 103.5
    assert result.iloc[1]["Open"] == 110
    assert result.iloc[1]["Close"] == 113.5


def test_historical_bar_fallback_reports_the_provider_that_served_data(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60")

    class Primary:
        name = "ibkr"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            raise TimeoutError("gateway unavailable")

    class Fallback:
        name = "yahoo"

        def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
            return pd.DataFrame({"Close": [100.0]})

    provider = FallbackMarketDataProvider(Primary(), Fallback())
    result = provider.historical_bars("SPY", "1m", bars=180)

    assert len(result) == 1
    assert provider.source_for("historical_bars") == "yahoo"
