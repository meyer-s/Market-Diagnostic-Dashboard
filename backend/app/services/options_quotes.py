from __future__ import annotations

import logging
from datetime import datetime, timezone
from math import ceil, log10
from typing import Optional

import pandas as pd

from app.services.market_data.date_utils import parse_option_expiry
from app.services.market_data.provider import MarketDataProvider
from app.services.greeks_calculator import black_scholes_d1_d2, black_scholes_price, calculate_greeks, norm_cdf


RISK_FREE_RATE = 0.0425
CONVEXITY_PROBABILITY_HUMP = 0.55
MIN_PROFIT_AT_HUMP_PCT = 20.0
logger = logging.getLogger(__name__)


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
            "data_source": None,
            "spread": None,
            "spread_pct": None,
            "volume": None,
            "open_interest": None,
            "implied_volatility": None,
            "last_trade_date": None,
            "quote_source": None,
            "quality": "missing",
        }

    bid = quote_number(row.get("bid"))
    ask = quote_number(row.get("ask"))
    last = quote_number(row.get("lastPrice"))
    two_sided = bid is not None and ask is not None and bid > 0 and ask > 0
    crossed = bool(two_sided and ask < bid)
    mid = (bid + ask) / 2.0 if two_sided and not crossed else None
    spread = (ask - bid) if two_sided else None
    spread_pct = (spread / mid * 100.0) if spread is not None and mid else None

    if crossed:
        premium = None
        price_source = None
    elif mid is not None:
        premium = mid
        price_source = "mid"
    elif last is not None and last > 0:
        premium = last
        price_source = "last"
    else:
        premium = None
        price_source = None

    quality = "crossed" if crossed else "mid" if mid is not None else "last" if premium is not None else "missing"
    if not crossed and spread_pct is not None and spread_pct > 25:
        quality = "wide"

    return {
        "bid": bid,
        "ask": ask,
        "last": last,
        "mid": mid,
        "premium": premium,
        "price_source": price_source,
        "data_source": row.get("dataSource"),
        "spread": spread,
        "spread_pct": spread_pct,
        "volume": quote_int(row.get("volume")),
        "open_interest": quote_int(row.get("openInterest")),
        "implied_volatility": quote_number(row.get("impliedVolatility")),
        "last_trade_date": quote_timestamp(row.get("lastTradeDate")),
        "quote_source": row.get("quoteSource"),
        "quality": quality,
    }


def option_premium_from_row(row: pd.Series) -> Optional[float]:
    premium = option_quote_from_row(row).get("premium")
    return float(premium) if isinstance(premium, (int, float)) and premium > 0 else None


def _contract_data_source(
    provider: MarketDataProvider,
    chain,
    quote: dict[str, object],
) -> str:
    for value in (quote.get("data_source"), getattr(chain, "source", None), getattr(provider, "name", "unknown")):
        if value is None:
            continue
        try:
            if pd.isna(value):
                continue
        except Exception:
            pass
        text = str(value).strip()
        if text:
            return text
    return "unknown"


def _contract_quote_source(chain, quote: dict[str, object]) -> Optional[str]:
    for value in (quote.get("quote_source"), getattr(chain, "quote_source", None)):
        if value is None:
            continue
        try:
            if pd.isna(value):
                continue
        except Exception:
            pass
        text = str(value).strip()
        if text:
            return text
    return None


def select_atm_contract(
    provider: MarketDataProvider,
    symbol: str,
    current_price: Optional[float],
    contract_side: str,
    target_dte: int,
    min_remaining_after_hold: int,
    max_moneyness_pct: float = 0.20,
) -> Optional[dict[str, object]]:
    if provider is None or current_price is None or current_price <= 0:
        return None

    try:
        expiries = provider.option_expirations(symbol)
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
        strikes = [
            strike
            for strike in provider.option_strikes(symbol, expiry)
            if abs(strike - current_price) / current_price <= max_moneyness_pct
        ]
        if not strikes:
            return None
        chain = provider.option_chain(
            symbol,
            expiry,
            right=contract_side,
            strikes=strikes,
        )
    except Exception:
        logger.info(
            "selected_contract_missing",
            extra={
                "symbol": symbol,
                "provider": getattr(provider, "name", "unknown"),
                "reason": "provider_error",
                "expiry": expiry,
            },
        )
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
            & (pd.to_numeric(frame["ask"], errors="coerce") >= pd.to_numeric(frame["bid"], errors="coerce"))
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
        "data_source": _contract_data_source(provider, chain, quote),
        "quote_source": _contract_quote_source(chain, quote),
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


