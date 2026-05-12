"""
Commodity-specific context adapters for non-grain agriculture futures.

Covers: Livestock (LE, GF, HE), Dairy (DC, DAIRY_CLASS_IV),
Softs (KC, CC, SB, CT, OJ, RS), Lumber (LBR, SYP),
Fertilizer Inputs (FERT_N, FERT_P, FERT_K).

Each group exposes:
  - A demand-signal adapter  (maps to export_demand slot)
  - A global/macro adapter   (maps to global_supply slot)
  - A current-conditions stub (maps to crop_progress slot)
  - A group-specific report calendar builder
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests

from app.core.config import settings
from app.services.ingestion.yahoo_client import YahooClient, YahooClientError
from app.services.market_context.agriculture_adapters import (  # noqa: PLC0415
    _with_daily_source_cache,  # type: ignore[attr-defined]
    _utcnow,  # type: ignore[attr-defined]
    _safe_get,  # type: ignore[attr-defined]
    _maybe_get_number,  # type: ignore[attr-defined]
    EASTERN_TZ,
    REPORT_CALENDAR_DESCRIPTOR,
)
from app.services.market_context.crop_stage import get_crop_stage
from app.services.market_context.types import (
    BiasLabel,
    NormalizedSourcePayload,
    SourceDescriptor,
    build_source_health,
)

# ---------------------------------------------------------------------------
# GROUP MEMBERSHIP SETS
# ---------------------------------------------------------------------------

GRAIN_OILSEED_SYMBOLS = frozenset({
    "ZC", "ZS", "ZW", "ZM", "ZL", "ZO", "ZR", "KE", "MW",
})
LIVESTOCK_SYMBOLS = frozenset({"LE", "GF", "HE"})
DAIRY_SYMBOLS = frozenset({"DC", "DAIRY_CLASS_IV"})
SOFTS_SYMBOLS = frozenset({"KC", "CC", "SB", "CT", "OJ", "RS"})
LUMBER_SYMBOLS = frozenset({"LBR", "SYP"})
FERTILIZER_SYMBOLS = frozenset({"FERT_N", "FERT_P", "FERT_K"})

_UTC = ZoneInfo("UTC")

# ---------------------------------------------------------------------------
# SOURCE DESCRIPTORS
# ---------------------------------------------------------------------------

AMS_LIVESTOCK_DESCRIPTOR = SourceDescriptor(
    source_id="ams_livestock_cutout",
    source_name="USDA AMS Livestock Cutout",
    source_category="demand_signal",
    affected_commodities=("LE", "GF", "HE"),
    update_frequency="daily",
    stale_data_threshold=timedelta(hours=28),
    reliability_level="official",
    fetch_method="USDA AMS daily livestock market reports",
    normalization_method="Parse Choice/Select beef or pork carcass cutout values and interpret versus prior day",
    source_url="https://www.ams.usda.gov/mnreports/",
)

FEED_COST_DESCRIPTOR = SourceDescriptor(
    source_id="feed_cost_proxy",
    source_name="Feed Cost Proxy (Corn + Soymeal)",
    source_category="input_cost",
    affected_commodities=("LE", "GF", "HE"),
    update_frequency="daily",
    stale_data_threshold=timedelta(hours=30),
    reliability_level="derived",
    fetch_method="Yahoo Finance ZC=F (Corn) and ZM=F (Soymeal) momentum",
    normalization_method="20-day change in ZC and ZM combined; rising feed costs compress cattle/hog margins",
    source_url="https://finance.yahoo.com/quote/ZC=F",
)

LIVESTOCK_PRODUCTION_DESCRIPTOR = SourceDescriptor(
    source_id="livestock_production_cycle",
    source_name="Livestock Production Cycle",
    source_category="production_cycle",
    affected_commodities=("LE", "GF", "HE"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=35),
    reliability_level="derived",
    fetch_method="Seasonal herd/slaughter cycle derived from symbol and date",
    normalization_method="Map calendar month to expected supply pressure phase",
    source_url="https://www.nass.usda.gov/Publications/Todays_Reports/",
)

AMS_DAIRY_DESCRIPTOR = SourceDescriptor(
    source_id="ams_dairy_market_news",
    source_name="USDA AMS Weekly Dairy Market News",
    source_category="demand_signal",
    affected_commodities=("DC", "DAIRY_CLASS_IV"),
    update_frequency="weekly",
    stale_data_threshold=timedelta(days=10),
    reliability_level="official",
    fetch_method="USDA AMS dymw500.txt weekly dairy market report",
    normalization_method="Parse Grade A cheese block/barrel and butter prices; interpret vs prior week",
    source_url="https://www.ams.usda.gov/mnreports/dymw500.txt",
)

GLOBAL_DAIRY_DESCRIPTOR = SourceDescriptor(
    source_id="global_dairy_context",
    source_name="Global Dairy Market Context",
    source_category="global_supply",
    affected_commodities=("DC", "DAIRY_CLASS_IV"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=35),
    reliability_level="derived",
    fetch_method="Seasonal production cycle + WASDE-backed context",
    normalization_method="Northern/Southern Hemisphere milk production cycle; trade flow seasonality",
    source_url="https://www.ams.usda.gov/mnreports/",
)

FAS_PSD_DESCRIPTOR = SourceDescriptor(
    source_id="usda_fas_psd",
    source_name="USDA FAS PSD World Production",
    source_category="global_supply",
    affected_commodities=("KC", "CC", "OJ", "RS"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=35),
    reliability_level="official",
    fetch_method="USDA FAS Production, Supply & Distribution API",
    normalization_method="Parse world production and stock estimates; compute year-over-year delta",
    source_url="https://apps.fas.usda.gov/psdonline/app/index.html#/app/downloads",
)

SOFTS_CONDITIONS_DESCRIPTOR = SourceDescriptor(
    source_id="softs_origin_conditions",
    source_name="Softs Origin Conditions",
    source_category="crop_conditions",
    affected_commodities=("KC", "CC", "SB", "CT", "OJ", "RS"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=35),
    reliability_level="derived",
    fetch_method="Seasonal crop calendar + available FAS/NASS indicators",
    normalization_method="Map symbol and calendar month to expected crop development phase and known risks",
    source_url="https://apps.fas.usda.gov/psdonline/app/index.html",
)

HOUSING_DESCRIPTOR = SourceDescriptor(
    source_id="fred_housing_starts",
    source_name="FRED Housing Starts",
    source_category="demand_signal",
    affected_commodities=("LBR", "SYP"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=40),
    reliability_level="official",
    fetch_method="Federal Reserve FRED API – HOUST (Total Housing Starts)",
    normalization_method="Last 12 months of monthly starts; compute 3-month vs 12-month trend",
    source_url="https://fred.stlouisfed.org/series/HOUST",
)

BUILDING_PERMITS_DESCRIPTOR = SourceDescriptor(
    source_id="fred_building_permits",
    source_name="FRED Building Permits",
    source_category="leading_indicator",
    affected_commodities=("LBR", "SYP"),
    update_frequency="monthly",
    stale_data_threshold=timedelta(days=40),
    reliability_level="official",
    fetch_method="Federal Reserve FRED API – PERMIT (Total Building Permits)",
    normalization_method="Last 12 months; compare recent 3-month avg vs 12-month avg",
    source_url="https://fred.stlouisfed.org/series/PERMIT",
)

NAT_GAS_DESCRIPTOR = SourceDescriptor(
    source_id="fred_henry_hub_gas",
    source_name="FRED Henry Hub Natural Gas",
    source_category="input_cost",
    affected_commodities=("FERT_N", "FERT_P", "FERT_K"),
    update_frequency="daily",
    stale_data_threshold=timedelta(hours=36),
    reliability_level="official",
    fetch_method="Federal Reserve FRED API – DHHNGSP (Henry Hub Natural Gas Spot)",
    normalization_method="20-day change; rising NG raises nitrogen fertilizer production cost",
    source_url="https://fred.stlouisfed.org/series/DHHNGSP",
)

FERTILIZER_DEMAND_DESCRIPTOR = SourceDescriptor(
    source_id="fertilizer_demand_proxy",
    source_name="Crop Price Fertilizer Demand Proxy",
    source_category="demand_signal",
    affected_commodities=("FERT_N", "FERT_P", "FERT_K"),
    update_frequency="daily",
    stale_data_threshold=timedelta(hours=30),
    reliability_level="derived",
    fetch_method="Yahoo Finance ZC=F (Corn) + ZS=F (Soybeans) price momentum as planting-season demand signal",
    normalization_method="High crop prices → stronger planting → more fertilizer demand",
    source_url="https://finance.yahoo.com/quote/ZC=F",
)

# ---------------------------------------------------------------------------
# HELPER UTILITIES
# ---------------------------------------------------------------------------


def _yahoo_20d_bias(ticker: str) -> dict[str, Any]:
    """Return 20-day price trend and bias label from Yahoo Finance."""
    try:
        now = _utcnow()
        rows = YahooClient().fetch_series(
            ticker=ticker,
            start_date=(now - timedelta(days=60)).strftime("%Y-%m-%d"),
            end_date=(now + timedelta(days=1)).strftime("%Y-%m-%d"),
            interval="1d",
        )
        if len(rows) < 22:
            return {"ticker": ticker, "bias": "neutral", "confidence": "low", "warnings": ["Insufficient history."]}
        prices = [float(r["value"]) for r in sorted(rows, key=lambda r: r["date"])]
        latest = prices[-1]
        twenty_ago = prices[-21]
        sixty_ago = prices[0]
        chg_20d = ((latest / twenty_ago) - 1.0) * 100.0
        chg_60d = ((latest / sixty_ago) - 1.0) * 100.0
        bias: BiasLabel = "bullish" if chg_20d > 0 and chg_60d >= 0 else ("bearish" if chg_20d < 0 and chg_60d <= 0 else "neutral")
        return {
            "ticker": ticker,
            "latest_price": round(latest, 4),
            "change_20d_pct": round(chg_20d, 2),
            "change_60d_pct": round(chg_60d, 2),
            "bias": bias,
            "confidence": "medium",
        }
    except Exception as exc:
        return {"ticker": ticker, "bias": "neutral", "confidence": "low", "warnings": [str(exc)]}


def _fred_series_last_n(series_id: str, n: int = 13) -> list[float]:
    """Fetch the last N observations from FRED (synchronous). Returns empty list on failure."""
    key = settings.FRED_API_KEY
    if not key:
        return []
    try:
        url = (
            "https://api.stlouisfed.org/fred/series/observations"
            f"?series_id={series_id}&api_key={key}&file_type=json"
            f"&limit={n}&sort_order=desc&observation_start=2000-01-01"
        )
        resp = _safe_get(url, timeout_seconds=8)
        obs = resp.json().get("observations", [])
        values = []
        for o in obs:
            try:
                values.append(float(o["value"]))
            except (ValueError, KeyError):
                pass
        return list(reversed(values))  # oldest → newest
    except Exception:
        return []


def _trend_bias(values: list[float], short_window: int = 3) -> BiasLabel:
    """Compare short-window average to full-series average; return directional bias."""
    if len(values) < short_window + 1:
        return "neutral"
    full_avg = sum(values) / len(values)
    short_avg = sum(values[-short_window:]) / short_window
    pct = (short_avg / full_avg - 1.0) * 100.0
    if pct > 3.0:
        return "bullish"
    if pct < -3.0:
        return "bearish"
    return "neutral"


def _insufficient_payload(descriptor: SourceDescriptor, message: str, as_of: datetime | None = None) -> NormalizedSourcePayload:
    fetched_at = _utcnow()
    health = build_source_health(
        descriptor,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[message],
        errors=[],
        confidence_level="low",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=descriptor,
        source_health=health,
        normalized_output={
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": [message],
            "warnings": [message],
        },
        last_updated=health.last_fetched_at,
        warnings=(message,),
        errors=(),
    )


# ---------------------------------------------------------------------------
# LIVESTOCK ADAPTERS
# ---------------------------------------------------------------------------

# AMS report URLs
_AMS_BEEF_URL = "https://www.ams.usda.gov/mnreports/lm_ct155.txt"
_AMS_PORK_URL = "https://www.ams.usda.gov/mnreports/lm_hg201.txt"


def _parse_beef_cutout(text: str) -> dict[str, Any] | None:
    """Extract Choice and Select cutout values from USDA AMS lm_ct155."""
    choice = None
    select = None
    spread = None
    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        # Lines like: "Choice Cutout Value:  305.61" or "CHOICE CUTOUT:  305.61"
        if re.search(r"choice\s+cutout", compact, re.IGNORECASE):
            m = re.search(r"([\d]+\.[\d]+)", compact)
            if m:
                choice = float(m.group(1))
        elif re.search(r"select\s+cutout", compact, re.IGNORECASE):
            m = re.search(r"([\d]+\.[\d]+)", compact)
            if m:
                select = float(m.group(1))
        elif re.search(r"choice.select\s+spread|chc.sel\s+spread", compact, re.IGNORECASE):
            m = re.search(r"(-?[\d]+\.[\d]+)", compact)
            if m:
                spread = float(m.group(1))
    if choice is None and select is None:
        return None
    return {"choice_cutout": choice, "select_cutout": select, "choice_select_spread": spread}


def _parse_pork_cutout(text: str) -> dict[str, Any] | None:
    """Extract pork carcass cutout value from USDA AMS lm_hg201."""
    cutout = None
    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        if re.search(r"pork\s+carcass\s+cutout|national\s+daily.*cutout", compact, re.IGNORECASE):
            m = re.search(r"([\d]+\.[\d]+)", compact)
            if m:
                cutout = float(m.group(1))
                break
        elif re.search(r"cutout\s+value", compact, re.IGNORECASE):
            m = re.search(r"([\d]+\.[\d]+)", compact)
            if m:
                cutout = float(m.group(1))
    if cutout is None:
        return None
    return {"pork_cutout": cutout}


def _interpret_beef_cutout(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Boxed beef cutout data unavailable from AMS report."],
            "warnings": ["AMS beef cutout parse failed; check report format."],
        }
    choice = data.get("choice_cutout")
    spread = data.get("choice_select_spread")
    reasons: list[str] = []
    bias: BiasLabel = "neutral"
    signal = "neutral"

    if choice is not None and choice >= 300:
        bias = "bullish"
        signal = "cutout supportive"
        reasons.append(f"Choice boxed beef cutout at ${choice:.2f}/cwt signals strong packer demand.")
    elif choice is not None and choice <= 260:
        bias = "bearish"
        signal = "cutout weak"
        reasons.append(f"Choice boxed beef cutout at ${choice:.2f}/cwt reflects weaker packer demand.")
    else:
        reasons.append(f"Boxed beef cutout at ${choice:.2f}/cwt — no extreme demand signal." if choice else "Cutout data present but value unclear.")

    if spread is not None and spread >= 20:
        reasons.append(f"Wide Choice/Select spread (${spread:.2f}) signals strong quality premium demand.")
    elif spread is not None and spread <= 5:
        reasons.append(f"Narrow Choice/Select spread (${spread:.2f}) suggests commodity-grade demand dominates.")

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium",
        "reasons": reasons,
        "warnings": [],
        "metrics": data,
        "report_url": _AMS_BEEF_URL,
    }


def _interpret_pork_cutout(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Pork carcass cutout unavailable from AMS report."],
            "warnings": ["AMS pork cutout parse failed; check report format."],
        }
    cutout = data.get("pork_cutout")
    bias: BiasLabel = "neutral"
    signal = "neutral"
    reasons: list[str] = []

    if cutout is not None and cutout >= 95:
        bias = "bullish"
        signal = "cutout supportive"
        reasons.append(f"Pork carcass cutout at ${cutout:.2f}/cwt signals firm packer demand.")
    elif cutout is not None and cutout <= 70:
        bias = "bearish"
        signal = "cutout weak"
        reasons.append(f"Pork carcass cutout at ${cutout:.2f}/cwt reflects soft packer demand.")
    else:
        reasons.append(f"Pork carcass cutout at ${cutout:.2f}/cwt — demand is moderate." if cutout else "Cutout data present but value unclear.")

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium",
        "reasons": reasons,
        "warnings": [],
        "metrics": data,
        "report_url": _AMS_PORK_URL,
    }


def fetch_livestock_demand_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Fetch USDA AMS beef or pork cutout as the demand-signal slot for livestock."""
    symbol_code = symbol.upper().lstrip("/")
    is_hog = symbol_code == "HE"
    report_url = _AMS_PORK_URL if is_hog else _AMS_BEEF_URL
    descriptor = AMS_LIVESTOCK_DESCRIPTOR

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        errors: list[str] = []
        parsed: dict[str, Any] | None = None
        published_at: datetime | None = None

        try:
            resp = _safe_get(report_url, timeout_seconds=10)
            text = resp.text
            # Try to extract a report date
            date_m = re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[,.]?\s+([A-Za-z]{3,9})\s+(\d{1,2})[,.]?\s+(\d{4})", text)
            if date_m:
                try:
                    from datetime import datetime as _dt
                    published_at = _dt.strptime(
                        f"{date_m.group(2).strip(',')} {date_m.group(3)} {date_m.group(4)}",
                        "%B %d %Y",
                    ).replace(tzinfo=EASTERN_TZ)
                except ValueError:
                    pass
            parsed = _parse_pork_cutout(text) if is_hog else _parse_beef_cutout(text)
        except Exception as exc:
            errors.append(str(exc))

        health = build_source_health(
            descriptor,
            last_fetched_at=fetched_at if not errors else None,
            published_at=published_at,
            warnings=[],
            errors=errors,
            as_of=as_of or fetched_at,
        )
        interpreted = _interpret_pork_cutout(parsed) if is_hog else _interpret_beef_cutout(parsed)
        return NormalizedSourcePayload(
            descriptor=descriptor,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"livestock_demand:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def fetch_livestock_feed_cost_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Return a feed-cost proxy payload using corn + soymeal price momentum."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        corn = _yahoo_20d_bias("ZC=F")
        meal = _yahoo_20d_bias("ZM=F")
        errors: list[str] = []

        corn_chg = corn.get("change_20d_pct")
        meal_chg = meal.get("change_20d_pct")
        reasons: list[str] = []
        bias: BiasLabel = "neutral"

        if corn_chg is not None and meal_chg is not None:
            avg_chg = (corn_chg + meal_chg) / 2.0
            if avg_chg >= 4.0:
                bias = "bearish"
                reasons.append(
                    f"Feed costs are rising (corn {corn_chg:+.1f}%, soymeal {meal_chg:+.1f}% over 20d) — "
                    "higher input costs compress cattle and hog margins."
                )
            elif avg_chg <= -4.0:
                bias = "bullish"
                reasons.append(
                    f"Feed costs are falling (corn {corn_chg:+.1f}%, soymeal {meal_chg:+.1f}% over 20d) — "
                    "lower input costs support packer and producer margins."
                )
            else:
                reasons.append(
                    f"Feed costs are stable (corn {corn_chg:+.1f}%, soymeal {meal_chg:+.1f}% over 20d) — "
                    "no material margin pressure from inputs."
                )
        else:
            reasons.append("Feed cost data unavailable; margin pressure cannot be assessed.")
            errors = corn.get("warnings", []) + meal.get("warnings", [])

        health = build_source_health(
            FEED_COST_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=[],
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=FEED_COST_DESCRIPTOR,
            source_health=health,
            normalized_output={
                "signal": "feed_cost_proxy",
                "bias": bias,
                "confidence": "medium" if corn_chg is not None else "low",
                "reasons": reasons,
                "warnings": [],
                "corn": corn,
                "soymeal": meal,
            },
            last_updated=health.last_fetched_at,
            warnings=(),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"feed_cost:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def build_livestock_production_cycle(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Return a production-cycle payload for the crop_progress slot of livestock symbols."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()
    reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
    month = reference.month
    crop_stage = get_crop_stage(symbol_code, as_of)

    # Seasonal supply-pressure narrative for cattle/hogs
    if symbol_code in {"LE", "GF"}:
        if month in {10, 11, 12, 1}:
            signal = "seasonal supply pressure"
            bias: BiasLabel = "bearish"
            reasons = [
                "October–January is peak cattle slaughter season as feedlots market summer placements; "
                "seasonal supply pressure typically weighs on nearby contracts."
            ]
        elif month in {2, 3, 4}:
            signal = "tighter seasonal supply"
            bias = "bullish"
            reasons = [
                "February–April cattle supplies typically tighten as winter placements are lighter; "
                "reduced marketings tend to support nearby contract prices."
            ]
        else:
            signal = "neutral seasonal phase"
            bias = "neutral"
            reasons = ["Cattle supply seasonality is not at a notable extreme in this period."]
    else:  # HE (Lean Hogs)
        if month in {5, 6, 7, 8}:
            signal = "peak hog supply season"
            bias = "bearish"
            reasons = [
                "Spring/summer is peak hog marketings; large slaughter numbers typically weigh on lean hog futures."
            ]
        elif month in {1, 2, 3}:
            signal = "seasonal hog tightness"
            bias = "bullish"
            reasons = [
                "Winter hog supplies are seasonally tighter; fewer marketings tend to support nearby prices."
            ]
        else:
            signal = "neutral seasonal phase"
            bias = "neutral"
            reasons = ["Hog supply seasonality is not at a notable extreme in this period."]

    health = build_source_health(
        LIVESTOCK_PRODUCTION_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[],
        errors=[],
        confidence_level="medium",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=LIVESTOCK_PRODUCTION_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "signal": signal,
            "bias": bias,
            "confidence": "medium",
            "reasons": reasons,
            "warnings": [],
            "cycle_stage": crop_stage.get("stage", "production_cycle"),
            "month": month,
        },
        last_updated=health.last_fetched_at,
        warnings=(),
        errors=(),
    )


# ---------------------------------------------------------------------------
# DAIRY ADAPTERS
# ---------------------------------------------------------------------------

_AMS_DAIRY_URL = "https://www.ams.usda.gov/mnreports/dymw500.txt"

# Typical thresholds for Class III pricing signals ($/cwt)
_CHEESE_BLOCK_BULL_THRESHOLD = 1.70   # $/lb – rising cheese → bullish DC futures
_CHEESE_BLOCK_BEAR_THRESHOLD = 1.40
_BUTTER_BULL_THRESHOLD = 2.50
_BUTTER_BEAR_THRESHOLD = 2.10


def _parse_dairy_market_news(text: str) -> dict[str, Any] | None:
    """Parse Grade A cheese block/barrel, butter, and dry whey from AMS dymw500."""
    data: dict[str, float | None] = {
        "cheese_block": None,
        "cheese_barrel": None,
        "butter": None,
        "dry_whey": None,
        "nfdm": None,
    }
    found_any = False

    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        price_m = re.search(r"\$?([\d]+\.[\d]+)", compact)
        price = float(price_m.group(1)) if price_m else None

        if re.search(r"grade\s+a.*cheddar.*block|cheddar\s+block", compact, re.IGNORECASE) and price:
            data["cheese_block"] = price
            found_any = True
        elif re.search(r"grade\s+a.*cheddar.*barrel|cheddar\s+barrel", compact, re.IGNORECASE) and price:
            data["cheese_barrel"] = price
            found_any = True
        elif re.search(r"grade\s+a\s+butter|aa\s+butter|butter.*price", compact, re.IGNORECASE) and price:
            data["butter"] = price
            found_any = True
        elif re.search(r"dry\s+whey", compact, re.IGNORECASE) and price:
            data["dry_whey"] = price
            found_any = True
        elif re.search(r"nonfat\s+dry\s+milk|nfdm", compact, re.IGNORECASE) and price:
            data["nfdm"] = price
            found_any = True

    return data if found_any else None


def _interpret_dairy_prices(data: dict[str, Any] | None, symbol: str) -> dict[str, Any]:
    if not data:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Dairy market price data unavailable from USDA AMS weekly report."],
            "warnings": ["AMS dairy report parse failed or data not yet published."],
        }

    is_class_iv = symbol in {"DAIRY_CLASS_IV"}
    cheese = data.get("cheese_block") or data.get("cheese_barrel")
    butter = data.get("butter")
    reasons: list[str] = []
    bias: BiasLabel = "neutral"
    signal = "neutral"

    # Class III (DC) driven by cheese; Class IV by butter/nfdm
    if is_class_iv:
        key_price = butter
        bull_t, bear_t = _BUTTER_BULL_THRESHOLD, _BUTTER_BEAR_THRESHOLD
        label = "butter"
    else:
        key_price = cheese
        bull_t, bear_t = _CHEESE_BLOCK_BULL_THRESHOLD, _CHEESE_BLOCK_BEAR_THRESHOLD
        label = "cheese block"

    if key_price is not None:
        if key_price >= bull_t:
            bias = "bullish"
            signal = "prices supportive"
            reasons.append(f"{label.title()} at ${key_price:.4f}/lb is at or above the supportive threshold — underpins Class {'IV' if is_class_iv else 'III'} milk pricing.")
        elif key_price <= bear_t:
            bias = "bearish"
            signal = "prices weak"
            reasons.append(f"{label.title()} at ${key_price:.4f}/lb is below the neutral zone — compresses Class {'IV' if is_class_iv else 'III'} milk settlement prices.")
        else:
            reasons.append(f"{label.title()} at ${key_price:.4f}/lb is in mid-range — no strong directional signal from current dairy spot prices.")
    else:
        reasons.append("Key dairy component price was not parseable from this week's report.")

    # Supplemental notes from secondary components
    if cheese and not is_class_iv and cheese is not key_price:
        pass  # already covered above
    if butter and is_class_iv and butter is not key_price:
        pass

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium" if key_price is not None else "low",
        "reasons": reasons,
        "warnings": [],
        "metrics": data,
        "report_url": _AMS_DAIRY_URL,
    }


