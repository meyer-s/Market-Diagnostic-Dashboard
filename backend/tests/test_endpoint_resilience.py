from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import pytest

from app.api import indicators, market_internals
from app.services import muni_data, real_estate_index
from app.services.endpoint_response_cache import ResponseSnapshot


@pytest.fixture(autouse=True)
def _avoid_external_refresh_locks(monkeypatch):
    @asynccontextmanager
    async def no_op_async_lock(_cache_key: str):
        yield

    monkeypatch.setattr(
        indicators,
        "async_response_refresh_lock",
        no_op_async_lock,
    )
    monkeypatch.setattr(
        muni_data,
        "async_response_refresh_lock",
        no_op_async_lock,
    )


def _snapshot(cache_key: str, payload, age_seconds: int = 7200) -> ResponseSnapshot:
    cached_at = datetime.utcnow() - timedelta(seconds=age_seconds)
    return ResponseSnapshot(
        cache_key=cache_key,
        payload=payload,
        cached_at=cached_at,
        age_seconds=float(age_seconds),
    )


def test_market_internals_cold_failure_is_bounded_and_explicitly_partial(
    monkeypatch,
) -> None:
    calls = {"batch": 0}

    monkeypatch.setattr(market_internals, "load_response_snapshot", lambda _key: None)
    monkeypatch.setattr(
        market_internals,
        "_fetch_exchange_universe",
        lambda: {"amex": ["AAA"], "nyse": ["BBB"], "nsdq": ["CCC"]},
    )

    def failed_batch(_symbols):
        calls["batch"] += 1
        return None

    monkeypatch.setattr(market_internals, "_download_breadth_close", failed_batch)
    monkeypatch.setattr(
        market_internals,
        "store_response_snapshot",
        lambda *_args, **_kwargs: pytest.fail("partial payload must not be cached"),
    )
    market_internals._cached_by_days.clear()

    payload = market_internals.get_market_internals_overview(days=90)

    assert calls["batch"] == 1
    assert payload["data_quality"] == {
        "status": "partial",
        "stale": False,
        "exchange_history_coverage": 0,
        "exchange_history_total": 3,
        "representative_exchange_coverage": 0,
        "representative_exchange_total": 3,
        "minimum_representative_participation_pct": 20.0,
        "cacheable": False,
        "representative": False,
        "provider_request_shape": "single_batched_breadth_download",
        "cache_ttl_seconds": 14400,
        "max_stale_age_seconds": 172800,
    }
    assert all(
        exchange["source"] == "unavailable"
        for exchange in payload["exchanges"].values()
    )


def test_market_internals_incomplete_refresh_reuses_marked_snapshot(
    monkeypatch,
) -> None:
    prior = {
        "as_of": "2026-07-28T15:00:00+00:00",
        "history": [{"date": "2026-07-28", "advancing": 100}],
        "warnings": [],
    }
    snapshot = _snapshot(
        "market-internals:overview:90",
        prior,
        age_seconds=20_000,
    )
    monkeypatch.setattr(
        market_internals,
        "load_response_snapshot",
        lambda _key: snapshot,
    )
    monkeypatch.setattr(
        market_internals,
        "_fetch_exchange_universe",
        lambda: {"amex": [], "nyse": [], "nsdq": []},
    )
    monkeypatch.setattr(
        market_internals,
        "_download_breadth_close",
        lambda _symbols: None,
    )
    market_internals._cached_by_days.clear()

    payload = market_internals.get_market_internals_overview(days=90)

    assert payload["history"] == prior["history"]
    assert payload["data_quality"]["status"] == "stale"
    assert payload["data_quality"]["reason"] == "breadth_refresh_incomplete"
    assert payload["data_quality"]["snapshot_ttl_seconds"] == 14400
    assert payload["data_quality"]["snapshot_max_stale_age_seconds"] == 172800
    assert payload["warnings"] == [
        "Live refresh failed; showing the last-known-good snapshot."
    ]


