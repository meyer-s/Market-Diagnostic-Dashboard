from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
import math
import os
import threading
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
CANONICAL_2H_SESSION_TIMES = {(9, 30), (11, 30), (13, 30), (15, 30)}
_refresh_attempt_lock = threading.Lock()
_refresh_attempts: dict[tuple[str, str], tuple[datetime, str]] = {}
_MAX_REFRESH_ATTEMPTS = 1_024


def _normalize_symbol(symbol: str) -> str:
    return (symbol or "").strip().upper()


def _normalize_source_label(source: object) -> str:
    cleaned = str(source or "UNKNOWN").strip()
    if cleaned.lower() in {"yahoo", "ibkr"}:
        return cleaned.upper()
    return cleaned


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


def _storage_timestamp(value: object, interval: str) -> datetime:
    """Return the canonical database identity for one market-data bar."""
    timestamp = pd.Timestamp(value)
    if pd.isna(timestamp):
        raise ValueError("bar timestamp is missing")
    if interval == "1d":
        # Daily providers encode a market-session date, not an instant. Preserve
        # that displayed date even when the source attaches an exchange offset.
        return datetime.combine(timestamp.date(), time.min)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert("UTC").tz_localize(None)
    return timestamp.to_pydatetime().replace(tzinfo=None)


def _is_canonical_2h_timestamp(value: object) -> bool:
    timestamp = pd.Timestamp(value)
    if pd.isna(timestamp):
        return False
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    exchange_time = timestamp.tz_convert("America/New_York")
    return (
        (exchange_time.hour, exchange_time.minute) in CANONICAL_2H_SESSION_TIMES
        and exchange_time.second == 0
        and exchange_time.microsecond == 0
    )


def _has_valid_adjusted_close(value: object) -> bool:
    try:
        adjusted = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(adjusted) and adjusted > 0


def _valid_adjusted_close_mask(frame: pd.DataFrame) -> pd.Series:
    if frame is None or frame.empty or "Adjusted Close" not in frame.columns:
        index = frame.index if isinstance(frame, pd.DataFrame) else None
        return pd.Series(False, index=index, dtype=bool)
    adjusted = pd.to_numeric(frame["Adjusted Close"], errors="coerce")
    return adjusted.map(_has_valid_adjusted_close).astype(bool)


def _has_complete_adjusted_history(frame: pd.DataFrame) -> bool:
    valid = _valid_adjusted_close_mask(frame)
    return bool(len(valid) > 0 and valid.all())


def _canonicalize_incoming_frame(frame: pd.DataFrame, interval: str) -> pd.DataFrame:
    """Choose one quality-ranked writer row before assigning storage identity."""
    working = frame.copy()
    working.index.name = None
    original_index = list(working.index)
    storage_timestamps = [_storage_timestamp(value, interval) for value in original_index]

    if interval == "1d":
        timestamp_column = "__cache_storage_timestamp"
        adjusted_column = "__cache_has_adjusted"
        canonical_column = "__cache_is_canonical"
        order_column = "__cache_source_order"
        adjusted_values = (
            working["Adjusted Close"].tolist()
            if "Adjusted Close" in working.columns
            else [None] * len(working)
        )
        working[timestamp_column] = storage_timestamps
        working[adjusted_column] = [
            _has_valid_adjusted_close(value) for value in adjusted_values
        ]
        working[canonical_column] = [
            pd.Timestamp(value).time() == time.min for value in original_index
        ]
        working[order_column] = range(len(working))
        working = working.sort_values(
            [timestamp_column, adjusted_column, canonical_column, order_column],
            kind="stable",
        ).drop_duplicates(subset=[timestamp_column], keep="last")
        working.index = pd.DatetimeIndex(working.pop(timestamp_column), name=None)
        working = working.drop(
            columns=[adjusted_column, canonical_column, order_column]
        )
    else:
        working.index = pd.DatetimeIndex(storage_timestamps, name=None)
        working = working[~working.index.duplicated(keep="last")]

    return working.sort_index()


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


def _intraday_coverage_incomplete(
    frame: pd.DataFrame,
    requested_start: datetime,
) -> bool:
    if frame is None or frame.empty:
        return True
    index = pd.to_datetime(frame.index, errors="coerce", utc=True)
    index = index[~pd.isna(index)]
    if len(index) == 0 or pd.Timestamp(index.min()).tz_convert(None) > requested_start + timedelta(days=7):
        return True

    local_session_dates = [
        pd.Timestamp(value).tz_convert("America/New_York").date()
        for value in index
    ]
    session_counts = pd.Series(local_session_dates, dtype=object).value_counts()
    session_dates = sorted(session_counts.index)
    for previous, current in zip(session_dates, session_dates[1:]):
        # Weekends and ordinary exchange holidays are expected. A gap larger
        # than five business dates indicates a materially sparse cache.
        missing_business_dates = max(
            0,
            len(pd.bdate_range(previous, current)) - 2,
        )
        if missing_business_dates > 5:
            return True
    completed_counts = session_counts.drop(labels=[session_dates[-1]], errors="ignore")
    if len(completed_counts) >= 3 and float(completed_counts.mean()) < 3.0:
        return True
    return False


