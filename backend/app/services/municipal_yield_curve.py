"""Dated national muni benchmarks from the table in MBIS's public curve widget.

Keep the publisher's coupon/call convention and observation time. This is a
benchmark, not a sample of individual offerings or a tax-equivalent par curve.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from math import isfinite
import re
from zoneinfo import ZoneInfo

import httpx
from lxml import etree, html


MUNICIPAL_SOURCE = "https://mbis.com/benchmark-curves"
MUNICIPAL_METHODOLOGY = "https://www.msrb.org/sites/default/files/MBIS-Yield-Curve-Methodology.pdf"
_CURVE_TABLE = "https://prime.mbis.com/sqx/server/curve/combo_chart.php"
_EASTERN = ZoneInfo("America/New_York")
_BASIS = "5% coupon, non-call 10 years"
_AS_OF = re.compile(r"Rates\s+as\s+of\s+(\d{1,2}:\d{2}\s+[AP]M\s+\d{1,2}/\d{1,2}/\d{2})", re.I)
_HISTORY_LIMIT = 4


class MunicipalCurveUnavailable(RuntimeError):
    """The public publisher table did not contain a complete, dated curve."""


def parse_municipal_curve(content: bytes, *, requested_date: date) -> dict:
    try:
        document = html.fromstring(content)
        text = " ".join(document.text_content().split())
        if not re.search(r"Benchmark\s+5%\s+Non-Call\s+10yr\s+Curve", text, re.I):
            raise ValueError("Benchmark coupon/call convention changed")
        timestamps = set(_AS_OF.findall(text))
        if len(timestamps) != 1:
            raise ValueError("Missing or ambiguous observation time")
        observed = datetime.strptime(timestamps.pop(), "%I:%M %p %m/%d/%y").replace(tzinfo=_EASTERN)
        if observed.date() > requested_date:
            raise ValueError("Publisher returned a later date than requested")
        values = {}
        for row in document.xpath("//tr[starts-with(@id, 'bCRVrow')]"):
            tenors = row.xpath("./td[@class='col_tenor']")
            rates = row.xpath("./td[@class='col_yield']")
            if len(tenors) != 1 or len(rates) != 1:
                raise ValueError("Unexpected maturity/rate cells")
            tenor = int(tenors[0].text_content().strip())
            rate = float(rates[0].text_content().strip())
            if tenor in values or not isfinite(rate) or not 0 <= rate <= 15:
                raise ValueError("Duplicate tenor or invalid yield")
            values[tenor] = rate
        if set(values) != set(range(1, 31)):
            raise ValueError("Expected all 30 annual maturity points")
    except (etree.LxmlError, TypeError, ValueError) as exc:
        raise MunicipalCurveUnavailable(f"Unrecognized MBIS benchmark table: {exc}") from exc

    day = observed.date().isoformat()
    return {
        "as_of": observed.isoformat(),
        "period_start": day,
        "period_end": day,
        "period_label": f"{observed:%b %d, %Y · %I:%M %p %Z}",
        "curve": [{"maturity": f"{tenor}Y", "yield": values[tenor]} for tenor in range(1, 31)],
        "basis": _BASIS,
        "source": {"name": "MBIS national tax-exempt benchmark", "url": MUNICIPAL_SOURCE},
    }


async def fetch_municipal_curve(*, today: date | None = None) -> dict:
    today = today or datetime.now(_EASTERN).date()
    # Seven weekday requests provide holiday headroom for five distinct curves.
    # Never relabel a weekend/holiday carry-forward as a new observation.
    requested_days = []
    for offset in range(12):
        day = today - timedelta(days=offset)
        if day.weekday() < 5:
            requested_days.append(day)
        if len(requested_days) == 7:
            break
    semaphore = asyncio.Semaphore(3)

    async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
        async def fetch(day: date) -> dict | None:
            async with semaphore:
                try:
                    response = await client.get(_CURVE_TABLE, params={
                        "curve": "ap_benchmark", "dtinput": day.strftime("%m/%d/%Y"),
                    })
                    response.raise_for_status()
                    return parse_municipal_curve(response.content, requested_date=day)
                except (httpx.HTTPError, MunicipalCurveUnavailable):
                    return None

        try:
            results = await asyncio.wait_for(asyncio.gather(*(fetch(day) for day in requested_days)), timeout=16)
        except TimeoutError as exc:
            raise MunicipalCurveUnavailable("MBIS benchmark refresh exceeded its time budget") from exc

    # The same published close can appear for multiple requested dates.
    by_day = {}
    for result in results:
        if result is not None:
            prior = by_day.get(result["period_start"])
            if prior is None or result["as_of"] > prior["as_of"]:
                by_day[result["period_start"]] = result
    curves = sorted(by_day.values(), key=lambda curve: curve["as_of"], reverse=True)
    if not curves:
        raise MunicipalCurveUnavailable("MBIS returned no usable national municipal benchmarks")
    latest, *history = curves
    age = (today - date.fromisoformat(latest["period_start"])).days
    failed = any(result is None for result in results)
    return {
        **latest,
        "history": history[:_HISTORY_LIMIT],
        "methodology": {"name": "MBIS benchmark methodology", "url": MUNICIPAL_METHODOLOGY},
        "frequency": "Public published snapshots; cached for up to 6 hours",
        "data_quality": {
            "stale": age > 7,
            "partial": False,
            "history_partial": len(history) < _HISTORY_LIMIT,
            "refresh_partial": failed,
            "maturities_received": len(latest["curve"]),
            "maturities_expected": 30,
            "latest_observation_age_days": age,
        },
    }
