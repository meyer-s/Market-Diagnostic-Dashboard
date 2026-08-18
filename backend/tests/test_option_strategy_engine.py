from __future__ import annotations

import pytest

from app.services.option_strategy_engine import (
    STRATEGY_MODEL_VERSION,
    build_risk_defined_strategy,
)
from tests.fake_market_data import FakeProvider


def test_directional_scan_builds_defined_risk_debit_spread() -> None:
    provider = FakeProvider()

    plan = build_risk_defined_strategy(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        direction="Calls",
        hold_days=14,
        expected_move_pct=6.0,
        iv30=24.0,
        hv30=30.0,
        selected_contract={
            "expiry": provider.far_expiry,
            "dte": 81,
            "strike": 100.0,
            "side": "CALL",
        },
    )

    assert plan is not None
    assert plan["model_version"] == STRATEGY_MODEL_VERSION
    primary = plan["primary"]
    assert primary["strategy_type"] == "call_debit_spread"
    assert primary["risk_defined"] is True
    assert primary["status"] == "actionable"
    assert primary["max_loss"] == pytest.approx(20.0)
    assert primary["max_profit"] == pytest.approx(480.0)
    assert primary["breakevens"] == [100.2]
    assert [leg["action"] for leg in primary["legs"]] == ["buy", "sell"]
    assert primary["greeks"]["vega"] > 0
    assert any(item["strategy_type"] == "long_call_butterfly" for item in plan["alternatives"])


def test_neutral_scan_builds_bidirectional_long_vol_structure() -> None:
    provider = FakeProvider()

    plan = build_risk_defined_strategy(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        direction="Neutral",
        hold_days=14,
        expected_move_pct=6.0,
        iv30=20.0,
        hv30=30.0,
    )

    assert plan is not None
    primary = plan["primary"]
    assert primary["strategy_type"] == "long_strangle"
    assert primary["direction"] == "bidirectional"
    assert primary["volatility_exposure"] == "long_vol"
    assert primary["max_loss"] == pytest.approx(440.0)
    assert primary["max_profit"] is None
    assert primary["max_profit_label"] == "Unlimited"
    assert len(primary["breakevens"]) == 2
    assert primary["greeks"]["vega"] > 0
    assert any(item["strategy_type"] == "long_straddle" for item in plan["alternatives"])
    assert plan["excluded_structures"][0]["label"] == "Credit spreads and iron condors"


class WideQuoteProvider(FakeProvider):
    def option_chain(self, *args, **kwargs):  # noqa: ANN002, ANN003
        chain = super().option_chain(*args, **kwargs)
        for frame in (chain.calls, chain.puts):
            frame.loc[:, "bid"] = 1.0
            frame.loc[:, "ask"] = 2.0
        return chain


def test_wide_leg_quotes_require_manual_price_discovery() -> None:
    provider = WideQuoteProvider()

    plan = build_risk_defined_strategy(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        direction="Neutral",
        hold_days=14,
        expected_move_pct=3.0,
        iv30=28.0,
        hv30=30.0,
    )

    assert plan is not None
    assert plan["primary"]["status"] == "manual_price_discovery"
    assert plan["primary"]["quote_issues"]
