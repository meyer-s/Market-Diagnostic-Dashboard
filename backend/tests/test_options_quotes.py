import pandas as pd
import pytest

from app.services.options_quotes import option_premium_from_row, option_quote_from_row


def test_option_quote_prefers_bid_ask_mid() -> None:
    row = pd.Series(
        {
            "bid": 1.2,
            "ask": 1.4,
            "lastPrice": 1.9,
            "volume": 12,
            "openInterest": 345,
            "impliedVolatility": 0.42,
            "lastTradeDate": pd.Timestamp("2026-06-01T15:30:00Z"),
        }
    )

    quote = option_quote_from_row(row)

    assert quote["premium"] == pytest.approx(1.3)
    assert quote["mid"] == pytest.approx(1.3)
    assert quote["price_source"] == "mid"
    assert quote["quality"] == "mid"
    assert quote["volume"] == 12
    assert quote["open_interest"] == 345
    assert option_premium_from_row(row) == pytest.approx(1.3)


def test_option_quote_falls_back_to_last_price() -> None:
    row = pd.Series({"bid": 0.0, "ask": 0.0, "lastPrice": 2.15})

    quote = option_quote_from_row(row)

    assert quote["premium"] == 2.15
    assert quote["price_source"] == "last"
    assert quote["quality"] == "last"


def test_option_quote_flags_wide_spreads() -> None:
    row = pd.Series({"bid": 1.0, "ask": 2.0, "lastPrice": 1.5})

    quote = option_quote_from_row(row)

    assert quote["premium"] == 1.5
    assert quote["spread_pct"] > 25
    assert quote["quality"] == "wide"
