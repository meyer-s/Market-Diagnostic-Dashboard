from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from typing import List, Generator

from app.core.db import SessionLocal
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.services.indicator_metadata import get_indicator_metadata

router = APIRouter()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/indicators")
def list_indicators():
    """Return basic metadata for all indicators."""
    db = SessionLocal()
    indicators: List[Indicator] = db.query(Indicator).all()
    db.close()

    return [
        {
            "code": ind.code,
            "name": ind.name,
            "source": ind.source,
            "source_symbol": ind.source_symbol,
            "category": ind.category,
            "direction": ind.direction,
            "lookback_days_for_z": ind.lookback_days_for_z,
            "threshold_green_max": ind.threshold_green_max,
            "threshold_yellow_max": ind.threshold_yellow_max,
            "weight": ind.weight,
        }
        for ind in indicators
    ]


@router.get("/indicators/{code}")
def get_indicator_detail(code: str):
    """Return metadata + latest value for a single indicator."""
    db = SessionLocal()

    ind: Indicator | None = (
        db.query(Indicator)
        .filter(Indicator.code == code)
        .first()
    )

    if not ind:
        db.close()
        raise HTTPException(status_code=404, detail=f"Indicator {code} not found")

    latest: IndicatorValue | None = (
        db.query(IndicatorValue)
        .filter(IndicatorValue.indicator_id == ind.id)
        .order_by(IndicatorValue.timestamp.desc())
        .first()
    )

    metadata = get_indicator_metadata(code)
    
    db.close()

    if not latest:
        return {
            "code": ind.code,
            "name": ind.name,
            "has_data": False,
            "metadata": metadata,
        }

    return {
        "code": ind.code,
        "name": ind.name,
        "source": ind.source,
        "source_symbol": ind.source_symbol,
        "category": ind.category,
        "direction": ind.direction,
        "lookback_days_for_z": ind.lookback_days_for_z,
        "threshold_green_max": ind.threshold_green_max,
        "threshold_yellow_max": ind.threshold_yellow_max,
        "weight": ind.weight,
        "latest": {
            "timestamp": latest.timestamp.isoformat(),
            "raw_value": latest.raw_value,
            "normalized_value": latest.normalized_value,
            "score": latest.score,
            "state": latest.state,
        },
        "metadata": metadata,
    }


@router.get("/indicators/{code}/history")
def get_indicator_history(code: str, days: int = 365):
    """Return time-series history for a single indicator (raw + score + state)."""
    from datetime import datetime, timedelta

    db = SessionLocal()

    ind: Indicator | None = (
        db.query(Indicator)
        .filter(Indicator.code == code)
        .first()
    )

    if not ind:
        db.close()
        raise HTTPException(status_code=404, detail=f"Indicator {code} not found")

    cutoff = datetime.utcnow() - timedelta(days=days)

    values: List[IndicatorValue] = (
        db.query(IndicatorValue)
        .filter(
            IndicatorValue.indicator_id == ind.id,
            IndicatorValue.timestamp >= cutoff,
        )
        .order_by(IndicatorValue.timestamp.asc())
        .all()
    )

    db.close()

    return [
        {
            "timestamp": v.timestamp.isoformat(),
            "raw_value": v.raw_value,
            "score": v.score,
            "state": v.state,
        }
        for v in values
    ]


# Note: Specific routes must be defined BEFORE generic routes
# so FastAPI matches them correctly

