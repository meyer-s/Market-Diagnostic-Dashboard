"""
Alert API Endpoints
"""
from fastapi import APIRouter
from app.services.alert_engine import get_recent_alerts, get_all_alerts, check_alert_conditions

router = APIRouter()


@router.get("/alerts")
def list_alerts(hours: int = 24):
    """Get recent alerts"""
    alerts = get_recent_alerts(hours=hours)
    
    return [
        {
            "id": alert.id,
            "timestamp": alert.timestamp,
            "type": alert.type,
            "message": alert.message,
            "affected_indicators": alert.affected_indicators
        }
        for alert in alerts
    ]


@router.post("/alerts/check")
def trigger_alert_check():
    """Manually trigger alert condition check"""
    alert = check_alert_conditions()
    
    if alert:
        return {
            "alert_triggered": True,
            "alert": {
                "id": alert.id,
                "timestamp": alert.timestamp,
                "type": alert.type,
                "message": alert.message,
                "affected_indicators": alert.affected_indicators
            }
        }
    
    return {"alert_triggered": False, "message": "No alert conditions met"}
