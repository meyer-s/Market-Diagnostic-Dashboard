"""Nearby precious-metals futures curves backed by contract-specific daily bars."""

from datetime import datetime
from typing import List, Optional

import yfinance as yf


MONTH_CODE_TO_NUMBER = {
    "F": 1,
    "G": 2,
    "H": 3,
    "J": 4,
    "K": 5,
    "M": 6,
    "N": 7,
    "Q": 8,
    "U": 9,
    "V": 10,
    "X": 11,
    "Z": 12,
}

PRECIOUS_METALS_FUTURES = {
    "AU": {
        "label": "Gold",
        "root": "GC",
        "exchange": "CMX",
        "months": ["G", "J", "M", "Q", "V", "Z"],
    },
    "AG": {
        "label": "Silver",
        "root": "SI",
        "exchange": "CMX",
        "months": ["H", "K", "N", "U", "Z"],
    },
    "PT": {
        "label": "Platinum",
        "root": "PL",
        "exchange": "NYM",
        "months": ["F", "J", "N", "V"],
    },
    "PD": {
        "label": "Palladium",
        "root": "PA",
        "exchange": "NYM",
        "months": ["H", "M", "U", "Z"],
    },
}

SOURCE_NAME = "Yahoo Finance month-specific futures history"


def build_nearby_contract_candidates(config: dict, contracts: int, as_of: datetime) -> List[dict]:
    candidates: List[dict] = []
    current_year = as_of.year
    current_month = as_of.month
    month_codes = sorted(config["months"], key=lambda code: MONTH_CODE_TO_NUMBER[code])

    for year_offset in range(0, 4):
        year = current_year + year_offset
        for month_code in month_codes:
            month_number = MONTH_CODE_TO_NUMBER[month_code]
            if year == current_year and month_number < current_month:
                continue
            symbol = f'{config["root"]}{month_code}{year % 100:02d}.{config["exchange"]}'
            candidates.append({
                "symbol": symbol,
                "month_code": month_code,
                "month_number": month_number,
                "year": year,
                "contract_label": datetime(year, month_number, 1).strftime("%b %Y"),
            })
            if len(candidates) >= contracts + 3:
                return candidates

    return candidates


def fetch_futures_contract_snapshot(symbol: str) -> Optional[dict]:
    try:
        history = yf.Ticker(symbol).history(period="5d")
    except Exception:
        return None

    if history is None or history.empty or "Close" not in history:
        return None

    closes = history["Close"].dropna()
    if closes.empty:
        return None

    latest_price = float(closes.iloc[-1])
    previous_close = float(closes.iloc[-2]) if len(closes) > 1 else latest_price
    latest_row = history.iloc[-1]
    volume = None
    if "Volume" in history and latest_row.get("Volume") is not None:
        try:
            volume = int(latest_row["Volume"])
        except (TypeError, ValueError):
            volume = None

    quote_time = history.index[-1]
    as_of_value = quote_time.to_pydatetime().isoformat() if hasattr(quote_time, "to_pydatetime") else str(quote_time)
    return {
        "price": latest_price,
        "previous_close": previous_close,
        "change_pct": ((latest_price / previous_close) - 1) * 100 if previous_close else 0.0,
        "volume": volume,
        "as_of": as_of_value,
    }


def get_metal_futures_curve(
    metal: str,
    contracts: int,
    as_of: Optional[datetime] = None,
    snapshot_fetcher=None,
) -> Optional[dict]:
    """Fetch one venue-specific nearby curve without querying unrelated metals."""
    config = PRECIOUS_METALS_FUTURES.get(metal)
    if not config:
        return None
    as_of = as_of or datetime.utcnow()
    fetcher = snapshot_fetcher or fetch_futures_contract_snapshot
    contract_rows = []
    for candidate in build_nearby_contract_candidates(config, contracts, as_of):
        snapshot = fetcher(candidate["symbol"])
        if not snapshot:
            continue
        contract_rows.append({**candidate, **snapshot})
        if len(contract_rows) >= contracts:
            break
    if not contract_rows:
        return None

    front_price = contract_rows[0]["price"]
    deferred_price = contract_rows[-1]["price"] if len(contract_rows) > 1 else front_price
    curve_bps = None
    curve_state = "FLAT"
    if front_price and deferred_price:
        curve_bps = ((front_price / deferred_price) - 1) * 10000
        if curve_bps > 0:
            curve_state = "BACKWARDATION"
        elif curve_bps < 0:
            curve_state = "CONTANGO"
    return {
        "metal": metal,
        "label": config["label"],
        "curve_state": curve_state,
        "curve_bps": curve_bps,
        "contracts": contract_rows,
    }


def get_precious_metals_futures_curve(contracts: int = 4, as_of: Optional[datetime] = None) -> dict:
    generated_at = as_of or datetime.utcnow()
    metals = []
    quote_timestamps = []

    for metal in PRECIOUS_METALS_FUTURES:
        curve = get_metal_futures_curve(metal, contracts=contracts, as_of=generated_at)
        if not curve:
            continue
        metals.append(curve)
        quote_timestamps.extend(row["as_of"] for row in curve["contracts"])

    return {
        "as_of": max(quote_timestamps) if quote_timestamps else None,
        "generated_at": generated_at.isoformat(),
        "source": SOURCE_NAME,
        "contracts_requested": contracts,
        "metals": metals,
    }
