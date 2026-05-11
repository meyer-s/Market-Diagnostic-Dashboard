from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from app.services.market_context.agriculture_metadata import AGRICULTURE_COMMODITY_METADATA, resolve_agriculture_commodity
from app.services.market_context.crop_stage import get_crop_stage
from app.services.market_context.types import (
    BiasLabel,
    NormalizedSourcePayload,
    SourceDescriptor,
    SourceHealth,
    build_source_health,
)


EASTERN_TZ = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (agriculture-context)",
    "Accept": "text/html,application/json,text/plain,*/*",
}

WEATHER_DESCRIPTOR = SourceDescriptor(
    source_id="nws_forecast",
    source_name="NOAA National Weather Service",
    source_category="weather",
    affected_commodities=tuple(AGRICULTURE_COMMODITY_METADATA.keys()),
    update_frequency="sub-daily",
    stale_data_threshold=timedelta(hours=12),
    reliability_level="official",
    fetch_method="api.weather.gov points + forecast",
    normalization_method="Aggregate the first 4 daytime forecast periods across mapped regions",
    source_url="https://api.weather.gov/",
)

WASDE_DESCRIPTOR = SourceDescriptor(
    source_id="wasde",
    source_name="USDA WASDE",
    source_category="balance_sheet",
    affected_commodities=tuple(AGRICULTURE_COMMODITY_METADATA.keys()),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=35),
    reliability_level="official",
    fetch_method="USDA WASDE text report",
    normalization_method="Parse current and prior-month columns from the latest available WASDE text",
    source_url="https://www.usda.gov/oce/commodity/wasde",
)

EXPORT_INSPECTIONS_DESCRIPTOR = SourceDescriptor(
    source_id="export_inspections",
    source_name="USDA AMS Export Inspections",
    source_category="export_demand",
    affected_commodities=("ZC", "ZS", "ZW", "ZO"),
    update_frequency="weekly",
    stale_data_threshold=timedelta(days=10),
    reliability_level="official",
    fetch_method="USDA AMS text report WA_GR101",
    normalization_method="Parse weekly volume and marketing-year-to-date pace versus last year",
    source_url="https://www.ams.usda.gov/mnreports/wa_gr101.txt",
)

REPORT_CALENDAR_DESCRIPTOR = SourceDescriptor(
    source_id="usda_report_calendar",
    source_name="USDA Report Calendar",
    source_category="calendar",
    affected_commodities=tuple(AGRICULTURE_COMMODITY_METADATA.keys()),
    update_frequency="weekly/monthly",
    stale_data_threshold=timedelta(days=14),
    reliability_level="official",
    fetch_method="USDA WASDE page plus recurring schedules",
    normalization_method="Project next catalyst from official release schedules and fixed recurring report times",
    source_url="https://www.usda.gov/oce/commodity/wasde",
)

CPROP_DESCRIPTOR = SourceDescriptor(
    source_id="crop_progress",
    source_name="USDA NASS Crop Progress",
    source_category="crop_progress",
    affected_commodities=("ZC", "ZS", "ZW", "ZO"),
    update_frequency="weekly",
    stale_data_threshold=timedelta(days=10),
    reliability_level="official",
    fetch_method="USDA NASS national/state PDF charts",
    normalization_method="Expose report metadata now; machine-extracted values remain unavailable in the current parser",
    source_url="https://www.nass.usda.gov/Charts_and_Maps/Crop_Progress_&_Condition/index.php",
)


AG_TICKERS = {
    "ZC": "ZC=F",
    "ZS": "ZS=F",
    "ZW": "ZW=F",
    "ZM": "ZM=F",
    "ZL": "ZL=F",
    "ZO": "ZO=F",
}

_MONTH_NAME_TO_NUMBER = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

_WASDE_LOOKUP_CACHE: dict[str, dict[str, Any]] = {}
_WASDE_LOOKUP_CACHE_LOCK = Lock()
_WASDE_LOOKUP_CACHE_TTL = timedelta(hours=6)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _wasde_cache_key(as_of: datetime | None) -> str:
    reference = (as_of or _utcnow()).astimezone(EASTERN_TZ)
    return reference.strftime("%Y-%m-%d")


def _safe_get(url: str) -> requests.Response:
    response = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    response.raise_for_status()
    return response


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _to_number(value: str) -> float:
    return float(value.replace(",", ""))


def _maybe_get_number(match_text: str | None) -> float | None:
    if match_text is None:
        return None
    try:
        return _to_number(match_text)
    except ValueError:
        return None


def _bias_from_signal(signal: str) -> BiasLabel:
    if signal in {"supportive", "tightening", "bullish"}:
        return "bullish"
    if signal in {"weak", "loosening", "bearish"}:
        return "bearish"
    if signal == "mixed":
        return "mixed"
    return "neutral"


