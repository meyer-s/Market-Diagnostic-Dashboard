from __future__ import annotations

from datetime import date, datetime
import math
from typing import Dict, Optional

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.stock_projection import compute_historical_volatility
from app.models.option_positions import OptionPosition
from app.utils.db_helpers import get_db_session

router = APIRouter(prefix="/secret/options", tags=["SecretOptions"])


class OptionPositionCreate(BaseModel):
    trade_date: str
    account: Optional[str] = None
    action: Optional[str] = None
    contracts: int
    symbol: str
    expiration: str
    strike: float
    option_type: str
    fill_price: float
    total_cost: float
    underlying_at_entry: Optional[float] = None
    estimated_delta: Optional[float] = None
    shares_equivalent: Optional[int] = None
    dte_at_entry: Optional[int] = None
    underlying_reference: Optional[float] = None


def _norm_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _norm_pdf(value: float) -> float:
    return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * value * value)


def _black_scholes_greeks(
    spot: float,
    strike: float,
    time_to_expiry: float,
    volatility: float,
    option_type: str,
    risk_free_rate: float = 0.045,
) -> Dict[str, float]:
    if spot <= 0 or strike <= 0 or time_to_expiry <= 0 or volatility <= 0:
        return {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}

    sqrt_t = math.sqrt(time_to_expiry)
    d1 = (math.log(spot / strike) + (risk_free_rate + 0.5 * volatility * volatility) * time_to_expiry) / (
        volatility * sqrt_t
    )
    d2 = d1 - volatility * sqrt_t
    pdf = _norm_pdf(d1)

    if option_type.lower() == "put":
        delta = _norm_cdf(d1) - 1.0
        theta = (
            -spot * pdf * volatility / (2.0 * sqrt_t)
            + risk_free_rate * strike * math.exp(-risk_free_rate * time_to_expiry) * _norm_cdf(-d2)
        )
    else:
        delta = _norm_cdf(d1)
        theta = (
            -spot * pdf * volatility / (2.0 * sqrt_t)
            - risk_free_rate * strike * math.exp(-risk_free_rate * time_to_expiry) * _norm_cdf(d2)
        )

    gamma = pdf / (spot * volatility * sqrt_t)
    vega = spot * pdf * sqrt_t

    # Theta is per year; convert to per-day.
    theta_per_day = theta / 365.0
    return {"delta": delta, "gamma": gamma, "theta": theta_per_day, "vega": vega}


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _seed_positions(db) -> None:
    if db.query(OptionPosition).count() > 0:
        return
    seed = [
        OptionPosition(
            trade_date=_parse_date("2026-01-22"),
            account="ACTIVE TRADING ***9557",
            action="Buy to Open",
            contracts=5,
            symbol="KTOS",
            expiration=_parse_date("2026-03-20"),
            strike=125.0,
            option_type="call",
            fill_price=8.83,
            total_cost=4418.37,
            underlying_at_entry=113.85,
            estimated_delta=0.35,
            shares_equivalent=500,
            dte_at_entry=56,
            underlying_reference=130.50,
        ),
        OptionPosition(
            trade_date=_parse_date("2026-01-22"),
            account="ROTH IRA ***9197",
            action="Buy to Open",
            contracts=5,
            symbol="NEOG",
            expiration=_parse_date("2026-03-20"),
            strike=10.0,
            option_type="call",
            fill_price=0.76,
            total_cost=383.37,
            underlying_at_entry=9.93,
            estimated_delta=0.4,
            shares_equivalent=500,
            dte_at_entry=56,
            underlying_reference=11.25,
        ),
        OptionPosition(
            trade_date=_parse_date("2026-01-22"),
            account="ACTIVE TRADING ***9557",
            action="Buy to Open",
            contracts=10,
            symbol="ERAS",
            expiration=_parse_date("2026-02-20"),
            strike=7.5,
            option_type="call",
            fill_price=3.40,
            total_cost=3406.74,
            underlying_at_entry=10.29,
            estimated_delta=0.45,
            shares_equivalent=1000,
            dte_at_entry=28,
            underlying_reference=9.85,
        ),
        OptionPosition(
            trade_date=_parse_date("2026-01-22"),
            account="ACTIVE TRADING ***9557",
            action="Buy to Open",
            contracts=5,
            symbol="NKE",
            expiration=_parse_date("2026-02-20"),
            strike=65.0,
            option_type="call",
            fill_price=2.86,
            total_cost=1433.37,
            underlying_at_entry=65.46,
            estimated_delta=0.3,
            shares_equivalent=500,
            dte_at_entry=28,
            underlying_reference=68.40,
        ),
    ]
    db.add_all(seed)
    db.commit()


