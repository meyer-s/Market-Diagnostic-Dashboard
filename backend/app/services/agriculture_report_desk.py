"""Official-source agriculture report desk.

The first chart-ready adapter uses USDA's monthly, as-reported WASDE CSV files.
Other report families remain visible in the catalog and calendar with an honest
coverage state until their historical parsers are connected. Market expectations
are deliberately not sourced here: USDA does not publish market consensus data.
"""

from __future__ import annotations

import csv
import io
import zipfile
from bisect import bisect_left
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from statistics import mean, pstdev
from threading import Lock
from time import sleep
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.exc import SQLAlchemyError

from app.core.db import SessionLocal
from app.models.agriculture_wasde_observation import AgricultureWasdeObservation
from app.services.agriculture_index import AGRICULTURE_SYMBOLS
from app.services.ingestion.yahoo_client import YahooClient, YahooClientError


EASTERN = ZoneInfo("America/New_York")
HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (agriculture-report-desk)",
    "Accept": "application/zip,text/csv,application/json,text/plain,*/*",
}
WASDE_CSV_URL = "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-{year}-{month:02d}.csv"
WASDE_STRUCTURED_START = date(2010, 4, 9)
WASDE_MONTHLY_ARCHIVE_START = date(2021, 1, 1)
WASDE_BULK_ARCHIVES = (
    (
        date(2010, 4, 1),
        date(2015, 12, 31),
        "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2010-04-to-2015-12.zip",
    ),
    (
        date(2016, 1, 1),
        date(2020, 12, 31),
        "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2016-01-to-2020-12.zip",
    ),
)
WASDE_MONTHLY_URL_OVERRIDES = {
    (2026, 5): "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2026-05-V2.csv",
    (2026, 6): "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2026-06-V2.csv",
}
# The official historical-data page has no October 2025 release file.
WASDE_UNPUBLISHED_MONTHS = {(2025, 10)}
_CACHE_TTL = timedelta(hours=12)
_CSV_CACHE: dict[str, dict[str, Any]] = {}
_CSV_CACHE_LOCK = Lock()


@dataclass(frozen=True)
class WasdeArchiveSource:
    url: str
    start: date
    end: date
    kind: str
    required: bool = True


COMMODITIES: dict[str, dict[str, str]] = {
    "ZC": {"name": "Corn", "usda": "Corn", "ticker": "ZC=F"},
    "ZS": {"name": "Soybeans", "usda": "Oilseed, Soybean", "ticker": "ZS=F"},
    "ZW": {"name": "Chicago Wheat", "usda": "Wheat", "ticker": "ZW=F"},
    "KE": {"name": "KC Hard Red Winter Wheat", "usda": "Wheat", "ticker": "KE=F"},
    "MW": {"name": "Minneapolis Spring Wheat", "usda": "Wheat", "ticker": "MWE=F"},
    "ZO": {"name": "Oats", "usda": "Oats", "ticker": "ZO=F"},
    "ZR": {"name": "Rough Rice", "usda": "Rice", "ticker": "ZR=F"},
    "CT": {"name": "Cotton", "usda": "Cotton", "ticker": "CT=F"},
}

METRICS: tuple[dict[str, Any], ...] = (
    {
        "id": "ending_stocks",
        "label": "Ending stocks",
        "attribute": ("Ending Stocks", "Ending stocks"),
        "orientation": -1,
        "bullish_when": "lower than the prior estimate",
    },
    {
        "id": "production",
        "label": "Production",
        "attribute": ("Production",),
        "orientation": -1,
        "bullish_when": "lower than the prior estimate",
    },
    {
        "id": "exports",
        "label": "Exports",
        "attribute": ("Exports",),
        "orientation": 1,
        "bullish_when": "higher than the prior estimate",
    },
    {
        "id": "yield",
        "label": "Yield",
        "attribute": ("Yield", "Yield per Harvested Acre"),
        "orientation": -1,
        "bullish_when": "lower than the prior estimate",
    },
)


