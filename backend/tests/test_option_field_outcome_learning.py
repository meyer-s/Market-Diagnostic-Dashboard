from __future__ import annotations

from app.models.option_decision_learning import OptionThesisAssessment
from app.services.option_decision_learning import (
    _assessment_market_field,
    _compact_market_field,
    _market_field_cohort,
)
from app.services.option_thesis_engine import json_dumps


def _field_context(path_state: str = "supportive") -> dict[str, object]:
    return {
        "schema_version": "option_market_field_v1",
        "model_version": "market_field_calculus_v1",
        "computed_at": "2026-07-22T15:00:00+00:00",
        "as_of_bar": "2026-07-21T00:00:00+00:00",
        "timeframe": "1D",
        "quality": {"available": True, "completed_bars_only": True, "observations": 250},
        "direction": {"option_aligned_pressure": 0.42, "option_aligned_velocity": 0.17},
        "classification": {
            "path_state": path_state,
            "eventfulness": "ordinary",
            "field_rank_eligible": False,
        },
        "relationship_atlas": {"future_return_winner": "must_not_survive"},
        "lexicon": {"holdout_outcomes": "must_not_survive"},
        "rank_influence": 0.0,
        "shadow_only": True,
    }


def test_field_outcome_snapshot_is_compact_and_excludes_retrospective_research() -> None:
    compact = _compact_market_field(_field_context())

    assert compact is not None
    assert compact["schema_version"] == "option_market_field_v1"
    assert compact["classification"]["field_rank_eligible"] is False
    assert "relationship_atlas" not in compact
    assert "lexicon" not in compact
    assert _market_field_cohort(compact) == "supportive"


def test_assessment_field_snapshot_supports_the_versioned_top_level_contract() -> None:
    assessment = OptionThesisAssessment(
        input_snapshot_json=json_dumps({"field_context": _field_context("contradictory")})
    )

    snapshot = _assessment_market_field(assessment)

    assert snapshot is not None
    assert _market_field_cohort(snapshot) == "contradictory"


def test_unavailable_or_unknown_field_states_are_not_forced_into_a_cohort() -> None:
    unavailable = _field_context("supportive")
    unavailable["quality"] = {"available": False}

    assert _compact_market_field(unavailable) is None
    assert _market_field_cohort(_compact_market_field(unavailable)) == "unavailable"
    assert _market_field_cohort({"classification": {"path_state": "new_label"}}) == "unavailable"
