from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta
import json
import sys
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

ibkr_cli_module = types.ModuleType("ibkr_cli")
ib_service_module = types.ModuleType("ibkr_cli.ib_service")
ib_service_module._capture_ib_errors = lambda *args, **kwargs: None  # noqa: SLF001, ANN002, ANN003
ib_service_module._quote_has_useful_prices = lambda *_args, **_kwargs: False  # noqa: SLF001
ib_service_module._quote_snapshot_payload = lambda *_args, **_kwargs: {}  # noqa: SLF001
ib_service_module._suppress_ib_async_logs = lambda *args, **kwargs: None  # noqa: SLF001, ANN002, ANN003
ib_service_module.ib_session = lambda *args, **kwargs: None  # noqa: ANN002, ANN003
sys.modules.setdefault("ibkr_cli", ibkr_cli_module)
sys.modules.setdefault("ibkr_cli.ib_service", ib_service_module)

from app.api import secret_options
from app.core.config import settings
from app.core.db import Base
from app.models.closed_positions import ClosedPosition
from app.models.option_training_outcomes import OptionTrainingOutcome
from app.models.option_position_reviews import OptionPositionReview
from app.models.option_decision_learning import (
    OptionModelRegistry,
    OptionPositionEvent,
    OptionPositionMandate,
    OptionRiskPolicy,
    OptionThesisAssessment,
    OptionTradeOutcome,
)
from app.models.option_trade_reminders import OptionTradeReminder
from app.models.options_alerts import OptionAlertEvent
from app.models.option_sweep_runs import OptionSweepRun
from app.models.option_positions import OptionPosition
from app.services import option_trade_reminders
from app.services import option_sweep_runs
from app.services.option_decision_learning import create_trade_outcome, learning_summary
from app.services.scanner_repeat_evidence import (
    load_scanner_repeat_evidence_context,
    position_match_for_event,
    record_scanner_recurrence_events,
)
from app.services.optionality_clusters import build_optionality_cluster_payload, classify_optionality_symbol


