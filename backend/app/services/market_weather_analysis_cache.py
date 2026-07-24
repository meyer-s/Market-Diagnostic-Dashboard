from __future__ import annotations

from collections import OrderedDict
import copy
from dataclasses import dataclass
import logging
import os
import threading
import time
from typing import Callable, Generic, Hashable, Literal, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")
CacheStatus = Literal["hit", "miss", "wait"]

_DEFAULT_MAX_ENTRIES = 1
_DEFAULT_TTL_SECONDS = 120.0
_MAX_ENTRIES_ENV = "MARKET_WEATHER_ANALYSIS_CACHE_MAX_ENTRIES"
_TTL_SECONDS_ENV = "MARKET_WEATHER_ANALYSIS_CACHE_TTL_SECONDS"
_MISSING = object()


@dataclass(frozen=True)
class AnalysisCacheResult(Generic[T]):
    value: T
    status: CacheStatus
    retained: bool


@dataclass(frozen=True)
class AnalysisCacheStats:
    hits: int
    misses: int
    waits: int
    size: int
    in_flight: int


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    expires_at: float


class _Flight(Generic[T]):
    def __init__(self, *, retain: bool, ttl_seconds: float) -> None:
        self.completed = threading.Event()
        self.value: T | object = _MISSING
        self.error: BaseException | None = None
        self.waiters = 0
        self.retain_requested = retain
        self.ttl_seconds = ttl_seconds
        self.retained = False


