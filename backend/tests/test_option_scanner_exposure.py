from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta
import hashlib
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import secret_options
from app.core.config import settings
from app.core.db import Base
from app.models.option_scanner_exposure import (
    OptionScannerImpression,
    OptionScannerRankSnapshot,
)
from app.models.option_sweep_runs import OptionSweepRun
from app.models.options_alerts import OptionAlertEvent
from app.services import option_sweep_runs


READ_KEY = "read-" + ("r" * 40)
WRITE_KEY = "write-" + ("w" * 40)


@pytest.fixture()
def scanner_exposure_app(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_local = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )
    Base.metadata.create_all(bind=engine)

    @contextmanager
    def testing_db_session():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(
        option_sweep_runs,
        "get_db_session",
        testing_db_session,
    )
    monkeypatch.setattr(
        secret_options,
        "get_db_session",
        testing_db_session,
    )
    monkeypatch.setattr(option_sweep_runs, "learning_summary", lambda _db: {})
    monkeypatch.setattr(
        option_sweep_runs,
        "build_learning_influence_context",
        lambda _summary: {},
    )
    monkeypatch.setattr(
        option_sweep_runs,
        "load_scanner_repeat_evidence_context",
        lambda _db, *, events: None,
    )
    monkeypatch.setattr(
        option_sweep_runs,
        "position_match_for_event",
        lambda _event, _context: None,
    )
    monkeypatch.setattr(
        option_sweep_runs,
        "record_scanner_recurrence_events_for_run",
        lambda _db, _run_id: [],
    )

    def attach_test_ranks(opportunities, _context):
        applied_order = {"LOW": 1, "HIGH": 2}
        for opportunity in opportunities:
            symbol = str(opportunity["symbol"])
            applied_rank = applied_order[symbol]
            champion_rank = 1 if symbol == "HIGH" else 2
            champion_score = 90.0 if symbol == "HIGH" else 60.0
            applied_score = 91.0 if symbol == "HIGH" else 95.0
            opportunity["learning_evaluation"] = {
                "version": "test_learning_v1",
                "point_in_time_receipt": True,
                "captured_at": "2026-07-26T12:00:00",
                "champion_rank": champion_rank,
                "counterfactual_rank": applied_rank,
                "applied_rank": applied_rank,
                "champion_score": champion_score,
                "counterfactual_score": applied_score,
                "applied_score": applied_score,
                "applied_weight": 0.1,
            }
            opportunity["score"] = applied_score
            opportunity["ranking_model_version"] = "test_learning_v1"
        return {
            "version": "test_learning_v1",
            "mode": "bounded_live_canary",
            "maximum_applied_weight": 0.1,
            "actual_order_unchanged": False,
        }

    monkeypatch.setattr(
        option_sweep_runs,
        "_attach_learning_evaluations",
        attach_test_ranks,
    )

    app = FastAPI()
    app.include_router(secret_options.router)
    return TestClient(app), session_local


def _insert_running_run(session_local) -> tuple[int, dict[str, int]]:
    now = datetime.utcnow()
    with session_local() as db:
        run = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="running",
            total_symbols=2,
            scanned_symbols=2,
            hits=2,
            hit_symbols="HIGH,LOW",
            started_at=now - timedelta(minutes=2),
            created_at=now - timedelta(minutes=2),
            updated_at=now,
        )
        db.add(run)
        db.flush()
        high = OptionAlertEvent(
            symbol="HIGH",
            sweep_run_id=run.id,
            triggered_at=now - timedelta(minutes=1),
            opportunity_score=90.0,
            opportunity_model_version="opportunity_test_v1",
            delivered=True,
        )
        low = OptionAlertEvent(
            symbol="LOW",
            sweep_run_id=run.id,
            triggered_at=now,
            opportunity_score=60.0,
            opportunity_model_version="opportunity_test_v1",
            delivered=True,
        )
        db.add_all([high, low])
        db.commit()
        return int(run.id), {"HIGH": int(high.id), "LOW": int(low.id)}


