from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
from typing import Any, Mapping, Sequence
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from app.services.market_weather import (
    MARKET_WEATHER_MINIMUM_BARS,
    MarketWeatherSettings,
    build_market_weather,
    normalize_market_history,
)
from app.services.market_weather_context import build_technical_context


OPTION_FIELD_SCHEMA_VERSION = "option_market_field_v1"
OPTION_FIELD_MODEL_VERSION = "market_field_calculus_v1"
OPTION_FIELD_SEMANTIC_REVISION = "1.2"
OPTION_FIELD_LEGACY_SEMANTIC_REVISION = "1.0"
OPTION_FIELD_MODE = "shadow_only"
OPTION_FIELD_RANK_INFLUENCE = 0.0
OPTION_FIELD_HORIZONS = tuple(range(12, 50, 2))
OPTION_FIELD_MAX_BARS = 365
OPTION_FIELD_MINIMUM_OBSERVED_WINDOW_BARS = max(OPTION_FIELD_HORIZONS) + 1
OPTION_FIELD_MINIMUM_INPUT_BARS = max(
    MARKET_WEATHER_MINIMUM_BARS,
    OPTION_FIELD_MINIMUM_OBSERVED_WINDOW_BARS,
)
OPTION_FIELD_TARGET_WARMUP_BARS = max(OPTION_FIELD_HORIZONS) * 2
# Retained as the public minimum constant for existing imports. Availability now
# requires the disclosed two-times-maximum-horizon initialization target.
OPTION_FIELD_MIN_BARS = OPTION_FIELD_TARGET_WARMUP_BARS
OPTION_FIELD_DAILY_CLOSE = time(16, 15)
OPTION_FIELD_MARKET_TIMEZONE = ZoneInfo("America/New_York")


def _as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _latest_completed_session_date(observed_at: datetime) -> date:
    local = observed_at.astimezone(OPTION_FIELD_MARKET_TIMEZONE)
    if local.time().replace(tzinfo=None) >= OPTION_FIELD_DAILY_CLOSE:
        return local.date()
    return local.date() - timedelta(days=1)


def _normalized_daily_frame(
    frame: pd.DataFrame | None,
) -> tuple[pd.DataFrame, dict[str, object]]:
    return normalize_market_history(
        frame,
        minimum_bars=0,
        allow_empty=True,
    )


def _completed_daily_frame(
    frame: pd.DataFrame | None,
    observed_at: datetime,
) -> tuple[pd.DataFrame, int, dict[str, object]]:
    history, input_quality = _normalized_daily_frame(frame)
    if history.empty:
        return history, 0, input_quality
    completed_through = _latest_completed_session_date(observed_at)
    # Daily provider indices are session labels. Comparing their calendar date
    # avoids shifting a midnight UTC label into the prior US market session.
    completed_mask = np.asarray([pd.Timestamp(value).date() <= completed_through for value in history.index])
    excluded = int((~completed_mask).sum())
    completed = history.loc[completed_mask].tail(OPTION_FIELD_MAX_BARS)
    input_quality = {
        **input_quality,
        "completed_rows_used": len(completed),
    }
    return completed, excluded, input_quality


def _finite(value: object, digits: int = 4) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return round(numeric, digits) if isfinite(numeric) else None


def _normalized_option_type(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"call", "calls", "c"}:
        return "call"
    if normalized in {"put", "puts", "p"}:
        return "put"
    return None


def _authority_payload() -> dict[str, object]:
    return {
        "scanner_rank": "none",
        "hard_veto": "none",
        "manager_verdict": "none",
        "target_size": "none",
        "assessment_confidence": "advisory",
        "review_priority": "advisory",
        "human_visible": True,
        "automated_execution": "none",
    }


