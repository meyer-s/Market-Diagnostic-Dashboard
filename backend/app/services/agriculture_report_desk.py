"""Official-source agriculture report desk.

USDA's monthly, as-reported WASDE CSV files power standardized chart layers.
Every other report family is backed by persisted official release history, with
numeric weekly snapshots where the publishing agency exposes a public dataset.
Market expectations remain user-entered: USDA does not publish consensus data.
"""

from __future__ import annotations

import csv
import io
import zipfile
from bisect import bisect_left
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from math import sqrt
from pathlib import Path
from statistics import mean, pstdev
from threading import Lock
from time import sleep
from typing import Any, Iterable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.exc import SQLAlchemyError

from app.core.db import SessionLocal
from app.models.agriculture_report_release import AgricultureReportRelease
from app.models.agriculture_wasde_observation import AgricultureWasdeObservation
from app.services.agriculture_report_archive import NASS_ARCHIVES, REPORT_ARCHIVE_START
from app.services.agriculture_index import AGRICULTURE_SYMBOLS, GROUP_LABELS
from app.services.ingestion.yahoo_client import YahooClient


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


_FULL_CROP_REPORTS = (
    "wasde", "crop_production", "crop_progress", "export_sales",
    "export_inspections", "grain_stocks", "acreage", "cot",
)
_RICE_REPORTS = (
    "wasde", "crop_production", "crop_progress", "export_sales",
    "grain_stocks", "acreage", "cot",
)
_COTTON_REPORTS = (
    "wasde", "crop_production", "crop_progress", "export_sales", "acreage", "cot",
)
_WASDE_AND_COT = ("wasde", "cot")
_COT_ONLY = ("cot",)
_SOY_COMPLEX_SCOPES = {
    "crop_production": "ZS",
    "crop_progress": "ZS",
    "export_sales": "ZS",
    "export_inspections": "ZS",
    "grain_stocks": "ZS",
    "acreage": "ZS",
}


