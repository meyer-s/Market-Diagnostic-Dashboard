from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

import pandas as pd

from app.services.ingestion.yahoo_client import YahooClient, YahooClientError
from app.services.market_context.agriculture_adapters import (
    AG_TICKERS,
    build_global_supply_payload,
    fetch_crop_progress_source,
    fetch_export_inspections_source,
    fetch_report_calendar_source,
    fetch_wasde_source,
    fetch_weather_source,
)
from app.services.market_context.agriculture_metadata import resolve_agriculture_commodity
from app.services.market_context.commodity_specific_adapters import (
    DAIRY_SYMBOLS,
    FERTILIZER_SYMBOLS,
    GRAIN_OILSEED_SYMBOLS,
    LIVESTOCK_SYMBOLS,
    LUMBER_SYMBOLS,
    SOFTS_SYMBOLS,
    build_dairy_global_context,
    build_fertilizer_global_context,
    build_livestock_production_cycle,
    build_lumber_global_context,
    build_nongrain_report_calendar,
    build_softs_crop_conditions,
    fetch_building_permits_source,
    fetch_dairy_market_source,
    fetch_fertilizer_demand_source,
    fetch_fertilizer_input_source,
    fetch_housing_demand_source,
    fetch_livestock_demand_source,
    fetch_livestock_feed_cost_source,
    fetch_softs_world_production_source,
)
from app.services.market_context.crop_stage import get_crop_stage
from app.services.market_context.scoring import compute_context_score, synthesize_trade_setup
from app.services.market_context.session import get_market_session_status
from app.services.market_context.thesis import generate_market_read, validate_generated_thesis


_CONTEXT_CACHE: dict[str, dict[str, Any]] = {}
_CONTEXT_CACHE_LOCK = Lock()
_CONTEXT_CACHE_TTL = timedelta(minutes=10)


def _series_to_pd(rows: list[dict[str, Any]]) -> pd.Series:
    if not rows:
        return pd.Series(dtype="float64")
    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["date", "value"]).sort_values("date")
    return pd.Series(frame["value"].values, index=frame["date"])


def _technical_signal(symbol: str) -> dict[str, Any]:
    ticker = AG_TICKERS[symbol]
    fetched_at = datetime.now(timezone.utc)
    try:
        rows = YahooClient().fetch_series(
            ticker=ticker,
            start_date=(fetched_at - timedelta(days=220)).strftime("%Y-%m-%d"),
            end_date=(fetched_at + timedelta(days=1)).strftime("%Y-%m-%d"),
            interval="1d",
        )
        series = _series_to_pd(rows)
        if len(series) < 80:
            raise YahooClientError("Insufficient history for technical signal")
        latest = float(series.iloc[-1])
        change_20d = ((latest / float(series.iloc[-21])) - 1.0) * 100.0
        change_60d = ((latest / float(series.iloc[-61])) - 1.0) * 100.0
        change_120d = ((latest / float(series.iloc[-121])) - 1.0) * 100.0 if len(series) > 121 else None
        if change_20d > 0 and change_60d >= 0:
            bias = "bullish"
        elif change_20d < 0 and change_60d <= 0:
            bias = "bearish"
        else:
            bias = "neutral"
        return {
            "ticker": ticker,
            "current_price": round(latest, 4),
            "change_20d": round(change_20d, 2),
            "change_60d": round(change_60d, 2),
            "change_120d": round(change_120d, 2) if change_120d is not None else None,
            "bias": bias,
            "confidence": "medium",
        }
    except Exception as exc:
        return {
            "ticker": ticker,
            "bias": "neutral",
            "confidence": "low",
            "warnings": [str(exc)],
        }


