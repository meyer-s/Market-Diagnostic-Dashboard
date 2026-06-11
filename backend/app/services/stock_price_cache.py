from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd
import yfinance as yf
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.stock_price_bar import StockPriceBar
from app.utils.db_helpers import get_db_session


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


def _coerce_ohlcv_frame(df: pd.DataFrame) -> pd.DataFrame:
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

    idx = pd.to_datetime(frame.index, errors="coerce")
    out = pd.DataFrame(index=idx)
    out = out[out.index.notna()]
    if out.empty:
        return pd.DataFrame()

    frame = frame.loc[out.index]
    out["Open"] = pd.to_numeric(frame["Open"], errors="coerce")
    out["High"] = pd.to_numeric(frame["High"], errors="coerce")
    out["Low"] = pd.to_numeric(frame["Low"], errors="coerce")
    out["Close"] = pd.to_numeric(frame["Close"], errors="coerce")

    if "Volume" in frame.columns:
        out["Volume"] = pd.to_numeric(frame["Volume"], errors="coerce")
    else:
        out["Volume"] = None

    out = out.dropna(subset=["Open", "High", "Low", "Close"])
    out = out.sort_index()
    if isinstance(out.index, pd.DatetimeIndex) and out.index.tz is not None:
        out.index = out.index.tz_convert(None)
    return out


def _as_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


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
    frame = _coerce_ohlcv_frame(raw)
    if frame.empty:
        return frame

    resampled = pd.DataFrame()
    resampled["Open"] = frame["Open"].resample("2h").first()
    resampled["High"] = frame["High"].resample("2h").max()
    resampled["Low"] = frame["Low"].resample("2h").min()
    resampled["Close"] = frame["Close"].resample("2h").last()
    resampled["Volume"] = frame["Volume"].resample("2h").sum(min_count=1)
    resampled = resampled.dropna(subset=["Open", "High", "Low", "Close"])
    return resampled


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
            "Volume": [float(row.volume) if row.volume is not None else None for row in rows],
        },
        index=pd.DatetimeIndex([row.timestamp for row in rows]),
    )
    frame = frame.sort_index()
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
        payload = {
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": float(row["Volume"]) if pd.notna(row.get("Volume")) else None,
            "source": source,
            "updated_at": datetime.utcnow(),
        }

        existing_row = existing_by_ts.get(ts)
        if existing_row is not None:
            existing_row.open = payload["open"]
            existing_row.high = payload["high"]
            existing_row.low = payload["low"]
            existing_row.close = payload["close"]
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
    now = datetime.utcnow()
    start = now - timedelta(days=days + 7)
    end = now + timedelta(days=1)

    with get_db_session() as db:
        cached = _read_cached_frame(db, symbol, "1d", start, end)
        latest_cached = cached.index.max() if not cached.empty else None
        stale = latest_cached is None or (now - pd.Timestamp(latest_cached).to_pydatetime()).days > 2

    if cached.empty:
        # First hit for a symbol: build durable full available daily history.
        ensure_symbol_history(symbol, years=10, full_history=True, include_2h=True, intraday_days=252)
        with get_db_session() as db:
            cached = _read_cached_frame(db, symbol, "1d", start, end)
    elif stale:
        # Steady-state refresh: fetch only a small overlap window to capture new bars and revisions.
        latest_ts = pd.Timestamp(latest_cached).to_pydatetime().replace(tzinfo=None)
        refresh_start = latest_ts - timedelta(days=7)
        refresh_end = now + timedelta(days=1)
        refreshed = _fetch_daily(symbol, refresh_start, refresh_end, full_history=False)
        if not refreshed.empty:
            with get_db_session() as db:
                _upsert_frame(db, symbol, "1d", refreshed)
                cached = _read_cached_frame(db, symbol, "1d", start, end)

    if cached.empty:
        raise HTTPException(status_code=404, detail=f"No cached daily candles available for {symbol}")

    cached = cached.sort_index()
    cached["returns"] = cached["Close"].pct_change()
    return cached
