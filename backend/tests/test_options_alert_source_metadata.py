from app.services.options_alerts import _format_alert_message
from tests.fake_market_data import FakeProvider


def test_alert_message_includes_scan_and_contract_sources() -> None:
    provider = FakeProvider()
    selected_contract = {
        "expiry": provider.near_expiry,
        "dte": 46,
        "strike": 100.0,
        "side": "CALL",
        "premium": 2.1,
        "price_source": "mid",
        "bid": 2.0,
        "ask": 2.2,
        "spread_pct": 9.5,
        "volume": 100,
        "open_interest": 1000,
        "implied_volatility": 0.35,
        "data_source": "ibkr",
        "quote_source": "delayed",
        "convexity_exit_option_price": 3.25,
        "convexity_exit_underlying": 104.0,
        "convexity_profit": 115.0,
        "convexity_profit_pct": 55.0,
        "convexity_probability_itm": 0.58,
        "convexity_delta": 0.52,
        "convexity_theta_daily_pct": 1.2,
        "target_option_price": 3.0,
        "stop_option_price": 1.4,
        "planned_loss": 70.0,
        "planned_loss_pct": 33.0,
        "reward_risk": 1.6,
    }

    message = _format_alert_message(
        "S&P 500",
        "FAKE",
        12.0,
        25.0,
        30.0,
        40.0,
        "CHEAP",
        ["CHEAP:IV_PCTL"],
        "Low IV percentile",
        "calls",
        "Trend favors calls",
        20.0,
        horizon_returns={"1m": 1.0, "3m": 2.0, "6m": 3.0, "1y": 4.0},
        history=provider.daily_bars("FAKE", days=365),
        provider=provider,
        selected_contract=selected_contract,
        options_data_source="ibkr_option_chain",
        options_quote_source="delayed",
    )

    assert "Data Src  : ibkr_option_chain / delayed" in message
    assert "Data Src  : ibkr / delayed" in message
    assert "Review Window:" in message
    assert "OPPORTUNITY RANK" in message
    assert "Score     :" in message
