from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.services.ingestion.etl_runner import _normalize_observation_timestamp, _upsert_indicator_value


def test_upsert_indicator_value_reuses_existing_logical_observation() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = session_local()
    indicator = Indicator(
        code="VIX",
        name="VIX",
        source="yahoo",
        source_symbol="^VIX",
        category="volatility",
        direction=1,
        lookback_days_for_z=252,
        threshold_green_max=40,
        threshold_yellow_max=70,
        weight=1.0,
    )
    db.add(indicator)
    db.commit()

    timestamp = datetime(2026, 5, 21, 15, 30, 59, 123)
    _upsert_indicator_value(
        db,
        indicator_id=indicator.id,
        timestamp=timestamp,
        raw_value=25.0,
        normalized_value=45.0,
        score=45.0,
        state="YELLOW",
    )
    _upsert_indicator_value(
        db,
        indicator_id=indicator.id,
        timestamp=timestamp,
        raw_value=30.0,
        normalized_value=35.0,
        score=35.0,
        state="RED",
    )
    db.commit()

    values = db.query(IndicatorValue).all()
    assert len(values) == 1
    assert values[0].timestamp == _normalize_observation_timestamp(timestamp)
    assert values[0].raw_value == 30.0
    assert values[0].score == 35.0
    assert values[0].state == "RED"
    db.close()