def fetch_dairy_market_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Fetch USDA AMS Weekly Dairy Market News for the export_demand slot of dairy symbols."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        errors: list[str] = []
        parsed: dict[str, Any] | None = None
        published_at: datetime | None = None

        try:
            resp = _safe_get(_AMS_DAIRY_URL, timeout_seconds=10)
            text = resp.text
            date_m = re.search(r"Week\s+Ending[:\s]+([A-Za-z]+\s+\d+,?\s+\d{4})", text, re.IGNORECASE)
            if date_m:
                try:
                    from datetime import datetime as _dt
                    published_at = _dt.strptime(
                        date_m.group(1).strip().rstrip(","), "%B %d %Y"
                    ).replace(tzinfo=EASTERN_TZ)
                except ValueError:
                    pass
            parsed = _parse_dairy_market_news(text)
        except Exception as exc:
            errors.append(str(exc))

        health = build_source_health(
            AMS_DAIRY_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=published_at,
            warnings=[],
            errors=errors,
            as_of=as_of or fetched_at,
        )
        interpreted = _interpret_dairy_prices(parsed, symbol_code)
        return NormalizedSourcePayload(
            descriptor=AMS_DAIRY_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"dairy_market:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def build_dairy_global_context(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Seasonal global dairy production cycle for the global_supply slot."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()
    reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
    month = reference.month

    # Southern Hemisphere (NZ/Australia) peaks Oct-Dec; Northern peaks Apr-Jun
    if month in {10, 11, 12}:
        bias: BiasLabel = "bearish"
        signal = "SH flush season"
        reasons = [
            "October–December is peak New Zealand and Australia milk production (Southern Hemisphere flush) — "
            "global dairy supplies typically peak, pressuring international cheese and butter prices."
        ]
    elif month in {4, 5, 6}:
        bias = "bearish"
        signal = "NH flush season"
        reasons = [
            "April–June is peak EU and US milk production (spring flush) — "
            "seasonal supply surplus tends to weigh on nearby dairy futures."
        ]
    elif month in {1, 2, 3}:
        bias = "bullish"
        signal = "NH tighter supply"
        reasons = [
            "January–March dairy output is seasonally lighter in major producing regions — "
            "tighter supply tends to provide underlying support for Class III and IV prices."
        ]
    else:
        bias = "neutral"
        signal = "neutral seasonal phase"
        reasons = ["Global dairy production seasonality is not at a notable extreme in this period."]

    health = build_source_health(
        GLOBAL_DAIRY_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[],
        errors=[],
        confidence_level="medium",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=GLOBAL_DAIRY_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "signal": signal,
            "bias": bias,
            "confidence": "medium",
            "reasons": reasons,
            "warnings": [],
            "month": month,
        },
        last_updated=health.last_fetched_at,
        warnings=(),
        errors=(),
    )


