from __future__ import annotations

from datetime import date, datetime
from typing import Dict, Optional

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
import traceback
from pydantic import BaseModel

from app.api.stock_projection import compute_historical_volatility
from app.models.option_positions import OptionPosition
from app.models.closed_positions import ClosedPosition
from app.utils.db_helpers import get_db_session
from app.services.greeks_calculator import (
    calculate_greeks,
    implied_volatility,
    generate_delta_gamma_curve,
    generate_theta_curve
)

router = APIRouter(prefix="/secret/options", tags=["SecretOptions"])

# Risk-free rate configuration (can be adjusted based on current T-bill rates)
RISK_FREE_RATE = 0.0425  # 4.25% - adjust as needed


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


class ClosePositionRequest(BaseModel):
    exit_price: float
    close_date: Optional[str] = None
    notes: Optional[str] = None


# Old Greeks functions removed - now using greeks_calculator module


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
    iv_source = None
    
    if option_row is not None:
        # Try to get IV from option chain
        implied_vol = option_row.get("impliedVolatility")
        if pd.notna(implied_vol):
            implied_vol = float(implied_vol)
            iv_source = "chain"
        
        # Get option price (prefer mid, fallback to last)
        last_price = option_row.get("lastPrice")
        bid = option_row.get("bid")
        ask = option_row.get("ask")
        
        if pd.notna(bid) and pd.notna(ask) and bid > 0 and ask > 0:
            option_price = float(bid + ask) / 2.0
            option_price_source = "mid"
        elif pd.notna(last_price) and last_price > 0:
            option_price = float(last_price)
            option_price_source = "last"

    # Get historical volatility as fallback
    hist = stock.history(period="6mo")
    hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
    
    # Determine spot price
    spot = market.get("current_price") or position.underlying_reference or position.underlying_at_entry
    
    # Determine volatility to use
    volatility = None
    
    # Priority 1: Chain IV (but only if realistic - between 10% and 500%)
    # Below 10% is often bad data from yfinance
    if implied_vol is not None and 0.10 <= implied_vol <= 5.0:
        volatility = implied_vol
        iv_source = "chain"
    # Priority 2: Invert from option price if available
    elif option_price is not None and spot and spot > 0:
        dte = max((position.expiration - date.today()).days, 0)
        T = max(dte, 0) / 365.0
        if T > 0:
            inverted_iv = implied_volatility(
                option_price,
                spot,
                position.strike,
                T,
                RISK_FREE_RATE,
                position.option_type
            )
            if inverted_iv is not None:
                volatility = inverted_iv
                iv_source = f"inverted ({option_price_source})"
    
    # Priority 3: Historical volatility
    if volatility is None and hv30 is not None:
        volatility = hv30
        iv_source = "historical"
    
    # If still no volatility, try a default
    if volatility is None:
        volatility = 0.30  # 30% default
        iv_source = "default"
    
    volatility_source = iv_source

    dte = max((position.expiration - date.today()).days, 0)
    time_to_expiry = max(dte, 0) / 365.0
    
    greeks = None
    if spot and volatility and time_to_expiry > 0:
        greeks = calculate_greeks(
            spot,
            position.strike,
            time_to_expiry,
            RISK_FREE_RATE,
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
            "implied_volatility": implied_vol,  # Original chain IV if available
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
    try:
        with get_db_session() as db:
            _seed_positions(db)
            positions = db.query(OptionPosition).order_by(OptionPosition.trade_date.desc()).all()
            payload = []
            for position in positions:
                try:
                    metrics = _compute_position_metrics(position)
                except Exception as perr:
                    # Log per-position errors but continue returning other positions
                    traceback.print_exc()
                    metrics = {"error": str(perr)}
                payload.append(
                    {
                        "position": _serialize_position(position),
                        "metrics": metrics,
                    }
                )
            return {"positions": payload}
    except Exception as exc:
        # Log traceback to server logs for debugging
        traceback.print_exc()
        # Return a useful message to the caller to aid debugging (temporary)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}")


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
    """
    Get detailed Greeks curves for a position.
    
    Returns:
        - price_curve: delta and gamma vs underlying price
        - theta_curve: theta vs days to expiry
        - current_greeks: Greeks at current spot price
        - model_info: Information about the model and parameters used
    """
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        metrics = _compute_position_metrics(position)
        spot = metrics["market"].get("current_price") or position.underlying_reference or position.underlying_at_entry
        volatility = metrics.get("volatility")
        dte = metrics.get("dte") or 0
        
        if not spot or not volatility or dte <= 0:
            return {
                "price_curve": [],
                "theta_curve": [],
                "current_greeks": None,
                "model_info": {
                    "error": "Insufficient data for Greeks calculation"
                }
            }

        T = dte / 365.0
        
        # Generate price curves (delta and gamma)
        price_curve = generate_delta_gamma_curve(
            K=position.strike,
            T=T,
            r=RISK_FREE_RATE,
            sigma=volatility,
            option_type=position.option_type,
            current_price=spot,
            price_range_pct=price_range_pct,
            num_points=51
        )
        
        # Generate theta curve (from current DTE down to 1 day)
        max_days = min(time_range_days, max(dte, 1))
        theta_curve = generate_theta_curve(
            S=spot,
            K=position.strike,
            r=RISK_FREE_RATE,
            sigma=volatility,
            option_type=position.option_type,
            current_dte=max_days,
            min_days=1
        )
        
        # Current Greeks
        current_greeks = metrics.get("greeks")

        return {
            "price_curve": price_curve,
            "theta_curve": theta_curve,
            "current_greeks": current_greeks,
            "model_info": {
                "model": "Black-Scholes (European)",
                "risk_free_rate": RISK_FREE_RATE,
                "volatility": volatility,
                "volatility_source": metrics.get("volatility_source"),
                "spot_price": spot,
                "dte": dte,
                "units": {
                    "delta": "per 1 share",
                    "gamma": "per $1 move per share",
                    "theta": "per day per contract (100 shares)",
                    "vega": "per 1 vol point per contract"
                }
            }
        }


@router.delete("/positions/{position_id}")
def close_position(position_id: int, request: ClosePositionRequest):
    """
    Close a position by moving it to closed_position table and deleting from active positions.
    Calculates P/L and tracks historical performance.
    """
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")
        
        # Calculate P/L
        total_proceeds = request.exit_price * position.contracts * 100
        dollar_pnl = total_proceeds - position.total_cost
        percent_pnl = (dollar_pnl / position.total_cost) * 100 if position.total_cost else 0
        
        # Get current underlying price
        market = _market_data_for_symbol(position.symbol)
        underlying_at_exit = market.get("current_price")
        
        # Create closed position record
        closed = ClosedPosition(
            symbol=position.symbol,
            option_type=position.option_type,
            strike=position.strike,
            expiration=position.expiration,
            contracts=position.contracts,
            trade_date=position.trade_date,
            fill_price=position.fill_price,
            total_cost=position.total_cost,
            underlying_at_entry=position.underlying_at_entry,
            close_date=_parse_date(request.close_date) if request.close_date else date.today(),
            exit_price=request.exit_price,
            total_proceeds=total_proceeds,
            underlying_at_exit=underlying_at_exit,
            dollar_pnl=dollar_pnl,
            percent_pnl=percent_pnl,
            account=position.account,
            notes=request.notes
        )
        db.add(closed)
        
        # Delete active position
        db.delete(position)
        db.commit()
        
        return {
            "message": "Position closed successfully",
            "pnl": {
                "dollar": dollar_pnl,
                "percent": percent_pnl,
                "total_proceeds": total_proceeds
            }
        }


@router.get("/closed-positions")
def get_closed_positions(
    limit: int = Query(100, ge=1, le=500),
    symbol: Optional[str] = None
):
    """
    Get closed positions history with P/L information.
    """
    with get_db_session() as db:
        query = db.query(ClosedPosition).order_by(ClosedPosition.close_date.desc())
        
        if symbol:
            query = query.filter(ClosedPosition.symbol == symbol.upper())
        
        closed_positions = query.limit(limit).all()
        
        results = []
        for pos in closed_positions:
            results.append({
                "id": pos.id,
                "symbol": pos.symbol,
                "option_type": pos.option_type,
                "strike": pos.strike,
                "expiration": pos.expiration.isoformat(),
                "contracts": pos.contracts,
                "trade_date": pos.trade_date.isoformat(),
                "close_date": pos.close_date.isoformat(),
                "fill_price": pos.fill_price,
                "exit_price": pos.exit_price,
                "total_cost": pos.total_cost,
                "total_proceeds": pos.total_proceeds,
                "dollar_pnl": pos.dollar_pnl,
                "percent_pnl": pos.percent_pnl,
                "underlying_at_entry": pos.underlying_at_entry,
                "underlying_at_exit": pos.underlying_at_exit,
                "account": pos.account,
                "notes": pos.notes
            })
        
        # Calculate summary stats
        total_pnl = sum(pos.dollar_pnl for pos in closed_positions)
        winning_trades = sum(1 for pos in closed_positions if pos.dollar_pnl > 0)
        total_trades = len(closed_positions)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        return {
            "closed_positions": results,
            "summary": {
                "total_pnl": total_pnl,
                "total_trades": total_trades,
                "winning_trades": winning_trades,
                "losing_trades": total_trades - winning_trades,
                "win_rate": win_rate
            }
        }
