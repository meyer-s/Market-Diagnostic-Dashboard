import asyncio
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import math
import time

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.models.alternative_assets import AASComponentV2, AASIndicator, CryptoPrice
from app.utils.db_helpers import get_db_session

router = APIRouter(prefix="/crypto", tags=["Crypto"])
COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
CRYPTO_ASSETS = [
    {"symbol": "BTC", "name": "Bitcoin", "coin_id": "bitcoin", "color": "#f7931a"},
    {"symbol": "ETH", "name": "Ethereum", "coin_id": "ethereum", "color": "#627eea"},
    {"symbol": "SOL", "name": "Solana", "coin_id": "solana", "color": "#14f195"},
    {"symbol": "XRP", "name": "XRP", "coin_id": "ripple", "color": "#f472b6"},
]
MARKET_OVERVIEW_CACHE_TTL_SECONDS = 900
MARKET_OVERVIEW_MAX_STALE_SECONDS = 7200
MARKET_OVERVIEW_RETRY_SECONDS = 60
_market_overview_cache: OrderedDict[int, tuple[float, dict]] = OrderedDict()
_market_overview_inflight: dict[int, asyncio.Task] = {}
_market_overview_retry_after: dict[int, float] = {}
SIGNAL_FIELDS = ("stablecoin_supply", "stablecoin_btc_ratio", "defi_tvl", "exchange_outflows",
                 "btc_spy_correlation", "altcoin_weakness", "btc_hash_rate", "btc_difficulty")


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value):
    return value.isoformat() + "Z" if value is not None else None


def _safe_round(value, digits=2):
    try:
        number = float(value)
        return round(number, digits) if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _parse_time(value):
    try:
        if isinstance(value, (float, int)):
            return datetime.fromtimestamp(value, timezone.utc).replace(tzinfo=None)
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _quality(observed_at, max_age=1200):
    age = (_now() - observed_at).total_seconds() if observed_at else None
    status = "unavailable" if age is None or age < -300 else "fresh" if age <= max_age else "stale"
    return {"status": status, "age_seconds": round(age) if age is not None else None}


def _row_observed_at(row):
    source = row.source or ""
    if source.startswith("COINGECKO_LIVE|"):
        return _parse_time(source.split("|", 1)[1])
    if "observed_at=" in source:
        return _parse_time(source.split("observed_at=", 1)[1])
    return row.date


def _coingecko_date(timestamp_ms):
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _get_cached_market_overview(days, allow_stale=False):
    cached = _market_overview_cache.get(days)
    if cached is None:
        return None
    age = time.monotonic() - cached[0]
    payload = cached[1]
    degraded = payload.get("source") == "Stored daily observations" or payload.get("data_quality", {}).get("status", "fresh") != "fresh"
    ttl = MARKET_OVERVIEW_RETRY_SECONDS if degraded else MARKET_OVERVIEW_CACHE_TTL_SECONDS
    if age > (MARKET_OVERVIEW_MAX_STALE_SECONDS if allow_stale else ttl):
        return None
    result = deepcopy(payload)
    result["cache"] = {"state": "stale" if age > ttl else "hit", "age_seconds": round(age), "ttl_seconds": ttl}
    result["generated_at"] = _iso(_now())
    for asset in result.get("assets", []):
        previous_status = asset.get("data_quality", {}).get("status")
        asset["data_quality"] = _quality(_parse_time(asset.get("observed_at")), 1200 if asset.get("source") == "CoinGecko" else 129600)
        if asset.get("current_price") is None:
            asset["data_quality"]["status"] = "unavailable"
        elif previous_status == "partial" and asset["data_quality"]["status"] == "fresh":
            asset["data_quality"]["status"] = "partial"
    if result.get("source") == "CoinGecko":
        summary = result.setdefault("summary", {})
        previous_summary_status = summary.get("data_quality", {}).get("status")
        summary["data_quality"] = _quality(_parse_time(summary.get("observed_at")))
        if previous_summary_status in ("partial", "unavailable") and summary["data_quality"]["status"] == "fresh":
            summary["data_quality"]["status"] = previous_summary_status
        source_quality = _quality(_parse_time(result.get("observed_at")))
        if source_quality["status"] != "fresh":
            result["data_quality"] = source_quality
    if age > ttl:
        result["data_quality"] = {**result.get("data_quality", {}), "status": "stale", "reason": "Provider refresh failed; showing a bounded cached observation."}
    return result


def _set_cached_market_overview(days, payload):
    _market_overview_cache[days] = (time.monotonic(), deepcopy(payload))
    _market_overview_cache.move_to_end(days)
    while len(_market_overview_cache) > 16:
        key, _ = _market_overview_cache.popitem(last=False)
        _market_overview_retry_after.pop(key, None)


