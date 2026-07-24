from __future__ import annotations

import hashlib
import inspect
import logging
import os
import threading
import weakref
from collections import Counter
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterator, Literal

import pandas as pd
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.models.stock_price_bar import StockPriceBar
from app.services.stock_price_cache import _coerce_ohlcv_frame, _upsert_frame
from app.utils.db_helpers import get_db_session

logger = logging.getLogger(__name__)


_TIMEFRAME_ALIASES = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "60m": "1h",
    "2h": "2h",
    "4h": "4h",
    "1d": "1D",
    "1w": "1W",
    "1wk": "1W",
}

# These defaults are intentionally longer than a browser refresh cadence. They
# protect providers from repeated identical history requests while still
# allowing the most recent bar to advance during its trading horizon.
_DEFAULT_TTL_SECONDS = {
    "1m": 60,
    "5m": 120,
    "15m": 300,
    "30m": 600,
    "1h": 900,
    "2h": 1_800,
    "4h": 3_600,
    "1D": 21_600,
    "1W": 43_200,
}

# Provider failures may use a recent durable snapshot, but never indefinitely.
# Daily and weekly windows deliberately span weekends and ordinary holidays.
_DEFAULT_MAX_STALE_SECONDS = {
    "1m": 900,
    "5m": 3_600,
    "15m": 14_400,
    "30m": 28_800,
    "1h": 86_400,
    "2h": 172_800,
    "4h": 345_600,
    "1D": 604_800,
    "1W": 2_592_000,
}

_lock_registry_guard = threading.Lock()
_key_locks: weakref.WeakValueDictionary[tuple[str, str], threading.Lock] = (
    weakref.WeakValueDictionary()
)
_ADVISORY_LOCK_NAMESPACE = "market-weather-history-cache:v1"


CacheStatus = Literal["hit", "refreshed", "stale_fallback", "cache_bypass"]


@dataclass(frozen=True)
class MarketWeatherHistoryCacheMetadata:
    status: CacheStatus
    symbol: str
    timeframe: str
    storage_interval: str
    requested_rows: int
    minimum_rows: int
    returned_rows: int
    cached_rows_before: int
    fetched_rows: int
    inserted_rows: int
    provider_called: bool
    stale: bool
    refresh_reason: str | None
    ttl_seconds: int
    age_seconds: float | None
    last_updated_at: str | None
    data_source: str
    provider_error: str | None = None
    cache_error: str | None = None
    depth_complete: bool = True
    write_race_recovered: bool = False
    source_counts: dict[str, int] = field(default_factory=dict)
    max_stale_seconds: int | None = None

    def to_dict(self) -> dict[str, object]:
        """Return JSON-ready cache diagnostics for an API response or log."""
        return asdict(self)


@dataclass(frozen=True)
class MarketWeatherHistoryResult:
    frame: pd.DataFrame
    metadata: MarketWeatherHistoryCacheMetadata


@dataclass(frozen=True)
class _CacheSnapshot:
    frame: pd.DataFrame
    row_count: int
    last_updated_at: datetime | None
    data_source: str
    source_counts: dict[str, int]


class _CacheAdvisoryLockUnavailable(RuntimeError):
    def __init__(self, cause: SQLAlchemyError) -> None:
        super().__init__(str(cause))
        self.cause = cause