def _initialization_payload(completed_bars: int) -> dict[str, object]:
    minimum_input_satisfied = completed_bars >= OPTION_FIELD_MINIMUM_INPUT_BARS
    initialization_target_covered = completed_bars >= OPTION_FIELD_TARGET_WARMUP_BARS
    return {
        "completed_bars": completed_bars,
        "maximum_horizon_bars": max(OPTION_FIELD_HORIZONS),
        "minimum_observed_window_bars": OPTION_FIELD_MINIMUM_OBSERVED_WINDOW_BARS,
        "minimum_input_bars": OPTION_FIELD_MINIMUM_INPUT_BARS,
        "minimum_input_satisfied": minimum_input_satisfied,
        "initialization_target_bars": OPTION_FIELD_TARGET_WARMUP_BARS,
        "initialization_target_covered": initialization_target_covered,
        "initialization_status": (
            "minimum_not_satisfied"
            if not minimum_input_satisfied
            else "minimum_satisfied"
            if not initialization_target_covered
            else "target_covered"
        ),
        "bars_needed_to_minimum_input": max(
            0,
            OPTION_FIELD_MINIMUM_INPUT_BARS - completed_bars,
        ),
        "bars_needed_to_initialization_target": max(
            0,
            OPTION_FIELD_TARGET_WARMUP_BARS - completed_bars,
        ),
        "note": "Availability requires the disclosed two-times-maximum-horizon initialization target. Target coverage is an initialization diagnostic, not an EWM convergence guarantee.",
        # Compatibility aliases retained for stored and v1.1 consumers.
        "target_warmup_bars": OPTION_FIELD_TARGET_WARMUP_BARS,
        "warmup_complete": initialization_target_covered,
        "status": "complete" if initialization_target_covered else "insufficient",
        "bars_needed": max(0, OPTION_FIELD_TARGET_WARMUP_BARS - completed_bars),
    }


def _maturity_payload(completed_bars: int) -> dict[str, object]:
    """Compatibility alias for pre-v1.2 callers."""
    return _initialization_payload(completed_bars)


def _normalized_action(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "bto": "buy_to_open",
        "buy": "buy_to_open",
        "buy_to_open": "buy_to_open",
        "sto": "sell_to_open",
        "sell": "sell_to_open",
        "sell_to_open": "sell_to_open",
    }
    return aliases.get(normalized)


def _alignment_payload(
    *,
    option_type: str | None,
    position_action: str | None,
    signed_delta: float | None,
    strategy_scope: str | None,
) -> dict[str, object]:
    normalized_action = _normalized_action(position_action)
    normalized_scope = str(strategy_scope or "").strip().lower().replace("-", "_").replace(" ", "_")
    finite_delta = _finite(signed_delta, digits=12)
    if finite_delta is not None and abs(finite_delta) > 1e-12:
        return {
            "supported": True,
            "basis": "signed_delta",
            "scope": normalized_scope or "explicit_exposure",
            "position_action": normalized_action,
            "directional_exposure_sign": 1 if finite_delta > 0.0 else -1,
            "assumptions": [],
        }

    if normalized_scope and normalized_scope not in {
        "single_leg",
        "long_single_leg",
        "short_single_leg",
    }:
        return {
            "supported": False,
            "basis": "unsupported",
            "scope": normalized_scope,
            "position_action": normalized_action,
            "directional_exposure_sign": None,
            "assumptions": [
                "Multi-leg or complex exposure requires an explicit signed delta for directional alignment."
            ],
        }

    option_sign = 1 if option_type == "call" else -1 if option_type == "put" else None
    if normalized_action is not None and option_sign is not None:
        action_sign = 1 if normalized_action == "buy_to_open" else -1
        return {
            "supported": True,
            "basis": "action_and_option_type",
            "scope": normalized_scope or ("long_single_leg" if action_sign > 0 else "short_single_leg"),
            "position_action": normalized_action,
            "directional_exposure_sign": option_sign * action_sign,
            "assumptions": [],
        }

    if position_action is None and option_sign is not None:
        return {
            "supported": True,
            "basis": "legacy_long_single_leg_option_type",
            "scope": normalized_scope or "long_single_leg",
            "position_action": None,
            "directional_exposure_sign": option_sign,
            "assumptions": [
                "Legacy callers provide option type but not position action; alignment assumes a long single-leg exposure."
            ],
        }

    return {
        "supported": False,
        "basis": "unsupported",
        "scope": normalized_scope or "unknown",
        "position_action": normalized_action,
        "directional_exposure_sign": None,
        "assumptions": ["Directional exposure could not be established from signed delta or action and option type."],
    }


def _blank_direction() -> dict[str, object]:
    return {
        "regime": None,
        "pressure": None,
        "velocity": None,
        "acceleration": None,
        "jerk": None,
        "snap": None,
        "option_aligned_pressure": None,
        "option_aligned_velocity": None,
        "horizon_alignment": None,
        "coherence": None,
        "entropy": None,
        "permutation_entropy": None,
        "expansion": None,
        "expansion_front": None,
    }


