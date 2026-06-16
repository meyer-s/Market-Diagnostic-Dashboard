import pandas as pd
import pytest

from app.services.market_data.date_utils import expiry_to_ibkr, expiry_to_iso, parse_option_expiry
from app.services.market_data.ibkr_cli_provider import _ibkr_option_rows_to_frames
from app.services.options_quotes import option_quote_from_row


def test_parse_option_expiry_accepts_iso_and_ibkr_dates() -> None:
    assert parse_option_expiry("2026-03-20").isoformat() == "2026-03-20"
    assert parse_option_expiry("20260320").isoformat() == "2026-03-20"
    assert expiry_to_ibkr("2026-03-20") == "20260320"
    assert expiry_to_iso("20260320") == "2026-03-20"


def test_ibkr_rows_normalize_to_internal_option_columns() -> None:
    calls, puts = _ibkr_option_rows_to_frames(
        [
            {
                "local_symbol": "AAPL  260320C00150000",
                "con_id": 123,
                "strike": 150,
                "right": "C",
                "bid": 1.2,
                "ask": 1.4,
                "last": 1.35,
                "volume": 12,
                "open_interest": 345,
                "implied_vol": 0.42,
                "delta": 0.51,
            },
            {
                "local_symbol": "AAPL  260320P00150000",
                "con_id": 124,
                "strike": 150,
                "right": "P",
                "bid": 1.1,
                "ask": 1.3,
                "last": 1.2,
                "volume": 10,
                "open_interest": 300,
                "implied_vol": 0.44,
            },
        ]
    )

    assert list(calls["contractSymbol"]) == ["AAPL  260320C00150000"]
    assert list(puts["right"]) == ["PUT"]
    row = calls.iloc[0]
    assert row["lastPrice"] == pytest.approx(1.35)
    assert row["openInterest"] == 345
    assert row["impliedVolatility"] == pytest.approx(0.42)
    assert row["ibkrConId"] == 123


def test_option_quote_from_normalized_ibkr_row_prefers_mid() -> None:
    row = pd.Series(
        {
            "bid": 1.2,
            "ask": 1.4,
            "lastPrice": 1.35,
            "volume": 12,
            "openInterest": 345,
            "impliedVolatility": 0.42,
            "quoteSource": "delayed",
        }
    )

    quote = option_quote_from_row(row)

    assert quote["premium"] == pytest.approx(1.3)
    assert quote["price_source"] == "mid"
    assert quote["quote_source"] == "delayed"
