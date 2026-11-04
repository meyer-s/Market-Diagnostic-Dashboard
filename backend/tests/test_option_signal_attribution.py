from datetime import date, datetime
import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.db import Base
from app.models.closed_positions import ClosedPosition
from app.models.option_positions import OptionPosition
from app.models.options_alerts import OptionAlertEvent
from app.models.option_decision_learning import OptionPositionEvent, OptionTradeOutcome
from app.services.option_decision_learning import create_trade_outcome, record_position_event
from app.services.option_signal_attribution import backfill_signal_links, resolve_signal_attribution


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def hit(db, *, when="2026-11-04T15:00:00", strike=290, expiry="2027-01-15", kind="call", strategy="call_debit_spread"):
    row = OptionAlertEvent(symbol="AMZN", triggered_at=datetime.fromisoformat(when),
        selected_expiry=expiry, selected_strike=strike, selected_option_type=kind, selected_strategy_type=strategy)
    db.add(row)
    db.flush()
    return row


def match(db, **kwargs):
    return resolve_signal_attribution(db, "AMZN", date(2026, 11, 4),
        expiration=date(2027, 1, 15), strike=290, option_type="call", **kwargs)


def position(db, **kwargs):
    fields = dict(symbol="AMZN", trade_date=date(2026, 11, 4), expiration=date(2027, 1, 15),
        strike=290, option_type="call", contracts=3, fill_price=2, total_cost=601.50,
        strategy_type="single_leg", source_match_method="fidelity_activity",
        source_match_confidence=1.0, source_match_notes="Broker source hash and settlement date.")
    fields.update(kwargs)
    row = OptionPosition(**fields)
    db.add(row)
    db.flush()
    return row


def test_exact_selected_leg_wins_over_later_different_strike(db):
    wanted = hit(db, when="2026-11-04T14:36:00")
    hit(db, strike=295)
    result = match(db)
    assert result["source_event_id"] == wanted.id
    assert result["source_match_method"] == "contract_leg+entry_date"
    assert result["source_match_confidence"] < 1
    assert "equivalence is unverified" in result["source_match_notes"]
    assert "execution time is unavailable" in result["source_match_notes"]


@pytest.mark.parametrize("values", [dict(kind="put"), dict(kind=None), dict(strategy="long_straddle"), dict(when="2026-11-05T15:00:00"), dict(when="2026-10-10T15:00:00")])
def test_incompatible_future_and_stale_hits_remain_unlinked(db, values):
    hit(db, **values)
    assert match(db)["source_event_id"] is None


def test_export_capture_time_rejects_later_same_day_hit(db):
    hit(db)
    assert match(db, latest_allowed_at=datetime.fromisoformat("2026-11-04T09:59:00-05:00"))["source_event_id"] is None


def test_us_entry_date_uses_eastern_not_utc(db):
    wanted = hit(db, when="2026-11-05T00:30:00", strategy="long_call")
    assert match(db)["source_event_id"] == wanted.id  # Nov 4, 7:30pm Eastern


def test_different_expiry_is_labelled_directional_only(db):
    hit(db, expiry="2026-12-18")
    result = match(db)
    assert result["source_match_method"] == "symbol+direction+entry_date"
    assert result["source_match_confidence"] == .70


def test_etf_directory_matches_tracker_visibility_directory():
    root = Path(__file__).resolve().parents[2]
    assert json.loads((root / "backend/app/data/etf_directory.json").read_text()) == json.loads(
        (root / "frontend/src/data/etfDirectory.json").read_text())


@pytest.mark.parametrize("symbol", ["XLU", "ETHA1", "TQQQ"])
def test_personal_etf_bets_require_explicit_link(db, symbol):
    event = hit(db)
    event.symbol = symbol
    db.flush()
    automatic = resolve_signal_attribution(db, symbol, date(2026, 11, 4), option_type="call")
    assert automatic["source_event_id"] is None
    assert "Personal ETF" in automatic["source_match_notes"]
    explicit = resolve_signal_attribution(db, symbol, date(2026, 11, 4), explicit_event_id=event.id)
    assert explicit["source_event_id"] == event.id


