from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
import pytest

from app.api.secret_options import router as real_secret_options_router
from app.api.secret_options_security import (
    SecretOptionsAuditRoute,
    require_secret_options_access,
    secret_options_access_payload,
    set_secret_options_audit_change,
)
from app.core.config import settings


READ_KEY = "read-" + ("r" * 40)
WRITE_KEY = "write-" + ("w" * 40)


def _app() -> FastAPI:
    app = FastAPI()
    router = APIRouter(
        prefix="/secret/options",
        dependencies=[Depends(require_secret_options_access)],
        route_class=SecretOptionsAuditRoute,
    )

    @router.get("/access")
    def access(request: Request):
        return secret_options_access_payload(request)

    @router.post("/objects/{object_id}")
    def mutate(object_id: int, request: Request):
        set_secret_options_audit_change(
            request,
            object_type="test_object",
            object_id=object_id,
            before={"id": object_id, "status": "before", "secret": "not-logged"},
            after={"id": object_id, "status": "after", "secret": "still-not-logged"},
        )
        return {"id": object_id, "status": "after"}

    @router.post("/batches/backfill")
    def backfill(request: Request):
        summary = {
            "checked": 25,
            "updated": 7,
            "lookback_days": 365,
            "limit": 100,
            "force": False,
        }
        set_secret_options_audit_change(
            request,
            object_type="test_batch",
            object_id="backfill",
            after=summary,
        )
        return summary

    app.include_router(router)
    return app


def _real_app() -> FastAPI:
    app = FastAPI()
    app.include_router(real_secret_options_router)
    return app


def _audit_event(caplog: pytest.LogCaptureFixture, request_id: str) -> dict[str, object]:
    line = next(record.getMessage() for record in caplog.records if request_id in record.getMessage())
    return json.loads(line.split("secret_options_audit ", 1)[1])


@pytest.fixture()
def production_auth(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", READ_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", WRITE_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_ACTOR", "research-reader")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_ACTOR", "portfolio-operator")
    return TestClient(_app())


def test_missing_authorization_returns_401_with_request_id(
    production_auth: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING, logger="secret_options.audit")
    response = production_auth.get(
        "/secret/options/access",
        headers={"X-Request-ID": "auth-missing-1"},
    )

    assert response.status_code == 401
    assert response.headers["x-request-id"] == "auth-missing-1"
    assert response.headers["www-authenticate"] == 'Bearer realm="secret-options"'
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["vary"] == "Authorization"
    event = _audit_event(caplog, "auth-missing-1")
    assert event["actor"] == "anonymous"
    assert event["scope"] == "none"
    assert event["result"] == "denied_missing_or_malformed"
    assert event["status_code"] == 401


def test_cookie_does_not_authenticate_bearer_boundary(production_auth: TestClient) -> None:
    response = production_auth.get(
        "/secret/options/access",
        cookies={"secret_options_token": READ_KEY},
    )

    assert response.status_code == 401


