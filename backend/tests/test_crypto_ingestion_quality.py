from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.alternative_assets import CryptoPrice, CryptoEcosystemMetric, BitcoinNetworkMetric, MacroLiquidityData, EquityPrice
from app.models.precious_metals import MetalPrice
from app.services.aas_calculator import AASCalculator
from app.services.ingestion import aas_data_ingestion as module
from app.services.ingestion.aas_data_ingestion import CryptoDataIngestion, CryptoEcosystemIngestion, BitcoinNetworkIngestion


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def response(data):
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: data)


def quotes(now):
    return {coin: {'usd': price, 'usd_24h_vol': 123, 'last_updated_at': now.replace(tzinfo=timezone.utc).timestamp()} for coin, price in [('bitcoin',60000),('ethereum',2000),('solana',75),('ripple',1)]}


def test_current_quotes_share_provider_time_and_upsert_existing_day(db, monkeypatch):
    now = datetime.utcnow()
    day = now.replace(hour=0,minute=0,second=0,microsecond=0)
    old = CryptoPrice(date=day, btc_usd=1, created_at=now-timedelta(hours=5))
    db.add(old);db.commit()
    calls = []
    def fetch(url, **kwargs):
        calls.append((url,kwargs))
        return response(quotes(now)) if url.endswith('/price') else response({'data': {'updated_at':now.replace(tzinfo=timezone.utc).timestamp(),'total_market_cap':{'usd':2e12},'market_cap_percentage':{'btc':60}}})
    monkeypatch.setattr(module.requests,'get',fetch)
    ingest=CryptoDataIngestion(db)
    monkeypatch.setattr(ingest,'fetch_historical_prices',lambda *_:pytest.fail('light refresh must not backfill'))
    row=ingest.fetch_current_prices()
    assert row.id==old.id and row.sol_usd==75 and row.xrp_usd==1
    assert row.total_crypto_mcap==2000 and row.created_at>now-timedelta(minutes=1)
    assert row.source.startswith('COINGECKO_LIVE|') and len(calls)==2
    assert 'solana,ripple' in calls[0][1]['params']['ids']


@pytest.mark.parametrize('bad', [None, -1, float('nan'), float('inf')])
def test_failed_quote_validation_preserves_previous_good_observation(db, monkeypatch, bad):
    now=datetime.utcnow();day=now.replace(hour=0,minute=0,second=0,microsecond=0)
    db.add(CryptoPrice(date=day,btc_usd=60000,source='OLD'));db.commit()
    data=quotes(now);data['bitcoin']['usd']=bad
    monkeypatch.setattr(module.requests,'get',lambda *a,**k:response(data))
    assert CryptoDataIngestion(db).fetch_current_prices() is None
    assert db.query(CryptoPrice).one().btc_usd==60000


def test_stale_current_quote_is_not_restamped(db, monkeypatch):
    data=quotes(datetime.utcnow()-timedelta(hours=2))
    monkeypatch.setattr(module.requests,'get',lambda *a,**k:response(data))
    assert CryptoDataIngestion(db).fetch_current_prices() is None
    assert db.query(CryptoPrice).count()==0


def test_historical_gold_ratio_never_uses_future_or_stale_gold(db):
    asof=datetime(2026,1,10)
    db.add_all([MetalPrice(metal='AU',date=asof+timedelta(days=1),price_usd_per_oz=9000,source='YAHOO_FINANCE'),MetalPrice(metal='AU',date=asof-timedelta(days=7),price_usd_per_oz=1000,source='YAHOO_FINANCE')]);db.commit()
    ingest=CryptoDataIngestion(db)
    assert ingest._fetch_gold_price(asof) is None
    db.add(MetalPrice(metal='AU',date=asof-timedelta(days=1),price_usd_per_oz=3000,source='YAHOO_FINANCE'));db.commit()
    assert ingest._fetch_gold_price(asof)==3000


def test_missing_exchange_flow_is_unknown_and_valid_zero_is_kept():
    parse=CryptoEcosystemIngestion._parse_exchange_flow
    assert parse({'FlowOutExNtv':'5'})==(None,None)
    assert parse({'FlowOutExNtv':'0','FlowInExNtv':'0','FlowOutExUSD':'nan','FlowInExUSD':'0'})==(0,None)
    assert parse({'FlowOutExNtv':'5','FlowInExNtv':'7'})==(-2,None)


