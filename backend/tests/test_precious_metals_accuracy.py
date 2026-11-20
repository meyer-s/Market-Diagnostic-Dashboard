from contextlib import contextmanager
from datetime import datetime
import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.api import precious_metals as pm
from app.core.db import Base
from app.models.precious_metals import MetalPrice, MetalRatio, CBHolding, ETFHolding, SupplyData, DemandData
from app.models.alternative_assets import MacroLiquidityData


@pytest.fixture()
def database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    @contextmanager
    def session():
        yield db
    monkeypatch.setattr(pm, "get_db_session", session)
    yield db
    db.close()
    engine.dispose()


def test_monetary_hedge_m2_component_has_one_half_weight(database):
    database.add(MetalRatio(date=datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0), metal1="AU", metal2="DXY", ratio_value=1, zscore_2y=0))
    database.commit()
    assert pm.calculate_monetary_hedge_strength(database, real_rate_signal=0, m2_growth_signal=1) == pytest.approx(60)


def test_seed_supply_never_produces_observed_production_or_profit_margin(database):
    database.add(SupplyData(metal="AU", period="2025-Q4", aisc_per_oz=1050, production_yoy_pct=-1.5, recycling_pct=30, source="SEED"))
    database.add(MetalPrice(metal="AU", date=datetime(2026, 11, 19), price_usd_per_oz=4000, source="YAHOO"))
    database.commit()
    row = pm.get_supply_data()[0]
    assert row["data_quality"]["status"] == "unavailable"
    assert row["period"] == "2025-Q4"
    assert row["source"] == "SEED"
    assert row["aisc_per_oz"] is row["margin_pct"] is row["production_tonnes_yoy_pct"] is row["recycling_pct_of_supply"] is None
    assert row["current_spot_price"] == 4000
    assert row["price_as_of"] == "2026-11-19T00:00:00"


def test_demand_exposes_old_period_without_pretending_it_is_fresh(database):
    database.add(DemandData(metal="AU", period="2020-Q3", source="WGC archived report", investment_tonnes=3, total_tonnes=10))
    database.commit()
    row = pm.get_demand_data()[0]
    assert row["period"] == "2020-Q3"
    assert row["data_quality"]["as_of"] == "2020-09-30T00:00:00"
    assert row["data_quality"]["status"] == "stale"
    assert row["investment_tonnes"] == 3


def test_history_does_not_backfill_future_central_bank_holdings(database):
    for day in (1, 3):
        database.add(MetalPrice(metal="AU", date=datetime(2020, 1, day), price_usd_per_oz=100, source="YAHOO"))
        database.add(MacroLiquidityData(date=datetime(2020, 1, day), global_m2=50))
    database.add(ETFHolding(ticker="GLD", date=datetime(2020, 1, 2), holdings=10, source="SPDR_OFFICIAL_ARCHIVE"))
    database.add(CBHolding(country="Test", date=datetime(2020, 1, 3), gold_tonnes=1, source="WGC"))
    database.commit()
    result = asyncio.run(pm.get_market_caps_history(years=50))
    assert result["history"][0]["metals_to_m2_pct"] is None
    expected = (10 + pm.TONNES_TO_OZ) * 100 / (50 * 1e12) * 100
    assert result["history"][1]["metals_to_m2_pct"] == pytest.approx(expected)
    assert "gold only" in result["notes"]["numerator_scope"]

def test_a_fresh_gold_silver_ratio_does_not_make_stale_other_ratios_current(database):
    database.add_all([
        MetalRatio(date=datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0), metal1="AU", metal2="AG", ratio_value=80, zscore_2y=1),
        MetalRatio(date=datetime(2020, 1, 1), metal1="PT", metal2="AU", ratio_value=0.5, zscore_2y=-1),
        MetalRatio(date=datetime(2020, 1, 1), metal1="AU", metal2="DXY", ratio_value=20, zscore_2y=-1),
    ])
    database.commit()
    result = pm.get_regime_classification()
    assert result["relative_value"]["au_ag_ratio"] == 80
    assert result["relative_value"]["pt_au_ratio"] is None
    assert result["price_anchors"]["au_dxy_ratio_zscore"] is None
    assert result["regime"]["pgm_bias"] is None


def test_future_observation_is_not_a_fresh_signal():
    from datetime import timedelta
    from types import SimpleNamespace
    tomorrow = datetime.utcnow() + timedelta(days=1)
    assert not pm._is_fresh(tomorrow, 5)
    quality = pm._source_quality(SimpleNamespace(date=tomorrow), cadence="daily", max_age_days=5)
    assert quality["status"] == "unavailable"


def test_legacy_retrieval_clock_ratio_cannot_mask_a_stale_source_session(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        MetalRatio(date=today - timedelta(days=10), metal1="AU", metal2="DXY", ratio_value=20, zscore_2y=-1),
        MetalRatio(date=today + timedelta(hours=1), metal1="AU", metal2="DXY", ratio_value=21, zscore_2y=2),
    ])
    database.commit()
    assert pm.calculate_monetary_hedge_strength(database, real_rate_signal=0, m2_growth_signal=0) == 50
    assert pm.get_regime_classification()["price_anchors"]["au_dxy_ratio_zscore"] is None
