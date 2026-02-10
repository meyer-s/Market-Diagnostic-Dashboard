from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from app.core.config import settings
from app.models.system_status import SystemStatus
from app.models.update_post import UpdatePost
from app.schemas.market_diagnostic_payload import (
    MarketDiagnosticPublishPayload,
    MarketDiagnosticRunResult,
)
from app.services.market_diagnostic_validation import validate_slug
from app.services.update_posts import create_update_post_if_absent
from app.utils.db_helpers import get_db_session

logger = logging.getLogger(__name__)


Mode = Literal["scheduled", "manual", "backfill"]


class OpenAIRequestError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        error_type: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.error_type = error_type


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_cached_inputs(run_date_utc: str) -> dict[str, Any]:
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()

    if not status:
        system_snapshot = {
            "status": "YELLOW",
            "score": None,
            "red_count": None,
            "yellow_count": None,
            "timestamp": None,
        }
    else:
        system_snapshot = {
            "status": (status.state or "YELLOW").strip().upper(),
            "score": status.composite_score,
            "red_count": status.red_count,
            "yellow_count": status.yellow_count,
            "timestamp": status.timestamp.isoformat() if status.timestamp else None,
        }

    return {
        "run_date_utc": run_date_utc,
        "system_snapshot": system_snapshot,
    }


