"""
Market Diagnostic publisher service.

Builds and publishes internal Market Diagnostic updates to /api/updates.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import logging
from typing import Any, Optional
from urllib.parse import quote_plus

import requests

from ..core.config import settings
from ..models.system_status import SystemStatus
from ..utils.db_helpers import get_db_session

logger = logging.getLogger(__name__)


@dataclass
class PublishResult:
    title: str
    status: str
    slug: str
    response_id: Optional[str]
    published_timestamp_utc: str
    source: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _coerce_utc(run_dt: Optional[datetime]) -> datetime:
    if run_dt is None:
        return datetime.now(timezone.utc)
    if run_dt.tzinfo is None:
        return run_dt.replace(tzinfo=timezone.utc)
    return run_dt.astimezone(timezone.utc)


def _title_for_date(run_dt: datetime) -> str:
    return f"Market Diagnostic — {run_dt.strftime('%b')} {run_dt.day}"


def _slug_for_date(run_dt: datetime) -> str:
    return f"market-diagnostic-{run_dt.strftime('%Y-%m-%d')}"


def _normalize_status(value: Optional[str]) -> str:
    normalized = (value or "YELLOW").strip().upper()
    if normalized in {"GREEN", "YELLOW", "RED"}:
        return normalized
    return "YELLOW"


def _publish_config() -> tuple[str, str]:
    base_url = (settings.UPDATES_BASE_URL or "").strip()
    publish_key = (settings.UPDATES_PUBLISH_KEY or "").strip()

    if not base_url:
        raise RuntimeError("UPDATES_BASE_URL is required for Market Diagnostic publishing.")
    if base_url.endswith("/"):
        raise RuntimeError("UPDATES_BASE_URL must not have a trailing slash.")
    if not publish_key:
        raise RuntimeError("UPDATES_PUBLISH_KEY is required for Market Diagnostic publishing.")

    return base_url, publish_key


def _latest_system_snapshot() -> dict[str, Any]:
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()

    if not status:
        return {
            "status": "YELLOW",
            "score": None,
            "red_count": None,
            "yellow_count": None,
            "timestamp": None,
        }

    return {
        "status": _normalize_status(status.state),
        "score": status.composite_score,
        "red_count": status.red_count,
        "yellow_count": status.yellow_count,
        "timestamp": status.timestamp,
    }


def _summary_for_snapshot(snapshot: dict[str, Any]) -> str:
    status = snapshot["status"]
    score = snapshot["score"]
    red_count = snapshot["red_count"]
    yellow_count = snapshot["yellow_count"]

    if score is None:
        return "Cross-asset conditions are mixed and the current regime remains in a caution posture."

    if status == "GREEN":
        return (
            f"System conditions remain broadly stable with a composite score near {score:.1f} "
            f"and limited stress breadth ({red_count or 0} red, {yellow_count or 0} yellow)."
        )
    if status == "RED":
        return (
            f"System conditions remain stressed with a composite score near {score:.1f} "
            f"and broad risk participation ({red_count or 0} red, {yellow_count or 0} yellow)."
        )
    return (
        f"System conditions remain mixed with a composite score near {score:.1f} "
        f"and moderate caution breadth ({red_count or 0} red, {yellow_count or 0} yellow)."
    )


def _tags_for_status(status: str) -> list[str]:
    tags = ["market-diagnostic", "macro"]
    if status == "GREEN":
        tags.extend(["risk-on", "stability"])
    elif status == "RED":
        tags.extend(["risk-off", "stress"])
    else:
        tags.extend(["caution", "transitional"])
    return tags


def _markdown_for_snapshot(run_dt: datetime, snapshot: dict[str, Any], summary: str) -> str:
    as_of = run_dt.strftime("%Y-%m-%d")
    score = snapshot["score"]
    red_count = snapshot["red_count"]
    yellow_count = snapshot["yellow_count"]
    status = snapshot["status"]

    score_line = "Composite score not available in the latest snapshot."
    breadth_line = "Breadth counts not available in the latest snapshot."

    if score is not None:
        score_line = f"Latest system composite score: **{score:.1f}** ({status})."
    if red_count is not None and yellow_count is not None:
        breadth_line = f"Breadth: **{red_count} red** and **{yellow_count} yellow** indicators."

    return f"""_As of UTC {as_of}_

{summary}

