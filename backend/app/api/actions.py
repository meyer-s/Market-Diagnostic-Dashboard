import json
import logging
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Header, HTTPException, Request
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.actions_run_market_diagnostic import GPTActionRunMarketDiagnosticRequest
from app.schemas.actions_publish_update import (
    GPTActionPublishUpdatePayload,
    GPTActionPublishUpdateResponse,
)
from app.schemas.market_diagnostic_payload import MarketDiagnosticRunResult
from app.services.market_diagnostic_runner import run_market_diagnostic
from app.services.update_posts import create_update_post_if_absent
from app.utils.db_helpers import get_db_session

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_gpt_action_publish_key(authorization: Optional[str]) -> None:
    expected_key = (settings.GPT_ACTION_PUBLISH_KEY or "").strip()
    if not expected_key:
        # Fail closed: never allow publishing if the key is not configured.
        raise HTTPException(status_code=500, detail="GPT actions publish key is not configured.")

    header = (authorization or "").strip()
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")
    provided = header.split(" ", 1)[1].strip()
    if not provided or provided != expected_key:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")


def _require_gpt_action_run_key(authorization: Optional[str]) -> None:
    expected_key = (settings.GPT_ACTION_RUN_KEY or "").strip()
    if not expected_key:
        raise HTTPException(status_code=500, detail="GPT actions run key is not configured.")

    header = (authorization or "").strip()
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")
    provided = header.split(" ", 1)[1].strip()
    if not provided or provided != expected_key:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")


def _request_id_from_request(request: Request) -> str:
    # Prefer caller-provided request ID when present.
    for header_name in ("x-request-id", "x-correlation-id", "x-amzn-trace-id"):
        value = (request.headers.get(header_name) or "").strip()
        if value:
            return value
    return str(uuid4())


@router.post("/api/actions/run_market_diagnostic", response_model=MarketDiagnosticRunResult)
@router.post("/actions/run_market_diagnostic", response_model=MarketDiagnosticRunResult, include_in_schema=False)
def run_market_diagnostic_from_action(
    request: Request,
    body: GPTActionRunMarketDiagnosticRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_gpt_action_run_key(authorization)

    run_date_utc = body.run_date_utc or datetime.now(timezone.utc).date().isoformat()
    # Advisory prompt value; scheduled runs are anchored to America/New_York.
    day_of_week = datetime.now(ZoneInfo("America/New_York")).strftime("%a").upper()
    mode = "manual" if body.mode == "manual" else "backfill"

    result = run_market_diagnostic(
        run_date_utc=run_date_utc,
        day_of_week=day_of_week,
        mode=mode,
        dry_run=body.dry_run,
    )

    logger.info(
        "gpt_action_run_market_diagnostic %s",
        json.dumps(
            {
                "request_id": _request_id_from_request(request),
                "run_date_utc": run_date_utc,
                "slug": result.slug,
                "action": result.action,
                "ok": result.ok,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    )
    return result


@router.post("/api/actions/publish_update", response_model=GPTActionPublishUpdateResponse)
@router.post("/actions/publish_update", response_model=GPTActionPublishUpdateResponse, include_in_schema=False)
def publish_update_from_action(
    request: Request,
    raw_payload: dict = Body(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """
    Narrow publish endpoint intended for Custom GPT Actions.

    Exposed on both /api/actions/publish_update and /actions/publish_update to support
    deployments where a reverse proxy may (or may not) strip the /api prefix.
    """
    _require_gpt_action_publish_key(authorization)

    try:
        payload = GPTActionPublishUpdatePayload.model_validate(raw_payload)
    except ValidationError as exc:
        # Map schema/validation failures to 400 for Actions callers.
        # Pydantic's error payload may include non-JSON-serializable objects in "ctx".
        sanitized_errors = []
        for err in exc.errors():
            if isinstance(err, dict) and "ctx" in err:
                err = {k: v for k, v in err.items() if k != "ctx"}
            sanitized_errors.append(err)
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid payload.", "errors": sanitized_errors},
        )

    request_id = _request_id_from_request(request)

    with get_db_session() as db:
        post, created = create_update_post_if_absent(
            db,
            title=payload.title,
            summary=payload.summary,
            status=payload.status,
            tags=payload.tags,
            slug=payload.slug,
            content_markdown=payload.content_markdown,
            chart_urls=payload.chart_urls,
            published=payload.published,
            pinned=payload.pinned,
        )

    action = "posted" if created else "skipped"

    logger.info(
        "gpt_action_publish_update %s",
        json.dumps(
            {
                "request_id": request_id,
                "slug": post.slug,
                "action": action,
                "status": str(payload.status),
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    )

    return GPTActionPublishUpdateResponse(ok=True, id=post.id, slug=post.slug, action=action)