COMMODITIES: dict[str, dict[str, Any]] = {
    "ZS": {"name": "Soybeans", "usda": "Oilseed, Soybean", "ticker": "ZS=F", "tickers": ("ZS=F",), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "ZC": {"name": "Corn", "usda": "Corn", "ticker": "ZC=F", "tickers": ("ZC=F",), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "ZW": {"name": "Chicago Wheat", "usda": "Wheat", "ticker": "ZW=F", "tickers": ("ZW=F",), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "KE": {"name": "KC Hard Red Winter Wheat", "usda": "Wheat", "ticker": "KE=F", "tickers": ("KE=F", "KW=F"), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "MW": {"name": "Minneapolis Spring Wheat", "usda": "Wheat", "ticker": "MWE=F", "tickers": ("MWE=F", "MW=F"), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "ZL": {"name": "Soybean Oil", "usda": "Oil, Soybean", "ticker": "ZL=F", "tickers": ("ZL=F",), "price_unit": "cents per pound", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS, "report_scopes": _SOY_COMPLEX_SCOPES},
    "ZM": {"name": "Soybean Meal", "usda": "Meal, Soybean", "ticker": "ZM=F", "tickers": ("ZM=F",), "price_unit": "dollars per short ton", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS, "report_scopes": _SOY_COMPLEX_SCOPES},
    "ZO": {"name": "Oats", "usda": "Oats", "ticker": "ZO=F", "tickers": ("ZO=F",), "price_unit": "cents per bushel", "group": "grains_oilseeds", "report_ids": _FULL_CROP_REPORTS},
    "ZR": {"name": "Rough Rice", "usda": "Rice", "ticker": "ZR=F", "tickers": ("ZR=F",), "price_unit": "dollars per hundredweight", "group": "grains_oilseeds", "report_ids": _RICE_REPORTS},
    "LE": {"name": "Live Cattle", "usda": "Beef", "ticker": "LE=F", "tickers": ("LE=F",), "price_unit": "cents per pound", "group": "livestock", "report_ids": _WASDE_AND_COT},
    "GF": {"name": "Feeder Cattle", "usda": "Beef", "ticker": "GF=F", "tickers": ("GF=F",), "price_unit": "cents per pound", "group": "livestock", "report_ids": _WASDE_AND_COT},
    "HE": {"name": "Lean Hogs", "usda": "Pork", "ticker": "HE=F", "tickers": ("HE=F",), "price_unit": "cents per pound", "group": "livestock", "report_ids": _WASDE_AND_COT},
    "DC": {"name": "Class III Milk", "usda": "Milk, Class III", "ticker": "DC=F", "tickers": ("DC=F",), "price_unit": "dollars per hundredweight", "group": "dairy", "report_ids": _WASDE_AND_COT},
    "DAIRY_CLASS_IV": {"name": "Class IV Milk", "usda": "Milk, Class IV", "ticker": "GDK=F", "tickers": ("GDK=F",), "price_unit": "dollars per hundredweight", "group": "dairy", "report_ids": _WASDE_AND_COT},
    "LBR": {"name": "Lumber", "usda": "", "ticker": "LBR=F", "tickers": ("LBR=F",), "price_unit": "dollars per thousand board feet", "group": "lumber", "report_ids": _COT_ONLY},
    "KC": {"name": "Coffee", "usda": "", "ticker": "KC=F", "tickers": ("KC=F",), "price_unit": "cents per pound", "group": "softs", "report_ids": _COT_ONLY},
    "CC": {"name": "Cocoa", "usda": "", "ticker": "CC=F", "tickers": ("CC=F",), "price_unit": "dollars per metric ton", "group": "softs", "report_ids": _COT_ONLY},
    "SB": {"name": "Sugar", "usda": "Sugar", "ticker": "SB=F", "tickers": ("SB=F",), "price_unit": "cents per pound", "group": "softs", "report_ids": _WASDE_AND_COT},
    "CT": {"name": "Cotton", "usda": "Cotton", "ticker": "CT=F", "tickers": ("CT=F",), "price_unit": "cents per pound", "group": "softs", "report_ids": _COTTON_REPORTS},
    "OJ": {"name": "Orange Juice", "usda": "", "ticker": "OJ=F", "tickers": ("OJ=F",), "price_unit": "cents per pound", "group": "softs", "report_ids": _COT_ONLY},
    "RS": {"name": "Canola", "usda": "", "ticker": "RS=F", "tickers": ("RS=F",), "price_unit": "Canadian dollars per metric tonne", "group": "softs", "report_ids": _COT_ONLY},
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
    {
        "id": "price_forecast",
        "label": "Price forecast",
        "attribute": ("Prices",),
        "orientation": 1,
        "bullish_when": "higher than the prior estimate",
    },
)


def _report_ids_for(symbol: str) -> tuple[str, ...]:
    return tuple(COMMODITIES[symbol]["report_ids"])


def _report_scope_for(symbol: str, report_id: str) -> str:
    return str(COMMODITIES[symbol].get("report_scopes", {}).get(report_id, symbol))


def _public_commodity(symbol: str, commodity: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "name": commodity["name"],
        "usda": commodity["usda"],
        "ticker": commodity["ticker"],
        "price_unit": commodity["price_unit"],
        "group": commodity["group"],
        "group_label": GROUP_LABELS[commodity["group"]],
        "report_count": len(commodity["report_ids"]),
    }


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
        "coverage": "history_ready",
        "coverage_label": "Release history",
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
        "coverage": "history_ready",
        "coverage_label": "Release history",
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
        "coverage": "history_ready",
        "coverage_label": "Weekly history",
        "description": "Weekly export commitments, shipments, and outstanding sales by commodity and destination.",
        "source_url": "https://www.fas.usda.gov/data/scheduled-reports",
        "archive_url": "https://apps.fas.usda.gov/esrqs/",
    },
    {
        "id": "export_inspections",
        "name": "Export Inspections",
        "agency": "USDA AMS/FGIS",
        "cadence": "Weekly",
        "release_time": "11:00 ET",
        "coverage": "history_ready",
        "coverage_label": "Weekly history",
        "description": "Inspected export volume and marketing-year pace for major grains and oilseeds.",
        "source_url": "https://agtransport.usda.gov/Exports/Grain-Inspections/sruw-w49i",
        "archive_url": "https://agtransport.usda.gov/Exports/Grain-Inspections/sruw-w49i",
    },
    {
        "id": "grain_stocks",
        "name": "Grain Stocks",
        "agency": "USDA NASS",
        "cadence": "Quarterly",
        "release_time": "12:00 ET",
        "coverage": "history_ready",
        "coverage_label": "Release history",
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
        "coverage": "history_ready",
        "coverage_label": "Release history",
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
        "coverage": "history_ready",
        "coverage_label": "Position history",
        "description": "Tuesday futures positioning published Friday, including commercial and managed-money cohorts.",
        "source_url": "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
        "archive_url": "https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy_All/srt6-5q2f",
    },
)

REPORT_IMPACT_DEFINITIONS: dict[str, dict[str, Any]] = {
    "wasde": {"channel": "Balance sheet", "half_life_days": 45},
    "crop_production": {"channel": "Supply", "half_life_days": 45},
    "crop_progress": {"channel": "Supply", "half_life_days": 14},
    "export_sales": {"channel": "Demand", "half_life_days": 14},
    "export_inspections": {"channel": "Demand", "half_life_days": 14},
    "grain_stocks": {"channel": "Balance sheet", "half_life_days": 120},
    "acreage": {"channel": "Supply", "half_life_days": 400},
    "cot": {"channel": "Positioning", "half_life_days": 14},
}

REPORT_RELATIONSHIPS: tuple[dict[str, str], ...] = (
    {"source_report_id": "acreage", "target_report_id": "crop_production", "kind": "sets the planted base for"},
    {"source_report_id": "crop_progress", "target_report_id": "crop_production", "kind": "leads the yield read in"},
    {"source_report_id": "crop_production", "target_report_id": "wasde", "kind": "feeds the supply side of"},
    {"source_report_id": "grain_stocks", "target_report_id": "wasde", "kind": "checks implied disappearance in"},
    {"source_report_id": "export_sales", "target_report_id": "export_inspections", "kind": "precedes physical shipments in"},
    {"source_report_id": "export_inspections", "target_report_id": "wasde", "kind": "tests the export assumptions in"},
    {"source_report_id": "cot", "target_report_id": "wasde", "kind": "shows whether positioning confirms"},
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


def _report_history_start(years: int, reference: date) -> date:
    return max(REPORT_ARCHIVE_START, reference - timedelta(days=years * 366))


def _empty_report_history(report_id: str, requested_start: date) -> dict[str, Any]:
    return {
        "report_id": report_id,
        "scope_key": None,
        "scope_label": None,
        "requested_start_date": requested_start.isoformat(),
        "observed_start_date": None,
        "observed_end_date": None,
        "release_count": 0,
        "returned_count": 0,
        "truncated": False,
        "releases": [],
        "analysis": None,
    }


def _metric_by_id(release: dict[str, Any], metric_id: str) -> dict[str, Any] | None:
    return next((metric for metric in release.get("metrics", []) if metric.get("id") == metric_id), None)


def _metric_releases(releases: list[dict[str, Any]], metric_id: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [
        (release, metric)
        for release in releases
        if (metric := _metric_by_id(release, metric_id)) is not None
    ]


def _pct_change(current: float, comparison: float | None) -> float | None:
    if comparison in (None, 0):
        return None
    return round((current / comparison - 1) * 100, 1)


def _change_phrase(value: float | None, comparison: str) -> str:
    if value is None:
        return f"no usable {comparison} comparison"
    if abs(value) < 0.05:
        return f"unchanged from {comparison}"
    return f"{abs(value):.1f}% {'above' if value > 0 else 'below'} {comparison}"


def _raw_change_phrase(value: float, comparison: str) -> str:
    if abs(value) < 0.5:
        return f"in line with {comparison}"
    return f"{abs(value):,.0f} {'above' if value > 0 else 'below'} {comparison}"


def _build_report_history_analysis(
    report_id: str,
    releases: list[dict[str, Any]],
    commodity_name: str,
) -> dict[str, Any] | None:
    definitions = {
        "crop_production": ("production", "production_trend", "Production estimate history", "Published national production estimates"),
        "crop_progress": ("condition_good_excellent", "progress_benchmark", "Field progress and condition", "Current reading against USDA's own benchmarks"),
        "export_sales": ("net_sales", "sales_flow", "Export demand flow", "Net sales and weekly exports by report week"),
        "export_inspections": ("inspected_volume", "inspection_pace", "Physical export inspection pace", "Weekly inspected volume with a four-week baseline"),
        "grain_stocks": ("total_stocks", "stocks_composition", "Inventory checkpoint", "Total stocks and the on-farm/off-farm split"),
        "acreage": ("planted_area", "acreage_comparison", "Acreage footprint", "Current planted area against the prior-year estimate"),
        "cot": ("noncommercial_net", "positioning_balance", "Speculative positioning", "Noncommercial net position and open interest"),
    }
    primary_id, chart_kind, title, subtitle = definitions[report_id]
    observations = _metric_releases(releases, primary_id)
    if report_id == "crop_progress" and not observations:
        progress_ids = [
            metric["id"]
            for release in releases
            for metric in release.get("metrics", [])
            if str(metric.get("id", "")).startswith("progress_")
        ]
        if progress_ids:
            primary_id = progress_ids[0]
            observations = _metric_releases(releases, primary_id)
    if not observations:
        return None

    latest_release, latest_metric = observations[0]
    latest_value = float(latest_metric["value"])
    previous_value = float(observations[1][1]["value"]) if len(observations) > 1 else None
    rolling_values = [float(metric["value"]) for _, metric in observations[1:5]]
    four_week_average = round(mean(rolling_values), 3) if rolling_values else None
    latest_label = latest_metric.get("label", primary_id)
    unit = latest_metric.get("unit", "")
    comparison_text = _change_phrase(_pct_change(latest_value, previous_value), "the previous release")
    headline = f"{latest_label}: {latest_value:,.1f} {unit.lower()}"
    body = f"The latest {commodity_name} reading is {comparison_text}."
    basis = "Release-to-release comparison"

    if report_id == "crop_production":
        yoy = _metric_by_id(latest_release, "production_yoy_pct")
        if yoy:
            yoy_value = float(yoy["value"])
            body = (
                f"USDA's latest national estimate is {abs(yoy_value):.1f}% "
                f"{'above' if yoy_value > 0 else 'below'} the year-ago crop, and {comparison_text}."
            )
            basis = "USDA's rounded year-over-year change plus the prior published estimate"
    elif report_id == "crop_progress":
        prior_week = latest_metric.get("previous_week")
        prior_year = latest_metric.get("previous_year")
        average = latest_metric.get("five_year_average")
        comparisons = []
        if prior_week is not None:
            comparisons.append(f"{latest_value - float(prior_week):+.0f} points week over week")
        if average is not None:
            comparisons.append(f"{latest_value - float(average):+.0f} points versus the five-year average")
        elif prior_year is not None:
            comparisons.append(f"{latest_value - float(prior_year):+.0f} points versus last year")
        body = f"USDA reports {latest_value:.0f}% for {latest_label.lower()}"
        body += f", {' and '.join(comparisons)}." if comparisons else "."
        basis = "USDA current, prior-week, prior-year, and five-year benchmarks where published"
    elif report_id == "export_sales":
        average_delta = latest_value - four_week_average if four_week_average is not None else None
        previous_delta = latest_value - previous_value if previous_value is not None else None
        body = f"Net sales are {latest_value:,.0f} {unit.lower()}"
        if average_delta is not None:
            body += f", {_raw_change_phrase(average_delta, 'the prior four-report average')}"
        if previous_delta is not None:
            body += f", and {_raw_change_phrase(previous_delta, 'the previous report')}"
        body += "."
        basis = "Previous report and prior four-report average"
    elif report_id == "export_inspections":
        rolling_change = _pct_change(latest_value, four_week_average)
        body = f"The latest {commodity_name} physical inspection pace is {_change_phrase(rolling_change, 'the prior four-report average')} and {comparison_text}."
        basis = "Previous report and prior four-report average"
    elif report_id == "grain_stocks":
        yoy = _metric_by_id(latest_release, "total_stocks_yoy_pct")
        if yoy:
            yoy_value = float(yoy["value"])
            body = (
                f"Reported stocks are {abs(yoy_value):.1f}% {'above' if yoy_value > 0 else 'below'} "
                "the comparable year-ago checkpoint, indicating a larger inventory cushion."
                if yoy_value > 0
                else f"Reported stocks are {abs(yoy_value):.1f}% below the comparable year-ago checkpoint, indicating a smaller inventory cushion."
            )
            basis = "USDA's rounded change from the comparable year-ago stock date"
    elif report_id == "acreage":
        yoy = _metric_by_id(latest_release, "planted_area_yoy_pct")
        if yoy:
            yoy_value = float(yoy["value"])
            body = (
                f"Planted area is {abs(yoy_value):.1f}% {'above' if yoy_value > 0 else 'below'} last year, "
                f"so the planted supply footprint has {'expanded' if yoy_value > 0 else 'contracted'}."
            )
            basis = "USDA's rounded change from prior-year planted area"
    elif report_id == "cot":
        direction = "net long" if latest_value > 0 else "net short" if latest_value < 0 else "neutral"
        delta = latest_value - previous_value if previous_value is not None else None
        body = f"Noncommercial traders are {direction} {abs(latest_value):,.0f} contracts"
        body += f", with net positioning moving {delta:+,.0f} contracts from the prior report." if delta is not None else "."
        basis = "Tuesday positions versus the previous CFTC report"

    return {
        "chart_kind": chart_kind,
        "title": title,
        "subtitle": subtitle,
        "primary_metric_id": primary_id,
        "latest_release_date": latest_release["release_date"],
        "latest_value": latest_value,
        "previous_value": previous_value,
        "four_report_average": four_week_average,
        "unit": unit,
        "headline": headline,
        "body": body,
        "comparison_basis": basis,
    }


def _load_report_histories(
    symbol: str,
    years: int,
    reference: date,
    *,
    release_limit: int = 160,
) -> dict[str, dict[str, Any]]:
    requested_start = _report_history_start(years, reference)
    report_ids = [report_id for report_id in _report_ids_for(symbol) if report_id != "wasde"]
    histories = {report_id: _empty_report_history(report_id, requested_start) for report_id in report_ids}
    source_scopes = {_report_scope_for(symbol, report_id) for report_id in report_ids}
    db = SessionLocal()
    try:
        rows = (
            db.query(AgricultureReportRelease)
            .filter(
                AgricultureReportRelease.report_id.in_(report_ids),
                AgricultureReportRelease.scope_key.in_((*source_scopes, "ALL")),
                AgricultureReportRelease.release_date >= requested_start,
                AgricultureReportRelease.release_date <= reference,
            )
            .order_by(AgricultureReportRelease.release_date.asc())
            .all()
        )
    except SQLAlchemyError:
        db.rollback()
        return histories
    finally:
        db.close()

    grouped: dict[tuple[str, str], list[AgricultureReportRelease]] = {}
    for row in rows:
        grouped.setdefault((row.report_id, row.scope_key), []).append(row)
    for report_id in report_ids:
        source_scope = _report_scope_for(symbol, report_id)
        direct = grouped.get((report_id, source_scope), [])
        universal = grouped.get((report_id, "ALL"), [])
        # NASS source documents are universal report releases. Commodity-scoped
        # rows enrich those same dates with parsed national metrics; they should
        # not shorten the visible archive to only the metric-enriched period.
        merge_scoped_metrics = report_id in NASS_ARCHIVES and bool(universal)
        selected = universal if merge_scoped_metrics else (direct or universal)
        if not selected:
            continue
        scope_key = source_scope if direct else "ALL"
        if direct:
            metric_scope_name = COMMODITIES[source_scope]["name"]
            if report_id in {"grain_stocks", "export_inspections"} and source_scope in {"ZW", "KE", "MW"}:
                metric_scope_name = "All wheat"
            elif report_id == "crop_progress" and source_scope in {"ZW", "KE"}:
                metric_scope_name = "Winter wheat"
            elif report_id == "crop_progress" and source_scope == "MW":
                metric_scope_name = "Spring wheat"
            if source_scope != symbol:
                metric_scope_name = f"{metric_scope_name} underlying-crop metrics for {COMMODITIES[symbol]['name']}"
            scope_label = (
                f"{metric_scope_name} metrics · full release archive"
                if merge_scoped_metrics
                else metric_scope_name
            )
        elif report_id == "export_inspections":
            scope_label = "All covered grains"
        else:
            scope_label = "All published releases"
        returned = list(reversed(selected[-release_limit:]))
        direct_by_date = {row.release_date: row for row in direct} if merge_scoped_metrics else {}
        serialized_releases = [
            {
                "release_date": row.release_date.isoformat(),
                "title": row.title,
                "source_url": row.source_url,
                "documents": row.documents or [],
                "metrics": (
                    direct_by_date[row.release_date].metrics
                    if row.release_date in direct_by_date
                    else row.metrics or []
                ),
            }
            for row in returned
        ]
        histories[report_id] = {
            "report_id": report_id,
            "scope_key": scope_key,
            "scope_label": scope_label,
            "requested_start_date": requested_start.isoformat(),
            "observed_start_date": selected[0].release_date.isoformat(),
            "observed_end_date": selected[-1].release_date.isoformat(),
            "release_count": len(selected),
            "returned_count": len(returned),
            "truncated": len(selected) > len(returned),
            "releases": serialized_releases,
            "analysis": _build_report_history_analysis(
                report_id,
                serialized_releases,
                scope_label,
            ),
        }
    return histories


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
        if item["usda"]
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
    source_dir: Path | None = None,
) -> dict[str, Any]:
    local_path = source_dir / Path(urlparse(source.url).path).name if source_dir else None
    loaded_from_local = bool(local_path and local_path.is_file())
    if loaded_from_local and local_path is not None:
        content = local_path.read_bytes()
    else:
        response = None
        for attempt in range(3):
            try:
                response = requests.get(source.url, headers=HTTP_HEADERS, timeout=60)
                if response.status_code == 404 and not source.required:
                    return {
                        "source": source,
                        "missing": True,
                        "loaded_from_local": False,
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
        content = response.content

    if source.kind == "bulk_zip":
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
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
        text_stream = io.StringIO(content.decode("utf-8-sig"))
        observations, rows_scanned = _select_backfill_observations(
            csv.DictReader(text_stream),
            source_url=source.url,
            since=since,
            through=through,
        )
    return {
        "source": source,
        "missing": False,
        "loaded_from_local": loaded_from_local,
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
    source_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Import every supported chart observation from the official USDA archive."""
    through = through or datetime.now(EASTERN).date()
    since = max(since, WASDE_STRUCTURED_START)
    if through < since:
        raise ValueError("through must be on or after the structured WASDE start date")
    local_source_dir = Path(source_dir) if source_dir else None
    if local_source_dir is not None and not local_source_dir.is_dir():
        raise ValueError(f"source_dir is not a directory: {local_source_dir}")
    sources = _wasde_archive_sources(since, through)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, 8))) as executor:
        futures = {
            executor.submit(
                _download_backfill_source,
                source,
                since=since,
                through=through,
                source_dir=local_source_dir,
            ): source
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
        "local_sources_loaded": sum(1 for result in results if result["loaded_from_local"]),
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


def _price_history(tickers: str | Iterable[str], start: date, end: date) -> tuple[list[dict[str, Any]], list[str]]:
    attempted = (tickers,) if isinstance(tickers, str) else tuple(tickers)
    errors: list[str] = []
    for ticker in attempted:
        try:
            rows = YahooClient().fetch_series(
                ticker,
                start_date=(start - timedelta(days=10)).isoformat(),
                end_date=(end + timedelta(days=8)).isoformat(),
            )
        except Exception as exc:
            errors.append(str(exc))
            continue
        clean = [row for row in rows if row.get("value") is not None]
        if not clean:
            continue
        base = float(clean[0]["value"])
        for row in clean:
            row.setdefault("ticker", ticker)
            row["rebased"] = round(float(row["value"]) / base * 100, 4) if base else None
        return clean, []
    detail = f": {errors[-1]}" if errors else "."
    return [], [f"Futures history returned no usable daily closes for {', '.join(attempted)}{detail}"]


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


def _effective_price_event_date(report_id: str, observation_date: date) -> date:
    """Map period-ending datasets to the session when traders received them."""
    offsets = {
        "export_sales": 7,  # FAS week ending Thursday, published the following Thursday.
        "export_inspections": 4,  # FGIS week ending Thursday, published Monday.
        "cot": 3,  # Tuesday positions, published Friday.
    }
    return observation_date + timedelta(days=offsets.get(report_id, 0))


def _report_price_reaction(
    report_id: str,
    observation_date: date,
    price_dates: list[date],
    closes: list[float],
) -> dict[str, Any]:
    event_date = _effective_price_event_date(report_id, observation_date)
    event_index = bisect_left(price_dates, event_date)
    if event_index >= len(closes):
        return {
            "price_event_date": event_date.isoformat(),
            "reaction_1d_pct": None,
            "reaction_5d_pct": None,
        }

    exact_session = price_dates[event_index] == event_date
    after_close = report_id == "crop_progress" and exact_session
    if after_close:
        base_index = event_index
        response_index = event_index + 1
        day_five_index = event_index + 5
    else:
        base_index = event_index - 1
        response_index = event_index
        day_five_index = event_index + 4
    if base_index < 0 or response_index >= len(closes):
        reaction_1d = None
    else:
        base = closes[base_index]
        reaction_1d = round((closes[response_index] / base - 1) * 100, 3) if base else None
    if base_index < 0 or day_five_index >= len(closes):
        reaction_5d = None
    else:
        base = closes[base_index]
        reaction_5d = round((closes[day_five_index] / base - 1) * 100, 3) if base else None
    return {
        "price_event_date": event_date.isoformat(),
        "reaction_1d_pct": reaction_1d,
        "reaction_5d_pct": reaction_5d,
    }


def _metric_value(release: dict[str, Any], metric_id: str) -> float | None:
    metric = _metric_by_id(release, metric_id)
    return _safe_float(metric.get("value")) if metric else None


def _non_wasde_signal_inputs(report_id: str, history: dict[str, Any]) -> list[dict[str, Any]]:
    releases = list(reversed(history.get("releases", [])))
    primary_metric_id = (history.get("analysis") or {}).get("primary_metric_id")
    rows: list[dict[str, Any]] = []
    primary_values: list[float] = []
    for release in releases:
        raw_signal: float | None = None
        basis = ""
        primary_value = _metric_value(release, primary_metric_id) if primary_metric_id else None
        if report_id == "crop_production":
            year_change = _metric_value(release, "production_yoy_pct")
            if year_change is not None:
                raw_signal = -year_change
                basis = "Production versus the year-ago crop; lower supply is price-supportive"
            elif primary_value is not None and primary_values:
                raw_signal = -(primary_value / primary_values[-1] - 1) * 100 if primary_values[-1] else None
                basis = "Production revision versus the prior report; lower supply is price-supportive"
        elif report_id == "crop_progress" and primary_metric_id:
            metric = _metric_by_id(release, primary_metric_id)
            if metric and primary_value is not None:
                benchmark = _safe_float(metric.get("five_year_average"))
                basis_label = "five-year average"
                if benchmark is None:
                    benchmark = _safe_float(metric.get("previous_year"))
                    basis_label = "year-ago condition"
                if benchmark is None:
                    benchmark = _safe_float(metric.get("previous_week"))
                    basis_label = "prior-week condition"
                if benchmark is not None:
                    raw_signal = -(primary_value - benchmark)
                    basis = f"Crop condition versus the {basis_label}; weaker condition is price-supportive"
        elif report_id in {"export_sales", "export_inspections"} and primary_value is not None:
            baseline_values = primary_values[-4:]
            if len(baseline_values) >= 4:
                raw_signal = primary_value - mean(baseline_values)
                basis = "Latest demand flow versus the prior four-report pace; stronger demand is price-supportive"
        elif report_id == "grain_stocks":
            year_change = _metric_value(release, "total_stocks_yoy_pct")
            if year_change is not None:
                raw_signal = -year_change
                basis = "Stocks versus the comparable year-ago checkpoint; lower inventories are price-supportive"
        elif report_id == "acreage":
            year_change = _metric_value(release, "planted_area_yoy_pct")
            if year_change is not None:
                raw_signal = -year_change
                basis = "Planted area versus the prior year; fewer acres are price-supportive"
        elif report_id == "cot" and primary_value is not None and primary_values:
            raw_signal = primary_value - primary_values[-1]
            basis = "Weekly change in noncommercial net positioning; increased net length is price-supportive context"

        if primary_value is not None:
            primary_values.append(primary_value)
        if raw_signal is not None:
            rows.append({
                "release_date": release["release_date"],
                "raw_signal": raw_signal,
                "signal_basis": basis,
            })

    raw_values = [row["raw_signal"] for row in rows]
    signal_mean = mean(raw_values) if raw_values else 0.0
    scale = sqrt(mean([(value - signal_mean) ** 2 for value in raw_values])) if raw_values else 0.0
    for row in rows:
        row["signal_z"] = round(max(-3.0, min(3.0, (row["raw_signal"] - signal_mean) / scale)), 3) if scale > 0 else None
    return rows


def _wasde_signal_inputs(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[float]] = {}
    for layer in series:
        for point in layer.get("points", []):
            signal = point.get("bullish_signal_z")
            if signal is not None:
                grouped.setdefault(point["release_date"], []).append(float(signal))
    return [
        {
            "release_date": released,
            "raw_signal": round(mean(signals), 3),
            "signal_z": round(mean(signals), 3),
            "signal_basis": "Average of standardized WASDE supply, demand, and yield revisions",
        }
        for released, signals in sorted(grouped.items())
    ]


def _relationship_statistics(observations: list[dict[str, Any]], reaction_key: str) -> dict[str, Any]:
    pairs = [
        (float(row["signal_z"]), float(row[reaction_key]))
        for row in observations
        if row.get("signal_z") is not None and row.get(reaction_key) is not None
    ]
    if not pairs:
        return {"sample_size": 0, "correlation": None, "slope": None, "alignment_rate": None, "residual_pct": None}
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = mean(xs)
    y_mean = mean(ys)
    x_variance = sum((value - x_mean) ** 2 for value in xs)
    y_variance = sum((value - y_mean) ** 2 for value in ys)
    correlation = (
        sum((x - x_mean) * (y - y_mean) for x, y in pairs) / sqrt(x_variance * y_variance)
        if x_variance > 0 and y_variance > 0
        else None
    )
    slope_denominator = sum(x * x for x in xs)
    slope = sum(x * y for x, y in pairs) / slope_denominator if slope_denominator > 0 else None
    aligned = [1.0 if x * y > 0 else 0.0 for x, y in pairs if abs(x) >= 0.1 and abs(y) >= 0.05]
    residual = (
        sqrt(mean([(y - slope * x) ** 2 for x, y in pairs]))
        if slope is not None
        else None
    )
    return {
        "sample_size": len(pairs),
        "correlation": round(correlation, 3) if correlation is not None else None,
        "slope": round(slope, 4) if slope is not None else None,
        "alignment_rate": round(mean(aligned), 3) if aligned else None,
        "residual_pct": round(residual, 3) if residual is not None else None,
    }


def _impact_confidence(sample_size: int, correlation: float | None) -> tuple[str, float]:
    if sample_size < 8 or correlation is None:
        return "Insufficient", 0.0
    strength = abs(correlation)
    sample_factor = min(1.0, sample_size / 24)
    reliability = sample_factor * min(1.0, strength / 0.5)
    if sample_size >= 20 and strength >= 0.35:
        label = "Established"
    elif strength >= 0.2:
        label = "Moderate"
    else:
        label = "Weak"
    return label, round(reliability, 3)


def _same_session_effective_weights(weighted_reports: list[dict[str, Any]]) -> dict[str, float]:
    event_groups: dict[str, list[dict[str, Any]]] = {}
    for report in weighted_reports:
        event_key = report.get("price_event_date") or report["report_id"]
        event_groups.setdefault(event_key, []).append(report)
    effective_weights: dict[str, float] = {}
    for event_reports in event_groups.values():
        raw_weights = [report["reliability"] * report["freshness"] for report in event_reports]
        group_weight = max(raw_weights)
        group_total = sum(raw_weights)
        for report, raw_weight in zip(event_reports, raw_weights, strict=True):
            effective_weights[report["report_id"]] = group_weight * raw_weight / group_total if group_total else 0.0
    return effective_weights


def _build_impact_model(
    series: list[dict[str, Any]],
    report_histories: dict[str, dict[str, Any]],
    prices: list[dict[str, Any]],
    commodity: dict[str, Any],
) -> dict[str, Any]:
    price_rows = [row for row in prices if row.get("value") is not None]
    price_dates = [date.fromisoformat(row["date"]) for row in price_rows]
    closes = [float(row["value"]) for row in price_rows]
    catalog_by_id = {report["id"]: report for report in REPORT_CATALOG}
    reports: list[dict[str, Any]] = []
    latest_signals: dict[str, float | None] = {}
    latest_price_date = price_dates[-1] if price_dates else None

    applicable_report_ids = set(commodity["report_ids"])
    for report_id in commodity["report_ids"]:
        definition = REPORT_IMPACT_DEFINITIONS[report_id]
        signal_rows = (
            _wasde_signal_inputs(series)
            if report_id == "wasde"
            else _non_wasde_signal_inputs(report_id, report_histories.get(report_id, {}))
        )
        observations = []
        for row in signal_rows:
            released = date.fromisoformat(row["release_date"])
            observations.append({
                **row,
                **_report_price_reaction(report_id, released, price_dates, closes),
            })
        latest = observations[-1] if observations else None
        stats_1d = _relationship_statistics(observations, "reaction_1d_pct")
        stats_5d = _relationship_statistics(observations, "reaction_5d_pct")
        confidence, reliability = _impact_confidence(stats_5d["sample_size"], stats_5d["correlation"])
        signal_z = latest.get("signal_z") if latest else None
        latest_signals[report_id] = signal_z
        model_5d = (
            round(float(stats_5d["slope"]) * float(signal_z), 3)
            if confidence != "Insufficient" and stats_5d["slope"] is not None and signal_z is not None
            else None
        )
        event_date = date.fromisoformat(latest["price_event_date"]) if latest else None
        age_days = max(0, (latest_price_date - event_date).days) if latest_price_date and event_date else None
        freshness = (
            round(0.5 ** (age_days / definition["half_life_days"]), 3)
            if age_days is not None
            else 0.0
        )
        reports.append({
            "report_id": report_id,
            "report": catalog_by_id[report_id]["name"],
            "channel": definition["channel"],
            "latest_release_date": latest.get("release_date") if latest else None,
            "price_event_date": latest.get("price_event_date") if latest else None,
            "signal_z": signal_z,
            "signal_basis": latest.get("signal_basis") if latest else None,
            "latest_reaction_1d_pct": latest.get("reaction_1d_pct") if latest else None,
            "latest_reaction_5d_pct": latest.get("reaction_5d_pct") if latest else None,
            "historical_1d": stats_1d,
            "historical_5d": stats_5d,
            "model_5d_pct": model_5d,
            "contribution_5d_pct": None,
            "confidence": confidence,
            "reliability": reliability,
            "freshness": freshness,
            "observations": observations,
        })

    weighted_reports = [
        report for report in reports
        if report["model_5d_pct"] is not None and report["reliability"] > 0 and report["freshness"] > 0
    ]
    effective_weights = _same_session_effective_weights(weighted_reports)
    total_weight = sum(effective_weights.values())
    for report in weighted_reports:
        normalized_weight = effective_weights[report["report_id"]] / total_weight if total_weight else 0.0
        report["contribution_5d_pct"] = round(report["model_5d_pct"] * normalized_weight, 3)
        report["model_weight"] = round(normalized_weight, 3)
    for report in reports:
        report.setdefault("model_weight", 0.0)

    projected_pct = round(sum(report["contribution_5d_pct"] or 0.0 for report in reports), 3) if weighted_reports else None
    uncertainty_pct = (
        round(sqrt(sum(
            ((report["historical_5d"]["residual_pct"] or 0.0) * report["model_weight"]) ** 2
            for report in weighted_reports
        )), 3)
        if weighted_reports
        else None
    )
    current_price = closes[-1] if closes else None
    projected_price = current_price * (1 + projected_pct / 100) if current_price is not None and projected_pct is not None else None
    lower_price = (
        current_price * (1 + (projected_pct - uncertainty_pct) / 100)
        if current_price is not None and projected_pct is not None and uncertainty_pct is not None
        else None
    )
    upper_price = (
        current_price * (1 + (projected_pct + uncertainty_pct) / 100)
        if current_price is not None and projected_pct is not None and uncertainty_pct is not None
        else None
    )
    if projected_pct is None:
        direction = "Unavailable"
    elif projected_pct >= 0.15:
        direction = "Price-supportive"
    elif projected_pct <= -0.15:
        direction = "Price-restrictive"
    else:
        direction = "Balanced"

    relationships = []
    for relationship in REPORT_RELATIONSHIPS:
        if not {relationship["source_report_id"], relationship["target_report_id"]}.issubset(applicable_report_ids):
            continue
        source_signal = latest_signals.get(relationship["source_report_id"])
        target_signal = latest_signals.get(relationship["target_report_id"])
        if source_signal is None or target_signal is None:
            status = "Unavailable"
        elif abs(source_signal) < 0.25 or abs(target_signal) < 0.25:
            status = "Mixed"
        elif source_signal * target_signal > 0:
            status = "Confirming"
        else:
            status = "Conflicting"
        source_name = catalog_by_id[relationship["source_report_id"]]["name"]
        target_name = catalog_by_id[relationship["target_report_id"]]["name"]
        relationships.append({
            **relationship,
            "source_report": source_name,
            "target_report": target_name,
            "status": status,
            "description": f"{source_name} {relationship['kind']} {target_name}; their latest price-pressure signals are {status.lower()}.",
        })

    return {
        "as_of": latest_price_date.isoformat() if latest_price_date else None,
        "price_unit": commodity["price_unit"],
        "horizon_sessions": 5,
        "aggregate": {
            "direction": direction,
            "current_price": round(current_price, 4) if current_price is not None else None,
            "projected_5d_pct": projected_pct,
            "projected_5d_price": round(projected_price, 4) if projected_price is not None else None,
            "lower_5d_price": round(lower_price, 4) if lower_price is not None else None,
            "upper_5d_price": round(upper_price, 4) if upper_price is not None else None,
            "uncertainty_5d_pct": uncertainty_pct,
            "contributors_included": len(weighted_reports),
        },
        "reports": reports,
        "relationships": relationships,
        "methodology": {
            "signal": "Each report is oriented so positive means price-supportive, then scaled against its own published history.",
            "reaction": "Next-close and five-session reactions use the trading session when the report became public; period-ending datasets are shifted to their publication date.",
            "scenario": "The five-session scenario is a freshness- and evidence-weighted blend of historical report/return associations, not a forecast or causal estimate. Reports released into the same price session share one event weight to limit double counting.",
            "uncertainty": "The overlap-sensitive range combines each included model's historical residual variation after same-session event weighting; it does not estimate cross-report covariance and is not a probability interval.",
        },
    }


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
    years = max(1, min(years, 150))
    now = datetime.now(EASTERN)
    commodity = COMMODITIES[symbol]
    applicable_report_ids = set(_report_ids_for(symbol))
    warnings: list[str] = []
    wasde_rows = _load_wasde_history(years, now.date()) if "wasde" in applicable_report_ids else []
    if "wasde" in applicable_report_ids and not wasde_rows:
        warnings.append("USDA WASDE history is temporarily unavailable; the release calendar and source links remain usable.")

    series: list[dict[str, Any]] = []
    if commodity["usda"]:
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
        commodity["tickers"],
        history_start,
        now.date(),
    )
    warnings.extend(price_warnings)
    _attach_reactions(series, prices)
    schedule = [event for event in build_release_calendar(now) if event["report_id"] in applicable_report_ids]
    next_release = schedule[0] if schedule else None
    selected_layer = next((layer for layer in series if layer["metric_id"] == selected_metric), series[0] if series else None)
    latest_release = selected_layer["points"][-1] if selected_layer and selected_layer["points"] else None
    release_dates = sorted({
        date.fromisoformat(point["release_date"])
        for layer in series
        for point in layer["points"]
    })
    history_complete = bool(release_dates) and release_dates[0] <= history_start + timedelta(days=45) if "wasde" in applicable_report_ids else False
    if "wasde" in applicable_report_ids and years > 3 and not history_complete:
        warnings.append(
            "The persisted USDA archive does not yet cover the full selected window; run the WASDE history backfill."
        )
    report_histories = _load_report_histories(symbol, years, now.date())
    if report_histories and not any(history["release_count"] for history in report_histories.values()):
        warnings.append(
            "The mapped non-WASDE release archive is empty for this future; run the agriculture report-history backfill."
        )
    report_catalog = []
    for report in REPORT_CATALOG:
        if report["id"] not in applicable_report_ids:
            continue
        item = dict(report)
        if report["id"] == "wasde":
            item.update({
                "release_count": len(release_dates),
                "observed_start_date": release_dates[0].isoformat() if release_dates else None,
                "observed_end_date": release_dates[-1].isoformat() if release_dates else None,
            })
        else:
            history = report_histories[report["id"]]
            item.update({
                "release_count": history["release_count"],
                "observed_start_date": history["observed_start_date"],
                "observed_end_date": history["observed_end_date"],
            })
            if history["analysis"]:
                item.update({
                    "coverage": "chart_ready",
                    "coverage_label": "Chart + history",
                })
        report_catalog.append(item)
    available_metric_ids = {layer["metric_id"] for layer in series}
    visible_metrics = [
        {key: value for key, value in metric.items() if key != "attribute"}
        for metric in METRICS
        if metric["id"] in available_metric_ids
    ]
    non_wasde_dates = sorted({
        date.fromisoformat(release["release_date"])
        for history in report_histories.values()
        for release in history["releases"]
    })
    observed_dates = release_dates or non_wasde_dates
    coverage_source = (
        "USDA WASDE as-reported CSV archive"
        if release_dates
        else "CFTC and mapped official release archives"
    )
    impact_model = _build_impact_model(series, report_histories, prices, commodity)
    return {
        "as_of": now.isoformat(),
        "commodity": _public_commodity(symbol, commodity),
        "commodities": [_public_commodity(code, item) for code, item in COMMODITIES.items()],
        "selected_metric": selected_metric,
        "years": years,
        "history_coverage": {
            "structured_start_date": WASDE_STRUCTURED_START.isoformat(),
            "requested_start_date": history_start.isoformat(),
            "observed_start_date": observed_dates[0].isoformat() if observed_dates else None,
            "observed_end_date": observed_dates[-1].isoformat() if observed_dates else None,
            "release_count": len(observed_dates),
            "complete": history_complete,
            "source": coverage_source,
        },
        "next_release": next_release,
        "latest_release": latest_release,
        "reports": report_catalog,
        "report_histories": report_histories,
        "schedule": schedule,
        "metrics": visible_metrics,
        "series": series,
        "price_history": prices,
        "impact_model": impact_model,
        "takeaways": _build_takeaways(series, selected_metric),
        "methodology": {
            "actuals": "Only reports mapped to this future are shown. Observations come from USDA WASDE, NASS, FAS, FGIS, and CFTC official archives and retain the source's release or report date.",
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