def test_wrong_bearer_token_returns_401(production_auth: TestClient) -> None:
    response = production_auth.get(
        "/secret/options/access",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert response.status_code == 401


def test_read_token_can_validate_access_without_exposing_key(production_auth: TestClient) -> None:
    response = production_auth.get(
        "/secret/options/access",
        headers={
            "Authorization": f"Bearer {READ_KEY}",
            "X-Request-ID": "reader-access-1",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "actor": "research-reader",
        "scope": "read",
        "request_id": "reader-access-1",
        "auth_mode": "bearer",
    }
    assert READ_KEY not in response.text
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["vary"] == "Authorization"


def test_read_token_is_forbidden_from_mutations(
    production_auth: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING, logger="secret_options.audit")
    response = production_auth.post(
        "/secret/options/objects/7",
        json={"status": "after"},
        headers={
            "Authorization": f"Bearer {READ_KEY}",
            "X-Request-ID": "reader-forbidden-7",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "The supplied Secret Options credential is read-only."
    assert response.headers["x-request-id"] == "reader-forbidden-7"
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    event = _audit_event(caplog, "reader-forbidden-7")
    assert event["actor"] == "research-reader"
    assert event["scope"] == "read"
    assert event["result"] == "denied_insufficient_scope"
    assert event["status_code"] == 403
    assert READ_KEY not in json.dumps(event)


def test_validation_errors_are_non_cacheable(production_auth: TestClient) -> None:
    response = production_auth.post(
        "/secret/options/objects/not-an-integer",
        json={"status": "after"},
        headers={
            "Authorization": f"Bearer {WRITE_KEY}",
            "X-Request-ID": "validation-error-1",
        },
    )

    assert response.status_code == 422
    assert response.headers["x-request-id"] == "validation-error-1"
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_write_token_can_mutate_and_emits_redacted_audit(
    production_auth: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="secret_options.audit")

    response = production_auth.post(
        "/secret/options/objects/7",
        json={"status": "after", "private_note": "never log this"},
        headers={
            "Authorization": f"Bearer {WRITE_KEY}",
            "X-Request-ID": "writer-change-7",
        },
    )

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "writer-change-7"
    line = next(record.getMessage() for record in caplog.records if "writer-change-7" in record.getMessage())
    event = json.loads(line.split("secret_options_audit ", 1)[1])
    assert event["actor"] == "portfolio-operator"
    assert event["scope"] == "write"
    assert event["route"] == "/secret/options/objects/{object_id}"
    assert event["object"] == {"type": "test_object", "id": "7"}
    assert event["result"] == "success"
    assert event["before"]["status"] == "before"
    assert event["after"]["status"] == "after"
    assert event["request_change"]["fields"] == ["private_note", "status"]
    assert WRITE_KEY not in line
    assert "never log this" not in line
    assert "not-logged" not in line


def test_batch_audit_exposes_curated_counts_without_raw_payload(
    production_auth: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="secret_options.audit")

    response = production_auth.post(
        "/secret/options/batches/backfill",
        headers={
            "Authorization": f"Bearer {WRITE_KEY}",
            "X-Request-ID": "batch-backfill-1",
        },
    )

    assert response.status_code == 200
    event = _audit_event(caplog, "batch-backfill-1")
    assert event["object"] == {"type": "test_batch", "id": "backfill"}
    assert event["after"]["checked"] == 25
    assert event["after"]["updated"] == 7
    assert event["after"]["lookback_days"] == 365
    assert event["after"]["limit"] == 100
    assert event["after"]["force"] is False


def test_production_fails_closed_when_keys_are_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", None)

    response = TestClient(_app()).get(
        "/secret/options/access",
        headers={"Authorization": "Bearer anything"},
    )

    assert response.status_code == 503


def test_production_rejects_shared_read_write_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    shared_key = "shared-" + ("s" * 40)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", shared_key)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", shared_key)

    response = TestClient(_app()).get(
        "/secret/options/access",
        headers={"Authorization": f"Bearer {shared_key}"},
    )

    assert response.status_code == 503


def test_production_rejects_short_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", "short-read-key")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", "short-write-key")

    response = TestClient(_app()).get(
        "/secret/options/access",
        headers={"Authorization": "Bearer short-read-key"},
    )

    assert response.status_code == 503


def test_real_secret_options_router_enforces_auth_and_audit_wrapper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", READ_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", WRITE_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_ACTOR", "research-reader")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_ACTOR", "portfolio-operator")

    routes = [route for route in real_secret_options_router.routes if isinstance(route, APIRoute)]
    assert routes
    assert all(isinstance(route, SecretOptionsAuditRoute) for route in routes)
    assert all(
        any(dependency.call is require_secret_options_access for dependency in route.dependant.dependencies)
        for route in routes
    )

    client = TestClient(_real_app())
    assert client.get("/secret/options/access").status_code == 401
    access = client.get(
        "/secret/options/access",
        headers={"Authorization": f"Bearer {READ_KEY}"},
    )
    assert access.status_code == 200
    assert access.json()["scope"] == "read"
    mutation = client.post(
        "/secret/options/thesis-assessments/refresh-due?limit=1",
        headers={"Authorization": f"Bearer {READ_KEY}"},
    )
    assert mutation.status_code == 403


def test_unconfigured_development_remains_backward_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", None)

    response = TestClient(_app()).get("/secret/options/access")

    assert response.status_code == 200
    assert response.json()["scope"] == "development"
    assert response.json()["auth_mode"] == "development_bypass"
