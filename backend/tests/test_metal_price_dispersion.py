from datetime import datetime, timezone

import pandas as pd
import pytest

from app.services.metal_price_dispersion import (
    build_global_price_dispersion,
    normalize_metal_price,
)
from app.services import metal_projections
from app.services.metal_projections import METAL_INSTRUMENTS


def test_normalizes_silver_cny_per_kg_and_jpy_per_gram() -> None:
    cny_price = normalize_metal_price("AG", 7600.0, "CNY", "kg", 7.2)
    jpy_price = normalize_metal_price("AG", 190.0, "JPY", "gram", 150.0)

    assert cny_price == pytest.approx(32.8297, rel=1e-4)
    assert jpy_price == pytest.approx(39.3977, rel=1e-4)


def test_requires_fx_for_non_usd_observation() -> None:
    with pytest.raises(ValueError, match="FX rate"):
        normalize_metal_price("AG", 7600.0, "CNY", "kg", None)


def test_projection_instruments_keep_price_units_explicit() -> None:
    assert METAL_INSTRUMENTS["AU"]["symbol"] == "GC=F"
    assert METAL_INSTRUMENTS["AU"]["quote_unit"] == "USD/troy oz"
    assert METAL_INSTRUMENTS["CU"]["quote_unit"] == "USD/lb"
    assert METAL_INSTRUMENTS["AL"]["quote_unit"] == "USD/metric tonne"


def test_projection_as_of_is_the_price_observation_not_compute_time(monkeypatch: pytest.MonkeyPatch) -> None:
    index = pd.date_range("2026-01-01", periods=220, freq="D")
    history = pd.DataFrame({"price": [100.0 + (index_value * 0.1) for index_value in range(220)]}, index=index)
    monkeypatch.setattr(metal_projections, "fetch_metal_price_history", lambda *_args, **_kwargs: history)

    result = metal_projections.compute_metal_projection("AG", "Silver", "SLV")

    assert result["as_of"] == index[-1].to_pydatetime().isoformat()
    assert result["instrument"]["symbol"] == "SI=F"


def test_builds_dispersion_only_from_matched_observations() -> None:
    timestamp = "2026-08-21T14:00:00+00:00"
    shared_tax_basis = "Matched test basis"
    body = build_global_price_dispersion(
        "AG",
        [
            {
                "registry_id": "comex_silver",
                "contract_month": "Sep 2026",
                "local_price": 35.0,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "fx_timestamp": timestamp,
                "price_type": "settlement",
                "quote_timestamp": timestamp,
                "session_status": "closed",
                "data_delay": "Test observation",
                "volume": 100,
                "open_interest": 200,
                "tax_basis": shared_tax_basis,
                "purity": "Matched test purity",
                "delivery_location": "Matched test location",
            },
            {
                "registry_id": "shfe_silver",
                "contract_month": "Sep 2026",
                "local_price": 8200.0,
                "currency": "CNY",
                "native_unit": "kg",
                "fx_rate_local_per_usd": 7.2,
                "fx_timestamp": timestamp,
                "price_type": "settlement",
                "quote_timestamp": timestamp,
                "session_status": "closed",
                "data_delay": "Test observation",
                "volume": 80,
                "open_interest": 160,
                "tax_basis": shared_tax_basis,
                "purity": "Matched test purity",
                "delivery_location": "Matched test location",
            },
        ],
        reference="global_median",
        now=datetime(2026, 8, 21, 15, 0, tzinfo=timezone.utc),
    )

    assert body["comparison_ready"] is True
    assert body["summary"]["comparable_venues"] == 2
    assert body["summary"]["dispersion_pct"] is not None
    shfe = next(row for row in body["venues"] if row["registry_id"] == "shfe_silver")
    assert shfe["comparability_status"] == "comparable"
    assert shfe["premium_type"] == "comparable_premium"
    assert shfe["fx_rate_local_per_usd"] == 7.2
    assert body["reference"]["registry_id"] == "global_median"
    assert body["reference"]["label"] == "Global median"


def test_unmatched_tax_basis_remains_a_headline_gap() -> None:
    timestamp = "2026-08-21T14:00:00+00:00"
    body = build_global_price_dispersion(
        "AG",
        [
            {
                "registry_id": "comex_silver",
                "contract_month": "Sep 2026",
                "local_price": 35.0,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": timestamp,
                "session_status": "closed",
            },
            {
                "registry_id": "shfe_silver",
                "contract_month": "Sep 2026",
                "local_price": 8200.0,
                "currency": "CNY",
                "native_unit": "kg",
                "fx_rate_local_per_usd": 7.2,
                "quote_timestamp": timestamp,
                "session_status": "closed",
            },
        ],
        basis="tax_adjusted",
        now=datetime(2026, 8, 21, 15, 0, tzinfo=timezone.utc),
    )

    shfe = next(row for row in body["venues"] if row["registry_id"] == "shfe_silver")
    assert shfe["comparability_status"] == "headline_only"
    assert "tax basis differs" in shfe["comparability_reasons"]
    assert body["controls"]["basis_applied"] == "raw_converted"
    assert body["comparison_ready"] is False


def test_different_quote_times_cannot_be_promoted_by_a_blanket_adjustment() -> None:
    body = build_global_price_dispersion(
        "AG",
        [
            {
                "registry_id": "comex_silver",
                "contract_month": "Sep 2026",
                "local_price": 35.0,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-21T14:00:00+00:00",
                "session_status": "closed",
            },
            {
                "registry_id": "shfe_silver",
                "contract_month": "Sep 2026",
                "local_price": 8200.0,
                "currency": "CNY",
                "native_unit": "kg",
                "fx_rate_local_per_usd": 7.2,
                "quote_timestamp": "2026-08-23T14:00:00+00:00",
                "session_status": "closed",
                "adjustments_complete": True,
                "sourced_adjustments": ["carry", "tax", "delivery"],
            },
        ],
        now=datetime(2026, 8, 23, 15, 0, tzinfo=timezone.utc),
    )

    shfe = next(row for row in body["venues"] if row["registry_id"] == "shfe_silver")
    assert shfe["comparability_status"] == "headline_only"
    assert "quote times differ by 48.0 hours" in shfe["comparability_reasons"]


def test_continuous_futures_proxy_is_reference_only() -> None:
    body = build_global_price_dispersion(
        "CU",
        [
            {
                "registry_id": "comex_copper",
                "contract_month": None,
                "local_price": 6.25,
                "currency": "USD",
                "native_unit": "lb",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-21T14:00:00+00:00",
                "session_status": "unverified",
            },
        ],
        now=datetime(2026, 8, 21, 15, 0, tzinfo=timezone.utc),
    )

    copper = next(row for row in body["venues"] if row["registry_id"] == "comex_copper")
    assert copper["comparability_status"] == "reference_only"
    assert copper["premium_type"] == "headline_gap"
    assert body["summary"]["comparable_venues"] == 0


def test_live_source_without_product_is_reported_as_no_qualifying_quote() -> None:
    body = build_global_price_dispersion(
        "PD",
        [],
        source_statuses=[{
            "provider_id": "sge",
            "provider_name": "Shanghai Gold Exchange",
            "status": "live",
            "observation_count": 0,
        }],
        now=datetime(2026, 8, 21, 15, 0, tzinfo=timezone.utc),
    )

    palladium = next(row for row in body["venues"] if row["registry_id"] == "sge_pd9995")
    assert palladium["availability_status"] == "unavailable"
    assert palladium["data_delay"] == "Latest official publication contained no qualifying quote for this product"
    assert body["sources"][0]["status"] == "live"
