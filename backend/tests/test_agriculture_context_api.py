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

    monkeypatch.setattr(
        "app.api.agriculture.build_agriculture_market_context",
        fake_build_agriculture_market_context,
        raising=True,
    )

    app = FastAPI()
    app.include_router(agriculture_router)
    return TestClient(app)


def test_context_endpoint_returns_aggregate_payload(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "ZC"})

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "ZC"
    assert body["context_score"]["net_bias"] == "bullish"
    assert body["report_calendar"]["next_report"]["report"] == "WASDE"
    assert body["setup_label"] == "wait for report"


def test_context_endpoint_supports_non_grain_symbol(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "LE"})

    assert response.status_code == 200
    assert response.json()["symbol"] == "LE"


def test_context_endpoint_returns_404_for_unknown_symbol(client: TestClient) -> None:
    response = client.get("/agriculture/context", params={"symbol": "BAD"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Unsupported agriculture symbol: BAD"