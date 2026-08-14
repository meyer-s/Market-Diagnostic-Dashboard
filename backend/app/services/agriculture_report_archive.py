"""Backfill official release history for every non-WASDE report-desk family."""

from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from time import sleep
from typing import Any, Iterable
from urllib.parse import urljoin

import requests
from lxml import html
from sqlalchemy.orm import Session

from app.models.agriculture_report_release import AgricultureReportRelease
from app.services.agriculture_nass_metrics import parse_nass_release_metrics


REPORT_ARCHIVE_START = date(1900, 1, 1)
HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (agriculture-report-archive)",
    "Accept": "application/json,text/html,*/*",
}
NASS_BASE_URL = "https://esmis.nal.usda.gov"
NASS_ARCHIVES = {
    "crop_production": ("Crop Production", "crop-production"),
    "crop_progress": ("Crop Progress", "crop-progress"),
    "grain_stocks": ("Grain Stocks", "grain-stocks"),
    "acreage": ("Acreage", "acreage"),
}
FAS_API_URL = "https://apps.fas.usda.gov/esrqs/api/reports/WeeklyHistorialReportData"
FAS_SOURCE_URL = "https://apps.fas.usda.gov/esrqs/"
FAS_COMMODITIES = {
    "ZC": (10, "Corn"),
    "ZS": (14, "Soybeans"),
    "ZW": (2, "Soft Red Winter Wheat"),
    "KE": (1, "Hard Red Winter Wheat"),
    "MW": (3, "Hard Red Spring Wheat"),
    "ZO": (12, "Oats"),
    "ZR": (34, "All Rice"),
    "CT": (27, "All Upland Cotton"),
}
FGIS_DATA_URL = "https://agtransport.usda.gov/resource/sruw-w49i.json"
FGIS_SOURCE_URL = "https://agtransport.usda.gov/Exports/Grain-Inspections/sruw-w49i"
FGIS_GRAINS = {
    "ZC": "CORN",
    "ZS": "SOYBEANS",
    "ZW": "WHEAT",
    "KE": "WHEAT",
    "MW": "WHEAT",
    "ZO": "OATS",
}
CFTC_DATA_URL = "https://publicreporting.cftc.gov/resource/srt6-5q2f.json"
CFTC_SOURCE_URL = "https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy_All/srt6-5q2f"
CFTC_MARKETS = {
    "ZC": ("Corn", ("CORN - CHICAGO BOARD OF TRADE",)),
    "ZS": ("Soybeans", ("SOYBEANS - CHICAGO BOARD OF TRADE",)),
    "ZW": (
        "Chicago Wheat",
        ("WHEAT - CHICAGO BOARD OF TRADE", "WHEAT-SRW - CHICAGO BOARD OF TRADE"),
    ),
    "KE": (
        "KC Hard Red Winter Wheat",
        ("WHEAT - KANSAS CITY BOARD OF TRADE", "WHEAT-HRW - CHICAGO BOARD OF TRADE"),
    ),
    "MW": (
        "Minneapolis Spring Wheat",
        (
            "WHEAT - MINNEAPOLIS GRAIN EXCHANGE",
            "WHEAT-HRSpring - MINNEAPOLIS GRAIN EXCHANGE",
            "WHEAT-HRSpring - MIAX FUTURES EXCHANGE",
        ),
    ),
    "ZO": ("Oats", ("OATS - CHICAGO BOARD OF TRADE", "OATS - CBT OATS")),
    "ZR": (
        "Rough Rice",
        (
            "ROUGH RICE - CHICAGO RICE AND COTTON EXCHANGE",
            "ROUGH RICE - MID AMERICA COMMODITY EXCHANGE",
            "ROUGH RICE - MIDAMERICA COMMODITY EXCHANGE",
            "ROUGH RICE - CHICAGO BOARD OF TRADE",
        ),
    ),
    "CT": (
        "Cotton No. 2",
        (
            "COTTON NO. 2 - NEW YORK COTTON EXCHANGE",
            "COTTON NO. 2 - NEW YORK BOARD OF TRADE",
            "COTTON NO. 2 - ICE FUTURES U.S.",
        ),
    ),
    "ZL": (
        "Soybean Oil",
        ("SOYBEAN OIL - CHICAGO BOARD OF TRADE", "SOYBEAN OIL - CBT SOYBEAN OIL"),
    ),
    "ZM": (
        "Soybean Meal",
        ("SOYBEAN MEAL - CHICAGO BOARD OF TRADE", "SOYBEAN MEAL - CBT SOYBEAN MEAL"),
    ),
    "LE": (
        "Live Cattle",
        ("LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE", "LIVE CATTLE - CME LIVE CATTLE"),
    ),
    "GF": (
        "Feeder Cattle",
        ("FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE", "FEEDER CATTLE - CME FEEDER CATTLE"),
    ),
    "HE": (
        "Lean Hogs",
        (
            "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
            "LIVE HOGS - CHICAGO MERCANTILE EXCHANGE",
            "LEAN HOGS - CME LEAN HOG",
        ),
    ),
    "DC": (
        "Class III Milk",
        ("MILK, Class III - CHICAGO MERCANTILE EXCHANGE", "MILK - CHICAGO MERCANTILE EXCHANGE"),
    ),
    "DAIRY_CLASS_IV": (
        "Class IV Milk",
        ("CME MILK IV - CHICAGO MERCANTILE EXCHANGE",),
    ),
    "LBR": (
        "Lumber",
        (
            "LUMBER - CHICAGO MERCANTILE EXCHANGE",
            "RANDOM LENGTH LUMBER - CHICAGO MERCANTILE EXCHANGE",
        ),
    ),
    "KC": (
        "Coffee C",
        (
            "COFFEE C - ICE FUTURES U.S.",
            "COFFEE C - NEW YORK BOARD OF TRADE",
            "COFFEE C - COFFEE SUGAR AND COCOA EXCHANGE",
        ),
    ),
    "CC": (
        "Cocoa",
        (
            "COCOA - ICE FUTURES U.S.",
            "COCOA - NEW YORK BOARD OF TRADE",
            "COCOA - COFFEE SUGAR AND COCOA EXCHANGE",
        ),
    ),
    "SB": (
        "Sugar No. 11",
        (
            "SUGAR NO. 11 - ICE FUTURES U.S.",
            "SUGAR NO. 11 - NEW YORK BOARD OF TRADE",
            "SUGAR NO. 11 - COFFEE SUGAR AND COCOA EXCHANGE",
        ),
    ),
    "OJ": (
        "Frozen Concentrated Orange Juice",
        (
            "FRZN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
            "FRZN CONCENTRATED ORANGE JUICE - NEW YORK BOARD OF TRADE",
        ),
    ),
    "RS": ("Canola", ("CANOLA - ICE FUTURES U.S.",)),
}


