from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.market_context.types import BiasLabel


def score_bias(bias: str) -> int:
    if bias == "bullish":
        return 1
    if bias == "bearish":
        return -1
    return 0


def compute_context_score(
    *,
    symbol: str,
    weather: dict[str, Any],
    crop_progress: dict[str, Any],
    export_demand: dict[str, Any],
    wasde: dict[str, Any],
    global_supply: dict[str, Any],
    session: dict[str, Any],
    next_report: dict[str, Any] | None,
    technical: dict[str, Any],
    source_health: list[dict[str, Any]],
    as_of: datetime,
) -> dict[str, Any]:
    component_breakdown = {
        "weather": score_bias(weather.get("bias", "neutral")),
        "crop_progress": score_bias(crop_progress.get("bias", "neutral")),
        "export_demand": score_bias(export_demand.get("bias", "neutral")),
        "wasde": score_bias(wasde.get("bias", "neutral")),
        "global_supply": score_bias(global_supply.get("bias", "neutral")),
        "technical": score_bias(technical.get("bias", "neutral")),
    }
    numerical_score = sum(component_breakdown.values())
    positive = sum(1 for value in component_breakdown.values() if value > 0)
    negative = sum(1 for value in component_breakdown.values() if value < 0)

    if numerical_score > 0:
        net_bias = "bullish"
    elif numerical_score < 0:
        net_bias = "bearish"
    elif positive and negative:
        net_bias = "mixed"
    else:
        net_bias = "neutral"

    confidence_points = 75
    stale_sources = sum(1 for item in source_health if item.get("freshness_status") == "stale")
    missing_sources = sum(1 for item in source_health if item.get("freshness_status") == "missing")
    if positive and negative:
        confidence_points -= 15
    confidence_points -= stale_sources * 10
    confidence_points -= missing_sources * 8

    report_warning: str | None = None
    if next_report and next_report.get("release_at"):
        release_at = datetime.fromisoformat(next_report["release_at"])
        hours_to_release = (release_at - as_of).total_seconds() / 3600
        if 0 <= hours_to_release <= 24 and next_report.get("impact") == "high":
            confidence_points -= 20
            report_warning = f"High-impact report risk: {next_report['report']} is due within 24 hours."

    session_warning: str | None = None
    if session.get("status") != "open":
        confidence_points -= 10
        session_warning = "Contract is not actively trading; execution risk is elevated."

    confidence_points = max(5, min(95, confidence_points))
    confidence = "high" if confidence_points >= 70 else "medium" if confidence_points >= 45 else "low"

    warnings = []
    if positive and negative:
        warnings.append("Signals are conflicted across modules, which lowers conviction.")
    if report_warning:
        warnings.append(report_warning)
    if session_warning:
        warnings.append(session_warning)
    warnings.extend(session.get("warnings", []))

    reasons = []
    for key, value in component_breakdown.items():
        if value > 0:
            reasons.append(f"{key.replace('_', ' ').title()} is supportive.")
        elif value < 0:
            reasons.append(f"{key.replace('_', ' ').title()} is a headwind.")

    source_health_summary = {
        "fresh": sum(1 for item in source_health if item.get("freshness_status") == "fresh"),
        "aging": sum(1 for item in source_health if item.get("freshness_status") == "aging"),
        "stale": stale_sources,
        "missing": missing_sources,
    }

    return {
        "symbol": symbol,
        "net_bias": net_bias,
        "confidence": confidence,
        "confidence_score": confidence_points,
        "numerical_score": numerical_score,
        "component_breakdown": component_breakdown,
        "reasons": reasons,
        "warnings": warnings,
        "source_health_summary": source_health_summary,
    }


def synthesize_trade_setup(
    *,
    technical_bias: str,
    context_bias: str,
    session_status: str,
    next_report: dict[str, Any] | None,
    as_of: datetime | None = None,
) -> str:
    if session_status != "open":
        return "closed/no execution"
    if next_report and next_report.get("impact") == "high" and next_report.get("release_at"):
        release_at = datetime.fromisoformat(next_report["release_at"])
        reference = as_of.astimezone(release_at.tzinfo) if as_of is not None else datetime.now(release_at.tzinfo)
        hours_to_release = (release_at - reference).total_seconds() / 3600
        if 0 <= hours_to_release <= 24:
            return "wait for report"
    if technical_bias == "bullish" and context_bias == "bullish":
        return "aligned long setup"
    if technical_bias == "bearish" and context_bias == "bearish":
        return "aligned short setup"
    if technical_bias in {"bullish", "bearish"} and context_bias == "neutral":
        return "technical-only setup"
    if technical_bias == "neutral" and context_bias in {"bullish", "bearish"}:
        return "fundamental-only setup"
    if technical_bias in {"bullish", "bearish"} and context_bias in {"bullish", "bearish"} and technical_bias != context_bias:
        return "conflicting signals"
    if context_bias == "mixed":
        return "watch"
    return "avoid"