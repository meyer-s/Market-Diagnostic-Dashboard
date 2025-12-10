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