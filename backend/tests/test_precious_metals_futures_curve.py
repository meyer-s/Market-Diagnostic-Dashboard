from __future__ import annotations

from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api import precious_metals as pm


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    class FixedDatetime(datetime):
        @classmethod
        def utcnow(cls) -> datetime:
            return cls(2026, 5, 15)

    snapshots = {
        "GCM26.CMX": {"price": 3200.0, "previous_close": 3190.0, "change_pct": 0.31, "volume": 18000, "as_of": "2026-05-15T14:30:00"},
        "GCQ26.CMX": {"price": 3215.0, "previous_close": 3208.0, "change_pct": 0.22, "volume": 14000, "as_of": "2026-05-15T14:30:00"},
        "GCV26.CMX": {"price": 3230.0, "previous_close": 3224.0, "change_pct": 0.19, "volume": 9000, "as_of": "2026-05-15T14:30:00"},
        "GCZ26.CMX": {"price": 3245.0, "previous_close": 3238.0, "change_pct": 0.22, "volume": 7000, "as_of": "2026-05-15T14:30:00"},
        "SIN26.CMX": {"price": 34.5, "previous_close": 34.2, "change_pct": 0.88, "volume": 5200, "as_of": "2026-05-15T14:30:00"},
        "SIU26.CMX": {"price": 34.9, "previous_close": 34.7, "change_pct": 0.58, "volume": 4100, "as_of": "2026-05-15T14:30:00"},
        "SIZ26.CMX": {"price": 35.3, "previous_close": 35.0, "change_pct": 0.86, "volume": 3600, "as_of": "2026-05-15T14:30:00"},
        "SIH27.CMX": {"price": 35.8, "previous_close": 35.5, "change_pct": 0.85, "volume": 3000, "as_of": "2026-05-15T14:30:00"},
        "PLN26.NYM": {"price": 1120.0, "previous_close": 1118.0, "change_pct": 0.18, "volume": 1500, "as_of": "2026-05-15T14:30:00"},
        "PLV26.NYM": {"price": 1129.0, "previous_close": 1125.0, "change_pct": 0.36, "volume": 1200, "as_of": "2026-05-15T14:30:00"},
        "PLF27.NYM": {"price": 1136.0, "previous_close": 1132.0, "change_pct": 0.35, "volume": 900, "as_of": "2026-05-15T14:30:00"},
        "PLJ27.NYM": {"price": 1144.0, "previous_close": 1139.0, "change_pct": 0.44, "volume": 700, "as_of": "2026-05-15T14:30:00"},
        "PAM26.NYM": {"price": 980.0, "previous_close": 975.0, "change_pct": 0.51, "volume": 800, "as_of": "2026-05-15T14:30:00"},
        "PAU26.NYM": {"price": 986.0, "previous_close": 981.0, "change_pct": 0.51, "volume": 650, "as_of": "2026-05-15T14:30:00"},
        "PAZ26.NYM": {"price": 991.0, "previous_close": 987.0, "change_pct": 0.41, "volume": 500, "as_of": "2026-05-15T14:30:00"},
        "PAH27.NYM": {"price": 997.0, "previous_close": 992.0, "change_pct": 0.50, "volume": 400, "as_of": "2026-05-15T14:30:00"},
    }

    monkeypatch.setattr(pm, "datetime", FixedDatetime, raising=True)
    monkeypatch.setattr(pm, "_fetch_futures_contract_snapshot", lambda symbol: snapshots.get(symbol), raising=True)
    monkeypatch.setattr(
        pm,
        "fetch_international_metal_observations",
        lambda _metal: {"observations": [], "sources": []},
        raising=True,
    )
    monkeypatch.setattr(
        pm,
        "fetch_international_metal_history",
        lambda _metal, _days: {
            "observations": [
                {
                    "registry_id": "lbma_silver",
                    "provider_id": "lbma",
                    "local_price": 30.0,
                    "currency": "USD",
                    "native_unit": "troy oz",
                    "fx_rate_local_per_usd": 1.0,
                    "quote_timestamp": "2026-05-14T00:00:00+00:00",
                },
                {
                    "registry_id": "lbma_silver",
                    "provider_id": "lbma",
                    "local_price": 33.0,
                    "currency": "USD",
                    "native_unit": "troy oz",
                    "fx_rate_local_per_usd": 1.0,
                    "quote_timestamp": "2026-05-15T00:00:00+00:00",
                },
            ],
            "sources": [{
                "provider_id": "lbma",
                "provider_name": "London Bullion Market Association",
                "status": "live",
                "fetched_at": "2026-05-15T00:00:00+00:00",
                "source_url": "https://prices.lbma.org.uk/json/silver.json",
                "source_tier": "official_primary",
                "history_scope": "Full published delayed benchmark history",
                "observation_count": 2,
            }],
        },
        raising=True,
    )

    app = FastAPI()
    app.include_router(pm.router)
    return TestClient(app)


def test_futures_curve_endpoint_returns_nearby_contracts(client: TestClient) -> None:
    response = client.get("/precious-metals/futures-curve", params={"contracts": 4})

    assert response.status_code == 200
    body = response.json()
    assert body["contracts_requested"] == 4
    assert body["source"] == "Yahoo Finance month-specific futures history"
    assert body["as_of"] == "2026-05-15T14:30:00"
    assert body["generated_at"] == "2026-05-15T00:00:00"

    gold = next(item for item in body["metals"] if item["metal"] == "AU")
    assert [contract["symbol"] for contract in gold["contracts"]] == [
        "GCM26.CMX",
        "GCQ26.CMX",
        "GCV26.CMX",
        "GCZ26.CMX",
    ]
    assert gold["curve_state"] == "CONTANGO"
    assert gold["curve_bps"] < 0
    assert gold["contracts"][0]["contract_label"] == "Jun 2026"

    silver = next(item for item in body["metals"] if item["metal"] == "AG")
    assert len(silver["contracts"]) == 4
    assert silver["contracts"][0]["symbol"] == "SIN26.CMX"


def test_global_dispersion_exposes_verified_reference_and_registry_coverage(client: TestClient) -> None:
    response = client.get("/precious-metals/global-price-dispersion", params={"metal": "AG"})

    assert response.status_code == 200
    body = response.json()
    assert body["metal"] == "AG"
    assert body["canonical_unit"] == "troy oz"
    assert body["comparison_ready"] is False
    assert body["summary"]["observed_venues"] == 1
    assert body["summary"]["registered_venues"] >= 6

    comex = next(row for row in body["venues"] if row["registry_id"] == "comex_silver")
    assert comex["symbol"] == "SIN26.CMX"
    assert comex["contract_month"] == "Jul 2026"
    assert comex["comparability_status"] == "reference"
    assert comex["price_type"] == "provider daily bar close"
    assert comex["normalized_price"] == 34.5

    shfe = next(row for row in body["venues"] if row["registry_id"] == "shfe_silver")
    assert shfe["availability_status"] == "unavailable"
    assert shfe["redistribution_status"].startswith("Official public Daily Express")


def test_global_dispersion_history_exposes_indexed_source_backed_series(client: TestClient) -> None:
    response = client.get(
        "/precious-metals/global-price-dispersion/history",
        params={"metal": "AG", "days": 30},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "indexed_change"
    lbma = next(row for row in body["series"] if row["registry_id"] == "lbma_silver")
    assert lbma["history_scope"] == "Full published delayed benchmark history"
    assert lbma["points"][0]["index_value"] == 100
    assert lbma["points"][-1]["index_value"] == 110
    assert lbma["change_pct"] == 10
    assert "shfe_silver" in {row["registry_id"] for row in body["venues_without_history"]}
