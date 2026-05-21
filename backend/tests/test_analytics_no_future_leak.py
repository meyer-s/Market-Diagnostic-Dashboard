from __future__ import annotations

from app.services.analytics import compute_rolling_z_scores, direction_adjusted, map_z_to_score, score_series


def test_future_values_do_not_change_past_z_scores() -> None:
    base = [float(i) for i in range(1, 80)]
    mutated = base[:]
    mutated[-1] = 10_000.0

    original_scores = compute_rolling_z_scores(base, lookback=20)
    mutated_scores = compute_rolling_z_scores(mutated, lookback=20)

    assert original_scores[:-1] == mutated_scores[:-1]


def test_constant_series_is_neutral() -> None:
    z_scores = compute_rolling_z_scores([5.0] * 40, lookback=20)
    scores = score_series(z_scores)

    assert all(z == 0.0 for z in z_scores)
    assert all(score == 50.0 for score in scores)


def test_scores_remain_bounded_and_direction_adjustment_is_monotonic() -> None:
    z_scores = compute_rolling_z_scores([1.0, 2.0, 3.0, 4.0, 5.0], lookback=5, min_periods=1)
    adjusted = direction_adjusted(z_scores, 1)
    scores = [map_z_to_score(value) for value in adjusted]

    assert all(0.0 <= score <= 100.0 for score in scores)
    assert scores[-1] <= scores[0]
