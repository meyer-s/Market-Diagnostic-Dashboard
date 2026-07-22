from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from app.models.alternative_assets import AASIndicator
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.models.options_alerts import OptionAlertEvent
from app.models.stock_projection_snapshot import StockProjectionSnapshot
from app.services.indicator_specs import INDICATOR_SPECS_BY_CODE
from app.utils.db_helpers import get_db_session


CONTEXT_VERSION = "shadow_context_v1"
RELATIONSHIP_LAGS = (0, 1, 5, 20)
RELATIONSHIP_LOOKBACK_DAYS = 1095
MINIMUM_CALIBRATION_OBSERVATIONS = 40
MINIMUM_HOLDOUT_OBSERVATIONS = 20
ROLLING_ASSOCIATION_WINDOW = 60


@dataclass(frozen=True)
class ContextSource:
    id: str
    label: str
    family: str
    source: str
    level_label: str
    unit: str
    freshness_days: int
    values: pd.Series
    pressure_multiplier: float


def _finite(value: Any, digits: int = 4) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed):
        return None
    return round(parsed, digits)


def _timestamp(value: Any) -> pd.Timestamp | None:
    parsed = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(parsed):
        return None
    return pd.Timestamp(parsed)


def _iso(value: Any) -> str | None:
    parsed = _timestamp(value)
    return parsed.isoformat() if parsed is not None else None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_price_frame(frame: pd.DataFrame | None) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    lookup = {str(column).lower(): column for column in frame.columns}
    if not all(name in lookup for name in ("open", "high", "low", "close")):
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    index = pd.to_datetime(frame.index, errors="coerce", utc=True)
    normalized = pd.DataFrame(index=index)
    for name in ("open", "high", "low", "close"):
        normalized[name] = pd.to_numeric(frame[lookup[name]], errors="coerce").to_numpy()
    volume_column = lookup.get("volume")
    normalized["volume"] = (
        pd.to_numeric(frame[volume_column], errors="coerce").fillna(0.0).to_numpy()
        if volume_column is not None
        else 0.0
    )
    normalized = normalized[normalized.index.notna()]
    normalized = normalized.dropna(subset=["open", "high", "low", "close"])
    return normalized[~normalized.index.duplicated(keep="last")].sort_index()