def _empty_payload(
    *,
    observed_at: datetime,
    option_type: str | None,
    data_source: str | None,
    timeframe: str,
    completed_bars: int = 0,
    excluded_incomplete_bars: int = 0,
    as_of_bar: str | None = None,
    warnings: Sequence[str] = (),
    missing_features: Sequence[str] = (),
    input_quality: Mapping[str, object] | None = None,
    alignment: Mapping[str, object] | None = None,
) -> dict[str, object]:
    source = str(data_source).strip() if data_source else None
    return {
        "schema_version": OPTION_FIELD_SCHEMA_VERSION,
        "model_version": OPTION_FIELD_MODEL_VERSION,
        "semantic_revision": OPTION_FIELD_SEMANTIC_REVISION,
        "mode": OPTION_FIELD_MODE,
        "shadow_only": True,
        "rank_influence": OPTION_FIELD_RANK_INFLUENCE,
        "automated_execution_enabled": False,
        "authority": _authority_payload(),
        "computed_at": _iso_utc(datetime.now(timezone.utc)),
        "observed_at": _iso_utc(observed_at),
        "as_of_bar": as_of_bar,
        "timeframe": timeframe,
        "option_type": option_type,
        "data_source": source,
        "completed_bars": completed_bars,
        "excluded_incomplete_bars": excluded_incomplete_bars,
        "initialization": _initialization_payload(completed_bars),
        "maturity": _maturity_payload(completed_bars),
        "input_quality": dict(input_quality or {}),
        "alignment": dict(alignment or {}),
        "quality": {
            "available": False,
            "status": "unavailable",
            "completed_bars_only": True,
            "missing_features": list(dict.fromkeys(missing_features)),
            "warnings": list(dict.fromkeys(warnings)),
            "data_source": source,
            "as_of_bar": as_of_bar,
        },
        "direction": _blank_direction(),
        "strata": {
            "structure": None,
            "kinematics": None,
            "geometry": None,
            "information": None,
            "propagation": None,
            "cascade_bias": None,
            "scaling_exponent": None,
        },
        "structure_components": {
            "activity": None,
            "horizon_agreement": None,
            "trend_agreement_composite": None,
            "display_organization": None,
        },
        "scaling_reference": {
            "stationary_finite_variance_reference": 0.5,
            "latest_exponent": None,
            "latest_excess": None,
            "valid": False,
            "reason": "field_unavailable",
            "exact_arithmetic_contract": {
                "nonnegative": True,
                "floating_point_tolerance": 1e-10,
                "defensive_storage_bounds": [-2.0, 2.0],
                "violation_status": "invalid",
            },
        },
        "carriers": {
            "realized_volatility_ratio": None,
            "participation_ratio": None,
            "liquidity_stress_ratio": None,
        },
        "price_action": {
            "state": "warming_up",
            "range_position20": None,
            "support_distance_atr": None,
            "resistance_distance_atr": None,
            "trend_gap20_pct": None,
            "return_5bar_pct": None,
        },
        "hypotheses": {
            "organized_expansion": False,
            "longward_cascade": False,
            "geometry_disorder_shock": False,
            "kinematic_exhaustion": False,
        },
        "classification": {
            "path_state": "unavailable",
            "eventfulness": "unavailable",
        },
    }


def _row_values(rows: Sequence[Mapping[str, object]], key: str, *, absolute: bool = False) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = _finite(row.get(key), digits=12)
        if value is not None:
            values.append(abs(value) if absolute else value)
    return values


def _prior_quantile(
    rows: Sequence[Mapping[str, object]],
    key: str,
    quantile: float,
    *,
    absolute: bool = False,
) -> float | None:
    values = _row_values(rows[:-1], key, absolute=absolute)
    if len(values) < 20:
        return None
    return float(np.quantile(np.asarray(values, dtype=float), quantile))


