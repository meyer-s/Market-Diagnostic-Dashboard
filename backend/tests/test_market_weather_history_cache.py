from __future__ import annotations

import gc
import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.stock_price_bar import StockPriceBar
from app.services import market_weather_history_cache as history_cache


class FakeProvider:
    name = "fake"

    def __init__(self, frame: pd.DataFrame | None = None, error: Exception | None = None) -> None:
        self.frame = frame
        self.error = error
        self.calls: list[tuple[str, str, int]] = []

    def historical_bars(self, symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
        self.calls.append((symbol, timeframe, bars))
        if self.error is not None:
            raise self.error
        assert self.frame is not None
        return self.frame.copy()

    def source_for(self, method: str) -> str:
        assert method == "historical_bars"
        return "fake-history"


@pytest.fixture()
def session_local(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    StockPriceBar.__table__.create(engine)
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    @contextmanager
    def session_scope():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(history_cache, "get_db_session", session_scope)
    yield testing_session_local
    engine.dispose()


def _frame(start: str, periods: int, freq: str = "5min", base: float = 100.0) -> pd.DataFrame:
    index = pd.date_range(start, periods=periods, freq=freq)
    values = [base + offset for offset in range(periods)]
    return pd.DataFrame(
        {
            "Open": values,
            "High": [value + 1.0 for value in values],
            "Low": [value - 1.0 for value in values],
            "Close": [value + 0.5 for value in values],
            "Volume": [1_000.0 + offset for offset in range(periods)],
        },
        index=index,
    )


def _seed(
    session_local,
    *,
    symbol: str,
    interval: str,
    frame: pd.DataFrame,
    updated_at: datetime,
    source: str = "seed",
) -> None:
    with session_local() as db:
        for timestamp, row in frame.iterrows():
            db.add(
                StockPriceBar(
                    symbol=symbol,
                    interval=interval,
                    timestamp=pd.Timestamp(timestamp).to_pydatetime(),
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row["Volume"]),
                    source=source,
                    created_at=updated_at,
                    updated_at=updated_at,
                )
            )
        db.commit()


def test_fresh_cache_returns_latest_rows_without_provider_call(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    cached = _frame("2026-07-24 09:30", periods=8)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=cached,
        updated_at=now - timedelta(seconds=30),
    )
    provider = FakeProvider(error=AssertionError("provider should not be called"))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        " spy ",
        "5m",
        bars=5,
        minimum_rows=3,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert provider.calls == []
    assert result.frame.index.tolist() == cached.index[-5:].tolist()
    assert result.metadata.status == "hit"
    assert result.metadata.provider_called is False
    assert result.metadata.returned_rows == 5
    assert result.metadata.age_seconds == 30.0


def test_freshness_uses_updated_at_not_old_bar_timestamp_on_weekend(session_local) -> None:
    monday = datetime(2026, 7, 27, 9, 0)
    friday_daily_bars = _frame("2026-07-20", periods=5, freq="1D")
    _seed(
        session_local,
        symbol="SPY",
        interval="1d",
        frame=friday_daily_bars,
        updated_at=monday - timedelta(minutes=1),
    )
    provider = FakeProvider(error=AssertionError("weekend gap must not trigger a fetch"))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1D",
        bars=5,
        minimum_rows=5,
        freshness=timedelta(hours=6),
        now=monday,
    )

    assert provider.calls == []
    assert result.metadata.status == "hit"
    assert result.metadata.storage_interval == "1d"
    assert result.metadata.age_seconds == 60.0


