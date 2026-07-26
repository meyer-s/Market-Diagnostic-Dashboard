import copy
import json
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services.option_decision_learning import (
    build_learning_influence_context,
    capture_option_learning_influence,
    evaluate_option_learning_influence,
    rebase_option_learning_evaluation,
)
from app.services.option_sweep_runs import _attach_learning_evaluations


def _family(cohorts):
    return {
        "cohorts": cohorts,
        "minimum_sample_before_comparison": 8,
        "automatic_weight_changes": False,
    }


def _summary(
    *,
    cycles,
    weak_process,
    recurrence,
    replacement=None,
    field=None,
    direction=None,
    duration=None,
):
    return {
        "sample": {"classified_trade_cycles": cycles},
        "trade_outcomes": {
            "process_quality": {
                "weak_process": weak_process,
                "mixed_process": max(0, cycles - weak_process),
            }
        },
        "scanner_recurrence_outcomes": _family(recurrence),
        "scanner_replacement_outcomes": _family(replacement or {}),
        "market_field_outcomes": _family(field or {}),
        "contract_direction_outcomes": _family(direction or {}),
        "contract_duration_outcomes": _family(duration or {}),
    }


def test_learning_influence_does_not_invent_weight_from_one_populated_cohort():
    summary = _summary(
        cycles=49,
        weak_process=45,
        recurrence={
            "no_repeat": {
                "sample_count": 49,
                "profitable": 28,
                "unprofitable": 21,
                "flat": 0,
                "average_percent_pnl": 10.14,
            }
        },
    )

    evaluation = evaluate_option_learning_influence(
        build_learning_influence_context(summary),
        champion_score=72.5,
    )

    assert evaluation["status"] == "collecting_comparable_cohorts"
    assert evaluation["learning_score"] is None
    assert evaluation["counterfactual_score"] == 72.5
    assert evaluation["counterfactual_weight"] == 0.0
    assert evaluation["applied_score"] == 72.5
    assert evaluation["applied_weight"] == 0.0
    assert evaluation["promotion_ready_for_review"] is False


