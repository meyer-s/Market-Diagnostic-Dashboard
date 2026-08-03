from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier
from types import SimpleNamespace

from sqlalchemy import URL, create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
import pandas as pd

from app.api import stock_projection
from app.api.stock_projection import _insert_institutional_flow_events, _sync_institutional_flow_history
from app.models.institutional_flow_event import InstitutionalFlowEvent


def _event_row() -> dict:
    return {
        "symbol": "SPY",
        "event_date": datetime(2026, 7, 29),
        "side": "sell",
        "price": 729.46,
        "volume": 70_697_200,
        "notional": 51_573_842_632.0,
        "volume_z": 2.4,
        "clv": -0.8,
        "price_change_pct": -1.2,
        "strength": 0.91,
    }


def _new_event_row() -> dict:
    row = _event_row()
    row.update(
        {
            "event_date": datetime(2026, 7, 30),
            "side": "buy",
            "price": 731.12,
            "volume": 62_004_100,
        }
    )
    return row


def test_institutional_flow_insert_is_safe_when_workers_race(tmp_path) -> None:
    database_path = tmp_path / "institutional-flow-race.sqlite3"
    engine = create_engine(
        URL.create("sqlite+pysqlite", database=str(database_path)),
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    InstitutionalFlowEvent.__table__.create(bind=engine)
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    start = Barrier(2)

    def insert_from_worker() -> None:
        db = session_local()
        try:
            start.wait(timeout=5)
            _insert_institutional_flow_events(db, [_event_row()])
            db.commit()
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(insert_from_worker) for _ in range(2)]
        for future in futures:
            future.result(timeout=15)

    db = session_local()
    try:
        rows = db.query(InstitutionalFlowEvent).all()
        assert len(rows) == 1
        assert rows[0].symbol == "SPY"
        assert rows[0].volume == 70_697_200
    finally:
        db.close()
        engine.dispose()


def test_flow_insert_keeps_new_rows_when_batch_also_contains_duplicate() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    InstitutionalFlowEvent.__table__.create(bind=engine)
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = session_local()

    try:
        _insert_institutional_flow_events(db, [_event_row()])
        db.commit()

        _insert_institutional_flow_events(db, [_event_row(), _new_event_row()])

        # Core inserts must remain immediately queryable in the caller's
        # session; the endpoint reads the complete history after committing.
        rows = (
            db.query(InstitutionalFlowEvent)
            .order_by(InstitutionalFlowEvent.event_date.asc())
            .all()
        )
        assert [(row.event_date.date(), row.side) for row in rows] == [
            (datetime(2026, 7, 29).date(), "sell"),
            (datetime(2026, 7, 30).date(), "buy"),
        ]
    finally:
        db.close()
        engine.dispose()


def test_postgres_flow_insert_uses_atomic_unique_conflict_handling() -> None:
    class CapturingSession:
        bind = SimpleNamespace(dialect=postgresql.dialect())

        def __init__(self) -> None:
            self.statement = None

        def execute(self, statement) -> None:
            self.statement = statement

    db = CapturingSession()
    _insert_institutional_flow_events(db, [_event_row()])

    assert db.statement is not None
    compiled = str(db.statement.compile(dialect=postgresql.dialect()))
    assert (
        "ON CONFLICT (symbol, event_date, side, price, volume) DO NOTHING"
        in compiled
    )


def test_flow_history_returns_newest_250_in_chronological_order() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    InstitutionalFlowEvent.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    start = datetime(2025, 1, 1)
    try:
        for index in range(300):
            row = _event_row()
            row["event_date"] = start + pd.Timedelta(days=index)
            row["price"] = 100.0 + index
            row["volume"] = 1_000_000 + index
            db.add(InstitutionalFlowEvent(**row))
        db.commit()

        payload = _sync_institutional_flow_history(db, "SPY", pd.DataFrame(), 399.0)

        assert len(payload["event_history"]) == 250
        assert payload["event_history"][0]["date"] == (start + pd.Timedelta(days=50)).date().isoformat()
        assert payload["event_history"][-1]["date"] == (start + pd.Timedelta(days=299)).date().isoformat()
        assert payload["method"]["name"] == "high_volume_accumulation_proxy"
        assert payload["method"]["direct_institutional_tape"] is False
        assert payload["summary"]["signal_strength"] == payload["summary"]["confidence"]
    finally:
        db.close()
        engine.dispose()


def test_flow_reconciliation_removes_superseded_events(monkeypatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    InstitutionalFlowEvent.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    try:
        old = _event_row()
        old["event_date"] = datetime(2026, 7, 29)
        db.add(InstitutionalFlowEvent(**old))
        db.commit()

        replacement = {
            "date": "2026-07-29",
            "side": "buy",
            "price": 730.0,
            "volume": 71_000_000,
            "notional": 51_830_000_000.0,
            "volume_z": 2.6,
            "clv": 0.7,
            "price_change_pct": 1.0,
            "strength": 1.82,
        }
        monkeypatch.setattr(stock_projection, "detect_flow_events_from_frame", lambda *args, **kwargs: [replacement])
        index = pd.date_range("2026-07-01", "2026-07-31", freq="B")
        frame = pd.DataFrame(
            {
                "Open": 700.0,
                "High": 735.0,
                "Low": 695.0,
                "Close": 730.0,
                "Volume": 71_000_000,
            },
            index=index,
        )

        payload = _sync_institutional_flow_history(db, "SPY", frame, 730.0)

        assert len(payload["event_history"]) == 1
        assert payload["event_history"][0]["side"] == "buy"
        assert db.query(InstitutionalFlowEvent).count() == 1
    finally:
        db.close()
        engine.dispose()
