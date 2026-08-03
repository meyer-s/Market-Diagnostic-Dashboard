from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.stock_price_bar import StockPriceBar
from app.services import stock_price_cache as cache


@pytest.fixture()
def cache_db(monkeypatch):
    cache._refresh_attempts.clear()
    engine = create_engine("sqlite+pysqlite:///:memory:")
    StockPriceBar.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)

    @contextmanager
    def session_context():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(cache, "get_db_session", session_context)
    yield session_local
    cache._refresh_attempts.clear()
    engine.dispose()


def _seed(
    session_local,
    *,
    interval: str,
    observed_at: datetime,
    updated_at: datetime,
    adjusted_close: float | None = 100.0,
    close: float = 100.0,
    source: str = "YAHOO",
) -> None:
    db = session_local()
    try:
        db.add(
            StockPriceBar(
                symbol="TEST",
                interval=interval,
                timestamp=observed_at,
                open=100.0,
                high=101.0,
                low=99.0,
                close=close,
                adjusted_close=adjusted_close,
                volume=1_000_000,
                source=source,
                created_at=updated_at,
                updated_at=updated_at,
            )
        )
        db.commit()
    finally:
        db.close()


def _frame(timestamp: datetime, close: float = 101.0, adjusted: float | None = 101.0) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Open": [close - 1],
            "High": [close + 1],
            "Low": [close - 2],
            "Close": [close],
            "Adjusted Close": [adjusted],
            "Volume": [1_100_000],
        },
        index=pd.DatetimeIndex([timestamp]),
    )


def test_daily_refresh_uses_cache_update_ttl_not_latest_bar_age(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 22, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(hours=3),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
    )
    calls = []
    monkeypatch.setattr(cache, "_utc_now", lambda: now)

    def fetch(*args, **kwargs):
        calls.append((args, kwargs))
        return _frame(now.replace(tzinfo=None), 101.0)

    monkeypatch.setattr(cache, "_fetch_daily", fetch)
    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert len(calls) == 1
    assert result.iloc[-1]["Close"] == 101.0
    assert result.attrs["metadata"]["refresh_succeeded"] is True