def get_or_refresh_market_weather_history(
    provider: object,
    symbol: str,
    timeframe: str,
    bars: int = 500,
    *,
    minimum_rows: int = 60,
    freshness: timedelta | None = None,
    max_stale: timedelta | None = None,
    now: datetime | None = None,
) -> MarketWeatherHistoryResult:
    """Return recent OHLCV history through a persistent read-through cache.

    A fresh cache that meets ``minimum_rows`` avoids all provider history calls.
    An ideal-depth shortfall is retried after the freshness TTL rather than on
    every browser request. On a miss, stale entry, or minimum-depth shortfall,
    the provider is called once and normalized rows are upserted into
    ``stock_price_bar``. If that refresh fails, an existing cache that meets
    ``minimum_rows`` is returned as an explicitly marked stale fallback.

    Freshness is measured from ``StockPriceBar.updated_at`` rather than the
    latest market timestamp. This is important for daily and weekly data:
    weekends and holidays do not make an otherwise recently checked cache look
    stale merely because the exchange has not printed a new bar.
    """
    normalized_symbol = _normalize_symbol(symbol)
    canonical_timeframe = canonical_market_weather_timeframe(timeframe)
    storage_interval = _storage_interval(canonical_timeframe)
    requested_rows = max(1, int(bars))
    required_rows = min(requested_rows, max(1, int(minimum_rows)))
    observed_now = _as_naive_utc(now or datetime.now(timezone.utc))
    ttl = freshness if freshness is not None else timedelta(seconds=_ttl_seconds(canonical_timeframe))
    if ttl.total_seconds() < 0:
        raise ValueError("freshness must be nonnegative")
    ttl_seconds = int(ttl.total_seconds())
    max_stale_window = (
        max_stale
        if max_stale is not None
        else timedelta(seconds=_max_stale_seconds(canonical_timeframe))
    )
    if max_stale_window.total_seconds() < 0:
        raise ValueError("max_stale must be nonnegative")
    max_stale_seconds = int(max_stale_window.total_seconds())

    lock = _lock_for(normalized_symbol, storage_interval)
    with lock:
        # Re-read after taking the per-key lock. Another request in this worker
        # may have completed the refresh while this request was waiting.
        try:
            cached = _read_latest_snapshot(normalized_symbol, storage_interval, requested_rows)
        except SQLAlchemyError as exc:
            # Persistence is an optimization, not an authority dependency. If
            # the cache database cannot be read, fetch exactly once and return
            # the provider data without attempting a write to the same failing
            # infrastructure.
            fetched, source = _fetch_history(
                provider,
                normalized_symbol,
                canonical_timeframe,
                requested_rows,
            )
            return _cache_bypass_result(
                frame=fetched,
                source=source,
                cache_error=exc,
                reason="cache_read_unavailable",
                symbol=normalized_symbol,
                timeframe=canonical_timeframe,
                storage_interval=storage_interval,
                requested_rows=requested_rows,
                minimum_rows=required_rows,
                cached_rows_before=0,
                ttl_seconds=ttl_seconds,
                max_stale_seconds=max_stale_seconds,
            )
        age_seconds = _age_seconds(observed_now, cached.last_updated_at)
        refresh_required = _refresh_required(
            cached,
            age_seconds=age_seconds,
            ttl=ttl,
            minimum_rows=required_rows,
        )
        if not refresh_required:
            # Some providers cannot reach the ideal requested depth even after
            # exhausting their paging allowance. A recently checked cache that
            # is deep enough to run the analysis is therefore authoritative
            # until its TTL expires.
            reason = "depth_retry_deferred" if cached.row_count < requested_rows else None
            return _fresh_cache_result(
                cached,
                symbol=normalized_symbol,
                timeframe=canonical_timeframe,
                storage_interval=storage_interval,
                requested_rows=requested_rows,
                minimum_rows=required_rows,
                ttl_seconds=ttl_seconds,
                max_stale_seconds=max_stale_seconds,
                age_seconds=age_seconds,
                reason=reason,
            )

        try:
            with _cross_process_refresh_lock(normalized_symbol, storage_interval):
                # The cross-process lock is acquired only on a refresh path.
                # Re-read now: another worker may have filled the durable cache
                # while this request was waiting for the advisory lock.
                try:
                    locked_cached = _read_latest_snapshot(
                        normalized_symbol,
                        storage_interval,
                        requested_rows,
                    )
                except SQLAlchemyError as exc:
                    fetched, source = _fetch_history(
                        provider,
                        normalized_symbol,
                        canonical_timeframe,
                        requested_rows,
                    )
                    return _cache_bypass_result(
                        frame=fetched,
                        source=source,
                        cache_error=exc,
                        reason="cache_locked_read_unavailable",
                        symbol=normalized_symbol,
                        timeframe=canonical_timeframe,
                        storage_interval=storage_interval,
                        requested_rows=requested_rows,
                        minimum_rows=required_rows,
                        cached_rows_before=cached.row_count,
                        ttl_seconds=ttl_seconds,
                        max_stale_seconds=max_stale_seconds,
                    )

                locked_age = _age_seconds(observed_now, locked_cached.last_updated_at)
                if not _refresh_required(
                    locked_cached,
                    age_seconds=locked_age,
                    ttl=ttl,
                    minimum_rows=required_rows,
                ):
                    return _fresh_cache_result(
                        locked_cached,
                        symbol=normalized_symbol,
                        timeframe=canonical_timeframe,
                        storage_interval=storage_interval,
                        requested_rows=requested_rows,
                        minimum_rows=required_rows,
                        ttl_seconds=ttl_seconds,
                        max_stale_seconds=max_stale_seconds,
                        age_seconds=locked_age,
                        reason="refresh_completed_by_peer",
                    )

                return _refresh_cache_under_lock(
                    provider=provider,
                    cached=locked_cached,
                    symbol=normalized_symbol,
                    timeframe=canonical_timeframe,
                    storage_interval=storage_interval,
                    requested_rows=requested_rows,
                    minimum_rows=required_rows,
                    observed_now=observed_now,
                    ttl=ttl,
                    ttl_seconds=ttl_seconds,
                    max_stale_window=max_stale_window,
                    max_stale_seconds=max_stale_seconds,
                )
        except _CacheAdvisoryLockUnavailable as exc:
            # If the database cannot establish the serialization lock, retain
            # availability through one direct provider call and avoid writing
            # into infrastructure whose coordination state is unknown.
            fetched, source = _fetch_history(
                provider,
                normalized_symbol,
                canonical_timeframe,
                requested_rows,
            )
            return _cache_bypass_result(
                frame=fetched,
                source=source,
                cache_error=exc.cause,
                reason="cache_lock_unavailable",
                symbol=normalized_symbol,
                timeframe=canonical_timeframe,
                storage_interval=storage_interval,
                requested_rows=requested_rows,
                minimum_rows=required_rows,
                cached_rows_before=cached.row_count,
                ttl_seconds=ttl_seconds,
                max_stale_seconds=max_stale_seconds,
            )