# ---------------------------------------------------------------------------
# SOFTS ADAPTERS
# ---------------------------------------------------------------------------

# USDA FAS PSD commodity codes (no API key required)
_FAS_PSD_BASE = "https://apps.fas.usda.gov/psdonline/api/0/data"

_FAS_COMMODITY_CODES = {
    "KC": "0813100",   # Coffee, Arabica
    "CC": "0622400",   # Cocoa Beans
    "OJ": "0580300",   # Orange Juice
    "RS": "2222000",   # Rapeseed/Canola
}

_FAS_ATTRIBUTE_IDS = {
    "production": 28,
    "exports": 88,
    "imports": 57,
    "ending_stocks": 176,
}

# Major origin countries (ISO codes used by FAS) and their supply/demand role
_SOFTS_ORIGIN_COUNTRIES = {
    "KC": [("0231", "Brazil", "supply"), ("0231", "Brazil", "supply"), ("2251", "Vietnam", "supply"), ("1351", "Colombia", "supply")],
    "CC": [("1143", "Cote d'Ivoire", "supply"), ("1144", "Ghana", "supply"), ("0231", "Brazil", "supply"), ("5110", "Indonesia", "supply")],
    "OJ": [("0231", "Brazil", "supply"), ("0100", "United States", "supply"), ("5121", "Mexico", "supply")],
    "RS": [("1011", "Canada", "supply"), ("0231", "Brazil", "supply"), ("4104", "Australia", "supply"), ("0100", "United States", "supply")],
}

