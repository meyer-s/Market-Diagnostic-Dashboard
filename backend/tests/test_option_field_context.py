from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.models.options_alerts import OptionAlertEvent
from app.services import market_weather_research
from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.option_field_context import (
    OPTION_FIELD_HORIZONS,
    OPTION_FIELD_MODEL_VERSION,
    OPTION_FIELD_SCHEMA_VERSION,
    OPTION_FIELD_SEMANTIC_REVISION,
    OPTION_FIELD_TARGET_WARMUP_BARS,
    build_option_field_context,
    option_field_context_from_event,
    option_field_event_fields,
)
from app.services.option_sweep_runs import _ranked_opportunity_from_event
from app.services.options_alerts import (
    _build_training_trade_lines,
    _contract_side_from_direction,
    _training_plan_inputs,
)
from maintenance_scripts import options_chain_sweep


def _history(periods: int = 100, *, end: str = "2026-07-22") -> pd.DataFrame:
    index = pd.bdate_range(end=end, periods=periods)
    step = np.arange(periods, dtype=float)
    close = 100.0 + step * 0.18 + np.sin(step / 4.0)
    return pd.DataFrame(
        {
            "Open": close - 0.25,
            "High": close + 1.0,
            "Low": close - 1.0,
            "Close": close,
            "Volume": 1_000_000.0 + step * 2_500.0,
        },
        index=index,
    )


def _walk_keys(value: object) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            keys.add(str(key))
            keys.update(_walk_keys(nested))
    elif isinstance(value, list):
        for nested in value:
            keys.update(_walk_keys(nested))
    return keys


def test_field_context_excludes_current_daily_bar_until_market_close_cutoff() -> None:
    history = _history()
    before_close = build_option_field_context(
        history,
        option_type="call",
        observed_at=datetime(2026, 7, 22, 19, 0, tzinfo=timezone.utc),  # 15:00 ET
        data_source="test",
    )
    after_close = build_option_field_context(
        history,
        option_type="call",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),  # 17:00 ET
        data_source="test",
    )

    assert before_close["as_of_bar"] == "2026-07-21"
    assert before_close["excluded_incomplete_bars"] == 1
    assert after_close["as_of_bar"] == "2026-07-22"
    assert after_close["excluded_incomplete_bars"] == 0


def test_incomplete_bar_values_cannot_change_causal_snapshot() -> None:
    original = _history()
    mutated = original.copy()
    mutated.loc[pd.Timestamp("2026-07-22"), ["Open", "High", "Low", "Close", "Volume"]] = [
        500.0,
        800.0,
        10.0,
        700.0,
        99_000_000.0,
    ]
    observed_at = datetime(2026, 7, 22, 19, 0, tzinfo=timezone.utc)

    left = build_option_field_context(original, option_type="call", observed_at=observed_at)
    right = build_option_field_context(mutated, option_type="call", observed_at=observed_at)

    for key in ("direction", "strata", "carriers", "price_action", "hypotheses", "classification"):
        assert left[key] == right[key]