def _get(url: str, *, params: dict[str, Any] | None = None, timeout: int = 60) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            response = requests.get(url, params=params, headers=HTTP_HEADERS, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 3:
                sleep(0.5 * (2 ** attempt))
    assert last_error is not None
    raise last_error


def _as_number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _display_number(value: float) -> int | float:
    return int(value) if value.is_integer() else round(value, 3)


def _metric(metric_id: str, label: str, value: float, unit: str) -> dict[str, Any]:
    return {
        "id": metric_id,
        "label": label,
        "value": _display_number(value),
        "unit": unit,
    }


def _parse_nass_page(report_id: str, report_name: str, slug: str, content: bytes) -> list[dict[str, Any]]:
    root = html.fromstring(content)
    releases: list[dict[str, Any]] = []
    for row in root.xpath("//tbody/tr"):
        detail_links = row.xpath(f'.//a[contains(@href, "/publication/{slug}/")]/@href')
        if not detail_links:
            continue
        detail_url = urljoin(NASS_BASE_URL, detail_links[-1])
        try:
            release_date = date.fromisoformat(detail_url.rstrip("/").rsplit("/", 1)[-1])
        except ValueError:
            continue
        documents: list[dict[str, str]] = []
        for href in row.xpath('.//a[contains(@href, "/release-files/")]/@href'):
            extension = href.rsplit(".", 1)[-1].lower() if "." in href else "file"
            documents.append({"label": extension.upper(), "format": extension, "url": urljoin(NASS_BASE_URL, href)})
        releases.append({
            "report_id": report_id,
            "scope_key": "ALL",
            "release_date": release_date,
            "title": _portable_nass_title(report_name, release_date),
            "source_url": detail_url,
            "documents": documents,
            "metrics": [],
        })
    return releases


def _portable_nass_title(report_name: str, released: date) -> str:
    return f"{report_name} release"


def collect_nass_releases(
    report_id: str,
    report_name: str,
    slug: str,
    *,
    since: date,
    through: date,
    max_workers: int = 8,
) -> list[dict[str, Any]]:
    source_url = f"{NASS_BASE_URL}/publication/{slug}"
    first = _get(source_url, timeout=45)
    root = html.fromstring(first.content)
    last_links = root.xpath('//a[normalize-space()="Last"]/@href')
    last_page = int(last_links[-1].split("page=")[-1]) if last_links else 0
    page_content: dict[int, bytes] = {0: first.content}
    if last_page:
        with ThreadPoolExecutor(max_workers=max(1, min(max_workers, 12))) as executor:
            futures = {
                executor.submit(_get, source_url, params={"page": page}, timeout=45): page
                for page in range(1, last_page + 1)
            }
            for future in as_completed(futures):
                page_content[futures[future]] = future.result().content
    releases: list[dict[str, Any]] = []
    for page in range(last_page + 1):
        for release in _parse_nass_page(report_id, report_name, slug, page_content[page]):
            if since <= release["release_date"] <= through:
                release["title"] = _portable_nass_title(report_name, release["release_date"])
                releases.append(release)
    return releases


def collect_nass_metric_releases(
    releases: Iterable[dict[str, Any]],
    *,
    max_workers: int = 8,
) -> list[dict[str, Any]]:
    """Download NASS TXT documents and create commodity-scoped metric rows."""
    materialized = list(releases)
    jobs: dict[Any, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, 12))) as executor:
        for release in materialized:
            text_document = next(
                (document for document in release.get("documents", []) if document.get("format") == "txt"),
                None,
            )
            if text_document:
                jobs[executor.submit(_get, text_document["url"], timeout=60)] = release

        enriched: list[dict[str, Any]] = []
        for future in as_completed(jobs):
            release = jobs[future]
            response = future.result()
            text = response.content.decode(response.encoding or "utf-8", errors="replace")
            for scope_key, metrics in parse_nass_release_metrics(release["report_id"], text).items():
                enriched.append({
                    **release,
                    "scope_key": scope_key,
                    "metrics": metrics,
                })
    return enriched


