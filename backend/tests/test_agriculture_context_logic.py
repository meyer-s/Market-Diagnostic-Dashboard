from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.market_context.agriculture_metadata import resolve_agriculture_commodity
from app.services.market_context.agriculture_adapters import (
    _WASDE_LOOKUP_CACHE,
    _WASDE_LOOKUP_CACHE_LOCK,
    _WASDE_LOOKUP_TIMEOUT_SECONDS,
    _find_latest_available_wasde,
    _with_daily_source_cache,
    interpret_crop_progress_snapshot,
    interpret_export_demand,
    interpret_global_supply_context,
    interpret_wasde_balance_sheet,
    interpret_weather_context,
)
from app.services.market_context.crop_stage import get_crop_stage
from app.services.market_context.scoring import compute_context_score, synthesize_trade_setup
from app.services.market_context.thesis import generate_market_read, validate_generated_thesis


UTC = ZoneInfo("UTC")


def test_weather_hot_dry_pollination_is_bullish() -> None:
    result = interpret_weather_context(
        symbol="ZC",
        crop_stage={"stage": "pollination", "weather_sensitivity": "high"},
        region_summaries=[
            {"region_label": "Iowa", "avg_temp_f": 92.0, "avg_precip_probability": 10.0},
            {"region_label": "Illinois", "avg_temp_f": 90.0, "avg_precip_probability": 15.0},
        ],
        freshness_status="fresh",
    )

    assert result["bias"] == "bullish"
    assert result["confidence"] == "high"


def test_crop_progress_deterioration_is_bullish() -> None:
    result = interpret_crop_progress_snapshot(
        {
            "good_excellent_wow_change": -3,
            "good_excellent_vs_five_year_avg": -5,
        },
        {"stage": "pollination", "weather_sensitivity": "high"},
    )

    assert result["bias"] == "bullish"
    assert result["signal"] == "deteriorating condition"


def test_export_demand_ahead_of_last_year_is_supportive() -> None:
    result = interpret_export_demand(
        {
            "pace_vs_prior_year_pct": 8.4,
            "weekly_change_pct": 2.1,
        }
    )

    assert result["bias"] == "bullish"
    assert result["signal"] == "demand supportive"


def test_wasde_tightening_scores_bullish() -> None:
    result = interpret_wasde_balance_sheet(
        {
            "month_over_month": {
                "ending_stocks": -120.0,
                "production": -80.0,
                "yield": -1.2,
                "exports": 75.0,
                "domestic_use": 0.0,
            }
        }
    )

    assert result["status"] == "tightening"
    assert result["bias"] == "bullish"


def test_global_supply_more_foreign_supply_is_bearish() -> None:
    result = interpret_global_supply_context(
        "ZC",
        {
            "drivers": [
                {"label": "Brazil production", "direction": "supply", "delta": 3.0},
                {"label": "Argentina production", "direction": "supply", "delta": 2.0},
            ]
        },
    )

    assert result["bias"] == "bearish"
    assert result["status"] == "globally aligned bearish"


def test_context_score_penalizes_conflict_and_report_risk() -> None:
    as_of = datetime(2026, 5, 11, 12, 0, tzinfo=UTC)
    result = compute_context_score(
        symbol="ZC",
        weather={"bias": "bullish"},
        crop_progress={"bias": "neutral"},
        export_demand={"bias": "bullish"},
        wasde={"bias": "bearish"},
        global_supply={"bias": "bearish"},
        session={"status": "open", "warnings": []},
        next_report={
            "report": "WASDE",
            "impact": "high",
            "release_at": (as_of + timedelta(hours=6)).isoformat(),
        },
        technical={"bias": "bullish"},
        source_health=[
            {"freshness_status": "fresh"},
            {"freshness_status": "fresh"},
            {"freshness_status": "fresh"},
            {"freshness_status": "fresh"},
            {"freshness_status": "fresh"},
        ],
        as_of=as_of,
    )

    assert result["net_bias"] == "bullish"
    assert any("High-impact report risk" in warning for warning in result["warnings"])
    assert result["confidence_score"] < 75