def _claim_refresh_attempt(
    symbol: str,
    interval: str,
    now: datetime,
    cooldown_seconds: int,
) -> tuple[bool, Optional[str]]:
    key = (symbol, interval)
    with _refresh_attempt_lock:
        _prune_refresh_attempts(now)
        previous = _refresh_attempts.get(key)
        if previous is not None:
            attempted_at, error = previous
            age_seconds = _age_seconds(now, attempted_at)
            if age_seconds is not None and age_seconds < cooldown_seconds:
                return False, error
        _make_refresh_attempt_room(key)
        _refresh_attempts[key] = (now, "refresh recently attempted")
    return True, None


def _record_refresh_failure(
    symbol: str,
    interval: str,
    now: datetime,
    error: str,
) -> None:
    with _refresh_attempt_lock:
        _prune_refresh_attempts(now)
        _make_refresh_attempt_room((symbol, interval))
        _refresh_attempts[(symbol, interval)] = (now, error)


def _clear_refresh_attempt(symbol: str, interval: str) -> None:
    with _refresh_attempt_lock:
        _refresh_attempts.pop((symbol, interval), None)


def _prune_refresh_attempts(now: datetime) -> None:
    expired = []
    for key, (attempted_at, _error) in _refresh_attempts.items():
        interval = key[1]
        cooldown = (
            DAILY_CACHE_TTL_SECONDS
            if interval == "1d"
            else INTRADAY_CACHE_TTL_SECONDS
        )
        age_seconds = _age_seconds(now, attempted_at)
        if age_seconds is None or age_seconds >= cooldown:
            expired.append(key)
    for key in expired:
        _refresh_attempts.pop(key, None)


def _make_refresh_attempt_room(key: tuple[str, str]) -> None:
    if key in _refresh_attempts or len(_refresh_attempts) < _MAX_REFRESH_ATTEMPTS:
        return
    oldest_key = min(
        _refresh_attempts,
        key=lambda candidate: _refresh_attempts[candidate][0],
    )
    _refresh_attempts.pop(oldest_key, None)


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
        adjusted_coverage = round(
            float(_valid_adjusted_close_mask(frame).mean() * 100.0),
            1,
        )
    return {
        "symbol": symbol,
        "interval": interval,
        "source": _normalize_source_label(stored.get("source") or "YAHOO"),
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
        "discarded_duplicate_session_rows": int(stored.get("discarded_duplicate_session_rows") or 0),
        "discarded_noncanonical_rows": int(stored.get("discarded_noncanonical_rows") or 0),
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
            frame = _coerce_ohlcv_frame(attempt(), preserve_timezone=True)
            if not frame.empty:
                # Yahoo daily indices are exchange-midnight timestamps. Persist
                # canonical session dates rather than UTC-shifted wall times.
                frame.index = pd.DatetimeIndex(
                    [datetime.combine(pd.Timestamp(value).date(), time.min) for value in frame.index]
                )
                if _has_complete_adjusted_history(frame):
                    return frame
                errors.append("incomplete adjusted-close history")
                continue
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
        aggregated.index = pd.DatetimeIndex(
            [session_open + pd.Timedelta(hours=2 * int(bucket_id)) for bucket_id in aggregated.index]
        )
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

    duplicate_session_rows = 0
    noncanonical_rows = 0
    if interval == "1d":
        rows_by_session: dict[object, list[StockPriceBar]] = {}
        for row in rows:
            rows_by_session.setdefault(row.timestamp.date(), []).append(row)

        selected_rows: list[StockPriceBar] = []
        for session_rows in rows_by_session.values():
            duplicate_session_rows += max(0, len(session_rows) - 1)

            def daily_rank(candidate: StockPriceBar) -> tuple[bool, bool, datetime, int]:
                has_adjusted = _has_valid_adjusted_close(candidate.adjusted_close)
                updated_at = candidate.updated_at or candidate.created_at or datetime.min
                is_canonical = candidate.timestamp.time() == time.min
                return has_adjusted, is_canonical, updated_at, int(candidate.id or 0)

            selected_rows.append(max(session_rows, key=daily_rank))
        rows = sorted(selected_rows, key=lambda row: row.timestamp.date())
        frame_index = pd.DatetimeIndex(
            [datetime.combine(row.timestamp.date(), time.min) for row in rows]
        )
    elif interval == "2h":
        canonical_rows = [row for row in rows if _is_canonical_2h_timestamp(row.timestamp)]
        noncanonical_rows = len(rows) - len(canonical_rows)
        rows = canonical_rows
        frame_index = pd.DatetimeIndex([row.timestamp for row in rows])
    else:
        frame_index = pd.DatetimeIndex([row.timestamp for row in rows])

    if not rows:
        frame = pd.DataFrame()
        frame.attrs["cache_metadata"] = {
            "discarded_duplicate_session_rows": duplicate_session_rows,
            "discarded_noncanonical_rows": noncanonical_rows,
            "_row_sources": [],
            "_row_updated_at": [],
        }
        return frame

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
        index=frame_index,
    )
    frame = frame.sort_index()
    latest_row = max(rows, key=lambda row: row.timestamp)
    updated_values = [row.updated_at for row in rows if row.updated_at is not None]
    frame.attrs["cache_metadata"] = {
        "source": _normalize_source_label(latest_row.source),
        "observed_at": frame.index.max(),
        "cache_updated_at": max(updated_values) if updated_values else None,
        "discarded_duplicate_session_rows": duplicate_session_rows,
        "discarded_noncanonical_rows": noncanonical_rows,
        "_row_sources": [_normalize_source_label(row.source) for row in rows],
        "_row_updated_at": [row.updated_at for row in rows],
    }
    return frame