def _current_hypotheses(
    derivative_rows: Sequence[Mapping[str, object]],
    strata_rows: Sequence[Mapping[str, object]],
) -> tuple[dict[str, bool], list[str]]:
    if not derivative_rows or not strata_rows:
        return {
            "organized_expansion": False,
            "longward_cascade": False,
            "geometry_disorder_shock": False,
            "kinematic_exhaustion": False,
        }, ["hypothesis_history"]

    derivative = derivative_rows[-1]
    strata = strata_rows[-1]
    thresholds = {
        "structure70": _prior_quantile(strata_rows, "structure", 0.70),
        "propagation60": _prior_quantile(strata_rows, "propagation", 0.60),
        "information50": _prior_quantile(strata_rows, "information", 0.50),
        "pressure60": _prior_quantile(derivative_rows, "pressure", 0.60, absolute=True),
        "propagation72": _prior_quantile(strata_rows, "propagation", 0.72),
        "cascade62": _prior_quantile(strata_rows, "cascade_bias", 0.62),
        "pressure55": _prior_quantile(derivative_rows, "pressure", 0.55, absolute=True),
        "geometry75": _prior_quantile(strata_rows, "geometry", 0.75),
        "information60": _prior_quantile(strata_rows, "information", 0.60),
        "kinematics75": _prior_quantile(strata_rows, "kinematics", 0.75),
        "pressure65": _prior_quantile(derivative_rows, "pressure", 0.65, absolute=True),
    }
    if any(value is None for value in thresholds.values()):
        return {
            "organized_expansion": False,
            "longward_cascade": False,
            "geometry_disorder_shock": False,
            "kinematic_exhaustion": False,
        }, ["hypothesis_history"]

    pressure = _finite(derivative.get("pressure"), digits=12) or 0.0
    velocity = _finite(derivative.get("velocity"), digits=12) or 0.0
    structure = _finite(strata.get("structure"), digits=12) or 0.0
    propagation = _finite(strata.get("propagation"), digits=12) or 0.0
    information = _finite(strata.get("information"), digits=12) or 0.0
    cascade_bias = _finite(strata.get("cascade_bias"), digits=12) or 0.0
    geometry = _finite(strata.get("geometry"), digits=12) or 0.0
    kinematics = _finite(strata.get("kinematics"), digits=12) or 0.0
    strength_velocity = np.sign(pressure) * velocity
    prior_strength_velocity = [
        np.sign(float(row.get("pressure") or 0.0)) * float(row.get("velocity") or 0.0)
        for row in derivative_rows[:-1]
        if _finite(row.get("pressure"), digits=12) is not None
        and _finite(row.get("velocity"), digits=12) is not None
    ]
    velocity35 = float(np.quantile(prior_strength_velocity, 0.35))

    hypotheses = {
        "organized_expansion": bool(
            structure >= float(thresholds["structure70"])
            and propagation >= float(thresholds["propagation60"])
            and information <= float(thresholds["information50"])
            and abs(pressure) >= float(thresholds["pressure60"])
        ),
        "longward_cascade": bool(
            propagation >= float(thresholds["propagation72"])
            and cascade_bias >= max(0.08, float(thresholds["cascade62"]))
            and abs(pressure) >= float(thresholds["pressure55"])
        ),
        "geometry_disorder_shock": bool(
            geometry >= float(thresholds["geometry75"])
            and information >= float(thresholds["information60"])
        ),
        "kinematic_exhaustion": bool(
            kinematics >= float(thresholds["kinematics75"])
            and abs(pressure) >= float(thresholds["pressure65"])
            and strength_velocity <= velocity35
        ),
    }
    return hypotheses, []


def _classification(
    *,
    alignment_supported: bool,
    aligned_pressure: float | None,
    aligned_velocity: float | None,
    hypotheses: Mapping[str, bool],
) -> dict[str, str]:
    if not alignment_supported or aligned_pressure is None or aligned_velocity is None:
        path_state = "unavailable"
    elif abs(aligned_pressure) <= 0.02:
        path_state = "mixed"
    elif aligned_pressure < 0.0:
        path_state = "contradictory"
    elif aligned_velocity < 0.0:
        path_state = "fading"
    else:
        path_state = "supportive"

    active_count = sum(1 for value in hypotheses.values() if value)
    if path_state == "unavailable":
        eventfulness = "unavailable"
    elif active_count >= 2:
        eventfulness = "compound"
    elif active_count == 1:
        eventfulness = "active"
    else:
        eventfulness = "quiet"
    return {"path_state": path_state, "eventfulness": eventfulness}