def _probability_itm(
    *,
    underlying_price: float,
    strike: float,
    remaining_calendar_days: int,
    sigma: float,
    contract_side: str,
) -> float:
    T = max(1, remaining_calendar_days) / 365.0
    try:
        _, d2 = black_scholes_d1_d2(
            S=underlying_price,
            K=strike,
            T=T,
            r=RISK_FREE_RATE,
            sigma=sigma,
        )
    except Exception:
        return 0.0
    if contract_side == "CALL":
        return float(norm_cdf(d2))
    return float(norm_cdf(-d2))


def _convexity_harvest_point(
    *,
    current_price: float,
    target_underlying: float,
    strike: float,
    premium: float,
    remaining_calendar_days: int,
    sigma: float,
    contract_side: str,
) -> dict[str, object]:
    if contract_side == "CALL":
        upper = max(target_underlying, strike * 1.02, current_price * 1.04)
        upper = min(max(upper, current_price * 1.02), current_price * 1.18)
        points = [current_price + (upper - current_price) * step / 36 for step in range(1, 37)]
    else:
        lower = min(target_underlying, strike * 0.98, current_price * 0.96)
        lower = max(min(lower, current_price * 0.98), current_price * 0.82)
        points = [current_price - (current_price - lower) * step / 36 for step in range(1, 37)]

    best = None
    fallback = None
    for underlying in points:
        option_price = _modeled_exit_price(
            underlying_price=underlying,
            strike=strike,
            remaining_calendar_days=remaining_calendar_days,
            sigma=sigma,
            contract_side=contract_side,
        )
        profit = max(0.0, (option_price - premium) * 100.0)
        profit_pct = ((option_price / premium) - 1.0) * 100.0 if premium else 0.0
        probability = _probability_itm(
            underlying_price=underlying,
            strike=strike,
            remaining_calendar_days=remaining_calendar_days,
            sigma=sigma,
            contract_side=contract_side,
        )
        greeks = calculate_greeks(
            S=underlying,
            K=strike,
            T=max(1, remaining_calendar_days) / 365.0,
            r=RISK_FREE_RATE,
            sigma=sigma,
            option_type=contract_side.lower(),
        )
        theta_daily_pct = (
            abs(float(greeks["theta"])) / max(option_price * 100.0, 1.0) * 100.0
            if option_price > 0
            else None
        )
        point = {
            "underlying": float(underlying),
            "option_price": float(option_price),
            "profit": float(profit),
            "profit_pct": float(profit_pct),
            "probability_itm": float(probability),
            "delta": float(abs(greeks["delta"])),
            "theta_daily_pct": float(theta_daily_pct) if theta_daily_pct is not None else None,
            "hump_reached": probability >= CONVEXITY_PROBABILITY_HUMP,
        }
        fallback = point
        if probability >= CONVEXITY_PROBABILITY_HUMP and profit_pct >= MIN_PROFIT_AT_HUMP_PCT:
            best = point
            break

    return best or fallback or {
        "underlying": float(target_underlying),
        "option_price": 0.0,
        "profit": 0.0,
        "profit_pct": 0.0,
        "probability_itm": 0.0,
        "delta": 0.0,
        "theta_daily_pct": None,
        "hump_reached": False,
    }


