from __future__ import annotations

import logging
import sys
import threading
import types

from app.services.market_data import factory
from app.services.market_data import ibkr_cli_provider as ibkr_provider_module
from app.services.market_data.ibkr_cli_provider import IbkrCliProvider, TtlCache


class _StubProvider:
    name = "stub"


def test_factory_reuses_provider_instance_and_can_reset(monkeypatch) -> None:
    constructed = 0

    class StubYahoo(_StubProvider):
        name = "yahoo"

        def __init__(self) -> None:
            nonlocal constructed
            constructed += 1

    factory.reset_market_data_provider_cache()
    monkeypatch.setattr(factory, "YahooProvider", StubYahoo)

    first = factory.get_market_data_provider("yahoo")
    second = factory.get_market_data_provider("yahoo")
    assert second is first
    assert constructed == 1

    factory.reset_market_data_provider_cache()
    third = factory.get_market_data_provider("yahoo")
    assert third is not first
    assert constructed == 2


def test_factory_rebuilds_ibkr_provider_when_environment_changes(monkeypatch) -> None:
    constructed: list[str | None] = []

    class StubIbkr(_StubProvider):
        name = "ibkr"

        def __init__(self) -> None:
            constructed.append(factory.os.getenv("IBKR_TIMEOUT_SECONDS"))

    factory.reset_market_data_provider_cache()
    monkeypatch.setattr(factory, "IbkrCliProvider", StubIbkr)
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "ibkr")
    monkeypatch.delenv("MARKET_DATA_FALLBACK_PROVIDER", raising=False)
    monkeypatch.setenv("IBKR_TIMEOUT_SECONDS", "5")

    first = factory.get_market_data_provider()
    assert factory.get_market_data_provider() is first

    monkeypatch.setenv("IBKR_TIMEOUT_SECONDS", "7")
    second = factory.get_market_data_provider()
    assert second is not first
    assert constructed == ["5", "7"]

    factory.reset_market_data_provider_cache()


def test_fallback_warning_message_contains_operational_context(monkeypatch, caplog) -> None:
    class Primary(_StubProvider):
        name = "ibkr"

        def quote(self, _symbol):
            raise RuntimeError("rate limited")

    class Fallback(_StubProvider):
        name = "yahoo"

        def quote(self, _symbol):
            return "fallback quote"

    monkeypatch.setenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60")
    provider = factory.FallbackMarketDataProvider(Primary(), Fallback())

    with caplog.at_level(logging.WARNING):
        assert provider.quote("SPY") == "fallback quote"

    message = caplog.messages[-1]
    assert "primary=ibkr" in message
    assert "fallback=yahoo" in message
    assert "method=quote" in message
    assert "reason=exception" in message


def test_fallback_source_attribution_is_request_thread_local() -> None:
    provider = factory.FallbackMarketDataProvider(_StubProvider(), _StubProvider())
    barrier = threading.Barrier(2)

    def set_and_read(source: str) -> str:
        provider._set_source("historical_bars", source)
        barrier.wait(timeout=2)
        return provider.source_for("historical_bars")

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as executor:
        ibkr = executor.submit(set_and_read, "ibkr")
        yahoo = executor.submit(set_and_read, "yahoo")
        assert {ibkr.result(timeout=2), yahoo.result(timeout=2)} == {"ibkr", "yahoo"}


def test_fallback_cooldown_is_scoped_to_the_failing_method(monkeypatch) -> None:
    now = [0.0]
    monkeypatch.setattr(factory.time, "monotonic", lambda: now[0])
    monkeypatch.setenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60")

    class Primary(_StubProvider):
        name = "ibkr"

        def __init__(self) -> None:
            self.history_calls = 0
            self.quote_calls = 0
            self.expiration_calls = 0

        def historical_bars(self, _symbol, _timeframe, bars=500):
            self.history_calls += 1
            raise TimeoutError("historical pacing limit")

        def quote(self, _symbol):
            self.quote_calls += 1
            return "ibkr quote"

        def option_expirations(self, _symbol):
            self.expiration_calls += 1
            return ["2026-09-18"]

    class Fallback(_StubProvider):
        name = "yahoo"

        def __init__(self) -> None:
            self.history_calls = 0

        def historical_bars(self, _symbol, _timeframe, bars=500):
            self.history_calls += 1
            return "yahoo history"

    primary = Primary()
    fallback = Fallback()
    provider = factory.FallbackMarketDataProvider(primary, fallback)

    assert provider.historical_bars("SPY", "1m") == "yahoo history"
    now[0] = 1.0
    assert provider.historical_bars("SPY", "1m") == "yahoo history"
    assert primary.history_calls == 1
    assert fallback.history_calls == 2

    assert provider.quote("SPY") == "ibkr quote"
    assert provider.option_expirations("SPY") == ["2026-09-18"]
    assert primary.quote_calls == 1
    assert primary.expiration_calls == 1


