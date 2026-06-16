from app.services.options_quotes import select_atm_contract, select_optimal_contract
from tests.fake_market_data import FakeProvider


def test_select_atm_contract_works_with_provider() -> None:
    provider = FakeProvider()

    selected = select_atm_contract(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        contract_side="CALL",
        target_dte=45,
        min_remaining_after_hold=10,
    )

    assert selected is not None
    assert selected["data_source"] == "fake"
    assert selected["quote_source"] == "fake"
    assert selected["premium"] == 2.1
    assert selected["strike"] == 100.0


def test_select_optimal_contract_preserves_scoring_fields() -> None:
    provider = FakeProvider()

    selected = select_optimal_contract(
        provider=provider,
        symbol="FAKE",
        current_price=100.0,
        contract_side="CALL",
        hold_days=14,
        target_move_pct=6.0,
        stop_move_pct=3.0,
        fallback_iv_pct=35.0,
        fallback_hv_pct=20.0,
    )

    assert selected is not None
    assert selected["selection"] == "optimized_30_90_dte"
    assert selected["score"] > 0
    assert selected["target_option_price"] > 0
    assert selected["reward_risk"] >= 0
    assert selected["data_source"] == "fake"