def test_stale_cache_is_refreshed_and_provider_rows_are_upserted(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    old = _frame("2026-07-24 09:30", periods=3)
    refreshed = _frame("2026-07-24 09:30", periods=6, base=200.0)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=old,
        updated_at=now - timedelta(hours=1),
    )
    provider = FakeProvider(frame=refreshed)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert provider.calls == [("SPY", "5m", 6)]
    assert result.metadata.status == "refreshed"
    assert result.metadata.refresh_reason == "stale"
    assert result.metadata.cached_rows_before == 3
    assert result.metadata.fetched_rows == 6
    assert result.metadata.inserted_rows == 3
    assert result.metadata.data_source == "fake-history"
    assert result.frame["Close"].tolist() == refreshed["Close"].tolist()

    with session_local() as db:
        rows = (
            db.query(StockPriceBar)
            .filter(StockPriceBar.symbol == "SPY", StockPriceBar.interval == "5m")
            .order_by(StockPriceBar.timestamp.asc())
            .all()
        )
        assert len(rows) == 6
        assert rows[0].close == 200.5
        assert rows[-1].source == "fake-history"


def test_provider_failure_returns_sufficient_stale_cache(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    cached = _frame("2026-07-24 09:30", periods=5)
    _seed(
        session_local,
        symbol="SPY",
        interval="15m",
        frame=cached,
        updated_at=now - timedelta(hours=2),
    )
    provider = FakeProvider(error=TimeoutError("provider rate limited"))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "15m",
        bars=5,
        minimum_rows=4,
        freshness=timedelta(minutes=5),
        now=now,
    )

    assert provider.calls == [("SPY", "15m", 5)]
    assert result.frame.equals(cached)
    assert result.metadata.status == "stale_fallback"
    assert result.metadata.stale is True
    assert result.metadata.data_source == "seed"
    assert result.metadata.provider_error == "TimeoutError: provider rate limited"