def _wasde_archive_sources(since: date, through: date) -> list[WasdeArchiveSource]:
    sources = [
        WasdeArchiveSource(url=url, start=start, end=end, kind="bulk_zip")
        for start, end, url in WASDE_BULK_ARCHIVES
        if start <= through and end >= since
    ]
    cursor = max(since, WASDE_MONTHLY_ARCHIVE_START).replace(day=1)
    final_month = through.replace(day=1)
    while cursor <= final_month:
        if (cursor.year, cursor.month) in WASDE_UNPUBLISHED_MONTHS:
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
            continue
        sources.append(
            WasdeArchiveSource(
                url=WASDE_MONTHLY_URL_OVERRIDES.get(
                    (cursor.year, cursor.month),
                    WASDE_CSV_URL.format(year=cursor.year, month=cursor.month),
                ),
                start=cursor,
                end=(cursor.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1),
                kind="monthly_csv",
                required=cursor < final_month,
            )
        )
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return sources

REPORT_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": "wasde",
        "name": "WASDE",
        "agency": "USDA OCE",
        "cadence": "Monthly",
        "release_time": "12:00 ET",
        "coverage": "chart_ready",
        "coverage_label": "Chart ready",
        "description": "U.S. and world balance-sheet estimates, preserved as reported on each release date.",
        "source_url": "https://www.usda.gov/oce/commodity/wasde",
        "archive_url": "https://www.usda.gov/historical-wasde-report-data-3",
    },
    {
        "id": "crop_production",
        "name": "Crop Production",
        "agency": "USDA NASS",
        "cadence": "Monthly in season",
        "release_time": "12:00 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "Acreage, yield, and production estimates from producer surveys and objective measurements.",
        "source_url": "https://esmis.nal.usda.gov/publication/crop-production",
        "archive_url": "https://esmis.nal.usda.gov/publication/crop-production",
    },
    {
        "id": "crop_progress",
        "name": "Crop Progress",
        "agency": "USDA NASS",
        "cadence": "Weekly in season",
        "release_time": "16:00 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "Planting, development, harvest pace, and crop-condition ratings.",
        "source_url": "https://esmis.nal.usda.gov/publication/crop-progress",
        "archive_url": "https://esmis.nal.usda.gov/publication/crop-progress",
    },
    {
        "id": "export_sales",
        "name": "Export Sales",
        "agency": "USDA FAS",
        "cadence": "Weekly",
        "release_time": "08:30 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "Weekly export commitments, shipments, and outstanding sales by commodity and destination.",
        "source_url": "https://www.fas.usda.gov/data/scheduled-reports",
        "archive_url": "https://apps.fas.usda.gov/esrquery/",
    },
    {
        "id": "export_inspections",
        "name": "Export Inspections",
        "agency": "USDA AMS",
        "cadence": "Weekly",
        "release_time": "11:00 ET",
        "coverage": "latest_snapshot",
        "coverage_label": "Latest snapshot",
        "description": "Inspected export volume and marketing-year pace for major grains and oilseeds.",
        "source_url": "https://www.ams.usda.gov/mnreports/wa_gr101.txt",
        "archive_url": "https://www.ams.usda.gov/market-news/grain-and-feed",
    },
    {
        "id": "grain_stocks",
        "name": "Grain Stocks",
        "agency": "USDA NASS",
        "cadence": "Quarterly",
        "release_time": "12:00 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "On-farm and off-farm stocks, a direct checkpoint on supply disappearance.",
        "source_url": "https://esmis.nal.usda.gov/publication/grain-stocks",
        "archive_url": "https://esmis.nal.usda.gov/publication/grain-stocks",
    },
    {
        "id": "acreage",
        "name": "Acreage",
        "agency": "USDA NASS",
        "cadence": "Annual",
        "release_time": "12:00 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "Planted and harvested acreage estimates following the March intentions survey.",
        "source_url": "https://esmis.nal.usda.gov/publication/acreage",
        "archive_url": "https://esmis.nal.usda.gov/publication/acreage",
    },
    {
        "id": "cot",
        "name": "Commitments of Traders",
        "agency": "CFTC",
        "cadence": "Weekly",
        "release_time": "15:30 ET",
        "coverage": "official_archive",
        "coverage_label": "Raw archive",
        "description": "Tuesday futures positioning published Friday, including commercial and managed-money cohorts.",
        "source_url": "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
        "archive_url": "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm",
    },
)

