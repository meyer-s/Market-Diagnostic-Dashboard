from __future__ import annotations

from contextlib import contextmanager
import sys
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pandas as pd
import pytest

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