def _refresh_required(
    cached: _CacheSnapshot,
    *,
    age_seconds: float | None,
    ttl: timedelta,
    minimum_rows: int,
) -> bool:
    age_stale = age_seconds is None or age_seconds > ttl.total_seconds()
    return cached.frame.empty or age_stale or cached.row_count < minimum_rows


def _fresh_cache_result(
    cached: _CacheSnapshot,
    *,
    symbol: str,
    timeframe: str,
    storage_interval: str,
    requested_rows: int,
    minimum_rows: int,
    ttl_seconds: int,
    max_stale_seconds: int,
    age_seconds: float | None,
    reason: str | None,
) -> MarketWeatherHistoryResult:
    return MarketWeatherHistoryResult(
        frame=cached.frame.copy(),
        metadata=_metadata(
            status="hit",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=storage_interval,
            requested_rows=requested_rows,
            minimum_rows=minimum_rows,
            returned_rows=cached.row_count,
            cached_rows_before=cached.row_count,
            fetched_rows=0,
            inserted_rows=0,
            provider_called=False,
            stale=False,
            refresh_reason=reason,
            ttl_seconds=ttl_seconds,
            max_stale_seconds=max_stale_seconds,
            age_seconds=age_seconds,
            last_updated_at=cached.last_updated_at,
            data_source=cached.data_source,
            source_counts=cached.source_counts,
        ),
    )


