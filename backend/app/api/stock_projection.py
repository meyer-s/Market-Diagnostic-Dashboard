"""
Stock Projection API Endpoints

Provides REST API access to individual stock performance projections using the same
transparent scoring methodology as sector projections.

Endpoints:
- GET /stocks/{ticker}/projections: Get multi-horizon projections for a single stock

All projections include:
- Composite score (0-100) and component scores (trend, relative strength, risk, regime)
- Raw metrics (returns, volatility, drawdown, etc.)
"""

from fastapi import APIRouter, HTTPException, Path, Query
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional, Any
from zoneinfo import ZoneInfo
import hashlib
import json
import os
import time
import threading
import yfinance as yf
import pandas as pd
import numpy as np
import math
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.models.institutional_flow_event import InstitutionalFlowEvent
from app.models.stock_projection_snapshot import StockProjectionSnapshot
from app.models.system_status import SystemStatus
from app.services.institutional_flow import detect_flow_events_from_frame, summarize_flow_events
from app.services.market_data.date_utils import parse_option_expiry
from app.services.market_data.factory import get_market_data_provider
from app.services.market_data.provider import MarketDataProvider
from app.services.options_quotes import option_premium_from_row, option_quote_from_row
from app.services.stock_price_cache import get_cached_intraday_frame, get_or_refresh_daily_frame
from app.utils.db_helpers import get_db_session

router = APIRouter()

HORIZONS = {
    "T": 0,    # Today (uses T_WINDOW_DAYS for calculation)
    "3m": 63,
    "6m": 126,
    "12m": 252,
}

_STOCK_PROJECTION_CACHE_TTL_SECONDS = 5 * 60
_STOCK_PROJECTION_PAYLOAD_SCHEMA_VERSION = 3
_stock_projection_cache: dict[str, dict[str, Any]] = {}
_stock_projection_cache_lock = threading.Lock()
_MARKET_TIMEZONE = ZoneInfo("America/New_York")


