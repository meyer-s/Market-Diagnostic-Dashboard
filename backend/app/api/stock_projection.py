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
import time
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


def _get_quarterly_df(stock: yf.Ticker, getters) -> pd.DataFrame:
    frames = []
    for getter in getters:
        try:
            df = getter()
        except Exception:
            continue
        if isinstance(df, pd.DataFrame) and not df.empty:
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    merged = frames[0].copy()
    for df in frames[1:]:
        try:
            merged = merged.combine_first(df)
        except Exception:
            continue
    return merged


def _normalize_quarter_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    try:
        df = df.copy()
        df.columns = pd.to_datetime(df.columns, errors="coerce")
        df = df.loc[:, df.columns.notna()]
        return df
    except Exception:
        return df


def _row_series(df: pd.DataFrame, row_names) -> Optional[pd.Series]:
    if df is None or df.empty:
        return None
    for name in row_names:
        if name in df.index:
            series = df.loc[name]
            if isinstance(series, pd.Series):
                return series.dropna()
    return None


def _series_from_row(df: pd.DataFrame, row_names, max_points: int = 8) -> list:
    series = _row_series(df, row_names)
    if series is None or series.empty:
        return []
    data = []
    for col, value in series.items():
        if pd.isna(value):
            continue
        date = pd.to_datetime(col, errors="coerce")
        if pd.isna(date):
            continue
        data.append({"date": date.date().isoformat(), "value": float(value)})
    data.sort(key=lambda item: item["date"])
    return data[-max_points:]


def _merge_series(primary: list, secondary: list, max_points: int) -> list:
    merged = {item["date"]: item for item in secondary}
    for item in primary:
        merged[item["date"]] = item
    combined = list(merged.values())
    combined.sort(key=lambda item: item["date"])
    return combined[-max_points:]


def _price_on_or_before(df: pd.DataFrame, date: pd.Timestamp) -> Optional[float]:
    if df is None or df.empty or "Close" not in df.columns:
        return None
    try:
        price_df = df.copy()
        if not isinstance(price_df.index, pd.DatetimeIndex):
            price_df.index = pd.to_datetime(price_df.index, errors="coerce")
        price_df = price_df[price_df.index.notna()]
        if price_df.index.tz is not None:
            price_df.index = price_df.index.tz_localize(None)
        if date.tzinfo is not None:
            date = date.tz_localize(None)
        subset = price_df[price_df.index <= date]
        if subset.empty:
            return None
        return float(subset["Close"].iloc[-1])
    except Exception:
        return None


def _value_on_or_before(series: pd.Series, date: pd.Timestamp) -> Optional[float]:
    if series is None or series.empty:
        return None
    try:
        data = series.dropna()
        if data.empty:
            return None
        if not isinstance(data.index, pd.DatetimeIndex):
            data.index = pd.to_datetime(data.index, errors="coerce")
        data = data[data.index.notna()]
        if data.index.tz is not None:
            data.index = data.index.tz_localize(None)
        if date.tzinfo is not None:
            date = date.tz_localize(None)
        subset = data[data.index <= date]
        if subset.empty:
            return None
        return float(subset.iloc[-1])
    except Exception:
        return None


def _last_quarter_dates(df: pd.DataFrame, max_points: int = 8) -> list:
    if df is None or df.empty:
        return []
    try:
        idx = pd.to_datetime(df.index, errors="coerce")
        idx = idx[idx.notna()]
        if idx.empty:
            return []
        quarter_ends = idx.to_period("Q").end_time
        unique_dates = sorted({date.date().isoformat() for date in quarter_ends})
        return unique_dates[-max_points:]
    except Exception:
        return []


def _series_from_earnings_dates(stock: yf.Ticker, max_points: int = 12) -> list:
    try:
        earnings = stock.get_earnings_dates(limit=max_points * 3)
    except Exception:
        return []
    if earnings is None or earnings.empty:
        return []

    eps_column = None
    for col in earnings.columns:
        if "reported" in str(col).lower() and "eps" in str(col).lower():
            eps_column = col
            break
    if eps_column is None:
        return []

    data = []
    for idx, row in earnings.iterrows():
        eps_value = row.get(eps_column)
        if pd.isna(eps_value):
            continue
        date = pd.to_datetime(idx, errors="coerce")
        if pd.isna(date):
            continue
        data.append({"date": date.date().isoformat(), "value": float(eps_value)})

    data.sort(key=lambda item: item["date"])
    return data[-max_points:]


