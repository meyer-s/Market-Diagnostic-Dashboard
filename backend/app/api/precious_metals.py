from fastapi import APIRouter, HTTPException
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from sqlalchemy import func, desc
import statistics

from app.models.alternative_assets import MacroLiquidityData
from app.models.precious_metals import (
    MetalPrice, MetalRatio, CBHolding, CBPurchase, COMEXInventory, 
    ETFHolding, SupplyData, DemandData, MetalCorrelation, 
    MetalRegimeClassification, BackwardationData, LBMAPremium, MetalVolatility,
    RegimeType, GoldBiasType, SilverBiasType, PGMBiasType, RiskLevel
)
from app.utils.db_helpers import get_db_session

router = APIRouter(prefix="/precious-metals", tags=["precious-metals"])


# ==================== HELPER FUNCTIONS ====================

def _compute_zscore(values: List[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    if stdev == 0:
        return 0.0
    return (values[0] - mean) / stdev


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


def _calc_global_cb_gold_pct_reserves(db, date: Optional[datetime]) -> Optional[float]:
    if not date:
        return None
    holdings = db.query(CBHolding).filter(
        CBHolding.date == date,
        CBHolding.gold_tonnes.isnot(None),
        CBHolding.pct_of_reserves.isnot(None)
    ).all()
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


def _calc_cb_net_purchases_yoy(db) -> Optional[float]:
    recent_purchases = db.query(CBPurchase).filter(
        CBPurchase.tonnes_net_yoy_pct.isnot(None)
    ).order_by(desc(CBPurchase.period)).limit(4).all()
    if not recent_purchases:
        return None
    return sum(p.tonnes_net_yoy_pct for p in recent_purchases) / len(recent_purchases)


def _compute_real_rate_signal(db) -> Optional[float]:
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
        MacroLiquidityData.global_m2.isnot(None)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not latest or latest.global_m2 is None:
        return None
    prior = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.global_m2.isnot(None),
        MacroLiquidityData.date <= latest.date - timedelta(days=330)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not prior or prior.global_m2 is None or prior.global_m2 == 0:
        return None
    yoy_pct = ((latest.global_m2 - prior.global_m2) / prior.global_m2) * 100
    return yoy_pct / 10.0

def calculate_structural_monetary_bid(db) -> Optional[float]:
    """
    SMB = 0.5 × (Net Purchase Momentum) 
        + 0.3 × (CB Gold % Reserves Change)
        + 0.2 × (EM Accumulation Trend)
    """
    net_purchase_momentum = _calc_cb_net_purchases_yoy(db)
    latest_date, prior_date = _get_latest_cb_dates(db)
    if net_purchase_momentum is None:
        net_purchase_momentum = _calc_yoy_change(
            _sum_gold_tonnes(db, latest_date),
            _sum_gold_tonnes(db, prior_date)
        )
    
    # CB Gold % Reserve Change
    recent_holdings = db.query(CBHolding).filter(
        CBHolding.pct_of_reserves.isnot(None)
    ).order_by(desc(CBHolding.date)).limit(2).all()
    
    cb_reserve_change = 0.0
    if len(recent_holdings) >= 2:
        pct_change = (recent_holdings[0].pct_of_reserves - recent_holdings[1].pct_of_reserves) / recent_holdings[1].pct_of_reserves * 100
        cb_reserve_change = pct_change
    
    # EM Accumulation Trend (proxy: recent purchases from top EM countries)
    em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
    em_purchases = db.query(CBPurchase).filter(
        CBPurchase.country.in_(em_countries),
        CBPurchase.period >= str(datetime.utcnow().year - 1)
    ).all()
    em_accumulation_trend = (
        sum([p.tonnes_net_yoy_pct for p in em_purchases]) / len(em_purchases)
        if em_purchases else None
    )
    if em_accumulation_trend is None and latest_date and prior_date:
        em_accumulation_trend = _calc_yoy_change(
            _sum_gold_tonnes(db, latest_date, em_countries),
            _sum_gold_tonnes(db, prior_date, em_countries)
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
    PCI = 100 - (OI_to_Registered_Ratio / Historical_90th_Percentile) × 100
    Adjusted for backwardation & spreads
    """
    # Get latest COMEX inventory
    latest_comex = db.query(COMEXInventory).order_by(desc(COMEXInventory.date)).first()
    
    if not latest_comex or not latest_comex.oi_to_registered_ratio:
        return None
    
    # Get historical 90th percentile
    all_ratios = db.query(COMEXInventory.oi_to_registered_ratio).filter(
        COMEXInventory.oi_to_registered_ratio.isnot(None)
    ).all()
    
    if not all_ratios:
        return None
    
    ratios_list = [r[0] for r in all_ratios]
    p90 = statistics.quantiles(ratios_list, n=10)[8] if len(ratios_list) > 10 else max(ratios_list)
    
    stress_factor = (latest_comex.oi_to_registered_ratio / p90) if p90 > 0 else 1.0
    pci = 100 - (stress_factor * 100)
    
    # Adjust for backwardation
    latest_backwardation = db.query(BackwardationData).order_by(desc(BackwardationData.date)).first()
    if latest_backwardation and latest_backwardation.backwardation_bps > 500:
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
            
            # Get COMEX data
            comex = db.query(COMEXInventory).order_by(desc(COMEXInventory.date)).first()
            comex_change = None
            if comex:
                prior_comex = db.query(COMEXInventory).filter(
                    COMEXInventory.date < comex.date
                ).order_by(desc(COMEXInventory.date)).first()
                if prior_comex:
                    comex_change = (comex.registered_oz - prior_comex.registered_oz) / prior_comex.registered_oz * 100
            
            # Get backwardation data
            backwardation = db.query(BackwardationData).filter(
                BackwardationData.metal == "AU"
            ).order_by(desc(BackwardationData.date)).first()
            back_severity = backwardation.backwardation_bps if backwardation else None
            
            # Get ETF flow data
            latest_etf = db.query(ETFHolding).filter(
                ETFHolding.ticker == "GLD"
            ).order_by(desc(ETFHolding.date)).first()
            etf_divergence = None
            if latest_etf:
                prior_etf = db.query(ETFHolding).filter(
                    ETFHolding.ticker == "GLD",
                    ETFHolding.date < latest_etf.date
                ).order_by(desc(ETFHolding.date)).first()
                if prior_etf and latest_etf.holdings and prior_etf.holdings:
                    etf_divergence = ((latest_etf.holdings - prior_etf.holdings) / prior_etf.holdings) * 100
            
            latest_cb_date, prior_cb_date = _get_latest_cb_dates(db)
            global_cb_gold_pct_reserves = _calc_global_cb_gold_pct_reserves(db, latest_cb_date)
            net_purchases_yoy = _calc_cb_net_purchases_yoy(db)
            if net_purchases_yoy is None:
                net_purchases_yoy = _calc_yoy_change(
                    _sum_gold_tonnes(db, latest_cb_date),
                    _sum_gold_tonnes(db, prior_cb_date)
                )
            em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
            em_accumulation_momentum = None
            em_purchases = db.query(CBPurchase).filter(
                CBPurchase.country.in_(em_countries),
                CBPurchase.period >= str(datetime.utcnow().year - 1)
            ).all()
            if em_purchases:
                em_accumulation_momentum = (
                    sum([p.tonnes_net_yoy_pct for p in em_purchases]) / len(em_purchases)
                )
            if em_accumulation_momentum is None and latest_cb_date and prior_cb_date:
                em_accumulation_momentum = _calc_yoy_change(
                    _sum_gold_tonnes(db, latest_cb_date, em_countries),
                    _sum_gold_tonnes(db, prior_cb_date, em_countries)
                )

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
                    "au_dxy_ratio_zscore": au_dxy.zscore_2y if au_dxy else None,
                    "ag_dxy_ratio_zscore": ag_dxy.zscore_2y if ag_dxy else None,
                    "real_rate_signal": real_rate_signal,
                    "monetary_hedge_strength": mhs
                },
                "relative_value": {
                    "au_ag_ratio": au_ag.ratio_value if au_ag else None,
                    "au_ag_ratio_zscore": au_ag.zscore_2y if au_ag else None,
                    "pt_au_ratio": pt_au.ratio_value if pt_au else None,
                    "pt_au_ratio_zscore": pt_au.zscore_2y if pt_au else None,
                    "pd_au_ratio": pd_au.ratio_value if pd_au else None,
                    "pd_au_ratio_zscore": pd_au.zscore_2y if pd_au else None
                },
                "physical_paper": {
                    "paper_credibility_index": pci,
                    "oi_registered_ratio": comex.oi_to_registered_ratio if comex else None,
                    "comex_registered_inventory_change_yoy": comex_change if comex else None,
                    "backwardation_severity": back_severity if backwardation else None,
                    "etf_flow_divergence": etf_divergence if latest_etf else None
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
            ).order_by(desc(CBHolding.gold_tonnes)).limit(20).all()
            
            # Get YoY change
            result = []
            for holding in holdings:
                prior_year = db.query(CBHolding).filter(
                    CBHolding.country == holding.country,
                    CBHolding.date < holding.date - timedelta(days=365)
                ).order_by(desc(CBHolding.date)).first()
                
                yoy_pct = None
                if prior_year and prior_year.gold_tonnes:
                    yoy_pct = (holding.gold_tonnes - prior_year.gold_tonnes) / prior_year.gold_tonnes * 100
                
                result.append({
                    "country": holding.country,
                    "gold_tonnes": holding.gold_tonnes,
                    "pct_of_reserves": holding.pct_of_reserves,
                    "net_purchase_qty": None,
                    "net_purchase_yoy_pct": yoy_pct
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


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
    Return current spot prices; market caps require ingested above-ground stock data.
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
            
            # Calculate market caps
            market_caps = {}
            total_value = 0
            for metal in ['AU', 'AG', 'PT', 'PD']:
                if metal in prices:
                    value = None
                    market_caps[metal] = {
                        "metal": metal,
                        "price_usd_per_oz": prices[metal],
                        "stock_oz": None,
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
def get_metal_price_history(metal: str, days: int = 365):
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
async def get_market_caps_history():
    """
    Calculate Metals/M2 ratio history using ingested prices and macro data.
    """
    with get_db_session() as db:
        gold_prices = db.query(MetalPrice).filter(
            MetalPrice.metal == 'AU',
            MetalPrice.price_usd_per_oz.isnot(None)
        ).order_by(MetalPrice.date).all()
        macro = db.query(MacroLiquidityData).filter(
            MacroLiquidityData.global_m2.isnot(None)
        ).order_by(MacroLiquidityData.date).all()

        price_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices}
        m2_map = {m.date.date(): m.global_m2 for m in macro}
        overlap_dates = sorted(set(price_map.keys()) & set(m2_map.keys()))

        history = []
        for date in overlap_dates:
            history.append({
                'date': date.isoformat(),
                'gold_price': price_map[date],
                'global_m2_trillions': m2_map[date],
                'metals_to_m2_pct': None
            })

        return {
            'history': history,
            'notes': {
                'metals_to_m2_pct': 'Requires ingested above-ground stock data to compute.'
            }
        }