def _refresh_cache_under_lock(
    *,
    provider: object,
    cached: _CacheSnapshot,
    symbol: str,
    timeframe: str,
    storage_interval: str,
    requested_rows: int,
    minimum_rows: int,
    observed_now: datetime,
    ttl: timedelta,
    ttl_seconds: int,
    max_stale_window: timedelta,
    max_stale_seconds: int,
) -> MarketWeatherHistoryResult:
    age_seconds = _age_seconds(observed_now, cached.last_updated_at)
    age_stale = age_seconds is None or age_seconds > ttl.total_seconds()
    refresh_reason = (
        "miss"
        if cached.frame.empty
        else "stale"
        if age_stale
        else "insufficient_minimum_rows"
    )
    try:
        fetched, source = _fetch_history(
            provider,
            symbol,
            timeframe,
            requested_rows,
        )
    except Exception as exc:
        stale_within_limit = (
            cached.row_count >= minimum_rows
            and age_seconds is not None
            and age_seconds <= max_stale_window.total_seconds()
        )
        if stale_within_limit:
            logger.warning(
                "market_weather_history_stale_fallback",
                extra={
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "cached_rows": cached.row_count,
                    "requested_rows": requested_rows,
                    "refresh_reason": refresh_reason,
                    "age_seconds": age_seconds,
                    "max_stale_seconds": max_stale_seconds,
                    "error_type": type(exc).__name__,
                },
            )
            return MarketWeatherHistoryResult(
                frame=cached.frame.copy(),
                metadata=_metadata(
                    status="stale_fallback",
                    symbol=symbol,
                    timeframe=timeframe,
                    storage_interval=storage_interval,
                    requested_rows=requested_rows,
                    minimum_rows=minimum_rows,
                    returned_rows=cached.row_count,
                    cached_rows_before=cached.row_count,
                    fetched_rows=0,
                    inserted_rows=0,
                    provider_called=True,
                    stale=True,
                    refresh_reason=refresh_reason,
                    ttl_seconds=ttl_seconds,
                    max_stale_seconds=max_stale_seconds,
                    age_seconds=age_seconds,
                    last_updated_at=cached.last_updated_at,
                    data_source=cached.data_source,
                    source_counts=cached.source_counts,
                    provider_error=_safe_error(exc),
                ),
            )
        raise

    write_race_recovered = False
    race_error: IntegrityError | None = None
    try:
        with get_db_session() as db:
            try:
                inserted_rows = _upsert_frame(
                    db,
                    symbol,
                    storage_interval,
                    fetched,
                    source=source,
                )
            except IntegrityError as exc:
                db.rollback()
                inserted_rows = 0
                race_error = exc
    except SQLAlchemyError as exc:
        return _cache_bypass_result(
            frame=fetched,
            source=source,
            cache_error=exc,
            reason="cache_write_unavailable",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=storage_interval,
            requested_rows=requested_rows,
            minimum_rows=minimum_rows,
            cached_rows_before=cached.row_count,
            ttl_seconds=ttl_seconds,
            max_stale_seconds=max_stale_seconds,
        )

    try:
        refreshed = _read_latest_snapshot(symbol, storage_interval, requested_rows)
    except SQLAlchemyError as exc:
        return _cache_bypass_result(
            frame=fetched,
            source=source,
            cache_error=exc,
            reason="cache_readback_unavailable",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=storage_interval,
            requested_rows=requested_rows,
            minimum_rows=minimum_rows,
            cached_rows_before=cached.row_count,
            ttl_seconds=ttl_seconds,
            max_stale_seconds=max_stale_seconds,
        )

    if race_error is not None:
        if not _peer_refresh_is_visible(
            before=cached,
            after=refreshed,
            fetched=fetched,
            observed_now=observed_now,
            ttl=ttl,
            minimum_rows=minimum_rows,
        ):
            return _cache_bypass_result(
                frame=fetched,
                source=source,
                cache_error=race_error,
                reason="cache_race_unpersisted",
                symbol=symbol,
                timeframe=timeframe,
                storage_interval=storage_interval,
                requested_rows=requested_rows,
                minimum_rows=minimum_rows,
                cached_rows_before=cached.row_count,
                ttl_seconds=ttl_seconds,
                max_stale_seconds=max_stale_seconds,
            )
        write_race_recovered = True
        logger.info(
            "market_weather_history_upsert_race_recovered",
            extra={
                "symbol": symbol,
                "timeframe": timeframe,
                "cached_rows": refreshed.row_count,
            },
        )

    if refreshed.row_count < minimum_rows:
        raise ValueError(
            f"Provider returned too few {timeframe} bars for {symbol}: "
            f"{refreshed.row_count} available, {minimum_rows} required."
        )

    refreshed_age = _age_seconds(observed_now, refreshed.last_updated_at)
    return MarketWeatherHistoryResult(
        frame=refreshed.frame.copy(),
        metadata=_metadata(
            status="refreshed",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=storage_interval,
            requested_rows=requested_rows,
            minimum_rows=minimum_rows,
            returned_rows=refreshed.row_count,
            cached_rows_before=cached.row_count,
            fetched_rows=len(fetched),
            inserted_rows=inserted_rows,
            provider_called=True,
            stale=False,
            refresh_reason=refresh_reason,
            write_race_recovered=write_race_recovered,
            ttl_seconds=ttl_seconds,
            max_stale_seconds=max_stale_seconds,
            age_seconds=refreshed_age,
            last_updated_at=refreshed.last_updated_at,
            data_source=refreshed.data_source or source,
            source_counts=refreshed.source_counts,
        ),
    )


