from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
import asyncio
import math
import statistics

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.precious_metals import MetalPrice, MetalRatio, MetalCorrelation, MetalVolatility
from app.services.ingestion import precious_metals_ingester as module
from app.services.ingestion.precious_metals_ingester import PreciousMetalsIngester
from app.services import scheduler as jobs


@pytest.fixture
def db(monkeypatch):
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    @contextmanager
    def get_session():
        yield session
    monkeypatch.setattr(module, 'get_db_session', get_session)
    yield session
    session.close()


def test_repeated_daily_refresh_updates_same_source_session_without_minting_today(db, monkeypatch):
    monkeypatch.setattr(module, 'METAL_SYMBOLS', {'AU': {'yahoo': 'GC=F'}})
    db.add(MetalPrice(metal='AU', date=datetime(2026, 11, 19, 6), price_usd_per_oz=100, source='YAHOO'))
    db.commit()
    data = pd.DataFrame({'Close':[200.0], 'Volume':[12]}, index=pd.DatetimeIndex(['2026-11-19'], tz='America/New_York'))
    monkeypatch.setattr(module.yf, 'Ticker', lambda _: SimpleNamespace(history=lambda **kwargs: data))
    ingester = PreciousMetalsIngester()
    assert ingester._ingest_spot_prices() == 1
    data.iloc[0, 0] = 210
    assert ingester._ingest_spot_prices() == 1
    rows = db.query(MetalPrice).all()
    assert len(rows) == 1
    assert rows[0].date == datetime(2026, 11, 19)
    assert rows[0].price_usd_per_oz == 210
    assert rows[0].volume == 12


@pytest.mark.parametrize('price', [np.nan, np.inf, 0, -1])
def test_invalid_provider_close_is_not_persisted(db, monkeypatch, price):
    monkeypatch.setattr(module, 'METAL_SYMBOLS', {'AU': {'yahoo': 'GC=F'}})
    data = pd.DataFrame({'Close':[price]}, index=pd.DatetimeIndex(['2026-11-19']))
    monkeypatch.setattr(module.yf, 'Ticker', lambda _: SimpleNamespace(history=lambda **kwargs: data))
    assert PreciousMetalsIngester()._ingest_spot_prices() == 0
    assert db.query(MetalPrice).count() == 0


def test_backfill_repairs_existing_session_value_instead_of_skipping(db, monkeypatch):
    monkeypatch.setattr(module, 'METAL_SYMBOLS', {'AU': {'yahoo': 'GC=F'}})
    db.add(MetalPrice(metal='AU', date=datetime(2026, 11, 19, 6), price_usd_per_oz=100, source='YAHOO'))
    db.commit()
    data = pd.DataFrame({'Close':[230.0]}, index=pd.DatetimeIndex(['2026-11-19']))
    monkeypatch.setattr(module.yf, 'Ticker', lambda _: SimpleNamespace(history=lambda **kwargs: data))
    assert PreciousMetalsIngester().backfill_historical_prices(days=400) == 1
    assert db.query(MetalPrice).count() == 1
    assert db.query(MetalPrice).first().date == datetime(2026, 11, 19)
    assert db.query(MetalPrice).first().price_usd_per_oz == 230


def test_ratio_refresh_deduplicates_days_and_does_not_weight_repeated_runs(db, monkeypatch):
    day = datetime(2026, 11, 19)
    db.add_all([MetalPrice(metal='AU', date=day, price_usd_per_oz=4, source='YAHOO'), MetalPrice(metal='AG', date=day, price_usd_per_oz=1, source='YAHOO')])
    for offset, value in [(3, 1.0), (2, 2.0), (1, 3.0)]:
        db.add_all([MetalPrice(metal='AU',date=day-timedelta(days=offset),price_usd_per_oz=value,source='YAHOO'),MetalPrice(metal='AG',date=day-timedelta(days=offset),price_usd_per_oz=1,source='YAHOO')])
        for _ in range(20 if value == 1 else 1):
            db.add(MetalRatio(date=day-timedelta(days=offset),metal1='AU',metal2='AG',ratio_value=value))
    db.commit()
    ingester = PreciousMetalsIngester()
    monkeypatch.setattr(ingester, '_fetch_fred_series_historical', lambda *args: {})
    ingester._compute_ratios(); ingester._compute_ratios()
    current = db.query(MetalRatio).filter(MetalRatio.date == day).all()
    assert len(current) == 1
    assert current[0].ratio_value == 4
    assert current[0].zscore_2y == 2.0


def test_dollar_ratio_uses_shared_observation_day(db, monkeypatch):
    db.add_all([MetalPrice(metal='AU',date=datetime(2026,11,18),price_usd_per_oz=200,source='YAHOO'), MetalPrice(metal='AU',date=datetime(2026,11,19),price_usd_per_oz=210,source='YAHOO')]);db.commit()
    ingester=PreciousMetalsIngester()
    monkeypatch.setattr(ingester,'_fetch_fred_series_historical',lambda *args:{datetime(2026,11,18).date():100})
    monkeypatch.setattr(ingester,'_backfill_dxy_ratios',lambda *args,**kwargs:None)
    ingester._compute_ratios()
    row=db.query(MetalRatio).filter_by(metal1='AU',metal2='DXY').one()
    assert row.date == datetime(2026,11,18)
    assert row.ratio_value == 2


