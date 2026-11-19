from contextlib import contextmanager
from datetime import date, datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import sector_projection as api
from app.core.db import Base
from app.models.options_alerts import OptionAlertEvent


def _api_database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    run = SimpleNamespace(id=42, as_of_date=date(2026, 11, 1), created_at=datetime(2026, 11, 1, 20),
        model_version="test", system_state="RED", config_json={"price_as_of_date": "2026-10-30", "price_observations": {"XLE": "2026-10-30"}})
    @contextmanager
    def session():
        yield db
    monkeypatch.setattr(api, "get_db_session", session)
    monkeypatch.setattr(api, "get_latest_sector_projection_run", lambda db: run)
    monkeypatch.setattr(api, "_analytics_cache_payload", None)
    return db


def test_latest_api_distinguishes_run_day_from_price_session(monkeypatch):
    db = _api_database(monkeypatch)
    result = api.get_latest_projections()
    assert result["as_of_date"] == "2026-11-01"
    assert result["price_as_of_date"] == "2026-10-30"
    assert result["price_observations"] == {"XLE": "2026-10-30"}
    db.close()


def test_analytics_api_bounds_scanner_evidence_to_selected_run(monkeypatch):
    db = _api_database(monkeypatch)
    db.add_all([
        OptionAlertEvent(symbol="IN_WINDOW", triggered_at=datetime(2026, 11, 1, 23, 59)),
        OptionAlertEvent(symbol="FUTURE", triggered_at=datetime(2026, 11, 2)),
        OptionAlertEvent(symbol="TOO_OLD", triggered_at=datetime(2026, 9, 1)),
    ])
    db.commit()
    monkeypatch.setattr(api, "build_sector_projection_history", lambda *args: {})
    monkeypatch.setattr(api, "build_sector_projection_analytics", lambda **kwargs: {
        "selected_symbols": [event.symbol for event in kwargs["scanner_events"]],
        "as_of_date": kwargs["as_of"].isoformat(),
    })
    result = api.get_projection_analytics(days=60, scanner_days=45)
    assert result["selected_symbols"] == ["IN_WINDOW"]
    assert result["run_id"] == 42
    assert result["price_as_of_date"] == "2026-10-30"
    db.close()