def test_fresh_cache_is_not_refetched_only_because_observation_is_old(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(days=10),
        updated_at=now.replace(tzinfo=None) - timedelta(minutes=2),
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(
        cache,
        "_fetch_daily",
        lambda *args, **kwargs: pytest.fail("fresh cache should not refresh"),
    )

    result = cache.get_or_refresh_daily_frame("TEST", days=20)

    assert result.attrs["metadata"]["refresh_attempted"] is False
    assert result.attrs["metadata"]["stale"] is True


def test_daily_refresh_failure_returns_last_known_data_with_warning_metadata(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(days=1),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(cache, "_fetch_daily", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("provider down")))

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert result.iloc[-1]["Close"] == 100.0
    assert result.attrs["metadata"]["refresh_succeeded"] is False
    assert result.attrs["metadata"]["refresh_error"] == "provider down"
    assert result.attrs["metadata"]["stale"] is True


def test_existing_intraday_cache_refreshes_on_ttl(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 30, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="2h",
        observed_at=now.replace(tzinfo=None) - timedelta(hours=2),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
        adjusted_close=None,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)

    def fetch_intraday(*args, **kwargs):
        session_dates = pd.bdate_range("2026-07-06", "2026-08-03")
        index = pd.DatetimeIndex(
            [
                session_date + pd.Timedelta(hours=hour, minutes=30)
                for session_date in session_dates
                for hour in (13, 15, 17, 19)
            ]
        )
        closes = [102.0] * len(index)
        return pd.DataFrame(
            {
                "Open": closes,
                "High": [103.0] * len(index),
                "Low": [101.0] * len(index),
                "Close": closes,
                "Volume": [1_100_000] * len(index),
            },
            index=index,
        )

    monkeypatch.setattr(cache, "_fetch_2h", fetch_intraday)

    result = cache.get_cached_intraday_frame("TEST", days=10)

    assert result.iloc[-1]["Close"] == 102.0
    assert result.attrs["metadata"]["refresh_attempted"] is True
    assert result.attrs["metadata"]["refresh_succeeded"] is True


def test_empty_intraday_refresh_failure_uses_retry_cooldown(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 30, tzinfo=timezone.utc)
    calls = []
    monkeypatch.setattr(cache, "_utc_now", lambda: now)

    def fail_refresh(*args, **kwargs):
        calls.append((args, kwargs))
        raise RuntimeError("intraday unavailable")

    monkeypatch.setattr(cache, "_fetch_2h", fail_refresh)

    first = cache.get_cached_intraday_frame("TEST", days=10)
    second = cache.get_cached_intraday_frame("TEST", days=10)

    assert len(calls) == 1
    assert first.empty and second.empty
    assert first.attrs["metadata"]["refresh_attempted"] is True
    assert first.attrs["metadata"]["refresh_succeeded"] is False
    assert second.attrs["metadata"]["refresh_attempted"] is False
    assert second.attrs["metadata"]["refresh_deferred"] is True
    assert second.attrs["metadata"]["refresh_error"] == "intraday unavailable"


def test_refresh_attempt_registry_prunes_expired_entries_and_enforces_cap(monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(cache, "_MAX_REFRESH_ATTEMPTS", 3)
    cache._refresh_attempts.clear()
    cache._refresh_attempts.update(
        {
            ("ACTIVE", "1d"): (now - timedelta(minutes=1), "active"),
            ("EXPIRED", "1d"): (
                now - timedelta(seconds=cache.DAILY_CACHE_TTL_SECONDS + 1),
                "expired",
            ),
            ("OLDEST", "1d"): (now - timedelta(minutes=2), "oldest"),
        }
    )

    cache._record_refresh_failure("NEW", "1d", now, "new")
    cache._record_refresh_failure("NEWER", "1d", now, "newer")

    assert len(cache._refresh_attempts) == 3
    assert ("EXPIRED", "1d") not in cache._refresh_attempts
    assert ("OLDEST", "1d") not in cache._refresh_attempts
    assert ("ACTIVE", "1d") in cache._refresh_attempts
    assert ("NEW", "1d") in cache._refresh_attempts
    assert ("NEWER", "1d") in cache._refresh_attempts
    cache._refresh_attempts.clear()


def test_intraday_coverage_detects_large_interior_business_gap() -> None:
    index = pd.DatetimeIndex(
        [
            "2026-01-05 14:30:00",
            "2026-01-06 14:30:00",
            "2026-02-02 14:30:00",
            "2026-02-03 14:30:00",
        ]
    )
    frame = pd.DataFrame({"Close": [100.0, 101.0, 102.0, 103.0]}, index=index)

    assert cache._intraday_coverage_incomplete(
        frame,
        datetime(2026, 1, 1),
    ) is True


def test_intraday_coverage_rejects_one_bucket_per_full_session() -> None:
    index = pd.bdate_range("2026-07-06", "2026-07-17") + pd.Timedelta(
        hours=13,
        minutes=30,
    )
    frame = pd.DataFrame({"Close": [100.0] * len(index)}, index=index)

    assert cache._intraday_coverage_incomplete(
        frame,
        datetime(2026, 7, 1),
    ) is True


def test_partial_adjusted_history_uses_one_raw_basis_without_scale_break(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(days=1),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
        adjusted_close=None,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(
        cache,
        "_fetch_daily",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("adjusted history unavailable")
        ),
    )

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert result.attrs["metadata"]["return_basis"] == "raw_close_fallback"
    assert result.attrs["metadata"]["adjusted_close_coverage_pct"] == 0.0
    assert result.attrs["metadata"]["refresh_attempted"] is True
    assert result.attrs["metadata"]["refresh_succeeded"] is False
    assert result.attrs["metadata"]["refresh_error"] == "adjusted history unavailable"


def test_failed_adjusted_repair_is_deferred_during_retry_cooldown(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(days=1),
        updated_at=now.replace(tzinfo=None) - timedelta(minutes=1),
        adjusted_close=None,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    calls = []

    def fail_refresh(*args, **kwargs):
        calls.append((args, kwargs))
        raise RuntimeError("adjusted history unavailable")

    monkeypatch.setattr(cache, "_fetch_daily", fail_refresh)

    first = cache.get_or_refresh_daily_frame("TEST", days=10)
    second = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert len(calls) == 1
    assert first.attrs["metadata"]["refresh_attempted"] is True
    assert first.attrs["metadata"]["refresh_succeeded"] is False
    assert second.attrs["metadata"]["return_basis"] == "raw_close_fallback"
    assert second.attrs["metadata"]["refresh_attempted"] is False
    assert second.attrs["metadata"]["refresh_succeeded"] is False
    assert second.attrs["metadata"]["refresh_deferred"] is True
    assert second.attrs["metadata"]["stale"] is True


def test_incomplete_daily_refresh_is_reported_as_failed_without_overwriting_cache(
    cache_db,
    monkeypatch,
) -> None:
    now = datetime(2026, 8, 3, 22, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=datetime(2026, 7, 31),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
        adjusted_close=99.5,
        close=100.0,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(
        cache,
        "_fetch_daily",
        lambda *args, **kwargs: _frame(
            datetime(2026, 7, 31),
            close=101.0,
            adjusted=None,
        ),
    )

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert result.iloc[-1]["Close"] == 100.0
    assert result.iloc[-1]["Adjusted Close"] == 99.5
    assert result.attrs["metadata"]["refresh_attempted"] is True
    assert result.attrs["metadata"]["refresh_succeeded"] is False
    assert result.attrs["metadata"]["refresh_error"] == (
        "upstream returned incomplete adjusted-close history"
    )


def test_in_progress_daily_session_is_withheld_from_latest_close() -> None:
    frame = pd.DataFrame(
        {
            "Open": [99.0, 100.0],
            "High": [101.0, 102.0],
            "Low": [98.0, 99.0],
            "Close": [100.0, 101.0],
            "Adjusted Close": [100.0, 101.0],
            "Volume": [1_000_000, 500_000],
        },
        index=pd.to_datetime(["2026-07-31", "2026-08-03"]),
    )
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)  # 11:00 ET

    completed = cache._completed_daily_frame(frame, now)

    assert list(completed.index) == [pd.Timestamp("2026-07-31")]
    assert completed.attrs["cache_metadata"]["partial_session_withheld"] is True


def test_same_day_partial_row_refreshes_once_session_is_finalized(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 20, 16, tzinfo=timezone.utc)  # 16:16 ET
    _seed(
        cache_db,
        interval="1d",
        observed_at=datetime(2026, 8, 3),
        updated_at=datetime(2026, 8, 3, 20, 10),  # fetched before 16:15 ET cutoff
    )
    calls = []
    monkeypatch.setattr(cache, "_utc_now", lambda: now)

    def fetch(*args, **kwargs):
        calls.append((args, kwargs))
        return _frame(datetime(2026, 8, 3), close=101.5, adjusted=101.5)

    monkeypatch.setattr(cache, "_fetch_daily", fetch)

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert len(calls) == 1
    assert result.iloc[-1]["Close"] == 101.5
    assert result.attrs["metadata"]["refresh_succeeded"] is True


def test_two_hour_resample_is_anchored_to_0930_exchange_session() -> None:
    index = pd.date_range("2026-08-03 09:30", periods=3, freq="60min", tz="America/New_York")
    frame = pd.DataFrame(
        {
            "Open": [100.0, 101.0, 102.0],
            "High": [101.0, 102.0, 103.0],
            "Low": [99.0, 100.0, 101.0],
            "Close": [100.5, 101.5, 102.5],
            "Volume": [100.0, 200.0, 300.0],
        },
        index=index,
    )

    result = cache._resample_2h_sessions(frame)

    assert len(result) == 2
    assert result.index[0] == pd.Timestamp("2026-08-03 13:30:00")
    assert result.iloc[0]["Open"] == 100.0
    assert result.iloc[0]["Close"] == 101.5
    assert result.iloc[0]["Volume"] == 300.0


def test_two_hour_resample_preserves_clock_bucket_when_an_hour_is_missing() -> None:
    index = pd.DatetimeIndex(
        [
            "2026-08-03 09:30",
            "2026-08-03 11:30",
            "2026-08-03 12:30",
        ],
        tz="America/New_York",
    )
    frame = pd.DataFrame(
        {
            "Open": [100.0, 102.0, 103.0],
            "High": [101.0, 103.0, 104.0],
            "Low": [99.0, 101.0, 102.0],
            "Close": [100.5, 102.5, 103.5],
            "Volume": [100.0, 300.0, 400.0],
        },
        index=index,
    )

    result = cache._resample_2h_sessions(frame)

    assert len(result) == 2
    assert result.index[0] == pd.Timestamp("2026-08-03 13:30:00")
    assert result.iloc[0]["Close"] == 100.5
    assert result.iloc[0]["Volume"] == 100.0
    assert result.index[1] == pd.Timestamp("2026-08-03 15:30:00")
    assert result.iloc[1]["Close"] == 103.5
    assert result.iloc[1]["Volume"] == 700.0


def test_daily_cache_collapses_legacy_timezone_rows_and_prefers_adjusted_contract(
    cache_db,
    monkeypatch,
) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    for day, raw_close, legacy_adjusted_close in (
        (datetime(2026, 7, 30), 101.0, 98.0),
        (datetime(2026, 7, 31), 102.0, 99.0),
    ):
        _seed(
            cache_db,
            interval="1d",
            observed_at=day,
            updated_at=now.replace(tzinfo=None) - timedelta(minutes=2),
            adjusted_close=raw_close - 0.5,
            close=raw_close,
            source="YAHOO",
        )
        _seed(
            cache_db,
            interval="1d",
            observed_at=day + timedelta(hours=4),
            updated_at=now.replace(tzinfo=None) - timedelta(minutes=1),
            adjusted_close=None,
            close=legacy_adjusted_close,
            source="yahoo",
        )

    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(
        cache,
        "_fetch_daily",
        lambda *args, **kwargs: pytest.fail("complete fresh cache should not refresh"),
    )

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert list(result.index) == [pd.Timestamp("2026-07-30"), pd.Timestamp("2026-07-31")]
    assert result.index.is_unique
    assert result["Close"].tolist() == [101.0, 102.0]
    assert result["Adjusted Close"].tolist() == [100.5, 101.5]
    assert result.attrs["metadata"]["adjusted_close_coverage_pct"] == 100.0
    assert result.attrs["metadata"]["discarded_duplicate_session_rows"] == 2


def test_daily_upsert_keeps_complete_row_when_same_source_refresh_lacks_adjusted_close(cache_db) -> None:
    updated_at = datetime(2026, 8, 3, 12, 0)
    _seed(
        cache_db,
        interval="1d",
        observed_at=datetime(2026, 7, 31),
        updated_at=updated_at,
        adjusted_close=99.5,
        close=100.0,
    )
    incoming = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [102.0],
            "Low": [99.0],
            "Close": [101.0],
            "Volume": [1_200_000],
        },
        index=pd.DatetimeIndex(["2026-07-31 00:00:00-04:00"]),
    )

    db = cache_db()
    try:
        cache._upsert_frame(db, "TEST", "1d", incoming, source="yahoo")
        rows = db.query(StockPriceBar).all()
    finally:
        db.close()

    assert len(rows) == 1
    assert rows[0].timestamp == datetime(2026, 7, 31)
    assert rows[0].close == 100.0
    assert rows[0].adjusted_close == 99.5
    assert rows[0].source == "YAHOO"


def test_daily_upsert_does_not_mix_adjusted_yahoo_row_with_raw_ibkr_ohlc(cache_db) -> None:
    _seed(
        cache_db,
        interval="1d",
        observed_at=datetime(2026, 7, 31),
        updated_at=datetime(2026, 8, 3, 12, 0),
        adjusted_close=99.5,
        close=100.0,
        source="YAHOO",
    )
    incoming = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [102.0],
            "Low": [99.0],
            "Close": [101.0],
            "Volume": [1_200_000],
        },
        index=pd.DatetimeIndex(["2026-07-31"]),
    )

    db = cache_db()
    try:
        cache._upsert_frame(db, "TEST", "1d", incoming, source="IBKR")
        rows = db.query(StockPriceBar).all()
    finally:
        db.close()

    assert len(rows) == 1
    assert rows[0].close == 100.0
    assert rows[0].adjusted_close == 99.5
    assert rows[0].source == "YAHOO"