def compute_fundamentals(stock: yf.Ticker, price_df: pd.DataFrame) -> dict:
    max_points = 12
    income_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_financials,
            lambda: stock.get_income_stmt(freq="quarterly"),
        ],
    )
    balance_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_balance_sheet,
            lambda: stock.get_balance_sheet(freq="quarterly"),
        ],
    )
    cashflow_df = _get_quarterly_df(
        stock,
        [
            lambda: stock.quarterly_cashflow,
            lambda: stock.get_cashflow(freq="quarterly"),
        ],
    )

    income_df = _normalize_quarter_columns(income_df)
    balance_df = _normalize_quarter_columns(balance_df)
    cashflow_df = _normalize_quarter_columns(cashflow_df)

    net_income_series = _series_from_row(
        income_df,
        [
            "Net Income",
            "Net Income Applicable To Common Shares",
            "Net Income Common Stockholders",
            "Net Income Continuous Operations",
            "Net Income From Continuing Operations",
        ],
        max_points=max_points,
    )
    revenue_series = _series_from_row(
        income_df,
        [
            "Total Revenue",
            "TotalRevenue",
            "Revenue",
            "Total Revenue As Reported",
            "Revenue From Contract With Customer Excluding Assessed Tax",
        ],
        max_points=max_points,
    )

    equity_series = _series_from_row(
        balance_df,
        [
            "Total Stockholder Equity",
            "Total Equity Gross Minority Interest",
            "Total Equity",
        ],
        max_points=max_points,
    )

    shares_outstanding = None
    try:
        shares_outstanding = stock.info.get("sharesOutstanding")
    except Exception:
        shares_outstanding = None
    if not shares_outstanding:
        try:
            shares_outstanding = stock.fast_info.get("shares")
        except Exception:
            shares_outstanding = None

    shares_full = None
    try:
        start = (datetime.utcnow() - timedelta(days=365 * 3 + 30)).date().isoformat()
        shares_full = stock.get_shares_full(start=start)
    except Exception:
        shares_full = None

    reported_eps_series = _series_from_row(
        income_df,
        [
            "Diluted EPS",
            "Basic EPS",
            "Diluted EPS Continued Operations",
            "Basic EPS Continued Operations",
            "Diluted EPS Continuing Operations",
            "Basic EPS Continuing Operations",
            "EPS",
        ],
        max_points=max_points,
    )
    earnings_eps_series = _series_from_earnings_dates(stock, max_points=max_points)

    share_count_series = _series_from_row(
        balance_df,
        [
            "Ordinary Shares Number",
            "Share Issued",
            "Common Stock Shares Outstanding",
            "Common Stock Shares Issued",
            "Common Shares Outstanding",
            "Shares Outstanding",
        ],
        max_points=max_points,
    )
    if not share_count_series:
        share_count_series = _series_from_row(
            income_df,
            [
                "Diluted Average Shares",
                "Basic Average Shares",
                "Diluted Weighted Average Shares",
                "Basic Weighted Average Shares",
                "Weighted Average Shares",
            ],
            max_points=max_points,
        )

    eps_series = []
    eps_derived = False
    if reported_eps_series:
        eps_series = reported_eps_series
        if len(eps_series) < max_points and earnings_eps_series:
            eps_series = _merge_series(eps_series, earnings_eps_series, max_points)
    elif net_income_series:
        share_by_date = {point["date"]: point["value"] for point in share_count_series}
        if share_by_date:
            for point in net_income_series:
                shares = share_by_date.get(point["date"])
                if shares is None or shares == 0:
                    continue
                eps_series.append(
                    {
                        "date": point["date"],
                        "value": float(point["value"]) / float(shares),
                    }
                )
            eps_derived = True
        elif shares_outstanding:
            for point in net_income_series:
                eps_series.append(
                    {
                        "date": point["date"],
                        "value": float(point["value"]) / float(shares_outstanding),
                    }
                )
            eps_derived = True
    if not eps_series and earnings_eps_series:
        eps_series = earnings_eps_series
        eps_derived = False

    roe_series = []
    if net_income_series and equity_series:
        equity_by_date = {point["date"]: point["value"] for point in equity_series}
        for point in net_income_series:
            equity_value = equity_by_date.get(point["date"])
            if equity_value is None or equity_value == 0:
                continue
            roe_series.append(
                {
                    "date": point["date"],
                    "value": float(point["value"]) / float(equity_value) * 100,
                }
            )

    fcf_series = []
    if not cashflow_df.empty:
        free_cash = _row_series(cashflow_df, ["Free Cash Flow"])
        if free_cash is not None and not free_cash.empty:
            for col, value in free_cash.items():
                if pd.isna(value):
                    continue
                date = pd.to_datetime(col, errors="coerce")
                if pd.isna(date):
                    continue
                fcf_series.append({"date": date.date().isoformat(), "value": float(value)})
        else:
            operating = _row_series(
                cashflow_df,
                [
                    "Total Cash From Operating Activities",
                    "Operating Cash Flow",
                    "Total Cash From Operating Activities Continued Operations",
                ],
            )
            capex = _row_series(
                cashflow_df,
                [
                    "Capital Expenditures",
                    "CapitalExpenditures",
                    "Capital Expenditure",
                ],
            )
            if operating is not None and capex is not None:
                for col, op_value in operating.items():
                    cap_value = capex.get(col)
                    if pd.isna(op_value) or pd.isna(cap_value):
                        continue
                    date = pd.to_datetime(col, errors="coerce")
                    if pd.isna(date):
                        continue
                    fcf_series.append(
                        {"date": date.date().isoformat(), "value": float(op_value) + float(cap_value)}
                    )

    fcf_derived = True
    if _row_series(cashflow_df, ["Free Cash Flow"]) is not None:
        fcf_derived = False

    market_cap_series = []
    shares_by_date = {point["date"]: point["value"] for point in share_count_series}
    if shares_by_date:
        for date_str, shares in shares_by_date.items():
            date = pd.to_datetime(date_str, errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None or shares is None or shares == 0:
                continue
            market_cap_series.append(
                {"date": date.date().isoformat(), "value": float(price) * float(shares)}
            )
    market_cap_full = []
    if isinstance(shares_full, pd.Series) and not shares_full.empty:
        for point in eps_series or []:
            date = pd.to_datetime(point["date"], errors="coerce")
            if pd.isna(date):
                continue
            shares = _value_on_or_before(shares_full, date)
            price = _price_on_or_before(price_df, date)
            if shares is None or price is None:
                continue
            market_cap_full.append(
                {"date": date.date().isoformat(), "value": float(price) * float(shares)}
            )
    if market_cap_full:
        market_cap_series = _merge_series(market_cap_series, market_cap_full, max_points)
    elif shares_outstanding:
        quarter_dates = sorted(
            {
                point["date"]
                for series in (net_income_series, equity_series, fcf_series, eps_series)
                for point in series
            }
        )
        if not quarter_dates:
            quarter_dates = _last_quarter_dates(price_df, max_points=max_points)
        for date_str in quarter_dates:
            date = pd.to_datetime(date_str, errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None:
                continue
            market_cap_series.append(
                {"date": date.date().isoformat(), "value": float(price) * float(shares_outstanding)}
            )

    pe_series = []
    if eps_series:
        eps_series_sorted = sorted(eps_series, key=lambda item: item["date"])
        for idx, point in enumerate(eps_series_sorted):
            if idx < 3:
                continue
            trailing_eps = sum(p["value"] for p in eps_series_sorted[idx - 3 : idx + 1])
            if trailing_eps <= 0:
                continue
            date = pd.to_datetime(point["date"], errors="coerce")
            if pd.isna(date):
                continue
            price = _price_on_or_before(price_df, date)
            if price is None:
                continue
            pe_series.append({"date": point["date"], "value": float(price) / trailing_eps})

    def _limit(series: list, limit: int) -> list:
        series.sort(key=lambda item: item["date"])
        return series[-limit:]

    revenue_yoy_series = []
    if revenue_series:
        revenue_sorted = sorted(revenue_series, key=lambda item: item["date"])
        for idx in range(4, len(revenue_sorted)):
            current = revenue_sorted[idx]
            prior = revenue_sorted[idx - 4]
            prior_value = prior.get("value")
            current_value = current.get("value")
            if prior_value is None or current_value is None or prior_value == 0:
                continue
            revenue_yoy_series.append(
                {
                    "date": current["date"],
                    "value": (float(current_value) - float(prior_value)) / float(prior_value) * 100,
                }
            )

    return {
        "as_of": datetime.utcnow().isoformat(),
        "eps": {"series": _limit(eps_series, max_points), "derived": eps_derived},
        "roe": {"series": _limit(roe_series, max_points), "derived": True},
        "free_cash_flow": {"series": _limit(fcf_series, max_points), "derived": fcf_derived},
        "market_cap": {"series": _limit(market_cap_series, max_points), "derived": True},
        "pe_ratio": {"series": _limit(pe_series, max_points), "derived": True},
        "revenue": {"series": _limit(revenue_series, max_points), "derived": False},
        "revenue_yoy": {"series": _limit(revenue_yoy_series, max_points), "derived": True},
    }

def _is_yahoo_rate_limit_message(message: str) -> bool:
    message = (message or "").lower()
    return (
        "too many requests" in message
        or "rate limited" in message
        or "429" in message
    )


def _is_yahoo_rate_limit_error(exc: Exception) -> bool:
    return _is_yahoo_rate_limit_message(str(exc))


def _normalize_yf_download_frame(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Normalize yfinance download output to a single-ticker OHLCV frame."""
    if df is None or df.empty:
        return pd.DataFrame()

    normalized = df.copy()
    if isinstance(normalized.columns, pd.MultiIndex):
        try:
            # Typical shape: (PriceField, Ticker) for single-symbol downloads.
            normalized = normalized.droplevel(-1, axis=1)
        except Exception:
            try:
                # Fallback for other MultiIndex layouts.
                normalized = normalized.xs(ticker, axis=1, level=-1)
            except Exception:
                return pd.DataFrame()
    return normalized


def fetch_stock_data(ticker: str, days: int = 2000) -> pd.DataFrame:
    """Fetch historical price data for a stock with retries/fallback for transient upstream failures."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    errors: list[str] = []

    attempts = [
        lambda: yf.Ticker(ticker).history(start=start_date, end=end_date),
        lambda: _normalize_yf_download_frame(
            yf.download(
                ticker,
                start=start_date,
                end=end_date,
                progress=False,
                threads=False,
                auto_adjust=False,
            ),
            ticker,
        ),
    ]

    for index, attempt in enumerate(attempts):
        try:
            df = attempt()
            if df is None or df.empty:
                errors.append("No data returned")
                continue
            if "Close" not in df.columns:
                errors.append("Missing Close column in price data")
                continue
            df["returns"] = df["Close"].pct_change()
            return df
        except Exception as exc:
            errors.append(str(exc))
            if _is_yahoo_rate_limit_error(exc) and index < len(attempts) - 1:
                time.sleep(1.0)
            continue

    if any(_is_yahoo_rate_limit_message(msg) for msg in errors if msg):
        raise HTTPException(
            status_code=429,
            detail=f"Unable to fetch data for {ticker}: Yahoo Finance rate limit. Try again shortly.",
        )

    detail = "; ".join(err for err in errors if err) or "Unknown upstream fetch error."
    raise HTTPException(status_code=404, detail=f"Unable to fetch data for {ticker}: {detail}")


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
        expiry = None
        calls = pd.DataFrame()
        puts = pd.DataFrame()
        for exp in expiries:
            try:
                chain = stock.option_chain(exp)
            except Exception:
                continue
            calls = chain.calls if chain and hasattr(chain, "calls") else pd.DataFrame()
            puts = chain.puts if chain and hasattr(chain, "puts") else pd.DataFrame()
            if not calls.empty or not puts.empty:
                expiry = exp
                break

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

    def collect_iv_values(df: pd.DataFrame) -> None:
        if df is None or df.empty:
            return
        iv_series = df.get("impliedVolatility")
        if iv_series is None:
            return
        for val in iv_series.dropna().tolist():
            if val and val > 0:
                iv_values.append(float(val) * 100)

    for expiry, _ in front_expiries:
        try:
            chain = stock.option_chain(expiry)
        except Exception:
            continue

        calls = chain.calls if chain and hasattr(chain, "calls") else pd.DataFrame()
        puts = chain.puts if chain and hasattr(chain, "puts") else pd.DataFrame()

        thresholds = [0.05, 0.1, 0.2]
        near_calls = pd.DataFrame()
        near_puts = pd.DataFrame()
        near_chain = pd.DataFrame()
        for threshold in thresholds:
            near_calls = _near_atm(calls, current_price, threshold)
            near_puts = _near_atm(puts, current_price, threshold)
            near_chain = pd.concat([near_calls, near_puts], ignore_index=True)
            if not near_chain.empty:
                break

        if near_chain.empty:
            collect_iv_values(pd.concat([calls, puts], ignore_index=True))
            continue

        collect_iv_values(near_chain)

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

        if expiry == target_expiry:
            iv_series = near_chain.get("impliedVolatility")
            if iv_series is not None and not iv_series.dropna().empty:
                iv30 = round(float(iv_series.dropna().median() * 100), 2)

    iv_percentile = None
    if iv30 is None and iv_values:
        iv30 = round(float(np.median(iv_values)), 2)

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
    return max(0.0, stop_loss)


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

    fundamentals = compute_fundamentals(stock, df)
    
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
        "fundamentals": fundamentals,
    }
    
    # Sanitize NaN/Inf values before returning
    return sanitize_for_json(result)
