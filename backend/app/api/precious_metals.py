from fastapi import APIRouter, HTTPException, Query
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
from typing import List, Optional, Tuple
from sqlalchemy import func, desc
import statistics

from app.models.alternative_assets import MacroLiquidityData
from app.models.precious_metals import (
    MetalPrice, MetalRatio, CBHolding, COMEXInventory,
    ETFHolding, SupplyData, DemandData, MetalCorrelation,
    MetalRegimeClassification, BackwardationData, LBMAPremium, MetalVolatility,
    RegimeType, GoldBiasType, SilverBiasType, PGMBiasType, RiskLevel
)
from app.utils.db_helpers import get_db_session
from app.services.metal_price_dispersion import (
    DEFAULT_REFERENCE_IDS,
    METAL_DEFINITIONS,
    build_global_price_dispersion,
    build_global_price_history,
)
from app.services.metal_market_sources import (
    fetch_international_metal_history,
    fetch_international_metal_observations,
)
from app.services.metal_futures_curve import (
    PRECIOUS_METALS_FUTURES,
    SOURCE_NAME as FUTURES_CURVE_SOURCE,
    fetch_futures_contract_snapshot as _fetch_futures_contract_snapshot,
    get_metal_futures_curve as _service_get_metal_futures_curve,
)

router = APIRouter(prefix="/precious-metals", tags=["precious-metals"])
logger = logging.getLogger(__name__)

TONNES_TO_OZ = 32150.7466
COMEX_PLACEHOLDER_SOURCES = ["SEED", "ESTIMATED_FROM_PRICES"]
FRESHNESS_DAYS = {
    "central_bank": 150,
    "gld_holdings": 7,
    "comex_inventory": 7,
    "futures_curve": 7,
    "metal_ratios": 5,
    "macro_liquidity": 14,
}


def _is_fresh(as_of: Optional[datetime], max_age_days: int) -> bool:
    if not as_of:
        return False
    return datetime.utcnow() - as_of.replace(tzinfo=None) <= timedelta(days=max_age_days)


def _source_quality(
    record,
    *,
    cadence: str,
    max_age_days: int,
    source_url: Optional[str] = None,
    source_name: Optional[str] = None,
) -> dict:
    if record is None:
        return {
            "status": "unavailable",
            "as_of": None,
            "loaded_at": None,
            "source": source_name,
            "source_url": source_url,
            "cadence": cadence,
            "max_age_days": max_age_days,
        }
    as_of = getattr(record, "date", None)
    loaded_at = getattr(record, "created_at", None)
    age_days = max(0, (datetime.utcnow() - as_of.replace(tzinfo=None)).days) if as_of else None
    if age_days is None:
        status = "unavailable"
    elif age_days <= max_age_days:
        status = "fresh"
    elif age_days <= max_age_days * 2:
        status = "aging"
    else:
        status = "stale"
    return {
        "status": status,
        "as_of": as_of.isoformat() if as_of else None,
        "loaded_at": loaded_at.isoformat() if loaded_at else None,
        "source": source_name or getattr(record, "source", None),
        "source_url": source_url,
        "cadence": cadence,
        "max_age_days": max_age_days,
    }


# ==================== HELPER FUNCTIONS ====================

def _compute_zscore(values: List[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    if stdev == 0:
        return 0.0
    return (values[0] - mean) / stdev


def _get_metal_futures_curve(
    metal: str, contracts: int, as_of: Optional[datetime] = None
) -> Optional[dict]:
    return _service_get_metal_futures_curve(
        metal,
        contracts=contracts,
        as_of=as_of or datetime.utcnow(),
        snapshot_fetcher=_fetch_futures_contract_snapshot,
    )


def get_precious_metals_futures_curve(contracts: int = 4) -> dict:
    as_of = datetime.utcnow()
    metals = []
    quote_timestamps = []
    for metal in PRECIOUS_METALS_FUTURES:
        curve = _get_metal_futures_curve(metal, contracts=contracts, as_of=as_of)
        if not curve:
            continue
        metals.append(curve)
        quote_timestamps.extend(row["as_of"] for row in curve["contracts"])
    return {
        "as_of": max(quote_timestamps) if quote_timestamps else None,
        "generated_at": as_of.isoformat(),
        "source": FUTURES_CURVE_SOURCE,
        "contracts_requested": contracts,
        "metals": metals,
    }


def _get_latest_cb_dates(db) -> Tuple[Optional[datetime], Optional[datetime]]:
    latest_date = db.query(func.max(CBHolding.date)).scalar()
    if not latest_date:
        return None, None
    prior_date = db.query(func.max(CBHolding.date)).filter(
        CBHolding.date <= latest_date - timedelta(days=330)
    ).scalar()
    return latest_date, prior_date


def _sum_gold_tonnes(db, date: datetime, countries: Optional[List[str]] = None) -> Optional[float]:
    if not date:
        return None
    query = db.query(func.sum(CBHolding.gold_tonnes)).filter(CBHolding.date == date)
    if countries:
        query = query.filter(CBHolding.country.in_(countries))
    total = query.scalar()
    return total if total is not None else None


def _calc_global_cb_gold_pct_reserves(
    db, date: Optional[datetime], countries: Optional[List[str]] = None
) -> Optional[float]:
    if not date:
        return None
    query = db.query(CBHolding).filter(
        CBHolding.date == date,
        CBHolding.gold_tonnes.isnot(None),
        CBHolding.pct_of_reserves.isnot(None)
    )
    if countries:
        query = query.filter(CBHolding.country.in_(countries))
    holdings = query.all()
    if not holdings:
        return None
    total_gold = 0.0
    total_reserves = 0.0
    for holding in holdings:
        if not holding.pct_of_reserves:
            continue
        total_gold += holding.gold_tonnes
        total_reserves += holding.gold_tonnes / (holding.pct_of_reserves / 100)
    if total_reserves <= 0:
        return None
    return (total_gold / total_reserves) * 100


def _calc_yoy_change(latest_total: Optional[float], prior_total: Optional[float]) -> Optional[float]:
    if latest_total is None or prior_total is None or prior_total <= 0:
        return None
    return ((latest_total - prior_total) / prior_total) * 100


def _matched_cb_countries(
    db,
    latest_date: Optional[datetime],
    prior_date: Optional[datetime],
    countries: Optional[List[str]] = None,
) -> List[str]:
    if not latest_date or not prior_date:
        return []
    latest_query = db.query(CBHolding.country).filter(
        CBHolding.date == latest_date,
        CBHolding.gold_tonnes.isnot(None),
    )
    prior_query = db.query(CBHolding.country).filter(
        CBHolding.date == prior_date,
        CBHolding.gold_tonnes.isnot(None),
    )
    if countries:
        latest_query = latest_query.filter(CBHolding.country.in_(countries))
        prior_query = prior_query.filter(CBHolding.country.in_(countries))
    latest_countries = {row[0] for row in latest_query.all()}
    prior_countries = {row[0] for row in prior_query.all()}
    return sorted(latest_countries & prior_countries)


def _calc_cb_holdings_yoy(
    db,
    latest_date: Optional[datetime],
    prior_date: Optional[datetime],
    countries: Optional[List[str]] = None,
) -> Optional[float]:
    matched = _matched_cb_countries(db, latest_date, prior_date, countries)
    if not matched:
        return None
    return _calc_yoy_change(
        _sum_gold_tonnes(db, latest_date, matched),
        _sum_gold_tonnes(db, prior_date, matched),
    )


def _calc_etf_holdings_zscore(
    db, ticker: str = "GLD", window_days: int = 730
) -> Optional[float]:
    latest = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None),
    ).order_by(desc(ETFHolding.date)).first()
    if not latest or not _is_fresh(latest.date, FRESHNESS_DAYS["gld_holdings"]):
        return None
    records = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None),
        ETFHolding.date >= datetime.utcnow() - timedelta(days=window_days)
    ).order_by(ETFHolding.date).all()
    values = [r.holdings for r in records if r.holdings is not None]
    if len(values) < 20:
        return None
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    if stdev == 0:
        return 0.0
    return (values[-1] - mean) / stdev


