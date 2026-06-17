from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime

import pandas as pd

from app.services import market_data_capture
from app.services.market_data.provider import OptionChainFrame, UnderlyingQuote


class _FakeDb:
    def __init__(self) -> None:
        self.added = []
        self.commits = 0

    def add(self, row) -> None:  # noqa: ANN001
        self.added.append(row)

    def commit(self) -> None:
        self.commits += 1


def test_record_underlying_quote_writes_pending_observation(monkeypatch) -> None:
    fake_db = _FakeDb()

    @contextmanager
    def fake_session():
        yield fake_db

    monkeypatch.setenv("MARKET_DATA_CAPTURE_ENABLED", "true")
    monkeypatch.setattr(market_data_capture, "get_db_session", fake_session)

    quote = UnderlyingQuote(
        symbol="SPY",
        last=500.0,
        bid=499.9,
        ask=500.1,
        close=498.0,
        source="ibkr",
        quote_source="delayed",
        observed_at="2026-06-17T14:30:00",
    )

    assert market_data_capture.record_underlying_quote(quote, raw_payload={"last": 500.0})

    assert fake_db.commits == 1
    row = fake_db.added[0]
    assert row.provider == "ibkr"
    assert row.data_type == "underlying_quote"
    assert row.symbol == "SPY"
    assert row.quote_source == "delayed"
    assert row.process_status == "pending"
    assert row.payload["quote"]["last"] == 500.0
    assert row.payload["raw"]["last"] == 500.0


def test_record_option_chain_serializes_rows_and_replaces_nan(monkeypatch) -> None:
    fake_db = _FakeDb()

    @contextmanager
    def fake_session():
        yield fake_db

    monkeypatch.setenv("MARKET_DATA_CAPTURE_ENABLED", "true")
    monkeypatch.setattr(market_data_capture, "get_db_session", fake_session)

    chain = OptionChainFrame(
        symbol="SPY",
        expiry="2026-07-17",
        calls=pd.DataFrame(
            [
                {
                    "strike": 500.0,
                    "bid": 2.1,
                    "ask": float("nan"),
                    "quoteSource": "delayed",
                }
            ]
        ),
        puts=pd.DataFrame(),
        source="ibkr",
        quote_source="delayed",
    )

    assert market_data_capture.record_option_chain(provider="ibkr", chain=chain, right="CALL", strikes=[500.0])

    row = fake_db.added[0]
    assert row.data_type == "option_chain"
    assert row.expiry == "2026-07-17"
    assert row.right == "CALL"
    assert row.row_count == 1
    assert row.payload["calls"][0]["ask"] is None
    assert row.payload["requested_strikes"] == [500.0]


def test_daily_bars_frame_from_payload_round_trips_timestamped_records() -> None:
    payload = {
        "bars": [
            {
                "timestamp": datetime(2026, 6, 16).isoformat(),
                "Open": 10.0,
                "High": 11.0,
                "Low": 9.5,
                "Close": 10.5,
                "Volume": 1000.0,
            }
        ]
    }

    frame = market_data_capture._daily_bars_frame_from_payload(payload)

    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert frame.index[0] == pd.Timestamp("2026-06-16")
    assert frame.iloc[0]["Close"] == 10.5
