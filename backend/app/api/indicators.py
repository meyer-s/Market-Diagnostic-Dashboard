from fastapi import APIRouter, HTTPException, Query
from typing import List

from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.services.indicator_metadata import get_indicator_metadata, normalize_indicator_code
from app.utils.db_helpers import get_db_session
from app.utils.response_helpers import (
    format_indicator_basic,
    format_indicator_detail,
    format_indicator_history,
)
from app.services.muni_data import get_muni_subsystem
from app.models.virtual_indicator import VirtualIndicator
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.models.system_status import SystemStatus

router = APIRouter()

# Sector classifications for virtual indicator
DEFENSIVE_SECTORS = ["XLU", "XLP", "XLV"]
CYCLICAL_SECTORS = ["XLE", "XLF", "XLK", "XLY"]


def compute_sector_regime_alignment():
    """
    Compute a virtual indicator score for sector regime alignment.
    Returns (score, raw_value, state) tuple.
    
    Logic:
    - In RED market: Defensives should outperform cyclicals (score increases with spread)
    - In GREEN market: Cyclicals should outperform defensives (score increases with negative spread)
    - Score ranges 0-100, thresholds: RED<45, YELLOW 45-65, GREEN>65
    """
    with get_db_session() as db:
        # Get latest projection run and system state
        run = db.query(SectorProjectionRun).order_by(SectorProjectionRun.as_of_date.desc()).first()
        if not run:
            return (50.0, 0.0, "YELLOW")  # Default if no data
        
        # Get 3m projections (most recent)
        values_3m = db.query(SectorProjectionValue).filter_by(
            run_id=run.id, 
            horizon="3m"
        ).all()
        
        # Calculate defensive vs cyclical averages
        defensive_scores = [v.score_total for v in values_3m if v.sector_symbol in DEFENSIVE_SECTORS]
        cyclical_scores = [v.score_total for v in values_3m if v.sector_symbol in CYCLICAL_SECTORS]
        
        if not defensive_scores or not cyclical_scores:
            return (50.0, 0.0, "YELLOW")
        
        defensive_avg = sum(defensive_scores) / len(defensive_scores)
        cyclical_avg = sum(cyclical_scores) / len(cyclical_scores)
        spread = defensive_avg - cyclical_avg  # Positive = defensives leading
        
        # Get system state
        system_state = run.system_state  # Stored in projection run
        
        # Score calculation
        if system_state == "RED":
            # RED market: Want defensives to lead (positive spread is good)
            # spread range typically -20 to +20
            # Map +20 → 100, 0 → 50, -20 → 0
            alignment_score = 50 + (spread * 2.5)
        elif system_state == "GREEN":
            # GREEN market: Want cyclicals to lead (negative spread is good)
            # Map -20 → 100, 0 → 50, +20 → 0
            alignment_score = 50 - (spread * 2.5)
        else:  # YELLOW
            # YELLOW market: Balanced is fine, penalize extreme divergence
            # Map small spreads to higher scores
            alignment_score = 100 - abs(spread * 2)
        
        # Clamp to 0-100
        alignment_score = max(0, min(100, alignment_score))
        
        # Determine state
        if alignment_score >= 65:
            state = "GREEN"
        elif alignment_score >= 45:
            state = "YELLOW"
        else:
            state = "RED"
        
        return (alignment_score, spread, state)


# Register virtual indicator
SECTOR_REGIME_ALIGNMENT = VirtualIndicator(
    code="SECTOR_REGIME_ALIGNMENT",
    name="Sector Regime Alignment",
    description="Measures whether sector leadership (defensive vs cyclical) matches expected market regime patterns",
    compute_fn=compute_sector_regime_alignment,
    weight=1.5,
)


@router.get("/indicators/metadata")
def list_indicators():
    """Return basic metadata for all indicators (including virtual ones)."""
    with get_db_session() as db:
        # Get database indicators
        indicators: List[Indicator] = db.query(Indicator).all()
        result = [format_indicator_basic(ind) for ind in indicators]
        
        # Add virtual indicator
        virtual_data = SECTOR_REGIME_ALIGNMENT.compute()
        result.append({
            "code": virtual_data["code"],
            "name": virtual_data["name"],
            "state": virtual_data["state"],
            "description": virtual_data["description"],
            "weight": virtual_data["weight"],
            "is_virtual": True,
        })
        
        return result


