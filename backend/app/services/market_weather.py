from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import numpy as np
import pandas as pd

from app.services.market_weather_research import build_market_weather_research


EPSILON = 1e-9


@dataclass(frozen=True)
class MarketWeatherSettings:
    state_smoothing: int = 5
    cross_horizon_blend: float = 0.32
    renderer_time_blur: int = 3
    renderer_spatial_blend: float = 0.42
    motion_normalization_length: int = 13
    reflectivity_strength_weight: float = 0.50
    reflectivity_motion_weight: float = 0.22
    reflectivity_boundary_weight: float = 0.28
    reflectivity_compression: float = 4.0
    contour_bands: int = 7
    edge_gain: float = 1.35
    entropy_smoothing: int = 4
    confidence_gamma: float = 0.86


def _clip(values: np.ndarray, low: float = 0.0, high: float = 1.0) -> np.ndarray:
    return np.clip(np.nan_to_num(values, nan=0.0, posinf=high, neginf=low), low, high)


def _ewm_rows(values: np.ndarray, span: int) -> np.ndarray:
    return np.vstack(
        [pd.Series(row).ewm(span=max(1, span), adjust=False).mean().to_numpy(dtype=float) for row in values]
    )


def _neighbor_average(values: np.ndarray) -> np.ndarray:
    result = np.empty_like(values)
    if len(values) == 1:
        result[0] = values[0]
        return result
    result[0] = values[1]
    result[-1] = values[-2]
    if len(values) > 2:
        result[1:-1] = (values[:-2] + values[2:]) / 2.0
    return result


def _spatial_smooth(values: np.ndarray, blend: float) -> np.ndarray:
    if len(values) == 1:
        return values.copy()
    smoothed = np.empty_like(values)
    smoothed[0] = (1.0 - blend) * values[0] + blend * ((2.0 * values[0] + values[1]) / 3.0)
    smoothed[-1] = (1.0 - blend) * values[-1] + blend * ((values[-2] + 2.0 * values[-1]) / 3.0)
    if len(values) > 2:
        neighborhood = (values[:-2] + 2.0 * values[1:-1] + values[2:]) / 4.0
        smoothed[1:-1] = (1.0 - blend) * values[1:-1] + blend * neighborhood
    return smoothed


def _vertical_derivatives(
    values: np.ndarray,
    horizons: list[int],
    edge_gain: float,
) -> tuple[np.ndarray, np.ndarray]:
    gradient = np.zeros_like(values)
    laplacian = np.zeros_like(values)
    if len(values) == 1:
        return gradient, laplacian
    log_horizons = np.log(np.asarray(horizons, dtype=float))
    first = np.gradient(values, log_horizons, axis=0, edge_order=1)
    second = np.gradient(first, log_horizons, axis=0, edge_order=1)
    gradient_energy = np.abs(first) * edge_gain
    curvature_energy = np.abs(second) * edge_gain
    gradient = gradient_energy / (1.0 + gradient_energy)
    laplacian = curvature_energy / (1.0 + curvature_energy)
    return _clip(gradient), _clip(laplacian)


