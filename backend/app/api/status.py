from fastapi import APIRouter
from sqlalchemy.orm import Session
from app.core.db import SessionLocal
from app.models.system_status import SystemStatus
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/system")
def get_system_status():
    db = SessionLocal()
    status = db.query(SystemStatus).order_by(SystemStatus.timestamp.desc()).first()
    db.close()

    if not status:
        return {
            "state": "UNKNOWN",
            "composite_score": None,
            "red_count": 0,
            "yellow_count": 0
        }

    return {
        "timestamp": status.timestamp,
        "state": status.state,
        "composite_score": status.composite_score,
        "red_count": status.red_count,
        "yellow_count": status.yellow_count
    }

@router.get("/indicators")
def get_indicator_status():
    db = SessionLocal()

    indicators = db.query(Indicator).all()
    values = (
        db.query(IndicatorValue)
        .order_by(IndicatorValue.timestamp.desc())
        .all()
    )

    db.close()

    latest = {}
    for v in values:
        if v.indicator_id not in latest:
            latest[v.indicator_id] = v

    out = []
    for ind in indicators:
        v = latest.get(ind.id)
        if v:
            out.append({
                "code": ind.code,
                "name": ind.name,
                "raw_value": v.raw_value,
                "score": v.score,
                "state": v.state,
                "timestamp": v.timestamp
            })

    return out