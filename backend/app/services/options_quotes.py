from __future__ import annotations

from datetime import date, datetime, timezone
from math import ceil, log10
from typing import Optional

import pandas as pd
import yfinance as yf

from app.services.greeks_calculator import black_scholes_price


RISK_FREE_RATE = 0.0425


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

    today = datetime.now(timezone.utc).date()
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


def _candidate_frame(frame: pd.DataFrame, current_price: float, contract_side: str) -> pd.DataFrame:
    if frame is None or frame.empty or "strike" not in frame.columns:
        return pd.DataFrame()

    frame = frame.dropna(subset=["strike"]).copy()
    if frame.empty:
        return pd.DataFrame()

    if contract_side == "CALL":
        filtered = frame[
            (frame["strike"] >= current_price * 0.96)
            & (frame["strike"] <= current_price * 1.10)
        ]
    else:
        filtered = frame[
            (frame["strike"] <= current_price * 1.04)
            & (frame["strike"] >= current_price * 0.90)
        ]
    if filtered.empty:
        filtered = frame[(frame["strike"] - current_price).abs() / current_price <= 0.12]

    return filtered.copy()


def _modeled_exit_price(
    *,
    underlying_price: float,
    strike: float,
    remaining_calendar_days: int,
    sigma: float,
    contract_side: str,
) -> float:
    return black_scholes_price(
        S=underlying_price,
        K=strike,
        T=max(1, remaining_calendar_days) / 365.0,
        r=RISK_FREE_RATE,
        sigma=sigma,
        option_type=contract_side.lower(),
    )


def select_optimal_contract(
    stock: Optional[yf.Ticker],
    current_price: Optional[float],
    contract_side: str,
    hold_days: int,
    target_move_pct: float,
    stop_move_pct: float,
    fallback_iv_pct: Optional[float] = None,
    fallback_hv_pct: Optional[float] = None,
    min_dte: int = 30,
    max_dte: int = 90,
) -> Optional[dict[str, object]]:
    if stock is None or current_price is None or current_price <= 0:
        return None

    try:
        expiries = stock.options or []
    except Exception:
        return None

    today = datetime.now(timezone.utc).date()
    expiry_candidates: list[tuple[str, int]] = []
    for expiry in expiries:
        expiry_date = parse_option_expiry(expiry)
        if not expiry_date:
            continue
        dte = (expiry_date - today).days
        if min_dte <= dte <= max_dte:
            expiry_candidates.append((expiry, dte))

    if not expiry_candidates:
        return None

    if contract_side == "CALL":
        target_underlying = current_price * (1 + target_move_pct / 100.0)
        stop_underlying = current_price * (1 - stop_move_pct / 100.0)
    else:
        target_underlying = current_price * (1 - target_move_pct / 100.0)
        stop_underlying = current_price * (1 + stop_move_pct / 100.0)

    hold_calendar_days = max(1, int(ceil(hold_days * 7 / 5)))
    fallback_sigma = None
    for vol_pct in (fallback_iv_pct, fallback_hv_pct):
        if vol_pct is not None and vol_pct > 0:
            fallback_sigma = max(0.08, min(2.0, float(vol_pct) / 100.0))
            break
    if fallback_sigma is None:
        fallback_sigma = 0.30

    min_usable_dte = max(min_dte, hold_calendar_days + 14)
    best: Optional[dict[str, object]] = None
    best_score = float("-inf")
    scored_count = 0

    for expiry, dte in expiry_candidates:
        if dte < min_usable_dte:
            continue
        remaining_calendar_days = max(1, dte - hold_calendar_days)
        try:
            chain = stock.option_chain(expiry)
        except Exception:
            continue

        frame = chain.calls if contract_side == "CALL" else chain.puts
        candidates = _candidate_frame(frame, current_price, contract_side)
        if candidates.empty:
            continue

        for _, row in candidates.iterrows():
            quote = option_quote_from_row(row)
            premium = quote.get("premium")
            if not isinstance(premium, (int, float)) or premium <= 0:
                continue

            spread_pct = quote.get("spread_pct")
            if isinstance(spread_pct, (int, float)) and spread_pct > 45:
                continue

            strike = quote_number(row.get("strike"))
            if strike is None or strike <= 0:
                continue

            chain_iv = quote.get("implied_volatility")
            sigma = (
                float(chain_iv)
                if isinstance(chain_iv, (int, float)) and 0.05 <= float(chain_iv) <= 5.0
                else fallback_sigma
            )

            target_option = _modeled_exit_price(
                underlying_price=target_underlying,
                strike=strike,
                remaining_calendar_days=remaining_calendar_days,
                sigma=sigma,
                contract_side=contract_side,
            )
            stop_option = _modeled_exit_price(
                underlying_price=stop_underlying,
                strike=strike,
                remaining_calendar_days=remaining_calendar_days,
                sigma=sigma,
                contract_side=contract_side,
            )

            plan_profit = max(0.0, (target_option - premium) * 100.0)
            planned_loss = max(0.0, (premium - stop_option) * 100.0)
            max_loss = premium * 100.0
            risk = max(planned_loss, premium * 100.0 * 0.25, 1.0)
            reward_risk = plan_profit / risk
            profit_pct = ((target_option / premium) - 1.0) * 100.0 if premium else 0.0
            stop_loss_pct = max(0.0, (1.0 - (stop_option / premium)) * 100.0) if premium else 0.0

            open_interest = int(quote.get("open_interest") or 0)
            volume = int(quote.get("volume") or 0)
            liquidity_score = min(2.0, log10(open_interest + volume + 10) / 2.0)
            spread_penalty = (float(spread_pct) / 18.0) if isinstance(spread_pct, (int, float)) else 1.2
            dte_penalty = abs(dte - 60) / 90.0
            moneyness_penalty = abs(strike - current_price) / current_price

            score = (
                reward_risk * 2.0
                + min(2.5, profit_pct / 45.0)
                + liquidity_score
                - spread_penalty
                - dte_penalty
                - moneyness_penalty * 3.0
            )

            scored_count += 1
            if score <= best_score:
                continue

            best_score = score
            theoretical_max_profit = None
            if contract_side == "PUT":
                theoretical_max_profit = max(0.0, (strike - premium) * 100.0)

            best = {
                "expiry": expiry,
                "dte": dte,
                "strike": float(strike),
                "side": contract_side,
                "premium": float(premium),
                "price_source": quote.get("price_source"),
                "bid": quote.get("bid"),
                "ask": quote.get("ask"),
                "last": quote.get("last"),
                "spread_pct": quote.get("spread_pct"),
                "volume": volume,
                "open_interest": open_interest,
                "implied_volatility": quote.get("implied_volatility"),
                "last_trade_date": quote.get("last_trade_date"),
                "quality": quote.get("quality"),
                "selection": "optimized_30_90_dte",
                "score": float(score),
                "scored_contracts": scored_count,
                "hold_days": hold_days,
                "hold_calendar_days": hold_calendar_days,
                "target_underlying": float(target_underlying),
                "stop_underlying": float(stop_underlying),
                "target_option_price": float(target_option),
                "stop_option_price": float(stop_option),
                "target_profit": float(plan_profit),
                "target_profit_pct": float(profit_pct),
                "planned_loss": float(planned_loss),
                "planned_loss_pct": float(stop_loss_pct),
                "max_loss": float(max_loss),
                "theoretical_max_profit": float(theoretical_max_profit) if theoretical_max_profit is not None else None,
                "reward_risk": float(reward_risk),
                "remaining_dte_after_hold": remaining_calendar_days,
                "model_volatility": float(sigma),
            }

    return best