_WASDE_2026_DATES = (
    date(2026, 1, 12), date(2026, 2, 10), date(2026, 3, 10), date(2026, 4, 9),
    date(2026, 5, 12), date(2026, 6, 11), date(2026, 7, 10), date(2026, 8, 12),
    date(2026, 9, 11), date(2026, 10, 9), date(2026, 11, 10), date(2026, 12, 10),
)


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return parsed


def _month_starts(years: int, reference: date) -> list[date]:
    cursor = reference.replace(day=1)
    months: list[date] = []
    for _ in range(max(12, min(years, 3) * 12)):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(months))


def _history_start(years: int, reference: date) -> date:
    return max(WASDE_STRUCTURED_START, reference - timedelta(days=years * 366))


def _download_wasde_month(month_start: date) -> list[dict[str, str]]:
    if (month_start.year, month_start.month) in WASDE_UNPUBLISHED_MONTHS:
        return []
    url = WASDE_MONTHLY_URL_OVERRIDES.get(
        (month_start.year, month_start.month),
        WASDE_CSV_URL.format(year=month_start.year, month=month_start.month),
    )
    now = datetime.now(EASTERN)
    with _CSV_CACHE_LOCK:
        cached = _CSV_CACHE.get(url)
        if cached and now - cached["fetched_at"] <= _CACHE_TTL:
            return cached["rows"]

    response = requests.get(url, headers=HTTP_HEADERS, timeout=12)
    if response.status_code == 404:
        rows: list[dict[str, str]] = []
    else:
        response.raise_for_status()
        rows = list(csv.DictReader(io.StringIO(response.text.lstrip("\ufeff"))))

    with _CSV_CACHE_LOCK:
        _CSV_CACHE[url] = {"fetched_at": now, "rows": rows}
    return rows


def _download_wasde_months(months: list[date]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(_download_wasde_month, month): month for month in months}
        for future in as_completed(futures):
            try:
                rows.extend(future.result())
            except requests.RequestException:
                continue
    return rows


def _read_persisted_wasde_rows(start: date, end: date) -> list[dict[str, str]]:
    db = SessionLocal()
    try:
        observations = db.query(AgricultureWasdeObservation).filter(
            AgricultureWasdeObservation.release_date >= start,
            AgricultureWasdeObservation.release_date <= end,
        ).order_by(AgricultureWasdeObservation.release_date.asc()).all()
    except SQLAlchemyError:
        db.rollback()
        return []
    finally:
        db.close()
    return [
        {
            "ReleaseDate": observation.release_date.isoformat(),
            "ReportDate": observation.release_date.isoformat(),
            "ReportTitle": "USDA WASDE as-reported archive",
            "Attribute": observation.source_attribute,
            "Commodity": observation.commodity,
            "Region": "United States",
            "MarketYear": observation.market_year,
            "ProjEstFlag": observation.projection_status or "",
            "Value": str(observation.value),
            "Unit": observation.unit,
            "SourceUrl": observation.source_url,
        }
        for observation in observations
    ]


def _load_wasde_history(years: int, reference: date) -> list[dict[str, str]]:
    persisted = _read_persisted_wasde_rows(_history_start(years, reference), reference)
    if persisted:
        recent_months = _month_starts(1, reference)[-2:]
        return _download_wasde_months(recent_months) + persisted
    return _download_wasde_months(_month_starts(min(years, 3), reference))


def _release_date(row: dict[str, str]) -> date | None:
    raw = row.get("ReleaseDate") or row.get("ReportDate")
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    return None


def _market_year_sort(value: str) -> tuple[int, int]:
    parts = value.replace(" ", "").split("/")
    try:
        first = int(parts[0])
        second = int(parts[1]) if len(parts) > 1 else first
        if second < 100:
            second += first // 100 * 100
        return first, second
    except (TypeError, ValueError):
        return (0, 0)


