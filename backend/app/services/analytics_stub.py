"""
Analytics Engine (Quant Layer)
Atlas → Agent C

Provides:
- rolling z-score normalization
- directional inversion (e.g., high = stress vs low = stress)
- 0–100 stability scoring
- GREEN / YELLOW / RED classification
"""

import numpy as np


def compute_z_scores(values, lookback=252):
    """
    Rolling z-scores:
        z = (x - mean) / std
    If fewer than lookback points exist, fall back to full-sample.
    """
    arr = np.array(values, dtype=float)

    if len(arr) < 30:
        # Not enough data for meaningful stats
        mean = arr.mean()
        std = arr.std() if arr.std() != 0 else 1
        return list((arr - mean) / std)

    window = arr[-lookback:]
    mean = window.mean()
    std = window.std() if window.std() != 0 else 1

    z = (arr - mean) / std
    return list(z)


def direction_adjusted(z_scores, direction):
    """
    direction = +1 → high value = stress → z as is
    direction = -1 → high value = stability → invert z
    """
    if direction == 1:
        return z_scores
    else:
        return [-z for z in z_scores]


def map_z_to_score(z):
    """
    Convert a z-score into a 0–100 stability score.
    Lower = worse. Higher = healthier.

    Mapping:
        z ≤ -2.0 → score 0
        z = 0    → score 50
        z ≥ +2.0 → score 100
    """
    if z <= -2:
        return 0
    if z >= 2:
        return 100

    return int(((z + 2) / 4) * 100)


def classify_state(score, thresholds):
    """
    thresholds = (green_max, yellow_max)
    Score ranges:
        0–green_max       → RED
        green_max–yellow_max → YELLOW
        yellow_max–100     → GREEN
    """
    gmax, ymax = thresholds

    if score < gmax:
        return "RED"
    elif score < ymax:
        return "YELLOW"
    else:
        return "GREEN"


def normalize_series(raw_values, direction=1, lookback=252):
    """
    Final pipeline:
    1. rolling z-scores
    2. direction-aware inversion
    3. returns list of z-values
    """
    z = compute_z_scores(raw_values, lookback=lookback)
    adj = direction_adjusted(z, direction)
    return adj


def score_series(z_scores):
    """Map each z-score to a 0–100 stability score."""
    return [map_z_to_score(z) for z in z_scores]


def classify_series(scores, green_max, yellow_max):
    """Map each score to a Red/Yellow/Green state."""
    return [classify_state(s, (green_max, yellow_max)) for s in scores]


def compute_score(value):
    """Legacy stub for compatibility."""
    return 50


def compute_state(score):
    """Legacy stub for compatibility."""
    return "YELLOW"
