from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
import logging
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.actions import router as actions_router
from app.core.config import settings
from app.core.db import Base
from app.models.update_post import UpdatePost


def _valid_generated_payload(*, run_date_utc: str) -> dict:
    return {
        "title": "Market Diagnostic — Feb 10",
        "summary": "One-sentence summary aligned with the current regime.",
        "status": "YELLOW",
        "tags": ["market-diagnostic", "macro"],
        "slug": f"market-diagnostic-{run_date_utc}",
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
    settings.GPT_ACTION_RUN_KEY = "test-run-key"
    settings.OPENAI_API_KEY = "test-openai-key"

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    import app.utils.db_helpers as db_helpers

    monkeypatch.setattr(db_helpers, "SessionLocal", TestingSessionLocal, raising=True)

    # Patch OpenAI call to return a deterministic valid payload.
    import app.services.market_diagnostic_runner as runner

    def fake_openai(*, system_prompt: str, user_prompt: str, timeout_seconds: int = 60):
        # Extract run_date_utc from the prompt JSON.
        import json as _json

        parsed = _json.loads(user_prompt)
        return _valid_generated_payload(run_date_utc=parsed["run_date_utc"])

    monkeypatch.setattr(runner, "_openai_chat_completion_json", fake_openai, raising=True)

    app = FastAPI()
    app.include_router(actions_router)
    return TestClient(app)


def test_missing_authorization_header_returns_401(client: TestClient):
    resp = client.post("/api/actions/run_market_diagnostic", json={})
    assert resp.status_code == 401


def test_successful_run_returns_posted_then_skipped(client: TestClient):
    headers = {"Authorization": f"Bearer {settings.GPT_ACTION_RUN_KEY}"}
    body = {"run_date_utc": "2026-02-10", "dry_run": False, "mode": "manual"}

    first = client.post("/api/actions/run_market_diagnostic", json=body, headers=headers)
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["ok"] is True
    assert first_body["slug"] == "market-diagnostic-2026-02-10"
    assert first_body["action"] == "posted"
    assert first_body.get("id")

    second = client.post("/api/actions/run_market_diagnostic", json=body, headers=headers)
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["ok"] is True
    assert second_body["slug"] == "market-diagnostic-2026-02-10"
    assert second_body["action"] == "skipped"
    assert second_body.get("id") == first_body.get("id")


def test_future_run_date_returns_error(client: TestClient):
    headers = {"Authorization": f"Bearer {settings.GPT_ACTION_RUN_KEY}"}
    future_date = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    body = {"run_date_utc": future_date, "dry_run": False, "mode": "manual"}

    resp = client.post("/api/actions/run_market_diagnostic", json=body, headers=headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["ok"] is False
    assert payload["action"] == "skipped"
    assert payload["error"] == "run_date_utc cannot be in the future"


def test_openai_failure_uses_loud_fallback_and_logs_error_code(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    import app.services.market_diagnostic_runner as runner
    import app.utils.db_helpers as db_helpers

    def fake_openai_fail(*, system_prompt: str, user_prompt: str, timeout_seconds: int = 25, **kwargs):
        raise runner.OpenAIRequestError(
            "OpenAI error: status=429 message=insufficient quota",
            status_code=429,
            error_code="insufficient_quota",
            error_type="insufficient_quota",
        )

    monkeypatch.setattr(runner, "_openai_chat_completion_json", fake_openai_fail, raising=True)

    caplog.set_level(logging.INFO, logger="app.services.market_diagnostic_runner")

    headers = {"Authorization": f"Bearer {settings.GPT_ACTION_RUN_KEY}"}
    safe_date = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    body = {"run_date_utc": safe_date, "dry_run": False, "mode": "manual"}

    resp = client.post("/api/actions/run_market_diagnostic", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["slug"] == f"market-diagnostic-{safe_date}"
    assert data["action"] == "posted"

    # Verify fallback was "loud" in the stored post.
    with db_helpers.SessionLocal() as db:
        post = db.query(UpdatePost).filter(UpdatePost.slug == f"market-diagnostic-{safe_date}").first()
        assert post is not None
        assert "fallback" in (post.tags or [])
        assert "openai-unavailable" in (post.tags or [])
        assert "Generation fallback used (OpenAI unavailable)." in (post.content_markdown or "")

    # Verify structured log line includes generation_mode and OpenAI error code.
    log_json = None
    for rec in caplog.records:
        msg = rec.getMessage()
        if msg.startswith("market_diagnostic_run "):
            try:
                import json as _json

                log_json = _json.loads(msg[len("market_diagnostic_run ") :])
            except Exception:
                continue

    assert log_json is not None
    assert log_json["slug"] == f"market-diagnostic-{safe_date}"
    assert log_json["generation_mode"] == "fallback"
    assert log_json["openai_error_code"] == "insufficient_quota"