def test_provider_failure_is_raised_when_cache_is_insufficient(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    cached = _frame("2026-07-24 09:30", periods=2)
    _seed(
        session_local,
        symbol="SPY",
        interval="30m",
        frame=cached,
        updated_at=now - timedelta(hours=2),
    )
    provider = FakeProvider(error=TimeoutError("provider unavailable"))

    with pytest.raises(TimeoutError, match="provider unavailable"):
        history_cache.get_or_refresh_market_weather_history(
            provider,
            "SPY",
            "30m",
            bars=6,
            minimum_rows=4,
            freshness=timedelta(minutes=5),
            now=now,
        )


def test_cache_supports_every_canonical_timeframe(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    for timeframe in ("1m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W"):
        frame = _frame("2026-07-01", periods=3)
        provider = FakeProvider(frame=frame)
        result = history_cache.get_or_refresh_market_weather_history(
            provider,
            f"T{timeframe}",
            timeframe,
            bars=3,
            minimum_rows=3,
            freshness=timedelta(minutes=5),
            now=now,
        )

        assert provider.calls == [(f"T{timeframe}".upper(), timeframe, 3)]
        assert result.metadata.storage_interval == timeframe.lower()
        assert result.metadata.status == "refreshed"


def test_daily_refresh_prefers_single_call_daily_provider_path(session_local) -> None:
    class DailyProvider(FakeProvider):
        def __init__(self, frame: pd.DataFrame) -> None:
            super().__init__(frame=frame)
            self.daily_calls: list[tuple[str, int, bool]] = []

        def daily_bars(
            self,
            symbol: str,
            days: int = 365,
            *,
            force_refresh: bool = False,
        ) -> pd.DataFrame:
            self.daily_calls.append((symbol, days, force_refresh))
            assert self.frame is not None
            return self.frame.copy()

        def source_for(self, method: str) -> str:
            return f"fake-{method}"

    provider = DailyProvider(_frame("2026-07-01", periods=5, freq="1D"))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1D",
        bars=5,
        minimum_rows=5,
        freshness=timedelta(hours=6),
        now=datetime(2026, 7, 24, 15, 0),
    )

    assert provider.daily_calls == [("SPY", 5, True)]
    assert provider.calls == []
    assert result.metadata.data_source == "fake-daily_bars"


def test_stale_persistent_refresh_bypasses_provider_memory_cache(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    durable_rows = _frame("2026-07-24 09:30", periods=4, base=100.0)
    provider_cached_rows = _frame("2026-07-24 09:30", periods=4, base=150.0)
    upstream_rows = _frame("2026-07-24 09:30", periods=4, base=200.0)
    _seed(
        session_local,
        symbol="SPY",
        interval="1m",
        frame=durable_rows,
        updated_at=now - timedelta(minutes=10),
    )

    class MemoryCachedProvider:
        name = "ibkr"

        def __init__(self) -> None:
            self.cached = provider_cached_rows.copy()
            self.force_refresh_values: list[bool] = []

        def historical_bars(
            self,
            _symbol: str,
            _timeframe: str,
            bars: int = 500,
            *,
            force_refresh: bool = False,
        ) -> pd.DataFrame:
            self.force_refresh_values.append(force_refresh)
            if force_refresh:
                self.cached = upstream_rows.copy()
            return self.cached.tail(bars).copy()

        def source_for(self, _method: str) -> str:
            return "ibkr"

    provider = MemoryCachedProvider()
    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1m",
        bars=4,
        minimum_rows=4,
        freshness=timedelta(seconds=60),
        now=now,
    )

    assert provider.force_refresh_values == [True]
    assert result.metadata.status == "refreshed"
    assert result.frame["Close"].tolist() == upstream_rows["Close"].tolist()
    assert result.frame["Close"].tolist() != provider_cached_rows["Close"].tolist()


def test_repeat_request_reuses_rows_written_by_first_request(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    provider = FakeProvider(frame=_frame("2026-07-24 09:30", periods=6))

    first = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )
    second = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert provider.calls == [("SPY", "5m", 6)]
    assert first.metadata.status == "refreshed"
    assert second.metadata.status == "hit"
    assert second.metadata.provider_called is False
    assert second.frame.equals(first.frame)


def test_fresh_sufficient_partial_depth_defers_retry_until_ttl(session_local) -> None:
    checked_at = datetime(2026, 7, 24, 14, 50)
    cached = _frame("2026-07-23 09:30", periods=80)
    _seed(
        session_local,
        symbol="SPY",
        interval="1h",
        frame=cached,
        updated_at=checked_at,
    )
    provider = FakeProvider(frame=cached)

    fresh = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1h",
        bars=100,
        minimum_rows=60,
        freshness=timedelta(minutes=15),
        now=checked_at + timedelta(minutes=5),
    )

    assert provider.calls == []
    assert fresh.metadata.status == "hit"
    assert fresh.metadata.returned_rows == 80
    assert fresh.metadata.depth_complete is False
    assert fresh.metadata.refresh_reason == "depth_retry_deferred"

    expired = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1h",
        bars=100,
        minimum_rows=60,
        freshness=timedelta(minutes=15),
        now=checked_at + timedelta(minutes=16),
    )

    assert provider.calls == [("SPY", "1h", 100)]
    assert expired.metadata.status == "refreshed"
    assert expired.metadata.refresh_reason == "stale"
    assert expired.metadata.depth_complete is False


def test_unique_key_upsert_race_recovers_from_durable_peer_rows(session_local, monkeypatch) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    fetched = _frame("2026-07-24 09:30", periods=6)
    provider = FakeProvider(frame=fetched)
    real_upsert = history_cache._upsert_frame

    def peer_wins_then_conflicts(db, symbol, interval, frame, source="unknown"):
        # Model the observable end state of a cross-worker race: the peer's
        # rows committed, while this worker receives the unique-key error.
        real_upsert(db, symbol, interval, frame, source=source)
        raise IntegrityError("insert stock_price_bar", {}, RuntimeError("unique key race"))

    monkeypatch.setattr(history_cache, "_upsert_frame", peer_wins_then_conflicts)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert result.metadata.status == "refreshed"
    assert result.metadata.write_race_recovered is True
    assert result.metadata.returned_rows == 6
    assert result.frame["Close"].tolist() == fetched["Close"].tolist()


