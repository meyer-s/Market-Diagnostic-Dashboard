"""
Sector Projection API Endpoints

Provides REST API access to sector ETF performance projections computed by the transparent
scoring system. Includes latest projections, historical data, and manual refresh capabilities.

Endpoints:
- GET /sectors/projections/latest: Current projections for all sectors across all horizons
- GET /sectors/projections/history: Time-series of projection runs for trend analysis
- POST /sectors/projections/refresh: Trigger immediate recomputation (admin use)

All projections include:
- Composite score (0-100) and component scores (trend, relative strength, risk, regime)
- Ranking and classification (Winner/Neutral/Loser)
- Raw metrics (returns, volatility, drawdown, etc.)
"""

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import time
from app.utils.db_helpers import get_db_session
from app.models.options_alerts import OptionAlertEvent
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.services.sector_projection import (
    build_sector_projection_history,
    compute_sector_projections,
    detect_duplicate_series,
    detect_stale_series,
    fetch_sector_price_history,
    get_latest_sector_projection_run,
    save_sector_projection_run,
    sector_projection_quality_status,
)
from app.models.system_status import SystemStatus
from typing import Dict
from app.services.sector_projection_analytics import build_sector_projection_analytics

router = APIRouter()

# Cache historical scores since they don't change (based on date)
_historical_scores_cache = {}
_cache_date = None
_analytics_cache_key = None
_analytics_cache_payload = None
_analytics_cache_expires_at = 0.0

def _get_or_compute_historical_scores(db: Session) -> Dict[str, float]:
    """Get cached historical scores or compute them once per day (UTC)."""
    global _historical_scores_cache, _cache_date
    
    today_utc = datetime.utcnow().date()
    
    # Return cached result if we have it for today
    if _cache_date == today_utc and _historical_scores_cache:
        return _historical_scores_cache

    # Avoid expensive Yahoo history pulls during requests.
    # This prevents long-running requests that can trigger 504s.
    _historical_scores_cache = {}
    _cache_date = today_utc
    return _historical_scores_cache

@router.get("/sectors/projections/latest")
def get_latest_projections():
    import math
    def clean_float(val):
        """Convert NaN/Inf to None for JSON serialization"""
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            return None
        return val
    
    with get_db_session() as db:
        run = get_latest_sector_projection_run(db)
        if not run:
            raise HTTPException(status_code=404, detail="No sector projections available.")
        values = db.query(SectorProjectionValue).filter_by(run_id=run.id).all()
        result = {}
        # Group by horizon first to get correct count per horizon
        for v in values:
            result.setdefault(v.horizon, [])
        
        # Now add each value with correct classification
        for v in values:
            n_sectors = len([val for val in values if val.horizon == v.horizon])
            result[v.horizon].append({
                "sector_symbol": v.sector_symbol,
                "sector_name": v.sector_name,
                "score_total": clean_float(v.score_total),
                "score_trend": clean_float(v.score_trend),
                "score_rel": clean_float(v.score_rel),
                "score_risk": clean_float(v.score_risk),
                "score_regime": clean_float(v.score_regime),
                "rank": v.rank,
                "metrics": {k: clean_float(val) for k, val in (v.metrics_json or {}).items()},
                "classification": classify_rank(v.rank, n_sectors),
            })
        
        # Compute or get cached historical scores
        historical_scores = _get_or_compute_historical_scores(db)
        
        config = run.config_json or {}
        data_warnings = config.get("data_warnings", [])
        return {
            "run_id": run.id,
            "as_of_date": str(run.as_of_date),
            "created_at": run.created_at.isoformat(),
            "model_version": run.model_version,
            "system_state": run.system_state,
            "data_warnings": data_warnings,
            "quality_status": config.get("quality_status") or sector_projection_quality_status(data_warnings),
            "excluded_from_latest": config.get("excluded_from_latest", False),
            "projections": result,
            "historical": historical_scores,  # {sector_symbol: score_3m_ago}
        }

@router.get("/sectors/projections/warnings")
def get_projection_warnings():
    with get_db_session() as db:
        run = db.query(SectorProjectionRun).order_by(SectorProjectionRun.created_at.desc()).first()
        if not run:
            raise HTTPException(status_code=404, detail="No sector projections available.")
        return {
            "run_id": run.id,
            "as_of_date": str(run.as_of_date),
            "created_at": run.created_at.isoformat(),
            "system_state": run.system_state,
            "data_warnings": (run.config_json or {}).get("data_warnings", []),
        }