def _swami_mode(price: np.ndarray, horizon: int) -> np.ndarray:
    """High-fidelity causal Swami benchmark from the supplied research report."""
    count = len(price)
    band_pass = np.zeros(count, dtype=float)
    beta = np.cos(2.0 * np.pi / horizon)
    gamma = 1.0 / np.cos(4.0 * np.pi * 0.50 / horizon)
    alpha = gamma - np.sqrt(max(0.0, gamma * gamma - 1.0))
    for index in range(2, count):
        band_pass[index] = (
            0.5 * (1.0 - alpha) * (price[index] - price[index - 2])
            + beta * (1.0 + alpha) * band_pass[index - 1]
            - alpha * band_pass[index - 2]
        )

    band_series = pd.Series(band_pass)
    mean = band_series.rolling(2 * horizon, min_periods=1).mean()
    peaks = pd.Series(np.nan, index=band_series.index, dtype=float)
    valleys = pd.Series(np.nan, index=band_series.index, dtype=float)
    for index in range(2, count):
        previous = band_pass[index - 1]
        if previous > band_pass[index - 2] and previous >= band_pass[index]:
            peaks.iloc[index] = previous
        if previous < band_pass[index - 2] and previous <= band_pass[index]:
            valleys.iloc[index] = previous

    expanding_peak = band_series.expanding(min_periods=1).max()
    expanding_valley = band_series.expanding(min_periods=1).min()
    peaks = peaks.ffill().fillna(expanding_peak)
    valleys = valleys.ffill().fillna(expanding_valley)
    average_peak = peaks.rolling(50, min_periods=1).mean()
    average_valley = valleys.rolling(50, min_periods=1).mean()
    center = 0.10 * (average_peak + average_valley) / 2.0
    half_amplitude = 0.10 * (average_peak - average_valley).abs() / 2.0
    mode = (mean - center) / half_amplitude.where(half_amplitude > EPSILON, np.nan)
    return np.clip(mode.fillna(0.0).to_numpy(dtype=float), -2.0, 2.0)


def _normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise ValueError("No daily price history was returned.")
    column_lookup = {str(column).lower(): column for column in frame.columns}
    required = ("open", "high", "low", "close")
    missing = [column for column in required if column not in column_lookup]
    if missing:
        raise ValueError(f"Daily history is missing required columns: {', '.join(missing)}")

    normalized = pd.DataFrame(index=pd.to_datetime(frame.index, errors="coerce"))
    for name in required:
        normalized[name] = pd.to_numeric(frame[column_lookup[name]], errors="coerce").to_numpy()
    volume_column = column_lookup.get("volume")
    normalized["volume"] = (
        pd.to_numeric(frame[volume_column], errors="coerce").fillna(0.0).to_numpy()
        if volume_column is not None
        else 0.0
    )
    normalized = normalized[normalized.index.notna()]
    normalized = normalized.dropna(subset=["open", "high", "low", "close"])
    normalized = normalized[~normalized.index.duplicated(keep="last")].sort_index()
    if len(normalized) < 60:
        raise ValueError("At least 60 daily bars are required to build the market-weather field.")
    return normalized


def _rounded_matrix(values: np.ndarray) -> list[list[float]]:
    return np.round(np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0), 4).tolist()


def _regime_label(direction: float, coherence: float, entropy: float, expansion: float) -> str:
    if entropy >= 0.62 and coherence < 0.48:
        return "Turbulent / mixed"
    if direction >= 0.25 and coherence >= 0.58:
        return "Organized bullish"
    if direction <= -0.25 and coherence >= 0.58:
        return "Organized bearish"
    if direction >= 0.10 and expansion >= 0.20:
        return "Bullish expansion"
    if direction <= -0.10 and expansion >= 0.20:
        return "Bearish expansion"
    if abs(direction) < 0.12:
        return "Transition / neutral"
    return "Developing trend"


