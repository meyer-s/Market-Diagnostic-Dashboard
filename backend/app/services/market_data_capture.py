from __future__ import annotations

import logging
import math
import os
from datetime import datetime
from typing import Any, Iterable, Optional

import pandas as pd

from app.models.market_data_observation import MarketDataObservation
from app.services.market_data.provider import OptionChainFrame, UnderlyingQuote
from app.utils.db_helpers import get_db_session

logger = logging.getLogger(__name__)


def _capture_enabled() -> bool:
    return os.getenv("MARKET_DATA_CAPTURE_ENABLED", "true").strip().lower() in {"1", "true", "yes"}


def _max_rows() -> int:
    try:
        return max(1, int(os.getenv("MARKET_DATA_CAPTURE_MAX_ROWS", "2000")))
    except ValueError:
        return 2000


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _parse_observed_at(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        parsed = pd.Timestamp(value)
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime().replace(tzinfo=None)


def _frame_records(frame: pd.DataFrame, *, index_field: str | None = None) -> list[dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    working = frame.copy()
    if index_field:
        working[index_field] = working.index
    records = working.to_dict(orient="records")
    return [_json_safe(record) for record in records]


def _bounded_records(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    limit = _max_rows()
    if len(records) <= limit:
        return records, False
    return records[-limit:], True


def _write_observation(
    *,
    provider: str,
    data_type: str,
    symbol: str,
    payload: dict[str, Any],
    row_count: int,
    observed_at: Optional[datetime] = None,
    expiry: str | None = None,
    right: str | None = None,
    interval: str | None = None,
    quote_source: str | None = None,
) -> bool:
    if not _capture_enabled():
        return False

    try:
        with get_db_session() as db:
            db.add(
                MarketDataObservation(
                    provider=provider,
                    data_type=data_type,
                    symbol=symbol.upper(),
                    expiry=expiry,
                    right=right,
                    interval=interval,
                    quote_source=quote_source,
                    row_count=int(row_count),
                    observed_at=observed_at,
                    captured_at=datetime.utcnow(),
                    process_status="pending",
                    payload=_json_safe(payload),
                )
            )
            db.commit()
        return True
    except Exception:
        logger.exception(
            "market_data_capture_failed",
            extra={"provider": provider, "data_type": data_type, "symbol": symbol},
        )
        return False


def record_underlying_quote(quote: UnderlyingQuote, *, raw_payload: dict[str, Any] | None = None) -> bool:
    payload = {
        "quote": {
            "symbol": quote.symbol,
            "last": quote.last,
            "bid": quote.bid,
            "ask": quote.ask,
            "close": quote.close,
            "open": quote.open,
            "high": quote.high,
            "low": quote.low,
            "volume": quote.volume,
            "source": quote.source,
            "quote_source": quote.quote_source,
            "observed_at": quote.observed_at,
        },
        "raw": raw_payload or {},
    }
    return _write_observation(
        provider=quote.source or "unknown",
        data_type="underlying_quote",
        symbol=quote.symbol,
        payload=payload,
        row_count=1,
        observed_at=_parse_observed_at(quote.observed_at),
        quote_source=quote.quote_source,
    )


def record_daily_bars(
    *,
    provider: str,
    symbol: str,
    frame: pd.DataFrame,
    days_requested: int,
) -> bool:
    records, truncated = _bounded_records(_frame_records(frame, index_field="timestamp"))
    observed_at = None
    if frame is not None and not frame.empty:
        observed_at = _parse_observed_at(pd.Timestamp(frame.index.max()))
    payload = {
        "days_requested": int(days_requested),
        "truncated": truncated,
        "bars": records,
    }
    return _write_observation(
        provider=provider,
        data_type="daily_bars",
        symbol=symbol,
        interval="1d",
        payload=payload,
        row_count=len(frame) if frame is not None else 0,
        observed_at=observed_at,
    )


def record_option_chain(
    *,
    provider: str,
    chain: OptionChainFrame,
    right: str,
    strikes: Iterable[float] | None = None,
) -> bool:
    calls = _frame_records(chain.calls)
    puts = _frame_records(chain.puts)
    call_records, calls_truncated = _bounded_records(calls)
    put_records, puts_truncated = _bounded_records(puts)
    payload = {
        "requested_right": right,
        "requested_strikes": [float(value) for value in strikes] if strikes is not None else None,
        "truncated": calls_truncated or puts_truncated,
        "calls": call_records,
        "puts": put_records,
    }
    return _write_observation(
        provider=provider,
        data_type="option_chain",
        symbol=chain.symbol,
        expiry=chain.expiry,
        right=right,
        quote_source=chain.quote_source,
        payload=payload,
        row_count=len(calls) + len(puts),
    )


def _daily_bars_frame_from_payload(payload: dict[str, Any]) -> pd.DataFrame:
    records = payload.get("bars") if isinstance(payload, dict) else None
    if not isinstance(records, list) or not records:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    frame = pd.DataFrame(records)
    if "timestamp" not in frame.columns:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    frame.index = pd.to_datetime(frame["timestamp"], errors="coerce")
    frame = frame[frame.index.notna()]
    columns = [column for column in ["Open", "High", "Low", "Close", "Volume"] if column in frame.columns]
    if not {"Open", "High", "Low", "Close"}.issubset(set(columns)):
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    return frame[columns].dropna(subset=["Open", "High", "Low", "Close"]).sort_index()


def process_pending_daily_bar_observations(limit: int = 100, *, dry_run: bool = False) -> dict[str, int]:
    """Promote captured daily bar observations into stock_price_bar."""
    from app.services.stock_price_cache import _upsert_frame

    summary = {"checked": 0, "processed": 0, "skipped": 0, "errors": 0, "inserted": 0}
    with get_db_session() as db:
        rows = (
            db.query(MarketDataObservation)
            .filter(
                MarketDataObservation.provider == "ibkr",
                MarketDataObservation.data_type == "daily_bars",
                MarketDataObservation.process_status == "pending",
            )
            .order_by(MarketDataObservation.captured_at.asc())
            .limit(max(1, int(limit)))
            .all()
        )

        for row in rows:
            summary["checked"] += 1
            try:
                frame = _daily_bars_frame_from_payload(row.payload or {})
                if frame.empty:
                    summary["skipped"] += 1
                    if not dry_run:
                        row.process_status = "skipped"
                        row.processed_at = datetime.utcnow()
                        row.error = "No usable bars in payload"
                    continue

                if dry_run:
                    summary["processed"] += 1
                    continue

                inserted = _upsert_frame(db, row.symbol, row.interval or "1d", frame, source="IBKR")
                row.process_status = "processed"
                row.processed_at = datetime.utcnow()
                row.error = None
                summary["inserted"] += int(inserted)
                summary["processed"] += 1
            except Exception as exc:
                summary["errors"] += 1
                if not dry_run:
                    row.process_status = "error"
                    row.processed_at = datetime.utcnow()
                    row.error = str(exc)[:500]

        if not dry_run:
            db.commit()
    return summary