def interpret_weather_context(
    *,
    symbol: str,
    crop_stage: dict[str, str],
    region_summaries: list[dict[str, Any]],
    freshness_status: str,
) -> dict[str, Any]:
    if not region_summaries:
        return {
            "commodity": symbol,
            "crop_stage": crop_stage["stage"],
            "affected_regions": [],
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Weather data was unavailable across mapped regions."],
            "warnings": ["Missing weather data reduced confidence."],
        }

    avg_temp = sum(item["avg_temp_f"] for item in region_summaries) / len(region_summaries)
    avg_precip = sum(item["avg_precip_probability"] for item in region_summaries) / len(region_summaries)
    stage = crop_stage["stage"]
    sensitivity = crop_stage["weather_sensitivity"]
    reasons: list[str] = []
    warnings: list[str] = []
    bias: BiasLabel = "neutral"

    if avg_temp >= 88 and avg_precip <= 30 and stage in {"pollination", "flowering_pod_set", "grain_fill", "heading_fill"}:
        bias = "bullish"
        reasons.append("Hot and dry weather is showing up during a high-sensitivity crop window.")
    elif avg_precip >= 65 and stage in {"planting", "harvest"}:
        bias = "bullish"
        reasons.append("Heavy precipitation risk can delay planting or harvest progress.")
    elif avg_precip >= 50 and sensitivity == "high":
        bias = "mixed"
        reasons.append("Weather is active during a sensitive crop window, but the signal is not cleanly one-sided.")
    elif avg_precip >= 35 and avg_temp <= 80 and sensitivity == "low":
        bias = "neutral"
        reasons.append("Weather is generally non-threatening outside the highest sensitivity window.")
    elif avg_precip >= 35 and avg_temp <= 82:
        bias = "bearish"
        reasons.append("Benign moisture and temperature conditions reduce weather premium risk.")
    else:
        reasons.append("Weather conditions do not create a strong directional edge right now.")

    if freshness_status != "fresh":
        warnings.append("Weather data freshness reduced conviction.")

    confidence = "high" if sensitivity == "high" and freshness_status == "fresh" else "medium"
    if bias == "neutral" or freshness_status == "stale":
        confidence = "low" if freshness_status == "stale" else "medium"

    return {
        "commodity": symbol,
        "crop_stage": crop_stage["stage"],
        "affected_regions": [item["region_label"] for item in region_summaries],
        "bias": bias,
        "confidence": confidence,
        "reasons": reasons,
        "warnings": warnings,
        "region_summaries": region_summaries,
    }


def interpret_crop_progress_snapshot(snapshot: dict[str, Any] | None, crop_stage: dict[str, str]) -> dict[str, Any]:
    if not snapshot:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Crop Progress values were unavailable."],
            "warnings": ["Crop Progress data could not be machine-validated from the official source."],
        }

    planted_vs_avg = snapshot.get("planted_vs_five_year_avg")
    harvest_vs_avg = snapshot.get("harvested_vs_five_year_avg")
    condition_wow = snapshot.get("good_excellent_wow_change")
    condition_vs_avg = snapshot.get("good_excellent_vs_five_year_avg")
    reasons: list[str] = []
    warnings: list[str] = []
    bias: BiasLabel = "neutral"
    signal = "neutral"

    if condition_wow is not None and condition_vs_avg is not None and condition_wow < 0 and condition_vs_avg < 0:
        signal = "deteriorating condition"
        bias = "bullish"
        reasons.append("Condition ratings deteriorated and remain below the five-year average.")
    elif planted_vs_avg is not None and planted_vs_avg > 0:
        signal = "ahead of pace"
        bias = "bearish"
        reasons.append("Planting pace is ahead of the five-year average, which usually eases near-term supply concern.")
    elif harvest_vs_avg is not None and harvest_vs_avg < 0:
        signal = "harvest delayed"
        bias = "bullish"
        reasons.append("Harvest pace is behind the five-year average, which can keep nearby supply tighter.")
    else:
        reasons.append("Crop Progress does not currently show a strong directional divergence.")

    if crop_stage["weather_sensitivity"] == "low":
        warnings.append("Crop Progress carries less weight outside the active crop window.")

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium" if bias != "neutral" else "low",
        "reasons": reasons,
        "warnings": warnings,
        "snapshot": snapshot,
    }


