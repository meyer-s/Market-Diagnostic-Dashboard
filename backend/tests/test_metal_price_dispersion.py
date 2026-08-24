from datetime import datetime, timezone

import pandas as pd
import pytest

from app.services.metal_price_dispersion import (
    build_global_price_dispersion,
    build_global_price_history,
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


def test_builds_continuous_exchange_history_without_fabricating_missing_series() -> None:
    body = build_global_price_history(
        "AG",
        [
            {
                "registry_id": "comex_silver",
                "provider_id": "us_reference",
                "local_price": 40.0,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-20T00:00:00+00:00",
            },
            {
                "registry_id": "comex_silver",
                "provider_id": "us_reference",
                "local_price": 42.0,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-21T00:00:00+00:00",
            },
            {
                "registry_id": "sge_ag9999",
                "provider_id": "sge",
                "local_price": 9000.0,
                "currency": "CNY",
                "native_unit": "kg",
                "fx_rate_local_per_usd": None,
                "quote_timestamp": "2026-08-21T00:00:00+00:00",
            },
        ],
        days=30,
        source_statuses=[{
            "provider_id": "us_reference",
            "status": "live",
            "history_scope": "Stored daily history",
        }],
        now=datetime(2026, 8, 22, tzinfo=timezone.utc),
    )

    assert len(body["series"]) == 1
    series = body["series"][0]
    assert series["registry_id"] == "comex_silver"
    assert series["points"][0]["index_value"] == 100
    assert series["points"][1]["index_value"] == 105
    assert series["points"][1]["aligned_index_value"] == 105
    assert series["change_pct"] == 5
    assert body["composite"]["change_pct"] == 5
    assert body["composite"]["points"][-1]["contributor_count"] == 1
    assert "sge_ag9999" in {row["registry_id"] for row in body["venues_without_history"]}
    assert body["mode"] == "composite_direction"


def test_global_history_prefers_official_venue_returns_and_collapses_products_by_venue() -> None:
    observations = []
    for registry_id, provider_id, start, end in [
        ("comex_silver", "us_reference", 100.0, 120.0),
        ("lbma_silver", "lbma", 100.0, 102.0),
        ("sge_ag9999", "sge", 100.0, 104.0),
        ("sge_ag_td", "sge", 100.0, 106.0),
    ]:
        observations.extend([
            {
                "registry_id": registry_id,
                "provider_id": provider_id,
                "local_price": start,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-20T00:00:00+00:00",
            },
            {
                "registry_id": registry_id,
                "provider_id": provider_id,
                "local_price": end,
                "currency": "USD",
                "native_unit": "troy oz",
                "fx_rate_local_per_usd": 1.0,
                "quote_timestamp": "2026-08-21T00:00:00+00:00",
            },
        ])

    body = build_global_price_history(
        "AG",
        observations,
        days=30,
        source_statuses=[
            {"provider_id": "us_reference", "source_tier": "reference_only", "status": "live"},
            {"provider_id": "lbma", "source_tier": "official_primary", "status": "live"},
            {"provider_id": "sge", "source_tier": "official_primary", "status": "live"},
        ],
        now=datetime(2026, 8, 22, tzinfo=timezone.utc),
    )

    point = body["composite"]["points"][-1]
    assert point["source_quality"] == "official_primary"
    assert point["contributor_count"] == 2
    assert {row["venue"] for row in point["contributors"]} == {"LBMA", "SGE"}
    assert point["daily_return_pct"] == 3.5
    assert body["composite"]["change_pct"] == 3.5


def test_global_history_does_not_interleave_fallback_dates_with_official_calendar() -> None:
    observations = [
        {
            "registry_id": "comex_silver",
            "provider_id": "us_reference",
            "local_price": price,
            "currency": "USD",
            "native_unit": "troy oz",
            "fx_rate_local_per_usd": 1.0,
            "quote_timestamp": timestamp,
        }
        for price, timestamp in [
            (100.0, "2026-08-20T00:00:00+00:00"),
            (120.0, "2026-08-21T00:00:00+00:00"),
        ]
    ] + [
        {
            "registry_id": "lbma_silver",
            "provider_id": "lbma",
            "local_price": price,
            "currency": "USD",
            "native_unit": "troy oz",
            "fx_rate_local_per_usd": 1.0,
            "quote_timestamp": timestamp,
        }
        for price, timestamp in [
            (100.0, "2026-08-20T00:00:00+00:00"),
            (102.0, "2026-08-22T00:00:00+00:00"),
        ]
    ]

    body = build_global_price_history(
        "AG",
        observations,
        days=30,
        source_statuses=[
            {"provider_id": "us_reference", "source_tier": "reference_only", "status": "live"},
            {"provider_id": "lbma", "source_tier": "official_primary", "status": "live"},
        ],
        now=datetime(2026, 8, 23, tzinfo=timezone.utc),
    )

    assert [point["date"] for point in body["composite"]["points"]] == [
        "2026-08-20",
        "2026-08-22",
    ]
    assert body["composite"]["change_pct"] == 2
    assert body["composite"]["official_primary_days"] == 1
    assert body["composite"]["fallback_days"] == 0