@router.get("/indicators/{code}")
def get_indicator_detail(code: str):
    """Return metadata + latest value for a single indicator (including virtual ones)."""
    # Check if it's a virtual indicator
    if code == "SECTOR_REGIME_ALIGNMENT":
        virtual_data = SECTOR_REGIME_ALIGNMENT.compute()
        return {
            "code": virtual_data["code"],
            "name": virtual_data["name"],
            "description": virtual_data["description"],
            "weight": virtual_data["weight"],
            "latest_value": virtual_data["score"],
            "latest_timestamp": virtual_data["timestamp"],
            "state": virtual_data["state"],
            "raw_value": virtual_data["raw_value"],
            "is_virtual": True,
        }
    
    canonical_code = normalize_indicator_code(code)
    with get_db_session() as db:
        ind: Indicator | None = (
            db.query(Indicator)
            .filter(Indicator.code == canonical_code)
            .first()
        )

        if not ind:
            raise HTTPException(status_code=404, detail=f"Indicator {code} not found")

        latest: IndicatorValue | None = (
            db.query(IndicatorValue)
            .filter(IndicatorValue.indicator_id == ind.id)
            .order_by(IndicatorValue.timestamp.desc())
            .first()
        )

        metadata = get_indicator_metadata(canonical_code)
        
        return format_indicator_detail(ind, latest, metadata)


@router.get("/indicators/{code}/history")
def get_indicator_history(code: str, days: int = Query(365, ge=1, le=1095)):
    """Return time-series history for a single indicator (raw + score + state)."""
    # Virtual indicators don't have historical data yet
    if code == "SECTOR_REGIME_ALIGNMENT":
        # Return current value as single-point history
        virtual_data = SECTOR_REGIME_ALIGNMENT.compute()
        return [{
            "timestamp": virtual_data["timestamp"],
            "score": virtual_data["score"],
            "raw_value": virtual_data["raw_value"],
            "state": virtual_data["state"],
        }]
    
    from datetime import datetime, timedelta

    canonical_code = normalize_indicator_code(code)
    with get_db_session() as db:
        ind: Indicator | None = (
            db.query(Indicator)
            .filter(Indicator.code == canonical_code)
            .first()
        )

        if not ind:
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

        return format_indicator_history(values)



# Note: Specific routes must be defined BEFORE generic routes
# so FastAPI matches them correctly