def select_optimal_contract(
    provider: MarketDataProvider,
    symbol: str,
    current_price: Optional[float],
    contract_side: str,
    hold_days: int,
    target_move_pct: float,
    stop_move_pct: float,
    fallback_iv_pct: Optional[float] = None,
    fallback_hv_pct: Optional[float] = None,
    min_dte: int = 30,
    max_dte: int = 90,
    max_expiries: Optional[int] = None,
) -> Optional[dict[str, object]]:
    if provider is None or current_price is None or current_price <= 0:
        return None

    try:
        expiries = provider.option_expirations(symbol)
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
    if max_expiries is not None and max_expiries > 0:
        expiry_candidates = sorted(expiry_candidates, key=lambda item: abs(item[1] - 60))[:max_expiries]

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
            strikes = provider.option_strikes(symbol, expiry)
            if contract_side == "CALL":
                strikes = [s for s in strikes if current_price * 0.96 <= s <= current_price * 1.10]
            else:
                strikes = [s for s in strikes if current_price * 0.90 <= s <= current_price * 1.04]
            if not strikes:
                logger.info(
                    "selected_contract_missing",
                    extra={
                        "symbol": symbol,
                        "provider": getattr(provider, "name", "unknown"),
                        "reason": "no_strikes",
                        "expiry": expiry,
                    },
                )
                continue
            chain = provider.option_chain(
                symbol,
                expiry,
                right=contract_side,
                strikes=strikes,
            )
        except Exception:
            logger.info(
                "selected_contract_missing",
                extra={
                    "symbol": symbol,
                    "provider": getattr(provider, "name", "unknown"),
                    "reason": "provider_error",
                    "expiry": expiry,
                },
            )
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
            harvest = _convexity_harvest_point(
                current_price=current_price,
                target_underlying=target_underlying,
                strike=strike,
                premium=float(premium),
                remaining_calendar_days=remaining_calendar_days,
                sigma=sigma,
                contract_side=contract_side,
            )

            plan_profit = max(0.0, (target_option - premium) * 100.0)
            convexity_profit = float(harvest["profit"])
            planned_loss = max(0.0, (premium - stop_option) * 100.0)
            max_loss = premium * 100.0
            risk = max(planned_loss, premium * 100.0 * 0.25, 1.0)
            reward_risk = convexity_profit / risk
            profit_pct = ((target_option / premium) - 1.0) * 100.0 if premium else 0.0
            convexity_profit_pct = float(harvest["profit_pct"])
            stop_loss_pct = max(0.0, (1.0 - (stop_option / premium)) * 100.0) if premium else 0.0

            open_interest = int(quote.get("open_interest") or 0)
            volume = int(quote.get("volume") or 0)
            liquidity_score = min(2.0, log10(open_interest + volume + 10) / 2.0)
            spread_penalty = (float(spread_pct) / 18.0) if isinstance(spread_pct, (int, float)) else 1.2
            dte_penalty = abs(dte - 60) / 90.0
            moneyness_penalty = abs(strike - current_price) / current_price

            score = (
                reward_risk * 2.0
                + min(2.5, convexity_profit_pct / 45.0)
                + (0.75 if harvest.get("hump_reached") else -0.5)
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
                "data_source": _contract_data_source(provider, chain, quote),
                "quote_source": _contract_quote_source(chain, quote),
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
                "convexity_exit_underlying": float(harvest["underlying"]),
                "convexity_exit_option_price": float(harvest["option_price"]),
                "convexity_profit": float(harvest["profit"]),
                "convexity_profit_pct": float(harvest["profit_pct"]),
                "convexity_probability_itm": float(harvest["probability_itm"]),
                "convexity_delta": float(harvest["delta"]),
                "convexity_theta_daily_pct": harvest.get("theta_daily_pct"),
                "convexity_hump_reached": bool(harvest["hump_reached"]),
                "convexity_probability_hump": CONVEXITY_PROBABILITY_HUMP,
                "planned_loss": float(planned_loss),
                "planned_loss_pct": float(stop_loss_pct),
                "max_loss": float(max_loss),
                "theoretical_max_profit": float(theoretical_max_profit) if theoretical_max_profit is not None else None,
                "max_profit": float(harvest["profit"]),
                "max_profit_definition": "convexity_harvest_probability_hump",
                "reward_risk": float(reward_risk),
                "remaining_dte_after_hold": remaining_calendar_days,
                "model_volatility": float(sigma),
            }

    return best