def build_market_weather(
    frame: pd.DataFrame,
    horizons: Iterable[int] = range(12, 50, 2),
    settings: MarketWeatherSettings | None = None,
) -> dict[str, object]:
    settings = settings or MarketWeatherSettings()
    history = _normalize_frame(frame)
    horizon_values = [int(value) for value in horizons]
    if not horizon_values or any(value < 4 for value in horizon_values):
        raise ValueError("Horizons must contain values of at least 4 bars.")
    if horizon_values != sorted(set(horizon_values)):
        raise ValueError("Horizons must be unique and sorted in ascending order.")

    high = history["high"]
    low = history["low"]
    close = history["close"]
    price = ((high + low) / 2.0).astype(float)
    previous_close = close.shift(1)
    true_range = pd.concat(
        [(high - low).abs(), (high - previous_close).abs(), (low - previous_close).abs()], axis=1
    ).max(axis=1)
    absolute_move = price.diff().abs().fillna(0.0)

    raw_direction_rows: list[np.ndarray] = []
    state_rows: list[np.ndarray] = []
    swami_rows: list[np.ndarray] = []
    for horizon in horizon_values:
        fast = price.ewm(span=max(2, horizon // 2), adjust=False).mean()
        slow = price.ewm(span=horizon, adjust=False).mean()
        atr = true_range.rolling(horizon, min_periods=1).mean().replace(0.0, np.nan)
        spread = ((fast - slow) / atr).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        bounded_direction = spread / (1.0 + spread.abs())
        path = absolute_move.rolling(horizon, min_periods=1).sum().replace(0.0, np.nan)
        efficiency = ((price - price.shift(horizon)).abs() / path).clip(0.0, 1.0).fillna(0.0)
        state_raw = bounded_direction * efficiency
        state = state_raw.ewm(span=settings.state_smoothing, adjust=False).mean()
        raw_direction_rows.append(bounded_direction.to_numpy(dtype=float))
        state_rows.append(state.to_numpy(dtype=float))
        swami_rows.append(_swami_mode(price.to_numpy(dtype=float), horizon))

    direction = np.vstack(raw_direction_rows)
    state_temporal = np.vstack(state_rows)
    neighbor_state = _neighbor_average(state_temporal)
    pressure_raw = (
        (1.0 - settings.cross_horizon_blend) * state_temporal
        + settings.cross_horizon_blend * neighbor_state
    )
    pressure_time = _ewm_rows(pressure_raw, settings.renderer_time_blur)
    pressure = _spatial_smooth(pressure_time, settings.renderer_spatial_blend)

    velocity_raw = np.diff(pressure, axis=1, prepend=pressure[:, :1])
    velocity_scale = _ewm_rows(np.abs(velocity_raw), settings.motion_normalization_length)
    velocity_normalized = np.divide(
        velocity_raw,
        velocity_scale,
        out=np.zeros_like(velocity_raw),
        where=velocity_scale > EPSILON,
    )
    velocity = velocity_normalized / (1.0 + np.abs(velocity_normalized))
    acceleration_raw = np.diff(velocity, axis=1, prepend=velocity[:, :1])
    acceleration_scale = _ewm_rows(np.abs(acceleration_raw), settings.motion_normalization_length)
    acceleration_normalized = np.divide(
        acceleration_raw,
        acceleration_scale,
        out=np.zeros_like(acceleration_raw),
        where=acceleration_scale > EPSILON,
    )
    acceleration = acceleration_normalized / (1.0 + np.abs(acceleration_normalized))

    structural_strength = _clip(np.abs(pressure) * 1.8)
    motion_energy = _clip(np.abs(velocity) * 1.4)
    vertical_gradient, laplacian = _vertical_derivatives(pressure, horizon_values, settings.edge_gain)
    temporal_gradient = _clip(np.abs(np.diff(pressure, axis=1, prepend=pressure[:, :1])) * settings.edge_gain * 2.0)
    boundary_energy = _clip(0.42 * vertical_gradient + 0.33 * temporal_gradient + 0.25 * laplacian)
    coherence = _clip(1.0 - vertical_gradient / 1.35)
    entropy_raw = _clip(0.60 * (1.0 - coherence) + 0.40 * motion_energy)
    entropy = _ewm_rows(entropy_raw, settings.entropy_smoothing)
    aligned_velocity = np.where(pressure >= 0.0, velocity, -velocity)
    expansion = _clip(aligned_velocity * 1.8)
    contraction = _clip(-aligned_velocity * 1.8)

    sign_frame = pd.DataFrame(np.sign(pressure).T)
    persistence = sign_frame.rolling(5, min_periods=1).mean().abs().to_numpy(dtype=float).T
    reflectivity_raw = (
        settings.reflectivity_strength_weight * structural_strength
        + settings.reflectivity_motion_weight * motion_energy
        + settings.reflectivity_boundary_weight * boundary_energy
    )
    compression = max(EPSILON, settings.reflectivity_compression)
    reflectivity = np.log1p(compression * _clip(reflectivity_raw)) / np.log1p(compression)
    confidence = _clip(0.48 * coherence + 0.32 * structural_strength + 0.20 * (1.0 - entropy))
    convection = _clip(boundary_energy * (0.45 + 0.55 * motion_energy))

    dates = [pd.Timestamp(timestamp).isoformat() for timestamp in history.index]
    research_channels, research = build_market_weather_research(
        history=history,
        dates=dates,
        horizons=horizon_values,
        pressure=pressure,
        velocity=velocity,
        acceleration=acceleration,
        structural_strength=structural_strength,
        coherence=coherence,
        field_disorder=entropy,
        boundary_energy=boundary_energy,
        motion_normalization_length=settings.motion_normalization_length,
    )

    channels = {
        "pressure": pressure,
        "direction": direction,
        "structural_strength": structural_strength,
        "velocity": velocity,
        "acceleration": acceleration,
        "boundary_energy": boundary_energy,
        "vertical_gradient": vertical_gradient,
        "temporal_gradient": temporal_gradient,
        "laplacian": laplacian,
        "coherence": coherence,
        "entropy": entropy,
        "persistence": persistence,
        "confidence": confidence,
        "expansion": expansion,
        "contraction": contraction,
        "reflectivity": reflectivity,
        "convection": convection,
        "swami": np.vstack(swami_rows),
        **research_channels,
    }

    latest_pressure = pressure[:, -1]
    weights = np.asarray(horizon_values, dtype=float)
    weights = weights / weights.sum()
    field_direction = float(np.sum(latest_pressure * weights))
    latest_coherence = float(np.mean(coherence[:, -1]))
    latest_entropy = float(np.mean(entropy[:, -1]))
    latest_permutation_entropy = float(np.mean(research_channels["permutation_entropy"][:, -1]))
    latest_expansion = float(np.mean(expansion[:, -1]))
    latest_convection = float(np.mean(convection[:, -1]))
    latest_reflectivity = float(np.mean(reflectivity[:, -1]))
    aligned = np.sign(latest_pressure) == np.sign(field_direction)
    horizon_alignment = float(np.mean(aligned)) if abs(field_direction) > 0.02 else 0.5
    expanding_horizons = [
        horizon_values[index] for index, value in enumerate(expansion[:, -1]) if value >= 0.35
    ]
    expansion_front = max(expanding_horizons) if expanding_horizons else None

    price_rows = [
        {
            "date": dates[index],
            "open": round(float(row.open), 4),
            "high": round(float(row.high), 4),
            "low": round(float(row.low), 4),
            "close": round(float(row.close), 4),
            "volume": round(float(row.volume), 2),
        }
        for index, row in enumerate(history.itertuples())
    ]
    latest_profile = [
        {
            "horizon": horizon,
            "pressure": round(float(pressure[index, -1]), 4),
            "confidence": round(float(confidence[index, -1]), 4),
            "coherence": round(float(coherence[index, -1]), 4),
            "entropy": round(float(entropy[index, -1]), 4),
            "permutation_entropy": round(float(research_channels["permutation_entropy"][index, -1]), 4),
            "expansion": round(float(expansion[index, -1]), 4),
            "convection": round(float(convection[index, -1]), 4),
        }
        for index, horizon in enumerate(horizon_values)
    ]

    return {
        "orientation": "horizon_by_time",
        "dates": dates,
        "horizons": horizon_values,
        "price": price_rows,
        "channels": {name: _rounded_matrix(values) for name, values in channels.items()},
        "summary": {
            "regime": _regime_label(field_direction, latest_coherence, latest_entropy, latest_expansion),
            "field_direction": round(field_direction, 4),
            "horizon_alignment": round(horizon_alignment, 4),
            "coherence": round(latest_coherence, 4),
            "entropy": round(latest_entropy, 4),
            "permutation_entropy": round(latest_permutation_entropy, 4),
            "reflectivity": round(latest_reflectivity, 4),
            "convection": round(latest_convection, 4),
            "expansion": round(latest_expansion, 4),
            "expansion_front": expansion_front,
        },
        "latest_profile": latest_profile,
        "research": research,
        "settings": asdict(settings),
    }
