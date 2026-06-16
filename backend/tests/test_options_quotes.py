import pandas as pd
import pytest

from app.services.options_quotes import option_premium_from_row, option_quote_from_row, select_optimal_contract
from tests.fake_market_data import FakeProvider


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


def test_select_optimal_contract_keeps_time_after_hold() -> None:
    provider = FakeProvider()
    selected = select_optimal_contract(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        contract_side="CALL",
        hold_days=28,
        target_move_pct=8.0,
        stop_move_pct=4.0,
        fallback_iv_pct=30.0,
        min_dte=30,
        max_dte=90,
    )

    assert selected is not None
    assert selected["expiry"] == provider.far_expiry
    assert selected["remaining_dte_after_hold"] >= 14
    assert selected["selection"] == "optimized_30_90_dte"
    assert selected["target_option_price"] > selected["premium"]
    assert selected["max_profit_definition"] == "convexity_harvest_probability_hump"
    assert selected["convexity_exit_option_price"] > selected["premium"]
    assert selected["max_profit"] == selected["convexity_profit"]