def test_unique_key_error_without_peer_rows_returns_unpersisted_bypass(session_local, monkeypatch) -> None:
    provider = FakeProvider(frame=_frame("2026-07-24 09:30", periods=6))

    def unresolved_conflict(*_args, **_kwargs):
        raise IntegrityError("insert stock_price_bar", {}, RuntimeError("unresolved unique key"))

    monkeypatch.setattr(history_cache, "_upsert_frame", unresolved_conflict)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=datetime(2026, 7, 24, 15, 0),
    )

    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_race_unpersisted"
    assert result.metadata.write_race_recovered is False


def test_initial_cache_read_outage_bypasses_persistence_and_returns_provider_data(
    session_local,
    monkeypatch,
) -> None:
    provider_frame = _frame("2026-07-24 09:30", periods=6)
    provider = FakeProvider(frame=provider_frame)

    def unavailable_read(*_args, **_kwargs):
        raise OperationalError("select stock_price_bar", {}, RuntimeError("database offline"))

    def forbidden_upsert(*_args, **_kwargs):
        raise AssertionError("persistence must not be attempted after the initial read outage")

    monkeypatch.setattr(history_cache, "_read_latest_snapshot", unavailable_read)
    monkeypatch.setattr(history_cache, "_upsert_frame", forbidden_upsert)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=datetime(2026, 7, 24, 15, 0),
    )

    assert provider.calls == [("SPY", "5m", 6)]
    assert result.frame.equals(provider_frame)
    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_read_unavailable"
    assert result.metadata.inserted_rows == 0
    assert result.metadata.cache_error is not None
    json.dumps(result.metadata.to_dict())


def test_initial_cache_read_outage_does_not_swallow_provider_failure(
    session_local,
    monkeypatch,
) -> None:
    provider = FakeProvider(error=TimeoutError("provider rate limited"))

    def unavailable_read(*_args, **_kwargs):
        raise OperationalError("select stock_price_bar", {}, RuntimeError("database offline"))

    monkeypatch.setattr(history_cache, "_read_latest_snapshot", unavailable_read)

    with pytest.raises(TimeoutError, match="provider rate limited"):
        history_cache.get_or_refresh_market_weather_history(
            provider,
            "SPY",
            "5m",
            bars=6,
            minimum_rows=4,
            freshness=timedelta(minutes=2),
            now=datetime(2026, 7, 24, 15, 0),
        )


def test_cache_write_outage_returns_successful_provider_frame(session_local, monkeypatch) -> None:
    provider_frame = _frame("2026-07-24 09:30", periods=6)
    provider = FakeProvider(frame=provider_frame)

    def unavailable_write(*_args, **_kwargs):
        raise OperationalError("insert stock_price_bar", {}, RuntimeError("database read only"))

    monkeypatch.setattr(history_cache, "_upsert_frame", unavailable_write)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=datetime(2026, 7, 24, 15, 0),
    )

    assert result.frame.equals(provider_frame)
    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_write_unavailable"
    assert result.metadata.cache_error is not None


def test_cache_readback_outage_returns_successful_provider_frame(session_local, monkeypatch) -> None:
    provider_frame = _frame("2026-07-24 09:30", periods=6)
    provider = FakeProvider(frame=provider_frame)
    real_read = history_cache._read_latest_snapshot
    read_calls = 0

    def read_once_then_fail(*args, **kwargs):
        nonlocal read_calls
        read_calls += 1
        if read_calls <= 2:
            return real_read(*args, **kwargs)
        raise OperationalError("select stock_price_bar", {}, RuntimeError("database disconnected"))

    monkeypatch.setattr(history_cache, "_read_latest_snapshot", read_once_then_fail)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=datetime(2026, 7, 24, 15, 0),
    )

    assert result.frame.equals(provider_frame)
    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_readback_unavailable"
    assert result.metadata.cache_error is not None


