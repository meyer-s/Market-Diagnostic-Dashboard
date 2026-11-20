import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import crypto
from app.core.db import Base
from app.models.alternative_assets import AASComponentV2, AASIndicator, CryptoPrice


NOW = datetime(2026, 11, 20, 15)


@pytest.fixture
def database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    @contextmanager
    def session():
        yield db
    monkeypatch.setattr(crypto, "get_db_session", session)
    monkeypatch.setattr(crypto, "_now", lambda: NOW)
    crypto._market_overview_cache.clear()
    crypto._market_overview_inflight.clear()
    crypto._market_overview_retry_after.clear()
    yield db
    db.close()
    engine.dispose()


def test_daily_history_keeps_newest_duplicate_and_calendar_window(database):
    for day in range(31):
        for hour in (0, 4, 8, 12):
            database.add(CryptoPrice(date=NOW.replace(hour=hour) - timedelta(days=day), btc_usd=100 + hour, source="test"))
    database.commit()
    rows = crypto._get_market_structure_history(30)
    result = crypto._build_db_fallback_market_overview(30)
    assert len(rows) == 31
    assert len({row["date"] for row in rows}) == 31
    assert result["assets"][0]["current_price"] == 112


def test_fallback_missing_yesterday_is_unknown_not_previous_row_change(database):
    database.add_all([
        CryptoPrice(date=NOW.replace(hour=0), btc_usd=200),
        CryptoPrice(date=NOW.replace(hour=0) - timedelta(days=2), btc_usd=100),
    ])
    database.commit()
    result = crypto._build_db_fallback_market_overview(30)
    assert result["assets"][0]["change_24h"] is None
    assert result["summary"]["advancing_assets_24h"] is None
    assert result["summary"]["change_24h_available_assets"] == 0
    assert result["as_of"] == "2026-11-20T00:00:00Z"
    assert result["generated_at"] == "2026-11-20T15:00:00Z"


def test_thirty_day_return_uses_calendar_not_31_rows(database):
    for day in range(31):
        if day != 7:
            database.add(CryptoPrice(date=NOW.replace(hour=0) - timedelta(days=day), btc_usd=200 if day == 0 else 100))
    database.commit()
    result = crypto._build_db_fallback_market_overview(30)
    assert result["assets"][0]["change_30d"] == 100
    assert result["assets"][1]["current_price"] is None


def test_daily_key_does_not_turn_a_39_hour_comparison_into_24h(database):
    database.add_all([
        CryptoPrice(date=NOW.replace(hour=0), btc_usd=200, source="COINGECKO_LIVE|2026-11-20T15:00:00Z"),
        CryptoPrice(date=NOW.replace(hour=0) - timedelta(days=1), btc_usd=100, source="CoinGecko"),
    ])
    database.commit()
    assert crypto._build_db_fallback_market_overview(30)["assets"][0]["change_24h"] is None


def test_diagnostic_dedup_units_and_no_mismatched_model_summary(database):
    date = NOW.replace(hour=0)
    database.add_all([
        AASComponentV2(date=date, stablecoin_supply=0.1, created_at=NOW-timedelta(hours=1)),
        AASComponentV2(date=date, stablecoin_supply=0.9, created_at=NOW),
        AASIndicator(date=date-timedelta(days=1), stability_score=40, pressure_index=.6, regime="test", primary_driver="old"),
    ])
    database.commit()
    result = crypto.get_crypto_diagnostic_context(30)
    assert result["current_signals"]["stablecoin_supply"] == .9
    assert result["signal_history"][0]["stablecoin_supply"] == .9
    assert result["signal_kind"] == "normalized_model_pressure"
    assert result["summary"]["primary_driver"] is None
    assert result["model_dates_aligned"] is False
    assert result["data_quality"]["status"] == "partial"