def collect_export_sales_releases(*, since: date, through: date) -> list[dict[str, Any]]:
    releases: list[dict[str, Any]] = []
    for scope_key, (commodity_id, commodity_name) in FAS_COMMODITIES.items():
        rows = _get(
            FAS_API_URL,
            params={"WeekEndingDate": through.strftime("%m/%d/%Y"), "CommodityId": commodity_id},
            timeout=120,
        ).json()
        grouped: dict[date, dict[str, Any]] = {}
        for row in rows:
            try:
                released = date.fromisoformat(str(row.get("weekEndingDate", ""))[:10])
            except ValueError:
                continue
            if not since <= released <= through:
                continue
            aggregate = grouped.setdefault(released, {
                "weeklyExport": 0.0,
                "netSales": 0.0,
                "outstandingSales": 0.0,
                "accumulatedExport": 0.0,
                "marketingYears": set(),
            })
            for key in ("weeklyExport", "netSales", "outstandingSales", "accumulatedExport"):
                aggregate[key] += _as_number(row.get(key))
            if row.get("myDefinition"):
                aggregate["marketingYears"].add(str(row["myDefinition"]))
        unit = "Running Bales" if scope_key == "CT" else "Metric Tons"
        for released, aggregate in grouped.items():
            releases.append({
                "report_id": "export_sales",
                "scope_key": scope_key,
                "release_date": released,
                "title": f"Weekly Export Sales — {commodity_name} (week ending)",
                "source_url": FAS_SOURCE_URL,
                "documents": [{"label": "FAS data", "format": "dataset", "url": FAS_SOURCE_URL}],
                "metrics": [
                    _metric("net_sales", "Net sales", aggregate["netSales"], unit),
                    _metric("weekly_exports", "Weekly exports", aggregate["weeklyExport"], unit),
                    _metric("outstanding_sales", "Outstanding sales", aggregate["outstandingSales"], unit),
                    _metric("accumulated_exports", "Accumulated exports", aggregate["accumulatedExport"], unit),
                ],
            })
    return releases


