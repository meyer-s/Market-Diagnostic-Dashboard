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
        database.add(MacroLiquidityData(date=datetime(2020, 1, day), global_m2=50, source=pm.VERIFIED_M2_SOURCE))
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


def test_verified_annual_supply_supersedes_unverified_quarterly_archive(database):
    database.add_all([
        SupplyData(metal="PT", period="2025-Q3", production_tonnes=48.3, source="WPIC Q3 2025"),
        SupplyData(metal="PT", period="2025", production_tonnes=170, source="USGS_MCS_ANNUAL_ESTIMATE|https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-platinum-group.pdf"),
    ])
    database.commit()
    row=pm.get_supply_data()[0]
    assert row["period"] == "2025"
    assert row["production_tonnes"] == 170
    assert row["data_quality"]["estimated"] is True


def test_partial_mhs_remains_visible_without_a_full_gold_bias(database, monkeypatch):
    monkeypatch.setattr(pm, "_compute_real_rate_signal", lambda db: 1.0)
    monkeypatch.setattr(pm, "_compute_m2_growth_signal", lambda db: None)
    result = pm.get_regime_classification()
    assert result["price_anchors"]["monetary_hedge_strength"] == 100
    quality = result["price_anchors"]["monetary_hedge_quality"]
    assert quality["status"] == "partial"
    assert quality["available_components"] == 1
    assert quality["total_components"] == 3
    assert not quality["classification_usable"]
    assert result["regime"]["gold_bias"] is None
    assert result["regime"]["overall_regime"] is None


def test_industrial_catch_all_requires_evidence_not_just_an_ordinary_pci(database, monkeypatch):
    monkeypatch.setattr(pm, "calculate_paper_credibility_index", lambda db: 60)
    assert pm.classify_regime(database)[0] is None


def test_complete_monetary_inputs_preserve_existing_regime_thresholds(database, monkeypatch):
    monkeypatch.setattr(pm, "_monetary_hedge_components", lambda db: {"gold_usd_zscore": 1, "real_rate_signal": 0, "m2_growth_signal": 0})
    monkeypatch.setattr(pm, "calculate_structural_monetary_bid", lambda db: 40)
    result = pm.classify_regime(database)
    assert result[0] == pm.RegimeType.MONETARY_STRESS
    assert result[1] == pm.GoldBiasType.MONETARY_HEDGE


def test_silver_momentum_counts_unique_source_sessions_not_refresh_rows(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    for index in range(61):
        database.add(MetalPrice(metal="AG", date=today-timedelta(days=60-index), price_usd_per_oz=100+index, source="YAHOO"))
    for index in range(80):
        database.add(MetalPrice(metal="AG", date=today+timedelta(hours=1), price_usd_per_oz=1000+index, source="YAHOO"))
    database.commit()
    assert pm._silver_session_momentum(database) == pytest.approx(60)
    database.query(MetalPrice).filter(MetalPrice.date==today-timedelta(days=60)).delete()
    database.commit()
    assert pm._silver_session_momentum(database) is None


def test_cb_yoy_discloses_reporting_sample_sizes(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    prior = today-timedelta(days=365)
    database.add_all([
        CBHolding(country="A", date=today, gold_tonnes=100, pct_of_reserves=10, source="WGC"),
        CBHolding(country="B", date=today, gold_tonnes=100, pct_of_reserves=10, source="WGC"),
        CBHolding(country="A", date=prior, gold_tonnes=90, pct_of_reserves=10, source="WGC"),
        CBHolding(country="C", date=prior, gold_tonnes=90, pct_of_reserves=10, source="WGC"),
        CBHolding(country="D", date=prior, gold_tonnes=90, pct_of_reserves=10, source="WGC"),
    ])
    database.commit()
    result = pm.get_regime_classification()
    coverage = result["cb_context"]["coverage"]
    assert coverage["latest_reporting_countries"] == 2
    assert coverage["prior_year_reporting_countries"] == 3
    assert coverage["matched_yoy_countries"] == 1
    assert result["cb_context"]["net_purchases_yoy"] == pytest.approx((100/90-1)*100)


def test_official_gold_report_retains_human_source_and_category_scope(database):
    url = "https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q3-2026"
    source = "WGC_METALS_FOCUS_GDT|"+url
    database.add(SupplyData(metal="AU", period="2026-Q3", source=source, production_tonnes=900, recycling_tonnes=300, aisc_per_oz=None))
    database.add(DemandData(metal="AU", period="2026-Q3", source=source, total_tonnes=1200))
    database.commit()
    supply = pm.get_supply_data()[0]
    assert supply["production_tonnes"] == 900
    assert supply["recycling_tonnes"] == 300
    assert supply["aisc_per_oz"] is supply["margin_pct"] is None
    assert supply["source_url"] == url
    assert supply["data_quality"]["source_url"] == url
    demand = pm.get_demand_data()[0]
    assert "World Gold Council" in demand["source"]
    assert demand["category_scope"]["jewelry_tonnes"] == "Jewellery fabrication"

def test_unverified_or_old_m2_cannot_be_current_denominator(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        MacroLiquidityData(date=today, global_m2=60, source="FRED"),
        MacroLiquidityData(date=today-timedelta(days=800), global_m2=50, source=pm.VERIFIED_M2_SOURCE),
        MetalPrice(metal="AU", date=today, price_usd_per_oz=4000, source="YAHOO"),
        ETFHolding(ticker="GLD", date=today, holdings=10, source="SPDR_OFFICIAL_ARCHIVE"),
    ])
    database.commit()
    assert pm._compute_m2_growth_signal(database) is None
    result = pm.get_market_caps()
    assert result["global_m2_usd"] is None
    assert result["metals_to_m2_pct"] is None
    assert result["m2_quality"]["status"] == "stale"


def test_m2_yoy_requires_same_verified_panel_and_a_real_year_comparison(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        MacroLiquidityData(date=today, global_m2=55, source=pm.VERIFIED_M2_SOURCE),
        MacroLiquidityData(date=today-timedelta(days=800), global_m2=50, source=pm.VERIFIED_M2_SOURCE),
        MacroLiquidityData(date=today-timedelta(days=365), global_m2=30, source="FRED"),
    ])
    database.commit()
    assert pm._compute_m2_growth_signal(database) is None
    database.add(MacroLiquidityData(date=today-timedelta(days=365), global_m2=50, source=pm.VERIFIED_M2_SOURCE))
    database.commit()
    assert pm._compute_m2_growth_signal(database) == pytest.approx(1)