def _calc_etf_holdings_yoy(db, ticker: str = "GLD") -> Optional[float]:
    latest = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None)
    ).order_by(desc(ETFHolding.date)).first()
    if not latest or latest.holdings is None:
        return None
    if not _is_fresh(latest.date, FRESHNESS_DAYS["gld_holdings"]):
        return None
    prior = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None),
        ETFHolding.date <= latest.date - timedelta(days=330)
    ).order_by(desc(ETFHolding.date)).first()
    if not prior or prior.holdings is None:
        return None
    return ((latest.holdings - prior.holdings) / prior.holdings) * 100


def _calc_em_accumulation_momentum(db) -> Optional[float]:
    em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
    latest_date = db.query(func.max(CBHolding.date)).filter(
        CBHolding.country.in_(em_countries),
        CBHolding.gold_tonnes.isnot(None)
    ).scalar()
    if not latest_date:
        return None
    prior_date = db.query(func.max(CBHolding.date)).filter(
        CBHolding.country.in_(em_countries),
        CBHolding.gold_tonnes.isnot(None),
        CBHolding.date <= latest_date - timedelta(days=330),
    ).scalar()
    if not prior_date:
        return None
    return _calc_cb_holdings_yoy(db, latest_date, prior_date, em_countries)


def _latest_cb_gold_oz(db) -> Optional[float]:
    latest_date = db.query(func.max(CBHolding.date)).scalar()
    if not latest_date:
        return None
    subq = db.query(
        CBHolding.country,
        func.max(CBHolding.id).label("max_id")
    ).filter(
        CBHolding.date == latest_date,
        CBHolding.gold_tonnes.isnot(None)
    ).group_by(CBHolding.country).subquery()
    total_tonnes = db.query(func.sum(CBHolding.gold_tonnes)).join(
        subq,
        CBHolding.id == subq.c.max_id
    ).scalar()
    if total_tonnes is None:
        return None
    return total_tonnes * TONNES_TO_OZ


def _cb_gold_oz_series(db) -> dict:
    subq = db.query(
        CBHolding.date.label("date"),
        CBHolding.country.label("country"),
        func.max(CBHolding.id).label("max_id")
    ).filter(
        CBHolding.gold_tonnes.isnot(None)
    ).group_by(CBHolding.date, CBHolding.country).subquery()

    rows = db.query(
        subq.c.date,
        func.sum(CBHolding.gold_tonnes)
    ).join(
        CBHolding,
        CBHolding.id == subq.c.max_id
    ).group_by(subq.c.date).order_by(subq.c.date).all()
    return {row[0].date(): row[1] * TONNES_TO_OZ for row in rows if row[1] is not None}


def _compute_real_rate_signal(db) -> Optional[float]:
    latest = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.real_rate_10y.isnot(None)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not latest or not _is_fresh(latest.date, FRESHNESS_DAYS["macro_liquidity"]):
        return None
    values = [
        row[0] for row in db.query(MacroLiquidityData.real_rate_10y)
        .filter(MacroLiquidityData.real_rate_10y.isnot(None))
        .order_by(desc(MacroLiquidityData.date))
        .limit(365)
        .all()
        if row[0] is not None
    ]
    zscore = _compute_zscore(values)
    if zscore is None:
        return None
    return -zscore


def _compute_m2_growth_signal(db) -> Optional[float]:
    latest = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.global_m2.between(10, 500)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not latest or latest.global_m2 is None:
        return None
    prior = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.global_m2.between(10, 500),
        MacroLiquidityData.date <= latest.date - timedelta(days=330)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not prior or prior.global_m2 is None or prior.global_m2 == 0:
        return None
    yoy_pct = ((latest.global_m2 - prior.global_m2) / prior.global_m2) * 100
    if abs(yoy_pct) > 30:
        return None
    return yoy_pct / 10.0

