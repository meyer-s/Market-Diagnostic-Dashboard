from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from app.services import market_weather_analysis_cache as cache_module
from app.services.market_weather_analysis_cache import MarketWeatherAnalysisCache


def test_cache_returns_isolated_values_and_expires() -> None:
    now = [100.0]
    calls = 0
    cache: MarketWeatherAnalysisCache[dict[str, list[int]]] = MarketWeatherAnalysisCache(
        max_entries=2,
        ttl_seconds=10,
        clock=lambda: now[0],
    )

    def compute() -> dict[str, list[int]]:
        nonlocal calls
        calls += 1
        return {"values": [calls]}

    first = cache.get_or_compute(("SPY", "1D"), compute)
    assert first.status == "miss"
    assert first.retained is True
    first.value["values"].append(99)

    second = cache.get_or_compute(("SPY", "1D"), compute)
    assert second.status == "hit"
    assert second.retained is True
    assert second.value == {"values": [1]}
    second.value["values"].append(88)

    third = cache.get_or_compute(("SPY", "1D"), compute)
    assert third.value == {"values": [1]}
    assert calls == 1

    now[0] = 110.0
    expired = cache.get_or_compute(("SPY", "1D"), compute)
    assert expired.status == "miss"
    assert expired.value == {"values": [2]}
    assert calls == 2


def test_cache_evicts_the_least_recently_used_entry() -> None:
    cache: MarketWeatherAnalysisCache[str] = MarketWeatherAnalysisCache(
        max_entries=2,
        ttl_seconds=60,
    )

    assert cache.get_or_compute("a", lambda: "a1").status == "miss"
    assert cache.get_or_compute("b", lambda: "b1").status == "miss"
    assert cache.get_or_compute("a", lambda: "unused").status == "hit"
    assert cache.get_or_compute("c", lambda: "c1").status == "miss"
    assert cache.get_or_compute("b", lambda: "b2").value == "b2"


def test_cache_coalesces_concurrent_computations() -> None:
    cache: MarketWeatherAnalysisCache[dict[str, list[int]]] = MarketWeatherAnalysisCache(
        max_entries=2,
        ttl_seconds=60,
    )
    compute_started = threading.Event()
    release_compute = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def compute() -> dict[str, list[int]]:
        nonlocal calls
        with calls_lock:
            calls += 1
        compute_started.set()
        assert release_compute.wait(timeout=2)
        return {"values": [1]}

    with ThreadPoolExecutor(max_workers=5) as executor:
        owner = executor.submit(cache.get_or_compute, "same-key", compute)
        assert compute_started.wait(timeout=2)
        waiters = [
            executor.submit(cache.get_or_compute, "same-key", compute)
            for _ in range(4)
        ]
        deadline = time.monotonic() + 2
        while cache.stats().waits < 4 and time.monotonic() < deadline:
            time.sleep(0.005)
        release_compute.set()
        results = [owner.result(timeout=2), *(future.result(timeout=2) for future in waiters)]

    assert calls == 1
    assert sorted(result.status for result in results) == ["miss", "wait", "wait", "wait", "wait"]
    assert all(result.retained is True for result in results)
    results[0].value["values"].append(2)
    assert all(result.value == {"values": [1]} for result in results[1:])
    assert cache.stats().in_flight == 0


def test_cache_does_not_retain_exceptions() -> None:
    cache: MarketWeatherAnalysisCache[str] = MarketWeatherAnalysisCache(
        max_entries=2,
        ttl_seconds=60,
    )
    calls = 0

    def fail() -> str:
        nonlocal calls
        calls += 1
        raise ValueError("provider unavailable")

    with pytest.raises(ValueError, match="provider unavailable"):
        cache.get_or_compute("SPY", fail)

    recovered = cache.get_or_compute("SPY", lambda: "ok")
    assert recovered.status == "miss"
    assert recovered.value == "ok"
    assert calls == 1


def test_concurrent_exception_is_shared_but_next_call_retries() -> None:
    cache: MarketWeatherAnalysisCache[str] = MarketWeatherAnalysisCache(
        max_entries=2,
        ttl_seconds=60,
    )
    compute_started = threading.Event()
    release_compute = threading.Event()
    calls = 0

    def fail() -> str:
        nonlocal calls
        calls += 1
        compute_started.set()
        assert release_compute.wait(timeout=2)
        raise RuntimeError("temporary limit")

    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(cache.get_or_compute, "SPY", fail)
        assert compute_started.wait(timeout=2)
        waiter = executor.submit(cache.get_or_compute, "SPY", fail)
        deadline = time.monotonic() + 2
        while cache.stats().waits < 1 and time.monotonic() < deadline:
            time.sleep(0.005)
        release_compute.set()
        with pytest.raises(RuntimeError, match="temporary limit"):
            owner.result(timeout=2)
        with pytest.raises(RuntimeError, match="temporary limit"):
            waiter.result(timeout=2)

    assert calls == 1
    assert cache.stats().size == 0
    assert cache.get_or_compute("SPY", lambda: "recovered").value == "recovered"


