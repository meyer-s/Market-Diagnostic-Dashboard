from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timezone
from typing import Any, Iterable, Mapping, Sequence
from zoneinfo import ZoneInfo

import httpx
from lxml import html

try:
    from curl_cffi import requests as curl_requests
except ImportError:  # pragma: no cover - the production image installs curl-cffi
    curl_requests = None

from app.core.config import settings
from app.models.bls_observation_vintage import BlsObservationVintage
from app.services.endpoint_response_cache import (
    async_response_refresh_lock,
    load_response_snapshot,
    mark_stale_snapshot,
    store_response_snapshot,
)
from app.utils.db_helpers import get_db_session


logger = logging.getLogger(__name__)

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
BLS_PAYROLL_REVISIONS_URL = "https://www.bls.gov/web/empsit/cesnaicsrev.htm"
BLS_RELEASE_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics"
BLS_LENS_CACHE_KEY = "bls-lens:v2-unadjusted-canonical-10"
BLS_LENS_CACHE_TTL_SECONDS = 6 * 60 * 60
BLS_LENS_MAX_STALE_AGE_SECONDS = 7 * 24 * 60 * 60
CANONICAL_YEARS = 10
HISTORY_START_YEAR = 2010
PERCENTILE_WINDOW_MONTHS = 60
PERCENTILE_MINIMUM_POINTS = 24

# BLS applies automated-retrieval controls to its public web pages. A normal,
# explicit browser user agent and content negotiation are required for the HTML
# and iCalendar sources (the API endpoint itself accepts the same headers).
BLS_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0.0.0 Safari/537.36 "
        "Market-Diagnostic-Dashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.bls.gov/",
}


REPORTS: tuple[dict[str, Any], ...] = (
    {
        "report_id": "cpi",
        "key": "cpi",
        "label": "Consumer Price Index",
        "report": "Consumer Price Index",
        "description": "Consumer prices paid by urban consumers, including headline and core measures.",
        "series_ids": ["CUUR0000SA0", "CUUR0000SA0L1E"],
        "source_url": "https://www.bls.gov/news.release/cpi.htm",
    },
    {
        "report_id": "ppi",
        "key": "ppi",
        "label": "Producer Price Index",
        "report": "Producer Price Index",
        "description": "Selling prices received by domestic producers for final demand.",
        "series_ids": ["WPUFD4"],
        "source_url": "https://www.bls.gov/news.release/ppi.htm",
    },
    {
        "report_id": "employment_situation",
        "key": "employment_situation",
        "label": "Employment Situation",
        "report": "Employment Situation",
        "description": "Payroll employment, average hourly earnings, and household unemployment.",
        "series_ids": ["CES0000000001", "CES0500000003", "LNS14000000"],
        "source_url": "https://www.bls.gov/news.release/empsit.htm",
    },
    {
        "report_id": "jolts",
        "key": "jolts",
        "label": "Job Openings and Labor Turnover Survey",
        "report": "Job Openings and Labor Turnover Survey",
        "description": "Employer demand and worker turnover through openings and quits.",
        "series_ids": [
            "JTS000000000000000JOR",
            "JTS000000000000000JOL",
            "JTS000000000000000QUR",
        ],
        "source_url": "https://www.bls.gov/news.release/jolts.htm",
    },
)


SERIES_CONFIGS: tuple[dict[str, Any], ...] = (
    {
        "series_id": "CUUR0000SA0",
        "key": "headline_cpi",
        "report_id": "cpi",
        "family": "inflation",
        "label": "Headline CPI",
        "short_label": "Headline CPI",
        "description": "All-items Consumer Price Index for all urban consumers.",
        "raw_unit": "index (1982-84=100)",
        "change_1m_unit": "index points",
        "seasonal_adjustment": "not seasonally adjusted",
        "unit": "% year over year",
        "primary_unit": "% year over year",
        "primary_measure": "12-month percent change",
        "transformation": "year_over_year_percent_change",
        "higher_means": "More headline consumer-price inflation relative to the comparison window.",
    },
    {
        "series_id": "CUUR0000SA0L1E",
        "key": "core_cpi",
        "report_id": "cpi",
        "family": "inflation",
        "label": "Core CPI",
        "short_label": "Core CPI",
        "description": "Consumer prices excluding food and energy.",
        "raw_unit": "index (1982-84=100)",
        "change_1m_unit": "index points",
        "seasonal_adjustment": "not seasonally adjusted",
        "unit": "% year over year",
        "primary_unit": "% year over year",
        "primary_measure": "12-month percent change",
        "transformation": "year_over_year_percent_change",
        "higher_means": "More core consumer-price inflation relative to the comparison window.",
    },
    {
        "series_id": "WPUFD4",
        "key": "final_demand_ppi",
        "report_id": "ppi",
        "family": "inflation",
        "label": "Final-demand PPI",
        "short_label": "Final-demand PPI",
        "description": "Producer Price Index for final demand.",
        "raw_unit": "index (November 2009=100)",
        "change_1m_unit": "index points",
        "seasonal_adjustment": "not seasonally adjusted",
        "unit": "% year over year",
        "primary_unit": "% year over year",
        "primary_measure": "12-month percent change",
        "transformation": "year_over_year_percent_change",
        "higher_means": "More final-demand producer-price inflation relative to the comparison window.",
    },
    {
        "series_id": "CES0000000001",
        "key": "payroll_change",
        "report_id": "employment_situation",
        "family": "labor_growth",
        "label": "Total nonfarm payroll change",
        "short_label": "Payroll change",
        "description": "Monthly change in total nonfarm payroll employment.",
        "raw_unit": "thousands of jobs",
        "change_1m_unit": "thousands of jobs",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "thousands of jobs per month",
        "primary_unit": "thousands of jobs per month",
        "primary_measure": "1-month level change",
        "transformation": "monthly_change",
        "higher_means": "More net payroll jobs added in the month relative to the comparison window.",
    },
    {
        "series_id": "CES0500000003",
        "key": "hourly_earnings_yoy",
        "report_id": "employment_situation",
        "family": "wages",
        "label": "Average hourly earnings growth",
        "short_label": "Hourly earnings",
        "description": "Year-over-year growth in average hourly earnings of all private employees.",
        "raw_unit": "U.S. dollars per hour",
        "change_1m_unit": "U.S. dollars per hour",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "% year over year",
        "primary_unit": "% year over year",
        "primary_measure": "12-month percent change",
        "transformation": "year_over_year_percent_change",
        "higher_means": "Faster average-hourly-earnings growth relative to the comparison window.",
    },
    {
        "series_id": "LNS14000000",
        "key": "unemployment_rate",
        "report_id": "employment_situation",
        "family": "labor_slack",
        "label": "Unemployment rate",
        "short_label": "Unemployment",
        "description": "Civilian unemployment rate for people age 16 and older.",
        "raw_unit": "% of labor force",
        "change_1m_unit": "percentage points",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "% of labor force",
        "primary_unit": "% of labor force",
        "primary_measure": "published rate",
        "transformation": "identity",
        "higher_means": "More unemployment relative to the comparison window.",
    },
    {
        "series_id": "JTS000000000000000JOR",
        "key": "job_openings_rate",
        "report_id": "jolts",
        "family": "labor_demand",
        "label": "Job openings rate",
        "short_label": "Openings rate",
        "description": "Job openings as a share of employment plus openings.",
        "raw_unit": "%",
        "change_1m_unit": "percentage points",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "%",
        "primary_unit": "%",
        "primary_measure": "published rate",
        "transformation": "identity",
        "higher_means": "More job openings relative to employment and openings in the comparison window.",
    },
    {
        "series_id": "JTS000000000000000JOL",
        "key": "job_openings_level",
        "report_id": "jolts",
        "family": "labor_demand",
        "label": "Job openings level",
        "short_label": "Openings level",
        "description": "Number of job openings, expressed in millions.",
        "raw_unit": "thousands of openings",
        "change_1m_unit": "thousands of openings",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "millions of openings",
        "primary_unit": "millions of openings",
        "primary_measure": "published level scaled to millions",
        "transformation": "thousands_to_millions",
        "higher_means": "More job openings relative to the comparison window.",
    },
    {
        "series_id": "JTS000000000000000QUR",
        "key": "quits_rate",
        "report_id": "jolts",
        "family": "labor_turnover",
        "label": "Quits rate",
        "short_label": "Quits rate",
        "description": "Voluntary quits as a share of employment.",
        "raw_unit": "% of employment",
        "change_1m_unit": "percentage points",
        "seasonal_adjustment": "seasonally adjusted",
        "unit": "% of employment",
        "primary_unit": "% of employment",
        "primary_measure": "published rate",
        "transformation": "identity",
        "higher_means": "More voluntary quits relative to employment in the comparison window.",
    },
)

