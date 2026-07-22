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
        "semantic_revision": "1.1",
        "computed_at": "2026-07-22T15:00:00+00:00",
        "as_of_bar": "2026-07-21T00:00:00+00:00",
        "timeframe": "1D",
        "quality": {"available": True, "completed_bars_only": True, "observations": 250},
        "input_quality": {"rows_received": 250, "rows_used": 250},
        "maturity": {"status": "complete", "warmup_complete": True, "completed_bars": 250},
        "alignment": {"supported": True, "basis": "action_and_option_type"},
        "authority": {"scanner_rank": "none", "automated_execution": "none"},
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
    assert compact["semantic_revision"] == "1.1"
    assert compact["maturity"]["status"] == "complete"
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


def test_v12_cohort_uses_canonical_initialization_without_relabelling_v11() -> None:
    current = _field_context("supportive")
    current["semantic_revision"] = "1.2"
    current["initialization"] = {
        "minimum_input_satisfied": True,
        "initialization_target_covered": True,
        "initialization_status": "target_covered",
        "completed_bars": 250,
    }

    compact = _compact_market_field(current)

    assert compact is not None
    assert compact["semantic_revision"] == "1.2"
    assert compact["initialization"]["initialization_target_covered"] is True
    assert _market_field_cohort(compact) == "supportive"

    missing_initialization = _field_context("supportive")
    missing_initialization["semantic_revision"] = "1.2"
    assert _market_field_cohort(_compact_market_field(missing_initialization)) == "unavailable"


def test_unavailable_or_unknown_field_states_are_not_forced_into_a_cohort() -> None:
    unavailable = _field_context("supportive")
    unavailable["quality"] = {"available": False}

    assert _compact_market_field(unavailable) is None
    assert _market_field_cohort(_compact_market_field(unavailable)) == "unavailable"
    assert _market_field_cohort({"classification": {"path_state": "new_label"}}) == "unavailable"


def test_legacy_and_incomplete_snapshots_do_not_mix_with_supported_cohorts() -> None:
    legacy = _field_context("supportive")
    legacy.pop("semantic_revision")
    legacy.pop("maturity")
    immature = _field_context("supportive")
    immature["maturity"] = {"status": "insufficient", "warmup_complete": False, "completed_bars": 60}
    unsupported = _field_context("supportive")
    unsupported["alignment"] = {"supported": False, "basis": "unsupported"}

    assert _compact_market_field(legacy) is not None
    assert _market_field_cohort(_compact_market_field(legacy)) == "unavailable"
    assert _market_field_cohort(_compact_market_field(immature)) == "unavailable"
    assert _market_field_cohort(_compact_market_field(unsupported)) == "unavailable"