_SOFTS_CROP_CALENDAR = {
    "KC": {
        (4, 5, 6, 7): ("flowering", "bullish", "Brazil main-crop flowering/fruiting — weather risk is elevated."),
        (9, 10, 11): ("harvest", "neutral", "Brazil Conilon/Arabica harvest underway — supply becoming clearer."),
        (1, 2, 3): ("off-season", "neutral", "Inter-harvest period; trade flow data key."),
        (8, 12): ("biennial cycle", "neutral", "Arabica biennial cycle sets expectations for next crop."),
    },
    "CC": {
        (9, 10, 11, 12): ("main crop", "bullish", "West Africa main crop assessment — pod development risk key."),
        (4, 5, 6): ("mid-crop", "neutral", "West Africa mid-crop (smaller); early assessment season."),
        (1, 2, 3, 7, 8): ("off-season", "neutral", "Between major harvest windows."),
    },
    "OJ": {
        (12, 1, 2): ("Florida harvest", "bearish", "Florida harvest season — fresh supply arriving."),
        (8, 9, 10, 11): ("growing season", "bullish", "Florida growing season and hurricane risk window."),
        (3, 4, 5, 6, 7): ("late season", "neutral", "Late Florida season; Brazil imports fill gaps."),
    },
    "RS": {
        (4, 5, 6): ("Canada planting", "neutral", "Canadian canola planting — early season."),
        (7, 8, 9): ("Canada harvest", "bearish", "Canadian canola harvest — supply clarity builds."),
        (10, 11, 12, 1, 2, 3): ("Australian season", "neutral", "Australia planting/harvest cycle running."),
    },
}