def _daily_rows(db, model, days):
    # Calendar window, not row count: intraday writes cannot truncate it.
    start = _now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days)
    rows = db.query(model).filter(model.date >= start, model.date <= _now()).order_by(model.date.desc(), model.created_at.desc(), model.id.desc()).all()
    by_day = {}
    for row in rows:
        by_day.setdefault(row.date.date(), row)
    return [by_day[day] for day in sorted(by_day)]


def _structure(rows):
    return [{"date": row.date.date().isoformat(),
             "total_market_cap": _safe_round(row.total_crypto_mcap * 1e9 if row.total_crypto_mcap is not None else None),
             "btc_dominance_pct": _safe_round(row.btc_dominance)} for row in rows]


def _get_market_structure_history(days):
    with get_db_session() as db:
        return _structure(_daily_rows(db, CryptoPrice, days))


def _calendar_change(rows, latest, field, period):
    if latest is None:
        return None
    target = latest.date.date() - timedelta(days=period)
    baseline = next((row for row in rows if row.date.date() == target), None)
    if baseline is None:
        return None
    latest_time, baseline_time = _row_observed_at(latest), _row_observed_at(baseline)
    if latest_time is None or baseline_time is None:
        return None
    elapsed = (latest_time - baseline_time).total_seconds()
    if abs(elapsed - period * 86400) > 3600:
        return None
    old, current = _safe_round(getattr(baseline, field), 8), _safe_round(getattr(latest, field), 8)
    return _safe_round((current / old - 1) * 100) if old and current is not None else None


def _build_db_fallback_market_overview(days, stale_payload=None):
    # Do not merge unaligned cached provider fields into a stored observation.
    with get_db_session() as db:
        rows = _daily_rows(db, CryptoPrice, max(days, 31))
    if not rows:
        return None
    latest = rows[-1]
    observed = _row_observed_at(latest)
    start = (_now() - timedelta(days=days)).date()
    display_rows = [row for row in rows if row.date.date() >= start]
    assets = []
    for asset in CRYPTO_ASSETS:
        field = asset["symbol"].lower() + "_usd"
        price = _safe_round(getattr(latest, field), 4)
        cap = latest.total_crypto_mcap * 1e9 * latest.btc_dominance / 100 if asset["symbol"] == "BTC" and latest.total_crypto_mcap is not None and latest.btc_dominance is not None else None
        assets.append({**asset, "current_price": price,
                       "change_24h": _calendar_change(rows, latest, field, 1),
                       "change_30d": _calendar_change(rows, latest, field, 30),
                       "change_24h_basis": "Matched daily snapshots; not a rolling live return",
                       "change_30d_basis": "Matched daily snapshots 30 calendar days apart",
                       "market_cap": _safe_round(cap), "total_volume_24h": _safe_round(latest.btc_volume_24h) if asset["symbol"] == "BTC" else None,
                       "history": [{"date": row.date.date().isoformat(), "price": _safe_round(getattr(row, field), 4)} for row in display_rows],
                       "source": "Stored daily observations", "source_detail": latest.source,
                       "observed_at": _iso(observed),
                       "data_quality": _quality(observed, 129600) if price is not None else {"status": "unavailable", "age_seconds": None}})
    changes = [asset["change_24h"] for asset in assets if asset["change_24h"] is not None]
    quality = _quality(observed, 129600)
    quality["reason"] = "Live provider unavailable; stored daily snapshots, with missing fields left unknown."
    if quality["status"] == "fresh":
        quality["status"] = "partial"
    return {"as_of": _iso(observed), "observed_at": _iso(observed),
            "generated_at": _iso(_now()), "source": "Stored daily observations", "data_quality": quality,
            "summary": {"btc_dominance": _safe_round(latest.btc_dominance), "total_market_cap": _safe_round(latest.total_crypto_mcap * 1e9 if latest.total_crypto_mcap is not None else None),
                        "market_cap_change_24h": _calendar_change(rows, latest, "total_crypto_mcap", 1),
                        "advancing_assets_24h": sum(change > 0 for change in changes) if changes else None,
                        "change_24h_available_assets": len(changes), "monitored_assets": len(CRYPTO_ASSETS)},
            "assets": assets, "market_structure_history": _structure(display_rows)}


