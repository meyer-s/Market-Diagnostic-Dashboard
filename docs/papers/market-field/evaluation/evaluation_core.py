from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy.special import logsumexp


EPSILON = 1e-12

FIELD_FEATURE_FAMILIES: dict[str, tuple[str, ...]] = {
    "pressure_state": (
        "pressure",
        "velocity",
        "acceleration",
        "jerk",
        "snap",
    ),
    "field_transform": (
        "structure",
        "kinematics",
        "geometry",
        "information",
        "propagation",
        "cascade_bias",
        "scaling_exponent",
    ),
    "ohlcv_carrier": (
        "realized_volatility",
        "participation",
        "liquidity_stress",
    ),
}
FIELD_FEATURES = tuple(
    feature
    for family_features in FIELD_FEATURE_FAMILIES.values()
    for feature in family_features
)
TECHNICAL_FEATURES = (
    "ema_displacement",
    "ema_slope",
    "path_efficiency",
    "variation_ratio",
    "volume_ratio",
)
CHANGE_POINT_FEATURES = (
    "return_mean_break",
    "return_variation_break",
    "range_break",
    "volume_break",
)
HMM_OBSERVATION_FEATURES = (
    "log_return",
    "absolute_log_return",
    "true_range_fraction",
    "log_volume_change",
)
TARGET_NAMES = (
    "forward_return",
    "forward_realized_variation",
    "pressure_aligned_maximum_adverse_excursion",
)

MODEL_SPECS: dict[str, dict[str, Any]] = {
    "naive_zero": {"kind": "zero"},
    "naive_fit_mean": {"kind": "mean"},
    "ema_12_24_ridge": {
        "kind": "ridge",
        "source": "technical",
        "features": TECHNICAL_FEATURES[:2],
    },
    "technical_24_ridge": {
        "kind": "ridge",
        "source": "technical",
        "features": TECHNICAL_FEATURES,
    },
    "causal_change_point_ridge": {
        "kind": "ridge",
        "source": "change_point",
        "features": CHANGE_POINT_FEATURES,
    },
    "gaussian_hmm_2state": {
        "kind": "hmm",
        "source": "hmm",
        "features": HMM_OBSERVATION_FEATURES,
    },
    "market_field_dictionary": {
        "kind": "dictionary",
        "source": "field",
        "features": FIELD_FEATURES,
    },
    "market_field_raw_ridge": {
        "kind": "ridge",
        "source": "field",
        "features": FIELD_FEATURES,
    },
    "market_field_minus_pressure_state": {
        "kind": "ridge",
        "source": "field",
        "features": tuple(
            feature
            for feature in FIELD_FEATURES
            if feature not in FIELD_FEATURE_FAMILIES["pressure_state"]
        ),
    },
    "market_field_minus_field_transform": {
        "kind": "ridge",
        "source": "field",
        "features": tuple(
            feature
            for feature in FIELD_FEATURES
            if feature not in FIELD_FEATURE_FAMILIES["field_transform"]
        ),
    },
    "market_field_minus_ohlcv_carrier": {
        "kind": "ridge",
        "source": "field",
        "features": tuple(
            feature
            for feature in FIELD_FEATURES
            if feature not in FIELD_FEATURE_FAMILIES["ohlcv_carrier"]
        ),
    },
}


@dataclass(frozen=True)
class PrequentialSplit:
    split_id: int
    fit_start: int
    fit_end: int
    calibration_start: int
    calibration_end: int
    origin: int
    purge_bars: int
    embargo_bars: int

    def to_dict(self) -> dict[str, int]:
        return {key: int(value) for key, value in asdict(self).items()}


def canonical_json_sha256(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    raise TypeError(f"Cannot serialize {type(value)!r}")


def normalize_history(frame: pd.DataFrame) -> pd.DataFrame:
    """Return a deterministic, validated adjusted-OHLCV frame."""
    if frame is None or frame.empty:
        raise ValueError("OHLCV history is empty.")
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index, errors="coerce", utc=True)
    normalized = normalized[normalized.index.notna()]
    normalized = normalized[~normalized.index.duplicated(keep="last")].sort_index()
    required = ("Open", "High", "Low", "Close", "Volume")
    missing = [column for column in required if column not in normalized.columns]
    if missing:
        raise ValueError(f"OHLCV history is missing columns: {missing}")
    normalized = normalized[list(required)].apply(pd.to_numeric, errors="coerce")
    if normalized[["Open", "High", "Low", "Close"]].isna().any().any():
        raise ValueError("OHLCV history contains nonfinite price cells.")
    normalized["Volume"] = normalized["Volume"].where(normalized["Volume"] >= 0.0)
    upper_boundary = normalized[["Open", "Low", "Close"]].max(axis=1)
    lower_boundary = normalized[["Open", "High", "Close"]].min(axis=1)
    high_below_boundary = (normalized["High"] < upper_boundary) & ~np.isclose(
        normalized["High"],
        upper_boundary,
        rtol=1e-12,
        atol=1e-12,
    )
    low_above_boundary = (normalized["Low"] > lower_boundary) & ~np.isclose(
        normalized["Low"],
        lower_boundary,
        rtol=1e-12,
        atol=1e-12,
    )
    invalid = (
        (normalized[["Open", "High", "Low", "Close"]] <= 0.0).any(axis=1)
        | high_below_boundary
        | low_above_boundary
    )
    if bool(invalid.any()):
        raise ValueError(f"OHLCV history contains {int(invalid.sum())} invalid price rows.")
    return normalized