def _get_softs_crop_season(symbol: str, month: int) -> tuple[str, BiasLabel, str]:
    """Return (stage, bias, reason) for a soft commodity in the given calendar month."""
    calendar = _SOFTS_CROP_CALENDAR.get(symbol.upper(), {})
    for months_tuple, (stage, bias_str, reason) in calendar.items():
        if month in months_tuple:
            return stage, bias_str, reason  # type: ignore[return-value]
    return "off-season", "neutral", "No major crop calendar event this month."


def _fetch_fas_psd_world_production(commodity_code: str, market_year: int) -> dict[str, Any] | None:
    """Call FAS PSD API for world production data. Returns None on failure."""
    try:
        url = (
            f"{_FAS_PSD_BASE}/cropData"
            f"?commodityCode={commodity_code}"
            f"&marketYear={market_year}"
            f"&countryCode=0000"  # 0000 = World
        )
        resp = _safe_get(url, timeout_seconds=12)
        data = resp.json()
        if not isinstance(data, list) or len(data) == 0:
            return None

        # Find latest month's projection
        production_entries = [e for e in data if e.get("attributeId") == _FAS_ATTRIBUTE_IDS["production"]]
        stocks_entries = [e for e in data if e.get("attributeId") == _FAS_ATTRIBUTE_IDS["ending_stocks"]]

        def _latest_value(entries: list) -> float | None:
            if not entries:
                return None
            latest = max(entries, key=lambda e: e.get("monthNumber", 0))
            try:
                return float(latest["value"])
            except (KeyError, ValueError, TypeError):
                return None

        return {
            "world_production": _latest_value(production_entries),
            "world_ending_stocks": _latest_value(stocks_entries),
            "market_year": market_year,
        }
    except Exception:
        return None


def _interpret_softs_world_supply(
    symbol: str,
    psd_data: dict[str, Any] | None,
    crop_stage: str,
    crop_bias: BiasLabel,
    crop_reason: str,
    month: int,
) -> dict[str, Any]:
    reasons: list[str] = [crop_reason]
    bias = crop_bias
    signal = crop_stage

    if psd_data:
        prod = psd_data.get("world_production")
        stocks = psd_data.get("world_ending_stocks")
        year = psd_data.get("market_year")
        if prod:
            reasons.append(f"World production for {year}/{str(year + 1)[-2:]}: {prod:,.0f} thousand MT (FAS estimate).")
        if stocks:
            reasons.append(f"World ending stocks: {stocks:,.0f} thousand MT.")
    else:
        reasons.append("FAS PSD world production data unavailable; seasonal context used.")

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium" if psd_data else "low",
        "reasons": reasons,
        "warnings": [] if psd_data else ["FAS PSD API unavailable — seasonal context only."],
        "psd_data": psd_data,
    }


def fetch_softs_world_production_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Fetch USDA FAS PSD world production for the global_supply slot of softs."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
        month = reference.month
        year = reference.year
        market_year = year if month >= 10 else year - 1  # coffee/cocoa MYs often start Oct

        commodity_code = _FAS_COMMODITY_CODES.get(symbol_code)
        errors: list[str] = []
        psd_data: dict[str, Any] | None = None

        if commodity_code:
            try:
                psd_data = _fetch_fas_psd_world_production(commodity_code, market_year)
                if not psd_data:
                    psd_data = _fetch_fas_psd_world_production(commodity_code, market_year + 1)
            except Exception as exc:
                errors.append(str(exc))

        stage, crop_bias, crop_reason = _get_softs_crop_season(symbol_code, month)
        interpreted = _interpret_softs_world_supply(symbol_code, psd_data, stage, crop_bias, crop_reason, month)

        health = build_source_health(
            FAS_PSD_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=interpreted.get("warnings", []),
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=FAS_PSD_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"softs_world:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def build_softs_crop_conditions(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Return a crop-conditions payload for the crop_progress slot of softs symbols."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()
    reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
    month = reference.month
    stage, bias, reason = _get_softs_crop_season(symbol_code, month)

    # Additional commodity-specific context
    extra_context = {
        "KC": "Brazil is the world's largest coffee producer; La Nina/El Nino weather cycles in Minas Gerais are the primary supply risk.",
        "CC": "Cote d'Ivoire + Ghana supply ~60% of global cocoa; Black pod disease and harmattan wind conditions are key risks.",
        "OJ": "Florida USDA crop forecast and freeze probability drive OJ price volatility; Brazil fills supply gaps.",
        "CT": "US weekly export sales and Adjusted World Price (AWP) are the primary weekly demand catalysts.",
        "SB": "Brazil is the swing supplier; India domestic use/export policy drives global sugar balance.",
        "RS": "Canadian carry-out stocks and export pace versus Australia alternate-year production cycles.",
    }.get(symbol_code, "")

    reasons = [reason]
    if extra_context:
        reasons.append(extra_context)

    health = build_source_health(
        SOFTS_CONDITIONS_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[],
        errors=[],
        confidence_level="medium",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=SOFTS_CONDITIONS_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "signal": stage,
            "bias": bias,
            "confidence": "medium",
            "reasons": reasons,
            "warnings": [],
            "month": month,
            "crop_stage": stage,
        },
        last_updated=health.last_fetched_at,
        warnings=(),
        errors=(),
    )


