from __future__ import annotations

from datetime import date, datetime, time, timedelta
import math
from numbers import Real
import re
from typing import Any, Dict, Optional

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
import traceback
from pydantic import BaseModel

from app.api.stock_projection import compute_historical_volatility
from app.models.option_positions import OptionPosition
from app.models.closed_positions import ClosedPosition
from app.models.options_alerts import OptionAlertEvent
from app.services.market_data.factory import get_market_data_provider
from app.services.market_data.provider import MarketDataProvider
from app.services.options_quotes import option_quote_from_row
from app.utils.db_helpers import get_db_session
from app.services.greeks_calculator import (
    black_scholes_price,
    calculate_greeks,
    implied_volatility,
    generate_delta_gamma_curve,
    generate_theta_curve
)

router = APIRouter(prefix="/secret/options", tags=["SecretOptions"])

# Risk-free rate configuration (can be adjusted based on current T-bill rates)
RISK_FREE_RATE = 0.0425  # 4.25% - adjust as needed


def _is_finite_number(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _json_safe(value: Any) -> Any:
    """Convert non-finite live-market values to JSON-safe nulls."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, Real):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


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
    source_event_id: Optional[int] = None


class ClosePositionRequest(BaseModel):
    exit_price: float
    close_date: Optional[str] = None
    notes: Optional[str] = None


# Old Greeks functions removed - now using greeks_calculator module


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_SETUP_RE = re.compile(r"Setup\s*:\s*1x ATM\s+(CALL|PUT)", re.IGNORECASE)
_CONTRACT_RE = re.compile(
    r"Contract\s*:\s*(\d{4}-\d{2}-\d{2})\s+([0-9]+(?:\.[0-9]+)?)\s+(CALL|PUT)",
    re.IGNORECASE,
)
_HOLD_RE = re.compile(r"Hold\s*:\s*(\d+)\s*trading\s*days", re.IGNORECASE)
_PREMIUM_RE = re.compile(r"Est\s+Prem\s*:\s*\$\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)


def _strip_ansi(value: Optional[str]) -> str:
    if not value:
        return ""
    return _ANSI_RE.sub("", value)


def _is_exceptional_training_event(event: OptionAlertEvent) -> bool:
    if event.iv_percentile is None:
        return False
    iv_percentile = float(event.iv_percentile)
    spread_ok = (
        event.iv30 is not None
        and event.hv30 is not None
        and float(event.iv30) - float(event.hv30) <= -4.0
    )
    edr_ok = event.avg_edr is not None and float(event.avg_edr) <= 35.0
    return iv_percentile <= 5.0 or (iv_percentile <= 10.0 and (spread_ok or edr_ok))


def _extract_training_recipe(message: Optional[str]) -> Dict[str, Optional[float | int | str]]:
    plain = _strip_ansi(message)
    setup_match = _SETUP_RE.search(plain)
    contract_match = _CONTRACT_RE.search(plain)
    hold_match = _HOLD_RE.search(plain)
    premium_match = _PREMIUM_RE.search(plain)

    option_type = setup_match.group(1).lower() if setup_match else None
    contract_expiry = contract_match.group(1) if contract_match else None
    contract_strike = float(contract_match.group(2)) if contract_match else None
    contract_type = contract_match.group(3).lower() if contract_match else None
    if option_type is None:
        option_type = contract_type
    hold_days = int(hold_match.group(1)) if hold_match else None
    est_premium = float(premium_match.group(1)) if premium_match else None

    return {
        "option_type": option_type,
        "contract_expiry": contract_expiry,
        "contract_strike": contract_strike,
        "hold_days": hold_days,
        "est_premium": est_premium,
    }


def _compute_training_outcome(event: OptionAlertEvent) -> Optional[Dict[str, object]]:
    recipe = _extract_training_recipe(event.message)
    option_type = event.selected_option_type or recipe.get("option_type")
    hold_days = recipe.get("hold_days")

    if not option_type or not isinstance(hold_days, int) or hold_days <= 0:
        return None

    trigger_day = event.triggered_at.date() if event.triggered_at else date.today()
    start_day = trigger_day - timedelta(days=7)
    # Use completed sessions only so outcomes do not drift intraday.
    # yfinance `end` is exclusive, so `end=today` includes up to yesterday.
    end_day = date.today()

    stock = yf.Ticker(event.symbol)
    history = stock.history(start=start_day.isoformat(), end=end_day.isoformat())
    if history is None or history.empty or "Close" not in history.columns:
        return None

    close = history["Close"].dropna()
    if close.empty:
        return None

    index = pd.to_datetime(close.index)
    if getattr(index, "tz", None) is not None:
        index = index.tz_localize(None)
    daily = pd.DataFrame({"close": close.to_numpy()}, index=index.normalize())
    daily = daily[~daily.index.duplicated(keep="last")]

    entry_candidates = daily.index[daily.index.date >= trigger_day]
    if len(entry_candidates) == 0:
        fallback_entry_price = float(close.iloc[-1])
        recommended_exit_date = trigger_day + timedelta(days=hold_days)
        elapsed_calendar_days = (date.today() - trigger_day).days
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "hold_days": hold_days,
            "entry_date": trigger_day.isoformat(),
            "exit_date": None,
            "entry_underlying": fallback_entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": event.selected_premium if event.selected_premium is not None else recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    entry_date = entry_candidates[0]
    entry_idx = daily.index.get_loc(entry_date)
    entry_price = float(daily.iloc[entry_idx]["close"])

    recommended_exit_date = entry_date.date() + timedelta(days=hold_days)
    elapsed_calendar_days = (date.today() - entry_date.date()).days

    # Real-world exit model for the training modal:
    # once the hold window has passed, settle on the most recent trading close
    # on or before the recommended calendar exit date. This is deterministic
    # and does not change on subsequent refreshes.
    if date.today() < recommended_exit_date:
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "hold_days": hold_days,
            "entry_date": entry_date.date().isoformat(),
            "exit_date": None,
            "entry_underlying": entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    eligible_exit_dates = daily.index[
        (daily.index.date >= entry_date.date())
        & (daily.index.date <= recommended_exit_date)
    ]
    if len(eligible_exit_dates) == 0:
        return {
            "event_id": event.id,
            "symbol": event.symbol,
            "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
            "option_type": option_type,
            "hold_days": hold_days,
            "entry_date": entry_date.date().isoformat(),
            "exit_date": None,
            "entry_underlying": entry_price,
            "exit_underlying": None,
            "underlying_directional_return_pct": None,
            "entry_option_price_est": recipe.get("est_premium"),
            "exit_option_price_est": None,
            "option_return_pct_est": None,
            "option_pnl_per_contract_est": None,
            "recommended_exit_date": recommended_exit_date.isoformat(),
            "days_elapsed_calendar": elapsed_calendar_days,
            "status": "pending",
        }

    exit_date = eligible_exit_dates[-1]
    exit_idx = daily.index.get_loc(exit_date)
    realized_hold_days = (exit_date.date() - entry_date.date()).days

    exit_price = float(daily.iloc[exit_idx]["close"])

    directional_multiplier = 1.0 if option_type == "call" else -1.0
    underlying_directional_return_pct = ((exit_price - entry_price) / entry_price) * 100.0 * directional_multiplier

    sigma = float(event.iv30) / 100.0 if event.iv30 is not None else None
    if sigma is None or sigma <= 0:
        sigma = float(event.hv30) / 100.0 if event.hv30 is not None else 0.30
    sigma = max(0.08, min(2.0, sigma))

    est_premium_raw = event.selected_premium if event.selected_premium is not None else recipe.get("est_premium")
    if isinstance(est_premium_raw, (int, float)) and est_premium_raw > 0:
        entry_option_price = float(est_premium_raw)
    else:
        entry_option_price = max(0.35, entry_price * 0.012)

    contract_strike_raw = event.selected_strike if event.selected_strike is not None else recipe.get("contract_strike")
    strike = (
        float(contract_strike_raw)
        if isinstance(contract_strike_raw, (int, float)) and contract_strike_raw > 0
        else entry_price
    )

    contract_expiry_raw = event.selected_expiry or recipe.get("contract_expiry")
    contract_expiry = _parse_date(str(contract_expiry_raw)) if contract_expiry_raw else None
    if contract_expiry:
        remaining_dte = max(1, (contract_expiry - exit_date.date()).days)
    else:
        initial_dte = max(30, hold_days + 14)
        remaining_dte = max(1, initial_dte - hold_days)

    exit_option_price = black_scholes_price(
        S=exit_price,
        K=strike,
        T=remaining_dte / 365.0,
        r=RISK_FREE_RATE,
        sigma=sigma,
        option_type=option_type,
    )
    option_return_pct = ((exit_option_price - entry_option_price) / entry_option_price) * 100.0 if entry_option_price else None
    option_pnl_contract = (exit_option_price - entry_option_price) * 100.0

    return {
        "event_id": event.id,
        "symbol": event.symbol,
        "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
        "option_type": option_type,
        "contract_expiry": contract_expiry.isoformat() if contract_expiry else None,
        "contract_strike": strike,
        "hold_days": hold_days,
        "entry_date": entry_date.date().isoformat(),
        "exit_date": exit_date.date().isoformat(),
        "entry_underlying": entry_price,
        "exit_underlying": exit_price,
        "underlying_directional_return_pct": underlying_directional_return_pct,
        "entry_option_price_est": entry_option_price,
        "exit_option_price_est": exit_option_price,
        "option_return_pct_est": option_return_pct,
        "option_pnl_per_contract_est": option_pnl_contract,
        "recommended_exit_date": recommended_exit_date.isoformat(),
        "hold_days_realized": realized_hold_days,
        "days_elapsed_calendar": elapsed_calendar_days,
        "status": "matured",
    }


def _event_confidence_for_trade(trade_date: date, triggered_at: datetime) -> float:
    day_delta = (trade_date - triggered_at.date()).days
    if day_delta == 0:
        return 1.0
    if day_delta == 1:
        return 0.92
    if day_delta == 2:
        return 0.84
    if 3 <= day_delta <= 7:
        return max(0.55, 0.82 - 0.06 * (day_delta - 2))
    if -1 <= day_delta < 0:
        return 0.6
    return 0.35


def _resolve_signal_attribution(
    db,
    symbol: str,
    trade_date: date,
    explicit_event_id: Optional[int] = None,
) -> Dict[str, object]:
    if explicit_event_id is not None:
        event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == explicit_event_id).first()
        if event and event.symbol.upper() == symbol.upper() and event.triggered_at:
            confidence = _event_confidence_for_trade(trade_date, event.triggered_at)
            return {
                "source_event_id": event.id,
                "source_triggered_at": event.triggered_at,
                "source_match_method": "manual_event_id",
                "source_match_confidence": confidence,
                "source_match_notes": "Manually linked by event id.",
            }

    symbol_upper = symbol.upper()
    window_start = datetime.combine(trade_date - timedelta(days=2), time.min)
    window_end = datetime.combine(trade_date + timedelta(days=1), time.max)
    candidates = (
        db.query(OptionAlertEvent)
        .filter(
            OptionAlertEvent.symbol == symbol_upper,
            OptionAlertEvent.triggered_at.isnot(None),
            OptionAlertEvent.triggered_at >= window_start,
            OptionAlertEvent.triggered_at <= window_end,
        )
        .order_by(OptionAlertEvent.triggered_at.desc())
        .all()
    )

    method = "symbol+trade_date_window"
    if not candidates:
        fallback_start = datetime.combine(trade_date - timedelta(days=21), time.min)
        candidates = (
            db.query(OptionAlertEvent)
            .filter(
                OptionAlertEvent.symbol == symbol_upper,
                OptionAlertEvent.triggered_at.isnot(None),
                OptionAlertEvent.triggered_at >= fallback_start,
                OptionAlertEvent.triggered_at <= datetime.combine(trade_date, time.max),
            )
            .order_by(OptionAlertEvent.triggered_at.desc())
            .all()
        )
        method = "symbol+fallback_21d"
    if not candidates:
        return {
            "source_event_id": None,
            "source_triggered_at": None,
            "source_match_method": "no_match",
            "source_match_confidence": 0.0,
            "source_match_notes": "No matching sweep event found for symbol/date.",
        }

    best = max(
        candidates,
        key=lambda event: _event_confidence_for_trade(trade_date, event.triggered_at),
    )
    confidence = _event_confidence_for_trade(trade_date, best.triggered_at)
    day_delta = (trade_date - best.triggered_at.date()).days

    return {
        "source_event_id": best.id,
        "source_triggered_at": best.triggered_at,
        "source_match_method": method,
        "source_match_confidence": confidence,
        "source_match_notes": f"Matched by symbol and proximity ({day_delta} day delta).",
    }


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


def _resolve_option_row(
    provider: MarketDataProvider,
    symbol: str,
    expiration: date,
    option_type: str,
    strike: float,
) -> Optional[pd.Series]:
    try:
        side = "CALL" if option_type.lower() == "call" else "PUT"
        try:
            available_strikes = provider.option_strikes(symbol, expiration.isoformat())
            strikes = sorted(available_strikes, key=lambda value: abs(float(value) - float(strike)))[:3]
        except Exception:
            strikes = [float(strike)]
        chain = provider.option_chain(
            symbol,
            expiration.isoformat(),
            right=side,
            strikes=strikes or [float(strike)],
        )
    except Exception:
        return None
    frame = chain.calls if side == "CALL" else chain.puts
    if frame is None or frame.empty or "strike" not in frame.columns:
        return None
    frame = frame.dropna(subset=["strike"])
    if frame.empty:
        return None
    frame = frame.copy()
    frame["strike_delta"] = (frame["strike"] - strike).abs()
    row = frame.sort_values("strike_delta").iloc[0]
    return row


def _quote_payload_from_row(row: Optional[pd.Series]) -> Dict[str, object]:
    quote = option_quote_from_row(row)
    return {
        "bid": quote.get("bid"),
        "ask": quote.get("ask"),
        "last": quote.get("last"),
        "mid": quote.get("mid"),
        "spread": quote.get("spread"),
        "spread_pct": quote.get("spread_pct"),
        "volume": quote.get("volume"),
        "open_interest": quote.get("open_interest"),
        "implied_volatility": quote.get("implied_volatility"),
        "last_trade_at": quote.get("last_trade_date"),
        "quality": quote.get("quality"),
    }


def _market_data_for_symbol(provider: MarketDataProvider, symbol: str) -> Dict[str, object]:
    try:
        quote = provider.quote(symbol)
    except Exception as exc:
        return {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "last_updated": datetime.utcnow().isoformat(),
            "error": str(exc),
        }
    current = quote.price
    previous = quote.close
    change = current - previous if current is not None and previous is not None else None
    change_pct = (change / previous) * 100 if previous else None
    return {
        "current_price": current,
        "previous_close": previous,
        "change": change,
        "change_percent": change_pct,
        "last_updated": datetime.utcnow().isoformat(),
        "data_source": provider.name,
        "quote_source": quote.quote_source,
    }


def _empty_position_metrics(error: Optional[str] = None) -> Dict[str, object]:
    payload: Dict[str, object] = {
        "market": {
            "current_price": None,
            "previous_close": None,
            "change": None,
            "change_percent": None,
            "implied_volatility": None,
            "last_updated": datetime.utcnow().isoformat(),
        },
        "option_price": None,
        "option_price_source": None,
        "volatility": None,
        "volatility_source": None,
        "dte": None,
        "greeks": None,
        "pnl": {
            "dollar": None,
            "percent": None,
            "source": None,
        },
    }
    if error:
        payload["error"] = error
    return payload


def _compute_position_metrics(position: OptionPosition) -> Dict[str, object]:
    provider = get_market_data_provider()
    market = _market_data_for_symbol(provider, position.symbol)

    option_row = _resolve_option_row(
        provider,
        position.symbol,
        position.expiration,
        position.option_type,
        position.strike,
    )
    quote = _quote_payload_from_row(option_row)
    implied_vol = None
    option_price = None
    option_price_source = None
    iv_source = None
    
    if option_row is not None:
        # Try to get IV from option chain
        implied_vol = option_row.get("impliedVolatility")
        if pd.notna(implied_vol) and _is_finite_number(implied_vol):
            implied_vol = float(implied_vol)
            iv_source = "chain"
        else:
            implied_vol = None
        
        # Get option price (prefer mid, fallback to last)
        last_price = option_row.get("lastPrice")
        bid = option_row.get("bid")
        ask = option_row.get("ask")
        
        if (
            pd.notna(bid)
            and pd.notna(ask)
            and _is_finite_number(bid)
            and _is_finite_number(ask)
            and bid > 0
            and ask > 0
        ):
            option_price = float(bid + ask) / 2.0
            option_price_source = "mid"
        elif pd.notna(last_price) and _is_finite_number(last_price) and last_price > 0:
            option_price = float(last_price)
            option_price_source = "last"

    # Get historical volatility as fallback
    try:
        hist = provider.daily_bars(position.symbol, days=180)
    except Exception:
        hist = None
    try:
        hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
    except Exception:
        hv30 = None
    
    # Determine spot price
    spot = market.get("current_price") or position.underlying_reference or position.underlying_at_entry
    
    # Determine volatility to use
    volatility = None

    # Priority 1: invert from current quoted option price if available. This
    # keeps Greeks consistent with the premium shown on the options page.
    if option_price is not None and spot and spot > 0:
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

    # Priority 2: Chain IV (but only if realistic - between 10% and 500%).
    if volatility is None and implied_vol is not None and 0.10 <= implied_vol <= 5.0:
        volatility = implied_vol
        iv_source = "chain"

    # Priority 3: Historical volatility. compute_historical_volatility returns
    # percent units, while Black-Scholes expects decimal volatility.
    if volatility is None and hv30 is not None and _is_finite_number(hv30):
        volatility = float(hv30) / 100.0
        iv_source = "historical"
    
    # If still no volatility, try a default
    if volatility is None:
        volatility = 0.30  # 30% default
        iv_source = "default"
    
    volatility_source = iv_source

    dte = max((position.expiration - date.today()).days, 0)
    time_to_expiry = max(dte, 0) / 365.0
    
    greeks = None
    if (
        spot
        and _is_finite_number(spot)
        and volatility
        and _is_finite_number(volatility)
        and time_to_expiry > 0
    ):
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
        "quote": quote,
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
        "source_event_id": position.source_event_id,
        "source_triggered_at": (
            position.source_triggered_at.isoformat() if position.source_triggered_at else None
        ),
        "source_match_method": position.source_match_method,
        "source_match_confidence": position.source_match_confidence,
        "source_match_notes": position.source_match_notes,
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
                    metrics = _empty_position_metrics(str(perr))
                payload.append(
                    {
                        "position": _serialize_position(position),
                        "metrics": metrics,
                    }
                )
            return _json_safe({"positions": payload})
    except Exception as exc:
        # Log traceback to server logs for debugging
        traceback.print_exc()
        # Return a useful message to the caller to aid debugging (temporary)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}")


@router.post("/positions")
def create_position(payload: OptionPositionCreate):
    with get_db_session() as db:
        trade_date = _parse_date(payload.trade_date)
        attribution = _resolve_signal_attribution(
            db,
            payload.symbol.upper(),
            trade_date,
            explicit_event_id=payload.source_event_id,
        )
        position = OptionPosition(
            trade_date=trade_date,
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
            source_event_id=attribution["source_event_id"],
            source_triggered_at=attribution["source_triggered_at"],
            source_match_method=attribution["source_match_method"],
            source_match_confidence=attribution["source_match_confidence"],
            source_match_notes=attribution["source_match_notes"],
        )
        db.add(position)
        db.commit()
        db.refresh(position)
        return _json_safe({"position": _serialize_position(position)})


@router.put("/positions/{position_id}")
def update_position(position_id: int, payload: OptionPositionCreate):
    with get_db_session() as db:
        position = db.query(OptionPosition).filter(OptionPosition.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        trade_date = _parse_date(payload.trade_date)
        attribution = _resolve_signal_attribution(
            db,
            payload.symbol.upper(),
            trade_date,
            explicit_event_id=payload.source_event_id,
        )

        position.trade_date = trade_date
        position.account = payload.account
        position.action = payload.action
        position.contracts = payload.contracts
        position.symbol = payload.symbol.upper()
        position.expiration = _parse_date(payload.expiration)
        position.strike = payload.strike
        position.option_type = payload.option_type.lower()
        position.fill_price = payload.fill_price
        position.total_cost = payload.total_cost
        position.underlying_at_entry = payload.underlying_at_entry
        position.estimated_delta = payload.estimated_delta
        position.shares_equivalent = payload.shares_equivalent
        position.dte_at_entry = payload.dte_at_entry
        position.underlying_reference = payload.underlying_reference
        position.source_event_id = attribution["source_event_id"]
        position.source_triggered_at = attribution["source_triggered_at"]
        position.source_match_method = attribution["source_match_method"]
        position.source_match_confidence = attribution["source_match_confidence"]
        position.source_match_notes = attribution["source_match_notes"]

        db.commit()
        db.refresh(position)
        return _json_safe({"position": _serialize_position(position)})


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

        try:
            metrics = _compute_position_metrics(position)
        except Exception as exc:
            metrics = _empty_position_metrics(str(exc))
        spot = metrics["market"].get("current_price") or position.underlying_reference or position.underlying_at_entry
        volatility = metrics.get("volatility")
        dte = metrics.get("dte") or 0
        
        if not spot or not volatility or dte <= 0:
            return {
                "price_curve": [],
                "theta_curve": [],
                "current_greeks": None,
                "model_info": {
                    "error": metrics.get("error") or "Insufficient data for Greeks calculation",
                    "spot_price": spot,
                    "volatility": volatility,
                    "dte": dte,
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

        return _json_safe({
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
        })


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
            notes=request.notes,
            source_event_id=position.source_event_id,
            source_triggered_at=position.source_triggered_at,
            source_match_method=position.source_match_method,
            source_match_confidence=position.source_match_confidence,
            source_match_notes=position.source_match_notes,
        )
        db.add(closed)
        
        # Delete active position
        db.delete(position)
        db.commit()
        
        return _json_safe({
            "message": "Position closed successfully",
            "pnl": {
                "dollar": dollar_pnl,
                "percent": percent_pnl,
                "total_proceeds": total_proceeds
            }
        })


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
                "notes": pos.notes,
                "source_event_id": pos.source_event_id,
                "source_triggered_at": (
                    pos.source_triggered_at.isoformat() if pos.source_triggered_at else None
                ),
                "source_match_method": pos.source_match_method,
                "source_match_confidence": pos.source_match_confidence,
                "source_match_notes": pos.source_match_notes,
            })
        
        # Calculate summary stats
        total_pnl = sum(pos.dollar_pnl for pos in closed_positions)
        winning_trades = sum(1 for pos in closed_positions if pos.dollar_pnl > 0)
        total_trades = len(closed_positions)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        attributed = [pos for pos in closed_positions if pos.source_event_id is not None]
        attributed_total = len(attributed)
        attributed_winners = sum(1 for pos in attributed if pos.dollar_pnl > 0)
        attributed_pnl = sum(pos.dollar_pnl for pos in attributed)
        attributed_win_rate = (attributed_winners / attributed_total * 100) if attributed_total else 0
        
        return _json_safe({
            "closed_positions": results,
            "summary": {
                "total_pnl": total_pnl,
                "total_trades": total_trades,
                "winning_trades": winning_trades,
                "losing_trades": total_trades - winning_trades,
                "win_rate": win_rate,
                "attributed_trades": attributed_total,
                "attributed_winning_trades": attributed_winners,
                "attributed_total_pnl": attributed_pnl,
                "attributed_win_rate": attributed_win_rate,
            }
        })


@router.post("/attribution/backfill")
def backfill_signal_attribution(limit: int = Query(1000, ge=1, le=10000)):
    """
    Backfill signal attribution for existing open/closed positions that do not
    yet have a linked sweep event.
    """
    with get_db_session() as db:
        open_positions = (
            db.query(OptionPosition)
            .filter(OptionPosition.source_event_id.is_(None))
            .order_by(OptionPosition.trade_date.desc())
            .limit(limit)
            .all()
        )
        closed_positions = (
            db.query(ClosedPosition)
            .filter(ClosedPosition.source_event_id.is_(None))
            .order_by(ClosedPosition.trade_date.desc())
            .limit(limit)
            .all()
        )

        open_linked = 0
        closed_linked = 0

        for position in open_positions:
            attribution = _resolve_signal_attribution(db, position.symbol, position.trade_date)
            position.source_event_id = attribution["source_event_id"]
            position.source_triggered_at = attribution["source_triggered_at"]
            position.source_match_method = attribution["source_match_method"]
            position.source_match_confidence = attribution["source_match_confidence"]
            position.source_match_notes = attribution["source_match_notes"]
            if position.source_event_id is not None:
                open_linked += 1

        for position in closed_positions:
            attribution = _resolve_signal_attribution(db, position.symbol, position.trade_date)
            position.source_event_id = attribution["source_event_id"]
            position.source_triggered_at = attribution["source_triggered_at"]
            position.source_match_method = attribution["source_match_method"]
            position.source_match_confidence = attribution["source_match_confidence"]
            position.source_match_notes = attribution["source_match_notes"]
            if position.source_event_id is not None:
                closed_linked += 1

        db.commit()
        return _json_safe({
            "open_positions_checked": len(open_positions),
            "open_positions_linked": open_linked,
            "closed_positions_checked": len(closed_positions),
            "closed_positions_linked": closed_linked,
        })


@router.get("/training-outcomes")
def get_training_outcomes(
    lookback_days: int = Query(365, ge=30, le=1825),
    limit: int = Query(200, ge=1, le=1000),
):
    """
    Evaluate exceptional scanner training examples by holding for the
    suggested horizon and estimating option outcomes.
    """
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    with get_db_session() as db:
        events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= cutoff)
            .order_by(OptionAlertEvent.triggered_at.desc())
            .limit(limit)
            .all()
        )

    exceptional_events = [event for event in events if _is_exceptional_training_event(event)]
    outcomes: list[Dict[str, object]] = []

    for event in exceptional_events:
        try:
            outcome = _compute_training_outcome(event)
            if outcome:
                outcomes.append(outcome)
        except Exception:
            continue

    matured = [row for row in outcomes if row.get("status") == "matured"]
    matured_option_returns = [
        float(row["option_return_pct_est"])
        for row in matured
        if row.get("option_return_pct_est") is not None
    ]
    matured_option_pnl = [
        float(row["option_pnl_per_contract_est"])
        for row in matured
        if row.get("option_pnl_per_contract_est") is not None
    ]
    winners = [value for value in matured_option_returns if value > 0]

    summary = {
        "sample_size": len(outcomes),
        "matured": len(matured),
        "pending": len(outcomes) - len(matured),
        "win_rate_pct": (len(winners) / len(matured_option_returns) * 100.0) if matured_option_returns else None,
        "avg_option_return_pct": (sum(matured_option_returns) / len(matured_option_returns)) if matured_option_returns else None,
        "total_option_pnl_per_contract": sum(matured_option_pnl) if matured_option_pnl else None,
    }

    return _json_safe({
        "outcomes": outcomes,
        "summary": summary,
    })
