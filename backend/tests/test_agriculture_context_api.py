from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.agriculture import router as agriculture_router


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    def fake_build_agriculture_market_context(symbol: str) -> dict[str, object]:
        if symbol == "BAD":
            raise KeyError("Unsupported agriculture symbol: BAD")
        return {
            "as_of": "2026-05-11T16:00:00+00:00",
            "symbol": symbol,
            "commodity": "Corn",
            "session": {"status": "open", "warnings": []},
            "crop_stage": {
                "stage": "pollination",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Weather premium is elevated.",
                "stage_explanation": "Corn is in a sensitive window.",
            },
            "weather": {"bias": "bullish", "source_health": {"freshness_status": "fresh"}},
            "crop_progress": {"bias": "neutral", "source_health": {"freshness_status": "missing"}},
            "export_demand": {"signal": "demand supportive", "bias": "bullish", "source_health": {"freshness_status": "fresh"}},
            "wasde": {"status": "tightening", "bias": "bullish", "source_health": {"freshness_status": "fresh"}},
            "global_supply": {"status": "mixed", "bias": "mixed", "source_health": {"freshness_status": "fresh"}},
            "report_calendar": {
                "next_report": {
                    "report": "WASDE",
                    "release_at": "2026-05-12T12:00:00-04:00",
                    "impact": "high",
                },
                "source_health": {"freshness_status": "fresh"},
            },
            "technical": {"bias": "bullish", "confidence": "medium"},
            "context_score": {
                "net_bias": "bullish",
                "confidence": "medium",
                "confidence_score": 62,
                "numerical_score": 2,
                "component_breakdown": {"weather": 1, "wasde": 1, "technical": 1, "global_supply": 0},
                "warnings": ["Signals are conflicted across modules, which lowers conviction."],
            },
            "setup_label": "wait for report",
            "market_read": "Corn read: Context is bullish.",
            "thesis_validation": {
                "validation_status": "confirmed",
                "confirmations": ["weather matched structured source inputs."],
                "warnings": [],
            },
            "source_health": [],
        }

    def fake_calculate_composite_index(days: int) -> dict[str, object]:
        assert days == 365
        return {
            "as_of": "2026-08-18T15:00:00+00:00",
            "regime_label": "Stable Expansion",
            "stability_score": 68.0,
            "stability_components": {},
            "component_history": [],
            "summary": "Agriculture internals are stable.",
            "composite": {"group_weights": {}, "changes": {}, "history": [], "volatility": None},
            "groups": [],
            "strongest_markets": [],
            "weakest_markets": [],
            "correlations": {"group_matrix": {"60": []}, "pair_insights": {"60": {}}},
            "macro_pressure": {"interest_rates": {"name": "10Y Yield", "status": "supportive", "change_20d": -1.0}},
            "special_signals": {
                "soybean_oil_vs_grains": {"spread_20d": 1.0, "interpretation": "supportive"},
                "livestock_feed_margin_pressure": {"spread_20d": -1.0, "interpretation": "easing"},
            },
            "availability": {
                "symbols": [],
                "missing_symbols": [],
                "missing_macro_series": [],
                "available_group_count": 6,
                "total_configured_symbols": 25,
                "available_symbol_count": 25,
            },
            "warnings": [],
        }

    monkeypatch.setattr(
        "app.api.agriculture.build_agriculture_market_context",
        fake_build_agriculture_market_context,
        raising=True,
    )
    monkeypatch.setattr(
        "app.api.agriculture.calculate_composite_index",
        fake_calculate_composite_index,
        raising=True,
    )

    app = FastAPI()
    app.include_router(agriculture_router)
    return TestClient(app)


def test_context_endpoint_returns_aggregate_payload(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "ZC"})

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] == "2026-05-11T16:00:00+00:00"
    assert body["symbol"] == "ZC"
    assert body["context_score"]["net_bias"] == "bullish"
    assert body["report_calendar"]["next_report"]["report"] == "WASDE"
    assert body["setup_label"] == "wait for report"


def test_overview_endpoint_returns_one_shared_deep_dive_snapshot(client: TestClient) -> None:
    response = client.get("/agriculture/overview", params={"days": 365})

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] == "2026-08-18T15:00:00+00:00"
    assert body["correlations"]["group_matrix"]["60"] == []
    assert body["macro_pressure"]["interest_rates"]["name"] == "10Y Yield"
    assert body["special_signals"]["soybean_oil_vs_grains"]["spread_20d"] == 1.0
    assert body["availability"]["missing_macro_series"] == []


def test_context_endpoint_supports_non_grain_symbol(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "LE"})

    assert response.status_code == 200
    assert response.json()["symbol"] == "LE"


def test_context_endpoint_returns_404_for_unknown_symbol(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "BAD"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Unsupported agriculture symbol: BAD"
