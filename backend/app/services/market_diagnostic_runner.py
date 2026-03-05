from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Literal, Sequence

import httpx

from app.core.config import settings
from app.models.update_post import UpdatePost
from app.schemas.market_diagnostic_payload import (
    MarketDiagnosticPublishPayload,
    MarketDiagnosticRunResult,
)
from app.services.market_diagnostic_publisher import publish_market_diagnostic_for_date
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


def _recent_published_titles(*, limit: int = 8) -> list[str]:
    with get_db_session() as db:
        rows = (
            db.query(UpdatePost.title)
            .filter(UpdatePost.published.is_(True))
            .order_by(UpdatePost.created_at.desc())
            .limit(limit)
            .all()
        )
    titles: list[str] = []
    for row in rows:
        value = (row[0] or "").strip()
        if value:
            titles.append(value)
    return titles


def _ensure_non_reused_title(title: str, recent_titles: Sequence[str], run_date_utc: str) -> str:
    candidate = re.sub(r"\s+", " ", "".join(ch for ch in (title or "") if ch.isprintable())).strip()
    lower = candidate.lower()
    generic = (
        not candidate
        or (
            lower.startswith("market diagnostic")
            and (
                "latest" in lower
                or bool(re.search(r"\b\d{4}-\d{2}-\d{2}\b", lower))
                or len(lower.split()) <= 6
            )
        )
    )
    if generic:
        return f"Macro Regime Shift Checkpoint ({run_date_utc})"
    lowered_recent = {item.strip().lower() for item in recent_titles if item}
    if candidate.lower() not in lowered_recent:
        return candidate
    return f"{candidate} ({run_date_utc})"


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
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_prompt}],
            },
        ],
        "tools": [{"type": "web_search"}],
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "market_diagnostic_payload",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "title",
                        "summary",
                        "status",
                        "tags",
                        "slug",
                        "content_markdown",
                        "chart_urls",
                        "published",
                        "pinned",
                    ],
                    "properties": {
                        "title": {"type": "string"},
                        "summary": {"type": "string"},
                        "status": {"type": "string", "enum": ["GREEN", "YELLOW", "RED"]},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "slug": {"type": "string"},
                        "content_markdown": {"type": "string"},
                        "chart_urls": {"type": "array", "items": {"type": "string"}},
                        "published": {"type": "boolean"},
                        "pinned": {"type": "boolean"},
                    },
                },
            }
        },
        # Allow slight variation so headlines/subtitles/tags remain fresh.
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
                    "https://api.openai.com/v1/responses",
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

    def _extract_output_text(response: dict[str, Any]) -> str:
        for item in response.get("output", []):
            if item.get("type") != "message":
                continue
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    return part.get("text", "")
        raise RuntimeError("OpenAI response did not include output text.")

    try:
        content = _extract_output_text(data)
    except Exception as exc:
        raise RuntimeError(f"OpenAI response parse error: {exc}")

    try:
        return json.loads(content)
    except Exception as exc:
        raise RuntimeError(f"OpenAI did not return valid JSON: {exc}; content={content[:400]}")