def test_learning_influence_applies_only_a_bounded_gated_canary(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", True)
    summary = _summary(
        cycles=120,
        weak_process=20,
        recurrence={
            "no_repeat": {
                "sample_count": 60,
                "profitable": 20,
                "unprofitable": 40,
                "flat": 0,
                "average_percent_pnl": -5.0,
            },
            "strengthened_seen": {
                "sample_count": 60,
                "profitable": 45,
                "unprofitable": 15,
                "flat": 0,
                "average_percent_pnl": 12.0,
            },
        },
    )

    evaluation = evaluate_option_learning_influence(
        build_learning_influence_context(summary),
        champion_score=65.0,
        position_match={"classification": "strengthened"},
    )

    assert evaluation["status"] == "live_canary_active"
    assert evaluation["candidate_cohorts"]["scanner_recurrence"] == "strengthened_seen"
    assert evaluation["learning_score"] > 65.0
    assert evaluation["maximum_counterfactual_weight"] == 0.10
    assert evaluation["maximum_applied_weight"] == 0.10
    assert evaluation["nominal_weight_cap"] == 0.10
    assert evaluation["rank_snapshot_persisted"] is False
    assert evaluation["rank_snapshot_state_at_event_capture"] == "not_yet_terminal"
    assert evaluation["counterfactual_weight"] == 0.10
    assert evaluation["evidence_scaled_event_weight"] == 0.10
    assert evaluation["counterfactual_score"] > 65.0
    assert evaluation["applied_score"] > 65.0
    assert evaluation["applied_weight"] == 0.10
    assert evaluation["applied_event_weight"] == 0.10
    assert evaluation["operator_authorization"] == {
        "configured": True,
        "setting": "OPTION_LEARNING_CANARY_ENABLED",
        "default": False,
        "frozen_in_receipt": True,
    }
    assert evaluation["weight_control"] == {
        "configured_policy_cap": 0.10,
        "evidence_scaled_event_weight": 0.10,
        "applied_event_weight": 0.10,
        "operator_authorized": True,
        "evidence_scaling_is_policy_or_cap_change": False,
        "automatic_policy_or_cap_changes": False,
    }
    assert evaluation["gates"] == {
        "independent_cycles": True,
        "process_quality": True,
        "comparable_cohorts": True,
        "live_canary_authorized": True,
    }
    assert evaluation["automatic_weight_changes"] is False
    assert evaluation["automatic_policy_or_cap_changes"] is False
    assert evaluation["evidence_gates_passed"] is True
    assert evaluation["application_gates_passed"] is True

    rebased = rebase_option_learning_evaluation(evaluation, champion_score=80.0)
    assert rebased["champion_score"] == 80.0
    assert rebased["applied_weight"] == evaluation["applied_weight"]
    assert rebased["applied_score"] < 80.0

    oversized = {
        **evaluation,
        "counterfactual_weight": 0.50,
        "applied_weight": 0.50,
    }
    clamped = rebase_option_learning_evaluation(oversized, champion_score=80.0)
    assert clamped["counterfactual_weight"] == 0.10
    assert clamped["applied_weight"] == 0.10


def test_learning_influence_default_disabled_keeps_evidence_counterfactual(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", False)
    summary = _summary(
        cycles=120,
        weak_process=20,
        recurrence={
            "no_repeat": {
                "sample_count": 60,
                "profitable": 20,
                "unprofitable": 40,
                "flat": 0,
                "average_percent_pnl": -5.0,
            },
            "strengthened_seen": {
                "sample_count": 60,
                "profitable": 45,
                "unprofitable": 15,
                "flat": 0,
                "average_percent_pnl": 12.0,
            },
        },
    )

    context = build_learning_influence_context(summary)
    evaluation = evaluate_option_learning_influence(
        context,
        champion_score=65.0,
        position_match={"classification": "strengthened"},
    )

    assert context["operator_authorization"]["configured"] is False
    assert context["live_canary_enabled"] is False
    assert context["actual_rank_influence"] == 0.0
    assert evaluation["status"] == "counterfactual_operator_disabled"
    assert evaluation["learning_score"] > 65.0
    assert evaluation["counterfactual_weight"] == 0.10
    assert evaluation["evidence_scaled_event_weight"] == 0.10
    assert evaluation["counterfactual_score"] > 65.0
    assert evaluation["applied_weight"] == 0.0
    assert evaluation["applied_event_weight"] == 0.0
    assert evaluation["applied_score"] == 65.0
    assert evaluation["evidence_gates_passed"] is True
    assert evaluation["application_gates_passed"] is False
    assert evaluation["promotion_ready_for_review"] is True
    assert evaluation["live_canary_active"] is False
    assert evaluation["gates"]["live_canary_authorized"] is False
    assert evaluation["weight_control"]["automatic_policy_or_cap_changes"] is False
    assert any(
        "OPTION_LEARNING_CANARY_ENABLED is false" in reason
        for reason in evaluation["reasons"]
    )
    tampered = {**evaluation, "applied_weight": 0.10}
    rebased = rebase_option_learning_evaluation(tampered, champion_score=70.0)
    assert rebased["counterfactual_weight"] == 0.10
    assert rebased["applied_weight"] == 0.0
    assert rebased["applied_score"] == 70.0
    assert rebased["weight_control"]["operator_authorized"] is False


def test_learning_influence_preserves_existing_point_in_time_receipts_across_policy_versions():
    for version, weight in (
        ("option_learning_influence_canary_v2", 0.05),
        ("option_learning_influence_canary_v3", 0.10),
    ):
        receipt = {
            "version": version,
            "point_in_time_receipt": True,
            "champion_score": 70.0,
            "learning_score": 80.0,
            "counterfactual_weight": weight,
            "applied_weight": weight,
        }
        serialized = json.dumps(receipt, sort_keys=True)
        event = SimpleNamespace(
            learning_influence_version=version,
            learning_influence_json=serialized,
        )

        captured = capture_option_learning_influence(
            object(),
            event=event,
            position_match=None,
        )

        assert captured == receipt
        assert event.learning_influence_version == version
        assert event.learning_influence_json == serialized

    rebased = rebase_option_learning_evaluation(
        {
            "version": "option_learning_influence_canary_v2",
            "point_in_time_receipt": True,
            "champion_score": 70.0,
            "learning_score": 80.0,
            "counterfactual_weight": 0.08,
            "applied_weight": 0.08,
        },
        champion_score=75.0,
    )
    assert rebased["counterfactual_weight"] == 0.05
    assert rebased["applied_weight"] == 0.05


def test_learning_influence_maps_replacement_and_market_field_cohorts():
    summary = _summary(cycles=0, weak_process=0, recurrence={})
    field_context = {
        "semantic_revision": "1.2",
        "quality": {"available": True},
        "initialization": {
            "minimum_input_satisfied": True,
            "initialization_target_covered": True,
        },
        "alignment": {"supported": True},
        "classification": {"path_state": "supportive"},
    }

    evaluation = evaluate_option_learning_influence(
        build_learning_influence_context(summary),
        champion_score=50.0,
        field_context=field_context,
        position_match={
            "classification": "contract_drift",
            "replacement_decision": {"recommendation": "rescue_roll_rejected"},
        },
    )

    assert evaluation["candidate_cohorts"] == {
        "scanner_recurrence": "contract_drift_seen",
        "replacement_signal": "rescue_roll_rejected_seen",
        "market_field": "supportive",
        "contract_direction": "unavailable",
        "contract_duration": "unavailable",
    }


def test_market_field_has_zero_direct_authority_and_auditable_bounded_indirect_attribution(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", True)
    summary = _summary(
        cycles=120,
        weak_process=20,
        recurrence={},
        field={
            "supportive": {
                "sample_count": 60,
                "profitable": 48,
                "unprofitable": 12,
                "flat": 0,
                "non_weak_process": 50,
                "average_percent_pnl": 18.0,
                "median_percent_pnl": 12.0,
            },
            "contradictory": {
                "sample_count": 60,
                "profitable": 12,
                "unprofitable": 48,
                "flat": 0,
                "non_weak_process": 50,
                "average_percent_pnl": -18.0,
                "median_percent_pnl": -12.0,
            },
        },
    )
    context = build_learning_influence_context(summary)

    def field(path_state: str) -> dict[str, object]:
        return {
            "semantic_revision": "1.3",
            "quality": {"available": True},
            "initialization": {
                "minimum_input_satisfied": True,
                "initialization_target_covered": True,
                "state_vector_coverage": {
                    "schema_version": "market_field_coordinate_coverage_v1",
                    "coordinate_count": 15,
                    "coverage_is_convergence": False,
                },
            },
            "alignment": {"supported": True},
            "classification": {"path_state": path_state},
            "rank_influence": 0.0,
            "authority": {"scanner_rank": "none", "automated_execution": "none"},
        }

    supportive = evaluate_option_learning_influence(
        context,
        champion_score=60.0,
        field_context=field("supportive"),
    )
    contradictory = evaluate_option_learning_influence(
        context,
        champion_score=60.0,
        field_context=field("contradictory"),
    )

    assert supportive["applied_score"] > 60.0
    assert contradictory["applied_score"] < 60.0
    for evaluation, cohort in (
        (supportive, "supportive"),
        (contradictory, "contradictory"),
    ):
        assert evaluation["candidate_cohorts"]["market_field"] == cohort
        assert 0.0 < evaluation["applied_weight"] <= 0.10
        assert evaluation["maximum_applied_weight"] == 0.10
        attribution = evaluation["family_attribution"]["market_field"]
        assert attribution["available"] is True
        assert attribution["cohort"] == cohort
        assert attribution["normalized_learning_weight"] == 1.0
        assert attribution["direct_scanner_weight"] == 0.0
        assert attribution["influence_path"] == "indirect_outcome_learning_canary"
        assert attribution["applied_score_delta"] == pytest.approx(
            evaluation["applied_score"] - evaluation["champion_score"],
            abs=0.011,
        )
        assert evaluation["authority"] == {
            "candidate_eligibility": "champion_only",
            "hard_veto": "champion_only",
            "position_sizing": "none",
            "review_verdict": "none",
            "automated_execution": "none",
            "direct_market_field_scanner_weight": 0.0,
            "outcome_learning_canary_maximum_weight": 0.10,
            "market_field_indirect_applied_score_delta": attribution[
                "applied_score_delta"
            ],
            "note": evaluation["authority"]["note"],
        }
        assert abs(evaluation["applied_score"] - evaluation["champion_score"]) <= (
            0.10 * abs(evaluation["learning_score"] - evaluation["champion_score"])
            + 0.011
        )


def test_family_attribution_reconciles_multi_family_learning_score_and_delta(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", True)
    summary = _summary(
        cycles=120,
        weak_process=20,
        recurrence={
            "no_repeat": {
                "sample_count": 60,
                "profitable": 20,
                "unprofitable": 40,
                "flat": 0,
                "average_percent_pnl": -5.0,
            },
            "strengthened_seen": {
                "sample_count": 60,
                "profitable": 45,
                "unprofitable": 15,
                "flat": 0,
                "average_percent_pnl": 12.0,
            },
        },
        field={
            "supportive": {
                "sample_count": 60,
                "profitable": 42,
                "unprofitable": 18,
                "flat": 0,
                "average_percent_pnl": 10.0,
            },
            "contradictory": {
                "sample_count": 60,
                "profitable": 18,
                "unprofitable": 42,
                "flat": 0,
                "average_percent_pnl": -10.0,
            },
        },
    )
    field_context = {
        "semantic_revision": "1.3",
        "quality": {"available": True},
        "initialization": {
            "minimum_input_satisfied": True,
            "initialization_target_covered": True,
        },
        "alignment": {"supported": True},
        "classification": {"path_state": "supportive"},
        "rank_influence": 0.0,
    }

    evaluation = evaluate_option_learning_influence(
        build_learning_influence_context(summary),
        champion_score=60.0,
        field_context=field_context,
        position_match={"classification": "strengthened"},
    )
    attribution = evaluation["family_attribution"]
    available = [row for row in attribution.values() if row["available"]]

    assert {row["cohort"] for row in available} == {
        "strengthened_seen",
        "supportive",
    }
    assert sum(row["normalized_learning_weight"] for row in available) == pytest.approx(
        1.0,
        abs=1e-6,
    )
    assert sum(row["learning_score_component"] for row in available) == pytest.approx(
        evaluation["learning_score"],
        abs=0.011,
    )
    assert sum(row["applied_score_delta"] for row in available) == pytest.approx(
        evaluation["applied_score"] - evaluation["champion_score"],
        abs=0.011,
    )
    assert attribution["market_field"]["direct_scanner_weight"] == 0.0
    assert attribution["market_field"]["influence_path"] == (
        "indirect_outcome_learning_canary"
    )
    assert attribution["scanner_recurrence"]["direct_scanner_weight"] is None
    assert attribution["scanner_recurrence"]["influence_path"] == (
        "outcome_learning_canary"
    )
    assert evaluation["authority"]["market_field_indirect_applied_score_delta"] == (
        attribution["market_field"]["applied_score_delta"]
    )


def test_scanner_market_field_metamorphism_changes_only_bounded_learning_rank_fields(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", True)
    summary = _summary(
        cycles=120,
        weak_process=20,
        recurrence={},
        field={
            "supportive": {
                "sample_count": 60,
                "profitable": 48,
                "unprofitable": 12,
                "flat": 0,
                "average_percent_pnl": 18.0,
                "median_percent_pnl": 12.0,
            },
            "contradictory": {
                "sample_count": 60,
                "profitable": 12,
                "unprofitable": 48,
                "flat": 0,
                "average_percent_pnl": -18.0,
                "median_percent_pnl": -12.0,
            },
        },
    )
    context = build_learning_influence_context(summary)

    def field(path_state: str) -> dict[str, object]:
        return {
            "semantic_revision": "1.3",
            "quality": {"available": True},
            "initialization": {
                "minimum_input_satisfied": True,
                "initialization_target_covered": True,
            },
            "alignment": {"supported": True},
            "classification": {"path_state": path_state},
            "rank_influence": 0.0,
        }

    authoritative = {
        "eligible": True,
        "eligibility_reason": "champion_filter_passed",
        "selected_contract": {
            "expiry": "2026-09-18",
            "dte": 54,
            "strike": 105.0,
            "option_type": "call",
            "premium": 2.25,
            "bid": 2.2,
            "ask": 2.3,
        },
        "vetoes": [],
        "sizing": {"target_contracts": 2, "risk_budget": 450.0},
        "quantity": 2,
        "entry_price": 2.25,
        "pnl": {"dollar": 0.0, "percent": 0.0},
        "execution_authority": "manual_only",
    }
    rows: list[dict[str, object]] = []
    frozen_authority: list[dict[str, object]] = []
    for event_id, path_state in enumerate(("supportive", "contradictory"), start=1):
        receipt = evaluate_option_learning_influence(
            context,
            champion_score=60.0,
            field_context=field(path_state),
        )
        receipt["point_in_time_receipt"] = True
        row = {
            "event_id": event_id,
            "triggered_at": f"2026-07-26T12:0{event_id}:00",
            "score": 60.0,
            "grade": "B",
            "components": {"champion": 60.0},
            "field_context": field(path_state),
            "position_match": None,
            "learning_evaluation": receipt,
            **copy.deepcopy(authoritative),
        }
        rows.append(row)
        frozen_authority.append(
            {key: copy.deepcopy(row[key]) for key in authoritative}
        )

    policy = _attach_learning_evaluations(rows, context)

    assert rows[0]["score"] > 60.0
    assert rows[1]["score"] < 60.0
    for row, before in zip(rows, frozen_authority):
        assert {key: row[key] for key in authoritative} == before
        evaluation = row["learning_evaluation"]
        assert 0.0 < evaluation["applied_weight"] <= 0.10
        assert evaluation["authority"]["candidate_eligibility"] == "champion_only"
        assert evaluation["authority"]["hard_veto"] == "champion_only"
        assert evaluation["authority"]["position_sizing"] == "none"
        assert evaluation["authority"]["review_verdict"] == "none"
        assert evaluation["authority"]["automated_execution"] == "none"
        assert evaluation["authority"]["direct_market_field_scanner_weight"] == 0.0
        field_attribution = evaluation["family_attribution"]["market_field"]
        assert field_attribution["influence_path"] == "indirect_outcome_learning_canary"
        assert field_attribution["direct_scanner_weight"] == 0.0
        assert abs(row["score"] - evaluation["champion_score"]) <= (
            0.10 * abs(evaluation["learning_score"] - evaluation["champion_score"])
            + 0.011
        )
    assert policy["maximum_applied_weight"] == 0.10
    assert policy["observed_max_applied_weight"] <= 0.10
    assert policy["direct_market_field_rank_weight"] == 0.0
    assert policy["market_field_influence_path"] == "indirect_outcome_learning_canary"


def test_entry_duration_can_activate_the_canary_without_using_outcome_time_features(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "OPTION_LEARNING_CANARY_ENABLED", True)
    summary = _summary(
        cycles=50,
        weak_process=45,
        recurrence={},
        duration={
            "under_45_dte": {
                "sample_count": 17,
                "profitable": 8,
                "unprofitable": 9,
                "flat": 0,
                "non_weak_process": 2,
                "average_percent_pnl": -3.64,
                "median_percent_pnl": -12.0,
            },
            "45_to_90_dte": {
                "sample_count": 29,
                "profitable": 19,
                "unprofitable": 10,
                "flat": 0,
                "non_weak_process": 3,
                "average_percent_pnl": 18.08,
                "median_percent_pnl": 9.0,
            },
        },
    )

    evaluation = evaluate_option_learning_influence(
        build_learning_influence_context(summary),
        champion_score=70.0,
        contract_context={"option_type": "call", "dte": 60},
    )

    assert evaluation["candidate_cohorts"]["contract_duration"] == "45_to_90_dte"
    assert evaluation["status"] == "live_canary_active"
    assert evaluation["applied_weight"] > 0
    duration_signal = next(
        signal for signal in evaluation["signals"] if signal["family"] == "contract_duration"
    )
    assert duration_signal["available"] is True
    assert duration_signal["pnl_statistic_used"] == "median"
    assert duration_signal["non_weak_process_share"] < 0.2
