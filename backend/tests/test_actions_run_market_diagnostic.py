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
from app.services.market_diagnostic_runner import _build_prompts
from app.services.market_diagnostic_validation import validate_market_diagnostic_structure

def _valid_generated_payload(*, run_date_utc: str) -> dict:
    return {
        "title": "Market Diagnostic — Feb 10",
        "summary": "One-sentence summary aligned with the current regime.",
        "status": "YELLOW",
        "tags": ["market-diagnostic", "macro"],
        "slug": f"market-diagnostic-{run_date_utc}",
        "content_markdown": (
            f"Date: {run_date_utc} (UTC)\n\n"
            "## Earnings / EPS Revisions (S&P 500)\n"
            "Trend: Mixed but stable.\n"
            "- Earnings breadth is steady. (Source: https://example.com/earnings)\n"
            "- Guidance dispersion remains a watch item. (Source: https://example.com/earnings)\n"
            "- Revisions trend is stable. (Source: https://example.com/earnings)\n"
            "Signal: 🟡 Neutral\n\n"
            "## Credit Stress (HY OAS, IG Spreads, Bank CDS)\n"
            "Trend: Contained.\n"
            "- HY spreads are steady. (Source: https://example.com/credit)\n"
            "- IG spreads are rangebound. (Source: https://example.com/credit)\n"
            "- Bank CDS remains stable. (Source: https://example.com/credit)\n"
            "Signal: 🟡 Mixed\n\n"
            "## Growth (Nowcasts/PMIs + Sahm Rule Proximity)\n"
            "Trend: Moderating.\n"
            "- Nowcasts suggest slower momentum. (Source: https://example.com/growth)\n"
            "- PMIs are mixed. (Source: https://example.com/growth)\n"
            "- Sahm Rule proximity remains below trigger. (Source: https://example.com/growth)\n"
            "Signal: 🟡 Slowing\n\n"
            "## Financial Conditions Indexes\n"
            "Trend: Mixed.\n"
            "- Conditions remain neutral. (Source: https://example.com/conditions)\n"
            "- Liquidity remains adequate. (Source: https://example.com/conditions)\n"
            "- Volatility remains contained. (Source: https://example.com/conditions)\n"
            "Signal: 🟡 Monitor\n\n"
            "## Policy / Geopolitical Headlines\n"
            "Trend: Elevated watch.\n"
            "- Policy guidance remains data-dependent. (Source: https://example.com/policy)\n"
            "- Geopolitical risks remain headline-driven. (Source: https://example.com/policy)\n"
            "- Fiscal signals are mixed. (Source: https://example.com/policy)\n"
            "Signal: 🟡 Policy Risk Watch\n\n"
            "## Risk Regime Assessment\n"
            "Risk Regime: 🟡 Late-Cycle / Fragile\n"
            "Correction risk elevated?: No\n"
            "Recession risk elevated?: No\n"
            "- Earnings breadth remains mixed. (Source: https://example.com/regime)\n"
            "- Credit conditions are steady. (Source: https://example.com/regime)\n"
            "- Growth is moderating, not contracting. (Source: https://example.com/regime)\n"
            "- Financial conditions remain neutral. (Source: https://example.com/regime)\n"
            "Final Regime: 🟡 Late-Cycle / Fragile\n"
            "Confidence: Medium\n"
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


def test_openai_failure_returns_error_and_logs_error_code(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    import app.services.market_diagnostic_runner as runner

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
    assert data["ok"] is False
    assert data["slug"] == f"market-diagnostic-{safe_date}"
    assert data["action"] == "skipped"

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
    assert log_json["generation_mode"] == "model"
    assert log_json["openai_error_code"] == "insufficient_quota"


def test_prompt_instructions_emphasize_recent_readable_recaps():
    system_prompt, user_prompt = _build_prompts(
        run_date_utc="2026-04-30",
        day_of_week="Wednesday",
        mode="manual",
        recent_titles=["Prior title"],
    )

    combined = system_prompt + "\n" + user_prompt
    assert "Write for fast human scanning" in combined
    assert "Favor the freshest material possible" in combined
    assert "recent notable earnings" in combined
    assert "major market moves" in combined
    assert "Never use placeholder citations" in combined
    assert '"coverage_targets"' in user_prompt
    assert "3-7 bullets" in combined


def test_validation_allows_richer_sections_with_seven_bullets():
    content_markdown = """Date: 2026-04-30 (UTC)

## Earnings / EPS Revisions (S&P 500)
Trend: Earnings tone improved on fresh mega-cap reports.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
- Item 4. (Source: https://example.com/4)
- Item 5. (Source: https://example.com/5)
- Item 6. (Source: https://example.com/6)
- Item 7. (Source: https://example.com/7)
Signal: 🟢 Supportive

## Credit Stress (HY OAS, IG Spreads, Bank CDS)
Trend: Stable.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Growth (Nowcasts/PMIs + Sahm Rule Proximity)
Trend: Moderating.
No Change: No material change since the prior weekly recap.
Signal: 🟡 Mixed

## Financial Conditions Indexes
Trend: Neutral.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Policy / Geopolitical Headlines
Trend: Watchful.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Risk Regime Assessment
Risk Regime: 🟡 Fragile but improving
Correction risk elevated?: No
Recession risk elevated?: No
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
- Item 4. (Source: https://example.com/4)
- Item 5. (Source: https://example.com/5)
- Item 6. (Source: https://example.com/6)
- Item 7. (Source: https://example.com/7)
Final Regime: 🟡 Stay selective
Confidence: Medium
"""

    validate_market_diagnostic_structure(content_markdown)


def test_validation_rejects_placeholder_source_urls():
    content_markdown = """Date: 2026-04-30 (UTC)

## Earnings / EPS Revisions (S&P 500)
Trend: Earnings tone improved on fresh mega-cap reports.
- Item 1. (Source: https://...)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟢 Supportive

## Credit Stress (HY OAS, IG Spreads, Bank CDS)
Trend: Stable.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Growth (Nowcasts/PMIs + Sahm Rule Proximity)
Trend: Moderating.
No Change: No material change since the prior weekly recap.
Signal: 🟡 Mixed

## Financial Conditions Indexes
Trend: Neutral.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Policy / Geopolitical Headlines
Trend: Watchful.
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
Signal: 🟡 Mixed

## Risk Regime Assessment
Risk Regime: 🟡 Fragile but improving
Correction risk elevated?: No
Recession risk elevated?: No
- Item 1. (Source: https://example.com/1)
- Item 2. (Source: https://example.com/2)
- Item 3. (Source: https://example.com/3)
- Item 4. (Source: https://example.com/4)
Final Regime: 🟡 Stay selective
Confidence: Medium
"""

    with pytest.raises(ValueError, match="valid http"):
        validate_market_diagnostic_structure(content_markdown)
