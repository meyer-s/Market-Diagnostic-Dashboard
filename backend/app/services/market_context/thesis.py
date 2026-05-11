from __future__ import annotations

from typing import Any


def generate_market_read(
    *,
    symbol: str,
    commodity: str,
    context_score: dict[str, Any],
    weather: dict[str, Any],
    crop_progress: dict[str, Any],
    export_demand: dict[str, Any],
    wasde: dict[str, Any],
    next_report: dict[str, Any] | None,
    session: dict[str, Any],
) -> str:
    bullish_factor = next(
        (
            reason
            for module in (weather, crop_progress, export_demand, wasde)
            for reason in module.get("reasons", [])
            if module.get("bias") == "bullish"
        ),
        "No strong bullish factor is currently dominant.",
    )
    bearish_factor = next(
        (
            reason
            for module in (weather, crop_progress, export_demand, wasde)
            for reason in module.get("reasons", [])
            if module.get("bias") == "bearish"
        ),
        "No strong bearish factor is currently dominant.",
    )
    catalyst = next_report["report"] if next_report else "No near-term catalyst identified"
    session_warnings = session.get("warnings") or ["Execution risk is normal."]
    session_warning = session_warnings[0]

    return (
        f"{commodity} read: Context is {context_score['net_bias']}. "
        f"Bullish factor: {bullish_factor} "
        f"Bearish factor: {bearish_factor} "
        f"Next catalyst: {catalyst}. "
        f"Confidence is {context_score['confidence']}. "
        f"Execution note: {session_warning}"
    )


def validate_generated_thesis(
    *,
    thesis_text: str,
    weather: dict[str, Any],
    crop_progress: dict[str, Any],
    export_demand: dict[str, Any],
    wasde: dict[str, Any],
    global_supply: dict[str, Any],
    session: dict[str, Any],
) -> dict[str, Any]:
    source_checks = []
    confirmations = []
    contradictions = []
    warnings = []

    def _check(name: str, module: dict[str, Any], keyword: str | None = None) -> None:
        status = module.get("bias")
        if keyword and keyword.lower() not in thesis_text.lower():
            return
        if module.get("signal") == "insufficient_data" or module.get("status") == "insufficient_data":
            source_checks.append({"claim": name, "status": "not verifiable"})
            warnings.append(f"{name} could not be validated from current sources.")
            return
        if status in {"bullish", "bearish", "mixed", "neutral"}:
            source_checks.append({"claim": name, "status": "supported", "bias": status})
            confirmations.append(f"{name} matched the structured source inputs.")

    _check("weather", weather, "weather")
    _check("crop conditions", crop_progress, "condition")
    _check("export demand", export_demand, "export")
    _check("balance sheet", wasde, "stocks")
    _check("global supply", global_supply, "global")
    _check("session", {"bias": "neutral" if session.get("status") == "open" else "bearish"}, "market")

    if any(item.get("status") == "not verifiable" for item in source_checks) and confirmations:
        validation_status = "partially confirmed"
        confidence_adjustment = -5
    elif confirmations and not contradictions:
        validation_status = "confirmed"
        confidence_adjustment = 5
    elif contradictions:
        validation_status = "challenged"
        confidence_adjustment = -15
    elif warnings:
        validation_status = "insufficient data"
        confidence_adjustment = -10
    else:
        validation_status = "stale sources"
        confidence_adjustment = -10

    return {
        "original_thesis_text": thesis_text,
        "validation_status": validation_status,
        "confidence_adjustment": confidence_adjustment,
        "source_checks": source_checks,
        "expert_consensus": [],
        "confirmations": confirmations,
        "contradictions": contradictions,
        "warnings": warnings,
    }