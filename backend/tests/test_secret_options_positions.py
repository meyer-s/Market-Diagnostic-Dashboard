from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta
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
from app.core.db import Base
from app.models.closed_positions import ClosedPosition
from app.models.option_training_outcomes import OptionTrainingOutcome
from app.models.option_trade_reminders import OptionTradeReminder
from app.models.options_alerts import OptionAlertEvent
from app.models.option_sweep_runs import OptionSweepRun
from app.models.option_positions import OptionPosition
from app.services import option_trade_reminders
from app.services import option_sweep_runs
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

    monkeypatch.setattr(secret_options, "get_db_session", _fake_db_session)
    monkeypatch.setattr(secret_options, "_seed_positions", lambda _db: None)
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
        lambda _position, _provider=None: {
            "market": {"current_price": float("nan")},
            "volatility": float("inf"),
            "greeks": {"delta": float("-inf")},
        },
    )

    response = TestClient(app).get("/secret/options/positions")

    assert response.status_code == 200
    metrics = response.json()["positions"][0]["metrics"]
    assert metrics["market"]["current_price"] is None
    assert metrics["volatility"] is None
    assert metrics["greeks"]["delta"] is None


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


def test_create_position_rejects_duplicate_resubmission(secret_options_client) -> None:
    client, _session_local = secret_options_client

    first = client.post("/secret/options/positions", json=_position_payload())
    second = client.post("/secret/options/positions", json=_position_payload())

    assert first.status_code == 200
    assert second.status_code == 409
    assert "Duplicate open position" in second.json()["detail"]


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
                message="Setup: 1x ATM CALL\nContract: 2026-07-17 80.0 CALL\nHold: 21 trading days\nEst Prem: $1.35",
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
    assert body["position"]["evaluation_hold_days"] == 21
    assert body["position"]["evaluation_due_date"] == "2026-06-22"
    assert body["position"]["evaluation_source"] == "sell_reminder"
    with session_local() as db:
        reminder = db.query(OptionTradeReminder).one()
        assert reminder.position_id == body["position"]["id"]
        assert reminder.source_event_id == event.id
        assert reminder.symbol == "SYY"
        assert reminder.reminder_date == date(2026, 6, 22)
        assert reminder.hold_days == 21
        assert reminder.status == "pending"


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

    first = client.get("/secret/options/training-outcomes", params={"lookback_days": 365, "limit": 50})
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

    response = client.get("/secret/options/training-outcomes", params={"lookback_days": 365, "limit": 50})

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