def test_annual_usgs_and_quarterly_gold_reports_coexist_without_seed_override(database):
    database.add_all([
        SupplyData(metal="AU", period="2026-Q3", source="WGC_METALS_FOCUS_GDT|https://www.gold.org/report", production_tonnes=900),
        SupplyData(metal="PT", period="2025", source="USGS_MCS_ANNUAL_ESTIMATE|https://pubs.usgs.gov/report", production_tonnes=170),
        SupplyData(metal="PT", period="2025-Q4", source="SEED", production_tonnes=190, aisc_per_oz=950),
    ])
    database.commit()
    rows = {row["metal"]: row for row in pm.get_supply_data()}
    assert rows["AU"]["period"] == "2026-Q3"
    assert rows["PT"]["period"] == "2025"
    assert rows["PT"]["production_tonnes"] == 170
    assert rows["PT"]["aisc_per_oz"] is None
    assert rows["PT"]["data_quality"]["cadence"] == "annual"
    assert rows["PT"]["data_quality"]["max_age_days"] == 450
    assert rows["PT"]["data_quality"]["estimated"]
    assert rows["PT"]["source_url"] == "https://pubs.usgs.gov/report"

def test_etf_year_over_year_uses_a_year_not_330_days(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        ETFHolding(ticker="GLD", date=today, holdings=110),
        ETFHolding(ticker="GLD", date=today-timedelta(days=330), holdings=50),
        ETFHolding(ticker="GLD", date=today-timedelta(days=365), holdings=100),
    ])
    database.commit()
    assert pm._calc_etf_holdings_yoy(database) == pytest.approx(10)


def test_central_bank_yoy_does_not_compare_a_multi_year_gap(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        CBHolding(country="A", date=today, gold_tonnes=100, pct_of_reserves=10),
        CBHolding(country="A", date=today-timedelta(days=800), gold_tonnes=50, pct_of_reserves=10),
    ])
    database.commit()
    assert pm._get_latest_cb_dates(database) == (today, None)
    assert pm.get_cb_holdings()[0]["net_purchase_yoy_pct"] is None

def test_reserve_share_comparison_uses_the_same_known_percentage_cohort(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    prior = today-timedelta(days=365)
    database.add_all([
        CBHolding(country="A", date=today, gold_tonnes=100, pct_of_reserves=10),
        CBHolding(country="A", date=prior, gold_tonnes=100, pct_of_reserves=10),
        CBHolding(country="B", date=today, gold_tonnes=100, pct_of_reserves=None),
        CBHolding(country="B", date=prior, gold_tonnes=100, pct_of_reserves=50),
    ])
    database.commit()
    # Neither matched holdings nor matched reserve percentages changed. Country
    # B's missing percentage must not become an apparent structural flow signal.
    assert pm.calculate_structural_monetary_bid(database) == 0
    coverage = pm.get_regime_classification()["cb_context"]["coverage"]
    assert coverage["latest_reporting_countries"] == 2
    assert coverage["matched_yoy_countries"] == 2
    assert coverage["latest_reserve_share_countries"] == 1
    assert coverage["matched_reserve_share_countries"] == 1
    assert pm._calc_global_cb_gold_pct_reserves(database, today, []) is None

def test_market_values_and_supply_use_latest_canonical_price_not_legacy_clock(database):
    from datetime import timedelta
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    database.add_all([
        MetalPrice(metal="AU", date=today, price_usd_per_oz=3573, source="YAHOO"),
        MetalPrice(metal="AU", date=today+timedelta(hours=1), price_usd_per_oz=3586, source="YAHOO"),
        ETFHolding(ticker="GLD", date=today, holdings=10, source="SPDR_OFFICIAL_ARCHIVE"),
        SupplyData(metal="AU", period="2026-Q3", source="WGC", production_tonnes=900),
    ])
    database.commit()
    assert pm.get_market_caps()["metals"]["AU"]["price_usd_per_oz"] == 3573
    assert pm.get_supply_data()[0]["current_spot_price"] == 3573
    assert pm.get_metal_price_history("AU", days=10) == [{"date": today.isoformat(), "price": 3573}]
