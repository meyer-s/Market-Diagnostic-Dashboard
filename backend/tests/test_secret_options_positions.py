from __future__ import annotations

from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api import secret_options


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
        lambda _position: {
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
