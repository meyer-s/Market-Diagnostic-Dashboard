import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.services.ingestion import etl_runner


def _build_test_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(etl_runner, "SessionLocal", testing_session_local)
    return testing_session_local


def _insert_indicator(session_factory, code: str):
    db = session_factory()
    db.add(
        Indicator(
            code=code,
            name=code.replace("_", " ").title(),
            source="DERIVED",
            source_symbol=f"{code}_OVERVIEW",
            category="market_page",
            direction=-1,
            lookback_days_for_z=365,
            threshold_green_max=40,
            threshold_yellow_max=70,
            weight=1.0,
        )
    )
    db.commit()
    db.close()


def test_ingest_page_input_persists_latest_point(monkeypatch):
    session_factory = _build_test_session(monkeypatch)
    _insert_indicator(session_factory, "AGRICULTURE_STABILITY")

    monkeypatch.setattr(etl_runner, "get_page_input_history", lambda code, days=365: [
        {"timestamp": "2026-05-12T00:00:00", "raw_value": 58.0, "score": 58.0, "state": "YELLOW"},
        {"timestamp": "2026-05-13T00:00:00", "raw_value": 62.0, "score": 62.0, "state": "YELLOW"},
    ])
    monkeypatch.setattr(etl_runner, "get_page_input_statuses", lambda days=365: [])

    runner = etl_runner.ETLRunner()
    result = asyncio.run(runner.ingest_indicator("AGRICULTURE_STABILITY"))

    db = session_factory()
    indicator = db.query(Indicator).filter(Indicator.code == "AGRICULTURE_STABILITY").first()
    values = db.query(IndicatorValue).filter(IndicatorValue.indicator_id == indicator.id).all()

    assert result["score"] == 62.0
    assert indicator.last_score == 62.0
    assert indicator.last_state == "YELLOW"
    assert len(values) == 1
    assert values[0].score == 62.0
    assert values[0].normalized_value == 62.0
    db.close()


def test_ingest_page_input_backfills_history(monkeypatch):
    session_factory = _build_test_session(monkeypatch)
    _insert_indicator(session_factory, "REAL_ESTATE_STABILITY")

    monkeypatch.setattr(etl_runner, "get_page_input_history", lambda code, days=365: [
        {"timestamp": "2026-05-11T00:00:00", "raw_value": 52.0, "score": 52.0, "state": "YELLOW"},
        {"timestamp": "2026-05-12T00:00:00", "raw_value": 55.0, "score": 55.0, "state": "YELLOW"},
        {"timestamp": "2026-05-13T00:00:00", "raw_value": 60.0, "score": 60.0, "state": "YELLOW"},
    ])
    monkeypatch.setattr(etl_runner, "get_page_input_statuses", lambda days=365: [])

    runner = etl_runner.ETLRunner()
    result = asyncio.run(runner.ingest_indicator("REAL_ESTATE_STABILITY", backfill_days=3))

    db = session_factory()
    indicator = db.query(Indicator).filter(Indicator.code == "REAL_ESTATE_STABILITY").first()
    values = (
        db.query(IndicatorValue)
        .filter(IndicatorValue.indicator_id == indicator.id)
        .order_by(IndicatorValue.timestamp.asc())
        .all()
    )

    assert result["backfilled"] == 3
    assert indicator.last_score == 60.0
    assert [value.score for value in values] == [52.0, 55.0, 60.0]
    db.close()