def test_retain_false_avoids_copy_without_waiters(monkeypatch) -> None:
    cache: MarketWeatherAnalysisCache[dict[str, list[int]]] = MarketWeatherAnalysisCache(
        max_entries=1,
        ttl_seconds=120,
    )
    real_deepcopy = cache_module.copy.deepcopy
    copies = 0

    def tracking_deepcopy(value):
        nonlocal copies
        copies += 1
        return real_deepcopy(value)

    monkeypatch.setattr(cache_module.copy, "deepcopy", tracking_deepcopy)
    first = cache.get_or_compute(
        "oversized",
        lambda: {"values": [1]},
        retain=False,
    )
    second = cache.get_or_compute(
        "oversized",
        lambda: {"values": [2]},
        retain=False,
    )

    assert first == cache_module.AnalysisCacheResult(
        value={"values": [1]},
        status="miss",
        retained=False,
    )
    assert second.value == {"values": [2]}
    assert second.status == "miss"
    assert second.retained is False
    assert copies == 0
    assert cache.stats().size == 0


def test_retain_false_still_isolates_concurrent_waiters() -> None:
    cache: MarketWeatherAnalysisCache[dict[str, list[int]]] = MarketWeatherAnalysisCache(
        max_entries=1,
        ttl_seconds=120,
    )
    compute_started = threading.Event()
    release_compute = threading.Event()

    def compute() -> dict[str, list[int]]:
        compute_started.set()
        assert release_compute.wait(timeout=2)
        return {"values": [1]}

    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(cache.get_or_compute, "large", compute, retain=False)
        assert compute_started.wait(timeout=2)
        waiter = executor.submit(cache.get_or_compute, "large", compute, retain=False)
        deadline = time.monotonic() + 2
        while cache.stats().waits < 1 and time.monotonic() < deadline:
            time.sleep(0.005)
        release_compute.set()
        owner_result = owner.result(timeout=2)
        waiter_result = waiter.result(timeout=2)

    owner_result.value["values"].append(2)
    assert waiter_result.value == {"values": [1]}
    assert owner_result.retained is False
    assert waiter_result.retained is False
    assert cache.stats().size == 0


def test_retaining_waiter_can_retain_a_nonretaining_inflight_request() -> None:
    cache: MarketWeatherAnalysisCache[dict[str, list[int]]] = MarketWeatherAnalysisCache(
        max_entries=1,
        ttl_seconds=120,
    )
    compute_started = threading.Event()
    release_compute = threading.Event()

    def compute() -> dict[str, list[int]]:
        compute_started.set()
        assert release_compute.wait(timeout=2)
        return {"values": [1]}

    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(cache.get_or_compute, "shared", compute, retain=False)
        assert compute_started.wait(timeout=2)
        waiter = executor.submit(
            cache.get_or_compute,
            "shared",
            compute,
            retain=True,
            ttl_seconds=60,
        )
        deadline = time.monotonic() + 2
        while cache.stats().waits < 1 and time.monotonic() < deadline:
            time.sleep(0.005)
        release_compute.set()
        owner_result = owner.result(timeout=2)
        waiter_result = waiter.result(timeout=2)

    assert owner_result.retained is True
    assert waiter_result.retained is True
    assert cache.get_or_compute("shared", lambda: {"values": [2]}).status == "hit"


def test_per_call_ttl_is_bounded_by_global_ttl() -> None:
    now = [0.0]
    cache: MarketWeatherAnalysisCache[str] = MarketWeatherAnalysisCache(
        max_entries=1,
        ttl_seconds=120,
        clock=lambda: now[0],
    )
    calls = 0

    def compute() -> str:
        nonlocal calls
        calls += 1
        return f"value-{calls}"

    first = cache.get_or_compute("SPY-1m", compute, ttl_seconds=60)
    now[0] = 59.9
    assert cache.get_or_compute("SPY-1m", compute, ttl_seconds=60).status == "hit"
    now[0] = 60.0
    expired = cache.get_or_compute("SPY-1m", compute, ttl_seconds=60)

    assert first.retained is True
    assert expired.status == "miss"
    assert expired.value == "value-2"
    assert calls == 2


def test_shared_cache_reloads_when_environment_changes(monkeypatch) -> None:
    cache_module.reset_market_weather_analysis_cache()
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "1")
    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_TTL_SECONDS", "30")
    first = cache_module.get_market_weather_analysis_cache()
    assert first.max_entries == 1
    assert first.ttl_seconds == 30

    monkeypatch.setenv("MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES", "3")
    second = cache_module.get_market_weather_analysis_cache()
    assert second is not first
    assert second.max_entries == 3

    cache_module.reset_market_weather_analysis_cache()