def _build_prompts(
    *,
    run_date_utc: str,
    day_of_week: str,
    mode: Mode,
    recent_titles: Sequence[str],
) -> tuple[str, str]:
    system_prompt = (
        "You are an expert macro strategist writing a concise weekly market recap for a private dashboard.\n"
        "Use web search to gather sources for every datapoint.\n"
        "You MUST output exactly one JSON object and nothing else.\n"
        "The JSON MUST contain exactly these top-level keys: "
        "title, summary, status, tags, slug, content_markdown, chart_urls, published, pinned.\n"
        "Only use the emojis 🟢🟡🔴 in Signal/Risk Regime lines.\n"
    )

    user_prompt = json.dumps(
        {
            "task": "Generate one Market Diagnostic publish payload JSON that matches the schema exactly.",
            "run_date_utc": run_date_utc,
            "day_of_week": day_of_week,
            "mode": mode,
            "recent_titles_to_avoid_repeating_verbatim": list(recent_titles),
            "schema": {
                "title": "news-driven weekly recap headline",
                "summary": "single-sentence subtitle",
                "status": "GREEN",
                "tags": ["market-diagnostic", "macro", "example-topic"],
                "slug": f"market-diagnostic-{run_date_utc}",
                "content_markdown": (
                    "Must contain these Markdown H2 headings exactly once each and in this exact order: "
                    "## Earnings / EPS Revisions (S&P 500), "
                    "## Credit Stress (HY OAS, IG Spreads, Bank CDS), "
                    "## Growth (Nowcasts/PMIs + Sahm Rule Proximity), "
                    "## Financial Conditions Indexes, "
                    "## Policy / Geopolitical Headlines, "
                    "## Risk Regime Assessment. "
                    "Each of the first 5 sections must include: "
                    "a 'Trend:' line, a 'Signal:' line with 🟢🟡🔴, and either "
                    "(A) 3-6 bullets ending with '(Source: ...)' OR "
                    "(B) a single 'No Change:' line stating no material change since last recap. "
                    "The Risk Regime Assessment must include: "
                    "'Risk Regime:' (with 🟢🟡🔴), "
                    "'Correction risk elevated?: Yes/No', "
                    "'Recession risk elevated?: Yes/No', "
                    "4-6 bullets ending with '(Source: ...)', "
                    "and 'Final Regime:' with 🟢🟡🔴. "
                    "Optional: 'Confidence: Low|Medium|High'."
                ),
                "chart_urls": [],
                "published": True,
                "pinned": False,
            },
            "rules": [
                "Output JSON only (no markdown fences, no commentary).",
                f"slug MUST equal market-diagnostic-{run_date_utc}.",
                "status MUST be exactly one of: GREEN, YELLOW, RED (a single string, not an array).",
                "Generate title + summary + tags; do not use boilerplate strings.",
                "title MUST be specific and must NOT be a generic 'Market Diagnostic' placeholder or a raw date string.",
                "Do not reuse any recent title verbatim. Use a different opening phrase and framing.",
                "summary MUST be 12-28 words and read like a subtitle.",
                "tags MUST include market-diagnostic and macro, plus 1-4 additional lowercase hyphenated topical tags.",
                "chart_urls MUST be an empty array unless you have real http(s) URLs from sources (otherwise keep []).",
                "content_markdown MUST include the required headings in order and exactly once each.",
                "Include a date/time stamp line at the top (e.g., 'Date: YYYY-MM-DD (UTC)').",
                "Every section must include exactly one line starting with 'Trend:' and one line starting with 'Signal:'.",
                "Each bullet must end with a citation in the format '(Source: https://...)' using a real http(s) URL.",
                "Do not put citations on separate lines; the citation must be at the end of the bullet line.",
                "If you cannot find a source URL for a bullet, do not include that bullet.",
                "Do not invent citations; only cite URLs you actually found via web search.",
                "Prioritize sources published within the last 7 days relative to run_date_utc; avoid stale sources whenever fresher sources exist.",
                "If a section has no material change versus last recap, do not add fresh bullets there; use 'No Change: No material change since the prior weekly recap.' instead.",
                "Use only 🟢🟡🔴 for Signal/Risk Regime lines. No other emojis.",
            ],
            "format_template": (
                "Date: YYYY-MM-DD (UTC)\n\n"
                "## Earnings / EPS Revisions (S&P 500)\n"
                "Trend: ...\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "Signal: 🟢 ...\n\n"
                "## Credit Stress (HY OAS, IG Spreads, Bank CDS)\n"
                "Trend: ...\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "Signal: 🟡 ...\n\n"
                "## Growth (Nowcasts/PMIs + Sahm Rule Proximity)\n"
                "Trend: ...\n"
                "No Change: No material change since the prior weekly recap.\n"
                "Signal: 🟡 ...\n\n"
                "## Financial Conditions Indexes\n"
                "Trend: ...\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "Signal: 🟡 ...\n\n"
                "## Policy / Geopolitical Headlines\n"
                "Trend: ...\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "Signal: 🟡 ...\n\n"
                "## Risk Regime Assessment\n"
                "Risk Regime: 🟡 ...\n"
                "Correction risk elevated?: Yes/No\n"
                "Recession risk elevated?: Yes/No\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "- ... (Source: https://...)\n"
                "Final Regime: 🟡 ...\n"
                "Confidence: Medium"
            ),
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return system_prompt, user_prompt


def _build_repair_prompts(
    *,
    run_date_utc: str,
    day_of_week: str,
    mode: Mode,
    validation_error: str,
    previous_output: dict[str, Any] | None,
    recent_titles: Sequence[str],
) -> tuple[str, str]:
    system_prompt = (
        "You are an expert macro strategist. You are repairing a previously-generated Market Diagnostic payload.\n"
        "Use web search to gather sources for every datapoint.\n"
        "You MUST output exactly one JSON object and nothing else.\n"
        "The JSON MUST contain exactly these top-level keys: "
        "title, summary, status, tags, slug, content_markdown, chart_urls, published, pinned.\n"
        "Only use the emojis 🟢🟡🔴 in Signal/Risk Regime lines.\n"
        "Fix validation issues by adjusting content_markdown (and other fields if necessary) so it passes strict validation.\n"
    )

    # Keep context small: include only the prior JSON and a truncated error message.
    error_snippet = (validation_error or "")[:1200]

    user_prompt = json.dumps(
        {
            "task": "Repair the Market Diagnostic JSON to satisfy all schema + validation constraints exactly.",
            "run_date_utc": run_date_utc,
            "day_of_week": day_of_week,
            "mode": mode,
            "recent_titles_to_avoid_repeating_verbatim": list(recent_titles),
            "validation_error": error_snippet,
            "previous_output": previous_output,
            "rules": [
                "Output JSON only (no markdown fences, no commentary).",
                f"slug MUST equal market-diagnostic-{run_date_utc}.",
                "title and summary must be specific and non-boilerplate.",
                "Do not reuse any recent title verbatim; pick a new headline framing.",
                "tags MUST include market-diagnostic and macro, plus additional topical tags.",
                "content_markdown MUST include required headings in order and exactly once each.",
                "Each of the first 5 sections must include a Trend line and a Signal line.",
                "For each of the first 5 sections, use either 3-6 sourced bullets OR a single 'No Change:' line.",
                "Each bullet must end with '(Source: https://...)' using a real http(s) URL. No citations on separate lines.",
                "Do not invent citations; only cite URLs you actually found via web search.",
                "Prefer citations from the last 7 days whenever possible.",
                "If there is no material update in a section, use: 'No Change: No material change since the prior weekly recap.'",
            ],
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return system_prompt, user_prompt


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
    generation_mode: Literal["model"] | None = None
    openai_error_code: str | None = None
    openai_status_code: int | None = None
    validation_attempts = 0

    # Reject future dates before any DB or OpenAI work.
    try:
        run_date = datetime.strptime(run_date_utc, "%Y-%m-%d").date()
    except ValueError:
        return MarketDiagnosticRunResult(
            ok=False,
            slug=slug,
            action="skipped",
            id=None,
            error="run_date_utc must be YYYY-MM-DD",
        )
    today_utc = datetime.now(timezone.utc).date()
    if run_date > today_utc:
        logger.info(
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
                    "dry_run": dry_run,
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                    "validation": "rejected_future_date",
                    "generation_mode": None,
                    "openai_error_code": None,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
        return MarketDiagnosticRunResult(
            ok=False,
            slug=slug,
            action="skipped",
            id=None,
            error="run_date_utc cannot be in the future",
        )

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

    recent_titles = _recent_published_titles(limit=8)

    system_prompt, user_prompt = _build_prompts(
        run_date_utc=run_date_utc,
        day_of_week=day_of_week,
        mode=mode,
        recent_titles=recent_titles,
    )

    try:
        # Bounded retry: if the model returns JSON that fails strict validation, ask it to repair once.
        previous_output: dict[str, Any] | None = None
        last_validation_error: str | None = None

        for attempt in range(2):
            validation_attempts = attempt + 1
            if attempt == 0:
                model_json = _openai_chat_completion_json(system_prompt=system_prompt, user_prompt=user_prompt)
            else:
                repair_system, repair_user = _build_repair_prompts(
                    run_date_utc=run_date_utc,
                    day_of_week=day_of_week,
                    mode=mode,
                    validation_error=last_validation_error or "unknown validation error",
                    previous_output=previous_output,
                    recent_titles=recent_titles,
                )
                model_json = _openai_chat_completion_json(system_prompt=repair_system, user_prompt=repair_user)

            previous_output = model_json

            try:
                payload = MarketDiagnosticPublishPayload.model_validate(model_json)
                validate_slug(payload.slug, run_date_utc=run_date_utc)
                if payload.slug != slug:
                    raise ValueError(f"slug mismatch: expected={slug} got={payload.slug}")
                if payload.published is not True:
                    raise ValueError("published must be true")
                if payload.pinned is not False:
                    raise ValueError("pinned must be false")
                payload.title = _ensure_non_reused_title(payload.title, recent_titles, run_date_utc)
                generation_mode = "model"
                last_validation_error = None
                break
            except Exception as ve:
                last_validation_error = str(ve)
                if attempt == 0:
                    # Attempt repair once.
                    continue
                raise
    except Exception as exc:
        if isinstance(exc, OpenAIRequestError):
            openai_error_code = exc.error_code
            openai_status_code = exc.status_code
        else:
            openai_error_code = None
            openai_status_code = None

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
                    "dry_run": dry_run,
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                    "validation": "failed",
                    "error": str(exc),
                    "generation_mode": "model",
                    "validation_attempts": validation_attempts,
                    "openai_error_code": openai_error_code,
                    "openai_status_code": openai_status_code,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
        if not dry_run:
            try:
                fallback_dt = datetime.combine(run_date, datetime.min.time(), tzinfo=timezone.utc)
                fallback = publish_market_diagnostic_for_date(run_dt=fallback_dt)
                fallback_action: Literal["posted", "skipped"] = (
                    "posted" if fallback.source == "post" else "skipped"
                )
                logger.warning(
                    "market_diagnostic_run %s",
                    json.dumps(
                        {
                            "timestamp_utc": _now_utc_iso(),
                            "request_id": request_id,
                            "run_date_utc": run_date_utc,
                            "slug": fallback.slug,
                            "status": fallback.status,
                            "action": fallback_action,
                            "id": fallback.response_id,
                            "mode": mode,
                            "dry_run": dry_run,
                            "duration_ms": int((time.perf_counter() - started) * 1000),
                            "validation": "fallback_posted",
                            "generation_mode": "fallback_template",
                            "primary_error": str(exc)[:500],
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                )
                return MarketDiagnosticRunResult(
                    ok=True,
                    slug=fallback.slug,
                    action=fallback_action,
                    id=fallback.response_id,
                    error=f"Primary generation failed; used fallback template. {str(exc)[:220]}",
                )
            except Exception as fallback_exc:
                logger.error(
                    "market_diagnostic_run_fallback_failed %s",
                    json.dumps(
                        {
                            "timestamp_utc": _now_utc_iso(),
                            "request_id": request_id,
                            "run_date_utc": run_date_utc,
                            "slug": slug,
                            "mode": mode,
                            "duration_ms": int((time.perf_counter() - started) * 1000),
                            "primary_error": str(exc)[:500],
                            "fallback_error": str(fallback_exc)[:500],
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                )
                return MarketDiagnosticRunResult(
                    ok=False,
                    slug=slug,
                    action="skipped",
                    id=None,
                    error=f"Primary + fallback publish failed. primary={str(exc)[:220]} fallback={str(fallback_exc)[:220]}",
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
                "validation_attempts": validation_attempts,
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
                "validation": "passed",
                "generation_mode": generation_mode,
                "validation_attempts": validation_attempts,
                "openai_error_code": openai_error_code,
                "openai_status_code": openai_status_code,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    )
    return MarketDiagnosticRunResult(ok=True, slug=slug, action=action, id=post.id)