@router.get("/indicators/BOND_MARKET_STABILITY/components")
async def get_bond_composite_components(days: int = 365):
    """
    Return component breakdown for Bond Market Stability Composite.
    Shows the 4 sub-indicators and their weighted contributions.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    import numpy as np
    
    cutoff = datetime.utcnow() - timedelta(days=days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    # Fetch all sub-indicators
    async def fetch_all_components():
        fred = FredClient()
        
        # Fetch in parallel
        hy_oas_data = await fred.fetch_series("BAMLH0A0HYM2", start_date=start_date)
        ig_oas_data = await fred.fetch_series("BAMLC0A0CM", start_date=start_date)
        dgs10_data = await fred.fetch_series("DGS10", start_date=start_date)
        dgs2_data = await fred.fetch_series("DGS2", start_date=start_date)
        dgs3mo_data = await fred.fetch_series("DGS3MO", start_date=start_date)
        dgs30_data = await fred.fetch_series("DGS30", start_date=start_date)
        dgs5_data = await fred.fetch_series("DGS5", start_date=start_date)
        
        return {
            'hy_oas': hy_oas_data,
            'ig_oas': ig_oas_data,
            'dgs10': dgs10_data,
            'dgs2': dgs2_data,
            'dgs3mo': dgs3mo_data,
            'dgs30': dgs30_data,
            'dgs5': dgs5_data,
        }
    
    components = await fetch_all_components()
    
    # Convert to dicts for alignment
    def series_to_dict(s):
        return {x["date"]: x["value"] for x in s if x["value"] is not None}
    
    hy_oas = series_to_dict(components['hy_oas'])
    ig_oas = series_to_dict(components['ig_oas'])
    dgs10 = series_to_dict(components['dgs10'])
    dgs2 = series_to_dict(components['dgs2'])
    dgs3mo = series_to_dict(components['dgs3mo'])
    dgs30 = series_to_dict(components['dgs30'])
    dgs5 = series_to_dict(components['dgs5'])
    
    # Find common dates (only FRED sources)
    all_dates = set(hy_oas.keys()) & set(ig_oas.keys()) & set(dgs10.keys()) & \
                set(dgs2.keys()) & set(dgs3mo.keys()) & set(dgs30.keys()) & set(dgs5.keys())
    common_dates = sorted(all_dates)
    
    # Helper: z-score to 0-100
    def calc_scores(vals, invert=False):
        vals_arr = np.array(vals)
        mean = np.mean(vals_arr)
        std = np.std(vals_arr)
        if std == 0:
            return [50.0] * len(vals)
        z_scores = (vals_arr - mean) / std
        if invert:
            z_scores = -z_scores
        scores = 50 + (z_scores * 25)
        return np.clip(scores, 0, 100).tolist()
    
    # Extract values for each date
    hy_vals = [hy_oas[d] for d in common_dates]
    ig_vals = [ig_oas[d] for d in common_dates]
    dgs10_vals = np.array([dgs10[d] for d in common_dates])
    dgs2_vals = [dgs2[d] for d in common_dates]
    dgs3mo_vals = [dgs3mo[d] for d in common_dates]
    dgs30_vals = [dgs30[d] for d in common_dates]
    dgs5_vals = [dgs5[d] for d in common_dates]
    
    # Calculate scores for each component
    hy_scores = calc_scores(hy_vals, invert=False)
    ig_scores = calc_scores(ig_vals, invert=False)
    credit_scores = [(h + i) / 2 for h, i in zip(hy_scores, ig_scores)]
    
    # Yield curves (using 3 curves for better coverage)
    curve_10y2y = [d10 - d2 for d10, d2 in zip(dgs10_vals, dgs2_vals)]
    curve_10y3m = [d10 - d3m for d10, d3m in zip(dgs10_vals, dgs3mo_vals)]
    curve_30y5y = [d30 - d5 for d30, d5 in zip(dgs30_vals, dgs5_vals)]
    avg_curves = [(c1 + c2 + c3) / 3 for c1, c2, c3 in zip(curve_10y2y, curve_10y3m, curve_30y5y)]
    curve_scores = calc_scores(avg_curves, invert=True)
    
    # Rates momentum (3-month ROC)
    def calc_roc(vals, periods=63):
        roc = [0.0] * periods
        for i in range(periods, len(vals)):
            roc.append(vals[i] - vals[i - periods])
        return roc
    
    roc_2y = calc_roc(dgs2_vals)
    roc_10y = calc_roc(dgs10_vals.tolist())
    avg_roc = [(r2 + r10) / 2 for r2, r10 in zip(roc_2y, roc_10y)]
    momentum_scores = calc_scores(avg_roc, invert=False)
    
    # Calculate Treasury volatility (20-day rolling std dev of absolute daily changes)
    treasury_vol = []
    window = 20
    for i in range(len(dgs10_vals)):
        if i < window:
            # Use expanding window for first 20 periods
            start_idx = 0
            window_data = dgs10_vals[start_idx:i+1]
        else:
            # Use 20-day rolling window
            window_data = dgs10_vals[i-window:i]
        
        if len(window_data) > 1:
            # Calculate absolute daily changes
            changes = np.abs(np.diff(window_data))
            vol = np.std(changes)
        else:
            vol = 0.0
        treasury_vol.append(vol)
    
    vol_scores = calc_scores(treasury_vol, invert=False)
    
    # Updated weights (no term premium)
    weights = {'credit': 0.44, 'curve': 0.23, 'momentum': 0.17, 'volatility': 0.16}
    
    # Build result
    result = []
    for i, date in enumerate(common_dates):
        composite_stress = (
            credit_scores[i] * weights['credit'] +
            curve_scores[i] * weights['curve'] +
            momentum_scores[i] * weights['momentum'] +
            vol_scores[i] * weights['volatility']
        )
        
        result.append({
            "date": date,
            "credit_spread_stress": {
                "hy_oas": hy_vals[i],
                "ig_oas": ig_vals[i],
                "stress_score": credit_scores[i],
                "weight": weights['credit'],
                "contribution": credit_scores[i] * weights['credit'],
            },
            "yield_curve_stress": {
                "spread_10y2y": curve_10y2y[i],
                "spread_10y3m": curve_10y3m[i],
                "spread_30y5y": curve_30y5y[i],
                "stress_score": curve_scores[i],
                "weight": weights['curve'],
                "contribution": curve_scores[i] * weights['curve'],
            },
            "rates_momentum_stress": {
                "roc_2y": roc_2y[i],
                "roc_10y": roc_10y[i],
                "stress_score": momentum_scores[i],
                "weight": weights['momentum'],
                "contribution": momentum_scores[i] * weights['momentum'],
            },
            "treasury_volatility_stress": {
                "calculated_volatility": treasury_vol[i],
                "stress_score": vol_scores[i],
                "weight": weights['volatility'],
                "contribution": vol_scores[i] * weights['volatility'],
            },
            "composite": {
                "stress_score": composite_stress,
            }
        })
    
    return result


@router.get("/indicators/LIQUIDITY_PROXY/components")
async def get_liquidity_proxy_components(days: int = 365):
    """
    Return component breakdown for Liquidity Proxy Indicator.
    Shows M2 YoY%, Fed balance sheet delta, and RRP usage.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    import numpy as np
    
    # Fetch extra historical data for lookback calculations (252 days for YoY)
    fetch_days = days + 252 + 30  # Extra buffer for weekends/holidays
    cutoff = datetime.utcnow() - timedelta(days=fetch_days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    # Fetch all components
    async def fetch_all_components():
        fred = FredClient()
        
        m2_data = await fred.fetch_series("M2SL", start_date=start_date)
        fed_bs_data = await fred.fetch_series("WALCL", start_date=start_date)
        rrp_data = await fred.fetch_series("RRPONTSYD", start_date=start_date)
        
        return {
            'm2': m2_data,
            'fed_bs': fed_bs_data,
            'rrp': rrp_data,
        }
    
    components = await fetch_all_components()
    
    # Convert to dicts
    def series_to_dict(s):
        return {x["date"]: x["value"] for x in s if x["value"] is not None}
    
    m2_dict = series_to_dict(components['m2'])
    fed_bs_dict = series_to_dict(components['fed_bs'])
    rrp_dict = series_to_dict(components['rrp'])
    
    # Use RRP dates as base (most frequent updates) and forward-fill M2 and Fed BS
    all_dates = sorted(set(rrp_dict.keys()))
    
    # Forward-fill M2 and Fed BS values
    def forward_fill(source_dict, all_dates):
        result = []
        last_value = None
        for date in all_dates:
            if date in source_dict:
                last_value = source_dict[date]
            if last_value is not None:
                result.append(last_value)
            else:
                result.append(0.0)  # Default if no data yet
        return result
    
    m2_vals = np.array(forward_fill(m2_dict, all_dates))
    fed_bs_vals = np.array(forward_fill(fed_bs_dict, all_dates))
    rrp_vals = np.array([rrp_dict.get(d, 0.0) for d in all_dates])
    common_dates = all_dates
    
    # Calculate M2 YoY% (252 trading days ≈ 1 year)
    m2_yoy = []
    lookback = 252
    for i in range(len(m2_vals)):
        if i < lookback:
            m2_yoy.append(0.0)
        else:
            yoy_pct = ((m2_vals[i] - m2_vals[i - lookback]) / m2_vals[i - lookback]) * 100
            m2_yoy.append(yoy_pct)
    
    # Calculate Fed balance sheet delta (month-over-month ≈ 21 trading days)
    fed_bs_delta = []
    mom_window = 21
    for i in range(len(fed_bs_vals)):
        if i < mom_window:
            fed_bs_delta.append(0.0)
        else:
            delta = fed_bs_vals[i] - fed_bs_vals[i - mom_window]
            fed_bs_delta.append(delta)
    
    # Helper: compute z-score
    def compute_z_score(vals):
        mean = np.mean(vals)
        std = np.std(vals)
        if std == 0:
            return np.zeros_like(vals)
        return (vals - mean) / std
    
    # Compute z-scores
    z_m2_yoy = compute_z_score(np.array(m2_yoy))
    z_fed_delta = compute_z_score(np.array(fed_bs_delta))
    z_rrp = compute_z_score(rrp_vals)
    
    # Formula: Liquidity = z(M2_YoY) + z(ΔFedBS) - z(RRP_level)
    liquidity_proxy = z_m2_yoy + z_fed_delta - z_rrp
    
    # Map to stress score: 50 - (liquidity_proxy * 15), clipped to [0, 100]
    liquidity_stress = np.clip(50 - (liquidity_proxy * 15), 0, 100)
    
    # Build result
    result = []
    for i, date in enumerate(common_dates):
        result.append({
            "date": date,
            "m2_money_supply": {
                "value": m2_vals[i],
                "yoy_pct": m2_yoy[i],
                "z_score": float(z_m2_yoy[i]),
            },
            "fed_balance_sheet": {
                "value": fed_bs_vals[i],
                "delta": fed_bs_delta[i],
                "z_score": float(z_fed_delta[i]),
            },
            "reverse_repo": {
                "value": rrp_vals[i],
                "z_score": float(z_rrp[i]),
            },
            "composite": {
                "liquidity_proxy": float(liquidity_proxy[i]),
                "stress_score": float(liquidity_stress[i]),
            }
        })
    
    # Filter to only return the requested days (after using full history for calculations)
    from datetime import datetime, timedelta
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]
    
    return result