def _daily_rows(db, count):
    days=pd.bdate_range(end='2026-11-19',periods=count)
    au=100*np.exp(np.cumsum(.001+.006*np.sin(np.arange(count))))
    ag=30*np.exp(np.cumsum(.002+.004*np.cos(np.arange(count))))
    for metal,values in [('AU',au),('AG',ag)]:
        for day,value in zip(days,values):
            db.add(MetalPrice(metal=metal,date=day.to_pydatetime(),price_usd_per_oz=float(value),source='YAHOO'))
    db.commit()
    return au,ag


def test_correlation_uses_exact_return_windows_and_upserts_daily_record(db):
    au,ag=_daily_rows(db,90)
    ingester=PreciousMetalsIngester()
    ingester._compute_correlations();ingester._compute_correlations()
    row=db.query(MetalCorrelation).one()
    expected=float(np.corrcoef(np.diff(au)/au[:-1],np.diff(ag)/ag[:-1])[0,1])
    last60=float(np.corrcoef((np.diff(au)/au[:-1])[-60:],(np.diff(ag)/ag[:-1])[-60:])[0,1])
    assert row.date == datetime(2026,11,19)
    assert row.au_ag_60d == pytest.approx(last60)
    assert abs(row.au_ag_60d-expected) > .00001


def test_short_correlation_history_cannot_claim_sixty_returns(db):
    _daily_rows(db,40)
    assert PreciousMetalsIngester()._compute_correlations() == 1
    row=db.query(MetalCorrelation).one()
    assert row.au_ag_30d is not None
    assert row.au_ag_60d is None


def test_volatility_uses_thirty_actual_returns_not_thirty_calendar_days(db):
    au,_=_daily_rows(db,90)
    ingester=PreciousMetalsIngester()
    ingester._compute_volatility();ingester._compute_volatility()
    row=db.query(MetalVolatility).filter_by(metal='AU').one()
    assert row.volatility_30d == pytest.approx(statistics.stdev((np.diff(au)/au[:-1])[-30:])*math.sqrt(252))
    assert row.volatility_252d is None


def test_fast_market_refresh_does_not_call_archives(monkeypatch):
    ingester=PreciousMetalsIngester();calls=[]
    for name in ['_ingest_spot_prices','_compute_ratios','_compute_correlations','_compute_volatility']:
        monkeypatch.setattr(ingester,name,lambda name=name:calls.append(name) or 1)
    monkeypatch.setattr(ingester,'_ingest_etf_data',lambda:pytest.fail('Archive must not run every15minutes'))
    result=ingester.ingest_market_data()
    assert len(calls)==4 and result['prices_ingested']==1


def test_metals_job_is_bounded_and_coalesced(monkeypatch):
    class FakeScheduler:
        running=True
        jobs={}
        def get_job(self,key):return self.jobs.get(key)
        def add_job(self,func,trigger,**kwargs):self.jobs[kwargs['id']]={'func':func,'trigger':trigger,**kwargs}
    fake=FakeScheduler();monkeypatch.setattr(jobs,'scheduler',fake)
    jobs.start_scheduler()
    job=fake.jobs['metals_market_refresh']
    assert job['max_instances']==1 and job['coalesce'] is True
    assert str(job['trigger'].timezone)=='America/New_York'
    assert str(job['trigger'])=="cron[minute='*/15']"


def test_shared_advisory_lock_prevents_concurrent_market_writer(monkeypatch):
    @contextmanager
    def locked(_):yield False
    monkeypatch.setattr(jobs,'scheduler_job_lock',locked)
    monkeypatch.setattr(PreciousMetalsIngester,'ingest_market_data',lambda _:pytest.fail('Concurrent ingest forbidden'))
    assert jobs._refresh_metals_market_data() is None

def test_pearson_covariance_uses_matching_sample_denominator():
    assert PreciousMetalsIngester._pearson_correlation([1,2,3,4],[2,4,6,8]) == pytest.approx(1.0)
    assert PreciousMetalsIngester._pearson_correlation([1,2,3,4],[8,6,4,2]) == pytest.approx(-1.0)


def test_legacy_clock_dates_do_not_become_independent_price_observations(db):
    db.add_all([MetalPrice(metal='AU',date=datetime(2026,11,19),price_usd_per_oz=200,source='YAHOO'), MetalPrice(metal='AU',date=datetime(2026,11,20,8),price_usd_per_oz=210,source='YAHOO')]);db.commit()
    values=PreciousMetalsIngester._daily_price_map(db,'AU',datetime(2026,1,1))
    assert list(values)==[datetime(2026,11,19).date()]


def test_undefined_correlation_is_unavailable_not_a_zero_signal():
    assert PreciousMetalsIngester._pearson_correlation([1,1,1],[2,3,4]) is None
    assert PreciousMetalsIngester._pearson_correlation([1,float('nan'),2],[2,3,4]) is None


def test_closed_weekend_does_not_query_market_sources(monkeypatch):
    class Saturday(datetime):
        @classmethod
        def now(cls,tz=None):return cls(2026,11,21,12,tzinfo=tz)
    monkeypatch.setattr(jobs,'datetime',Saturday)
    monkeypatch.setattr(jobs,'_refresh_metals_market_data',lambda:pytest.fail('Saturday source call'))
    asyncio.run(jobs.scheduled_metals_market_refresh_job())
