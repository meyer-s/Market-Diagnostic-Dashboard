from __future__ import annotations

import asyncio
import calendar
from datetime import date, datetime
from math import isfinite
import re
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from lxml import etree, html
import xlrd


Comparison = Literal["corporate", "public-lending"]
CORPORATE_SOURCE = (
    "https://home.treasury.gov/data/treasury-coupon-issues-and-corporate-bond-yield-curve/"
    "corporate-bond-yield-curve"
)
CORPORATE_WORKBOOK = "https://home.treasury.gov/system/files/226/hqmeom_qh_pars.xls"
PUBLIC_LENDING_SOURCE = "https://www.rd.usda.gov/programs-services/services/rural-utilities-loan-interest-rates"
_EASTERN = ZoneInfo("America/New_York")
_CORPORATE_TENORS = (2, 5, 10, 30)
_PUBLIC_TENORS = (1, 2, 3, 5, 7, 10, 20)
_QUARTER = re.compile(r"([1-4])(?:st|nd|rd|th)\s+Quarter\s+of\s+(?:CY\s+)?(20\d{2})", re.I)

# Values checked against USDA's published Q4 2026 table on November 18, 2026.
# The pooled 2047-or-later row has no exact tenor on the chart.
_PUBLIC_SNAPSHOT_PERIOD = date(2026, 10, 1)
_PUBLIC_SNAPSHOT_VALUES = {1: 2.500, 2: 2.625, 3: 2.625, 5: 2.875, 7: 3.125, 10: 3.500, 20: 4.375}


class ComparisonUnavailable(RuntimeError):
    """The publisher did not return a recognizable comparison series."""


def _rate(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) and -10 < number < 100 else None


def _month_end(period: date) -> date:
    return period.replace(day=calendar.monthrange(period.year, period.month)[1])


def _curve(values: dict[int, float]) -> list[dict]:
    return [{"maturity": f"{tenor}Y", "yield": value} for tenor, value in sorted(values.items())]


def parse_corporate_par_workbook(content: bytes, *, today: date) -> dict:
    with xlrd.open_workbook(file_contents=content) as workbook:
        sheet = workbook.sheet_by_index(0)
        columns = {}
        first_data_row = 0
        for index in range(min(sheet.nrows, 15)):
            row = sheet.row_values(index)
            columns = {
                tenor: column for tenor in _CORPORATE_TENORS
                for column, label in enumerate(row)
                if str(label).strip().casefold() == f"{tenor} years"
            }
            if len(columns) == len(_CORPORATE_TENORS):
                first_data_row = index + 1
                break
        if not first_data_row:
            raise ComparisonUnavailable("Treasury HQM maturity headers were not found.")

        latest: tuple[date, dict[int, float]] | None = None
        for index in range(first_data_row, sheet.nrows):
            row = sheet.row_values(index)
            try:
                period = datetime.strptime(str(row[0]).strip(), "%b %Y").date()
            except ValueError:
                continue
            if _month_end(period) > today or latest and period <= latest[0]:
                continue
            values = {
                tenor: value for tenor, column in columns.items()
                if (value := _rate(row[column])) is not None
            }
            if len(values) >= 2:
                latest = period, values

    if latest is None:
        raise ComparisonUnavailable("Treasury HQM returned no usable end-of-month par yields.")
    period, values = latest
    end = _month_end(period)
    return {
        "period_start": period.isoformat(),
        "period_end": end.isoformat(),
        "period_label": f"{period:%b %Y} month-end",
        "curve": _curve(values),
        "source": {"name": "U.S. Treasury HQM", "url": CORPORATE_SOURCE},
        "data_quality": {
            "stale": (today - end).days > 62,
            "partial": len(values) != len(_CORPORATE_TENORS),
        },
    }


def _public_payload(period: date, values: dict[int, float], *, today: date, published_snapshot: bool = False) -> dict:
    end = _month_end(period.replace(month=period.month + 2))
    return {
        "period_start": period.isoformat(),
        "period_end": end.isoformat(),
        "period_label": f"Q{(period.month + 2) // 3} {period.year}",
        "curve": _curve(values),
        "source": {"name": "USDA Rural Utilities Service", "url": PUBLIC_LENDING_SOURCE},
        "data_quality": {
            "stale": today > end,
            "partial": len(values) != len(_PUBLIC_TENORS),
            "published_snapshot": published_snapshot,
        },
    }


def parse_public_lending_schedule(content: bytes, *, today: date) -> dict:
    document = html.fromstring(content)
    schedules = []
    for table in document.xpath("//table"):
        rows = table.xpath(".//tr")
        if not any("rus rate" in " ".join(row.text_content().lower().split()) for row in rows):
            continue
        context = table.xpath("./caption | preceding::*[self::h2 or self::h3 or self::h4 or self::h5][1]")
        match = _QUARTER.search(" ".join(" ".join(node.text_content().split()) for node in context))
        if not match:
            continue
        quarter, year = map(int, match.groups())
        period = date(year, 3 * quarter - 2, 1)
        if period > today:
            continue
        values = {}
        for row in rows:
            cells = row.xpath("./td")
            if len(cells) != 2:
                continue
            term, rate = (cell.text_content().strip() for cell in cells)
            if not re.fullmatch(r"20\d{2}", term):
                continue
            tenor = int(term) - year
            value = _rate(rate)
            if tenor in _PUBLIC_TENORS and value is not None:
                values[tenor] = value
        if len(values) >= 2:
            schedules.append((period, values))

    if not schedules:
        raise ComparisonUnavailable("USDA returned no usable municipal-rate schedule.")
    period, values = max(schedules, key=lambda item: item[0])
    if period < _PUBLIC_SNAPSHOT_PERIOD <= today:
        raise ComparisonUnavailable("USDA feed is behind the verified published schedule.")
    return _public_payload(period, values, today=today)


def published_public_lending_snapshot(*, today: date | None = None) -> dict | None:
    today = today or datetime.now(_EASTERN).date()
    if today < _PUBLIC_SNAPSHOT_PERIOD:
        return None
    return _public_payload(_PUBLIC_SNAPSHOT_PERIOD, _PUBLIC_SNAPSHOT_VALUES, today=today, published_snapshot=True)


async def fetch_curve_comparison(comparison: Comparison) -> dict:
    url = CORPORATE_WORKBOOK if comparison == "corporate" else PUBLIC_LENDING_SOURCE
    parse = parse_corporate_par_workbook if comparison == "corporate" else parse_public_lending_schedule
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
        return await asyncio.to_thread(parse, response.content, today=datetime.now(_EASTERN).date())
    except (httpx.HTTPError, xlrd.XLRDError, etree.LxmlError, ValueError) as exc:
        raise ComparisonUnavailable(f"Could not read the {comparison} publisher data.") from exc