# ---------------------------------------------------------------------------
# LUMBER / HOUSING ADAPTERS
# ---------------------------------------------------------------------------

def _interpret_housing_series(values: list[float], series_label: str, unit: str) -> dict[str, Any]:
    if not values:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": [f"{series_label} data unavailable from FRED."],
            "warnings": ["FRED API key not set or request failed."],
        }
    bias = _trend_bias(values, short_window=3)
    recent_avg = sum(values[-3:]) / 3 if len(values) >= 3 else values[-1]
    full_avg = sum(values) / len(values)
    pct = (recent_avg / full_avg - 1.0) * 100.0
    reasons: list[str] = []
    signal: str

    if bias == "bullish":
        signal = "construction demand rising"
        reasons.append(
            f"{series_label} averaging {recent_avg:,.0f}{unit} over the last 3 months, "
            f"{pct:+.1f}% above the 12-month average — rising construction activity supports lumber demand."
        )
    elif bias == "bearish":
        signal = "construction demand declining"
        reasons.append(
            f"{series_label} averaging {recent_avg:,.0f}{unit} over the last 3 months, "
            f"{pct:+.1f}% below the 12-month average — slowing construction reduces lumber demand."
        )
    else:
        signal = "construction demand stable"
        reasons.append(
            f"{series_label} averaging {recent_avg:,.0f}{unit} over the last 3 months — "
            "construction activity is broadly in line with the 12-month trend."
        )
    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium" if len(values) >= 6 else "low",
        "reasons": reasons,
        "warnings": [],
        "recent_avg": round(recent_avg, 1),
        "full_avg": round(full_avg, 1),
        "series": series_label,
    }