class MarketWeatherAnalysisCache:
    """Small per-worker TTL/LRU cache with identical-request coalescing.

    Values are isolated from any retained cache copy. A retained miss stores one
    deep copy while returning the value produced by the caller. Hits and waiters
    each receive one deep copy because field payloads contain mutable nested
    dictionaries and lists. With ``retain=False``, a lone miss performs no copy;
    concurrent waiters still receive isolated values through single-flight.
    """

    def __init__(
        self,
        *,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
        ttl_seconds: float = _DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_entries = max(0, int(max_entries))
        self.ttl_seconds = max(0.0, float(ttl_seconds))
        self._clock = clock
        self._entries: OrderedDict[Hashable, _CacheEntry[T]] = OrderedDict()
        self._flights: dict[Hashable, _Flight[T]] = {}
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._waits = 0

    def get_or_compute(
        self,
        key: Hashable,
        compute: Callable[[], T],
        *,
        retain: bool = True,
        ttl_seconds: float | None = None,
    ) -> AnalysisCacheResult[T]:
        """Return a cached value or run exactly one computation for ``key``."""
        effective_ttl = self._effective_ttl(ttl_seconds)
        with self._lock:
            now = self._clock()
            self._discard_expired(now)
            entry = self._entries.get(key)
            if entry is not None:
                self._entries.move_to_end(key)
                self._hits += 1
                hit_value = entry.value
            else:
                hit_value = _MISSING

            if hit_value is _MISSING:
                flight = self._flights.get(key)
                if flight is None:
                    flight = _Flight(
                        retain=retain,
                        ttl_seconds=effective_ttl if retain else self.ttl_seconds,
                    )
                    self._flights[key] = flight
                    self._misses += 1
                    owns_flight = True
                else:
                    flight.waiters += 1
                    if retain:
                        flight.retain_requested = True
                        flight.ttl_seconds = min(flight.ttl_seconds, effective_ttl)
                    self._waits += 1
                    owns_flight = False

        if hit_value is not _MISSING:
            # The retained value is never exposed directly, so it remains safe
            # to clone after releasing the global lock even if it is evicted.
            return AnalysisCacheResult(
                value=copy.deepcopy(hit_value),
                status="hit",
                retained=True,
            )

        if not owns_flight:
            flight.completed.wait()
            if flight.error is not None:
                raise flight.error
            if flight.value is _MISSING:
                raise RuntimeError("Market Weather analysis flight completed without a value")
            return AnalysisCacheResult(
                value=copy.deepcopy(flight.value),
                status="wait",
                retained=flight.retained,
            )

        try:
            value = compute()
        except BaseException as exc:
            self._fail_flight(key, flight, exc)
            raise

        with self._lock:
            should_retain = (
                flight.retain_requested
                and self.max_entries > 0
                and flight.ttl_seconds > 0
            )
            needs_isolated_value = should_retain or flight.waiters > 0
            if not needs_isolated_value:
                self._flights.pop(key, None)
                flight.completed.set()
                return AnalysisCacheResult(value=value, status="miss", retained=False)

        try:
            isolated_value = copy.deepcopy(value)
        except BaseException as exc:
            self._fail_flight(key, flight, exc)
            raise

        with self._lock:
            # A waiter can join while the copy is being made and request
            # retention or a shorter TTL. Re-evaluate using the final policy.
            should_retain = (
                flight.retain_requested
                and self.max_entries > 0
                and flight.ttl_seconds > 0
            )
            flight.value = isolated_value
            flight.retained = should_retain
            if should_retain:
                self._entries[key] = _CacheEntry(
                    value=isolated_value,
                    expires_at=self._clock() + flight.ttl_seconds,
                )
                self._entries.move_to_end(key)
                while len(self._entries) > self.max_entries:
                    self._entries.popitem(last=False)
            self._flights.pop(key, None)
            flight.completed.set()
        return AnalysisCacheResult(value=value, status="miss", retained=should_retain)

    def clear(self) -> None:
        """Clear completed entries without interrupting active computations."""
        with self._lock:
            self._entries.clear()

    def stats(self) -> AnalysisCacheStats:
        with self._lock:
            self._discard_expired(self._clock())
            return AnalysisCacheStats(
                hits=self._hits,
                misses=self._misses,
                waits=self._waits,
                size=len(self._entries),
                in_flight=len(self._flights),
            )

    def _discard_expired(self, now: float) -> None:
        expired = [key for key, entry in self._entries.items() if entry.expires_at <= now]
        for key in expired:
            self._entries.pop(key, None)

    def _effective_ttl(self, ttl_seconds: float | None) -> float:
        if ttl_seconds is None:
            return self.ttl_seconds
        try:
            requested = max(0.0, float(ttl_seconds))
        except (TypeError, ValueError):
            raise ValueError("ttl_seconds must be a nonnegative number") from None
        return min(self.ttl_seconds, requested)

    def _fail_flight(
        self,
        key: Hashable,
        flight: _Flight[T],
        exc: BaseException,
    ) -> None:
        with self._lock:
            flight.error = exc
            self._flights.pop(key, None)
            flight.completed.set()


_shared_cache: MarketWeatherAnalysisCache[object] | None = None
_shared_cache_config: tuple[int, float] | None = None
_shared_cache_lock = threading.Lock()


def get_market_weather_analysis_cache() -> MarketWeatherAnalysisCache[object]:
    """Return the per-worker cache, rebuilding it if environment settings change."""
    global _shared_cache, _shared_cache_config

    config = (_configured_max_entries(), _configured_ttl_seconds())
    with _shared_cache_lock:
        if _shared_cache is None or _shared_cache_config != config:
            _shared_cache = MarketWeatherAnalysisCache(
                max_entries=config[0],
                ttl_seconds=config[1],
            )
            _shared_cache_config = config
        return _shared_cache


def get_or_compute_market_weather_analysis(
    key: Hashable,
    compute: Callable[[], T],
    *,
    retain: bool = True,
    ttl_seconds: float | None = None,
) -> AnalysisCacheResult[T]:
    cache = get_market_weather_analysis_cache()
    result = cache.get_or_compute(
        key,
        compute,
        retain=retain,
        ttl_seconds=ttl_seconds,
    )
    return AnalysisCacheResult(
        value=result.value,
        status=result.status,
        retained=result.retained,
    )


def reset_market_weather_analysis_cache() -> None:
    """Discard the shared cache, primarily for tests and config reloads."""
    global _shared_cache, _shared_cache_config

    with _shared_cache_lock:
        _shared_cache = None
        _shared_cache_config = None


def _configured_max_entries() -> int:
    return _read_nonnegative_int(
        _MAX_ENTRIES_ENV,
        default=_DEFAULT_MAX_ENTRIES,
    )


def _configured_ttl_seconds() -> float:
    return _read_nonnegative_float(
        _TTL_SECONDS_ENV,
        default=_DEFAULT_TTL_SECONDS,
    )


def _read_nonnegative_int(name: str, *, default: int) -> int:
    raw_value = os.getenv(name, str(default))
    try:
        return max(0, int(raw_value))
    except (TypeError, ValueError):
        logger.warning("invalid %s=%r; using %s", name, raw_value, default)
        return default


def _read_nonnegative_float(name: str, *, default: float) -> float:
    raw_value = os.getenv(name, str(default))
    try:
        return max(0.0, float(raw_value))
    except (TypeError, ValueError):
        logger.warning("invalid %s=%r; using %s", name, raw_value, default)
        return default
