"""Extract chart-ready national metrics from official NASS release text files.

The NASS ESMIS archive is the source of record.  Its TXT files are formatted
for people rather than as a stable dataset, so the parser deliberately keeps a
small national-level contract and returns no metric when a table cannot be
identified confidently.
"""

from __future__ import annotations

import re
from typing import Any, Iterable


_NUMBER = r"\d[\d,]*(?:\.\d+)?"
_MAGNITUDE = r"(?:billion|million|thousand)?"


def _display(value: float) -> int | float:
    return int(value) if value.is_integer() else round(value, 3)


def _metric(metric_id: str, label: str, value: float, unit: str, **context: Any) -> dict[str, Any]:
    return {
        "id": metric_id,
        "label": label,
        "value": _display(value),
        "unit": unit,
        **{key: _display(item) if isinstance(item, float) else item for key, item in context.items()},
    }


def _number(value: str) -> float:
    return float(value.replace(",", ""))


def _to_millions(value: str, magnitude: str | None) -> float:
    parsed = _number(value)
    if (magnitude or "").lower() == "billion":
        return parsed * 1_000
    if (magnitude or "").lower() == "thousand":
        return parsed / 1_000
    return parsed


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def _window(
    content: str,
    subjects: Iterable[str],
    *,
    width: int = 850,
    qualifier: str | None = None,
    qualifier_width: int = 240,
) -> str | None:
    for subject in subjects:
        for match in re.finditer(subject, content, re.IGNORECASE):
            candidate = content[match.start() : match.start() + width]
            if qualifier:
                subject_length = match.end() - match.start()
                after_subject = candidate[subject_length : subject_length + qualifier_width]
                if not re.match(rf".{{0,48}}{qualifier}", after_subject, re.IGNORECASE):
                    continue
            return candidate
    return None


def _year_change(window: str) -> float | None:
    match = re.search(
        r"\b(up|down)\s+(\d+(?:\.\d+)?)\s+percent\s+from\s+"
        r"(?:last year|the previous year|a year (?:ago|earlier)|the \d{4} estimate|"
        r"(?:[A-Za-z]+\s+\d{1,2},\s+)?\d{4})",
        window[:360],
        re.IGNORECASE,
    )
    if not match:
        return None
    value = float(match.group(2))
    return value if match.group(1).lower() == "up" else -value


def _prior_from_change(current: float, change_pct: float | None) -> float | None:
    if change_pct is None or change_pct <= -100:
        return None
    implied = current / (1 + change_pct / 100)
    if implied == 0:
        return 0.0
    # The narrative percent is rounded, so preserve only three significant
    # digits rather than manufacturing precision in the implied prior level.
    digits = 3 - len(str(int(abs(implied))))
    return round(implied, digits)


_PRODUCTION_SUBJECTS = {
    "ZC": (r"Corn production for grain",),
    "ZS": (r"Soybean production for beans",),
    "ZW": (r"All wheat production for grain",),
    "KE": (r"Winter wheat production",),
    "MW": (r"Other spring wheat production for grain",),
    "CT": (r"All cotton production",),
}


def _production_narrative_metrics(content: str, symbol: str) -> list[dict[str, Any]]:
    window = _window(
        content,
        _PRODUCTION_SUBJECTS[symbol],
        qualifier=r"\b(?:is forecast|is estimated|is expected)\b",
    )
    if not window:
        return []
    quantity = re.search(
        rf"(?:forecast|estimated)(?:\s+for\s+\w+)?\s+at"
        rf"(?:\s+(?:a\s+)?record(?:\s+(?:high|low))?)?\s+({_NUMBER})\s+({_MAGNITUDE})\s+"
        r"(480-pound bales|bushels|bales|cwt)",
        window,
        re.IGNORECASE,
    )
    if not quantity:
        return []
    production = _to_millions(quantity.group(1), quantity.group(2))
    source_unit = quantity.group(3).lower()
    unit = "Million 480-pound bales" if "bales" in source_unit else (
        "Million cwt" if source_unit == "cwt" else "Million bushels"
    )
    year_change = _year_change(window)
    metrics = [_metric("production", "Production", production, unit)]
    year_ago = _prior_from_change(production, year_change)
    if year_ago is not None:
        metrics.extend((
            _metric(
                "production_year_ago",
                "Implied year-ago production",
                year_ago,
                unit,
                comparison_quality="implied_from_published_rounded_percent",
            ),
            _metric("production_yoy_pct", "Production vs year ago", year_change or 0, "Percent"),
        ))
    yield_match = re.search(
        rf"(?:average\s+)?yield[^.]*?(?:forecast\s+at|expected\s+to\s+be|estimated\s+at)"
        rf"(?:\s+(?:a\s+)?record(?:\s+(?:high|low))?)?\s+({_NUMBER})\s+"
        r"(bushels|pounds)",
        window,
        re.IGNORECASE,
    )
    if yield_match:
        yield_unit = "Bushels per acre" if yield_match.group(2).lower() == "bushels" else "Pounds per harvested acre"
        metrics.append(_metric("yield", "Yield", _number(yield_match.group(1)), yield_unit))
    return metrics


