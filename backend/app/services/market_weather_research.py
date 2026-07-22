from __future__ import annotations

import hashlib
from collections import Counter, deque
from math import ceil, factorial, log
from typing import Mapping, Sequence

import numpy as np
import pandas as pd


EPSILON = 1e-9
DISTANCE_TAIL_CUTOFF = 0.05
DISTANCE_TAIL_MINIMUM_SUPPORT = 20


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


def _relative_ratio(values: np.ndarray, span: int) -> np.ndarray:
    """Return an interpretable current-to-causal-baseline ratio."""
    baseline = _ewm_rows(values, span)
    return np.clip(
        np.nan_to_num(
            np.divide(values + EPSILON, baseline + EPSILON),
            nan=1.0,
            posinf=10.0,
            neginf=0.0,
        ),
        0.0,
        10.0,
    )


def _carrier_fields(
    history: pd.DataFrame,
    horizons: Sequence[int],
    structure: np.ndarray,
) -> tuple[
    dict[str, np.ndarray],
    dict[str, np.ndarray],
    np.ndarray,
    dict[str, bool | int],
]:
    close = history["close"].astype(float)
    volume = history["volume"].astype(float).clip(lower=0.0)
    positive_volume_observations = int(np.sum(volume.to_numpy(dtype=float) > 0.0))
    volume_available = positive_volume_observations > 0
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
    unavailable_ratio = np.full_like(realized_volatility, np.nan, dtype=float)
    ratios = {
        "realized_volatility": _relative_ratio(realized_volatility, baseline_span),
        "participation": (
            _relative_ratio(volume_field, baseline_span)
            if volume_available
            else unavailable_ratio.copy()
        ),
        "liquidity_stress": (
            _relative_ratio(impact_field, baseline_span)
            if volume_available
            else unavailable_ratio.copy()
        ),
    }
    carriers = {
        "price_structure": _clip(structure),
        "realized_volatility": _relative_level(realized_volatility, baseline_span),
        "participation": _relative_level(volume_field, baseline_span),
        "liquidity_stress": _relative_level(impact_field, baseline_span),
    }
    availability: dict[str, bool | int] = {
        "realized_volatility": True,
        "participation": volume_available,
        "liquidity_stress": volume_available,
        "positive_volume_observations": positive_volume_observations,
    }
    return carriers, ratios, realized_volatility, availability


