import pytest

from app.services.ingestion.sentiment_sources import compute_staleness_weights


def test_compute_staleness_weights_decays_stale_components_and_normalizes():
    nominal = {"umich": 0.30, "nfib": 0.30, "ism": 0.25, "capex": 0.15}
    latest = {
        "umich": "2026-03-15",
        "nfib": "2026-03-01",
        "ism": "2026-01-15",
        "capex": "2025-12-01",
    }

    weights = compute_staleness_weights(latest, nominal, as_of="2026-03-26")

    assert sum(weights.values()) == pytest.approx(1.0)
    assert weights["umich"] > nominal["umich"]
    assert weights["nfib"] > nominal["nfib"]
    assert weights["ism"] < nominal["ism"]
    assert weights["capex"] < nominal["capex"]


def test_compute_staleness_weights_zeroes_missing_components():
    nominal = {"umich": 0.50, "nfib": 0.50}
    latest = {"umich": "2026-03-10", "nfib": None}

    weights = compute_staleness_weights(latest, nominal, as_of="2026-03-26")

    assert weights["umich"] == pytest.approx(1.0)
    assert weights["nfib"] == pytest.approx(0.0)
