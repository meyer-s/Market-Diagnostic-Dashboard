from datetime import date, datetime
from types import SimpleNamespace

from app.services.option_replacement_classifier import classify_option_replacement


def _position(*, strike: float = 115.0, option_type: str = "call") -> SimpleNamespace:
    return SimpleNamespace(
        id=7,
        symbol="SJM",
        expiration=date(2026, 9, 18),
        strike=strike,
        option_type=option_type,
        contracts=5,
    )


def _event(
    *,
    strike: float = 120.0,
    expiry: str = "2026-10-16",
    option_type: str = "call",
    spread_pct: float | None = 12.0,
    convexity_profit_pct: float | None = 55.0,
    convexity_probability_itm: float | None = 0.48,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=91,
        triggered_at=datetime(2026, 7, 20, 14, 30),
        selected_expiry=expiry,
        selected_dte=88,
        selected_strike=strike,
        selected_option_type=option_type,
        selected_premium=3.25,
        selected_spread_pct=spread_pct,
        selected_reward_risk=1.15,
        selected_contract_score=2.0,
        selected_convexity_profit_pct=convexity_profit_pct,
        selected_convexity_probability_itm=convexity_probability_itm,
    )


def _assessment(
    *,
    pnl_pct: float,
    score: float,
    spread_pct: float = 12.0,
    contract_status: str = "attractive",
    field_path_state: str | None = None,
) -> dict[str, object]:
    assessment = {
        "company_thesis_status": "watch",
        "path_status": "behind",
        "contract_status": contract_status,
        "input_snapshot": {
            "market": {
                "pnl_percent": pnl_pct,
                "spread_pct": spread_pct,
                "delta": 0.42,
                "theta_per_day_per_contract": -0.06,
            },
            "opportunity": {"current": {"score": score}},
        },
    }
    if field_path_state is not None:
        assessment["input_snapshot"]["field_context"] = {
            "schema_version": "option_market_field_v1",
            "mode": "shadow_only",
            "quality": {"available": True, "status": "complete", "warnings": []},
            "as_of_bar": "2026-07-19T20:00:00Z",
            "classification": {"path_state": field_path_state, "eventfulness": "normal"},
            "direction": {
                "option_aligned_pressure": -0.44 if field_path_state == "contradictory" else 0.44,
                "option_aligned_velocity": -0.21 if field_path_state == "contradictory" else 0.21,
            },
            "hypotheses": {},
        }
    return assessment


def test_losing_up_and_out_is_rejected_as_a_rescue_roll() -> None:
    result = classify_option_replacement(
        position=_position(),
        event=_event(),
        candidate_score=47.0,
        held_baseline_score=37.0,
        repeat_count=3,
        latest_assessment=_assessment(pnl_pct=-27.6, score=41.0, spread_pct=35.3),
        latest_decision={"verdict": "conditional_hold", "target_contracts": 5},
    )

    assert result["status"] == "rejected"
    assert result["recommendation"] == "rescue_roll_rejected"
    assert result["structure"]["label"] == "Up and out"
    assert result["structure"]["directional_hurdle"] == "higher"
    assert result["comparison"]["change"] == {"dte": 28, "strike": 5.0, "score": 6.0}
    assert result["implementation_ready"] is False


def test_winning_up_and_out_can_be_a_partial_convexity_harvest_candidate() -> None:
    result = classify_option_replacement(
        position=_position(),
        event=_event(),
        candidate_score=64.0,
        held_baseline_score=60.0,
        repeat_count=2,
        latest_assessment=_assessment(pnl_pct=32.0, score=65.0),
        latest_decision={"verdict": "hold", "target_contracts": 5},
    )

    assert result["status"] == "candidate"
    assert result["recommendation"] == "convexity_harvest_candidate"
    assert result["action"] == "partial_replace"


def test_later_same_strike_contract_can_qualify_when_current_contract_is_marginal() -> None:
    result = classify_option_replacement(
        position=_position(),
        event=_event(strike=115.0),
        candidate_score=58.0,
        held_baseline_score=40.0,
        repeat_count=2,
        latest_assessment=_assessment(
            pnl_pct=-3.0,
            score=42.0,
            contract_status="marginal",
        ),
        latest_decision={"verdict": "conditional_hold", "target_contracts": 5},
    )

    assert result["status"] == "candidate"
    assert result["recommendation"] == "roll_out_candidate"
    assert result["structure"]["label"] == "Straight out"


def test_opposite_option_direction_is_a_new_thesis_not_a_roll() -> None:
    result = classify_option_replacement(
        position=_position(),
        event=_event(option_type="put"),
        candidate_score=75.0,
        held_baseline_score=40.0,
        repeat_count=4,
        latest_assessment=_assessment(pnl_pct=10.0, score=45.0),
        latest_decision={"verdict": "hold", "target_contracts": 5},
    )

    assert result["status"] == "rejected"
    assert result["recommendation"] == "direction_change"
    assert result["label"] == "Not a roll"


def test_contradictory_underlying_path_is_an_advisory_gate_not_a_standalone_rejection() -> None:
    result = classify_option_replacement(
        position=_position(),
        event=_event(strike=115.0),
        candidate_score=58.0,
        held_baseline_score=40.0,
        repeat_count=2,
        latest_assessment=_assessment(
            pnl_pct=-3.0,
            score=42.0,
            contract_status="marginal",
            field_path_state="contradictory",
        ),
        latest_decision={"verdict": "conditional_hold", "target_contracts": 5},
    )

    underlying_gate = next(gate for gate in result["gates"] if gate["key"] == "underlying_path")
    assert result["model_version"] == "replacement_rules_v2_field_shadow"
    assert result["status"] == "candidate"
    assert result["recommendation"] == "roll_out_candidate"
    assert result["comparison"]["held"]["underlying_path"] == "contradictory"
    assert underlying_gate["status"] == "fail"
    assert "advisory only" in underlying_gate["detail"]
    assert result["implementation_ready"] is False
    assert result["automated_execution_enabled"] is False
