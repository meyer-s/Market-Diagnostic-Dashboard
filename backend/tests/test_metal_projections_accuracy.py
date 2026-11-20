from contextlib import contextmanager
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.precious_metals import MetalPrice
from app.services import metal_projections as service


def test_wilder_rsi_matches_reference_seed_and_flat_limit():
    values = pd.Series([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28])
    assert service._wilder_rsi(values).iloc[-1] == pytest.approx(70.464135, abs=1e-6)
    assert service._wilder_rsi(pd.Series([100.0] * 30)).iloc[-1] == 50
    assert service._wilder_rsi(pd.Series(range(30), dtype=float)).iloc[-1] == 100
    assert service._wilder_rsi(pd.Series(range(30, 0, -1), dtype=float)).iloc[-1] == 0


def test_projection_reader_uses_provider_sessions_not_legacy_clock_rows(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(220):
        db.add(MetalPrice(metal="AU", date=today - timedelta(days=219-i), price_usd_per_oz=100+i, source="YAHOO"))
    db.add(MetalPrice(metal="AU", date=today + timedelta(hours=1), price_usd_per_oz=9999, source="YAHOO"))
    db.add(MetalPrice(metal="AU", date=today, price_usd_per_oz=999, source="SEED"))
    db.commit()
    @contextmanager
    def session():
        yield db
    monkeypatch.setattr(service, "get_db_session", session)
    frame = service.fetch_metal_price_history("AU")
    assert len(frame) == 220
    assert frame.index.is_unique
    assert frame.price.iloc[-1] == 319
    db.close()


def test_short_history_does_not_receive_a_full_technical_score(monkeypatch):
    frame = pd.DataFrame({"price": np.arange(50)+100.0}, index=pd.date_range("2026-01-01", periods=50))
    monkeypatch.setattr(service, "fetch_metal_price_history", lambda *args, **kwargs: frame)
    assert "error" in service.compute_metal_projection("AU", "Gold", "GLD")


def test_equal_scores_have_equal_ranks_and_no_arbitrary_loser(monkeypatch):
    frame = pd.DataFrame({"price": [100.0]*220}, index=pd.date_range("2026-01-01", periods=220))
    monkeypatch.setattr(service, "fetch_metal_price_history", lambda *args, **kwargs: frame)
    result = service.compute_all_metal_projections()
    assert {row["rank"] for row in result["projections"]} == {1}
    assert {row["relative_classification"] for row in result["projections"]} == {"Neutral"}
    assert all(row["rsi_method"] == "wilder_14" for row in result["projections"])


def test_futures_page_checks_share_provider_snapshot(monkeypatch):
    from app.services import metal_futures_curve as curves
    calls = []
    class Ticker:
        def __init__(self, symbol):
            self.symbol = symbol
        def history(self, **kwargs):
            calls.append(self.symbol)
            return pd.DataFrame({"Close": [10.0, 11.0]}, index=pd.date_range("2026-11-18", periods=2))
    monkeypatch.setattr(curves.yf, "Ticker", Ticker)
    curves._cached_contract_snapshot.cache_clear()
    first = curves.fetch_futures_contract_snapshot("TEST")
    first["price"] = 99
    second = curves.fetch_futures_contract_snapshot("TEST")
    assert second["price"] == 11
    assert calls == ["TEST"]
    assert second["observation_kind"] == "source_session_label"