async def _fetch_market_overview(days):
    ids = ",".join(asset["coin_id"] for asset in CRYPTO_ASSETS)
    async with httpx.AsyncClient(timeout=7) as client:
        results = await asyncio.gather(
            client.get(f"{COINGECKO_BASE_URL}/coins/markets", params={"ids": ids, "vs_currency": "usd", "price_change_percentage": "24h,30d"}),
            client.get(f"{COINGECKO_BASE_URL}/global"),
            *[client.get(f"{COINGECKO_BASE_URL}/coins/{asset['coin_id']}/market_chart", params={"vs_currency": "usd", "days": days, "interval": "daily"}) for asset in CRYPTO_ASSETS],
            return_exceptions=True)
    current = results[0]
    if isinstance(current, Exception):
        raise current
    current.raise_for_status()
    current_by_id = {row["id"]: row for row in current.json()}
    global_payload = {}
    global_time = None
    if not isinstance(results[1], Exception) and results[1].is_success:
        global_payload = results[1].json().get("data", {})
        global_time = _parse_time(global_payload.get("updated_at"))
    global_quality = _quality(global_time)
    global_valid = global_quality["status"] != "unavailable"
    global_cap = _safe_round(global_payload.get("total_market_cap", {}).get("usd"))
    global_dominance = _safe_round(global_payload.get("market_cap_percentage", {}).get("btc"))
    if global_cap is None or global_cap <= 0 or global_dominance is None or not 0 <= global_dominance <= 100:
        global_valid = False
        global_quality = {**global_quality, "status": "unavailable", "reason": "Missing or invalid market aggregate fields."}
    assets = []
    stored_fallback = None
    for asset, history_response in zip(CRYPTO_ASSETS, results[2:]):
        quote = current_by_id.get(asset["coin_id"], {})
        observed = _parse_time(quote.get("last_updated"))
        quality = _quality(observed)
        price = _safe_round(quote.get("current_price"), 4)
        valid = quality["status"] != "unavailable" and price is not None and price > 0
        if not valid:
            quality = {**quality, "status": "unavailable", "reason": "Missing or invalid provider price or observation timestamp."}
        history_by_date = {}
        history_source = "CoinGecko"
        if not isinstance(history_response, Exception) and history_response.is_success:
            history_payload = history_response.json()
            for source, name, digits in (("prices", "price", 4), ("market_caps", "market_cap", 2), ("total_volumes", "total_volume", 2)):
                for timestamp, value in sorted(history_payload.get(source, []), key=lambda item: item[0]):
                    day = _coingecko_date(timestamp)
                    history_by_date.setdefault(day, {"date": day})[name] = _safe_round(value, digits)
        history = sorted(history_by_date.values(), key=lambda row: row["date"])
        if not history:
            if stored_fallback is None:
                stored_fallback = _build_db_fallback_market_overview(days) or {}
            history = next((row["history"] for row in stored_fallback.get("assets", []) if row["symbol"] == asset["symbol"]), [])
            history_source = "Stored daily observations"
        assets.append({**asset, "current_price": price if valid else None,
                       "change_24h": _safe_round(quote.get("price_change_percentage_24h")) if valid else None,
                       "change_30d": _safe_round(quote.get("price_change_percentage_30d_in_currency")) if valid else None,
                       "change_24h_basis": "CoinGecko rolling 24h", "change_30d_basis": "CoinGecko rolling 30d",
                       "market_cap": _safe_round(quote.get("market_cap")) if valid else None,
                       "total_volume_24h": _safe_round(quote.get("total_volume")) if valid else None,
                       "history": history, "history_source": history_source, "source": "CoinGecko", "observed_at": _iso(observed),
                       "data_quality": quality})
    known_dates = [_parse_time(asset["observed_at"]) for asset in assets if asset["observed_at"]]
    observed = min(known_dates) if known_dates else None
    changes = [asset["change_24h"] for asset in assets if asset["change_24h"] is not None]
    quality = _quality(observed)
    if any(asset["data_quality"]["status"] != "fresh" for asset in assets) or global_quality["status"] != "fresh":
        quality = {**quality, "status": "partial" if quality["status"] == "fresh" else quality["status"], "reason": "Some provider observations are stale or missing."}
    return {"as_of": _iso(observed), "observed_at": _iso(observed),
            "generated_at": _iso(_now()), "source": "CoinGecko", "data_quality": quality,
            "summary": {"btc_dominance": _safe_round(global_payload.get("market_cap_percentage", {}).get("btc")) if global_valid else None,
                        "total_market_cap": _safe_round(global_payload.get("total_market_cap", {}).get("usd")) if global_valid else None,
                        "market_cap_change_24h": _safe_round(global_payload.get("market_cap_change_percentage_24h_usd")) if global_valid else None,
                        "observed_at": _iso(global_time), "data_quality": global_quality,
                        "advancing_assets_24h": sum(change > 0 for change in changes) if changes else None,
                        "change_24h_available_assets": len(changes), "monitored_assets": len(CRYPTO_ASSETS)},
            "assets": assets, "market_structure_history": _get_market_structure_history(days)}