def _openai_chat_completion_json(
    *,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: int = 25,
    max_retries: int = 1,
    overall_deadline_seconds: int = 30,
) -> dict[str, Any]:
    api_key = (settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    model = (getattr(settings, "MARKET_DIAGNOSTIC_MODEL", None) or "").strip() or "gpt-4o-mini"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    deadline = time.monotonic() + max(1, overall_deadline_seconds)
    last_exc: Exception | None = None

    for attempt in range(max_retries + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OpenAIRequestError(
                "OpenAI request deadline exceeded.",
                status_code=None,
                error_code="deadline_exceeded",
                error_type="timeout",
            )

        attempt_timeout = min(timeout_seconds, int(remaining))
        if attempt_timeout <= 0:
            attempt_timeout = 1

        try:
            with httpx.Client(timeout=attempt_timeout) as client:
                resp = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )

            if resp.status_code >= 400:
                error_code = None
                error_type = None
                message = resp.text[:400]
                try:
                    err = (resp.json() or {}).get("error") or {}
                    error_code = err.get("code") or None
                    error_type = err.get("type") or None
                    message = (err.get("message") or message)[:400]
                except Exception:
                    pass

                # Only retry for 5xx. Do not retry 4xx/429 to avoid amplifying quota/auth problems.
                if resp.status_code >= 500 and attempt < max_retries:
                    last_exc = OpenAIRequestError(
                        f"OpenAI error: status={resp.status_code} message={message}",
                        status_code=resp.status_code,
                        error_code=error_code,
                        error_type=error_type,
                    )
                    continue

                raise OpenAIRequestError(
                    f"OpenAI error: status={resp.status_code} message={message}",
                    status_code=resp.status_code,
                    error_code=error_code,
                    error_type=error_type,
                )

            data = resp.json()
            last_exc = None
            break
        except httpx.TimeoutException as exc:
            last_exc = OpenAIRequestError(
                f"OpenAI request timeout: {exc}",
                status_code=None,
                error_code="timeout",
                error_type="timeout",
            )
            if attempt < max_retries:
                continue
            raise last_exc
        except httpx.RequestError as exc:
            last_exc = OpenAIRequestError(
                f"OpenAI request error: {exc}",
                status_code=None,
                error_code="request_error",
                error_type="network",
            )
            if attempt < max_retries:
                continue
            raise last_exc

    if last_exc is not None:
        raise last_exc

    try:
        content = data["choices"][0]["message"]["content"]
    except Exception as exc:
        raise RuntimeError(f"OpenAI response parse error: {exc}")

    try:
        return json.loads(content)
    except Exception as exc:
        raise RuntimeError(f"OpenAI did not return valid JSON: {exc}; content={content[:400]}")


def _build_prompts(*, run_date_utc: str, day_of_week: str, mode: Mode, cached_inputs: dict[str, Any]) -> tuple[str, str]:
    system_prompt = (
        "You are an expert macro strategist writing a concise Market Diagnostic for a private dashboard.\n"
        "You must ONLY use the cached_inputs provided by the server.\n"
        "You MUST NOT browse, fetch, or call any external URLs.\n"
        "You MUST output exactly one JSON object and nothing else.\n"
        "Do not include emojis.\n"
    )

    user_prompt = json.dumps(
        {
            "task": "Generate one Market Diagnostic publish payload JSON that matches the schema exactly.",
            "run_date_utc": run_date_utc,
            "day_of_week": day_of_week,
            "mode": mode,
            "schema": {
                "title": "Market Diagnostic — MMM D",
                "summary": "one sentence",
                "status": "GREEN",
                "tags": ["market-diagnostic", "macro"],
                "slug": f"market-diagnostic-{run_date_utc}",
                "content_markdown": (
                    "Must contain these Markdown H2 headings exactly once each and in this exact order: "
                    "## Earnings, ## Credit, ## Growth, ## Financial Conditions, ## Policy/Geo"
                ),
                "chart_urls": [],
                "published": True,
                "pinned": False,
            },
            "cached_inputs": cached_inputs,
            "rules": [
                "Output JSON only (no markdown fences, no commentary).",
                f"slug MUST equal market-diagnostic-{run_date_utc}.",
                "status MUST be exactly one of: GREEN, YELLOW, RED (a single string, not an array).",
                "tags MUST include market-diagnostic and macro.",
                "chart_urls MUST be an empty array unless you have real http(s) URLs in cached_inputs (otherwise keep []).",
                "content_markdown MUST include the required headings in order and exactly once each.",
                "No emojis anywhere.",
            ],
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return system_prompt, user_prompt


def _fallback_payload(*, run_date_utc: str, cached_inputs: dict[str, Any]) -> dict[str, Any]:
    # Deterministic fallback when OpenAI is unavailable (quota/network/etc).
    dt = datetime.strptime(run_date_utc, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    title = f"Market Diagnostic — {dt.strftime('%b')} {dt.day}"
    slug = f"market-diagnostic-{run_date_utc}"

    snapshot = (cached_inputs or {}).get("system_snapshot") or {}
    status_raw = (snapshot.get("status") or "YELLOW").strip().upper()
    status = status_raw if status_raw in {"GREEN", "YELLOW", "RED"} else "YELLOW"
    score = snapshot.get("score")
    red_count = snapshot.get("red_count")
    yellow_count = snapshot.get("yellow_count")

    score_part = "System composite score unavailable."
    if isinstance(score, (int, float)):
        score_part = f"System conditions are {status.lower()} with composite score near {float(score):.1f}."

    breadth_part = ""
    if isinstance(red_count, int) and isinstance(yellow_count, int):
        breadth_part = f" Breadth: {red_count} red, {yellow_count} yellow."

    summary = f"{score_part}{breadth_part}".strip()

    content_markdown = (
        f"_As of UTC {run_date_utc}_\n\n"
        f"{summary}\n\n"
        "## Earnings\n"
        "- Earnings tone remains aligned with the current macro regime and leadership breadth.\n\n"
        "## Credit\n"
        "- Credit spreads and funding conditions remain central to the risk read.\n\n"
        "## Growth\n"
        "- Growth momentum remains tied to labor and demand resilience in incoming data.\n\n"
        "## Financial Conditions\n"
        "- Financial conditions remain a primary transmission channel for regime shifts.\n\n"
        "## Policy/Geo\n"
        "- Generation fallback used (OpenAI unavailable).\n"
        "- Policy communication and geopolitical developments remain key tail-risk inputs.\n"
    )

    tags = ["market-diagnostic", "macro"]
    if status == "GREEN":
        tags += ["risk-on", "stability"]
    elif status == "RED":
        tags += ["risk-off", "stress"]
    else:
        tags += ["caution", "transitional"]

    tags += ["fallback", "openai-unavailable"]

    return {
        "title": title,
        "summary": summary,
        "status": status,
        "tags": tags,
        "slug": slug,
        "content_markdown": content_markdown,
        "chart_urls": [],
        "published": True,
        "pinned": False,
    }


def run_market_diagnostic(
    *,
    run_date_utc: str,
    day_of_week: str,
    mode: Mode = "scheduled",
    dry_run: bool = False,
) -> MarketDiagnosticRunResult:
    """
    Server-side job runner: fetch cached inputs, call OpenAI, validate, idempotently publish by slug.
    """
    started = time.perf_counter()
    slug = f"market-diagnostic-{run_date_utc}"
    request_id = f"md-{run_date_utc}-{int(time.time())}"
    generation_mode: Literal["model", "fallback"] | None = None
    openai_error_code: str | None = None
    openai_status_code: int | None = None

    # Idempotency short-circuit: if slug already exists, never call OpenAI.
    with get_db_session() as db:
        existing = db.query(UpdatePost).filter(UpdatePost.slug == slug).first()
        if existing:
            logger.info(
                "market_diagnostic_run %s",
                json.dumps(
                    {
                        "timestamp_utc": _now_utc_iso(),
                        "request_id": request_id,
                        "run_date_utc": run_date_utc,
                        "slug": slug,
                        "status": str(existing.status),
                        "action": "skipped",
                        "id": existing.id,
                        "mode": mode,
                        "dry_run": dry_run,
                        "duration_ms": int((time.perf_counter() - started) * 1000),
                        "validation": "skipped_existing",
                        "generation_mode": None,
                        "openai_error_code": None,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
            return MarketDiagnosticRunResult(ok=True, slug=slug, action="skipped", id=existing.id)

    cached_inputs = _load_cached_inputs(run_date_utc)
    system_prompt, user_prompt = _build_prompts(
        run_date_utc=run_date_utc,
        day_of_week=day_of_week,
        mode=mode,
        cached_inputs=cached_inputs,
    )

    used_fallback = False
    try:
        model_json = _openai_chat_completion_json(system_prompt=system_prompt, user_prompt=user_prompt)
        payload = MarketDiagnosticPublishPayload.model_validate(model_json)
        validate_slug(payload.slug, run_date_utc=run_date_utc)
        if payload.slug != slug:
            raise ValueError(f"slug mismatch: expected={slug} got={payload.slug}")
        if payload.published is not True:
            raise ValueError("published must be true")
        if payload.pinned is not False:
            raise ValueError("pinned must be false")
        generation_mode = "model"
    except Exception as exc:
        if isinstance(exc, OpenAIRequestError):
            openai_error_code = exc.error_code
            openai_status_code = exc.status_code
        else:
            openai_error_code = None
            openai_status_code = None

        if dry_run:
            logger.error(
                "market_diagnostic_run %s",
                json.dumps(
                    {
                        "timestamp_utc": _now_utc_iso(),
                        "request_id": request_id,
                        "run_date_utc": run_date_utc,
                        "slug": slug,
                        "status": None,
                        "action": "skipped",
                        "id": None,
                        "mode": mode,
                        "dry_run": True,
                        "duration_ms": int((time.perf_counter() - started) * 1000),
                        "validation": "failed",
                        "error": str(exc),
                        "generation_mode": "model",
                        "openai_error_code": openai_error_code,
                        "openai_status_code": openai_status_code,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
            return MarketDiagnosticRunResult(ok=False, slug=slug, action="skipped", id=None, error=str(exc))

        try:
            fallback_json = _fallback_payload(run_date_utc=run_date_utc, cached_inputs=cached_inputs)
            payload = MarketDiagnosticPublishPayload.model_validate(fallback_json)
            validate_slug(payload.slug, run_date_utc=run_date_utc)
            used_fallback = True
            generation_mode = "fallback"
        except Exception as fallback_exc:
            logger.error(
                "market_diagnostic_run %s",
                json.dumps(
                    {
                        "timestamp_utc": _now_utc_iso(),
                        "request_id": request_id,
                        "run_date_utc": run_date_utc,
                        "slug": slug,
                        "status": None,
                        "action": "skipped",
                        "id": None,
                        "mode": mode,
                        "dry_run": False,
                        "duration_ms": int((time.perf_counter() - started) * 1000),
                        "validation": "failed_fallback",
                        "error": str(exc),
                        "fallback_error": str(fallback_exc),
                        "generation_mode": "fallback",
                        "openai_error_code": openai_error_code,
                        "openai_status_code": openai_status_code,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
            return MarketDiagnosticRunResult(ok=False, slug=slug, action="skipped", id=None, error=str(exc))

    if dry_run:
        logger.info(
            "market_diagnostic_run %s",
            json.dumps(
                {
                    "timestamp_utc": _now_utc_iso(),
                    "request_id": request_id,
                    "run_date_utc": run_date_utc,
                    "slug": slug,
                    "status": str(payload.status),
                    "action": "skipped",
                    "id": None,
                    "mode": mode,
                    "dry_run": True,
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                    "validation": "passed_dry_run",
                    "generation_mode": generation_mode,
                    "openai_error_code": None,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
        return MarketDiagnosticRunResult(ok=True, slug=slug, action="skipped", id=None)

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
        "market_diagnostic_run %s",
        json.dumps(
            {
                "timestamp_utc": _now_utc_iso(),
                "request_id": request_id,
                "run_date_utc": run_date_utc,
                "slug": slug,
                "status": str(payload.status),
                "action": action,
                "id": post.id,
                "mode": mode,
                "dry_run": False,
                "duration_ms": int((time.perf_counter() - started) * 1000),
                "validation": "passed_fallback" if used_fallback else "passed",
                "generation_mode": generation_mode,
                "openai_error_code": openai_error_code,
                "openai_status_code": openai_status_code,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    )
    return MarketDiagnosticRunResult(ok=True, slug=slug, action=action, id=post.id)
