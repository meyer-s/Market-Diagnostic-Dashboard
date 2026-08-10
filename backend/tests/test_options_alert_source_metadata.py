from types import SimpleNamespace

from app.services.options_alerts import (
    _compute_option_bias,
    _format_alert_message,
    _passes_scanner_iv_hv_threshold,
    _scanner_iv_hv_ratio,
    _scanner_iv_percentile,
    _should_trigger,
)
from tests.fake_market_data import FakeProvider


def test_watch_admission_uses_canonical_percentile_without_consensus_veto() -> None:
    percentile = _scanner_iv_percentile(
        {
            "iv30_chain_percentile": 12.0,
            "iv_percentile": None,
        }
    )
    bias, _votes = _compute_option_bias(31.0, 24.0, percentile, 65.0)
    watch = SimpleNamespace(active=True, iv_percentile_max=20.0)

    assert percentile == 12.0
    assert bias == "EXPENSIVE"
    assert _should_trigger(watch, percentile) is True


def test_watch_admission_rejects_missing_above_threshold_or_inactive_inputs() -> None:
    watch = SimpleNamespace(active=True, iv_percentile_max=20.0)

    assert _should_trigger(watch, None) is False
    assert _should_trigger(watch, 20.1) is False
    assert _should_trigger(SimpleNamespace(active=False, iv_percentile_max=20.0), 12.0) is False


def test_scanner_admission_uses_only_the_iv_hv_ratio() -> None:
    percentile = 90.0
    bias, _votes = _compute_option_bias(23.0, 24.0, percentile, 65.0)

    assert bias == "EXPENSIVE"
    assert _scanner_iv_hv_ratio(23.0, 24.0) == 95.8
    assert _passes_scanner_iv_hv_threshold(23.0, 24.0, 100.0) is True
    assert _passes_scanner_iv_hv_threshold(23.0, 24.0, 95.0) is False
    assert _passes_scanner_iv_hv_threshold(23.0, None, 100.0) is False


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