@router.get("/indicators/BOND_MARKET_STABILITY/components")
async def get_bond_composite_components(days: int = Query(365, ge=1, le=1095)):
    """
    Return component breakdown for Bond Market Stability Composite.
    Shows the 4 sub-indicators and their weighted contributions.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    from app.utils.data_helpers import series_to_dict, find_common_dates
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
    
    # Convert to dicts for alignment using helper
    hy_oas = series_to_dict(components['hy_oas'])
    ig_oas = series_to_dict(components['ig_oas'])
    dgs10 = series_to_dict(components['dgs10'])
    dgs2 = series_to_dict(components['dgs2'])
    dgs3mo = series_to_dict(components['dgs3mo'])
    dgs30 = series_to_dict(components['dgs30'])
    dgs5 = series_to_dict(components['dgs5'])
    
    # Find common dates using helper
    common_dates = find_common_dates(hy_oas, ig_oas, dgs10, dgs2, dgs3mo, dgs30, dgs5)
    
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
                "stability_score": 100 - credit_scores[i],
                "weight": weights['credit'],
                "contribution": credit_scores[i] * weights['credit'],
            },
            "yield_curve_stress": {
                "spread_10y2y": curve_10y2y[i],
                "spread_10y3m": curve_10y3m[i],
                "spread_30y5y": curve_30y5y[i],
                "stress_score": curve_scores[i],
                "stability_score": 100 - curve_scores[i],
                "weight": weights['curve'],
                "contribution": curve_scores[i] * weights['curve'],
            },
            "rates_momentum_stress": {
                "roc_2y": roc_2y[i],
                "roc_10y": roc_10y[i],
                "stress_score": momentum_scores[i],
                "stability_score": 100 - momentum_scores[i],
                "weight": weights['momentum'],
                "contribution": momentum_scores[i] * weights['momentum'],
            },
            "treasury_volatility_stress": {
                "calculated_volatility": treasury_vol[i],
                "stress_score": vol_scores[i],
                "stability_score": 100 - vol_scores[i],
                "weight": weights['volatility'],
                "contribution": vol_scores[i] * weights['volatility'],
            },
            "composite": {
                "stress_score": composite_stress,
                "stability_score": 100 - composite_stress,
            }
        })
    
    return result


@router.get("/indicators/BOND_MARKET_STABILITY/muni")
async def get_bond_muni_subsystem(days: int = Query(365, ge=1, le=1095)):
    """
    Return municipal credit & funding stress subsystem data.
    Includes Revdex revenue proxy, long-end municipal stress proxy,
    SIFMA swap index, and Treasury curve slope stability proxy.
    """
    data = await get_muni_subsystem(days=days)

    # Relationship signal: Muni–Corporate Divergence
    muni_score = (data.get("composite") or {}).get("score")
    bond_score = None
    with get_db_session() as db:
        ind = db.query(Indicator).filter(Indicator.code == "BOND_MARKET_STABILITY").first()
        if ind:
            latest = (
                db.query(IndicatorValue)
                .filter(IndicatorValue.indicator_id == ind.id)
                .order_by(IndicatorValue.timestamp.desc())
                .first()
            )
            bond_score = latest.score if latest else None

    spread_series = None
    for series in data.get("series", []):
        if series.get("key") == "MUNI_LONG_SPREAD":
            spread_series = series
            break

    proxy_z_60d = None
    if spread_series and spread_series.get("history"):
        values = [p.get("value") for p in spread_series["history"] if p.get("value") is not None]
        if len(values) > 61:
            changes_60d = [values[i] - values[i - 60] for i in range(60, len(values))]
            lookback = min(60, len(changes_60d))
            from app.services.analytics_stub import compute_z_scores
            z_scores = compute_z_scores(changes_60d, lookback=lookback)
            proxy_z_60d = z_scores[-1] if z_scores else None

    cond_muni = muni_score is not None and muni_score <= 45
    cond_bond = bond_score is not None and bond_score >= 65
    cond_spread = proxy_z_60d is not None and proxy_z_60d >= 1.0

    if cond_muni and cond_bond and cond_spread:
        divergence_state = "RED"
    elif cond_muni and cond_bond and proxy_z_60d is not None:
        divergence_state = "YELLOW"
    else:
        divergence_state = "GREEN"

    data["relationship_signal"] = {
        "name": "Muni–Corporate Divergence",
        "state": divergence_state,
        "message": "Public-sector funding stress diverging from corporate credit." if divergence_state != "GREEN" else None,
        "inputs": {
            "public_sector_score": muni_score,
            "bond_market_score": bond_score,
            "muni_proxy_z_60d": proxy_z_60d,
        },
    }

    return data


@router.get("/indicators/LIQUIDITY_PROXY/components")
async def get_liquidity_proxy_components(days: int = Query(365, ge=1, le=1095)):
    """
    Return component breakdown for Liquidity Proxy Indicator.
    
    Shows M2 YoY%, Fed balance sheet delta, and RRP usage with z-score normalization.
    
    Important: All numeric values are sanitized to prevent NaN/Infinity values that
    would cause JSON serialization errors. Z-score calculations use np.nan_to_num()
    and all outputs pass through safe_float() conversion.
    
    Args:
        days: Number of days of component history to return (default: 365)
    
    Returns:
        List of daily component breakdowns with M2, Fed balance sheet, RRP, and composite scores
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
    
    # Calculate M2 YoY% using calendar lookback to align with forward-filled daily series
    from datetime import datetime, timedelta
    import bisect

    date_objs = [datetime.strptime(d, "%Y-%m-%d") for d in common_dates]
    m2_yoy = []
    for i, current_date in enumerate(date_objs):
        target_date = current_date - timedelta(days=365)
        j = bisect.bisect_left(date_objs, target_date)
        if j < i and m2_vals[j] != 0:
            yoy_pct = ((m2_vals[i] - m2_vals[j]) / m2_vals[j]) * 100
            m2_yoy.append(yoy_pct)
        else:
            m2_yoy.append(0.0)
    
    # Calculate Fed balance sheet delta (month-over-month ≈ 21 trading days)
    fed_bs_delta = []
    mom_window = 21
    for i in range(len(fed_bs_vals)):
        if i < mom_window:
            fed_bs_delta.append(0.0)
        else:
            delta = fed_bs_vals[i] - fed_bs_vals[i - mom_window]
            fed_bs_delta.append(delta)
    
    # Helper: compute z-score with NaN/Inf handling
    def compute_z_score(vals):
        mean = np.mean(vals)
        std = np.std(vals)
        if std == 0 or np.isnan(std) or np.isinf(std):
            return np.zeros_like(vals)
        z_scores = (vals - mean) / std
        # Replace any NaN or Inf values with 0
        z_scores = np.nan_to_num(z_scores, nan=0.0, posinf=0.0, neginf=0.0)
        return z_scores
    
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
        # Ensure all float values are JSON-compliant (no NaN or Inf)
        def safe_float(val):
            if np.isnan(val) or np.isinf(val):
                return 0.0
            return float(val)
        
        result.append({
            "date": date,
            "m2_money_supply": {
                "value": safe_float(m2_vals[i]),
                "yoy_pct": safe_float(m2_yoy[i]),
                "z_score": safe_float(z_m2_yoy[i]),
            },
            "fed_balance_sheet": {
                "value": safe_float(fed_bs_vals[i]),
                "delta": safe_float(fed_bs_delta[i]),
                "z_score": safe_float(z_fed_delta[i]),
            },
            "reverse_repo": {
                "value": safe_float(rrp_vals[i]),
                "z_score": safe_float(z_rrp[i]),
            },
            "composite": {
                "liquidity_proxy": safe_float(liquidity_proxy[i]),
                "stress_score": safe_float(liquidity_stress[i]),
                "stability_score": safe_float(100.0 - liquidity_stress[i]),
            }
        })
    
    # Filter to only return the requested days (after using full history for calculations)
    from datetime import datetime, timedelta
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]
    
    return result


