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


@router.get("/indicators/BOND_MARKET_STABILITY/components")
async def get_bond_composite_components(days: int = 365):
    """
    Return component breakdown for Bond Market Stability Composite.
    Shows the 5 sub-indicators and their weighted contributions.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    from app.services.ingestion.yahoo_client import YahooClient
    import asyncio
    import numpy as np
    
    cutoff = datetime.utcnow() - timedelta(days=days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    # Fetch all sub-indicators
    async def fetch_all_components():
        fred = FredClient()
        yahoo = YahooClient()
        
        # Fetch in parallel
        hy_oas_data = await fred.fetch_series("BAMLH0A0HYM2", start_date=start_date)
        ig_oas_data = await fred.fetch_series("BAMLC0A0CM", start_date=start_date)
        dgs10_data = await fred.fetch_series("DGS10", start_date=start_date)
        dgs2_data = await fred.fetch_series("DGS2", start_date=start_date)
        dgs3mo_data = await fred.fetch_series("DGS3MO", start_date=start_date)
        move_data = yahoo.fetch_series("^MOVE", start_date=start_date)
        term_premium_data = await fred.fetch_series("ACMTP10", start_date=start_date)
        
        return {
            'hy_oas': hy_oas_data,
            'ig_oas': ig_oas_data,
            'dgs10': dgs10_data,
            'dgs2': dgs2_data,
            'dgs3mo': dgs3mo_data,
            'move': move_data,
            'term_premium': term_premium_data,
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
    move = series_to_dict(components['move'])
    term_premium = series_to_dict(components['term_premium'])
    
    # Find common dates
    all_dates = set(hy_oas.keys()) & set(ig_oas.keys()) & set(dgs10.keys()) & \
                set(dgs2.keys()) & set(dgs3mo.keys()) & set(move.keys()) & \
                set(term_premium.keys())
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
    dgs10_vals = [dgs10[d] for d in common_dates]
    dgs2_vals = [dgs2[d] for d in common_dates]
    dgs3mo_vals = [dgs3mo[d] for d in common_dates]
    move_vals = [move[d] for d in common_dates]
    tp_vals = [term_premium[d] for d in common_dates]
    
    # Calculate scores for each component
    hy_scores = calc_scores(hy_vals, invert=False)
    ig_scores = calc_scores(ig_vals, invert=False)
    credit_scores = [(h + i) / 2 for h, i in zip(hy_scores, ig_scores)]
    
    # Yield curves
    curve_10y2y = [d10 - d2 for d10, d2 in zip(dgs10_vals, dgs2_vals)]
    curve_10y3m = [d10 - d3m for d10, d3m in zip(dgs10_vals, dgs3mo_vals)]
    avg_curves = [(c1 + c2) / 2 for c1, c2 in zip(curve_10y2y, curve_10y3m)]
    curve_scores = calc_scores(avg_curves, invert=True)
    
    # Rates momentum (3-month ROC)
    def calc_roc(vals, periods=63):
        roc = [0.0] * periods
        for i in range(periods, len(vals)):
            roc.append(vals[i] - vals[i - periods])
        return roc
    
    roc_2y = calc_roc(dgs2_vals)
    roc_10y = calc_roc(dgs10_vals)
    avg_roc = [(r2 + r10) / 2 for r2, r10 in zip(roc_2y, roc_10y)]
    momentum_scores = calc_scores(avg_roc, invert=False)
    
    # MOVE and term premium
    move_scores = calc_scores(move_vals, invert=False)
    tp_scores = calc_scores(tp_vals, invert=False)
    
    # Weights
    weights = {'credit': 0.40, 'curve': 0.20, 'momentum': 0.15, 'move': 0.15, 'premium': 0.10}
    
    # Build result
    result = []
    for i, date in enumerate(common_dates):
        composite_stress = (
            credit_scores[i] * weights['credit'] +
            curve_scores[i] * weights['curve'] +
            momentum_scores[i] * weights['momentum'] +
            move_scores[i] * weights['move'] +
            tp_scores[i] * weights['premium']
        )
        composite_stability = 100 - composite_stress
        
        result.append({
            "date": date,
            "credit_spread": {
                "hy_oas": hy_vals[i],
                "ig_oas": ig_vals[i],
                "score": credit_scores[i],
                "weight": weights['credit'],
            },
            "yield_curve": {
                "spread_10y2y": curve_10y2y[i],
                "spread_10y3m": curve_10y3m[i],
                "score": curve_scores[i],
                "weight": weights['curve'],
            },
            "rates_momentum": {
                "roc_2y": roc_2y[i],
                "roc_10y": roc_10y[i],
                "score": momentum_scores[i],
                "weight": weights['momentum'],
            },
            "treasury_volatility": {
                "move_index": move_vals[i],
                "score": move_scores[i],
                "weight": weights['move'],
            },
            "term_premium": {
                "value": tp_vals[i],
                "score": tp_scores[i],
                "weight": weights['premium'],
            },
            "composite": {
                "stress_score": composite_stress,
                "stability_score": composite_stability,
            }
        })
    
    return result