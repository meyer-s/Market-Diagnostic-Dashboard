from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.services.sector_projection import (
    SECTOR_ETFS,
    _continuous_peer_score,
    _score_sector_metrics_frame,
    build_sector_projection_history,
)


def _metrics_frame() -> pd.DataFrame:
    rows = {}
    for index, etf in enumerate(SECTOR_ETFS):
        rows[etf["symbol"]] = {
            "sector_name": etf["name"],
            "return": 0.01 + 0.012 * index,
            "sma_dist": -0.02 + 0.006 * index,
            "vol": 0.12 + 0.018 * index,
            "drawdown": -0.02 - 0.008 * index,
            "rel_ret": -0.04 + 0.009 * index,
        }
    return pd.DataFrame.from_dict(rows, orient="index")


def test_peer_score_moves_when_top_magnitude_changes_without_rank_change():
    base = pd.Series([0.01, 0.02, 0.03, 0.04, 0.05], index=list("ABCDE"))
    stronger = base.copy()
    stronger.loc["E"] = 0.12

    base_score = _continuous_peer_score(base)
    stronger_score = _continuous_peer_score(stronger)

    assert base.rank().loc["E"] == stronger.rank().loc["E"] == 5
    assert stronger_score.loc["E"] > base_score.loc["E"]


def test_continuous_scoring_preserves_risk_direction_without_endpoint_pinning():
    risk = pd.Series([0.10, 0.14, 0.18, 0.22, 0.30], index=list("ABCDE"))

    stability = _continuous_peer_score(risk, invert=True)

    assert stability.loc["A"] > stability.loc["E"]
    assert 0.0 < stability.min() < stability.max() < 100.0


def test_sector_metric_scores_remain_bounded_and_ranked():
    scored = _score_sector_metrics_frame(_metrics_frame(), "YELLOW")

    for column in ("score_trend", "score_rel", "score_risk", "score_regime", "score_total"):
        assert scored[column].between(0.0, 100.0).all()
    assert sorted(scored["rank"].tolist()) == list(range(1, len(SECTOR_ETFS) + 1))


def test_history_rescores_complete_legacy_peer_sets_from_saved_metrics():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    run = SectorProjectionRun(
        as_of_date=date(2026, 7, 16),
        created_at=datetime(2026, 7, 16, 20, 0),
        system_state="YELLOW",
        model_version="option_b_v1",
        config_json={"data_warnings": [], "quality_status": "valid"},
    )
    db.add(run)
    db.flush()

    frame = _metrics_frame()
    for rank, etf in enumerate(SECTOR_ETFS, start=1):
        metrics = frame.loc[etf["symbol"]]
        db.add(SectorProjectionValue(
            run_id=run.id,
            horizon="3m",
            sector_symbol=etf["symbol"],
            sector_name=etf["name"],
            score_total=77.5,
            score_trend=100.0,
            score_rel=100.0,
            score_risk=0.0,
            score_regime=50.0,
            metrics_json={
                "return": float(metrics["return"]),
                "sma_dist": float(metrics["sma_dist"]),
                "vol": float(metrics["vol"]),
                "drawdown": float(metrics["drawdown"]),
                "rel_ret": float(metrics["rel_ret"]),
            },
            rank=rank,
        ))
    db.commit()

    history = build_sector_projection_history(db, date(2026, 7, 1), include_flagged=True)
    rescored = [history[etf["symbol"]]["3m"][0]["score_total"] for etf in SECTOR_ETFS]
    expected = _score_sector_metrics_frame(frame, "YELLOW")

    assert len({round(value, 4) for value in rescored}) > 1
    assert any(abs(value - 77.5) > 0.01 for value in rescored)
    for etf in SECTOR_ETFS:
        actual = history[etf["symbol"]]["3m"][0]
        assert actual["score_total"] == pytest.approx(expected.loc[etf["symbol"], "score_total"])
        assert actual["rank"] == expected.loc[etf["symbol"], "rank"]