def _resolve_option_row(stock: yf.Ticker, expiration: date, option_type: str, strike: float) -> Optional[pd.Series]:
    try:
        chain = stock.option_chain(expiration.strftime("%Y-%m-%d"))
    except Exception:
        return None
    frame = chain.calls if option_type.lower() == "call" else chain.puts
    if frame is None or frame.empty or "strike" not in frame.columns:
        return None
    frame = frame.dropna(subset=["strike"])
    if frame.empty:
        return None
    frame = frame.copy()
    frame["strike_delta"] = (frame["strike"] - strike).abs()
    row = frame.sort_values("strike_delta").iloc[0]
    return row


def _market_data_for_symbol(symbol: str) -> Dict[str, Optional[float]]:
    stock = yf.Ticker(symbol)
    history = stock.history(period="5d")
    if history is None or history.empty or "Close" not in history.columns:
        return {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "last_updated": datetime.utcnow().isoformat(),
        }
    close = history["Close"].dropna()
    if close.empty:
        return {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "last_updated": datetime.utcnow().isoformat(),
        }
    current = float(close.iloc[-1])
    previous = float(close.iloc[-2]) if len(close) >= 2 else current
    change = current - previous
    change_pct = (change / previous) * 100 if previous else None
    return {
        "current_price": current,
        "previous_close": previous,
        "change": change,
        "change_percent": change_pct,
        "last_updated": datetime.utcnow().isoformat(),
    }


def _compute_position_metrics(position: OptionPosition) -> Dict[str, object]:
    stock = yf.Ticker(position.symbol)
    market = _market_data_for_symbol(position.symbol)

    option_row = _resolve_option_row(stock, position.expiration, position.option_type, position.strike)
    implied_vol = None
    option_price = None
    option_price_source = None
    if option_row is not None:
        implied_vol = option_row.get("impliedVolatility")
        if pd.notna(implied_vol):
            implied_vol = float(implied_vol)
        last_price = option_row.get("lastPrice")
        bid = option_row.get("bid")
        ask = option_row.get("ask")
        if pd.notna(last_price) and last_price > 0:
            option_price = float(last_price)
            option_price_source = "last"
        elif pd.notna(bid) and pd.notna(ask):
            option_price = float(bid + ask) / 2.0
            option_price_source = "mid"

    hist = stock.history(period="6mo")
    hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
    volatility = implied_vol if implied_vol is not None else hv30
    volatility_source = "implied" if implied_vol is not None else "historical" if hv30 is not None else "none"

    dte = max((position.expiration - date.today()).days, 0)
    time_to_expiry = max(dte, 0) / 365.0
    spot = market.get("current_price") or position.underlying_reference or position.underlying_at_entry
    greeks = None
    if spot and volatility and time_to_expiry > 0:
        greeks = _black_scholes_greeks(
            spot,
            position.strike,
            time_to_expiry,
            volatility,
            position.option_type,
        )

    pnl_source = None
    pnl_dollar = None
    pnl_percent = None
    if option_price is not None:
        pnl_source = "option_price"
        pnl_dollar = (option_price - position.fill_price) * position.contracts * 100
    elif greeks and position.underlying_at_entry and spot:
        pnl_source = "delta_estimate"
        estimated_price = position.fill_price + greeks["delta"] * (spot - position.underlying_at_entry)
        pnl_dollar = (estimated_price - position.fill_price) * position.contracts * 100

    if pnl_dollar is not None and position.total_cost:
        pnl_percent = pnl_dollar / position.total_cost * 100

    return {
        "market": {
            **market,
            "implied_volatility": implied_vol,
        },
        "option_price": option_price,
        "option_price_source": option_price_source,
        "volatility": volatility,
        "volatility_source": volatility_source,
        "dte": dte,
        "greeks": greeks,
        "pnl": {
            "dollar": pnl_dollar,
            "percent": pnl_percent,
            "source": pnl_source,
        },
    }


