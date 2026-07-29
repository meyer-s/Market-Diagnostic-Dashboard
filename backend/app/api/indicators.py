import asyncio
import logging
from fastapi import APIRouter, HTTPException, Query
from typing import List
import pandas as pd

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
from app.services.ingestion.sentiment_sources import fetch_sentiment_component_series
from app.services.sector_divergence import (
    CYCLICAL_SECTORS,
    DEFENSIVE_SECTORS,
    compute_alignment_score,
    compute_breadth_counts,
)
from app.services.bond_market_stability import build_bond_market_stability_history
from app.services.endpoint_response_cache import (
    async_response_refresh_lock,
    load_response_snapshot,
    mark_stale_snapshot,
    store_response_snapshot,
)

router = APIRouter()
logger = logging.getLogger(__name__)
_ANALYST_COMPONENT_CACHE_TTL_SECONDS = 4 * 60 * 60
_ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS = 7 * 24 * 60 * 60


def _analyst_component_quality(payload: object) -> tuple[int, int]:
    """Rank evidence status and optional component coverage.

    Row count and snapshot age are intentionally excluded: a newly computed
    partial response should advance the cache when its evidence quality is
    equal, rather than freezing an older partial response until the hard stale
    ceiling.
    """

    if not isinstance(payload, list) or not payload:
        return (0, 0)
    latest = payload[-1]
    if not isinstance(latest, dict):
        return (0, 0)
    metadata = latest.get("data_quality")
    status = metadata.get("status") if isinstance(metadata, dict) else None
    if status == "stale":
        status = None
    if status not in {"complete", "partial", "unavailable"}:
        vix = latest.get("vix")
        source = vix.get("source") if isinstance(vix, dict) else None
        status = "complete" if source == "yahoo_live" else "partial"
    status_rank = {"unavailable": 0, "partial": 1, "complete": 2}[status]
    component_coverage = sum(
        isinstance(latest.get(component), dict)
        for component in ("vix", "hy_oas", "move", "erp_proxy")
    )
    return (status_rank, component_coverage)


