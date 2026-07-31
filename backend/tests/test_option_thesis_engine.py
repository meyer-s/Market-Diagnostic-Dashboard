from __future__ import annotations

import copy
from datetime import date, datetime
import json
from types import SimpleNamespace

import pandas as pd

from app.models.option_decision_learning import OptionPositionMandate, OptionRiskPolicy
from app.services.option_thesis_engine import (
    FIELD_SHADOW_FEATURE_SCHEMA_VERSION,
    FIELD_SHADOW_MODEL_VERSION,
    GRADER_VERSION,
    build_assessment_payload,
    rebase_continuation_condition,
    technical_snapshot_from_frame,
)


def _position(**overrides):
    payload = {
        "id": 1,
        "trade_date": date(2026, 6, 1),
        "contracts": 4,
        "symbol": "TEST",
        "expiration": date(2026, 9, 18),
        "strike": 110.0,
        "option_type": "call",
        "fill_price": 2.0,
        "total_cost": 800.0,
        "underlying_at_entry": 100.0,
        "underlying_reference": 100.0,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def _mandate() -> OptionPositionMandate:
    return OptionPositionMandate(
        id=1,
        position_id=1,
        mandate_version=1,
        confirmation_status="confirmed",
        threshold_approval_status="approved",
        trade_role="trend",
        original_thesis="Trend continuation.",
        contract_thesis="Enough time for a measured move.",
        confirmation_condition="Close above 104.",
        invalidation_condition="Close below 96.",
        decision_deadline=date(2026, 8, 1),
        thresholds_json="{}",
        source_snapshot_json="{}",
    )


def _policy() -> OptionRiskPolicy:
    return OptionRiskPolicy(
        id=1,
        policy_version=1,
        active=True,
        approval_status="approved",
        portfolio_capital=100_000.0,
        max_single_position_premium_pct=30.0,
        max_directional_premium_pct=75.0,
        max_expiry_bucket_premium_pct=60.0,
        max_option_spread_pct=25.0,
        min_dte_for_add=21,
        settings_json="{}",
    )


def test_technical_snapshot_calculates_point_in_time_features() -> None:
    close = pd.Series([90 + index * 0.5 for index in range(220)])
    frame = pd.DataFrame(
        {
            "Close": close,
            "High": close + 1,
            "Low": close - 1,
            "Volume": [1_000_000 + index * 100 for index in range(220)],
        }
    )

    snapshot = technical_snapshot_from_frame(frame)

    assert snapshot["observations"] == 220
    assert snapshot["price"] > snapshot["sma20"] > snapshot["sma50"]
    assert snapshot["sma200"] is not None
    assert snapshot["atr14_pct"] > 0


def test_continuation_condition_replaces_the_stale_deadline() -> None:
    condition = rebase_continuation_condition(
        "Require a close above 104 before 2026-07-13.",
        deadline=date(2026, 7, 20),
        verdict="conditional_hold",
    )

    assert "2026-07-13" not in condition
    assert "2026-07-20" in condition


def test_grader_separates_company_contract_and_portfolio_and_never_auto_adds() -> None:
    position = _position()
    other = _position(id=2, total_cost=2_000.0, contracts=10, strike=105.0)
    metrics = {
        "market": {"current_price": 102.0, "last_updated": "2026-07-15T16:00:00Z"},
        "option_price": 1.4,
        "quote": {"bid": 1.3, "ask": 1.5, "spread_pct": 14.3},
        "volatility": 0.25,
        "dte": 65,
        "greeks": {"delta": 0.35, "theta": -0.04},
        "pnl": {"dollar": -240.0, "percent": -30.0},
        "technical_snapshot": {
            "price": 102.0,
            "sma20": 101.0,
            "sma50": 99.0,
            "sma20_slope_pct": 1.2,
            "rsi14": 56.0,
            "macd_hist": 0.3,
        },
    }

    result = build_assessment_payload(
        position=position,
        metrics=metrics,
        mandate=_mandate(),
        latest_review=None,
        portfolio_positions=[position, other],
        risk_policy=_policy(),
        projection_payload={
            "projections": {"3M": {"direction": "bullish", "conviction": "medium"}},
            "fundamentals": {
                "revenue_yoy": {"series": [{"date": "2026-03-31", "value": 3.0}, {"date": "2026-06-30", "value": 5.0}]},
                "eps": {"series": [{"date": "2026-03-31", "value": 1.0}, {"date": "2026-06-30", "value": 1.2}]},
            },
        },
        as_of=datetime(2026, 7, 15, 16, 0),
    )

    assert result["company_thesis_status"] in {"strengthening", "intact"}
    assert result["contract_status"] in {"attractive", "marginal"}
    assert result["portfolio_fit_status"] in {"crowded", "over_budget"}
    assert result["proposed_verdict"] == "reduce"
    assert result["proposed_target_contracts"] < position.contracts
    assert result["proposed_verdict"] != "add_eligible"
    assert result["axis_results"]["company_thesis"]["status"] != result["axis_results"]["portfolio_fit"]["status"]
    assert result["next_review_date"] > date(2026, 7, 15)
    assert result["decision_deadline"] >= result["next_review_date"]
    assert result["input_snapshot"]["path"]["mandate_deadline"] == date(2026, 8, 1)
    assert result["input_snapshot"]["decision_window"]["max_hold_sessions"] <= 14


def test_nonviable_contract_can_be_replaced_without_declaring_company_thesis_broken() -> None:
    position = _position(expiration=date(2026, 7, 24), strike=125.0)
    metrics = {
        "market": {"current_price": 102.0, "last_updated": "2026-07-15T16:00:00Z"},
        "option_price": 0.05,
        "quote": {"bid": 0.0, "ask": 0.1, "spread_pct": 200.0},
        "volatility": 0.20,
        "dte": 9,
        "greeks": {"delta": 0.03, "theta": -0.01},
        "pnl": {"dollar": -780.0, "percent": -97.5},
        "technical_snapshot": {
            "price": 102.0,
            "sma20": 101.0,
            "sma50": 99.0,
            "sma20_slope_pct": 1.0,
            "rsi14": 55.0,
            "macd_hist": 0.2,
        },
    }

    result = build_assessment_payload(
        position=position,
        metrics=metrics,
        mandate=_mandate(),
        latest_review=None,
        portfolio_positions=[position],
        risk_policy=_policy(),
        projection_payload={
            "projections": {"3M": {"direction": "bullish"}},
            "fundamentals": {
                "revenue_yoy": {"series": [{"date": "2026-06-30", "value": 4.0}]},
                "eps": {"series": [{"date": "2026-03-31", "value": 1.0}, {"date": "2026-06-30", "value": 1.1}]},
            },
        },
        as_of=datetime(2026, 7, 15, 16, 0),
    )

    assert result["company_thesis_status"] in {"strengthening", "intact"}
    assert result["contract_status"] == "nonviable"
    assert result["proposed_verdict"] == "replacement_candidate"
    assert result["proposed_target_contracts"] == 0
    assert result["next_review_date"] is None
    assert result["decision_deadline"] == date(2026, 7, 15)


def test_market_field_is_immutable_advisory_evidence_not_a_verdict_rule() -> None:
    position = _position(strike=105.0)
    offsetting_position = _position(
        id=2,
        option_type="put",
        expiration=date(2026, 12, 18),
        total_cost=2_400.0,
    )


def _current_metrics(**overrides):
    payload = {
        "market": {"current_price": 94.0, "last_updated": "2026-07-15T16:00:00Z"},
        "option_price": 2.0,
        "option_price_source": "mid",
        "quote": {
            "bid": 1.9,
            "ask": 2.1,
            "spread_pct": 10.0,
            "quality": "mid",
            "open_interest": 500,
            "volume": 50,
        },
        "volatility": 0.30,
        "dte": 30,
        "greeks": {"delta": 0.35, "gamma": 0.03, "theta": -2.0, "vega": 0.08},
        "pnl": {"dollar": -200.0, "percent": -25.0},
        "opportunity": {"score_change": -20.0},
        "technical_snapshot": {
            "price": 94.0,
            "sma20": 97.0,
            "sma50": 99.0,
            "sma20_slope_pct": -1.2,
            "rsi14": 42.0,
            "macd_hist": -0.3,
        },
    }
    payload.update(overrides)
    return payload


def _weakening_projection():
    return {
        "projections": {"3M": {"direction": "bearish", "conviction": "medium"}},
        "fundamentals": {
            "revenue_yoy": {"series": [{"date": "2026-06-30", "value": -4.0}]},
            "eps": {
                "series": [
                    {"date": "2026-03-31", "value": 1.0},
                    {"date": "2026-06-30", "value": 0.7},
                ]
            },
        },
    }


def _previous_assessment(ladder: str, *, as_of: datetime, signals: tuple[str, ...] = ()):
    return SimpleNamespace(
        grader_version=GRADER_VERSION,
        as_of=as_of,
        axis_results_json=json.dumps(
            {
                "trim_sizing": {
                    "applied_ladder": ladder,
                    "signals": [{"code": code} for code in signals],
                }
            }
        ),
    )
    field_context = {
        "schema_version": "option_market_field_v1",
        "mode": "shadow_only",
        "rank_influence": 0.0,
        "available": True,
        "computed_at": "2026-07-15T16:05:00Z",
        "as_of_bar": "2026-07-14T20:00:00Z",
        "timeframe": "1D",
        "quality": {"available": True, "status": "complete", "warnings": []},
        "direction": {
            "option_aligned_pressure": -0.42,
            "option_aligned_velocity": -0.27,
        },
        "strata": {
            "structure": 0.61,
            "kinematics": 0.48,
            "geometry": 0.55,
            "information": 0.72,
            "propagation": 0.31,
            "cascade_bias": -0.18,
        },
        "price_action": {
            "state": "breakdown",
            "support_distance_atr": -0.35,
            "resistance_distance_atr": 2.8,
        },
        "classification": {
            "path_state": "contradictory",
            "eventfulness": "normal",
        },
        "hypotheses": {
            "organized_expansion": False,
            "longward_cascade": False,
            "geometry_disorder_shock": False,
            "kinematic_exhaustion": False,
        },
    }
    metrics = {
        "market": {"current_price": 102.0, "last_updated": "2026-07-15T16:00:00Z"},
        "option_price": 1.4,
        "quote": {"bid": 1.3, "ask": 1.5, "spread_pct": 14.3},
        "volatility": 0.25,
        "dte": 65,
        "greeks": {"delta": 0.35, "theta": -0.04},
        "pnl": {"dollar": -240.0, "percent": -30.0},
        "technical_snapshot": {
            "price": 102.0,
            "sma20": 101.0,
            "sma50": 99.0,
            "sma20_slope_pct": 1.2,
            "rsi14": 56.0,
            "macd_hist": 0.3,
        },
        "field_context": field_context,
    }

    assessment_kwargs = {
        "position": position,
        "mandate": _mandate(),
        "latest_review": None,
        "portfolio_positions": [position, offsetting_position],
        "risk_policy": _policy(),
        "projection_payload": {
            "projections": {"3M": {"direction": "bullish", "conviction": "medium"}},
            "fundamentals": {
                "revenue_yoy": {
                    "series": [
                        {"date": "2026-03-31", "value": 3.0},
                        {"date": "2026-06-30", "value": 5.0},
                    ]
                },
                "eps": {
                    "series": [
                        {"date": "2026-03-31", "value": 1.0},
                        {"date": "2026-06-30", "value": 1.2},
                    ]
                },
            },
        },
        "as_of": datetime(2026, 7, 15, 16, 0),
    }
    baseline_metrics = dict(metrics)
    baseline_metrics.pop("field_context")
    baseline = build_assessment_payload(metrics=baseline_metrics, **assessment_kwargs)
    result = build_assessment_payload(
        metrics=metrics,
        **assessment_kwargs,
    )
    supportive_context = copy.deepcopy(field_context)
    supportive_context["direction"] = {
        "option_aligned_pressure": 0.42,
        "option_aligned_velocity": 0.27,
    }
    supportive_context["price_action"] = {
        "state": "breakout",
        "support_distance_atr": 1.4,
        "resistance_distance_atr": 0.2,
    }
    supportive_context["classification"]["path_state"] = "supportive"
    supportive = build_assessment_payload(
        metrics={**metrics, "field_context": supportive_context},
        **assessment_kwargs,
    )

    for immutable_field in (
        "company_thesis_status",
        "contract_status",
        "portfolio_fit_status",
        "proposed_verdict",
        "proposed_target_contracts",
        "target_contracts_min",
        "target_contracts_max",
    ):
        assert result[immutable_field] == baseline[immutable_field]
        assert supportive[immutable_field] == baseline[immutable_field]
    assert result["vetoes"] == baseline["vetoes"]
    assert supportive["vetoes"] == baseline["vetoes"]
    assert result["proposed_verdict"] == "hold"
    assert result["proposed_target_contracts"] == position.contracts
    assert not any(item["code"].startswith("market_field") for item in result["vetoes"])
    assert result["confidence"] == "medium"
    assert result["urgency"] == "high"
    assert result["grader_version"] == FIELD_SHADOW_MODEL_VERSION
    assert result["feature_schema_version"] == FIELD_SHADOW_FEATURE_SCHEMA_VERSION
    assert result["input_snapshot"]["field_context"] == field_context
    assert result["axis_results"]["market_structure"]["status"] == "contradictory"
    assert result["axis_results"]["market_structure"]["familiarity"] == "not_scored"
    assert result["axis_results"]["market_structure"]["authority"]["manager_verdict"] == "none"
    assert result["axis_results"]["market_structure"]["authority"]["review_priority"] == "advisory"
    assert result["market_field_effects"] == {
        "confidence": {"before": "high", "after": "medium", "changed": True},
        "urgency": {"before": "low", "after": "high", "changed": True},
        "review_window_recomputed_from_advisory_urgency": True,
        "rank_changed": False,
        "veto_changed": False,
        "verdict_changed": False,
        "target_size_changed": False,
        "execution_authority": "none",
    }
    assert supportive["axis_results"]["market_structure"]["status"] == "supportive"
    assert supportive["market_field_effects"]["rank_changed"] is False
    assert supportive["market_field_effects"]["veto_changed"] is False
    assert supportive["market_field_effects"]["verdict_changed"] is False
    assert supportive["market_field_effects"]["target_size_changed"] is False
    assert supportive["market_field_effects"]["execution_authority"] == "none"
    field_evidence = next(item for item in result["evidence"] if item["evidence_id"] == "market_field_path")
    assert field_evidence["advisory"] is True
    assert field_evidence["rank_influence"] == 0.0
    assert field_evidence["authority"]["target_size"] == "none"


def test_trim_ladder_excludes_loser_drawdown_and_starts_with_one_rung() -> None:
    position = _position(contracts=10, strike=95.0, total_cost=2_000.0)
    offset = _position(
        id=2,
        option_type="put",
        expiration=date(2026, 12, 18),
        total_cost=8_000.0,
    )
    common = {
        "position": position,
        "mandate": _mandate(),
        "latest_review": None,
        "portfolio_positions": [position, offset],
        "risk_policy": _policy(),
        "projection_payload": _weakening_projection(),
        "as_of": datetime(2026, 7, 15, 16, 0),
    }

    mild_loss = build_assessment_payload(
        metrics=_current_metrics(pnl={"dollar": -200.0, "percent": -10.0}),
        **common,
    )
    severe_loss = build_assessment_payload(
        metrics=_current_metrics(pnl={"dollar": -1_900.0, "percent": -95.0}),
        **common,
    )

    assert mild_loss["proposed_verdict"] == "reduce"
    assert mild_loss["proposed_target_contracts"] == 8
    assert severe_loss["proposed_target_contracts"] == mild_loss["proposed_target_contracts"]
    sizing = severe_loss["axis_results"]["trim_sizing"]
    assert sizing["raw_ladder"] == "runner_25"
    assert sizing["applied_ladder"] == "trim_25"
    assert sizing["persistence"]["escalation_limited"] is True
    assert sizing["loss_drawdown_used_for_sizing"] is False


def test_trim_ladder_escalates_at_most_one_rung_on_a_new_date() -> None:
    position = _position(contracts=10, strike=95.0, total_cost=2_000.0)
    offset = _position(
        id=2,
        option_type="put",
        expiration=date(2026, 12, 18),
        total_cost=8_000.0,
    )
    common = {
        "position": position,
        "metrics": _current_metrics(),
        "mandate": _mandate(),
        "latest_review": None,
        "portfolio_positions": [position, offset],
        "risk_policy": _policy(),
        "projection_payload": _weakening_projection(),
        "as_of": datetime(2026, 7, 15, 16, 0),
    }

    same_day = build_assessment_payload(
        previous_assessment=_previous_assessment(
            "trim_25",
            as_of=datetime(2026, 7, 15, 9, 0),
            signals=("company_thesis_impaired", "path_failed"),
        ),
        **common,
    )
    next_day = build_assessment_payload(
        previous_assessment=_previous_assessment(
            "trim_25",
            as_of=datetime(2026, 7, 14, 16, 0),
            signals=("company_thesis_impaired", "path_failed"),
        ),
        **common,
    )

    assert same_day["axis_results"]["trim_sizing"]["applied_ladder"] == "trim_25"
    assert same_day["proposed_target_contracts"] == 8
    assert next_day["axis_results"]["trim_sizing"]["applied_ladder"] == "trim_50"
    assert next_day["proposed_target_contracts"] == 5
    assert next_day["axis_results"]["trim_sizing"]["persistence"]["repeated_signal_codes"]


def test_confirmed_deadline_failure_bypasses_trim_hysteresis() -> None:
    position = _position(contracts=10, strike=95.0, total_cost=2_000.0)
    mandate = _mandate()
    mandate.decision_deadline = date(2026, 7, 14)

    result = build_assessment_payload(
        position=position,
        metrics=_current_metrics(),
        mandate=mandate,
        latest_review=None,
        portfolio_positions=[position],
        risk_policy=_policy(),
        projection_payload=_weakening_projection(),
        as_of=datetime(2026, 7, 15, 16, 0),
    )

    sizing = result["axis_results"]["trim_sizing"]
    assert result["proposed_verdict"] == "reduce"
    assert sizing["raw_ladder"] == "runner_25"
    assert sizing["applied_ladder"] == "runner_25"
    assert sizing["persistence"]["hard_resize_bypass"] is True
    assert result["proposed_target_contracts"] == 3


def test_convexity_harvest_trims_a_winner_only_with_actionable_quote() -> None:
    position = _position(contracts=10, strike=95.0, total_cost=2_000.0)
    offset = _position(
        id=2,
        option_type="put",
        expiration=date(2026, 12, 18),
        total_cost=8_000.0,
    )
    metrics = _current_metrics(
        market={"current_price": 110.0, "last_updated": "2026-07-15T16:00:00Z"},
        option_price=5.0,
        dte=60,
        greeks={"delta": 0.65, "gamma": 0.02, "theta": -2.0, "vega": 0.1},
        pnl={"dollar": 800.0, "percent": 40.0},
        opportunity={"score_change": 2.0},
        technical_snapshot={
            "price": 110.0,
            "sma20": 106.0,
            "sma50": 102.0,
            "sma20_slope_pct": 1.4,
            "rsi14": 61.0,
            "macd_hist": 0.4,
        },
    )
    strengthening = {
        "projections": {"3M": {"direction": "bullish"}},
        "fundamentals": {
            "revenue_yoy": {"series": [{"date": "2026-06-30", "value": 5.0}]},
            "eps": {"series": [{"value": 1.0}, {"value": 1.2}]},
        },
    }
    common = {
        "position": position,
        "mandate": _mandate(),
        "latest_review": None,
        "portfolio_positions": [position, offset],
        "risk_policy": _policy(),
        "projection_payload": strengthening,
        "as_of": datetime(2026, 7, 15, 16, 0),
    }

    actionable = build_assessment_payload(metrics=metrics, **common)
    last_only = build_assessment_payload(
        metrics={
            **metrics,
            "option_price_source": "last",
            "quote": {
                "bid": 0.0,
                "ask": 5.5,
                "spread_pct": None,
                "quality": "last",
            },
        },
        **common,
    )

    assert actionable["proposed_verdict"] == "reduce"
    assert actionable["proposed_target_contracts"] == 8
    assert actionable["axis_results"]["trim_sizing"]["harvest_candidate"] is True
    assert last_only["axis_results"]["trim_sizing"]["harvest_candidate"] is False
    assert last_only["proposed_verdict"] == "conditional_hold"
    assert last_only["axis_results"]["trim_sizing"]["execution"]["ready"] is False


def test_wide_spread_alone_blocks_execution_without_forcing_a_trim() -> None:
    position = _position(contracts=10, strike=100.0, total_cost=2_000.0)
    metrics = _current_metrics(
        market={"current_price": 102.0, "last_updated": "2026-07-15T16:00:00Z"},
        option_price=2.0,
        dte=65,
        quote={
            "bid": 1.2,
            "ask": 2.8,
            "spread_pct": 80.0,
            "quality": "wide",
        },
        greeks={"delta": 0.45, "gamma": 0.02, "theta": -1.0, "vega": 0.1},
        pnl={"dollar": -100.0, "percent": -5.0},
        opportunity={"score_change": 0.0},
    )
    result = build_assessment_payload(
        position=position,
        metrics=metrics,
        mandate=_mandate(),
        latest_review=None,
        portfolio_positions=[position],
        risk_policy=_policy(),
        projection_payload={
            "projections": {"3M": {"direction": "bullish"}},
            "fundamentals": {
                "revenue_yoy": {"series": [{"value": 5.0}]},
                "eps": {"series": [{"value": 1.0}, {"value": 1.2}]},
            },
        },
        as_of=datetime(2026, 7, 15, 16, 0),
    )

    sizing = result["axis_results"]["trim_sizing"]
    assert result["contract_status"] == "marginal"
    assert result["axis_results"]["exact_contract"]["reason_code"] == "spread_marginal"
    assert result["proposed_verdict"] == "conditional_hold"
    assert result["proposed_target_contracts"] == position.contracts
    assert sizing["applied_ladder"] == "hold"
    assert sizing["execution"]["ready"] is False
    assert not any(item["code"] == "contract_marginal" for item in sizing["signals"])
