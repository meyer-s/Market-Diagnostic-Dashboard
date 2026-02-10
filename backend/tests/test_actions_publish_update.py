from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.actions import router as actions_router
from app.core.config import settings
from app.core.db import Base


def _valid_payload(*, slug: str = "market-diagnostic-2026-02-10") -> dict:
    return {
        "title": "Market Diagnostic - Test",
        "summary": "Test summary",
        "status": "YELLOW",
        "tags": ["market-diagnostic", "macro"],
        "slug": slug,
        "content_markdown": (
            "## Earnings\n- x\n\n"
            "## Credit\n- x\n\n"
            "## Growth\n- x\n\n"
            "## Financial Conditions\n- x\n\n"
            "## Policy/Geo\n- x\n"
        ),
        "chart_urls": [],
        "published": True,
        "pinned": False,
    }


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings.GPT_ACTION_PUBLISH_KEY = "test-gpt-action-key"

    # StaticPool keeps a single connection open so an in-memory SQLite DB persists
    # across sessions within the test client.
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    # Patch the DB session factory used by get_db_session().
    import app.utils.db_helpers as db_helpers

    monkeypatch.setattr(db_helpers, "SessionLocal", TestingSessionLocal, raising=True)

    app = FastAPI()
    app.include_router(actions_router)
    return TestClient(app)


def test_missing_authorization_header_returns_401(client: TestClient):
    resp = client.post("/api/actions/publish_update", json=_valid_payload())
    assert resp.status_code == 401


def test_invalid_authorization_header_returns_401(client: TestClient):
    resp = client.post(
        "/api/actions/publish_update",
        json=_valid_payload(),
        headers={"Authorization": "Bearer wrong"},
    )
    assert resp.status_code == 401


def test_invalid_headings_returns_400(client: TestClient):
    payload = _valid_payload()
    payload["content_markdown"] = "## Earnings\n- x\n"
    resp = client.post(
        "/api/actions/publish_update",
        json=payload,
        headers={"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["message"] == "Invalid payload."


def test_missing_required_tags_returns_400(client: TestClient):
    payload = _valid_payload()
    payload["tags"] = ["market-diagnostic"]
    resp = client.post(
        "/api/actions/publish_update",
        json=payload,
        headers={"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["message"] == "Invalid payload."


def test_invalid_slug_returns_400(client: TestClient):
    payload = _valid_payload(slug="market-diagnostic-2026-2-10")
    resp = client.post(
        "/api/actions/publish_update",
        json=payload,
        headers={"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["message"] == "Invalid payload."


def test_future_slug_returns_400(client: TestClient):
    future_date = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    payload = _valid_payload(slug=f"market-diagnostic-{future_date}")
    resp = client.post(
        "/api/actions/publish_update",
        json=payload,
        headers={"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["message"] == "Invalid payload."


def test_idempotency_returns_skipped_for_existing_slug(client: TestClient):
    headers = {"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"}

    first = client.post("/api/actions/publish_update", json=_valid_payload(), headers=headers)
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["ok"] is True
    assert first_body["action"] == "posted"
    assert first_body["slug"] == "market-diagnostic-2026-02-10"
    assert first_body.get("id")

    second = client.post("/api/actions/publish_update", json=_valid_payload(), headers=headers)
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["ok"] is True
    assert second_body["action"] == "skipped"
    assert second_body["slug"] == "market-diagnostic-2026-02-10"
    assert second_body.get("id") == first_body.get("id")


def test_successful_post_returns_posted(client: TestClient):
    resp = client.post(
        "/api/actions/publish_update",
        json=_valid_payload(slug="market-diagnostic-2026-02-09"),
        headers={"Authorization": f"Bearer {settings.GPT_ACTION_PUBLISH_KEY}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["action"] == "posted"
    assert body["slug"] == "market-diagnostic-2026-02-09"
    assert body.get("id")