def test_daily_upsert_treats_nan_adjusted_close_as_incomplete(cache_db) -> None:
    _seed(
        cache_db,
        interval="1d",
        observed_at=datetime(2026, 7, 31),
        updated_at=datetime(2026, 8, 3, 12, 0),
        adjusted_close=99.5,
        close=100.0,
        source="YAHOO",
    )
    incoming = _frame(
        datetime(2026, 7, 31),
        close=101.0,
        adjusted=float("nan"),
    )

    db = cache_db()
    try:
        cache._upsert_frame(db, "TEST", "1d", incoming, source="YAHOO")
        rows = db.query(StockPriceBar).all()
    finally:
        db.close()

    assert len(rows) == 1
    assert rows[0].close == 100.0
    assert rows[0].adjusted_close == 99.5
    assert rows[0].source == "YAHOO"


def test_daily_upsert_quality_ranks_duplicates_before_assigning_session_identity(cache_db) -> None:
    incoming = pd.DataFrame(
        {
            "Open": [100.0, 94.0],
            "High": [102.0, 96.0],
            "Low": [99.0, 93.0],
            "Close": [101.0, 95.0],
            "Adjusted Close": [99.5, float("nan")],
            "Volume": [1_200_000, 1_100_000],
        },
        index=pd.DatetimeIndex(["2026-07-31 00:00:00", "2026-07-31 04:00:00"]),
    )

    db = cache_db()
    try:
        cache._upsert_frame(db, "TEST", "1d", incoming, source="YAHOO")
        rows = db.query(StockPriceBar).all()
    finally:
        db.close()

    assert len(rows) == 1
    assert rows[0].timestamp == datetime(2026, 7, 31)
    assert rows[0].close == 101.0
    assert rows[0].adjusted_close == 99.5


