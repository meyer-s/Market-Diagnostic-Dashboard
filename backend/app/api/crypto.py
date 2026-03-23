import asyncio
from datetime import datetime

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
MARKET_OVERVIEW_CACHE_TTL_SECONDS = 300
_market_overview_cache: dict[int, tuple[float, dict]] = {}


def _coingecko_date(timestamp_ms: float) -> str:
    return datetime.utcfromtimestamp(timestamp_ms / 1000).strftime("%Y-%m-%d")


def _safe_round(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _get_cached_market_overview(days: int) -> dict | None:
    cached = _market_overview_cache.get(days)
    if not cached:
        return None

    cached_at, payload = cached
    if (datetime.utcnow().timestamp() - cached_at) > MARKET_OVERVIEW_CACHE_TTL_SECONDS:
        return None

    return payload


def _set_cached_market_overview(days: int, payload: dict) -> None:
    _market_overview_cache[days] = (datetime.utcnow().timestamp(), payload)


def _get_market_structure_history(days: int) -> list[dict[str, float | str | None]]:
    with get_db_session() as db:
        rows = (
            db.query(CryptoPrice)
            .order_by(CryptoPrice.date.desc())
            .limit(days * 2)
            .all()
        )

    history = []
    for row in sorted(rows, key=lambda item: item.date)[-days:]:
        total_market_cap = None
        if row.total_crypto_mcap is not None:
            total_market_cap = float(row.total_crypto_mcap) * 1_000_000_000

        history.append(
            {
                "date": row.date.date().isoformat(),
                "total_market_cap": _safe_round(total_market_cap, 2),
                "btc_dominance_pct": _safe_round(row.btc_dominance, 2),
            }
        )

    return history


@router.get("/market-overview")
async def get_crypto_market_overview(
    days: int = Query(365, ge=30, le=730, description="Number of days of market history to retrieve")
):
    cached_payload = _get_cached_market_overview(days)
    if cached_payload is not None:
        return cached_payload

    asset_ids = ",".join(asset["coin_id"] for asset in CRYPTO_ASSETS)
    market_structure_history = _get_market_structure_history(days)
    latest_market_structure = market_structure_history[-1] if market_structure_history else None

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            current_task = client.get(
                f"{COINGECKO_BASE_URL}/simple/price",
                params={
                    "ids": asset_ids,
                    "vs_currencies": "usd",
                    "include_market_cap": "true",
                    "include_24hr_vol": "true",
                    "include_24hr_change": "true",
                },
            )
            global_task = client.get(f"{COINGECKO_BASE_URL}/global")
            history_tasks = [
                client.get(
                    f"{COINGECKO_BASE_URL}/coins/{asset['coin_id']}/market_chart",
                    params={
                        "vs_currency": "usd",
                        "days": days,
                        "interval": "daily",
                    },
                )
                for asset in CRYPTO_ASSETS
            ]

            current_response, global_response, *history_responses = await asyncio.gather(
                current_task,
                global_task,
                *history_tasks,
            )

        current_response.raise_for_status()
        global_response.raise_for_status()
        for response in history_responses:
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if cached_payload is not None:
            return cached_payload
        raise HTTPException(status_code=502, detail=f"Crypto source returned an error: {exc}")
    except Exception as exc:
        if cached_payload is not None:
            return cached_payload
        raise HTTPException(status_code=502, detail=f"Failed to fetch crypto market data: {exc}")

    current_payload = current_response.json()
    global_payload = global_response.json().get("data", {})

    assets = []
    advancing_assets_24h = 0

    for asset, history_response in zip(CRYPTO_ASSETS, history_responses):
        market_payload = current_payload.get(asset["coin_id"], {})
        history_payload = history_response.json()

        history_by_date: dict[str, dict[str, float | str | None]] = {}
        for timestamp, price in history_payload.get("prices", []):
            date_key = _coingecko_date(timestamp)
            history_by_date.setdefault(date_key, {"date": date_key})["price"] = _safe_round(price, 4)
        for timestamp, market_cap in history_payload.get("market_caps", []):
            date_key = _coingecko_date(timestamp)
            history_by_date.setdefault(date_key, {"date": date_key})["market_cap"] = _safe_round(market_cap, 2)
        for timestamp, volume in history_payload.get("total_volumes", []):
            date_key = _coingecko_date(timestamp)
            history_by_date.setdefault(date_key, {"date": date_key})["total_volume"] = _safe_round(volume, 2)

        history = sorted(history_by_date.values(), key=lambda item: item["date"])
        history_prices = [entry["price"] for entry in history if isinstance(entry.get("price"), (int, float))]
        change_30d = None
        if len(history_prices) >= 31 and history_prices[-31]:
            base_price = float(history_prices[-31])
            latest_price = float(history_prices[-1])
            if base_price != 0:
                change_30d = ((latest_price / base_price) - 1) * 100

        change_24h = market_payload.get("usd_24h_change")
        if isinstance(change_24h, (int, float)) and change_24h > 0:
            advancing_assets_24h += 1

        assets.append(
            {
                "symbol": asset["symbol"],
                "name": asset["name"],
                "coin_id": asset["coin_id"],
                "color": asset["color"],
                "current_price": _safe_round(market_payload.get("usd"), 4),
                "change_24h": _safe_round(change_24h, 2),
                "change_30d": _safe_round(change_30d, 2),
                "market_cap": _safe_round(market_payload.get("usd_market_cap"), 2),
                "total_volume_24h": _safe_round(market_payload.get("usd_24h_vol"), 2),
                "history": history,
            }
        )

    payload = {
        "as_of": datetime.utcnow().isoformat(),
        "summary": {
            "btc_dominance": _safe_round(global_payload.get("market_cap_percentage", {}).get("btc"), 2)
            or (latest_market_structure.get("btc_dominance_pct") if latest_market_structure else None),
            "total_market_cap": _safe_round(global_payload.get("total_market_cap", {}).get("usd"), 2)
            or (latest_market_structure.get("total_market_cap") if latest_market_structure else None),
            "market_cap_change_24h": _safe_round(global_payload.get("market_cap_change_percentage_24h_usd"), 2),
            "advancing_assets_24h": advancing_assets_24h,
            "monitored_assets": len(CRYPTO_ASSETS),
        },
        "assets": assets,
        "market_structure_history": market_structure_history,
    }

    _set_cached_market_overview(days, payload)
    return payload


@router.get("/diagnostic-context")
def get_crypto_diagnostic_context(
    days: int = Query(365, ge=30, le=730, description="Number of days of stored crypto diagnostic context to retrieve")
):
    with get_db_session() as db:
        latest_indicator = db.query(AASIndicator).order_by(AASIndicator.date.desc()).first()
        latest_component = db.query(AASComponentV2).order_by(AASComponentV2.date.desc()).first()

        market_rows = (
            db.query(CryptoPrice)
            .order_by(CryptoPrice.date.desc())
            .limit(days * 2)
            .all()
        )
        component_rows = (
            db.query(AASComponentV2)
            .order_by(AASComponentV2.date.desc())
            .limit(days * 2)
            .all()
        )

        market_by_day = {}
        for row in market_rows:
            market_by_day[row.date.date()] = row

        component_by_day = {}
        for row in component_rows:
            component_by_day[row.date.date()] = row

        market_history = [
            {
                "date": row.date.date().isoformat(),
                "btc_price": _safe_round(row.btc_usd, 2),
                "eth_price": _safe_round(row.eth_usd, 2),
                "total_crypto_mcap_b": _safe_round(row.total_crypto_mcap, 2),
                "btc_dominance_pct": _safe_round(row.btc_dominance, 2),
                "btc_volume_24h": _safe_round(row.btc_volume_24h, 2),
            }
            for row in sorted(market_by_day.values(), key=lambda item: item.date)[-days:]
        ]

        signal_history = [
            {
                "date": row.date.date().isoformat(),
                "stablecoin_supply": _safe_round(row.stablecoin_supply, 4),
                "stablecoin_btc_ratio": _safe_round(row.stablecoin_btc_ratio, 4),
                "defi_tvl": _safe_round(row.defi_tvl, 4),
                "exchange_outflows": _safe_round(row.exchange_outflows, 4),
                "btc_spy_correlation": _safe_round(row.btc_spy_correlation, 4),
                "altcoin_weakness": _safe_round(row.altcoin_weakness, 4),
                "btc_hash_rate": _safe_round(row.btc_hash_rate, 4),
                "btc_difficulty": _safe_round(row.btc_difficulty, 4),
            }
            for row in sorted(component_by_day.values(), key=lambda item: item.date)[-days:]
        ]

        if not market_history and not signal_history:
            raise HTTPException(status_code=404, detail="No crypto diagnostic context available")

        return {
            "as_of": datetime.utcnow().isoformat(),
            "summary": {
                "primary_driver": latest_indicator.primary_driver if latest_indicator else None,
                "stress_type": latest_indicator.stress_type if latest_indicator else None,
                "crypto_contribution": _safe_round(latest_indicator.crypto_contribution, 3) if latest_indicator else None,
                "crypto_pressure_score": _safe_round(latest_component.crypto_pressure_score, 3) if latest_component else None,
                "correlation_regime": latest_component.correlation_regime if latest_component else None,
            },
            "current_signals": {
                "stablecoin_supply": _safe_round(latest_component.stablecoin_supply, 4) if latest_component else None,
                "stablecoin_btc_ratio": _safe_round(latest_component.stablecoin_btc_ratio, 4) if latest_component else None,
                "defi_tvl": _safe_round(latest_component.defi_tvl, 4) if latest_component else None,
                "exchange_outflows": _safe_round(latest_component.exchange_outflows, 4) if latest_component else None,
                "btc_spy_correlation": _safe_round(latest_component.btc_spy_correlation, 4) if latest_component else None,
                "altcoin_weakness": _safe_round(latest_component.altcoin_weakness, 4) if latest_component else None,
                "btc_hash_rate": _safe_round(latest_component.btc_hash_rate, 4) if latest_component else None,
                "btc_difficulty": _safe_round(latest_component.btc_difficulty, 4) if latest_component else None,
            },
            "market_history": market_history,
            "signal_history": signal_history,
        }