def _table_window(content: str, heading: str, *, width: int = 7_000) -> str | None:
    matches = list(re.finditer(heading, content, re.IGNORECASE))
    match = matches[-1] if matches else None
    return content[match.start() : match.start() + width] if match else None


def _national_row(block: str, minimum_values: int) -> list[float] | None:
    for match in re.finditer(r"United States\s*\.*\s*:\s*([^\r\n]+)", block, re.IGNORECASE):
        values = [_number(value) for value in re.findall(_NUMBER, match.group(1))]
        if len(values) >= minimum_values:
            return values
    return None


def _production_table_metrics(content: str, symbol: str) -> list[dict[str, Any]]:
    if symbol == "ZO":
        block = _table_window(content, r"Oat Area Harvested, Yield, and Production")
        values = _national_row(block or "", 7)
        if not values:
            return []
        prior_area, current_area = values[0:2]
        prior_yield, current_yield = values[2], values[-3]
        prior_production, current_production = values[-2:]
        return [
            _metric("production", "Production", current_production / 1_000, "Million bushels"),
            _metric("production_year_ago", "Year-ago production", prior_production / 1_000, "Million bushels"),
            _metric("yield", "Yield", current_yield, "Bushels per acre"),
            _metric("yield_year_ago", "Year-ago yield", prior_yield, "Bushels per acre"),
            _metric("harvested_area", "Harvested area", current_area / 1_000, "Million acres"),
            _metric("harvested_area_year_ago", "Year-ago harvested area", prior_area / 1_000, "Million acres"),
        ]
    if symbol == "ZR":
        block = _table_window(content, r"Rice Area Harvested, Yield, and Production")
        values = _national_row(block or "", 6)
        if not values:
            return []
        prior_area, current_area = values[0:2]
        prior_yield, current_yield = values[2], values[-3]
        prior_production, current_production = values[-2:]
        return [
            _metric("production", "Production", current_production / 1_000, "Million cwt"),
            _metric("production_year_ago", "Year-ago production", prior_production / 1_000, "Million cwt"),
            _metric("yield", "Yield", current_yield, "Pounds per acre"),
            _metric("yield_year_ago", "Year-ago yield", prior_yield, "Pounds per acre"),
            _metric("harvested_area", "Harvested area", current_area / 1_000, "Million acres"),
            _metric("harvested_area_year_ago", "Year-ago harvested area", prior_area / 1_000, "Million acres"),
        ]
    return []


_PROGRESS_COMMODITIES = {
    "ZC": "Corn",
    "ZS": "Soybean",
    "ZW": "Winter Wheat",
    "KE": "Winter Wheat",
    "MW": "Spring Wheat",
    "ZO": "Oat",
    "ZR": "Rice",
    "CT": "Cotton",
}


