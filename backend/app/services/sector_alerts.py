"""
Sector Divergence Alert Service
Generates alerts when sector leadership patterns diverge from expected market regime behavior.
"""
from typing import List, Dict, Any
from datetime import datetime
from app.utils.db_helpers import get_db_session
from app.models.sector_projection import SectorProjectionValue
from app.services.sector_projection import get_latest_sector_projection_run

# Sector classifications
DEFENSIVE_SECTORS = ["XLU", "XLP", "XLV"]
CYCLICAL_SECTORS = ["XLE", "XLF", "XLK", "XLY"]


def check_sector_divergence_alerts() -> List[Dict[str, Any]]:
    """
    Check for divergence alerts based on sector leadership vs market regime.
    
    Alerts:
    1. RED market + Cyclical leaders = Potential recovery signal
    2. GREEN market + Defensive leaders = Early warning sign
    3. Strong divergence = Regime transition possible
    
    Returns: List of alert dicts (not saved to DB, consumed by UI)
    """
    alerts = []
    
    with get_db_session() as db:
        # Get latest projection run
        run = get_latest_sector_projection_run(db)
        
        if not run:
            return alerts
        
        # Get 3m projections (most recent trend)
        values = db.query(SectorProjectionValue).filter_by(
            run_id=run.id,
            horizon="3m"
        ).all()
        
        # Get current system state
        system_state = run.system_state
        
        # Calculate averages
        defensive_scores = [v.score_total for v in values if v.sector_symbol in DEFENSIVE_SECTORS]
        cyclical_scores = [v.score_total for v in values if v.sector_symbol in CYCLICAL_SECTORS]
        
        if not defensive_scores or not cyclical_scores:
            return alerts
        
        defensive_avg = sum(defensive_scores) / len(defensive_scores)
        cyclical_avg = sum(cyclical_scores) / len(cyclical_scores)
        spread = defensive_avg - cyclical_avg
        
        # Get top 3 sectors overall
        top_sectors = sorted(values, key=lambda v: v.score_total, reverse=True)[:3]
        top_sector_symbols = [s.sector_symbol for s in top_sectors]
        
        # Count defensive vs cyclical in top 3
        defensive_in_top = sum(1 for s in top_sector_symbols if s in DEFENSIVE_SECTORS)
        cyclical_in_top = sum(1 for s in top_sector_symbols if s in CYCLICAL_SECTORS)
        
        # Alert 1: RED market with cyclical leaders (recovery signal)
        if system_state == "RED" and spread < -10:
            alerts.append({
                "type": "SECTOR_DIVERGENCE",
                "severity": "INFO",
                "title": "Recovery Signal: Cyclicals Leading in RED Market",
                "message": f"Cyclical sectors outperforming defensives by {abs(spread):.1f} points in RED market. This may indicate early recovery positioning.",
                "details": {
                    "system_state": system_state,
                    "defensive_avg": round(defensive_avg, 1),
                    "cyclical_avg": round(cyclical_avg, 1),
                    "spread": round(spread, 1),
                    "cyclical_in_top_3": cyclical_in_top,
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
        
        # Alert 2: RED market with strong defensive bias (expected but monitor magnitude)
        elif system_state == "RED" and spread > 15:
            alerts.append({
                "type": "SECTOR_DIVERGENCE",
                "severity": "WARNING",
                "title": "Extreme Flight to Safety",
                "message": f"Defensives outperforming cyclicals by {spread:.1f} points in RED market. Extremely risk-off positioning.",
                "details": {
                    "system_state": system_state,
                    "defensive_avg": round(defensive_avg, 1),
                    "cyclical_avg": round(cyclical_avg, 1),
                    "spread": round(spread, 1),
                    "defensive_in_top_3": defensive_in_top,
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
        
        # Alert 3: GREEN market with defensive leaders (warning sign)
        elif system_state == "GREEN" and spread > 10:
            alerts.append({
                "type": "SECTOR_DIVERGENCE",
                "severity": "WARNING",
                "title": "Caution Signal: Defensives Leading in GREEN Market",
                "message": f"Defensive sectors outperforming cyclicals by {spread:.1f} points in GREEN market. This may indicate early weakness.",
                "details": {
                    "system_state": system_state,
                    "defensive_avg": round(defensive_avg, 1),
                    "cyclical_avg": round(cyclical_avg, 1),
                    "spread": round(spread, 1),
                    "defensive_in_top_3": defensive_in_top,
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
        
        # Alert 4: GREEN market with strong cyclical bias (healthy)
        elif system_state == "GREEN" and spread < -15:
            alerts.append({
                "type": "SECTOR_DIVERGENCE",
                "severity": "INFO",
                "title": "Strong Risk-On Environment",
                "message": f"Cyclicals outperforming defensives by {abs(spread):.1f} points in GREEN market. Healthy risk appetite confirmed.",
                "details": {
                    "system_state": system_state,
                    "defensive_avg": round(defensive_avg, 1),
                    "cyclical_avg": round(cyclical_avg, 1),
                    "spread": round(spread, 1),
                    "cyclical_in_top_3": cyclical_in_top,
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
        
        # Alert 5: YELLOW market with extreme bias (transition signal)
        elif system_state == "YELLOW" and abs(spread) > 15:
            direction = "defensive" if spread > 0 else "cyclical"
            alerts.append({
                "type": "SECTOR_DIVERGENCE",
                "severity": "WARNING",
                "title": f"Regime Transition Signal: Strong {direction.title()} Bias",
                "message": f"Strong {direction} positioning ({abs(spread):.1f} point spread) in YELLOW market suggests potential regime shift.",
                "details": {
                    "system_state": system_state,
                    "defensive_avg": round(defensive_avg, 1),
                    "cyclical_avg": round(cyclical_avg, 1),
                    "spread": round(spread, 1),
                    "direction": direction,
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
    
    return alerts