def test_ecosystem_backfill_uses_actual_dates_and_preserves_failed_fields(db, monkeypatch):
    day=(datetime.utcnow()-timedelta(days=2)).date()
    key=datetime.combine(day,datetime.min.time())
    db.add(CryptoEcosystemMetric(date=key,stablecoin_supply_usd=999,source='MULTI'));db.commit()
    ingest=CryptoEcosystemIngestion(db)
    monkeypatch.setattr(ingest,'_fetch_stablecoin_supply_series',lambda *_:{day:100})
    monkeypatch.setattr(ingest,'_fetch_defi_tvl_series',lambda *_:{day:50})
    monkeypatch.setattr(ingest,'_fetch_exchange_outflows_series',lambda *_:{day:(0,0)})
    monkeypatch.setattr(ingest,'_fetch_btc_market_cap_series',lambda *_:{day:1000})
    ingest._backfill_metrics(7)
    verified=db.query(CryptoEcosystemMetric).filter_by(source='MULTI_V2').one()
    assert verified.date==key and verified.stablecoin_btc_ratio==.1
    monkeypatch.setattr(ingest,'_fetch_stablecoin_supply_series',lambda *_:{})
    ingest._backfill_metrics(7)
    assert verified.stablecoin_supply_usd==100 and verified.exchange_net_outflow_btc==0
    assert db.query(CryptoEcosystemMetric).filter_by(source='MULTI').one().stablecoin_supply_usd==999


def test_calculator_uses_one_observation_per_day_and_rejects_stale(db):
    day=datetime(2026,11,20)
    for i in range(30):
        for value in [1,100+i]:db.add(CryptoPrice(date=day-timedelta(days=29-i),btc_usd=value))
    db.commit();calc=AASCalculator(db)
    assert len(calc._get_crypto_prices(day,60))==30
    assert calc._get_crypto_prices(day,60)[-1].btc_usd==129
    assert calc._get_crypto_prices(day+timedelta(days=5),60)==[]


def test_pressure_ignores_legacy_false_dates_and_matches_independent_zscore(db):
    day=datetime(2026,11,20)
    for i in range(20):
        key=day-timedelta(days=19-i)
        db.add(CryptoEcosystemMetric(date=key,stablecoin_supply_usd=i+1,source='MULTI_V2'))
        db.add(CryptoEcosystemMetric(date=key,stablecoin_supply_usd=9999,source='MULTI'))
    db.commit();calc=AASCalculator(db)
    expected=((20-10.5)/np.sqrt((20**2-1)/12)+2)/4
    assert calc._calc_stablecoin_supply(day)==pytest.approx(expected)
    assert calc._calc_stablecoin_supply(day+timedelta(days=6)) is None


def test_correlation_pressure_is_inverse_mapping_of_raw_coefficient(db):
    day=datetime(2026,11,20)
    db.add(CryptoEcosystemMetric(date=day,btc_spy_corr_30d=-.8,source='MULTI_V2'));db.commit()
    assert AASCalculator(db)._calc_btc_spy_correlation(day)==pytest.approx(.9)


def test_false_legacy_m2_does_not_supply_crypto_signal(db):
    day=datetime(2026,11,20)
    db.add_all([CryptoPrice(date=day,btc_usd=60000,total_crypto_mcap=2000),MacroLiquidityData(date=day,global_m2=50,source='FRED')]);db.commit()
    assert AASCalculator(db)._calc_crypto_m2_ratio(day) is None


def test_correlation_uses_same_dates_excludes_partial_today(db):
    day=datetime(2026,11,20)
    levels=np.cumprod([1]+[1+.01*np.sin(i) for i in range(30)])*100
    for i,value in enumerate(levels):
        key=day-timedelta(days=31-i)
        db.add_all([CryptoPrice(date=key,btc_usd=value),EquityPrice(symbol='SPY',date=key,close=2*value)])
    db.add_all([CryptoPrice(date=day,btc_usd=1e6),EquityPrice(symbol='SPY',date=day,close=1)])
    db.commit()
    assert CryptoEcosystemIngestion(db)._calculate_btc_spy_corr(day)==pytest.approx(1)


@pytest.mark.parametrize('ingester',[CryptoDataIngestion,CryptoEcosystemIngestion])
def test_provider_series_reject_malformed_nonfinite_and_future_observations(db, ingester):
    now=datetime.utcnow().replace(tzinfo=timezone.utc)
    valid=int(now.timestamp()*1000)
    future=int((now+timedelta(days=1)).timestamp()*1000)
    values=[[valid,5],[valid-86400000,float('nan')],[future,10],None,[],[1],'12',[valid,-1]]
    assert ingester(db)._series_to_date_map(values)=={now.date():5}


def test_network_rejects_negative_nonfinite_and_future_points(db, monkeypatch):
    now=datetime.utcnow().replace(tzinfo=timezone.utc)
    data={'values':[{'x':now.timestamp()-86400,'y':100},{'x':now.timestamp(),'y':float('inf')},{'x':now.timestamp()+86400,'y':200},{'x':now.timestamp(),'y':-1}]}
    monkeypatch.setattr(module.requests,'get',lambda *a,**k:response(data))
    rows=BitcoinNetworkIngestion(db)._fetch_chart_series('hash-rate')
    assert len(rows)==1 and rows[0][1]==100
