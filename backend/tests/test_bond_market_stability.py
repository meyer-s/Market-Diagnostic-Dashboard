from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.models.indicator import Indicator
from app.services.bond_market_stability import build_bond_market_stability_history
from app.services.ingestion import etl_runner


def _series(values: list[float]) -> list[dict]:
    start = datetime(2026, 1, 1)
    return [
        {"date": (start + timedelta(days=index)).date().isoformat(), "value": value}
        for index, value in enumerate(values)
    ]


class _FakeFredClient:
    def __init__(self) -> None:
        self.payload = {
            "BAMLH0A0HYM2": _series([3.0 + index * 0.02 for index in range(40)]),
            "BAMLC0A0CM": _series([1.0 + index * 0.01 for index in range(40)]),
            "DGS10": _series([4.0 + index * 0.01 for index in range(40)]),
            "DGS2": _series([3.0 + index * 0.008 for index in range(40)]),
            "DGS3MO": _series([2.5 + index * 0.005 for index in range(40)]),
            "DGS30": _series([4.5 + index * 0.012 for index in range(40)]),
            "DGS5": _series([3.5 + index * 0.009 for index in range(40)]),
        }

    async def fetch_series(self, series_id: str, start_date: str | None = None) -> list[dict]:
        return self.payload[series_id]


def test_bond_service_builds_composite_history() -> None:
    history = asyncio.run(
        build_bond_market_stability_history(
            start_date="2026-01-01",
            fred_client=_FakeFredClient(),
        )
    )

    assert len(history) == 40
    assert "credit_spread_stress" in history[-1]
    assert history[-1]["composite"]["stability_score"] == 100.0 - history[-1]["composite"]["stress_score"]


def test_bond_etl_uses_canonical_service(monkeypatch) -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(etl_runner, "SessionLocal", testing_session_local)

    db = testing_session_local()
    db.add(
        Indicator(
            code="BOND_MARKET_STABILITY",
            name="Bond Market Stability Composite",
            source="DERIVED",
            source_symbol="BOND_COMPOSITE",
            category="bonds",
            direction=1,
            lookback_days_for_z=252,
            threshold_green_max=40,
            threshold_yellow_max=70,
            weight=2.0,
        )
    )
    db.commit()
    db.close()

    expected_history = asyncio.run(build_bond_market_stability_history(start_date="2026-01-01", fred_client=_FakeFredClient()))
    runner = etl_runner.ETLRunner()
    runner.fred = _FakeFredClient()

    result = asyncio.run(runner.ingest_indicator("BOND_MARKET_STABILITY"))

    assert result["score"] == expected_history[-1]["composite"]["stability_score"]
