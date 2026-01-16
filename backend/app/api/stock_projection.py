"""
Stock Projection API Endpoints

Provides REST API access to individual stock performance projections using the same
transparent scoring methodology as sector projections.

Endpoints:
- GET /stocks/{ticker}/projections: Get multi-horizon projections for a single stock

All projections include:
- Composite score (0-100) and component scores (trend, relative strength, risk, regime)
- Raw metrics (returns, volatility, drawdown, etc.)
"""

from fastapi import APIRouter, HTTPException, Path
from datetime import datetime, timedelta
from typing import Optional
import yfinance as yf
import pandas as pd
import numpy as np
import math
from app.models.system_status import SystemStatus
from app.utils.db_helpers import get_db_session

router = APIRouter()

HORIZONS = {
    "T": 0,    # Today (uses T_WINDOW_DAYS for calculation)
    "3m": 63,
    "6m": 126,
    "12m": 252,
}


def sanitize_for_json(obj):
    """
    Recursively replace NaN and Inf values with None for JSON serialization.
    """
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item) for item in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj
T_WINDOW_DAYS = 21

def fetch_stock_data(ticker: str, days: int = 2000) -> pd.DataFrame:
    """Fetch historical price data for a stock"""
    try:
        stock = yf.Ticker(ticker)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        df = stock.history(start=start_date, end=end_date)
        if df.empty:
            raise ValueError(f"No data available for ticker {ticker}")
        
        df['returns'] = df['Close'].pct_change()
        return df
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Unable to fetch data for {ticker}: {str(e)}")