def calculate_structural_monetary_bid(db) -> Optional[float]:
    """
    SMB = 0.5 × (Net Purchase Momentum) 
        + 0.3 × (CB Gold % Reserves Change)
        + 0.2 × (EM Accumulation Trend)
    """
    latest_date, prior_date = _get_latest_cb_dates(db)
    if not _is_fresh(latest_date, FRESHNESS_DAYS["central_bank"]):
        return None
    matched_countries = _matched_cb_countries(db, latest_date, prior_date)
    net_purchase_momentum = _calc_cb_holdings_yoy(db, latest_date, prior_date)
    
    # CB Gold % Reserve Change
    latest_reserve_pct = _calc_global_cb_gold_pct_reserves(
        db, latest_date, matched_countries
    )
    prior_reserve_pct = _calc_global_cb_gold_pct_reserves(
        db, prior_date, matched_countries
    )
    cb_reserve_change = _calc_yoy_change(latest_reserve_pct, prior_reserve_pct)
    
    # EM Accumulation Trend (proxy: recent purchases from top EM countries)
    em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
    em_accumulation_trend = _calc_cb_holdings_yoy(
        db, latest_date, prior_date, em_countries
    )

    components = []
    if net_purchase_momentum is not None:
        components.append((net_purchase_momentum, 0.5))
    if cb_reserve_change is not None:
        components.append((cb_reserve_change, 0.3))
    if em_accumulation_trend is not None:
        components.append((em_accumulation_trend, 0.2))
    if not components:
        return None

    weighted_sum = sum(value * weight for value, weight in components)
    weight_total = sum(weight for _, weight in components)
    smb = weighted_sum / weight_total
    return max(-100, min(100, smb))  # Clamp to [-100, 100]


def calculate_monetary_hedge_strength(
    db,
    real_rate_signal: Optional[float] = None,
    m2_growth_signal: Optional[float] = None
) -> Optional[float]:
    """
    MHS = (Au/DXY_Z + Real_Rate_Signal + 0.5 × M2_Growth_Signal) / 2.5
    Normalized to 0-100
    """
    # Get latest Au/DXY ratio z-score
    latest_au_dxy = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "AU",
        MetalRatio.metal2 == "DXY"
    ).order_by(desc(MetalRatio.date)).first()
    
    au_dxy_zscore = latest_au_dxy.zscore_2y if latest_au_dxy else None
    if latest_au_dxy and not _is_fresh(
        latest_au_dxy.date, FRESHNESS_DAYS["metal_ratios"]
    ):
        au_dxy_zscore = None

    if real_rate_signal is None:
        real_rate_signal = _compute_real_rate_signal(db)
    if m2_growth_signal is None:
        m2_growth_signal = _compute_m2_growth_signal(db)

    components = []
    if au_dxy_zscore is not None:
        components.append((au_dxy_zscore, 1.0))
    if real_rate_signal is not None:
        components.append((real_rate_signal, 1.0))
    if m2_growth_signal is not None:
        components.append((m2_growth_signal * 0.5, 0.5))
    if not components:
        return None

    weighted_sum = sum(value * weight for value, weight in components)
    weight_total = sum(weight for _, weight in components)
    mhs_raw = weighted_sum / weight_total
    mhs_score = 50 + (mhs_raw * 50)  # Normalize to 0-100
    return max(0, min(100, mhs_score))


def calculate_paper_credibility_index(db) -> Optional[float]:
    """
    PCI derived from ETF holdings (primary) or COMEX ratio (fallback).
    Adjusted for backwardation & spreads.
    """
    gld_zscore = _calc_etf_holdings_zscore(db, "GLD")
    if gld_zscore is not None:
        pci = max(0, min(100, ((gld_zscore + 2) / 4) * 100))
    else:
        # COMEX fallback
        latest_comex = db.query(COMEXInventory).filter(
            COMEXInventory.metal == "AU",
            COMEXInventory.oi_to_registered_ratio.isnot(None),
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).order_by(desc(COMEXInventory.date)).first()

        if (
            not latest_comex
            or not latest_comex.oi_to_registered_ratio
            or not _is_fresh(latest_comex.date, FRESHNESS_DAYS["comex_inventory"])
        ):
            return None

        all_ratios = db.query(COMEXInventory.oi_to_registered_ratio).filter(
            COMEXInventory.metal == "AU",
            COMEXInventory.oi_to_registered_ratio.isnot(None),
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).all()

        if not all_ratios:
            return None

        ratios_list = [r[0] for r in all_ratios]
        p90 = statistics.quantiles(ratios_list, n=10)[8] if len(ratios_list) > 10 else max(ratios_list)
        stress_factor = (latest_comex.oi_to_registered_ratio / p90) if p90 > 0 else 1.0
        pci = 100 - (stress_factor * 100)

    # Adjust for backwardation
    latest_backwardation = db.query(BackwardationData).filter(
        BackwardationData.metal == "AU"
    ).order_by(desc(BackwardationData.date)).first()
    if (
        latest_backwardation
        and _is_fresh(latest_backwardation.date, FRESHNESS_DAYS["futures_curve"])
        and latest_backwardation.backwardation_bps > 500
    ):
        pci -= 15  # Penalize deep backwardation
    
    return max(0, min(100, pci))