def build_technical_context(
    frame: pd.DataFrame | None,
    *,
    visible_dates: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build causal support/resistance and price-action measurements.

    Support and resistance use the *prior* 20 bars. The current bar is excluded,
    so a breakout can be observed instead of moving the boundary at the same time.
    """
    history = _normalize_price_frame(frame)
    if history.empty:
        return {
            "available": False,
            "method": "Prior-20-bar range with Wilder-style 14-bar true-range mean.",
            "series": [],
            "latest": None,
        }

    previous_close = history["close"].shift(1)
    true_range = pd.concat(
        [
            (history["high"] - history["low"]).abs(),
            (history["high"] - previous_close).abs(),
            (history["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr14 = true_range.rolling(14, min_periods=5).mean()
    support20 = history["low"].rolling(20, min_periods=10).min().shift(1)
    resistance20 = history["high"].rolling(20, min_periods=10).max().shift(1)
    range_width = (resistance20 - support20).replace(0.0, np.nan)
    range_position = (history["close"] - support20) / range_width * 100.0
    sma20 = history["close"].rolling(20, min_periods=10).mean()
    trend_gap = (history["close"] / sma20 - 1.0) * 100.0
    return5 = history["close"].pct_change(5) * 100.0
    support_distance = (history["close"] - support20) / atr14.replace(0.0, np.nan)
    resistance_distance = (resistance20 - history["close"]) / atr14.replace(0.0, np.nan)

    visible = None
    if visible_dates:
        visible = {
            parsed
            for parsed in (_timestamp(value) for value in visible_dates)
            if parsed is not None
        }

    rows: list[dict[str, Any]] = []
    for index, close in history["close"].items():
        parsed_index = _timestamp(index)
        if parsed_index is None or (visible is not None and parsed_index not in visible):
            continue
        position = _finite(range_position.loc[index], 2)
        if position is None:
            state = "warming_up"
        elif position > 100.0:
            state = "breakout"
        elif position < 0.0:
            state = "breakdown"
        elif position >= 75.0:
            state = "upper_range"
        elif position <= 25.0:
            state = "lower_range"
        else:
            state = "mid_range"
        rows.append(
            {
                "date": parsed_index.isoformat(),
                "close": _finite(close, 4),
                "support20": _finite(support20.loc[index], 4),
                "resistance20": _finite(resistance20.loc[index], 4),
                "atr14": _finite(atr14.loc[index], 4),
                "range_position20": position,
                "support_distance_atr": _finite(support_distance.loc[index], 2),
                "resistance_distance_atr": _finite(resistance_distance.loc[index], 2),
                "trend_gap20_pct": _finite(trend_gap.loc[index], 2),
                "return_5bar_pct": _finite(return5.loc[index], 2),
                "state": state,
            }
        )

    return {
        "available": bool(rows),
        "method": "Causal prior-20-bar low/high boundaries; ATR uses the trailing 14 bars; no future values.",
        "series": rows,
        "latest": rows[-1] if rows else None,
    }


def _series_from_indicator_rows(rows: Iterable[IndicatorValue]) -> pd.Series:
    points: dict[pd.Timestamp, float] = {}
    for row in rows:
        timestamp = _timestamp(row.timestamp)
        value = _finite(row.score)
        if timestamp is None or value is None:
            continue
        points[timestamp.normalize()] = value
    return pd.Series(points, dtype=float).sort_index()


def _series_from_aas_rows(rows: Iterable[AASIndicator], attribute: str) -> pd.Series:
    points: dict[pd.Timestamp, float] = {}
    for row in rows:
        timestamp = _timestamp(row.date)
        value = _finite(getattr(row, attribute, None))
        if timestamp is None or value is None:
            continue
        # Contributions are stored as 0-1 weighted pressure shares. Display and
        # analyze them as percentage-point pressure contributions.
        points[timestamp.normalize()] = value * 100.0
    return pd.Series(points, dtype=float).sort_index()


def _load_context_sources() -> tuple[list[ContextSource], list[str]]:
    warnings: list[str] = []
    sources: list[ContextSource] = []
    cutoff = _utc_now() - timedelta(days=RELATIONSHIP_LOOKBACK_DAYS + 45)
    indicator_codes = (
        "ENERGY_STABILITY",
        "REAL_ESTATE_STABILITY",
        "AGRICULTURE_STABILITY",
        "SECTOR_REGIME_ALIGNMENT",
    )

    try:
        with get_db_session() as db:
            indicators = db.query(Indicator).filter(Indicator.code.in_(indicator_codes)).all()
            by_code = {indicator.code: indicator for indicator in indicators}
            indicator_definitions = (
                ("energy", "Energy pressure", "energy", "ENERGY_STABILITY"),
                ("real_estate", "Real-estate pressure", "real_estate", "REAL_ESTATE_STABILITY"),
                ("agriculture", "Agriculture pressure", "agriculture", "AGRICULTURE_STABILITY"),
                ("sector_divergence", "Sector-divergence pressure", "sectors", "SECTOR_REGIME_ALIGNMENT"),
            )
            for source_id, label, family, code in indicator_definitions:
                indicator = by_code.get(code)
                if indicator is None:
                    warnings.append(f"{label}: indicator definition unavailable.")
                    continue
                rows = (
                    db.query(IndicatorValue)
                    .filter(
                        IndicatorValue.indicator_id == indicator.id,
                        IndicatorValue.timestamp >= cutoff.replace(tzinfo=None),
                    )
                    .order_by(IndicatorValue.timestamp.asc())
                    .all()
                )
                values = _series_from_indicator_rows(rows)
                spec = INDICATOR_SPECS_BY_CODE.get(code)
                sources.append(
                    ContextSource(
                        id=source_id,
                        label=label,
                        family=family,
                        source=f"indicator_value:{code}",
                        level_label=f"{indicator.name} score",
                        unit="0-100 stability score",
                        freshness_days=spec.freshness_horizon_days if spec else 7,
                        values=values,
                        # Convert a falling stability/alignment score into rising pressure.
                        pressure_multiplier=-1.0,
                    )
                )

            aas_rows = (
                db.query(AASIndicator)
                .filter(AASIndicator.date >= cutoff.replace(tzinfo=None))
                .order_by(AASIndicator.date.asc())
                .all()
            )
            sources.extend(
                [
                    ContextSource(
                        id="metals",
                        label="Metals pressure",
                        family="metals",
                        source="aap_indicator:metals_contribution",
                        level_label="Weighted metals instability",
                        unit="pressure percentage points",
                        freshness_days=3,
                        values=_series_from_aas_rows(aas_rows, "metals_contribution"),
                        pressure_multiplier=1.0,
                    ),
                    ContextSource(
                        id="crypto",
                        label="Crypto pressure",
                        family="crypto",
                        source="aap_indicator:crypto_contribution",
                        level_label="Weighted crypto instability",
                        unit="pressure percentage points",
                        freshness_days=3,
                        values=_series_from_aas_rows(aas_rows, "crypto_contribution"),
                        pressure_multiplier=1.0,
                    ),
                ]
            )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Cross-market cache could not be read: {exc}")

    return sources, warnings


def _daily_close_returns(frame: pd.DataFrame | None) -> pd.Series:
    history = _normalize_price_frame(frame)
    if history.empty:
        return pd.Series(dtype=float)
    close = history["close"].copy()
    close.index = close.index.normalize()
    close = close[~close.index.duplicated(keep="last")].sort_index()
    return np.log(close.clip(lower=1e-12)).diff().replace([np.inf, -np.inf], np.nan)


def _aligned_relationship_frame(
    ticker_returns: pd.Series,
    source: ContextSource,
    lag: int,
) -> pd.DataFrame:
    if ticker_returns.empty or source.values.empty:
        return pd.DataFrame(columns=["target_return", "pressure_change"])
    dates = ticker_returns.index.sort_values()
    # Use only dates on which the cached source itself has an observation. This
    # avoids silently carrying a traded or derived daily value across missing
    # dates. A lag shifts the observed innovation by ticker trading days.
    pressure_change = source.values.diff().mul(source.pressure_multiplier).reindex(dates)
    aligned = pd.DataFrame(
        {
            "target_return": ticker_returns,
            "pressure_change": pressure_change.shift(lag),
        }
    ).dropna()
    return aligned[np.isfinite(aligned["target_return"]) & np.isfinite(aligned["pressure_change"])]


def _spearman(frame: pd.DataFrame) -> tuple[float | None, float | None]:
    if len(frame) < 3 or frame["pressure_change"].nunique() < 3 or frame["target_return"].nunique() < 3:
        return None, None
    statistic, p_value = spearmanr(frame["pressure_change"], frame["target_return"], nan_policy="omit")
    return _finite(statistic, 4), _finite(p_value, 6)


def _block_permutation_p_value(
    frame: pd.DataFrame,
    observed_rho: float | None,
    *,
    seed_key: str,
    permutations: int = 199,
    block_size: int = 5,
) -> float | None:
    """Two-sided null screen that preserves short runs of source innovations."""
    if observed_rho is None or len(frame) < MINIMUM_HOLDOUT_OBSERVATIONS:
        return None
    x_rank = pd.Series(frame["pressure_change"].to_numpy(dtype=float)).rank(method="average").to_numpy()
    y_rank = pd.Series(frame["target_return"].to_numpy(dtype=float)).rank(method="average").to_numpy()
    blocks = [x_rank[index : index + block_size] for index in range(0, len(x_rank), block_size)]
    if len(blocks) < 4:
        return None
    seed = int.from_bytes(hashlib.sha256(seed_key.encode("utf-8")).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    exceedances = 0
    for _ in range(permutations):
        order = rng.permutation(len(blocks))
        permuted = np.concatenate([blocks[index] for index in order])[: len(y_rank)]
        rho = float(np.corrcoef(permuted, y_rank)[0, 1])
        if np.isfinite(rho) and abs(rho) >= abs(observed_rho):
            exceedances += 1
    return round((exceedances + 1) / (permutations + 1), 6)


def _benjamini_hochberg(p_values: list[tuple[int, float]]) -> dict[int, float]:
    if not p_values:
        return {}
    ordered = sorted(p_values, key=lambda item: item[1])
    count = len(ordered)
    adjusted: dict[int, float] = {}
    running = 1.0
    for reverse_index in range(count - 1, -1, -1):
        original_index, p_value = ordered[reverse_index]
        rank = reverse_index + 1
        running = min(running, p_value * count / rank)
        adjusted[original_index] = round(min(1.0, running), 6)
    return adjusted


def _rolling_association(frame: pd.DataFrame, window: int = ROLLING_ASSOCIATION_WINDOW) -> list[dict[str, Any]]:
    if len(frame) < max(20, window // 2):
        return []
    # pandas rolling.corr is Pearson-only. Recompute Spearman ranks at a compact
    # set of evenly spaced trailing windows so the API stays responsive.
    values: list[dict[str, Any]] = []
    first_index = max(20, window // 2) - 1
    candidate_indices = np.linspace(first_index, len(frame) - 1, min(36, len(frame) - first_index)).round().astype(int)
    for index in sorted(set(candidate_indices.tolist())):
        sample = frame.iloc[max(0, index - window + 1) : index + 1]
        rho, _ = _spearman(sample)
        if rho is None:
            continue
        values.append({"date": pd.Timestamp(frame.index[index]).isoformat(), "rho": rho})
    return values


def _relationship_status(
    calibration_rho: float | None,
    holdout_rho: float | None,
    q_value: float | None,
    holdout_count: int,
) -> str:
    if calibration_rho is None or holdout_rho is None or holdout_count < MINIMUM_HOLDOUT_OBSERVATIONS:
        return "insufficient"
    same_direction = calibration_rho * holdout_rho > 0
    if not same_direction:
        return "unstable"
    if q_value is not None and q_value <= 0.10 and abs(holdout_rho) >= 0.15:
        return "persistent"
    return "directionally_consistent"


def build_cross_market_relationships(
    daily_frame: pd.DataFrame | None,
    *,
    symbol: str,
    sources: Sequence[ContextSource] | None = None,
) -> dict[str, Any]:
    ticker_returns = _daily_close_returns(daily_frame)
    loaded_sources, warnings = _load_context_sources() if sources is None else (list(sources), [])
    provisional: list[dict[str, Any]] = []

    for source in loaded_sources:
        available_values = source.values.dropna().sort_index()
        latest_at = available_values.index[-1] if not available_values.empty else None
        latest_value = _finite(available_values.iloc[-1], 2) if not available_values.empty else None
        latest_change = (
            _finite((available_values.iloc[-1] - available_values.iloc[-2]) * source.pressure_multiplier, 2)
            if len(available_values) >= 2
            else None
        )
        age_days = (
            max(0.0, (_utc_now() - latest_at.to_pydatetime()).total_seconds() / 86400.0)
            if latest_at is not None
            else None
        )
        freshness = (
            "unavailable"
            if age_days is None
            else "fresh"
            if age_days <= source.freshness_days
            else "stale"
        )

        lag_samples: list[tuple[int, pd.DataFrame, pd.DataFrame, float | None]] = []
        for lag in RELATIONSHIP_LAGS:
            aligned = _aligned_relationship_frame(ticker_returns, source, lag)
            split = max(MINIMUM_CALIBRATION_OBSERVATIONS, int(len(aligned) * 0.70))
            if len(aligned) - split < MINIMUM_HOLDOUT_OBSERVATIONS:
                calibration = aligned.iloc[:0]
                holdout = aligned.iloc[:0]
            else:
                calibration = aligned.iloc[:split]
                holdout = aligned.iloc[split:]
            calibration_rho, _ = _spearman(calibration)
            lag_samples.append((lag, calibration, holdout, calibration_rho))

        eligible = [sample for sample in lag_samples if sample[3] is not None]
        selected = max(eligible, key=lambda sample: abs(float(sample[3]))) if eligible else None
        if selected is None:
            selected_lag = None
            calibration = pd.DataFrame()
            holdout = pd.DataFrame()
            calibration_rho = None
            holdout_rho = None
            holdout_p = None
            full_aligned = pd.DataFrame()
        else:
            selected_lag, calibration, holdout, calibration_rho = selected
            holdout_rho, _ = _spearman(holdout)
            holdout_p = _block_permutation_p_value(
                holdout,
                holdout_rho,
                seed_key=f"{symbol}:{source.id}:{selected_lag}",
            )
            full_aligned = _aligned_relationship_frame(ticker_returns, source, selected_lag)

        provisional.append(
            {
                "id": source.id,
                "label": source.label,
                "family": source.family,
                "source": source.source,
                "level_label": source.level_label,
                "unit": source.unit,
                "current_value": latest_value,
                "current_pressure_change": latest_change,
                "as_of": latest_at.isoformat() if latest_at is not None else None,
                "freshness": freshness,
                "freshness_days": source.freshness_days,
                "age_days": _finite(age_days, 1),
                "source_observations": int(len(available_values)),
                "coverage_start": available_values.index[0].isoformat() if not available_values.empty else None,
                "coverage_end": available_values.index[-1].isoformat() if not available_values.empty else None,
                "selected_lag_days": selected_lag,
                "calibration_rho": calibration_rho,
                "calibration_observations": int(len(calibration)),
                "holdout_rho": holdout_rho,
                "holdout_p_value": holdout_p,
                "holdout_observations": int(len(holdout)),
                "holdout_q_value": None,
                "status": "insufficient",
                "rolling_association": _rolling_association(full_aligned),
                "input_definition": "Daily change in pressure, where positive means the cached market became more stressed.",
            }
        )

    adjusted = _benjamini_hochberg(
        [
            (index, float(item["holdout_p_value"]))
            for index, item in enumerate(provisional)
            if item["holdout_p_value"] is not None
        ]
    )
    for index, item in enumerate(provisional):
        item["holdout_q_value"] = adjusted.get(index)
        item["status"] = _relationship_status(
            item["calibration_rho"],
            item["holdout_rho"],
            item["holdout_q_value"],
            item["holdout_observations"],
        )
        rho = item["holdout_rho"]
        if rho is None:
            item["interpretation"] = "Not enough aligned holdout observations yet."
        elif rho > 0:
            item["interpretation"] = f"Rising {item['label'].lower()} has accompanied positive {symbol} returns in holdout."
        else:
            item["interpretation"] = f"Rising {item['label'].lower()} has accompanied negative {symbol} returns in holdout."

    status_order = {"persistent": 0, "directionally_consistent": 1, "unstable": 2, "insufficient": 3}
    relationships = sorted(
        provisional,
        key=lambda item: (
            status_order.get(str(item["status"]), 4),
            -abs(float(item["holdout_rho"] or 0.0)),
            str(item["label"]),
        ),
    )
    if ticker_returns.empty:
        warnings.append("Daily ticker history was unavailable, so cross-market relationships were not estimated.")

    return {
        "available": any(item["holdout_rho"] is not None for item in relationships),
        "relationship_timeframe": "1D",
        "target": f"{symbol} daily log return",
        "window": {
            "start": ticker_returns.index[0].isoformat() if not ticker_returns.empty else None,
            "end": ticker_returns.index[-1].isoformat() if not ticker_returns.empty else None,
            "timezone": "UTC",
            "source_carry_policy": "none",
        },
        "input_polarity": "Positive source changes always mean rising cross-market pressure.",
        "candidate_lags_days": list(RELATIONSHIP_LAGS),
        "selection": "Lag selected on the first 70% of aligned observations by absolute Spearman rho.",
        "validation": "The selected lag is re-estimated on the final 30%; five-observation block-permutation p-values are Benjamini-Hochberg adjusted across available sources.",
        "rolling_window_observations": ROLLING_ASSOCIATION_WINDOW,
        "relationships": relationships,
        "warnings": warnings,
    }


def _optionality_snapshot(symbol: str) -> dict[str, Any]:
    payload: dict[str, Any] | None = None
    cached_at: datetime | None = None
    latest_event: OptionAlertEvent | None = None
    event_count = 0
    first_event: datetime | None = None
    try:
        with get_db_session() as db:
            snapshot = (
                db.query(StockProjectionSnapshot)
                .filter(StockProjectionSnapshot.symbol == symbol)
                .first()
            )
            if snapshot is not None and isinstance(snapshot.payload, dict):
                payload = dict(snapshot.payload)
                cached_at = snapshot.cached_at

            event_query = db.query(OptionAlertEvent).filter(OptionAlertEvent.symbol == symbol)
            latest_event = event_query.order_by(OptionAlertEvent.triggered_at.desc()).first()
            event_count = event_query.count()
            first_event_row = event_query.order_by(OptionAlertEvent.triggered_at.asc()).first()
            first_event = first_event_row.triggered_at if first_event_row is not None else None
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "history_mode": "current_snapshot_plus_sparse_scanner_events",
            "error": str(exc),
        }

    optionality = payload.get("optionality") if isinstance(payload, dict) else None
    if not isinstance(optionality, dict):
        optionality = {}
    observed_at = _timestamp(cached_at)
    age_hours = (
        max(0.0, (_utc_now() - observed_at.to_pydatetime()).total_seconds() / 3600.0)
        if observed_at is not None
        else None
    )
    iv30 = _finite(optionality.get("iv30"), 2)
    hv30 = _finite(optionality.get("hv30"), 2)
    iv_hv_spread = _finite(iv30 - hv30, 2) if iv30 is not None and hv30 is not None else None
    if iv_hv_spread is None:
        relative_richness_state = "unavailable"
    elif iv_hv_spread <= -5.0:
        relative_richness_state = "implied_below_realized"
    elif iv_hv_spread >= 5.0:
        relative_richness_state = "implied_above_realized"
    else:
        relative_richness_state = "near_realized"

    scanner = None
    if latest_event is not None:
        scanner = {
            "latest_event_at": _iso(latest_event.triggered_at),
            "events": event_count,
            "coverage_start": _iso(first_event),
            "opportunity_score": _finite(latest_event.opportunity_score, 2),
            "opportunity_grade": latest_event.opportunity_grade,
            "iv30_pct": _finite(latest_event.iv30, 2),
            "hv30_pct": _finite(latest_event.hv30, 2),
            "iv_cross_section_percentile_pct": _finite(latest_event.iv_percentile, 1),
            "selected_spread_pct": _finite(latest_event.selected_spread_pct, 2),
            "selected_open_interest": latest_event.selected_open_interest,
            "selected_volume": latest_event.selected_volume,
        }

    return {
        "available": bool(optionality),
        "as_of": observed_at.isoformat() if observed_at is not None else None,
        "age_hours": _finite(age_hours, 1),
        "freshness": "unavailable" if age_hours is None else "fresh" if age_hours <= 24 else "stale",
        "history_mode": "current_snapshot_plus_sparse_scanner_events",
        "history_note": "Stock Analysis overwrites its current snapshot. Secret Options contributes only event-time observations, so optionality is not used as a continuous historical feature.",
        "iv30_pct": iv30,
        "hv30_pct": hv30,
        "iv_hv_spread_points": iv_hv_spread,
        "iv_cross_section_percentile_pct": _finite(optionality.get("iv_percentile"), 1),
        "avg_extrinsic_share_pct": _finite(optionality.get("avg_edr"), 2),
        "relative_richness_state": relative_richness_state,
        "data_source": optionality.get("data_source"),
        "quote_source": optionality.get("quote_source"),
        "scanner_evidence": scanner,
    }


def build_market_weather_context(
    *,
    symbol: str,
    selected_frame: pd.DataFrame | None,
    daily_frame: pd.DataFrame | None,
    visible_dates: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build a shadow-only context layer without changing the learned field."""
    technical = build_technical_context(selected_frame, visible_dates=visible_dates)
    cross_market = build_cross_market_relationships(daily_frame, symbol=symbol)
    return {
        "version": CONTEXT_VERSION,
        "generated_at": _utc_now().isoformat(),
        "mode": "shadow_only",
        "field_influence": "none",
        "description": "Price structure, current optionality, and cached cross-market relationships are shown beside the learned field but do not alter its state assignment.",
        "technical": technical,
        "optionality": _optionality_snapshot(symbol),
        "cross_market": cross_market,
        "promotion_rule": "A source can influence the field only after persistent direction, sufficient holdout coverage, timestamp-safe availability, and repeated out-of-sample validation are demonstrated.",
    }