def canonical_ohlcv_sha256(frame: pd.DataFrame) -> str:
    canonical = normalize_history(frame)[
        ["Open", "High", "Low", "Close", "Volume"]
    ].to_csv(
        date_format="%Y-%m-%dT%H:%M:%SZ",
        float_format="%.10g",
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def technical_feature_frame(history: pd.DataFrame) -> pd.DataFrame:
    """Build the paper's causal five-coordinate 24-bar technical baseline."""
    history = normalize_history(history)
    epsilon = 1e-9
    close = history["Close"].astype(float)
    high = history["High"].astype(float)
    low = history["Low"].astype(float)
    volume = history["Volume"].astype(float)
    midpoint = (high + low) / 2.0
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr24 = true_range.rolling(24, min_periods=1).mean()
    ema12 = midpoint.ewm(
        span=12,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    ema24 = midpoint.ewm(
        span=24,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()

    def signed_bound(values: pd.Series) -> pd.Series:
        finite = values.replace([np.inf, -np.inf], np.nan).fillna(0.0)
        return finite / (1.0 + finite.abs())

    ema_displacement = signed_bound((ema12 - ema24) / atr24.clip(lower=epsilon))
    ema_change = ema24.diff().fillna(0.0)
    ema_change_scale = ema_change.abs().ewm(
        span=13,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    ema_slope = signed_bound(ema_change / ema_change_scale.clip(lower=epsilon))
    path = midpoint.diff().abs().rolling(24, min_periods=1).sum()
    displacement = midpoint - midpoint.shift(24)
    path_efficiency = (
        displacement.abs() / path.clip(lower=epsilon)
    ).clip(0.0, 1.0) * np.sign(displacement.fillna(0.0))
    returns = np.log(close.clip(lower=epsilon)).diff().fillna(0.0)
    realized_variation = np.sqrt(
        returns.pow(2).rolling(24, min_periods=1).sum()
    )
    variation_baseline = realized_variation.ewm(
        span=48,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    variation_ratio = signed_bound(
        np.log((realized_variation + epsilon) / (variation_baseline + epsilon))
    )
    rolling_volume = volume.rolling(24, min_periods=1).mean()
    volume_baseline = rolling_volume.ewm(
        span=48,
        adjust=False,
        ignore_na=False,
        min_periods=0,
    ).mean()
    volume_ratio = signed_bound(
        np.log((rolling_volume + epsilon) / (volume_baseline + epsilon))
    )
    return pd.DataFrame(
        {
            "ema_displacement": ema_displacement,
            "ema_slope": ema_slope,
            "path_efficiency": path_efficiency,
            "variation_ratio": variation_ratio,
            "volume_ratio": volume_ratio,
        },
        index=history.index,
    ).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def change_point_feature_frame(history: pd.DataFrame) -> pd.DataFrame:
    """Build causal two-window location/scale break scores.

    This is a fixed structural-break feature baseline, not a fitted Bayesian
    change-point posterior. Every value at row t uses observations no later
    than t; the evaluation warm-up excludes its startup fill.
    """
    history = normalize_history(history)
    epsilon = 1e-9
    close = history["Close"].astype(float).clip(lower=epsilon)
    returns = np.log(close).diff()
    previous_close = close.shift(1)
    range_fraction = (
        (history["High"].astype(float) - history["Low"].astype(float))
        / previous_close
    )
    log_volume = np.log1p(history["Volume"].astype(float).clip(lower=0.0))

    def bounded_log_ratio(
        recent: pd.Series,
        prior: pd.Series,
    ) -> pd.Series:
        raw = np.log(
            (recent.abs() + epsilon) / (prior.abs() + epsilon)
        )
        return raw / (1.0 + raw.abs())

    recent_return_mean = returns.rolling(12, min_periods=12).mean()
    prior_return_mean = returns.shift(12).rolling(48, min_periods=48).mean()
    prior_return_scale = returns.shift(12).rolling(48, min_periods=24).std()
    mean_break_raw = (
        (recent_return_mean - prior_return_mean)
        / prior_return_scale.clip(lower=epsilon)
    )
    return_mean_break = mean_break_raw / (1.0 + mean_break_raw.abs())

    recent_variation = returns.rolling(12, min_periods=12).std()
    prior_variation = returns.shift(12).rolling(48, min_periods=24).std()
    return_variation_break = bounded_log_ratio(
        recent_variation,
        prior_variation,
    )

    recent_range = range_fraction.rolling(12, min_periods=12).mean()
    prior_range = range_fraction.shift(12).rolling(48, min_periods=24).mean()
    range_break = bounded_log_ratio(recent_range, prior_range)

    recent_volume = log_volume.rolling(12, min_periods=6).mean()
    prior_volume = log_volume.shift(12).rolling(48, min_periods=12).mean()
    volume_break = bounded_log_ratio(recent_volume, prior_volume)

    return pd.DataFrame(
        {
            "return_mean_break": return_mean_break,
            "return_variation_break": return_variation_break,
            "range_break": range_break,
            "volume_break": volume_break,
        },
        index=history.index,
    ).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def hmm_observation_frame(history: pd.DataFrame) -> pd.DataFrame:
    """Build causal observations for the fixed two-state Gaussian HMM."""
    history = normalize_history(history)
    epsilon = 1e-9
    close = history["Close"].astype(float).clip(lower=epsilon)
    log_return = np.log(close).diff().fillna(0.0)
    previous_close = close.shift(1).fillna(close.iloc[0])
    true_range_fraction = pd.concat(
        [
            history["High"].astype(float) - history["Low"].astype(float),
            (history["High"].astype(float) - previous_close).abs(),
            (history["Low"].astype(float) - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1) / previous_close.clip(lower=epsilon)
    log_volume = np.log1p(history["Volume"].astype(float).clip(lower=0.0))
    log_volume_change = log_volume.diff().fillna(0.0)
    return pd.DataFrame(
        {
            "log_return": log_return,
            "absolute_log_return": log_return.abs(),
            "true_range_fraction": true_range_fraction,
            "log_volume_change": log_volume_change,
        },
        index=history.index,
    ).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def generate_prequential_splits(
    observation_count: int,
    *,
    feature_warmup_bars: int,
    minimum_proper_fit_bars: int,
    fit_calibration_purge_bars: int,
    calibration_bars: int,
    calibration_test_embargo_bars: int,
    origin_step_bars: int,
) -> list[PrequentialSplit]:
    """Generate expanding, origin-only evaluation splits through the sample end."""
    values = (
        observation_count,
        feature_warmup_bars,
        minimum_proper_fit_bars,
        fit_calibration_purge_bars,
        calibration_bars,
        calibration_test_embargo_bars,
        origin_step_bars,
    )
    if any(int(value) < 0 for value in values):
        raise ValueError("Split parameters cannot be negative.")
    if origin_step_bars <= 0:
        raise ValueError("origin_step_bars must be positive.")
    first_origin = (
        feature_warmup_bars
        + minimum_proper_fit_bars
        + fit_calibration_purge_bars
        + calibration_bars
        + calibration_test_embargo_bars
    )
    splits: list[PrequentialSplit] = []
    for split_id, origin in enumerate(
        range(first_origin, observation_count, origin_step_bars),
        start=1,
    ):
        calibration_end = origin - calibration_test_embargo_bars
        calibration_start = calibration_end - calibration_bars
        fit_end = calibration_start - fit_calibration_purge_bars
        split = PrequentialSplit(
            split_id=split_id,
            fit_start=feature_warmup_bars,
            fit_end=fit_end,
            calibration_start=calibration_start,
            calibration_end=calibration_end,
            origin=origin,
            purge_bars=fit_calibration_purge_bars,
            embargo_bars=calibration_test_embargo_bars,
        )
        validate_split(split, observation_count=observation_count)
        if split.fit_end - split.fit_start < minimum_proper_fit_bars:
            raise AssertionError("Generated split violates the minimum proper-fit length.")
        splits.append(split)
    return splits


def validate_split(split: PrequentialSplit, *, observation_count: int) -> None:
    if not (
        0
        <= split.fit_start
        < split.fit_end
        <= split.calibration_start
        < split.calibration_end
        <= split.origin
        < observation_count
    ):
        raise ValueError(f"Invalid chronological split: {split}")
    if split.calibration_start - split.fit_end != split.purge_bars:
        raise ValueError("Fit/calibration purge length is inconsistent.")
    if split.origin - split.calibration_end != split.embargo_bars:
        raise ValueError("Calibration/test embargo length is inconsistent.")


def build_outcome_frame(
    history: pd.DataFrame,
    *,
    direction: Sequence[float],
    horizons: Sequence[int],
) -> pd.DataFrame:
    """Construct auditable future-only outcome columns on the source index."""
    history = normalize_history(history)
    direction_values = np.asarray(direction, dtype=float)
    if len(direction_values) != len(history):
        raise ValueError("Direction length must equal OHLCV history length.")
    close = history["Close"].to_numpy(dtype=float)
    high = history["High"].to_numpy(dtype=float)
    low = history["Low"].to_numpy(dtype=float)
    log_returns = np.diff(np.log(np.clip(close, EPSILON, None)), prepend=np.nan)
    output: dict[str, np.ndarray] = {}
    count = len(history)
    for horizon_value in horizons:
        horizon = int(horizon_value)
        if horizon <= 0:
            raise ValueError("Outcome horizons must be positive.")
        forward_return = np.full(count, np.nan, dtype=float)
        realized_variation = np.full(count, np.nan, dtype=float)
        adverse_excursion = np.full(count, np.nan, dtype=float)
        for index in range(0, max(0, count - horizon)):
            endpoint = index + horizon
            forward_return[index] = close[endpoint] / close[index] - 1.0
            future_returns = log_returns[index + 1 : endpoint + 1]
            if len(future_returns) == horizon and np.all(np.isfinite(future_returns)):
                realized_variation[index] = math.sqrt(float(np.sum(np.square(future_returns))))
            sign = float(np.sign(direction_values[index]))
            if sign > 0.0:
                adverse_excursion[index] = float(
                    np.min(low[index + 1 : endpoint + 1] / close[index] - 1.0)
                )
            elif sign < 0.0:
                adverse_excursion[index] = float(
                    np.min(1.0 - high[index + 1 : endpoint + 1] / close[index])
                )
        output[target_column("forward_return", horizon)] = forward_return
        output[
            target_column("forward_realized_variation", horizon)
        ] = realized_variation
        output[
            target_column(
                "pressure_aligned_maximum_adverse_excursion",
                horizon,
            )
        ] = adverse_excursion
    return pd.DataFrame(output, index=history.index)


def target_column(outcome: str, horizon_bars: int) -> str:
    if outcome not in TARGET_NAMES:
        raise ValueError(f"Unknown outcome {outcome!r}")
    return f"{outcome}__h{int(horizon_bars)}"


def parse_target_column(column: str) -> tuple[str, int]:
    outcome, separator, horizon = column.rpartition("__h")
    if not separator or outcome not in TARGET_NAMES:
        raise ValueError(f"Invalid target column {column!r}")
    return outcome, int(horizon)


def robust_fit_scale(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or not len(values):
        raise ValueError("Robust scaling requires a nonempty two-dimensional matrix.")
    center = np.median(values, axis=0)
    lower = np.quantile(values, 0.25, axis=0, method="linear")
    upper = np.quantile(values, 0.75, axis=0, method="linear")
    scale = upper - lower
    mad_scale = 1.4826 * np.median(np.abs(values - center), axis=0)
    standard_scale = np.std(values, axis=0)
    scale = np.where(scale > EPSILON, scale, mad_scale)
    scale = np.where(scale > EPSILON, scale, standard_scale)
    scale = np.where(scale > EPSILON, scale, 1.0)
    return center, scale


def _complete_rows(*arrays: np.ndarray) -> np.ndarray:
    if not arrays:
        raise ValueError("At least one array is required.")
    masks: list[np.ndarray] = []
    for values in arrays:
        numeric = np.asarray(values, dtype=float)
        if numeric.ndim == 1:
            masks.append(np.isfinite(numeric))
        elif numeric.ndim == 2:
            masks.append(np.all(np.isfinite(numeric), axis=1))
        else:
            raise ValueError("Only one- and two-dimensional arrays are supported.")
    result = masks[0].copy()
    for mask in masks[1:]:
        result &= mask
    return result


def _ridge_coefficients(
    standardized_x: np.ndarray,
    y: np.ndarray,
    *,
    alpha: float,
) -> tuple[np.ndarray, np.ndarray]:
    y_mean = np.mean(y, axis=0)
    centered_y = y - y_mean
    gram = standardized_x.T @ standardized_x
    penalty = np.eye(standardized_x.shape[1], dtype=float) * float(alpha)
    beta = np.linalg.solve(gram + penalty, standardized_x.T @ centered_y)
    return y_mean, beta


def _hmm_log_emissions(
    observations: np.ndarray,
    means: np.ndarray,
    variances: np.ndarray,
) -> np.ndarray:
    observations = np.asarray(observations, dtype=float)
    dimension = observations.shape[1]
    return -0.5 * (
        dimension * math.log(2.0 * math.pi)
        + np.sum(np.log(variances), axis=1)[None, :]
        + np.sum(
            np.square(
                observations[:, None, :] - means[None, :, :]
            )
            / variances[None, :, :],
            axis=2,
        )
    )


def _hmm_forward_backward(
    log_emissions: np.ndarray,
    initial_probability: np.ndarray,
    transition_probability: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, float]:
    count, states = log_emissions.shape
    log_initial = np.log(np.clip(initial_probability, EPSILON, None))
    log_transition = np.log(
        np.clip(transition_probability, EPSILON, None)
    )
    log_alpha = np.empty((count, states), dtype=float)
    log_alpha[0] = log_initial + log_emissions[0]
    for index in range(1, count):
        log_alpha[index] = log_emissions[index] + logsumexp(
            log_alpha[index - 1][:, None] + log_transition,
            axis=0,
        )
    log_likelihood = float(logsumexp(log_alpha[-1]))
    log_beta = np.zeros((count, states), dtype=float)
    for index in range(count - 2, -1, -1):
        log_beta[index] = logsumexp(
            log_transition
            + log_emissions[index + 1][None, :]
            + log_beta[index + 1][None, :],
            axis=1,
        )
    log_gamma = log_alpha + log_beta - log_likelihood
    gamma = np.exp(
        log_gamma - logsumexp(log_gamma, axis=1, keepdims=True)
    )
    transition_expectation = np.zeros((states, states), dtype=float)
    for index in range(1, count):
        log_xi = (
            log_alpha[index - 1][:, None]
            + log_transition
            + log_emissions[index][None, :]
            + log_beta[index][None, :]
            - log_likelihood
        )
        transition_expectation += np.exp(
            log_xi - logsumexp(log_xi)
        )
    return gamma, transition_expectation, log_likelihood


def fit_diagonal_gaussian_hmm(
    observations: np.ndarray,
    *,
    state_count: int = 2,
    maximum_iterations: int = 8,
    variance_floor: float = 1e-4,
    convergence_tolerance: float = 1e-6,
) -> dict[str, Any]:
    """Fit a deterministic diagonal-Gaussian HMM on proper-fit rows only."""
    values = np.asarray(observations, dtype=float)
    if values.ndim != 2 or len(values) < max(40, state_count * 10):
        raise ValueError("Gaussian HMM requires a sufficiently long 2D matrix.")
    if state_count != 2:
        raise ValueError("Protocol v0 fixes the Gaussian HMM to two states.")
    if not np.all(np.isfinite(values)):
        raise ValueError("Gaussian HMM observations must be finite.")
    if maximum_iterations <= 0 or variance_floor <= 0.0:
        raise ValueError("Gaussian HMM iteration and variance settings are invalid.")

    ordering_feature = values[:, 1]
    median = float(np.median(ordering_feature))
    initial_groups = (
        ordering_feature <= median,
        ordering_feature > median,
    )
    global_mean = np.mean(values, axis=0)
    global_variance = np.maximum(
        np.var(values, axis=0),
        variance_floor,
    )
    means = np.stack(
        [
            (
                np.mean(values[group], axis=0)
                if np.any(group)
                else global_mean.copy()
            )
            for group in initial_groups
        ]
    )
    variances = np.repeat(
        global_variance[None, :],
        state_count,
        axis=0,
    )
    initial_probability = np.full(state_count, 1.0 / state_count)
    transition_probability = np.asarray(
        [[0.95, 0.05], [0.05, 0.95]],
        dtype=float,
    )
    previous_likelihood: float | None = None
    converged = False
    iterations = 0
    for iterations in range(1, maximum_iterations + 1):
        log_emissions = _hmm_log_emissions(values, means, variances)
        gamma, transition_expectation, log_likelihood = (
            _hmm_forward_backward(
                log_emissions,
                initial_probability,
                transition_probability,
            )
        )
        state_weights = np.sum(gamma, axis=0)
        if np.any(state_weights < 5.0):
            raise ValueError("Gaussian HMM produced an unsupported state.")
        initial_probability = (gamma[0] + 0.5) / np.sum(
            gamma[0] + 0.5
        )
        transition_prior = np.full((state_count, state_count), 0.5)
        np.fill_diagonal(transition_prior, 1.5)
        transition_probability = (
            transition_expectation + transition_prior
        )
        transition_probability /= np.sum(
            transition_probability,
            axis=1,
            keepdims=True,
        )
        means = (gamma.T @ values) / state_weights[:, None]
        centered = values[:, None, :] - means[None, :, :]
        variances = (
            np.sum(
                gamma[:, :, None] * np.square(centered),
                axis=0,
            )
            / state_weights[:, None]
        )
        variances = np.maximum(variances, variance_floor)
        if (
            previous_likelihood is not None
            and abs(log_likelihood - previous_likelihood)
            <= convergence_tolerance * (1.0 + abs(previous_likelihood))
        ):
            converged = True
            break
        previous_likelihood = log_likelihood

    order = sorted(
        range(state_count),
        key=lambda state: tuple(np.round(means[state], 10).tolist())
        + (state,),
    )
    ordered = np.asarray(order, dtype=int)
    means = means[ordered]
    variances = variances[ordered]
    initial_probability = initial_probability[ordered]
    initial_probability /= np.sum(initial_probability)
    transition_probability = transition_probability[
        np.ix_(ordered, ordered)
    ]
    return {
        "means": means,
        "variances": variances,
        "initial_probability": initial_probability,
        "transition_probability": transition_probability,
        "iterations": int(iterations),
        "converged": bool(converged),
        "fit_log_likelihood": float(
            _hmm_forward_backward(
                _hmm_log_emissions(values, means, variances),
                initial_probability,
                transition_probability,
            )[2]
        ),
    }


def filter_diagonal_gaussian_hmm(
    observations: np.ndarray,
    parameters: Mapping[str, Any],
) -> np.ndarray:
    """Return causal filtered state probabilities under fixed parameters."""
    values = np.asarray(observations, dtype=float)
    if values.ndim != 2 or not len(values) or not np.all(np.isfinite(values)):
        raise ValueError("Gaussian HMM filtering requires finite 2D observations.")
    means = np.asarray(parameters["means"], dtype=float)
    variances = np.asarray(parameters["variances"], dtype=float)
    initial_probability = np.asarray(
        parameters["initial_probability"],
        dtype=float,
    )
    transition_probability = np.asarray(
        parameters["transition_probability"],
        dtype=float,
    )
    log_emissions = _hmm_log_emissions(values, means, variances)
    probabilities = np.empty((len(values), len(means)), dtype=float)
    log_state = (
        np.log(np.clip(initial_probability, EPSILON, None))
        + log_emissions[0]
    )
    log_state -= logsumexp(log_state)
    probabilities[0] = np.exp(log_state)
    log_transition = np.log(
        np.clip(transition_probability, EPSILON, None)
    )
    for index in range(1, len(values)):
        log_state = log_emissions[index] + logsumexp(
            log_state[:, None] + log_transition,
            axis=0,
        )
        log_state -= logsumexp(log_state)
        probabilities[index] = np.exp(log_state)
    return probabilities


def _deterministic_kmeans(
    values: np.ndarray,
    *,
    cluster_count: int,
    iterations: int = 40,
) -> tuple[np.ndarray, np.ndarray]:
    if len(values) < cluster_count:
        raise ValueError("K-means requires at least one row per cluster.")
    distance_from_origin = np.sum(np.square(values), axis=1)
    selected = [int(np.argmin(distance_from_origin))]
    centroids = [values[selected[0]].copy()]
    while len(centroids) < cluster_count:
        distances = np.min(
            np.stack(
                [
                    np.sum(np.square(values - centroid), axis=1)
                    for centroid in centroids
                ]
            ),
            axis=0,
        )
        distances[np.asarray(selected, dtype=int)] = -1.0
        selected.append(int(np.argmax(distances)))
        centroids.append(values[selected[-1]].copy())
    centroid_array = np.stack(centroids)
    assignments = np.zeros(len(values), dtype=int)
    for _ in range(iterations):
        distances = np.stack(
            [
                np.sum(np.square(values - centroid), axis=1)
                for centroid in centroid_array
            ],
            axis=1,
        )
        next_assignments = np.argmin(distances, axis=1)
        next_centroids = centroid_array.copy()
        for cluster in range(cluster_count):
            members = values[next_assignments == cluster]
            if len(members):
                next_centroids[cluster] = np.mean(members, axis=0)
        if np.array_equal(assignments, next_assignments) and np.allclose(
            centroid_array,
            next_centroids,
            rtol=0.0,
            atol=1e-12,
        ):
            centroid_array = next_centroids
            assignments = next_assignments
            break
        centroid_array = next_centroids
        assignments = next_assignments
    return centroid_array, assignments


def _mean_silhouette(
    values: np.ndarray,
    assignments: np.ndarray,
    cluster_count: int,
) -> float:
    if cluster_count <= 1 or len(values) <= cluster_count:
        return 0.0
    pairwise = np.sqrt(
        np.sum(
            np.square(values[:, None, :] - values[None, :, :]),
            axis=2,
        )
    )
    silhouettes = np.zeros(len(values), dtype=float)
    for index, state in enumerate(assignments):
        same = assignments == state
        same[index] = False
        within = float(np.mean(pairwise[index, same])) if np.any(same) else 0.0
        alternatives = [
            float(np.mean(pairwise[index, assignments == other]))
            for other in range(cluster_count)
            if other != state and np.any(assignments == other)
        ]
        between = min(alternatives) if alternatives else 0.0
        denominator = max(within, between)
        silhouettes[index] = (
            (between - within) / denominator if denominator > EPSILON else 0.0
        )
    return float(np.mean(silhouettes))


def _select_supported_centroids(
    values: np.ndarray,
    *,
    maximum_clusters: int = 5,
) -> tuple[np.ndarray, int]:
    minimum_support = max(20, int(math.ceil(len(values) * 0.05)))
    upper = min(maximum_clusters, max(1, len(values) // minimum_support))
    candidates: list[tuple[float, int, np.ndarray]] = []
    for cluster_count in range(2, upper + 1):
        centroids, assignments = _deterministic_kmeans(
            values,
            cluster_count=cluster_count,
        )
        counts = np.bincount(assignments, minlength=cluster_count)
        if np.any(counts < minimum_support):
            continue
        pairwise = np.sqrt(
            np.sum(
                np.square(centroids[:, None, :] - centroids[None, :, :]),
                axis=2,
            )
        )
        if np.any(pairwise[np.triu_indices(cluster_count, 1)] <= 1e-6):
            continue
        silhouette = _mean_silhouette(values, assignments, cluster_count)
        if silhouette >= 0.25:
            candidates.append((silhouette, cluster_count, centroids))
    if candidates:
        _, _, selected = max(candidates, key=lambda item: (item[0], -item[1]))
        return selected, minimum_support
    centroids, _ = _deterministic_kmeans(values, cluster_count=1)
    return centroids, minimum_support


def _canonicalize_centroids(centroids: np.ndarray) -> np.ndarray:
    order = sorted(
        range(len(centroids)),
        key=lambda index: tuple(np.round(centroids[index], 10).tolist())
        + (index,),
    )
    return centroids[np.asarray(order, dtype=int)]


def _assign_centroids(values: np.ndarray, centroids: np.ndarray) -> np.ndarray:
    distances = np.stack(
        [
            np.sum(np.square(values - centroid), axis=1)
            for centroid in centroids
        ],
        axis=1,
    )
    return np.argmin(distances, axis=1)


def field_metric_weights(features: Sequence[str]) -> np.ndarray:
    selected = tuple(features)
    families_present = [
        family
        for family, family_features in FIELD_FEATURE_FAMILIES.items()
        if any(feature in family_features for feature in selected)
    ]
    if not families_present:
        raise ValueError("No recognized Market Field feature family is present.")
    family_weight = 1.0 / len(families_present)
    weights = []
    for feature in selected:
        family = next(
            (
                candidate
                for candidate, family_features in FIELD_FEATURE_FAMILIES.items()
                if feature in family_features
            ),
            None,
        )
        if family is None:
            raise ValueError(f"Unknown Market Field feature {feature!r}")
        selected_in_family = sum(
            candidate in FIELD_FEATURE_FAMILIES[family]
            for candidate in selected
        )
        weights.append(family_weight / selected_in_family)
    return np.asarray(weights, dtype=float)


def _calibration_radius(
    actual: np.ndarray,
    predicted: np.ndarray,
    *,
    quantile: float,
    minimum_rows: int = 20,
) -> tuple[np.ndarray, np.ndarray]:
    if actual.shape != predicted.shape or actual.ndim != 2:
        raise ValueError("Calibration arrays must be aligned two-dimensional matrices.")
    radii = np.full(actual.shape[1], np.nan, dtype=float)
    counts = np.zeros(actual.shape[1], dtype=int)
    for target_index in range(actual.shape[1]):
        valid = np.isfinite(actual[:, target_index]) & np.isfinite(
            predicted[:, target_index]
        )
        counts[target_index] = int(np.sum(valid))
        if counts[target_index] >= minimum_rows:
            radii[target_index] = float(
                np.quantile(
                    np.abs(
                        actual[valid, target_index]
                        - predicted[valid, target_index]
                    ),
                    quantile,
                    method="higher",
                )
            )
    return radii, counts


def fit_predict_all_targets(
    *,
    model_id: str,
    split: PrequentialSplit,
    field_features: pd.DataFrame,
    technical_features: pd.DataFrame,
    outcomes: pd.DataFrame,
    ridge_alpha: float,
    minimum_model_fit_rows: int,
    minimum_dictionary_state_outcomes: int,
    interval_calibration_quantile: float,
    change_point_features: pd.DataFrame | None = None,
    hmm_features: pd.DataFrame | None = None,
    hmm_maximum_iterations: int = 8,
    hmm_variance_floor: float = 1e-4,
) -> dict[str, Any]:
    """Fit one model at one origin and predict every predeclared outcome."""
    if model_id not in MODEL_SPECS:
        raise ValueError(f"Unknown model {model_id!r}")
    if not field_features.index.equals(outcomes.index):
        raise ValueError("Field-feature and outcome indexes do not align.")
    if not technical_features.index.equals(outcomes.index):
        raise ValueError("Technical-feature and outcome indexes do not align.")
    if (
        change_point_features is not None
        and not change_point_features.index.equals(outcomes.index)
    ):
        raise ValueError("Change-point-feature and outcome indexes do not align.")
    if (
        hmm_features is not None
        and not hmm_features.index.equals(outcomes.index)
    ):
        raise ValueError("HMM-feature and outcome indexes do not align.")
    target_columns = list(outcomes.columns)
    y = outcomes.to_numpy(dtype=float)
    fit_slice = slice(split.fit_start, split.fit_end)
    calibration_slice = slice(split.calibration_start, split.calibration_end)
    fit_y = y[fit_slice]
    calibration_y = y[calibration_slice]
    spec = MODEL_SPECS[model_id]
    result: dict[str, Any] = {
        "model_id": model_id,
        "status": "ok",
        "reason": None,
        "target_columns": target_columns,
        "predictions": np.full(len(target_columns), np.nan, dtype=float),
        "interval_radius": np.full(len(target_columns), np.nan, dtype=float),
        "fit_rows": 0,
        "fit_rows_by_target": np.zeros(len(target_columns), dtype=int),
        "calibration_rows": 0,
        "calibration_rows_by_target": np.zeros(len(target_columns), dtype=int),
        "target_reasons": [None] * len(target_columns),
        "assigned_state": None,
        "archetype_count": None,
        "model_iterations": None,
        "model_converged": None,
    }

    if spec["kind"] == "zero":
        predictions = np.zeros(len(target_columns), dtype=float)
        calibration_predictions = np.zeros_like(calibration_y)
        interval_radius, calibration_rows = _calibration_radius(
            calibration_y,
            calibration_predictions,
            quantile=interval_calibration_quantile,
        )
        result.update(
            predictions=predictions,
            interval_radius=interval_radius,
            fit_rows=int(np.sum(np.any(np.isfinite(fit_y), axis=1))),
            fit_rows_by_target=np.sum(np.isfinite(fit_y), axis=0),
            calibration_rows=int(np.max(calibration_rows, initial=0)),
            calibration_rows_by_target=calibration_rows,
        )
        return result

    if spec["kind"] == "mean":
        y_mean = np.full(len(target_columns), np.nan, dtype=float)
        fit_counts = np.sum(np.isfinite(fit_y), axis=0).astype(int)
        target_reasons: list[str | None] = [None] * len(target_columns)
        for target_index, count in enumerate(fit_counts):
            if int(count) < minimum_model_fit_rows:
                target_reasons[target_index] = (
                    "insufficient_complete_fit_outcomes"
                )
                continue
            finite = np.isfinite(fit_y[:, target_index])
            y_mean[target_index] = float(
                np.mean(fit_y[finite, target_index])
            )
        calibration_predictions = np.repeat(
            y_mean[None, :],
            len(calibration_y),
            axis=0,
        )
        interval_radius, calibration_rows = _calibration_radius(
            calibration_y,
            calibration_predictions,
            quantile=interval_calibration_quantile,
        )
        result.update(
            predictions=y_mean,
            interval_radius=interval_radius,
            fit_rows=int(np.max(fit_counts, initial=0)),
            fit_rows_by_target=fit_counts,
            calibration_rows=int(np.max(calibration_rows, initial=0)),
            calibration_rows_by_target=calibration_rows,
            target_reasons=target_reasons,
        )
        return result

    source_name = str(spec.get("source"))
    source_lookup = {
        "field": field_features,
        "technical": technical_features,
        "change_point": change_point_features,
        "hmm": hmm_features,
    }
    source = source_lookup.get(source_name)
    if source is None:
        result.update(
            status="model_fit_unavailable",
            reason=f"{source_name}_features_unavailable",
        )
        return result
    features = tuple(spec["features"])
    x = source.loc[:, list(features)].to_numpy(dtype=float)
    fit_x = x[fit_slice]
    calibration_x = x[calibration_slice]
    origin_x = x[split.origin : split.origin + 1]
    feature_fit_valid = _complete_rows(fit_x)
    fit_rows = int(np.sum(feature_fit_valid))
    result["fit_rows"] = fit_rows
    minimum_required = max(
        int(minimum_model_fit_rows),
        len(features) + 2,
    )
    if fit_rows < minimum_required:
        result.update(
            status="model_fit_unavailable",
            reason="insufficient_complete_fit_rows",
        )
        return result
    if not bool(_complete_rows(origin_x)[0]):
        result.update(
            status="model_prediction_unavailable",
            reason="nonfinite_origin_features",
        )
        return result

    center, scale = robust_fit_scale(fit_x[feature_fit_valid])
    standardized_fit = (fit_x[feature_fit_valid] - center) / scale
    fit_y_on_features = fit_y[feature_fit_valid]
    standardized_calibration = (calibration_x - center) / scale
    standardized_origin = (origin_x - center) / scale

    if spec["kind"] == "hmm":
        sequential_x = x[split.fit_start : split.origin + 1]
        if not np.all(feature_fit_valid) or not np.all(
            np.isfinite(sequential_x)
        ):
            result.update(
                status="model_fit_unavailable",
                reason="nonfinite_hmm_observations",
            )
            return result
        standardized_sequence = (sequential_x - center) / scale
        try:
            parameters = fit_diagonal_gaussian_hmm(
                standardized_fit,
                state_count=2,
                maximum_iterations=int(hmm_maximum_iterations),
                variance_floor=float(hmm_variance_floor),
            )
            filtered = filter_diagonal_gaussian_hmm(
                standardized_sequence,
                parameters,
            )
        except (ValueError, np.linalg.LinAlgError, FloatingPointError):
            result.update(
                status="model_fit_unavailable",
                reason="gaussian_hmm_fit_failed",
            )
            return result
        fit_probabilities = filtered[
            : split.fit_end - split.fit_start
        ]
        calibration_probabilities = filtered[
            split.calibration_start
            - split.fit_start : split.calibration_end
            - split.fit_start
        ]
        origin_probabilities = filtered[-1]
        state_count = fit_probabilities.shape[1]
        state_means = np.full(
            (state_count, len(target_columns)),
            np.nan,
            dtype=float,
        )
        fit_counts = np.sum(
            np.isfinite(fit_y_on_features),
            axis=0,
        ).astype(int)
        target_reasons: list[str | None] = [None] * len(target_columns)
        for target_index in range(len(target_columns)):
            target_valid = np.isfinite(
                fit_y_on_features[:, target_index]
            )
            for state in range(state_count):
                weights = fit_probabilities[target_valid, state]
                effective_support = float(np.sum(weights))
                if effective_support < minimum_dictionary_state_outcomes:
                    continue
                state_means[state, target_index] = float(
                    np.sum(
                        weights
                        * fit_y_on_features[target_valid, target_index]
                    )
                    / effective_support
                )
            if not np.all(np.isfinite(state_means[:, target_index])):
                target_reasons[target_index] = (
                    "insufficient_hmm_state_outcomes"
                )
        predictions = origin_probabilities @ state_means
        calibration_predictions = (
            calibration_probabilities @ state_means
        )
        interval_radius, calibration_rows = _calibration_radius(
            calibration_y,
            calibration_predictions,
            quantile=interval_calibration_quantile,
        )
        result.update(
            predictions=predictions,
            interval_radius=interval_radius,
            fit_rows_by_target=fit_counts,
            calibration_rows=int(
                np.max(calibration_rows, initial=0)
            ),
            calibration_rows_by_target=calibration_rows,
            target_reasons=target_reasons,
            assigned_state=int(np.argmax(origin_probabilities)),
            archetype_count=state_count,
            model_iterations=int(parameters["iterations"]),
            model_converged=bool(parameters["converged"]),
        )
        return result

    if spec["kind"] == "ridge":
        predictions = np.full(len(target_columns), np.nan, dtype=float)
        calibration_predictions = np.full_like(calibration_y, np.nan)
        fit_counts = np.zeros(len(target_columns), dtype=int)
        target_reasons: list[str | None] = [None] * len(target_columns)
        for target_index in range(len(target_columns)):
            target_valid = np.isfinite(
                fit_y_on_features[:, target_index]
            )
            fit_counts[target_index] = int(np.sum(target_valid))
            if fit_counts[target_index] < minimum_required:
                target_reasons[target_index] = (
                    "insufficient_complete_fit_rows"
                )
                continue
            y_mean, beta = _ridge_coefficients(
                standardized_fit[target_valid],
                fit_y_on_features[target_valid, target_index : target_index + 1],
                alpha=ridge_alpha,
            )
            predictions[target_index] = float(
                (y_mean + standardized_origin @ beta)[0, 0]
            )
            calibration_predictions[:, target_index] = (
                y_mean + standardized_calibration @ beta
            )[:, 0]
        interval_radius, calibration_rows = _calibration_radius(
            calibration_y,
            calibration_predictions,
            quantile=interval_calibration_quantile,
        )
        result.update(
            predictions=predictions,
            interval_radius=interval_radius,
            fit_rows_by_target=fit_counts,
            calibration_rows=int(np.max(calibration_rows, initial=0)),
            calibration_rows_by_target=calibration_rows,
            target_reasons=target_reasons,
        )
        return result

    if spec["kind"] != "dictionary":
        raise AssertionError(f"Unhandled model kind {spec['kind']!r}")

    metric_weights = field_metric_weights(features)
    metric_fit = standardized_fit * np.sqrt(metric_weights)[None, :]
    metric_calibration = standardized_calibration * np.sqrt(metric_weights)[None, :]
    metric_origin = standardized_origin * np.sqrt(metric_weights)[None, :]
    centroids, _ = _select_supported_centroids(metric_fit, maximum_clusters=5)
    centroids = _canonicalize_centroids(centroids)
    fit_states = _assign_centroids(metric_fit, centroids)
    origin_state = int(_assign_centroids(metric_origin, centroids)[0])
    result.update(
        assigned_state=origin_state,
        archetype_count=len(centroids),
    )
    state_means = np.full((len(centroids), len(target_columns)), np.nan)
    state_support = np.zeros((len(centroids), len(target_columns)), dtype=int)
    for state in range(len(centroids)):
        members = fit_states == state
        for target_index in range(len(target_columns)):
            target_members = members & np.isfinite(
                fit_y_on_features[:, target_index]
            )
            state_support[state, target_index] = int(
                np.sum(target_members)
            )
            if (
                state_support[state, target_index]
                >= minimum_dictionary_state_outcomes
            ):
                state_means[state, target_index] = float(
                    np.mean(
                        fit_y_on_features[target_members, target_index]
                    )
                )
    predictions = state_means[origin_state]
    target_reasons = [
        (
            None
            if np.isfinite(predictions[target_index])
            else "insufficient_dictionary_state_outcomes"
        )
        for target_index in range(len(target_columns))
    ]
    calibration_states = _assign_centroids(metric_calibration, centroids)
    calibration_predictions = state_means[calibration_states]
    interval_radius, calibration_rows = _calibration_radius(
        calibration_y,
        calibration_predictions,
        quantile=interval_calibration_quantile,
    )
    result.update(
        predictions=predictions,
        interval_radius=interval_radius,
        fit_rows_by_target=np.sum(
            np.isfinite(fit_y_on_features),
            axis=0,
        ).astype(int),
        calibration_rows=int(np.max(calibration_rows, initial=0)),
        calibration_rows_by_target=calibration_rows,
        target_reasons=target_reasons,
    )
    return result


def summarize_prediction_metrics(predictions: pd.DataFrame) -> pd.DataFrame:
    group_columns = [
        "dataset_id",
        "symbol",
        "timeframe",
        "model_id",
        "outcome",
        "horizon_bars",
    ]
    rows: list[dict[str, Any]] = []
    for key, group in predictions.groupby(group_columns, sort=True, dropna=False):
        statuses = group["status"].value_counts().to_dict()
        scored = group[group["status"] == "scored"].copy()
        error = (
            scored["prediction"].to_numpy(dtype=float)
            - scored["actual"].to_numpy(dtype=float)
        )
        interval_available = scored[
            np.isfinite(pd.to_numeric(scored["interval_lower_90"], errors="coerce"))
            & np.isfinite(pd.to_numeric(scored["interval_upper_90"], errors="coerce"))
        ]
        interval_covered = (
            (
                interval_available["actual"]
                >= interval_available["interval_lower_90"]
            )
            & (
                interval_available["actual"]
                <= interval_available["interval_upper_90"]
            )
        )
        rows.append(
            {
                **dict(zip(group_columns, key)),
                "candidate_origins": len(group),
                "scored": len(scored),
                "pending_outcome": int(statuses.get("outcome_not_yet_observable", 0)),
                "model_unavailable": int(statuses.get("model_unavailable", 0)),
                "coverage": len(scored) / len(group) if len(group) else math.nan,
                "mean_absolute_error": (
                    float(np.mean(np.abs(error))) if len(error) else math.nan
                ),
                "median_absolute_error": (
                    float(np.median(np.abs(error))) if len(error) else math.nan
                ),
                "root_mean_squared_error": (
                    float(np.sqrt(np.mean(np.square(error))))
                    if len(error)
                    else math.nan
                ),
                "mean_signed_error": (
                    float(np.mean(error)) if len(error) else math.nan
                ),
                "interval_90_supported": len(interval_available),
                "interval_90_empirical_coverage": (
                    float(np.mean(interval_covered))
                    if len(interval_available)
                    else math.nan
                ),
                "interval_90_mean_width": (
                    float(
                        np.mean(
                            interval_available["interval_upper_90"]
                            - interval_available["interval_lower_90"]
                        )
                    )
                    if len(interval_available)
                    else math.nan
                ),
                "decision_eligible": False,
                "interpretation": "retrospective_development_diagnostic",
            }
        )
    return pd.DataFrame(rows).sort_values(group_columns).reset_index(drop=True)


def summarize_case_accounting(predictions: pd.DataFrame) -> pd.DataFrame:
    group_columns = [
        "dataset_id",
        "symbol",
        "timeframe",
        "model_id",
        "outcome",
        "horizon_bars",
        "status",
        "reason",
    ]
    accounting = (
        predictions.groupby(group_columns, dropna=False, sort=True)
        .size()
        .reset_index(name="cases")
    )
    accounting["reason"] = accounting["reason"].fillna("")
    return accounting.sort_values(group_columns).reset_index(drop=True)


def stationary_bootstrap_indices(
    observation_count: int,
    *,
    mean_block_length: float,
    rng: np.random.Generator,
) -> np.ndarray:
    if observation_count <= 0:
        raise ValueError("Stationary bootstrap requires at least one observation.")
    if mean_block_length < 1.0:
        raise ValueError("mean_block_length must be at least one.")
    restart_probability = min(1.0, 1.0 / float(mean_block_length))
    indexes = np.empty(observation_count, dtype=int)
    indexes[0] = int(rng.integers(0, observation_count))
    for index in range(1, observation_count):
        if float(rng.random()) < restart_probability:
            indexes[index] = int(rng.integers(0, observation_count))
        else:
            indexes[index] = (indexes[index - 1] + 1) % observation_count
    return indexes


def stationary_bootstrap_mean(
    values: Sequence[float],
    *,
    replications: int,
    mean_block_length: float,
    confidence: float,
    seed: int,
) -> dict[str, float | int | None]:
    numeric = np.asarray(values, dtype=float)
    numeric = numeric[np.isfinite(numeric)]
    if not len(numeric):
        return {
            "sample_size": 0,
            "estimate": None,
            "lower": None,
            "upper": None,
            "two_sided_centered_p": None,
        }
    if replications <= 0:
        raise ValueError("replications must be positive.")
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence must lie strictly between zero and one.")
    rng = np.random.default_rng(int(seed))
    estimates = np.empty(replications, dtype=float)
    null_estimates = np.empty(replications, dtype=float)
    observed = float(np.mean(numeric))
    centered = numeric - observed
    for replication in range(replications):
        indexes = stationary_bootstrap_indices(
            len(numeric),
            mean_block_length=mean_block_length,
            rng=rng,
        )
        estimates[replication] = float(np.mean(numeric[indexes]))
        null_estimates[replication] = float(np.mean(centered[indexes]))
    tail = (1.0 - confidence) / 2.0
    return {
        "sample_size": int(len(numeric)),
        "estimate": observed,
        "lower": float(np.quantile(estimates, tail, method="linear")),
        "upper": float(np.quantile(estimates, 1.0 - tail, method="linear")),
        "two_sided_centered_p": float(
            (
                1
                + int(
                    np.sum(
                        np.abs(null_estimates)
                        >= abs(observed) - np.finfo(float).eps
                    )
                )
            )
            / (replications + 1)
        ),
    }


def stable_trial_seed(base_seed: int, trial_id: str) -> int:
    digest = hashlib.sha256(trial_id.encode("utf-8")).digest()
    offset = int.from_bytes(digest[:8], byteorder="big", signed=False)
    return int((int(base_seed) + offset) % (2**63 - 1))


def adjust_benjamini_hochberg(
    p_values: Sequence[float | None],
    *,
    planned_count: int | None = None,
) -> np.ndarray:
    values = np.asarray(
        [np.nan if value is None else float(value) for value in p_values],
        dtype=float,
    )
    finite_indexes = np.flatnonzero(np.isfinite(values))
    output = np.full(len(values), np.nan, dtype=float)
    if not len(finite_indexes):
        return output
    total = int(planned_count) if planned_count is not None else len(finite_indexes)
    if total < len(finite_indexes):
        raise ValueError("planned_count cannot be smaller than the finite p-value count.")
    order = finite_indexes[np.argsort(values[finite_indexes], kind="stable")]
    ranked = np.asarray(
        [
            min(1.0, values[index] * total / rank)
            for rank, index in enumerate(order, start=1)
        ],
        dtype=float,
    )
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    output[order] = ranked
    return output


def adjust_holm(
    p_values: Sequence[float | None],
    *,
    planned_count: int | None = None,
) -> np.ndarray:
    values = np.asarray(
        [np.nan if value is None else float(value) for value in p_values],
        dtype=float,
    )
    finite_indexes = np.flatnonzero(np.isfinite(values))
    output = np.full(len(values), np.nan, dtype=float)
    if not len(finite_indexes):
        return output
    total = int(planned_count) if planned_count is not None else len(finite_indexes)
    if total < len(finite_indexes):
        raise ValueError("planned_count cannot be smaller than the finite p-value count.")
    order = finite_indexes[np.argsort(values[finite_indexes], kind="stable")]
    ranked = np.asarray(
        [
            min(1.0, values[index] * (total - rank + 1))
            for rank, index in enumerate(order, start=1)
        ],
        dtype=float,
    )
    ranked = np.maximum.accumulate(ranked)
    output[order] = ranked
    return output


def build_paired_bootstrap_comparisons(
    predictions: pd.DataFrame,
    *,
    comparator_model: str,
    replications: int,
    mean_block_length: float,
    confidence: float,
    base_seed: int,
    primary_family: Mapping[str, Any],
    secondary_planned_count: int,
) -> pd.DataFrame:
    scored = predictions[predictions["status"] == "scored"].copy()
    key_columns = [
        "dataset_id",
        "origin_index",
        "outcome",
        "horizon_bars",
    ]
    comparator = scored[scored["model_id"] == comparator_model][
        key_columns + ["prediction", "actual"]
    ].rename(columns={"prediction": "comparator_prediction"})
    rows: list[dict[str, Any]] = []
    for model_id in sorted(
        set(scored["model_id"].astype(str)) - {comparator_model}
    ):
        candidate = scored[scored["model_id"] == model_id][
            key_columns + ["symbol", "timeframe", "prediction", "actual"]
        ]
        paired = candidate.merge(
            comparator,
            on=key_columns,
            how="inner",
            suffixes=("", "_comparator"),
            validate="one_to_one",
        )
        for key, group in paired.groupby(
            ["dataset_id", "symbol", "timeframe", "outcome", "horizon_bars"],
            sort=True,
        ):
            (
                dataset_id,
                symbol,
                timeframe,
                outcome,
                horizon_bars,
            ) = key
            loss_difference = (
                np.abs(group["prediction"] - group["actual"])
                - np.abs(
                    group["comparator_prediction"]
                    - group["actual_comparator"]
                )
            ).to_numpy(dtype=float)
            trial_id = (
                f"{dataset_id}|{model_id}|{outcome}|h{int(horizon_bars)}"
                f"|mae_difference_vs_{comparator_model}"
            )
            bootstrap = stationary_bootstrap_mean(
                loss_difference,
                replications=replications,
                mean_block_length=mean_block_length,
                confidence=confidence,
                seed=stable_trial_seed(base_seed, trial_id),
            )
            is_primary = (
                model_id == primary_family["model"]
                and comparator_model == primary_family["comparator"]
                and outcome == primary_family["outcome"]
                and int(horizon_bars) == int(primary_family["horizon_bars"])
            )
            rows.append(
                {
                    "trial_id": trial_id,
                    "family_id": (
                        "primary_development_family"
                        if is_primary
                        else "secondary_development_family"
                    ),
                    "dataset_id": dataset_id,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "model_id": model_id,
                    "comparator_model": comparator_model,
                    "outcome": outcome,
                    "horizon_bars": int(horizon_bars),
                    "metric": "mean_absolute_error_difference",
                    "paired_observations": bootstrap["sample_size"],
                    "estimate": bootstrap["estimate"],
                    "bootstrap_lower": bootstrap["lower"],
                    "bootstrap_upper": bootstrap["upper"],
                    "unadjusted_two_sided_p": bootstrap[
                        "two_sided_centered_p"
                    ],
                    "bootstrap_replications": int(replications),
                    "mean_block_origins": float(mean_block_length),
                    "decision_eligible": False,
                    "interpretation": "retrospective_development_diagnostic",
                }
            )
    result = pd.DataFrame(rows)
    if result.empty:
        return result
    primary_planned = int(primary_family["planned_hypotheses"])
    for family_id, indexes in result.groupby("family_id").groups.items():
        family_indexes = list(indexes)
        planned_count = (
            primary_planned
            if family_id == "primary_development_family"
            else int(secondary_planned_count)
        )
        p_values = result.loc[
            family_indexes,
            "unadjusted_two_sided_p",
        ].tolist()
        result.loc[family_indexes, "benjamini_hochberg_q"] = (
            adjust_benjamini_hochberg(
                p_values,
                planned_count=planned_count,
            )
        )
        result.loc[family_indexes, "holm_adjusted_p"] = adjust_holm(
            p_values,
            planned_count=planned_count,
        )
        result.loc[family_indexes, "planned_family_hypotheses"] = planned_count
        result.loc[family_indexes, "finite_family_tests"] = int(
            np.sum(np.isfinite(np.asarray(p_values, dtype=float)))
        )
    return result.sort_values(
        ["family_id", "dataset_id", "model_id", "outcome", "horizon_bars"]
    ).reset_index(drop=True)
