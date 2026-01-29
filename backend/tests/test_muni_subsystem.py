from app.services.muni_data import compute_composite_score, normalize_component_weights


def test_dynamic_reweighting_missing_component():
    base_weights = {
        "SIFMA_INDEX": 0.30,
        "MUNI_LONG_SPREAD": 0.30,
        "MUNI_REVENUE_PROXY": 0.25,
        "MUNI_CURVE_SLOPE_STABILITY": 0.15,
    }
    available = ["MUNI_LONG_SPREAD", "SIFMA_INDEX", "MUNI_REVENUE_PROXY"]
    weights_used = normalize_component_weights(base_weights, available)

    assert round(sum(weights_used.values()), 6) == 1.0
    expected_total = (
        base_weights["MUNI_LONG_SPREAD"]
        + base_weights["SIFMA_INDEX"]
        + base_weights["MUNI_REVENUE_PROXY"]
    )
    assert weights_used["MUNI_LONG_SPREAD"] == base_weights["MUNI_LONG_SPREAD"] / expected_total
    assert weights_used["SIFMA_INDEX"] == base_weights["SIFMA_INDEX"] / expected_total
    assert weights_used["MUNI_REVENUE_PROXY"] == base_weights["MUNI_REVENUE_PROXY"] / expected_total

    latest_scores = {
        "MUNI_LONG_SPREAD": 60.0,
        "SIFMA_INDEX": 55.0,
        "MUNI_REVENUE_PROXY": 50.0,
    }
    composite = compute_composite_score(latest_scores, weights_used)
    assert composite is not None


def test_dynamic_reweighting_handles_empty_available():
    base_weights = {
        "SIFMA_INDEX": 0.30,
        "MUNI_LONG_SPREAD": 0.30,
    }
    weights_used = normalize_component_weights(base_weights, [])
    assert weights_used == {}