SERIES_IDS = tuple(config["series_id"] for config in SERIES_CONFIGS)
SERIES_SOURCE_URLS = {
    series_id: f"https://data.bls.gov/timeseries/{series_id}"
    for series_id in SERIES_IDS
}


class BlsUpstreamError(RuntimeError):
    pass


class BlsLensUnavailable(RuntimeError):
    pass


def _as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _month_shift(value: date, months: int) -> date:
    zero_based = value.year * 12 + value.month - 1 + months
    year, month_zero = divmod(zero_based, 12)
    return date(year, month_zero + 1, 1)


def _round_optional(value: float | None, digits: int = 3) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    rounded = round(float(value), digits)
    return 0.0 if rounded == -0.0 else rounded


def _compact_number(value: float | None) -> int | float | None:
    if value is None:
        return None
    if float(value).is_integer():
        return int(value)
    return _round_optional(value, 3)


def _clean_footnotes(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    cleaned: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, Mapping):
            continue
        code = str(item.get("code") or "").strip()
        text = str(item.get("text") or "").strip()
        if code or text:
            cleaned.append({"code": code, "text": text})
    return cleaned


def _is_preliminary(footnotes: Sequence[Mapping[str, str]]) -> bool:
    return any(
        str(note.get("code", "")).upper() == "P"
        or "preliminar" in str(note.get("text", "")).lower()
        for note in footnotes
    )


def normalize_bls_series_data(
    rows: Iterable[Mapping[str, object]],
) -> list[dict[str, Any]]:
    """Normalize BLS monthly rows while retaining explicitly unavailable periods."""

    normalized: dict[date, dict[str, Any]] = {}
    for row in rows:
        period_code = str(row.get("period") or "")
        if not re.fullmatch(r"M(?:0[1-9]|1[0-2])", period_code):
            continue
        try:
            observation_date = date(
                int(str(row.get("year"))),
                int(period_code[1:]),
                1,
            )
        except (TypeError, ValueError):
            continue
        raw_text = str(row.get("value") or "").strip().replace(",", "")
        try:
            raw_value = float(raw_text)
            if not math.isfinite(raw_value):
                raw_value = None
        except ValueError:
            raw_value = None
        footnotes = _clean_footnotes(row.get("footnotes"))
        normalized[observation_date] = {
            "observation_date": observation_date,
            "raw_value": raw_value,
            "available": raw_value is not None,
            "unavailable_reason": (
                None if raw_value is not None else "published_without_numeric_value"
            ),
            "preliminary": _is_preliminary(footnotes),
            "footnotes": footnotes,
            "source_latest": str(row.get("latest") or "").lower() == "true",
        }
    if not normalized:
        return []
    first_period = min(normalized)
    last_period = max(normalized)
    dense: list[dict[str, Any]] = []
    period = first_period
    while period <= last_period:
        row = normalized.get(period)
        if row is None:
            row = {
                "observation_date": period,
                "raw_value": None,
                "available": False,
                "unavailable_reason": "missing_from_bls_api_response",
                "preliminary": False,
                "footnotes": [],
                "source_latest": False,
            }
        dense.append(row)
        period = _month_shift(period, 1)
    return dense