def test_synthesize_trade_setup_waits_for_report() -> None:
    as_of = datetime(2026, 5, 11, 12, 0, tzinfo=UTC)
    result = synthesize_trade_setup(
        technical_bias="bullish",
        context_bias="bullish",
        session_status="open",
        next_report={
            "report": "WASDE",
            "impact": "high",
            "release_at": (as_of + timedelta(hours=4)).isoformat(),
        },
        as_of=as_of,
    )

    assert result == "wait for report"


def test_market_read_and_validation_confirm_structured_claims() -> None:
    context_score = {"net_bias": "bullish", "confidence": "medium"}
    weather = {"bias": "bullish", "reasons": ["Hot and dry weather is showing up during a high-sensitivity crop window."]}
    crop_progress = {"bias": "neutral", "reasons": ["Crop Progress does not currently show a strong directional divergence."]}
    export_demand = {"bias": "bullish", "reasons": ["Marketing-year export inspections are running ahead of last year."]}
    wasde = {"bias": "bearish", "status": "loosening", "reasons": ["Ending stocks increased month over month."]}
    session = {"status": "open", "warnings": []}
    thesis = generate_market_read(
        symbol="ZC",
        commodity="Corn",
        context_score=context_score,
        weather=weather,
        crop_progress=crop_progress,
        export_demand=export_demand,
        wasde=wasde,
        next_report={"report": "WASDE"},
        session=session,
    )

    validation = validate_generated_thesis(
        thesis_text=thesis,
        weather=weather,
        crop_progress={"signal": "insufficient_data", "bias": "neutral"},
        export_demand=export_demand,
        wasde=wasde,
        global_supply={"bias": "mixed", "status": "mixed"},
        session=session,
    )

    assert "Corn read" in thesis
    assert validation["validation_status"] == "confirmed"
    assert len(validation["confirmations"]) >= 2


def test_resolve_agriculture_commodity_supports_non_grain_symbols() -> None:
    assert resolve_agriculture_commodity("LE").display_name == "Live Cattle"
    assert resolve_agriculture_commodity("FERT_N").commodity_group == "fertilizer_inputs"


def test_get_crop_stage_supports_non_crop_symbol_groups() -> None:
    livestock_stage = get_crop_stage("LE")
    fertilizer_stage = get_crop_stage("FERT_N")

    assert livestock_stage["stage"] == "herd_cycle"
    assert livestock_stage["weather_sensitivity"] == "low"
    assert fertilizer_stage["stage"] == "application_cycle"


def test_daily_source_cache_reuses_builder_for_current_day() -> None:
    calls = {"count": 0}

    def builder() -> dict[str, int]:
        calls["count"] += 1
        return {"value": calls["count"]}

    first = _with_daily_source_cache(
        "test-cache-key",
        as_of=datetime.now(UTC),
        force_refresh=True,
        builder=builder,
    )
    second = _with_daily_source_cache(
        "test-cache-key",
        as_of=datetime.now(UTC),
        force_refresh=False,
        builder=builder,
    )

    assert calls["count"] == 1
    assert first == second == {"value": 1}


def test_wasde_lookup_caches_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}
    seen_timeouts: list[float] = []

    with _WASDE_LOOKUP_CACHE_LOCK:
        _WASDE_LOOKUP_CACHE.clear()

    def fake_safe_get(url: str, *, timeout_seconds: float = 20):
        calls["count"] += 1
        seen_timeouts.append(timeout_seconds)
        raise RuntimeError("simulated wasde timeout")

    monkeypatch.setattr("app.services.market_context.agriculture_adapters._safe_get", fake_safe_get)

    with pytest.raises(RuntimeError, match="simulated wasde timeout"):
        _find_latest_available_wasde()

    with pytest.raises(RuntimeError, match="simulated wasde timeout"):
        _find_latest_available_wasde()

    assert calls["count"] == 1
    assert seen_timeouts == [_WASDE_LOOKUP_TIMEOUT_SECONDS]

    with _WASDE_LOOKUP_CACHE_LOCK:
        _WASDE_LOOKUP_CACHE.clear()