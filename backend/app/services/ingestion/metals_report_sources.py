"""Limited mine-production extracts from public-domain USGS MCS chapters.

These are annual reported estimates, not current-quarter supply or metal demand.
The adapter deliberately does not import USGS's third-party price quotations,
combined-PGM recycling totals, or US-only apparent-consumption statistics.
"""
from __future__ import annotations

from datetime import date
from io import BytesIO
import logging
import math
import re

import requests
from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)
USGS_SOURCE_TAG = "USGS_MCS_ANNUAL_ESTIMATE"
_MAX_CHAPTER_BYTES = 2_000_000


def parse_usgs_mine_supply(text: str, report_year: int, commodity: str, source_url: str) -> list[dict]:
    """Validate the published world-production columns before converting units."""
    if commodity not in {"platinum-group", "silver"}:
        raise ValueError("Unsupported USGS mine-production chapter")
    normalized = re.sub(r"\s+", " ", text).strip()
    prior, latest = report_year - 2, report_year - 1
    if f"Mineral Commodity Summaries, February {report_year}" not in normalized:
        raise ValueError("USGS chapter edition does not match its URL")
    if "World Mine Production and Reserves:" not in normalized:
        raise ValueError("USGS world mine-production table is missing")
    # Match only the world table; domestic statistics use different definitions.
    table = normalized.split("World Mine Production and Reserves:", 1)[1].split("World Resources:", 1)[0]
    years = rf"{prior}\s+{latest}\s*[eᵉ]"
    if commodity == "platinum-group":
        if "[Data in kilograms" not in normalized or not re.search(rf"Palladium Platinum\s+{years}\s+{years}", table):
            raise ValueError("USGS PGM units or production-column order changed")
        count, divisor, metals = 4, 1000.0, ("PD", "PT")
    else:
        if not re.search(r"[\[(]Data in (?:metric tons|metric tonnes)", normalized) or not re.search(years, table):
            raise ValueError("USGS silver units or year columns changed")
        count, divisor, metals = 2, 1.0, ("AG",)
    totals = re.search(r"World total\s*\(rounded\)\s+" + r"\s+".join([r"([\d,]+(?:\.\d+)?)"] * count), table)
    if not totals:
        raise ValueError("USGS world-production total was not found")
    numbers = [float(value.replace(",", "")) / divisor for value in totals.groups()]
    if any(not math.isfinite(value) or value <= 0 for value in numbers):
        raise ValueError("USGS world-production observation is invalid")
    rows = []
    for offset, metal in enumerate(metals):
        old, new = numbers[offset * 2:offset * 2 + 2]
        # Unit/schema errors should never become plausible-looking comparisons.
        upper = 100_000 if metal == "AG" else 2_000
        if not all(1 <= value <= upper for value in (old, new)):
            raise ValueError("USGS world-production units are outside the supported scale")
        for year, value in ((prior, old), (latest, new)):
            rows.append({
                "metal": metal,
                "period": str(year),
                "production_tonnes": value,
                "production_yoy_pct": (new / old - 1) * 100 if year == latest else None,
                "aisc_per_oz": None,
                "recycling_tonnes": None,
                "recycling_pct": None,
                "source": f"{USGS_SOURCE_TAG}|{source_url}",
            })
    return rows


def fetch_usgs_mine_supply(session: requests.Session | None = None, *, today: date | None = None) -> dict:
    """Fetch current/prior annual edition without replacing stored data on error.

    New editions normally appear in February. A missing current-year edition may
    fall back one edition; transport/schema failures retain existing DB records.
    """
    client = session or requests.Session()
    current_year = (today or date.today()).year
    supply = []
    errors = []
    for commodity in ("platinum-group", "silver"):
        for year in (current_year, current_year - 1):
            source_url = f"https://pubs.usgs.gov/periodicals/mcs{year}/mcs{year}-{commodity}.pdf"
            try:
                response = client.get(source_url, timeout=(5, 20))
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                content = response.content
                if not content.startswith(b"%PDF-") or len(content) > _MAX_CHAPTER_BYTES:
                    raise ValueError("USGS source is not a bounded PDF chapter")
                reader = PdfReader(BytesIO(content))
                if not 1 <= len(reader.pages) <= 5:
                    raise ValueError("USGS source is not an individual commodity chapter")
                text = "\n".join(page.extract_text() or "" for page in reader.pages)
                supply.extend(parse_usgs_mine_supply(text, year, commodity, source_url))
                break
            except (requests.RequestException, ValueError, OSError, PdfReadError) as exc:
                logger.warning("USGS %s annual mine-production refresh unavailable: %s", commodity, exc)
                errors.append({"commodity": commodity, "source_url": source_url, "reason": str(exc)})
                break
    return {"supply": supply, "demand": [], "errors": errors}
