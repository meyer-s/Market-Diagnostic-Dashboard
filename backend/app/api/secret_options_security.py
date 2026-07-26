from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any, Mapping, Optional
from uuid import uuid4

from fastapi import Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse, Response

from app.core.config import settings


logger = logging.getLogger("secret_options.audit")

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}
_READ_SCOPE_APPEND_ROUTES = {
    ("POST", "/secret/options/scanner-impressions"),
}
_PRODUCTION_ENVIRONMENTS = {"prod", "production"}
_MINIMUM_PRODUCTION_KEY_LENGTH = 32
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_SAFE_AUDIT_VALUE_KEYS = {
    "active",
    "approval_status",
    "automated_execution_enabled",
    "automated_model_promotion",
    "checked",
    "checked_events",
    "closed_positions_checked",
    "closed_positions_linked",
    "closed_position_id",
    "dry_run",
    "errors",
    "event_type",
    "force",
    "id",
    "inserted",
    "limit",
    "linked_only",
    "lookback_days",
    "mature_decisions",
    "model_version",
    "open_positions_checked",
    "open_positions_linked",
    "outcome_count",
    "policy_version",
    "position_id",
    "recompute_training",
    "refreshed",
    "reminders_updated",
    "review_sequence",
    "run_id",
    "received",
    "skipped_no_recipe",
    "status",
    "skipped_duplicates",
    "snapshot_id",
    "supersedes_review_id",
    "training_rows_checked",
    "training_rows_failed",
    "training_rows_recomputed",
    "training_rows_stamped",
    "updated",
    "updated_events",
}

_SECRET_RESPONSE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


def _apply_security_headers(response: Response, request_id: str) -> None:
    response.headers["X-Request-ID"] = request_id
    for header_name, header_value in _SECRET_RESPONSE_HEADERS.items():
        response.headers[header_name] = header_value
    vary_values = {
        item.strip()
        for item in response.headers.get("Vary", "").split(",")
        if item.strip()
    }
    vary_values.add("Authorization")
    response.headers["Vary"] = ", ".join(sorted(vary_values))


def _configured(value: Optional[str]) -> str:
    return str(value or "").strip()


def _production_auth_required() -> bool:
    environment = _configured(getattr(settings, "APP_ENV", "development")).lower()
    return environment in _PRODUCTION_ENVIRONMENTS


def _auth_required(read_key: str, write_key: str) -> bool:
    configured_requirement = getattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    return (
        _production_auth_required()
        or configured_requirement is True
        or bool(read_key)
        or bool(write_key)
    )


def _request_id(request: Request) -> str:
    existing = getattr(request.state, "secret_options_request_id", None)
    if existing:
        return str(existing)
    for header_name in ("x-request-id", "x-correlation-id", "x-amzn-trace-id"):
        candidate = _configured(request.headers.get(header_name))
        if candidate and _REQUEST_ID_PATTERN.fullmatch(candidate):
            request.state.secret_options_request_id = candidate
            return candidate
    generated = str(uuid4())
    request.state.secret_options_request_id = generated
    return generated


def _audit_actor(value: Optional[str], fallback: str) -> str:
    candidate = _configured(value)
    if not candidate:
        return fallback
    cleaned = re.sub(r"[^A-Za-z0-9._:@/-]+", "-", candidate).strip("-")
    return cleaned[:80] or fallback


def _bearer_token(authorization: Optional[str]) -> str | None:
    header = _configured(authorization)
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if not token or "," in token:
        return None
    return token


def _matches(provided: str, expected: str) -> bool:
    return bool(expected) and hmac.compare_digest(provided, expected)


def _read_scope_append_allowed(request: Request) -> bool:
    return (
        request.method.upper(),
        request.url.path.rstrip("/") or "/",
    ) in _READ_SCOPE_APPEND_ROUTES


def _deny(
    request: Request,
    *,
    status_code: int,
    detail: str,
    result: str,
) -> None:
    request.state.secret_options_actor = "anonymous"
    request.state.secret_options_scope = "none"
    request.state.secret_options_auth_result = result
    headers = {"X-Request-ID": _request_id(request), **_SECRET_RESPONSE_HEADERS}
    headers["Vary"] = "Authorization"
    if status_code == 401:
        headers["WWW-Authenticate"] = 'Bearer realm="secret-options"'
    raise HTTPException(status_code=status_code, detail=detail, headers=headers)


