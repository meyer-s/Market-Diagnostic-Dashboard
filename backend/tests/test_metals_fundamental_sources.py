from contextlib import contextmanager
from datetime import datetime, date, timedelta
from types import SimpleNamespace
import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.db import Base
from app.models.precious_metals import SupplyData, DemandData
from app.models.alternative_assets import MacroLiquidityData
from app.services.ingestion import precious_metals_ingester as module
from app.services.ingestion.precious_metals_ingester import PreciousMetalsIngester
from app.services.ingestion.aas_data_ingestion import MacroDataIngestion, M2_PANEL_SOURCE


def wgc_table():
    return pd.DataFrame([
        ['', "Q3'25", "Q3'26"], ['Mine Production',900,1000], ['Recycled Gold',100,100], ['Total Supply',1100,1200],
        ['Jewellery Fabrication',350,400], ['Technology',100,100], ['Investment',300,300],
        ['Central Bank and Other Institutions',150,200], ['OTC and other',200,200], ['Total Demand',1100,1200],
    ]).to_html(header=False,index=False)


@pytest.fixture
def db(monkeypatch):
    engine=create_engine('sqlite:///:memory:');Base.metadata.create_all(engine);session=sessionmaker(bind=engine)()
    @contextmanager
    def get_session():yield session
    monkeypatch.setattr(module,'get_db_session',get_session)
    yield session
    session.close()


def test_wgc_parser_requires_reconciled_categories_and_year_prior():
    values=PreciousMetalsIngester._parse_wgc_supply_demand(wgc_table(),'https://www.gold.org/report')
    assert values['period']=='2026-Q3' and values['prior_period']=='2025-Q3'
    assert values['latest']['total demand']==1200


@pytest.mark.parametrize('replace', [('Total Demand','Missing Total'),('1200','1500'),('Q3\'25','Q4\'25')])
def test_wgc_schema_or_arithmetic_drift_is_rejected(replace):
    with pytest.raises(ValueError):
        PreciousMetalsIngester._parse_wgc_supply_demand(wgc_table().replace(*replace),'https://www.gold.org/report')


def test_wgc_ingest_is_idempotent_and_keeps_unknown_cost_and_geography_empty(db,monkeypatch):
    ingester=PreciousMetalsIngester()
    index='<a href="/goldhub/research/gold-demand-trends/gold-demand-trends-q3-2026">Latest</a>'
    monkeypatch.setattr(ingester.session,'get',lambda url,**kwargs:SimpleNamespace(text=index if url.endswith('/gold-demand-trends') else wgc_table(),raise_for_status=lambda:None))
    assert ingester._ingest_wgc_supply_demand()==3
    assert ingester._ingest_wgc_supply_demand()==3
    assert db.query(SupplyData).count()==2 and db.query(DemandData).count()==1
    supply=db.query(SupplyData).filter_by(period='2026-Q3').one()
    assert supply.production_yoy_pct==pytest.approx((1000/900-1)*100)
    assert supply.aisc_per_oz is None and supply.recycling_pct==pytest.approx(100/1200*100)
    demand=db.query(DemandData).one()
    assert demand.jewelry_asia_tonnes is None
    assert demand.jewelry_tonnes+demand.industrial_tonnes+demand.investment_tonnes+demand.other_tonnes==demand.total_tonnes
    assert demand.source.endswith('gold-demand-trends-q3-2026')


def panel(day):
    return {'us_m2':{day:20000},'eurozone_m2':{day:10e12},'japan_m2':{day:1400e12},'uk_m2':{day:1e12}}


def test_money_proxy_requires_same_fixed_panel_and_actual_prior_dates():
    day=date(2026,10,1)
    values=MacroDataIngestion._m2_panel_snapshot(panel(day),day+timedelta(days=10))
    assert values['value']==pytest.approx(42.27) and values['date']==day
    incomplete=panel(day);del incomplete['uk_m2']
    assert MacroDataIngestion._m2_panel_snapshot(incomplete,day) is None


@pytest.mark.parametrize('bad', [None,-1,np.nan,np.inf])
def test_bad_money_component_does_not_become_zero_or_partial_aggregate(bad):
    day=date(2026,10,1);p=panel(day);p['us_m2'][day]=bad
    assert MacroDataIngestion._m2_panel_snapshot(p,day) is None