def interpret_export_demand(metrics: dict[str, Any] | None) -> dict[str, Any]:
    if not metrics:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Export demand data was unavailable."],
            "warnings": ["Missing export data reduced confidence."],
        }

    pace_pct = metrics.get("pace_vs_prior_year_pct")
    weekly_change_pct = metrics.get("weekly_change_pct")
    reasons: list[str] = []
    signal = "demand neutral"
    bias: BiasLabel = "neutral"

    if pace_pct is not None and pace_pct >= 3:
        signal = "demand supportive"
        bias = "bullish"
        reasons.append("Marketing-year export inspections are running ahead of last year.")
    elif pace_pct is not None and pace_pct <= -3:
        signal = "demand weak"
        bias = "bearish"
        reasons.append("Marketing-year export inspections are lagging last year.")
    elif weekly_change_pct is not None and weekly_change_pct >= 10:
        signal = "demand supportive"
        bias = "bullish"
        reasons.append("Weekly export inspections accelerated meaningfully from the prior week.")
    else:
        reasons.append("Export demand is not far enough from recent pace to create a strong signal.")

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium" if bias != "neutral" else "low",
        "reasons": reasons,
        "warnings": [],
        "metrics": metrics,
    }


def interpret_wasde_balance_sheet(balance_sheet: dict[str, Any] | None) -> dict[str, Any]:
    if not balance_sheet:
        return {
            "status": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["WASDE balance-sheet data was unavailable."],
            "warnings": ["Missing WASDE data reduced confidence."],
        }

    deltas = balance_sheet.get("month_over_month", {})
    score = 0
    reasons: list[str] = []

    ending_stocks = deltas.get("ending_stocks")
    production = deltas.get("production")
    yield_value = deltas.get("yield")
    exports = deltas.get("exports")
    demand = deltas.get("domestic_use") or deltas.get("crush") or deltas.get("ethanol")

    if ending_stocks is not None:
        if ending_stocks < 0:
            score += 1
            reasons.append("Ending stocks tightened month over month.")
        elif ending_stocks > 0:
            score -= 1
            reasons.append("Ending stocks increased month over month.")
    if production is not None:
        if production < 0:
            score += 1
            reasons.append("Production moved lower month over month.")
        elif production > 0:
            score -= 1
            reasons.append("Production moved higher month over month.")
    if yield_value is not None:
        if yield_value < 0:
            score += 1
            reasons.append("Yield estimates slipped versus the prior month.")
        elif yield_value > 0:
            score -= 1
            reasons.append("Yield estimates improved versus the prior month.")
    if exports is not None:
        if exports > 0:
            score += 1
            reasons.append("Exports were raised versus the prior month.")
        elif exports < 0:
            score -= 1
            reasons.append("Exports were cut versus the prior month.")
    if demand is not None and demand < 0:
        score -= 1
        reasons.append("Domestic demand components were cut month over month.")

    if score > 0:
        status = "tightening"
        bias: BiasLabel = "bullish"
    elif score < 0:
        status = "loosening"
        bias = "bearish"
    else:
        status = "neutral"
        bias = "neutral"
        if not reasons:
            reasons.append("WASDE revisions were minimal versus the prior month.")

    return {
        "status": status,
        "bias": bias,
        "confidence": "high" if bias != "neutral" else "medium",
        "reasons": reasons,
        "warnings": [],
        "balance_sheet": balance_sheet,
    }


def _parse_region_projection(normalized_section: str, region_name: str) -> dict[str, float] | None:
    pattern = re.compile(
        rf"{re.escape(region_name)}\s+Mar\s+((?:[\d./-]+\s+){{7}})Apr\s+((?:[\d./-]+\s+){{7}})",
        re.IGNORECASE,
    )
    match = pattern.search(normalized_section)
    if not match:
        return None
    previous_values = [float(token) for token in match.group(1).split()]
    current_values = [float(token) for token in match.group(2).split()]
    keys = ("beginning_stocks", "production", "imports", "domestic_feed_or_crush", "total_use", "exports", "ending_stocks")
    return {
        f"previous_{key}": previous_values[index] for index, key in enumerate(keys)
    } | {
        key: current_values[index] for index, key in enumerate(keys)
    }