@router.get("/indicators/ANALYST_ANXIETY/components")
async def get_analyst_anxiety_components(days: int = Query(365, ge=1, le=1095)):
    """
    Return component breakdown for Analyst Confidence composite indicator.
    Shows VIX, MOVE, HY OAS, and ERP proxy with weights and contributions.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    from app.services.ingestion.yahoo_client import YahooClient
    import numpy as np
    
    # Fetch extra historical data for lookback calculations (520 days as per spec)
    fetch_days = days + 520 + 30  # Extra buffer
    cutoff = datetime.utcnow() - timedelta(days=fetch_days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    # Fetch all components
    fred = FredClient()
    yahoo = YahooClient()
    
    # Fetch VIX
    vix_raw = yahoo.fetch_series("^VIX", start_date=start_date)
    
    # Fetch MOVE (optional)
    move_raw = []
    try:
        move_raw = yahoo.fetch_series("^MOVE", start_date=start_date)
    except:
        pass
    
    # Fetch HY OAS
    hy_oas_raw = await fred.fetch_series("BAMLH0A0HYM2", start_date=start_date)
    
    # Fetch 10Y Treasury
    dgs10_raw = await fred.fetch_series("DGS10", start_date=start_date)
    
    # Fetch BBB Corporate Yield (optional for ERP)
    bbb_raw = []
    try:
        bbb_raw = await fred.fetch_series("BAMLC0A4CBBB", start_date=start_date)
    except:
        pass
    
    # Convert to dicts
    def series_to_dict(s):
        return {x["date"]: x["value"] for x in s if x["value"] is not None}
    
    vix_dict = series_to_dict(vix_raw)
    move_dict = series_to_dict(move_raw) if move_raw else {}
    hy_oas_dict = series_to_dict(hy_oas_raw)
    dgs10_dict = series_to_dict(dgs10_raw)
    bbb_dict = series_to_dict(bbb_raw) if bbb_raw else {}
    
    # Find common dates (VIX, HY OAS, DGS10 required)
    required_dates = set(vix_dict.keys()) & set(hy_oas_dict.keys()) & set(dgs10_dict.keys())
    common_dates = sorted(required_dates)
    
    if len(common_dates) < 30:
        raise HTTPException(status_code=500, detail="Insufficient data for Analyst Confidence components")
    
    # Forward fill optional components
    def forward_fill_to_dates(data_dict, target_dates):
        result = {}
        last_value = None
        for date in target_dates:
            if date in data_dict:
                last_value = data_dict[date]
            if last_value is not None:
                result[date] = last_value
        return result
    
    move_filled = forward_fill_to_dates(move_dict, common_dates) if move_dict else {}
    bbb_filled = forward_fill_to_dates(bbb_dict, common_dates) if bbb_dict else {}
    
    # Extract values
    vix_vals = np.array([vix_dict[d] for d in common_dates])
    hy_oas_vals = np.array([hy_oas_dict[d] for d in common_dates])
    dgs10_vals = np.array([dgs10_dict[d] for d in common_dates])
    
    has_move = len(move_filled) == len(common_dates) and all(d in move_filled for d in common_dates)
    has_bbb = len(bbb_filled) == len(common_dates) and all(d in bbb_filled for d in common_dates)
    
    move_vals = np.array([move_filled[d] for d in common_dates]) if has_move else None
    bbb_vals = np.array([bbb_filled[d] for d in common_dates]) if has_bbb else None
    erp_vals = (bbb_vals - dgs10_vals) if has_bbb else None
    
    # Helper function to compute stress scores (matches ETL logic)
    def compute_stress_score(vals, use_momentum=True):
        lookback = min(520, len(vals))
        window = vals[-lookback:]
        mean = np.mean(window)
        std = np.std(window)
        if std == 0:
            std = 1
        
        z_base = (vals - mean) / std
        
        if use_momentum and len(vals) > 10:
            roc_10d = np.zeros_like(vals)
            for i in range(10, len(vals)):
                roc_10d[i] = vals[i] - vals[i-10]
            
            roc_mean = np.mean(roc_10d[-lookback:])
            roc_std = np.std(roc_10d[-lookback:])
            if roc_std == 0:
                roc_std = 1
            z_momentum = (roc_10d - roc_mean) / roc_std
            
            z_blended = 0.75 * z_base + 0.25 * z_momentum
        else:
            z_blended = z_base
        
        z_clamped = np.clip(z_blended, -3, 3)
        stress = ((z_clamped + 3) / 6) * 100
        
        return stress
    
    # Compute stress scores for each component
    vix_stress = compute_stress_score(vix_vals)
    hy_oas_stress = compute_stress_score(hy_oas_vals)
    move_stress = compute_stress_score(move_vals) if has_move else None
    erp_stress = compute_stress_score(erp_vals) if has_bbb else None
    
    # Determine weights based on available components
    if has_move and has_bbb:
        weights = {'vix': 0.40, 'move': 0.25, 'hy_oas': 0.25, 'erp': 0.10}
        composite_stress = (
            vix_stress * weights['vix'] +
            move_stress * weights['move'] +
            hy_oas_stress * weights['hy_oas'] +
            erp_stress * weights['erp']
        )
    elif has_move:
        weights = {'vix': 0.44, 'move': 0.28, 'hy_oas': 0.28, 'erp': 0.00}
        composite_stress = (
            vix_stress * weights['vix'] +
            move_stress * weights['move'] +
            hy_oas_stress * weights['hy_oas']
        )
    elif has_bbb:
        weights = {'vix': 0.55, 'move': 0.00, 'hy_oas': 0.35, 'erp': 0.10}
        composite_stress = (
            vix_stress * weights['vix'] +
            hy_oas_stress * weights['hy_oas'] +
            erp_stress * weights['erp']
        )
    else:
        weights = {'vix': 0.60, 'move': 0.00, 'hy_oas': 0.40, 'erp': 0.00}
        composite_stress = (
            vix_stress * weights['vix'] +
            hy_oas_stress * weights['hy_oas']
        )
    
    # Convert stress to stability (invert: 0 stress = 100 stability)
    composite_stability = 100 - composite_stress
    
    # Build result
    result = []
    for i, date in enumerate(common_dates):
        entry = {
            "date": date,
            "vix": {
                "value": float(vix_vals[i]),
                "stress_score": float(vix_stress[i]),
                "stability_score": float(100 - vix_stress[i]),
                "weight": weights['vix'],
                "contribution": float(vix_stress[i] * weights['vix']),
            },
            "hy_oas": {
                "value": float(hy_oas_vals[i]),
                "stress_score": float(hy_oas_stress[i]),
                "stability_score": float(100 - hy_oas_stress[i]),
                "weight": weights['hy_oas'],
                "contribution": float(hy_oas_stress[i] * weights['hy_oas']),
            },
            "composite": {
                "stress_score": float(composite_stress[i]),
                "stability_score": float(composite_stability[i]),
            }
        }
        
        if has_move:
            entry["move"] = {
                "value": float(move_vals[i]),
                "stress_score": float(move_stress[i]),
                "stability_score": float(100 - move_stress[i]),
                "weight": weights['move'],
                "contribution": float(move_stress[i] * weights['move']),
            }
        
        if has_bbb:
            entry["erp_proxy"] = {
                "bbb_yield": float(bbb_vals[i]),
                "treasury_10y": float(dgs10_vals[i]),
                "spread": float(erp_vals[i]),
                "stress_score": float(erp_stress[i]),
                "stability_score": float(100 - erp_stress[i]),
                "weight": weights['erp'],
                "contribution": float(erp_stress[i] * weights['erp']),
            }
        
        result.append(entry)
    
    # Filter to only return the requested days
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]
    
    return result


@router.get("/indicators/ANALYST_CONFIDENCE/components")
async def get_analyst_confidence_components(days: int = Query(365, ge=1, le=1095)):
    """Alias route for Analyst Confidence composite components."""
    return await get_analyst_anxiety_components(days=days)


@router.get("/indicators/SENTIMENT_COMPOSITE/components")
async def get_sentiment_composite_components(days: int = Query(365, ge=1, le=1095)):
    """
    Get breakdown of Consumer & Corporate Sentiment Composite components.
    Returns Michigan Consumer Sentiment, NFIB, ISM New Orders, CapEx proxy.
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    import numpy as np
    
    client = FredClient()
    # Match ETL-style practical history depth so component confidence scores
    # remain comparable to the stored headline score.
    lookback_days_for_z = 520
    fetch_days = max(800, days + 30)
    cutoff = datetime.utcnow() - timedelta(days=fetch_days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    # Fetch all components
    umich_series = await client.fetch_series("UMCSENT", start_date=start_date)
    
    nfib_series = []
    try:
        nfib_series = await client.fetch_series("BOPTEXP", start_date=start_date)
    except:
        try:
            nfib_series = await client.fetch_series("BOPTTOTM", start_date=start_date)
        except:
            pass
    
    ism_series = []
    try:
        ism_series = await client.fetch_series("NEWORDER", start_date=start_date)
    except:
        pass
    
    capex_series = []
    try:
        capex_series = await client.fetch_series("ACOGNO", start_date=start_date)
    except:
        pass
    
    # Convert to dicts
    def series_to_dict(s):
        return {x["date"]: x["value"] for x in s if x["value"] is not None}
    
    umich_dict = series_to_dict(umich_series)
    nfib_dict = series_to_dict(nfib_series) if nfib_series else {}
    ism_dict = series_to_dict(ism_series) if ism_series else {}
    capex_dict = series_to_dict(capex_series) if capex_series else {}
    
    if len(umich_dict) < 12:
        raise HTTPException(status_code=404, detail="Insufficient data for SENTIMENT_COMPOSITE")
    
    common_dates = sorted(set(umich_dict.keys()))
    
    # Forward fill
    def forward_fill_to_dates(data_dict, target_dates):
        result = {}
        last_value = None
        for date in target_dates:
            if date in data_dict:
                last_value = data_dict[date]
            if last_value is not None:
                result[date] = last_value
        return result
    
    nfib_filled = forward_fill_to_dates(nfib_dict, common_dates) if nfib_dict else {}
    ism_filled = forward_fill_to_dates(ism_dict, common_dates) if ism_dict else {}
    capex_filled = forward_fill_to_dates(capex_dict, common_dates) if capex_dict else {}
    
    # Extract values
    umich_vals = np.array([umich_dict[d] for d in common_dates])
    
    has_nfib = len(nfib_filled) == len(common_dates)
    has_ism = len(ism_filled) == len(common_dates)
    has_capex = len(capex_filled) == len(common_dates)
    
    nfib_vals = np.array([nfib_filled[d] for d in common_dates]) if has_nfib else None
    ism_vals = np.array([ism_filled[d] for d in common_dates]) if has_ism else None
    capex_vals = np.array([capex_filled[d] for d in common_dates]) if has_capex else None
    
    # Compute confidence scores
    def compute_confidence_score(vals):
        lookback = min(lookback_days_for_z, len(vals))
        window = vals[-lookback:]
        mean = np.mean(window)
        std = np.std(window)
        if std == 0:
            std = 1
        
        z_vals = (vals - mean) / std
        z_clamped = np.clip(z_vals, -3, 3)
        confidence = ((z_clamped + 3) / 6) * 100
        
        return confidence
    
    umich_conf = compute_confidence_score(umich_vals)
    nfib_conf = compute_confidence_score(nfib_vals) if has_nfib else None
    ism_conf = compute_confidence_score(ism_vals) if has_ism else None
    capex_conf = compute_confidence_score(capex_vals) if has_capex else None
    
    # Determine weights
    if has_nfib and has_ism and has_capex:
        weights = {'umich': 0.30, 'nfib': 0.30, 'ism': 0.25, 'capex': 0.15}
        composite_conf = (
            umich_conf * weights['umich'] +
            nfib_conf * weights['nfib'] +
            ism_conf * weights['ism'] +
            capex_conf * weights['capex']
        )
    elif has_nfib and has_ism:
        weights = {'umich': 0.33, 'nfib': 0.33, 'ism': 0.34, 'capex': 0.00}
        composite_conf = (
            umich_conf * weights['umich'] +
            nfib_conf * weights['nfib'] +
            ism_conf * weights['ism']
        )
    elif has_nfib:
        weights = {'umich': 0.50, 'nfib': 0.50, 'ism': 0.00, 'capex': 0.00}
        composite_conf = (
            umich_conf * weights['umich'] +
            nfib_conf * weights['nfib']
        )
    else:
        weights = {'umich': 1.00, 'nfib': 0.00, 'ism': 0.00, 'capex': 0.00}
        composite_conf = umich_conf

    # Carry forward latest known monthly reading to today so this view
    # stays aligned with the headline indicator freshness behavior.
    today_key = datetime.utcnow().strftime("%Y-%m-%d")
    if common_dates and common_dates[-1] < today_key:
        common_dates.append(today_key)
        umich_vals = np.append(umich_vals, umich_vals[-1])
        umich_conf = np.append(umich_conf, umich_conf[-1])
        composite_conf = np.append(composite_conf, composite_conf[-1])
        if has_nfib:
            nfib_vals = np.append(nfib_vals, nfib_vals[-1])
            nfib_conf = np.append(nfib_conf, nfib_conf[-1])
        if has_ism:
            ism_vals = np.append(ism_vals, ism_vals[-1])
            ism_conf = np.append(ism_conf, ism_conf[-1])
        if has_capex:
            capex_vals = np.append(capex_vals, capex_vals[-1])
            capex_conf = np.append(capex_conf, capex_conf[-1])
    
    # Build result
    result = []
    for i, date in enumerate(common_dates):
        entry = {
            "date": date,
            "michigan_sentiment": {
                "value": float(umich_vals[i]),
                "confidence_score": float(umich_conf[i]),
                "weight": weights['umich'],
                "contribution": float(umich_conf[i] * weights['umich']),
            },
            "composite": {
                "confidence_score": float(composite_conf[i]),
                # Keep component view aligned with indicator detail headline score
                # (ETL stores sentiment composite as 0-100 stability score).
                "stability_score": float(int(np.clip(composite_conf[i], 0, 100))),
            }
        }
        
        if has_nfib:
            entry["nfib_optimism"] = {
                "value": float(nfib_vals[i]),
                "confidence_score": float(nfib_conf[i]),
                "weight": weights['nfib'],
                "contribution": float(nfib_conf[i] * weights['nfib']),
            }
        
        if has_ism:
            entry["ism_new_orders"] = {
                "value": float(ism_vals[i]),
                "confidence_score": float(ism_conf[i]),
                "weight": weights['ism'],
                "contribution": float(ism_conf[i] * weights['ism']),
            }
        
        if has_capex:
            entry["capex_proxy"] = {
                "value": float(capex_vals[i]),
                "confidence_score": float(capex_conf[i]),
                "weight": weights['capex'],
                "contribution": float(capex_conf[i] * weights['capex']),
            }
        
        result.append(entry)
    
    # Filter to requested days
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]
    
    return result