class BlsClient:
    """Small direct client for the official BLS Public Data API v2."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.api_key = (api_key if api_key is not None else settings.BLS_API_KEY) or None
        self.timeout_seconds = timeout_seconds
        self.messages: list[str] = []

    def _year_ranges(self, start_year: int, end_year: int) -> list[tuple[int, int]]:
        if start_year > end_year:
            raise ValueError("start_year must not exceed end_year")
        maximum = 20 if self.api_key else 10
        ranges: list[tuple[int, int]] = []
        cursor = start_year
        while cursor <= end_year:
            chunk_end = min(cursor + maximum - 1, end_year)
            ranges.append((cursor, chunk_end))
            cursor = chunk_end + 1
        return ranges

    async def _fetch_chunk(
        self,
        client: httpx.AsyncClient,
        series_ids: Sequence[str],
        start_year: int,
        end_year: int,
    ) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
        body: dict[str, object] = {
            "seriesid": list(series_ids),
            "startyear": str(start_year),
            "endyear": str(end_year),
        }
        if self.api_key:
            body["registrationkey"] = self.api_key
        response = await client.post(BLS_API_URL, json=body)
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise BlsUpstreamError("BLS API returned invalid JSON") from exc
        if not isinstance(payload, Mapping):
            raise BlsUpstreamError("BLS API returned an unexpected payload")
        messages = [
            str(message).strip()
            for message in payload.get("message", [])
            if str(message).strip()
        ] if isinstance(payload.get("message"), list) else []
        if payload.get("status") != "REQUEST_SUCCEEDED":
            detail = "; ".join(messages) or str(payload.get("status") or "unknown error")
            raise BlsUpstreamError(f"BLS API request failed: {detail}")

        results = payload.get("Results")
        if isinstance(results, list):
            result_mapping = next(
                (item for item in results if isinstance(item, Mapping)),
                {},
            )
        else:
            result_mapping = results if isinstance(results, Mapping) else {}
        series_rows = result_mapping.get("series", [])
        parsed: dict[str, list[dict[str, Any]]] = {}
        if isinstance(series_rows, list):
            for series in series_rows:
                if not isinstance(series, Mapping):
                    continue
                series_id = str(series.get("seriesID") or "")
                data = series.get("data")
                parsed[series_id] = [
                    dict(row) for row in data if isinstance(row, Mapping)
                ] if isinstance(data, list) else []
        return parsed, messages

    async def fetch_series(
        self,
        series_ids: Sequence[str],
        *,
        start_year: int,
        end_year: int,
    ) -> dict[str, list[dict[str, Any]]]:
        requested_ids = tuple(dict.fromkeys(series_ids))
        combined: dict[str, dict[tuple[str, str], dict[str, Any]]] = {
            series_id: {} for series_id in requested_ids
        }
        ranges = self._year_ranges(start_year, end_year)
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            follow_redirects=True,
            headers={**BLS_BROWSER_HEADERS, "Accept": "application/json"},
        ) as client:
            chunks = await asyncio.gather(
                *(
                    self._fetch_chunk(client, requested_ids, chunk_start, chunk_end)
                    for chunk_start, chunk_end in ranges
                )
            )
        messages: list[str] = []
        for parsed, chunk_messages in chunks:
            for message in chunk_messages:
                if message not in messages:
                    messages.append(message)
            for series_id, rows in parsed.items():
                if series_id not in combined:
                    continue
                for row in rows:
                    key = (str(row.get("year") or ""), str(row.get("period") or ""))
                    combined[series_id][key] = row
        self.messages = messages
        return {
            series_id: sorted(
                rows.values(),
                key=lambda row: (str(row.get("year") or ""), str(row.get("period") or "")),
            )
            for series_id, rows in combined.items()
        }


def _revision_key(
    value: float,
    preliminary: bool,
    footnotes: Sequence[Mapping[str, str]],
) -> str:
    state = {
        "value": format(float(value), ".15g"),
        "preliminary": bool(preliminary),
        "footnotes": [
            {
                "code": str(note.get("code", "")),
                "text": str(note.get("text", "")),
            }
            for note in footnotes
        ],
    }
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def persist_bls_observation_vintages(
    series_data: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    observed_at: datetime | None = None,
) -> tuple[dict[tuple[str, date], dict[str, Any]], dict[str, int]]:
    """Insert changed states and touch only the matching current state."""

    seen_at = _as_utc(observed_at).replace(tzinfo=None)
    numeric_rows: list[tuple[str, Mapping[str, Any]]] = []
    for series_id, rows in series_data.items():
        for row in rows:
            if isinstance(row.get("observation_date"), date) and row.get("raw_value") is not None:
                numeric_rows.append((series_id, row))
    if not numeric_rows:
        return {}, {
            "observations_seen": 0,
            "tracked_observations": 0,
            "states_inserted": 0,
            "states_reused": 0,
        }

    series_ids = sorted({series_id for series_id, _ in numeric_rows})
    dates = [row["observation_date"] for _, row in numeric_rows]
    inserted = 0
    reused = 0
    with get_db_session() as db:
        existing = (
            db.query(BlsObservationVintage)
            .filter(
                BlsObservationVintage.series_id.in_(series_ids),
                BlsObservationVintage.observation_date >= min(dates),
                BlsObservationVintage.observation_date <= max(dates),
            )
            .all()
        )
        by_state = {
            (row.series_id, row.observation_date, row.revision_key): row
            for row in existing
        }
        for series_id, row in numeric_rows:
            raw_value = float(row["raw_value"])
            preliminary = bool(row.get("preliminary"))
            footnotes = [dict(note) for note in row.get("footnotes", [])]
            revision_key = _revision_key(raw_value, preliminary, footnotes)
            state_key = (series_id, row["observation_date"], revision_key)
            vintage = by_state.get(state_key)
            if vintage is None:
                vintage = BlsObservationVintage(
                    series_id=series_id,
                    observation_date=row["observation_date"],
                    value=raw_value,
                    revision_key=revision_key,
                    preliminary=preliminary,
                    footnotes=footnotes,
                    source_url=SERIES_SOURCE_URLS.get(series_id, BLS_API_URL),
                    first_seen_at=seen_at,
                    last_seen_at=seen_at,
                )
                db.add(vintage)
                by_state[state_key] = vintage
                inserted += 1
            else:
                vintage.last_seen_at = seen_at
                reused += 1
        db.commit()

        all_rows = (
            db.query(BlsObservationVintage)
            .filter(
                BlsObservationVintage.series_id.in_(series_ids),
                BlsObservationVintage.observation_date >= min(dates),
                BlsObservationVintage.observation_date <= max(dates),
            )
            .order_by(
                BlsObservationVintage.series_id,
                BlsObservationVintage.observation_date,
                BlsObservationVintage.first_seen_at,
                BlsObservationVintage.id,
            )
            .all()
        )
        grouped: dict[tuple[str, date], list[BlsObservationVintage]] = defaultdict(list)
        for vintage in all_rows:
            grouped[(vintage.series_id, vintage.observation_date)].append(vintage)

        metadata: dict[tuple[str, date], dict[str, Any]] = {}
        for key, vintages in grouped.items():
            first = min(vintages, key=lambda row: (row.first_seen_at, row.id))
            current = max(vintages, key=lambda row: (row.last_seen_at, row.id))
            metadata[key] = {
                "first_seen_value": _compact_number(first.value),
                "current_value": _compact_number(current.value),
                "revision_delta": _round_optional(current.value - first.value),
                "revision_count": max(len(vintages) - 1, 0),
                "first_seen_at": first.first_seen_at.isoformat() + "Z",
                "last_seen_at": current.last_seen_at.isoformat() + "Z",
                "revision_tracking_status": "tracked",
            }
    return metadata, {
        "observations_seen": len(numeric_rows),
        "tracked_observations": len(metadata),
        "states_inserted": inserted,
        "states_reused": reused,
    }


def _trailing_percentiles(
    dates: Sequence[date],
    values: Sequence[float | None],
) -> list[float | None]:
    result: list[float | None] = []
    for index, (period, value) in enumerate(zip(dates, values)):
        if value is None:
            result.append(None)
            continue
        window_start = _month_shift(period, -(PERCENTILE_WINDOW_MONTHS - 1))
        window = [
            candidate
            for prior_period, candidate in zip(dates[: index + 1], values[: index + 1])
            if prior_period >= window_start and candidate is not None
        ]
        if len(window) < PERCENTILE_MINIMUM_POINTS:
            result.append(None)
            continue
        less = sum(candidate < value for candidate in window)
        equal = sum(candidate == value for candidate in window)
        result.append(round(100.0 * (less + 0.5 * equal) / len(window), 1))
    return result


def transform_bls_series(
    series_id: str,
    rows: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any],
    revision_metadata: Mapping[tuple[str, date], Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    normalized = normalize_bls_series_data(rows)
    raw_by_date = {
        row["observation_date"]: row["raw_value"]
        for row in normalized
        if row.get("raw_value") is not None
    }
    dates = [row["observation_date"] for row in normalized]
    primary_values: list[float | None] = []
    changes_1m: list[float | None] = []
    changes_12m_pct: list[float | None] = []
    for row in normalized:
        period = row["observation_date"]
        raw_value = row.get("raw_value")
        prior_1m = raw_by_date.get(_month_shift(period, -1))
        prior_12m = raw_by_date.get(_month_shift(period, -12))
        change_1m = (
            float(raw_value) - float(prior_1m)
            if raw_value is not None and prior_1m is not None
            else None
        )
        change_12m_pct = (
            (float(raw_value) / float(prior_12m) - 1.0) * 100.0
            if raw_value is not None and prior_12m not in {None, 0}
            else None
        )
        transformation = config["transformation"]
        if transformation == "monthly_change":
            primary = change_1m
        elif transformation == "year_over_year_percent_change":
            primary = change_12m_pct
        elif transformation == "thousands_to_millions":
            primary = float(raw_value) / 1000.0 if raw_value is not None else None
        else:
            primary = float(raw_value) if raw_value is not None else None
        primary_values.append(primary)
        changes_1m.append(change_1m)
        changes_12m_pct.append(change_12m_pct)

    percentiles = _trailing_percentiles(dates, primary_values)
    revision_metadata = revision_metadata or {}
    observations: list[dict[str, Any]] = []
    for row, primary, percentile, change_1m, change_12m_pct in zip(
        normalized,
        primary_values,
        percentiles,
        changes_1m,
        changes_12m_pct,
    ):
        period = row["observation_date"]
        raw_value = row.get("raw_value")
        tracked = revision_metadata.get((series_id, period))
        if tracked is None:
            tracked = {
                "first_seen_value": _compact_number(raw_value),
                "current_value": _compact_number(raw_value),
                "revision_delta": 0.0 if raw_value is not None else None,
                "revision_count": 0,
                "first_seen_at": None,
                "last_seen_at": None,
                "revision_tracking_status": (
                    "not_applicable" if raw_value is None else "unavailable"
                ),
            }
        observations.append(
            {
                "period": period.isoformat(),
                "raw_value": _compact_number(raw_value),
                "primary_value": _round_optional(primary),
                "relative_percentile": percentile,
                "change_1m": _round_optional(change_1m),
                "change_12m_pct": _round_optional(change_12m_pct),
                "preliminary": bool(row.get("preliminary")),
                "footnotes": deepcopy(row.get("footnotes", [])),
                "available": bool(row.get("available")),
                "unavailable_reason": row.get("unavailable_reason"),
                **tracked,
            }
        )
    return observations


_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _cell_text(cell: Any) -> str:
    return " ".join(" ".join(cell.itertext()).split())


def _parse_table_number(value: str) -> float | None:
    normalized = (
        value.strip()
        .replace(",", "")
        .replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
    )
    if not normalized or normalized in {"-", "NA", "N/A"}:
        return None
    negative_parentheses = normalized.startswith("(") and ")" in normalized
    match = re.search(r"[-+]?\d+(?:\.\d+)?", normalized)
    if match is None:
        return None
    number = float(match.group(0))
    return -abs(number) if negative_parentheses else number


def parse_payroll_revision_history(document: str | bytes) -> list[dict[str, Any]]:
    """Parse the official CES seasonally-adjusted 1st/2nd/3rd estimates."""

    try:
        root = html.fromstring(document)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid BLS payroll revision HTML") from exc
    by_period: dict[date, dict[str, Any]] = {}
    for table in root.xpath("//table"):
        direct_rows = []
        for row in table.xpath(".//tr"):
            nearest_table = row.xpath("ancestor::table[1]")
            if nearest_table and nearest_table[0] is table:
                direct_rows.append(row)
        header_text = " ".join(
            _cell_text(cell)
            for row in direct_rows[:8]
            for cell in row.xpath("./th|./td")
        ).lower()
        if "seasonally adjusted" not in header_text or "over-the-month" not in header_text:
            continue
        for row in direct_rows:
            cells = row.xpath("./th|./td")
            if len(cells) < 8:
                continue
            values = [_cell_text(cell) for cell in cells]
            month_key = re.sub(r"[^a-z]", "", values[0].lower())
            month = _MONTHS.get(month_key)
            if month is None or not re.fullmatch(r"\d{4}", values[1].strip()):
                continue
            year = int(values[1])
            period = date(year, month, 1)
            first = _parse_table_number(values[2])
            second = _parse_table_number(values[3])
            third = _parse_table_number(values[4])
            second_minus_first = _parse_table_number(values[5])
            third_minus_second = _parse_table_number(values[6])
            total_revision = _parse_table_number(values[7])
            if second_minus_first is None and first is not None and second is not None:
                second_minus_first = second - first
            if third_minus_second is None and second is not None and third is not None:
                third_minus_second = third - second
            if total_revision is None and first is not None and third is not None:
                total_revision = third - first
            latest = third if third is not None else second if second is not None else first
            if third is not None:
                revision_stage = "third_estimate"
            elif second is not None:
                revision_stage = "second_estimate"
            elif first is not None:
                revision_stage = "first_estimate"
            else:
                # Year tables include future placeholder months. They are not
                # observed estimates or revisions and should not be charted.
                continue
            by_period[period] = {
                "period": period.isoformat(),
                "first_estimate": _compact_number(first),
                "second_estimate": _compact_number(second),
                "third_estimate": _compact_number(third),
                "revision_2_minus_1": _compact_number(second_minus_first),
                "revision_3_minus_2": _compact_number(third_minus_second),
                "revision_3_minus_1": _compact_number(total_revision),
                "second_minus_first": _compact_number(second_minus_first),
                "third_minus_second": _compact_number(third_minus_second),
                "total_revision": _compact_number(total_revision),
                "latest_estimate": _compact_number(latest),
                "revision_stage": revision_stage,
                "status": revision_stage,
                "unit": "thousands of jobs",
                "seasonal_adjustment": "seasonally adjusted",
                "source_url": BLS_PAYROLL_REVISIONS_URL,
            }
    return [by_period[period] for period in sorted(by_period)]


def _unescape_ics(value: str) -> str:
    return (
        value.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


def _unfold_ics(document: str) -> list[str]:
    unfolded: list[str] = []
    for raw_line in document.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += raw_line[1:]
        else:
            unfolded.append(raw_line)
    return unfolded


def _parse_ics_datetime(value: str, params: Mapping[str, str]) -> datetime | None:
    raw = value.strip()
    if not raw:
        return None
    date_only = params.get("VALUE", "").upper() == "DATE" or "T" not in raw
    formats = ["%Y%m%d"] if date_only else ["%Y%m%dT%H%M%S", "%Y%m%dT%H%M"]
    is_utc = raw.endswith("Z")
    candidate = raw[:-1] if is_utc else raw
    parsed: datetime | None = None
    for pattern in formats:
        try:
            parsed = datetime.strptime(candidate, pattern)
            break
        except ValueError:
            continue
    if parsed is None:
        return None
    if is_utc:
        return parsed.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York"))
    tzid = params.get("TZID", "America/New_York").strip('"')
    try:
        zone = ZoneInfo(tzid)
    except Exception:
        zone = ZoneInfo("America/New_York")
    return parsed.replace(tzinfo=zone).astimezone(ZoneInfo("America/New_York"))


def _calendar_report(summary: str) -> tuple[str, str] | None:
    normalized = " ".join(summary.lower().split())
    if "consumer price index" in normalized:
        return "cpi", "Consumer Price Index"
    if "producer price index" in normalized:
        return "ppi", "Producer Price Index"
    if "employment situation" in normalized:
        return "employment_situation", "Employment Situation"
    if "job openings and labor turnover survey" in normalized:
        return "jolts", "Job Openings and Labor Turnover Survey"
    return None


def parse_bls_release_calendar(
    document: str,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Parse relevant BLS VEVENTs and normalize every timestamp to US Eastern."""

    reference = _as_utc(now).astimezone(ZoneInfo("America/New_York"))
    events: list[dict[str, tuple[str, dict[str, str]]]] = []
    current: dict[str, tuple[str, dict[str, str]]] | None = None
    for line in _unfold_ics(document):
        if line.upper() == "BEGIN:VEVENT":
            current = {}
            continue
        if line.upper() == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
            continue
        if current is None or ":" not in line:
            continue
        key_part, raw_value = line.split(":", 1)
        key_bits = key_part.split(";")
        key = key_bits[0].upper()
        params: dict[str, str] = {}
        for bit in key_bits[1:]:
            if "=" in bit:
                param_key, param_value = bit.split("=", 1)
                params[param_key.upper()] = param_value
        current[key] = (_unescape_ics(raw_value), params)

    parsed: list[dict[str, Any]] = []
    for event in events:
        summary = event.get("SUMMARY", ("", {}))[0]
        report = _calendar_report(summary)
        if report is None:
            continue
        scheduled_raw, scheduled_params = event.get("DTSTART", ("", {}))
        scheduled_at = _parse_ics_datetime(scheduled_raw, scheduled_params)
        if scheduled_at is None:
            continue
        report_id, report_label = report
        raw_status = event.get("STATUS", ("", {}))[0].strip().lower() or None
        source_event_url = event.get("URL", (BLS_RELEASE_CALENDAR_URL, {}))[0]
        parsed.append(
            {
                "report_id": report_id,
                "report": report_label,
                "title": summary or report_label,
                "date": scheduled_at.date().isoformat(),
                "time_label": scheduled_at.strftime("%I:%M %p ET").lstrip("0"),
                "scheduled_at": scheduled_at.isoformat(),
                "status": "past_scheduled" if scheduled_at <= reference else "scheduled",
                "calendar_status": raw_status,
                "source_url": source_event_url or BLS_RELEASE_CALENDAR_URL,
                "time_zone": "America/New_York",
                "provenance": {
                    "publisher": "U.S. Bureau of Labor Statistics",
                    "calendar_url": BLS_RELEASE_CALENDAR_URL,
                    "event_url": source_event_url or None,
                    "uid": event.get("UID", (None, {}))[0],
                    "calendar_status": raw_status,
                },
            }
        )
    return sorted(parsed, key=lambda event: (event["scheduled_at"], event["report_id"]))