def interpret_global_supply_context(symbol: str, global_data: dict[str, Any] | None) -> dict[str, Any]:
    if not global_data:
        return {
            "status": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Global supply context was unavailable."],
            "warnings": ["Missing global data reduced confidence."],
        }

    score = 0
    reasons: list[str] = []
    drivers = global_data.get("drivers", [])
    for driver in drivers:
        delta = driver.get("delta")
        direction = driver.get("direction")
        if delta is None:
            continue
        if direction == "supply" and delta > 0:
            score -= 1
            reasons.append(f"{driver['label']} increased, which can cap upside.")
        elif direction == "supply" and delta < 0:
            score += 1
            reasons.append(f"{driver['label']} declined, which tightens the global backdrop.")
        elif direction == "demand" and delta > 0:
            score += 1
            reasons.append(f"{driver['label']} improved, supporting demand.")
        elif direction == "demand" and delta < 0:
            score -= 1
            reasons.append(f"{driver['label']} softened, weakening demand support.")

    if score > 0:
        status = "globally aligned bullish"
        bias: BiasLabel = "bullish"
    elif score < 0:
        status = "globally aligned bearish"
        bias = "bearish"
    else:
        status = "mixed"
        bias = "mixed"
        if not reasons:
            reasons.append("Global drivers were mixed or unchanged versus the prior month.")

    return {
        "status": status,
        "bias": bias,
        "confidence": "medium" if reasons else "low",
        "reasons": reasons,
        "warnings": [],
        "global_data": global_data,
    }