def test_stale_or_future_foreign_money_observations_are_not_current():
    day=date(2026,10,1)
    assert MacroDataIngestion._m2_panel_snapshot(panel(day),day+timedelta(days=63)) is None
    future=panel(day+timedelta(days=1))
    assert MacroDataIngestion._m2_panel_snapshot(future,day) is None
    mixed=panel(day)
    for name in ['eurozone_m2','japan_m2','uk_m2']:mixed[name]={date(2023,11,1):next(iter(mixed[name].values()))}
    assert MacroDataIngestion._m2_panel_snapshot(mixed,day) is None


def test_verified_money_snapshot_preserves_reference_date_and_marker(db):
    ingest=MacroDataIngestion(db,'test')
    snap=MacroDataIngestion._m2_panel_snapshot(panel(date(2025,10,1)),date(2025,10,7))
    ingest._store_m2_panel_snapshot(snap);db.commit();ingest._store_m2_panel_snapshot(snap);db.commit()
    row=db.query(MacroLiquidityData).one()
    assert row.date==datetime(2025,10,1) and row.source==M2_PANEL_SOURCE
    assert row.global_m2==pytest.approx(42.27)

def test_current_macro_rejects_discontinued_foreign_sources_without_losing_rates(db,monkeypatch):
    ingest=MacroDataIngestion(db,'test')
    monkeypatch.setattr(ingest,'_fetch_fred_series',lambda series,**kwargs:{'WALCL':7000000,'DFF':4,'DGS10':4.5,'CPIAUCSL':2.5}[series])
    monkeypatch.setattr(ingest,'_fetch_fred_series_historical',lambda *args:{})
    current=ingest.fetch_current_macro_data()
    assert current.global_m2 is None
    assert current.fed_rate==4 and current.real_rate_10y==2
    assert current.source=='FRED'


def test_current_macro_stores_verified_money_at_its_own_reference_date(db,monkeypatch):
    ingest=MacroDataIngestion(db,'test');day=datetime.utcnow().date()-timedelta(days=7)
    from app.services.ingestion.aas_data_ingestion import M2_PANEL_SERIES
    reverse={code:name for name,code in M2_PANEL_SERIES.items()}
    monkeypatch.setattr(ingest,'_fetch_fred_series',lambda series,**kwargs:{'WALCL':7000000,'DFF':4,'DGS10':4.5,'CPIAUCSL':2.5}[series])
    monkeypatch.setattr(ingest,'_fetch_fred_series_historical',lambda series,*args:panel(day)[reverse[series]])
    current=ingest.fetch_current_macro_data()
    assert current.global_m2 is None and current.real_rate_10y==2
    money=db.query(MacroLiquidityData).filter_by(source=M2_PANEL_SOURCE).one()
    assert money.date.date()==day and money.global_m2==pytest.approx(42.27)


def test_usgs_ingestion_survives_independent_gold_report_failure(db,monkeypatch):
    from app.services.ingestion import metals_report_sources
    ingester=PreciousMetalsIngester()
    def failed():raise ValueError('Gold report unavailable')
    monkeypatch.setattr(ingester,'_ingest_wgc_supply_demand',failed)
    monkeypatch.setattr(metals_report_sources,'fetch_usgs_mine_supply',lambda session:{'supply':[{'metal':'PT','period':'2025','production_tonnes':170,'production_yoy_pct':-5,'source':'USGS_MCS_ANNUAL_ESTIMATE|https://pubs.usgs.gov/test.pdf'}],'errors':[]})
    assert ingester._ingest_supply_data()==1
    row=db.query(SupplyData).filter_by(metal='PT').one()
    assert row.period=='2025' and row.aisc_per_oz is None


def test_gold_report_cannot_import_a_different_quarter_as_observed():
    with pytest.raises(ValueError):
        PreciousMetalsIngester._parse_wgc_supply_demand(wgc_table().replace("Q3'26","Q4'26"),'https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q3-2026')


def test_historical_backfill_does_not_change_the_country_panel_when_one_source_is_missing(db,monkeypatch):
    from app.services.ingestion.aas_data_ingestion import M2_PANEL_SERIES
    ingest=MacroDataIngestion(db,'test');day=datetime.utcnow().date()-timedelta(days=365)
    reverse={code:name for name,code in M2_PANEL_SERIES.items()}
    monkeypatch.setattr(ingest,'_fetch_fred_series_historical',lambda series,*args:{} if reverse[series]=='uk_m2' else panel(day)[reverse[series]])
    assert ingest.seed_estimated_global_m2(days=730)==0
    assert db.query(MacroLiquidityData).count()==0