class _FakeQuery:
    def order_by(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
        return self

    def all(self):
        return [object()]


class _FakeDb:
    def query(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
        return _FakeQuery()


@contextmanager
def _fake_db_session():
    yield _FakeDb()


def test_positions_endpoint_replaces_non_finite_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    app = FastAPI()
    app.include_router(secret_options.router)
    with secret_options._POSITION_METRICS_CACHE_LOCK:
        secret_options._POSITION_METRICS_CACHE.clear()
    compute_count = 0
    scheduled_refreshes = 0

    def compute_metrics(_position, _provider=None):
        nonlocal compute_count
        compute_count += 1
        return {
            "market": {"current_price": float("nan")},
            "volatility": float("inf"),
            "greeks": {"delta": float("-inf")},
        }

    def schedule_refresh(_positions):
        nonlocal scheduled_refreshes
        if not _positions:
            return False
        scheduled_refreshes += 1
        return True

    monkeypatch.setattr(secret_options, "get_db_session", _fake_db_session)
    monkeypatch.setattr(secret_options, "_schedule_position_metrics_refresh", schedule_refresh)
    monkeypatch.setattr(
        secret_options,
        "_serialize_position",
        lambda _position, _evaluation_window=None: {
            "id": 1,
            "symbol": "TEST",
            "trade_date": "2026-06-17",
            "expiration": "2026-07-17",
            "strike": 10.0,
            "option_type": "call",
        },
    )
    monkeypatch.setattr(
        secret_options,
        "_compute_position_metrics",
        compute_metrics,
    )

    response = TestClient(app).get("/secret/options/positions")

    assert response.status_code == 200
    response_body = response.json()
    metrics = response_body["positions"][0]["metrics"]
    assert metrics["market"]["current_price"] is None
    assert metrics["volatility"] is None
    assert metrics["greeks"]["delta"] is None
    assert response_body["metrics_cache"]["status"] == "fresh"
    assert compute_count == 1

    forced_response = TestClient(app).get("/secret/options/positions?refresh=true")

    assert forced_response.status_code == 200
    assert forced_response.json()["metrics_cache"]["status"] == "stale"
    assert forced_response.json()["metrics_cache"]["refresh_in_progress"] is True
    assert compute_count == 1
    assert scheduled_refreshes == 1

    with secret_options._POSITION_METRICS_CACHE_LOCK:
        cache_key = next(iter(secret_options._POSITION_METRICS_CACHE))
        _cached_at, cached_metrics = secret_options._POSITION_METRICS_CACHE[cache_key]
        secret_options._POSITION_METRICS_CACHE[cache_key] = (0.0, cached_metrics)

    stale_response = TestClient(app).get("/secret/options/positions")

    assert stale_response.status_code == 200
    assert stale_response.json()["metrics_cache"]["status"] == "stale"
    assert stale_response.json()["metrics_cache"]["refresh_in_progress"] is True
    assert compute_count == 1
    assert scheduled_refreshes == 2
    with secret_options._POSITION_METRICS_CACHE_LOCK:
        secret_options._POSITION_METRICS_CACHE.clear()


def test_quote_payload_preserves_market_data_source() -> None:
    row = pd.Series(
        {
            "bid": 1.1,
            "ask": 1.3,
            "lastPrice": 1.2,
            "volume": 10,
            "openInterest": 50,
            "impliedVolatility": 0.42,
            "dataSource": "ibkr",
            "quoteSource": "delayed",
        }
    )

    payload = secret_options._quote_payload_from_row(row)

    assert payload["data_source"] == "ibkr"
    assert payload["quote_source"] == "delayed"
    assert payload["bid"] == 1.1
    assert payload["ask"] == 1.3


def test_empty_position_metrics_preserves_current_field_contract() -> None:
    payload = secret_options._empty_position_metrics("fixture failure")
    field = payload["field_context"]

    assert field["semantic_revision"] == "1.3"
    assert field["authority"]["manager_verdict"] == "none"
    assert field["authority"]["automated_execution"] == "none"
    assert field["maturity"]["status"] == "insufficient"
    assert field["alignment"]["supported"] is False
    assert field["input_quality"]["rows_used"] == 0
    assert "position_metrics_unavailable" in field["quality"]["warnings"]
    assert payload["error"] == "fixture failure"


def test_position_metrics_reuses_daily_history_for_causal_field_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    history = pd.DataFrame(
        {
            "Open": [99.0, 100.0],
            "High": [101.0, 102.0],
            "Low": [98.0, 99.0],
            "Close": [100.0, 101.0],
            "Volume": [1_000_000, 1_100_000],
        },
        index=pd.to_datetime(["2026-07-20", "2026-07-21"]),
    )
    calls: dict[str, object] = {}

    class Provider:
        name = "fixture_provider"

        def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
            calls["daily_bars"] = (symbol, days)
            return history

    field_context = {
        "schema_version": "option_market_field_v1",
        "mode": "shadow_only",
        "rank_influence": 0.0,
        "quality": {"available": True, "status": "complete", "warnings": []},
        "classification": {"path_state": "supportive", "eventfulness": "normal"},
        "hypotheses": {},
        "direction": {
            "option_aligned_pressure": 0.4,
            "option_aligned_velocity": 0.2,
        },
    }

    def field_builder(frame, **kwargs):
        calls["field_frame"] = frame
        calls["field_kwargs"] = kwargs
        return field_context

    def technical_builder(frame):
        calls["technical_frame"] = frame
        return {"price": 101.0, "observations": 2}

    monkeypatch.setattr(
        secret_options,
        "_market_data_for_symbol",
        lambda *_args, **_kwargs: {
            "current_price": 101.0,
            "last_updated": "2026-07-21T20:00:00Z",
            "data_source": "ibkr",
        },
    )
    monkeypatch.setattr(secret_options, "_resolve_option_row", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(secret_options, "compute_historical_volatility", lambda *_args: 25.0)
    monkeypatch.setattr(secret_options, "technical_snapshot_from_frame", technical_builder)
    monkeypatch.setattr(secret_options, "build_option_field_context", field_builder)
    monkeypatch.setattr(secret_options, "_compute_volatility_signal", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(secret_options, "_compute_position_opportunity_signal", lambda *_args: None)

    position = types.SimpleNamespace(
        symbol="SYY",
        expiration=date.today() + timedelta(days=60),
        option_type="call",
        action="Buy to Open",
        strike=105.0,
        underlying_reference=100.0,
        underlying_at_entry=99.0,
        fill_price=2.0,
        contracts=2,
        total_cost=400.0,
        source_event_id=None,
    )

    metrics = secret_options._compute_position_metrics(position, Provider())

    assert calls["daily_bars"] == ("SYY", 180)
    assert calls["technical_frame"] is history
    assert calls["field_frame"] is history
    assert calls["field_kwargs"] == {
        "option_type": "call",
        "position_action": "Buy to Open",
        "strategy_scope": "single_leg",
        "observed_at": datetime(2026, 7, 21, 20, 0),
        "data_source": "ibkr",
        "timeframe": "1D",
    }
    assert metrics["field_context"] == field_context
    assert metrics["pnl"] == {"dollar": None, "percent": None, "source": None}


def test_position_metrics_does_not_report_flat_pnl_without_current_market_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    history = pd.DataFrame(
        {"Close": [99.0, 100.0]},
        index=pd.to_datetime(["2026-07-20", "2026-07-21"]),
    )

    class Provider:
        name = "fixture_provider"

        def daily_bars(self, _symbol: str, days: int = 365) -> pd.DataFrame:
            return history

    monkeypatch.setattr(
        secret_options,
        "_market_data_for_symbol",
        lambda *_args, **_kwargs: {
            "current_price": None,
            "last_updated": "2026-07-21T20:00:00Z",
            "data_source": "fixture_provider",
        },
    )
    monkeypatch.setattr(secret_options, "_resolve_option_row", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(secret_options, "compute_historical_volatility", lambda *_args: 25.0)
    monkeypatch.setattr(secret_options, "technical_snapshot_from_frame", lambda *_args: {})
    monkeypatch.setattr(secret_options, "build_option_field_context", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(secret_options, "_compute_volatility_signal", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(secret_options, "_compute_position_opportunity_signal", lambda *_args: None)

    position = types.SimpleNamespace(
        symbol="KVUE",
        expiration=date.today() + timedelta(days=60),
        option_type="call",
        action="Buy to Open",
        strike=19.0,
        underlying_reference=20.0,
        underlying_at_entry=20.0,
        fill_price=1.09,
        contracts=50,
        total_cost=5_450.0,
        source_event_id=None,
    )

    metrics = secret_options._compute_position_metrics(position, Provider())

    # The entry/reference spot still supports model context, but neither it nor
    # a live underlying quote can replace a current contract mark for P&L.
    assert metrics["greeks"] is not None
    assert metrics["pnl"] == {"dollar": None, "percent": None, "source": None}


def test_legacy_discord_training_recipe_derives_gate() -> None:
    message = """
---
**CVS** — S&P 500 (SPY/IVV)

**Directional Bias**
- **Short-term Bearish** — 20d return -7.0%, price below 50D MA
- **1m**: Bearish (-6.6%)
---
"""

    recipe = secret_options._extract_training_recipe(message)

    assert recipe["option_type"] == "put"
    assert recipe["hold_days"] == 14
    assert recipe["review_min_hold_days"] == 6
    assert recipe["review_max_hold_days"] == 14


def test_training_recipe_extracts_review_window() -> None:
    message = "Setup: 1x optimized CALL\nReview Window: 3-8 trading days\nHold: 8 trading days"

    recipe = secret_options._extract_training_recipe(message)

    assert recipe["option_type"] == "call"
    assert recipe["review_min_hold_days"] == 3
    assert recipe["review_max_hold_days"] == 8
    assert recipe["hold_days"] == 8


def test_legacy_discord_training_recipe_uses_twenty_day_fallback() -> None:
    message = """
**Options Alert - S&P 500 (IVV)**
`NKE`
- Direction hint: **Calls** (20d return +15.2%, price above 50D MA)
"""

    recipe = secret_options._extract_training_recipe(message)

    assert recipe["option_type"] == "call"
    assert recipe["hold_days"] == 7


@pytest.fixture()
def secret_options_client(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    @contextmanager
    def _testing_db_session():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(secret_options.router)
    monkeypatch.setattr(secret_options, "get_db_session", _testing_db_session)
    monkeypatch.setattr(option_sweep_runs, "get_db_session", _testing_db_session)
    monkeypatch.setattr(
        secret_options,
        "_resolve_signal_attribution",
        lambda *_args, **_kwargs: {
            "source_event_id": None,
            "source_triggered_at": None,
            "source_match_method": None,
            "source_match_confidence": None,
            "source_match_notes": None,
        },
    )
    monkeypatch.setattr(
        secret_options,
        "_market_data_for_symbol",
        lambda *_args, **_kwargs: {"current_price": 100.0},
    )
    monkeypatch.setattr(secret_options, "get_market_data_provider", lambda: None)

    return TestClient(app), testing_session_local


def test_read_scope_get_matrix_does_not_mutate_database(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    read_key = "read-" + ("r" * 40)
    write_key = "write-" + ("w" * 40)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", read_key)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", write_key)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_ACTOR", "read-invariance-test")
    monkeypatch.setattr(
        secret_options,
        "_compute_position_metrics_batch",
        lambda positions: [secret_options._empty_position_metrics("test fixture") for _ in positions],
    )
    monkeypatch.setattr(secret_options, "_schedule_position_metrics_refresh", lambda _positions: False)

    with session_local() as db:
        position = OptionPosition(
            trade_date=date.today(),
            account="Read-only fixture",
            action="Buy to Open",
            contracts=1,
            symbol="READ",
            expiration=date.today() + timedelta(days=45),
            strike=100.0,
            option_type="call",
            fill_price=1.0,
            total_cost=100.0,
        )
        event = OptionAlertEvent(
            symbol="READ",
            triggered_at=datetime.utcnow(),
            selected_option_type="call",
            selected_expiry=(date.today() + timedelta(days=45)).isoformat(),
            selected_strike=100.0,
            selected_premium=1.0,
            message=(
                "Setup: 1x ATM CALL\n"
                f"Contract: {(date.today() + timedelta(days=45)).isoformat()} 100.0 CALL\n"
                "Hold: 10 trading days\nEst Prem: $1.00"
            ),
        )
        db.add_all([position, event])
        db.commit()
        position_id = int(position.id)

    tracked_models = (
        OptionPosition,
        OptionPositionMandate,
        OptionThesisAssessment,
        OptionRiskPolicy,
        OptionModelRegistry,
        OptionTrainingOutcome,
    )

    def counts() -> dict[str, int]:
        with session_local() as db:
            return {model.__tablename__: db.query(model).count() for model in tracked_models}

    before = counts()
    headers = {"Authorization": f"Bearer {read_key}"}
    responses = [
        client.get("/secret/options/positions", headers=headers),
        client.get(f"/secret/options/positions/{position_id}/thesis-assessment", headers=headers),
        client.get("/secret/options/risk-policy", headers=headers),
        client.get("/secret/options/learning-summary", headers=headers),
        client.get(
            "/secret/options/training-outcomes",
            params={"lookback_days": 365, "limit": 50},
            headers=headers,
        ),
    ]

    assert [response.status_code for response in responses] == [200, 404, 200, 200, 200]
    assert responses[2].json()["risk_policy"]["id"] is None
    assert responses[4].json()["outcomes"] == []
    assert counts() == before


def test_market_field_registry_is_a_non_promoting_shadow_challenger(
    secret_options_client,
) -> None:
    _client, session_local = secret_options_client

    with session_local() as db:
        first = secret_options.ensure_model_registry(db)
        second = secret_options.ensure_model_registry(db)
        db.commit()
        rows = (
            db.query(OptionModelRegistry)
            .filter(OptionModelRegistry.model_key == "option_thesis_grader")
            .order_by(OptionModelRegistry.id.asc())
            .all()
        )

    assert first.id == second.id
    assert len(rows) == 2
    champion = next(row for row in rows if row.model_status == "champion")
    challenger = next(row for row in rows if row.model_status == "challenger")
    assert champion.model_version == "thesis_rules_v2"
    assert champion.feature_schema_version == "option_thesis_features_v2"
    assert challenger.model_version == "thesis_rules_v2_market_field_shadow_v1"
    assert challenger.feature_schema_version == "option_market_field_features_v1"
    challenger_metrics = secret_options.json_loads(challenger.metrics_json, {})
    promotion_gates = secret_options.json_loads(challenger.promotion_gates_json, {})
    assert challenger_metrics["mode"] == "advisory_shadow"
    assert challenger_metrics["rank_influence"] == 0.0
    assert challenger_metrics["automated_execution_enabled"] is False
    assert promotion_gates["incremental_out_of_sample_value_required"] is True
    assert promotion_gates["automatic_promotion"] is False


def _position_payload() -> dict[str, object]:
    return {
        "trade_date": "2026-06-01",
        "account": "Active Trading",
        "action": "Buy to Open",
        "contracts": 2,
        "symbol": "SYY",
        "expiration": "2026-07-17",
        "strike": 80.0,
        "option_type": "call",
        "fill_price": 1.35,
        "total_cost": 270.0,
        "underlying_at_entry": 78.5,
    }


def test_position_row_context_includes_index_membership_and_linked_scan(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    with secret_options._POSITION_INDEX_MEMBERSHIP_CACHE_LOCK:
        secret_options._POSITION_INDEX_MEMBERSHIP_CACHE = None

    def fake_universe(key: str):
        symbols = ["SYY", "AAPL"] if key == "SP500" else ["XYZ"]
        return types.SimpleNamespace(tickers=symbols)

    monkeypatch.setattr(secret_options, "resolve_sweep_universe", fake_universe)
    with session_local() as db:
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="completed",
        )
        db.add(run)
        db.flush()
        event = OptionAlertEvent(
            symbol="SYY",
            triggered_at=datetime(2026, 7, 15, 14, 30),
            sweep_run_id=run.id,
            opportunity_score=72.5,
            opportunity_grade="B",
            opportunity_model_version="opportunity_v1",
            selected_expiry="2026-08-21",
            selected_dte=37,
            selected_strike=80.0,
            selected_option_type="call",
            selected_premium=1.35,
            selected_convexity_profit_pct=65.0,
            selected_convexity_probability_itm=0.54,
        )
        db.add(event)
        db.flush()
        position = OptionPosition(
            trade_date=date(2026, 7, 15),
            account="Active Trading",
            action="Buy to Open",
            contracts=2,
            symbol="SYY",
            expiration=date(2026, 8, 21),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=270.0,
            source_event_id=event.id,
            source_triggered_at=event.triggered_at,
            source_match_method="exact_contract",
            source_match_confidence=0.96,
        )
        db.add(position)
        db.commit()
        position_id = position.id

    response = client.get("/secret/options/position-row-context")

    assert response.status_code == 200
    context = response.json()["contexts_by_position"][str(position_id)]
    assert context["index_memberships"] == [
        {"key": "SP500", "label": "SPY", "name": "S&P 500"}
    ]
    assert context["linked_trade"] is True
    assert context["scan"]["universe_label"] == "S&P 500"
    assert context["scan"]["opportunity_score"] == 72.5
    assert context["scan"]["selected_convexity_profit_pct"] == 65.0


def test_create_position_rejects_duplicate_resubmission(secret_options_client) -> None:
    client, _session_local = secret_options_client

    first = client.post("/secret/options/positions", json=_position_payload())
    second = client.post("/secret/options/positions", json=_position_payload())

    assert first.status_code == 200
    assert second.status_code == 409
    assert "Duplicate open position" in second.json()["detail"]


def _decision_review_payload() -> dict[str, object]:
    review_date = date.today()
    return {
        "review_date": review_date.isoformat(),
        "trade_role": "catalyst",
        "original_thesis": "Earnings should reset the revenue outlook higher.",
        "contract_thesis": "The August call should retain enough time after the event.",
        "expected_path": "Hold the earnings gap and make a new high within five sessions.",
        "catalyst": "Quarterly earnings",
        "confirmation_condition": "Close above 82 within five sessions.",
        "invalidation_condition": "Close below 76 or surrender the earnings gap.",
        "risk_budget": 400.0,
        "evidence_since_last": "The event passed; the gap is holding so far.",
        "thesis_status": "intact",
        "fresh_entry_answer": "yes_smaller",
        "portfolio_fit": "Bullish exposure is already elevated.",
        "verdict": "reduce",
        "target_contracts": 1,
        "quality": "yellow",
        "urgency": "high",
        "confidence": "medium",
        "continuation_condition": "Keep one only while the gap holds.",
        "next_review_date": (review_date + timedelta(days=1)).isoformat(),
        "decision_deadline": (review_date + timedelta(days=7)).isoformat(),
        "decision_notes": "Use a limit order for the reduction.",
    }


def test_decision_reviews_are_append_only_and_capture_market_snapshot(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    created = client.post(
        "/secret/options/positions",
        json={**_position_payload(), "expiration": "2026-08-21"},
    )
    position_id = created.json()["position"]["id"]
    monkeypatch.setattr(
        secret_options,
        "_compute_position_metrics",
        lambda *_args, **_kwargs: {
            "market": {"current_price": 79.5, "last_updated": "2026-07-15T15:30:00Z"},
            "option_price": 1.1,
            "quote": {"implied_volatility": 0.31, "quality": "live"},
            "volatility": 0.3,
            "dte": 2,
            "greeks": {"delta": 0.45, "theta": -0.08},
            "pnl": {"dollar": -50.0, "percent": -18.52},
        },
    )

    first = client.post(
        f"/secret/options/positions/{position_id}/decision-reviews",
        json=_decision_review_payload(),
    )
    second_payload = {
        **_decision_review_payload(),
        "review_date": date.today().isoformat(),
        "evidence_since_last": "The gap failed on the third session.",
        "thesis_status": "weakened",
        "fresh_entry_answer": "no_underlying_valid",
        "verdict": "close",
        "target_contracts": 0,
        "quality": "red",
        "urgency": "critical",
        "next_review_date": None,
        "decision_deadline": date.today().isoformat(),
    }
    second = client.post(
        f"/secret/options/positions/{position_id}/decision-reviews",
        json=second_payload,
    )
    history = client.get(f"/secret/options/positions/{position_id}/decision-reviews")
    rail_windows = client.get("/secret/options/decision-review-windows")

    assert first.status_code == 200
    assert second.status_code == 200
    assert history.status_code == 200
    assert rail_windows.status_code == 200
    first_review = first.json()["review"]
    second_review = second.json()["review"]
    assert first_review["review_type"] == "mandate"
    assert first_review["snapshot"]["remaining_capital"] == pytest.approx(220.0)
    assert first_review["snapshot"]["market_data_as_of"] == "2026-07-15T15:30:00"
    assert second_review["review_type"] == "reassessment"
    assert second_review["supersedes_review_id"] == first_review["id"]
    assert history.json()["review_count"] == 2
    assert [row["review_sequence"] for row in history.json()["history"]] == [2, 1]
    assert history.json()["latest_review"]["evidence_since_last"] == "The gap failed on the third session."
    assert rail_windows.json()["window_count"] == 2
    assert rail_windows.json()["windows_by_position"][str(position_id)] == [
        {
            "id": second_review["id"],
            "position_id": position_id,
            "review_sequence": 2,
            "review_date": date.today().isoformat(),
            "next_review_date": None,
            "decision_deadline": date.today().isoformat(),
        },
        {
            "id": first_review["id"],
            "position_id": position_id,
            "review_sequence": 1,
            "review_date": date.today().isoformat(),
            "next_review_date": (date.today() + timedelta(days=1)).isoformat(),
            "decision_deadline": (date.today() + timedelta(days=7)).isoformat(),
        },
    ]
    with session_local() as db:
        assert db.query(OptionPositionReview).count() == 2


def test_automatic_assessment_prefills_review_and_close_learning(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    created = client.post(
        "/secret/options/positions",
        json={
            **_position_payload(),
            "expiration": (date.today() + timedelta(days=60)).isoformat(),
        },
    )
    position_id = created.json()["position"]["id"]
    metrics_compute_count = 0

    def position_metrics(*_args, **_kwargs):
        nonlocal metrics_compute_count
        metrics_compute_count += 1
        return {
            "market": {
                "current_price": 79.5,
                "last_updated": "2026-07-15T15:30:00Z",
                "data_source": "test",
            },
            "option_price": 1.1,
            "quote": {
                "bid": 1.0,
                "ask": 1.2,
                "spread_pct": 18.18,
                "implied_volatility": 0.31,
                "quality": "live",
            },
            "volatility": 0.3,
            "dte": 30,
            "greeks": {"delta": 0.45, "theta": -0.08},
            "pnl": {"dollar": -50.0, "percent": -18.52},
            "technical_snapshot": {
                "price": 79.5,
                "sma20": 78.0,
                "sma50": 77.0,
                "sma20_slope_pct": 1.0,
                "rsi14": 55.0,
                "macd_hist": 0.2,
            },
        }

    monkeypatch.setattr(
        secret_options,
        "_compute_position_metrics",
        position_metrics,
    )

    assessment_response = client.post(
        f"/secret/options/positions/{position_id}/thesis-assessment"
    )

    assert assessment_response.status_code == 200
    assessment_body = assessment_response.json()
    assert assessment_body["automated_execution_enabled"] is False
    assert assessment_body["assessment"]["proposed_verdict"] in {
        "hold",
        "conditional_hold",
        "reduce",
        "replacement_candidate",
        "manual_review",
    }
    assert assessment_body["assessment"]["market_field_effects"]["execution_authority"] == "none"
    assert assessment_body["assessment"]["market_field_effects"]["verdict_changed"] is False
    assert assessment_body["review_defaults"]["selected_assessment_id"] == assessment_body["assessment"]["id"]
    assert assessment_body["mandate"]["threshold_origin"] == "system_draft"
    assert assessment_body["suggested_window"]["decision_deadline"] >= date.today().isoformat()
    if assessment_body["suggested_window"]["next_review_date"]:
        assert assessment_body["suggested_window"]["next_review_date"] > date.today().isoformat()
    assert assessment_body["suggested_window"]["decision_deadline"] in assessment_body["review_defaults"]["continuation_condition"]

    cached_assessment_response = client.get(
        f"/secret/options/positions/{position_id}/thesis-assessment"
    )

    assert cached_assessment_response.status_code == 200
    assert cached_assessment_response.json()["assessment"]["id"] == assessment_body["assessment"]["id"]
    assert metrics_compute_count == 1

    review_response = client.post(
        f"/secret/options/positions/{position_id}/decision-reviews",
        json={
            "review_date": date.today().isoformat(),
            "selected_assessment_id": assessment_body["assessment"]["id"],
            "threshold_approval_status": "approved",
        },
    )

    assert review_response.status_code == 200, review_response.json()
    review_body = review_response.json()
    assert review_body["review"]["decision_source"] == "human_confirmed_auto"
    assert review_body["review"]["human_override"] == "none"
    assert review_body["mandate"]["confirmation_status"] == "confirmed"
    assert review_body["mandate"]["threshold_approval_status"] == "approved"
    assert review_body["automated_execution_enabled"] is False

    close_response = client.request(
        "DELETE",
        f"/secret/options/positions/{position_id}",
        json={"exit_price": 1.25, "close_date": date.today().isoformat(), "notes": "test close"},
    )

    assert close_response.status_code == 200
    close_body = close_response.json()
    assert close_body["learning_outcome"]["source_position_id"] == position_id
    closed_log = client.get("/secret/options/closed-positions?limit=10").json()
    assert closed_log["closed_positions"][0]["learning_outcome"]["primary_lesson"]
    lifecycle = client.get(f"/secret/options/positions/{position_id}/lifecycle-events").json()
    assert {row["event_type"] for row in lifecycle["events"]} >= {"opened", "assessed", "reviewed", "closed"}
    with session_local() as db:
        assert db.query(OptionPositionMandate).count() == 2
        assert db.query(OptionThesisAssessment).count() == 1
        assert db.query(OptionTradeOutcome).count() == 1
        assert db.query(OptionPositionEvent).count() >= 4


def test_market_field_metamorphism_preserves_manual_lifecycle_execution_and_pnl_authority(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    expiration = date.today() + timedelta(days=60)

    def field_context(path_state: str) -> dict[str, object]:
        aligned_sign = 1.0 if path_state == "supportive" else -1.0
        return {
            "schema_version": "option_market_field_v1",
            "model_version": "market_field_calculus_v1",
            "semantic_revision": "1.3",
            "mode": "shadow_only",
            "shadow_only": True,
            "rank_influence": 0.0,
            "automated_execution_enabled": False,
            "available": True,
            "computed_at": "2026-07-25T20:05:00Z",
            "as_of_bar": "2026-07-24",
            "timeframe": "1D",
            "quality": {
                "available": True,
                "status": "complete",
                "completed_bars_only": True,
                "warnings": [],
            },
            "initialization": {
                "minimum_input_satisfied": True,
                "initialization_target_covered": True,
                "initialization_status": "target_covered",
                "state_vector_coverage": {
                    "schema_version": "market_field_coordinate_coverage_v1",
                    "coordinate_count": 15,
                    "initialization_target_covered": True,
                    "coverage_is_convergence": False,
                },
            },
            "maturity": {
                "status": "complete",
                "warmup_complete": True,
                "completed_bars": 250,
            },
            "alignment": {
                "supported": True,
                "basis": "action_and_option_type",
                "scope": "long_single_leg",
            },
            "authority": {
                "scanner_rank": "none",
                "hard_veto": "none",
                "manager_verdict": "none",
                "target_size": "none",
                "automated_execution": "none",
            },
            "direction": {
                "option_aligned_pressure": 0.42 * aligned_sign,
                "option_aligned_velocity": 0.27 * aligned_sign,
            },
            "strata": {
                "structure": 0.61,
                "kinematics": 0.48,
                "geometry": 0.55,
                "information": 0.72,
                "propagation": 0.31,
                "cascade_bias": 0.18 * aligned_sign,
            },
            "price_action": {
                "state": "breakout" if path_state == "supportive" else "breakdown",
                "support_distance_atr": 1.4 if path_state == "supportive" else -0.35,
                "resistance_distance_atr": 0.2 if path_state == "supportive" else 2.8,
            },
            "classification": {
                "path_state": path_state,
                "eventfulness": "ordinary",
                "field_rank_eligible": False,
            },
            "hypotheses": {
                "organized_expansion": path_state == "supportive",
                "longward_cascade": path_state == "supportive",
                "geometry_disorder_shock": False,
                "kinematic_exhaustion": path_state == "contradictory",
            },
        }

    contexts = {
        "SUP": field_context("supportive"),
        "CON": field_context("contradictory"),
    }
    position_ids: dict[str, int] = {}
    source_event_ids: dict[str, int] = {}
    with session_local() as db:
        for symbol, context in contexts.items():
            source_event = OptionAlertEvent(
                symbol=symbol,
                triggered_at=datetime.utcnow(),
                opportunity_score=60.0,
                opportunity_grade="B",
                opportunity_model_version="opportunity_v1",
                selected_expiry=expiration.isoformat(),
                selected_dte=60,
                selected_strike=105.0,
                selected_option_type="call",
                selected_premium=1.35,
                selected_bid=1.30,
                selected_ask=1.40,
                field_context_version="option_market_field_v1",
                field_context_json=json.dumps(context, sort_keys=True),
            )
            db.add(source_event)
            db.flush()
            position = OptionPosition(
                trade_date=date.today() - timedelta(days=5),
                account="Metamorphic authority fixture",
                action="Buy to Open",
                contracts=2,
                symbol=symbol,
                expiration=expiration,
                strike=105.0,
                option_type="call",
                fill_price=1.35,
                total_cost=270.0,
                underlying_at_entry=100.0,
                source_event_id=source_event.id,
                source_triggered_at=source_event.triggered_at,
                source_match_method="exact_contract",
                source_match_confidence=1.0,
            )
            db.add(position)
            db.flush()
            position_ids[symbol] = int(position.id)
            source_event_ids[symbol] = int(source_event.id)
        db.commit()

    def position_metrics(position, *_args, **_kwargs):
        return {
            "market": {
                "current_price": 102.0,
                "last_updated": "2026-07-25T20:00:00Z",
                "data_source": "test",
            },
            "option_price": 1.10,
            "quote": {
                "bid": 1.0,
                "ask": 1.2,
                "spread_pct": 18.18,
                "implied_volatility": 0.31,
                "quality": "live",
            },
            "volatility": 0.30,
            "dte": 60,
            "greeks": {"delta": 0.45, "theta": -0.08},
            "pnl": {"dollar": -50.0, "percent": -18.52},
            "technical_snapshot": {
                "price": 102.0,
                "sma20": 101.0,
                "sma50": 99.0,
                "sma20_slope_pct": 1.2,
                "rsi14": 56.0,
                "macd_hist": 0.3,
            },
            "field_context": contexts[position.symbol],
        }

    monkeypatch.setattr(secret_options, "_compute_position_metrics", position_metrics)

    assessments: dict[str, dict[str, object]] = {}
    for symbol, position_id in position_ids.items():
        response = client.post(
            f"/secret/options/positions/{position_id}/thesis-assessment"
        )
        assert response.status_code == 200, response.json()
        assessments[symbol] = response.json()

    supportive_assessment = assessments["SUP"]["assessment"]
    contradictory_assessment = assessments["CON"]["assessment"]
    for field in (
        "company_thesis_status",
        "contract_status",
        "portfolio_fit_status",
        "proposed_verdict",
        "proposed_target_contracts",
        "target_contracts_min",
        "target_contracts_max",
        "vetoes",
    ):
        assert supportive_assessment[field] == contradictory_assessment[field]
    for assessment in (supportive_assessment, contradictory_assessment):
        assert assessment["market_field_effects"]["rank_changed"] is False
        assert assessment["market_field_effects"]["veto_changed"] is False
        assert assessment["market_field_effects"]["verdict_changed"] is False
        assert assessment["market_field_effects"]["target_size_changed"] is False
        assert assessment["market_field_effects"]["execution_authority"] == "none"
    assert (
        supportive_assessment["axis_results"]["market_structure"]["status"]
        == "supportive"
    )
    assert (
        contradictory_assessment["axis_results"]["market_structure"]["status"]
        == "contradictory"
    )

    reviews: dict[str, dict[str, object]] = {}
    for symbol, position_id in position_ids.items():
        response = client.post(
            f"/secret/options/positions/{position_id}/decision-reviews",
            json={
                **_decision_review_payload(),
                "selected_assessment_id": assessments[symbol]["assessment"]["id"],
                "threshold_approval_status": "approved",
                "override_reason": "Metamorphic authority boundary fixture.",
            },
        )
        assert response.status_code == 200, response.json()
        reviews[symbol] = response.json()

    for field in (
        "contracts_snapshot",
        "verdict",
        "target_contracts",
        "risk_budget",
    ):
        assert reviews["SUP"]["review"][field] == reviews["CON"]["review"][field]
    for field in ("option_price", "pnl_dollar", "pnl_percent"):
        assert (
            reviews["SUP"]["review"]["snapshot"][field]
            == reviews["CON"]["review"]["snapshot"][field]
        )
    assert reviews["SUP"]["automated_execution_enabled"] is False
    assert reviews["CON"]["automated_execution_enabled"] is False

    manual_events: dict[str, dict[str, object]] = {}
    for symbol, position_id in position_ids.items():
        response = client.post(
            f"/secret/options/positions/{position_id}/lifecycle-events",
            json={
                "event_type": "partial_close",
                "quantity_after": 1,
                "execution_price": 1.10,
                "notes": "Manual log; intentionally does not mutate the position.",
            },
        )
        assert response.status_code == 200, response.json()
        manual_events[symbol] = response.json()

    for field in (
        "event_type",
        "quantity_before",
        "quantity_after",
        "execution_price",
        "total_cost_before",
        "total_cost_after",
    ):
        assert manual_events["SUP"]["event"][field] == manual_events["CON"]["event"][field]
    assert manual_events["SUP"]["position_mutated"] is False
    assert manual_events["CON"]["position_mutated"] is False
    assert manual_events["SUP"]["automated_execution_enabled"] is False
    assert manual_events["CON"]["automated_execution_enabled"] is False

    with session_local() as db:
        for symbol, position_id in position_ids.items():
            position = (
                db.query(OptionPosition)
                .filter(OptionPosition.id == position_id)
                .one()
            )
            assert (position.contracts, position.fill_price, position.total_cost) == (
                2,
                1.35,
                270.0,
            )
            source_event = (
                db.query(OptionAlertEvent)
                .filter(OptionAlertEvent.id == source_event_ids[symbol])
                .one()
            )
            assert (
                source_event.selected_expiry,
                source_event.selected_strike,
                source_event.selected_option_type,
                source_event.selected_premium,
                source_event.selected_bid,
                source_event.selected_ask,
            ) == (
                expiration.isoformat(),
                105.0,
                "call",
                1.35,
                1.30,
                1.40,
            )

    close_results: dict[str, dict[str, object]] = {}
    for symbol, position_id in position_ids.items():
        response = client.request(
            "DELETE",
            f"/secret/options/positions/{position_id}",
            json={
                "exit_price": 1.25,
                "close_date": date.today().isoformat(),
                "notes": "Identical manual close fixture.",
            },
        )
        assert response.status_code == 200, response.json()
        close_results[symbol] = response.json()

    assert close_results["SUP"]["pnl"] == close_results["CON"]["pnl"] == {
        "dollar": -20.0,
        "percent": pytest.approx(-20.0 / 270.0 * 100.0),
        "total_proceeds": 250.0,
    }
    with session_local() as db:
        closed_by_symbol = {
            row.symbol: row
            for row in db.query(ClosedPosition)
            .filter(ClosedPosition.symbol.in_(contexts))
            .all()
        }
        assert set(closed_by_symbol) == {"SUP", "CON"}
        for closed in closed_by_symbol.values():
            assert (
                closed.contracts,
                closed.fill_price,
                closed.total_cost,
                closed.exit_price,
                closed.total_proceeds,
                closed.dollar_pnl,
            ) == (2, 1.35, 270.0, 1.25, 250.0, -20.0)
        for symbol, position_id in position_ids.items():
            events = (
                db.query(OptionPositionEvent)
                .filter(OptionPositionEvent.position_id == position_id)
                .all()
            )
            manual = next(row for row in events if row.source == "manual_execution_log")
            closed_event = next(row for row in events if row.event_type == "closed")
            assert (
                manual.quantity_before,
                manual.quantity_after,
                manual.execution_price,
            ) == (2, 1, 1.10)
            assert (
                closed_event.quantity_before,
                closed_event.quantity_after,
                closed_event.execution_price,
            ) == (2, 0, 1.25)
            outcome = (
                db.query(OptionTradeOutcome)
                .filter(OptionTradeOutcome.source_position_id == position_id)
                .one()
            )
            outcome_metrics = json.loads(outcome.metrics_json)
            assert outcome_metrics["market_field_entry_cohort"] == (
                "supportive" if symbol == "SUP" else "contradictory"
            )


def test_decision_review_status_keeps_review_date_and_deadline_separate(secret_options_client) -> None:
    _client, session_local = secret_options_client
    position = OptionPosition(
        trade_date=date(2026, 6, 1),
        contracts=2,
        symbol="SYY",
        expiration=date(2026, 8, 21),
        strike=80.0,
        option_type="call",
        fill_price=1.35,
        total_cost=270.0,
    )
    with session_local() as db:
        db.add(position)
        db.commit()
        db.refresh(position)
        review = OptionPositionReview(
            position_id=position.id,
            review_sequence=1,
            review_date=date(2026, 7, 10),
            review_type="mandate",
            symbol="SYY",
            expiration=position.expiration,
            strike=position.strike,
            option_type="call",
            contracts_snapshot=2,
            trade_role="trend",
            original_thesis="Trend continuation.",
            contract_thesis="Enough time for continuation.",
            confirmation_condition="New high.",
            invalidation_condition="Close below support.",
            thesis_status="intact",
            fresh_entry_answer="conditional",
            verdict="conditional_hold",
            target_contracts=2,
            quality="yellow",
            urgency="high",
            confidence="medium",
            next_review_date=date(2026, 7, 12),
            decision_deadline=date(2026, 7, 20),
            underlying_price_snapshot=79.5,
            option_price_snapshot=1.1,
        )

    status = secret_options._position_review_status(review, position, today=date(2026, 7, 15))

    assert status["window_status"] == "review_overdue"
    assert status["review_due"] is True
    assert status["decision_deadline_missed"] is False
    assert "The active decision deadline has passed." not in status["addition_blockers"]


def test_latest_decision_review_replaces_old_modeled_process_window(secret_options_client) -> None:
    _client, session_local = secret_options_client
    with session_local() as db:
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            contracts=2,
            symbol="SYY",
            expiration=date(2026, 8, 21),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=270.0,
        )
        db.add(position)
        db.flush()
        db.add(
            OptionPositionReview(
                position_id=position.id,
                review_sequence=1,
                review_date=date(2026, 7, 15),
                review_type="mandate",
                symbol="SYY",
                expiration=position.expiration,
                strike=position.strike,
                option_type="call",
                contracts_snapshot=2,
                trade_role="trend",
                thesis_status="intact",
                fresh_entry_answer="conditional",
                verdict="conditional_hold",
                target_contracts=2,
                quality="yellow",
                urgency="high",
                confidence="medium",
                continuation_condition="Require a new high within five sessions.",
                next_review_date=date(2026, 7, 20),
                decision_deadline=date(2026, 7, 22),
            )
        )
        db.commit()
        db.refresh(position)

        window = secret_options._position_evaluation_window(db, position)

    assert window["evaluation_source"] == "decision_review"
    assert window["evaluation_start_date"] == "2026-07-15"
    assert window["evaluation_due_date"] == "2026-07-20"
    assert window["evaluation_decision_deadline"] == "2026-07-22"
    assert window["evaluation_hold_days"] == 5
    assert window["evaluation_window_basis"] == "Require a new high within five sessions."


def test_create_scanner_attributed_position_schedules_sell_reminder(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        db.add(
            OptionAlertEvent(
                symbol="SYY",
                triggered_at=datetime(2026, 6, 1, 14, 30),
                iv_percentile=4.0,
                selected_option_type="call",
                selected_expiry="2026-07-17",
                selected_strike=80.0,
                selected_premium=1.35,
                review_min_hold_days=7,
                review_max_hold_days=21,
                review_window_basis="test window",
                message="Setup: 1x ATM CALL\nContract: 2026-07-17 80.0 CALL\nReview Window: 7-21 trading days\nHold: 21 trading days\nEst Prem: $1.35",
            )
        )
        db.commit()
        event = db.query(OptionAlertEvent).one()

    monkeypatch.setattr(
        secret_options,
        "_resolve_signal_attribution",
        lambda *_args, **_kwargs: {
            "source_event_id": event.id,
            "source_triggered_at": event.triggered_at,
            "source_match_method": "exact",
            "source_match_confidence": 1.0,
            "source_match_notes": "test",
        },
    )

    response = client.post("/secret/options/positions", json=_position_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["position"]["evaluation_min_hold_days"] == 7
    assert body["position"]["evaluation_hold_days"] == 21
    assert body["position"]["evaluation_start_date"] == "2026-06-08"
    assert body["position"]["evaluation_due_date"] == "2026-06-22"
    assert body["position"]["evaluation_source"] == "sell_reminder"
    with session_local() as db:
        reminder = db.query(OptionTradeReminder).one()
        assert reminder.position_id == body["position"]["id"]
        assert reminder.source_event_id == event.id
        assert reminder.symbol == "SYY"
        assert reminder.reminder_date == date(2026, 6, 22)
        assert reminder.min_hold_days == 7
        assert reminder.hold_days == 21
        assert reminder.status == "pending"


def test_review_window_backfill_updates_linked_event_reminder_and_outcome(
    secret_options_client,
) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="SYY",
            triggered_at=datetime(2026, 6, 1, 14, 30),
            iv30=42.0,
            hv30=34.0,
            iv_percentile=4.0,
            avg_edr=2.4,
            selected_option_type="call",
            selected_expiry="2026-07-17",
            selected_dte=46,
            selected_strike=80.0,
            selected_premium=1.35,
            message=(
                "Setup: 1x ATM CALL\n"
                "Contract: 2026-07-17 80.0 CALL\n"
                "HORIZONS\n  1m +9.5%\n"
                "Hold: 21 trading days\n"
                "Est Prem: $1.35"
            ),
        )
        db.add(event)
        db.flush()
        position = OptionPosition(
            trade_date=date(2026, 6, 2),
            account="ACTIVE",
            action="BUY",
            contracts=1,
            symbol="SYY",
            expiration=date(2026, 7, 17),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=135.0,
            source_event_id=event.id,
            source_triggered_at=event.triggered_at,
            source_match_method="exact",
            source_match_confidence=1.0,
        )
        db.add(position)
        db.add(
            OptionTrainingOutcome(
                event_id=event.id,
                symbol="SYY",
                triggered_at=event.triggered_at,
                option_type="call",
                hold_days=21,
                entry_date=date(2026, 6, 2),
                recommended_exit_date=date(2026, 6, 23),
                status="pending",
                compute_status="ok",
                computed_at=datetime(2026, 6, 2, 15, 0),
            )
        )
        db.commit()

    response = client.post(
        "/secret/options/review-windows/backfill?lookback_days=3650&recompute_training=false"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["updated_events"] == 1
    assert body["reminders_updated"] == 1
    assert body["training_rows_stamped"] == 1
    with session_local() as db:
        event = db.query(OptionAlertEvent).one()
        reminder = db.query(OptionTradeReminder).one()
        outcome = db.query(OptionTrainingOutcome).one()
        assert event.review_min_hold_days is not None
        assert event.review_max_hold_days == 21
        assert reminder.min_hold_days == event.review_min_hold_days
        assert reminder.hold_days == event.review_max_hold_days
        assert outcome.review_min_hold_days == event.review_min_hold_days
        assert outcome.review_max_hold_days == event.review_max_hold_days


def test_linked_position_volatility_signal_tracks_entry_to_current(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _client, session_local = secret_options_client
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="SYY",
            triggered_at=datetime(2026, 6, 1, 14, 30),
            iv30=20.0,
            hv30=30.0,
            iv_percentile=5.0,
            avg_edr=40.0,
            selected_option_type="call",
            selected_expiry="2026-07-17",
            selected_strike=80.0,
            selected_premium=1.35,
            selected_implied_volatility=0.25,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            account="Active Trading",
            action="Buy to Open",
            contracts=2,
            symbol="SYY",
            expiration=date(2026, 7, 17),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=270.0,
            underlying_at_entry=78.5,
            source_event_id=event.id,
        )

    monkeypatch.setattr(
        secret_options,
        "compute_optionality_metrics",
        lambda *_args, **_kwargs: {
            "iv30": 28.0,
            "hv30": 32.0,
            "iv_percentile": 15.0,
            "avg_edr": 45.0,
            "data_source": "ibkr_option_chain",
            "quote_source": "delayed",
            "pricing_basis": "bid_ask_mid_then_last",
            "expiries_scanned": 3,
        },
    )

    signal = secret_options._compute_volatility_signal(
        position,
        object(),
        {"current_price": 100.0},
        {"implied_volatility": 0.33},
        hv30=32.0,
        include_chain_snapshot=True,
    )

    assert signal["entry"]["contract_iv"] == 25.0
    assert signal["entry"]["iv_hv_spread"] == -10.0
    assert signal["current"]["contract_iv"] == 33.0
    assert signal["current"]["iv_hv_spread"] == -4.0
    assert signal["trend"]["contract_iv_change"] == 8.0
    assert signal["trend"]["iv_hv_spread_change"] == 6.0
    assert signal["trend"]["contract_iv_state"] == "expanding"
    assert signal["trend"]["value_state"] == "expanding"


def test_volatility_signal_avoids_chain_scan_by_default(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _client, session_local = secret_options_client
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="SYY",
            triggered_at=datetime(2026, 6, 1, 14, 30),
            iv30=20.0,
            hv30=30.0,
            selected_option_type="call",
            selected_expiry="2026-07-17",
            selected_strike=80.0,
            selected_premium=1.35,
            selected_implied_volatility=0.25,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            contracts=2,
            symbol="SYY",
            expiration=date(2026, 7, 17),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=270.0,
            underlying_at_entry=78.5,
            source_event_id=event.id,
        )

    def _fail_chain_scan(*_args, **_kwargs):
        raise AssertionError("chain scan should be opt-in")

    monkeypatch.setattr(secret_options, "compute_optionality_metrics", _fail_chain_scan)

    signal = secret_options._compute_volatility_signal(
        position,
        object(),
        {"current_price": 100.0},
        {"implied_volatility": 0.33},
        hv30=32.0,
    )

    assert signal["entry"]["iv30"] == 20.0
    assert signal["current"]["contract_iv"] == 33.0
    assert signal["current"]["hv30"] == 32.0
    assert signal["current"]["iv30"] is None


def test_optionality_clusters_group_hospitality_hits() -> None:
    events = [
        OptionAlertEvent(
            id=1,
            symbol="MGM",
            triggered_at=datetime(2026, 7, 2, 14, 0),
            iv30=18.0,
            hv30=31.0,
            iv_percentile=5.0,
            avg_edr=30.0,
        ),
        OptionAlertEvent(
            id=2,
            symbol="HLT",
            triggered_at=datetime(2026, 7, 9, 14, 0),
            iv30=20.0,
            hv30=28.0,
            iv_percentile=8.0,
            avg_edr=34.0,
        ),
        OptionAlertEvent(
            id=3,
            symbol="CRVL",
            triggered_at=datetime(2026, 7, 3, 14, 0),
            iv30=22.0,
            hv30=30.0,
            iv_percentile=12.0,
            avg_edr=40.0,
        ),
    ]

    payload = build_optionality_cluster_payload(events, today=date(2026, 7, 10), lookback_days=21)
    clusters = {row["group"]: row for row in payload["clusters"]}

    assert classify_optionality_symbol("HLT").group == "Hospitality & Travel"
    assert classify_optionality_symbol("MGM").group == "Hospitality & Travel"
    assert classify_optionality_symbol("CRVL").group == "Health Care Services"
    assert clusters["Hospitality & Travel"]["symbols"] == ["HLT", "MGM"]
    assert clusters["Hospitality & Travel"]["hits"] == 2
    assert clusters["Hospitality & Travel"]["avg_iv_hv_spread"] == -10.5


def test_optionality_clusters_prioritize_classified_groups() -> None:
    events = [
        OptionAlertEvent(id=idx, symbol=f"ZZZ{idx}", triggered_at=datetime(2026, 7, 9, 14, 0))
        for idx in range(1, 7)
    ]
    events.append(OptionAlertEvent(id=7, symbol="MGM", triggered_at=datetime(2026, 7, 9, 14, 0)))

    payload = build_optionality_cluster_payload(events, today=date(2026, 7, 10), lookback_days=21)

    assert payload["clusters"][0]["group"] == "Hospitality & Travel"
    assert any(row["group"] == "Unclassified" for row in payload["clusters"])


def test_scanner_summary_tracks_runs_and_repeated_names(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        db.add_all(
            [
                OptionAlertEvent(
                    symbol="MGM",
                    triggered_at=now,
                    iv30=18.0,
                    hv30=31.0,
                    iv_percentile=5.0,
                    avg_edr=28.0,
                    selected_spread_pct=12.0,
                    selected_volume=24,
                    selected_open_interest=350,
                    selected_contract_score=4.5,
                    selected_reward_risk=1.9,
                    selected_convexity_profit_pct=93.0,
                    selected_convexity_probability_itm=0.57,
                    opportunity_score=86.0,
                    opportunity_grade="A+",
                    opportunity_model_version="heuristic_v1",
                    delivered=True,
                ),
                OptionAlertEvent(
                    symbol="MGM",
                    triggered_at=now,
                    iv30=19.0,
                    hv30=29.0,
                    iv_percentile=7.0,
                    avg_edr=32.0,
                    selected_spread_pct=18.0,
                    selected_volume=12,
                    selected_open_interest=180,
                    selected_contract_score=3.1,
                    selected_reward_risk=1.4,
                    selected_convexity_profit_pct=70.0,
                    selected_convexity_probability_itm=0.53,
                    opportunity_score=74.0,
                    opportunity_grade="B",
                    opportunity_model_version="heuristic_v1",
                    delivered=True,
                ),
                OptionAlertEvent(
                    symbol="HLT",
                    triggered_at=now,
                    iv30=20.0,
                    hv30=28.0,
                    iv_percentile=9.0,
                    avg_edr=40.0,
                    selected_spread_pct=25.0,
                    selected_volume=4,
                    selected_open_interest=75,
                    selected_contract_score=1.2,
                    selected_reward_risk=0.9,
                    selected_convexity_profit_pct=38.0,
                    selected_convexity_probability_itm=0.45,
                    opportunity_score=56.0,
                    opportunity_grade="C",
                    opportunity_model_version="heuristic_v1",
                    delivered=False,
                ),
                OptionSweepRun(
                    universe_key="SP500",
                    universe_label="S&P 500",
                    threshold=30.0,
                    trigger_source="dashboard",
                    status="completed",
                    total_symbols=500,
                    scanned_symbols=500,
                    hits=3,
                    errors=1,
                    rate_limit_errors=0,
                    hit_symbols="MGM,HLT",
                    started_at=now,
                    completed_at=now,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        db.commit()

    response = client.get("/secret/options/scanner-summary?lookback_days=21&run_limit=5")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["event_count"] == 3
    assert body["summary"]["delivered"] == 2
    assert body["top_symbols"][0]["symbol"] == "MGM"
    assert body["top_symbols"][0]["hits"] == 2
    assert body["top_symbols"][0]["group"] == "Hospitality & Travel"
    assert body["top_symbols"][0]["avg_opportunity_score"] == 80.0
    assert body["ranked_opportunities"][0]["symbol"] == "MGM"
    assert body["ranked_opportunities"][0]["score"] > body["ranked_opportunities"][1]["score"]
    assert body["ranked_opportunities"][0]["grade"] in {"A", "A+"}
    assert set(body["ranked_opportunities"][0]["components"]) >= {"cheapness", "volatility_edge", "contract_quality", "recurrence"}
    assert body["ranked_opportunities"][0]["selected_contract"]["reward_risk"] == 1.9
    assert body["learning_policy"]["actual_rank_influence"] == 0.0
    assert body["learning_policy"]["nominal_weight_cap"] == 0.10
    assert body["learning_policy"]["maximum_applied_weight"] == 0.10
    assert body["learning_policy"]["configured_operator_authorization"] is False
    assert body["learning_policy"]["live_canary_enabled"] is False
    assert body["learning_policy"]["observed_max_applied_weight"] == 0.0
    assert body["learning_policy"]["observed_mean_applied_weight"] == 0.0
    assert body["learning_policy"]["actual_order_unchanged"] is True
    learning = body["ranked_opportunities"][0]["learning_evaluation"]
    assert learning["champion_score"] == body["ranked_opportunities"][0]["score"]
    assert learning["applied_score"] == body["ranked_opportunities"][0]["score"]
    assert learning["applied_weight"] == 0.0
    assert body["runs"][0]["universe_key"] == "SP500"
    assert body["runs"][0]["hit_symbols"] == ["MGM", "HLT"]


def test_scanner_run_detail_returns_hits_for_selected_run(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        db.add_all(
            [
                OptionAlertEvent(
                    symbol="MGM",
                    triggered_at=now - timedelta(minutes=3),
                    iv30=18.0,
                    hv30=31.0,
                    iv_percentile=5.0,
                    avg_edr=28.0,
                    selected_expiry="2026-09-18",
                    selected_dte=70,
                    selected_strike=52.0,
                    selected_option_type="call",
                    selected_premium=1.25,
                    selected_spread_pct=12.0,
                    selected_volume=24,
                    selected_open_interest=350,
                    selected_contract_score=4.5,
                    selected_reward_risk=1.9,
                    selected_convexity_profit_pct=93.0,
                    selected_convexity_probability_itm=0.57,
                    opportunity_score=86.0,
                    opportunity_grade="A+",
                    opportunity_model_version="heuristic_v1",
                    delivered=True,
                ),
                OptionAlertEvent(
                    symbol="HLT",
                    triggered_at=now - timedelta(minutes=2),
                    iv30=20.0,
                    hv30=28.0,
                    iv_percentile=9.0,
                    avg_edr=40.0,
                    selected_expiry="2026-09-18",
                    selected_dte=70,
                    selected_strike=250.0,
                    selected_option_type="call",
                    selected_premium=4.75,
                    selected_spread_pct=25.0,
                    selected_volume=4,
                    selected_open_interest=75,
                    selected_contract_score=1.2,
                    selected_reward_risk=0.9,
                    selected_convexity_profit_pct=38.0,
                    selected_convexity_probability_itm=0.45,
                    opportunity_score=56.0,
                    opportunity_grade="C",
                    opportunity_model_version="heuristic_v1",
                    delivered=True,
                ),
            ]
        )
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="completed",
            total_symbols=500,
            scanned_symbols=500,
            hits=2,
            errors=0,
            rate_limit_errors=0,
            hit_symbols="MGM,HLT",
            started_at=now - timedelta(minutes=5),
            completed_at=now,
            created_at=now - timedelta(minutes=5),
            updated_at=now,
        )
        db.add(run)
        db.commit()
        run_id = run.id

    response = client.get(f"/secret/options/scanner-run/{run_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["run"]["id"] == run_id
    assert body["hit_count"] == 2
    assert body["matched_event_count"] == 2
    assert [hit["symbol"] for hit in body["hits"]] == ["MGM", "HLT"]
    assert body["hits"][0]["selected_contract"]["reward_risk"] == 1.9
    assert body["hits"][0]["score"] >= body["hits"][1]["score"]
    assert body["learning_policy"]["actual_order_unchanged"] is True
    assert all(hit["learning_evaluation"]["applied_weight"] == 0.0 for hit in body["hits"])


def test_scanner_summary_adds_exact_held_contract_repeat_evidence_without_writing(secret_options_client) -> None:
    client, session_local = secret_options_client
    source_at = datetime.utcnow() - timedelta(days=5)
    current_at = datetime.utcnow()
    with session_local() as db:
        source_event = OptionAlertEvent(
            symbol="GIS",
            triggered_at=source_at,
            selected_expiry="2026-09-18",
            selected_strike=40.0,
            selected_option_type="CALL",
            opportunity_score=61.0,
            selected_contract_score=2.0,
            selected_reward_risk=1.1,
        )
        db.add(source_event)
        db.flush()
        position = OptionPosition(
            trade_date=source_at.date(),
            account="test",
            action="Buy to Open",
            contracts=4,
            symbol="GIS",
            expiration=date(2026, 9, 18),
            strike=40.0,
            option_type="call",
            fill_price=0.8,
            total_cost=320.0,
            source_event_id=source_event.id,
        )
        current_event = OptionAlertEvent(
            symbol="GIS",
            triggered_at=current_at,
            selected_expiry="2026-09-18",
            selected_strike=40.000001,
            selected_option_type="call",
            opportunity_score=70.0,
            selected_contract_score=3.0,
            selected_reward_risk=1.4,
        )
        db.add_all([position, current_event])
        db.commit()
        current_event_id = current_event.id
        position_id = position.id

    response = client.get("/secret/options/scanner-summary?lookback_days=21&run_limit=5")

    assert response.status_code == 200
    opportunity = next(
        row for row in response.json()["ranked_opportunities"] if row["event_id"] == current_event_id
    )
    match = opportunity["position_match"]
    assert match["match_type"] == "exact_contract"
    assert match["classification"] == "strengthened"
    assert match["position_id"] == position_id
    assert match["held_contracts"] == 4
    assert match["repeat_count"] == 1
    assert match["previous_event_id"] is not None
    assert match["deltas"]["base_score"] == 9.0
    assert match["assessment_refresh_recommended"] is True
    with session_local() as db:
        assert db.query(OptionPositionEvent).filter(OptionPositionEvent.position_id == position_id).count() == 0


def test_scanner_repeat_evidence_handles_missing_drift_opposite_direction_and_duplicate_lots(
    secret_options_client,
) -> None:
    _client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        db.add_all(
            [
                OptionPosition(
                    trade_date=(now - timedelta(days=2)).date(),
                    contracts=2,
                    symbol="SJM",
                    expiration=date(2026, 9, 18),
                    strike=115.0,
                    option_type="call",
                    fill_price=2.0,
                    total_cost=400.0,
                ),
                OptionPosition(
                    trade_date=(now - timedelta(days=2)).date(),
                    contracts=3,
                    symbol="SJM",
                    expiration=date(2026, 9, 18),
                    strike=115.0,
                    option_type="call",
                    fill_price=2.1,
                    total_cost=630.0,
                ),
            ]
        )
        missing = OptionAlertEvent(symbol="SJM", triggered_at=now, opportunity_score=55.0)
        drift = OptionAlertEvent(
            symbol="SJM",
            triggered_at=now + timedelta(minutes=1),
            selected_expiry="2026-10-16",
            selected_strike=120.0,
            selected_option_type="call",
            opportunity_score=57.0,
        )
        opposite = OptionAlertEvent(
            symbol="SJM",
            triggered_at=now + timedelta(minutes=2),
            selected_expiry="2026-09-18",
            selected_strike=115.0,
            selected_option_type="put",
            opportunity_score=58.0,
        )
        exact = OptionAlertEvent(
            symbol="SJM",
            triggered_at=now + timedelta(minutes=3),
            selected_expiry="2026-09-18",
            selected_strike=115.0,
            selected_option_type="call",
            opportunity_score=60.0,
        )
        db.add_all([missing, drift, opposite, exact])
        db.commit()
        context = load_scanner_repeat_evidence_context(db, events=[missing, drift, opposite, exact])
        missing_match = position_match_for_event(missing, context)
        drift_match = position_match_for_event(drift, context)
        opposite_match = position_match_for_event(opposite, context)
        exact_match = position_match_for_event(exact, context)

    assert missing_match["classification"] == "still_qualifies"
    assert missing_match["contract_comparison_status"] == "unavailable"
    assert drift_match["classification"] == "contract_drift"
    assert drift_match["held_contracts"] == 5
    assert drift_match["replacement_decision"]["recommendation"] == "watch_replacement"
    assert drift_match["replacement_decision"]["implementation_ready"] is False
    assert opposite_match["classification"] == "contradiction"
    assert opposite_match["replacement_decision"]["recommendation"] == "direction_change"
    assert exact_match["match_type"] == "exact_contract"
    assert exact_match["held_contracts"] == 5
    assert len(exact_match["position_ids"]) == 2


def test_scanner_recurrence_journal_is_db_idempotent_and_counts_distinct_sweeps(secret_options_client) -> None:
    _client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        source = OptionAlertEvent(
            symbol="KMI",
            triggered_at=now - timedelta(days=3),
            selected_expiry="2026-09-18",
            selected_strike=34.0,
            selected_option_type="call",
            opportunity_score=55.0,
        )
        db.add(source)
        db.flush()
        source_id = source.id
        position = OptionPosition(
            trade_date=(now - timedelta(days=3)).date(),
            contracts=3,
            symbol="KMI",
            expiration=date(2026, 9, 18),
            strike=34.0,
            option_type="call",
            fill_price=0.5,
            total_cost=150.0,
            source_event_id=source.id,
        )
        first_same_sweep = OptionAlertEvent(
            symbol="KMI",
            triggered_at=now - timedelta(minutes=1),
            sweep_run_id=77,
            selected_expiry="2026-09-18",
            selected_strike=34.0,
            selected_option_type="call",
            opportunity_score=60.0,
        )
        current = OptionAlertEvent(
            symbol="KMI",
            triggered_at=now,
            sweep_run_id=77,
            selected_expiry="2026-09-18",
            selected_strike=34.0,
            selected_option_type="call",
            opportunity_score=62.0,
        )
        db.add_all([position, first_same_sweep, current])
        db.flush()
        context = load_scanner_repeat_evidence_context(db, events=[current])
        match = position_match_for_event(current, context)
        record_scanner_recurrence_events(db, current)
        record_scanner_recurrence_events(db, current)
        db.commit()
        position_id = position.id
        current_id = current.id

    assert match["repeat_count"] == 1
    assert match["previous_event_id"] == source_id
    with session_local() as db:
        rows = (
            db.query(OptionPositionEvent)
            .filter(
                OptionPositionEvent.position_id == position_id,
                OptionPositionEvent.related_alert_event_id == current_id,
            )
            .all()
        )
        assert len(rows) == 1
        assert rows[0].quantity_before == rows[0].quantity_after == 3
        captured_event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == current_id).one()
        receipt = json.loads(captured_event.learning_influence_json)
        assert captured_event.learning_influence_version == "option_learning_influence_canary_v3"
        assert receipt["point_in_time_receipt"] is True
        assert receipt["nominal_weight_cap"] == 0.10
        assert receipt["rank_snapshot_persisted"] is False
        assert receipt["operator_authorization"] == {
            "configured": False,
            "setting": "OPTION_LEARNING_CANARY_ENABLED",
            "default": False,
            "frozen_in_receipt": True,
        }
        assert receipt["gates"]["live_canary_authorized"] is False
        assert receipt["applied_weight"] == 0.0


def test_scanner_recurrence_replay_does_not_rewrite_a_v2_learning_receipt(
    secret_options_client,
) -> None:
    _client, session_local = secret_options_client
    v2_receipt = {
        "version": "option_learning_influence_canary_v2",
        "point_in_time_receipt": True,
        "champion_score": 61.0,
        "learning_score": 71.0,
        "counterfactual_weight": 0.05,
        "applied_weight": 0.05,
    }
    serialized = json.dumps(v2_receipt, sort_keys=True)
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="ABT",
            triggered_at=datetime.utcnow(),
            opportunity_score=61.0,
            learning_influence_version="option_learning_influence_canary_v2",
            learning_influence_json=serialized,
        )
        db.add(event)
        db.flush()

        record_scanner_recurrence_events(db, event)
        db.commit()
        event_id = event.id

    with session_local() as db:
        persisted = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == event_id).one()
        assert persisted.learning_influence_version == "option_learning_influence_canary_v2"
        assert persisted.learning_influence_json == serialized


def test_closed_trade_learning_keeps_scanner_recurrence_as_actual_outcome_cohort(secret_options_client) -> None:
    _client, session_local = secret_options_client
    with session_local() as db:
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            contracts=1,
            symbol="PNC",
            expiration=date(2026, 8, 21),
            strike=260.0,
            option_type="call",
            fill_price=4.0,
            total_cost=400.0,
        )
        db.add(position)
        db.flush()
        db.add(
            OptionPositionEvent(
                position_id=position.id,
                event_type="scanner_recurrence",
                event_at=datetime(2026, 6, 10),
                source="scanner",
                related_alert_event_id=991,
                details_json='{"classification":"strengthened","scanner_event_id":991}',
            )
        )
        closed = ClosedPosition(
            source_position_id=position.id,
            symbol="PNC",
            option_type="call",
            strike=260.0,
            expiration=date(2026, 8, 21),
            contracts=1,
            trade_date=date(2026, 6, 1),
            fill_price=4.0,
            total_cost=400.0,
            underlying_at_entry=250.0,
            close_date=date(2026, 6, 20),
            exit_price=5.0,
            total_proceeds=500.0,
            underlying_at_exit=255.0,
            dollar_pnl=100.0,
            percent_pnl=25.0,
        )
        db.add(closed)
        db.flush()
        outcome = create_trade_outcome(db, closed)
        summary = learning_summary(db)
        db.commit()

    assert outcome is not None
    assert summary["scanner_recurrence_outcomes"]["cohorts"]["strengthened_seen"]["sample_count"] == 1
    assert summary["scanner_recurrence_outcomes"]["cohorts"]["strengthened_seen"]["average_percent_pnl"] == 25.0
    assert summary["scanner_recurrence_outcomes"]["automatic_weight_changes"] is False


def test_closed_trade_learning_keeps_point_in_time_market_field_cohort(secret_options_client) -> None:
    _client, session_local = secret_options_client
    field_json = """{
      "schema_version":"option_market_field_v1",
      "semantic_revision":"1.1",
      "mode":"shadow_only",
      "rank_influence":0.0,
      "quality":{"available":true,"completed_bars_only":true},
      "maturity":{"status":"complete","warmup_complete":true,"completed_bars":250},
      "alignment":{"supported":true,"basis":"legacy_long_single_leg_option_type"},
      "direction":{"option_aligned_pressure":0.42,"option_aligned_velocity":0.11},
      "classification":{"path_state":"supportive","eventfulness":"quiet"}
    }"""
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="FIELD",
            triggered_at=datetime(2026, 6, 1, 20, 0),
            selected_option_type="call",
            field_context_version="option_market_field_v1",
            field_context_as_of=datetime(2026, 5, 29),
            field_context_json=field_json,
            message="field snapshot",
        )
        db.add(event)
        db.flush()
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            contracts=1,
            symbol="FIELD",
            expiration=date(2026, 8, 21),
            strike=105.0,
            option_type="call",
            fill_price=3.0,
            total_cost=300.0,
            source_event_id=event.id,
        )
        db.add(position)
        db.flush()
        closed = ClosedPosition(
            source_position_id=position.id,
            source_event_id=event.id,
            symbol="FIELD",
            option_type="call",
            strike=105.0,
            expiration=date(2026, 8, 21),
            contracts=1,
            trade_date=date(2026, 6, 1),
            fill_price=3.0,
            total_cost=300.0,
            underlying_at_entry=100.0,
            close_date=date(2026, 6, 20),
            exit_price=4.5,
            total_proceeds=450.0,
            underlying_at_exit=107.0,
            dollar_pnl=150.0,
            percent_pnl=50.0,
        )
        db.add(closed)
        db.flush()

        outcome = create_trade_outcome(db, closed)
        summary = learning_summary(db)
        attribution = secret_options.json_loads(outcome.attribution_json, {})
        outcome_model_version = outcome.model_version
        db.commit()

    assert attribution["market_field"]["cohort_basis"] == "entry_snapshot"
    assert attribution["market_field"]["entry_snapshot"]["classification"]["path_state"] == "supportive"
    assert outcome_model_version == "decision_outcomes_v2_field_shadow"
    assert summary["market_field_outcomes"]["cohorts"]["supportive"]["sample_count"] == 1
    assert summary["market_field_outcomes"]["cohorts"]["supportive"]["average_percent_pnl"] == 50.0
    assert summary["market_field_outcomes"]["rank_influence"] == 0.0
    assert summary["market_field_outcomes"]["automatic_weight_changes"] is False


def test_scanner_run_detail_uses_direct_sweep_run_id(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="running",
            total_symbols=500,
            scanned_symbols=80,
            hits=2,
            errors=0,
            rate_limit_errors=0,
            hit_symbols=None,
            started_at=now - timedelta(minutes=5),
            completed_at=None,
            created_at=now - timedelta(minutes=5),
            updated_at=now,
        )
        db.add(run)
        db.flush()
        db.add_all(
            [
                OptionAlertEvent(
                    symbol="A",
                    sweep_run_id=run.id,
                    triggered_at=now - timedelta(minutes=2),
                    iv30=34.0,
                    hv30=56.0,
                    iv_percentile=25.0,
                    avg_edr=72.0,
                    selected_expiry="2026-09-18",
                    selected_dte=70,
                    selected_strike=145.0,
                    selected_option_type="call",
                    selected_premium=4.15,
                    opportunity_score=88.0,
                    opportunity_grade="A",
                    delivered=True,
                ),
                OptionAlertEvent(
                    symbol="SJM",
                    sweep_run_id=run.id,
                    triggered_at=now - timedelta(minutes=1),
                    iv30=22.0,
                    hv30=30.0,
                    iv_percentile=18.0,
                    avg_edr=41.0,
                    selected_expiry="2026-09-18",
                    selected_dte=70,
                    selected_strike=115.0,
                    selected_option_type="call",
                    selected_premium=3.15,
                    opportunity_score=70.0,
                    opportunity_grade="B",
                    delivered=True,
                ),
            ]
        )
        db.commit()
        run_id = run.id

    response = client.get(f"/secret/options/scanner-run/{run_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["hit_count"] == 2
    assert body["matched_event_count"] == 2
    assert {hit["symbol"] for hit in body["hits"]} == {"A", "SJM"}
    assert [hit["score"] for hit in body["hits"]] == sorted(
        (hit["score"] for hit in body["hits"]),
        reverse=True,
    )


def test_scanner_run_detail_recovers_legacy_window_hits(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        db.add_all(
            [
                OptionAlertEvent(
                    symbol="CVS",
                    triggered_at=now - timedelta(minutes=2),
                    iv30=24.0,
                    hv30=38.0,
                    iv_percentile=14.0,
                    avg_edr=52.0,
                    selected_expiry="2026-09-18",
                    selected_dte=70,
                    selected_strike=70.0,
                    selected_option_type="call",
                    selected_premium=2.1,
                    opportunity_score=76.0,
                    opportunity_grade="B",
                    message="CVS - S&P 500\nMISPRICING",
                    delivered=True,
                ),
                OptionAlertEvent(
                    symbol="XYZ",
                    triggered_at=now - timedelta(minutes=2),
                    iv30=24.0,
                    hv30=38.0,
                    iv_percentile=14.0,
                    avg_edr=52.0,
                    message="XYZ - Russell 2000\nMISPRICING",
                    delivered=True,
                ),
            ]
        )
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="stopped",
            total_symbols=500,
            scanned_symbols=120,
            hits=1,
            errors=0,
            rate_limit_errors=0,
            hit_symbols=None,
            started_at=now - timedelta(minutes=5),
            completed_at=now,
            created_at=now - timedelta(minutes=5),
            updated_at=now,
        )
        db.add(run)
        db.commit()
        run_id = run.id

    response = client.get(f"/secret/options/scanner-run/{run_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["hit_count"] == 1
    assert body["matched_event_count"] == 1
    assert [hit["symbol"] for hit in body["hits"]] == ["CVS"]


def test_sweep_progress_persists_hit_symbols(secret_options_client) -> None:
    _client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="running",
            total_symbols=500,
            scanned_symbols=10,
            hits=0,
            errors=0,
            rate_limit_errors=0,
            started_at=now,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(run)
        db.commit()
        run_id = run.id

    option_sweep_runs.update_sweep_run_from_progress(
        run_id,
        {
            "event": "progress",
            "scanned": 25,
            "total_expected": 500,
            "hits": 2,
            "hit_symbols": ["A", "SJM"],
            "errors": 0,
            "rate_limit_errors": 0,
        },
    )

    with session_local() as db:
        run = db.query(OptionSweepRun).filter(OptionSweepRun.id == run_id).one()
        assert run.hit_symbols == "A,SJM"
        assert run.hits == 2


def test_scanner_summary_marks_stale_running_run(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        stale_run = OptionSweepRun(
            universe_key="RUSSELL2000",
            universe_label="Russell 2000",
            threshold=30.0,
            trigger_source="dashboard",
            status="running",
            total_symbols=600,
            scanned_symbols=12,
            hits=1,
            errors=0,
            rate_limit_errors=0,
            hit_symbols="MGM",
            started_at=now - timedelta(hours=14),
            completed_at=None,
            created_at=now - timedelta(hours=14),
            updated_at=now - timedelta(hours=13),
        )
        db.add(stale_run)
        db.commit()
        run_id = stale_run.id

    response = client.get("/secret/options/scanner-summary?lookback_days=21&run_limit=5")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["active_runs"] == 0
    assert body["summary"]["stale_runs_marked"] == 1
    assert body["runs"][0]["id"] == run_id
    assert body["runs"][0]["status"] == "stale"


def test_dashboard_scanner_run_endpoint_queues_sweep(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _session_local = secret_options_client

    def _fake_start(universe_key: str, threshold: float) -> dict[str, object]:
        assert universe_key == "RUSSELL2000"
        assert threshold == 25.0
        return {
            "id": 42,
            "universe_key": universe_key,
            "universe_label": "Russell 2000",
            "threshold": threshold,
            "trigger_source": "dashboard",
            "status": "queued",
            "total_symbols": 0,
            "scanned_symbols": 0,
            "hits": 0,
            "errors": 0,
            "rate_limit_errors": 0,
            "hit_symbols": [],
            "notes": None,
            "last_event": None,
            "last_symbol": None,
            "last_error": None,
            "started_at": "2026-07-10T10:00:00",
            "completed_at": None,
            "updated_at": "2026-07-10T10:00:00",
        }

    monkeypatch.setattr(secret_options, "start_dashboard_sweep", _fake_start)

    response = client.post(
        "/secret/options/scanner-run",
        json={"universe_key": "RUSSELL2000", "threshold": 25.0},
    )

    assert response.status_code == 200
    assert response.json()["run"]["id"] == 42
    assert response.json()["status"] == "queued"


def test_dashboard_scanner_stop_endpoint_requests_stop(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _session_local = secret_options_client

    def _fake_stop(run_id: int) -> dict[str, object]:
        assert run_id == 42
        return {
            "stopped": True,
            "message": "Stop requested for scanner run #42.",
            "run": {
                "id": 42,
                "universe_key": "SP500",
                "universe_label": "S&P 500",
                "threshold": 30.0,
                "trigger_source": "dashboard",
                "status": "running",
                "total_symbols": 503,
                "scanned_symbols": 20,
                "hits": 0,
                "errors": 0,
                "rate_limit_errors": 0,
                "hit_symbols": [],
                "notes": None,
                "last_event": "stop_requested",
                "last_symbol": None,
                "last_error": "Stop requested from dashboard.",
                "started_at": "2026-07-10T10:00:00",
                "completed_at": None,
                "updated_at": "2026-07-10T10:01:00",
            },
        }

    monkeypatch.setattr(secret_options, "request_stop_dashboard_sweep", _fake_stop)

    response = client.post("/secret/options/scanner-run/42/stop")

    assert response.status_code == 200
    assert response.json()["stopped"] is True
    assert response.json()["run"]["last_event"] == "stop_requested"


def test_opportunity_backtest_compares_closed_trades(secret_options_client) -> None:
    client, session_local = secret_options_client
    now = datetime.utcnow()
    with session_local() as db:
        strong_event = OptionAlertEvent(
            symbol="MGM",
            triggered_at=now,
            iv30=18.0,
            hv30=31.0,
            iv_percentile=5.0,
            avg_edr=28.0,
            selected_spread_pct=12.0,
            selected_volume=24,
            selected_open_interest=350,
            selected_reward_risk=1.9,
            selected_convexity_profit_pct=93.0,
            selected_convexity_probability_itm=0.57,
            opportunity_score=86.0,
            opportunity_grade="A+",
            opportunity_model_version="heuristic_v1",
        )
        weak_event = OptionAlertEvent(
            symbol="HLT",
            triggered_at=now,
            iv30=24.0,
            hv30=26.0,
            iv_percentile=24.0,
            avg_edr=48.0,
            selected_spread_pct=32.0,
            selected_volume=1,
            selected_open_interest=20,
            selected_reward_risk=0.6,
            selected_convexity_profit_pct=20.0,
            selected_convexity_probability_itm=0.41,
            opportunity_score=42.0,
            opportunity_grade="Watch",
            opportunity_model_version="heuristic_v1",
        )
        db.add_all([strong_event, weak_event])
        db.flush()
        db.add_all(
            [
                ClosedPosition(
                    symbol="MGM",
                    option_type="call",
                    strike=100.0,
                    expiration=date(2026, 9, 18),
                    contracts=1,
                    trade_date=date(2026, 7, 1),
                    fill_price=2.0,
                    total_cost=200.0,
                    close_date=date(2026, 7, 8),
                    exit_price=3.0,
                    total_proceeds=300.0,
                    dollar_pnl=100.0,
                    percent_pnl=50.0,
                    source_event_id=strong_event.id,
                    source_triggered_at=strong_event.triggered_at,
                ),
                ClosedPosition(
                    symbol="HLT",
                    option_type="call",
                    strike=200.0,
                    expiration=date(2026, 9, 18),
                    contracts=1,
                    trade_date=date(2026, 7, 1),
                    fill_price=4.0,
                    total_cost=400.0,
                    close_date=date(2026, 7, 8),
                    exit_price=2.0,
                    total_proceeds=200.0,
                    dollar_pnl=-200.0,
                    percent_pnl=-50.0,
                    source_event_id=weak_event.id,
                    source_triggered_at=weak_event.triggered_at,
                ),
            ]
        )
        db.commit()

    response = client.get("/secret/options/opportunity-backtest?lookback_days=365&threshold=65&limit=20")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["scored_trades"] == 2
    assert body["summary"]["model_selected"]["count"] == 1
    assert body["summary"]["model_selected"]["total_pnl"] == 100.0
    assert body["summary"]["avoided_loss_from_excluded"] == 200.0


def test_close_position_rejects_duplicate_closed_trade(secret_options_client) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        db.add(
            OptionPosition(
                trade_date=date(2026, 6, 1),
                account="Active Trading",
                action="Buy to Open",
                contracts=2,
                symbol="SYY",
                expiration=date(2026, 7, 17),
                strike=80.0,
                option_type="call",
                fill_price=1.35,
                total_cost=270.0,
            )
        )
        db.add(
            ClosedPosition(
                trade_date=date(2026, 6, 1),
                close_date=date(2026, 6, 23),
                account="Active Trading",
                contracts=2,
                symbol="SYY",
                expiration=date(2026, 7, 17),
                strike=80.0,
                option_type="call",
                fill_price=1.35,
                exit_price=3.50,
                total_cost=270.0,
                total_proceeds=700.0,
                dollar_pnl=430.0,
                percent_pnl=159.259259,
            )
        )
        db.commit()
        position_id = db.query(OptionPosition).one().id

    response = client.request(
        "DELETE",
        f"/secret/options/positions/{position_id}",
        json={"exit_price": 3.50, "close_date": "2026-06-23"},
    )

    assert response.status_code == 409
    assert "Duplicate closed position" in response.json()["detail"]


def test_due_sell_reminders_send_once(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _client, session_local = secret_options_client
    monkeypatch.delenv("OPTIONS_TRADE_REMINDER_MENTION", raising=False)

    @contextmanager
    def _testing_db_session():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    with session_local() as db:
        position = OptionPosition(
            trade_date=date(2026, 6, 1),
            account="Active Trading",
            action="Buy to Open",
            contracts=1,
            symbol="SYY",
            expiration=date(2026, 7, 17),
            strike=80.0,
            option_type="call",
            fill_price=1.35,
            total_cost=135.0,
            source_event_id=42,
        )
        db.add(position)
        db.flush()
        db.add(
            OptionTradeReminder(
                position_id=position.id,
                source_event_id=42,
                symbol="SYY",
                option_type="call",
                expiration=date(2026, 7, 17),
                strike=80.0,
                contracts=1,
                fill_price=1.35,
                reminder_date=date(2026, 6, 22),
                hold_days=21,
                status="pending",
                attempts=0,
            )
        )
        db.commit()

    sent_messages: list[str] = []

    def _fake_send(message: str) -> tuple[bool, None]:
        sent_messages.append(message)
        return True, None

    monkeypatch.setattr(option_trade_reminders, "get_db_session", _testing_db_session)
    monkeypatch.setattr(option_trade_reminders, "_send_discord_message", _fake_send)

    first = option_trade_reminders.send_due_trade_sell_reminders(today=date(2026, 6, 22))
    second = option_trade_reminders.send_due_trade_sell_reminders(today=date(2026, 6, 22))

    assert first == {"checked": 1, "sent": 1, "skipped": 0, "error": 0}
    assert second == {"checked": 0, "sent": 0, "skipped": 0, "error": 0}
    assert len(sent_messages) == 1
    assert sent_messages[0].startswith("@_steve1234 Time to review/sell SYY")
    with session_local() as db:
        reminder = db.query(OptionTradeReminder).one()
        assert reminder.status == "sent"
        assert reminder.attempts == 1
        assert reminder.sent_at is not None


def test_update_and_delete_closed_position(secret_options_client) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        db.add(
            ClosedPosition(
                trade_date=date(2026, 5, 11),
                close_date=date(2026, 5, 11),
                account=None,
                contracts=3,
                symbol="LW",
                expiration=date(2026, 6, 20),
                strike=42.50,
                option_type="put",
                fill_price=2.40,
                exit_price=1.50,
                total_cost=720.0,
                total_proceeds=450.0,
                dollar_pnl=-270.0,
                percent_pnl=-37.5,
                notes="duplicate",
            )
        )
        db.commit()
        closed_id = db.query(ClosedPosition).one().id

    update_response = client.put(
        f"/secret/options/closed-positions/{closed_id}",
        json={
            "trade_date": "2026-05-11",
            "close_date": "2026-05-12",
            "account": None,
            "contracts": 3,
            "symbol": "LW",
            "expiration": "2026-06-20",
            "strike": 42.5,
            "option_type": "put",
            "fill_price": 2.4,
            "exit_price": 1.75,
            "total_cost": 720.0,
            "notes": "fixed exit",
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()["closed_position"]
    assert updated["close_date"] == "2026-05-12"
    assert updated["total_proceeds"] == 525.0
    assert updated["dollar_pnl"] == -195.0
    assert updated["notes"] == "fixed exit"

    delete_response = client.delete(f"/secret/options/closed-positions/{closed_id}")

    assert delete_response.status_code == 200
    with session_local() as db:
        assert db.query(ClosedPosition).count() == 0


def test_training_outcomes_are_persisted(secret_options_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        db.add(
            OptionAlertEvent(
                symbol="BTU",
                triggered_at=datetime(2026, 6, 1, 14, 30),
                iv30=50.0,
                hv30=60.0,
                iv_percentile=4.0,
                avg_edr=70.0,
                selected_option_type="put",
                selected_expiry="2026-09-18",
                selected_strike=24.0,
                selected_premium=2.70,
                message="Setup: 1x ATM PUT\nContract: 2026-09-18 24.0 PUT\nHold: 21 trading days\nEst Prem: $2.70",
            )
        )
        db.commit()
        event_id = db.query(OptionAlertEvent).one().id

    calls = {"count": 0}

    def _fake_compute(event: OptionAlertEvent) -> dict[str, object]:
        calls["count"] += 1
        return {
            "event_id": event.id,
            "symbol": "BTU",
            "triggered_at": event.triggered_at.isoformat(),
            "option_type": "put",
            "contract_expiry": "2026-09-18",
            "contract_strike": 24.0,
            "hold_days": 21,
            "entry_date": "2026-06-01",
            "exit_date": "2026-06-22",
            "entry_underlying": 23.0,
            "exit_underlying": 21.0,
            "underlying_directional_return_pct": 8.69565,
            "entry_option_price_est": 2.70,
            "exit_option_price_est": 4.20,
            "option_return_pct_est": 55.55556,
            "option_pnl_per_contract_est": 150.0,
            "recommended_exit_date": "2026-06-22",
            "hold_days_realized": 21,
            "days_elapsed_calendar": 21,
            "status": "matured",
        }

    monkeypatch.setattr(secret_options, "_compute_training_outcome_with_cache", _fake_compute)

    first = client.post("/secret/options/training-outcomes/backfill", params={"lookback_days": 365, "limit": 50})
    second = client.get("/secret/options/training-outcomes", params={"lookback_days": 365, "limit": 50})

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1
    assert first.json()["outcomes"][0]["event_id"] == event_id
    assert second.json()["outcomes"][0]["event_id"] == event_id
    with session_local() as db:
        row = db.query(OptionTrainingOutcome).one()
        assert row.event_id == event_id
        assert row.compute_status == "ok"
        assert row.status == "matured"


def test_training_outcomes_include_linked_non_candidate_events(
    secret_options_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = secret_options_client
    with session_local() as db:
        event = OptionAlertEvent(
            symbol="ORCL",
            triggered_at=datetime(2026, 6, 1, 14, 30),
            iv30=30.0,
            hv30=35.0,
            iv_percentile=25.0,
            avg_edr=75.0,
            message="Bias      : NEUTRAL\nHORIZONS\n  1m +1.9%  3m -21.4%",
        )
        db.add(event)
        db.flush()
        db.add(
            OptionPosition(
                trade_date=date(2026, 6, 2),
                account="Active Trading",
                action="Buy to Open",
                contracts=1,
                symbol="ORCL",
                expiration=date(2026, 9, 18),
                strike=155.0,
                option_type="call",
                fill_price=14.77,
                total_cost=1477.0,
                source_event_id=event.id,
                source_triggered_at=event.triggered_at,
                source_match_method="manual_event_id",
                source_match_confidence=0.92,
            )
        )
        db.commit()
        event_id = event.id

    calls = {"count": 0}

    def _fake_compute(event: OptionAlertEvent, linked_trade: dict[str, object]) -> dict[str, object]:
        calls["count"] += 1
        assert linked_trade["option_type"] == "call"
        assert linked_trade["strike"] == 155.0
        return {
            "event_id": event.id,
            "symbol": "ORCL",
            "triggered_at": event.triggered_at.isoformat(),
            "option_type": "call",
            "contract_expiry": "2026-09-18",
            "contract_strike": 155.0,
            "hold_days": 21,
            "entry_date": "2026-06-01",
            "exit_date": None,
            "entry_underlying": 150.0,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": 14.77,
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": "2026-06-22",
            "days_elapsed_calendar": 1,
            "status": "pending",
        }

    monkeypatch.setattr(secret_options, "_compute_training_outcome_for_linked_event", _fake_compute)

    response = client.post("/secret/options/training-outcomes/backfill", params={"lookback_days": 365, "limit": 50})

    assert response.status_code == 200
    assert calls["count"] == 1
    body = response.json()
    assert body["outcomes"][0]["event_id"] == event_id
    assert body["summary"]["linked_event_rows"] == 1
    with session_local() as db:
        row = db.query(OptionTrainingOutcome).one()
        assert row.event_id == event_id
        assert row.hold_days == 21
        assert row.compute_status == "ok"
