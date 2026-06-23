from __future__ import annotations

from contextlib import contextmanager
from datetime import date
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
from app.models.option_positions import OptionPosition


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