def test_market_internals_sparse_histories_are_cacheable_but_not_complete(
    monkeypatch,
) -> None:
    stored = []
    monkeypatch.setattr(market_internals, "load_response_snapshot", lambda _key: None)
    monkeypatch.setattr(
        market_internals,
        "_fetch_exchange_universe",
        lambda: {
            "amex": [f"A{index}" for index in range(1000)],
            "nyse": [f"N{index}" for index in range(1000)],
            "nsdq": [f"Q{index}" for index in range(1000)],
        },
    )
    monkeypatch.setattr(
        market_internals,
        "_download_breadth_close",
        lambda _symbols: object(),
    )

    def sparse_bucket(_key, label, _days, universe_size, close_frame):
        assert close_frame is not None
        snapshot = {
            "advancing": 10,
            "declining": 5,
            "advancing_pct": 66.7,
            "declining_pct": 33.3,
            "ad_rate": 5.0,
            "volume_advancing": 100.0,
            "volume_declining": 50.0,
            "volume_advancing_pct": 66.7,
            "volume_declining_pct": 33.3,
            "new_highs": 2,
            "new_lows": 1,
            "new_highs_pct": 66.7,
            "new_lows_pct": 33.3,
            "participation_pct": 1.5,
        }
        return {
            "label": label,
            **snapshot,
            "universe_size": universe_size,
            "history": [{"date": "2026-07-28", **snapshot}],
            "source": "breadth-symbols",
        }

    monkeypatch.setattr(
        market_internals,
        "_build_bucket_from_breadth_symbols",
        sparse_bucket,
    )
    monkeypatch.setattr(
        market_internals,
        "store_response_snapshot",
        lambda key, payload, **_kwargs: stored.append((key, payload)),
    )
    market_internals._cached_by_days.clear()

    payload = market_internals.get_market_internals_overview(days=90)

    assert payload["history"]
    assert payload["data_quality"]["cacheable"] is True
    assert payload["data_quality"]["representative"] is False
    assert payload["data_quality"]["status"] == "partial"
    assert payload["data_quality"]["representative_exchange_coverage"] == 0
    assert len(stored) == 1
    assert stored[0][1]["data_quality"]["status"] == "partial"


def test_market_internals_degraded_refresh_retains_better_snapshot(
    monkeypatch,
) -> None:
    def bucket(label: str, source: str, participation: float, history_days: int):
        latest = {
            "advancing": 500,
            "declining": 300,
            "advancing_pct": 62.5,
            "declining_pct": 37.5,
            "ad_rate": 200.0,
            "volume_advancing": 1000.0,
            "volume_declining": 600.0,
            "volume_advancing_pct": 62.5,
            "volume_declining_pct": 37.5,
            "new_highs": 20,
            "new_lows": 10,
            "new_highs_pct": 66.7,
            "new_lows_pct": 33.3,
            "participation_pct": participation,
        }
        return {
            "label": label,
            **latest,
            "universe_size": 1000,
            "history": [
                {"date": f"2026-07-{index + 1:02d}", **latest}
                for index in range(history_days)
            ],
            "source": source,
        }

    prior = {
        "as_of": "2026-07-28T15:00:00+00:00",
        "exchanges": {
            "amex": bucket("AMEX", "exchange-universe-full", 80.0, 10),
            "nsdq": bucket("NSDQ", "exchange-universe-full", 75.0, 10),
            "nyse": bucket("NYSE", "exchange-universe-full", 70.0, 10),
        },
        "history": [{"date": "2026-07-28", "advancing": 1500}],
        "warnings": [],
        "data_quality": {
            "status": "complete",
            "representative_exchange_coverage": 3,
        },
    }
    snapshot = _snapshot(
        "market-internals:overview:90",
        prior,
        age_seconds=20_000,
    )
    monkeypatch.setattr(
        market_internals,
        "load_response_snapshot",
        lambda _key: snapshot,
    )
    monkeypatch.setattr(
        market_internals,
        "_fetch_exchange_universe",
        lambda: {
            "amex": [f"A{index}" for index in range(1000)],
            "nyse": [f"N{index}" for index in range(1000)],
            "nsdq": [f"Q{index}" for index in range(1000)],
        },
    )
    monkeypatch.setattr(
        market_internals,
        "_download_breadth_close",
        lambda _symbols: object(),
    )

    def sparse_bucket(_key, label, _days, universe_size, close_frame):
        assert close_frame is not None
        result = bucket(label, "breadth-symbols", 1.5, 1)
        result["universe_size"] = universe_size
        return result

    monkeypatch.setattr(
        market_internals,
        "_build_bucket_from_breadth_symbols",
        sparse_bucket,
    )
    monkeypatch.setattr(
        market_internals,
        "store_response_snapshot",
        lambda *_args, **_kwargs: pytest.fail(
            "degraded breadth must not overwrite a better snapshot"
        ),
    )
    market_internals._cached_by_days.clear()

    payload = market_internals.get_market_internals_overview(days=90)

    assert payload["history"] == prior["history"]
    assert payload["data_quality"]["status"] == "stale"
    assert payload["data_quality"]["reason"] == "breadth_refresh_degraded"
    assert (
        payload["exchanges"]["nyse"]["source"]
        == "exchange-universe-full"
    )


