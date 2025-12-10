"""
Alert Engine
Monitors indicator states and triggers alerts when conditions are met
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.core.db import SessionLocal
from app.models.indicator import Indicator
from app.models.alert import Alert

def check_alert_conditions():
    """
    Check if 2 or more indicators are RED and create an alert if needed.
    Returns: Alert object if condition met, None otherwise
    """
    db = SessionLocal()
    
    try:
        # Count RED indicators
        red_indicators = db.query(Indicator).filter(
            Indicator.last_state == "RED"
        ).all()
        
        red_count = len(red_indicators)
        
        # Alert condition: 2 or more RED indicators
        if red_count >= 2:
            # Check if we already have a recent alert (within last hour)
            from datetime import timedelta
            recent_threshold = datetime.now() - timedelta(hours=1)
            
            recent_alert = db.query(Alert).filter(
                Alert.timestamp >= recent_threshold,
                Alert.type == "RED_THRESHOLD"
            ).first()
            
            if not recent_alert:
                # Create new alert
                affected_codes = [ind.code for ind in red_indicators]
                alert = Alert(
                    timestamp=datetime.now(),
                    type="RED_THRESHOLD",
                    message=f"Market instability detected: {red_count} indicators are RED",
                    affected_indicators=affected_codes
                )
                db.add(alert)
                db.commit()
                db.refresh(alert)
                
                print(f"🚨 ALERT TRIGGERED: {red_count} RED indicators - {', '.join(affected_codes)}")
                return alert
        
        return None
        
    finally:
        db.close()


def get_recent_alerts(hours: int = 24):
    """Get alerts from the last N hours"""
    db = SessionLocal()
    
    try:
        from datetime import timedelta
        since = datetime.now() - timedelta(hours=hours)
        
        alerts = db.query(Alert).filter(
            Alert.timestamp >= since
        ).order_by(Alert.timestamp.desc()).all()
        
        return alerts
    finally:
        db.close()


def get_all_alerts(limit: int = 100):
    """Get all alerts, most recent first"""
    db = SessionLocal()
    
    try:
        alerts = db.query(Alert).order_by(
            Alert.timestamp.desc()
        ).limit(limit).all()
        
        return alerts
    finally:
        db.close()