async def _fetch_official_text(url: str, *, accept: str) -> str:
    headers = {**BLS_BROWSER_HEADERS, "Accept": accept}
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.text
    except httpx.HTTPError:
        if curl_requests is None:
            raise

        def browser_impersonated_request() -> str:
            response = curl_requests.get(
                url,
                headers=headers,
                timeout=30.0,
                impersonate="chrome",
            )
            if response.status_code >= 400:
                raise BlsUpstreamError(
                    f"Official BLS document returned HTTP {response.status_code}"
                )
            return response.text

        logger.info("Retrying official BLS document with browser transport: %s", url)
        return await asyncio.to_thread(browser_impersonated_request)


async def fetch_payroll_revision_history() -> list[dict[str, Any]]:
    document = await _fetch_official_text(
        BLS_PAYROLL_REVISIONS_URL,
        accept="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    )
    rows = parse_payroll_revision_history(document)
    if not rows:
        raise BlsUpstreamError("BLS payroll revision page contained no monthly rows")
    return rows


async def fetch_release_calendar(now: datetime | None = None) -> list[dict[str, Any]]:
    document = await _fetch_official_text(
        BLS_RELEASE_CALENDAR_URL,
        accept="text/calendar,text/plain;q=0.9,*/*;q=0.8",
    )
    events = parse_bls_release_calendar(document, now=now)
    if not events:
        raise BlsUpstreamError("BLS release calendar contained no relevant events")
    return events


def _build_series_payloads(
    source_rows: Mapping[str, Sequence[Mapping[str, Any]]],
    revision_metadata: Mapping[tuple[str, date], Mapping[str, Any]],
) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for config in SERIES_CONFIGS:
        series_id = config["series_id"]
        observations = transform_bls_series(
            series_id,
            source_rows.get(series_id, []),
            config,
            revision_metadata,
        )
        coverage_start = observations[0]["period"] if observations else None
        coverage_end = observations[-1]["period"] if observations else None
        latest = next(
            (
                deepcopy(observation)
                for observation in reversed(observations)
                if observation.get("primary_value") is not None
            ),
            None,
        )
        payloads.append(
            {
                **dict(config),
                "frequency": "monthly",
                "source_url": SERIES_SOURCE_URLS[series_id],
                "coverage_start": coverage_start,
                "coverage_end": coverage_end,
                "coverage": {
                    "start": coverage_start,
                    "end": coverage_end,
                    "observation_count": len(observations),
                    "valid_primary_count": sum(
                        observation.get("primary_value") is not None
                        for observation in observations
                    ),
                },
                "latest": latest,
                "observations": observations,
            }
        )
    return payloads


def _mapping_rows(payload: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    rows = payload.get(key)
    return [row for row in rows if isinstance(row, Mapping)] if isinstance(rows, list) else []


def _valid_month_period(value: object) -> str | None:
    try:
        parsed = date.fromisoformat(str(value or ""))
    except ValueError:
        return None
    if parsed.day != 1:
        return None
    return parsed.isoformat()


def _valid_calendar_timestamp(value: object) -> str | None:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("America/New_York"))
    return parsed.astimezone(timezone.utc).isoformat()


def _series_quality(payload: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    quality: dict[str, dict[str, Any]] = {}
    for series in _mapping_rows(payload, "series"):
        series_id = str(series.get("series_id") or "")
        if not series_id:
            continue
        observations = []
        periods: list[str] = []
        if isinstance(series.get("observations"), list):
            for row in series["observations"]:
                if not isinstance(row, Mapping):
                    continue
                period = _valid_month_period(row.get("period"))
                if period is None:
                    continue
                observations.append(row)
                periods.append(period)
        valid_primary_count = sum(
            row.get("primary_value") is not None for row in observations
        )
        numeric_observation_count = sum(
            row.get("raw_value") is not None for row in observations
        )
        tracked_numeric_count = sum(
            row.get("raw_value") is not None
            and row.get("revision_tracking_status") == "tracked"
            for row in observations
        )
        latest_period = max(
            (
                period
                for row, period in zip(observations, periods)
                if row.get("primary_value") is not None
            ),
            default=None,
        )
        latest = series.get("latest")
        declared_latest_period = (
            _valid_month_period(latest.get("period"))
            if isinstance(latest, Mapping)
            else None
        )
        coverage = series.get("coverage")
        coverage = coverage if isinstance(coverage, Mapping) else {}

        def declared_count(key: str) -> int | None:
            try:
                value = int(coverage[key])
            except (KeyError, TypeError, ValueError):
                return None
            return value if value >= 0 else None

        declared_coverage_start = _valid_month_period(series.get("coverage_start"))
        declared_coverage_end = _valid_month_period(series.get("coverage_end"))
        declared_observation_count = declared_count("observation_count")
        declared_valid_primary_count = declared_count("valid_primary_count")
        metadata_consistent = (
            declared_coverage_start == (min(periods) if periods else None)
            and declared_coverage_end == (max(periods) if periods else None)
            and declared_observation_count == len(observations)
            and declared_valid_primary_count == valid_primary_count
            and declared_latest_period == latest_period
        )
        quality[series_id] = {
            "coverage_start": min(periods) if periods else None,
            "coverage_end": max(periods) if periods else None,
            "observation_count": len(observations),
            "valid_primary_count": valid_primary_count,
            "numeric_observation_count": numeric_observation_count,
            "tracked_numeric_count": tracked_numeric_count,
            "latest_period": latest_period,
            "declared_latest_period": declared_latest_period,
            "declared_coverage_start": declared_coverage_start,
            "declared_coverage_end": declared_coverage_end,
            "declared_observation_count": declared_observation_count,
            "declared_valid_primary_count": declared_valid_primary_count,
            "metadata_consistent": metadata_consistent,
        }
    return quality


def _report_quality(payload: Mapping[str, Any]) -> dict[str, set[str]]:
    quality: dict[str, set[str]] = {}
    for report in _mapping_rows(payload, "reports"):
        report_id = str(report.get("report_id") or report.get("id") or "")
        if not report_id:
            continue
        values = report.get("series_ids")
        quality[report_id] = {
            str(series_id)
            for series_id in values
            if series_id
        } if isinstance(values, list) else set()
    return quality


_PAYROLL_STAGE_RANK = {
    "first_estimate": 1,
    "second_estimate": 2,
    "third_estimate": 3,
}


def _payroll_quality(payload: Mapping[str, Any]) -> dict[str, Any]:
    by_period: dict[str, int] = {}
    for row in _mapping_rows(payload, "payroll_revisions"):
        period = _valid_month_period(row.get("period"))
        if period is None:
            continue
        stage = str(row.get("revision_stage") or row.get("status") or "")
        stage_rank = _PAYROLL_STAGE_RANK.get(stage)
        if stage_rank is None:
            continue
        by_period[period] = stage_rank
    periods = sorted(by_period)
    return {
        "count": len(periods),
        "start": periods[0] if periods else None,
        "end": periods[-1] if periods else None,
        "stage_by_period": by_period,
        "second_or_later_count": sum(rank >= 2 for rank in by_period.values()),
        "third_estimate_count": sum(rank >= 3 for rank in by_period.values()),
    }


def _calendar_quality(payload: Mapping[str, Any]) -> dict[str, Any]:
    rows = _mapping_rows(payload, "release_calendar")
    timestamps: list[str] = []
    report_ids: set[str] = set()
    latest_by_report: dict[str, str] = {}
    for row in rows:
        report_id = str(row.get("report_id") or "")
        scheduled_at = _valid_calendar_timestamp(row.get("scheduled_at"))
        schedule_status = str(row.get("status") or "")
        if (
            not report_id
            or scheduled_at is None
            or schedule_status not in {"scheduled", "past_scheduled"}
        ):
            continue
        report_ids.add(report_id)
        timestamps.append(scheduled_at)
        latest_by_report[report_id] = max(
            latest_by_report.get(report_id, scheduled_at),
            scheduled_at,
        )
    timestamps.sort()
    return {
        "count": len(timestamps),
        "start": timestamps[0] if timestamps else None,
        "end": timestamps[-1] if timestamps else None,
        "report_ids": report_ids,
        "latest_by_report": latest_by_report,
    }


def _revision_tracking_status(payload: Mapping[str, Any]) -> str:
    data_quality = payload.get("data_quality")
    if not isinstance(data_quality, Mapping):
        return "unavailable"
    revision_tracking = data_quality.get("revision_tracking")
    if not isinstance(revision_tracking, Mapping):
        return "unavailable"
    return str(revision_tracking.get("status") or "unavailable")


def _revision_tracking_quality(payload: Mapping[str, Any]) -> dict[str, Any]:
    data_quality = payload.get("data_quality")
    revision_tracking = (
        data_quality.get("revision_tracking")
        if isinstance(data_quality, Mapping)
        else None
    )
    if not isinstance(revision_tracking, Mapping):
        return {
            "status": "unavailable",
            "observations_seen": 0,
            "tracked_observations": 0,
        }

    def nonnegative_int(key: str) -> int:
        try:
            return max(int(revision_tracking.get(key) or 0), 0)
        except (TypeError, ValueError):
            return 0

    return {
        "status": str(revision_tracking.get("status") or "unavailable"),
        "observations_seen": nonnegative_int("observations_seen"),
        "tracked_observations": nonnegative_int("tracked_observations"),
    }


def _completeness_details(payload: Mapping[str, Any]) -> dict[str, Any]:
    series_quality = _series_quality(payload)
    report_quality = _report_quality(payload)
    calendar_quality = _calendar_quality(payload)
    payroll_quality = _payroll_quality(payload)
    required_series = set(SERIES_IDS)
    required_reports = {str(report["report_id"]) for report in REPORTS}
    usable_series = {
        series_id
        for series_id, quality in series_quality.items()
        if quality["observation_count"] > 0
        and quality["valid_primary_count"] > 0
        and quality["latest_period"] is not None
        and quality["declared_latest_period"] == quality["latest_period"]
        and quality["metadata_consistent"]
        and quality["tracked_numeric_count"] == quality["numeric_observation_count"]
    }
    missing_series = sorted(required_series - usable_series)
    missing_reports = sorted(required_reports - set(report_quality))
    missing_calendar_reports = sorted(
        required_reports - calendar_quality["report_ids"]
    )
    mismatched_report_series = sorted(
        report_id
        for report_id, expected in (
            (str(report["report_id"]), set(report["series_ids"])) for report in REPORTS
        )
        if not expected.issubset(report_quality.get(report_id, set()))
    )
    revision_quality = _revision_tracking_quality(payload)
    numeric_observation_count = sum(
        quality["numeric_observation_count"] for quality in series_quality.values()
    )
    revision_available = (
        revision_quality["status"] == "available"
        and revision_quality["observations_seen"] >= numeric_observation_count
        and revision_quality["tracked_observations"] >= numeric_observation_count
    )
    complete = (
        not missing_series
        and not missing_reports
        and not missing_calendar_reports
        and not mismatched_report_series
        and payroll_quality["count"] > 0
        and calendar_quality["count"] > 0
        and revision_available
    )
    return {
        "complete": complete,
        "required_series_ids": sorted(required_series),
        "missing_required_series_ids": missing_series,
        "required_report_ids": sorted(required_reports),
        "missing_required_report_ids": missing_reports,
        "mismatched_report_series_ids": mismatched_report_series,
        "missing_calendar_report_ids": missing_calendar_reports,
        "payroll_revision_count": payroll_quality["count"],
        "calendar_event_count": calendar_quality["count"],
        "revision_tracking_available": revision_available,
        "numeric_observation_count": numeric_observation_count,
        "tracked_observation_count": revision_quality["tracked_observations"],
    }


def _payload_quality(payload: Mapping[str, Any]) -> tuple[int, int, int]:
    return (
        len(
            {
                series_id
                for series_id, quality in _series_quality(payload).items()
                if quality["observation_count"] > 0
            }
        ),
        _payroll_quality(payload)["count"],
        _calendar_quality(payload)["count"],
    )


def _loses_live_calendar_coverage(
    candidate: Mapping[str, Any],
    prior: Mapping[str, Any],
) -> bool:
    """Check the new official feed before preserved historical events are merged."""

    candidate_quality = _calendar_quality(candidate)
    prior_quality = _calendar_quality(prior)
    if prior_quality["count"] and not candidate_quality["count"]:
        return True
    if not prior_quality["report_ids"].issubset(candidate_quality["report_ids"]):
        return True
    for report_id, prior_latest in prior_quality["latest_by_report"].items():
        candidate_latest = candidate_quality["latest_by_report"].get(report_id)
        if candidate_latest is None or candidate_latest < prior_latest:
            return True
    return False


def _calendar_event_key(row: Mapping[str, Any]) -> str:
    provenance = row.get("provenance")
    uid = provenance.get("uid") if isinstance(provenance, Mapping) else None
    if uid:
        return f"uid:{uid}"
    return f"event:{row.get('report_id')}:{row.get('scheduled_at')}"


def _merge_calendar_history(
    candidate: Mapping[str, Any],
    prior: Mapping[str, Any],
) -> dict[str, Any]:
    """Preserve prior scheduled events while accepting the current official feed."""

    merged_payload = deepcopy(dict(candidate))
    merged: dict[str, dict[str, Any]] = {}
    for row in _mapping_rows(prior, "release_calendar"):
        merged[_calendar_event_key(row)] = deepcopy(dict(row))
    for row in _mapping_rows(candidate, "release_calendar"):
        merged[_calendar_event_key(row)] = deepcopy(dict(row))
    try:
        as_of = datetime.fromisoformat(
            str(candidate.get("as_of") or "").replace("Z", "+00:00")
        )
    except ValueError:
        as_of = datetime.now(timezone.utc)
    as_of = _as_utc(as_of)
    rows: list[dict[str, Any]] = []
    for row in merged.values():
        try:
            scheduled_at = datetime.fromisoformat(
                str(row.get("scheduled_at") or "").replace("Z", "+00:00")
            )
        except ValueError:
            continue
        row["status"] = (
            "past_scheduled" if _as_utc(scheduled_at) <= as_of else "scheduled"
        )
        rows.append(row)
    rows.sort(key=lambda row: (str(row.get("scheduled_at")), str(row.get("report_id"))))
    merged_payload["release_calendar"] = rows
    data_quality = merged_payload.get("data_quality")
    if isinstance(data_quality, dict):
        data_quality["calendar_history_preserved_count"] = max(
            len(rows) - len(_mapping_rows(candidate, "release_calendar")),
            0,
        )
        completeness = _completeness_details(merged_payload)
        data_quality["completeness"] = completeness
        data_quality["status"] = (
            "complete" if completeness["complete"] else "partial"
        )
    return merged_payload


def _loses_quality_dimension(
    candidate: Mapping[str, Any],
    prior: Mapping[str, Any],
) -> bool:
    """Require monotonic completeness before replacing last-known-good evidence."""

    previous_revision = _revision_tracking_quality(prior)
    current_revision = _revision_tracking_quality(candidate)
    if previous_revision["status"] == "available" and current_revision["status"] != "available":
        return True
    for key in ("observations_seen", "tracked_observations"):
        if current_revision[key] < previous_revision[key]:
            return True
    prior_quality = prior.get("data_quality")
    candidate_quality = candidate.get("data_quality")
    if isinstance(prior_quality, Mapping):
        for key in (
            "payroll_revision_history_available",
            "release_calendar_available",
        ):
            if bool(prior_quality.get(key)) and not (
                isinstance(candidate_quality, Mapping)
                and bool(candidate_quality.get(key))
            ):
                return True

    prior_series = _series_quality(prior)
    candidate_series = _series_quality(candidate)
    if not set(prior_series).issubset(candidate_series):
        return True
    for series_id, previous in prior_series.items():
        current = candidate_series[series_id]
        if previous["metadata_consistent"] and not current["metadata_consistent"]:
            return True
        if previous["coverage_start"] is not None and (
            current["coverage_start"] is None
            or current["coverage_start"] > previous["coverage_start"]
        ):
            return True
        if previous["coverage_end"] is not None and (
            current["coverage_end"] is None
            or current["coverage_end"] < previous["coverage_end"]
        ):
            return True
        for key in (
            "observation_count",
            "valid_primary_count",
            "numeric_observation_count",
            "tracked_numeric_count",
        ):
            if current[key] < previous[key]:
                return True
        if previous["latest_period"] is not None and (
            current["latest_period"] is None
            or current["latest_period"] < previous["latest_period"]
        ):
            return True
        if previous["declared_latest_period"] is not None and (
            current["declared_latest_period"] is None
            or current["declared_latest_period"] < previous["declared_latest_period"]
        ):
            return True
        if previous["declared_coverage_start"] is not None and (
            current["declared_coverage_start"] is None
            or current["declared_coverage_start"]
            > previous["declared_coverage_start"]
        ):
            return True
        if previous["declared_coverage_end"] is not None and (
            current["declared_coverage_end"] is None
            or current["declared_coverage_end"] < previous["declared_coverage_end"]
        ):
            return True
        for key in (
            "declared_observation_count",
            "declared_valid_primary_count",
        ):
            if previous[key] is not None and (
                current[key] is None or current[key] < previous[key]
            ):
                return True

    prior_reports = _report_quality(prior)
    candidate_reports = _report_quality(candidate)
    if not set(prior_reports).issubset(candidate_reports):
        return True
    if any(
        not series_ids.issubset(candidate_reports.get(report_id, set()))
        for report_id, series_ids in prior_reports.items()
    ):
        return True

    previous_payroll = _payroll_quality(prior)
    current_payroll = _payroll_quality(candidate)
    for key in ("count", "second_or_later_count", "third_estimate_count"):
        if current_payroll[key] < previous_payroll[key]:
            return True
    if previous_payroll["start"] is not None and (
        current_payroll["start"] is None
        or current_payroll["start"] > previous_payroll["start"]
    ):
        return True
    if previous_payroll["end"] is not None and (
        current_payroll["end"] is None
        or current_payroll["end"] < previous_payroll["end"]
    ):
        return True
    for period, prior_stage in previous_payroll["stage_by_period"].items():
        if current_payroll["stage_by_period"].get(period, -1) < prior_stage:
            return True

    previous_calendar = _calendar_quality(prior)
    current_calendar = _calendar_quality(candidate)
    if current_calendar["count"] < previous_calendar["count"]:
        return True
    if not previous_calendar["report_ids"].issubset(current_calendar["report_ids"]):
        return True
    if previous_calendar["start"] is not None and (
        current_calendar["start"] is None
        or current_calendar["start"] > previous_calendar["start"]
    ):
        return True
    if previous_calendar["end"] is not None and (
        current_calendar["end"] is None
        or current_calendar["end"] < previous_calendar["end"]
    ):
        return True
    for report_id, prior_latest in previous_calendar["latest_by_report"].items():
        current_latest = current_calendar["latest_by_report"].get(report_id)
        if current_latest is None or current_latest < prior_latest:
            return True

    if _completeness_details(prior)["complete"] and not _completeness_details(candidate)["complete"]:
        return True
    return False


def _coverage_for_series(
    series: Sequence[Mapping[str, Any]],
    *,
    years: int,
    as_of: datetime,
) -> dict[str, Any]:
    starts = [item.get("coverage_start") for item in series if item.get("coverage_start")]
    ends = [item.get("coverage_end") for item in series if item.get("coverage_end")]
    return {
        "requested_start": date(as_of.year - years, as_of.month, 1).isoformat(),
        "requested_end": as_of.date().isoformat(),
        "actual_start": min(starts) if starts else None,
        "actual_end": max(ends) if ends else None,
        "series_available": sum(bool(item.get("observations")) for item in series),
        "series_total": len(SERIES_CONFIGS),
    }


def _slice_payload(payload: Mapping[str, Any], years: int) -> dict[str, Any]:
    sliced = deepcopy(dict(payload))
    try:
        as_of = datetime.fromisoformat(str(sliced.get("as_of", "")).replace("Z", "+00:00"))
    except ValueError:
        as_of = datetime.now(timezone.utc)
    as_of = _as_utc(as_of)
    cutoff = date(as_of.year - years, as_of.month, 1).isoformat()
    series_payloads: list[dict[str, Any]] = []
    for item in sliced.get("series", []):
        if not isinstance(item, Mapping):
            continue
        series = dict(item)
        observations = [
            observation
            for observation in series.get("observations", [])
            if isinstance(observation, Mapping) and str(observation.get("period", "")) >= cutoff
        ]
        series["observations"] = observations
        series["coverage_start"] = observations[0]["period"] if observations else None
        series["coverage_end"] = observations[-1]["period"] if observations else None
        series["coverage"] = {
            "start": series["coverage_start"],
            "end": series["coverage_end"],
            "observation_count": len(observations),
            "valid_primary_count": sum(
                observation.get("primary_value") is not None
                for observation in observations
            ),
        }
        series["latest"] = next(
            (
                deepcopy(observation)
                for observation in reversed(observations)
                if observation.get("primary_value") is not None
            ),
            None,
        )
        series_payloads.append(series)
    sliced["series"] = series_payloads
    sliced["payroll_revisions"] = [
        row
        for row in sliced.get("payroll_revisions", [])
        if isinstance(row, Mapping) and str(row.get("period", "")) >= cutoff
    ]
    sliced["requested_years"] = years
    sliced["coverage"] = _coverage_for_series(series_payloads, years=years, as_of=as_of)
    data_quality = sliced.get("data_quality")
    if isinstance(data_quality, dict):
        completeness = _completeness_details(sliced)
        data_quality["completeness"] = completeness
        if not data_quality.get("stale") and data_quality.get("status") != "stale":
            data_quality["status"] = (
                "complete" if completeness["complete"] else "partial"
            )
    return sliced


async def build_bls_lens_payload(
    *,
    years: int = CANONICAL_YEARS,
    now: datetime | None = None,
    retain_history: bool = False,
) -> dict[str, Any]:
    generated_at = _as_utc(now)
    # A stable 2010 history floor prevents the canonical cache from thinning as
    # the visible 10-year window advances and provides full five-year context
    # at its start. Unregistered requests are split into at-most-10-year calls.
    start_year = min(HISTORY_START_YEAR, generated_at.year - years - 5)
    client = BlsClient()
    series_task = asyncio.create_task(
        client.fetch_series(SERIES_IDS, start_year=start_year, end_year=generated_at.year)
    )
    payroll_task = asyncio.create_task(fetch_payroll_revision_history())
    calendar_task = asyncio.create_task(fetch_release_calendar(generated_at))
    source_rows_result, payroll_result, calendar_result = await asyncio.gather(
        series_task,
        payroll_task,
        calendar_task,
        return_exceptions=True,
    )
    if isinstance(source_rows_result, BaseException):
        raise BlsUpstreamError("Unable to retrieve official BLS time series") from source_rows_result
    source_rows = source_rows_result
    normalized_for_vintages = {
        series_id: normalize_bls_series_data(rows)
        for series_id, rows in source_rows.items()
    }
    # The API sometimes emits catalog warnings for JOLTS even though this
    # request does not ask for catalog data. Preserve every upstream message in
    # data_quality, but reserve the user-facing warning rail for data evidence.
    warnings: list[str] = [
        message
        for message in client.messages
        if "catalog data" not in message.lower()
    ]
    try:
        revision_metadata, persistence_stats = await asyncio.to_thread(
            persist_bls_observation_vintages,
            normalized_for_vintages,
            observed_at=generated_at,
        )
        expected_tracked_observations = sum(
            row.get("raw_value") is not None
            for rows in normalized_for_vintages.values()
            for row in rows
        )
        tracked_observations = len(revision_metadata)
        persistence_stats["tracked_observations"] = tracked_observations
        revision_tracking_status = (
            "available"
            if tracked_observations == expected_tracked_observations
            else "partial"
        )
        if revision_tracking_status != "available":
            warnings.append(
                "BLS vintage tracking returned incomplete observation metadata; "
                "the response will not replace a complete cached snapshot."
            )
    except Exception as exc:
        logger.exception("Unable to persist BLS observation vintages")
        revision_metadata = {}
        persistence_stats = {
            "observations_seen": 0,
            "tracked_observations": 0,
            "states_inserted": 0,
            "states_reused": 0,
        }
        revision_tracking_status = "unavailable"
        warnings.append(f"BLS vintage tracking is unavailable: {type(exc).__name__}.")

    series_payloads = _build_series_payloads(source_rows, revision_metadata)
    unavailable_series = [
        series["series_id"] for series in series_payloads if not series["observations"]
    ]
    for series_id in unavailable_series:
        warnings.append(f"Official BLS series {series_id} returned no monthly observations.")
    published_nonnumeric_periods = sum(
        observation.get("unavailable_reason") == "published_without_numeric_value"
        for series in series_payloads
        for observation in series["observations"]
    )
    missing_months = sum(
        observation.get("unavailable_reason") == "missing_from_bls_api_response"
        for series in series_payloads
        for observation in series["observations"]
    )
    if published_nonnumeric_periods:
        warnings.append(
            f"{published_nonnumeric_periods} published BLS periods contain no numeric value; their official footnotes are retained."
        )
    if missing_months:
        warnings.append(
            f"{missing_months} monthly periods are absent from the BLS API response and are rendered as explicit gaps."
        )

    if isinstance(payroll_result, BaseException):
        logger.warning("Unable to retrieve BLS payroll revisions: %s", payroll_result)
        payroll_revisions: list[dict[str, Any]] = []
        warnings.append("Official national payroll revision history is temporarily unavailable.")
    else:
        payroll_revisions = payroll_result
    if isinstance(calendar_result, BaseException):
        logger.warning("Unable to retrieve BLS release calendar: %s", calendar_result)
        release_calendar: list[dict[str, Any]] = []
        warnings.append("Official BLS release calendar is temporarily unavailable.")
    else:
        release_calendar = calendar_result

    payload: dict[str, Any] = {
        "as_of": generated_at.isoformat().replace("+00:00", "Z"),
        "requested_years": years,
        "coverage": _coverage_for_series(
            series_payloads,
            years=years,
            as_of=generated_at,
        ),
        "data_quality": {
            "status": "partial",
            "stale": False,
            "source": "U.S. Bureau of Labor Statistics",
            "api_url": BLS_API_URL,
            "api_registered": bool(client.api_key),
            "api_messages": list(client.messages),
            "series_available": len(SERIES_CONFIGS) - len(unavailable_series),
            "series_total": len(SERIES_CONFIGS),
            "payroll_revision_history_available": bool(payroll_revisions),
            "release_calendar_available": bool(release_calendar),
            "revision_tracking": {
                "status": revision_tracking_status,
                **persistence_stats,
            },
            "cache_ttl_seconds": BLS_LENS_CACHE_TTL_SECONDS,
            "max_stale_age_seconds": BLS_LENS_MAX_STALE_AGE_SECONDS,
        },
        "reports": [deepcopy(report) for report in REPORTS],
        "series": series_payloads,
        "payroll_revisions": payroll_revisions,
        "release_calendar": release_calendar,
        "methodology": {
            "series_source": {
                "publisher": "U.S. Bureau of Labor Statistics",
                "api_version": "v2",
                "url": BLS_API_URL,
                "sample_data_used": False,
            },
            "primary_values": (
                "Official not-seasonally-adjusted CPI, core CPI, and final-demand PPI, "
                "plus seasonally adjusted hourly earnings, use 12-month percent change; "
                "payrolls use the 1-month level change; openings level is scaled from "
                "thousands to millions; unemployment, openings rate, and quits rate use "
                "their published rates."
            ),
            "relative_percentile": {
                "window_months": PERCENTILE_WINDOW_MONTHS,
                "minimum_valid_points": PERCENTILE_MINIMUM_POINTS,
                "method": "inclusive trailing-window midrank percentile of the primary measure",
                "interpretation": (
                    "Higher means more of the named measure relative to its own recent history; "
                    "it never means inherently good or bad."
                ),
            },
            "change_fields": {
                "change_1m": "Published raw-value change from the immediately prior calendar month.",
                "change_12m_pct": "Published raw-value percent change from the same month one year earlier.",
            },
            "tracked_revisions": (
                "The dashboard records each distinct raw BLS value, preliminary flag, and footnote "
                "state observed for a series-month. First-seen/current values and deltas refer to "
                "those observed API vintages, not a reconstruction of releases before tracking began."
            ),
            "payroll_revisions": {
                "source_url": BLS_PAYROLL_REVISIONS_URL,
                "scope": "official national seasonally adjusted over-the-month payroll estimates",
                "note": (
                    "BLS publishes first, second, and third sample-based estimates and their deltas; "
                    "the third estimate remains subject to the separate annual benchmark-revision "
                    "process."
                ),
            },
            "calendar": {
                "source_url": BLS_RELEASE_CALENDAR_URL,
                "time_zone": "America/New_York",
                "status_contract": (
                    "Calendar entries describe scheduled clock events only. "
                    "scheduled means the clock is still ahead; past_scheduled means it has elapsed. "
                    "Neither status proves publication nor links a release to an observation vintage."
                ),
            },
        },
        "warnings": warnings,
    }
    completeness = _completeness_details(payload)
    payload["data_quality"]["status"] = (
        "complete" if completeness["complete"] else "partial"
    )
    payload["data_quality"]["completeness"] = completeness
    return payload if retain_history else _slice_payload(payload, years)


def _usable_snapshot():
    snapshot = load_response_snapshot(BLS_LENS_CACHE_KEY)
    if snapshot is not None and not snapshot.is_within_stale_limit(
        BLS_LENS_MAX_STALE_AGE_SECONDS
    ):
        return None
    return snapshot


async def refresh_bls_lens_snapshot(*, force: bool = False) -> dict[str, Any]:
    """Refresh the canonical response snapshot with lower-quality protection."""

    snapshot = _usable_snapshot()
    if snapshot is not None and snapshot.is_fresh(BLS_LENS_CACHE_TTL_SECONDS) and not force:
        return snapshot.payload
    async with async_response_refresh_lock(BLS_LENS_CACHE_KEY):
        snapshot = _usable_snapshot()
        if snapshot is not None and snapshot.is_fresh(BLS_LENS_CACHE_TTL_SECONDS) and not force:
            return snapshot.payload
        try:
            payload = await build_bls_lens_payload(
                years=CANONICAL_YEARS,
                retain_history=True,
            )
        except Exception as exc:
            if snapshot is None:
                raise BlsLensUnavailable(
                    "Official BLS data could not be refreshed and no cached snapshot is available."
                ) from exc
            logger.exception(
                "BLS Lens refresh failed; reusing snapshot aged %.1fs",
                snapshot.age_seconds,
            )
            return mark_stale_snapshot(
                snapshot.payload,
                snapshot,
                reason="bls_lens_refresh_failed",
                ttl_seconds=BLS_LENS_CACHE_TTL_SECONDS,
                max_stale_age_seconds=BLS_LENS_MAX_STALE_AGE_SECONDS,
            )
        if snapshot is not None:
            if _loses_live_calendar_coverage(payload, snapshot.payload):
                logger.warning(
                    "BLS calendar refresh lost required live-feed coverage; retaining snapshot aged %.1fs",
                    snapshot.age_seconds,
                )
                return mark_stale_snapshot(
                    snapshot.payload,
                    snapshot,
                    reason="bls_lens_refresh_lower_quality",
                    ttl_seconds=BLS_LENS_CACHE_TTL_SECONDS,
                    max_stale_age_seconds=BLS_LENS_MAX_STALE_AGE_SECONDS,
                )
            payload = _merge_calendar_history(payload, snapshot.payload)
            if _loses_quality_dimension(payload, snapshot.payload):
                logger.warning(
                    "BLS Lens refresh was lower quality; retaining snapshot aged %.1fs",
                    snapshot.age_seconds,
                )
                return mark_stale_snapshot(
                    snapshot.payload,
                    snapshot,
                    reason="bls_lens_refresh_lower_quality",
                    ttl_seconds=BLS_LENS_CACHE_TTL_SECONDS,
                    max_stale_age_seconds=BLS_LENS_MAX_STALE_AGE_SECONDS,
                )
        if _payload_quality(payload)[0] == 0:
            if snapshot is not None:
                return mark_stale_snapshot(
                    snapshot.payload,
                    snapshot,
                    reason="bls_lens_refresh_incomplete",
                    ttl_seconds=BLS_LENS_CACHE_TTL_SECONDS,
                    max_stale_age_seconds=BLS_LENS_MAX_STALE_AGE_SECONDS,
                )
            raise BlsLensUnavailable("Official BLS series returned no usable observations.")
        store_response_snapshot(BLS_LENS_CACHE_KEY, payload)
        return payload


async def get_bls_lens_payload(years: int) -> dict[str, Any]:
    canonical = await refresh_bls_lens_snapshot()
    return _slice_payload(canonical, years)
