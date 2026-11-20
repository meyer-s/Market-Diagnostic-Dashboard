from __future__ import annotations

from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.services.sector_projection import (
    HORIZONS,
    SECTOR_ETFS,
    build_sector_projection_history,
    compute_sector_projections,
    get_latest_sector_projection_run,
    save_sector_projection_run,
    validate_sector_projection_quality,
)


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _projection_rows(zero_symbols: set[str] | None = None):
    zero_symbols = zero_symbols or set()
    rows = []
    for horizon_index, horizon in enumerate(HORIZONS):
        for rank, etf in enumerate(SECTOR_ETFS, start=1):
            symbol = etf["symbol"]
            zeroed = symbol in zero_symbols
            metrics = {
                "return": 0.0 if zeroed else 0.01 * rank,
                "sma_dist": 0.0 if zeroed else 0.002 * rank,
                "vol": 0.15 + rank / 100,
                "drawdown": -0.03,
                "rel_ret": 0.0 if zeroed else 0.003 * rank,
            }
            rows.append({
                "horizon": horizon,
                "sector_symbol": symbol,
                "sector_name": etf["name"],
                "score_total": 80.0 - rank - horizon_index,
                "score_trend": 70.0 - rank,
                "score_rel": 65.0 - rank,
                "score_risk": 60.0 - rank,
                "score_regime": 50.0,
                "rank": rank,
                "metrics": metrics,
            })
    return rows


def _add_value(db, run_id: int, symbol: str, horizon: str, score_total: float, rank: int = 1):
    db.add(SectorProjectionValue(
        run_id=run_id,
        horizon=horizon,
        sector_symbol=symbol,
        sector_name=symbol,
        score_total=score_total,
        score_trend=score_total,
        score_rel=score_total,
        score_risk=score_total,
        score_regime=50.0,
        metrics_json={"return": 0.01, "sma_dist": 0.02, "vol": 0.1, "drawdown": -0.01, "rel_ret": 0.005},
        rank=rank,
    ))


def test_history_dedupes_same_day_rows_and_sorts_chronologically():
    db = _session()
    db.add_all([
        SectorProjectionRun(
            id=1646,
            as_of_date=date(2026, 6, 15),
            created_at=datetime(2026, 6, 15, 20, 0),
            system_state="YELLOW",
            model_version="test",
            config_json={"data_warnings": [], "quality_status": "valid"},
        ),
        SectorProjectionRun(
            id=1647,
            as_of_date=date(2026, 6, 16),
            created_at=datetime(2026, 6, 16, 10, 0),
            system_state="YELLOW",
            model_version="test",
            config_json={"data_warnings": [], "quality_status": "valid"},
        ),
        SectorProjectionRun(
            id=1648,
            as_of_date=date(2026, 6, 16),
            created_at=datetime(2026, 6, 16, 11, 0),
            system_state="YELLOW",
            model_version="test",
            config_json={
                "data_warnings": [],
                "quality_status": "valid",
                "previous_run_cache": {
                    "run_id": 1647,
                    "as_of_date": "2026-06-16",
                    "created_at": "2026-06-16T10:00:00",
                    "values": [{
                        "horizon": "12m",
                        "sector_symbol": "XLC",
                        "sector_name": "Communication Services",
                        "score_total": 77.95,
                        "rank": 1,
                    }],
                },
            },
        ),
    ])
    _add_value(db, 1646, "XLC", "12m", 30.23)
    _add_value(db, 1647, "XLC", "12m", 77.95)
    _add_value(db, 1648, "XLC", "12m", 78.95)
    db.commit()

    history = build_sector_projection_history(db, date(2026, 6, 1), include_flagged=True)

    entries = history["XLC"]["12m"]
    assert [entry["as_of_date"] for entry in entries] == ["2026-06-15", "2026-06-16"]
    assert [entry["run_id"] for entry in entries] == [1646, 1648]
    assert entries[-1]["score_total"] == 78.95


def test_partial_zero_filled_sector_metrics_are_blocking_warnings():
    zero_symbols = {etf["symbol"] for etf in SECTOR_ETFS[:8]}

    warnings = validate_sector_projection_quality(_projection_rows(zero_symbols))

    assert any(warning["type"] == "partial_sector_metrics" for warning in warnings)


def test_quality_blocked_run_is_not_latest_eligible_run():
    db = _session()
    good_run, _ = save_sector_projection_run(
        db,
        _projection_rows(),
        system_state="YELLOW",
        as_of_date=date(2026, 6, 15),
        created_at=datetime(2026, 6, 15, 20, 0),
    )
    bad_run, warnings = save_sector_projection_run(
        db,
        _projection_rows({etf["symbol"] for etf in SECTOR_ETFS[:8]}),
        system_state="YELLOW",
        as_of_date=date(2026, 6, 16),
        created_at=datetime(2026, 6, 16, 20, 0),
    )
    unflagged_bad_run = SectorProjectionRun(
        as_of_date=date(2026, 6, 17),
        created_at=datetime(2026, 6, 17, 20, 0),
        system_state="YELLOW",
        model_version="test",
        config_json={"data_warnings": [], "quality_status": "valid"},
    )
    db.add(unflagged_bad_run)
    db.flush()
    for row in _projection_rows({etf["symbol"] for etf in SECTOR_ETFS[:8]}):
        db.add(SectorProjectionValue(
            run_id=unflagged_bad_run.id,
            horizon=row["horizon"],
            sector_symbol=row["sector_symbol"],
            sector_name=row["sector_name"],
            score_total=row["score_total"],
            score_trend=row["score_trend"],
            score_rel=row["score_rel"],
            score_risk=row["score_risk"],
            score_regime=row["score_regime"],
            metrics_json=row["metrics"],
            rank=row["rank"],
        ))
    db.commit()

    latest = get_latest_sector_projection_run(db)

    assert latest.id == good_run.id
    assert bad_run.config_json["excluded_from_latest"] is True
    assert any(warning["type"] == "partial_sector_metrics" for warning in warnings)


