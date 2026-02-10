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
            "Date: 2026-02-10 (UTC)\n\n"
            "## Earnings / EPS Revisions (S&P 500)\n"
            "Trend: Mixed but stable.\n"
            "- Earnings breadth is steady. (Source: Test)\n"
            "- Guidance dispersion remains a watch item. (Source: Test)\n"
            "- Revisions trend is stable. (Source: Test)\n"
            "Signal: 🟡 Neutral\n\n"
            "## Credit Stress (HY OAS, IG Spreads, Bank CDS)\n"
            "Trend: Contained.\n"
            "- HY spreads are steady. (Source: Test)\n"
            "- IG spreads are rangebound. (Source: Test)\n"
            "- Bank CDS remains stable. (Source: Test)\n"
            "Signal: 🟡 Mixed\n\n"
            "## Growth (Nowcasts/PMIs + Sahm Rule Proximity)\n"
            "Trend: Moderating.\n"
            "- Nowcasts suggest slower momentum. (Source: Test)\n"
            "- PMIs are mixed. (Source: Test)\n"
            "- Sahm Rule proximity remains below trigger. (Source: Test)\n"
            "Signal: 🟡 Slowing\n\n"
            "## Financial Conditions Indexes\n"
            "Trend: Mixed.\n"
            "- Conditions remain neutral. (Source: Test)\n"
            "- Liquidity remains adequate. (Source: Test)\n"
            "- Volatility remains contained. (Source: Test)\n"
            "Signal: 🟡 Monitor\n\n"
            "## Policy / Geopolitical Headlines\n"
            "Trend: Elevated watch.\n"
            "- Policy guidance remains data-dependent. (Source: Test)\n"
            "- Geopolitical risks remain headline-driven. (Source: Test)\n"
            "- Fiscal signals are mixed. (Source: Test)\n"
            "Signal: 🟡 Policy Risk Watch\n\n"
            "## Risk Regime Assessment\n"
            "Risk Regime: 🟡 Late-Cycle / Fragile\n"
            "Correction risk elevated?: No\n"
            "Recession risk elevated?: No\n"
            "- Earnings breadth remains mixed. (Source: Test)\n"
            "- Credit conditions are steady. (Source: Test)\n"
            "- Growth is moderating, not contracting. (Source: Test)\n"
            "- Financial conditions remain neutral. (Source: Test)\n"
            "Final Regime: 🟡 Late-Cycle / Fragile\n"
            "Confidence: Medium\n"
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