def _peer_refresh_is_visible(
    *,
    before: _CacheSnapshot,
    after: _CacheSnapshot,
    fetched: pd.DataFrame,
    observed_now: datetime,
    ttl: timedelta,
    minimum_rows: int,
) -> bool:
    if after.row_count < minimum_rows or after.last_updated_at is None:
        return False
    if (
        before.last_updated_at is not None
        and _as_naive_utc(after.last_updated_at) <= _as_naive_utc(before.last_updated_at)
    ):
        return False
    age_seconds = _age_seconds(observed_now, after.last_updated_at)
    if age_seconds is None or age_seconds > ttl.total_seconds():
        return False
    if fetched.empty or after.frame.empty:
        return False
    fetched_latest = pd.Timestamp(fetched.index.max()).to_pydatetime().replace(tzinfo=None)
    after_indexes = {
        pd.Timestamp(index).to_pydatetime().replace(tzinfo=None)
        for index in after.frame.index
    }
    return fetched_latest in after_indexes


def _advisory_lock_key(symbol: str, storage_interval: str) -> int:
    payload = f"{_ADVISORY_LOCK_NAMESPACE}:{symbol}:{storage_interval}".encode("utf-8")
    unsigned = int.from_bytes(hashlib.sha256(payload).digest()[:8], "big", signed=False)
    return unsigned - (1 << 64) if unsigned >= (1 << 63) else unsigned


@contextmanager
def _cross_process_refresh_lock(symbol: str, storage_interval: str) -> Iterator[bool]:
    """Serialize a PostgreSQL refresh without holding a normal transaction.

    The dedicated connection remains checked out because PostgreSQL session
    advisory locks belong to that physical connection. The transaction opened
    by the lock statement is immediately committed before provider I/O.
    """
    try:
        with get_db_session() as db:
            bind = db.get_bind()
    except SQLAlchemyError as exc:
        raise _CacheAdvisoryLockUnavailable(exc) from exc

    if bind.dialect.name != "postgresql":
        yield False
        return

    connection = None
    acquired = False
    lock_key = _advisory_lock_key(symbol, storage_interval)
    try:
        try:
            connection = bind.connect()
            connection.execute(
                text("SELECT pg_advisory_lock(:lock_key)"),
                {"lock_key": lock_key},
            )
            connection.commit()
            acquired = True
        except SQLAlchemyError as exc:
            if connection is not None:
                _invalidate_connection(connection)
                _close_connection_quietly(connection)
            raise _CacheAdvisoryLockUnavailable(exc) from exc

        yield True
    finally:
        if acquired and connection is not None:
            try:
                connection.execute(
                    text("SELECT pg_advisory_unlock(:lock_key)"),
                    {"lock_key": lock_key},
                )
                connection.commit()
            except SQLAlchemyError:
                # Never return a pooled connection that might still own the
                # session-level advisory lock.
                logger.exception(
                    "market_weather_history_advisory_unlock_failed",
                    extra={"symbol": symbol, "storage_interval": storage_interval},
                )
                _invalidate_connection(connection)
            finally:
                _close_connection_quietly(connection)