def _select_backfill_observations(
    rows: Iterable[dict[str, str]],
    *,
    source_url: str,
    since: date,
    through: date,
) -> tuple[list[dict[str, Any]], int]:
    commodity_lookup = {
        item["usda"].strip().lower(): item["usda"]
        for item in COMMODITIES.values()
    }
    metric_lookup = {
        attribute.strip().lower(): (metric["id"], attribute)
        for metric in METRICS
        for attribute in metric["attribute"]
    }
    candidates: dict[tuple[str, str, date], tuple[tuple[int, tuple[int, int]], dict[str, Any]]] = {}
    rows_scanned = 0
    for row in rows:
        rows_scanned += 1
        commodity = commodity_lookup.get((row.get("Commodity") or "").strip().lower())
        metric_match = metric_lookup.get((row.get("Attribute") or "").strip().lower())
        if commodity is None or metric_match is None:
            continue
        if (row.get("Region") or "").strip().lower() != "united states":
            continue
        if "reliability" in (row.get("ReportTitle") or "").lower():
            continue
        released = _release_date(row)
        value = _safe_float(row.get("Value"))
        if released is None or value is None or released < since or released > through:
            continue
        metric_id, source_attribute = metric_match
        projection_status = (row.get("ProjEstFlag") or "").strip()
        rank = (
            1 if projection_status.lower().startswith("proj") else 0,
            _market_year_sort(row.get("MarketYear") or ""),
        )
        key = (commodity, metric_id, released)
        observation = {
            "commodity": commodity,
            "metric_id": metric_id,
            "source_attribute": source_attribute,
            "release_date": released,
            "value": value,
            "unit": (row.get("Unit") or "").strip(),
            "market_year": (row.get("MarketYear") or "").strip(),
            "projection_status": projection_status or None,
            "source_url": source_url,
        }
        current = candidates.get(key)
        if current is None or rank > current[0]:
            candidates[key] = (rank, observation)
    observations = [item[1] for item in candidates.values()]
    observations.sort(key=lambda item: (item["release_date"], item["commodity"], item["metric_id"]))
    return observations, rows_scanned


def _download_backfill_source(
    source: WasdeArchiveSource,
    *,
    since: date,
    through: date,
) -> dict[str, Any]:
    response = None
    for attempt in range(3):
        try:
            response = requests.get(source.url, headers=HTTP_HEADERS, timeout=60)
            if response.status_code == 404 and not source.required:
                return {
                    "source": source,
                    "missing": True,
                    "rows_scanned": 0,
                    "observations": [],
                }
            response.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 2:
                raise
            sleep(0.5 * (2 ** attempt))
    if response is None:
        raise RuntimeError(f"USDA archive request returned no response: {source.url}")

    if source.kind == "bulk_zip":
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            members = [name for name in archive.namelist() if name.lower().endswith(".csv")]
            if not members:
                raise ValueError(f"USDA archive contained no CSV file: {source.url}")
            with archive.open(members[0]) as raw_stream:
                with io.TextIOWrapper(raw_stream, encoding="utf-8-sig", newline="") as text_stream:
                    observations, rows_scanned = _select_backfill_observations(
                        csv.DictReader(text_stream),
                        source_url=source.url,
                        since=since,
                        through=through,
                    )
    else:
        text_stream = io.StringIO(response.content.decode("utf-8-sig"))
        observations, rows_scanned = _select_backfill_observations(
            csv.DictReader(text_stream),
            source_url=source.url,
            since=since,
            through=through,
        )
    return {
        "source": source,
        "missing": False,
        "rows_scanned": rows_scanned,
        "observations": observations,
    }