def collect_export_inspection_releases(*, since: date, through: date) -> list[dict[str, Any]]:
    rows = _get(
        FGIS_DATA_URL,
        params={
            "$select": "date,grain,sum(mt) as metric_tons",
            "$where": f"date >= '{since.isoformat()}T00:00:00.000' AND date <= '{through.isoformat()}T23:59:59.999'",
            "$group": "date,grain",
            "$order": "date",
            "$limit": 50000,
        },
        timeout=120,
    ).json()
    by_grain: dict[tuple[date, str], float] = defaultdict(float)
    all_grains: dict[date, float] = defaultdict(float)
    for row in rows:
        try:
            released = date.fromisoformat(str(row.get("date", ""))[:10])
        except ValueError:
            continue
        grain = str(row.get("grain", "")).upper()
        volume = _as_number(row.get("metric_tons"))
        by_grain[(released, grain)] += volume
        all_grains[released] += volume
    releases: list[dict[str, Any]] = []
    for scope_key, grain in FGIS_GRAINS.items():
        for (released, row_grain), volume in by_grain.items():
            if row_grain != grain:
                continue
            releases.append({
                "report_id": "export_inspections",
                "scope_key": scope_key,
                "release_date": released,
                "title": f"Grain Export Inspections — {grain.title()} (week ending)",
                "source_url": FGIS_SOURCE_URL,
                "documents": [{"label": "FGIS data", "format": "dataset", "url": FGIS_SOURCE_URL}],
                "metrics": [_metric("inspected_volume", "Inspected volume", volume, "Metric Tons")],
            })
    for released, volume in all_grains.items():
        releases.append({
            "report_id": "export_inspections",
            "scope_key": "ALL",
            "release_date": released,
            "title": "Grain Export Inspections — All covered grains (week ending)",
            "source_url": FGIS_SOURCE_URL,
            "documents": [{"label": "FGIS data", "format": "dataset", "url": FGIS_SOURCE_URL}],
            "metrics": [_metric("inspected_volume", "Total inspected volume", volume, "Metric Tons")],
        })
    return releases


def _socrata_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def collect_cot_releases(*, since: date, through: date) -> list[dict[str, Any]]:
    releases: list[dict[str, Any]] = []
    select = ",".join((
        "report_date_as_yyyy_mm_dd",
        "market_and_exchange_names",
        "open_interest_all",
        "noncomm_positions_long_all",
        "noncomm_positions_short_all",
        "comm_positions_long_all",
        "comm_positions_short_all",
    ))
    for scope_key, (commodity_name, markets) in CFTC_MARKETS.items():
        market_list = ",".join(_socrata_literal(market) for market in markets)
        rows = _get(
            CFTC_DATA_URL,
            params={
                "$select": select,
                "$where": (
                    "futonly_or_combined='FutOnly' "
                    f"AND report_date_as_yyyy_mm_dd >= '{since.isoformat()}T00:00:00.000' "
                    f"AND report_date_as_yyyy_mm_dd <= '{through.isoformat()}T23:59:59.999' "
                    f"AND market_and_exchange_names in({market_list})"
                ),
                "$order": "report_date_as_yyyy_mm_dd",
                "$limit": 10000,
            },
            timeout=120,
        ).json()
        grouped: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for row in rows:
            try:
                released = date.fromisoformat(str(row.get("report_date_as_yyyy_mm_dd", ""))[:10])
            except ValueError:
                continue
            for key in (
                "open_interest_all",
                "noncomm_positions_long_all",
                "noncomm_positions_short_all",
                "comm_positions_long_all",
                "comm_positions_short_all",
            ):
                grouped[released][key] += _as_number(row.get(key))
        for released, values in grouped.items():
            noncommercial_net = values["noncomm_positions_long_all"] - values["noncomm_positions_short_all"]
            commercial_net = values["comm_positions_long_all"] - values["comm_positions_short_all"]
            releases.append({
                "report_id": "cot",
                "scope_key": scope_key,
                "release_date": released,
                "title": f"Legacy COT Futures Only — {commodity_name} (positions as of)",
                "source_url": CFTC_SOURCE_URL,
                "documents": [{"label": "CFTC data", "format": "dataset", "url": CFTC_SOURCE_URL}],
                "metrics": [
                    _metric("noncommercial_net", "Noncommercial net", noncommercial_net, "Contracts"),
                    _metric("noncommercial_long", "Noncommercial long", values["noncomm_positions_long_all"], "Contracts"),
                    _metric("noncommercial_short", "Noncommercial short", values["noncomm_positions_short_all"], "Contracts"),
                    _metric("open_interest", "Open interest", values["open_interest_all"], "Contracts"),
                    _metric("commercial_net", "Commercial net", commercial_net, "Contracts"),
                ],
            })
    return releases


