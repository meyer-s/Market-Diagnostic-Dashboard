from app.api import real_estate


def _overview_payload():
    return {
        "as_of": "2026-07-28T15:00:00Z",
        "regime_label": "YELLOW",
        "composite_score": 52.0,
        "stability_score": 48.0,
        "summary": "Mixed.",
        "groups": [],
        "symbols": [],
        "factors": [],
        "metrics": {},
        "availability": {
            "available_count": 8,
            "total_configured": 8,
        },
        "warnings": [],
        "composite_history": [],
        "stability_history": [],
        "factor_history": [],
        "transmission": {
            "mortgage_rate_30y": [],
            "treasury_10y": [],
            "indexed_xhb": [],
            "indexed_vnq": [],
            "credit_spread": [],
        },
        "data_quality": {
            "status": "stale",
            "stale": True,
            "reason": "real_estate_overview_refresh_failed",
            "snapshot_cached_at": "2026-07-28T15:00:00Z",
            "snapshot_age_seconds": 7200.0,
        },
    }


def test_projection_routes_preserve_real_estate_provenance(monkeypatch) -> None:
    payload = _overview_payload()
    monkeypatch.setattr(
        real_estate,
        "calculate_real_estate_index",
        lambda days: payload,
    )

    overview = real_estate.get_real_estate_overview(days=365)
    history = real_estate.get_real_estate_history(days=365)
    transmission = real_estate.get_real_estate_transmission(days=365)

    assert overview["data_quality"] == payload["data_quality"]
    assert history["data_quality"] == payload["data_quality"]
    assert transmission["data_quality"] == payload["data_quality"]


def test_commercial_route_keeps_service_provenance(monkeypatch) -> None:
    payload = {
        "as_of": "2026-07-28T15:00:00Z",
        "data_quality": {
            "status": "partial",
            "stale": False,
            "reason": "commercial_real_estate_refresh_incomplete",
        },
    }
    monkeypatch.setattr(
        real_estate,
        "calculate_commercial_real_estate",
        lambda days: payload,
    )

    assert real_estate.get_commercial_real_estate(days=365)["data_quality"] == payload[
        "data_quality"
    ]