def _invalidate_connection(connection: object) -> None:
    try:
        invalidate = getattr(connection, "invalidate")
        invalidate()
    except Exception:  # noqa: BLE001
        logger.exception("market_weather_history_connection_invalidate_failed")


def _close_connection_quietly(connection: object) -> None:
    try:
        close = getattr(connection, "close")
        close()
    except Exception:  # noqa: BLE001
        logger.exception("market_weather_history_connection_close_failed")


def canonical_market_weather_timeframe(timeframe: str) -> str:
    normalized = str(timeframe or "").strip().lower()
    canonical = _TIMEFRAME_ALIASES.get(normalized)
    if canonical is None:
        raise ValueError(f"Unsupported historical timeframe: {timeframe}")
    return canonical


def market_weather_history_ttl_seconds(timeframe: str) -> int:
    """Return the configured history freshness TTL for a timeframe alias."""
    return _ttl_seconds(canonical_market_weather_timeframe(timeframe))


def _normalize_symbol(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper()
    if not normalized:
        raise ValueError("symbol is required")
    return normalized


def _storage_interval(canonical_timeframe: str) -> str:
    # Preserve the stock-price cache's existing lower-case "1d" convention
    # while extending it uniformly to every Market Field timeframe.
    return canonical_timeframe.lower()


def _ttl_seconds(canonical_timeframe: str) -> int:
    specific_key = f"MARKET_WEATHER_HISTORY_TTL_{canonical_timeframe.upper()}_SECONDS"
    configured = os.getenv(specific_key) or os.getenv("MARKET_WEATHER_HISTORY_TTL_SECONDS")
    if configured is not None:
        try:
            value = int(configured)
        except ValueError:
            logger.warning("market_weather_history_invalid_ttl", extra={"environment_key": specific_key})
        else:
            if value >= 0:
                return value
            logger.warning("market_weather_history_invalid_ttl", extra={"environment_key": specific_key})
    return _DEFAULT_TTL_SECONDS[canonical_timeframe]


def _max_stale_seconds(canonical_timeframe: str) -> int:
    specific_key = (
        f"MARKET_WEATHER_HISTORY_MAX_STALE_{canonical_timeframe.upper()}_SECONDS"
    )
    configured = os.getenv(specific_key) or os.getenv(
        "MARKET_WEATHER_HISTORY_MAX_STALE_SECONDS"
    )
    if configured is not None:
        try:
            value = int(configured)
        except ValueError:
            logger.warning(
                "market_weather_history_invalid_max_stale",
                extra={"environment_key": specific_key},
            )
        else:
            if value >= 0:
                return value
            logger.warning(
                "market_weather_history_invalid_max_stale",
                extra={"environment_key": specific_key},
            )
    return _DEFAULT_MAX_STALE_SECONDS[canonical_timeframe]


def _lock_for(symbol: str, storage_interval: str) -> threading.Lock:
    key = (symbol, storage_interval)
    with _lock_registry_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


def _read_latest_snapshot(symbol: str, interval: str, limit: int) -> _CacheSnapshot:
    with get_db_session() as db:
        rows = (
            db.query(StockPriceBar)
            .filter(
                StockPriceBar.symbol == symbol,
                StockPriceBar.interval == interval,
            )
            .order_by(StockPriceBar.timestamp.desc())
            .limit(limit)
            .all()
        )
        return _snapshot_from_rows(rows)


def _snapshot_from_rows(rows: list[StockPriceBar]) -> _CacheSnapshot:
    if not rows:
        return _CacheSnapshot(
            frame=pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"]),
            row_count=0,
            last_updated_at=None,
            data_source="unknown",
            source_counts={},
        )

    rows_ascending = list(reversed(rows))
    updated_values = [row.updated_at for row in rows_ascending if row.updated_at is not None]
    last_updated_at = max(updated_values) if updated_values else None
    source_counts = dict(
        sorted(Counter(str(row.source or "unknown") for row in rows_ascending).items())
    )
    data_source = next(iter(source_counts)) if len(source_counts) == 1 else "mixed"
    frame = pd.DataFrame(
        {
            "Open": [float(row.open) for row in rows_ascending],
            "High": [float(row.high) for row in rows_ascending],
            "Low": [float(row.low) for row in rows_ascending],
            "Close": [float(row.close) for row in rows_ascending],
            "Volume": [
                float(row.volume) if row.volume is not None else None
                for row in rows_ascending
            ],
        },
        index=pd.DatetimeIndex([row.timestamp for row in rows_ascending]),
    )
    return _CacheSnapshot(
        frame=frame,
        row_count=len(rows_ascending),
        last_updated_at=last_updated_at,
        data_source=data_source,
        source_counts=source_counts,
    )


def _fetch_history(
    provider: object,
    symbol: str,
    timeframe: str,
    bars: int,
) -> tuple[pd.DataFrame, str]:
    # The providers' daily path can retrieve a requested duration in one
    # logical call. In particular, this avoids IBKR historical pagination for
    # a 1D field. Other canonical horizons retain historical_bars semantics.
    if timeframe == "1D" and callable(getattr(provider, "daily_bars", None)):
        method = "daily_bars"
        fetcher = getattr(provider, method, None)
        assert callable(fetcher)
        raw = _call_with_force_refresh(fetcher, symbol, days=bars)
    else:
        method = "historical_bars"
        fetcher = getattr(provider, method, None)
        if not callable(fetcher):
            raise ValueError(f"Configured market-data provider does not support {timeframe} bars.")
        raw = _call_with_force_refresh(fetcher, symbol, timeframe, bars=bars)

    frame = _coerce_ohlcv_frame(raw)
    if frame.empty:
        raise ValueError(f"Provider returned no {timeframe} historical bars for {symbol}.")
    frame = frame[~frame.index.duplicated(keep="last")].sort_index().tail(bars)
    source_resolver = getattr(provider, "source_for", None)
    source = (
        str(source_resolver(method))
        if callable(source_resolver)
        else str(getattr(provider, "name", "unknown"))
    )
    return frame, source


def _call_with_force_refresh(fetcher, *args, **kwargs):
    """Bypass provider-local bar caches when the durable cache requires refresh.

    Older test/custom providers remain compatible: the keyword is supplied
    only when their signature explicitly accepts it or accepts arbitrary
    keyword arguments. We intentionally do not retry after a ``TypeError``,
    because that could duplicate a real upstream request whose implementation
    raised the error internally.
    """
    if _accepts_keyword(fetcher, "force_refresh"):
        kwargs = dict(kwargs)
        kwargs["force_refresh"] = True
    return fetcher(*args, **kwargs)


def _accepts_keyword(callable_value: object, keyword: str) -> bool:
    try:
        parameters = inspect.signature(callable_value).parameters
    except (TypeError, ValueError):
        return False
    parameter = parameters.get(keyword)
    if parameter is not None and parameter.kind is not inspect.Parameter.POSITIONAL_ONLY:
        return True
    return any(
        value.kind is inspect.Parameter.VAR_KEYWORD
        for value in parameters.values()
    )


def _age_seconds(now: datetime, updated_at: datetime | None) -> float | None:
    if updated_at is None:
        return None
    age = (_as_naive_utc(now) - _as_naive_utc(updated_at)).total_seconds()
    return max(0.0, float(age))


def _as_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_naive_utc(value).replace(tzinfo=timezone.utc).isoformat()


def _safe_error(exc: Exception) -> str:
    message = " ".join(str(exc).split())
    summary = type(exc).__name__
    if message:
        summary = f"{summary}: {message}"
    return summary[:300]


def _cache_bypass_result(
    *,
    frame: pd.DataFrame,
    source: str,
    cache_error: Exception,
    reason: str,
    symbol: str,
    timeframe: str,
    storage_interval: str,
    requested_rows: int,
    minimum_rows: int,
    cached_rows_before: int,
    ttl_seconds: int,
    max_stale_seconds: int,
) -> MarketWeatherHistoryResult:
    returned_rows = len(frame)
    if returned_rows < minimum_rows:
        raise ValueError(
            f"Provider returned too few {timeframe} bars for {symbol}: "
            f"{returned_rows} available, {minimum_rows} required."
        )
    logger.warning(
        "market_weather_history_cache_bypass",
        extra={
            "symbol": symbol,
            "timeframe": timeframe,
            "returned_rows": returned_rows,
            "reason": reason,
            "error_type": type(cache_error).__name__,
            "cache_error": _safe_error(cache_error),
        },
    )
    return MarketWeatherHistoryResult(
        frame=frame.copy(),
        metadata=_metadata(
            status="cache_bypass",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=storage_interval,
            requested_rows=requested_rows,
            minimum_rows=minimum_rows,
            returned_rows=returned_rows,
            cached_rows_before=cached_rows_before,
            fetched_rows=returned_rows,
            inserted_rows=0,
            provider_called=True,
            stale=False,
            refresh_reason=reason,
            ttl_seconds=ttl_seconds,
            max_stale_seconds=max_stale_seconds,
            age_seconds=None,
            last_updated_at=None,
            data_source=source,
            source_counts={source: returned_rows},
            # Cache infrastructure details are intentionally not exposed by
            # this public response; the reason plus exception class is enough
            # for client diagnostics, while full failures remain server-side.
            cache_error=type(cache_error).__name__,
        ),
    )


def _metadata(
    *,
    status: CacheStatus,
    symbol: str,
    timeframe: str,
    storage_interval: str,
    requested_rows: int,
    minimum_rows: int,
    returned_rows: int,
    cached_rows_before: int,
    fetched_rows: int,
    inserted_rows: int,
    provider_called: bool,
    stale: bool,
    refresh_reason: str | None,
    ttl_seconds: int,
    max_stale_seconds: int,
    age_seconds: float | None,
    last_updated_at: datetime | None,
    data_source: str,
    provider_error: str | None = None,
    cache_error: str | None = None,
    write_race_recovered: bool = False,
    source_counts: dict[str, int] | None = None,
) -> MarketWeatherHistoryCacheMetadata:
    return MarketWeatherHistoryCacheMetadata(
        status=status,
        symbol=symbol,
        timeframe=timeframe,
        storage_interval=storage_interval,
        requested_rows=requested_rows,
        minimum_rows=minimum_rows,
        returned_rows=returned_rows,
        cached_rows_before=cached_rows_before,
        fetched_rows=fetched_rows,
        inserted_rows=inserted_rows,
        provider_called=provider_called,
        stale=stale,
        depth_complete=returned_rows >= requested_rows,
        write_race_recovered=write_race_recovered,
        refresh_reason=refresh_reason,
        ttl_seconds=ttl_seconds,
        age_seconds=round(age_seconds, 3) if age_seconds is not None else None,
        last_updated_at=_iso_utc(last_updated_at),
        data_source=data_source,
        provider_error=provider_error,
        cache_error=cache_error,
        source_counts=dict(sorted((source_counts or {}).items())),
        max_stale_seconds=max_stale_seconds,
    )