def test_waiting_worker_rereads_peer_fill_before_provider_call(
    session_local,
    monkeypatch,
) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    peer_frame = _frame("2026-07-24 09:30", periods=6)
    provider = FakeProvider(error=AssertionError("peer fill must prevent provider call"))

    @contextmanager
    def peer_fills_while_waiting(_symbol: str, _interval: str):
        _seed(
            session_local,
            symbol="SPY",
            interval="5m",
            frame=peer_frame,
            updated_at=now - timedelta(seconds=10),
            source="peer-worker",
        )
        yield True

    monkeypatch.setattr(
        history_cache,
        "_cross_process_refresh_lock",
        peer_fills_while_waiting,
    )

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert provider.calls == []
    assert result.metadata.status == "hit"
    assert result.metadata.refresh_reason == "refresh_completed_by_peer"
    assert result.metadata.data_source == "peer-worker"


def test_postgres_advisory_lock_uses_stable_bound_signed_key(monkeypatch) -> None:
    statements: list[tuple[str, dict[str, int]]] = []

    class FakeConnection:
        def __init__(self) -> None:
            self.commits = 0
            self.closed = False
            self.invalidated = False

        def execute(self, statement, params):
            statements.append((str(statement), dict(params)))

        def commit(self) -> None:
            self.commits += 1

        def close(self) -> None:
            self.closed = True

        def invalidate(self) -> None:
            self.invalidated = True

    connection = FakeConnection()

    class FakeBind:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):
            return connection

    class FakeSession:
        def get_bind(self):
            return FakeBind()

    @contextmanager
    def fake_session_scope():
        yield FakeSession()

    monkeypatch.setattr(history_cache, "get_db_session", fake_session_scope)

    with history_cache._cross_process_refresh_lock("SPY", "5m") as acquired:
        assert acquired is True

    expected_key = history_cache._advisory_lock_key("SPY", "5m")
    assert -(1 << 63) <= expected_key < (1 << 63)
    assert expected_key == -710002257822584013
    assert expected_key == history_cache._advisory_lock_key("SPY", "5m")
    assert expected_key != history_cache._advisory_lock_key("QQQ", "5m")
    assert statements == [
        ("SELECT pg_advisory_lock(:lock_key)", {"lock_key": expected_key}),
        ("SELECT pg_advisory_unlock(:lock_key)", {"lock_key": expected_key}),
    ]
    assert connection.commits == 2
    assert connection.closed is True
    assert connection.invalidated is False


def test_advisory_lock_outage_bypasses_persistence_after_provider_success(
    session_local,
    monkeypatch,
) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    stale = _frame("2026-07-24 09:30", periods=6)
    fetched = _frame("2026-07-24 09:30", periods=6, base=200.0)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=stale,
        updated_at=now - timedelta(hours=1),
    )
    provider = FakeProvider(frame=fetched)

    @contextmanager
    def unavailable_lock(_symbol: str, _interval: str):
        raise history_cache._CacheAdvisoryLockUnavailable(
            OperationalError("pg_advisory_lock", {}, RuntimeError("database offline"))
        )
        yield  # pragma: no cover

    def forbidden_upsert(*_args, **_kwargs):
        raise AssertionError("unknown lock state must prevent persistence")

    monkeypatch.setattr(history_cache, "_cross_process_refresh_lock", unavailable_lock)
    monkeypatch.setattr(history_cache, "_upsert_frame", forbidden_upsert)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert result.frame.equals(fetched)
    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_lock_unavailable"


def test_stale_fallback_respects_timeframe_maximum_age(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    cached = _frame("2026-07-24 09:30", periods=5, freq="1min")
    provider = FakeProvider(error=TimeoutError("provider unavailable"))
    _seed(
        session_local,
        symbol="SPY",
        interval="1m",
        frame=cached,
        updated_at=now - timedelta(minutes=14, seconds=59),
    )

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "1m",
        bars=5,
        minimum_rows=5,
        freshness=timedelta(minutes=1),
        now=now,
    )

    assert result.metadata.status == "stale_fallback"
    assert result.metadata.max_stale_seconds == 900


