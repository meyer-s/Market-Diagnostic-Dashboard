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
    engine.dispose()


def _seed(
    session_local,
    *,
    interval: str,
    observed_at: datetime,
    updated_at: datetime,
    adjusted_close: float | None = 100.0,
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
                close=100.0,
                adjusted_close=adjusted_close,
                volume=1_000_000,
                source="YAHOO",
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
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="2h",
        observed_at=now.replace(tzinfo=None) - timedelta(hours=2),
        updated_at=now.replace(tzinfo=None) - timedelta(hours=2),
        adjusted_close=None,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)
    monkeypatch.setattr(cache, "_fetch_2h", lambda *args, **kwargs: _frame(now.replace(tzinfo=None), 102.0, None))

    result = cache.get_cached_intraday_frame("TEST", days=10)

    assert result.iloc[-1]["Close"] == 102.0
    assert result.attrs["metadata"]["refresh_attempted"] is True
    assert result.attrs["metadata"]["refresh_succeeded"] is True


def test_partial_adjusted_history_uses_one_raw_basis_without_scale_break(cache_db, monkeypatch) -> None:
    now = datetime(2026, 8, 3, 15, 0, tzinfo=timezone.utc)
    _seed(
        cache_db,
        interval="1d",
        observed_at=now.replace(tzinfo=None) - timedelta(days=1),
        updated_at=now.replace(tzinfo=None) - timedelta(minutes=1),
        adjusted_close=None,
    )
    monkeypatch.setattr(cache, "_utc_now", lambda: now)

    result = cache.get_or_refresh_daily_frame("TEST", days=10)

    assert result.attrs["metadata"]["return_basis"] == "raw_close_fallback"
    assert result.attrs["metadata"]["adjusted_close_coverage_pct"] == 0.0


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