def test_cache_isolated_bounded_and_max_two_hours(monkeypatch):
    crypto._market_overview_cache.clear()
    clock = [10000.]
    monkeypatch.setattr(crypto.time, "monotonic", lambda: clock[0])
    payload = {"source": "CoinGecko", "assets": [{"symbol": "BTC"}]}
    crypto._set_cached_market_overview(30, payload)
    first = crypto._get_cached_market_overview(30)
    first["assets"][0]["symbol"] = "modified"
    assert crypto._get_cached_market_overview(30)["assets"][0]["symbol"] == "BTC"
    clock[0] += 901
    assert crypto._get_cached_market_overview(30) is None
    assert crypto._get_cached_market_overview(30, True)["data_quality"]["status"] == "stale"
    clock[0] += 6300
    assert crypto._get_cached_market_overview(30, True) is None
    for days in range(30, 60):
        crypto._set_cached_market_overview(days, payload)
    assert len(crypto._market_overview_cache) == 16


def test_concurrent_visitors_share_one_refresh(database, monkeypatch):
    calls = []
    async def fetch(days):
        calls.append(days)
        await asyncio.sleep(.01)
        return {"source": "CoinGecko", "assets": []}
    monkeypatch.setattr(crypto, "_fetch_market_overview", fetch)
    async def run():
        return await asyncio.gather(*[crypto.get_crypto_market_overview(30) for _ in range(10)])
    results = asyncio.run(run())
    assert len(calls) == 1
    results[0]["assets"].append("changed")
    assert results[1]["assets"] == []


def test_provider_failure_uses_short_fallback_cache_and_backoff(database, monkeypatch):
    database.add(CryptoPrice(date=NOW.replace(hour=0), btc_usd=100))
    database.commit()
    calls = []
    async def fetch(days):
        calls.append(days)
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(crypto, "_fetch_market_overview", fetch)
    async def run():
        first = await crypto.get_crypto_market_overview(30)
        second = await crypto.get_crypto_market_overview(30)
        return first, second
    first, second = asyncio.run(run())
    assert len(calls) == 1
    assert first["source"] == "Stored daily observations"
    assert second["cache"]["ttl_seconds"] == 60


@pytest.mark.parametrize("value", [None, "invalid", float("inf"), float("nan")])
def test_nonfinite_values_are_unknown(value):
    assert crypto._safe_round(value) is None


def test_live_native_returns_dates_and_independent_history_failure(database, monkeypatch):
    captured = []
    class Client:
        def __init__(self, **kwargs):
            assert kwargs["timeout"] == 7
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params=None):
            captured.append((url, params))
            request = httpx.Request("GET", url)
            if url.endswith("/coins/markets"):
                rows = [{"id": asset["coin_id"], "current_price": 200, "last_updated": "2026-11-20T14:59:00Z",
                         "price_change_percentage_24h": -5, "price_change_percentage_30d_in_currency": -25,
                         "market_cap": 1000000, "total_volume": 40000} for asset in crypto.CRYPTO_ASSETS]
                return httpx.Response(200, request=request, json=rows)
            if url.endswith("/global"):
                return httpx.Response(200, request=request, json={"data": {"updated_at": NOW.replace(tzinfo=__import__('datetime').timezone.utc).timestamp(),
                                                                          "total_market_cap": {"usd": 1000000}, "market_cap_percentage": {"btc": 0}}})
            return httpx.Response(429, request=request, json={})
    monkeypatch.setattr(crypto.httpx, "AsyncClient", Client)
    result = asyncio.run(crypto.get_crypto_market_overview(30))
    assert result["assets"][0]["change_30d"] == -25
    assert result["assets"][0]["change_24h"] == -5
    assert result["summary"]["btc_dominance"] == 0
    assert result["observed_at"] == "2026-11-20T14:59:00Z"
    assert result["summary"]["change_24h_available_assets"] == 4
    assert len(captured) == 6
    assert captured[0][1]["price_change_percentage"] == "24h,30d"