def _row_values(line: str) -> list[float]:
    return [0.0 if value == "-" else float(value) for value in re.findall(r"(?<!\S)(?:-|\d+(?:\.\d+)?)(?!\S)", line)]


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _progress_metrics(text: str, symbol: str) -> list[dict[str, Any]]:
    commodity = _PROGRESS_COMMODITIES[symbol]
    commodity_pattern = {
        "Soybean": r"Soybeans?",
        "Oat": r"Oats?",
    }.get(commodity, re.escape(commodity))
    lines = text.splitlines()
    headings: list[tuple[int, str]] = []
    heading_pattern = re.compile(rf"^\s*((?:{commodity_pattern})\s+.+?)\s+-\s+Selected States", re.IGNORECASE)
    for index, line in enumerate(lines):
        match = heading_pattern.search(line)
        if match:
            headings.append((index, match.group(1).strip()))
    metrics: list[dict[str, Any]] = []
    condition_metrics: list[dict[str, Any]] = []
    for heading_index, (start, title) in enumerate(headings):
        end = headings[heading_index + 1][0] if heading_index + 1 < len(headings) else min(len(lines), start + 180)
        block = lines[start:end]
        aggregate_index = next(
            (index for index, line in enumerate(block) if re.search(r"^\s*\d+\s+States\s+\.+:", line)),
            None,
        )
        if aggregate_index is None:
            continue
        values = _row_values(block[aggregate_index].split(":", 1)[-1])
        if "condition" in title.lower() and len(values) >= 5:
            previous_week = next((_row_values(line.split(":", 1)[-1]) for line in block[aggregate_index + 1 :] if re.search(r"^\s*Previous week", line, re.IGNORECASE)), [])
            previous_year = next((_row_values(line.split(":", 1)[-1]) for line in block[aggregate_index + 1 :] if re.search(r"^\s*Previous year", line, re.IGNORECASE)), [])
            condition_metrics.append(_metric(
                "condition_good_excellent",
                "Good + excellent",
                values[-2] + values[-1],
                "Percent",
                previous_week=(previous_week[-2] + previous_week[-1]) if len(previous_week) >= 5 else None,
                previous_year=(previous_year[-2] + previous_year[-1]) if len(previous_year) >= 5 else None,
                chart_group="condition",
            ))
            continue
        if len(values) < 4:
            continue
        stage = re.sub(rf"^(?:{commodity_pattern})\s+", "", title, flags=re.IGNORECASE)
        metrics.append(_metric(
            f"progress_{_slug(stage)}",
            stage,
            values[-2],
            "Percent",
            previous_year=values[-4],
            previous_week=values[-3],
            five_year_average=values[-1],
            chart_group="progress",
        ))
    return condition_metrics + metrics


_STOCK_SUBJECTS = {
    "ZC": (r"Corn stocks in all positions",),
    "ZS": (r"Soybeans stored in all positions", r"Soybean stocks in all positions"),
    "ZW": (r"Old crop all wheat stored in all positions", r"All wheat stored in all positions"),
    "KE": (r"Old crop all wheat stored in all positions", r"All wheat stored in all positions"),
    "MW": (r"Old crop all wheat stored in all positions", r"All wheat stored in all positions"),
}


def _stock_narrative_metrics(content: str, symbol: str) -> list[dict[str, Any]]:
    window = _window(
        content,
        _STOCK_SUBJECTS[symbol],
        width=900,
        qualifier=r"\b(?:totaled|estimated at)\b",
    )
    if not window:
        return []
    total = re.search(rf"(?:totaled|estimated at)\s+({_NUMBER})\s+({_MAGNITUDE})\s+bushels", window, re.IGNORECASE)
    if not total:
        return []
    total_value = _to_millions(total.group(1), total.group(2))
    year_change = _year_change(window)
    metrics = [_metric("total_stocks", "Total stocks", total_value, "Million bushels")]
    year_ago = _prior_from_change(total_value, year_change)
    if year_ago is not None:
        metrics.extend((
            _metric(
                "total_stocks_year_ago",
                "Implied year-ago stocks",
                year_ago,
                "Million bushels",
                comparison_quality="implied_from_published_rounded_percent",
            ),
            _metric("total_stocks_yoy_pct", "Stocks vs year ago", year_change or 0, "Percent"),
        ))
    on_farm = re.search(
        rf"(?:({_NUMBER})\s+({_MAGNITUDE})\s+bushels\s+are\s+stored on farms|On-farm stocks(?:\s+totaled|,\s+at|\s+are\s+estimated\s+at)\s+({_NUMBER})\s+({_MAGNITUDE})\s+bushels)",
        window,
        re.IGNORECASE,
    )
    if on_farm:
        metrics.append(_metric("on_farm_stocks", "On-farm stocks", _to_millions(on_farm.group(1) or on_farm.group(3), on_farm.group(2) or on_farm.group(4)), "Million bushels"))
    off_farm = re.search(rf"Off-farm stocks(?:,\s+at|\s+totaled)\s+({_NUMBER})\s+({_MAGNITUDE})\s+bushels", window, re.IGNORECASE)
    if off_farm:
        metrics.append(_metric("off_farm_stocks", "Off-farm stocks", _to_millions(off_farm.group(1), off_farm.group(2)), "Million bushels"))
    return metrics


