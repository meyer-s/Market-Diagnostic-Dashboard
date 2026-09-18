from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
import logging
import xml.etree.ElementTree as ET

import httpx


logger = logging.getLogger(__name__)

TREASURY_CURVE_FEED = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "pages/xml"
)
TREASURY_CURVE_SOURCE_PAGE = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "TextView?type=daily_treasury_yield_curve"
)

_ATOM_NS = "http://www.w3.org/2005/Atom"
_D_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices"
_M_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"

_MATURITIES = (
    ("1M", "BC_1MONTH"),
    ("2M", "BC_2MONTH"),
    ("3M", "BC_3MONTH"),
    ("4M", "BC_4MONTH"),
    ("6M", "BC_6MONTH"),
    ("1Y", "BC_1YEAR"),
    ("2Y", "BC_2YEAR"),
    ("3Y", "BC_3YEAR"),
    ("5Y", "BC_5YEAR"),
    ("7Y", "BC_7YEAR"),
    ("10Y", "BC_10YEAR"),
    ("20Y", "BC_20YEAR"),
    ("30Y", "BC_30YEAR"),
)


class TreasuryYieldCurveUnavailable(RuntimeError):
    """Raised when the official Treasury feed has no usable observations."""


def _shift_month(reference: date, offset: int) -> date:
    month_index = reference.year * 12 + reference.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def build_treasury_curve_requests(
    months: int,
    *,
    reference_date: date | None = None,
) -> tuple[str, list[tuple[str, str]]]:
    """Return the inclusive cutoff month and the smallest set of yearly feeds."""

    today = reference_date or date.today()
    cutoff = _shift_month(today.replace(day=1), -(months - 1))
    years = range(cutoff.year, today.year + 1)
    requests = [
        (
            str(year),
            f"{TREASURY_CURVE_FEED}?data=daily_treasury_yield_curve"
            f"&field_tdr_date_value={year}",
        )
        for year in years
    ]
    return cutoff.isoformat(), requests


def parse_treasury_curve_xml(xml_text: str, *, cutoff_date: str) -> list[dict]:
    """Parse Treasury's Atom feed into newest-first daily curve observations."""

    root = ET.fromstring(xml_text)
    entries = root.findall(f"{{{_ATOM_NS}}}entry")
    if not entries:
        entries = root.findall(f".//{{{_ATOM_NS}}}entry")

    curves: list[dict] = []
    for entry in entries:
        properties = entry.find(f".//{{{_M_NS}}}properties")
        if properties is None:
            continue

        date_element = properties.find(f"{{{_D_NS}}}NEW_DATE")
        if date_element is None or not date_element.text:
            continue
        observation_date = date_element.text[:10]
        if observation_date < cutoff_date:
            continue

        curve = []
        for label, field in _MATURITIES:
            element = properties.find(f"{{{_D_NS}}}{field}")
            if element is None or not element.text:
                continue
            try:
                curve.append({"maturity": label, "yield": float(element.text)})
            except ValueError:
                continue

        if curve:
            curves.append({"date": observation_date, "curve": curve})

    return curves


async def fetch_treasury_yield_curve(
    months: int,
    *,
    reference_date: date | None = None,
) -> dict:
    """Fetch recent official daily par-yield curves with bounded partial failure."""

    today = reference_date or date.today()
    cutoff_date, requests = build_treasury_curve_requests(
        months,
        reference_date=today,
    )
    # Treasury's CDN can take roughly 15-20 seconds to begin streaming from the
    # production region, even when the response is healthy. Keep enough read
    # headroom to distinguish that latency from a genuine upstream outage.
    timeout = httpx.Timeout(45.0, connect=8.0)
    headers = {
        "Accept": "application/atom+xml, application/xml, text/xml",
        "User-Agent": "MarketDiagnosticDashboard/1.0 (+https://marketdiagnostictool.com)",
    }

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers=headers,
    ) as client:
        responses = await asyncio.gather(
            *(client.get(url) for _, url in requests),
            return_exceptions=True,
        )

    curve_map: dict[str, dict] = {}
    received_periods: list[str] = []
    warnings: list[str] = []

    for (period, _url), response in zip(requests, responses):
        if isinstance(response, Exception):
            logger.warning("Treasury yield-curve request failed for %s: %r", period, response)
            warnings.append(f"Treasury data for {period} could not be refreshed.")
            continue

        try:
            response.raise_for_status()
            parsed = parse_treasury_curve_xml(
                response.text,
                cutoff_date=cutoff_date,
            )
        except (httpx.HTTPError, ET.ParseError) as exc:
            logger.warning("Treasury yield-curve response failed for %s: %s", period, exc)
            warnings.append(f"Treasury data for {period} could not be refreshed.")
            continue

        received_periods.append(period)
        for entry in parsed:
            curve_map.setdefault(entry["date"], entry)

    curves = sorted(
        curve_map.values(),
        key=lambda item: item["date"],
        reverse=True,
    )
    if not curves:
        raise TreasuryYieldCurveUnavailable(
            "The official Treasury feed returned no usable yield-curve observations."
        )

    latest = curves[0]
    latest_maturities = len(latest["curve"])
    complete = len(received_periods) == len(requests) and latest_maturities == len(_MATURITIES)
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    latest_age_days = max((today - date.fromisoformat(latest["date"])).days, 0)

    return {
        "month": today.strftime("%Y%m"),
        "months_requested": months,
        "as_of": latest["date"],
        "fetched_at": fetched_at,
        "source": {
            "name": "U.S. Department of the Treasury",
            "url": TREASURY_CURVE_SOURCE_PAGE,
            "series": "Daily Treasury Par Yield Curve Rates",
            "frequency": "Business days, official close",
        },
        "data_quality": {
            "status": "complete" if complete else "partial",
            "stale": False,
            "latest_observation_age_days": latest_age_days,
            "maturities_received": latest_maturities,
            "maturities_expected": len(_MATURITIES),
            "periods_received": received_periods,
            "periods_requested": [period for period, _url in requests],
        },
        "warnings": warnings,
        "curves": curves,
    }
