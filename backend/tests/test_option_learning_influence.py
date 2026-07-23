from app.services.option_decision_learning import (
    build_learning_influence_context,
    evaluate_option_learning_influence,
)


def _family(cohorts):
    return {
        "cohorts": cohorts,
        "minimum_sample_before_comparison": 20,
        "automatic_weight_changes": False,
    }


def _summary(*, cycles, weak_process, recurrence, replacement=None, field=None):
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


def test_learning_influence_can_measure_but_never_apply_a_gated_challenger():
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

    assert evaluation["status"] == "manual_promotion_eligible"
    assert evaluation["candidate_cohorts"]["scanner_recurrence"] == "strengthened_seen"
    assert evaluation["learning_score"] > 65.0
    assert 0.0 < evaluation["counterfactual_weight"] <= 0.10
    assert evaluation["counterfactual_score"] > 65.0
    assert evaluation["applied_score"] == 65.0
    assert evaluation["applied_weight"] == 0.0
    assert evaluation["gates"] == {
        "independent_cycles": True,
        "process_quality": True,
        "comparable_cohorts": True,
        "manual_promotion": False,
    }
    assert evaluation["automatic_weight_changes"] is False


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
    }
