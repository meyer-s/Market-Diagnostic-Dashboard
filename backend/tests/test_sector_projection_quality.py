from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.services.sector_projection import (
    HORIZONS,
    SECTOR_ETFS,
    build_sector_projection_history,
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
