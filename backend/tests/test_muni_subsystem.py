from app.services.muni_data import compute_muni_long_spread, compute_composite_score, normalize_component_weights


def test_dynamic_reweighting_missing_component():
    base_weights = {
        "MUNI_LONG_SPREAD": 0.40,
        "SIFMA_INDEX": 0.25,
        "MUNI_CURVE_SLOPE_STABILITY": 0.20,
        "MUNI_LEVEL_STRESS": 0.15,
    }
    available = ["MUNI_LONG_SPREAD", "SIFMA_INDEX", "MUNI_LEVEL_STRESS"]
    weights_used = normalize_component_weights(base_weights, available)

    assert round(sum(weights_used.values()), 6) == 1.0
    expected_total = base_weights["MUNI_LONG_SPREAD"] + base_weights["SIFMA_INDEX"] + base_weights["MUNI_LEVEL_STRESS"]
    assert weights_used["MUNI_LONG_SPREAD"] == base_weights["MUNI_LONG_SPREAD"] / expected_total
    assert weights_used["SIFMA_INDEX"] == base_weights["SIFMA_INDEX"] / expected_total
    assert weights_used["MUNI_LEVEL_STRESS"] == base_weights["MUNI_LEVEL_STRESS"] / expected_total

    latest_scores = {
        "MUNI_LONG_SPREAD": 60.0,
        "SIFMA_INDEX": 55.0,
        "MUNI_LEVEL_STRESS": 50.0,
    }
    composite = compute_composite_score(latest_scores, weights_used)
    assert composite is not None


def test_muni_long_spread_requires_both_operands():
    muni_dates, muni_values = compute_muni_long_spread({}, {"2024-01-01": 4.0})
    assert muni_dates == []
    assert muni_values == []

    muni_dates, muni_values = compute_muni_long_spread({"2024-01-01": 3.0}, {})
    assert muni_dates == []
    assert muni_values == []