def test_terminal_finalization_freezes_rank_order_once_and_get_never_writes(
    scanner_exposure_app,
) -> None:
    client, session_local = scanner_exposure_app
    run_id, event_ids = _insert_running_run(session_local)

    active_response = client.get(f"/secret/options/scanner-run/{run_id}")
    assert active_response.status_code == 200
    assert active_response.json()["ranking_snapshot"] is None
    assert [row["symbol"] for row in active_response.json()["hits"]] == [
        "LOW",
        "HIGH",
    ]
    with session_local() as db:
        assert db.query(OptionScannerRankSnapshot).count() == 0

    option_sweep_runs.finish_sweep_run(
        run_id,
        status="completed",
        total_symbols=2,
        hits=2,
        hit_symbols=["HIGH", "LOW"],
    )
    first = client.get(f"/secret/options/scanner-run/{run_id}").json()
    snapshot = first["ranking_snapshot"]
    assert snapshot["integrity_verified"] is True
    assert snapshot["candidate_count"] == 2
    assert [candidate["symbol"] for candidate in snapshot["candidates"]] == [
        "LOW",
        "HIGH",
    ]
    assert snapshot["candidates"][0] == {
        "applied_rank": 1,
        "applied_score": 95.0,
        "applied_weight": 0.1,
        "champion_rank": 2,
        "champion_score": 60.0,
        "counterfactual_rank": 1,
        "counterfactual_score": 95.0,
        "display_ordinal": 1,
        "eligibility_reason": "persisted_scanner_hit",
        "event_id": event_ids["LOW"],
        "field_context_version": None,
        "included": True,
        "learning_receipt_captured_at": "2026-07-26T12:00:00",
        "learning_receipt_version": "test_learning_v1",
        "opportunity_model_version": "opportunity_test_v1",
        "point_in_time_receipt": True,
        "ranking_model_version": "test_learning_v1",
        "scan_ordinal": 2,
        "symbol": "LOW",
    }
    assert [row["display_ordinal"] for row in first["hits"]] == [1, 2]
    assert [row["scan_ordinal"] for row in first["hits"]] == [2, 1]

    with session_local() as db:
        stored = db.query(OptionScannerRankSnapshot).one()
        first_uuid = stored.snapshot_uuid
        first_hash = stored.payload_sha256
        assert hashlib.sha256(stored.payload_json.encode("utf-8")).hexdigest() == first_hash

    option_sweep_runs.finish_sweep_run(
        run_id,
        status="completed",
        total_symbols=2,
        hits=2,
        hit_symbols=["HIGH", "LOW"],
    )
    with session_local() as db:
        snapshots = db.query(OptionScannerRankSnapshot).all()
        assert len(snapshots) == 1
        assert snapshots[0].snapshot_uuid == first_uuid
        assert snapshots[0].payload_sha256 == first_hash

    for _ in range(2):
        assert client.get(f"/secret/options/scanner-run/{run_id}").status_code == 200
    with session_local() as db:
        assert db.query(OptionScannerRankSnapshot).count() == 1


def test_terminal_empty_run_gets_empty_snapshot_while_legacy_terminal_stays_null(
    scanner_exposure_app,
) -> None:
    client, session_local = scanner_exposure_app
    now = datetime.utcnow()
    with session_local() as db:
        fresh = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="running",
            total_symbols=1,
            scanned_symbols=1,
            hits=0,
            started_at=now,
            created_at=now,
            updated_at=now,
        )
        legacy = OptionSweepRun(
            universe_key="SP500",
            universe_label="S&P 500",
            threshold=30.0,
            trigger_source="dashboard",
            status="completed",
            total_symbols=1,
            scanned_symbols=1,
            hits=0,
            started_at=now - timedelta(days=1),
            completed_at=now - timedelta(days=1),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
        )
        db.add_all([fresh, legacy])
        db.commit()
        fresh_id = int(fresh.id)
        legacy_id = int(legacy.id)

    option_sweep_runs.finish_sweep_run(
        fresh_id,
        status="completed",
        total_symbols=1,
        hits=0,
        hit_symbols=[],
    )
    fresh_payload = client.get(f"/secret/options/scanner-run/{fresh_id}").json()
    legacy_payload = client.get(f"/secret/options/scanner-run/{legacy_id}").json()
    assert fresh_payload["ranking_snapshot"]["candidate_count"] == 0
    assert fresh_payload["ranking_snapshot"]["candidates"] == []
    assert legacy_payload["ranking_snapshot"] is None
    with session_local() as db:
        assert db.query(OptionScannerRankSnapshot).count() == 1


def test_stop_without_local_control_freezes_the_terminal_snapshot(
    scanner_exposure_app,
) -> None:
    _client, session_local = scanner_exposure_app
    run_id, _event_ids = _insert_running_run(session_local)

    result = option_sweep_runs.request_stop_dashboard_sweep(run_id)

    assert result["stopped"] is True
    assert result["run"]["status"] == "stopped"
    with session_local() as db:
        snapshot = db.query(OptionScannerRankSnapshot).one()
        assert snapshot.sweep_run_id == run_id
        assert snapshot.candidate_count == 2


