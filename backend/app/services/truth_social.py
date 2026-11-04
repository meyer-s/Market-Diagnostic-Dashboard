"""Source-defined posting counts, without sentiment or market-signal inference."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import re
import threading
import time
from zoneinfo import ZoneInfo

import requests

SOURCE_URL = "https://www.trumpstruth.org/stats"
_EASTERN = ZoneInfo("America/New_York")
_TTL = 900
_MAX_STALE = 21600
_CACHE: dict[int, tuple[float, dict]] = {}
_LOCK = threading.RLock()
_TYPES = {"Originals": "originals", "Quotes": "quotes", "Reblogs": "retruths"}


def parse_archive(html: str, year: int, now: datetime) -> dict:
    """Decode published chart JSON; never execute upstream JavaScript or fill gaps."""
    today = now.astimezone(_EASTERN).date()
    coverage = re.search(r'class="stats-page__summary-coverage"[^>]*>(.*?)</p>', html, re.S)
    dates = re.findall(r"[A-Z][a-z]+ \d{1,2}, \d{4}", coverage.group(1)) if coverage else []
    if len(dates) != 2:
        raise ValueError("The archive no longer exposes its coverage dates.")
    first, last = (datetime.strptime(value, "%B %d, %Y").date() for value in dates)
    if first > last or last > today:
        raise ValueError("The archive returned invalid coverage dates.")
    marker = re.search(r"window\.statsChartData\s*=\s*", html)
    if not marker:
        raise ValueError("The archive's daily chart is unavailable.")
    try:
        chart, _ = json.JSONDecoder().raw_decode(html[marker.end():])
        labels, datasets = chart["labels"], chart["datasets"]
        if not isinstance(labels, list) or not isinstance(datasets, list):
            raise ValueError("Invalid archive chart shape.")
        if len(labels) > 366 or len(set(labels)) != len(labels):
            raise ValueError("The archive returned duplicate or excessive dates.")
        values = {}
        for dataset in datasets:
            label = dataset["label"]
            if label not in _TYPES or label in values:
                raise ValueError("The archive's post-type definitions have changed.")
            counts = dataset["data"]
            if not isinstance(counts, list) or len(counts) != len(labels):
                raise ValueError("The archive returned misaligned post counts.")
            if any(type(value) is not int or value < 0 for value in counts):
                raise ValueError("The archive returned missing or invalid post counts.")
            values[label] = counts
        if set(values) != set(_TYPES):
            raise ValueError("The archive is missing a post-type series.")
        parsed_dates = [date.fromisoformat(label) for label in labels]
        if parsed_dates != sorted(parsed_dates) or any(day.year != year for day in parsed_dates):
            raise ValueError("The archive returned dates outside the requested year.")
        start, end = max(date(year, 1, 1), first), min(date(year, 12, 31), last, today)
        rows = []
        for i, day in enumerate(parsed_dates):
            if start <= day <= end:
                row = {"date": day.isoformat(), **{key: values[label][i] for label, key in _TYPES.items()}}
                row["total"] = sum(row[key] for key in _TYPES.values())
                row["partial"] = day == today
                rows.append(row)
        expected = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        if not rows or [date.fromisoformat(row["date"]) for row in rows] != expected:
            raise ValueError("The archive has an unreported calendar gap; missing dates cannot be treated as zero.")
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("The archive's chart format could not be validated.") from exc
    return {
        "year": year,
        "timezone": "America/New_York",
        "fetched_at": now.astimezone(timezone.utc).isoformat(),
        "archive_through": last.isoformat(),
        "start_date": rows[0]["date"],
        "end_date": rows[-1]["date"],
        "stale": False,
        "refresh_error": None,
        "source": {"name": "Trump's Truth / Defending Democracy Together", "url": SOURCE_URL},
        "caveats": [
            "Counts reflect this independent archive, which may miss posts or add them later; a calendar day ending does not certify archive completeness.",
            "Originals include image and video posts. Quotes and ReTruths use the archive's categories; the archive calls ReTruths 'Reblogs'.",
            "Dates use America/New_York, including daylight saving time. No dates beyond the archive's reported coverage are plotted as zero.",
            "Account activity does not identify who wrote each post. Posting counts alone do not establish a relationship or predictive effect."
        ],
        "days": rows,
    }


def get_truth_social(year: int | None = None) -> dict:
    now = datetime.now(timezone.utc)
    year = year if year is not None else now.astimezone(_EASTERN).year
    if not 2022 <= year <= now.astimezone(_EASTERN).year:
        raise ValueError("Choose a year from 2022 through the current year.")
    with _LOCK:
        cached = _CACHE.get(year)
        if cached and time.monotonic() - cached[0] < _TTL:
            return deepcopy(cached[1])
        try:
            end = min(date(year, 12, 31), now.astimezone(_EASTERN).date())
            response = requests.get(SOURCE_URL, params={"start_date": f"{year}-01-01", "end_date": end.isoformat()},
                                    timeout=(5, 20), headers={"User-Agent": "MarketDiagnosticTool/1.0 (public research)"})
            response.raise_for_status()
            payload = parse_archive(response.text, year, now)
            _CACHE[year] = (time.monotonic(), payload)
            return deepcopy(payload)
        except (requests.RequestException, ValueError) as exc:
            if cached and time.monotonic() - cached[0] <= _MAX_STALE:
                payload = deepcopy(cached[1])
                payload.update(stale=True, refresh_error="Archive refresh failed; showing the previously fetched counts.")
                return payload
            raise ValueError("Validated Truth Social archive counts are temporarily unavailable.") from exc