def _stored_indicator_raw_series(code: str, start_date: str) -> list[dict]:
    """Use the persisted ETL series when a live component provider is unavailable."""

    from datetime import datetime

    try:
        cutoff = datetime.strptime(start_date, "%Y-%m-%d")
        with get_db_session() as db:
            indicator = db.query(Indicator).filter(Indicator.code == code).first()
            if indicator is None:
                return []
            rows = (
                db.query(IndicatorValue)
                .filter(
                    IndicatorValue.indicator_id == indicator.id,
                    IndicatorValue.timestamp >= cutoff,
                    IndicatorValue.raw_value.isnot(None),
                )
                .order_by(IndicatorValue.timestamp.asc())
                .all()
            )
        return [
            {
                "date": row.timestamp.strftime("%Y-%m-%d"),
                "value": float(row.raw_value),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("Stored %s component fallback was unavailable: %s", code, exc)
        return []


@router.get("/indicators/metadata")
def list_indicators():
    """Return basic metadata for all indicators."""
    with get_db_session() as db:
        indicators: List[Indicator] = db.query(Indicator).all()
        return [format_indicator_basic(ind) for ind in indicators]


@router.get("/indicators/{code}")
def get_indicator_detail(code: str):
    """Return metadata + latest value for a single indicator."""

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

    cutoff = datetime.utcnow() - timedelta(days=days)
    start_date = cutoff.strftime("%Y-%m-%d")
    return await build_bond_market_stability_history(start_date=start_date)


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


@router.get("/indicators/BOND_MARKET_STABILITY/yield-curve")
async def get_treasury_yield_curve(months: int = Query(12, ge=1, le=24)):
    """
    Fetch the live Treasury yield curve from treasury.gov across recent months.
    Returns all available daily curves, newest first.
    """
    import asyncio
    import httpx
    import xml.etree.ElementTree as ET
    from datetime import date

    today = date.today()
    month_str = today.strftime("%Y%m")

    def build_month_strings(count: int) -> list[str]:
        month_values: list[str] = []
        current_year = today.year
        current_month = today.month

        for _ in range(count):
            month_values.append(f"{current_year}{current_month:02d}")
            current_month -= 1
            if current_month == 0:
                current_month = 12
                current_year -= 1

        return month_values

    maturities = [
        ("1M", "BC_1MONTH"),
        ("2M", "BC_2MONTH"),
        ("3M", "BC_3MONTH"),
        ("4M", "BC_4MONTH"),
        ("6M", "BC_6MONTH"),
        ("1Y", "BC_1YEAR"),
        ("2Y", "BC_2YEAR"),
        ("3Y", "BC_3YEAR"),
        ("5Y", "BC_5YEAR"),
        ("7Y", "BC_7YEAR"),
        ("10Y", "BC_10YEAR"),
        ("20Y", "BC_20YEAR"),
        ("30Y", "BC_30YEAR"),
    ]

    month_values = build_month_strings(months)
    urls = [
        (
            month_value,
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            f"pages/xmlview?data=daily_treasury_yield_curve&field_tdr_date_value_month={month_value}"
        )
        for month_value in month_values
    ]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            responses = await asyncio.gather(
                *(client.get(url) for _, url in urls),
                return_exceptions=True,
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Treasury data: {e}")

    ATOM_NS = "http://www.w3.org/2005/Atom"
    D_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices"
    M_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"

    try:
        curve_map: dict[str, dict[str, object]] = {}

        for index, response in enumerate(responses):
            if isinstance(response, Exception):
                continue

            response.raise_for_status()
            root = ET.fromstring(response.text)
            entries = root.findall(f"{{{ATOM_NS}}}entry")
            if not entries:
                entries = root.findall(f".//{{{ATOM_NS}}}entry")

            for entry in entries:
                props = entry.find(f".//{{{M_NS}}}properties")
                if props is None:
                    continue

                date_el = props.find(f"{{{D_NS}}}NEW_DATE")
                if date_el is None or not date_el.text:
                    continue
                date_val = date_el.text[:10]

                curve_points = []
                for label, field in maturities:
                    el = props.find(f"{{{D_NS}}}{field}")
                    if el is not None and el.text:
                        try:
                            curve_points.append({"maturity": label, "yield": float(el.text)})
                        except ValueError:
                            pass

                if date_val and curve_points and date_val not in curve_map:
                    curve_map[date_val] = {
                        "date": date_val,
                        "curve": curve_points,
                        "source_month": urls[index][0],
                    }

        curves = sorted(curve_map.values(), key=lambda item: item["date"], reverse=True)
        return {
            "month": month_str,
            "months_requested": months,
            "curves": curves,
        }

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Treasury source returned an error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Treasury XML: {e}")


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


async def _build_analyst_anxiety_components(days: int):
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
    
    def fetch_yahoo_components():
        vix_values = []
        move_values = []
        try:
            vix_values = yahoo.fetch_series("^VIX", start_date=start_date)
        except Exception as exc:
            logger.warning("Live VIX fetch failed; trying persisted history: %s", exc)
        try:
            move_values = yahoo.fetch_series("^MOVE", start_date=start_date)
        except Exception:
            pass
        return vix_values, move_values

    yahoo_result, hy_result, dgs10_result, bbb_result = await asyncio.gather(
        asyncio.to_thread(fetch_yahoo_components),
        fred.fetch_series("BAMLH0A0HYM2", start_date=start_date),
        fred.fetch_series("DGS10", start_date=start_date),
        fred.fetch_series("BAMLC0A4CBBB", start_date=start_date),
        return_exceptions=True,
    )

    vix_source = "yahoo_live"
    if isinstance(yahoo_result, tuple):
        vix_raw, move_raw = yahoo_result
    else:
        vix_raw, move_raw = [], []
    if len(vix_raw) < 30:
        stored_vix = _stored_indicator_raw_series("VIX", start_date)
        if len(stored_vix) >= 30:
            vix_raw = stored_vix
            vix_source = "stored_indicator_history"

    hy_oas_raw = hy_result if isinstance(hy_result, list) else []
    dgs10_raw = dgs10_result if isinstance(dgs10_result, list) else []
    bbb_raw = bbb_result if isinstance(bbb_result, list) else []
    
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
            "data_quality": {
                "status": "complete" if vix_source == "yahoo_live" else "partial",
                "stale": False,
                "reason": (
                    None
                    if vix_source == "yahoo_live"
                    else "live_vix_provider_unavailable"
                ),
                "vix_source": vix_source,
                "cache_ttl_seconds": _ANALYST_COMPONENT_CACHE_TTL_SECONDS,
                "max_stale_age_seconds": _ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS,
            },
            "vix": {
                "value": float(vix_vals[i]),
                "stress_score": float(vix_stress[i]),
                "stability_score": float(100 - vix_stress[i]),
                "weight": weights['vix'],
                "contribution": float(vix_stress[i] * weights['vix']),
                "source": vix_source,
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


@router.get("/indicators/ANALYST_ANXIETY/components")
async def get_analyst_anxiety_components(days: int = Query(365, ge=1, le=1095)):
    cache_key = f"indicator-components:analyst-confidence:{days}"
    shared_snapshot = load_response_snapshot(cache_key)
    if (
        shared_snapshot is not None
        and not shared_snapshot.is_within_stale_limit(
            _ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS
        )
    ):
        shared_snapshot = None
    if (
        shared_snapshot is not None
        and shared_snapshot.is_fresh(_ANALYST_COMPONENT_CACHE_TTL_SECONDS)
    ):
        return shared_snapshot.payload

    async with async_response_refresh_lock(cache_key):
        # Another worker may have completed the cold/TTL refresh while this
        # request was waiting on the advisory lock.
        shared_snapshot = load_response_snapshot(cache_key)
        if (
            shared_snapshot is not None
            and not shared_snapshot.is_within_stale_limit(
                _ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS
            )
        ):
            shared_snapshot = None
        if (
            shared_snapshot is not None
            and shared_snapshot.is_fresh(_ANALYST_COMPONENT_CACHE_TTL_SECONDS)
        ):
            return shared_snapshot.payload

        try:
            result = await _build_analyst_anxiety_components(days)
        except Exception:
            if shared_snapshot is None:
                raise
            logger.exception(
                "Analyst component refresh failed; reusing snapshot aged %.1fs",
                shared_snapshot.age_seconds,
            )
            return mark_stale_snapshot(
                shared_snapshot.payload,
                shared_snapshot,
                reason="analyst_component_refresh_failed",
                ttl_seconds=_ANALYST_COMPONENT_CACHE_TTL_SECONDS,
                max_stale_age_seconds=_ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS,
            )

        if not result:
            return result

        if (
            shared_snapshot is not None
            and _analyst_component_quality(shared_snapshot.payload)
            > _analyst_component_quality(result)
        ):
            return mark_stale_snapshot(
                shared_snapshot.payload,
                shared_snapshot,
                reason="analyst_component_refresh_lower_quality",
                ttl_seconds=_ANALYST_COMPONENT_CACHE_TTL_SECONDS,
                max_stale_age_seconds=_ANALYST_COMPONENT_MAX_STALE_AGE_SECONDS,
            )

        # Equal-quality partial evidence is intentionally advanced. This
        # prevents a provider fallback from pinning an older partial response
        # for the entire seven-day bounded-stale window.
        store_response_snapshot(cache_key, result)
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
    
    sentiment_sources = await fetch_sentiment_component_series(client, start_date)
    umich_series = sentiment_sources["umich_series"]
    nfib_series = sentiment_sources["business_confidence_series"]
    ism_series = sentiment_sources["regional_new_orders_series"]
    capex_series = sentiment_sources["capex_series"]
    
    # Convert to dicts
    def series_to_dict(s):
        return {x["date"]: x["value"] for x in s if x["value"] is not None}
    
    umich_dict = series_to_dict(umich_series)
    nfib_dict = series_to_dict(nfib_series) if nfib_series else {}
    ism_dict = series_to_dict(ism_series) if ism_series else {}
    capex_dict = series_to_dict(capex_series) if capex_series else {}
    
    if len(umich_dict) < 12:
        raise HTTPException(status_code=404, detail="Insufficient data for SENTIMENT_COMPOSITE")

    common_dates = sorted(
        set(umich_dict.keys())
        | set(nfib_dict.keys())
        | set(ism_dict.keys())
        | set(capex_dict.keys())
    )
    
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
    
    umich_filled = forward_fill_to_dates(umich_dict, common_dates)
    nfib_filled = forward_fill_to_dates(nfib_dict, common_dates) if nfib_dict else {}
    ism_filled = forward_fill_to_dates(ism_dict, common_dates) if ism_dict else {}
    capex_filled = forward_fill_to_dates(capex_dict, common_dates) if capex_dict else {}

    common_dates = [date for date in common_dates if date in umich_filled]
    
    # Extract values
    umich_vals = np.array([umich_filled[d] for d in common_dates])
    
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
    
    from app.services.ingestion.sentiment_sources import compute_staleness_weights

    umich_conf = compute_confidence_score(umich_vals)
    nfib_conf = compute_confidence_score(nfib_vals) if has_nfib else None
    ism_conf = compute_confidence_score(ism_vals) if has_ism else None
    capex_conf = compute_confidence_score(capex_vals) if has_capex else None
    
    # Staleness-aware weights (mirrors ETL behaviour)
    component_latest = {
        "umich": max(umich_dict.keys()) if umich_dict else None,
        "nfib": max(nfib_dict.keys()) if nfib_dict else None,
        "ism": max(ism_dict.keys()) if ism_dict else None,
        "capex": max(capex_dict.keys()) if capex_dict else None,
    }
    if has_nfib and has_ism and has_capex:
        nominal = {"umich": 0.30, "nfib": 0.30, "ism": 0.25, "capex": 0.15}
    elif has_nfib and has_ism:
        nominal = {"umich": 0.33, "nfib": 0.33, "ism": 0.34, "capex": 0.0}
    elif has_nfib:
        nominal = {"umich": 0.50, "nfib": 0.50, "ism": 0.0, "capex": 0.0}
    else:
        nominal = {"umich": 1.0, "nfib": 0.0, "ism": 0.0, "capex": 0.0}

    weights = compute_staleness_weights(component_latest, nominal)

    composite_conf = umich_conf * weights["umich"]
    if has_nfib:
        composite_conf = composite_conf + nfib_conf * weights["nfib"]
    if has_ism:
        composite_conf = composite_conf + ism_conf * weights["ism"]
    if has_capex:
        composite_conf = composite_conf + capex_conf * weights["capex"]

    def resolve_stability_score(fallback_confidence: float) -> float:
        return float(np.clip(fallback_confidence, 0, 100))
    
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
                "stability_score": resolve_stability_score(float(composite_conf[i])),
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


_SECTOR_NAMES = {
    "XLB": "Materials",
    "XLC": "Comm Svcs",
    "XLE": "Energy",
    "XLF": "Financials",
    "XLI": "Industrials",
    "XLK": "Technology",
    "XLP": "Staples",
    "XLRE": "Real Estate",
    "XLV": "Health Care",
    "XLY": "Discretionary",
    "XLU": "Utilities",
}
_BREADTH_PROXY_TICKERS = ["RSP", "SPY", "IWM"] + list(_SECTOR_NAMES.keys())
_BREADTH_HEALTH_COMP_CACHE: dict = {"fetched_at": None, "data": None, "days": None}
_BREADTH_HEALTH_COMP_CACHE_TTL = 4 * 60 * 60


@router.get("/indicators/BREADTH_HEALTH/components")
def get_breadth_health_components(days: int = Query(90, ge=1, le=365)):
    """
    Return proxy-based breadth component breakdown for BREADTH_HEALTH.

    Uses ~14 ETF tickers (no full-exchange scan) to compute:
    - RSP/SPY indexed ratio (equal-weight vs cap-weight participation)
    - IWM/SPY indexed ratio (small-cap breadth)
    - % of 11 SPDR sectors above their 20-day simple moving average
    - % of 11 SPDR sectors with a positive 20-day price return
    - Per-sector status for the most recent date
    """
    import math
    from datetime import datetime, timedelta

    import numpy as np
    import yfinance as yf

    now = datetime.utcnow()
    cached = _BREADTH_HEALTH_COMP_CACHE
    if (
        cached["fetched_at"] is not None
        and cached["days"] == days
        and (now - cached["fetched_at"]).total_seconds() < _BREADTH_HEALTH_COMP_CACHE_TTL
    ):
        return cached["data"]

    # Extra buffer so 20-day MA is valid from the first day we want to return
    fetch_days = days + 60
    start_date = (now - timedelta(days=fetch_days)).strftime("%Y-%m-%d")

    try:
        raw = yf.download(
            tickers=_BREADTH_PROXY_TICKERS,
            start=start_date,
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance download failed: {exc}")

    if raw is None or raw.empty:
        raise HTTPException(status_code=502, detail="No data returned from yfinance")

    # Extract Close prices — handle multi-level columns
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = raw.columns.get_level_values(0)
        level1 = raw.columns.get_level_values(1)
        if "Close" in level0:
            close_df = raw["Close"]
        elif "Close" in level1:
            close_df = raw.swaplevel(axis=1)["Close"]
        else:
            raise HTTPException(status_code=502, detail="Unexpected yfinance column structure")
    else:
        close_df = raw[["Close"]] if "Close" in raw.columns else raw

    close_df = close_df.dropna(how="all")

    def safe_col(ticker: str) -> "pd.Series | None":
        if ticker in close_df.columns:
            return close_df[ticker].dropna()
        return None

    rsp_s = safe_col("RSP")
    spy_s = safe_col("SPY")
    iwm_s = safe_col("IWM")

    if rsp_s is None or spy_s is None or iwm_s is None:
        raise HTTPException(status_code=502, detail="Missing RSP, SPY, or IWM price data")

    # Align RSP/SPY and IWM/SPY on common dates
    ratio_df = pd.DataFrame({"rsp": rsp_s, "spy": spy_s, "iwm": iwm_s}).dropna()
    ratio_df["rsp_spy"] = ratio_df["rsp"] / ratio_df["spy"]
    ratio_df["iwm_spy"] = ratio_df["iwm"] / ratio_df["spy"]

    # Build per-date sector metrics (20-day MA and 20-day return)
    sector_series: dict[str, "pd.Series"] = {}
    for ticker in _SECTOR_NAMES:
        s = safe_col(ticker)
        if s is not None and len(s) >= 21:
            sector_series[ticker] = s

    # Compute sector participation per date aligned to ratio_df index
    sector_above_ma20: list[float] = []
    sector_positive_20d: list[float] = []

    all_dates = ratio_df.index
    for date in all_dates:
        above = 0
        pos = 0
        counted_ma = 0
        counted_ret = 0
        for ticker, s in sector_series.items():
            s_up_to = s[s.index <= date]
            if len(s_up_to) < 2:
                continue
            current_price = float(s_up_to.iloc[-1])
            # 20-day MA
            ma_window = s_up_to.iloc[-20:] if len(s_up_to) >= 20 else s_up_to
            ma20 = float(ma_window.mean())
            if current_price > ma20:
                above += 1
            counted_ma += 1
            # 20-day return
            if len(s_up_to) >= 21:
                past_price = float(s_up_to.iloc[-21])
                if past_price > 0:
                    if current_price > past_price:
                        pos += 1
                    counted_ret += 1
        sector_above_ma20.append(above / counted_ma * 100.0 if counted_ma > 0 else 50.0)
        sector_positive_20d.append(pos / counted_ret * 100.0 if counted_ret > 0 else 50.0)

    ratio_df["sectors_above_ma20_pct"] = sector_above_ma20
    ratio_df["sectors_positive_20d_pct"] = sector_positive_20d

    # Cut to the requested window and index RSP/SPY + IWM/SPY to 100
    cutoff = now - timedelta(days=days)
    window_df = ratio_df[ratio_df.index >= cutoff].copy()

    if window_df.empty:
        raise HTTPException(status_code=404, detail="No data in the requested window")

    base_rsp_spy = float(window_df["rsp_spy"].iloc[0])
    base_iwm_spy = float(window_df["iwm_spy"].iloc[0])

    def safe_float(v: float) -> float:
        if math.isnan(v) or math.isinf(v):
            return 0.0
        return round(v, 4)

    history = []
    for idx_ts, row in window_df.iterrows():
        rsp_spy_norm = safe_float((row["rsp_spy"] / base_rsp_spy * 100.0) if base_rsp_spy else 0.0)
        iwm_spy_norm = safe_float((row["iwm_spy"] / base_iwm_spy * 100.0) if base_iwm_spy else 0.0)
        history.append({
            "date": idx_ts.strftime("%Y-%m-%d"),
            "rsp_spy_norm": rsp_spy_norm,
            "iwm_spy_norm": iwm_spy_norm,
            "sectors_above_ma20_pct": safe_float(row["sectors_above_ma20_pct"]),
            "sectors_positive_20d_pct": safe_float(row["sectors_positive_20d_pct"]),
        })

    # Per-sector detail for the most recent date
    latest_date = window_df.index[-1]
    latest_sectors = []
    for ticker, name in _SECTOR_NAMES.items():
        s = sector_series.get(ticker)
        if s is None:
            continue
        s_up_to = s[s.index <= latest_date]
        if len(s_up_to) < 2:
            continue
        current_price = float(s_up_to.iloc[-1])
        ma_window = s_up_to.iloc[-20:] if len(s_up_to) >= 20 else s_up_to
        ma20 = float(ma_window.mean())
        above_ma20 = current_price > ma20
        if len(s_up_to) >= 21:
            past_price = float(s_up_to.iloc[-21])
            return_20d_pct = safe_float(((current_price - past_price) / past_price * 100.0) if past_price > 0 else 0.0)
        else:
            return_20d_pct = 0.0
        latest_sectors.append({
            "ticker": ticker,
            "name": name,
            "above_ma20": above_ma20,
            "return_20d_pct": return_20d_pct,
        })

    result = {
        "as_of": latest_date.strftime("%Y-%m-%d"),
        "history": history,
        "latest_sectors": latest_sectors,
    }

    _BREADTH_HEALTH_COMP_CACHE["fetched_at"] = now
    _BREADTH_HEALTH_COMP_CACHE["days"] = days
    _BREADTH_HEALTH_COMP_CACHE["data"] = result
    return result


@router.get("/indicators/SECTOR_REGIME_ALIGNMENT/components")
def get_sector_divergence_alignment_components(days: int = Query(365, ge=30, le=1095)):
    """Return rich sector divergence alignment diagnostics and history."""
    from datetime import datetime, timedelta
    from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue

    cutoff = datetime.utcnow().date() - timedelta(days=days)

    with get_db_session() as db:
        runs = (
            db.query(SectorProjectionRun)
            .filter(SectorProjectionRun.as_of_date >= cutoff)
            .order_by(SectorProjectionRun.as_of_date.asc(), SectorProjectionRun.created_at.asc())
            .all()
        )

        if not runs:
            raise HTTPException(status_code=404, detail="No sector projection history available")

        history = []
        latest_payload = None

        for run in runs:
            values = db.query(SectorProjectionValue).filter_by(run_id=run.id).all()
            by_horizon = {"T": [], "3m": [], "6m": [], "12m": []}
            for value in values:
                if value.horizon in by_horizon:
                    by_horizon[value.horizon].append({
                        "symbol": value.sector_symbol,
                        "name": value.sector_name,
                        "score": value.score_total,
                        "rank": value.rank,
                    })

            data_3m = by_horizon["3m"]
            defensive = [entry for entry in data_3m if entry["symbol"] in DEFENSIVE_SECTORS]
            cyclical = [entry for entry in data_3m if entry["symbol"] in CYCLICAL_SECTORS]
            if not defensive or not cyclical:
                continue

            defensive_avg = sum(entry["score"] for entry in defensive) / len(defensive)
            cyclical_avg = sum(entry["score"] for entry in cyclical) / len(cyclical)
            spread = defensive_avg - cyclical_avg
            alignment_score = compute_alignment_score(run.system_state, spread)
            breadth = compute_breadth_counts(by_horizon)

            point = {
                "date": str(run.as_of_date),
                "system_state": run.system_state,
                "defensive_avg": round(defensive_avg, 2),
                "cyclical_avg": round(cyclical_avg, 2),
                "spread": round(spread, 2),
                "alignment_score": round(alignment_score, 2),
                "sector_breadth": breadth,
            }
            history.append(point)
            latest_payload = {
                **point,
                "top_defensive": sorted(defensive, key=lambda item: item["score"], reverse=True)[:3],
                "top_cyclical": sorted(cyclical, key=lambda item: item["score"], reverse=True)[:3],
                "updated_at": run.created_at.isoformat(),
            }

        if not history or latest_payload is None:
            raise HTTPException(status_code=404, detail="Insufficient sector divergence component history")

        return {
            "as_of": latest_payload["date"],
            "updated_at": latest_payload["updated_at"],
            "refresh_cadence": "Updates whenever sector projection runs refresh, typically daily or on manual recompute.",
            "latest": latest_payload,
            "history": history,
        }


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
    if canonical_code == "SECTOR_REGIME_ALIGNMENT":
        return get_sector_divergence_alignment_components(days=days)
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

    import bisect
    from app.services.ingestion.yahoo_client import YahooClient

    # Fetch enough history for z-score normalization window.
    client = FredClient()
    yahoo = YahooClient()
    fetch_days = max(800, days + lookback_days_for_z + 30)
    cutoff = datetime.utcnow() - timedelta(days=fetch_days)
    start_date = cutoff.strftime("%Y-%m-%d")

    pce_series = await client.fetch_series("PCE", start_date=start_date)
    cpi_series = await client.fetch_series("CPIAUCSL", start_date=start_date)
    pi_series = await client.fetch_series("PI", start_date=start_date)

    # XLY / XLP — daily discretionary vs staples prices
    xly_raw = yahoo.fetch_series("XLY", start_date=start_date)
    xlp_raw = yahoo.fetch_series("XLP", start_date=start_date)
    xly_price = {x["date"]: x["value"] for x in xly_raw if x["value"] is not None}
    xlp_price = {x["date"]: x["value"] for x in xlp_raw if x["value"] is not None}
    xly_dates_sorted = sorted(xly_price.keys())
    xlp_dates_sorted = sorted(xlp_price.keys())
    
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

        # XLY/XLP ratio at this date — nearest prior trading day
        xi = bisect.bisect_right(xly_dates_sorted, date) - 1
        li = bisect.bisect_right(xlp_dates_sorted, date) - 1
        xly_val = xly_price[xly_dates_sorted[xi]] if xi >= 0 else None
        xlp_val = xlp_price[xlp_dates_sorted[li]] if li >= 0 else None
        xly_xlp_ratio = (xly_val / xlp_val) if (xly_val and xlp_val) else None

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
            "xly_xlp": {
                "xly": xly_val,
                "xlp": xlp_val,
                "ratio": xly_xlp_ratio,
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
        macro_norm = normalize_series(consumer_health_series, direction=direction, lookback=lookback_days_for_z)

        # Blend XLY/XLP at 15% if data is available
        xly_xlp_ratios_raw = [e["xly_xlp"]["ratio"] for e in result]
        has_ratio = any(v is not None for v in xly_xlp_ratios_raw)
        if has_ratio:
            last_r = None
            filled_ratios = []
            for v in xly_xlp_ratios_raw:
                if v is not None:
                    last_r = v
                filled_ratios.append(last_r if last_r is not None else 1.0)
            xly_xlp_norm = normalize_series(filled_ratios, direction=direction, lookback=lookback_days_for_z)
            blended_norm = [0.85 * macro_norm[i] + 0.15 * xly_xlp_norm[i] for i in range(len(macro_norm))]
        else:
            blended_norm = macro_norm

        stability_scores = score_series(blended_norm)

        for i, entry in enumerate(result):
            stability_score = float(stability_scores[i])
            entry["composite"] = {
                "raw_value": float(consumer_health_series[i]),
                "normalized_value": float(blended_norm[i]),
                "stress_score": float(100.0 - stability_score),
                "stability_score": stability_score,
            }

    # Filter to requested days after normalization to preserve lookback context.
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = [r for r in result if r["date"] >= cutoff_date]

    return result