def build_option_field_context(
    frame: pd.DataFrame | None,
    *,
    option_type: str | None,
    observed_at: datetime | None = None,
    data_source: str | None = None,
    timeframe: str = "1D",
    position_action: str | None = None,
    signed_delta: float | None = None,
    strategy_scope: str | None = None,
) -> dict[str, object]:
    """Build a causal, point-in-time Market Field snapshot for an option path.

    Only completed daily bars enter the calculation. This intentionally omits
    the learned lexicon, relationship-atlas outcomes, cross-market context, and
    optionality inputs so the scanner's shadow feature cannot grade itself.
    """
    observation_time = _as_utc(observed_at)
    normalized_option_type = _normalized_option_type(option_type)
    normalized_timeframe = str(timeframe or "1D").strip() or "1D"
    completed, excluded, input_quality = _completed_daily_frame(frame, observation_time)
    as_of_bar = pd.Timestamp(completed.index[-1]).date().isoformat() if not completed.empty else None
    alignment = _alignment_payload(
        option_type=normalized_option_type,
        position_action=position_action,
        signed_delta=signed_delta,
        strategy_scope=strategy_scope,
    )
    missing_features: list[str] = []
    warnings = [str(value) for value in input_quality.get("warnings", [])]
    if normalized_option_type is None and alignment.get("basis") != "signed_delta":
        missing_features.append("option_type")
    elif not alignment.get("supported"):
        missing_features.append("directional_alignment")
    if len(completed) < OPTION_FIELD_MIN_BARS:
        missing_features.append("completed_daily_history")
        warnings.append(f"requires_{OPTION_FIELD_MIN_BARS}_completed_bars")
        return _empty_payload(
            observed_at=observation_time,
            option_type=normalized_option_type,
            data_source=data_source,
            timeframe=normalized_timeframe,
            completed_bars=len(completed),
            excluded_incomplete_bars=excluded,
            as_of_bar=as_of_bar,
            warnings=warnings,
            missing_features=missing_features,
            input_quality=input_quality,
            alignment=alignment,
        )

    try:
        field = build_market_weather(
            completed,
            horizons=OPTION_FIELD_HORIZONS,
            settings=MarketWeatherSettings(),
            include_retrospective_research=False,
            include_history_payload=False,
        )
        summary = field.get("summary") if isinstance(field.get("summary"), dict) else {}
        research = field.get("research") if isinstance(field.get("research"), dict) else {}
        derivative_rows = research.get("derivative_series") if isinstance(research.get("derivative_series"), list) else []
        strata_block = research.get("strata") if isinstance(research.get("strata"), dict) else {}
        strata_rows = strata_block.get("series") if isinstance(strata_block.get("series"), list) else []
        strata_latest = strata_block.get("latest") if isinstance(strata_block.get("latest"), dict) else {}
        carriers_block = research.get("carriers") if isinstance(research.get("carriers"), dict) else {}
        ratios_block = carriers_block.get("ratios") if isinstance(carriers_block.get("ratios"), dict) else {}
        ratios_latest = ratios_block.get("latest") if isinstance(ratios_block.get("latest"), dict) else {}
        carrier_availability = (
            carriers_block.get("availability")
            if isinstance(carriers_block.get("availability"), dict)
            else {}
        )
        structure_block = (
            research.get("structure_components")
            if isinstance(research.get("structure_components"), dict)
            else {}
        )
        structure_latest = (
            structure_block.get("latest")
            if isinstance(structure_block.get("latest"), dict)
            else {}
        )
        scaling_block = (
            research.get("scaling_reference")
            if isinstance(research.get("scaling_reference"), dict)
            else {}
        )
        derivative_latest = derivative_rows[-1] if derivative_rows else {}
        technical = build_technical_context(completed)
        price_action_latest = technical.get("latest") if isinstance(technical.get("latest"), dict) else {}

        pressure = _finite(derivative_latest.get("pressure"))
        velocity = _finite(derivative_latest.get("velocity"))
        exposure_sign = _finite(alignment.get("directional_exposure_sign"), digits=0)
        side = float(exposure_sign) if alignment.get("supported") and exposure_sign is not None else None
        aligned_pressure = _finite(pressure * side) if pressure is not None and side is not None else None
        aligned_velocity = _finite(velocity * side) if velocity is not None and side is not None else None
        scaling_valid = bool(scaling_block.get("valid"))
        strata_payload = {
            key: _finite(strata_latest.get(key))
            for key in (
                "structure",
                "kinematics",
                "geometry",
                "information",
                "propagation",
                "cascade_bias",
                "scaling_exponent",
            )
        }
        if not scaling_valid:
            # The defensive field payload may retain an impossible raw value for
            # diagnosis. It has no place in an option snapshot or downstream
            # decision context, so expose the quality reason and withhold it.
            strata_payload["scaling_exponent"] = None
            missing_features.append("scaling_exponent")
            scaling_reason = str(scaling_block.get("reason") or "unavailable")
            warnings.append(f"scaling_exponent_withheld:{scaling_reason}")
        hypotheses, hypothesis_missing = _current_hypotheses(derivative_rows, strata_rows)
        missing_features.extend(hypothesis_missing)
        if not carrier_availability.get("participation", False):
            missing_features.append("volume_participation")
        if not carrier_availability.get("liquidity_stress", False):
            missing_features.append("liquidity_stress")

        classification = _classification(
            alignment_supported=bool(alignment.get("supported")),
            aligned_pressure=aligned_pressure,
            aligned_velocity=aligned_velocity,
            hypotheses=hypotheses,
        )
        source = str(data_source).strip() if data_source else None
        quality_status = (
            "complete"
            if not missing_features and input_quality.get("status") == "valid"
            else "limited"
        )
        return {
            "schema_version": OPTION_FIELD_SCHEMA_VERSION,
            "model_version": OPTION_FIELD_MODEL_VERSION,
            "semantic_revision": OPTION_FIELD_SEMANTIC_REVISION,
            "mode": OPTION_FIELD_MODE,
            "shadow_only": True,
            "rank_influence": OPTION_FIELD_RANK_INFLUENCE,
            "automated_execution_enabled": False,
            "authority": _authority_payload(),
            "computed_at": _iso_utc(datetime.now(timezone.utc)),
            "observed_at": _iso_utc(observation_time),
            "as_of_bar": as_of_bar,
            "timeframe": normalized_timeframe,
            "option_type": normalized_option_type,
            "data_source": source,
            "completed_bars": len(completed),
            "excluded_incomplete_bars": excluded,
            "initialization": _initialization_payload(len(completed)),
            "maturity": _maturity_payload(len(completed)),
            "input_quality": input_quality,
            "alignment": alignment,
            "quality": {
                "available": True,
                "status": quality_status,
                "completed_bars_only": True,
                "missing_features": list(dict.fromkeys(missing_features)),
                "warnings": warnings,
                "data_source": source,
                "as_of_bar": as_of_bar,
                "positive_volume_observations": carrier_availability.get("positive_volume_observations"),
            },
            "direction": {
                "regime": summary.get("regime"),
                "pressure": pressure,
                "velocity": velocity,
                "acceleration": _finite(derivative_latest.get("acceleration")),
                "jerk": _finite(derivative_latest.get("jerk")),
                "snap": _finite(derivative_latest.get("snap")),
                "option_aligned_pressure": aligned_pressure,
                "option_aligned_velocity": aligned_velocity,
                "horizon_alignment": _finite(summary.get("horizon_alignment")),
                "coherence": _finite(summary.get("coherence")),
                "entropy": _finite(summary.get("entropy")),
                "permutation_entropy": _finite(summary.get("permutation_entropy")),
                "expansion": _finite(summary.get("expansion")),
                "expansion_front": summary.get("expansion_front"),
            },
            "strata": strata_payload,
            "structure_components": {
                key: _finite(structure_latest.get(key))
                for key in (
                    "activity",
                    "horizon_agreement",
                    "trend_agreement_composite",
                    "display_organization",
                )
            },
            "scaling_reference": {
                "stationary_finite_variance_reference": _finite(
                    scaling_block.get("stationary_finite_variance_reference")
                ),
                "latest_exponent": _finite(scaling_block.get("latest_exponent")),
                "latest_excess": _finite(scaling_block.get("latest_excess")),
                "valid": scaling_valid,
                "reason": scaling_block.get("reason"),
                "exact_arithmetic_contract": scaling_block.get("exact_arithmetic_contract"),
            },
            "carriers": {
                "realized_volatility_ratio": _finite(ratios_latest.get("realized_volatility")),
                "participation_ratio": _finite(ratios_latest.get("participation")),
                "liquidity_stress_ratio": _finite(ratios_latest.get("liquidity_stress")),
            },
            "price_action": {
                "state": price_action_latest.get("state") or "warming_up",
                "range_position20": _finite(price_action_latest.get("range_position20"), 2),
                "support_distance_atr": _finite(price_action_latest.get("support_distance_atr"), 2),
                "resistance_distance_atr": _finite(price_action_latest.get("resistance_distance_atr"), 2),
                "trend_gap20_pct": _finite(price_action_latest.get("trend_gap20_pct"), 2),
                "return_5bar_pct": _finite(price_action_latest.get("return_5bar_pct"), 2),
            },
            "hypotheses": hypotheses,
            "classification": classification,
        }
    except Exception as exc:
        return _empty_payload(
            observed_at=observation_time,
            option_type=normalized_option_type,
            data_source=data_source,
            timeframe=normalized_timeframe,
            completed_bars=len(completed),
            excluded_incomplete_bars=excluded,
            as_of_bar=as_of_bar,
            warnings=[f"field_calculation_failed:{type(exc).__name__}"],
            missing_features=[*missing_features, "market_field"],
            input_quality=input_quality,
            alignment=alignment,
        )