def calculate_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Calculate Average True Range for volatility measurement"""
    high_low = df['High'] - df['Low']
    high_close = abs(df['High'] - df['Close'].shift())
    low_close = abs(df['Low'] - df['Close'].shift())
    
    ranges = pd.concat([high_low, high_close, low_close], axis=1)
    true_range = ranges.max(axis=1)
    atr = true_range.rolling(period).mean()
    
    return atr.iloc[-1] if not pd.isna(atr.iloc[-1]) else 0


def compute_conviction(trend_score: float, rel_strength_score: float, risk_score: float, volatility: float, composite_score: float) -> float:
    """
    Calculate conviction (confidence) in the projection (0-100)
    High conviction = strong signals aligned, low volatility
    Low conviction = mixed signals, high volatility
    """
    # Score alignment: how close are the component scores to the composite?
    component_scores = [trend_score, rel_strength_score, risk_score]
    avg_component = np.mean(component_scores)
    alignment = 100 - np.std(component_scores)  # Lower std = better alignment = higher conviction
    
    # Volatility factor: lower volatility = higher conviction
    volatility_factor = max(0, 100 - (volatility * 2))
    
    # Strength factor: scores far from neutral (50) = higher conviction
    strength = abs(composite_score - 50) / 50 * 100
    
    # Weighted conviction
    conviction = (
        0.40 * alignment +           # Component alignment (40%)
        0.35 * volatility_factor +   # Low volatility confidence (35%)
        0.25 * strength              # Signal strength (25%)
    )
    
    return np.clip(conviction, 0, 100)


def compute_historical_volatility(df: pd.DataFrame, window: int = 30) -> Optional[float]:
    """Calculate historical volatility over a rolling window (annualized)."""
    returns = df['Close'].pct_change().dropna()
    if len(returns) < window:
        return None
    hv = returns.tail(window).std() * np.sqrt(252) * 100
    return round(float(hv), 2)


def _parse_expiry(expiry: str) -> Optional[datetime]:
    try:
        return datetime.strptime(expiry, "%Y-%m-%d")
    except Exception:
        return None


def _near_atm(options_df: pd.DataFrame, current_price: float, threshold: float = 0.05) -> pd.DataFrame:
    if options_df is None or options_df.empty or current_price <= 0:
        return pd.DataFrame()
    return options_df[(options_df["strike"] - current_price).abs() / current_price <= threshold]


def _option_mid_price(row: pd.Series) -> Optional[float]:
    bid = row.get("bid")
    ask = row.get("ask")
    last = row.get("lastPrice")
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return float((bid + ask) / 2)
    if last is not None and last > 0:
        return float(last)
    return None


def compute_options_flow(stock: yf.Ticker) -> Optional[dict]:
    """Build a lightweight options flow snapshot from the nearest expiry."""
    try:
        expiries = stock.options or []
        if not expiries:
            return None

        expiry = expiries[0]
        chain = stock.option_chain(expiry)
        calls = chain.calls if chain and hasattr(chain, "calls") else pd.DataFrame()
        puts = chain.puts if chain and hasattr(chain, "puts") else pd.DataFrame()

        if calls.empty and puts.empty:
            return None

        def top_walls(df: pd.DataFrame) -> list:
            if df is None or df.empty:
                return []
            cols = df[["strike", "openInterest", "volume"]].fillna(0)
            cols = cols.sort_values("openInterest", ascending=False).head(3)
            return [
                {
                    "strike": float(row.strike),
                    "open_interest": int(row.openInterest),
                    "volume": int(row.volume),
                }
                for _, row in cols.iterrows()
            ]

        call_walls = top_walls(calls)
        put_walls = top_walls(puts)
        call_oi_total = int(calls["openInterest"].fillna(0).sum()) if not calls.empty else 0
        put_oi_total = int(puts["openInterest"].fillna(0).sum()) if not puts.empty else 0
        call_vol_total = int(calls["volume"].fillna(0).sum()) if not calls.empty else 0
        put_vol_total = int(puts["volume"].fillna(0).sum()) if not puts.empty else 0
        put_call_oi_ratio = round(put_oi_total / call_oi_total, 2) if call_oi_total > 0 else None

        return {
            "expiry": expiry,
            "as_of": datetime.utcnow().isoformat(),
            "call_walls": call_walls,
            "put_walls": put_walls,
            "call_open_interest_total": call_oi_total,
            "put_open_interest_total": put_oi_total,
            "call_volume_total": call_vol_total,
            "put_volume_total": put_vol_total,
            "put_call_oi_ratio": put_call_oi_ratio,
        }
    except Exception:
        return None


def compute_optionality_metrics(
    stock: yf.Ticker,
    current_price: float,
    hv30: Optional[float],
) -> dict:
    """Compute IV/HV spread, IV percentile, and extrinsic density ratio."""
    expiries = stock.options or []
    if not expiries:
        return {
            "iv30": None,
            "hv30": hv30,
            "iv_percentile": None,
            "avg_edr": None,
        }

    today = datetime.utcnow().date()
    expiry_candidates = []
    for exp in expiries:
        exp_date = _parse_expiry(exp)
        if not exp_date:
            continue
        dte = (exp_date.date() - today).days
        if dte <= 0:
            continue
        expiry_candidates.append((exp, dte))

    if not expiry_candidates:
        return {
            "iv30": None,
            "hv30": hv30,
            "iv_percentile": None,
            "avg_edr": None,
        }

    expiry_candidates.sort(key=lambda x: x[1])
    front_expiries = expiry_candidates[:6]
    target_expiry = min(front_expiries, key=lambda x: abs(x[1] - 30))[0]

    iv_values = []
    edr_values = []
    iv30 = None

    for expiry, _ in front_expiries:
        try:
            chain = stock.option_chain(expiry)
        except Exception:
            continue

        calls = chain.calls if chain and hasattr(chain, "calls") else pd.DataFrame()
        puts = chain.puts if chain and hasattr(chain, "puts") else pd.DataFrame()

        near_calls = _near_atm(calls, current_price)
        near_puts = _near_atm(puts, current_price)
        near_chain = pd.concat([near_calls, near_puts], ignore_index=True)
        if near_chain.empty:
            continue

        iv_series = near_chain.get("impliedVolatility")
        if iv_series is not None:
            iv_values.extend([float(v) * 100 for v in iv_series.dropna().tolist() if v > 0])

        for _, row in near_calls.iterrows():
            price = _option_mid_price(row)
            if not price:
                continue
            intrinsic = max(current_price - row.strike, 0)
            extrinsic = max(price - intrinsic, 0)
            edr_values.append(extrinsic / price if price > 0 else 0)

        for _, row in near_puts.iterrows():
            price = _option_mid_price(row)
            if not price:
                continue
            intrinsic = max(row.strike - current_price, 0)
            extrinsic = max(price - intrinsic, 0)
            edr_values.append(extrinsic / price if price > 0 else 0)

        if expiry == target_expiry and iv_series is not None and not iv_series.dropna().empty:
            iv30 = round(float(iv_series.dropna().median() * 100), 2)

    iv_percentile = None
    if iv30 is not None and iv_values:
        sorted_vals = sorted(iv_values)
        count = sum(1 for v in sorted_vals if v <= iv30)
        iv_percentile = round((count / len(sorted_vals)) * 100, 1)

    avg_edr = None
    if edr_values:
        avg_edr = round(float(np.mean(edr_values) * 100), 2)

    return {
        "iv30": iv30,
        "hv30": hv30,
        "iv_percentile": iv_percentile,
        "avg_edr": avg_edr,
    }


def calculate_take_profit(current_price: float, return_pct: float, volatility: float, horizon_days: int) -> float:
    """
    Calculate take profit target based on:
    - Expected return over horizon
    - Volatility adjustment
    - Time horizon scaling
    """
    # Base target from return (more conservative)
    base_target = current_price * (1 + return_pct * 0.6)  # Use 60% of projected return
    
    # Volatility-adjusted upside (reduce profits in high vol)
    vol_adjustment = 1 - (volatility / 100 * 0.15)  # Reduce by up to 15% for very high vol
    
    # Horizon scaling (minimal scaling for tighter targets)
    horizon_multiplier = 1 + (horizon_days / 252 * 0.05)
    
    target = base_target * vol_adjustment * horizon_multiplier
    return target


def calculate_stop_loss(current_price: float, volatility: float, risk_score: float, horizon_days: int) -> float:
    """
    Calculate stop loss based on:
    - Volatility (higher vol = wider stops)
    - Risk score (higher risk = tighter stops)
    - Time horizon
    """
    # Base stop: 1.5 ATR equivalent (tighter than before)
    atr_equivalent = current_price * (volatility / 100) * 0.35
    
    # Risk adjustment (more conservative)
    risk_adjustment = (100 - risk_score) / 100 * 0.8  # Up to 0.8x ATR for low-risk assets
    
    # Horizon adjustment (tighter multiplier)
    horizon_factor = 1 + (min(horizon_days, 252) / 252 * 0.15)
    
    stop_loss = current_price - (atr_equivalent * (1 + risk_adjustment) * horizon_factor)
    return stop_loss


def calculate_rsi(df: pd.DataFrame, period: int = 14) -> tuple:
    """Calculate RSI and return current value and historical values"""
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    return rsi.iloc[-1], rsi


def calculate_macd(df: pd.DataFrame, lookback_days: int = 252) -> dict:
    """Calculate MACD, signal line, and histogram for full lookback period"""
    ema_12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema_26 = df['Close'].ewm(span=26, adjust=False).mean()
    
    macd = ema_12 - ema_26
    signal = macd.ewm(span=9, adjust=False).mean()
    histogram = macd - signal
    
    return {
        "macd": macd.iloc[-1],
        "signal": signal.iloc[-1],
        "histogram": histogram.iloc[-1],
        "macd_series": macd.tail(lookback_days).tolist(),
        "signal_series": signal.tail(lookback_days).tolist(),
        "histogram_series": histogram.tail(lookback_days).tolist(),
    }


def calculate_technical_indicators(df: pd.DataFrame, lookback_days: int = 252) -> dict:
    """Calculate all technical indicators for 252-day lookback"""
    
    # Get last 252 days of data
    lookback_df = df.tail(lookback_days).copy()
    
    if len(lookback_df) < 50:
        return {"error": "Insufficient data for technical analysis"}
    
    # OHLC data for candlestick chart (return all candles, no sampling)
    candles = []
    
    for date, row in lookback_df.iterrows():
        candles.append({
            "date": date.strftime("%Y-%m-%d"),
            "open": float(row['Open']),
            "high": float(row['High']),
            "low": float(row['Low']),
            "close": float(row['Close']),
            "volume": int(row.get('Volume', 0)) if 'Volume' in row else 0,
        })
    
    # RSI
    rsi_current, rsi_series = calculate_rsi(lookback_df)
    
    # MACD
    macd_data = calculate_macd(lookback_df, lookback_days)
    
    # SMA 50 and 200
    sma_50 = lookback_df['Close'].rolling(50).mean().iloc[-1]
    sma_200 = lookback_df['Close'].rolling(200).mean().iloc[-1] if len(lookback_df) >= 200 else None
    
    # Price levels
    current_price = lookback_df['Close'].iloc[-1]
    high_52w = lookback_df['High'].max()
    low_52w = lookback_df['Low'].min()
    
    # Trend
    trend = "uptrend" if current_price > sma_50 else "downtrend" if sma_200 and current_price < sma_200 else "neutral"
    
    return {
        "lookback_days": len(lookback_df),
        "current_price": float(current_price),
        "high_52w": float(high_52w),
        "low_52w": float(low_52w),
        "sma_50": float(sma_50),
        "sma_200": float(sma_200) if sma_200 else None,
        "trend": trend,
        "rsi": {
            "current": float(rsi_current),
            "status": "overbought" if rsi_current > 70 else "oversold" if rsi_current < 30 else "neutral",
            "series": rsi_series.tail(lookback_days).tolist(),
        },
        "macd": {
            "current": float(macd_data["macd"]),
            "signal": float(macd_data["signal"]),
            "histogram": float(macd_data["histogram"]),
            "status": "bullish" if macd_data["histogram"] > 0 else "bearish",
            "macd_series": macd_data["macd_series"],
            "signal_series": macd_data["signal_series"],
            "histogram_series": macd_data["histogram_series"],
        },
        "candles": candles,
    }


def compute_stock_projection(ticker: str, df: pd.DataFrame, spy_df: pd.DataFrame, horizon_days: int, system_state: str) -> dict:
    """Compute projection scores for a single stock at a given horizon"""
    
    if len(df) < horizon_days:
        raise ValueError(f"Insufficient data: need {horizon_days} days, have {len(df)}")
    
    # Get the lookback window
    window_df = df.iloc[-horizon_days:]
    spy_window = spy_df.iloc[-horizon_days:]
    
    # 1. TREND SCORE (45% weight)
    # Return over period
    total_return = (window_df['Close'].iloc[-1] / window_df['Close'].iloc[0]) - 1
    
    # SMA distance (200-day)
    sma_200 = df['Close'].rolling(200).mean().iloc[-1]
    sma_distance = (df['Close'].iloc[-1] / sma_200) - 1 if not pd.isna(sma_200) else 0
    
    # Trend composite (normalize to 0-100 scale)
    trend_raw = total_return + (0.5 * sma_distance)
    trend_score = max(0, min(100, (trend_raw + 0.5) * 100))  # Simple normalization
    
    # 2. RELATIVE STRENGTH SCORE (30% weight)
    spy_return = (spy_window['Close'].iloc[-1] / spy_window['Close'].iloc[0]) - 1
    relative_strength_raw = total_return - spy_return
    rel_strength_score = max(0, min(100, (relative_strength_raw + 0.5) * 100))
    
    # 3. RISK SCORE (20% weight, inverted)
    # Realized volatility (20-day rolling, annualized)
    volatility = window_df['returns'].rolling(20).std().mean() * np.sqrt(252) * 100
    
    # Max drawdown
    cumulative = (1 + window_df['returns']).cumprod()
    running_max = cumulative.expanding().max()
    drawdown = ((cumulative - running_max) / running_max * 100).min()
    max_drawdown = abs(drawdown)
    
    # Risk composite (lower risk = higher score)
    risk_raw = volatility + (0.5 * max_drawdown)
    risk_score = max(0, min(100, 100 - (risk_raw * 2)))  # Inverted and normalized
    
    # 4. REGIME ADJUSTMENT (5% weight)
    regime_score = 50  # Neutral baseline
    if system_state == "RED":
        # Penalize high volatility in red market
        if volatility > 30:
            regime_score = 45
    
    # COMPOSITE SCORE
    composite_score = (
        0.45 * trend_score +
        0.30 * rel_strength_score +
        0.20 * risk_score +
        0.05 * regime_score
    )
    
    # CONVICTION CALCULATION (confidence in the projection)
    # Based on score consistency and direction strength
    conviction = compute_conviction(
        trend_score, 
        rel_strength_score, 
        risk_score, 
        volatility,
        composite_score
    )
    
    # PRICE TARGETS (Take Profit and Stop Loss)
    current_price = df['Close'].iloc[-1]
    atr_20 = calculate_atr(df, 20)
    
    # Take profit: based on positive return + volatility adjustment
    take_profit = calculate_take_profit(
        current_price,
        total_return,
        volatility,
        horizon_days
    )
    
    # Stop loss: based on volatility and risk score
    stop_loss = calculate_stop_loss(
        current_price,
        volatility,
        risk_score,
        horizon_days
    )
    
    return {
        "score_total": round(composite_score, 2),
        "score_trend": round(trend_score, 2),
        "score_relative_strength": round(rel_strength_score, 2),
        "score_risk": round(risk_score, 2),
        "score_regime": round(regime_score, 2),
        "trailing_return_pct": round(total_return * 100, 2),
        "volatility": round(volatility, 2),
        "max_drawdown": round(max_drawdown, 2),
        "conviction": round(conviction, 2),
        "current_price": round(current_price, 2),
        "take_profit": round(take_profit, 2),
        "stop_loss": round(stop_loss, 2),
    }


@router.get("/stocks/{ticker}/projections")
def get_stock_projections(
    ticker: str = Path(..., description="Stock ticker symbol (e.g., AAPL, TSLA)")
):
    """
    Get multi-horizon projections for a single stock
    
    Returns composite scores and component breakdowns for 3M, 6M, and 12M horizons
    """
    
    ticker = ticker.upper()
    stock = yf.Ticker(ticker)
    
    data_warnings = []

    # Fetch stock data
    df = fetch_stock_data(ticker)
    current_price = float(df['Close'].iloc[-1])
    hv30 = compute_historical_volatility(df, window=30)
    
    # Fetch SPY for relative strength comparison
    spy_df = fetch_stock_data("SPY")

    # Data freshness checks
    try:
        latest_stock_date = pd.to_datetime(df.index).max()
        latest_spy_date = pd.to_datetime(spy_df.index).max()
        if latest_stock_date < latest_spy_date:
            lag_days = (latest_spy_date - latest_stock_date).days
            if lag_days > 2:
                data_warnings.append({
                    "type": "stale_series",
                    "details": {
                        "symbol": ticker,
                        "latest_date": latest_stock_date.date().isoformat(),
                        "lag_days": lag_days,
                    },
                })
    except Exception:
        pass
    
    # Get current system state
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
        system_state = status.state if status else "YELLOW"
    
    # Get stock name
    stock_info = {}
    try:
        stock_info = stock.info
    except Exception:
        stock_info = {}

    stock_name = stock_info.get('longName') or stock_info.get('shortName') or ticker
    analyst_target = stock_info.get("targetMeanPrice") or stock_info.get("targetMedianPrice")
    analyst_count = stock_info.get("numberOfAnalystOpinions")
    try:
        analyst_target = round(float(analyst_target), 2) if analyst_target is not None else None
    except Exception:
        analyst_target = None
    try:
        analyst_count = int(analyst_count) if analyst_count is not None else None
    except Exception:
        analyst_count = None

    options_flow = compute_options_flow(stock)
    optionality = compute_optionality_metrics(stock, current_price, hv30)
    
    # Compute projections for each horizon
    projections = {}
    for horizon_name, horizon_days in HORIZONS.items():
        try:
            effective_days = T_WINDOW_DAYS if horizon_days == 0 else horizon_days
            projection = compute_stock_projection(ticker, df, spy_df, effective_days, system_state)
            projection.update({
                "ticker": ticker,
                "name": stock_name,
                "horizon": horizon_name,
            })
            projections[horizon_name] = projection
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error computing {horizon_name} projection: {str(e)}")
    
    # Compute HISTORICAL score from 3 months ago (for chart visualization)
    historical_score = None
    try:
        # Calculate what the 3M score was 90 days ago
        three_months_ago_idx = len(df) - 90  # Go back 90 days from today
        if three_months_ago_idx > 63:  # Need at least 63 days of lookback data
            historical_df = df.iloc[:three_months_ago_idx]
            historical_spy = spy_df.iloc[:three_months_ago_idx]
            historical_score = compute_stock_projection(
                ticker, 
                historical_df, 
                historical_spy, 
                HORIZONS["3m"],  # 63 days
                system_state
            )["score_total"]
    except Exception as e:
        # If we can't compute historical, that's okay - frontend will handle it
        print(f"Warning: Could not compute historical score for {ticker}: {str(e)}")
    
    # Calculate technical indicators for 252-day lookback
    technical_data = calculate_technical_indicators(df, lookback_days=252)
    
    result = {
        "ticker": ticker,
        "name": stock_name,
        "as_of_date": datetime.now().isoformat(),
        "created_at": datetime.utcnow().isoformat(),
        "data_warnings": data_warnings,
        "analyst_target": analyst_target,
        "analyst_count": analyst_count,
        "options_flow": options_flow,
        "optionality": optionality,
        "projections": projections,
        "historical": {
            "score_3m_ago": historical_score  # What the score was 90 days ago
        },
        "technical": technical_data,
    }
    
    # Sanitize NaN/Inf values before returning
    return sanitize_for_json(result)