def classify_regime(db) -> tuple:
    """
    Classify metals regime based on indicator combination
    Returns: (regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk)
    """
    smb = calculate_structural_monetary_bid(db)
    mhs = calculate_monetary_hedge_strength(db)
    pci = calculate_paper_credibility_index(db)
    
    # Get latest ratios
    au_ag_latest = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "AU",
        MetalRatio.metal2 == "AG"
    ).order_by(desc(MetalRatio.date)).first()
    
    pt_au_latest = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "PT",
        MetalRatio.metal2 == "AU"
    ).order_by(desc(MetalRatio.date)).first()
    
    # Get industrial demand proxy (silver price momentum + PGM ratios)
    recent_silver_prices = db.query(MetalPrice).filter(
        MetalPrice.metal == "AG"
    ).order_by(desc(MetalPrice.date)).limit(60).all()
    
    silver_momentum = None
    if len(recent_silver_prices) >= 2:
        silver_momentum = (
            (recent_silver_prices[0].price_usd_per_oz - recent_silver_prices[-1].price_usd_per_oz)
            / recent_silver_prices[-1].price_usd_per_oz
            * 100
        )
    
    # Regime logic
    has_signal = any(
        value is not None
        for value in [mhs, smb, pci, silver_momentum]
    ) or pt_au_latest is not None

    if not has_signal:
        regime = None
    elif mhs is not None and smb is not None and mhs > 60 and smb > 30:
        regime = RegimeType.MONETARY_STRESS
    elif mhs is not None and silver_momentum is not None and mhs > 40 and silver_momentum > 10:
        regime = RegimeType.INFLATION_HEDGE
    elif pt_au_latest and pt_au_latest.ratio_value > 0.8:
        regime = RegimeType.GROWTH_REFLATION
    elif pci is not None and pci < 50:
        regime = RegimeType.LIQUIDITY_CRISIS
    else:
        regime = RegimeType.INDUSTRIAL_COMMODITY
    
    # Gold bias
    if mhs is None:
        gold_bias = None
    elif mhs > 60:
        gold_bias = GoldBiasType.MONETARY_HEDGE
    elif mhs > 40:
        gold_bias = GoldBiasType.NEUTRAL
    else:
        gold_bias = GoldBiasType.FINANCIAL_ASSET
    
    # Silver bias
    if not au_ag_latest:
        silver_bias = None
    elif au_ag_latest.ratio_value > 70:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY  # Ag underperforming due to industrial weakness
    elif au_ag_latest and au_ag_latest.ratio_value < 50:
        silver_bias = SilverBiasType.INDUSTRIAL  # Ag outperforming on industrial demand
    else:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY
    
    # PGM bias
    if not pt_au_latest:
        pgm_bias = None
    elif pt_au_latest.ratio_value < 0.6:
        pgm_bias = PGMBiasType.RECESSION
    elif pt_au_latest and pt_au_latest.ratio_value > 0.85:
        pgm_bias = PGMBiasType.GROWTH
    else:
        pgm_bias = PGMBiasType.NEUTRAL
    
    # Paper/Physical risk
    if pci is None:
        paper_physical_risk = None
    elif pci > 75:
        paper_physical_risk = RiskLevel.LOW
    elif pci > 50:
        paper_physical_risk = RiskLevel.MODERATE
    else:
        paper_physical_risk = RiskLevel.HIGH
    
    return regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk


# ==================== API ENDPOINTS ====================