def backfill_wasde_history(
    db,
    *,
    since: date = WASDE_STRUCTURED_START,
    through: date | None = None,
    max_workers: int = 6,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Import every supported chart observation from the official USDA archive."""
    through = through or datetime.now(EASTERN).date()
    since = max(since, WASDE_STRUCTURED_START)
    if through < since:
        raise ValueError("through must be on or after the structured WASDE start date")
    sources = _wasde_archive_sources(since, through)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, 8))) as executor:
        futures = {
            executor.submit(_download_backfill_source, source, since=since, through=through): source
            for source in sources
        }
        for future in as_completed(futures):
            results.append(future.result())

    incoming: dict[tuple[str, str, date], dict[str, Any]] = {}
    for result in results:
        for observation in result["observations"]:
            key = (
                observation["commodity"],
                observation["metric_id"],
                observation["release_date"],
            )
            incoming[key] = observation

    existing_rows = db.query(AgricultureWasdeObservation).filter(
        AgricultureWasdeObservation.release_date >= since,
        AgricultureWasdeObservation.release_date <= through,
    ).all()
    existing = {
        (row.commodity, row.metric_id, row.release_date): row
        for row in existing_rows
    }
    inserted = 0
    updated = 0
    unchanged = 0
    now = datetime.now(ZoneInfo("UTC")).replace(tzinfo=None)
    mutable_fields = (
        "source_attribute",
        "value",
        "unit",
        "market_year",
        "projection_status",
        "source_url",
    )
    for key, observation in incoming.items():
        current = existing.get(key)
        if current is None:
            db.add(AgricultureWasdeObservation(**observation, created_at=now, updated_at=now))
            inserted += 1
            continue
        changed = any(getattr(current, field) != observation[field] for field in mutable_fields)
        if not changed:
            unchanged += 1
            continue
        for field in mutable_fields:
            setattr(current, field, observation[field])
        current.updated_at = now
        updated += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    release_dates = sorted({key[2] for key in incoming})
    missing_urls = [result["source"].url for result in results if result["missing"]]
    return {
        "status": "dry_run" if dry_run else "committed",
        "requested_start": since.isoformat(),
        "requested_end": through.isoformat(),
        "sources_requested": len(sources),
        "sources_loaded": len(sources) - len(missing_urls),
        "missing_optional_sources": missing_urls,
        "raw_rows_scanned": sum(result["rows_scanned"] for result in results),
        "observations_selected": len(incoming),
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "release_count": len(release_dates),
        "coverage_start": release_dates[0].isoformat() if release_dates else None,
        "coverage_end": release_dates[-1].isoformat() if release_dates else None,
    }


def _select_metric_rows(
    rows: list[dict[str, str]], commodity: str, attributes: tuple[str, ...]
) -> list[dict[str, Any]]:
    accepted_attributes = {attribute.lower() for attribute in attributes}
    candidates: dict[date, list[dict[str, str]]] = {}
    for row in rows:
        if (row.get("Commodity") or "").strip().lower() != commodity.lower():
            continue
        if (row.get("Attribute") or "").strip().lower() not in accepted_attributes:
            continue
        if (row.get("Region") or "").strip().lower() != "united states":
            continue
        if "reliability" in (row.get("ReportTitle") or "").lower():
            continue
        released = _release_date(row)
        value = _safe_float(row.get("Value"))
        if released is None or value is None:
            continue
        candidates.setdefault(released, []).append(row)

    selected: list[dict[str, Any]] = []
    for released, release_rows in sorted(candidates.items()):
        projected = [row for row in release_rows if (row.get("ProjEstFlag") or "").lower().startswith("proj")]
        pool = projected or release_rows
        row = max(pool, key=lambda item: _market_year_sort(item.get("MarketYear") or ""))
        selected.append({
            "release_date": released.isoformat(),
            "value": _safe_float(row.get("Value")),
            "unit": (row.get("Unit") or "").strip(),
            "market_year": (row.get("MarketYear") or "").strip(),
            "projection_status": (row.get("ProjEstFlag") or "").strip() or None,
        })
    return selected


def _standardize_metric(points: list[dict[str, Any]], orientation: int) -> None:
    prior_by_market_year: dict[str, float] = {}
    revisions: list[float] = []
    for point in points:
        prior = prior_by_market_year.get(point["market_year"])
        revision = point["value"] - prior if prior is not None else None
        point["prior_value"] = prior
        point["revision"] = revision
        if revision is not None:
            revisions.append(revision)
        prior_by_market_year[point["market_year"]] = point["value"]

    center = mean(revisions) if revisions else 0.0
    scale = pstdev(revisions) if len(revisions) >= 2 else 0.0
    for point in points:
        revision = point["revision"]
        raw_z = (revision - center) / scale if revision is not None and scale > 0 else None
        point["revision_z"] = round(raw_z, 3) if raw_z is not None else None
        point["bullish_signal_z"] = round(max(-3.0, min(3.0, raw_z * orientation)), 3) if raw_z is not None else None
    for point in points:
        point["normalization"] = {
            "basis": "release-to-release revision for the same market year",
            "mean_revision": round(center, 6),
            "revision_std_dev": round(scale, 6),
            "positive_means": "bullish supply-demand revision",
        }


def _price_history(ticker: str, start: date, end: date) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        rows = YahooClient().fetch_series(
            ticker,
            start_date=(start - timedelta(days=10)).isoformat(),
            end_date=(end + timedelta(days=8)).isoformat(),
        )
    except YahooClientError as exc:
        return [], [f"Futures history is temporarily unavailable: {exc}"]
    clean = [row for row in rows if row.get("value") is not None]
    if not clean:
        return [], ["Futures history returned no usable daily closes."]
    base = float(clean[0]["value"])
    for row in clean:
        row["rebased"] = round(float(row["value"]) / base * 100, 4) if base else None
    return clean, warnings


def _attach_reactions(series: list[dict[str, Any]], prices: list[dict[str, Any]]) -> None:
    if not prices:
        return
    price_dates = [date.fromisoformat(row["date"]) for row in prices]
    closes = [float(row["value"]) for row in prices]
    for layer in series:
        for point in layer["points"]:
            released = date.fromisoformat(point["release_date"])
            event_index = bisect_left(price_dates, released)
            prior_index = event_index - 1
            if event_index >= len(closes) or prior_index < 0:
                point["reaction_1d_pct"] = None
                point["reaction_5d_pct"] = None
                continue
            base = closes[prior_index]
            day_five = event_index + 4
            point["reaction_1d_pct"] = round((closes[event_index] / base - 1) * 100, 3) if base else None
            point["reaction_5d_pct"] = (
                round((closes[day_five] / base - 1) * 100, 3)
                if base and day_five < len(closes)
                else None
            )


def _next_release_weekday(reference: datetime, weekday: int, release_time: time) -> date:
    offset = (weekday - reference.weekday()) % 7
    candidate = reference.date() + timedelta(days=offset)
    candidate_at = datetime.combine(candidate, release_time, tzinfo=EASTERN)
    if candidate_at < reference:
        candidate += timedelta(days=7)
    return candidate


def _release_event(report_id: str, label: str, released: date, release_time: time, confidence: str) -> dict[str, Any]:
    timestamp = datetime.combine(released, release_time, tzinfo=EASTERN)
    return {
        "report_id": report_id,
        "report": label,
        "release_at": timestamp.isoformat(),
        "date": released.isoformat(),
        "time_label": timestamp.strftime("%I:%M %p ET").lstrip("0"),
        "confidence": confidence,
    }


def build_release_calendar(reference: date | datetime | None = None) -> list[dict[str, Any]]:
    if isinstance(reference, datetime):
        reference_at = reference.astimezone(EASTERN)
    elif isinstance(reference, date):
        reference_at = datetime.combine(reference, time.min, tzinfo=EASTERN)
    else:
        reference_at = datetime.now(EASTERN)
    reference_date = reference_at.date()
    events: list[dict[str, Any]] = []
    for released in _WASDE_2026_DATES:
        if datetime.combine(released, time(12), tzinfo=EASTERN) >= reference_at:
            events.append(_release_event("wasde", "WASDE", released, time(12), "official"))
            events.append(_release_event("crop_production", "Crop Production", released, time(12), "official"))
    crop_progress = _next_release_weekday(reference_at, 0, time(16))
    if 4 <= crop_progress.month <= 11:
        events.append(_release_event("crop_progress", "Crop Progress", crop_progress, time(16), "recurring"))
    events.append(_release_event("export_inspections", "Export Inspections", _next_release_weekday(reference_at, 0, time(11)), time(11), "recurring"))
    events.append(_release_event("export_sales", "Export Sales", _next_release_weekday(reference_at, 3, time(8, 30)), time(8, 30), "recurring"))
    events.append(_release_event("cot", "Commitments of Traders", _next_release_weekday(reference_at, 4, time(15, 30)), time(15, 30), "recurring"))

    grain_stock_dates = [date(reference_date.year, 9, 30), date(reference_date.year + 1, 1, 12), date(reference_date.year + 1, 3, 31)]
    next_grain_stocks = next(item for item in grain_stock_dates if datetime.combine(item, time(12), tzinfo=EASTERN) >= reference_at)
    events.append(_release_event("grain_stocks", "Grain Stocks", next_grain_stocks, time(12), "expected"))
    acreage = date(reference_date.year, 6, 30)
    if datetime.combine(acreage, time(12), tzinfo=EASTERN) < reference_at:
        acreage = date(reference_date.year + 1, 6, 30)
    events.append(_release_event("acreage", "Acreage", acreage, time(12), "expected"))
    return sorted(events, key=lambda item: item["release_at"])[:18]


def _build_takeaways(series: list[dict[str, Any]], selected_metric: str) -> list[dict[str, str]]:
    selected = next((layer for layer in series if layer["metric_id"] == selected_metric), series[0] if series else None)
    if selected is None or not selected["points"]:
        return [{"tone": "neutral", "title": "History unavailable", "body": "No chart-ready official observations were returned for this selection."}]
    latest = selected["points"][-1]
    signal = latest.get("bullish_signal_z")
    reaction = latest.get("reaction_1d_pct")
    if signal is None:
        direction = "The release opened a new market-year sequence, so no like-for-like revision signal is available yet."
        tone = "neutral"
    elif signal >= 0.5:
        direction = f"The latest {selected['label'].lower()} revision was supply-demand supportive at {signal:+.2f}σ."
        tone = "positive"
    elif signal <= -0.5:
        direction = f"The latest {selected['label'].lower()} revision was supply-demand restrictive for price at {signal:+.2f}σ."
        tone = "negative"
    else:
        direction = f"The latest {selected['label'].lower()} revision was close to its historical norm at {signal:+.2f}σ."
        tone = "neutral"
    if signal is None or reaction is None:
        alignment = "The aligned/divergent read needs both a standardized revision and a same-session futures close."
        alignment_tone = "neutral"
    elif signal * reaction > 0:
        alignment = f"Futures moved {reaction:+.2f}% through the release-day close, aligned with the standardized report direction."
        alignment_tone = "positive" if signal > 0 else "negative"
    else:
        alignment = f"Futures moved {reaction:+.2f}% through the release-day close, diverging from the standardized report direction."
        alignment_tone = "warning"
    return [
        {"tone": tone, "title": "Standardized release read", "body": direction},
        {"tone": alignment_tone, "title": "Price confirmation", "body": alignment},
        {
            "tone": "neutral",
            "title": "Interpretation boundary",
            "body": "Price moves are associated reactions, not causal attribution. Weather, positioning, macro, and simultaneous releases can dominate.",
        },
    ]


def build_report_desk(symbol: str = "ZC", years: int = 2, selected_metric: str = "ending_stocks") -> dict[str, Any]:
    symbol = symbol.upper().strip()
    if symbol not in COMMODITIES:
        raise KeyError(f"Report history is not yet chart-ready for agriculture symbol: {symbol}")
    metric_ids = {metric["id"] for metric in METRICS}
    if selected_metric not in metric_ids:
        raise KeyError(f"Unsupported report metric: {selected_metric}")
    years = max(1, min(years, 20))
    now = datetime.now(EASTERN)
    commodity = COMMODITIES[symbol]
    warnings: list[str] = []
    wasde_rows = _load_wasde_history(years, now.date())
    if not wasde_rows:
        warnings.append("USDA WASDE history is temporarily unavailable; the release calendar and source links remain usable.")

    series: list[dict[str, Any]] = []
    for metric in METRICS:
        points = _select_metric_rows(wasde_rows, commodity["usda"], metric["attribute"])
        _standardize_metric(points, metric["orientation"])
        if points:
            series.append({
                "id": f"wasde:{metric['id']}",
                "report_id": "wasde",
                "report": "WASDE",
                "metric_id": metric["id"],
                "label": metric["label"],
                "bullish_when": metric["bullish_when"],
                "unit": points[-1]["unit"],
                "points": points,
            })

    history_start = _history_start(years, now.date())
    prices, price_warnings = _price_history(
        commodity["ticker"],
        history_start,
        now.date(),
    )
    warnings.extend(price_warnings)
    _attach_reactions(series, prices)
    schedule = build_release_calendar(now)
    next_release = schedule[0] if schedule else None
    selected_layer = next((layer for layer in series if layer["metric_id"] == selected_metric), None)
    latest_release = selected_layer["points"][-1] if selected_layer and selected_layer["points"] else None
    release_dates = sorted({
        date.fromisoformat(point["release_date"])
        for layer in series
        for point in layer["points"]
    })
    history_complete = bool(release_dates) and release_dates[0] <= history_start + timedelta(days=45)
    if years > 3 and not history_complete:
        warnings.append(
            "The persisted USDA archive does not yet cover the full selected window; run the WASDE history backfill."
        )
    return {
        "as_of": now.isoformat(),
        "commodity": {"symbol": symbol, **commodity},
        "commodities": [{"symbol": code, **item} for code, item in COMMODITIES.items()],
        "selected_metric": selected_metric,
        "years": years,
        "history_coverage": {
            "structured_start_date": WASDE_STRUCTURED_START.isoformat(),
            "requested_start_date": history_start.isoformat(),
            "observed_start_date": release_dates[0].isoformat() if release_dates else None,
            "observed_end_date": release_dates[-1].isoformat() if release_dates else None,
            "release_count": len(release_dates),
            "complete": history_complete,
            "source": "USDA WASDE as-reported CSV archive",
        },
        "next_release": next_release,
        "latest_release": latest_release,
        "reports": list(REPORT_CATALOG),
        "schedule": schedule,
        "metrics": [{key: value for key, value in metric.items() if key != "attribute"} for metric in METRICS],
        "series": series,
        "price_history": prices,
        "takeaways": _build_takeaways(series, selected_metric),
        "methodology": {
            "actuals": "USDA WASDE bulk and monthly CSV files from April 2010 forward, preserved as reported on each release date.",
            "expectations": "User-entered only. USDA does not publish market consensus expectations.",
            "standardization": "Each metric uses the z-score of like-market-year release revisions; positive always means price-supportive.",
            "futures": f"Adjusted daily closes for {commodity['ticker']}, rebased to 100 at the start of the selected window.",
            "reaction": "Release-day and five-session returns use the previous trading-day close as the baseline.",
        },
        "warnings": warnings,
    }


def build_calendar_ics(reference: date | None = None) -> str:
    events = build_release_calendar(reference)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Market Diagnostic Dashboard//Agriculture Reports//EN", "CALSCALE:GREGORIAN"]
    stamp = datetime.now(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")
    for event in events:
        starts = datetime.fromisoformat(event["release_at"])
        ends = starts + timedelta(minutes=30)
        uid = f"{event['report_id']}-{starts.strftime('%Y%m%d')}@market-diagnostic-dashboard"
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;TZID=America/New_York:{starts.strftime('%Y%m%dT%H%M%S')}",
            f"DTEND;TZID=America/New_York:{ends.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:USDA {event['report']}",
            f"DESCRIPTION:Release timing confidence: {event['confidence']}. Verify holiday exceptions with the official source.",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def report_desk_supported_symbols() -> set[str]:
    """Expose the supported subset for API validation and contract tests."""
    configured = {item.code for item in AGRICULTURE_SYMBOLS}
    return configured.intersection(COMMODITIES)