def test_backfill_dry_run_apply_provenance_economics_and_idempotency(db):
    wanted = hit(db)
    row = position(db)
    record_position_event(db, position_id=row.id, event_type="opened", source="fidelity_batch",
        details={"source_asof": "2026-11-04T10:07:10-05:00"})
    db.commit()
    before = (row.contracts, row.fill_price, row.total_cost)
    preview = backfill_signal_links(db, dry_run=True, imported_only=True)
    assert preview["open_positions_linked"] == 1
    assert row.source_event_id is None
    assert db.query(OptionPositionEvent).count() == 1
    applied = backfill_signal_links(db, imported_only=True)
    db.commit()
    assert applied["links"] == preview["links"]
    assert row.source_event_id == wanted.id
    assert row.source_match_notes.startswith("Broker source hash and settlement date.")
    assert (row.contracts, row.fill_price, row.total_cost) == before
    assert db.query(OptionPositionEvent).count() == 2
    assert backfill_signal_links(db, imported_only=True)["open_positions_linked"] == 0
    assert db.query(OptionPositionEvent).count() == 2


def test_stored_capture_bound_and_missing_confidence_are_respected(db):
    hit(db)
    row = position(db)
    record_position_event(db, position_id=row.id, event_type="opened", source="fidelity_batch",
        details={"source_asof": "2026-11-04T09:59:00-05:00"})
    db.commit()
    result = backfill_signal_links(db, imported_only=True)
    db.commit()
    assert result["open_positions_linked"] == 0
    assert result["unlinked_confidence_corrected"] == 1
    assert row.source_event_id is None
    assert row.source_match_confidence == 0
    count = db.query(OptionPositionEvent).count()
    assert backfill_signal_links(db, imported_only=True)["unlinked_confidence_corrected"] == 0
    assert db.query(OptionPositionEvent).count() == count


def test_closed_repair_versions_outcomes_and_preserves_human_corrections(db):
    wanted = hit(db)
    original = position(db)
    closed = ClosedPosition(source_position_id=original.id, symbol=original.symbol,
        trade_date=original.trade_date, expiration=original.expiration, strike=original.strike,
        option_type=original.option_type, contracts=original.contracts,
        fill_price=original.fill_price, total_cost=original.total_cost,
        close_date=date(2026, 11, 4), exit_price=3, total_proceeds=900,
        dollar_pnl=298.5, percent_pnl=49.6259, strategy_type="single_leg",
        source_match_method="fidelity_activity", source_match_notes="Broker provenance",
        source_position_snapshot_json=json.dumps({"source_event_id": None, "contracts": 3}))
    db.add(closed)
    db.flush()
    prior = create_trade_outcome(db, closed, human_overrides={"primary_lesson": "human reviewed"})
    prior_json = prior.attribution_json
    db.commit()
    backfill_signal_links(db, imported_only=True)
    db.commit()
    assert closed.source_event_id == wanted.id
    assert json.loads(closed.source_position_snapshot_json)["source_event_id"] == wanted.id
    assert json.loads(closed.source_position_snapshot_json)["contracts"] == 3
    outcomes = db.query(OptionTradeOutcome).order_by(OptionTradeOutcome.id).all()
    assert len(outcomes) == 2
    assert outcomes[1].supersedes_outcome_id == prior.id
    assert outcomes[1].primary_lesson == "human reviewed"
    assert outcomes[0].attribution_json == prior_json
    assert (closed.total_cost, closed.total_proceeds, closed.dollar_pnl) == (601.5, 900, 298.5)


def test_existing_links_are_not_reassigned(db):
    older = hit(db, when="2026-11-03T15:00:00")
    row = position(db, source_event_id=older.id, source_match_method="manual_event_id")
    hit(db)
    db.commit()
    assert backfill_signal_links(db)["open_positions_checked"] == 0
    assert row.source_event_id == older.id


@pytest.mark.parametrize("job_name", ["refresh_due_option_assessments", "update_option_learning_outcomes"])
def test_scheduled_jobs_repair_imported_links(db, monkeypatch, job_name):
    from contextlib import contextmanager
    from app.services import option_decision_jobs as jobs

    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 4)

    @contextmanager
    def session():
        yield db

    monkeypatch.setattr(jobs, "date", FixedDate)
    monkeypatch.setattr(jobs, "get_db_session", session)
    monkeypatch.setattr(jobs, "_position_is_due", lambda *args: False)
    monkeypatch.setattr(jobs, "get_market_data_provider", lambda: None)
    monkeypatch.setattr(jobs, "ensure_model_registry", lambda db: None)
    monkeypatch.setattr(jobs, "backfill_trade_outcomes", lambda *args, **kwargs: {})
    monkeypatch.setattr(jobs, "mature_decision_outcomes", lambda *args, **kwargs: {})
    monkeypatch.setattr(jobs, "learning_summary", lambda db: {})
    wanted = hit(db)
    row = position(db)
    db.commit()
    result = getattr(jobs, job_name)()
    assert result["attribution"]["open_positions_linked"] == 1
    assert row.source_event_id == wanted.id