def build_agriculture_market_context(symbol: str, as_of: datetime | None = None) -> dict[str, Any]:
    reference = as_of or datetime.now(timezone.utc)
    symbol_code = symbol.upper().lstrip("/")

    if as_of is None:
        with _CONTEXT_CACHE_LOCK:
            cached = _CONTEXT_CACHE.get(symbol_code)
            if cached and (reference - cached["timestamp"]) <= _CONTEXT_CACHE_TTL:
                return cached["payload"]

    commodity = resolve_agriculture_commodity(symbol_code)
    session = get_market_session_status(reference)
    crop_stage = get_crop_stage(symbol_code, reference)

    # ------------------------------------------------------------------
    # Adapter routing — grain/oilseed symbols use WASDE-centric adapters;
    # non-grain groups use commodity-specific sources.
    # ------------------------------------------------------------------
    weather_payload = fetch_weather_source(symbol_code, reference)
    wasde_payload, global_context = fetch_wasde_source(symbol_code, reference)

    if symbol_code in GRAIN_OILSEED_SYMBOLS:
        crop_progress_payload = fetch_crop_progress_source(symbol_code, reference)
        export_payload = fetch_export_inspections_source(symbol_code, reference)
        global_payload = build_global_supply_payload(
            symbol_code,
            global_context,
            source_health=wasde_payload.source_health,
        )
        report_calendar_payload = fetch_report_calendar_source(symbol_code, reference)

    elif symbol_code in LIVESTOCK_SYMBOLS:
        crop_progress_payload = build_livestock_production_cycle(symbol_code, reference)
        export_payload = fetch_livestock_demand_source(symbol_code, reference)
        global_payload = fetch_livestock_feed_cost_source(symbol_code, reference)
        report_calendar_payload = build_nongrain_report_calendar(symbol_code, reference)

    elif symbol_code in DAIRY_SYMBOLS:
        crop_progress_payload = fetch_dairy_market_source(symbol_code, reference)
        export_payload = fetch_dairy_market_source(symbol_code, reference)
        global_payload = build_dairy_global_context(symbol_code, reference)
        report_calendar_payload = build_nongrain_report_calendar(symbol_code, reference)

    elif symbol_code in SOFTS_SYMBOLS:
        crop_progress_payload = build_softs_crop_conditions(symbol_code, reference)
        # CT and SB export data from WASDE; KC/CC/OJ/RS from FAS PSD
        export_payload = fetch_softs_world_production_source(symbol_code, reference)
        global_payload = build_global_supply_payload(
            symbol_code,
            global_context,
            source_health=wasde_payload.source_health,
        )
        report_calendar_payload = build_nongrain_report_calendar(symbol_code, reference)

    elif symbol_code in LUMBER_SYMBOLS:
        crop_progress_payload = fetch_building_permits_source(symbol_code, reference)
        export_payload = fetch_housing_demand_source(symbol_code, reference)
        global_payload = build_lumber_global_context(symbol_code, reference)
        report_calendar_payload = build_nongrain_report_calendar(symbol_code, reference)

    elif symbol_code in FERTILIZER_SYMBOLS:
        crop_progress_payload = fetch_fertilizer_demand_source(symbol_code, reference)
        export_payload = fetch_fertilizer_demand_source(symbol_code, reference)
        global_payload = build_fertilizer_global_context(symbol_code, reference)
        report_calendar_payload = build_nongrain_report_calendar(symbol_code, reference)

    else:
        # Unknown group — fall back to generic adapters
        crop_progress_payload = fetch_crop_progress_source(symbol_code, reference)
        export_payload = fetch_export_inspections_source(symbol_code, reference)
        global_payload = build_global_supply_payload(
            symbol_code,
            global_context,
            source_health=wasde_payload.source_health,
        )
        report_calendar_payload = fetch_report_calendar_source(symbol_code, reference)

    technical = _technical_signal(symbol_code)

    source_health = [
        weather_payload.source_health.__dict__,
        crop_progress_payload.source_health.__dict__,
        export_payload.source_health.__dict__,
        wasde_payload.source_health.__dict__,
        global_payload.source_health.__dict__,
        report_calendar_payload.source_health.__dict__,
    ]
    next_report = report_calendar_payload.normalized_output.get("next_report")

    context_score = compute_context_score(
        symbol=symbol_code,
        weather=weather_payload.normalized_output,
        crop_progress=crop_progress_payload.normalized_output,
        export_demand=export_payload.normalized_output,
        wasde=wasde_payload.normalized_output,
        global_supply=global_payload.normalized_output,
        session=session,
        next_report=next_report,
        technical=technical,
        source_health=source_health,
        as_of=reference.astimezone(timezone.utc),
    )

    setup_label = synthesize_trade_setup(
        technical_bias=technical.get("bias", "neutral"),
        context_bias=context_score["net_bias"],
        session_status=session["status"],
        next_report=next_report,
        as_of=reference,
    )
    market_read = generate_market_read(
        symbol=symbol_code,
        commodity=commodity.display_name,
        context_score=context_score,
        weather=weather_payload.normalized_output,
        crop_progress=crop_progress_payload.normalized_output,
        export_demand=export_payload.normalized_output,
        wasde=wasde_payload.normalized_output,
        next_report=next_report,
        session=session,
    )
    thesis_validation = validate_generated_thesis(
        thesis_text=market_read,
        weather=weather_payload.normalized_output,
        crop_progress=crop_progress_payload.normalized_output,
        export_demand=export_payload.normalized_output,
        wasde=wasde_payload.normalized_output,
        global_supply=global_payload.normalized_output,
        session=session,
    )

    payload = {
        "symbol": symbol_code,
        "commodity": commodity.display_name,
        "metadata": {
            "root_symbol": commodity.root_symbol,
            "display_name": commodity.display_name,
            "commodity_group": commodity.commodity_group,
            "exchange": commodity.exchange,
            "trading_hours_profile": commodity.trading_hours_profile,
            "related_reports": list(commodity.related_reports),
            "weather_regions": [region.label for region in commodity.weather_regions],
            "global_drivers": list(commodity.global_drivers),
            "demand_drivers": list(commodity.demand_drivers),
            "supply_drivers": list(commodity.supply_drivers),
        },
        "session": session,
        "crop_stage": crop_stage,
        "weather": {
            **weather_payload.normalized_output,
            "source_health": weather_payload.source_health.__dict__,
        },
        "crop_progress": {
            **crop_progress_payload.normalized_output,
            "source_health": crop_progress_payload.source_health.__dict__,
        },
        "export_demand": {
            **export_payload.normalized_output,
            "source_health": export_payload.source_health.__dict__,
        },
        "wasde": {
            **wasde_payload.normalized_output,
            "source_health": wasde_payload.source_health.__dict__,
        },
        "global_supply": {
            **global_payload.normalized_output,
            "source_health": global_payload.source_health.__dict__,
        },
        "report_calendar": {
            **report_calendar_payload.normalized_output,
            "source_health": report_calendar_payload.source_health.__dict__,
        },
        "technical": technical,
        "context_score": context_score,
        "setup_label": setup_label,
        "market_read": market_read,
        "thesis_validation": thesis_validation,
        "source_health": source_health,
    }

    if as_of is None:
        with _CONTEXT_CACHE_LOCK:
            _CONTEXT_CACHE[symbol_code] = {"timestamp": reference, "payload": payload}

    return payload