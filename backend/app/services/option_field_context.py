from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
from typing import Any, Mapping, Sequence
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from app.services.market_weather import MarketWeatherSettings, build_market_weather
from app.services.market_weather_context import build_technical_context


OPTION_FIELD_SCHEMA_VERSION = "option_market_field_v1"
OPTION_FIELD_MODEL_VERSION = "market_field_calculus_v1"
OPTION_FIELD_MODE = "shadow_only"
OPTION_FIELD_RANK_INFLUENCE = 0.0
OPTION_FIELD_HORIZONS = tuple(range(12, 50, 2))
OPTION_FIELD_MAX_BARS = 365
OPTION_FIELD_MIN_BARS = 60
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


def _normalized_daily_frame(frame: pd.DataFrame | None) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    lookup = {str(column).lower(): column for column in frame.columns}
    required = ("open", "high", "low", "close")
    if any(name not in lookup for name in required):
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    index = pd.to_datetime(frame.index, errors="coerce")
    normalized = pd.DataFrame(index=index)
    for name in required:
        normalized[name] = pd.to_numeric(frame[lookup[name]], errors="coerce").to_numpy()
    volume_column = lookup.get("volume")
    normalized["volume"] = (
        pd.to_numeric(frame[volume_column], errors="coerce").fillna(0.0).to_numpy()
        if volume_column is not None
        else 0.0
    )
    normalized = normalized[normalized.index.notna()]
    normalized = normalized.dropna(subset=list(required))
    return normalized[~normalized.index.duplicated(keep="last")].sort_index()


def _completed_daily_frame(
    frame: pd.DataFrame | None,
    observed_at: datetime,
) -> tuple[pd.DataFrame, int]:
    history = _normalized_daily_frame(frame)
    if history.empty:
        return history, 0
    completed_through = _latest_completed_session_date(observed_at)
    # Daily provider indices are session labels. Comparing their calendar date
    # avoids shifting a midnight UTC label into the prior US market session.
    completed_mask = np.asarray([pd.Timestamp(value).date() <= completed_through for value in history.index])
    excluded = int((~completed_mask).sum())
    return history.loc[completed_mask].tail(OPTION_FIELD_MAX_BARS), excluded


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
) -> dict[str, object]:
    source = str(data_source).strip() if data_source else None
    return {
        "schema_version": OPTION_FIELD_SCHEMA_VERSION,
        "model_version": OPTION_FIELD_MODEL_VERSION,
        "mode": OPTION_FIELD_MODE,
        "shadow_only": True,
        "rank_influence": OPTION_FIELD_RANK_INFLUENCE,
        "automated_execution_enabled": False,
        "computed_at": _iso_utc(datetime.now(timezone.utc)),
        "observed_at": _iso_utc(observed_at),
        "as_of_bar": as_of_bar,
        "timeframe": timeframe,
        "option_type": option_type,
        "data_source": source,
        "completed_bars": completed_bars,
        "excluded_incomplete_bars": excluded_incomplete_bars,
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
    option_type: str | None,
    aligned_pressure: float | None,
    aligned_velocity: float | None,
    hypotheses: Mapping[str, bool],
) -> dict[str, str]:
    if option_type is None or aligned_pressure is None or aligned_velocity is None:
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
) -> dict[str, object]:
    """Build a causal, point-in-time Market Field snapshot for an option path.

    Only completed daily bars enter the calculation. This intentionally omits
    the learned lexicon, relationship-atlas outcomes, cross-market context, and
    optionality inputs so the scanner's shadow feature cannot grade itself.
    """
    observation_time = _as_utc(observed_at)
    normalized_option_type = _normalized_option_type(option_type)
    normalized_timeframe = str(timeframe or "1D").strip() or "1D"
    completed, excluded = _completed_daily_frame(frame, observation_time)
    as_of_bar = pd.Timestamp(completed.index[-1]).date().isoformat() if not completed.empty else None
    missing_features: list[str] = []
    warnings: list[str] = []
    if normalized_option_type is None:
        missing_features.append("option_type")
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
        derivative_latest = derivative_rows[-1] if derivative_rows else {}
        technical = build_technical_context(completed)
        price_action_latest = technical.get("latest") if isinstance(technical.get("latest"), dict) else {}

        pressure = _finite(derivative_latest.get("pressure"))
        velocity = _finite(derivative_latest.get("velocity"))
        side = 1.0 if normalized_option_type == "call" else -1.0 if normalized_option_type == "put" else None
        aligned_pressure = _finite(pressure * side) if pressure is not None and side is not None else None
        aligned_velocity = _finite(velocity * side) if velocity is not None and side is not None else None
        hypotheses, hypothesis_missing = _current_hypotheses(derivative_rows, strata_rows)
        missing_features.extend(hypothesis_missing)
        if not carrier_availability.get("participation", False):
            missing_features.append("volume_participation")
        if not carrier_availability.get("liquidity_stress", False):
            missing_features.append("liquidity_stress")

        classification = _classification(
            option_type=normalized_option_type,
            aligned_pressure=aligned_pressure,
            aligned_velocity=aligned_velocity,
            hypotheses=hypotheses,
        )
        source = str(data_source).strip() if data_source else None
        quality_status = "complete" if not missing_features else "limited"
        return {
            "schema_version": OPTION_FIELD_SCHEMA_VERSION,
            "model_version": OPTION_FIELD_MODEL_VERSION,
            "mode": OPTION_FIELD_MODE,
            "shadow_only": True,
            "rank_influence": OPTION_FIELD_RANK_INFLUENCE,
            "automated_execution_enabled": False,
            "computed_at": _iso_utc(datetime.now(timezone.utc)),
            "observed_at": _iso_utc(observation_time),
            "as_of_bar": as_of_bar,
            "timeframe": normalized_timeframe,
            "option_type": normalized_option_type,
            "data_source": source,
            "completed_bars": len(completed),
            "excluded_incomplete_bars": excluded,
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
            "strata": {
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
        )


def option_field_event_fields(payload: Mapping[str, object]) -> dict[str, object]:
    """Serialize one immutable field snapshot onto an OptionAlertEvent."""
    as_of = pd.to_datetime(payload.get("as_of_bar"), errors="coerce", utc=True)
    as_of_datetime = None if pd.isna(as_of) else as_of.tz_convert("UTC").tz_localize(None).to_pydatetime()
    canonical = dict(payload)
    canonical["schema_version"] = OPTION_FIELD_SCHEMA_VERSION
    canonical["model_version"] = OPTION_FIELD_MODEL_VERSION
    canonical["mode"] = OPTION_FIELD_MODE
    canonical["shadow_only"] = True
    canonical["rank_influence"] = OPTION_FIELD_RANK_INFLUENCE
    canonical["automated_execution_enabled"] = False
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
    parsed["mode"] = OPTION_FIELD_MODE
    parsed["shadow_only"] = True
    parsed["rank_influence"] = OPTION_FIELD_RANK_INFLUENCE
    parsed["automated_execution_enabled"] = False
    return parsed
