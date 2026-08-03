from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from typing import Optional

import pandas as pd
import yfinance as yf
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.stock_price_bar import StockPriceBar
from app.utils.db_helpers import get_db_session


DAILY_CACHE_TTL_SECONDS = max(
    60,
    int(os.getenv("STOCK_DAILY_CACHE_TTL_SECONDS", "900")),
)
INTRADAY_CACHE_TTL_SECONDS = max(
    60,
    int(os.getenv("STOCK_INTRADAY_CACHE_TTL_SECONDS", "900")),
)
MAX_MISSING_BUSINESS_SESSIONS = 2


def _normalize_symbol(symbol: str) -> str:
    return (symbol or "").strip().upper()


def _normalize_download_frame(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    normalized = df.copy()
    if isinstance(normalized.columns, pd.MultiIndex):
        try:
            normalized = normalized.droplevel(-1, axis=1)
        except Exception:
            try:
                normalized = normalized.xs(symbol, axis=1, level=-1)
            except Exception:
                return pd.DataFrame()
    return normalized


def _coerce_ohlcv_frame(df: pd.DataFrame, *, preserve_timezone: bool = False) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()

    frame = df.copy()
    if isinstance(frame.columns, pd.MultiIndex):
        try:
            frame.columns = frame.columns.get_level_values(0)
        except Exception:
            return pd.DataFrame()

    needed = ["Open", "High", "Low", "Close"]
    if any(col not in frame.columns for col in needed):
        return pd.DataFrame()

    frame.index = pd.to_datetime(frame.index, errors="coerce")
    frame = frame[frame.index.notna()]
    if frame.empty:
        return pd.DataFrame()

    if (
        isinstance(frame.index, pd.DatetimeIndex)
        and frame.index.tz is not None
        and not preserve_timezone
    ):
        frame.index = frame.index.tz_convert(None)

    out = pd.DataFrame(index=frame.index)
    out["Open"] = pd.to_numeric(frame["Open"], errors="coerce")
    out["High"] = pd.to_numeric(frame["High"], errors="coerce")
    out["Low"] = pd.to_numeric(frame["Low"], errors="coerce")
    out["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
    adjusted_column = (
        "Adj Close"
        if "Adj Close" in frame.columns
        else "Adjusted Close"
        if "Adjusted Close" in frame.columns
        else None
    )
    if adjusted_column is not None:
        out["Adjusted Close"] = pd.to_numeric(frame[adjusted_column], errors="coerce")
    out["Volume"] = pd.to_numeric(frame["Volume"], errors="coerce") if "Volume" in frame.columns else None

    out = out.dropna(subset=["Open", "High", "Low", "Close"]).sort_index()
    return out


def _as_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(value: Optional[datetime | pd.Timestamp]) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat()


def _age_seconds(now: datetime, value: Optional[datetime | pd.Timestamp]) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return max(0.0, (pd.Timestamp(now) - timestamp).total_seconds())


def _business_session_lag(
    now: datetime,
    value: Optional[datetime | pd.Timestamp],
) -> Optional[int]:
    if value is None or pd.isna(value):
        return None
    observed = pd.Timestamp(value)
    if observed.tzinfo is not None:
        observed = observed.tz_convert("America/New_York").tz_localize(None)
    current = pd.Timestamp(now)
    if current.tzinfo is not None:
        current = current.tz_convert("America/New_York").tz_localize(None)
    if observed.date() >= current.date():
        return 0
    # Counting business dates (instead of elapsed hours) makes Friday-to-Monday
    # and a one-day market holiday safe. A two-session allowance also absorbs a
    # holiday that is not represented by pandas' weekday calendar.
    return max(0, len(pd.bdate_range(observed.normalize(), current.normalize())) - 1)


def _frame_metadata(
    frame: pd.DataFrame,
    *,
    symbol: str,
    interval: str,
    retrieved_at: datetime,
    refresh_attempted: bool = False,
    refresh_succeeded: Optional[bool] = None,
    refresh_error: Optional[str] = None,
) -> dict:
    stored = dict(frame.attrs.get("cache_metadata") or {})
    observed_at = stored.get("observed_at")
    cache_updated_at = stored.get("cache_updated_at")
    observation_age = _age_seconds(retrieved_at, observed_at)
    business_session_lag = _business_session_lag(retrieved_at, observed_at)
    adjusted_coverage = None
    if interval == "1d" and not frame.empty:
        adjusted = frame.get("Adjusted Close")
        adjusted_coverage = (
            round(float(adjusted.notna().mean() * 100.0), 1)
            if adjusted is not None
            else 0.0
        )
    return {
        "symbol": symbol,
        "interval": interval,
        "source": stored.get("source") or "YAHOO",
        "observed_at": _utc_iso(observed_at),
        "retrieved_at": _utc_iso(retrieved_at),
        "cache_updated_at": _utc_iso(cache_updated_at),
        "cache_age_seconds": round(_age_seconds(retrieved_at, cache_updated_at) or 0.0, 1)
        if cache_updated_at is not None
        else None,
        "observation_age_seconds": round(observation_age, 1)
        if observation_age is not None
        else None,
        "business_session_lag": business_session_lag,
        "stale": (
            business_session_lag is None
            or business_session_lag > MAX_MISSING_BUSINESS_SESSIONS
            or refresh_succeeded is False
        ),
        "refresh_attempted": refresh_attempted,
        "refresh_succeeded": refresh_succeeded,
        "refresh_error": refresh_error,
        "adjusted_close_coverage_pct": adjusted_coverage,
        "partial_session_withheld": bool(stored.get("partial_session_withheld")),
    }


def _fetch_daily(symbol: str, start: datetime, end: datetime, full_history: bool = False) -> pd.DataFrame:
    start_naive = _as_naive_utc(start)
    end_naive = _as_naive_utc(end)

    attempts = [
        (
            lambda: yf.Ticker(symbol).history(period="max", auto_adjust=False)
            if full_history
            else yf.Ticker(symbol).history(start=start_naive, end=end_naive, auto_adjust=False)
        ),
        lambda: _normalize_download_frame(
            yf.download(
                symbol,
                period="max" if full_history else None,
                start=None if full_history else start_naive,
                end=None if full_history else end_naive,
                progress=False,
                threads=False,
                auto_adjust=False,
            ),
            symbol,
        ),
    ]

    errors: list[str] = []
    for attempt in attempts:
        try:
            frame = _coerce_ohlcv_frame(attempt())
            if not frame.empty:
                # Yahoo daily indices are exchange-midnight timestamps. Persist
                # canonical session dates rather than UTC-shifted wall times.
                frame.index = pd.DatetimeIndex(frame.index).normalize()
                return frame
            errors.append("no rows")
        except Exception as exc:
            errors.append(str(exc))
    raise HTTPException(status_code=404, detail=f"Unable to fetch daily candles for {symbol}: {'; '.join(errors)}")


def _fetch_2h(symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
    # Yahoo does not provide a native 2h interval; fetch 60m and resample.
    start_naive = _as_naive_utc(start)
    end_naive = _as_naive_utc(end)
    raw = _normalize_download_frame(
        yf.download(
            symbol,
            start=start_naive,
            end=end_naive,
            interval="60m",
            progress=False,
            threads=False,
            auto_adjust=False,
        ),
        symbol,
    )
    frame = _coerce_ohlcv_frame(raw, preserve_timezone=True)
    if frame.empty:
        return frame

    return _resample_2h_sessions(frame)


def _resample_2h_sessions(frame: pd.DataFrame) -> pd.DataFrame:
    """Aggregate 60m bars in pairs anchored to each 09:30 ET session."""
    if frame is None or frame.empty:
        return pd.DataFrame()
    working = frame.copy()
    if working.index.tz is None:
        working.index = working.index.tz_localize("UTC")
    working.index = working.index.tz_convert("America/New_York")
    working = working.between_time("09:30", "15:59")
    pieces: list[pd.DataFrame] = []
    for session_date, session_frame in working.groupby(working.index.date, sort=True):
        if session_frame.empty:
            continue
        session_frame = session_frame.sort_index()
        session_open = pd.Timestamp(session_date, tz="America/New_York") + pd.Timedelta(hours=9, minutes=30)
        # Anchor buckets to exchange clock time, not row position. A missing
        # hourly bar must leave a gap instead of pulling a later bar backward.
        bucket = pd.Series(
            ((session_frame.index - session_open).total_seconds() // (2 * 60 * 60)).astype(int),
            index=session_frame.index,
        )
        aggregated = session_frame.groupby(bucket).agg(
            Open=("Open", "first"),
            High=("High", "max"),
            Low=("Low", "min"),
            Close=("Close", "last"),
            Volume=("Volume", lambda values: values.sum(min_count=1)),
        )
        first_indexes = [group.index[0] for _, group in session_frame.groupby(bucket)]
        aggregated.index = pd.DatetimeIndex(first_indexes)
        pieces.append(aggregated)
    if not pieces:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    result = pd.concat(pieces).sort_index()
    # Database timestamps are UTC-naive by schema convention; response
    # serialization restores the explicit +00:00 offset.
    result.index = result.index.tz_convert("UTC").tz_localize(None)
    return result


def _completed_daily_frame(frame: pd.DataFrame, now: datetime) -> pd.DataFrame:
    if frame is None or frame.empty:
        return frame
    current = pd.Timestamp(now)
    if current.tzinfo is None:
        current = current.tz_localize("UTC")
    current_et = current.tz_convert("America/New_York")
    latest = pd.Timestamp(frame.index.max())
    latest_date = latest.date()
    is_current_weekday = latest_date == current_et.date() and current_et.weekday() < 5
    session_finalized = (current_et.hour, current_et.minute) >= (16, 15)
    if is_current_weekday and not session_finalized:
        completed = frame[pd.DatetimeIndex(frame.index).date < current_et.date()].copy()
        completed.attrs.update(frame.attrs)
        if not completed.empty:
            cache_metadata = dict(completed.attrs.get("cache_metadata") or {})
            cache_metadata["observed_at"] = completed.index.max()
            cache_metadata["partial_session_withheld"] = True
            completed.attrs["cache_metadata"] = cache_metadata
        return completed
    return frame


def _needs_daily_finalization_refresh(
    frame: pd.DataFrame,
    now: datetime,
    cache_updated_at: Optional[datetime | pd.Timestamp | str],
) -> bool:
    """Refresh a same-day row once after the regular session is finalized."""
    if frame is None or frame.empty or cache_updated_at is None:
        return False
    current = pd.Timestamp(now)
    if current.tzinfo is None:
        current = current.tz_localize("UTC")
    current_et = current.tz_convert("America/New_York")
    if current_et.weekday() >= 5 or (current_et.hour, current_et.minute) < (16, 15):
        return False
    latest = pd.Timestamp(frame.index.max())
    if latest.date() != current_et.date():
        return False
    updated = pd.to_datetime(cache_updated_at, errors="coerce", utc=True)
    if pd.isna(updated):
        return True
    finalization_cutoff_et = current_et.normalize() + pd.Timedelta(hours=16, minutes=15)
    return pd.Timestamp(updated) < finalization_cutoff_et.tz_convert("UTC")


def _read_cached_frame(db: Session, symbol: str, interval: str, start: datetime, end: datetime) -> pd.DataFrame:
    rows = (
        db.query(StockPriceBar)
        .filter(
            StockPriceBar.symbol == symbol,
            StockPriceBar.interval == interval,
            StockPriceBar.timestamp >= start,
            StockPriceBar.timestamp <= end,
        )
        .order_by(StockPriceBar.timestamp.asc())
        .all()
    )
    if not rows:
        return pd.DataFrame()

    frame = pd.DataFrame(
        {
            "Open": [float(row.open) for row in rows],
            "High": [float(row.high) for row in rows],
            "Low": [float(row.low) for row in rows],
            "Close": [float(row.close) for row in rows],
            "Adjusted Close": [
                float(row.adjusted_close) if row.adjusted_close is not None else None
                for row in rows
            ],
            "Volume": [float(row.volume) if row.volume is not None else None for row in rows],
        },
        index=pd.DatetimeIndex([row.timestamp for row in rows]),
    )
    frame = frame.sort_index()
    latest_row = max(rows, key=lambda row: row.timestamp)
    updated_values = [row.updated_at for row in rows if row.updated_at is not None]
    frame.attrs["cache_metadata"] = {
        "source": latest_row.source,
        "observed_at": latest_row.timestamp,
        "cache_updated_at": max(updated_values) if updated_values else None,
    }
    return frame


def _upsert_frame(db: Session, symbol: str, interval: str, frame: pd.DataFrame, source: str = "YAHOO") -> int:
    if frame is None or frame.empty:
        return 0

    frame = frame.sort_index()
    ts_values = [pd.Timestamp(idx).to_pydatetime().replace(tzinfo=None) for idx in frame.index]
    if not ts_values:
        return 0

    min_ts = min(ts_values)
    max_ts = max(ts_values)
    existing = (
        db.query(StockPriceBar)
        .filter(
            StockPriceBar.symbol == symbol,
            StockPriceBar.interval == interval,
            StockPriceBar.timestamp >= min_ts,
            StockPriceBar.timestamp <= max_ts,
        )
        .all()
    )
    existing_by_ts = {row.timestamp: row for row in existing}

    inserts = 0
    for idx, row in frame.iterrows():
        ts = pd.Timestamp(idx).to_pydatetime().replace(tzinfo=None)
        now_utc = datetime.utcnow()
        adjusted_close = row.get("Adjusted Close")
        payload = {
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "adjusted_close": float(adjusted_close) if pd.notna(adjusted_close) else None,
            "volume": float(row["Volume"]) if pd.notna(row.get("Volume")) else None,
            "source": source,
            "updated_at": now_utc,
        }

        existing_row = existing_by_ts.get(ts)
        if existing_row is not None:
            existing_row.open = payload["open"]
            existing_row.high = payload["high"]
            existing_row.low = payload["low"]
            existing_row.close = payload["close"]
            existing_row.adjusted_close = payload["adjusted_close"]
            existing_row.volume = payload["volume"]
            existing_row.source = payload["source"]
            existing_row.updated_at = payload["updated_at"]
            continue

        db.add(
            StockPriceBar(
                symbol=symbol,
                interval=interval,
                timestamp=ts,
                open=payload["open"],
                high=payload["high"],
                low=payload["low"],
                close=payload["close"],
                adjusted_close=payload["adjusted_close"],
                volume=payload["volume"],
                source=payload["source"],
                created_at=datetime.utcnow(),
                updated_at=payload["updated_at"],
            )
        )
        inserts += 1

    db.commit()
    return inserts


def ensure_symbol_history(
    symbol: str,
    *,
    years: int = 10,
    full_history: bool = True,
    include_2h: bool = True,
    intraday_days: int = 252,
) -> dict:
    symbol = _normalize_symbol(symbol)
    now = datetime.utcnow()
    daily_start = now - timedelta(days=max(365 * years, 365 * 5))
    daily_end = now + timedelta(days=1)

    with get_db_session() as db:
        daily_frame = _fetch_daily(symbol, daily_start, daily_end, full_history=full_history)
        daily_inserts = _upsert_frame(db, symbol, "1d", daily_frame)

        intraday_inserts = 0
        intraday_rows = 0
        if include_2h:
            # 60m coverage is typically limited, so bound lookback to ~730 days.
            lookback_days = min(max(intraday_days + 7, 30), 730)
            intra_start = now - timedelta(days=lookback_days)
            intra_end = now + timedelta(days=1)
            two_hour = _fetch_2h(symbol, intra_start, intra_end)
            intraday_rows = int(len(two_hour))
            if not two_hour.empty:
                intraday_inserts = _upsert_frame(db, symbol, "2h", two_hour)

        return {
            "symbol": symbol,
            "full_history": bool(full_history),
            "daily_rows_fetched": int(len(daily_frame)),
            "daily_rows_inserted": int(daily_inserts),
            "intraday_rows_fetched": int(intraday_rows),
            "intraday_rows_inserted": int(intraday_inserts),
        }


def get_or_refresh_daily_frame(symbol: str, days: int = 2000) -> pd.DataFrame:
    symbol = _normalize_symbol(symbol)
    now_aware = _utc_now()
    now = now_aware.replace(tzinfo=None)
    start = now - timedelta(days=days + 7)
    end = now + timedelta(days=1)

    with get_db_session() as db:
        cached = _read_cached_frame(db, symbol, "1d", start, end)
    metadata = _frame_metadata(
        cached,
        symbol=symbol,
        interval="1d",
        retrieved_at=now_aware,
    )
    refresh_needed = (
        cached.empty
        or metadata.get("cache_age_seconds") is None
        or float(metadata["cache_age_seconds"]) >= DAILY_CACHE_TTL_SECONDS
        or _needs_daily_finalization_refresh(
            cached,
            now_aware,
            metadata.get("cache_updated_at"),
        )
    )
    refresh_attempted = False
    refresh_succeeded: Optional[bool] = None
    refresh_error: Optional[str] = None

    if cached.empty:
        # First hit for a symbol: build durable full available daily history.
        refresh_attempted = True
        ensure_symbol_history(symbol, years=10, full_history=True, include_2h=False, intraday_days=252)
        refresh_succeeded = True
        with get_db_session() as db:
            cached = _read_cached_frame(db, symbol, "1d", start, end)
    elif refresh_needed:
        refresh_attempted = True
        try:
            adjusted = cached.get("Adjusted Close")
            adjusted_missing = adjusted is None or bool(adjusted.isna().any())
            latest_ts = pd.Timestamp(cached.index.max()).to_pydatetime().replace(tzinfo=None)
            # A migration-era cache can contain no adjusted closes. Re-fetch the
            # requested history once its TTL expires so total-return coverage is
            # repaired, rather than only refreshing the newest overlap.
            refresh_start = start if adjusted_missing else latest_ts - timedelta(days=7)
            refreshed = _fetch_daily(symbol, refresh_start, end, full_history=False)
            if refreshed.empty:
                raise RuntimeError("upstream returned no daily bars")
            with get_db_session() as db:
                _upsert_frame(db, symbol, "1d", refreshed)
                cached = _read_cached_frame(db, symbol, "1d", start, end)
            refresh_succeeded = True
        except Exception as exc:
            # Existing rows are the last-known-good fallback. The error remains
            # attached to the frame so API callers cannot mistake it for fresh.
            refresh_succeeded = False
            refresh_error = str(exc)

    if cached.empty:
        raise HTTPException(status_code=404, detail=f"No cached daily candles available for {symbol}")

    cached = _completed_daily_frame(cached.sort_index(), _utc_now())
    if cached.empty:
        raise HTTPException(status_code=404, detail=f"No completed daily candles available for {symbol}")
    adjusted = cached.get("Adjusted Close")
    adjusted_complete = bool(
        adjusted is not None
        and adjusted.notna().all()
        and (pd.to_numeric(adjusted, errors="coerce") > 0).all()
    )
    total_return_price = adjusted if adjusted_complete else cached["Close"]
    cached["price_returns"] = cached["Close"].pct_change()
    cached["returns"] = total_return_price.pct_change()
    cached.attrs["metadata"] = _frame_metadata(
        cached,
        symbol=symbol,
        interval="1d",
        retrieved_at=_utc_now(),
        refresh_attempted=refresh_attempted,
        refresh_succeeded=refresh_succeeded,
        refresh_error=refresh_error,
    )
    cached.attrs["metadata"]["return_basis"] = (
        "adjusted_close" if adjusted_complete else "raw_close_fallback"
    )
    return cached


def get_cached_intraday_frame(symbol: str, days: int = 252) -> pd.DataFrame:
    symbol = _normalize_symbol(symbol)
    now_aware = _utc_now()
    now = now_aware.replace(tzinfo=None)
    start = now - timedelta(days=max(days + 7, 30))
    end = now + timedelta(days=1)

    with get_db_session() as db:
        cached = _read_cached_frame(db, symbol, "2h", start, end)
    metadata = _frame_metadata(
        cached,
        symbol=symbol,
        interval="2h",
        retrieved_at=now_aware,
    )
    refresh_needed = (
        cached.empty
        or metadata.get("cache_age_seconds") is None
        or float(metadata["cache_age_seconds"]) >= INTRADAY_CACHE_TTL_SECONDS
    )
    refresh_attempted = False
    refresh_succeeded: Optional[bool] = None
    refresh_error: Optional[str] = None

    if refresh_needed:
        refresh_attempted = True
        try:
            fetch_start = start
            if not cached.empty:
                fetch_start = pd.Timestamp(cached.index.max()).to_pydatetime().replace(tzinfo=None) - timedelta(days=7)
            refreshed = _fetch_2h(symbol, fetch_start, end)
            if refreshed.empty:
                raise RuntimeError("upstream returned no intraday bars")
            with get_db_session() as db:
                _upsert_frame(db, symbol, "2h", refreshed)
                cached = _read_cached_frame(db, symbol, "2h", start, end)
            refresh_succeeded = True
        except Exception as exc:
            refresh_succeeded = False
            refresh_error = str(exc)

    if cached.empty:
        empty = pd.DataFrame()
        empty.attrs["metadata"] = _frame_metadata(
            empty,
            symbol=symbol,
            interval="2h",
            retrieved_at=_utc_now(),
            refresh_attempted=refresh_attempted,
            refresh_succeeded=refresh_succeeded,
            refresh_error=refresh_error,
        )
        return empty

    cached = cached.sort_index()
    cached.attrs["metadata"] = _frame_metadata(
        cached,
        symbol=symbol,
        interval="2h",
        retrieved_at=_utc_now(),
        refresh_attempted=refresh_attempted,
        refresh_succeeded=refresh_succeeded,
        refresh_error=refresh_error,
    )
    return cached
