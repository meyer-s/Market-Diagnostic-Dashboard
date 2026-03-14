from fastapi import APIRouter, Query
from sqlalchemy import func
from datetime import datetime, timedelta
from app.models.system_status import SystemStatus
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.utils.db_helpers import get_db_session
from app.utils.response_helpers import format_system_status, format_indicator_status
from app.utils.system_scoring import compute_weighted_composite

router = APIRouter()

@router.get("/system")
def get_system_status():
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
        return format_system_status(status)

@router.get("/system/history")
def get_system_history(days: int = Query(365, ge=1, le=1095)):
    """
    Return time-series history of composite system scores.
    
    Calculates scores dynamically from indicator history to support arbitrary date ranges.
    This approach eliminates the limitation of the SystemStatus table which only contains
    recent ETL update records. By aggregating indicator values by day and computing
    weighted composite scores, we can provide historical data for any requested period.
    
    Args:
        days: Number of days of history to return (default: 365)
    
    Returns:
        List of daily system status records with composite score, state, and indicator counts
    """
    with get_db_session() as db:
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        # Get all indicators with their weights
        indicators = db.query(Indicator).all()
        indicator_map = {ind.id: ind for ind in indicators}
        indicator_codes = [ind.code for ind in indicators]
        
        # Get historical values for all indicators within date range
        values = (
            db.query(IndicatorValue)
            .filter(IndicatorValue.timestamp >= cutoff)
            .order_by(IndicatorValue.timestamp.asc())
            .all()
        )
        
        # Group values by date (day granularity)
        from collections import defaultdict
        date_values = defaultdict(list)
        for val in values:
            date_key = val.timestamp.date()
            date_values[date_key].append(val)

        # Seed last known values before cutoff so counts carry forward
        last_seen = {}
        for indicator in indicators:
            last_value = (
                db.query(IndicatorValue)
                .filter(
                    IndicatorValue.indicator_id == indicator.id,
                    IndicatorValue.timestamp < cutoff,
                )
                .order_by(IndicatorValue.timestamp.desc())
                .first()
            )
            if last_value:
                last_seen[indicator.id] = last_value

        # Calculate composite score for each date
        history = []
        start_date = cutoff.date()
        end_date = datetime.utcnow().date()
        current_date = start_date
        while current_date <= end_date:
            day_values = date_values.get(current_date, [])

            for val in day_values:
                existing = last_seen.get(val.indicator_id)
                if not existing or val.timestamp > existing.timestamp:
                    last_seen[val.indicator_id] = val

            if not last_seen:
                current_date += timedelta(days=1)
                continue

            # Calculate weighted composite score using carried-forward values
            red_count = 0
            yellow_count = 0
            scores_by_code = {}
            weights_by_code = {}

            for indicator_id, val in last_seen.items():
                indicator = indicator_map.get(indicator_id)
                if not indicator:
                    continue
                scores_by_code[indicator.code] = val.score
                weights_by_code[indicator.code] = indicator.weight or 0

                if val.state == "RED":
                    red_count += 1
                elif val.state == "YELLOW":
                    yellow_count += 1

            total_count = len(last_seen)
            green_count = max(0, total_count - red_count - yellow_count)

            composite_score, weights_used = compute_weighted_composite(scores_by_code, weights_by_code)
            if composite_score is not None:

                # Determine system state based on composite score
                if composite_score >= 70:
                    state = "GREEN"
                elif composite_score >= 40:
                    state = "YELLOW"
                else:
                    state = "RED"

                # Use end of day for timestamp
                timestamp = datetime.combine(current_date, datetime.max.time())

                contributions = {
                    code: round((scores_by_code.get(code) or 0.0) * weights_used.get(code, 0.0), 2)
                    for code in indicator_codes
                }

                history.append({
                    "timestamp": timestamp.isoformat(),
                    "composite_score": round(composite_score, 1),
                    "state": state,
                    "red_count": red_count,
                    "yellow_count": yellow_count,
                    "green_count": green_count,
                    "total_count": total_count,
                    "contributions": contributions,
                })

            current_date += timedelta(days=1)

        return history

@router.get("/indicators")
def get_indicator_status():
    with get_db_session() as db:
        indicators = db.query(Indicator).all()

        # Subquery: latest timestamp per indicator_id
        subq = (
            db.query(
                IndicatorValue.indicator_id,
                func.max(IndicatorValue.timestamp).label("max_ts"),
            )
            .group_by(IndicatorValue.indicator_id)
            .subquery()
        )
        values = (
            db.query(IndicatorValue)
            .join(
                subq,
                (IndicatorValue.indicator_id == subq.c.indicator_id)
                & (IndicatorValue.timestamp == subq.c.max_ts),
            )
            .all()
        )

        latest = {v.indicator_id: v for v in values}
        return [
            format_indicator_status(ind, latest.get(ind.id))
            for ind in indicators
        ]
