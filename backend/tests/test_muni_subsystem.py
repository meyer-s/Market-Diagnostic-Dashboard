from app.services.muni_data import compute_composite_score, normalize_component_weights


def test_misidentified_swedish_components_are_unavailable_and_do_not_enter_weights(monkeypatch):
    import asyncio
    from datetime import datetime, timedelta
    from app.services import muni_data

    now = datetime.utcnow()

    async def sifma():
        return [{"date": (now - timedelta(days=7)).date().isoformat(), "value": 2.75}, {"date": now.date().isoformat(), "value": 2.8}]

    async def curve(_start):
        return [{"date": now.date().isoformat(), "yields": {"2": 4.1, "10": 4.5}}]

    async def forbidden(*args, **kwargs):
        raise AssertionError("No unverified FRED municipal index may be requested")

    monkeypatch.setattr(muni_data, "_fetch_sifma_series", sifma)
    monkeypatch.setattr(muni_data, "_build_fred_curve_points", curve)
    monkeypatch.setattr(muni_data.FredClient, "fetch_series", forbidden)
    data = asyncio.run(muni_data._build_muni_subsystem(days=1095))

    assert data["data_quality"]["status"] == "partial"
    assert data["composite"]["coverage_live"] == 2
    assert set(data["composite"]["missing_keys"]) == {"MUNI_LONG_SPREAD", "MUNI_REVENUE_PROXY"}
    assert set(data["composite"]["weights_used"]) == {"SIFMA_INDEX", "MUNI_CURVE_SLOPE_STABILITY"}
    for series in data["series"]:
        if series["key"] in {"MUNI_LONG_SPREAD", "MUNI_REVENUE_PROXY"}:
            assert not series["is_live"]
            assert series["history"] == []
            assert series["latest"] is None


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