def test_field_context_is_live_only_shadow_evidence() -> None:
    history = _history()
    payload = build_option_field_context(
        history,
        option_type="put",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
        data_source="yahoo",
    )
    direct_field = build_market_weather(
        history,
        horizons=OPTION_FIELD_HORIZONS,
        settings=MarketWeatherSettings(),
        include_retrospective_research=False,
        include_history_payload=False,
    )

    assert payload["schema_version"] == OPTION_FIELD_SCHEMA_VERSION
    assert payload["model_version"] == OPTION_FIELD_MODEL_VERSION
    assert payload["semantic_revision"] == OPTION_FIELD_SEMANTIC_REVISION
    assert payload["mode"] == "shadow_only"
    assert payload["rank_influence"] == 0.0
    assert payload["automated_execution_enabled"] is False
    assert payload["authority"] == {
        "scope": "direct_market_field_snapshot",
        "scanner_rank": "none",
        "hard_veto": "none",
        "manager_verdict": "none",
        "target_size": "none",
        "assessment_confidence": "advisory",
        "review_priority": "advisory",
        "human_visible": True,
        "automated_execution": "none",
        "downstream_outcome_learning": {
            "cohort_input_allowed": True,
            "authority_contract": "separately_versioned_bounded_canary",
            "note": payload["authority"]["downstream_outcome_learning"]["note"],
        },
    }
    assert payload["maturity"]["status"] == "complete"
    assert payload["maturity"]["target_warmup_bars"] == OPTION_FIELD_TARGET_WARMUP_BARS
    assert payload["initialization"]["minimum_input_bars"] == 60
    assert payload["initialization"]["minimum_input_satisfied"] is True
    assert payload["initialization"]["initialization_target_bars"] == OPTION_FIELD_TARGET_WARMUP_BARS
    assert payload["initialization"]["initialization_target_covered"] is True
    assert payload["initialization"]["initialization_status"] == "target_covered"
    coordinate_coverage = payload["initialization"]["state_vector_coverage"]
    assert coordinate_coverage["schema_version"] == "market_field_coordinate_coverage_v1"
    assert coordinate_coverage["coordinate_count"] == 15
    assert coordinate_coverage["analysis_bars"] == 100
    assert coordinate_coverage["initialization_target_covered"] is True
    assert coordinate_coverage["coverage_is_convergence"] is False
    assert all(
        row["initialization_target_covered"] is True
        for row in coordinate_coverage["features"]
    )
    assert payload["alignment"]["basis"] == "legacy_long_single_leg_option_type"
    assert payload["alignment"]["scope"] == "long_single_leg"
    assert payload["quality"]["available"] is True
    assert payload["quality"]["completed_bars_only"] is True
    assert payload["quality"]["data_source"] == "yahoo"
    assert payload["quality"]["as_of_bar"] == "2026-07-22"
    assert payload["analysis_identity"] is not None
    assert payload["analysis_identity"]["scope"] == (
        "recipe_and_normalized_input_identity"
    )
    assert payload["analysis_identity"]["provider_truth_verified"] is False
    for key in ("recipe_hash", "input_hash", "analysis_hash"):
        assert payload["analysis_identity"][key] == direct_field["provenance"][key]
    assert payload["direction"]["option_aligned_pressure"] == -payload["direction"]["pressure"]
    assert payload["direction"]["option_aligned_velocity"] == -payload["direction"]["velocity"]
    assert payload["scaling_reference"]["exact_arithmetic_contract"]["nonnegative"] is True
    assert payload["scaling_reference"]["exact_arithmetic_contract"]["violation_status"] == "invalid"
    assert not {
        "relationship_atlas",
        "lexicon",
        "validation",
        "outcomes",
        "optionality",
        "cross_market",
    }.intersection(_walk_keys(payload))


def test_field_context_does_not_execute_retrospective_research(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args: object, **kwargs: object) -> object:
        raise AssertionError("retrospective research must not run in scanner snapshots")

    monkeypatch.setattr(market_weather_research, "_build_relationship_atlas", fail)
    monkeypatch.setattr(market_weather_research, "_build_market_state_lexicon", fail)

    payload = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )

    assert payload["quality"]["available"] is True


def test_field_context_withholds_impossible_scaling_without_changing_hypotheses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_at = datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc)
    baseline = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=observed_at,
    )
    original = market_weather_research._log_horizon_scaling_exponent

    def inject_contract_violation(realized_volatility, horizons):
        values = original(realized_volatility, horizons)
        values[0, -1] = -0.25
        return values

    monkeypatch.setattr(
        market_weather_research,
        "_log_horizon_scaling_exponent",
        inject_contract_violation,
    )

    payload = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=observed_at,
    )

    assert payload["strata"]["scaling_exponent"] is None
    assert payload["scaling_reference"]["valid"] is False
    assert payload["scaling_reference"]["reason"] == (
        "negative_exponent_violates_exact_arithmetic_contract"
    )
    assert "scaling_exponent" in payload["quality"]["missing_features"]
    assert payload["hypotheses"] == baseline["hypotheses"]


def test_field_context_returns_stable_unavailable_shape_without_enough_bars() -> None:
    payload = build_option_field_context(
        _history(20),
        option_type=None,
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )

    assert payload["quality"]["available"] is False
    assert payload["quality"]["completed_bars_only"] is True
    assert set(payload["quality"]["missing_features"]) == {"option_type", "completed_daily_history"}
    assert payload["classification"] == {"path_state": "unavailable", "eventfulness": "unavailable"}
    assert payload["rank_influence"] == 0.0
    assert payload["maturity"]["status"] == "insufficient"
    assert payload["maturity"]["bars_needed"] == OPTION_FIELD_TARGET_WARMUP_BARS - 20
    assert payload["initialization"]["minimum_input_satisfied"] is False
    assert payload["initialization"]["initialization_target_covered"] is False
    assert payload["initialization"]["initialization_status"] == "minimum_not_satisfied"
    assert payload["analysis_identity"] is None