@router.get("/indicators/{code}/components")
async def get_indicator_components(code: str, days: int = Query(365, ge=1, le=1095)):
    """
    Return component breakdown for derived indicators.
    Currently supports: CONSUMER_HEALTH (returns PCE/PI/CPI data plus
    score-aligned composite stability metrics).
    """
    from datetime import datetime, timedelta
    from app.services.ingestion.fred_client import FredClient
    from app.services.analytics_stub import normalize_series, score_series
    
    canonical_code = normalize_indicator_code(code)
    if canonical_code != "CONSUMER_HEALTH":
        raise HTTPException(
            status_code=400, 
            detail=f"Component breakdown not available for {code}"
        )
    
    # Match ETL normalization settings so component charts align with indicator score.
    direction = -1
    lookback_days_for_z = 252
    with get_db_session() as db:
        indicator_cfg = db.query(Indicator).filter(Indicator.code == "CONSUMER_HEALTH").first()
        if indicator_cfg:
            if indicator_cfg.direction is not None:
                direction = int(indicator_cfg.direction)
            if indicator_cfg.lookback_days_for_z:
                lookback_days_for_z = int(indicator_cfg.lookback_days_for_z)

    # Fetch enough history for z-score normalization window.
    client = FredClient()
    fetch_days = max(800, days + lookback_days_for_z + 30)
    cutoff = datetime.utcnow() - timedelta(days=fetch_days)
    start_date = cutoff.strftime("%Y-%m-%d")
    
    pce_series = await client.fetch_series("PCE", start_date=start_date)
    cpi_series = await client.fetch_series("CPIAUCSL", start_date=start_date)
    pi_series = await client.fetch_series("PI", start_date=start_date)
    
    # Calculate MoM% for each
    def calc_mom_pct(series):
        result = []
        for i in range(len(series)):
            if i == 0 or series[i]["value"] is None:
                result.append({"date": series[i]["date"], "value": series[i]["value"], "mom_pct": 0.0})
            else:
                prev_val = series[i-1]["value"]
                curr_val = series[i]["value"]
                if prev_val is None or curr_val is None:
                    mom_pct = 0.0
                else:
                    mom_pct = ((curr_val - prev_val) / prev_val * 100) if prev_val != 0 else 0.0
                result.append({"date": series[i]["date"], "value": curr_val, "mom_pct": mom_pct})
        return result
    
    pce_with_mom = calc_mom_pct(pce_series)
    cpi_with_mom = calc_mom_pct(cpi_series)
    pi_with_mom = calc_mom_pct(pi_series)
    
    # Align by date and calculate spreads
    pce_dict = {x["date"]: x for x in pce_with_mom if x["value"] is not None}
    cpi_dict = {x["date"]: x for x in cpi_with_mom if x["value"] is not None}
    pi_dict = {x["date"]: x for x in pi_with_mom if x["value"] is not None}
    
    # Use union of all dates to show all available data
    all_dates = sorted(set(pce_dict.keys()) | set(cpi_dict.keys()) | set(pi_dict.keys()))
    
    # Forward-fill missing values (use last known value)
    last_pce = None
    last_pi = None
    last_cpi = None
    
    result = []
    consumer_health_series = []
    prev_pce_val = None
    prev_cpi_val = None
    prev_pi_val = None
    
    for date in all_dates:
        # Update last known values if available
        if date in pce_dict:
            last_pce = pce_dict[date]
        if date in cpi_dict:
            last_cpi = cpi_dict[date]
        if date in pi_dict:
            last_pi = pi_dict[date]
        
        # Skip if we don't have any data yet
        if not last_pce or not last_cpi or not last_pi:
            continue
        
        # Calculate MoM based on whether we have new data or are forward-filling
        if date in pce_dict and prev_pce_val is not None:
            pce_mom = ((last_pce["value"] - prev_pce_val) / prev_pce_val * 100) if prev_pce_val != 0 else 0.0
        elif date in pce_dict:
            pce_mom = 0.0  # First data point
        else:
            pce_mom = 0.0  # Forward-filled, no change
            
        if date in cpi_dict and prev_cpi_val is not None:
            cpi_mom = ((last_cpi["value"] - prev_cpi_val) / prev_cpi_val * 100) if prev_cpi_val != 0 else 0.0
        elif date in cpi_dict:
            cpi_mom = 0.0  # First data point
        else:
            cpi_mom = 0.0  # Forward-filled, no change
            
        if date in pi_dict and prev_pi_val is not None:
            pi_mom = ((last_pi["value"] - prev_pi_val) / prev_pi_val * 100) if prev_pi_val != 0 else 0.0
        elif date in pi_dict:
            pi_mom = 0.0  # First data point
        else:
            pi_mom = 0.0  # Forward-filled, no change
        
        pce_spread = pce_mom - cpi_mom
        pi_spread = pi_mom - cpi_mom
        consumer_health = (pce_spread + pi_spread) / 2  # Average of the two spreads
        
        pce_is_filled = date not in pce_dict
        cpi_is_filled = date not in cpi_dict
        pi_is_filled = date not in pi_dict

        consumer_health_series.append(consumer_health)

        result.append({
            "date": date,
            "pce": {
                "value": last_pce["value"],
                "mom_pct": pce_mom,
                "is_filled": pce_is_filled,
                "as_of": last_pce["date"],
            },
            "cpi": {
                "value": last_cpi["value"],
                "mom_pct": cpi_mom,
                "is_filled": cpi_is_filled,
                "as_of": last_cpi["date"],
            },
            "pi": {
                "value": last_pi["value"],
                "mom_pct": pi_mom,
                "is_filled": pi_is_filled,
                "as_of": last_pi["date"],
            },
            "spreads": {
                "pce_spread": pce_spread,
                "pi_spread": pi_spread,
                "consumer_health": consumer_health,
            },
        })
        
        # Update previous values for next iteration
        if date in pce_dict:
            prev_pce_val = last_pce["value"]
        if date in cpi_dict:
            prev_cpi_val = last_cpi["value"]
        if date in pi_dict:
            prev_pi_val = last_pi["value"]
    
    if consumer_health_series:
        normalized_series = normalize_series(
            consumer_health_series,
            direction=direction,
            lookback=lookback_days_for_z,
        )
        stability_scores = score_series(normalized_series)

        for i, entry in enumerate(result):
            stability_score = float(stability_scores[i])
            entry["composite"] = {
                "raw_value": float(consumer_health_series[i]),
                "normalized_value": float(normalized_series[i]),
                "stress_score": float(100.0 - stability_score),
                "stability_score": stability_score,
            }

    # Filter to requested days after normalization to preserve lookback context.
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]

    return result