def _serialize_position(position: OptionPosition) -> Dict[str, object]:
    return {
        "id": position.id,
        "trade_date": position.trade_date.isoformat(),
        "account": position.account,
        "action": position.action,
        "contracts": position.contracts,
        "symbol": position.symbol,
        "expiration": position.expiration.isoformat(),
        "strike": position.strike,
        "option_type": position.option_type,
        "fill_price": position.fill_price,
        "total_cost": position.total_cost,
        "underlying_at_entry": position.underlying_at_entry,
        "estimated_delta": position.estimated_delta,
        "shares_equivalent": position.shares_equivalent,
        "dte_at_entry": position.dte_at_entry,
        "underlying_reference": position.underlying_reference,
    }


@router.get("/positions")
def get_positions():
    with get_db_session() as db:
        _seed_positions(db)
        positions = db.query(OptionPosition).order_by(OptionPosition.trade_date.desc()).all()
        payload = []
        for position in positions:
            metrics = _compute_position_metrics(position)
            payload.append(
                {
                    "position": _serialize_position(position),
                    "metrics": metrics,
                }
            )
        return {"positions": payload}


@router.post("/positions")
def create_position(payload: OptionPositionCreate):
    with get_db_session() as db:
        position = OptionPosition(
            trade_date=_parse_date(payload.trade_date),
            account=payload.account,
            action=payload.action,
            contracts=payload.contracts,
            symbol=payload.symbol.upper(),
            expiration=_parse_date(payload.expiration),
            strike=payload.strike,
            option_type=payload.option_type.lower(),
            fill_price=payload.fill_price,
            total_cost=payload.total_cost,
            underlying_at_entry=payload.underlying_at_entry,
            estimated_delta=payload.estimated_delta,
            shares_equivalent=payload.shares_equivalent,
            dte_at_entry=payload.dte_at_entry,
            underlying_reference=payload.underlying_reference,
        )
        db.add(position)
        db.commit()
        db.refresh(position)
        return {"position": _serialize_position(position)}


@router.get("/greeks/{position_id}")
def get_position_greeks(
    position_id: int,
    price_range_pct: float = Query(0.3, ge=0.05, le=1.0),
    time_range_days: int = Query(60, ge=5, le=365),
):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        metrics = _compute_position_metrics(position)
        spot = metrics["market"].get("current_price") or position.underlying_reference or position.underlying_at_entry
        volatility = metrics.get("volatility")
        dte = metrics.get("dte") or 0
        if not spot or not volatility or dte <= 0:
            return {"price_curve": [], "theta_curve": []}

        lower = spot * (1 - price_range_pct)
        upper = spot * (1 + price_range_pct)
        steps = 31
        price_curve = []
        for idx in range(steps):
            price = lower + (upper - lower) * idx / (steps - 1)
            greeks = _black_scholes_greeks(
                price,
                position.strike,
                dte / 365.0,
                volatility,
                position.option_type,
            )
            price_curve.append(
                {
                    "price": round(price, 2),
                    "delta": greeks["delta"],
                    "gamma": greeks["gamma"],
                }
            )

        max_days = min(time_range_days, max(dte, 1))
        theta_curve = []
        for day in range(1, max_days + 1):
            greeks = _black_scholes_greeks(
                spot,
                position.strike,
                day / 365.0,
                volatility,
                position.option_type,
            )
            theta_curve.append({"days": day, "theta": greeks["theta"]})

        return {
            "price_curve": price_curve,
            "theta_curve": theta_curve,
        }