def test_field_context_requires_full_two_horizon_warmup_at_95_and_96_bars() -> None:
    observed_at = datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc)

    immature = build_option_field_context(
        _history(95),
        option_type="call",
        observed_at=observed_at,
    )
    mature = build_option_field_context(
        _history(96),
        option_type="call",
        observed_at=observed_at,
    )

    assert immature["quality"]["available"] is False
    assert immature["maturity"]["status"] == "insufficient"
    assert immature["maturity"]["warmup_complete"] is False
    assert immature["maturity"]["bars_needed"] == 1
    assert immature["initialization"]["minimum_input_satisfied"] is True
    assert immature["initialization"]["initialization_target_covered"] is False
    assert immature["initialization"]["initialization_status"] == "minimum_satisfied"
    assert "requires_96_completed_bars" in immature["quality"]["warnings"]
    assert mature["quality"]["available"] is True
    assert mature["maturity"]["status"] == "complete"
    assert mature["maturity"]["warmup_complete"] is True
    assert mature["maturity"]["bars_needed"] == 0
    assert mature["initialization"]["initialization_target_covered"] is True
    assert mature["initialization"]["initialization_status"] == "target_covered"


@pytest.mark.parametrize(
    ("option_type", "position_action", "expected_sign", "expected_scope"),
    [
        ("call", "buy_to_open", 1, "long_single_leg"),
        ("put", "buy_to_open", -1, "long_single_leg"),
        ("call", "sell_to_open", -1, "short_single_leg"),
        ("put", "sell_to_open", 1, "short_single_leg"),
    ],
)
def test_field_context_alignment_respects_position_action(
    option_type: str,
    position_action: str,
    expected_sign: int,
    expected_scope: str,
) -> None:
    payload = build_option_field_context(
        _history(),
        option_type=option_type,
        position_action=position_action,
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )

    assert payload["alignment"]["basis"] == "action_and_option_type"
    assert payload["alignment"]["scope"] == expected_scope
    assert payload["alignment"]["directional_exposure_sign"] == expected_sign
    assert payload["direction"]["option_aligned_pressure"] == pytest.approx(
        expected_sign * payload["direction"]["pressure"]
    )


def test_signed_delta_overrides_legacy_option_type_alignment() -> None:
    payload = build_option_field_context(
        _history(),
        option_type="call",
        signed_delta=-0.35,
        strategy_scope="multi_leg",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )

    assert payload["alignment"]["basis"] == "signed_delta"
    assert payload["alignment"]["scope"] == "multi_leg"
    assert payload["alignment"]["directional_exposure_sign"] == -1
    assert payload["direction"]["option_aligned_pressure"] == pytest.approx(
        -payload["direction"]["pressure"]
    )


def test_multi_leg_alignment_abstains_without_signed_delta() -> None:
    payload = build_option_field_context(
        _history(),
        option_type="call",
        position_action="buy_to_open",
        strategy_scope="multi_leg",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )

    assert payload["alignment"]["supported"] is False
    assert payload["alignment"]["basis"] == "unsupported"
    assert payload["direction"]["option_aligned_pressure"] is None
    assert payload["classification"]["path_state"] == "unavailable"
    assert payload["quality"]["status"] == "limited"
    assert "directional_alignment" in payload["quality"]["missing_features"]


def test_event_snapshot_round_trip_is_immutable_shadow_context() -> None:
    payload = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )
    payload["rank_influence"] = 99.0
    payload["authority"] = {"automated_execution": "full"}
    fields = option_field_event_fields(payload)
    event = OptionAlertEvent(symbol="SPY", **fields)

    restored = option_field_context_from_event(event)

    assert event.field_context_version == OPTION_FIELD_SCHEMA_VERSION
    assert event.field_context_as_of == datetime(2026, 7, 22)
    assert json.loads(event.field_context_json)["rank_influence"] == 0.0
    assert restored is not None
    assert restored["rank_influence"] == 0.0
    assert restored["model_version"] == OPTION_FIELD_MODEL_VERSION
    assert restored["automated_execution_enabled"] is False
    assert restored["authority"]["automated_execution"] == "none"
    assert restored["authority"]["manager_verdict"] == "none"


def test_legacy_event_readback_is_not_relabelled_as_current_semantics() -> None:
    event = OptionAlertEvent(
        symbol="SPY",
        field_context_version=OPTION_FIELD_SCHEMA_VERSION,
        field_context_json=json.dumps(
            {
                "schema_version": OPTION_FIELD_SCHEMA_VERSION,
                "model_version": OPTION_FIELD_MODEL_VERSION,
                "option_type": "call",
                "completed_bars": 250,
                "quality": {"available": True},
                "classification": {"path_state": "supportive"},
            }
        ),
    )

    restored = option_field_context_from_event(event)

    assert restored is not None
    assert restored["semantic_revision"] == "1.0"
    assert restored["maturity"]["status"] == "complete"
    assert restored["initialization"]["initialization_target_covered"] is True
    assert restored["alignment"]["basis"] == "legacy_long_single_leg_option_type"