def test_fallback_forwards_force_refresh_and_tolerates_legacy_providers() -> None:
    class ForceAware(_StubProvider):
        name = "ibkr"

        def __init__(self) -> None:
            self.force_refresh_values: list[bool] = []
            self.daily_force_refresh_values: list[bool] = []

        def historical_bars(self, _symbol, _timeframe, bars=500, *, force_refresh=False):
            self.force_refresh_values.append(force_refresh)
            return "fresh history"

        def daily_bars(self, _symbol, days=365, *, force_refresh=False):
            self.daily_force_refresh_values.append(force_refresh)
            return "fresh daily history"

    force_aware = ForceAware()
    provider = factory.FallbackMarketDataProvider(force_aware, _StubProvider())
    assert provider.historical_bars("SPY", "1m", force_refresh=True) == "fresh history"
    assert provider.daily_bars("SPY", force_refresh=True) == "fresh daily history"
    assert force_aware.force_refresh_values == [True]
    assert force_aware.daily_force_refresh_values == [True]

    class Legacy(_StubProvider):
        name = "ibkr"

        def historical_bars(self, _symbol, _timeframe, bars=500):
            return "legacy history"

    legacy_provider = factory.FallbackMarketDataProvider(Legacy(), _StubProvider())
    assert legacy_provider.historical_bars("SPY", "1m", force_refresh=True) == "legacy history"


def test_ibkr_force_refresh_bypasses_daily_and_historical_memory_cache(monkeypatch) -> None:
    from app.services import market_data_capture

    provider = object.__new__(IbkrCliProvider)
    provider.profile = object()
    provider.exchange = "SMART"
    provider.currency = "USD"
    provider.timeout = 1.0
    provider.bars_ttl = 300.0
    provider._cache = TtlCache()
    provider._symbol_cache = {}
    provider._call_with_symbol = lambda symbol, fetcher: fetcher(symbol)

    calls = 0

    def get_historical_bars(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        price = float(100 + calls)
        return {
            "rows": [
                {
                    "date": "2026-07-24 09:30:00",
                    "open": price,
                    "high": price,
                    "low": price,
                    "close": price,
                    "volume": 1_000,
                }
            ]
        }

    ibkr_package = types.ModuleType("ibkr_cli")
    ibkr_package.__path__ = []
    ib_service = types.ModuleType("ibkr_cli.ib_service")
    ib_service.get_historical_bars = get_historical_bars
    monkeypatch.setitem(sys.modules, "ibkr_cli", ibkr_package)
    monkeypatch.setitem(sys.modules, "ibkr_cli.ib_service", ib_service)
    monkeypatch.setattr(market_data_capture, "record_daily_bars", lambda **_kwargs: None)

    daily_first = provider.daily_bars("SPY", days=1)
    daily_cached = provider.daily_bars("SPY", days=1)
    daily_fresh = provider.daily_bars("SPY", days=1, force_refresh=True)
    assert daily_cached.equals(daily_first)
    assert daily_fresh.iloc[-1]["Close"] > daily_cached.iloc[-1]["Close"]

    history_first = provider.historical_bars("SPY", "1m", bars=1)
    history_cached = provider.historical_bars("SPY", "1m", bars=1)
    history_fresh = provider.historical_bars("SPY", "1m", bars=1, force_refresh=True)
    assert history_cached.equals(history_first)
    assert history_fresh.iloc[-1]["Close"] > history_cached.iloc[-1]["Close"]
    assert calls == 4


def test_ibkr_ttl_cache_get_and_set_are_safe_across_threads() -> None:
    from concurrent.futures import ThreadPoolExecutor

    cache = TtlCache()

    def write_and_read(index: int) -> int:
        key = ("bars", index % 4)
        cache.set(key, index, ttl_seconds=60)
        value = cache.get(key)
        assert isinstance(value, int)
        return value

    with ThreadPoolExecutor(max_workers=8) as executor:
        values = list(executor.map(write_and_read, range(100)))

    assert len(values) == 100


def test_ibkr_ttl_cache_is_bounded_and_uses_lru_eviction() -> None:
    cache = TtlCache(max_entries=3)
    cache.set(("item", 1), "one", ttl_seconds=60)
    cache.set(("item", 2), "two", ttl_seconds=60)
    cache.set(("item", 3), "three", ttl_seconds=60)
    assert cache.get(("item", 1)) == "one"

    cache.set(("item", 4), "four", ttl_seconds=60)

    assert len(cache) == 3
    assert cache.get(("item", 2)) is None
    assert cache.get(("item", 1)) == "one"
    assert cache.get(("item", 4)) == "four"


def test_ibkr_ttl_cache_opportunistically_sweeps_expired_keys(monkeypatch) -> None:
    now = [100.0]
    monkeypatch.setattr(ibkr_provider_module.time, "time", lambda: now[0])
    cache = TtlCache(max_entries=3)
    cache.set(("expired",), "old", ttl_seconds=5)
    now[0] = 106.0

    cache.set(("current",), "new", ttl_seconds=60)

    assert len(cache) == 1
    assert cache.get(("expired",)) is None
    assert cache.get(("current",)) == "new"