def _market_session_date(now: Optional[datetime] = None):
    """Return the US equity market date for an instant (naive inputs are UTC)."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(_MARKET_TIMEZONE).date()


def _option_source_name(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, dict):
        return ""
    return str(value.get("data_source") or "")


def _cache_matches_market_data_provider(payload: dict[str, Any]) -> bool:
    provider = os.getenv("MARKET_DATA_PROVIDER", "yahoo").strip().lower()
    if provider != "ibkr":
        return True
    option_sources = (
        _option_source_name(payload, "options_flow"),
        _option_source_name(payload, "optionality"),
    )
    return not any(source.startswith("yahoo") for source in option_sources)


def _cache_matches_accuracy_contract(payload: dict[str, Any]) -> bool:
    if int(payload.get("schema_version") or 0) < _STOCK_PROJECTION_PAYLOAD_SCHEMA_VERSION:
        return False
    optionality = payload.get("optionality")
    if (
        not isinstance(optionality, dict)
        or "mispricing_usable" not in optionality
        or "iv30_chain_percentile" not in optionality
        or optionality.get("iv30_chain_percentile_kind") != "current_chain_cross_section"
        or "iv_percentile" not in optionality
        or optionality.get("iv_percentile") is not None
    ):
        return False
    options_flow = payload.get("options_flow")
    if isinstance(options_flow, dict) and not isinstance(options_flow.get("coverage"), dict):
        return False
    projections = payload.get("projections")
    if not isinstance(projections, dict) or set(projections) != set(HORIZONS):
        return False
    if not isinstance(payload.get("analysis_input_fingerprint"), str):
        return False
    return all(
        isinstance(projection, dict)
        and projection.get("analysis_kind") == "trailing_window"
        for projection in projections.values()
    )


def _get_stock_projection_cache(ticker: str) -> Optional[dict[str, Any]]:
    now_ts = time.time()
    with _stock_projection_cache_lock:
        cached = _stock_projection_cache.get(ticker)
        if cached:
            if now_ts - float(cached.get("cached_at", 0)) > _STOCK_PROJECTION_CACHE_TTL_SECONDS:
                _stock_projection_cache.pop(ticker, None)
            else:
                payload = cached.get("payload")
                if (
                    isinstance(payload, dict)
                    and _cache_matches_market_data_provider(payload)
                    and _cache_matches_accuracy_contract(payload)
                ):
                    return dict(payload)

    # Fallback to persistent DB snapshot cache so warm data survives process restarts.
    try:
        with get_db_session() as db:
            row = (
                db.query(StockProjectionSnapshot)
                .filter(StockProjectionSnapshot.symbol == ticker)
                .first()
            )
            if row is None or row.cached_at is None:
                return None
            age_seconds = (datetime.utcnow() - row.cached_at).total_seconds()
            if age_seconds > _STOCK_PROJECTION_CACHE_TTL_SECONDS:
                return None
            if not isinstance(row.payload, dict):
                return None

            payload = dict(row.payload)
            if (
                not _cache_matches_market_data_provider(payload)
                or not _cache_matches_accuracy_contract(payload)
            ):
                return None
            with _stock_projection_cache_lock:
                _stock_projection_cache[ticker] = {
                    "cached_at": time.time(),
                    "payload": payload,
                }
            return payload
    except Exception:
        return None


def _set_stock_projection_cache(ticker: str, payload: dict[str, Any]) -> None:
    now_utc = datetime.utcnow()
    versioned_payload = dict(payload)
    versioned_payload["schema_version"] = _STOCK_PROJECTION_PAYLOAD_SCHEMA_VERSION
    safe_payload = sanitize_for_json(versioned_payload)

    with _stock_projection_cache_lock:
        _stock_projection_cache[ticker] = {
            "cached_at": now_utc.timestamp(),
            "payload": safe_payload,
        }

    # Persist snapshot to Postgres for cross-process cache reuse.
    try:
        with get_db_session() as db:
            row = (
                db.query(StockProjectionSnapshot)
                .filter(StockProjectionSnapshot.symbol == ticker)
                .first()
            )
            if row is None:
                row = StockProjectionSnapshot(
                    symbol=ticker,
                    payload=safe_payload,
                    cached_at=now_utc,
                    created_at=now_utc,
                    updated_at=now_utc,
                )
                db.add(row)
            else:
                row.payload = safe_payload
                row.cached_at = now_utc
                row.updated_at = now_utc
            db.commit()
    except Exception:
        # If cache persistence fails, request should still succeed via in-memory cache.
        return


def sanitize_for_json(obj):
    """
    Recursively replace NaN and Inf values with None for JSON serialization.
    """
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item) for item in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj


def _analysis_input_fingerprint(stock_df: pd.DataFrame, benchmark_df: pd.DataFrame) -> str:
    """Hash the latest stock and benchmark calculation inputs used by headlines."""

    def latest(frame: pd.DataFrame) -> dict[str, Any]:
        if frame is None or frame.empty:
            return {"observed_at": None, "close": None, "adjusted_close": None}
        ordered = frame.sort_index()
        row = ordered.iloc[-1]

        def finite_value(value: Any) -> Optional[float]:
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return None
            return numeric if math.isfinite(numeric) else None

        return {
            "observed_at": _utc_iso(ordered.index[-1]),
            "close": finite_value(row.get("Close")),
            "adjusted_close": finite_value(row.get("Adjusted Close")),
        }

    canonical = json.dumps(
        {"stock": latest(stock_df), "benchmark": latest(benchmark_df)},
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _cache_matches_analysis_inputs(
    payload: dict[str, Any],
    *,
    as_of_date: Optional[str],
    benchmark_as_of_date: Optional[str],
    analysis_input_fingerprint: str,
) -> bool:
    return (
        payload.get("as_of_date") == as_of_date
        and payload.get("benchmark_as_of_date") == benchmark_as_of_date
        and payload.get("analysis_input_fingerprint") == analysis_input_fingerprint
    )
T_WINDOW_DAYS = 21


def _utc_iso(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat()


def _frame_response_metadata(df: pd.DataFrame, symbol: str, interval: str) -> dict[str, Any]:
    metadata = dict(df.attrs.get("metadata") or {}) if isinstance(df, pd.DataFrame) else {}
    latest = df.index.max() if isinstance(df, pd.DataFrame) and not df.empty else None
    metadata.setdefault("symbol", symbol)
    metadata.setdefault("interval", interval)
    metadata.setdefault("source", "YAHOO")
    metadata.setdefault("observed_at", _utc_iso(latest))
    metadata.setdefault("retrieved_at", datetime.now(timezone.utc).isoformat())
    metadata.setdefault("cache_updated_at", None)
    metadata.setdefault("cache_age_seconds", None)
    metadata.setdefault("observation_age_seconds", None)
    metadata.setdefault("business_session_lag", None)
    metadata.setdefault("stale", False if latest is not None else True)
    metadata.setdefault("refresh_attempted", False)
    metadata.setdefault("refresh_succeeded", None)
    metadata.setdefault("refresh_error", None)
    return metadata


def _series_freshness_warning(metadata: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not metadata.get("stale") and not metadata.get("refresh_error"):
        return None
    return {
        "type": "stale_series" if metadata.get("stale") else "cache_refresh_failed",
        "details": {
            "symbol": metadata.get("symbol"),
            "interval": metadata.get("interval"),
            "source": metadata.get("source"),
            "observed_at": metadata.get("observed_at"),
            "cache_updated_at": metadata.get("cache_updated_at"),
            "observation_age_seconds": metadata.get("observation_age_seconds"),
            "business_session_lag": metadata.get("business_session_lag"),
            "stock_session_lag": metadata.get("stock_session_lag"),
            "benchmark_session_lag": metadata.get("benchmark_session_lag"),
            "daily_session_lag": metadata.get("daily_session_lag"),
            "stale_reason": metadata.get("stale_reason"),
            "refresh_error": metadata.get("refresh_error"),
        },
    }


def _event_datetime(date_str: str) -> datetime:
    return datetime.fromisoformat(f"{date_str}T00:00:00")


_INSTITUTIONAL_FLOW_UNIQUE_COLUMNS = (
    "symbol",
    "event_date",
    "side",
    "price",
    "volume",
)


def _insert_institutional_flow_events(db, event_rows: list[dict[str, Any]]) -> None:
    """Insert newly detected events without failing when another worker wins the race."""
    if not event_rows:
        return

    table = InstitutionalFlowEvent.__table__
    dialect_name = db.bind.dialect.name if db.bind is not None else ""

    if dialect_name == "postgresql":
        statement = postgresql_insert(table).values(event_rows)
        statement = statement.on_conflict_do_nothing(
            index_elements=list(_INSTITUTIONAL_FLOW_UNIQUE_COLUMNS)
        )
        db.execute(statement)
        return

    if dialect_name == "sqlite":
        statement = sqlite_insert(table).values(event_rows)
        statement = statement.on_conflict_do_nothing(
            index_elements=list(_INSTITUTIONAL_FLOW_UNIQUE_COLUMNS)
        )
        db.execute(statement)
        return

    # Preserve the prior behavior for other SQLAlchemy dialects. Production
    # uses PostgreSQL, and unknown integrity failures should remain visible.
    for event_row in event_rows:
        db.add(InstitutionalFlowEvent(**event_row))


def _sync_institutional_flow_history(db, symbol: str, df: pd.DataFrame, latest_price: Optional[float]) -> dict:
    analysis_frame = df.tail(365) if df is not None else pd.DataFrame()
    detected_events = detect_flow_events_from_frame(analysis_frame, lookback_days=365)

    valid_index = pd.to_datetime(analysis_frame.index, errors="coerce") if not analysis_frame.empty else []
    valid_dates = [value for value in valid_index if not pd.isna(value)]
    if valid_dates:
        min_date = pd.Timestamp(min(valid_dates)).normalize().to_pydatetime().replace(tzinfo=None)
        max_date = pd.Timestamp(max(valid_dates)).normalize().to_pydatetime().replace(tzinfo=None)
        existing_rows = (
            db.query(InstitutionalFlowEvent)
            .filter(
                InstitutionalFlowEvent.symbol == symbol,
                InstitutionalFlowEvent.event_date >= min_date,
                InstitutionalFlowEvent.event_date <= max_date,
            )
            .all()
        )
        existing_keys = {
            (
                row.event_date.date().isoformat(),
                row.side,
                round(float(row.price), 4),
                int(row.volume),
            )
            for row in existing_rows
        }
        detected_keys = {
            (
                event["date"],
                event["side"],
                round(float(event["price"]), 4),
                int(event["volume"]),
            )
            for event in detected_events
        }

        # Reconcile revised source bars inside the recomputed window. Without
        # this, a provider correction could leave a superseded event beside its
        # replacement forever.
        removed = False
        for row in existing_rows:
            key = (
                row.event_date.date().isoformat(),
                row.side,
                round(float(row.price), 4),
                int(row.volume),
            )
            if key not in detected_keys:
                db.delete(row)
                existing_keys.discard(key)
                removed = True

        rows_to_insert: list[dict[str, Any]] = []
        for event in detected_events:
            key = (
                event["date"],
                event["side"],
                round(float(event["price"]), 4),
                int(event["volume"]),
            )
            if key in existing_keys:
                continue
            rows_to_insert.append(
                {
                    "symbol": symbol,
                    "event_date": _event_datetime(event["date"]),
                    "side": event["side"],
                    "price": float(event["price"]),
                    "volume": int(event["volume"]),
                    "notional": float(event["notional"]),
                    "volume_z": float(event["volume_z"]),
                    "clv": float(event["clv"]),
                    "price_change_pct": float(event["price_change_pct"]),
                    "strength": float(event["strength"]),
                }
            )
            existing_keys.add(key)

        if rows_to_insert or removed:
            _insert_institutional_flow_events(db, rows_to_insert)
            db.commit()

    newest_rows = (
        db.query(InstitutionalFlowEvent)
        .filter(InstitutionalFlowEvent.symbol == symbol)
        .order_by(InstitutionalFlowEvent.event_date.desc())
        .limit(250)
        .all()
    )
    rows = list(reversed(newest_rows))

    history = [
        {
            "date": row.event_date.date().isoformat(),
            "price": round(float(row.price), 4),
            "volume": int(row.volume),
            "notional": round(float(row.notional), 2),
            "volume_z": round(float(row.volume_z), 2),
            "clv": round(float(row.clv), 3),
            "price_change_pct": round(float(row.price_change_pct), 2),
            "side": row.side,
            "strength": round(float(row.strength), 2),
        }
        for row in rows
    ]

    summary = summarize_flow_events(history, latest_price=latest_price)
    summary["signal_strength"] = summary.get("confidence")
    return {
        "summary": summary,
        "event_history": history,
        "method": {
            "name": "high_volume_accumulation_proxy",
            "description": "High-volume daily bars classified by close location and price direction.",
            "direct_institutional_tape": False,
        },
    }


def _slice_price_history_window(
    df: pd.DataFrame,
    history_window: Literal["252d", "1y", "5y", "max"],
) -> pd.DataFrame:
    """Apply trading-session or calendar-year semantics to chart history."""
    required = ["Open", "High", "Low", "Close"]
    if df is None or df.empty or not set(required).issubset(df.columns):
        return pd.DataFrame(columns=df.columns if isinstance(df, pd.DataFrame) else required)

    ordered = df.sort_index().copy()
    parsed_index = pd.to_datetime(ordered.index, errors="coerce")
    valid_index = ~pd.isna(parsed_index)
    ordered = ordered.loc[valid_index].copy()
    ordered.index = pd.DatetimeIndex(parsed_index[valid_index])
    for column in required:
        ordered[column] = pd.to_numeric(ordered[column], errors="coerce")
    ordered = ordered.dropna(subset=required)
    if ordered.empty:
        return ordered

    if history_window == "252d":
        return ordered.tail(252)
    if history_window == "max":
        return ordered

    years = 1 if history_window == "1y" else 5
    cutoff = pd.Timestamp(ordered.index.max()) - pd.DateOffset(years=years)
    return ordered.loc[ordered.index >= cutoff]


def _build_price_history(df: pd.DataFrame, days: Optional[int] = 180) -> list[dict]:
    required = {"Open", "High", "Low", "Close"}
    if df is None or df.empty or not required.issubset(df.columns):
        return []

    history = []
    rows = df.tail(days) if days is not None else df
    for idx, row in rows.iterrows():
        open_price = row.get("Open")
        high_price = row.get("High")
        low_price = row.get("Low")
        close_price = row.get("Close")
        if pd.isna(open_price) or pd.isna(high_price) or pd.isna(low_price) or pd.isna(close_price):
            continue
        date = pd.to_datetime(idx, errors="coerce")
        if pd.isna(date):
            continue
        history.append(
            {
                "date": date.date().isoformat(),
                "open": round(float(open_price), 4),
                "high": round(float(high_price), 4),
                "low": round(float(low_price), 4),
                "close": round(float(close_price), 4),
            }
        )
    return history


def _build_intraday_history(df: pd.DataFrame) -> list[dict]:
    required = {"Open", "High", "Low", "Close"}
    if df is None or df.empty or not required.issubset(df.columns):
        return []

    history = []
    for idx, row in df.iterrows():
        open_price = row.get("Open")
        high_price = row.get("High")
        low_price = row.get("Low")
        close_price = row.get("Close")
        if pd.isna(open_price) or pd.isna(high_price) or pd.isna(low_price) or pd.isna(close_price):
            continue
        dt = pd.to_datetime(idx, errors="coerce")
        if pd.isna(dt):
            continue
        history.append(
            {
                "timestamp": _utc_iso(dt),
                "open": round(float(open_price), 4),
                "high": round(float(high_price), 4),
                "low": round(float(low_price), 4),
                "close": round(float(close_price), 4),
            }
        )
    return history


def _get_quarterly_df(stock: yf.Ticker, getters) -> pd.DataFrame:
    frames = []
    for getter in getters:
        try:
            df = getter()
        except Exception:
            continue
        if isinstance(df, pd.DataFrame) and not df.empty:
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    merged = frames[0].copy()
    for df in frames[1:]:
        try:
            merged = merged.combine_first(df)
        except Exception:
            continue
    return merged


def _normalize_quarter_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    try:
        df = df.copy()
        df.columns = pd.to_datetime(df.columns, errors="coerce")
        df = df.loc[:, df.columns.notna()]
        return df
    except Exception:
        return df


def _row_series(df: pd.DataFrame, row_names) -> Optional[pd.Series]:
    if df is None or df.empty:
        return None
    for name in row_names:
        if name in df.index:
            series = df.loc[name]
            if isinstance(series, pd.Series):
                return series.dropna()
    return None


def _series_from_row(df: pd.DataFrame, row_names, max_points: int = 8) -> list:
    series = _row_series(df, row_names)
    if series is None or series.empty:
        return []
    data = []
    for col, value in series.items():
        if pd.isna(value):
            continue
        date = pd.to_datetime(col, errors="coerce")
        if pd.isna(date):
            continue
        data.append({"date": date.date().isoformat(), "value": float(value)})
    data.sort(key=lambda item: item["date"])
    return data[-max_points:]


def _merge_series(primary: list, secondary: list, max_points: int) -> list:
    merged = {item["date"]: item for item in secondary}
    for item in primary:
        merged[item["date"]] = item
    combined = list(merged.values())
    combined.sort(key=lambda item: item["date"])
    return combined[-max_points:]


def _price_on_or_before(df: pd.DataFrame, date: pd.Timestamp) -> Optional[float]:
    if df is None or df.empty or "Close" not in df.columns:
        return None
    try:
        price_df = df.copy()
        if not isinstance(price_df.index, pd.DatetimeIndex):
            price_df.index = pd.to_datetime(price_df.index, errors="coerce")
        price_df = price_df[price_df.index.notna()]
        if price_df.index.tz is not None:
            price_df.index = price_df.index.tz_localize(None)
        price_df.index = price_df.index.normalize()
        if date.tzinfo is not None:
            date = date.tz_localize(None)
        date = date.normalize()
        subset = price_df[price_df.index <= date]
        if subset.empty:
            return None
        return float(subset["Close"].iloc[-1])
    except Exception:
        return None


def _value_on_or_before(series: pd.Series, date: pd.Timestamp) -> Optional[float]:
    if series is None or series.empty:
        return None
    try:
        data = series.dropna()
        if data.empty:
            return None
        if not isinstance(data.index, pd.DatetimeIndex):
            data.index = pd.to_datetime(data.index, errors="coerce")
        data = data[data.index.notna()]
        if data.index.tz is not None:
            data.index = data.index.tz_localize(None)
        if date.tzinfo is not None:
            date = date.tz_localize(None)
        subset = data[data.index <= date]
        if subset.empty:
            return None
        return float(subset.iloc[-1])
    except Exception:
        return None


def _last_quarter_dates(df: pd.DataFrame, max_points: int = 8) -> list:
    if df is None or df.empty:
        return []
    try:
        idx = pd.to_datetime(df.index, errors="coerce")
        idx = idx[idx.notna()]
        if idx.empty:
            return []
        quarter_ends = idx.to_period("Q").end_time
        unique_dates = sorted({date.date().isoformat() for date in quarter_ends})
        return unique_dates[-max_points:]
    except Exception:
        return []


def _series_from_earnings_dates(stock: yf.Ticker, max_points: int = 12) -> list:
    try:
        earnings = stock.get_earnings_dates(limit=max_points * 3)
    except Exception:
        return []
    if earnings is None or earnings.empty:
        return []

    eps_column = None
    for col in earnings.columns:
        if "reported" in str(col).lower() and "eps" in str(col).lower():
            eps_column = col
            break
    if eps_column is None:
        return []

    data = []
    for idx, row in earnings.iterrows():
        eps_value = row.get(eps_column)
        if pd.isna(eps_value):
            continue
        date = pd.to_datetime(idx, errors="coerce")
        if pd.isna(date):
            continue
        data.append(
            {
                "date": date.date().isoformat(),
                "value": float(eps_value),
                "date_role": "earnings_announcement",
            }
        )

    data.sort(key=lambda item: item["date"])
    return data[-max_points:]


def _quarterly_points(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_quarter: dict[pd.Period, dict[str, Any]] = {}
    for item in series or []:
        date = pd.to_datetime(item.get("date"), errors="coerce")
        value = item.get("value")
        if pd.isna(date) or value is None or pd.isna(value):
            continue
        quarter = date.to_period("Q")
        current = by_quarter.get(quarter)
        if current is None or str(item["date"]) > str(current["date"]):
            by_quarter[quarter] = item
    return [by_quarter[key] for key in sorted(by_quarter)]


def _has_consecutive_quarters(points: list[dict[str, Any]], count: int) -> bool:
    if len(points) < count:
        return False
    periods = [pd.Timestamp(item["date"]).to_period("Q").ordinal for item in points[-count:]]
    return all(current - previous == 1 for previous, current in zip(periods, periods[1:]))


def _ttm_snapshot_metric(series: list[dict[str, Any]], *, derived: bool) -> dict[str, Any]:
    ordered = _quarterly_points(series)
    if len(ordered) < 4:
        return {"value": None, "period_end": ordered[-1]["date"] if ordered else None, "change_pct": None, "derived": derived}
    if not _has_consecutive_quarters(ordered, 4):
        return {"value": None, "period_end": ordered[-1]["date"], "change_pct": None, "derived": derived}
    latest = sum(float(item["value"]) for item in ordered[-4:])
    previous = (
        sum(float(item["value"]) for item in ordered[-5:-1])
        if len(ordered) >= 5 and _has_consecutive_quarters(ordered, 5)
        else None
    )
    change_pct = (
        (latest - previous) / abs(previous) * 100.0
        if previous not in (None, 0)
        else None
    )
    return {
        "value": latest,
        "period_end": ordered[-1]["date"],
        "change_pct": change_pct,
        "derived": derived,
    }


def _ttm_roe_snapshot(
    net_income_series: list[dict[str, Any]],
    equity_series: list[dict[str, Any]],
) -> dict[str, Any]:
    income = _quarterly_points(net_income_series)
    equity = _quarterly_points(equity_series)
    if len(income) < 4 or len(equity) < 2 or not _has_consecutive_quarters(income, 4):
        return {
            "value": None,
            "period_end": income[-1]["date"] if income else (equity[-1]["date"] if equity else None),
            "change_pct": None,
            "derived": True,
        }

    equity_by_period = {
        pd.Timestamp(item["date"]).to_period("Q").ordinal: float(item["value"])
        for item in equity
    }

    def calculate(income_window: list[dict[str, Any]]) -> Optional[float]:
        if len(income_window) != 4 or not _has_consecutive_quarters(income_window, 4):
            return None
        first_period = pd.Timestamp(income_window[0]["date"]).to_period("Q").ordinal
        end_period = pd.Timestamp(income_window[-1]["date"]).to_period("Q").ordinal
        beginning_equity = equity_by_period.get(first_period - 1)
        ending_equity = equity_by_period.get(end_period)
        if beginning_equity is None or ending_equity is None:
            return None
        average_equity = (beginning_equity + ending_equity) / 2.0
        if average_equity == 0:
            return None
        return sum(float(item["value"]) for item in income_window) / average_equity * 100.0

    latest = calculate(income[-4:])
    previous = calculate(income[-5:-1]) if len(income) >= 5 else None
    change_pct = (
        (latest - previous) / abs(previous) * 100.0
        if latest is not None and previous not in (None, 0)
        else None
    )
    return {
        "value": latest,
        "period_end": income[-1]["date"],
        "change_pct": change_pct,
        "derived": True,
    }


def _rolling_ttm_roe_series(
    net_income_series: list[dict[str, Any]],
    equity_series: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    income = _quarterly_points(net_income_series)
    if len(income) < 4:
        return []
    results: list[dict[str, Any]] = []
    for end in range(3, len(income)):
        window = income[end - 3 : end + 1]
        snapshot = _ttm_roe_snapshot(window, equity_series)
        if snapshot.get("value") is not None:
            results.append({"date": window[-1]["date"], "value": float(snapshot["value"])})
    return results


def _annual_roe_series(
    net_income_series: list[dict[str, Any]],
    equity_series: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    income = sorted(net_income_series or [], key=lambda item: item["date"])
    equity_by_year = {
        pd.Timestamp(item["date"]).year: float(item["value"])
        for item in equity_series or []
    }
    results: list[dict[str, Any]] = []
    for item in income:
        year = pd.Timestamp(item["date"]).year
        beginning_equity = equity_by_year.get(year - 1)
        ending_equity = equity_by_year.get(year)
        if beginning_equity is None or ending_equity is None:
            continue
        average_equity = (beginning_equity + ending_equity) / 2.0
        if average_equity == 0:
            continue
        results.append(
            {
                "date": item["date"],
                "value": float(item["value"]) / average_equity * 100.0,
            }
        )
    return results


def _round_snapshot_metric(metric: dict[str, Any]) -> dict[str, Any]:
    output = dict(metric)
    for key in ("value", "change_pct"):
        value = output.get(key)
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            output[key] = round(float(value), 4 if key == "value" else 2)
    return output


def compute_fundamentals(stock: yf.Ticker, price_df: pd.DataFrame) -> dict:
    max_points = 12
    income_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_financials,
            lambda: stock.get_income_stmt(freq="quarterly"),
        ],
    )
    balance_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_balance_sheet,
            lambda: stock.get_balance_sheet(freq="quarterly"),
        ],
    )
    cashflow_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_cashflow,
            lambda: stock.get_cashflow(freq="quarterly"),
        ],
    )

    income_df = _normalize_quarter_columns(income_df)
    balance_df = _normalize_quarter_columns(balance_df)
    cashflow_df = _normalize_quarter_columns(cashflow_df)

    net_income_series = _series_from_row(
        income_df,
        [
            "Net Income",
            "Net Income Applicable To Common Shares",
            "Net Income Common Stockholders",
            "Net Income Continuous Operations",
            "Net Income From Continuing Operations",
        ],
        max_points=max_points,
    )
    revenue_series = _series_from_row(
        income_df,
        [
            "Total Revenue",
            "TotalRevenue",
            "Revenue",
            "Total Revenue As Reported",
            "Revenue From Contract With Customer Excluding Assessed Tax",
        ],
        max_points=max_points,
    )

    equity_series = _series_from_row(
        balance_df,
        [
            "Total Stockholder Equity",
            "Total Equity Gross Minority Interest",
            "Total Equity",
        ],
        max_points=max_points,
    )

    shares_outstanding = None
    try:
        shares_outstanding = stock.info.get("sharesOutstanding")
    except Exception:
        shares_outstanding = None
    if not shares_outstanding:
        try:
            shares_outstanding = stock.fast_info.get("shares")
        except Exception:
            shares_outstanding = None

    shares_full = None
    try:
        start = (datetime.utcnow() - timedelta(days=365 * 3 + 30)).date().isoformat()
        shares_full = stock.get_shares_full(start=start)
    except Exception:
        shares_full = None

    reported_eps_series = _series_from_row(
        income_df,
        [
            "Diluted EPS",
            "Basic EPS",
            "Diluted EPS Continued Operations",
            "Basic EPS Continued Operations",
            "Diluted EPS Continuing Operations",
            "Basic EPS Continuing Operations",
            "EPS",
        ],
        max_points=max_points,
    )
    earnings_eps_series = _series_from_earnings_dates(stock, max_points=max_points)

    share_count_series = _series_from_row(
        balance_df,
        [
            "Ordinary Shares Number",
            "Share Issued",
            "Common Stock Shares Outstanding",
            "Common Stock Shares Issued",
            "Common Shares Outstanding",
            "Shares Outstanding",
        ],
        max_points=max_points,
    )
    weighted_average_share_series = _series_from_row(
        income_df,
        [
            "Diluted Average Shares",
            "Diluted Weighted Average Shares",
            "Basic Average Shares",
            "Basic Weighted Average Shares",
            "Weighted Average Shares",
        ],
        max_points=max_points,
    )
    eps_denominator_series = weighted_average_share_series or share_count_series

    eps_series = []
    eps_derived = False
    eps_source = "unavailable"
    if reported_eps_series:
        eps_series = reported_eps_series
        eps_source = "quarterly_statement"
    elif net_income_series and eps_denominator_series:
        share_by_date = {point["date"]: point["value"] for point in eps_denominator_series}
        for point in net_income_series:
            shares = share_by_date.get(point["date"])
            if shares is None or shares == 0:
                continue
            eps_series.append(
                {
                    "date": point["date"],
                    "value": float(point["value"]) / float(shares),
                }
            )
        eps_derived = True
        eps_source = (
            "net_income_divided_by_weighted_average_shares"
            if weighted_average_share_series
            else "net_income_divided_by_period_end_shares"
        )
    if not eps_series and earnings_eps_series:
        eps_series = earnings_eps_series
        eps_derived = False
        eps_source = "earnings_announcement"

    roe_series = _rolling_ttm_roe_series(net_income_series, equity_series)

    fcf_series = []
    if not cashflow_df.empty:
        free_cash = _row_series(cashflow_df, ["Free Cash Flow"])
        if free_cash is not None and not free_cash.empty:
            for col, value in free_cash.items():
                if pd.isna(value):
                    continue
                date = pd.to_datetime(col, errors="coerce")
                if pd.isna(date):
                    continue
                fcf_series.append({"date": date.date().isoformat(), "value": float(value)})
        else:
            operating = _row_series(
                cashflow_df,
                [
                    "Total Cash From Operating Activities",
                    "Operating Cash Flow",
                    "Total Cash From Operating Activities Continued Operations",
                ],
            )
            capex = _row_series(
                cashflow_df,
                [
                    "Capital Expenditures",
                    "CapitalExpenditures",
                    "Capital Expenditure",
                ],
            )
            if operating is not None and capex is not None:
                for col, op_value in operating.items():
                    cap_value = capex.get(col)
                    if pd.isna(op_value) or pd.isna(cap_value):
                        continue
                    date = pd.to_datetime(col, errors="coerce")
                    if pd.isna(date):
                        continue
                    fcf_series.append(
                        {"date": date.date().isoformat(), "value": float(op_value) + float(cap_value)}
                    )

    fcf_derived = True
    if _row_series(cashflow_df, ["Free Cash Flow"]) is not None:
        fcf_derived = False

    market_cap_series = []
    shares_by_date = {point["date"]: point["value"] for point in share_count_series}
    if shares_by_date:
        for date_str, shares in shares_by_date.items():
            date = pd.to_datetime(date_str, errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None or shares is None or shares == 0:
                continue
            market_cap_series.append(
                {"date": date.date().isoformat(), "value": float(price) * float(shares)}
            )
    market_cap_full = []
    if isinstance(shares_full, pd.Series) and not shares_full.empty:
        for point in eps_series or []:
            date = pd.to_datetime(point["date"], errors="coerce")
            if pd.isna(date):
                continue
            shares = _value_on_or_before(shares_full, date)
            price = _price_on_or_before(price_df, date)
            if shares is None or price is None:
                continue
            market_cap_full.append(
                {"date": date.date().isoformat(), "value": float(price) * float(shares)}
            )
    if market_cap_full:
        market_cap_series = _merge_series(market_cap_series, market_cap_full, max_points)

    pe_series = []
    if eps_series and eps_source != "earnings_announcement":
        eps_series_sorted = _quarterly_points(eps_series)
        for idx, point in enumerate(eps_series_sorted):
            if idx < 3:
                continue
            eps_window = eps_series_sorted[idx - 3 : idx + 1]
            if not _has_consecutive_quarters(eps_window, 4):
                continue
            trailing_eps = sum(p["value"] for p in eps_window)
            if trailing_eps <= 0:
                continue
            date = pd.to_datetime(point["date"], errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None:
                continue
            pe_series.append({"date": point["date"], "value": float(price) / trailing_eps})

    def _limit(series: list, limit: int) -> list:
        series.sort(key=lambda item: item["date"])
        return series[-limit:]

    revenue_yoy_series = []
    if revenue_series:
        revenue_sorted = _quarterly_points(revenue_series)
        revenue_by_period = {
            pd.Timestamp(item["date"]).to_period("Q").ordinal: item
            for item in revenue_sorted
        }
        for current in revenue_sorted:
            current_period = pd.Timestamp(current["date"]).to_period("Q").ordinal
            prior = revenue_by_period.get(current_period - 4)
            if prior is None:
                continue
            prior_value = prior.get("value")
            current_value = current.get("value")
            if prior_value is None or current_value is None or prior_value == 0:
                continue
            revenue_yoy_series.append(
                {
                    "date": current["date"],
                    "value": (float(current_value) - float(prior_value)) / float(prior_value) * 100,
                }
            )

    # ── Annual data (5-year view) ──────────────────────────────────────────────
    max_ann = 5
    ann_income_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.income_stmt,
            lambda: stock.get_income_stmt(freq="yearly"),
        ],
    )
    ann_balance_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.balance_sheet,
            lambda: stock.get_balance_sheet(freq="yearly"),
        ],
    )
    ann_cashflow_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.cashflow,
            lambda: stock.get_cashflow(freq="yearly"),
        ],
    )
    ann_income_df = _normalize_quarter_columns(ann_income_df)
    ann_balance_df = _normalize_quarter_columns(ann_balance_df)
    ann_cashflow_df = _normalize_quarter_columns(ann_cashflow_df)

    revenue_ann = _series_from_row(
        ann_income_df,
        [
            "Total Revenue", "TotalRevenue", "Revenue", "Total Revenue As Reported",
            "Revenue From Contract With Customer Excluding Assessed Tax",
        ],
        max_points=max_ann,
    )
    net_income_ann = _series_from_row(
        ann_income_df,
        [
            "Net Income", "Net Income Applicable To Common Shares",
            "Net Income Common Stockholders", "Net Income Continuous Operations",
            "Net Income From Continuing Operations",
        ],
        max_points=max_ann,
    )
    equity_ann = _series_from_row(
        ann_balance_df,
        ["Total Stockholder Equity", "Total Equity Gross Minority Interest", "Total Equity"],
        max_points=max_ann,
    )
    eps_ann = _series_from_row(
        ann_income_df,
        [
            "Diluted EPS", "Basic EPS", "Diluted EPS Continued Operations",
            "Basic EPS Continued Operations", "Diluted EPS Continuing Operations",
            "Basic EPS Continuing Operations", "EPS",
        ],
        max_points=max_ann,
    )
    share_count_ann = _series_from_row(
        ann_balance_df,
        [
            "Ordinary Shares Number", "Share Issued", "Common Stock Shares Outstanding",
            "Common Stock Shares Issued", "Common Shares Outstanding", "Shares Outstanding",
        ],
        max_points=max_ann,
    )
    weighted_average_share_ann = _series_from_row(
        ann_income_df,
        [
            "Diluted Average Shares", "Diluted Weighted Average Shares",
            "Basic Average Shares", "Basic Weighted Average Shares",
            "Weighted Average Shares",
        ],
        max_points=max_ann,
    )
    eps_denominator_ann = weighted_average_share_ann or share_count_ann

    eps_ann_derived = False
    if not eps_ann and net_income_ann:
        sc_by_date_a = {p["date"]: p["value"] for p in eps_denominator_ann}
        if sc_by_date_a:
            for p in net_income_ann:
                sc = sc_by_date_a.get(p["date"])
                if sc and sc != 0:
                    eps_ann.append({"date": p["date"], "value": float(p["value"]) / float(sc)})
                    eps_ann_derived = True
    eps_ann = _limit(eps_ann, max_ann)

    roe_ann = _annual_roe_series(net_income_ann, equity_ann)
    roe_ann = _limit(roe_ann, max_ann)

    fcf_ann = []
    fcf_ann_derived = False
    if not ann_cashflow_df.empty:
        free_cash_ann = _row_series(ann_cashflow_df, ["Free Cash Flow"])
        if free_cash_ann is not None and not free_cash_ann.empty:
            for col, value in free_cash_ann.items():
                if pd.isna(value):
                    continue
                date = pd.to_datetime(col, errors="coerce")
                if pd.isna(date):
                    continue
                fcf_ann.append({"date": date.date().isoformat(), "value": float(value)})
        else:
            fcf_ann_derived = True
            op_ann = _row_series(
                ann_cashflow_df,
                [
                    "Total Cash From Operating Activities", "Operating Cash Flow",
                    "Total Cash From Operating Activities Continued Operations",
                ],
            )
            cap_ann = _row_series(
                ann_cashflow_df,
                ["Capital Expenditures", "CapitalExpenditures", "Capital Expenditure"],
            )
            if op_ann is not None and cap_ann is not None:
                for col, op_val in op_ann.items():
                    cap_val = cap_ann.get(col)
                    if pd.isna(op_val) or cap_val is None or pd.isna(cap_val):
                        continue
                    date = pd.to_datetime(col, errors="coerce")
                    if pd.isna(date):
                        continue
                    fcf_ann.append({"date": date.date().isoformat(), "value": float(op_val) + float(cap_val)})
    fcf_ann = _limit(fcf_ann, max_ann)

    mcap_ann = []
    sc_by_date_ann = {p["date"]: p["value"] for p in share_count_ann}
    if sc_by_date_ann:
        for ds, shares in sc_by_date_ann.items():
            date = pd.to_datetime(ds, errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None or not shares or shares == 0:
                continue
            mcap_ann.append({"date": ds, "value": float(price) * float(shares)})
    mcap_ann = _limit(mcap_ann, max_ann)

    pe_ann = []
    for p in eps_ann:
        if p["value"] <= 0:
            continue
        date = pd.to_datetime(p["date"], errors="coerce")
        if pd.isna(date):
            continue
        price = _price_on_or_before(price_df, date)
        if price is None:
            continue
        pe_ann.append({"date": p["date"], "value": float(price) / float(p["value"])})
    pe_ann = _limit(pe_ann, max_ann)

    rev_yoy_ann = []
    if revenue_ann:
        rev_ann_sorted = sorted(revenue_ann, key=lambda x: x["date"])
        for idx in range(1, len(rev_ann_sorted)):
            cur = rev_ann_sorted[idx]
            prev = rev_ann_sorted[idx - 1]
            if pd.Timestamp(cur["date"]).year - pd.Timestamp(prev["date"]).year != 1:
                continue
            if prev["value"] == 0:
                continue
            rev_yoy_ann.append({
                "date": cur["date"],
                "value": (float(cur["value"]) - float(prev["value"])) / float(prev["value"]) * 100,
            })

    latest_price = (
        float(pd.to_numeric(price_df["Close"], errors="coerce").dropna().iloc[-1])
        if price_df is not None and not price_df.empty and "Close" in price_df.columns
        and not pd.to_numeric(price_df["Close"], errors="coerce").dropna().empty
        else None
    )
    latest_price_date = (
        pd.Timestamp(price_df.index[-1]).date().isoformat()
        if latest_price is not None
        else None
    )
    current_shares = None
    if isinstance(shares_full, pd.Series) and not shares_full.empty and latest_price_date:
        current_shares = _value_on_or_before(shares_full, pd.Timestamp(latest_price_date))
    if current_shares is None and share_count_series:
        current_shares = float(sorted(share_count_series, key=lambda item: item["date"])[-1]["value"])
    if current_shares is None and shares_outstanding:
        current_shares = float(shares_outstanding)

    eps_ttm = (
        _ttm_snapshot_metric(eps_series, derived=eps_derived)
        if eps_source != "earnings_announcement"
        else {
            "value": None,
            "period_end": None,
            "change_pct": None,
            "derived": False,
            "date_role": "earnings_announcement",
        }
    )
    revenue_ttm = _ttm_snapshot_metric(revenue_series, derived=False)
    free_cash_flow_ttm = _ttm_snapshot_metric(fcf_series, derived=fcf_derived)
    roe_ttm = _ttm_roe_snapshot(net_income_series, equity_series)
    current_pe = (
        latest_price / float(eps_ttm["value"])
        if latest_price is not None and eps_ttm.get("value") is not None and float(eps_ttm["value"]) > 0
        else None
    )
    current_market_cap = (
        latest_price * current_shares
        if latest_price is not None and current_shares is not None and current_shares > 0
        else None
    )
    latest_fiscal_period = max(
        (
            item["date"]
            for series in (
                [] if eps_source == "earnings_announcement" else eps_series,
                revenue_series,
                net_income_series,
                equity_series,
                fcf_series,
            )
            for item in (series or [])
        ),
        default=None,
    )
    retrieved_at = datetime.now(timezone.utc).isoformat()

    snapshot_metadata = {
        "eps_ttm": {
            "cadence": "reported_event_only" if eps_source == "earnings_announcement" else "TTM",
            "unit": "USD_per_share",
            "source": eps_source,
            "definition": (
                "Reported EPS events without a verified fiscal-period mapping; TTM is unavailable."
                if eps_source == "earnings_announcement"
                else "Sum of the latest four consecutive fiscal-quarter EPS values."
            ),
        },
        "revenue_ttm": {"cadence": "TTM", "unit": "USD", "source": "quarterly_statement", "definition": "Sum of the latest four consecutive fiscal-quarter revenue values."},
        "free_cash_flow_ttm": {
            "cadence": "TTM",
            "unit": "USD",
            "source": "derived_from_operating_cash_flow_and_capex" if fcf_derived else "quarterly_cash_flow_statement",
            "definition": "Sum of the latest four consecutive fiscal-quarter free-cash-flow values.",
        },
        "roe_ttm": {"cadence": "TTM", "unit": "percent", "source": "derived_from_statements", "definition": "TTM net income divided by average beginning and ending equity."},
    }
    snapshot_metrics = {
        "eps_ttm": eps_ttm,
        "revenue_ttm": revenue_ttm,
        "free_cash_flow_ttm": free_cash_flow_ttm,
        "roe_ttm": roe_ttm,
    }
    for key, metadata in snapshot_metadata.items():
        snapshot_metrics[key].update(metadata)

    return {
        "as_of": latest_fiscal_period,
        "retrieved_at": retrieved_at,
        "snapshot": {
            "eps_ttm": _round_snapshot_metric(eps_ttm),
            "revenue_ttm": _round_snapshot_metric(revenue_ttm),
            "free_cash_flow_ttm": _round_snapshot_metric(free_cash_flow_ttm),
            "roe_ttm": _round_snapshot_metric(roe_ttm),
            "pe_ratio": _round_snapshot_metric(
                {
                    "value": current_pe,
                    "period_end": latest_price_date,
                    "change_pct": None,
                    "derived": True,
                    "cadence": "current_price_over_TTM",
                    "unit": "multiple",
                    "source": "derived_from_latest_close_and_ttm_eps",
                    "definition": "Latest raw close divided by TTM EPS.",
                    "price_observed_at": latest_price_date,
                    "earnings_period_end": eps_ttm.get("period_end"),
                }
            ),
            "market_cap": _round_snapshot_metric(
                {
                    "value": current_market_cap,
                    "period_end": latest_price_date,
                    "change_pct": None,
                    "derived": True,
                    "cadence": "current",
                    "unit": "USD",
                    "source": "derived_from_latest_close_and_current_shares",
                    "definition": "Latest raw close multiplied by the latest available share count.",
                }
            ),
        },
        "eps": {"series": _limit(eps_series, max_points), "derived": eps_derived},
        "roe": {"series": _limit(roe_series, max_points), "derived": True},
        "free_cash_flow": {"series": _limit(fcf_series, max_points), "derived": fcf_derived},
        "market_cap": {"series": _limit(market_cap_series, max_points), "derived": True},
        "pe_ratio": {"series": _limit(pe_series, max_points), "derived": True},
        "revenue": {"series": _limit(revenue_series, max_points), "derived": False},
        "revenue_yoy": {"series": _limit(revenue_yoy_series, max_points), "derived": True},
        "eps_annual": {"series": eps_ann, "derived": eps_ann_derived},
        "roe_annual": {"series": roe_ann, "derived": True},
        "free_cash_flow_annual": {"series": fcf_ann, "derived": fcf_ann_derived},
        "market_cap_annual": {"series": mcap_ann, "derived": True},
        "pe_ratio_annual": {"series": pe_ann, "derived": True},
        "revenue_annual": {"series": _limit(revenue_ann, max_ann), "derived": False},
        "revenue_yoy_annual": {"series": rev_yoy_ann, "derived": True},
    }

def _is_yahoo_rate_limit_message(message: str) -> bool:
    message = (message or "").lower()
    return (
        "too many requests" in message
        or "rate limited" in message
        or "429" in message
    )


def _is_yahoo_rate_limit_error(exc: Exception) -> bool:
    return _is_yahoo_rate_limit_message(str(exc))


def _normalize_yf_download_frame(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Normalize yfinance download output to a single-ticker OHLCV frame."""
    if df is None or df.empty:
        return pd.DataFrame()

    normalized = df.copy()
    if isinstance(normalized.columns, pd.MultiIndex):
        try:
            # Typical shape: (PriceField, Ticker) for single-symbol downloads.
            normalized = normalized.droplevel(-1, axis=1)
        except Exception:
            try:
                # Fallback for other MultiIndex layouts.
                normalized = normalized.xs(ticker, axis=1, level=-1)
            except Exception:
                return pd.DataFrame()
    return normalized


