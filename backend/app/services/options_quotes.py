from __future__ import annotations

from datetime import date, datetime
from typing import Optional

import pandas as pd
import yfinance as yf


def parse_option_expiry(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def quote_number(value) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    try:
        return float(value)
    except Exception:
        return None


def quote_int(value) -> Optional[int]:
    number = quote_number(value)
    return int(number) if number is not None else None


def quote_timestamp(value) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def option_quote_from_row(row: Optional[pd.Series]) -> dict[str, object]:
    if row is None:
        return {
            "bid": None,
            "ask": None,
            "last": None,
            "mid": None,
            "premium": None,
            "price_source": None,
            "spread": None,
            "spread_pct": None,
            "volume": None,
            "open_interest": None,
            "implied_volatility": None,
            "last_trade_date": None,
            "quality": "missing",
        }

    bid = quote_number(row.get("bid"))
    ask = quote_number(row.get("ask"))
    last = quote_number(row.get("lastPrice"))
    mid = (bid + ask) / 2.0 if bid is not None and ask is not None and bid > 0 and ask > 0 else None
    spread = (ask - bid) if mid is not None and bid is not None and ask is not None else None
    spread_pct = (spread / mid * 100.0) if spread is not None and mid else None

    if mid is not None:
        premium = mid
        price_source = "mid"
    elif last is not None and last > 0:
        premium = last
        price_source = "last"
    else:
        premium = None
        price_source = None

    quality = "mid" if mid is not None else "last" if premium is not None else "missing"
    if spread_pct is not None and spread_pct > 25:
        quality = "wide"

    return {
        "bid": bid,
        "ask": ask,
        "last": last,
        "mid": mid,
        "premium": premium,
        "price_source": price_source,
        "spread": spread,
        "spread_pct": spread_pct,
        "volume": quote_int(row.get("volume")),
        "open_interest": quote_int(row.get("openInterest")),
        "implied_volatility": quote_number(row.get("impliedVolatility")),
        "last_trade_date": quote_timestamp(row.get("lastTradeDate")),
        "quality": quality,
    }


def option_premium_from_row(row: pd.Series) -> Optional[float]:
    premium = option_quote_from_row(row).get("premium")
    return float(premium) if isinstance(premium, (int, float)) and premium > 0 else None


def select_atm_contract(
    stock: Optional[yf.Ticker],
    current_price: Optional[float],
    contract_side: str,
    target_dte: int,
    min_remaining_after_hold: int,
    max_moneyness_pct: float = 0.20,
) -> Optional[dict[str, object]]:
    if stock is None or current_price is None or current_price <= 0:
        return None

    try:
        expiries = stock.options or []
    except Exception:
        return None

    today = datetime.utcnow().date()
    candidates: list[tuple[str, int]] = []
    for expiry in expiries:
        expiry_date = parse_option_expiry(expiry)
        if not expiry_date:
            continue
        dte = (expiry_date - today).days
        if dte <= min_remaining_after_hold:
            continue
        candidates.append((expiry, dte))

    if not candidates:
        return None

    expiry, dte = min(candidates, key=lambda item: abs(item[1] - target_dte))
    try:
        chain = stock.option_chain(expiry)
    except Exception:
        return None

    frame = chain.calls if contract_side == "CALL" else chain.puts
    if frame is None or frame.empty or "strike" not in frame.columns:
        return None

    frame = frame.dropna(subset=["strike"]).copy()
    if frame.empty:
        return None

    frame["strike_delta"] = (frame["strike"] - current_price).abs()
    near_frame = frame[(frame["strike"] - current_price).abs() / current_price <= max_moneyness_pct]
    if not near_frame.empty:
        frame = near_frame

    if {"bid", "ask"}.issubset(frame.columns):
        quoted = frame[
            frame["bid"].apply(lambda value: (quote_number(value) or 0) > 0)
            & frame["ask"].apply(lambda value: (quote_number(value) or 0) > 0)
        ]
    else:
        quoted = pd.DataFrame()

    source_frame = quoted if not quoted.empty else frame
    row = source_frame.sort_values("strike_delta").iloc[0]
    quote = option_quote_from_row(row)
    premium = quote.get("premium")
    if not isinstance(premium, (int, float)) or premium <= 0:
        return None

    return {
        "expiry": expiry,
        "dte": dte,
        "strike": float(row.get("strike")),
        "side": contract_side,
        "premium": premium,
        "price_source": quote.get("price_source"),
        "bid": quote.get("bid"),
        "ask": quote.get("ask"),
        "last": quote.get("last"),
        "spread_pct": quote.get("spread_pct"),
        "volume": int(quote.get("volume") or 0),
        "open_interest": int(quote.get("open_interest") or 0),
        "implied_volatility": quote.get("implied_volatility"),
        "last_trade_date": quote.get("last_trade_date"),
    }