def test_scanner_serialization_exposes_field_context_without_changing_rank() -> None:
    base_kwargs = {
        "id": 1,
        "symbol": "SPY",
        "triggered_at": datetime(2026, 7, 22, 21, 0),
        "iv_percentile": 9.0,
        "iv30": 18.0,
        "hv30": 24.0,
        "avg_edr": 25.0,
        "selected_spread_pct": 8.0,
        "selected_open_interest": 900,
        "selected_volume": 120,
        "selected_reward_risk": 2.2,
        "selected_convexity_profit_pct": 60.0,
        "selected_convexity_probability_itm": 0.55,
        "selected_contract_score": 80.0,
    }
    without_field = OptionAlertEvent(**base_kwargs)
    field_payload = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )
    with_field = OptionAlertEvent(**{**base_kwargs, "id": 2}, **option_field_event_fields(field_payload))

    baseline = _ranked_opportunity_from_event(without_field)
    enriched = _ranked_opportunity_from_event(with_field)

    assert baseline["score"] == enriched["score"]
    assert baseline["components"] == enriched["components"]
    assert baseline["field_context"] is None
    assert enriched["field_context"]["schema_version"] == OPTION_FIELD_SCHEMA_VERSION
    assert enriched["field_context"]["rank_influence"] == 0.0


def test_neutral_direction_abstains_from_contract_side_and_training_selection() -> None:
    history = _history()
    assert _contract_side_from_direction("Neutral") is None
    plan = _training_plan_inputs("Neutral", 18.0, 22.0, {"1m": 0.5}, history)
    assert plan["contract_side"] is None
    assert plan["target_price"] is None
    assert plan["stop_price"] is None

    lines = _build_training_trade_lines(
        "Neutral",
        10.0,
        18.0,
        22.0,
        25.0,
        20.0,
        {"1m": 0.5},
        history,
        provider=object(),
        symbol="SPY",
    )
    rendered = "\n".join(lines)
    assert "no CALL/PUT training contract selected" in rendered
    assert "optimized CALL" not in rendered
    assert "optimized PUT" not in rendered


def test_sweep_persists_field_snapshot_on_every_emitted_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    history = _history()

    class FakeProvider:
        name = "test"

        def quote(self, symbol: str) -> SimpleNamespace:
            return SimpleNamespace(price=120.0)

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            return history

        def source_for(self, method: str) -> str:
            return "test_history"

    class FakeSession:
        def __init__(self) -> None:
            self.events: list[OptionAlertEvent] = []

        def add(self, event: OptionAlertEvent) -> None:
            self.events.append(event)

        def flush(self) -> None:
            return None

        def commit(self) -> None:
            return None

    session = FakeSession()

    @contextmanager
    def fake_session() -> object:
        yield session

    monkeypatch.setattr(options_chain_sweep, "get_market_data_provider", lambda key: FakeProvider())
    monkeypatch.setattr(options_chain_sweep, "compute_historical_volatility", lambda frame, days: 24.0)
    monkeypatch.setattr(
        options_chain_sweep,
        "compute_optionality_metrics",
        lambda *args, **kwargs: {
            "iv30_chain_percentile": 90.0,
            "iv_percentile": None,
            "iv30": 23.0,
            "hv30": 24.0,
            "avg_edr": 50.0,
            "data_source": "test_options",
            "quote_source": "test",
        },
    )
    monkeypatch.setattr(options_chain_sweep, "_direction_hint", lambda frame: ("Calls", "test trend"))
    monkeypatch.setattr(options_chain_sweep, "_select_training_contract", lambda **kwargs: None)
    monkeypatch.setattr(options_chain_sweep, "_format_alert_message", lambda *args, **kwargs: "test alert")
    monkeypatch.setattr(options_chain_sweep, "_send_webhook", lambda *args, **kwargs: (False, None, "test"))
    monkeypatch.setattr(options_chain_sweep, "get_db_session", fake_session)
    monkeypatch.setattr(options_chain_sweep, "record_scanner_recurrence_events", lambda db, event: None)

    hits = options_chain_sweep._scan_tickers(
        ["SPY"],
        "Test",
        threshold=100.0,
        max_count=1,
        pause_seconds=0.0,
        market_data_provider="test",
    )

    assert hits == 1
    assert len(session.events) == 1
    event = session.events[0]
    assert event.iv_percentile == 90.0
    assert event.field_context_version == OPTION_FIELD_SCHEMA_VERSION
    snapshot = json.loads(event.field_context_json)
    assert snapshot["quality"]["available"] is True
    assert snapshot["quality"]["data_source"] == "test_history"
    assert snapshot["rank_influence"] == 0.0
    assert snapshot["alignment"]["basis"] == "action_and_option_type"
    assert snapshot["alignment"]["scope"] == "single_leg"
