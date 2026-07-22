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
from app.services.option_field_context import (
    OPTION_FIELD_MODEL_VERSION,
    OPTION_FIELD_SCHEMA_VERSION,
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
    payload = build_option_field_context(
        _history(),
        option_type="put",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
        data_source="yahoo",
    )

    assert payload["schema_version"] == OPTION_FIELD_SCHEMA_VERSION
    assert payload["model_version"] == OPTION_FIELD_MODEL_VERSION
    assert payload["mode"] == "shadow_only"
    assert payload["rank_influence"] == 0.0
    assert payload["automated_execution_enabled"] is False
    assert payload["quality"]["available"] is True
    assert payload["quality"]["completed_bars_only"] is True
    assert payload["quality"]["data_source"] == "yahoo"
    assert payload["quality"]["as_of_bar"] == "2026-07-22"
    assert payload["direction"]["option_aligned_pressure"] == -payload["direction"]["pressure"]
    assert payload["direction"]["option_aligned_velocity"] == -payload["direction"]["velocity"]
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


def test_event_snapshot_round_trip_is_immutable_shadow_context() -> None:
    payload = build_option_field_context(
        _history(),
        option_type="call",
        observed_at=datetime(2026, 7, 22, 21, 0, tzinfo=timezone.utc),
    )
    payload["rank_influence"] = 99.0
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
            "iv_percentile": 10.0,
            "iv30": 17.0,
            "hv30": 24.0,
            "avg_edr": 25.0,
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
        threshold=20.0,
        max_count=1,
        pause_seconds=0.0,
        market_data_provider="test",
    )

    assert hits == 1
    assert len(session.events) == 1
    event = session.events[0]
    assert event.field_context_version == OPTION_FIELD_SCHEMA_VERSION
    snapshot = json.loads(event.field_context_json)
    assert snapshot["quality"]["available"] is True
    assert snapshot["quality"]["data_source"] == "test_history"
    assert snapshot["rank_influence"] == 0.0