def _source_price_frames(periods=300):
    sessions = pd.bdate_range("2025-01-02", periods=periods).strftime("%Y-%m-%d")
    return {
        symbol: pd.DataFrame({
            "date": sessions,
            "value": 100 * np.exp(np.arange(periods) * (0.0005 + index * 0.0001)),
        })
        for index, symbol in enumerate([etf["symbol"] for etf in SECTOR_ETFS] + ["SPY"])
    }


@pytest.mark.parametrize("bad_value", [np.nan, np.inf, 0.0, -1.0])
def test_single_invalid_sector_price_blocks_the_peer_run(bad_value):
    frames = _source_price_frames()
    frames["XLE"].loc[frames["XLE"].index[-1], "value"] = bad_value

    rows = compute_sector_projections(frames)
    warnings = validate_sector_projection_quality(rows)

    assert not any(row["sector_symbol"] == "XLE" for row in rows)
    assert any(warning["type"] == "missing_sector_projections" for warning in warnings)
    assert all(np.isfinite(row["score_total"]) for row in rows)


@pytest.mark.parametrize("bad_date", ["not-a-date", "2025-01-02"])
def test_invalid_or_duplicate_session_does_not_enter_peer_scoring(bad_date):
    frames = _source_price_frames()
    frames["XLE"].loc[frames["XLE"].index[-1], "date"] = bad_date

    rows = compute_sector_projections(frames)

    assert not any(row["sector_symbol"] == "XLE" for row in rows)
    assert any(warning["type"] == "missing_sector_projections" for warning in validate_sector_projection_quality(rows))


def test_sector_missing_latest_session_cannot_compete_at_an_older_end_date():
    frames = _source_price_frames()
    frames["XLE"] = frames["XLE"].iloc[:-1].copy()

    rows = compute_sector_projections(frames)

    assert not any(row["sector_symbol"] == "XLE" for row in rows)
    assert any(warning["type"] == "missing_sector_projections" for warning in validate_sector_projection_quality(rows))


def test_missing_interior_benchmark_session_cannot_shorten_one_peer_window():
    frames = _source_price_frames()
    frames["XLE"] = frames["XLE"].drop(index=frames["XLE"].index[-10])

    rows = compute_sector_projections(frames)

    assert not any(row["sector_symbol"] == "XLE" for row in rows)
    assert any(warning["type"] == "missing_sector_projections" for warning in validate_sector_projection_quality(rows))


def test_sector_windows_require_exactly_lookback_plus_one_shared_observations():
    complete = compute_sector_projections(_source_price_frames(periods=253))
    short = compute_sector_projections(_source_price_frames(periods=252))

    assert len(complete) == len(SECTOR_ETFS) * len(HORIZONS)
    assert len({row["source_session_date"] for row in complete}) == 1
    assert len([row for row in short if row["horizon"] == "12m"]) == 0
    assert any(warning["type"] == "missing_sector_projections" for warning in validate_sector_projection_quality(short))


def test_source_session_metadata_is_distinct_from_the_run_day():
    db = _session()
    frames = _source_price_frames()
    rows = compute_sector_projections(frames)
    source_session = frames["SPY"]["date"].iloc[-1]

    run, _ = save_sector_projection_run(db, rows, system_state="YELLOW", as_of_date=date(2026, 11, 19))

    assert run.as_of_date == date(2026, 11, 19)
    assert run.config_json["price_as_of_date"] == source_session
    assert run.config_json["price_observations"] == {etf["symbol"]: source_session for etf in SECTOR_ETFS}


def test_saved_rows_without_source_evidence_do_not_invent_an_observation_date():
    db = _session()

    run, _ = save_sector_projection_run(db, _projection_rows(), system_state="YELLOW", as_of_date=date(2026, 11, 19))

    assert run.config_json["price_as_of_date"] is None
    assert run.config_json["price_observations"] == {}


def test_mixed_source_sessions_do_not_get_one_shared_observation_date():
    db = _session()
    rows = _projection_rows()
    for row in rows:
        row["source_session_date"] = "2026-11-18"
    rows[0]["source_session_date"] = "2026-11-17"

    run, _ = save_sector_projection_run(db, rows, system_state="YELLOW", as_of_date=date(2026, 11, 19))

    assert run.config_json["price_as_of_date"] is None


@pytest.mark.parametrize("metric", ["return", "sma_dist", "rel_ret", "vol", "drawdown"])
def test_one_missing_stored_metric_blocks_the_entire_peer_run(metric):
    db = _session()
    good_run, _ = save_sector_projection_run(db, _projection_rows(), system_state="YELLOW", as_of_date=date(2026, 11, 18))
    rows = _projection_rows()
    rows[0]["metrics"][metric] = None
    bad_run, warnings = save_sector_projection_run(db, rows, system_state="YELLOW", as_of_date=date(2026, 11, 19))
    assert bad_run.config_json["excluded_from_latest"]
    assert any(warning["type"] == "invalid_sector_metrics" for warning in warnings)
    assert get_latest_sector_projection_run(db).id == good_run.id


def test_duplicate_stored_sector_row_cannot_change_the_peer_denominator():
    rows = _projection_rows()
    rows.append(dict(rows[0]))
    assert any(warning["type"] == "missing_sector_projections" for warning in validate_sector_projection_quality(rows))