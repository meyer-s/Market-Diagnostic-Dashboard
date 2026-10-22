"""The DOL weekly release, kept independent of monthly BLS evidence."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
import re

import httpx
from pypdf import PdfReader

from app.services.endpoint_response_cache import (
    async_response_refresh_lock, load_response_snapshot, store_response_snapshot,
)

SOURCE_URL = "https://www.dol.gov/ui/data.pdf"
CACHE_KEY = "labor-claims:v1"
TTL_SECONDS = 5 * 60
MAX_STALE_SECONDS = 8 * 24 * 60 * 60


def parse_claims_release(text: str, *, now: datetime | None = None) -> dict:
    text = re.sub(r"\s+", " ", text)
    date_match = re.search(
        r"(?:Monday|Tuesday|Wednesday|Thursday|Friday),\s+([A-Za-z]+ \d{1,2}, \d{4})",
        text,
    )
    if not date_match:
        raise ValueError("DOL publication date unavailable")
    released = datetime.strptime(date_match[1], "%B %d, %Y").date()
    today = (now or datetime.now(timezone.utc)).date()
    if released > today or (today - released).days > 8:
        raise ValueError("DOL publication date outside current release window")

    initial = re.search(
        r"week ending ([A-Za-z]+ \d{1,2}), the advance figure for seasonally adjusted initial claims was ([\d,]+), (?:an? (decrease|increase) of ([\d,]+)|unchanged)",
        text, re.I,
    )
    continued = re.search(
        r"advance number for seasonally adjusted insured unemployment during the week ending ([A-Za-z]+ \d{1,2}) was ([\d,]+), (?:an? (decrease|increase) of ([\d,]+)|unchanged)",
        text, re.I,
    )
    if not initial or not continued:
        raise ValueError("DOL seasonally adjusted claims figures unavailable")

    def reading(match: re.Match) -> dict:
        period = datetime.strptime(f"{match[1]} {released.year}", "%B %d %Y").date()
        if period > released:
            period = period.replace(year=period.year - 1)
        if not 0 <= (released - period).days <= 21:
            raise ValueError("DOL reference week inconsistent with publication date")
        value = int(match[2].replace(",", ""))
        change = int((match[4] or "0").replace(",", "")) * (-1 if (match[3] or "").lower() == "decrease" else 1)
        if value <= 0 or value - change <= 0:
            raise ValueError("DOL claims values outside valid range")
        return {"week_ending": period.isoformat(), "value": value, "change": change,
                "prior_revised": value - change}

    return {"released_on": released.isoformat(), "source_url": SOURCE_URL,
            "publisher": "U.S. Department of Labor", "seasonal_adjustment": "Seasonally adjusted",
            "estimate": "Advance", "initial_claims": reading(initial),
            "continuing_claims": reading(continued)}


async def _fetch_claims() -> dict:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        response = await client.get(SOURCE_URL, headers={"Accept": "application/pdf"})
        response.raise_for_status()
    def parse_pdf() -> dict:
        reader = PdfReader(BytesIO(response.content))
        text = " ".join(page.extract_text() or "" for page in reader.pages[:2])
        return parse_claims_release(text)
    return await asyncio.to_thread(parse_pdf)


async def get_labor_claims() -> dict:
    async with async_response_refresh_lock(CACHE_KEY):
        snapshot = load_response_snapshot(CACHE_KEY)
        if snapshot and snapshot.is_fresh(TTL_SECONDS):
            return snapshot.payload
        try:
            payload = await _fetch_claims()
            if snapshot and payload["released_on"] < snapshot.payload["released_on"]:
                raise ValueError("DOL release regressed")
            now = datetime.now(timezone.utc)
            payload["checked_at"] = now.isoformat()
            # A date older than a full weekly cycle is visibly stale even if
            # the source successfully served that same PDF again today.
            old_release = (now.date() - datetime.fromisoformat(payload["released_on"]).date()) >= timedelta(days=8)
            payload["status"] = "stale" if old_release else "current"
            store_response_snapshot(CACHE_KEY, payload)
            return payload
        except Exception:
            if snapshot and snapshot.is_within_stale_limit(MAX_STALE_SECONDS):
                return {**snapshot.payload, "status": "stale",
                        "message": "The latest DOL check failed; showing the last verified release."}
            return {"status": "unavailable", "source_url": SOURCE_URL,
                    "message": "Weekly claims are temporarily unavailable from DOL."}