def test_analyst_components_use_stored_vix_when_yahoo_is_rate_limited(
    monkeypatch,
) -> None:
    from app.services.ingestion import fred_client, yahoo_client

    start = datetime.utcnow().date() - timedelta(days=1000)
    dates = [(start + timedelta(days=index)).isoformat() for index in range(1000)]

    class FakeYahooClient:
        def fetch_series(self, symbol: str, start_date: str):
            if symbol == "^VIX":
                raise RuntimeError("429 rate limited")
            return []

    class FakeFredClient:
        async def fetch_series(self, series_id: str, start_date: str):
            base = {
                "BAMLH0A0HYM2": 3.0,
                "DGS10": 4.0,
                "BAMLC0A4CBBB": 5.0,
            }[series_id]
            return [
                {"date": date, "value": base + index * 0.001}
                for index, date in enumerate(dates)
            ]

    stored_vix = [
        {"date": date, "value": 15.0 + index * 0.005}
        for index, date in enumerate(dates)
    ]
    monkeypatch.setattr(yahoo_client, "YahooClient", FakeYahooClient)
    monkeypatch.setattr(fred_client, "FredClient", FakeFredClient)
    monkeypatch.setattr(
        indicators,
        "_stored_indicator_raw_series",
        lambda code, _start: stored_vix if code == "VIX" else [],
    )

    result = asyncio.run(
        indicators._build_analyst_anxiety_components(days=365)
    )

    assert result
    assert result[-1]["vix"]["source"] == "stored_indicator_history"
    assert result[-1]["data_quality"]["status"] == "partial"
    assert result[-1]["data_quality"]["reason"] == "live_vix_provider_unavailable"


def test_analyst_component_failure_reuses_stale_list_contract(monkeypatch) -> None:
    prior = [{"date": "2026-07-28", "vix": {"value": 18.0}}]
    snapshot = _snapshot(
        "indicator-components:analyst-confidence:365",
        prior,
        age_seconds=20_000,
    )
    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: snapshot)

    async def failed_builder(_days):
        raise RuntimeError("providers unavailable")

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        failed_builder,
    )

    result = asyncio.run(indicators.get_analyst_anxiety_components(days=365))

    assert isinstance(result, list)
    assert result[0]["vix"]["value"] == 18.0
    assert result[0]["data_quality"]["status"] == "stale"
    assert result[0]["data_quality"]["reason"] == "analyst_component_refresh_failed"


def test_analyst_empty_cold_response_is_not_persisted(monkeypatch) -> None:
    stored = []
    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: None)

    async def empty_builder(_days):
        return []

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        empty_builder,
    )
    monkeypatch.setattr(
        indicators,
        "store_response_snapshot",
        lambda *args, **kwargs: stored.append((args, kwargs)),
    )

    result = asyncio.run(indicators.get_analyst_anxiety_components(days=365))

    assert result == []
    assert stored == []


def test_analyst_equal_quality_partial_refresh_advances_snapshot(
    monkeypatch,
) -> None:
    prior = [
        {
            "date": "2026-07-27",
            "data_quality": {"status": "partial"},
            "vix": {"value": 18.0, "source": "stored_indicator_history"},
            "hy_oas": {"value": 3.0},
            "composite": {"stability_score": 55.0},
        }
    ]
    refreshed = [
        {
            "date": "2026-07-28",
            "data_quality": {"status": "partial"},
            "vix": {"value": 17.5, "source": "stored_indicator_history"},
            "hy_oas": {"value": 2.9},
            "composite": {"stability_score": 58.0},
        }
    ]
    snapshot = _snapshot(
        "indicator-components:analyst-confidence:365",
        prior,
        age_seconds=20_000,
    )
    stored = []
    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: snapshot)

    async def refreshed_builder(_days):
        return refreshed

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        refreshed_builder,
    )
    monkeypatch.setattr(
        indicators,
        "store_response_snapshot",
        lambda key, payload: stored.append((key, payload)),
    )

    result = asyncio.run(indicators.get_analyst_anxiety_components(days=365))

    assert result == refreshed
    assert stored == [
        ("indicator-components:analyst-confidence:365", refreshed)
    ]


def test_analyst_lower_quality_refresh_retains_materially_better_snapshot(
    monkeypatch,
) -> None:
    prior = [
        {
            "date": "2026-07-27",
            "data_quality": {"status": "complete"},
            "vix": {"value": 18.0, "source": "yahoo_live"},
            "hy_oas": {"value": 3.0},
            "move": {"value": 95.0},
            "erp_proxy": {"spread": 1.0},
            "composite": {"stability_score": 55.0},
        }
    ]
    degraded = [
        {
            "date": "2026-07-28",
            "data_quality": {"status": "partial"},
            "vix": {"value": 17.5, "source": "stored_indicator_history"},
            "hy_oas": {"value": 2.9},
            "composite": {"stability_score": 58.0},
        }
    ]
    snapshot = _snapshot(
        "indicator-components:analyst-confidence:365",
        prior,
        age_seconds=20_000,
    )
    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: snapshot)

    async def degraded_builder(_days):
        return degraded

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        degraded_builder,
    )
    monkeypatch.setattr(
        indicators,
        "store_response_snapshot",
        lambda *_args, **_kwargs: pytest.fail(
            "lower-quality Analyst evidence must not overwrite the prior"
        ),
    )

    result = asyncio.run(indicators.get_analyst_anxiety_components(days=365))

    assert result[0]["date"] == "2026-07-27"
    assert result[0]["data_quality"]["status"] == "stale"
    assert (
        result[0]["data_quality"]["reason"]
        == "analyst_component_refresh_lower_quality"
    )