@pytest.mark.parametrize("adjusted", [0.0, float("nan"), float("inf")])
def test_adjusted_close_validity_requires_finite_positive_values(adjusted) -> None:
    frame = _frame(datetime(2026, 7, 31), adjusted=adjusted)

    assert cache._has_complete_adjusted_history(frame) is False
    metadata = cache._frame_metadata(
        frame,
        symbol="TEST",
        interval="1d",
        retrieved_at=datetime(2026, 8, 3, tzinfo=timezone.utc),
    )
    assert metadata["adjusted_close_coverage_pct"] == 0.0


def test_daily_fetch_preserves_positive_offset_exchange_session_date(monkeypatch) -> None:
    frame = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [102.0],
            "Low": [99.0],
            "Close": [101.0],
            "Adj Close": [99.5],
            "Volume": [1_200_000],
        },
        index=pd.DatetimeIndex(["2026-08-03 00:00:00"], tz="Asia/Tokyo"),
    )

    class StubTicker:
        def history(self, **kwargs):
            assert kwargs["auto_adjust"] is False
            return frame

    monkeypatch.setattr(cache.yf, "Ticker", lambda _symbol: StubTicker())

    result = cache._fetch_daily(
        "TEST",
        datetime(2026, 8, 1),
        datetime(2026, 8, 5),
    )

    assert list(result.index) == [pd.Timestamp("2026-08-03")]