## Earnings
- Earnings tone remains aligned with the current macro regime and leadership breadth.
- Forward guidance dispersion remains the key determinant for near-term conviction.

## Credit
- Credit spreads and funding tone remain central to the risk read for this cycle phase.
- {breadth_line}

## Growth
- Growth momentum remains tied to labor and demand resilience in incoming data.
- Hard and soft data alignment continues to guide conviction around trend durability.

## Financial Conditions
- {score_line}
- Liquidity and volatility conditions remain a primary transmission channel for regime shifts.

## Policy/Geo
- Policy communication remains a key driver of rates and risk-asset sensitivity.
- Geopolitical developments are monitored for spillover into cross-asset pricing.
"""


def _lookup_existing_post(base_url: str, slug: str, timeout_seconds: int = 30) -> dict[str, Any]:
    lookup_url = f"{base_url}/api/updates?limit=50&offset=0&q={quote_plus(slug)}"
    response = requests.get(lookup_url, timeout=timeout_seconds)

    if not response.ok:
        raise RuntimeError(
            f"Update lookup failed: status={response.status_code} body={response.text[:400]}"
        )

    payload = response.json()
    if isinstance(payload, list):
        for item in payload:
            if item.get("slug") == slug:
                return item
    raise RuntimeError(f"Slug lookup returned no match for slug={slug}.")


def _is_duplicate_signal(status_code: int, response_text: str) -> bool:
    lowered = response_text.lower()
    if status_code == 409:
        return True
    return "slug" in lowered and (
        "exist" in lowered or "duplicate" in lowered or "conflict" in lowered
    )


def publish_market_diagnostic_for_date(
    run_dt: Optional[datetime] = None,
    timeout_seconds: int = 30,
) -> PublishResult:
    """
    Build and publish one Market Diagnostic post for a UTC date.
    Slug is deterministic per date to guarantee idempotency.
    """
    publish_dt = _coerce_utc(run_dt)
    title = _title_for_date(publish_dt)
    slug = _slug_for_date(publish_dt)
    base_url, publish_key = _publish_config()

    snapshot = _latest_system_snapshot()
    summary = _summary_for_snapshot(snapshot)
    status = snapshot["status"]
    tags = _tags_for_status(status)
    markdown = _markdown_for_snapshot(publish_dt, snapshot, summary)
    chart_urls: list[str] = []

    payload = {
        "title": title,
        "summary": summary,
        "status": status,
        "tags": tags,
        "slug": slug,
        "content_markdown": markdown,
        "chart_urls": chart_urls,
        "published": True,
        "pinned": False,
    }

    response = requests.post(
        f"{base_url}/api/updates",
        json=payload,
        headers={"X-Updates-Key": publish_key},
        timeout=timeout_seconds,
    )

    if response.ok:
        body = response.json() if response.content else {}
        result = PublishResult(
            title=title,
            status=status,
            slug=slug,
            response_id=body.get("id"),
            published_timestamp_utc=datetime.now(timezone.utc).isoformat(),
            source="post",
        )
        logger.info(
            "Market Diagnostic publish confirmation: title=%s status=%s slug=%s id=%s published_timestamp_utc=%s",
            result.title,
            result.status,
            result.slug,
            result.response_id,
            result.published_timestamp_utc,
        )
        return result

    if _is_duplicate_signal(response.status_code, response.text):
        existing = _lookup_existing_post(base_url=base_url, slug=slug, timeout_seconds=timeout_seconds)
        result = PublishResult(
            title=title,
            status=status,
            slug=slug,
            response_id=existing.get("id"),
            published_timestamp_utc=datetime.now(timezone.utc).isoformat(),
            source="existing",
        )
        logger.info(
            "Market Diagnostic existing confirmation: title=%s status=%s slug=%s id=%s published_timestamp_utc=%s",
            result.title,
            result.status,
            result.slug,
            result.response_id,
            result.published_timestamp_utc,
        )
        return result

    logger.error(
        "Market Diagnostic publish failed: status=%s body=%s",
        response.status_code,
        response.text[:400],
    )
    raise RuntimeError(
        f"Market Diagnostic publish failed: status={response.status_code} body={response.text[:400]}"
    )


def publish_market_diagnostic_for_today() -> PublishResult:
    """Convenience wrapper for publishing with the current UTC date."""
    return publish_market_diagnostic_for_date(run_dt=datetime.now(timezone.utc))
