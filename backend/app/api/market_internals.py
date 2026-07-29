from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, Query

from app.services.endpoint_response_cache import (
    load_response_snapshot,
    mark_stale_snapshot,
    response_refresh_lock,
    store_response_snapshot,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL_SECONDS = 4 * 60 * 60
_MAX_STALE_AGE_SECONDS = 48 * 60 * 60
_YAHOO_TIMEOUT_SECONDS = 8
_LISTING_TIMEOUT_SECONDS = 8
_MAX_MEMORY_CACHE_ENTRIES = 6
_MIN_REPRESENTATIVE_PARTICIPATION_PCT = 20.0
_cached_by_days: dict[int, dict[str, object]] = {}
_LISTING_CACHE_TTL_SECONDS = 24 * 60 * 60
_listing_cache: dict[str, object] = {"fetched_at": None, "data": None}


def _set_memory_snapshot(days: int, cached_at: datetime, payload: dict) -> None:
    _cached_by_days[days] = {"cached_at": cached_at, "payload": payload}
    if len(_cached_by_days) <= _MAX_MEMORY_CACHE_ENTRIES:
        return
    oldest_days = min(
        _cached_by_days,
        key=lambda key: _cached_by_days[key].get("cached_at") or datetime.min.replace(tzinfo=timezone.utc),
    )
    _cached_by_days.pop(oldest_days, None)


def _breadth_quality_rank(payload: object) -> tuple[int, float, int, int, int]:
    """Rank breadth evidence without confusing cacheability with completeness.

    Representative exchange coverage is the strongest signal, followed by the
    weakest exchange participation and then history coverage/depth. This keeps
    a transient sparse batch from overwriting materially stronger evidence
    while still allowing a sparse cold response to seed the shared cache.
    """

    if not isinstance(payload, dict):
        return (0, 0.0, 0, 0, 0)
    exchanges = payload.get("exchanges")
    if not isinstance(exchanges, dict):
        return (0, 0.0, 0, 0, 0)

    buckets = [
        exchanges.get(exchange_key)
        for exchange_key in ("amex", "nsdq", "nyse")
    ]
    valid_buckets = [bucket for bucket in buckets if isinstance(bucket, dict)]
    representative_coverage = sum(
        bucket.get("source") == "exchange-universe-full"
        and float(bucket.get("participation_pct") or 0.0)
        >= _MIN_REPRESENTATIVE_PARTICIPATION_PCT
        for bucket in valid_buckets
    )
    participation = [
        max(float(bucket.get("participation_pct") or 0.0), 0.0)
        for bucket in valid_buckets
    ]
    weakest_participation = min(participation) if len(participation) == 3 else 0.0
    history_lengths = [
        len(bucket.get("history"))
        if isinstance(bucket.get("history"), list)
        else 0
        for bucket in valid_buckets
    ]
    history_coverage = sum(length > 0 for length in history_lengths)
    weakest_history_depth = (
        min(history_lengths) if len(history_lengths) == 3 else 0
    )
    combined_history = payload.get("history")
    combined_history_depth = (
        len(combined_history) if isinstance(combined_history, list) else 0
    )
    return (
        representative_coverage,
        round(weakest_participation, 6),
        history_coverage,
        weakest_history_depth,
        combined_history_depth,
    )


BREADTH_SYMBOL_CANDIDATES = {
    "nyse": {
        "advancing": ["^ADVN"],
        "declining": ["^DECL"],
        "volume_advancing": ["^UVOL"],
        "volume_declining": ["^DVOL"],
        "new_highs": ["^NYHGH", "^NYSH"],
        "new_lows": ["^NYLOW", "^NYL"],
    },
    "nsdq": {
        "advancing": ["^ADVNQ", "^ADVD"],
        "declining": ["^DECLQ", "^DECD"],
        "volume_advancing": ["^UVOLQ"],
        "volume_declining": ["^DVOLQ"],
        "new_highs": ["^NAHGH", "^NAH"],
        "new_lows": ["^NALOW", "^NAL"],
    },
    "amex": {
        "advancing": ["^ADVA"],
        "declining": ["^DECA"],
        "volume_advancing": ["^UVOLA"],
        "volume_declining": ["^DVOLA"],
        "new_highs": ["^AMEXH", "^AEHGH"],
        "new_lows": ["^AMEXL", "^AELOW"],
    },
}


def _make_snapshot(
    adv: int,
    dec: int,
    vol_adv: float,
    vol_dec: float,
    highs: int,
    lows: int,
    participation_pct: float,
) -> dict[str, object]:
    breadth_total = max(adv + dec, 1)
    vol_total = max(vol_adv + vol_dec, 1.0)
    hl_total = max(highs + lows, 1)
    return {
        "advancing": adv,
        "declining": dec,
        "advancing_pct": adv / breadth_total * 100.0,
        "declining_pct": dec / breadth_total * 100.0,
        "ad_rate": float(adv - dec),
        "volume_advancing": vol_adv,
        "volume_declining": vol_dec,
        "volume_advancing_pct": vol_adv / vol_total * 100.0,
        "volume_declining_pct": vol_dec / vol_total * 100.0,
        "new_highs": highs,
        "new_lows": lows,
        "new_highs_pct": highs / hl_total * 100.0,
        "new_lows_pct": lows / hl_total * 100.0,
        "participation_pct": participation_pct,
    }


def _extract_close_volume(downloaded: pd.DataFrame) -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    if downloaded is None or downloaded.empty:
        return None, None

    if isinstance(downloaded.columns, pd.MultiIndex):
        level0 = downloaded.columns.get_level_values(0)
        level1 = downloaded.columns.get_level_values(1)
        if "Close" in level0 and "Volume" in level0:
            return downloaded["Close"], downloaded["Volume"]
        if "Close" in level1 and "Volume" in level1:
            swapped = downloaded.swaplevel(axis=1)
            return swapped["Close"], swapped["Volume"]
        return None, None

    has_close = "Close" in downloaded.columns
    has_volume = "Volume" in downloaded.columns
    if not has_close or not has_volume:
        return None, None

    close = pd.DataFrame({"SINGLE": downloaded["Close"]})
    volume = pd.DataFrame({"SINGLE": downloaded["Volume"]})
    return close, volume


def _chunked(symbols: list[str], chunk_size: int) -> list[list[str]]:
    return [symbols[i:i + chunk_size] for i in range(0, len(symbols), chunk_size)]


def _normalize_symbol(symbol: str) -> str:
    value = (symbol or "").strip().upper()
    if not value:
        return ""
    value = value.replace("$", "")
    value = value.replace(".", "-")
    return value


def _parse_pipe_table(text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return []
    headers = [h.strip() for h in lines[0].split("|")]
    rows: list[dict[str, str]] = []
    for line in lines[1:]:
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != len(headers):
            continue
        row = dict(zip(headers, parts))
        if row.get(headers[0], "").startswith("File Creation Time"):
            continue
        rows.append(row)
    return rows


def _fetch_exchange_universe() -> dict[str, list[str]]:
    now = datetime.now(timezone.utc)
    cached_at = _listing_cache.get("fetched_at")
    cached_data = _listing_cache.get("data")
    stale_data = cached_data if isinstance(cached_data, dict) else {"amex": [], "nyse": [], "nsdq": []}
    if isinstance(cached_at, datetime) and isinstance(cached_data, dict):
        if (now - cached_at).total_seconds() < _LISTING_CACHE_TTL_SECONDS:
            return cached_data  # type: ignore[return-value]

    nasdaq: set[str] = set()
    nyse: set[str] = set()
    amex: set[str] = set()

    try:
        with httpx.Client(timeout=_LISTING_TIMEOUT_SECONDS) as client:
            nasdaq_response = client.get(
                "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
            )
            other_response = client.get(
                "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
            )
            nasdaq_response.raise_for_status()
            other_response.raise_for_status()
            nasdaq_text = nasdaq_response.text
            other_text = other_response.text

        nasdaq_rows = _parse_pipe_table(nasdaq_text)
        for row in nasdaq_rows:
            if row.get("Test Issue", "N") == "Y":
                continue
            symbol = _normalize_symbol(row.get("Symbol", ""))
            if symbol:
                nasdaq.add(symbol)

        other_rows = _parse_pipe_table(other_text)
        for row in other_rows:
            if row.get("Test Issue", "N") == "Y":
                continue
            raw_symbol = row.get("ACT Symbol") or row.get("NASDAQ Symbol") or row.get("CQS Symbol") or ""
            symbol = _normalize_symbol(raw_symbol)
            if not symbol:
                continue

            exch = (row.get("Exchange") or "").upper()
            if exch == "N":
                nyse.add(symbol)
            elif exch in {"A", "P"}:
                amex.add(symbol)
            elif exch == "Q":
                nasdaq.add(symbol)

    except Exception as exc:
        logger.warning("Failed to fetch exchange universe listings: %s", exc)
        return {
            "amex": list(stale_data.get("amex", [])),
            "nyse": list(stale_data.get("nyse", [])),
            "nsdq": list(stale_data.get("nsdq", [])),
        }

    payload = {
        "amex": sorted(amex) if amex else list(stale_data.get("amex", [])),
        "nyse": sorted(nyse) if nyse else list(stale_data.get("nyse", [])),
        "nsdq": sorted(nasdaq) if nasdaq else list(stale_data.get("nsdq", [])),
    }
    _listing_cache["fetched_at"] = now
    _listing_cache["data"] = payload
    return payload


def _download_price_volume(symbols: list[str], period: str = "1y") -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    close_frames: list[pd.DataFrame] = []
    volume_frames: list[pd.DataFrame] = []

    for chunk in _chunked(symbols, 500):
        try:
            frame = yf.download(
                tickers=" ".join(chunk),
                period=period,
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=True,
                group_by="column",
                timeout=_YAHOO_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.warning("yf.download failed for chunk of %d symbols: %s", len(chunk), exc)
            continue

        close_frame, volume_frame = _extract_close_volume(frame)
        if close_frame is None or volume_frame is None:
            continue

        if "SINGLE" in close_frame.columns and len(chunk) == 1:
            close_frame = close_frame.rename(columns={"SINGLE": chunk[0]})
        if "SINGLE" in volume_frame.columns and len(chunk) == 1:
            volume_frame = volume_frame.rename(columns={"SINGLE": chunk[0]})

        close_frames.append(close_frame)
        volume_frames.append(volume_frame)

    if not close_frames or not volume_frames:
        return None, None

    close_all = pd.concat(close_frames, axis=1)
    volume_all = pd.concat(volume_frames, axis=1)
    close_all = close_all.loc[:, ~close_all.columns.duplicated()]
    volume_all = volume_all.loc[:, ~volume_all.columns.duplicated()]
    return close_all, volume_all


def _extract_close_frame(downloaded: pd.DataFrame) -> pd.DataFrame | None:
    if downloaded is None or downloaded.empty:
        return None

    if isinstance(downloaded.columns, pd.MultiIndex):
        level0 = downloaded.columns.get_level_values(0)
        level1 = downloaded.columns.get_level_values(1)
        if "Close" in level0:
            close = downloaded["Close"]
        elif "Close" in level1:
            close = downloaded.swaplevel(axis=1)["Close"]
        else:
            return None
        if isinstance(close, pd.Series):
            close = close.to_frame()
        return close

    if "Close" not in downloaded.columns:
        return None
    return pd.DataFrame({"SINGLE": downloaded["Close"]})


def _download_breadth_close(symbols: list[str]) -> pd.DataFrame | None:
    if not symbols:
        return None
    try:
        frame = yf.download(
            tickers=" ".join(symbols),
            period="1y",
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=True,
            group_by="column",
            timeout=_YAHOO_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("Batch breadth-symbol download failed: %s", exc)
        return None
    return _extract_close_frame(frame)


def _fetch_breadth_metric_series(
    candidates: list[str],
    close_frame: pd.DataFrame | None = None,
) -> dict[str, float]:
    if close_frame is not None:
        for symbol in candidates:
            if symbol not in close_frame.columns:
                continue
            clean = close_frame[symbol].dropna()
            if clean.empty:
                continue
            return {
                pd.Timestamp(idx).strftime("%Y-%m-%d"): float(value)
                for idx, value in clean.items()
            }
        return {}

    for symbol in candidates:
        try:
            frame = yf.download(
                tickers=symbol,
                period="1y",
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=True,
                timeout=_YAHOO_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.debug("yf.download failed for breadth symbol %s: %s", symbol, exc)
            continue

        if frame is None or frame.empty:
            continue

        series = None
        if isinstance(frame.columns, pd.MultiIndex):
            if "Close" in frame.columns.get_level_values(0):
                series = frame["Close"]
            elif "Adj Close" in frame.columns.get_level_values(0):
                series = frame["Adj Close"]
        else:
            if "Close" in frame.columns:
                series = frame["Close"]
            elif "Adj Close" in frame.columns:
                series = frame["Adj Close"]

        if series is None:
            continue

        if isinstance(series, pd.DataFrame):
            if series.empty:
                continue
            series = series.iloc[:, 0]

        clean = series.dropna()
        if clean.empty:
            continue

        mapped: dict[str, float] = {}
        for idx, value in clean.items():
            mapped[pd.Timestamp(idx).strftime("%Y-%m-%d")] = float(value)

        if mapped:
            return mapped

    return {}


def _build_bucket_from_breadth_symbols(
    exchange_key: str,
    label: str,
    lookback_days: int,
    universe_size: int = 0,
    close_frame: pd.DataFrame | None = None,
) -> dict[str, object] | None:
    candidates = BREADTH_SYMBOL_CANDIDATES.get(exchange_key)
    if not candidates:
        return None

    adv = _fetch_breadth_metric_series(candidates["advancing"], close_frame)
    dec = _fetch_breadth_metric_series(candidates["declining"], close_frame)
    uvol = _fetch_breadth_metric_series(candidates["volume_advancing"], close_frame)
    dvol = _fetch_breadth_metric_series(candidates["volume_declining"], close_frame)
    highs = _fetch_breadth_metric_series(candidates["new_highs"], close_frame)
    lows = _fetch_breadth_metric_series(candidates["new_lows"], close_frame)

    if not adv or not dec or not uvol or not dvol:
        return None

    common_dates = sorted(set(adv.keys()) & set(dec.keys()) & set(uvol.keys()) & set(dvol.keys()))
    if len(common_dates) < 20:
        return None

    common_dates = common_dates[-lookback_days:]
    history: list[dict[str, object]] = []

    for date_key in common_dates:
        adv_val = max(float(adv.get(date_key, 0.0)), 0.0)
        dec_val = max(float(dec.get(date_key, 0.0)), 0.0)
        uvol_val = max(float(uvol.get(date_key, 0.0)), 0.0)
        dvol_val = max(float(dvol.get(date_key, 0.0)), 0.0)
        high_val = max(float(highs.get(date_key, 0.0)), 0.0)
        low_val = max(float(lows.get(date_key, 0.0)), 0.0)

        effective_universe = max(universe_size, int(adv_val + dec_val))
        participation_pct = float((adv_val + dec_val) / max(effective_universe, 1) * 100.0)

        snap = _make_snapshot(
            int(round(adv_val)),
            int(round(dec_val)),
            uvol_val,
            dvol_val,
            int(round(high_val)),
            int(round(low_val)),
            participation_pct,
        )
        history.append({"date": date_key, **snap})

    latest = history[-1]
    return {
        "label": label,
        **{k: v for k, v in latest.items() if k != "date"},
        "universe_size": max(universe_size, int(latest["advancing"]) + int(latest["declining"])),
        "history": history,
        "source": "breadth-symbols",
    }


def _empty_bucket(label: str, universe_size: int, source: str) -> dict[str, object]:
    return {
        "label": label,
        "advancing": 0,
        "declining": 0,
        "advancing_pct": 0.0,
        "declining_pct": 0.0,
        "ad_rate": 0.0,
        "volume_advancing": 0.0,
        "volume_declining": 0.0,
        "volume_advancing_pct": 0.0,
        "volume_declining_pct": 0.0,
        "new_highs": 0,
        "new_lows": 0,
        "new_highs_pct": 0.0,
        "new_lows_pct": 0.0,
        "participation_pct": 0.0,
        "universe_size": universe_size,
        "history": [],
        "source": source,
    }


def _resolve_exchange_bucket(exchange_key: str, label: str, symbols: list[str], lookback_days: int) -> dict[str, object]:
    direct = _build_bucket_from_breadth_symbols(exchange_key, label, lookback_days, universe_size=len(symbols))
    if direct:
        return direct

    if not symbols:
        return _empty_bucket(label, 0, "unavailable")

    full_universe = _compute_bucket(symbols, label, lookback_days=lookback_days)
    if not full_universe.get("history"):
        return _empty_bucket(label, len(symbols), "unavailable")

    full_universe["source"] = "exchange-universe-full"
    return full_universe


def _build_bucket_history(
    close_frame: pd.DataFrame,
    volume_frame: pd.DataFrame,
    symbols: list[str],
    lookback_days: int = 90,
) -> list[dict[str, object]]:
    history: list[dict[str, object]] = []
    if close_frame is None or close_frame.empty:
        return history

    close = close_frame.copy().sort_index()
    volume = volume_frame.copy().sort_index()
    close = close[[c for c in close.columns if c in symbols]]
    volume = volume[[c for c in volume.columns if c in symbols]]

    if close.empty:
        return history

    dates = close.index.tolist()
    start_idx = max(1, len(dates) - lookback_days)
    rolling_max = close.rolling(window=252, min_periods=20).max()
    rolling_min = close.rolling(window=252, min_periods=20).min()

    for idx in range(start_idx, len(dates)):
        current_close = close.iloc[idx]
        previous_close = close.iloc[idx - 1]
        current_volume = volume.iloc[idx] if idx < len(volume.index) else pd.Series(dtype=float)

        valid_mask = current_close.notna() & previous_close.notna()
        up_mask = valid_mask & (current_close > previous_close)
        down_mask = valid_mask & (current_close < previous_close)

        advancing = int(up_mask.sum())
        declining = int(down_mask.sum())
        up_vol = float(current_volume[up_mask].sum()) if not current_volume.empty else 0.0
        down_vol = float(current_volume[down_mask].sum()) if not current_volume.empty else 0.0

        current_roll_max = rolling_max.iloc[idx]
        current_roll_min = rolling_min.iloc[idx]
        high_mask = valid_mask & current_roll_max.notna() & (current_close >= (current_roll_max * 0.999))
        low_mask = valid_mask & current_roll_min.notna() & (current_close <= (current_roll_min * 1.001))
        new_highs = int(high_mask.sum())
        new_lows = int(low_mask.sum())

        participation_pct = float((advancing + declining) / max(len(symbols), 1) * 100.0)
        snap = _make_snapshot(advancing, declining, up_vol, down_vol, new_highs, new_lows, participation_pct)
        history.append({"date": pd.Timestamp(dates[idx]).strftime("%Y-%m-%d"), **snap})

    return history


def _compute_bucket(symbols: list[str], label: str, lookback_days: int) -> dict[str, object]:
    close_frame, volume_frame = _download_price_volume(symbols, period="1y")
    if close_frame is None or volume_frame is None:
        return _empty_bucket(label, len(symbols), "unavailable")

    history = _build_bucket_history(close_frame, volume_frame, symbols, lookback_days=lookback_days)
    if not history:
        return _empty_bucket(label, len(symbols), "unavailable")

    latest = history[-1]
    return {
        "label": label,
        **{k: v for k, v in latest.items() if k != "date"},
        "universe_size": len(symbols),
        "history": history,
    }


def _build_market_internals_overview(
    days: int,
    shared_snapshot,
) -> dict[str, object]:
    now = datetime.now(timezone.utc)
    cache_key = f"market-internals:overview:{days}"
    cached = _cached_by_days.get(days)
    if cached:
        cached_at = cached.get("cached_at")
        payload = cached.get("payload")
        if isinstance(cached_at, datetime) and payload and (now - cached_at).total_seconds() < _CACHE_TTL_SECONDS:
            return payload  # type: ignore[return-value]

    exchange_universe = _fetch_exchange_universe()
    breadth_symbols = sorted({
        symbol
        for exchange in BREADTH_SYMBOL_CANDIDATES.values()
        for metric_symbols in exchange.values()
        for symbol in metric_symbols
    })
    breadth_close = _download_breadth_close(breadth_symbols)
    bounded_close = breadth_close if breadth_close is not None else pd.DataFrame()

    # The page should be bounded by a single provider batch. Falling through
    # to thousands of per-listing downloads made cold requests exceed the
    # reverse proxy timeout and amplified Yahoo throttling.
    amex = _build_bucket_from_breadth_symbols(
        "amex",
        "AMEX",
        days,
        universe_size=len(exchange_universe["amex"]),
        close_frame=bounded_close,
    ) or _empty_bucket("AMEX", len(exchange_universe["amex"]), "unavailable")
    nasdaq = _build_bucket_from_breadth_symbols(
        "nsdq",
        "NSDQ",
        days,
        universe_size=len(exchange_universe["nsdq"]),
        close_frame=bounded_close,
    ) or _empty_bucket("NSDQ", len(exchange_universe["nsdq"]), "unavailable")
    nyse = _build_bucket_from_breadth_symbols(
        "nyse",
        "NYSE",
        days,
        universe_size=len(exchange_universe["nyse"]),
        close_frame=bounded_close,
    ) or _empty_bucket("NYSE", len(exchange_universe["nyse"]), "unavailable")

    combined_adv = int(amex["advancing"] + nasdaq["advancing"] + nyse["advancing"])
    combined_dec = int(amex["declining"] + nasdaq["declining"] + nyse["declining"])
    combined_vol_adv = float(amex["volume_advancing"] + nasdaq["volume_advancing"] + nyse["volume_advancing"])
    combined_vol_dec = float(amex["volume_declining"] + nasdaq["volume_declining"] + nyse["volume_declining"])
    combined_highs = int(amex["new_highs"] + nasdaq["new_highs"] + nyse["new_highs"])
    combined_lows = int(amex["new_lows"] + nasdaq["new_lows"] + nyse["new_lows"])
    total_universe = len(exchange_universe["amex"]) + len(exchange_universe["nsdq"]) + len(exchange_universe["nyse"])

    amex_history = {entry["date"]: entry for entry in amex.get("history", [])}
    nasdaq_history = {entry["date"]: entry for entry in nasdaq.get("history", [])}
    nyse_history = {entry["date"]: entry for entry in nyse.get("history", [])}
    combined_dates = sorted(set(amex_history.keys()) & set(nasdaq_history.keys()) & set(nyse_history.keys()))
    combined_history = []

    if not combined_dates:
        logger.warning("Combined market internals history is empty — exchange date ranges do not overlap")

    for date_key in combined_dates:
        amx = amex_history[date_key]
        ndx = nasdaq_history[date_key]
        ny = nyse_history[date_key]

        adv = int(amx["advancing"] + ndx["advancing"] + ny["advancing"])
        dec = int(amx["declining"] + ndx["declining"] + ny["declining"])
        vol_adv = float(amx["volume_advancing"] + ndx["volume_advancing"] + ny["volume_advancing"])
        vol_dec = float(amx["volume_declining"] + ndx["volume_declining"] + ny["volume_declining"])
        highs = int(amx["new_highs"] + ndx["new_highs"] + ny["new_highs"])
        lows = int(amx["new_lows"] + ndx["new_lows"] + ny["new_lows"])
        participation_pct = float((adv + dec) / max(total_universe, 1) * 100.0)

        snap = _make_snapshot(adv, dec, vol_adv, vol_dec, highs, lows, participation_pct)
        combined_history.append({"date": date_key, **snap})

    composite_participation_pct = float((combined_adv + combined_dec) / max(total_universe, 1) * 100.0)
    composite = _make_snapshot(
        combined_adv, combined_dec,
        combined_vol_adv, combined_vol_dec,
        combined_highs, combined_lows,
        composite_participation_pct,
    )
    composite["universe_size"] = total_universe

    payload = {
        "as_of": now.isoformat(),
        "composite": composite,
        "days": days,
        "history": combined_history,
        "exchanges": {
            "amex": amex,
            "nsdq": nasdaq,
            "nyse": nyse,
        },
    }

    exchange_history_count = sum(
        bool(exchange.get("history"))
        for exchange in (amex, nasdaq, nyse)
    )
    is_cacheable = exchange_history_count == 3 and bool(combined_history)
    representative_exchange_count = sum(
        exchange.get("source") == "exchange-universe-full"
        and float(exchange.get("participation_pct") or 0.0)
        >= _MIN_REPRESENTATIVE_PARTICIPATION_PCT
        for exchange in (amex, nasdaq, nyse)
    )
    is_representative = representative_exchange_count == 3
    payload["data_quality"] = {
        "status": "complete" if is_representative else "partial",
        "stale": False,
        "exchange_history_coverage": exchange_history_count,
        "exchange_history_total": 3,
        "representative_exchange_coverage": representative_exchange_count,
        "representative_exchange_total": 3,
        "minimum_representative_participation_pct": _MIN_REPRESENTATIVE_PARTICIPATION_PCT,
        "cacheable": is_cacheable,
        "representative": is_representative,
        "provider_request_shape": "single_batched_breadth_download",
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "max_stale_age_seconds": _MAX_STALE_AGE_SECONDS,
    }

    if is_cacheable:
        if (
            shared_snapshot is not None
            and _breadth_quality_rank(payload)
            < _breadth_quality_rank(shared_snapshot.payload)
        ):
            logger.warning(
                "Breadth refresh for %s was lower quality than the prior "
                "snapshot; retaining snapshot aged %.1fs",
                cache_key,
                shared_snapshot.age_seconds,
            )
            return mark_stale_snapshot(
                shared_snapshot.payload,
                shared_snapshot,
                reason="breadth_refresh_degraded",
                ttl_seconds=_CACHE_TTL_SECONDS,
                max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
            )
        _set_memory_snapshot(days, now, payload)
        store_response_snapshot(cache_key, payload, cached_at=now.replace(tzinfo=None))
    elif shared_snapshot is not None:
        logger.warning(
            "Breadth refresh for %s was incomplete; reusing snapshot aged %.1fs",
            cache_key,
            shared_snapshot.age_seconds,
        )
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="breadth_refresh_incomplete",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )

    return payload


@router.get("/market-internals/overview")
def get_market_internals_overview(
    days: int = Query(90, ge=30, le=365),
) -> dict[str, object]:
    cache_key = f"market-internals:overview:{days}"
    shared_snapshot = load_response_snapshot(cache_key)
    if (
        shared_snapshot is not None
        and not shared_snapshot.is_within_stale_limit(_MAX_STALE_AGE_SECONDS)
    ):
        shared_snapshot = None
    if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
        return shared_snapshot.payload  # type: ignore[return-value]

    with response_refresh_lock(cache_key):
        # The lock holder may have populated the shared snapshot while this
        # request was waiting. Re-read before touching any provider.
        shared_snapshot = load_response_snapshot(cache_key)
        if (
            shared_snapshot is not None
            and not shared_snapshot.is_within_stale_limit(
                _MAX_STALE_AGE_SECONDS
            )
        ):
            shared_snapshot = None
        if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
            return shared_snapshot.payload  # type: ignore[return-value]
        return _build_market_internals_overview(days, shared_snapshot)