def option_field_event_fields(payload: Mapping[str, object]) -> dict[str, object]:
    """Serialize one immutable field snapshot onto an OptionAlertEvent."""
    as_of = pd.to_datetime(payload.get("as_of_bar"), errors="coerce", utc=True)
    as_of_datetime = None if pd.isna(as_of) else as_of.tz_convert("UTC").tz_localize(None).to_pydatetime()
    canonical = dict(payload)
    canonical["schema_version"] = OPTION_FIELD_SCHEMA_VERSION
    canonical["model_version"] = OPTION_FIELD_MODEL_VERSION
    canonical["semantic_revision"] = OPTION_FIELD_SEMANTIC_REVISION
    canonical["mode"] = OPTION_FIELD_MODE
    canonical["shadow_only"] = True
    canonical["rank_influence"] = OPTION_FIELD_RANK_INFLUENCE
    canonical["automated_execution_enabled"] = False
    canonical["authority"] = _authority_payload()
    completed_bars = int(canonical.get("completed_bars") or 0)
    if not isinstance(canonical.get("initialization"), dict):
        canonical["initialization"] = _initialization_payload(completed_bars)
    if not isinstance(canonical.get("maturity"), dict):
        canonical["maturity"] = dict(canonical["initialization"])
    return {
        "field_context_version": OPTION_FIELD_SCHEMA_VERSION,
        "field_context_as_of": as_of_datetime,
        "field_context_json": json.dumps(canonical, sort_keys=True, separators=(",", ":")),
    }