@router.get("/regime")
def get_regime_classification():
    """
    Get current precious metals regime classification
    """
    with get_db_session() as db:
        try:
            regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk = classify_regime(db)
            smb = calculate_structural_monetary_bid(db)
            real_rate_signal = _compute_real_rate_signal(db)
            m2_growth_signal = _compute_m2_growth_signal(db)
            mhs = calculate_monetary_hedge_strength(db, real_rate_signal, m2_growth_signal)
            pci = calculate_paper_credibility_index(db)
            
            # Get latest ratios
            au_ag = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AU", MetalRatio.metal2 == "AG"
            ).order_by(desc(MetalRatio.date)).first()
            
            pt_au = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "PT", MetalRatio.metal2 == "AU"
            ).order_by(desc(MetalRatio.date)).first()
            
            pd_au = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "PD", MetalRatio.metal2 == "AU"
            ).order_by(desc(MetalRatio.date)).first()
            
            au_dxy = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AU", MetalRatio.metal2 == "DXY"
            ).order_by(desc(MetalRatio.date)).first()
            
            ag_dxy = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AG", MetalRatio.metal2 == "DXY"
            ).order_by(desc(MetalRatio.date)).first()
            
            # COMEX data (optional)
            comex_record = db.query(COMEXInventory).filter(
                COMEXInventory.metal == "AU",
                COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
            ).order_by(desc(COMEXInventory.date)).first()
            comex = (
                comex_record
                if comex_record and _is_fresh(
                    comex_record.date, FRESHNESS_DAYS["comex_inventory"]
                )
                else None
            )
            comex_change = None
            if comex:
                prior_comex = db.query(COMEXInventory).filter(
                    COMEXInventory.metal == "AU",
                    COMEXInventory.date <= comex.date - timedelta(days=330),
                    COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
                ).order_by(desc(COMEXInventory.date)).first()
                if prior_comex and prior_comex.registered_oz:
                    comex_change = (comex.registered_oz - prior_comex.registered_oz) / prior_comex.registered_oz * 100
            
            # Get backwardation data
            backwardation_record = db.query(BackwardationData).filter(
                BackwardationData.metal == "AU"
            ).order_by(desc(BackwardationData.date)).first()
            backwardation = (
                backwardation_record
                if backwardation_record and _is_fresh(
                    backwardation_record.date, FRESHNESS_DAYS["futures_curve"]
                )
                else None
            )
            back_severity = backwardation.backwardation_bps if backwardation else None
            
            # Get ETF flow data
            latest_etf_record = db.query(ETFHolding).filter(
                ETFHolding.ticker == "GLD"
            ).order_by(desc(ETFHolding.date)).first()
            latest_etf = (
                latest_etf_record
                if latest_etf_record and _is_fresh(
                    latest_etf_record.date, FRESHNESS_DAYS["gld_holdings"]
                )
                else None
            )
            etf_divergence = None
            if latest_etf:
                prior_etf = db.query(ETFHolding).filter(
                    ETFHolding.ticker == "GLD",
                    ETFHolding.date < latest_etf.date
                ).order_by(desc(ETFHolding.date)).first()
                if prior_etf and latest_etf.holdings and prior_etf.holdings:
                    etf_divergence = ((latest_etf.holdings - prior_etf.holdings) / prior_etf.holdings) * 100
            
            gld_holdings_zscore = _calc_etf_holdings_zscore(db, "GLD")
            gld_holdings_yoy = _calc_etf_holdings_yoy(db, "GLD")

            latest_cb_date, prior_cb_date = _get_latest_cb_dates(db)
            cb_record = db.query(CBHolding).order_by(desc(CBHolding.date)).first()
            cb_is_fresh = _is_fresh(
                latest_cb_date, FRESHNESS_DAYS["central_bank"]
            )
            global_cb_gold_pct_reserves = (
                _calc_global_cb_gold_pct_reserves(db, latest_cb_date)
                if cb_is_fresh else None
            )
            net_purchases_yoy = (
                _calc_cb_holdings_yoy(db, latest_cb_date, prior_cb_date)
                if cb_is_fresh else None
            )
            em_accumulation_momentum = (
                _calc_em_accumulation_momentum(db) if cb_is_fresh else None
            )

            ratios_are_fresh = bool(
                au_ag and _is_fresh(au_ag.date, FRESHNESS_DAYS["metal_ratios"])
            )
            macro_record = db.query(MacroLiquidityData).order_by(
                desc(MacroLiquidityData.date)
            ).first()

            return {
                "regime": {
                    "overall_regime": regime.value if regime else None,
                    "gold_bias": gold_bias.value if gold_bias else None,
                    "silver_bias": silver_bias.value if silver_bias else None,
                    "pgm_bias": pgm_bias.value if pgm_bias else None,
                    "paper_physical_risk": paper_physical_risk.value if paper_physical_risk else None
                },
                "cb_context": {
                    "global_cb_gold_pct_reserves": global_cb_gold_pct_reserves,
                    "net_purchases_yoy": net_purchases_yoy,
                    "structural_monetary_bid": smb,
                    "em_accumulation_momentum": em_accumulation_momentum
                },
                "price_anchors": {
                    "au_dxy_ratio_zscore": au_dxy.zscore_2y if au_dxy and ratios_are_fresh else None,
                    "ag_dxy_ratio_zscore": ag_dxy.zscore_2y if ag_dxy and ratios_are_fresh else None,
                    "real_rate_signal": real_rate_signal,
                    "monetary_hedge_strength": mhs
                },
                "relative_value": {
                    "au_ag_ratio": au_ag.ratio_value if au_ag and ratios_are_fresh else None,
                    "au_ag_ratio_zscore": au_ag.zscore_2y if au_ag and ratios_are_fresh else None,
                    "pt_au_ratio": pt_au.ratio_value if pt_au and ratios_are_fresh else None,
                    "pt_au_ratio_zscore": pt_au.zscore_2y if pt_au and ratios_are_fresh else None,
                    "pd_au_ratio": pd_au.ratio_value if pd_au and ratios_are_fresh else None,
                    "pd_au_ratio_zscore": pd_au.zscore_2y if pd_au and ratios_are_fresh else None
                },
                "physical_paper": {
                    "paper_credibility_index": pci,
                    "oi_registered_ratio": comex.oi_to_registered_ratio if comex else None,
                    "comex_registered_inventory_change_yoy": comex_change if comex else None,
                    "etf_holdings_zscore": gld_holdings_zscore,
                    "etf_holdings_change_yoy": gld_holdings_yoy,
                    "backwardation_severity": back_severity if backwardation else None,
                    "etf_flow_divergence": etf_divergence if latest_etf else None
                },
                "data_quality": {
                    "central_bank": _source_quality(
                        cb_record,
                        cadence="quarterly",
                        max_age_days=FRESHNESS_DAYS["central_bank"],
                        source_url=(
                            "https://fsapi.gold.org/api/cbd/v11/charts/getPage"
                            "?page=snapshot&periodicity=QTD_FULL"
                        ),
                        source_name="World Gold Council Goldhub / IMF IFS",
                    ),
                    "gld_holdings": _source_quality(
                        latest_etf_record,
                        cadence="business daily",
                        max_age_days=FRESHNESS_DAYS["gld_holdings"],
                        source_url=(
                            "https://api.spdrgoldshares.com/api/v1/historical-archive"
                            "?exchange=NYSE&lang=en&product=gld"
                        ),
                    ),
                    "comex_inventory": _source_quality(
                        comex_record,
                        cadence="business daily",
                        max_age_days=FRESHNESS_DAYS["comex_inventory"],
                        source_url=(
                            "https://www.cmegroup.com/clearing/operations-and-deliveries/"
                            "registrar-reports.html"
                        ),
                        source_name="CME Group warehouse stocks",
                    ),
                    "futures_curve": _source_quality(
                        backwardation_record,
                        cadence="business daily",
                        max_age_days=FRESHNESS_DAYS["futures_curve"],
                    ),
                    "metal_ratios": _source_quality(
                        au_ag,
                        cadence="business daily",
                        max_age_days=FRESHNESS_DAYS["metal_ratios"],
                        source_name="Derived from ingested metal prices",
                    ),
                    "macro_liquidity": _source_quality(
                        macro_record,
                        cadence="daily and weekly series",
                        max_age_days=FRESHNESS_DAYS["macro_liquidity"],
                    ),
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/cb-holdings")
def get_cb_holdings():
    """
    Get central bank holdings by country (most recent)
    """
    with get_db_session() as db:
        try:
            latest_date = db.query(func.max(CBHolding.date)).scalar()
            if not latest_date:
                return []
            
            holdings = db.query(CBHolding).filter(
                CBHolding.date == latest_date
            ).all()
            prior_snapshot_date = db.query(func.max(CBHolding.date)).filter(
                CBHolding.date < latest_date
            ).scalar()
            prior_rows = db.query(CBHolding).filter(
                CBHolding.date == prior_snapshot_date
            ).all() if prior_snapshot_date else []
            prior_by_country = {row.country: row for row in prior_rows}
            
            # Get YoY change
            result = []
            for holding in holdings:
                prior_year = db.query(CBHolding).filter(
                    CBHolding.country == holding.country,
                    CBHolding.date <= holding.date - timedelta(days=330)
                ).order_by(desc(CBHolding.date)).first()
                
                yoy_pct = None
                if prior_year and prior_year.gold_tonnes:
                    yoy_pct = (holding.gold_tonnes - prior_year.gold_tonnes) / prior_year.gold_tonnes * 100

                prior_snapshot = prior_by_country.get(holding.country)
                net_purchase_qty = None
                if prior_snapshot and prior_snapshot.gold_tonnes is not None:
                    net_purchase_qty = holding.gold_tonnes - prior_snapshot.gold_tonnes
                
                result.append({
                    "country": holding.country,
                    "gold_tonnes": holding.gold_tonnes,
                    "pct_of_reserves": holding.pct_of_reserves,
                    "net_purchase_qty": net_purchase_qty,
                    "net_purchase_yoy_pct": yoy_pct,
                    "date": holding.date.isoformat(),
                    "prior_date": prior_snapshot.date.isoformat() if prior_snapshot else None,
                    "source": holding.source,
                })

            result.sort(
                key=lambda row: (
                    row["net_purchase_qty"] is not None,
                    row["net_purchase_qty"] or 0,
                ),
                reverse=True,
            )
            return result[:20]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/futures-curve")
def get_futures_curve(contracts: int = Query(4, ge=3, le=6)):
    """Get COMEX/NYMEX nearby month-specific precious-metals futures curves."""
    try:
        return get_precious_metals_futures_curve(contracts=contracts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global-price-dispersion")
def get_global_price_dispersion(
    metal: str = Query("AG", min_length=2, max_length=2),
    comparison_time: str = Query("latest_available"),
    reference: str = Query("auto"),
    basis: str = Query("raw_converted"),
):
    """Return registry coverage plus only those venue quotes that can be verified."""
    metal = metal.upper()
    if metal not in METAL_DEFINITIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported metal: {metal}")

    observations = []
    reference_id = DEFAULT_REFERENCE_IDS[metal]

    def fetch_reference() -> list[dict]:
        rows = []
        if metal in PRECIOUS_METALS_FUTURES:
            curve = _get_metal_futures_curve(metal, contracts=1)
            if curve and curve["contracts"]:
                front = curve["contracts"][0]
                rows.append({
                    "registry_id": reference_id,
                    "provider_id": "us_reference",
                    "symbol": front["symbol"],
                    "contract_month": front["contract_label"],
                    "local_price": front["price"],
                    "currency": "USD",
                    "native_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
                    "fx_rate_local_per_usd": 1.0,
                    "fx_timestamp": front["as_of"],
                    "fx_source": "Identity conversion for USD quote",
                    "price_type": "provider daily bar close",
                    "quote_timestamp": front["as_of"],
                    "timestamp_precision": "provider_daily_bar",
                    "session_status": "unverified",
                    "data_delay": "Daily provider observation; real-time status is not asserted",
                    "volume": front.get("volume"),
                    "open_interest": None,
                })
        else:
            with get_db_session() as db:
                latest = db.query(MetalPrice).filter(MetalPrice.metal == metal).order_by(desc(MetalPrice.date)).first()
                if latest and latest.price_usd_per_oz is not None:
                    rows.append({
                        "registry_id": reference_id,
                        "provider_id": "us_reference",
                        "contract_month": None,
                        "local_price": latest.price_usd_per_oz,
                        "currency": "USD",
                        "native_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
                        "fx_rate_local_per_usd": 1.0,
                        "fx_timestamp": latest.date.isoformat(),
                        "fx_source": "Identity conversion for USD quote",
                        "price_type": "stored daily close",
                        "quote_timestamp": latest.date.isoformat(),
                        "timestamp_precision": "trading_date",
                        "session_status": "unverified",
                        "data_delay": "Stored daily provider series; listed contract month is unavailable",
                        "volume": None,
                        "open_interest": None,
                    })
        return rows

    with ThreadPoolExecutor(max_workers=2) as executor:
        reference_future = executor.submit(fetch_reference)
        international_future = executor.submit(fetch_international_metal_observations, metal)
        international = international_future.result()
        reference_error = None
        try:
            reference_observations = reference_future.result()
        except Exception as exc:
            reference_observations = []
            reference_error = str(exc)[:240] or exc.__class__.__name__
            logger.warning("U.S. metal reference source failed for %s: %s", metal, reference_error)

    observations.extend(reference_observations)
    observations.extend(international["observations"])
    source_statuses = [{
        "provider_id": "us_reference",
        "provider_name": "U.S. reference series",
        "status": "unavailable" if reference_error else "live",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source_url": None,
        "error": reference_error,
        "observation_count": len(reference_observations),
    }, *international["sources"]]

    try:
        return build_global_price_dispersion(
            metal,
            observations,
            reference=reference,
            comparison_time=comparison_time,
            basis=basis,
            source_statuses=source_statuses,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/global-price-dispersion/history")
def get_global_price_dispersion_history(
    metal: str = Query("AG", min_length=2, max_length=2),
    days: int = Query(90, ge=30, le=365),
):
    """Return a source-backed global direction composite and aligned venue histories."""
    metal = metal.upper()
    if metal not in METAL_DEFINITIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported metal: {metal}")

    reference_id = DEFAULT_REFERENCE_IDS[metal]

    def fetch_reference_history() -> tuple[list[dict], dict]:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        with get_db_session() as db:
            rows = db.query(MetalPrice).filter(
                MetalPrice.metal == metal,
                MetalPrice.price_usd_per_oz.isnot(None),
                MetalPrice.date >= cutoff,
            ).order_by(MetalPrice.date).all()
        yahoo_rows = [row for row in rows if str(row.source or "").upper() == "YAHOO"]
        selected_rows = yahoo_rows if len(yahoo_rows) >= 2 else rows
        row_by_date = {row.date.date().isoformat(): row for row in selected_rows}
        observations = [{
            "registry_id": reference_id,
            "provider_id": "us_reference",
            "symbol": None,
            "contract_month": None,
            "local_price": row.price_usd_per_oz,
            "currency": "USD",
            "native_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
            "fx_rate_local_per_usd": 1.0,
            "fx_timestamp": row.date.isoformat(),
            "fx_source": "Identity conversion for USD quote",
            "price_type": "stored daily close",
            "quote_timestamp": row.date.isoformat(),
            "timestamp_precision": "trading_date",
            "session_status": "closed",
            "data_delay": "Stored daily continuous reference series; listed contract identity is unavailable",
            "volume": row.volume,
            "open_interest": None,
            "source_name": f"Stored {str(row.source or 'provider')} daily history",
        } for row in row_by_date.values()]
        observations.sort(key=lambda row: row["quote_timestamp"])
        status = {
            "provider_id": "us_reference",
            "provider_name": "U.S. reference series",
            "status": "live" if len(observations) >= 2 else "unavailable",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source_url": None,
            "source_tier": "reference_only",
            "history_scope": "Stored daily continuous reference history; contract month is not asserted",
            "observation_count": len(observations),
            "error": None if len(observations) >= 2 else "Fewer than two stored observations were available",
        }
        return observations, status

    with ThreadPoolExecutor(max_workers=2) as executor:
        reference_future = executor.submit(fetch_reference_history)
        international_future = executor.submit(fetch_international_metal_history, metal, days)
        try:
            reference_observations, reference_status = reference_future.result()
        except Exception as exc:
            reference_observations = []
            reference_status = {
                "provider_id": "us_reference",
                "provider_name": "U.S. reference series",
                "status": "unavailable",
                "fetched_at": None,
                "source_url": None,
                "source_tier": "reference_only",
                "history_scope": "Stored daily continuous reference history",
                "observation_count": 0,
                "error": str(exc)[:240] or exc.__class__.__name__,
            }
            logger.warning("U.S. metal history failed for %s: %s", metal, reference_status["error"])
        try:
            international = international_future.result()
        except Exception as exc:
            international = {"observations": [], "sources": [{
                "provider_id": "international_history",
                "provider_name": "International history sources",
                "status": "unavailable",
                "fetched_at": None,
                "source_url": None,
                "source_tier": None,
                "history_scope": None,
                "observation_count": 0,
                "error": str(exc)[:240] or exc.__class__.__name__,
            }]}
            logger.warning("International metal history failed for %s: %s", metal, international["sources"][0]["error"])

    try:
        return build_global_price_history(
            metal,
            [*reference_observations, *international["observations"]],
            days=days,
            source_statuses=[reference_status, *international["sources"]],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/supply")
def get_supply_data():
    """
    Get latest supply data (production, AISC, recycling)
    """
    with get_db_session() as db:
        try:
            latest_period = db.query(func.max(SupplyData.period)).scalar()
            if not latest_period:
                return []
            
            supply = db.query(SupplyData).filter(
                SupplyData.period == latest_period
            ).all()
            
            # Fetch latest spot prices for each metal
            spot_prices = {}
            for metal in ['AU', 'AG', 'PT', 'PD']:
                latest_price = db.query(MetalPrice).filter(
                    MetalPrice.metal == metal
                ).order_by(desc(MetalPrice.date)).first()
                if latest_price:
                    spot_prices[metal] = latest_price.price_usd_per_oz
            
            result = []
            for s in supply:
                current_spot = spot_prices.get(s.metal)
                aisc = s.aisc_per_oz
                margin_pct = (
                    ((current_spot - aisc) / aisc * 100)
                    if current_spot is not None and aisc
                    else None
                )
                
                result.append({
                    "metal": s.metal,
                    "production_tonnes_yoy_pct": s.production_yoy_pct,
                    "aisc_per_oz": aisc,
                    "current_spot_price": current_spot,
                    "margin_pct": margin_pct,
                    "recycling_pct_of_supply": s.recycling_pct
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/demand")
def get_demand_data():
    """
    Get latest demand decomposition by category
    """
    with get_db_session() as db:
        try:
            latest_period = db.query(func.max(DemandData.period)).scalar()
            if not latest_period:
                return []
            
            demand = db.query(DemandData).filter(
                DemandData.period == latest_period
            ).all()
            
            result = []
            for d in demand:
                result.append({
                    "metal": d.metal,
                    "period": d.period,
                    "investment_tonnes": d.investment_tonnes,
                    "industrial_tonnes": d.industrial_tonnes,
                    "jewelry_tonnes": d.jewelry_tonnes,
                    "jewelry_asia_tonnes": d.jewelry_asia_tonnes,
                    "other_tonnes": d.other_tonnes,
                    "total_tonnes": d.total_tonnes
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-caps")
def get_market_caps():
    """
    Return current spot prices with tracked holdings from ETF + CB data.
    """
    with get_db_session() as db:
        try:
            # Get latest prices
            prices = {}
            for metal in ['AU', 'AG', 'PT', 'PD']:
                latest = db.query(MetalPrice).filter(
                    MetalPrice.metal == metal
                ).order_by(desc(MetalPrice.date)).first()
                if latest:
                    prices[metal] = latest.price_usd_per_oz
            
            etf_by_metal = {
                "AU": "GLD",
                "AG": "SLV",
                "PT": "PPLT",
                "PD": "PALL",
            }

            # Calculate market caps from tracked holdings (ETF + CB gold)
            market_caps = {}
            total_value = 0.0
            cb_gold_oz = _latest_cb_gold_oz(db)
            for metal in ['AU', 'AG', 'PT', 'PD']:
                if metal not in prices:
                    continue
                stock_oz = None
                etf_ticker = etf_by_metal.get(metal)
                if etf_ticker:
                    latest_etf = db.query(ETFHolding).filter(
                        ETFHolding.ticker == etf_ticker
                    ).order_by(desc(ETFHolding.date)).first()
                    if latest_etf and latest_etf.holdings:
                        stock_oz = latest_etf.holdings
                if metal == "AU" and cb_gold_oz:
                    stock_oz = (stock_oz or 0) + cb_gold_oz

                value = (stock_oz * prices[metal]) if stock_oz is not None else None
                market_caps[metal] = {
                    "metal": metal,
                    "price_usd_per_oz": prices[metal],
                    "stock_oz": stock_oz,
                    "market_cap_usd": value
                }
                if value is not None:
                    total_value += value
            
            macro = db.query(MacroLiquidityData).filter(
                MacroLiquidityData.global_m2.isnot(None)
            ).order_by(desc(MacroLiquidityData.date)).first()
            global_m2_usd = (macro.global_m2 * 1e12) if macro and macro.global_m2 is not None else None
            metals_to_m2_ratio = (
                (total_value / global_m2_usd) * 100
                if global_m2_usd and total_value
                else None
            )
            
            return {
                "metals": market_caps,
                "total_market_cap_usd": total_value if total_value else None,
                "global_m2_usd": global_m2_usd,
                "metals_to_m2_pct": metals_to_m2_ratio,
                "notes": {
                    "tracked_stock": "Computed from latest ETF holdings; gold includes latest CB holdings.",
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/correlations")
def get_correlations():
    """
    Get latest rolling correlations
    """
    with get_db_session() as db:
        try:
            latest = db.query(MetalCorrelation).order_by(desc(MetalCorrelation.date)).first()
            
            if not latest:
                return {
                    "timestamp": datetime.utcnow().isoformat(),
                    "au_ag": None,
                    "au_pt": None,
                    "au_pd": None,
                    "ag_pt": None,
                    "ag_pd": None,
                    "pt_pd": None,
                    "au_spy": None,
                    "au_tlt": None,
                    "au_dxy": None,
                    "au_vix": None
                }
            
            au_pt = getattr(latest, "au_pt_60d", None)
            au_pd = getattr(latest, "au_pd_60d", None)
            ag_pt = getattr(latest, "ag_pt_60d", None)
            ag_pd = getattr(latest, "ag_pd_60d", None)
            pt_pd = getattr(latest, "pt_pd_60d", None)
            au_spy = getattr(latest, "au_spy_60d", None)
            au_tlt = getattr(latest, "au_tlt_60d", None)
            au_dxy = getattr(latest, "au_dxy_60d", None)
            au_vix = getattr(latest, "au_vix_60d", None)

            return {
                "timestamp": latest.date.isoformat(),
                "au_ag": latest.au_ag_60d if latest.au_ag_60d is not None else None,
                "au_pt": au_pt if au_pt is not None else None,
                "au_pd": au_pd if au_pd is not None else None,
                "ag_pt": ag_pt if ag_pt is not None else None,
                "ag_pd": ag_pd if ag_pd is not None else None,
                "pt_pd": pt_pd if pt_pd is not None else None,
                "au_spy": au_spy if au_spy is not None else None,
                "au_tlt": au_tlt if au_tlt is not None else None,
                "au_dxy": au_dxy if au_dxy is not None else None,
                "au_vix": au_vix if au_vix is not None else None
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{metal}")
def get_metal_price_history(metal: str, days: int = Query(365, ge=1, le=1095)):
    """
    Get historical price data for a metal
    """
    with get_db_session() as db:
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            prices = db.query(MetalPrice).filter(
                MetalPrice.metal == metal.upper(),
                MetalPrice.date >= cutoff_date
            ).order_by(MetalPrice.date).all()
            
            return [
                {
                    "date": p.date.isoformat(),
                    "price": p.price_usd_per_oz
                }
                for p in prices
            ]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-caps/history")
async def get_market_caps_history(years: int = 25):
    """
    Calculate Metals/M2 ratio history using ingested prices and macro data.
    """
    with get_db_session() as db:
        start_date = datetime.utcnow().date() - timedelta(days=years * 365)
        gold_prices = db.query(MetalPrice).filter(
            MetalPrice.metal == 'AU',
            MetalPrice.price_usd_per_oz.isnot(None),
            MetalPrice.date >= start_date
        ).order_by(MetalPrice.date).all()
        macro = db.query(MacroLiquidityData).filter(
            MacroLiquidityData.global_m2.isnot(None),
            MacroLiquidityData.date >= start_date
        ).order_by(MacroLiquidityData.date).all()

        price_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices}
        m2_map = {m.date.date(): m.global_m2 for m in macro}
        cb_gold_map = _cb_gold_oz_series(db)
        gld_holdings = db.query(ETFHolding).filter(
            ETFHolding.ticker == "GLD",
            ETFHolding.holdings.isnot(None)
        ).order_by(ETFHolding.date).all()
        holdings_map = {h.date.date(): h.holdings for h in gld_holdings}
        cb_gold_oz = _latest_cb_gold_oz(db) or 0.0
        overlap_dates = sorted(set(price_map.keys()) & set(m2_map.keys()))

        history = []
        cb_dates = sorted(cb_gold_map.keys())
        cb_index = 0
        last_cb_oz = None
        last_holdings = None
        for date in overlap_dates:
            if date in holdings_map:
                last_holdings = holdings_map[date]
            while cb_index < len(cb_dates) and cb_dates[cb_index] <= date:
                last_cb_oz = cb_gold_map[cb_dates[cb_index]]
                cb_index += 1
            tracked_cb_oz = last_cb_oz if last_cb_oz is not None else cb_gold_oz
            tracked_gold_oz = None
            if last_holdings is not None or tracked_cb_oz is not None:
                tracked_gold_oz = (last_holdings or 0.0) + (tracked_cb_oz or 0.0)
            tracked_value = (tracked_gold_oz * price_map[date]) if tracked_gold_oz is not None else None
            metals_to_m2 = (
                (tracked_value / (m2_map[date] * 1e12)) * 100
                if tracked_value is not None and m2_map[date] is not None
                else None
            )
            history.append({
                'date': date.isoformat(),
                'gold_price': price_map[date],
                'global_m2_trillions': m2_map[date],
                'metals_to_m2_pct': metals_to_m2
            })

        return {
            'history': history,
            'notes': {
                'metals_to_m2_pct': 'Tracked using GLD holdings and CB gold holdings (carried forward).'
            }
        }
