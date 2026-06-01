from datetime import date, timedelta

import pandas as pd
import pytest

from app.services.options_quotes import option_premium_from_row, option_quote_from_row, select_optimal_contract


class _Chain:
    def __init__(self, calls: pd.DataFrame, puts: pd.DataFrame | None = None) -> None:
        self.calls = calls
        self.puts = puts if puts is not None else pd.DataFrame()


class _FakeTicker:
    def __init__(self) -> None:
        today = date.today()
        self.near_expiry = (today + timedelta(days=46)).isoformat()
        self.far_expiry = (today + timedelta(days=81)).isoformat()
        self.options = [self.near_expiry, self.far_expiry]

    def option_chain(self, expiry: str) -> _Chain:
        rows = {
            self.near_expiry: [
                {
                    "strike": 105.0,
                    "bid": 4.8,
                    "ask": 5.2,
                    "lastPrice": 5.0,
                    "volume": 50,
                    "openInterest": 500,
                    "impliedVolatility": 0.30,
                }
            ],
            self.far_expiry: [
                {
                    "strike": 105.0,
                    "bid": 5.3,
                    "ask": 5.7,
                    "lastPrice": 5.5,
                    "volume": 40,
                    "openInterest": 600,
                    "impliedVolatility": 0.30,
                }
            ],
        }
        return _Chain(pd.DataFrame(rows[expiry]))


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
    stock = _FakeTicker()
    selected = select_optimal_contract(
        stock=stock,
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
    assert selected["expiry"] == stock.far_expiry
    assert selected["remaining_dte_after_hold"] >= 14
    assert selected["selection"] == "optimized_30_90_dte"
    assert selected["target_option_price"] > selected["premium"]