def option_field_context_from_event(event: object) -> dict[str, object] | None:
    raw = getattr(event, "field_context_json", None)
    if not raw:
        return None
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    parsed["schema_version"] = str(
        getattr(event, "field_context_version", None) or parsed.get("schema_version") or OPTION_FIELD_SCHEMA_VERSION
    )
    parsed["model_version"] = str(parsed.get("model_version") or OPTION_FIELD_MODEL_VERSION)
    # Reading an old stored snapshot must not relabel it as v1.1. Outcome
    # cohorts use this boundary to keep legacy 60-bar/implicit-side records out
    # of the stricter v1.1 comparison set.
    parsed["semantic_revision"] = str(
        parsed.get("semantic_revision") or OPTION_FIELD_LEGACY_SEMANTIC_REVISION
    )
    parsed["mode"] = OPTION_FIELD_MODE
    parsed["shadow_only"] = True
    parsed["rank_influence"] = OPTION_FIELD_RANK_INFLUENCE
    parsed["automated_execution_enabled"] = False
    parsed["authority"] = _authority_payload()
    if not isinstance(parsed.get("initialization"), dict):
        parsed["initialization"] = _initialization_payload(int(parsed.get("completed_bars") or 0))
    if not isinstance(parsed.get("maturity"), dict):
        # Do not rewrite the stored semantic revision; this is a read-time
        # compatibility view over the canonical initialization metadata.
        parsed["maturity"] = dict(parsed["initialization"])
    if not isinstance(parsed.get("alignment"), dict):
        parsed["alignment"] = _alignment_payload(
            option_type=_normalized_option_type(parsed.get("option_type")),
            position_action=None,
            signed_delta=None,
            strategy_scope="long_single_leg",
        )
    return parsed