def test_analyst_singleflight_rechecks_shared_snapshot(monkeypatch) -> None:
    fresh = _snapshot(
        "indicator-components:analyst-confidence:365",
        [{"date": "2026-07-28", "vix": {"value": 18.0}}],
        age_seconds=30,
    )
    snapshots = iter([None, fresh])
    monkeypatch.setattr(
        indicators,
        "load_response_snapshot",
        lambda _key: next(snapshots),
    )

    async def must_not_build(_days):
        pytest.fail("the lock winner's fresh Analyst snapshot must be reused")

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        must_not_build,
    )

    result = asyncio.run(indicators.get_analyst_anxiety_components(days=365))

    assert result == fresh.payload


def test_analyst_component_snapshot_older_than_limit_is_not_reused(
    monkeypatch,
) -> None:
    snapshot = _snapshot(
        "indicator-components:analyst-confidence:365",
        [{"date": "2026-07-01", "vix": {"value": 18.0}}],
        age_seconds=8 * 24 * 60 * 60,
    )
    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: snapshot)

    async def failed_builder(_days):
        raise RuntimeError("providers unavailable")

    monkeypatch.setattr(
        indicators,
        "_build_analyst_anxiety_components",
        failed_builder,
    )

    with pytest.raises(RuntimeError, match="providers unavailable"):
        asyncio.run(indicators.get_analyst_anxiety_components(days=365))


def test_public_credit_failure_reuses_stale_snapshot(monkeypatch) -> None:
    prior = {
        "composite": {
            "coverage_live": 4,
            "coverage_total": 4,
            "score": 62.0,
        },
        "warnings": [],
    }
    snapshot = _snapshot(
        "indicator-components:public-credit:730",
        prior,
        age_seconds=30_000,
    )
    monkeypatch.setattr(muni_data, "load_response_snapshot", lambda _key: snapshot)

    async def failed_builder(days: int):
        raise RuntimeError(f"failed for {days}")

    monkeypatch.setattr(muni_data, "_build_muni_subsystem", failed_builder)

    result = asyncio.run(muni_data.get_muni_subsystem(days=730))

    assert result["composite"]["score"] == 62.0
    assert result["data_quality"]["status"] == "stale"
    assert result["data_quality"]["reason"] == "public_credit_refresh_failed"


def test_public_credit_singleflight_rechecks_shared_snapshot(monkeypatch) -> None:
    fresh = _snapshot(
        "indicator-components:public-credit:730",
        {
            "composite": {
                "coverage_live": 4,
                "coverage_total": 4,
                "score": 62.0,
            }
        },
        age_seconds=30,
    )
    snapshots = iter([None, fresh])
    monkeypatch.setattr(
        muni_data,
        "load_response_snapshot",
        lambda _key: next(snapshots),
    )

    async def must_not_build(days: int):
        pytest.fail(
            f"the lock winner's fresh public-credit snapshot must be reused: {days}"
        )

    monkeypatch.setattr(muni_data, "_build_muni_subsystem", must_not_build)

    result = asyncio.run(muni_data.get_muni_subsystem(days=730))

    assert result == fresh.payload


def test_real_estate_failure_reuses_stale_snapshot(monkeypatch) -> None:
    prior = {
        "stability_score": 57.0,
        "availability": {
            "available_count": 8,
            "total_configured": 8,
            "missing_macro_series": [],
        },
        "warnings": [],
    }
    snapshot = _snapshot("real-estate:overview:365", prior)
    monkeypatch.setattr(
        real_estate_index,
        "load_response_snapshot",
        lambda _key: snapshot,
    )
    monkeypatch.setattr(
        real_estate_index,
        "_build_real_estate_index",
        lambda days: (_ for _ in ()).throw(RuntimeError(f"failed for {days}")),
    )

    result = real_estate_index.calculate_real_estate_index(days=365)

    assert result["stability_score"] == 57.0
    assert result["data_quality"]["status"] == "stale"
    assert result["data_quality"]["reason"] == "real_estate_overview_refresh_failed"