def _oat_stock_metrics(content: str) -> list[dict[str, Any]]:
    block = _table_window(content, r"Oat Stocks by Position")
    values = _national_row(block or "", 6)
    if not values:
        return []
    prior_on, prior_off, prior_total, current_on, current_off, current_total = values[-6:]
    return [
        _metric("total_stocks", "Total stocks", current_total / 1_000, "Million bushels"),
        _metric("total_stocks_year_ago", "Year-ago stocks", prior_total / 1_000, "Million bushels"),
        _metric("on_farm_stocks", "On-farm stocks", current_on / 1_000, "Million bushels"),
        _metric("off_farm_stocks", "Off-farm stocks", current_off / 1_000, "Million bushels"),
        _metric("on_farm_stocks_year_ago", "Year-ago on-farm", prior_on / 1_000, "Million bushels"),
        _metric("off_farm_stocks_year_ago", "Year-ago off-farm", prior_off / 1_000, "Million bushels"),
    ]


_ACREAGE_SUBJECTS = {
    "ZC": (r"Corn planted area for all purposes",),
    "ZS": (r"Soybean planted area for \d{4}",),
    "ZW": (r"All wheat planted area for \d{4}",),
    "KE": (r"(?:The \d{4} )?winter wheat planted area", r"Winter wheat: The \d{4} winter wheat planted area"),
    "MW": (r"(?:Area planted to )?other spring wheat for \d{4}", r"Other spring wheat:.*?planted area"),
    "ZO": (r"Oats: Area seeded to oats",),
    "ZR": (r"Rice: Area planted to rice",),
    "CT": (r"All cotton planted area for \d{4}",),
}


def _acreage_metrics(content: str, symbol: str) -> list[dict[str, Any]]:
    window = _window(
        content,
        _ACREAGE_SUBJECTS[symbol],
        width=420,
        qualifier=r"\b(?:estimated|forecast)\b",
    )
    if not window:
        return []
    planted = re.search(
        rf"(?:planted area|area)[^.]{{0,90}}?(?:,\s+at|\s+is\s+estimated\s+at|\s+is\s+forecast\s+at)"
        rf"(?:\s+(?:a\s+)?record(?:\s+(?:high|low))?)?\s+({_NUMBER})\s+({_MAGNITUDE})\s+acres",
        window,
        re.IGNORECASE,
    )
    if not planted:
        planted = re.search(
            rf"(?:estimated|forecast)(?:\s+for\s+\w+)?\s+(?:at|to)"
            rf"(?:\s+(?:a\s+)?record(?:\s+(?:high|low))?)?\s+({_NUMBER})\s+({_MAGNITUDE})\s+acres",
            window,
            re.IGNORECASE,
        )
    if not planted:
        return []
    planted_value = _to_millions(planted.group(1), planted.group(2))
    year_change = _year_change(window)
    metrics = [_metric("planted_area", "Planted area", planted_value, "Million acres")]
    year_ago = _prior_from_change(planted_value, year_change)
    if year_ago is not None:
        metrics.extend((
            _metric(
                "planted_area_year_ago",
                "Implied year-ago planted area",
                year_ago,
                "Million acres",
                comparison_quality="implied_from_published_rounded_percent",
            ),
            _metric("planted_area_yoy_pct", "Planted area vs year ago", year_change or 0, "Percent"),
        ))
    harvested = re.search(
        rf"(?:Area harvested|Harvested area|Area for harvest)[^.]*?(?:at|to)\s+({_NUMBER})\s+({_MAGNITUDE})\s+acres",
        window,
        re.IGNORECASE,
    )
    if harvested:
        metrics.append(_metric("harvested_area", "Harvested area", _to_millions(harvested.group(1), harvested.group(2)), "Million acres"))
    return metrics


def parse_nass_release_metrics(report_id: str, text: str) -> dict[str, list[dict[str, Any]]]:
    """Return national report metrics keyed by futures symbol."""
    content = _normalize(text)
    symbols = ("ZC", "ZS", "ZW", "KE", "MW", "ZO", "ZR", "CT")
    if report_id == "crop_production":
        return {
            symbol: metrics
            for symbol in symbols
            if (metrics := (
                _production_table_metrics(text, symbol)
                if symbol in {"ZO", "ZR"}
                else _production_narrative_metrics(content, symbol)
            ))
        }
    if report_id == "crop_progress":
        return {symbol: metrics for symbol in symbols if (metrics := _progress_metrics(text, symbol))}
    if report_id == "grain_stocks":
        return {
            symbol: metrics
            for symbol in symbols
            if (metrics := (
                _oat_stock_metrics(text)
                if symbol == "ZO"
                else _stock_narrative_metrics(content, symbol)
                if symbol in _STOCK_SUBJECTS
                else []
            ))
        }
    if report_id == "acreage":
        return {symbol: metrics for symbol in symbols if (metrics := _acreage_metrics(content, symbol))}
    raise KeyError(f"Unsupported NASS report family: {report_id}")