def require_secret_options_access(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> None:
    """Authorize every Secret Options route with separate read/write bearer scopes.

    Local development remains backward compatible when no Secret Options keys are
    configured. Production always fails closed and requires two distinct keys.
    """

    _request_id(request)
    read_key = _configured(getattr(settings, "SECRET_OPTIONS_READ_API_KEY", None))
    write_key = _configured(getattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", None))
    required = _auth_required(read_key, write_key)

    if not required:
        request.state.secret_options_actor = "local-development"
        request.state.secret_options_scope = "development"
        request.state.secret_options_auth_result = "development_bypass"
        return

    if _production_auth_required() and (
        not read_key
        or not write_key
        or len(read_key) < _MINIMUM_PRODUCTION_KEY_LENGTH
        or len(write_key) < _MINIMUM_PRODUCTION_KEY_LENGTH
        or hmac.compare_digest(read_key, write_key)
    ):
        _deny(
            request,
            status_code=503,
            detail="Secret Options authentication is not configured safely.",
            result="denied_misconfigured",
        )

    is_write = (
        request.method.upper() not in _READ_METHODS
        and not _read_scope_append_allowed(request)
    )
    if is_write and not write_key:
        _deny(
            request,
            status_code=503,
            detail="Secret Options write authentication is not configured.",
            result="denied_misconfigured",
        )
    if not is_write and not (read_key or write_key):
        _deny(
            request,
            status_code=503,
            detail="Secret Options read authentication is not configured.",
            result="denied_misconfigured",
        )

    token = _bearer_token(authorization)
    if token is None:
        _deny(
            request,
            status_code=401,
            detail="Missing or invalid Authorization header.",
            result="denied_missing_or_malformed",
        )

    if _matches(token, write_key):
        request.state.secret_options_actor = _audit_actor(
            getattr(settings, "SECRET_OPTIONS_WRITE_ACTOR", None),
            "secret-options-writer",
        )
        request.state.secret_options_scope = "write"
        request.state.secret_options_auth_result = "authorized"
        return

    if _matches(token, read_key):
        if is_write:
            request.state.secret_options_actor = _audit_actor(
                getattr(settings, "SECRET_OPTIONS_READ_ACTOR", None),
                "secret-options-reader",
            )
            request.state.secret_options_scope = "read"
            request.state.secret_options_auth_result = "denied_insufficient_scope"
            raise HTTPException(
                status_code=403,
                detail="The supplied Secret Options credential is read-only.",
                headers={
                    "X-Request-ID": _request_id(request),
                    "Vary": "Authorization",
                    **_SECRET_RESPONSE_HEADERS,
                },
            )
        request.state.secret_options_actor = _audit_actor(
            getattr(settings, "SECRET_OPTIONS_READ_ACTOR", None),
            "secret-options-reader",
        )
        request.state.secret_options_scope = "read"
        request.state.secret_options_auth_result = "authorized"
        return

    _deny(
        request,
        status_code=401,
        detail="Missing or invalid Authorization header.",
        result="denied_invalid",
    )


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return _jsonable(model_dump())
    return str(value)


def _snapshot(value: Any) -> dict[str, object] | None:
    if value is None:
        return None
    normalized = _jsonable(value)
    encoded = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    snapshot: dict[str, object] = {
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "bytes": len(encoded),
        "type": type(value).__name__,
    }
    if isinstance(normalized, dict):
        snapshot["fields"] = sorted(str(key) for key in normalized)[:80]
        for key in _SAFE_AUDIT_VALUE_KEYS:
            candidate = normalized.get(key)
            if candidate is None or isinstance(candidate, (str, int, float, bool)):
                if candidate is not None:
                    snapshot[key] = candidate
    return snapshot


def set_secret_options_audit_change(
    request: Request,
    *,
    object_type: str,
    object_id: object | None,
    before: Any = None,
    after: Any = None,
) -> None:
    request.state.secret_options_audit_object = {
        "type": re.sub(r"[^A-Za-z0-9._-]+", "-", object_type)[:80],
        "id": None if object_id is None else str(object_id)[:80],
    }
    request.state.secret_options_audit_before = _snapshot(before)
    request.state.secret_options_audit_after = _snapshot(after)


def secret_options_access_payload(request: Request) -> dict[str, str]:
    """Return the authenticated principal metadata, never credential material."""

    scope = str(getattr(request.state, "secret_options_scope", "none"))
    return {
        "actor": str(getattr(request.state, "secret_options_actor", "anonymous")),
        "scope": scope,
        "request_id": _request_id(request),
        "auth_mode": "bearer" if scope in {"read", "write"} else "development_bypass",
    }


def _body_metadata(body: bytes, content_type: str | None) -> dict[str, object] | None:
    if not body:
        return None
    metadata: dict[str, object] = {
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "content_type": (content_type or "").split(";", 1)[0],
    }
    if "json" in (content_type or "").lower():
        try:
            parsed = json.loads(body)
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = None
        if isinstance(parsed, dict):
            metadata["fields"] = sorted(str(key) for key in parsed)[:80]
    return metadata


def _route_object(request: Request) -> dict[str, object] | None:
    explicit = getattr(request.state, "secret_options_audit_object", None)
    if isinstance(explicit, dict):
        return explicit
    identifiers = {
        str(key): str(value)[:80]
        for key, value in request.path_params.items()
        if str(key).endswith("_id") or str(key) == "run_id"
    }
    return identifiers or None


class SecretOptionsAuditRoute(APIRoute):
    """Emit one redacted structured security event for every matched route."""

    def get_route_handler(self):  # type: ignore[no-untyped-def]
        original_handler = super().get_route_handler()

        async def audited_handler(request: Request) -> Response:
            request_id = _request_id(request)
            started = time.perf_counter()
            response: Response | None = None
            raised: Exception | None = None
            request_change = None
            if request.method.upper() not in _READ_METHODS:
                request_change = _body_metadata(
                    await request.body(),
                    request.headers.get("content-type"),
                )
            try:
                response = await original_handler(request)
                _apply_security_headers(response, request_id)
                return response
            except RequestValidationError as exc:
                raised = exc
                response = JSONResponse(
                    status_code=422,
                    content={"detail": jsonable_encoder(exc.errors())},
                )
                _apply_security_headers(response, request_id)
                return response
            except Exception as exc:
                raised = exc
                if isinstance(exc, HTTPException):
                    exception_headers = dict(exc.headers or {})
                    exception_headers.setdefault("X-Request-ID", request_id)
                    exception_headers.setdefault("Vary", "Authorization")
                    for header_name, header_value in _SECRET_RESPONSE_HEADERS.items():
                        exception_headers.setdefault(header_name, header_value)
                    exc.headers = exception_headers
                raise
            finally:
                status_code = (
                    response.status_code
                    if response is not None
                    else int(getattr(raised, "status_code", 500))
                )
                auth_result = str(
                    getattr(request.state, "secret_options_auth_result", "not_evaluated")
                )
                if auth_result == "authorized" or auth_result == "development_bypass":
                    result = "success" if status_code < 400 else "request_rejected"
                else:
                    result = auth_result
                before = getattr(request.state, "secret_options_audit_before", None)
                after = getattr(request.state, "secret_options_audit_after", None)
                if (
                    after is None
                    and request.method.upper() not in _READ_METHODS
                    and response is not None
                ):
                    after = _body_metadata(
                        bytes(getattr(response, "body", b"")),
                        response.headers.get("content-type"),
                    )
                event = {
                    "event": "secret_options_access",
                    "request_id": request_id,
                    "actor": str(
                        getattr(request.state, "secret_options_actor", "anonymous")
                    ),
                    "scope": str(
                        getattr(request.state, "secret_options_scope", "none")
                    ),
                    "method": request.method.upper(),
                    "route": self.path,
                    "object": _route_object(request),
                    "result": result,
                    "status_code": status_code,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
                    "request_change": request_change,
                    "before": before,
                    "after": after,
                }
                log_method = logger.warning if status_code >= 400 else logger.info
                log_method(
                    "secret_options_audit %s",
                    json.dumps(event, sort_keys=True, separators=(",", ":")),
                )

        return audited_handler