async def _refresh_market_overview(days):
    try:
        payload = await asyncio.wait_for(_fetch_market_overview(days), timeout=8)
        _set_cached_market_overview(days, payload)
        _market_overview_retry_after.pop(days, None)
        return payload
    except (httpx.HTTPError, ValueError, TypeError, KeyError, asyncio.TimeoutError):
        _market_overview_retry_after[days] = time.monotonic() + MARKET_OVERVIEW_RETRY_SECONDS
        stale = _get_cached_market_overview(days, allow_stale=True)
        if stale is not None:
            return stale
        fallback = _build_db_fallback_market_overview(days)
        if fallback is not None:
            _set_cached_market_overview(days, fallback)
            return fallback
        raise HTTPException(status_code=502, detail="Crypto source unavailable and no stored observations are available")


@router.get("/market-overview")
async def get_crypto_market_overview(days: int = Query(365, ge=30, le=730)):
    cached = _get_cached_market_overview(days)
    if cached is not None:
        return cached
    if time.monotonic() < _market_overview_retry_after.get(days, 0):
        stale = _get_cached_market_overview(days, allow_stale=True)
        if stale is not None:
            return stale
        raise HTTPException(status_code=502, detail="Crypto provider refresh is temporarily unavailable")
    task = _market_overview_inflight.get(days)
    if task is None:
        task = asyncio.create_task(_refresh_market_overview(days))
        _market_overview_inflight[days] = task
        def cleanup(completed):
            _market_overview_inflight.pop(days, None)
            if not completed.cancelled():
                completed.exception()
        task.add_done_callback(cleanup)
    return deepcopy(await asyncio.shield(task))


@router.get("/diagnostic-context")
def get_crypto_diagnostic_context(days: int = Query(365, ge=30, le=730)):
    with get_db_session() as db:
        latest_indicator = db.query(AASIndicator).filter(AASIndicator.date <= _now()).order_by(AASIndicator.date.desc(), AASIndicator.id.desc()).first()
        market_rows = _daily_rows(db, CryptoPrice, days)
        component_rows = _daily_rows(db, AASComponentV2, days)
        latest_component = component_rows[-1] if component_rows else None
        if not market_rows and not component_rows:
            raise HTTPException(status_code=404, detail="No crypto diagnostic context available")
        aligned = bool(latest_indicator and latest_component and latest_indicator.date == latest_component.date)
        signal_date = latest_component.date if latest_component else None
        quality = _quality(signal_date, 129600)
        missing = latest_component is None or any(_safe_round(getattr(latest_component, field), 4) is None for field in SIGNAL_FIELDS)
        if not aligned or missing:
            quality = {**quality, "status": "partial" if latest_component and quality["status"] == "fresh" else quality["status"], "reason": "Missing normalized inputs or model dates do not align."}
        current_signals = {field: _safe_round(getattr(latest_component, field), 4) if latest_component else None for field in SIGNAL_FIELDS}
        return {"as_of": _iso(signal_date), "observed_at": _iso(signal_date),
                "generated_at": _iso(_now()), "source": "Stored AAS model calculations", "data_quality": quality,
                "indicator_as_of": _iso(latest_indicator.date) if latest_indicator else None,
                "signal_as_of": _iso(signal_date),
                "market_as_of": _iso(_row_observed_at(market_rows[-1])) if market_rows else None,
                "model_dates_aligned": aligned, "signal_kind": "normalized_model_pressure",
                "signal_units": {field: "0–1 normalized pressure" for field in SIGNAL_FIELDS},
                "summary": {"primary_driver": latest_indicator.primary_driver if aligned else None,
                            "stress_type": latest_indicator.stress_type if aligned else None,
                            "crypto_contribution": _safe_round(latest_indicator.crypto_contribution, 3) if aligned else None,
                            "crypto_pressure_score": _safe_round(latest_component.crypto_pressure_score, 3) if latest_component else None,
                            "correlation_regime": latest_component.correlation_regime if latest_component else None},
                "current_signals": current_signals,
                "market_history": [{"date": row.date.date().isoformat(), "btc_price": _safe_round(row.btc_usd), "eth_price": _safe_round(row.eth_usd),
                                    "total_crypto_mcap_b": _safe_round(row.total_crypto_mcap), "btc_dominance_pct": _safe_round(row.btc_dominance),
                                    "btc_volume_24h": _safe_round(row.btc_volume_24h)} for row in market_rows],
                "signal_history": [{"date": row.date.date().isoformat(), **{field: _safe_round(getattr(row, field), 4) for field in SIGNAL_FIELDS}} for row in component_rows]}