def fetch_weather_source(symbol: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    commodity = resolve_agriculture_commodity(symbol)
    crop_stage = get_crop_stage(symbol, as_of)
    fetched_at = _utcnow()
    warnings: list[str] = []
    errors: list[str] = []
    region_summaries: list[dict[str, Any]] = []

    for region in commodity.weather_regions:
        try:
            point_response = _safe_get(f"https://api.weather.gov/points/{region.latitude},{region.longitude}")
            forecast_url = point_response.json()["properties"]["forecast"]
            forecast_response = _safe_get(forecast_url)
            periods = forecast_response.json()["properties"]["periods"]
            daytime_periods = [period for period in periods if period.get("isDaytime")][:4]
            if not daytime_periods:
                continue
            avg_temp = sum(float(period.get("temperature", 0.0)) for period in daytime_periods) / len(daytime_periods)
            avg_precip = sum(float((period.get("probabilityOfPrecipitation") or {}).get("value") or 0.0) for period in daytime_periods) / len(daytime_periods)
            region_summaries.append(
                {
                    "region_id": region.region_id,
                    "region_label": region.label,
                    "forecast_url": forecast_url,
                    "avg_temp_f": round(avg_temp, 1),
                    "avg_precip_probability": round(avg_precip, 1),
                    "short_forecasts": [period.get("shortForecast") for period in daytime_periods],
                }
            )
        except Exception as exc:
            errors.append(f"{region.label}: {exc}")

    health = build_source_health(
        WEATHER_DESCRIPTOR,
        last_fetched_at=fetched_at if region_summaries else None,
        published_at=fetched_at if region_summaries else None,
        warnings=warnings,
        errors=errors,
        as_of=as_of or fetched_at,
    )
    interpreted = interpret_weather_context(
        symbol=symbol.upper().lstrip("/"),
        crop_stage=crop_stage,
        region_summaries=region_summaries,
        freshness_status=health.freshness_status,
    )
    interpreted["forecast_url"] = region_summaries[0].get("forecast_url") if region_summaries else WEATHER_DESCRIPTOR.source_url
    return NormalizedSourcePayload(
        descriptor=WEATHER_DESCRIPTOR,
        source_health=health,
        normalized_output=interpreted,
        last_updated=health.last_fetched_at,
        warnings=tuple(interpreted.get("warnings", [])),
        errors=tuple(errors),
    )


def fetch_crop_progress_source(symbol: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    fetched_at = _utcnow()
    crop_stage = get_crop_stage(symbol, as_of)
    pdf_url = f"https://www.nass.usda.gov/Charts_and_Maps/Crop_Progress_%26_Condition/{fetched_at.year}/US_{fetched_at.year}.pdf"
    warnings = [
        "Official Crop Progress PDFs are available, but the current adapter cannot machine-extract chart values reliably from the image-based source.",
    ]
    health = build_source_health(
        CPROP_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=warnings,
        errors=[],
        confidence_level="low",
        as_of=as_of or fetched_at,
    )
    interpreted = interpret_crop_progress_snapshot(None, crop_stage)
    interpreted["report_url"] = pdf_url
    return NormalizedSourcePayload(
        descriptor=CPROP_DESCRIPTOR,
        source_health=health,
        normalized_output=interpreted,
        last_updated=health.last_fetched_at,
        warnings=tuple(warnings + interpreted.get("warnings", [])),
        errors=(),
    )


def fetch_export_inspections_source(symbol: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    symbol_code = symbol.upper().lstrip("/")
    commodity_name = {
        "ZC": "CORN",
        "ZS": "SOYBEANS",
        "ZW": "WHEAT",
        "ZO": "OATS",
    }.get(symbol_code)

    fetched_at = _utcnow()
    if commodity_name is None:
        health = build_source_health(
            EXPORT_INSPECTIONS_DESCRIPTOR,
            last_fetched_at=fetched_at,
            published_at=fetched_at,
            warnings=["Export inspections are not tracked for this symbol."],
            errors=[],
            confidence_level="low",
            as_of=as_of or fetched_at,
        )
        interpreted = interpret_export_demand(None)
        return NormalizedSourcePayload(
            descriptor=EXPORT_INSPECTIONS_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(health.warnings),
            errors=(),
        )

    warnings: list[str] = []
    errors: list[str] = []
    metrics: dict[str, Any] | None = None
    published_at: datetime | None = None
    try:
        response = _safe_get(EXPORT_INSPECTIONS_DESCRIPTOR.source_url or "")
        text = response.text
        date_match = re.search(r"Mon\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})", text)
        if date_match:
            month = _MONTH_NAME_TO_NUMBER[date_match.group(1).lower()]
            published_at = datetime(int(date_match.group(3)), month, int(date_match.group(2)), 11, 0, tzinfo=EASTERN_TZ)
        pattern = re.compile(
            rf"^{commodity_name}\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)",
            re.MULTILINE,
        )
        match = pattern.search(text)
        if match:
            weekly = _to_number(match.group(1))
            prev_week = _to_number(match.group(2))
            prior_year_week = _to_number(match.group(3))
            ytd = _to_number(match.group(4))
            prior_ytd = _to_number(match.group(5))
            metrics = {
                "weekly_volume": weekly,
                "previous_week_volume": prev_week,
                "prior_year_week_volume": prior_year_week,
                "marketing_year_to_date": ytd,
                "prior_marketing_year_to_date": prior_ytd,
                "pace_vs_prior_year_pct": round(((ytd / prior_ytd) - 1.0) * 100.0, 2) if prior_ytd else None,
                "weekly_change_pct": round(((weekly / prev_week) - 1.0) * 100.0, 2) if prev_week else None,
            }
        else:
            warnings.append("Commodity row was not found in the export inspections report.")
    except Exception as exc:
        errors.append(str(exc))

    health = build_source_health(
        EXPORT_INSPECTIONS_DESCRIPTOR,
        last_fetched_at=fetched_at if not errors else None,
        published_at=published_at,
        warnings=warnings,
        errors=errors,
        as_of=as_of or fetched_at,
    )
    interpreted = interpret_export_demand(metrics)
    return NormalizedSourcePayload(
        descriptor=EXPORT_INSPECTIONS_DESCRIPTOR,
        source_health=health,
        normalized_output=interpreted,
        last_updated=health.last_fetched_at,
        warnings=tuple(warnings + interpreted.get("warnings", [])),
        errors=tuple(errors),
    )


def _parse_release_schedule(page_text: str, year: int) -> dict[int, int]:
    marker = f"{year} WASDE Release Dates"
    index = page_text.find(marker)
    if index < 0:
        return {}
    window = page_text[index:index + 500]
    schedule: dict[int, int] = {}
    for month_name, day_value in re.findall(r"(Jan\.|Feb\.|Mar\.|Apr\.|May|Jun\.|Jul\.|Aug\.|Sep\.|Oct\.|Nov\.|Dec\.)\s+(\d{1,2})", window):
        normalized = month_name[:3].lower().replace(".", "")
        schedule[_MONTH_NAME_TO_NUMBER[normalized]] = int(day_value)
    return schedule


def _find_latest_available_wasde(as_of: datetime | None = None) -> tuple[dict[str, Any] | None, str | None, dict[int, int]]:
    cache_key = _wasde_cache_key(as_of)
    with _WASDE_LOOKUP_CACHE_LOCK:
        cached = _WASDE_LOOKUP_CACHE.get(cache_key)
        if cached and (_utcnow() - cached["timestamp"]) <= _WASDE_LOOKUP_CACHE_TTL:
            return cached["payload"]

    response = _safe_get(WASDE_DESCRIPTOR.source_url or "")
    page_text = response.text
    schedule = _parse_release_schedule(response.text, (as_of or _utcnow()).year)
    soup = BeautifulSoup(page_text, "lxml")
    txt_links = sorted(
        {
            anchor["href"]
            for anchor in soup.find_all("a", href=True)
            if re.search(r"wasde\d{4}\.txt$", anchor["href"], re.IGNORECASE)
        },
        reverse=True,
    )

    for link in txt_links:
        text = _safe_get(link).text
        if "not yet available" in text.lower():
            continue
        code_match = re.search(r"wasde(\d{2})(\d{2})\.txt$", link)
        if not code_match:
            continue
        month = int(code_match.group(1))
        year = 2000 + int(code_match.group(2))
        day = schedule.get(month, 10)
        published_at = datetime(year, month, day, 12, 0, tzinfo=EASTERN_TZ)
        payload = ({"code": f"{month:02d}{year % 100:02d}", "link": link, "published_at": published_at}, text, schedule)
        with _WASDE_LOOKUP_CACHE_LOCK:
            _WASDE_LOOKUP_CACHE[cache_key] = {"timestamp": _utcnow(), "payload": payload}
        return payload

    payload = (None, None, schedule)
    with _WASDE_LOOKUP_CACHE_LOCK:
        _WASDE_LOOKUP_CACHE[cache_key] = {"timestamp": _utcnow(), "payload": payload}
    return payload


def _extract_section(text: str, start_marker: str, end_markers: tuple[str, ...]) -> str | None:
    start = text.find(start_marker)
    if start < 0:
        return None
    end = len(text)
    for marker in end_markers:
        marker_index = text.find(marker, start + len(start_marker))
        if marker_index >= 0:
            end = min(end, marker_index)
    return text[start:end]


def _extract_last_two_values(section: str, label: str) -> tuple[float | None, float | None]:
    for line in section.splitlines():
        compact = _normalize_spaces(line)
        if compact.lower().startswith(label.lower()):
            values = re.findall(r"-?\d[\d,]*(?:\.\d+)?", compact)
            if len(values) >= 4:
                return _maybe_get_number(values[-2]), _maybe_get_number(values[-1])
    return None, None


def _build_wasde_balance_sheet(symbol: str, text: str, report_meta: dict[str, Any]) -> dict[str, Any] | None:
    symbol_code = symbol.upper().lstrip("/")
    root = "ZS" if symbol_code in {"ZM", "ZL"} else symbol_code
    section: str | None = None
    labels: dict[str, str] = {}

    if root == "ZW":
        section = _extract_section(text, "U.S. Wheat Supply and Use", ("U.S. Wheat by Class",))
        labels = {
            "yield": "Yield per Harvested Acre",
            "production": "Production",
            "imports": "Imports",
            "domestic_use": "Domestic, Total",
            "exports": "Exports",
            "ending_stocks": "Ending Stocks",
        }
    elif root == "ZC":
        section = _extract_section(text, "U.S. Feed Grain and Corn Supply and Use", ("Sorghum, Barley, and Oats Supply and Use",))
        corn_start = section.find("CORN") if section else -1
        if section and corn_start >= 0:
            section = section[corn_start:]
        labels = {
            "yield": "Yield per Harvested Acre",
            "production": "Production",
            "ethanol": "Ethanol & by-products",
            "domestic_use": "Domestic, Total",
            "exports": "Exports",
            "ending_stocks": "Ending Stocks",
        }
    elif root == "ZS":
        whole_section = _extract_section(text, "Soybeans and Products Supply and Use (Domestic Measure)", ("U.S. Sugar Supply and Use",))
        if whole_section:
            if symbol_code == "ZM":
                start = whole_section.find("SOYBEAN MEAL")
                end = whole_section.find("U.S. Sugar Supply and Use")
                section = whole_section[start:end if end > start else None]
                labels = {
                    "production": "Production",
                    "domestic_use": "Domestic Disappearance",
                    "exports": "Exports",
                    "ending_stocks": "Ending Stocks",
                }
            elif symbol_code == "ZL":
                start = whole_section.find("SOYBEAN OIL")
                end = whole_section.find("SOYBEAN MEAL")
                section = whole_section[start:end if end > start else None]
                labels = {
                    "production": "Production",
                    "domestic_use": "Domestic Disappearance",
                    "exports": "Exports",
                    "ending_stocks": "Ending stocks",
                }
            else:
                start = whole_section.find("SOYBEANS")
                end = whole_section.find("SOYBEAN OIL")
                section = whole_section[start:end if end > start else None]
                labels = {
                    "yield": "Yield per Harvested Acre",
                    "production": "Production",
                    "crush": "Crushings",
                    "exports": "Exports",
                    "ending_stocks": "Ending Stocks",
                }
    elif root == "ZO":
        section = _extract_section(text, "Sorghum, Barley, and Oats Supply and Use", ("U.S. Rice Supply and Use",))
        oats_start = section.find("OATS") if section else -1
        if section and oats_start >= 0:
            section = section[oats_start:]
        labels = {
            "yield": "Yield",
            "production": "Production",
            "domestic_use": "Use, Total",
            "exports": "Exports",
            "ending_stocks": "Ending Stocks",
        }

    if not section:
        return None

    current_values: dict[str, float | None] = {}
    previous_values: dict[str, float | None] = {}
    for key, label in labels.items():
        previous, current = _extract_last_two_values(section, label)
        previous_values[key] = previous
        current_values[key] = current

    month_code = report_meta["code"]
    report_month = int(month_code[:2])
    report_year = 2000 + int(month_code[2:])
    previous_month = 12 if report_month == 1 else report_month - 1
    previous_year = report_year - 1 if report_month == 1 else report_year

    month_over_month = {
        key: (current_values.get(key) - previous_values.get(key))
        if current_values.get(key) is not None and previous_values.get(key) is not None
        else None
        for key in labels
    }

    return {
        "report_month": f"{report_year}-{report_month:02d}",
        "prior_report_month": f"{previous_year}-{previous_month:02d}",
        "current": current_values,
        "previous": previous_values,
        "month_over_month": month_over_month,
    }


def _build_global_context(symbol: str, text: str) -> dict[str, Any] | None:
    symbol_code = symbol.upper().lstrip("/")
    root = "ZS" if symbol_code in {"ZM", "ZL"} else symbol_code
    if root == "ZC":
        section = _extract_section(text, "World Corn Supply and Use", ("World Rice Supply and Use",))
        markers = [
            ("Brazil", "production", "supply"),
            ("Argentina", "production", "supply"),
            ("Ukraine", "exports", "supply"),
            ("China", "imports", "demand"),
        ]
    elif root == "ZS":
        section = _extract_section(text, "World Soybean Supply and Use", ("World Soybean Meal Supply and Use",))
        markers = [
            ("Brazil", "production", "supply"),
            ("Brazil", "exports", "supply"),
            ("Argentina", "production", "supply"),
            ("China", "imports", "demand"),
        ]
    elif root == "ZW":
        section = _extract_section(text, "World Wheat Supply and Use", ("World Coarse Grain Supply and Use",))
        markers = [
            ("Russia", "production", "supply"),
            ("Russia", "exports", "supply"),
            ("Ukraine", "exports", "supply"),
            ("European Union", "production", "supply"),
            ("Australia", "production", "supply"),
        ]
    else:
        return None

    if not section:
        return None
    normalized = _normalize_spaces(section)
    drivers: list[dict[str, Any]] = []
    for region, field_name, direction in markers:
        parsed = _parse_region_projection(normalized, region)
        if not parsed:
            continue
        current = parsed.get(field_name)
        previous = parsed.get(f"previous_{field_name}")
        drivers.append(
            {
                "label": f"{region} {field_name.replace('_', ' ')}",
                "direction": direction,
                "current": current,
                "previous": previous,
                "delta": current - previous if current is not None and previous is not None else None,
            }
        )
    return {"drivers": drivers}


def fetch_wasde_source(symbol: str, as_of: datetime | None = None) -> tuple[NormalizedSourcePayload, dict[str, Any] | None]:
    fetched_at = _utcnow()
    warnings: list[str] = []
    errors: list[str] = []
    balance_sheet: dict[str, Any] | None = None
    global_context: dict[str, Any] | None = None
    report_meta: dict[str, Any] | None = None

    try:
        report_meta, text, _schedule = _find_latest_available_wasde(as_of)
        if text and report_meta:
            balance_sheet = _build_wasde_balance_sheet(symbol, text, report_meta)
            global_context = _build_global_context(symbol, text)
            if not balance_sheet:
                warnings.append("WASDE parser did not find a matching balance-sheet section for this symbol.")
        else:
            warnings.append("No available WASDE report was found.")
    except Exception as exc:
        errors.append(str(exc))

    health = build_source_health(
        WASDE_DESCRIPTOR,
        last_fetched_at=fetched_at if report_meta else None,
        published_at=report_meta["published_at"] if report_meta else None,
        warnings=warnings,
        errors=errors,
        as_of=as_of or fetched_at,
    )
    interpreted = interpret_wasde_balance_sheet(balance_sheet)
    interpreted["report_link"] = report_meta["link"] if report_meta else None
    payload = NormalizedSourcePayload(
        descriptor=WASDE_DESCRIPTOR,
        source_health=health,
        normalized_output=interpreted,
        last_updated=health.published_at or health.last_fetched_at,
        warnings=tuple(warnings + interpreted.get("warnings", [])),
        errors=tuple(errors),
    )
    return payload, global_context


def fetch_global_supply_source(symbol: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    fetched_at = _utcnow()
    warnings: list[str] = []
    errors: list[str] = []
    global_context: dict[str, Any] | None = None
    published_at: datetime | None = None
    try:
        report_meta, text, _schedule = _find_latest_available_wasde(as_of)
        if report_meta:
            published_at = report_meta["published_at"]
        if text:
            global_context = _build_global_context(symbol, text)
        if not global_context:
            warnings.append("Global supply drivers were not available in the parsed WASDE section.")
    except Exception as exc:
        errors.append(str(exc))

    health = build_source_health(
        WASDE_DESCRIPTOR,
        last_fetched_at=fetched_at if not errors else None,
        published_at=published_at,
        warnings=warnings,
        errors=errors,
        as_of=as_of or fetched_at,
    )
    interpreted = interpret_global_supply_context(symbol, global_context)
    return NormalizedSourcePayload(
        descriptor=WASDE_DESCRIPTOR,
        source_health=health,
        normalized_output=interpreted,
        last_updated=health.published_at or health.last_fetched_at,
        warnings=tuple(warnings + interpreted.get("warnings", [])),
        errors=tuple(errors),
    )


def build_global_supply_payload(
    symbol: str,
    global_context: dict[str, Any] | None,
    *,
    source_health: SourceHealth,
) -> NormalizedSourcePayload:
    interpreted = interpret_global_supply_context(symbol, global_context)
    return NormalizedSourcePayload(
        descriptor=WASDE_DESCRIPTOR,
        source_health=source_health,
        normalized_output=interpreted,
        last_updated=source_health.published_at or source_health.last_fetched_at,
        warnings=tuple(interpreted.get("warnings", [])),
        errors=source_health.errors,
    )


def fetch_report_calendar_source(symbol: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    as_of_dt = (as_of or _utcnow()).astimezone(EASTERN_TZ)
    symbol_code = symbol.upper().lstrip("/")
    commodity = resolve_agriculture_commodity(symbol_code)
    warnings: list[str] = []
    errors: list[str] = []
    fetched_at = _utcnow()

    wasde_meta = None
    schedule: dict[int, int] = {}
    try:
        wasde_meta, _text, schedule = _find_latest_available_wasde(as_of)
    except Exception as exc:
        errors.append(str(exc))
        warnings.append("WASDE calendar lookup failed; falling back to recurring report schedules only.")
    year = as_of_dt.year
    upcoming: list[dict[str, Any]] = []

    for month, day_value in schedule.items():
        release = datetime(year, month, day_value, 12, 0, tzinfo=EASTERN_TZ)
        if release >= as_of_dt:
            upcoming.append(
                {
                    "report": "WASDE",
                    "release_at": release.isoformat(),
                    "impact": "high",
                    "affected_markets": list(commodity.related_reports),
                }
            )

    def _next_weekday_occurrence(target_weekday: int, release_time: time) -> datetime:
        candidate = datetime.combine(as_of_dt.date(), release_time, tzinfo=EASTERN_TZ)
        delta = (target_weekday - as_of_dt.weekday()) % 7
        if delta == 0 and candidate < as_of_dt:
            delta = 7
        return candidate + timedelta(days=delta)

    recurring = [
        ("Crop Progress", _next_weekday_occurrence(0, time(16, 0)), "high"),
        ("Export Inspections", _next_weekday_occurrence(0, time(11, 0)), "medium"),
        ("Export Sales", _next_weekday_occurrence(3, time(8, 30)), "medium"),
    ]
    fixed_reports = [
        ("Grain Stocks", datetime(year, 6, 30, 12, 0, tzinfo=EASTERN_TZ), "high"),
        ("Acreage", datetime(year, 6, 30, 12, 0, tzinfo=EASTERN_TZ), "high"),
        ("Crop Production", datetime(year, 6, 11, 12, 0, tzinfo=EASTERN_TZ), "medium"),
        ("Prospective Plantings", datetime(year, 3, 31, 12, 0, tzinfo=EASTERN_TZ), "high"),
    ]
    for report, release_dt, impact in recurring + fixed_reports:
        if release_dt >= as_of_dt and report in commodity.related_reports:
            upcoming.append(
                {
                    "report": report,
                    "release_at": release_dt.isoformat(),
                    "impact": impact,
                    "affected_markets": [symbol_code],
                }
            )

    upcoming.sort(key=lambda item: item["release_at"])
    next_report = upcoming[0] if upcoming else None
    if next_report is None:
        warnings.append("No upcoming report was identified for this symbol.")

    health = build_source_health(
        REPORT_CALENDAR_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=wasde_meta["published_at"] if wasde_meta else fetched_at,
        warnings=warnings,
        errors=errors,
        as_of=as_of or fetched_at,
    )
    normalized_output = {
        "next_report": next_report,
        "upcoming_reports": upcoming[:6],
    }
    return NormalizedSourcePayload(
        descriptor=REPORT_CALENDAR_DESCRIPTOR,
        source_health=health,
        normalized_output=normalized_output,
        last_updated=health.last_fetched_at,
        warnings=tuple(warnings),
        errors=tuple(errors),
    )