def test_cached_intraday_read_discards_legacy_whole_hour_grid(cache_db) -> None:
    updated_at = datetime(2026, 8, 3, 12, 0)
    for observed_at in (
        datetime(2026, 6, 8, 12, 0),
        datetime(2026, 6, 8, 13, 30),
        datetime(2026, 6, 8, 13, 30, 30),
        datetime(2026, 6, 8, 14, 0),
        datetime(2026, 6, 8, 15, 30),
        datetime(2026, 6, 8, 16, 0),
        datetime(2026, 6, 8, 17, 30),
        datetime(2026, 6, 8, 18, 0),
        datetime(2026, 6, 8, 19, 30),
    ):
        _seed(
            cache_db,
            interval="2h",
            observed_at=observed_at,
            updated_at=updated_at,
            adjusted_close=None,
        )

    db = cache_db()
    try:
        result = cache._read_cached_frame(
            db,
            "TEST",
            "2h",
            datetime(2026, 6, 8),
            datetime(2026, 6, 9),
        )
    finally:
        db.close()

    assert list(result.index) == [
        pd.Timestamp("2026-06-08 13:30"),
        pd.Timestamp("2026-06-08 15:30"),
        pd.Timestamp("2026-06-08 17:30"),
        pd.Timestamp("2026-06-08 19:30"),
    ]
    assert result.attrs["cache_metadata"]["discarded_noncanonical_rows"] == 5


def test_two_hour_resample_labels_bucket_at_session_boundary_when_open_bar_is_missing() -> None:
    index = pd.DatetimeIndex(
        ["2026-08-03 10:30", "2026-08-03 11:30", "2026-08-03 12:30"],
        tz="America/New_York",
    )
    frame = pd.DataFrame(
        {
            "Open": [101.0, 102.0, 103.0],
            "High": [102.0, 103.0, 104.0],
            "Low": [100.0, 101.0, 102.0],
            "Close": [101.5, 102.5, 103.5],
            "Volume": [200.0, 300.0, 400.0],
        },
        index=index,
    )

    result = cache._resample_2h_sessions(frame)

    assert list(result.index) == [
        pd.Timestamp("2026-08-03 13:30"),
        pd.Timestamp("2026-08-03 15:30"),
    ]
