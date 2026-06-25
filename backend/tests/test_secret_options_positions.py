from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
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
from app.models.option_positions import OptionPosition
from app.services import option_trade_reminders


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
        lambda _position: {
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
    with session_local() as db:
        reminder = db.query(OptionTradeReminder).one()
        assert reminder.position_id == response.json()["position"]["id"]
        assert reminder.source_event_id == event.id
        assert reminder.symbol == "SYY"
        assert reminder.reminder_date == date(2026, 6, 22)
        assert reminder.hold_days == 21
        assert reminder.status == "pending"


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
    assert "Time to review/sell SYY" in sent_messages[0]
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
