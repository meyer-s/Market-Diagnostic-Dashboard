from datetime import date, datetime, timezone
from types import SimpleNamespace as NS

from app.services.option_exit_plans import build_exit_plan_queue


NOW = datetime(2026, 11, 20, 15, tzinfo=timezone.utc)


def position(**overrides):
    fields = dict(id=1, account="Account A", symbol="XYZ", expiration=date(2027, 1, 15), strike=100.0,
                  option_type="call", contracts=3, trade_date=date(2026, 11, 18), fill_price=2.1,
                  total_cost=632.0, action="BUY_TO_OPEN", strategy_type="single_leg",
                  source_event_id=11, source_match_method="contract_leg+entry_date")
    return NS(**(fields | overrides))


def event(**overrides):
    message = "\x1b[1;37mEXAMPLE TRADE (TRAINING)\x1b[0m\n  Contract : 2027-01-15 100.00 CALL\n  Hump Exit : opt $3.50 (+75%) @ und $110.00\n  Base Tgt : opt $4.00 @ und $115.00\n  Risk Cut : opt $1.20 (-40%) @ und $95.00\n  Stop/Tgt : 95.00 / 115.00\n"
    return NS(**(dict(id=11, symbol="XYZ", selected_expiry="2027-01-15", selected_strike=100.0,
                     selected_option_type="call", selected_premium=2.0, message=message,
                     triggered_at=datetime(2026, 11, 18, 14), selected_strategy_type="call_debit_spread") | overrides))


def queue(p=None, e=None, metrics=None, **kwargs):
    return build_exit_plan_queue([p or position()], {11: e or event()}, {1: metrics or {}}, now=NOW, **kwargs)


def test_uses_published_option_premiums_not_underlying_prices_or_actual_fill():
    result = queue(metrics={"option_price": 2.2})
    row = result["rows"][0]
    assert row["levels"] == dict(entry_premium=2.0, stop_premium=1.2, target_premium=3.5,
                                 target_basis="Hump Exit", source="saved_scanner_message")
    assert row["actual_fill"] == 2.1
    assert row["contract_symbol"] == "-XYZ270115C100"
    assert row["status"] == "review"
    assert row["broker_order_status"] == "unknown"
    assert result["order_submission_enabled"] is False


def test_wrong_structured_or_printed_contract_never_supplies_exits():
    for e in [event(selected_strike=101), event(selected_option_type="put"),
              event(message=event().message.replace("100.00 CALL", "101.00 CALL"))]:
        row = queue(e=e)["rows"][0]
        assert row["levels"] is None
        assert "differs" in row["reasons"][0]


def test_no_default_level_from_percent_or_underlying_stop():
    e = event(message="Contract : 2027-01-15 100.00 CALL\n Stop/Tgt : 95.00 / 115.00\n")
    assert queue(e=e)["rows"][0]["levels"] is None


def test_breached_stop_does_not_get_rebased_and_missing_mark_is_not_healthy():
    row = queue(metrics={"option_price": .8, "quote": {"last_trade_at": "2026-11-19T20:00:00Z"}})["rows"][0]
    assert row["status"] == "stop_crossed"
    assert row["levels"]["stop_premium"] == 1.2
    missing = queue(metrics={"option_price": float("nan")})["rows"][0]
    assert missing["indicative_mark"] is None
    assert any("No indicative" in x for x in missing["warnings"])


def test_future_source_expired_adjusted_short_and_multileg_are_withheld():
    assert queue(e=event(triggered_at=datetime(2026, 11, 19, 15)))["rows"][0]["levels"] is None
    for p in [position(expiration=date(2026, 11, 19)), position(symbol="XYZ1"),
              position(strategy_type="call_debit_spread"), position(action="SELL_TO_OPEN")]:
        assert queue(p=p)["rows"][0]["levels"] is None


def test_base_target_fallback_and_ambiguous_or_invalid_prices():
    msg = event().message
    row = queue(e=event(message="\n".join(line for line in msg.splitlines() if "Hump Exit" not in line)))["rows"][0]
    assert row["levels"]["target_premium"] == 4
    for bad in [msg + "\nRisk Cut : opt $1.30", msg.replace("$1.20", "$0.00"), msg.replace("$1.20", "$2.10")]:
        assert queue(e=event(message=bad))["rows"][0]["levels"] is None


def test_quantities_do_not_combine_accounts_and_fingerprint_changes_on_partial_close():
    ps = [position(), position(id=2, contracts=2), position(id=3, account="Account B", contracts=8)]
    result = build_exit_plan_queue(ps, {11: event()}, now=NOW)
    rows = {r["position_id"]: r for r in result["rows"]}
    assert rows[1]["contracts"] == 3 and rows[1]["account_contract_quantity"] == 5
    assert rows[3]["account_contract_quantity"] == 8
    assert rows[1]["sibling_lots"] == 2 and rows[3]["sibling_lots"] == 1
    assert queue(p=position(contracts=2))["rows"][0]["fingerprint"] != rows[1]["fingerprint"]


def test_proposed_link_remains_a_candidate_without_mutating_position():
    p = position(source_event_id=None, source_match_method="fidelity_activity")
    result = queue(p=p, proposals={1: dict(source_event_id=11, source_match_method="contract_leg+entry_date")})
    assert result["rows"][0]["source_is_candidate"]
    assert result["rows"][0]["levels"] is not None
    assert p.source_event_id is None and p.source_match_method == "fidelity_activity"