def fetch_housing_demand_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Fetch FRED Housing Starts for the wasde/supply-demand slot of lumber symbols."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        errors: list[str] = []
        values = _fred_series_last_n("HOUST", n=13)
        if not values:
            errors.append("FRED HOUST series unavailable (key not set or request failed).")

        interpreted = _interpret_housing_series(values, "Housing Starts", "k units/yr")
        health = build_source_health(
            HOUSING_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=interpreted.get("warnings", []),
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=HOUSING_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"housing_starts:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def fetch_building_permits_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Fetch FRED Building Permits for the crop_progress/leading-indicator slot of lumber."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        errors: list[str] = []
        values = _fred_series_last_n("PERMIT", n=13)
        if not values:
            errors.append("FRED PERMIT series unavailable (key not set or request failed).")

        interpreted = _interpret_housing_series(values, "Building Permits", "k units/yr")
        health = build_source_health(
            BUILDING_PERMITS_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=interpreted.get("warnings", []),
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=BUILDING_PERMITS_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"building_permits:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def build_lumber_global_context(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Seasonal lumber demand context for the global_supply slot."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()
    reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
    month = reference.month

    # Lumber demand follows housing construction seasonality
    if month in {3, 4, 5, 6}:
        bias: BiasLabel = "bullish"
        signal = "spring construction season"
        reasons = [
            "March–June is peak US housing construction season — builders ramp activity, driving peak lumber demand.",
        ]
    elif month in {11, 12, 1, 2}:
        bias = "bearish"
        signal = "winter construction slowdown"
        reasons = [
            "November–February sees construction slowdowns due to weather, reducing near-term lumber consumption.",
        ]
    else:
        bias = "neutral"
        signal = "shoulder season"
        reasons = ["Construction activity in transition between peak and off-peak seasons."]

    reasons.append(
        "Key structural drivers: 30-year mortgage rates (inverse), housing affordability index, "
        "multi-family vs single-family starts mix (lumber-intensive single-family is the key driver)."
    )

    health = build_source_health(
        BUILDING_PERMITS_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[],
        errors=[],
        confidence_level="medium",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=BUILDING_PERMITS_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "signal": signal,
            "bias": bias,
            "confidence": "medium",
            "reasons": reasons,
            "warnings": [],
            "month": month,
        },
        last_updated=health.last_fetched_at,
        warnings=(),
        errors=(),
    )


# ---------------------------------------------------------------------------
# FERTILIZER INPUT ADAPTERS
# ---------------------------------------------------------------------------

def _interpret_nat_gas(values: list[float], symbol: str) -> dict[str, Any]:
    if not values:
        return {
            "signal": "insufficient_data",
            "bias": "neutral",
            "confidence": "low",
            "reasons": ["Henry Hub natural gas data unavailable from FRED."],
            "warnings": ["FRED API key not set or DHHNGSP request failed."],
        }
    bias = _trend_bias(values, short_window=5)
    recent_avg = sum(values[-5:]) / 5 if len(values) >= 5 else values[-1]
    full_avg = sum(values) / len(values)
    pct = (recent_avg / full_avg - 1.0) * 100.0
    signal: str

    # For FERT_N: high NG = higher ammonia production cost = bullish nitrogen
    # For FERT_P/FERT_K: NG is an energy input to mining/processing, directionally similar
    if bias == "bullish":
        signal = "input costs rising"
        reasons = [
            f"Henry Hub natural gas recently averaging ${recent_avg:.2f}/MMBtu, "
            f"{pct:+.1f}% above recent norm — rising feedstock costs support nitrogen (urea/ammonia) pricing."
        ]
    elif bias == "bearish":
        signal = "input costs declining"
        reasons = [
            f"Henry Hub natural gas recently averaging ${recent_avg:.2f}/MMBtu, "
            f"{pct:+.1f}% below recent norm — declining feedstock costs pressure fertilizer production margins."
        ]
    else:
        signal = "input costs stable"
        reasons = [
            f"Henry Hub natural gas stable near ${recent_avg:.2f}/MMBtu — "
            "no major energy-cost shock to fertilizer production."
        ]

    return {
        "signal": signal,
        "bias": bias,
        "confidence": "medium",
        "reasons": reasons,
        "warnings": [],
        "recent_avg_mmbtu": round(recent_avg, 3),
    }


def fetch_fertilizer_input_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """FRED Henry Hub natural gas as the supply-cost signal for fertilizer inputs."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        errors: list[str] = []
        values = _fred_series_last_n("DHHNGSP", n=20)
        if not values:
            errors.append("FRED DHHNGSP series unavailable.")

        interpreted = _interpret_nat_gas(values, symbol_code)
        health = build_source_health(
            NAT_GAS_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=interpreted.get("warnings", []),
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=NAT_GAS_DESCRIPTOR,
            source_health=health,
            normalized_output=interpreted,
            last_updated=health.last_fetched_at,
            warnings=tuple(interpreted.get("warnings", [])),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"fertilizer_input:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def fetch_fertilizer_demand_source(
    symbol: str,
    as_of: datetime | None = None,
    *,
    force_refresh: bool = False,
) -> NormalizedSourcePayload:
    """Crop-price-based demand proxy for the export_demand slot of fertilizer inputs."""
    symbol_code = symbol.upper().lstrip("/")

    def _build() -> NormalizedSourcePayload:
        fetched_at = _utcnow()
        reference = (as_of or fetched_at).astimezone(EASTERN_TZ)
        month = reference.month

        corn = _yahoo_20d_bias("ZC=F")
        soy = _yahoo_20d_bias("ZS=F")
        errors: list[str] = corn.get("warnings", []) + soy.get("warnings", [])

        corn_chg = corn.get("change_20d_pct")
        soy_chg = soy.get("change_20d_pct")
        reasons: list[str] = []
        bias: BiasLabel = "neutral"

        # Seasonal demand cycle for fertilizer
        if month in {3, 4, 5}:
            reasons.append("Spring application season — fertilizer demand is at annual peak as US growers apply pre-plant nutrients.")
            bias = "bullish"
        elif month in {9, 10, 11}:
            reasons.append("Fall application season — post-harvest soil conditioning creates secondary demand peak.")
        else:
            reasons.append("Off-peak fertilizer application period; demand follows earlier seasonal pull-forward.")

        # Crop price as willingness-to-pay signal
        if corn_chg is not None and soy_chg is not None:
            avg_chg = (corn_chg + soy_chg) / 2.0
            if avg_chg >= 4.0:
                if bias != "bullish":
                    bias = "bullish"
                reasons.append(f"Corn ({corn_chg:+.1f}%) and soybean ({soy_chg:+.1f}%) prices rising — higher crop revenues incentivize aggressive fertilizer spending.")
            elif avg_chg <= -4.0:
                if bias not in {"bearish"}:
                    bias = "bearish"
                reasons.append(f"Crop prices declining (corn {corn_chg:+.1f}%, soybeans {soy_chg:+.1f}%) — lower margins reduce grower willingness to pay for inputs.")
            else:
                reasons.append(f"Crop prices stable (corn {corn_chg:+.1f}%, soybeans {soy_chg:+.1f}%) — demand signal neutral.")
        else:
            reasons.append("Crop price data unavailable; seasonal narrative used.")

        health = build_source_health(
            FERTILIZER_DEMAND_DESCRIPTOR,
            last_fetched_at=fetched_at if not errors else None,
            published_at=fetched_at,
            warnings=[],
            errors=errors,
            as_of=as_of or fetched_at,
        )
        return NormalizedSourcePayload(
            descriptor=FERTILIZER_DEMAND_DESCRIPTOR,
            source_health=health,
            normalized_output={
                "signal": "planting_demand_proxy",
                "bias": bias,
                "confidence": "medium" if corn_chg is not None else "low",
                "reasons": reasons,
                "warnings": [],
                "corn": corn,
                "soy": soy,
                "month": month,
            },
            last_updated=health.last_fetched_at,
            warnings=(),
            errors=tuple(errors),
        )

    return _with_daily_source_cache(
        f"fertilizer_demand:{symbol_code}",
        as_of=as_of,
        force_refresh=force_refresh,
        builder=_build,
    )


def build_fertilizer_global_context(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Global fertilizer trade context for the global_supply slot."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()

    contexts = {
        "FERT_N": (
            "neutral",
            [
                "Russia and Belarus supply ~40% of global nitrogen fertilizer exports; sanctions and export quotas create ongoing supply uncertainty.",
                "Chinese export restrictions on urea remain a structural swing factor for global ammonia/nitrogen pricing.",
                "Henry Hub natural gas price (see supply balance) is the primary production cost driver for US ammonia/urea.",
            ],
        ),
        "FERT_P": (
            "neutral",
            [
                "Mosaic Company (MOS) is the largest US phosphate producer; global phosphate pricing ties to Moroccan OCP and Saudi MAADEN production levels.",
                "Chinese phosphate export quotas (often announced Oct–Dec) drive the most significant short-term supply shocks.",
                "Phosphate demand correlates with corn/soybean planting intent in North and South America.",
            ],
        ),
        "FERT_K": (
            "neutral",
            [
                "Canpotex (Nutrien/Mosaic consortium) and Belarusian Potash Company (BPC/Belaruskali) control global potash export swing capacity.",
                "BPC sanctions have structurally removed supply, tightening the global potash balance.",
                "India/China contract negotiations (typically Q1 each year) set the benchmark price for global potash trade.",
            ],
        ),
    }

    bias_str, reasons = contexts.get(symbol_code, ("neutral", ["Global fertilizer trade context unavailable for this symbol."]))
    bias: BiasLabel = bias_str  # type: ignore[assignment]

    health = build_source_health(
        NAT_GAS_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=[],
        errors=[],
        confidence_level="medium",
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=NAT_GAS_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "signal": "global_trade_context",
            "bias": bias,
            "confidence": "medium",
            "reasons": reasons,
            "warnings": [],
        },
        last_updated=health.last_fetched_at,
        warnings=(),
        errors=(),
    )


# ---------------------------------------------------------------------------
# NON-GRAIN REPORT CALENDAR
# ---------------------------------------------------------------------------

_NONGRAIN_REPORTS: dict[str, list[tuple[str, str, str]]] = {
    # group → [(report_name, impact, schedule_note)]
    "livestock": [
        ("Cattle on Feed", "high", "monthly:last_friday"),
        ("Hogs and Pigs", "high", "quarterly:march_june_sept_dec"),
        ("Cold Storage", "medium", "monthly:last_wednesday"),
        ("Livestock Slaughter", "medium", "monthly:~21st"),
    ],
    "dairy": [
        ("Milk Production", "high", "monthly:~25th"),
        ("Dairy Products", "medium", "monthly:~30th"),
        ("Cold Storage", "medium", "monthly:last_wednesday"),
        ("Agricultural Prices", "medium", "monthly:last_friday"),
    ],
    "softs": [
        ("WASDE", "high", "monthly:~10th"),
        ("Export Sales", "medium", "weekly:thursday_8:30am"),
        ("Crop Progress", "medium", "weekly:monday"),
        ("USDA FAS World Production", "medium", "monthly"),
    ],
    "lumber": [
        ("Housing Starts", "high", "monthly:~17th"),
        ("Building Permits", "high", "monthly:~17th"),
        ("NAHB Housing Market Index", "medium", "monthly:~16th"),
        ("Existing Home Sales", "medium", "monthly:~22nd"),
    ],
    "fertilizer_inputs": [
        ("WASDE", "high", "monthly:~10th"),
        ("Agricultural Prices", "medium", "monthly:last_friday"),
        ("EIA Natural Gas Storage", "medium", "weekly:thursday"),
        ("Prospective Plantings", "high", "annual:march_31"),
    ],
}

# Group membership lookup
_SYMBOL_TO_GROUP: dict[str, str] = {}
for _sym in LIVESTOCK_SYMBOLS:
    _SYMBOL_TO_GROUP[_sym] = "livestock"
for _sym in DAIRY_SYMBOLS:
    _SYMBOL_TO_GROUP[_sym] = "dairy"
for _sym in SOFTS_SYMBOLS:
    _SYMBOL_TO_GROUP[_sym] = "softs"
for _sym in LUMBER_SYMBOLS:
    _SYMBOL_TO_GROUP[_sym] = "lumber"
for _sym in FERTILIZER_SYMBOLS:
    _SYMBOL_TO_GROUP[_sym] = "fertilizer_inputs"


def _next_occurrence_of_weekday(reference: datetime, target_weekday: int, release_time: time, allow_today: bool = False) -> datetime:
    """Return the next occurrence of target_weekday (0=Mon..6=Sun) at release_time."""
    candidate = datetime.combine(reference.date(), release_time, tzinfo=EASTERN_TZ)
    delta = (target_weekday - reference.weekday()) % 7
    if delta == 0 and (not allow_today or candidate < reference):
        delta = 7
    return candidate + timedelta(days=delta)


def _next_occurrence_of_day(reference: datetime, day_of_month: int) -> datetime:
    """Return next occurrence of day_of_month at noon ET."""
    year, month = reference.year, reference.month
    candidate_day = day_of_month
    try:
        candidate = datetime(year, month, candidate_day, 12, 0, tzinfo=EASTERN_TZ)
    except ValueError:
        # day_of_month > days in month; use last day
        import calendar
        candidate = datetime(year, month, calendar.monthrange(year, month)[1], 12, 0, tzinfo=EASTERN_TZ)
    if candidate < reference:
        # Advance to next month
        month += 1
        if month > 12:
            month, year = 1, year + 1
        try:
            candidate = datetime(year, month, candidate_day, 12, 0, tzinfo=EASTERN_TZ)
        except ValueError:
            import calendar
            candidate = datetime(year, month, calendar.monthrange(year, month)[1], 12, 0, tzinfo=EASTERN_TZ)
    return candidate


def _project_nongrain_upcoming(symbol: str, reference: datetime) -> list[dict[str, Any]]:
    group = _SYMBOL_TO_GROUP.get(symbol, "")
    report_defs = _NONGRAIN_REPORTS.get(group, [])
    upcoming: list[dict[str, Any]] = []

    for report_name, impact, schedule in report_defs:
        release_dt: datetime | None = None

        if "monthly:last_friday" in schedule:
            # Find last Friday of next month
            ref_m = reference.month + 1
            ref_y = reference.year
            if ref_m > 12:
                ref_m, ref_y = 1, ref_y + 1
            import calendar
            last_day = calendar.monthrange(ref_y, ref_m)[1]
            candidate = datetime(ref_y, ref_m, last_day, 15, 0, tzinfo=EASTERN_TZ)
            while candidate.weekday() != 4:  # 4 = Friday
                candidate -= timedelta(days=1)
            release_dt = candidate
        elif "monthly:last_wednesday" in schedule:
            ref_m = reference.month + 1
            ref_y = reference.year
            if ref_m > 12:
                ref_m, ref_y = 1, ref_y + 1
            import calendar
            last_day = calendar.monthrange(ref_y, ref_m)[1]
            candidate = datetime(ref_y, ref_m, last_day, 14, 0, tzinfo=EASTERN_TZ)
            while candidate.weekday() != 2:  # 2 = Wednesday
                candidate -= timedelta(days=1)
            release_dt = candidate
        elif "quarterly:march_june_sept_dec" in schedule:
            next_quarter_months = [3, 6, 9, 12]
            for qm in next_quarter_months:
                candidate = datetime(reference.year, qm, 28, 15, 0, tzinfo=EASTERN_TZ)
                while candidate.weekday() != 3:  # Thursday
                    candidate -= timedelta(days=1)
                if candidate >= reference:
                    release_dt = candidate
                    break
            if release_dt is None:
                release_dt = datetime(reference.year + 1, 3, 28, 15, 0, tzinfo=EASTERN_TZ)
                while release_dt.weekday() != 3:
                    release_dt -= timedelta(days=1)
        elif "monthly:~17th" in schedule:
            release_dt = _next_occurrence_of_day(reference, 17)
        elif "monthly:~25th" in schedule:
            release_dt = _next_occurrence_of_day(reference, 25)
        elif "monthly:~30th" in schedule:
            release_dt = _next_occurrence_of_day(reference, 28)  # safe approximation
        elif "monthly:~21st" in schedule:
            release_dt = _next_occurrence_of_day(reference, 21)
        elif "monthly:~22nd" in schedule:
            release_dt = _next_occurrence_of_day(reference, 22)
        elif "monthly:~16th" in schedule:
            release_dt = _next_occurrence_of_day(reference, 16)
        elif "monthly:~10th" in schedule:
            release_dt = _next_occurrence_of_day(reference, 10)
        elif "monthly:last_friday" in schedule:
            pass  # handled above
        elif "weekly:thursday_8:30am" in schedule:
            release_dt = _next_occurrence_of_weekday(reference, 3, time(8, 30))
        elif "weekly:thursday" in schedule:
            release_dt = _next_occurrence_of_weekday(reference, 3, time(10, 30))
        elif "weekly:monday" in schedule:
            release_dt = _next_occurrence_of_weekday(reference, 0, time(16, 0))
        elif "annual:march_31" in schedule:
            year = reference.year
            candidate = datetime(year, 3, 31, 12, 0, tzinfo=EASTERN_TZ)
            if candidate < reference:
                candidate = datetime(year + 1, 3, 31, 12, 0, tzinfo=EASTERN_TZ)
            release_dt = candidate
        elif "monthly" in schedule:
            release_dt = _next_occurrence_of_day(reference, 15)
        else:
            release_dt = _next_occurrence_of_day(reference, 15)

        if release_dt:
            upcoming.append({
                "report": report_name,
                "release_at": release_dt.isoformat(),
                "impact": impact,
                "affected_markets": [symbol],
            })

    upcoming.sort(key=lambda x: x["release_at"])
    return upcoming


def build_nongrain_report_calendar(
    symbol: str,
    as_of: datetime | None = None,
) -> NormalizedSourcePayload:
    """Build a group-appropriate report calendar without triggering a WASDE lookup."""
    symbol_code = symbol.upper().lstrip("/")
    fetched_at = _utcnow()
    reference = (as_of or fetched_at).astimezone(EASTERN_TZ)

    upcoming = _project_nongrain_upcoming(symbol_code, reference)
    next_report = upcoming[0] if upcoming else None
    warnings: list[str] = []
    if not next_report:
        warnings.append("No upcoming report identified for this symbol group.")

    health = build_source_health(
        REPORT_CALENDAR_DESCRIPTOR,
        last_fetched_at=fetched_at,
        published_at=fetched_at,
        warnings=warnings,
        errors=[],
        as_of=as_of or fetched_at,
    )
    return NormalizedSourcePayload(
        descriptor=REPORT_CALENDAR_DESCRIPTOR,
        source_health=health,
        normalized_output={
            "next_report": next_report,
            "upcoming_reports": upcoming[:6],
        },
        last_updated=health.last_fetched_at,
        warnings=tuple(warnings),
        errors=(),
    )