def test_provider_failure_propagates_when_cache_exceeds_maximum_stale_age(
    session_local,
) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    cached = _frame("2026-07-24 09:30", periods=5, freq="1min")
    provider = FakeProvider(error=TimeoutError("provider unavailable"))
    _seed(
        session_local,
        symbol="SPY",
        interval="1m",
        frame=cached,
        updated_at=now - timedelta(minutes=15, seconds=1),
    )

    with pytest.raises(TimeoutError, match="provider unavailable"):
        history_cache.get_or_refresh_market_weather_history(
            provider,
            "SPY",
            "1m",
            bars=5,
            minimum_rows=5,
            freshness=timedelta(minutes=1),
            now=now,
        )


def test_maximum_stale_age_has_global_and_timeframe_overrides(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_WEATHER_HISTORY_MAX_STALE_SECONDS", "1234")
    assert history_cache._max_stale_seconds("5m") == 1234

    monkeypatch.setenv("MARKET_WEATHER_HISTORY_MAX_STALE_5M_SECONDS", "567")
    assert history_cache._max_stale_seconds("5m") == 567


def test_mixed_cache_sources_are_explicit_and_counted(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=_frame("2026-07-24 09:30", periods=2),
        updated_at=now - timedelta(seconds=30),
        source="YAHOO",
    )
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=_frame("2026-07-24 09:40", periods=2),
        updated_at=now - timedelta(seconds=30),
        source="IBKR",
    )
    provider = FakeProvider(error=AssertionError("fresh mixed cache must be used"))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=4,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert result.metadata.data_source == "mixed"
    assert result.metadata.source_counts == {"IBKR": 2, "YAHOO": 2}
    assert provider.calls == []


def test_lock_registry_releases_high_cardinality_inactive_keys() -> None:
    held = history_cache._lock_for("HELD", "1m")
    same = history_cache._lock_for("HELD", "1m")
    assert same is held

    for index in range(500):
        transient = history_cache._lock_for(f"SYMBOL-{index}", "5m")
    del transient
    gc.collect()

    assert history_cache._key_locks.get(("HELD", "1m")) is held
    assert len(history_cache._key_locks) == 1

    del same
    del held
    gc.collect()
    assert history_cache._key_locks.get(("HELD", "1m")) is None


def test_integrity_race_requires_fresh_peer_advance(session_local, monkeypatch) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    stale = _frame("2026-07-24 09:30", periods=6)
    fetched = _frame("2026-07-24 09:30", periods=6, base=200.0)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=stale,
        updated_at=now - timedelta(hours=1),
    )
    provider = FakeProvider(frame=fetched)

    def conflict_without_peer_write(*_args, **_kwargs):
        raise IntegrityError("insert stock_price_bar", {}, RuntimeError("unique key race"))

    monkeypatch.setattr(history_cache, "_upsert_frame", conflict_without_peer_write)

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=6,
        minimum_rows=4,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert result.metadata.status == "cache_bypass"
    assert result.metadata.refresh_reason == "cache_race_unpersisted"
    assert result.metadata.write_race_recovered is False
    assert result.frame["Close"].tolist() == fetched["Close"].tolist()


def test_public_ttl_wrapper_normalizes_alias_and_honors_override(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_WEATHER_HISTORY_TTL_1D_SECONDS", "77")
    assert history_cache.market_weather_history_ttl_seconds("1d") == 77


def test_old_row_backfill_does_not_mark_latest_requested_tail_fresh(session_local) -> None:
    now = datetime(2026, 7, 24, 15, 0)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=_frame("2026-07-24 09:30", periods=3),
        updated_at=now - timedelta(seconds=10),
        source="backfill",
    )
    latest_stale = _frame("2026-07-24 09:45", periods=3)
    _seed(
        session_local,
        symbol="SPY",
        interval="5m",
        frame=latest_stale,
        updated_at=now - timedelta(hours=1),
        source="old-tail",
    )
    provider = FakeProvider(frame=_frame("2026-07-24 09:45", periods=3, base=200.0))

    result = history_cache.get_or_refresh_market_weather_history(
        provider,
        "SPY",
        "5m",
        bars=3,
        minimum_rows=3,
        freshness=timedelta(minutes=2),
        now=now,
    )

    assert provider.calls == [("SPY", "5m", 3)]
    assert result.metadata.status == "refreshed"