def test_read_authenticated_impressions_are_idempotent_and_snapshot_bounded(
    scanner_exposure_app,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, session_local = scanner_exposure_app
    run_id, event_ids = _insert_running_run(session_local)
    option_sweep_runs.finish_sweep_run(
        run_id,
        status="completed",
        total_symbols=2,
        hits=2,
        hit_symbols=["HIGH", "LOW"],
    )
    snapshot = client.get(f"/secret/options/scanner-run/{run_id}").json()[
        "ranking_snapshot"
    ]

    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_AUTH_REQUIRED", None)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_API_KEY", READ_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_API_KEY", WRITE_KEY)
    monkeypatch.setattr(settings, "SECRET_OPTIONS_READ_ACTOR", "research-reader")
    monkeypatch.setattr(settings, "SECRET_OPTIONS_WRITE_ACTOR", "portfolio-writer")
    headers = {
        "Authorization": f"Bearer {READ_KEY}",
        "X-Request-ID": "scanner-impression-read-1",
    }
    body = {
        "snapshot_id": snapshot["id"],
        "page_session_id": "page-session-" + ("x" * 24),
        "exposures": [
            {
                "client_impression_id": "impression-ranking-0001",
                "exposure_type": "ranking_rendered",
                "client_occurred_at": datetime.utcnow().isoformat(),
                "metadata": {
                    "candidate_count": 2,
                    "actor": "must-not-be-trusted",
                },
            },
            {
                "client_impression_id": "impression-candidate-001",
                "exposure_type": "candidate_visible",
                "event_id": event_ids["LOW"],
                "visibility_ratio": 0.75,
                "visible_ms": 900,
            },
        ],
    }
    first = client.post(
        "/secret/options/scanner-impressions",
        headers=headers,
        json=body,
    )
    assert first.status_code == 200
    assert first.json() == {
        "snapshot_id": snapshot["id"],
        "inserted": 2,
        "skipped_duplicates": 0,
        "received": 2,
    }
    repeated = client.post(
        "/secret/options/scanner-impressions",
        headers=headers,
        json=body,
    )
    assert repeated.status_code == 200
    assert repeated.json()["inserted"] == 0
    assert repeated.json()["skipped_duplicates"] == 2

    with session_local() as db:
        rows = (
            db.query(OptionScannerImpression)
            .order_by(OptionScannerImpression.id.asc())
            .all()
        )
        assert len(rows) == 2
        assert {row.actor for row in rows} == {"research-reader"}
        assert {row.request_id for row in rows} == {"scanner-impression-read-1"}
        assert all("page-session" not in row.page_session_hash for row in rows)
        assert all(len(row.page_session_hash) == 64 for row in rows)
        assert all(len(row.client_payload_sha256) == 64 for row in rows)
        assert json.loads(rows[0].metadata_json)["actor"] == "must-not-be-trusted"

    mismatched_replay = json.loads(json.dumps(body))
    mismatched_replay["exposures"][0]["metadata"]["candidate_count"] = 999
    conflict = client.post(
        "/secret/options/scanner-impressions",
        headers=headers,
        json=mismatched_replay,
    )
    assert conflict.status_code == 409
    assert "different payload" in conflict.json()["detail"]
    with session_local() as db:
        assert db.query(OptionScannerImpression).count() == 2

    invalid = client.post(
        "/secret/options/scanner-impressions",
        headers=headers,
        json={
            "snapshot_id": snapshot["id"],
            "page_session_id": "page-session-" + ("y" * 24),
            "exposures": [
                {
                    "client_impression_id": "impression-invalid-0001",
                    "exposure_type": "candidate_visible",
                    "event_id": max(event_ids.values()) + 1000,
                }
            ],
        },
    )
    assert invalid.status_code == 400
    assert "does not belong" in invalid.json()["detail"]
    with session_local() as db:
        assert db.query(OptionScannerImpression).count() == 2

    old_timestamp = client.post(
        "/secret/options/scanner-impressions",
        headers=headers,
        json={
            "snapshot_id": snapshot["id"],
            "page_session_id": "page-session-" + ("z" * 24),
            "exposures": [
                {
                    "client_impression_id": "impression-old-clock-001",
                    "exposure_type": "ranking_rendered",
                    "client_occurred_at": "2000-01-01T00:00:00",
                }
            ],
        },
    )
    assert old_timestamp.status_code == 200
    with session_local() as db:
        snapshot_row = db.query(OptionScannerRankSnapshot).one()
        old_row = (
            db.query(OptionScannerImpression)
            .filter(
                OptionScannerImpression.client_impression_id
                == "impression-old-clock-001"
            )
            .one()
        )
        assert old_row.client_occurred_at == (
            snapshot_row.source_generated_at - timedelta(minutes=5)
        )

    other_mutation = client.post(
        "/secret/options/scanner-run",
        headers=headers,
        json={"universe_key": "SP500", "threshold": 30.0},
    )
    assert other_mutation.status_code == 403
    assert other_mutation.json()["detail"] == (
        "The supplied Secret Options credential is read-only."
    )
