from app.services.analytics_stub import score_series
from app.services.ingestion.breadth_utils import compute_breadth_composite_z
from app.utils.system_scoring import compute_weighted_composite


def test_breadth_scores_within_bounds():
    ratio = [1.0 + (i * 0.001) for i in range(60)]
    scores = score_series(compute_breadth_composite_z(ratio, lookback=30))
    assert all(0 <= score <= 100 for score in scores)


def test_breadth_score_improves_with_rising_ratio():
    flat = [1.0 for _ in range(60)]
    rising = [1.0 + (i * 0.002) for i in range(60)]
    flat_score = score_series(compute_breadth_composite_z(flat, lookback=30))[-1]
    rising_score = score_series(compute_breadth_composite_z(rising, lookback=30))[-1]
    assert rising_score >= flat_score


def test_system_reweighting_excludes_missing_breadth():
    scores_by_code = {"VIX": 60.0, "SPY": 70.0, "BREADTH_HEALTH": None}
    weights_by_code = {"VIX": 1.5, "SPY": 1.4, "BREADTH_HEALTH": 1.0}
    composite, weights_used = compute_weighted_composite(scores_by_code, weights_by_code)
    assert composite is not None
    assert "BREADTH_HEALTH" not in weights_used
    assert abs(sum(weights_used.values()) - 1.0) < 1e-6