def _upsert_frame(db: Session, symbol: str, interval: str, frame: pd.DataFrame, source: str = "YAHOO") -> int:
    if frame is None or frame.empty:
        return 0

    frame = _canonicalize_incoming_frame(frame, interval)
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
    normalized_source = _normalize_source_label(source)
    has_adjusted_column = "Adjusted Close" in frame.columns
    for idx, row in frame.iterrows():
        ts = pd.Timestamp(idx).to_pydatetime().replace(tzinfo=None)
        now_utc = datetime.utcnow()
        adjusted_close = row.get("Adjusted Close")
        normalized_adjusted_close = (
            float(adjusted_close)
            if has_adjusted_column and _has_valid_adjusted_close(adjusted_close)
            else None
        )
        payload = {
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "adjusted_close": normalized_adjusted_close,
            "volume": float(row["Volume"]) if pd.notna(row.get("Volume")) else None,
            "source": normalized_source,
            "updated_at": now_utc,
        }

        existing_row = existing_by_ts.get(ts)
        if existing_row is not None:
            existing_has_adjusted = _has_valid_adjusted_close(existing_row.adjusted_close)
            incoming_has_adjusted = _has_valid_adjusted_close(payload["adjusted_close"])
            # Adjusted closes are provider-relative. Never combine an existing
            # complete row with raw-only replacement values. Keeping the whole
            # last-known-good row avoids a stale adjustment/raw-price mismatch,
            # even when both writes name the same provider.
            if (
                interval == "1d"
                and existing_has_adjusted
                and not incoming_has_adjusted
            ):
                continue
            existing_row.open = payload["open"]
            existing_row.high = payload["high"]
            existing_row.low = payload["low"]
            existing_row.close = payload["close"]
            if incoming_has_adjusted or not existing_has_adjusted:
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
        if not _has_complete_adjusted_history(daily_frame):
            raise RuntimeError("upstream returned incomplete adjusted-close history")
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
    adjusted_missing = bool(
        not cached.empty and not _has_complete_adjusted_history(cached)
    )
    cache_expired = bool(
        metadata.get("cache_age_seconds") is None
        or float(metadata["cache_age_seconds"]) >= DAILY_CACHE_TTL_SECONDS
    )
    refresh_needed = (
        cached.empty
        or adjusted_missing
        or cache_expired
        or _needs_daily_finalization_refresh(
            cached,
            now_aware,
            metadata.get("cache_updated_at"),
        )
    )
    refresh_attempted = False
    refresh_succeeded: Optional[bool] = None
    refresh_error: Optional[str] = None
    refresh_deferred = False

    if refresh_needed:
        claimed, recent_error = _claim_refresh_attempt(
            symbol,
            "1d",
            now_aware,
            DAILY_CACHE_TTL_SECONDS,
        )
        if not claimed:
            refresh_needed = False
            refresh_succeeded = False
            refresh_error = recent_error
            refresh_deferred = True

    if cached.empty and refresh_needed:
        # First hit for a symbol: build durable full available daily history.
        refresh_attempted = True
        try:
            ensure_symbol_history(
                symbol,
                years=10,
                full_history=True,
                include_2h=False,
                intraday_days=252,
            )
            refresh_succeeded = True
            _clear_refresh_attempt(symbol, "1d")
            with get_db_session() as db:
                cached = _read_cached_frame(db, symbol, "1d", start, end)
        except Exception as exc:
            refresh_succeeded = False
            refresh_error = str(exc)
            _record_refresh_failure(symbol, "1d", now_aware, refresh_error)
            raise
    elif refresh_needed:
        refresh_attempted = True
        try:
            latest_ts = pd.Timestamp(cached.index.max()).to_pydatetime().replace(tzinfo=None)
            # A migration-era or lower-information writer can leave no adjusted
            # closes. Re-fetch the requested history rather than only refreshing
            # the newest overlap.
            refresh_start = start if adjusted_missing else latest_ts - timedelta(days=7)
            refreshed = _fetch_daily(symbol, refresh_start, end, full_history=False)
            if refreshed.empty:
                raise RuntimeError("upstream returned no daily bars")
            if not _has_complete_adjusted_history(refreshed):
                raise RuntimeError("upstream returned incomplete adjusted-close history")
            with get_db_session() as db:
                _upsert_frame(db, symbol, "1d", refreshed)
                cached = _read_cached_frame(db, symbol, "1d", start, end)
            if not _has_complete_adjusted_history(cached):
                raise RuntimeError("cache refresh did not restore adjusted-close history")
            refresh_succeeded = True
            _clear_refresh_attempt(symbol, "1d")
        except Exception as exc:
            # Existing rows are the last-known-good fallback. The error remains
            # attached to the frame so API callers cannot mistake it for fresh.
            refresh_succeeded = False
            refresh_error = str(exc)
            _record_refresh_failure(symbol, "1d", now_aware, refresh_error)

    if cached.empty:
        if refresh_deferred and refresh_error:
            raise HTTPException(
                status_code=503,
                detail=f"Daily price refresh deferred after recent failure: {refresh_error}",
            )
        raise HTTPException(status_code=404, detail=f"No cached daily candles available for {symbol}")

    cached = _completed_daily_frame(cached.sort_index(), _utc_now())
    if cached.empty:
        raise HTTPException(status_code=404, detail=f"No completed daily candles available for {symbol}")
    adjusted = cached.get("Adjusted Close")
    adjusted_complete = _has_complete_adjusted_history(cached)
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
    cached.attrs["metadata"]["refresh_deferred"] = refresh_deferred
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
    coverage_incomplete = _intraday_coverage_incomplete(cached, start)
    cache_expired = bool(
        metadata.get("cache_age_seconds") is None
        or float(metadata["cache_age_seconds"]) >= INTRADAY_CACHE_TTL_SECONDS
    )
    refresh_needed = (
        cached.empty
        or coverage_incomplete
        or cache_expired
    )
    refresh_attempted = False
    refresh_succeeded: Optional[bool] = None
    refresh_error: Optional[str] = None
    refresh_deferred = False

    if refresh_needed:
        claimed, recent_error = _claim_refresh_attempt(
            symbol,
            "2h",
            now_aware,
            INTRADAY_CACHE_TTL_SECONDS,
        )
        if not claimed:
            refresh_needed = False
            refresh_succeeded = False
            refresh_error = recent_error
            refresh_deferred = True

    if refresh_needed:
        refresh_attempted = True
        try:
            fetch_start = start
            if not cached.empty and not coverage_incomplete:
                fetch_start = pd.Timestamp(cached.index.max()).to_pydatetime().replace(tzinfo=None) - timedelta(days=7)
            refreshed = _fetch_2h(symbol, fetch_start, end)
            if refreshed.empty:
                raise RuntimeError("upstream returned no intraday bars")
            with get_db_session() as db:
                _upsert_frame(db, symbol, "2h", refreshed)
                cached = _read_cached_frame(db, symbol, "2h", start, end)
            if _intraday_coverage_incomplete(cached, start):
                raise RuntimeError("cache refresh did not restore complete intraday history")
            refresh_succeeded = True
            _clear_refresh_attempt(symbol, "2h")
        except Exception as exc:
            refresh_succeeded = False
            refresh_error = str(exc)
            _record_refresh_failure(symbol, "2h", now_aware, refresh_error)

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
        empty.attrs["metadata"]["coverage_incomplete"] = True
        empty.attrs["metadata"]["refresh_deferred"] = refresh_deferred
        empty.attrs["metadata"]["stale_reason"] = "incomplete_intraday_history"
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
    coverage_incomplete = _intraday_coverage_incomplete(cached, start)
    cached.attrs["metadata"]["coverage_incomplete"] = coverage_incomplete
    cached.attrs["metadata"]["refresh_deferred"] = refresh_deferred
    if coverage_incomplete:
        cached.attrs["metadata"]["stale"] = True
        cached.attrs["metadata"]["stale_reason"] = "incomplete_intraday_history"
    return cached