def classify_rank(rank, n):
    if rank <= 3:
        return "Winner"
    elif rank > n - 3:
        return "Loser"
    return "Neutral"

@router.get("/sectors/projections/history")
def get_projection_history(days: int = Query(365, ge=1, le=1095)):
    cutoff = datetime.utcnow().date() - timedelta(days=days)
    with get_db_session() as db:
        return build_sector_projection_history(db, cutoff)


@router.get("/sectors/projections/analytics")
def get_projection_analytics(
    days: int = Query(365, ge=60, le=1095),
    scanner_days: int = Query(45, ge=14, le=180),
):
    """Return compact stability, uncertainty, scanner, and leadership analytics."""
    global _analytics_cache_key, _analytics_cache_payload, _analytics_cache_expires_at
    cutoff = datetime.utcnow().date() - timedelta(days=days)
    scanner_cutoff = datetime.utcnow() - timedelta(days=scanner_days)
    with get_db_session() as db:
        run = get_latest_sector_projection_run(db)
        if not run:
            raise HTTPException(status_code=404, detail="No sector projections available.")
        latest_scanner_event_id = (
            db.query(func.max(OptionAlertEvent.id))
            .filter(OptionAlertEvent.triggered_at >= scanner_cutoff)
            .scalar()
        )
        cache_key = (run.id, latest_scanner_event_id, days, scanner_days)
        if (
            _analytics_cache_key == cache_key
            and _analytics_cache_payload is not None
            and time.monotonic() < _analytics_cache_expires_at
        ):
            return _analytics_cache_payload
        values = db.query(SectorProjectionValue).filter_by(run_id=run.id).all()
        latest_by_horizon = {}
        for value in values:
            latest_by_horizon.setdefault(value.horizon, []).append(
                {
                    "sector_symbol": value.sector_symbol,
                    "sector_name": value.sector_name,
                    "score_total": value.score_total,
                    "rank": value.rank,
                }
            )
        history = build_sector_projection_history(db, cutoff)
        scanner_events = (
            db.query(OptionAlertEvent)
            .filter(OptionAlertEvent.triggered_at >= scanner_cutoff)
            .order_by(OptionAlertEvent.triggered_at.asc(), OptionAlertEvent.id.asc())
            .all()
        )
        payload = build_sector_projection_analytics(
            history=history,
            latest_by_horizon=latest_by_horizon,
            scanner_events=scanner_events,
            as_of=run.as_of_date,
            scanner_lookback_days=scanner_days,
        )
        _analytics_cache_key = cache_key
        _analytics_cache_payload = payload
        _analytics_cache_expires_at = time.monotonic() + 300.0
        return payload

@router.post("/sectors/projections/refresh")
def refresh_projections():
    # Get current system state
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
        system_state = status.state if status else "YELLOW"
    # Fetch data and compute projections
    price_data = fetch_sector_price_history()
    duplicates = detect_duplicate_series(price_data)
    stale = detect_stale_series(price_data)
    warnings = []
    if duplicates:
        warnings.append({"type": "duplicate_series", "details": duplicates})
    if stale:
        warnings.append({"type": "stale_series", "details": stale})
    if duplicates:
        raise HTTPException(
            status_code=500,
            detail="Duplicate sector price series detected; aborting projection refresh.",
        )
    projections = compute_sector_projections(price_data, system_state=system_state)
    if not projections:
        raise HTTPException(status_code=500, detail="Failed to compute projections.")
    # Store in DB. Quality-blocked runs are retained for audit but excluded from
    # latest/history readers by default.
    as_of_date = datetime.utcnow().date()
    with get_db_session() as db:
        run, persisted_warnings = save_sector_projection_run(
            db,
            projections,
            system_state=system_state,
            source_warnings=warnings,
            as_of_date=as_of_date,
        )
        config = run.config_json or {}
        run_id = run.id
    return {
        "status": "ok",
        "as_of_date": str(as_of_date),
        "count": len(projections),
        "run_id": run_id,
        "quality_status": config.get("quality_status"),
        "excluded_from_latest": config.get("excluded_from_latest", False),
        "data_warnings": persisted_warnings,
    }