def collect_report_releases(
    *,
    since: date = REPORT_ARCHIVE_START,
    through: date | None = None,
    max_workers: int = 8,
    report_ids: Iterable[str] | None = None,
    nass_metrics_since: date | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    through = through or date.today()
    selected = set(report_ids or (*NASS_ARCHIVES, "export_sales", "export_inspections", "cot"))
    releases: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for report_id, (report_name, slug) in NASS_ARCHIVES.items():
        if report_id not in selected:
            continue
        rows = collect_nass_releases(
            report_id,
            report_name,
            slug,
            since=since,
            through=through,
            max_workers=max_workers,
        )
        releases.extend(rows)
        counts[report_id] = len(rows)
        if nass_metrics_since is not None:
            metric_rows = collect_nass_metric_releases(
                [row for row in rows if row["release_date"] >= nass_metrics_since],
                max_workers=max_workers,
            )
            releases.extend(metric_rows)
            counts[f"{report_id}_metric_rows"] = len(metric_rows)
    collectors = {
        "export_sales": collect_export_sales_releases,
        "export_inspections": collect_export_inspection_releases,
        "cot": collect_cot_releases,
    }
    for report_id, collector in collectors.items():
        if report_id not in selected:
            continue
        rows = collector(since=since, through=through)
        releases.extend(rows)
        counts[report_id] = len(rows)
    return releases, counts


def persist_report_releases(
    db: Session,
    releases: Iterable[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> dict[str, int]:
    materialized = list(releases)
    existing = {
        (row.report_id, row.scope_key, row.release_date): row
        for row in db.query(AgricultureReportRelease).all()
    }
    inserted = updated = unchanged = 0
    for release in materialized:
        key = (release["report_id"], release["scope_key"], release["release_date"])
        stored = existing.get(key)
        if stored is None:
            inserted += 1
            if not dry_run:
                stored = AgricultureReportRelease(**release)
                db.add(stored)
                existing[key] = stored
            continue
        changed = any(
            getattr(stored, field) != release[field]
            for field in ("title", "source_url", "documents", "metrics")
        )
        if not changed:
            unchanged += 1
            continue
        updated += 1
        if not dry_run:
            for field in ("title", "source_url", "documents", "metrics"):
                setattr(stored, field, release[field])
            stored.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return {
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "total": len(materialized),
    }


def backfill_report_releases(
    db: Session,
    *,
    since: date = REPORT_ARCHIVE_START,
    through: date | None = None,
    max_workers: int = 8,
    report_ids: Iterable[str] | None = None,
    nass_metrics_since: date | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    through = through or date.today()
    releases, counts = collect_report_releases(
        since=since,
        through=through,
        max_workers=max_workers,
        report_ids=report_ids,
        nass_metrics_since=nass_metrics_since,
    )
    result = persist_report_releases(db, releases, dry_run=dry_run)
    return {
        **result,
        "since": since.isoformat(),
        "through": through.isoformat(),
        "dry_run": dry_run,
        "reports": counts,
        "nass_metrics_since": nass_metrics_since.isoformat() if nass_metrics_since else None,
    }
