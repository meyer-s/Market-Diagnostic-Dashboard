from __future__ import annotations

from collections import Counter, deque
from math import factorial, log
from typing import Mapping, Sequence

import numpy as np
import pandas as pd


EPSILON = 1e-9


def _clip(values: np.ndarray, low: float = 0.0, high: float = 1.0) -> np.ndarray:
    return np.clip(np.nan_to_num(values, nan=0.0, posinf=high, neginf=low), low, high)


def _ewm_rows(values: np.ndarray, span: int) -> np.ndarray:
    return np.vstack(
        [
            pd.Series(row).ewm(span=max(1, span), adjust=False).mean().to_numpy(dtype=float)
            for row in values
        ]
    )


def _bounded_signed(values: np.ndarray, span: int) -> np.ndarray:
    """Causally scale a signed field without allowing large outliers to dominate."""
    scale = _ewm_rows(np.abs(values), span)
    normalized = np.divide(values, scale, out=np.zeros_like(values), where=scale > EPSILON)
    return normalized / (1.0 + np.abs(normalized))


def _time_derivative(values: np.ndarray, span: int) -> np.ndarray:
    raw = np.diff(values, axis=1, prepend=values[:, :1])
    return _bounded_signed(raw, span)


def _log_scale_derivatives(
    values: np.ndarray,
    horizons: Sequence[int],
    span: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Return signed first/second derivatives on the physical log-horizon axis."""
    if len(horizons) < 2:
        zeros = np.zeros_like(values)
        return zeros, zeros

    log_horizons = np.log(np.asarray(horizons, dtype=float))
    first_raw = np.gradient(values, log_horizons, axis=0, edge_order=1)
    second_raw = np.gradient(first_raw, log_horizons, axis=0, edge_order=1)
    return _bounded_signed(first_raw, span), _bounded_signed(second_raw, span)


def rolling_permutation_entropy(
    values: np.ndarray,
    *,
    order: int = 3,
    window: int = 24,
) -> np.ndarray:
    """Causal Bandt-Pompe ordinal-pattern entropy, normalized to [0, 1]."""
    if order < 2:
        raise ValueError("Permutation entropy order must be at least 2.")
    if window < 2:
        raise ValueError("Permutation entropy window must be at least 2.")

    result = np.zeros_like(values, dtype=float)
    denominator = log(factorial(order))
    for row_index, row in enumerate(values):
        active: deque[tuple[int, ...]] = deque()
        counts: Counter[tuple[int, ...]] = Counter()
        for time_index in range(len(row)):
            if time_index >= order - 1:
                sample = row[time_index - order + 1 : time_index + 1]
                pattern = tuple(np.argsort(sample, kind="mergesort").tolist())
                active.append(pattern)
                counts[pattern] += 1
                if len(active) > window:
                    expired = active.popleft()
                    counts[expired] -= 1
                    if counts[expired] <= 0:
                        del counts[expired]
            if len(active) >= 2:
                total = float(len(active))
                entropy = -sum((count / total) * log(count / total) for count in counts.values())
                result[row_index, time_index] = entropy / denominator
    return _clip(result)


def _rolling_realized_volatility(close: pd.Series, horizons: Sequence[int]) -> np.ndarray:
    returns = np.log(close.astype(float).clip(lower=EPSILON)).diff().fillna(0.0)
    rows = [
        np.sqrt(returns.pow(2).rolling(horizon, min_periods=1).sum()).to_numpy(dtype=float)
        for horizon in horizons
    ]
    return np.vstack(rows)


def _relative_level(values: np.ndarray, span: int) -> np.ndarray:
    baseline = _ewm_rows(values, span)
    ratio = np.divide(values + EPSILON, baseline + EPSILON)
    return _clip(0.5 + 0.5 * np.tanh(2.0 * np.log(ratio)))


def _carrier_fields(
    history: pd.DataFrame,
    horizons: Sequence[int],
    structure: np.ndarray,
) -> tuple[dict[str, np.ndarray], np.ndarray]:
    close = history["close"].astype(float)
    volume = history["volume"].astype(float).clip(lower=0.0)
    realized_volatility = _rolling_realized_volatility(close, horizons)

    volume_rows: list[np.ndarray] = []
    impact_rows: list[np.ndarray] = []
    absolute_returns = np.log(close.clip(lower=EPSILON)).diff().abs().fillna(0.0)
    dollar_volume = (close * volume).replace(0.0, np.nan)
    impact = (absolute_returns / dollar_volume).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    for horizon in horizons:
        volume_rows.append(volume.rolling(horizon, min_periods=1).mean().to_numpy(dtype=float))
        impact_rows.append(impact.rolling(horizon, min_periods=1).mean().to_numpy(dtype=float))

    volume_field = np.vstack(volume_rows)
    impact_field = np.vstack(impact_rows)
    baseline_span = max(34, int(max(horizons) * 2))
    carriers = {
        "price_structure": _clip(structure),
        "realized_volatility": _relative_level(realized_volatility, baseline_span),
        "participation": _relative_level(volume_field, baseline_span),
        "liquidity_stress": _relative_level(impact_field, baseline_span),
    }
    return carriers, realized_volatility


def _aggregate(values: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    if weights is None:
        return np.mean(values, axis=0)
    normalized = weights / max(EPSILON, float(np.sum(weights)))
    return np.sum(values * normalized[:, None], axis=0)


def _rounded(value: float | np.floating[object] | None, digits: int = 4) -> float | None:
    if value is None or not np.isfinite(float(value)):
        return None
    return round(float(value), digits)


def _relationship_result(
    *,
    identifier: str,
    label: str,
    hypothesis: str,
    outcome_label: str,
    forward_bars: int,
    event_mask: np.ndarray,
    event_outcome: np.ndarray,
    baseline_outcome: np.ndarray,
    hit_threshold: float,
    method: str,
) -> dict[str, object]:
    event_values = event_outcome[event_mask]
    baseline_values = baseline_outcome[np.isfinite(baseline_outcome)]
    sample_size = int(len(event_values))
    event_mean = float(np.mean(event_values)) if sample_size else 0.0
    baseline_mean = float(np.mean(baseline_values)) if len(baseline_values) else 0.0
    event_hit = float(np.mean(event_values > hit_threshold)) if sample_size else 0.0
    baseline_hit = float(np.mean(baseline_values > hit_threshold)) if len(baseline_values) else 0.0
    uplift = event_mean - baseline_mean
    hit_uplift = event_hit - baseline_hit
    if sample_size < 8:
        status = "insufficient_sample"
    elif sample_size >= 20 and uplift > 0.0 and hit_uplift >= 0.05:
        status = "interesting_in_sample"
    elif uplift > 0.0:
        status = "positive_but_unconfirmed"
    else:
        status = "not_supported_here"

    return {
        "id": identifier,
        "label": label,
        "hypothesis": hypothesis,
        "outcome": outcome_label,
        "forward_bars": forward_bars,
        "sample_size": sample_size,
        "event_mean": _rounded(event_mean, 6),
        "baseline_mean": _rounded(baseline_mean, 6),
        "uplift": _rounded(uplift, 6),
        "event_hit_rate": _rounded(event_hit),
        "baseline_hit_rate": _rounded(baseline_hit),
        "status": status,
        "method": method,
    }


def _build_relationship_atlas(
    close: np.ndarray,
    dates: Sequence[str],
    derivative_series: Mapping[str, np.ndarray],
    strata: Mapping[str, np.ndarray],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    count = len(close)
    forward_bars = max(3, min(10, count // 60))
    split = max(40, int(count * 0.60))
    split = min(split, count - forward_bars - 1)
    calibration_start = min(20, max(0, split - 20))
    calibration = np.arange(calibration_start, split)
    evaluation = np.arange(split, count - forward_bars)

    validation = {
        "design": "Chronological 60/40 calibration/evaluation split; event thresholds are learned only from calibration bars.",
        "calibration_bars": int(len(calibration)),
        "evaluation_bars": int(len(evaluation)),
        "calibration_end": dates[split - 1] if split > 0 else None,
        "evaluation_start": dates[split] if split < len(dates) else None,
        "forward_bars": forward_bars,
        "purged": False,
        "multiple_testing_adjusted": False,
    }
    if len(evaluation) < 8 or len(calibration) < 20:
        return [], validation

    close_safe = np.clip(close.astype(float), EPSILON, None)
    forward_return = close_safe[np.minimum(evaluation + forward_bars, count - 1)] / close_safe[evaluation] - 1.0
    direction = derivative_series["pressure"]
    signed_return = np.sign(direction[evaluation]) * forward_return
    reversal_return = -signed_return
    absolute_return = np.abs(forward_return)

    def quantile(name: str, amount: float, absolute: bool = False) -> float:
        values = derivative_series[name] if name in derivative_series else strata[name]
        sample = np.abs(values[calibration]) if absolute else values[calibration]
        return float(np.quantile(sample[np.isfinite(sample)], amount))

    abs_direction = np.abs(direction)
    aligned_velocity = np.sign(direction) * derivative_series["velocity"]
    aligned_velocity_threshold = float(np.quantile(aligned_velocity[calibration], 0.35))
    continuation_mask = (
        (strata["structure"][evaluation] >= quantile("structure", 0.70))
        & (strata["propagation"][evaluation] >= quantile("propagation", 0.60))
        & (strata["information"][evaluation] <= quantile("information", 0.50))
        & (abs_direction[evaluation] >= quantile("pressure", 0.60, absolute=True))
    )
    cascade_mask = (
        (strata["propagation"][evaluation] >= quantile("propagation", 0.72))
        & (strata["cascade_bias"][evaluation] >= max(0.08, quantile("cascade_bias", 0.62)))
        & (abs_direction[evaluation] >= quantile("pressure", 0.55, absolute=True))
    )
    shock_mask = (
        (strata["geometry"][evaluation] >= quantile("geometry", 0.75))
        & (strata["information"][evaluation] >= quantile("information", 0.60))
    )
    exhaustion_mask = (
        (strata["kinematics"][evaluation] >= quantile("kinematics", 0.75))
        & (abs_direction[evaluation] >= quantile("pressure", 0.65, absolute=True))
        & (aligned_velocity[evaluation] <= aligned_velocity_threshold)
    )

    signed_method = (
        "Thresholds use the first 60% of observations; results use the later 40%. "
        "Forward outcomes overlap and are descriptive, not significance tests."
    )
    absolute_baseline = absolute_return
    absolute_threshold = float(np.median(absolute_baseline))
    atlas = [
        _relationship_result(
            identifier="organized_expansion",
            label="Organized expansion",
            hypothesis="Strong, coherent, low-disorder structure persists in its current direction.",
            outcome_label="Direction-aligned forward return",
            forward_bars=forward_bars,
            event_mask=continuation_mask,
            event_outcome=signed_return,
            baseline_outcome=signed_return,
            hit_threshold=0.0,
            method=signed_method,
        ),
        _relationship_result(
            identifier="longward_cascade",
            label="Longward cascade",
            hypothesis="A coherent front moving from fast toward slower horizons precedes directional persistence.",
            outcome_label="Direction-aligned forward return",
            forward_bars=forward_bars,
            event_mask=cascade_mask,
            event_outcome=signed_return,
            baseline_outcome=signed_return,
            hit_threshold=0.0,
            method=signed_method,
        ),
        _relationship_result(
            identifier="geometry_disorder_shock",
            label="Geometry + disorder shock",
            hypothesis="High scale curvature with high formal entropy precedes an unusually large move.",
            outcome_label="Absolute forward return",
            forward_bars=forward_bars,
            event_mask=shock_mask,
            event_outcome=absolute_return,
            baseline_outcome=absolute_baseline,
            hit_threshold=absolute_threshold,
            method=signed_method,
        ),
        _relationship_result(
            identifier="kinematic_exhaustion",
            label="Kinematic exhaustion",
            hypothesis="A strong field whose aligned velocity is decaying while higher derivatives are elevated is vulnerable to reversal.",
            outcome_label="Counter-directional forward return",
            forward_bars=forward_bars,
            event_mask=exhaustion_mask,
            event_outcome=reversal_return,
            baseline_outcome=reversal_return,
            hit_threshold=0.0,
            method=signed_method,
        ),
    ]
    return atlas, validation


def build_market_weather_research(
    *,
    history: pd.DataFrame,
    dates: Sequence[str],
    horizons: Sequence[int],
    pressure: np.ndarray,
    velocity: np.ndarray,
    acceleration: np.ndarray,
    structural_strength: np.ndarray,
    coherence: np.ndarray,
    field_disorder: np.ndarray,
    boundary_energy: np.ndarray,
    motion_normalization_length: int,
) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    """Build the experimental field-calculus channels and an auditable evidence layer."""
    jerk = _time_derivative(acceleration, motion_normalization_length)
    snap = _time_derivative(jerk, motion_normalization_length)
    scale_gradient, scale_curvature = _log_scale_derivatives(
        pressure,
        horizons,
        motion_normalization_length,
    )
    mixed_derivative = _time_derivative(scale_gradient, motion_normalization_length)
    permutation_entropy = rolling_permutation_entropy(pressure, order=3, window=24)

    cascade_raw = np.divide(
        -(velocity * scale_gradient),
        np.square(scale_gradient) + 0.08,
        out=np.zeros_like(pressure),
    )
    cascade_velocity = np.tanh(cascade_raw)
    propagation_strength = _clip(
        np.sqrt(np.abs(velocity) * np.abs(scale_gradient)) * (0.45 + 0.55 * coherence) * 1.8
    )

    structure = _clip(0.58 * structural_strength + 0.42 * coherence)
    carriers, realized_volatility = _carrier_fields(history, horizons, structure)
    if len(horizons) < 2:
        scaling_exponent = np.zeros_like(realized_volatility)
    else:
        log_horizons = np.log(np.asarray(horizons, dtype=float))
        scaling_exponent = np.gradient(
            np.log(realized_volatility + EPSILON),
            log_horizons,
            axis=0,
            edge_order=1,
        )
        scaling_exponent = np.clip(np.nan_to_num(scaling_exponent), -2.0, 2.0)

    kinematics = _clip(
        0.18 * np.abs(velocity)
        + 0.24 * np.abs(acceleration)
        + 0.27 * np.abs(jerk)
        + 0.31 * np.abs(snap)
    )
    geometry = _clip(
        0.32 * np.abs(scale_gradient)
        + 0.28 * np.abs(scale_curvature)
        + 0.20 * np.abs(mixed_derivative)
        + 0.20 * boundary_energy
    )
    information = _clip(0.72 * permutation_entropy + 0.28 * field_disorder)

    weights = np.asarray(horizons, dtype=float)
    aggregate_derivatives = {
        "pressure": _aggregate(pressure, weights),
        "velocity": _aggregate(velocity, weights),
        "acceleration": _aggregate(acceleration, weights),
        "jerk": _aggregate(jerk, weights),
        "snap": _aggregate(snap, weights),
    }
    cascade_denominator = np.sum(propagation_strength, axis=0)
    cascade_bias = np.divide(
        np.sum(cascade_velocity * propagation_strength, axis=0),
        cascade_denominator,
        out=np.zeros_like(cascade_denominator),
        where=cascade_denominator > EPSILON,
    )
    aggregate_strata = {
        "structure": _aggregate(structure),
        "kinematics": _aggregate(kinematics),
        "geometry": _aggregate(geometry),
        "information": _aggregate(information),
        "propagation": _aggregate(propagation_strength),
        "cascade_bias": cascade_bias,
        "scaling_exponent": np.clip(_aggregate(scaling_exponent), -2.0, 2.0),
    }
    aggregate_carriers = {name: _aggregate(values) for name, values in carriers.items()}

    derivative_series = [
        {"date": date, **{name: _rounded(values[index]) for name, values in aggregate_derivatives.items()}}
        for index, date in enumerate(dates)
    ]
    strata_series = [
        {"date": date, **{name: _rounded(values[index]) for name, values in aggregate_strata.items()}}
        for index, date in enumerate(dates)
    ]
    carrier_series = [
        {"date": date, **{name: _rounded(values[index]) for name, values in aggregate_carriers.items()}}
        for index, date in enumerate(dates)
    ]
    relationship_atlas, validation = _build_relationship_atlas(
        history["close"].to_numpy(dtype=float),
        dates,
        aggregate_derivatives,
        aggregate_strata,
    )

    channels = {
        "jerk": jerk,
        "snap": snap,
        "scale_gradient": scale_gradient,
        "scale_curvature": scale_curvature,
        "mixed_derivative": mixed_derivative,
        "cascade_velocity": cascade_velocity,
        "propagation_strength": propagation_strength,
        "permutation_entropy": permutation_entropy,
        "scaling_exponent": scaling_exponent,
    }
    research = {
        "model": "Market Field Calculus v1",
        "coordinate": {
            "time": "causal bar sequence",
            "scale": "natural log of horizon in bars",
            "derivative_jet": "orders 0 through 4 in time, plus first, second, and mixed log-scale derivatives",
        },
        "definitions": {
            "entropy / field_disorder": "Legacy heuristic: log-horizon disagreement plus motion energy; not information entropy.",
            "coherence": "Log-horizon neighbor-agreement score; not spectral or wavelet coherence.",
            "permutation_entropy": "Causal normalized Bandt-Pompe ordinal-pattern entropy (order 3, trailing 24 patterns).",
            "cascade_velocity": "Regularized local level-set velocity -P_t/P_s; positive indicates motion toward longer horizons.",
            "scaling_exponent": "Local slope of log realized volatility versus log horizon; descriptive, not a Hurst estimate.",
            "confidence": "Uncalibrated organization score; not a probability.",
        },
        "derivative_series": derivative_series,
        "strata": {
            "latest": {name: _rounded(values[-1]) for name, values in aggregate_strata.items()},
            "series": strata_series,
        },
        "carriers": {
            "latest": {name: _rounded(values[-1]) for name, values in aggregate_carriers.items()},
            "series": carrier_series,
            "note": "Price structure, realized volatility, volume participation, and an Amihud-like OHLCV liquidity-stress proxy are separate carriers; the other strata are transformations of the price field.",
        },
        "relationship_atlas": relationship_atlas,
        "validation": validation,
        "notes": [
            "All live field features are prefix-invariant and use no future bars.",
            "The relationship atlas is retrospective: it uses future returns only to evaluate pre-existing event definitions on a later chronological segment.",
            "Adjacent horizons overlap heavily; transfer-entropy or causality claims require orthogonal frequency bands and surrogate tests.",
            "No multiple-testing correction has been applied. Interesting results are hypotheses for replication, not discoveries.",
        ],
    }
    return channels, research
