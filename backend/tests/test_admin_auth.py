from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api import admin as admin_api
from app.core.config import settings


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    app.include_router(admin_api.router, prefix="/admin")
    monkeypatch.setattr(admin_api.etl, "update_system_status", lambda: {"system_state": "GREEN"})
    return TestClient(app)


def test_admin_endpoint_requires_authorization_header(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.ADMIN_API_KEY = "test-admin-key"
    called = {"value": False}

    async def _ingest() -> list[dict]:
        called["value"] = True
        return [{"indicator": "VIX"}]

    monkeypatch.setattr(admin_api.etl, "ingest_all_indicators", _ingest)

    response = client.post("/admin/ingest/run")

    assert response.status_code == 401
    assert called["value"] is False


def test_admin_endpoint_rejects_wrong_bearer_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.ADMIN_API_KEY = "test-admin-key"
    called = {"value": False}

    async def _ingest() -> list[dict]:
        called["value"] = True
        return [{"indicator": "VIX"}]

    monkeypatch.setattr(admin_api.etl, "ingest_all_indicators", _ingest)

    response = client.post("/admin/ingest/run", headers={"Authorization": "Bearer wrong"})

    assert response.status_code == 401
    assert called["value"] is False


def test_admin_endpoint_accepts_correct_bearer_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.ADMIN_API_KEY = "test-admin-key"

    async def _ingest() -> list[dict]:
        return [{"indicator": "VIX"}]

    monkeypatch.setattr(admin_api.etl, "ingest_all_indicators", _ingest)

    response = client.post("/admin/ingest/run", headers={"Authorization": "Bearer test-admin-key"})

    assert response.status_code == 200
    assert response.json()["message"] == "Ingestion completed"


def test_admin_endpoint_fails_closed_when_key_missing(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.ADMIN_API_KEY = None
    called = {"value": False}

    async def _ingest() -> list[dict]:
        called["value"] = True
        return [{"indicator": "VIX"}]

    monkeypatch.setattr(admin_api.etl, "ingest_all_indicators", _ingest)

    response = client.post("/admin/ingest/run", headers={"Authorization": "Bearer anything"})

    assert response.status_code == 500
    assert called["value"] is False