def fetch_stock_data(ticker: str, days: int = 2000) -> pd.DataFrame:
    """Read-through fetch backed by persistent DB candle cache."""
    try:
        return get_or_refresh_daily_frame(ticker, days=days)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Unable to fetch data for {ticker}: {exc}")


def calculate_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Calculate Average True Range for volatility measurement"""
    high_low = df['High'] - df['Low']
    high_close = abs(df['High'] - df['Close'].shift())
    low_close = abs(df['Low'] - df['Close'].shift())
    
    ranges = pd.concat([high_low, high_close, low_close], axis=1)
    true_range = ranges.max(axis=1)
    atr = true_range.rolling(period).mean()
    
    return atr.iloc[-1] if not pd.isna(atr.iloc[-1]) else 0


def compute_conviction(trend_score: float, rel_strength_score: float, risk_score: float, volatility: float, composite_score: float) -> float:
    """
    Calculate conviction (confidence) in the projection (0-100)
    High conviction = strong signals aligned, low volatility
    Low conviction = mixed signals, high volatility
    """
    # Score alignment: how close are the component scores to the composite?
    component_scores = [trend_score, rel_strength_score, risk_score]
    avg_component = np.mean(component_scores)
    alignment = 100 - np.std(component_scores)  # Lower std = better alignment = higher conviction
    
    # Volatility factor: lower volatility = higher conviction
    volatility_factor = max(0, 100 - (volatility * 2))
    
    # Strength factor: scores far from neutral (50) = higher conviction
    strength = abs(composite_score - 50) / 50 * 100
    
    # Weighted conviction
    conviction = (
        0.40 * alignment +           # Component alignment (40%)
        0.35 * volatility_factor +   # Low volatility confidence (35%)
        0.25 * strength              # Signal strength (25%)
    )
    
    return np.clip(conviction, 0, 100)


def compute_historical_volatility(df: pd.DataFrame, window: int = 30) -> Optional[float]:
    """Calculate annualized volatility from exactly ``window`` daily returns."""
    if df is None or df.empty or window <= 0 or "Close" not in df.columns:
        return None
    price_window = df.sort_index().tail(window + 1)
    if len(price_window) != window + 1:
        return None

    raw_close = pd.to_numeric(price_window["Close"], errors="coerce")
    adjusted = price_window.get("Adjusted Close")
    adjusted_close = (
        pd.to_numeric(adjusted, errors="coerce")
        if adjusted is not None
        else None
    )
    adjusted_complete = bool(
        adjusted_close is not None
        and adjusted_close.notna().all()
        and np.isfinite(adjusted_close).all()
        and (adjusted_close > 0).all()
    )
    prices = adjusted_close if adjusted_complete else raw_close
    if prices.isna().any() or not np.isfinite(prices).all() or not (prices > 0).all():
        return None
    returns = prices.pct_change(fill_method=None).dropna()
    if len(returns) != window:
        return None
    hv = returns.tail(window).std() * np.sqrt(252) * 100
    if not math.isfinite(float(hv)):
        return None
    return round(float(hv), 2)


def _parse_expiry(expiry: str) -> Optional[datetime]:
    parsed = parse_option_expiry(expiry)
    if parsed is None:
        return None
    return datetime.combine(parsed, datetime.min.time())


def _near_atm(options_df: pd.DataFrame, current_price: float, threshold: float = 0.05) -> pd.DataFrame:
    if options_df is None or options_df.empty or current_price <= 0:
        return pd.DataFrame()
    return options_df[(options_df["strike"] - current_price).abs() / current_price <= threshold]


def _option_mid_price(row: pd.Series) -> Optional[float]:
    return option_premium_from_row(row)


def _ordered_option_providers(provider: MarketDataProvider) -> list[MarketDataProvider]:
    primary = getattr(provider, "primary", None)
    if primary is None:
        return [provider]

    providers = [primary]
    fallback = getattr(provider, "fallback", None)
    if fallback is not None:
        providers.append(fallback)
    return providers


def _optionality_has_provider_data(metrics: dict[str, Any]) -> bool:
    if not isinstance(metrics, dict):
        return False
    return (
        metrics.get("iv30") is not None
        or metrics.get("avg_edr") is not None
        or int(metrics.get("expiries_scanned") or 0) > 0
    )


def _latest_option_observation(*frames: pd.DataFrame) -> Optional[str]:
    observations: list[pd.Timestamp] = []
    for frame in frames:
        if frame is None or frame.empty or "lastTradeDate" not in frame.columns:
            continue
        parsed = pd.to_datetime(frame["lastTradeDate"], errors="coerce", utc=True)
        observations.extend(value for value in parsed if not pd.isna(value))
    if not observations:
        return None
    return max(observations).isoformat()


def _empty_optionality(
    *,
    source_name: str,
    hv30: Optional[float],
    error: Optional[str] = None,
    reason: str = "options_data_unavailable",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "iv30": None,
        "hv30": hv30,
        "iv30_chain_percentile": None,
        "iv30_chain_position": None,
        "iv30_chain_percentile_kind": "current_chain_cross_section",
        "iv30_chain_percentile_metadata": {
            "scope": "current_near_money_chain_cross_section",
            "method": "midrank_empirical_cdf",
            "historical_series": False,
            "classification_thresholds": {
                "lower_cross_section_lt": 30.0,
                "upper_cross_section_gt": 70.0,
            },
        },
        # Retired ambiguous field. It must remain null so legacy consumers
        # cannot treat a chain cross-section as historical IV rank.
        "iv_percentile": None,
        "iv_percentile_kind": "retired_ambiguous_field",
        "iv_percentile_metadata": {
            "canonical_field": "iv30_chain_percentile",
            "retired": True,
            "reason": "ambiguous_with_historical_iv_rank",
        },
        "avg_edr": None,
        "data_source": f"{source_name}_option_chain",
        "quote_source": None,
        "observed_at": None,
        "retrieved_at": None,
        "latest_chain_observed_at": None,
        "iv30_observed_at": None,
        "iv30_observation_complete": False,
        "iv30_observation_business_session_lag": None,
        "iv30_contributing_expiries": [],
        "quote_observation_provenance": None,
        "latest_contract_trade_at": None,
        "pricing_basis": "acceptable_bid_ask_mid_only_for_edr",
        "price_source_counts": {"mid": 0, "last": 0, "missing": 0, "wide": 0, "crossed": 0},
        "sample_counts": {"iv": 0, "iv30": 0, "edr": 0},
        "iv30_method": None,
        "iv30_dte": None,
        "iv_term_points": [],
        "component_usable": {
            "iv30": False,
            "iv30_chain_percentile": False,
            "iv_percentile": False,
            "avg_edr": False,
            "mispricing": False,
        },
        "mispricing_usable": False,
        "quality_status": "unusable",
        "quality_reasons": [reason],
        "expiries_scanned": 0,
    }
    if error:
        payload["error"] = error
    return payload


def _apply_underlying_basis_quality(
    optionality: dict[str, Any],
    *,
    price: Optional[float],
    price_metadata: dict[str, Any],
) -> dict[str, Any]:
    payload = dict(optionality or {})
    payload["underlying_price"] = price
    payload["underlying_observed_at"] = price_metadata.get("observed_at")
    payload["underlying_source"] = price_metadata.get("source")
    underlying_usable = not bool(price_metadata.get("stale")) and price is not None and price > 0
    payload["underlying_basis_usable"] = underlying_usable
    if not underlying_usable:
        payload["mispricing_usable"] = False
        components = dict(payload.get("component_usable") or {})
        components["mispricing"] = False
        payload["component_usable"] = components
        payload["quality_status"] = "unusable"
        reasons = list(payload.get("quality_reasons") or [])
        if "stale_underlying_basis" not in reasons:
            reasons.append("stale_underlying_basis")
        payload["quality_reasons"] = reasons
    return payload


def compute_options_flow(
    provider: MarketDataProvider,
    symbol: str,
    current_price: Optional[float] = None,
) -> Optional[dict]:
    """Build a lightweight options flow snapshot from the nearest expiry."""
    for candidate in _ordered_option_providers(provider):
        try:
            expiries = candidate.option_expirations(symbol)
            if not expiries:
                continue
            spot = current_price
            if spot is None or spot <= 0:
                spot = candidate.quote(symbol).price
        except Exception:
            continue

        chain = None
        calls = pd.DataFrame()
        puts = pd.DataFrame()
        requested_strike_count = 0
        for exp in expiries[:8]:
            try:
                strikes = candidate.option_strikes(symbol, exp)
                if not strikes:
                    continue
                requested_strike_count = len(strikes)
                chain = candidate.option_chain(symbol, exp, right="ALL", strikes=strikes)
            except Exception:
                continue
            calls = chain.calls if chain else pd.DataFrame()
            puts = chain.puts if chain else pd.DataFrame()
            if not calls.empty or not puts.empty:
                break
        else:
            continue

        if calls.empty and puts.empty:
            continue

        def valid_contracts(df: pd.DataFrame) -> pd.DataFrame:
            if df is None or df.empty or "strike" not in df.columns:
                return pd.DataFrame()
            rows = df.copy()
            strikes = pd.to_numeric(rows["strike"], errors="coerce")
            rows = rows[strikes.notna() & np.isfinite(strikes) & (strikes > 0)].copy()
            rows["strike"] = strikes.loc[rows.index].astype(float)
            for field in ("openInterest", "volume"):
                values = pd.to_numeric(rows.get(field), errors="coerce")
                if not isinstance(values, pd.Series):
                    values = pd.Series(np.nan, index=rows.index, dtype=float)
                rows[field] = values.where(np.isfinite(values) & (values >= 0))
            return rows

        valid_calls = valid_contracts(calls)
        valid_puts = valid_contracts(puts)
        if spot is not None and spot > 0:
            call_wall_candidates = _near_atm(valid_calls, spot, threshold=0.15)
            put_wall_candidates = _near_atm(valid_puts, spot, threshold=0.15)
        else:
            call_wall_candidates = pd.DataFrame()
            put_wall_candidates = pd.DataFrame()

        def top_walls(df: pd.DataFrame) -> list:
            if df is None or df.empty:
                return []
            cols = df[["strike", "openInterest", "volume"]].fillna(0)
            cols = cols.sort_values("openInterest", ascending=False).head(3)
            return [
                {
                    "strike": float(row.strike),
                    "open_interest": int(row.openInterest),
                    "volume": int(row.volume),
                }
                for _, row in cols.iterrows()
            ]

        call_walls = top_walls(call_wall_candidates)
        put_walls = top_walls(put_wall_candidates)
        call_oi_total = int(valid_calls["openInterest"].fillna(0).sum()) if not valid_calls.empty else 0
        put_oi_total = int(valid_puts["openInterest"].fillna(0).sum()) if not valid_puts.empty else 0
        call_vol_total = int(valid_calls["volume"].fillna(0).sum()) if not valid_calls.empty else 0
        put_vol_total = int(valid_puts["volume"].fillna(0).sum()) if not valid_puts.empty else 0
        put_call_oi_ratio = round(put_oi_total / call_oi_total, 2) if call_oi_total > 0 else None

        chain_observed_at = getattr(chain, "observed_at", None) if chain else None
        chain_retrieved_at = getattr(chain, "retrieved_at", None) if chain else None
        latest_contract_trade_at = _latest_option_observation(valid_calls, valid_puts)
        flow_as_of = chain_observed_at or chain_retrieved_at or latest_contract_trade_at
        return {
            "expiry": chain.expiry if chain else None,
            "as_of": flow_as_of,
            "observed_at": chain_observed_at or latest_contract_trade_at,
            "retrieved_at": chain_retrieved_at,
            "quote_observation_provenance": (
                "chain_observed_at"
                if chain_observed_at
                else "contract_last_trade_legacy"
                if latest_contract_trade_at
                else None
            ),
            "latest_contract_trade_at": latest_contract_trade_at,
            "data_source": f"{chain.source or getattr(candidate, 'name', 'unknown')}_option_chain",
            "quote_source": chain.quote_source if chain else None,
            "call_walls": call_walls,
            "put_walls": put_walls,
            "call_open_interest_total": call_oi_total,
            "put_open_interest_total": put_oi_total,
            "call_volume_total": call_vol_total,
            "put_volume_total": put_vol_total,
            "put_call_oi_ratio": put_call_oi_ratio,
            "coverage": {
                "totals_scope": "full_valid_chain",
                "wall_scope": "within_15_percent_of_spot",
                "wall_strike_band_pct": 15.0,
                "spot": float(spot) if spot is not None and spot > 0 else None,
                "requested_strikes": requested_strike_count,
                "contracts_returned": {
                    "calls": int(len(calls)),
                    "puts": int(len(puts)),
                    "total": int(len(calls) + len(puts)),
                },
                "contracts_valid": {
                    "calls": int(len(valid_calls)),
                    "puts": int(len(valid_puts)),
                    "total": int(len(valid_calls) + len(valid_puts)),
                },
                "open_interest_observations": {
                    "calls": int(valid_calls["openInterest"].notna().sum()) if not valid_calls.empty else 0,
                    "puts": int(valid_puts["openInterest"].notna().sum()) if not valid_puts.empty else 0,
                },
                "volume_observations": {
                    "calls": int(valid_calls["volume"].notna().sum()) if not valid_calls.empty else 0,
                    "puts": int(valid_puts["volume"].notna().sum()) if not valid_puts.empty else 0,
                },
                "wall_candidates": {
                    "calls": int(len(call_wall_candidates)),
                    "puts": int(len(put_wall_candidates)),
                    "total": int(len(call_wall_candidates) + len(put_wall_candidates)),
                },
            },
        }

    return None


def compute_optionality_metrics(
    provider: MarketDataProvider,
    symbol: str,
    current_price: float,
    hv30: Optional[float],
    max_expiries: Optional[int] = None,
    strike_thresholds: Optional[list[float]] = None,
) -> dict:
    """Compute IV/HV spread, IV percentile, and extrinsic density ratio."""
    ordered_providers = _ordered_option_providers(provider)
    if len(ordered_providers) > 1:
        primary_metrics = compute_optionality_metrics(
            ordered_providers[0],
            symbol,
            current_price,
            hv30,
            max_expiries=max_expiries,
            strike_thresholds=strike_thresholds,
        )
        if _optionality_has_provider_data(primary_metrics):
            return primary_metrics

        fallback_metrics = primary_metrics
        for fallback_provider in ordered_providers[1:]:
            fallback_metrics = compute_optionality_metrics(
                fallback_provider,
                symbol,
                current_price,
                hv30,
                max_expiries=max_expiries,
                strike_thresholds=strike_thresholds,
            )
            if _optionality_has_provider_data(fallback_metrics):
                fallback_metrics = dict(fallback_metrics)
                fallback_metrics["fallback_reason"] = (
                    primary_metrics.get("error") or "primary_options_unavailable"
                )
                fallback_metrics["primary_data_source"] = primary_metrics.get("data_source")
                reasons = list(fallback_metrics.get("quality_reasons") or [])
                if "fallback_provider_used" not in reasons:
                    reasons.append("fallback_provider_used")
                fallback_metrics["quality_reasons"] = reasons
                if fallback_metrics.get("quality_status") == "good":
                    fallback_metrics["quality_status"] = "limited"
                return fallback_metrics
        return fallback_metrics

    source_name = getattr(provider, "name", "unknown")
    try:
        expiries = provider.option_expirations(symbol)
    except Exception as exc:
        return _empty_optionality(
            source_name=source_name,
            hv30=hv30,
            error=str(exc),
            reason="provider_error",
        )
    if not expiries:
        return _empty_optionality(
            source_name=source_name,
            hv30=hv30,
            reason="no_expirations",
        )

    today = _market_session_date()
    expiry_candidates = []
    for exp in expiries:
        exp_date = _parse_expiry(exp)
        if not exp_date:
            continue
        dte = (exp_date.date() - today).days
        if dte <= 0:
            continue
        expiry_candidates.append((exp, dte))

    if not expiry_candidates:
        return _empty_optionality(
            source_name=source_name,
            hv30=hv30,
            reason="no_future_expirations",
        )

    expiry_candidates.sort(key=lambda x: x[1])
    expiry_limit = max_expiries if max_expiries is not None and max_expiries > 0 else 6
    front_expiries = expiry_candidates[:expiry_limit]
    iv_values = []
    raw_iv_values = []
    edr_values = []
    iv30_sample_count = 0
    expiry_iv_points: list[dict[str, Any]] = []
    raw_expiry_iv_points: list[dict[str, Any]] = []
    iv30_method: Optional[str] = None
    iv30_dte: Optional[float] = None
    price_source_counts = {"mid": 0, "last": 0, "missing": 0, "wide": 0, "crossed": 0}
    iv30 = None
    quote_sources: set[str] = set()
    observation_values: list[pd.Timestamp] = []
    retrieval_values: list[pd.Timestamp] = []
    contract_trade_values: list[pd.Timestamp] = []
    observation_provenance: set[str] = set()
    acceptable_mid_counts = {"calls": 0, "puts": 0}
    thresholds = strike_thresholds or [0.05, 0.1, 0.2]

    def collect_iv_values(df: pd.DataFrame) -> None:
        if df is None or df.empty:
            return
        iv_series = df.get("impliedVolatility")
        if iv_series is None:
            return
        for val in iv_series.dropna().tolist():
            numeric = float(val)
            if 0.05 <= numeric <= 5.0:
                raw_iv_values.append(numeric * 100)

    expiries_scanned = 0
    for expiry, expiry_dte in front_expiries:
        try:
            all_strikes = provider.option_strikes(symbol, expiry)
        except Exception:
            continue

        near_calls = pd.DataFrame()
        near_puts = pd.DataFrame()
        near_chain = pd.DataFrame()
        chain_source = source_name
        expiry_observed_at: Optional[pd.Timestamp] = None
        expiry_retrieved_at: Optional[pd.Timestamp] = None
        for threshold in thresholds:
            near_strikes = [
                strike
                for strike in all_strikes
                if current_price > 0 and abs(strike - current_price) / current_price <= threshold
            ]
            if not near_strikes:
                continue
            try:
                chain = provider.option_chain(symbol, expiry, right="ALL", strikes=near_strikes)
            except Exception:
                continue
            chain_source = chain.source or source_name
            chain_quote_sources: set[str] = set()
            if chain.quote_source:
                chain_quote_sources.update(
                    source.strip().lower()
                    for source in str(chain.quote_source).split(",")
                    if source.strip()
                )
            chain_observed_at = getattr(chain, "observed_at", None)
            chain_retrieved_at = getattr(chain, "retrieved_at", None)
            parsed_expiry_observed_at: Optional[pd.Timestamp] = None
            parsed_expiry_retrieved_at: Optional[pd.Timestamp] = None
            if chain_observed_at:
                parsed_observed = pd.to_datetime(chain_observed_at, errors="coerce", utc=True)
                if not pd.isna(parsed_observed):
                    parsed_expiry_observed_at = pd.Timestamp(parsed_observed)
            if chain_retrieved_at:
                parsed_retrieved = pd.to_datetime(chain_retrieved_at, errors="coerce", utc=True)
                if not pd.isna(parsed_retrieved):
                    parsed_expiry_retrieved_at = pd.Timestamp(parsed_retrieved)
            calls = chain.calls if chain else pd.DataFrame()
            puts = chain.puts if chain else pd.DataFrame()
            near_calls = _near_atm(calls, current_price, threshold)
            near_puts = _near_atm(puts, current_price, threshold)
            near_chain = pd.concat([near_calls, near_puts], ignore_index=True)
            if not near_chain.empty:
                quote_sources.update(chain_quote_sources)
                expiry_observed_at = parsed_expiry_observed_at
                expiry_retrieved_at = parsed_expiry_retrieved_at
                break

        if near_chain.empty:
            continue

        if expiry_observed_at is not None:
            observation_values.append(expiry_observed_at)
            observation_provenance.add("chain_observed_at")
        if expiry_retrieved_at is not None:
            retrieval_values.append(expiry_retrieved_at)
        expiries_scanned += 1
        source_name = chain_source
        collect_iv_values(near_chain)
        expiry_usable_iv_values: list[float] = []
        latest_contract_trade = _latest_option_observation(near_calls, near_puts)
        if latest_contract_trade:
            contract_trade_values.append(pd.Timestamp(latest_contract_trade))

        for _, row in near_calls.iterrows():
            quote = option_quote_from_row(row)
            if quote.get("quality") == "crossed":
                price_source_counts["crossed"] += 1
                continue
            price = quote.get("premium")
            if not price:
                price_source_counts["missing"] += 1
                continue
            price_source = str(quote.get("price_source") or "missing")
            price_source_counts[price_source] = price_source_counts.get(price_source, 0) + 1
            if quote.get("quality") == "wide":
                price_source_counts["wide"] += 1
            if quote.get("quality") == "mid":
                acceptable_mid_counts["calls"] += 1
                quote_iv = quote.get("implied_volatility")
                if isinstance(quote_iv, (int, float)) and 0.05 <= float(quote_iv) <= 5.0:
                    normalized_iv = float(quote_iv) * 100.0
                    iv_values.append(normalized_iv)
                    expiry_usable_iv_values.append(normalized_iv)
                intrinsic = max(current_price - row.strike, 0)
                extrinsic = max(price - intrinsic, 0)
                edr_values.append(extrinsic / price if price > 0 else 0)

        for _, row in near_puts.iterrows():
            quote = option_quote_from_row(row)
            if quote.get("quality") == "crossed":
                price_source_counts["crossed"] += 1
                continue
            price = quote.get("premium")
            if not price:
                price_source_counts["missing"] += 1
                continue
            price_source = str(quote.get("price_source") or "missing")
            price_source_counts[price_source] = price_source_counts.get(price_source, 0) + 1
            if quote.get("quality") == "wide":
                price_source_counts["wide"] += 1
            if quote.get("quality") == "mid":
                acceptable_mid_counts["puts"] += 1
                quote_iv = quote.get("implied_volatility")
                if isinstance(quote_iv, (int, float)) and 0.05 <= float(quote_iv) <= 5.0:
                    normalized_iv = float(quote_iv) * 100.0
                    iv_values.append(normalized_iv)
                    expiry_usable_iv_values.append(normalized_iv)
                intrinsic = max(row.strike - current_price, 0)
                extrinsic = max(price - intrinsic, 0)
                edr_values.append(extrinsic / price if price > 0 else 0)

        iv_series = near_chain.get("impliedVolatility")
        if iv_series is not None:
            plausible = pd.to_numeric(iv_series, errors="coerce")
            plausible = plausible[(plausible >= 0.05) & (plausible <= 5.0)].dropna()
            if len(plausible) >= 4:
                raw_expiry_iv_points.append(
                    {
                        "expiry": expiry,
                        "dte": int(expiry_dte),
                        "iv": float(plausible.median() * 100.0),
                        "samples": int(len(plausible)),
                        "observed_at": expiry_observed_at.isoformat()
                        if expiry_observed_at is not None
                        else None,
                    }
                )
        if len(expiry_usable_iv_values) >= 4:
            expiry_iv_points.append(
                {
                    "expiry": expiry,
                    "dte": int(expiry_dte),
                    "iv": float(np.median(expiry_usable_iv_values)),
                    "samples": int(len(expiry_usable_iv_values)),
                    "observed_at": expiry_observed_at.isoformat()
                    if expiry_observed_at is not None
                    else None,
                }
            )

    iv30_chain_percentile = None
    iv30_chain_position = None

    def derive_30d(
        points_input: list[dict[str, Any]],
    ) -> tuple[Optional[float], Optional[str], Optional[float], int, list[dict[str, Any]]]:
        if not points_input:
            return None, None, None, 0, []
        points = sorted(points_input, key=lambda point: point["dte"])
        lower = [point for point in points if point["dte"] <= 30]
        upper = [point for point in points if point["dte"] >= 30]
        lower_point = lower[-1] if lower else None
        upper_point = upper[0] if upper else None
        if lower_point and upper_point:
            if lower_point["dte"] == upper_point["dte"]:
                return (
                    round(float(lower_point["iv"]), 2),
                    "exact_expiry" if lower_point["dte"] == 30 else "nearest_expiry",
                    float(lower_point["dte"]),
                    int(lower_point["samples"]),
                    [lower_point],
                )
            else:
                weight = (30.0 - lower_point["dte"]) / (upper_point["dte"] - lower_point["dte"])
                lower_total_variance = float(lower_point["iv"]) ** 2 * float(lower_point["dte"])
                upper_total_variance = float(upper_point["iv"]) ** 2 * float(upper_point["dte"])
                target_total_variance = lower_total_variance + weight * (
                    upper_total_variance - lower_total_variance
                )
                return (
                    round(float(math.sqrt(target_total_variance / 30.0)), 2),
                    "total_variance_interpolation",
                    30.0,
                    int(lower_point["samples"] + upper_point["samples"]),
                    [lower_point, upper_point],
                )
        else:
            nearest = min(points, key=lambda point: abs(point["dte"] - 30))
            if abs(int(nearest["dte"]) - 30) <= 7:
                return (
                    round(float(nearest["iv"]), 2),
                    "nearest_expiry",
                    float(nearest["dte"]),
                    int(nearest["samples"]),
                    [nearest],
                )
        return None, None, None, 0, []

    iv30, iv30_method, iv30_dte, iv30_sample_count, iv30_contributors = derive_30d(expiry_iv_points)
    raw_iv30, raw_iv30_method, raw_iv30_dte, raw_iv30_sample_count, _ = derive_30d(raw_expiry_iv_points)

    if iv30 is not None and len(iv_values) >= 8:
        # Midrank empirical CDF avoids classifying a flat/tied chain at the
        # 100th percentile. This is a current-chain cross-section, not a
        # historical IV rank.
        below = sum(1 for value in iv_values if value < iv30 and not math.isclose(value, iv30))
        tied = sum(1 for value in iv_values if math.isclose(value, iv30))
        iv30_chain_percentile = round(((below + 0.5 * tied) / len(iv_values)) * 100, 1)
        if iv30_chain_percentile < 30.0:
            iv30_chain_position = "lower_cross_section"
        elif iv30_chain_percentile > 70.0:
            iv30_chain_position = "upper_cross_section"
        else:
            iv30_chain_position = "middle_cross_section"

    avg_edr = None
    if len(edr_values) >= 4:
        avg_edr = round(float(np.mean(edr_values) * 100), 2)

    hv_usable = hv30 is not None and 2.0 <= float(hv30) <= 200.0
    latest_chain_observed_at = max(observation_values) if observation_values else None
    retrieved_at = max(retrieval_values) if retrieval_values else None
    latest_contract_trade_at = max(contract_trade_values) if contract_trade_values else None

    iv30_contributor_observations: list[pd.Timestamp] = []
    for point in iv30_contributors:
        parsed = pd.to_datetime(point.get("observed_at"), errors="coerce", utc=True)
        if not pd.isna(parsed):
            iv30_contributor_observations.append(pd.Timestamp(parsed))
    iv30_observation_complete = bool(iv30_contributors) and (
        len(iv30_contributor_observations) == len(iv30_contributors)
    )
    # An interpolation is only as fresh as its oldest contributing bracket leg.
    iv30_observed_at = min(iv30_contributor_observations) if iv30_contributor_observations else None
    observed_at = iv30_observed_at or latest_chain_observed_at
    observation_session_lag = None
    if observed_at is not None:
        now_utc = pd.Timestamp.now(tz="UTC")
        observed_utc = observed_at.tz_convert("UTC") if observed_at.tzinfo else observed_at.tz_localize("UTC")
        observation_session_lag = max(
            0,
            len(pd.bdate_range(observed_utc.normalize(), now_utc.normalize())) - 1,
        )
    observation_fresh = (
        iv30_observation_complete
        and observation_session_lag is not None
        and observation_session_lag <= 2
    )
    two_sided_mid_coverage = all(count >= 2 for count in acceptable_mid_counts.values())
    frozen_quote_source = bool(quote_sources.intersection({"frozen", "delayed_frozen"}))
    quote_provenance_usable = (
        bool(quote_sources)
        and two_sided_mid_coverage
        and observation_fresh
        and not frozen_quote_source
    )
    chain_percentile_usable = iv30_chain_percentile is not None and quote_provenance_usable
    component_usable = {
        "iv30": iv30 is not None and quote_provenance_usable,
        "iv30_chain_percentile": chain_percentile_usable,
        # Retired because legacy consumers interpret it as historical IV rank.
        "iv_percentile": False,
        "avg_edr": avg_edr is not None,
        "mispricing": iv30 is not None and hv_usable and quote_provenance_usable,
    }
    quality_reasons: list[str] = []
    if len(iv_values) < 4:
        quality_reasons.append("insufficient_plausible_iv_samples")
    if iv30 is None:
        quality_reasons.append("iv30_unusable")
        if expiry_iv_points:
            quality_reasons.append("no_usable_30d_expiry_or_bracket")
    if iv30_chain_percentile is None:
        quality_reasons.append("iv30_chain_percentile_sample_too_small")
    if avg_edr is None:
        quality_reasons.append("insufficient_acceptable_mid_quotes_for_edr")
    if len(edr_values) < 4:
        quality_reasons.append("insufficient_acceptable_mid_quotes_for_mispricing")
    if not two_sided_mid_coverage:
        quality_reasons.append("insufficient_two_sided_mid_coverage")
    if price_source_counts.get("last", 0) > 0 and price_source_counts.get("mid", 0) == 0:
        quality_reasons.append("last_trade_only_pricing")
    if not quote_sources:
        quality_reasons.append("missing_quote_source")
    if frozen_quote_source:
        quality_reasons.append("frozen_quote_source")
    if not hv_usable:
        quality_reasons.append("historical_volatility_unusable")
    if iv30 is not None and not iv30_observation_complete:
        quality_reasons.append("iv30_contributor_observation_incomplete")
    if not observation_values:
        quality_reasons.append("quote_observation_unavailable")
    elif iv30_observation_complete and not observation_fresh:
        quality_reasons.append("stale_quote_observation")
    if (
        component_usable["mispricing"]
        and component_usable["avg_edr"]
        and component_usable["iv30_chain_percentile"]
    ):
        quality_status = "good"
    elif component_usable["mispricing"]:
        quality_status = "limited"
    else:
        quality_status = "unusable"

    return {
        "iv30": iv30,
        "raw_iv30": raw_iv30,
        "raw_iv30_method": raw_iv30_method,
        "raw_iv30_dte": raw_iv30_dte,
        "hv30": hv30,
        "iv30_chain_percentile": iv30_chain_percentile,
        "iv30_chain_position": iv30_chain_position,
        "iv30_chain_percentile_kind": "current_chain_cross_section",
        "iv30_chain_percentile_metadata": {
            "scope": "current_near_money_chain_cross_section",
            "method": "midrank_empirical_cdf",
            "historical_series": False,
            "classification_thresholds": {
                "lower_cross_section_lt": 30.0,
                "upper_cross_section_gt": 70.0,
            },
        },
        # Retired ambiguous field. It must remain null so legacy consumers
        # fail closed instead of treating this descriptor as historical rank.
        "iv_percentile": None,
        "iv_percentile_kind": "retired_ambiguous_field",
        "iv_percentile_metadata": {
            "canonical_field": "iv30_chain_percentile",
            "retired": True,
            "reason": "ambiguous_with_historical_iv_rank",
        },
        "avg_edr": avg_edr,
        "data_source": f"{source_name}_option_chain",
        "quote_source": ",".join(sorted(quote_sources)) if quote_sources else None,
        "observed_at": (
            observed_at.isoformat()
            if observed_at is not None
            else latest_contract_trade_at.isoformat()
            if latest_contract_trade_at is not None
            else None
        ),
        "retrieved_at": retrieved_at.isoformat() if retrieved_at is not None else None,
        "latest_chain_observed_at": (
            latest_chain_observed_at.isoformat()
            if latest_chain_observed_at is not None
            else None
        ),
        "iv30_observed_at": iv30_observed_at.isoformat() if iv30_observed_at is not None else None,
        "iv30_observation_complete": iv30_observation_complete,
        "iv30_contributing_expiries": [
            {
                "expiry": point.get("expiry"),
                "dte": point.get("dte"),
                "samples": point.get("samples"),
                "observed_at": point.get("observed_at"),
            }
            for point in iv30_contributors
        ],
        "quote_observation_provenance": (
            ",".join(sorted(observation_provenance))
            if observation_provenance
            else "contract_last_trade_legacy"
            if latest_contract_trade_at is not None
            else None
        ),
        "latest_contract_trade_at": (
            latest_contract_trade_at.isoformat()
            if latest_contract_trade_at is not None
            else None
        ),
        "observation_business_session_lag": observation_session_lag,
        "iv30_observation_business_session_lag": observation_session_lag,
        "pricing_basis": "acceptable_bid_ask_mid_only_for_edr",
        "price_source_counts": price_source_counts,
        "sample_counts": {
            "iv": len(iv_values),
            "raw_iv": len(raw_iv_values),
            "iv30": iv30_sample_count,
            "raw_iv30": raw_iv30_sample_count,
            "edr": len(edr_values),
            "acceptable_mid_calls": acceptable_mid_counts["calls"],
            "acceptable_mid_puts": acceptable_mid_counts["puts"],
        },
        "iv30_method": iv30_method,
        "iv30_dte": iv30_dte,
        "iv_term_points": expiry_iv_points,
        "component_usable": component_usable,
        "mispricing_usable": component_usable["mispricing"],
        "quality_status": quality_status,
        "quality_reasons": quality_reasons,
        "expiries_scanned": expiries_scanned,
    }


def calculate_take_profit(current_price: float, return_pct: float, volatility: float, horizon_days: int) -> float:
    """
    Calculate take profit target based on:
    - Expected return over horizon
    - Volatility adjustment
    - Time horizon scaling
    """
    # Apply confidence adjustments only to a positive trailing-price move. The
    # price anchor itself must never be discounted by volatility; otherwise an
    # "upper" reference can fall below the latest close.
    directional_move = current_price * max(0.0, return_pct) * 0.6
    vol_adjustment = max(0.5, 1 - (volatility / 100 * 0.15))
    horizon_multiplier = 1 + (horizon_days / 252 * 0.05)
    target = current_price + directional_move * vol_adjustment * horizon_multiplier
    return max(current_price, target)


def _latest_series_value(fundamentals: Optional[dict], key: str) -> Optional[float]:
    if not isinstance(fundamentals, dict):
        return None
    series_payload = fundamentals.get(key)
    if not isinstance(series_payload, dict):
        return None
    series = series_payload.get("series")
    if not isinstance(series, list) or not series:
        return None
    last_point = series[-1]
    if not isinstance(last_point, dict):
        return None
    value = last_point.get("value")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def _snapshot_value(fundamentals: Optional[dict], key: str) -> Optional[float]:
    if not isinstance(fundamentals, dict):
        return None
    snapshot = fundamentals.get("snapshot")
    metric = snapshot.get(key) if isinstance(snapshot, dict) else None
    value = metric.get("value") if isinstance(metric, dict) else None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _sanity_profile_for_horizon(horizon_days: int) -> dict[str, float]:
    if horizon_days <= 21:
        return {
            "max_cap_growth_multiple": 1.60,
            "analyst_gap_multiple": 1.30,
            "max_implied_pe": 80.0,
        }
    if horizon_days <= 63:
        return {
            "max_cap_growth_multiple": 1.90,
            "analyst_gap_multiple": 1.45,
            "max_implied_pe": 95.0,
        }
    if horizon_days <= 126:
        return {
            "max_cap_growth_multiple": 2.35,
            "analyst_gap_multiple": 1.65,
            "max_implied_pe": 115.0,
        }
    return {
        "max_cap_growth_multiple": 3.00,
        "analyst_gap_multiple": 2.00,
        "max_implied_pe": 140.0,
    }


def _compute_projection_targets(
    current_price: float,
    raw_upper_reference: float,
    horizon_days: int,
    analyst_target: Optional[float] = None,
    fundamentals: Optional[dict] = None,
) -> dict[str, Any]:
    if current_price <= 0:
        return {
            "raw_upper_reference": raw_upper_reference,
            "valuation_adjusted_target": raw_upper_reference,
            "trade_target": raw_upper_reference,
            "speculative_extension": None,
            "sanity_flags": [],
            "implied_market_cap": {
                "current": None,
                "raw_upper_reference": None,
                "valuation_adjusted_target": None,
                "trade_target": None,
                "speculative_extension": None,
            },
            "target_regime": "technical_extension",
        }

    profile = _sanity_profile_for_horizon(horizon_days)
    sanity_flags: list[dict[str, Any]] = []
    raw_upper_reference = max(float(current_price), float(raw_upper_reference))

    max_cap_growth_multiple = float(profile["max_cap_growth_multiple"])
    analyst_gap_multiple = float(profile["analyst_gap_multiple"])
    max_implied_pe = float(profile["max_implied_pe"])

    cap_limited_target = current_price * max_cap_growth_multiple

    valid_analyst_target = None
    if analyst_target is not None:
        try:
            parsed_analyst = float(analyst_target)
            if parsed_analyst > 0:
                valid_analyst_target = parsed_analyst
        except (TypeError, ValueError):
            valid_analyst_target = None

    if raw_upper_reference > cap_limited_target:
        sanity_flags.append(
            {
                "type": "implied_market_cap_outlier",
                "severity": "high",
                "message": "Raw extension implies market-cap growth beyond horizon sanity band.",
                "threshold": round(max_cap_growth_multiple, 2),
                "value": round(raw_upper_reference / current_price, 2),
            }
        )

    if valid_analyst_target and raw_upper_reference > valid_analyst_target * analyst_gap_multiple:
        severity = "high" if raw_upper_reference > valid_analyst_target * (analyst_gap_multiple * 1.2) else "medium"
        sanity_flags.append(
            {
                "type": "analyst_dislocation",
                "severity": severity,
                "message": "Raw extension is materially above analyst consensus anchor.",
                "threshold": round(analyst_gap_multiple, 2),
                "value": round(raw_upper_reference / valid_analyst_target, 2),
            }
        )

    current_pe = _snapshot_value(fundamentals, "pe_ratio")
    if current_pe is None:
        current_pe = _latest_series_value(fundamentals, "pe_ratio")
    if current_pe is None:
        current_pe = _latest_series_value(fundamentals, "pe_ratio_annual")
    implied_raw_pe = None
    implied_adjusted_pe = None
    if current_pe and current_pe > 0:
        implied_raw_pe = current_pe * (raw_upper_reference / current_price)
        if implied_raw_pe > max_implied_pe:
            sanity_flags.append(
                {
                    "type": "implied_pe_outlier",
                    "severity": "medium",
                    "message": "Raw extension implies an extreme price/TTM-EPS multiple.",
                    "threshold": round(max_implied_pe, 2),
                    "value": round(implied_raw_pe, 2),
                }
            )

    valuation_candidates: list[tuple[float, float]] = [(cap_limited_target, 0.45)]
    if valid_analyst_target is not None:
        valuation_candidates.append((valid_analyst_target, 0.55))

    weighted_sum = sum(value * weight for value, weight in valuation_candidates)
    weight_total = sum(weight for _, weight in valuation_candidates)
    valuation_anchor = weighted_sum / weight_total if weight_total > 0 else cap_limited_target
    valuation_adjusted_target = min(raw_upper_reference, max(current_price, valuation_anchor))

    if current_pe and current_pe > 0:
        implied_adjusted_pe = current_pe * (valuation_adjusted_target / current_price)
        if implied_adjusted_pe > max_implied_pe:
            pe_capped_target = current_price * (max_implied_pe / current_pe)
            valuation_adjusted_target = max(
                current_price,
                min(valuation_adjusted_target, pe_capped_target),
            )
            implied_adjusted_pe = current_pe * (valuation_adjusted_target / current_price)

    has_high_flag = any(flag.get("severity") == "high" for flag in sanity_flags)
    trade_target = max(current_price, min(raw_upper_reference, valuation_adjusted_target))
    valuation_cap_applied = trade_target < raw_upper_reference
    if valuation_cap_applied:
        sanity_flags.append(
            {
                "type": "valuation_anchor_cap_applied",
                "severity": "info",
                "message": "Trade target is capped by the valuation and analyst anchor blend.",
                "threshold": round(valuation_adjusted_target, 2),
                "value": round(raw_upper_reference, 2),
            }
        )

    speculative_extension = None
    if raw_upper_reference > trade_target * 1.03:
        speculative_extension = raw_upper_reference

    current_market_cap = _snapshot_value(fundamentals, "market_cap")
    if current_market_cap is None:
        current_market_cap = _latest_series_value(fundamentals, "market_cap")
    if current_market_cap is None:
        current_market_cap = _latest_series_value(fundamentals, "market_cap_annual")

    def _scale_market_cap(target_price: Optional[float]) -> Optional[float]:
        if current_market_cap is None or target_price is None or current_price <= 0:
            return None
        return current_market_cap * (target_price / current_price)

    if valuation_cap_applied:
        target_regime = "valuation_adjusted"
    elif has_high_flag:
        target_regime = "technical_extension_flagged"
    elif sanity_flags:
        target_regime = "technical_extension_flagged"
    else:
        target_regime = "technical_extension"

    if not sanity_flags and valid_analyst_target is None and current_market_cap is None:
        target_regime = "technical_extension_unanchored"

    return {
        "raw_upper_reference": raw_upper_reference,
        "valuation_adjusted_target": valuation_adjusted_target,
        "trade_target": trade_target,
        "speculative_extension": speculative_extension,
        "sanity_flags": sanity_flags,
        "implied_market_cap": {
            "current": _scale_market_cap(current_price),
            "raw_upper_reference": _scale_market_cap(raw_upper_reference),
            "valuation_adjusted_target": _scale_market_cap(valuation_adjusted_target),
            "trade_target": _scale_market_cap(trade_target),
            "speculative_extension": _scale_market_cap(speculative_extension),
        },
        "target_regime": target_regime,
    }


def calculate_stop_loss(current_price: float, volatility: float, risk_score: float, horizon_days: int) -> float:
    """
    Calculate stop loss based on:
    - Volatility (higher vol = wider stops)
    - Risk score (higher risk = tighter stops)
    - Time horizon
    """
    # Base stop: 1.5 ATR equivalent (tighter than before)
    atr_equivalent = current_price * (volatility / 100) * 0.35
    
    # Risk adjustment (more conservative)
    risk_adjustment = (100 - risk_score) / 100 * 0.8  # Up to 0.8x ATR for low-risk assets
    
    # Horizon adjustment (tighter multiplier)
    horizon_factor = 1 + (min(horizon_days, 252) / 252 * 0.15)
    
    stop_loss = current_price - (atr_equivalent * (1 + risk_adjustment) * horizon_factor)
    return max(0.0, stop_loss)


def calculate_rsi(df: pd.DataFrame, period: int = 14) -> tuple:
    """Calculate RSI and return current value and historical values"""
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    return rsi.iloc[-1], rsi


def calculate_macd(df: pd.DataFrame, lookback_days: int = 252) -> dict:
    """Calculate MACD, signal line, and histogram for full lookback period"""
    ema_12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema_26 = df['Close'].ewm(span=26, adjust=False).mean()
    
    macd = ema_12 - ema_26
    signal = macd.ewm(span=9, adjust=False).mean()
    histogram = macd - signal
    
    return {
        "macd": macd.iloc[-1],
        "signal": signal.iloc[-1],
        "histogram": histogram.iloc[-1],
        "macd_series": macd.tail(lookback_days).tolist(),
        "signal_series": signal.tail(lookback_days).tolist(),
        "histogram_series": histogram.tail(lookback_days).tolist(),
    }


def calculate_technical_indicators(df: pd.DataFrame, lookback_days: int = 252) -> dict:
    """Calculate all technical indicators for 252-day lookback"""
    
    # Get last 252 days of data
    lookback_df = df.tail(lookback_days).copy()
    
    if len(lookback_df) < 50:
        return {"error": "Insufficient data for technical analysis"}
    
    # OHLC data for candlestick chart (return all candles, no sampling)
    candles = []
    
    for date, row in lookback_df.iterrows():
        candles.append({
            "date": date.strftime("%Y-%m-%d"),
            "open": float(row['Open']),
            "high": float(row['High']),
            "low": float(row['Low']),
            "close": float(row['Close']),
            "volume": int(row.get('Volume', 0)) if 'Volume' in row else 0,
        })
    
    # RSI
    rsi_current, rsi_series = calculate_rsi(lookback_df)
    
    # MACD
    macd_data = calculate_macd(lookback_df, lookback_days)
    
    # EMA 50 and 200
    ema_50 = lookback_df['Close'].ewm(span=50, adjust=False).mean().iloc[-1]
    ema_200 = lookback_df['Close'].ewm(span=200, adjust=False).mean().iloc[-1] if len(lookback_df) >= 200 else None
    
    # Price levels
    current_price = lookback_df['Close'].iloc[-1]
    high_52w = lookback_df['High'].max()
    low_52w = lookback_df['Low'].min()
    
    # Trend
    trend = "uptrend" if current_price > ema_50 else "downtrend" if ema_200 and current_price < ema_200 else "neutral"
    
    return {
        "lookback_days": len(lookback_df),
        "current_price": float(current_price),
        "high_52w": float(high_52w),
        "low_52w": float(low_52w),
        # Preserve legacy field names for frontend compatibility; values are EMA-based.
        "sma_50": float(ema_50),
        "sma_200": float(ema_200) if ema_200 else None,
        "trend": trend,
        "rsi": {
            "current": float(rsi_current),
            "status": "overbought" if rsi_current > 70 else "oversold" if rsi_current < 30 else "neutral",
            "series": rsi_series.tail(lookback_days).tolist(),
        },
        "macd": {
            "current": float(macd_data["macd"]),
            "signal": float(macd_data["signal"]),
            "histogram": float(macd_data["histogram"]),
            "status": "bullish" if macd_data["histogram"] > 0 else "bearish",
            "macd_series": macd_data["macd_series"],
            "signal_series": macd_data["signal_series"],
            "histogram_series": macd_data["histogram_series"],
        },
        "candles": candles,
    }


def _trading_return_frame(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
    if df is None or df.empty or "Close" not in df.columns:
        return pd.DataFrame()
    frame = df.copy()
    index = pd.to_datetime(frame.index, errors="coerce", utc=True)
    frame = frame[index.notna()].copy()
    index = index[index.notna()].tz_convert(None).normalize()
    frame.index = index
    raw_close = pd.to_numeric(frame["Close"], errors="coerce")
    adjusted = frame.get("Adjusted Close")
    if adjusted is not None:
        adjusted = pd.to_numeric(adjusted, errors="coerce").where(lambda values: values > 0)
    else:
        adjusted = pd.Series(index=frame.index, dtype=float)
    normalized = pd.DataFrame(
        {
            f"{prefix}_price": raw_close,
            f"{prefix}_adjusted_price": adjusted,
        },
        index=frame.index,
    )
    return normalized[~normalized.index.duplicated(keep="last")].sort_index()


def compute_stock_projection(
    ticker: str,
    df: pd.DataFrame,
    spy_df: pd.DataFrame,
    horizon_days: int,
    system_state: str,
    analyst_target: Optional[float] = None,
    fundamentals: Optional[dict] = None,
) -> dict:
    """Compute projection scores for a single stock at a given horizon"""
    
    stock_returns = _trading_return_frame(df, "stock")
    benchmark_returns = _trading_return_frame(spy_df, "benchmark")
    stock_latest = stock_returns.index.max() if not stock_returns.empty else None
    benchmark_latest = benchmark_returns.index.max() if not benchmark_returns.empty else None
    series_session_gap = 0
    if stock_latest is not None and benchmark_latest is not None and stock_latest != benchmark_latest:
        earlier, later = sorted((pd.Timestamp(stock_latest), pd.Timestamp(benchmark_latest)))
        series_session_gap = max(0, len(pd.bdate_range(earlier, later)) - 1)
        if series_session_gap > 0:
            raise ValueError(
                "Stock and benchmark latest observations do not match; "
                "relative analysis is unavailable."
            )
    aligned = stock_returns.join(benchmark_returns, how="inner")
    aligned = aligned.dropna(subset=["stock_price", "benchmark_price"])
    required_closes = horizon_days + 1
    if len(aligned) < required_closes:
        raise ValueError(
            f"Insufficient aligned trading dates: need {required_closes} closes for "
            f"a {horizon_days}-session return, have {len(aligned)}"
        )

    # Stock and benchmark endpoints are intentionally selected from the same
    # trading dates. This prevents holiday gaps from comparing mismatched bars.
    window = aligned.iloc[-required_closes:]
    use_adjusted_returns = bool(
        window["stock_adjusted_price"].notna().all()
        and window["benchmark_adjusted_price"].notna().all()
        and (window["stock_adjusted_price"] > 0).all()
        and (window["benchmark_adjusted_price"] > 0).all()
    )
    stock_total_return_price = (
        window["stock_adjusted_price"] if use_adjusted_returns else window["stock_price"]
    )
    benchmark_total_return_price = (
        window["benchmark_adjusted_price"] if use_adjusted_returns else window["benchmark_price"]
    )
    analysis_observed_at = _utc_iso(window.index[-1])
    analysis_cutoff = pd.Timestamp(window.index[-1]).normalize()
    source_index = pd.to_datetime(df.index, errors="coerce", utc=True).tz_convert(None).normalize()
    analysis_df = df[source_index <= analysis_cutoff]
    
    # 1. TREND SCORE (45% weight)
    # Return over period
    total_return = (
        stock_total_return_price.iloc[-1]
        / stock_total_return_price.iloc[0]
    ) - 1
    price_return = (window["stock_price"].iloc[-1] / window["stock_price"].iloc[0]) - 1
    
    # SMA distance (200-day)
    sma_200 = analysis_df['Close'].rolling(200).mean().iloc[-1]
    sma_distance = (window["stock_price"].iloc[-1] / sma_200) - 1 if not pd.isna(sma_200) else 0
    
    # Trend composite (normalize to 0-100 scale)
    trend_raw = total_return + (0.5 * sma_distance)
    trend_score = max(0, min(100, (trend_raw + 0.5) * 100))  # Simple normalization
    
    # 2. RELATIVE STRENGTH SCORE (30% weight)
    spy_return = (
        benchmark_total_return_price.iloc[-1]
        / benchmark_total_return_price.iloc[0]
    ) - 1
    relative_strength_raw = total_return - spy_return
    rel_strength_score = max(0, min(100, (relative_strength_raw + 0.5) * 100))
    
    # 3. RISK SCORE (20% weight, inverted)
    # Realized volatility (20-day rolling, annualized)
    aligned_returns = stock_total_return_price.pct_change()
    volatility = aligned_returns.rolling(20).std().mean() * np.sqrt(252) * 100
    
    # Max drawdown
    cumulative = stock_total_return_price / float(stock_total_return_price.iloc[0])
    running_max = cumulative.expanding().max()
    drawdown = ((cumulative - running_max) / running_max * 100).min()
    max_drawdown = abs(drawdown)
    
    # Risk composite (lower risk = higher score)
    risk_raw = volatility + (0.5 * max_drawdown)
    risk_score = max(0, min(100, 100 - (risk_raw * 2)))  # Inverted and normalized
    
    # 4. REGIME ADJUSTMENT (5% weight)
    regime_score = 50  # Neutral baseline
    if system_state == "RED":
        # Penalize high volatility in red market
        if volatility > 30:
            regime_score = 45
    
    # COMPOSITE SCORE
    composite_score = (
        0.45 * trend_score +
        0.30 * rel_strength_score +
        0.20 * risk_score +
        0.05 * regime_score
    )
    
    # CONVICTION CALCULATION (confidence in the projection)
    # Based on score consistency and direction strength
    conviction = compute_conviction(
        trend_score, 
        rel_strength_score, 
        risk_score, 
        volatility,
        composite_score
    )
    
    # PRICE TARGETS (Take Profit and Stop Loss)
    current_price = window["stock_price"].iloc[-1]
    atr_20 = calculate_atr(analysis_df, 20)
    
    # Take profit: based on positive return + volatility adjustment
    raw_upper_reference = calculate_take_profit(
        current_price,
        price_return,
        volatility,
        horizon_days
    )

    target_meta = _compute_projection_targets(
        current_price=current_price,
        raw_upper_reference=raw_upper_reference,
        horizon_days=horizon_days,
        analyst_target=analyst_target,
        fundamentals=fundamentals,
    )
    trade_target = float(target_meta["trade_target"])
    
    # Stop loss: based on volatility and risk score
    stop_loss = calculate_stop_loss(
        current_price,
        volatility,
        risk_score,
        horizon_days
    )
    
    return {
        "score_total": round(composite_score, 2),
        "score_trend": round(trend_score, 2),
        "score_relative_strength": round(rel_strength_score, 2),
        "score_risk": round(risk_score, 2),
        "score_regime": round(regime_score, 2),
        "trailing_return_pct": round(total_return * 100, 2),
        "trailing_price_return_pct": round(price_return * 100, 2),
        "benchmark_trailing_return_pct": round(spy_return * 100, 2),
        "return_basis": "adjusted_close" if use_adjusted_returns else "raw_close_fallback",
        "analysis_observed_at": analysis_observed_at,
        "stock_benchmark_session_gap": series_session_gap,
        "volatility": round(volatility, 2),
        "max_drawdown": round(max_drawdown, 2),
        "conviction": round(conviction, 2),
        "current_price": round(current_price, 2),
        # Backward-compatible alias; canonical field is trade_target.
        "take_profit": round(trade_target, 2),
        "raw_upper_reference": round(float(target_meta["raw_upper_reference"]), 2),
        "valuation_adjusted_target": round(float(target_meta["valuation_adjusted_target"]), 2),
        "trade_target": round(trade_target, 2),
        "speculative_extension": round(float(target_meta["speculative_extension"]), 2)
        if target_meta.get("speculative_extension") is not None
        else None,
        "sanity_flags": target_meta.get("sanity_flags", []),
        "implied_market_cap": target_meta.get("implied_market_cap", {}),
        "target_regime": target_meta.get("target_regime"),
        "stop_loss": round(stop_loss, 2),
        "analysis_kind": "trailing_window",
        "lookback_days": int(horizon_days),
    }


def _calendar_month_cutoff_frames(
    df: pd.DataFrame,
    spy_df: pd.DataFrame,
    months: int = 3,
) -> tuple[pd.DataFrame, pd.DataFrame, str, Optional[str]]:
    latest_date = pd.to_datetime(df.index, errors="coerce", utc=True).max().normalize()
    calendar_cutoff = latest_date - pd.DateOffset(months=months)
    stock_index = pd.to_datetime(df.index, errors="coerce", utc=True).normalize()
    spy_index = pd.to_datetime(spy_df.index, errors="coerce", utc=True).normalize()
    historical_df = df[stock_index <= calendar_cutoff]
    historical_spy = spy_df[spy_index <= calendar_cutoff]
    stock_dates = pd.DatetimeIndex(
        pd.to_datetime(historical_df.index, errors="coerce", utc=True)
    ).normalize()
    spy_dates = pd.DatetimeIndex(
        pd.to_datetime(historical_spy.index, errors="coerce", utc=True)
    ).normalize()
    shared_dates = stock_dates.intersection(spy_dates)
    observed_at = None
    if not shared_dates.empty:
        shared_max = shared_dates.max()
        historical_df = historical_df[stock_dates <= shared_max]
        historical_spy = historical_spy[spy_dates <= shared_max]
        observed_at = _utc_iso(shared_max)
    return (
        historical_df,
        historical_spy,
        calendar_cutoff.date().isoformat(),
        observed_at,
    )


@router.get("/stocks/{ticker}/projections")
def get_stock_projections(
    ticker: str = Path(..., description="Stock ticker symbol (e.g., AAPL, TSLA)"),
    history_window: Literal["252d", "1y", "5y", "max"] = Query("252d", description="Price history window for chart payload"),
):
    """Return multi-window trailing analysis for a single stock."""

    ticker = ticker.upper()
    cached_payload = _get_stock_projection_cache(ticker)
    data_warnings: list[dict[str, Any]] = []
    stock_name = ticker
    analyst_target = None
    analyst_count = None
    options_flow = None
    optionality: dict[str, Any] = {}
    institutional_flow = None
    projections: dict[str, Any] = {}
    historical_score: Optional[float] = None
    technical_data: Optional[dict[str, Any]] = None
    fundamentals: dict[str, Any] = {}
    historical_cutoff_date: Optional[str] = None
    historical_observed_at: Optional[str] = None
    computed_at = datetime.now(timezone.utc).isoformat()
    created_at = computed_at

    # Daily frames are pulled before accepting a calculation cache so a newly
    # observed close can never be paired with an older cached headline.
    df = fetch_stock_data(ticker)
    spy_df = fetch_stock_data("SPY")
    price_metadata = _frame_response_metadata(df, ticker, "1d")
    benchmark_metadata = _frame_response_metadata(spy_df, "SPY", "1d")
    stock_observed = pd.to_datetime(price_metadata.get("observed_at"), errors="coerce", utc=True)
    benchmark_observed = pd.to_datetime(benchmark_metadata.get("observed_at"), errors="coerce", utc=True)
    if not pd.isna(stock_observed) and not pd.isna(benchmark_observed):
        if benchmark_observed.normalize() < stock_observed.normalize():
            lag = max(0, len(pd.bdate_range(benchmark_observed.normalize(), stock_observed.normalize())) - 1)
            benchmark_metadata["stock_session_lag"] = lag
            if lag > 2:
                benchmark_metadata["stale"] = True
                benchmark_metadata["stale_reason"] = "lags_stock_observation"
        elif stock_observed.normalize() < benchmark_observed.normalize():
            lag = max(0, len(pd.bdate_range(stock_observed.normalize(), benchmark_observed.normalize())) - 1)
            price_metadata["benchmark_session_lag"] = lag
            if lag > 2:
                price_metadata["stale"] = True
                price_metadata["stale_reason"] = "lags_benchmark_observation"
    as_of_date = price_metadata.get("observed_at") or _utc_iso(df.index.max())
    benchmark_as_of_date = benchmark_metadata.get("observed_at") or _utc_iso(spy_df.index.max())
    analysis_input_fingerprint = _analysis_input_fingerprint(df, spy_df)
    if cached_payload and not _cache_matches_analysis_inputs(
        cached_payload,
        as_of_date=as_of_date,
        benchmark_as_of_date=benchmark_as_of_date,
        analysis_input_fingerprint=analysis_input_fingerprint,
    ):
        cached_payload = None

    if cached_payload:
        data_warnings = list(cached_payload.get("data_warnings", []))
        stock_name = cached_payload.get("name") or ticker
        analyst_target = cached_payload.get("analyst_target")
        analyst_count = cached_payload.get("analyst_count")
        options_flow = cached_payload.get("options_flow")
        optionality = cached_payload.get("optionality") or {}
        institutional_flow = cached_payload.get("institutional_flow")
        projections = cached_payload.get("projections") or {}
        historical_score = cached_payload.get("historical_score")
        historical_cutoff_date = cached_payload.get("historical_cutoff_date")
        historical_observed_at = cached_payload.get("historical_observed_at")
        technical_data = cached_payload.get("technical")
        fundamentals = cached_payload.get("fundamentals") or {}
        created_at = _utc_iso(cached_payload.get("created_at")) or created_at
        computed_at = _utc_iso(cached_payload.get("computed_at")) or created_at
    else:
        stock = yf.Ticker(ticker)
        current_price = float(df['Close'].iloc[-1])
        hv30 = compute_historical_volatility(df, window=30)

        # Get current system state
        with get_db_session() as db:
            status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
            system_state = status.state if status else "YELLOW"
            institutional_flow = _sync_institutional_flow_history(db, ticker, df, current_price)

        # Get stock name and analyst snapshot
        stock_info = {}
        try:
            stock_info = stock.info
        except Exception:
            stock_info = {}

        stock_name = stock_info.get("longName") or stock_info.get("shortName") or ticker
        analyst_target = stock_info.get("targetMeanPrice") or stock_info.get("targetMedianPrice")
        analyst_count = stock_info.get("numberOfAnalystOpinions")
        try:
            analyst_target = round(float(analyst_target), 2) if analyst_target is not None else None
        except Exception:
            analyst_target = None
        try:
            analyst_count = int(analyst_count) if analyst_count is not None else None
        except Exception:
            analyst_count = None

        try:
            option_provider = get_market_data_provider()
        except Exception as exc:
            option_provider = None
            data_warnings.append({
                "type": "upstream_options_unavailable",
                "details": {
                    "symbol": ticker,
                    "source": "market_data_provider",
                    "message": str(exc),
                },
            })

        try:
            if option_provider is None:
                raise RuntimeError("Market data provider is unavailable")
            options_flow = compute_options_flow(option_provider, ticker, current_price)
        except Exception as exc:
            options_flow = None
            data_warnings.append({
                "type": "upstream_options_unavailable",
                "details": {
                    "symbol": ticker,
                    "source": "market_data_provider",
                    "message": str(exc),
                },
            })

        try:
            if option_provider is None:
                raise RuntimeError("Market data provider is unavailable")
            optionality = compute_optionality_metrics(option_provider, ticker, current_price, hv30)
        except Exception as exc:
            optionality = _empty_optionality(
                source_name="market_data_provider",
                hv30=hv30,
                error=str(exc),
                reason="provider_error",
            )
        optionality = _apply_underlying_basis_quality(
            optionality,
            price=current_price,
            price_metadata=price_metadata,
        )
        if optionality.get("error"):
            data_warnings.append({
                "type": "upstream_options_unavailable",
                "details": {
                    "symbol": ticker,
                    "source": optionality.get("data_source") or "market_data_provider",
                    "message": optionality["error"],
                },
            })
        if not optionality.get("mispricing_usable", False):
            data_warnings.append({
                "type": "optionality_quality",
                "details": {
                    "symbol": ticker,
                    "source": optionality.get("data_source"),
                    "quote_source": optionality.get("quote_source"),
                    "observed_at": optionality.get("observed_at"),
                    "quality_status": optionality.get("quality_status") or "unusable",
                    "reasons": list(optionality.get("quality_reasons") or []),
                    "message": "Options mispricing classification is unavailable because quote quality did not pass validation.",
                },
            })

        try:
            fundamentals = compute_fundamentals(stock, df)
        except Exception as exc:
            fundamentals = {}
            data_warnings.append({
                "type": "fundamentals_unavailable",
                "details": {
                    "symbol": ticker,
                    "source": "Yahoo Finance",
                    "message": str(exc),
                },
            })

        # Compute projections for each horizon
        projections = {}
        for horizon_name, horizon_days in HORIZONS.items():
            try:
                effective_days = T_WINDOW_DAYS if horizon_days == 0 else horizon_days
                projection = compute_stock_projection(
                    ticker,
                    df,
                    spy_df,
                    effective_days,
                    system_state,
                    analyst_target=analyst_target,
                    fundamentals=fundamentals,
                )
                projection.update({
                    "ticker": ticker,
                    "name": stock_name,
                    "horizon": horizon_name,
                })
                projections[horizon_name] = projection
            except Exception as e:
                data_warnings.append({
                    "type": "projection_unavailable",
                    "details": {
                        "symbol": ticker,
                        "horizon": horizon_name,
                        "message": str(e),
                    },
                })

        # Compute the score at the actual three-calendar-month cutoff, using the
        # latest shared trading observation on or before that date.
        historical_score = None
        try:
            (
                historical_df,
                historical_spy,
                historical_cutoff_date,
                historical_observed_at,
            ) = _calendar_month_cutoff_frames(df, spy_df, months=3)
            if len(historical_df) > HORIZONS["3m"] and len(historical_spy) > HORIZONS["3m"]:
                historical_score = compute_stock_projection(
                    ticker,
                    historical_df,
                    historical_spy,
                    HORIZONS["3m"],
                    system_state,
                )["score_total"]
        except Exception as e:
            print(f"Warning: Could not compute historical score for {ticker}: {str(e)}")

        # Calculate technical indicators for 252-day lookback
        try:
            technical_data = calculate_technical_indicators(df, lookback_days=252)
        except Exception as exc:
            technical_data = None
            data_warnings.append({
                "type": "technical_unavailable",
                "details": {
                    "symbol": ticker,
                    "message": str(exc),
                },
            })

        computed_at = datetime.now(timezone.utc).isoformat()
        created_at = computed_at
        if set(projections) == set(HORIZONS):
            _set_stock_projection_cache(
                ticker,
                {
                    "name": stock_name,
                    "as_of_date": as_of_date,
                    "benchmark_as_of_date": benchmark_as_of_date,
                    "analysis_input_fingerprint": analysis_input_fingerprint,
                    "created_at": created_at,
                    "computed_at": computed_at,
                    "data_warnings": data_warnings,
                    "analyst_target": analyst_target,
                    "analyst_count": analyst_count,
                    "options_flow": options_flow,
                    "optionality": optionality,
                    "institutional_flow": institutional_flow,
                    "projections": projections,
                    "historical_score": historical_score,
                    "historical_cutoff_date": historical_cutoff_date,
                    "historical_observed_at": historical_observed_at,
                    "technical": technical_data,
                    "fundamentals": fundamentals,
                },
            )

    optionality = _apply_underlying_basis_quality(
        optionality,
        price=float(df["Close"].iloc[-1]) if not df.empty else None,
        price_metadata=price_metadata,
    )

    history_fetch_days = {
        # Fetch enough calendar time to supply 252 completed trading sessions.
        "252d": 380,
        "1y": 380,
        "5y": 366 * 5 + 14,
        "max": 50000,
    }
    history_days = history_fetch_days[history_window]

    try:
        price_history_df = fetch_stock_data(ticker, days=history_days)
    except Exception as exc:
        # Keep analysis available even if long-range history fetch fails.
        price_history_df = df
        data_warnings.append({
            "type": "price_history_fallback",
            "details": {
                "symbol": ticker,
                "requested_window": history_window,
                "message": str(exc),
            },
        })
    price_history_df = _slice_price_history_window(price_history_df, history_window)

    intraday_history: list[dict] = []
    intraday_metadata: dict[str, Any] = {
        "symbol": ticker,
        "interval": "2h",
        "source": "YAHOO",
        "observed_at": None,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "stale": False,
        "status": "not_requested_for_history_window",
        "refresh_attempted": False,
        "refresh_succeeded": None,
        "refresh_error": None,
    }
    if history_window == "252d":
        try:
            intraday_df = get_cached_intraday_frame(ticker, days=252)
            intraday_metadata = _frame_response_metadata(intraday_df, ticker, "2h")
            daily_observed = pd.to_datetime(price_metadata.get("observed_at"), errors="coerce", utc=True)
            intraday_observed = pd.to_datetime(intraday_metadata.get("observed_at"), errors="coerce", utc=True)
            if not pd.isna(daily_observed) and not pd.isna(intraday_observed):
                daily_session_lag = max(
                    0,
                    len(pd.bdate_range(intraday_observed.normalize(), daily_observed.normalize())) - 1,
                )
                intraday_metadata["daily_session_lag"] = daily_session_lag
                if daily_session_lag > 2:
                    intraday_metadata["stale"] = True
                    intraday_metadata["stale_reason"] = "lags_latest_daily_observation"
            # Stale intraday rows are deliberately withheld so the chart cannot
            # quietly contradict the headline price.
            if not intraday_metadata.get("stale"):
                intraday_history = _build_intraday_history(intraday_df)
        except Exception as exc:
            intraday_metadata["refresh_error"] = str(exc)
            intraday_metadata["stale"] = True

    # Refresh/cache warnings are request-specific; replace any cached copies so
    # both stock and benchmark freshness are evaluated absolutely every time.
    data_warnings = [
        warning
        for warning in data_warnings
        if warning.get("type") not in {"stale_series", "cache_refresh_failed", "optionality_quality"}
    ]
    for metadata in (price_metadata, benchmark_metadata, intraday_metadata):
        warning = _series_freshness_warning(metadata)
        if warning:
            data_warnings.append(warning)
    if not optionality.get("mispricing_usable", False):
        data_warnings.append({
            "type": "optionality_quality",
            "details": {
                "symbol": ticker,
                "source": optionality.get("data_source"),
                "quote_source": optionality.get("quote_source"),
                "observed_at": optionality.get("observed_at"),
                "quality_status": optionality.get("quality_status") or "unusable",
                "reasons": list(optionality.get("quality_reasons") or []),
                "message": "Options mispricing classification is unavailable because quote quality did not pass validation.",
            },
        })
    
    result = {
        "ticker": ticker,
        "name": stock_name,
        "as_of_date": as_of_date,
        "benchmark_as_of_date": benchmark_as_of_date,
        "analysis_input_fingerprint": analysis_input_fingerprint,
        "created_at": created_at,
        "computed_at": computed_at,
        "retrieved_at": price_metadata.get("retrieved_at"),
        "price_metadata": price_metadata,
        "benchmark_metadata": benchmark_metadata,
        "intraday_metadata": intraday_metadata,
        "data_warnings": data_warnings,
        "analyst_target": analyst_target,
        "analyst_count": analyst_count,
        "options_flow": options_flow,
        "optionality": optionality,
        "institutional_flow": institutional_flow,
        "price_history_window": history_window,
        "price_history": _build_price_history(price_history_df, days=None),
        "intraday_history_2h": intraday_history,
        "projections": projections,
        "historical": {
            "score_3m_ago": historical_score,
            "cutoff_date": historical_cutoff_date,
            "observed_at": historical_observed_at,
            "analysis_kind": "trailing_window",
        },
        "technical": technical_data,
        "fundamentals": fundamentals,
    }
    
    # Sanitize NaN/Inf values before returning
    return sanitize_for_json(result)