@router.get("/indicators/{code}/components")
def get_indicator_components(code: str, days: int = 365):
    """
    Return component breakdown for derived indicators.
    Currently supports: CONSUMER_HEALTH (returns PCE, PI, CPI data)
    """
    from datetime import datetime, timedelta
    import asyncio
    from app.services.ingestion.fred_client import FredClient
    
    if code != "CONSUMER_HEALTH":
        raise HTTPException(
            status_code=400, 
            detail=f"Component breakdown not available for {code}"
        )
    
    # Fetch component data
    async def fetch_components():
        client = FredClient()
        cutoff = datetime.utcnow() - timedelta(days=days)
        start_date = cutoff.strftime("%Y-%m-%d")
        
        pce_series = await client.fetch_series("PCE", start_date=start_date)
        cpi_series = await client.fetch_series("CPIAUCSL", start_date=start_date)
        pi_series = await client.fetch_series("PI", start_date=start_date)
        
        return pce_series, cpi_series, pi_series
    
    pce_data, cpi_data, pi_data = asyncio.run(fetch_components())
    
    # Calculate MoM% for each
    def calc_mom_pct(series):
        result = []
        for i in range(len(series)):
            if i == 0:
                result.append({"date": series[i]["date"], "value": series[i]["value"], "mom_pct": 0.0})
            else:
                prev_val = series[i-1]["value"]
                curr_val = series[i]["value"]
                mom_pct = ((curr_val - prev_val) / prev_val * 100) if prev_val != 0 else 0.0
                result.append({"date": series[i]["date"], "value": curr_val, "mom_pct": mom_pct})
        return result
    
    pce_with_mom = calc_mom_pct(pce_data)
    cpi_with_mom = calc_mom_pct(cpi_data)
    pi_with_mom = calc_mom_pct(pi_data)
    
    # Align by date and calculate spreads
    pce_dict = {x["date"]: x for x in pce_with_mom}
    cpi_dict = {x["date"]: x for x in cpi_with_mom}
    pi_dict = {x["date"]: x for x in pi_with_mom}
    
    common_dates = sorted(set(pce_dict.keys()) & set(cpi_dict.keys()) & set(pi_dict.keys()))
    
    result = []
    for date in common_dates:
        pce_mom = pce_dict[date]["mom_pct"]
        cpi_mom = cpi_dict[date]["mom_pct"]
        pi_mom = pi_dict[date]["mom_pct"]
        
        pce_vs_cpi = pce_mom - cpi_mom
        pi_vs_cpi = pi_mom - cpi_mom
        consumer_health = pce_vs_cpi + pi_vs_cpi
        
        result.append({
            "date": date,
            "pce": {
                "value": pce_dict[date]["value"],
                "mom_pct": pce_mom,
            },
            "cpi": {
                "value": cpi_dict[date]["value"],
                "mom_pct": cpi_mom,
            },
            "pi": {
                "value": pi_dict[date]["value"],
                "mom_pct": pi_mom,
            },
            "spreads": {
                "pce_vs_cpi": pce_vs_cpi,
                "pi_vs_cpi": pi_vs_cpi,
                "consumer_health": consumer_health,
            }
        })
    
    return result