def _aggregate(values: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    if weights is None:
        return np.mean(values, axis=0)
    normalized = weights / max(EPSILON, float(np.sum(weights)))
    return np.sum(values * normalized[:, None], axis=0)


def _rounded(value: float | np.floating[object] | None, digits: int = 4) -> float | None:
    if value is None or not np.isfinite(float(value)):
        return None
    return round(float(value), digits)


def _empirical_distance_tail_score(
    distance: float,
    calibration_distances: np.ndarray,
    *,
    minimum_support: int = DISTANCE_TAIL_MINIMUM_SUPPORT,
) -> float | None:
    """Rank one distance against an independent chronological reference segment."""
    finite = calibration_distances[np.isfinite(calibration_distances)]
    if len(finite) < minimum_support:
        return None
    return float((1 + np.sum(finite >= distance)) / (len(finite) + 1))


def _robust_standardize(
    values: np.ndarray,
    calibration_start: int,
    calibration_stop: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Standardize from calibration data only, with deterministic finite fallbacks."""
    calibration = values[calibration_start:calibration_stop]
    center = np.median(calibration, axis=0)
    lower = np.quantile(calibration, 0.25, axis=0)
    upper = np.quantile(calibration, 0.75, axis=0)
    scale = upper - lower
    mad_scale = 1.4826 * np.median(np.abs(calibration - center), axis=0)
    standard_scale = np.std(calibration, axis=0)
    scale = np.where(scale > EPSILON, scale, mad_scale)
    scale = np.where(scale > EPSILON, scale, standard_scale)
    scale = np.where(scale > EPSILON, scale, 1.0)
    standardized = np.nan_to_num((values - center) / scale)
    return standardized, center, scale


def _deterministic_kmeans(
    calibration: np.ndarray,
    *,
    cluster_count: int,
    iterations: int = 40,
) -> tuple[np.ndarray, np.ndarray]:
    """Dependency-free farthest-first k-means with deterministic tie breaking."""
    if len(calibration) < cluster_count:
        raise ValueError("Lexicon calibration requires at least one row per archetype.")

    distance_from_origin = np.sum(np.square(calibration), axis=1)
    selected = [int(np.argmin(distance_from_origin))]
    centroids = [calibration[selected[0]].copy()]
    while len(centroids) < cluster_count:
        distances = np.min(
            np.stack([np.sum(np.square(calibration - centroid), axis=1) for centroid in centroids]),
            axis=0,
        )
        distances[np.asarray(selected, dtype=int)] = -1.0
        next_index = int(np.argmax(distances))
        selected.append(next_index)
        centroids.append(calibration[next_index].copy())

    centroid_array = np.vstack(centroids)
    assignments = np.zeros(len(calibration), dtype=int)
    for _ in range(iterations):
        distance_matrix = np.stack(
            [np.sum(np.square(calibration - centroid), axis=1) for centroid in centroid_array],
            axis=1,
        )
        updated_assignments = np.argmin(distance_matrix, axis=1)
        updated_centroids = centroid_array.copy()
        for cluster_index in range(cluster_count):
            members = calibration[updated_assignments == cluster_index]
            if len(members):
                updated_centroids[cluster_index] = np.mean(members, axis=0)
        if np.array_equal(updated_assignments, assignments) and np.allclose(
            updated_centroids,
            centroid_array,
            atol=1e-12,
            rtol=0.0,
        ):
            centroid_array = updated_centroids
            assignments = updated_assignments
            break
        centroid_array = updated_centroids
        assignments = updated_assignments
    return centroid_array, assignments


def _quantized_lexicon_centroid(centroid: np.ndarray) -> np.ndarray:
    return np.rint(np.asarray(centroid, dtype=float) / 0.35).astype("<i4")


def _mean_silhouette(calibration: np.ndarray, assignments: np.ndarray, cluster_count: int) -> float:
    """Return dependency-free mean silhouette on the calibration segment."""
    if cluster_count <= 1 or len(calibration) <= cluster_count:
        return 0.0
    pairwise = np.sqrt(
        np.sum(
            np.square(calibration[:, None, :] - calibration[None, :, :]),
            axis=2,
        )
    )
    silhouettes = np.zeros(len(calibration), dtype=float)
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
        silhouettes[index] = (between - within) / denominator if denominator > EPSILON else 0.0
    return float(np.mean(silhouettes))


def _select_supported_centroids(
    calibration: np.ndarray,
    *,
    max_clusters: int = 5,
) -> tuple[np.ndarray, int]:
    """Use the most separated supported codebook; fall back to one honest Form."""
    min_support = max(20, int(ceil(len(calibration) * 0.05)))
    upper = min(max_clusters, max(1, len(calibration) // min_support))
    candidates: list[tuple[float, int, np.ndarray]] = []
    for cluster_count in range(2, upper + 1):
        centroids, assignments = _deterministic_kmeans(
            calibration,
            cluster_count=cluster_count,
        )
        counts = np.bincount(assignments, minlength=cluster_count)
        if np.any(counts < min_support):
            continue
        if cluster_count > 1:
            pairwise = np.sqrt(
                np.sum(
                    np.square(centroids[:, None, :] - centroids[None, :, :]),
                    axis=2,
                )
            )
            separation = pairwise[np.triu_indices(cluster_count, 1)]
            if np.any(separation <= 1e-6):
                continue
            identities = {
                _quantized_lexicon_centroid(centroid).tobytes()
                for centroid in centroids
            }
            if len(identities) != cluster_count:
                continue
        silhouette = _mean_silhouette(calibration, assignments, cluster_count)
        if silhouette >= 0.25:
            candidates.append((silhouette, cluster_count, centroids))
    if candidates:
        _, _, selected = max(candidates, key=lambda item: (item[0], -item[1]))
        return selected, min_support
    # A single Form is always the honest fallback for a flat calibration field.
    centroids, _ = _deterministic_kmeans(calibration, cluster_count=1)
    return centroids, min_support


def _lexicon_identity(centroid: np.ndarray) -> tuple[str, str]:
    """Create a coarse, window-native signature and pronounceable nonsemantic token."""
    signature_version = "lx1"
    quantized = _quantized_lexicon_centroid(centroid)
    payload = signature_version.encode("ascii") + quantized.tobytes()
    digest = hashlib.sha256(payload).digest()
    consonants = ("b", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z")
    vowels = ("a", "e", "i", "o", "u")
    syllables = [
        consonants[value % len(consonants)] + vowels[(value // len(consonants)) % len(vowels)]
        for value in digest[:3]
    ]
    token = "".join(syllables).capitalize()
    signature = f"{signature_version}-{hashlib.sha256(payload).hexdigest()[:6]}"
    return token, signature


def _run_segments(assignments: np.ndarray, start: int, stop: int) -> list[tuple[int, int, int]]:
    """Return (state, inclusive start, inclusive end) runs in a bounded sequence."""
    if stop <= start:
        return []
    segments: list[tuple[int, int, int]] = []
    run_start = start
    state = int(assignments[start])
    for index in range(start + 1, stop):
        next_state = int(assignments[index])
        if next_state != state:
            segments.append((state, run_start, index - 1))
            state = next_state
            run_start = index
    segments.append((state, run_start, stop - 1))
    return segments


def _rounded_probability_row(values: np.ndarray) -> list[float]:
    """Round a probability row while preserving an exact unit sum for JSON consumers."""
    if len(values) == 1:
        return [1.0]
    rounded = np.round(np.asarray(values, dtype=float), 6)
    target = int(np.argmax(values))
    rounded[target] = round(float(rounded[target]) + (1.0 - float(np.sum(rounded))), 6)
    return [float(max(0.0, value)) for value in rounded]


def _forward_outcome_stats(
    close: np.ndarray,
    indexes: Sequence[int],
    *,
    forward_bars: int,
) -> dict[str, object]:
    valid = [index for index in indexes if index + forward_bars < len(close)]
    if not valid:
        return {
            "forward_bars": forward_bars,
            "sample_size": 0,
            "mean_return": None,
            "median_return": None,
            "positive_rate": None,
            "mean_absolute_return": None,
        }
    source = np.asarray(valid, dtype=int)
    outcomes = close[source + forward_bars] / np.clip(close[source], EPSILON, None) - 1.0
    return {
        "forward_bars": forward_bars,
        "sample_size": int(len(outcomes)),
        "mean_return": _rounded(float(np.mean(outcomes)), 6),
        "median_return": _rounded(float(np.median(outcomes)), 6),
        "positive_rate": _rounded(float(np.mean(outcomes > 0.0))),
        "mean_absolute_return": _rounded(float(np.mean(np.abs(outcomes))), 6),
    }


def _build_lexicon_motifs(
    *,
    assignments: np.ndarray,
    evaluation_start: int,
    close: np.ndarray,
    state_ids: Sequence[str],
    state_tokens: Sequence[str],
    forward_bars: int,
) -> list[dict[str, object]]:
    segments = _run_segments(assignments, evaluation_start, len(assignments))
    if len(segments) < 2:
        return []

    observed: dict[tuple[int, ...], list[tuple[int, int]]] = {}
    for length in range(2, 5):
        for offset in range(0, len(segments) - length + 1):
            motif = tuple(segment[0] for segment in segments[offset : offset + length])
            observed.setdefault(motif, []).append((offset, offset + length - 1))

    repeated = [(motif, occurrences) for motif, occurrences in observed.items() if len(occurrences) >= 2]
    repeated.sort(key=lambda item: (-len(item[1]), -len(item[0]), item[0]))
    current_states = tuple(segment[0] for segment in segments)
    results: list[dict[str, object]] = []
    for motif_index, (motif, occurrences) in enumerate(repeated[:24], start=1):
        # A phrase becomes recognizable on entry into its final Form. Using the
        # final run's exit would silently look ahead to a transition not yet seen.
        detection_indexes = [segments[end][1] for _, end in occurrences]
        spans = [segments[end][1] - segments[start][1] + 1 for start, end in occurrences]
        results.append(
            {
                "id": f"P.{motif_index:03d}",
                "states": [state_ids[state] for state in motif],
                "tokens": [state_tokens[state] for state in motif],
                "glyph": " → ".join(state_tokens[state] for state in motif),
                "length": len(motif),
                "count": len(occurrences),
                "typical_span_bars": _rounded(float(np.median(spans)), 1),
                "current": current_states[-len(motif) :] == motif,
                "outcome": _forward_outcome_stats(
                    close,
                    detection_indexes,
                    forward_bars=forward_bars,
                ),
                "outcome_anchor": "entry_into_final_form",
            }
        )
    return results


def scope_market_state_lexicon(
    lexicon: dict[str, object],
    *,
    visible_dates: Sequence[str],
    visible_close: Sequence[float],
    source_start_index: int,
) -> dict[str, object]:
    """Limit evaluation syntax, outcomes, and Phrases to the response window."""
    sequence = lexicon.get("evaluation_sequence")
    archetypes = lexicon.get("archetypes")
    grammar = lexicon.get("grammar")
    if not isinstance(sequence, list) or not isinstance(archetypes, list) or not isinstance(grammar, dict):
        return lexicon

    visible_count = len(visible_dates)
    rebased_sequence: list[dict[str, object]] = []
    for point in sequence:
        if not isinstance(point, dict):
            continue
        source_index = int(point.get("index", -1))
        visible_index = source_index - source_start_index
        if visible_index < 0 or visible_index >= visible_count:
            continue
        rebased = dict(point)
        rebased["index"] = visible_index
        rebased_sequence.append(rebased)
    lexicon["evaluation_sequence"] = rebased_sequence

    training_split = lexicon.get("training_split")
    if isinstance(training_split, dict):
        training_split.setdefault("evaluation_bars_total", training_split.get("evaluation_bars", 0))
        training_split["evaluation_bars"] = len(rebased_sequence)
        training_split["visible_evaluation_start"] = (
            rebased_sequence[0].get("date") if rebased_sequence else None
        )
        training_split["sequence_scope"] = "visible_response_window"

    close = np.asarray(visible_close, dtype=float)
    state_ids = [str(value) for value in grammar.get("state_ids", [])]
    state_lookup = {state_id: index for index, state_id in enumerate(state_ids)}
    visible_indexes_by_state: dict[str, list[int]] = {state_id: [] for state_id in state_ids}
    for point in rebased_sequence:
        state_id = str(point.get("state_id", ""))
        if state_id in visible_indexes_by_state:
            visible_indexes_by_state[state_id].append(int(point["index"]))

    pre_evaluation_total = 0
    for archetype in archetypes:
        if not isinstance(archetype, dict):
            continue
        fit_count = int(archetype.get("fit_count", 0))
        calibration_count = int(archetype.get("calibration_count", 0))
        pre_evaluation_total += fit_count + calibration_count
        indexes = visible_indexes_by_state.get(str(archetype.get("id", "")), [])
        archetype["evaluation_count"] = len(indexes)
        archetype["evaluation_outcome"] = _forward_outcome_stats(
            close,
            indexes,
            forward_bars=5,
        )
    scoped_total = max(1, pre_evaluation_total + len(rebased_sequence))
    for archetype in archetypes:
        if isinstance(archetype, dict):
            window_frequency = _rounded(
                (
                    int(archetype.get("fit_count", 0))
                    + int(archetype.get("calibration_count", 0))
                    + int(archetype.get("evaluation_count", 0))
                )
                / scoped_total
            )
            archetype["window_frequency"] = window_frequency
            archetype["frequency"] = window_frequency

    if rebased_sequence:
        evaluation_offset = int(rebased_sequence[0]["index"])
        assignments = np.asarray(
            [state_lookup[str(point["state_id"])] for point in rebased_sequence],
            dtype=int,
        )
        tokens_by_state = {
            str(archetype.get("id")): str(archetype.get("token"))
            for archetype in archetypes
            if isinstance(archetype, dict)
        }
        lexicon["motifs"] = _build_lexicon_motifs(
            assignments=assignments,
            evaluation_start=0,
            close=close[evaluation_offset : evaluation_offset + len(assignments)],
            state_ids=state_ids,
            state_tokens=[tokens_by_state.get(state_id, state_id) for state_id in state_ids],
            forward_bars=5,
        )
        current = lexicon.get("current")
        if isinstance(current, dict):
            source_age = int(current.get("age_bars", 1))
            current["age_bars"] = min(source_age, visible_count)
            current["age_truncated"] = source_age > visible_count
            current["transition_in_visible_window"] = source_age < visible_count
            if source_age >= visible_count:
                current["transition_surprise"] = 0.0
    else:
        lexicon["motifs"] = []
    lexicon["motif_note"] = (
        "Repeated 2-4-state run-collapsed phrases inside the visible response window; "
        "outcomes start when the final Form is entered, are descriptive and overlapping, "
        "and are not corrected for search."
    )
    return lexicon


def _build_market_state_lexicon(
    *,
    dates: Sequence[str],
    close: np.ndarray,
    derivative_series: Mapping[str, np.ndarray],
    strata: Mapping[str, np.ndarray],
    carriers: Mapping[str, np.ndarray],
    requested_warmup_bars: int,
) -> dict[str, object]:
    """Learn an empirical codebook from the chronological calibration segment only."""
    feature_arrays = {
        "pressure": derivative_series["pressure"],
        "velocity": derivative_series["velocity"],
        "acceleration": derivative_series["acceleration"],
        "jerk": derivative_series["jerk"],
        "snap": derivative_series["snap"],
        "structure": strata["structure"],
        "kinematics": strata["kinematics"],
        "geometry": strata["geometry"],
        "information": strata["information"],
        "propagation": strata["propagation"],
        "cascade_bias": strata["cascade_bias"],
        "scaling_exponent": strata["scaling_exponent"],
        "volatility_carrier": carriers["realized_volatility"],
        "participation_carrier": carriers["participation"],
        "liquidity_stress_carrier": carriers["liquidity_stress"],
    }
    feature_families = {
        "pressure": "pressure_state",
        "velocity": "pressure_state",
        "acceleration": "pressure_state",
        "jerk": "pressure_state",
        "snap": "pressure_state",
        "structure": "field_transform",
        "kinematics": "field_transform",
        "geometry": "field_transform",
        "information": "field_transform",
        "propagation": "field_transform",
        "cascade_bias": "field_transform",
        "scaling_exponent": "field_transform",
        "volatility_carrier": "ohlcv_carrier",
        "participation_carrier": "ohlcv_carrier",
        "liquidity_stress_carrier": "ohlcv_carrier",
    }
    feature_names = list(feature_arrays)
    values = np.column_stack([feature_arrays[name] for name in feature_names])
    count = len(values)
    evaluation_start = max(5, min(int(count * 0.60), count - 6))
    fit_start = min(max(0, requested_warmup_bars), max(0, evaluation_start - 40))
    pre_evaluation_bars = evaluation_start - fit_start
    desired_calibration_bars = max(20, pre_evaluation_bars // 3)
    calibration_bars = min(desired_calibration_bars, max(0, pre_evaluation_bars - 20))
    calibration_start = evaluation_start - calibration_bars
    standardized, center, scale = _robust_standardize(values, fit_start, calibration_start)
    family_counts = Counter(feature_families.values())
    family_weight = 1.0 / len(family_counts)
    feature_weights = np.asarray(
        [family_weight / family_counts[feature_families[name]] for name in feature_names],
        dtype=float,
    )
    metric_scale = np.sqrt(feature_weights)
    metric_values = standardized * metric_scale[None, :]
    raw_centroids, minimum_form_support = _select_supported_centroids(
        metric_values[fit_start:calibration_start],
        max_clusters=5,
    )

    # Canonicalize cluster identities so labels do not depend on seed order.
    cluster_order = sorted(
        range(len(raw_centroids)),
        key=lambda index: tuple(np.round(raw_centroids[index], 10).tolist()) + (index,),
    )
    centroids = raw_centroids[np.asarray(cluster_order, dtype=int)]
    distance_matrix = np.stack(
        [np.sum(np.square(metric_values - centroid), axis=1) for centroid in centroids],
        axis=1,
    )
    assignments = np.argmin(distance_matrix, axis=1)
    nearest_distance = np.sqrt(np.min(distance_matrix, axis=1))
    fit_silhouette = _mean_silhouette(
        metric_values[fit_start:calibration_start],
        assignments[fit_start:calibration_start],
        len(centroids),
    )

    distance_reference = nearest_distance[calibration_start:evaluation_start]
    if not len(distance_reference):
        distance_reference = nearest_distance[fit_start:calibration_start]
    distance_median = float(np.median(distance_reference))
    distance_high = float(np.quantile(distance_reference, 0.95))
    match_scale = max(distance_median, EPSILON)
    matches = np.clip(np.exp(-nearest_distance / match_scale), 0.0, 1.0)
    novelty_denominator = max(distance_high - distance_median, EPSILON)
    novelty = np.clip((nearest_distance - distance_median) / novelty_denominator, 0.0, 1.0)

    state_ids = [f"F.{index + 1:03d}" for index in range(len(centroids))]
    state_identities = [
        _lexicon_identity(centroid)
        for centroid in centroids
    ]
    state_tokens = [identity[0] for identity in state_identities]
    state_signatures = [identity[1] for identity in state_identities]

    smoothing = 0.5
    transition_counts = np.zeros((len(centroids), len(centroids)), dtype=int)
    fit_segments = _run_segments(assignments, fit_start, calibration_start)
    for segment_index in range(1, len(fit_segments)):
        previous_state = fit_segments[segment_index - 1][0]
        state = fit_segments[segment_index][0]
        transition_counts[previous_state, state] += 1
    if len(centroids) == 1:
        transition_probabilities = np.ones((1, 1), dtype=float)
    else:
        transition_probabilities = transition_counts.astype(float) + smoothing
        np.fill_diagonal(transition_probabilities, 0.0)
        transition_probabilities /= np.sum(transition_probabilities, axis=1, keepdims=True)

    durations: dict[int, list[int]] = {index: [] for index in range(len(centroids))}
    for state, start, end in fit_segments:
        durations[state].append(end - start + 1)

    standardized_centroids = np.divide(
        centroids,
        metric_scale[None, :],
        out=np.zeros_like(centroids),
        where=metric_scale[None, :] > EPSILON,
    )
    original_centroids = center[None, :] + standardized_centroids * scale[None, :]
    archetypes: list[dict[str, object]] = []
    calibration_distances_by_state: dict[int, np.ndarray] = {}
    for state_index, state_id in enumerate(state_ids):
        fit_indexes = np.flatnonzero(assignments[fit_start:calibration_start] == state_index) + fit_start
        calibration_indexes = (
            np.flatnonzero(assignments[calibration_start:evaluation_start] == state_index)
            + calibration_start
        )
        evaluation_indexes = np.flatnonzero(assignments[evaluation_start:] == state_index) + evaluation_start
        calibration_distances_by_state[state_index] = nearest_distance[calibration_indexes]
        total_count = len(fit_indexes) + len(calibration_indexes) + len(evaluation_indexes)
        archetypes.append(
            {
                "id": state_id,
                "token": state_tokens[state_index],
                "signature": state_signatures[state_index],
                "centroid": {
                    name: _rounded(original_centroids[state_index, feature_index], 6)
                    for feature_index, name in enumerate(feature_names)
                },
                "window_frequency": _rounded(total_count / max(1, count - fit_start)),
                "frequency": _rounded(total_count / max(1, count - fit_start)),
                "typical_duration_bars": _rounded(
                    float(np.median(durations[state_index])) if durations[state_index] else 0.0,
                    1,
                ),
                "fit_count": int(len(fit_indexes)),
                "calibration_count": int(len(calibration_indexes)),
                "evaluation_count": int(len(evaluation_indexes)),
                "evaluation_outcome": _forward_outcome_stats(
                    close,
                    evaluation_indexes.tolist(),
                    forward_bars=5,
                ),
                "evaluation_outcome_sampling": "Every assigned evaluation bar; forward windows overlap and observations are serially dependent.",
            }
        )

    evaluation_sequence: list[dict[str, object]] = []
    for index in range(evaluation_start, count):
        previous_state = int(assignments[index - 1])
        state = int(assignments[index])
        distance_tail_reference = calibration_distances_by_state[state]
        distance_tail_support = int(np.sum(np.isfinite(distance_tail_reference)))
        distance_tail_score = _empirical_distance_tail_score(
            float(nearest_distance[index]),
            distance_tail_reference,
        )
        transition_surprise = 0.0 if previous_state == state else -log(
            max(float(transition_probabilities[previous_state, state]), EPSILON)
        )
        evaluation_sequence.append(
            {
                "date": dates[index],
                "index": index,
                "state_id": state_ids[state],
                "match": _rounded(matches[index]),
                "novelty": _rounded(novelty[index]),
                "distance_tail_score": _rounded(distance_tail_score, 6),
                "distance_tail_support": distance_tail_support,
                "distance_tail_scope": "state_conditional" if distance_tail_score is not None else "unavailable",
                "outside_learned_range": (
                    distance_tail_score < DISTANCE_TAIL_CUTOFF
                    if distance_tail_score is not None
                    else None
                ),
                "transition_surprise": _rounded(transition_surprise, 6),
            }
        )

    latest_state = int(assignments[-1])
    current_age = 1
    for index in range(count - 2, -1, -1):
        if int(assignments[index]) != latest_state:
            break
        current_age += 1
    current_run_start = count - current_age
    current_distance_tail_reference = calibration_distances_by_state[latest_state]
    current_distance_tail_support = int(np.sum(np.isfinite(current_distance_tail_reference)))
    current_distance_tail_score = _empirical_distance_tail_score(
        float(nearest_distance[-1]),
        current_distance_tail_reference,
    )
    if current_run_start > 0 and int(assignments[current_run_start - 1]) != latest_state:
        latest_probability = max(
            float(transition_probabilities[int(assignments[current_run_start - 1]), latest_state]),
            EPSILON,
        )
        latest_surprise = -log(latest_probability)
    else:
        latest_surprise = 0.0
    probability_rows = [_rounded_probability_row(row) for row in transition_probabilities]
    likely_next = []
    minimum_transition_support = 5
    for state_index, row in enumerate(transition_probabilities):
        count_row = transition_counts[state_index]
        support = int(np.sum(count_row))
        leaders = np.flatnonzero(count_row == np.max(count_row)) if support else np.asarray([], dtype=int)
        ambiguous = support == 0 or len(leaders) != 1
        reliable = not ambiguous and support >= minimum_transition_support
        next_state = int(leaders[0]) if reliable else None
        likely_next.append(
            {
                "from_state": state_ids[state_index],
                "to_state": state_ids[next_state] if next_state is not None else None,
                "to_token": state_tokens[next_state] if next_state is not None else None,
                "probability": probability_rows[state_index][next_state] if next_state is not None else None,
                "support": support,
                "ambiguous": ambiguous,
                "reliable": reliable,
            }
        )

    motifs = _build_lexicon_motifs(
        assignments=assignments,
        evaluation_start=evaluation_start,
        close=close,
        state_ids=state_ids,
        state_tokens=state_tokens,
        forward_bars=5,
    )
    return {
        "model": "Market State Lexicon",
        "version": "0.1.0",
        "description": "A deterministic, window-native empirical codebook learned from this field, not a published market taxonomy, persistent identifier system, or trading signal.",
        "training_split": {
            "method": "Warm-up excluded where history permits; the pre-evaluation history is split chronologically into a proper fit segment and a later held-out calibration segment. Robust scaling, deterministic farthest-first k-means, Form selection, and grammar use the fit segment only. Candidate codebooks require 5%/20-bar fit support and mean fit silhouette >= 0.25.",
            "archetype_count": len(centroids),
            "maximum_archetypes": 5,
            "minimum_form_support": minimum_form_support,
            "fit_mean_silhouette": _rounded(fit_silhouette, 6),
            "minimum_mean_silhouette": 0.25,
            "requested_warmup_bars": requested_warmup_bars,
            "fit_start_index": fit_start,
            "fit_start": dates[fit_start],
            "fit_end_index": calibration_start - 1,
            "fit_end": dates[calibration_start - 1],
            "fit_bars": calibration_start - fit_start,
            "warmup_complete": fit_start >= requested_warmup_bars,
            "calibration_start_index": calibration_start,
            "calibration_start": dates[calibration_start],
            "calibration_bars": evaluation_start - calibration_start,
            "evaluation_bars": count - evaluation_start,
            "calibration_end": dates[evaluation_start - 1],
            "evaluation_start_index": evaluation_start,
            "evaluation_start": dates[evaluation_start],
            "calibration_independent_from_fit": True,
            "evaluation_outcomes_used_for_training": False,
        },
        "features": [
            {
                "id": name,
                "family": feature_families[name],
                "distance_weight": _rounded(feature_weights[index], 8),
                "calibration_median": _rounded(center[index], 6),
                "calibration_robust_scale": _rounded(scale[index], 6),
            }
            for index, name in enumerate(feature_names)
        ],
        "distance_metric": {
            "method": "Robust-standardized squared Euclidean distance with equal total weight for each feature family; match is an uncalibrated resonance index, not a probability.",
            "family_weights": {
                family: _rounded(family_weight, 8)
                for family in ("pressure_state", "field_transform", "ohlcv_carrier")
            },
            "signature_version": "lx1",
            "signature_quantization": "Metric-space centroids rounded to 0.35-unit bins; identities remain native to the selected rolling window.",
            "outside_range_rule": "State-conditional chronological held-out empirical distance-tail score below 0.05, available only with at least 20 same-state calibration distances.",
            "outside_range_cutoff": DISTANCE_TAIL_CUTOFF,
            "minimum_distance_tail_support": DISTANCE_TAIL_MINIMUM_SUPPORT,
            "distance_tail_interpretation": "A smaller score means the observation is farther from its assigned Form than most same-state bars in the later held-out calibration segment.",
            "coverage_guarantee": False,
            "dependence_caveat": "Overlapping, autocorrelated, and nonstationary market bars are not exchangeable; this empirical rank has no exact false-alert or coverage guarantee.",
        },
        "archetypes": archetypes,
        "evaluation_sequence": evaluation_sequence,
        "current": {
            "state_id": state_ids[latest_state],
            "token": state_tokens[latest_state],
            "signature": state_signatures[latest_state],
            "match": _rounded(matches[-1]),
            "novelty": _rounded(novelty[-1]),
            "distance_tail_score": _rounded(current_distance_tail_score, 6),
            "distance_tail_support": current_distance_tail_support,
            "distance_tail_scope": (
                "state_conditional" if current_distance_tail_score is not None else "unavailable"
            ),
            "outside_learned_range": (
                current_distance_tail_score < DISTANCE_TAIL_CUTOFF
                if current_distance_tail_score is not None
                else None
            ),
            "age_bars": current_age,
            "transition_surprise": _rounded(latest_surprise, 6),
        },
        "grammar": {
            "training": "Run-collapsed proper-fit Form exits only; self-persistence, calibration transitions, and evaluation transitions do not update this matrix.",
            "smoothing": smoothing,
            "minimum_transition_support": minimum_transition_support,
            "state_ids": state_ids,
            "counts": transition_counts.tolist(),
            "probabilities": probability_rows,
            "likely_next": likely_next,
        },
        "motifs": motifs,
        "motif_note": "Repeated 2-4-state run-collapsed phrases discovered in evaluation; outcomes start when the final Form is entered, are descriptive and overlapping, and are not corrected for search.",
    }


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
    include_retrospective: bool = True,
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
    carriers, carrier_ratios, realized_volatility, carrier_availability = _carrier_fields(
        history,
        horizons,
        structure,
    )
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
    aggregate_carrier_ratios = {name: _aggregate(values) for name, values in carrier_ratios.items()}

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
    carrier_ratio_series = [
        {"date": date, **{name: _rounded(values[index]) for name, values in aggregate_carrier_ratios.items()}}
        for index, date in enumerate(dates)
    ]
    if include_retrospective:
        relationship_atlas, validation = _build_relationship_atlas(
            history["close"].to_numpy(dtype=float),
            dates,
            aggregate_derivatives,
            aggregate_strata,
        )
        lexicon = _build_market_state_lexicon(
            dates=dates,
            close=history["close"].to_numpy(dtype=float),
            derivative_series=aggregate_derivatives,
            strata=aggregate_strata,
            carriers=aggregate_carriers,
            requested_warmup_bars=max(34, 2 * max(int(horizon) for horizon in horizons)),
        )
    else:
        # Scanner snapshots only need causal, live field measurements. Skipping
        # calibration, holdout outcomes, and learned state labels keeps the hot
        # sweep path bounded and prevents retrospective evidence from leaking
        # into a point-in-time candidate record.
        relationship_atlas = []
        validation = {"included": False, "reason": "live_only"}
        lexicon = {"included": False, "reason": "live_only"}

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
            "availability": carrier_availability,
            "ratios": {
                "latest": {name: _rounded(values[-1]) for name, values in aggregate_carrier_ratios.items()},
                "series": carrier_ratio_series,
                "baseline": "Arithmetic mean across configured horizons of current measure divided by its causal EWM baseline, which includes the current bar. 1.0 means equal, 1.2 means 20% above, and values are capped at 10.0.",
            },
            "note": "Price structure, realized volatility, volume participation, and an Amihud-like OHLCV liquidity-stress proxy are separate carriers. Volume-dependent direct ratios are unavailable when the source contains no positive volume observations; neutral internal values keep the descriptive clustering path finite without implying a measured 1.0x ratio.",
        },
        "relationship_atlas": relationship_atlas,
        "lexicon": lexicon,
        "validation": validation,
        "notes": [
            "All live field features are prefix-invariant and use no future bars.",
            "The relationship atlas is retrospective: it uses future returns only to evaluate pre-existing event definitions on a later chronological segment.",
            "Adjacent horizons overlap heavily; transfer-entropy or causality claims require orthogonal frequency bands and surrogate tests.",
            "No multiple-testing correction has been applied. Interesting results are hypotheses for replication, not discoveries.",
        ],
    }
    return channels, research
