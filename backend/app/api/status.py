from fastapi import APIRouter
from datetime import datetime, timedelta
from app.models.system_status import SystemStatus
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.utils.db_helpers import get_db_session
from app.utils.response_helpers import format_system_status, format_indicator_status

router = APIRouter()

@router.get("/system")
def get_system_status():
    with get_db_session() as db:
        status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
        return format_system_status(status)

@router.get("/system/history")
def get_system_history(days: int = 365):
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
        
        # Calculate composite score for each date
        history = []
        for date_key in sorted(date_values.keys()):
            day_values = date_values[date_key]
            
            # Get the latest value for each indicator on this date
            latest_per_indicator = {}
            for val in day_values:
                if val.indicator_id not in latest_per_indicator:
                    latest_per_indicator[val.indicator_id] = val
                elif val.timestamp > latest_per_indicator[val.indicator_id].timestamp:
                    latest_per_indicator[val.indicator_id] = val
            
            # Calculate weighted composite score
            total_weighted_score = 0
            total_weight = 0
            weighted_scores_by_code = {code: 0.0 for code in indicator_codes}
            red_count = 0
            yellow_count = 0
            
            for indicator_id, val in latest_per_indicator.items():
                if indicator_id in indicator_map:
                    indicator = indicator_map[indicator_id]
                    weight = indicator.weight or 0
                    score = val.score if val.score is not None else 0
                    weighted_score = score * weight
                    total_weighted_score += weighted_score
                    total_weight += weight
                    weighted_scores_by_code[indicator.code] = weighted_score
                    
                    if val.state == "RED":
                        red_count += 1
                    elif val.state == "YELLOW":
                        yellow_count += 1
            
            if total_weight > 0:
                composite_score = total_weighted_score / total_weight
                
                # Determine system state based on composite score
                if composite_score >= 70:
                    state = "GREEN"
                elif composite_score >= 40:
                    state = "YELLOW"
                else:
                    state = "RED"
                
                # Use end of day for timestamp
                timestamp = datetime.combine(date_key, datetime.max.time())
                
                contributions = {
                    code: round(weighted_scores_by_code[code] / total_weight, 2)
                    for code in indicator_codes
                }

                history.append({
                    "timestamp": timestamp.isoformat(),
                    "composite_score": round(composite_score, 1),
                    "state": state,
                    "red_count": red_count,
                    "yellow_count": yellow_count,
                    "contributions": contributions,
                })
        
        return history

@router.get("/indicators")
def get_indicator_status():
    with get_db_session() as db:
        indicators = db.query(Indicator).all()
        values = (
            db.query(IndicatorValue)
            .order_by(IndicatorValue.timestamp.desc())
            .all()
        )

        # Build a map of latest values per indicator
        latest = {}
        for v in values:
            if v.indicator_id not in latest:
                latest[v.indicator_id] = v

        # Format each indicator with its latest value
        return [
            format_indicator_status(ind, latest.get(ind.id))
            for ind in indicators
        ]
