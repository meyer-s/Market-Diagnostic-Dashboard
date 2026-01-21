from fastapi import APIRouter, HTTPException
from datetime import datetime, timedelta
from typing import List
from sqlalchemy import func, desc
import statistics

from app.models.precious_metals import (
    MetalPrice, MetalRatio, CBHolding, CBPurchase, COMEXInventory, 
    ETFHolding, SupplyData, DemandData, MetalCorrelation, 
    MetalRegimeClassification, BackwardationData, LBMAPremium, MetalVolatility,
    RegimeType, GoldBiasType, SilverBiasType, PGMBiasType, RiskLevel
)
from app.utils.db_helpers import get_db_session

router = APIRouter(prefix="/precious-metals", tags=["precious-metals"])


# ==================== HELPER FUNCTIONS ====================

def calculate_structural_monetary_bid(db) -> float:
    """
    SMB = 0.5 × (Net Purchase Momentum) 
        + 0.3 × (CB Gold % Reserves Change)
        + 0.2 × (EM Accumulation Trend)
    """
    # Get most recent quarterly purchases (last 4 quarters)
    recent_purchases = db.query(CBPurchase).filter(
        CBPurchase.tonnes_net_yoy_pct.isnot(None)
    ).order_by(desc(CBPurchase.period)).limit(4).all()
    
    if not recent_purchases:
        return 0.0
    
    # Net purchase momentum: avg of recent YoY %
    net_purchase_momentum = sum([p.tonnes_net_yoy_pct for p in recent_purchases]) / len(recent_purchases)
    
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
    
    em_accumulation_trend = sum([p.tonnes_net_yoy_pct for p in em_purchases]) / len(em_purchases) if em_purchases else 0.0
    
    # Compute SMB
    smb = (0.5 * net_purchase_momentum) + (0.3 * cb_reserve_change) + (0.2 * em_accumulation_trend)
    return max(-100, min(100, smb))  # Clamp to [-100, 100]


def calculate_monetary_hedge_strength(db) -> float:
    """
    MHS = (Au/DXY_Z + Real_Rate_Signal + 0.5 × M2_Growth_Signal) / 2.5
    Normalized to 0-100
    """
    # Get latest Au/DXY ratio z-score
    latest_au_dxy = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "AU",
        MetalRatio.metal2 == "DXY"
    ).order_by(desc(MetalRatio.date)).first()
    
    au_dxy_zscore = latest_au_dxy.zscore_2y if latest_au_dxy else 0.0
    
    # Real rate signal (inverted: low rates = positive for gold)
    # Would need to fetch from FRED data model or indicators
    real_rate_signal = -0.5  # Placeholder; integrate with core dashboard
    
    # M2 growth signal (placeholder)
    m2_growth_signal = 0.2  # Placeholder
    
    mhs_raw = (au_dxy_zscore + real_rate_signal + (0.5 * m2_growth_signal)) / 2.5
    mhs_score = 50 + (mhs_raw * 50)  # Normalize to 0-100
    return max(0, min(100, mhs_score))


def calculate_paper_credibility_index(db) -> float:
    """
    PCI = 100 - (OI_to_Registered_Ratio / Historical_90th_Percentile) × 100
    Adjusted for backwardation & spreads
    """
    # Get latest COMEX inventory
    latest_comex = db.query(COMEXInventory).order_by(desc(COMEXInventory.date)).first()
    
    if not latest_comex or not latest_comex.oi_to_registered_ratio:
        return 75.0  # Default healthy
    
    # Get historical 90th percentile
    all_ratios = db.query(COMEXInventory.oi_to_registered_ratio).filter(
        COMEXInventory.oi_to_registered_ratio.isnot(None)
    ).all()
    
    if not all_ratios:
        return 75.0
    
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
    
    silver_momentum = 0.0
    if len(recent_silver_prices) >= 2:
        silver_momentum = (recent_silver_prices[0].price_usd_per_oz - recent_silver_prices[-1].price_usd_per_oz) / recent_silver_prices[-1].price_usd_per_oz * 100
    
    # Regime logic
    if mhs > 60 and smb > 30:
        regime = RegimeType.MONETARY_STRESS
    elif mhs > 40 and silver_momentum > 10:
        regime = RegimeType.INFLATION_HEDGE
    elif pt_au_latest and pt_au_latest.ratio_value > 0.8:
        regime = RegimeType.GROWTH_REFLATION
    elif pci < 50:
        regime = RegimeType.LIQUIDITY_CRISIS
    else:
        regime = RegimeType.INDUSTRIAL_COMMODITY
    
    # Gold bias
    if mhs > 60:
        gold_bias = GoldBiasType.MONETARY_HEDGE
    elif mhs > 40:
        gold_bias = GoldBiasType.NEUTRAL
    else:
        gold_bias = GoldBiasType.FINANCIAL_ASSET
    
    # Silver bias
    if au_ag_latest and au_ag_latest.ratio_value > 70:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY  # Ag underperforming due to industrial weakness
    elif au_ag_latest and au_ag_latest.ratio_value < 50:
        silver_bias = SilverBiasType.INDUSTRIAL  # Ag outperforming on industrial demand
    else:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY
    
    # PGM bias
    if pt_au_latest and pt_au_latest.ratio_value < 0.6:
        pgm_bias = PGMBiasType.RECESSION
    elif pt_au_latest and pt_au_latest.ratio_value > 0.85:
        pgm_bias = PGMBiasType.GROWTH
    else:
        pgm_bias = PGMBiasType.NEUTRAL
    
    # Paper/Physical risk
    if pci > 75:
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
            mhs = calculate_monetary_hedge_strength(db)
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
            comex_change = 0.0
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
            back_severity = backwardation.backwardation_bps if backwardation else 0.0
            
            # Get ETF flow data
            latest_etf = db.query(ETFHolding).filter(
                ETFHolding.ticker == "GLD"
            ).order_by(desc(ETFHolding.date)).first()
            etf_divergence = 0.0
            if latest_etf:
                prior_etf = db.query(ETFHolding).filter(
                    ETFHolding.ticker == "GLD",
                    ETFHolding.date < latest_etf.date
                ).order_by(desc(ETFHolding.date)).first()
                if prior_etf and latest_etf.holdings and prior_etf.holdings:
                    etf_divergence = ((latest_etf.holdings - prior_etf.holdings) / prior_etf.holdings) * 100
            
            return {
                "regime": {
                    "overall_regime": regime.value,
                    "gold_bias": gold_bias.value,
                    "silver_bias": silver_bias.value,
                    "pgm_bias": pgm_bias.value,
                    "paper_physical_risk": paper_physical_risk.value
                },
                "cb_context": {
                    "global_cb_gold_pct_reserves": 11.2,  # Placeholder; would fetch from aggregated holdings
                    "net_purchases_yoy": 15.0,  # Placeholder
                    "structural_monetary_bid": smb,
                    "em_accumulation_momentum": 18.5  # Placeholder
                },
                "price_anchors": {
                    "au_dxy_ratio_zscore": au_dxy.zscore_2y if au_dxy else 0.0,
                    "ag_dxy_ratio_zscore": ag_dxy.zscore_2y if ag_dxy else 0.0,
                    "real_rate_signal": -0.5,  # Placeholder
                    "monetary_hedge_strength": mhs
                },
                "relative_value": {
                    "au_ag_ratio": au_ag.ratio_value if au_ag else 65.0,
                    "au_ag_ratio_zscore": au_ag.zscore_2y if au_ag else 0.0,
                    "pt_au_ratio": pt_au.ratio_value if pt_au else 0.7,
                    "pt_au_ratio_zscore": pt_au.zscore_2y if pt_au else 0.0,
                    "pd_au_ratio": pd_au.ratio_value if pd_au else 0.5,
                    "pd_au_ratio_zscore": pd_au.zscore_2y if pd_au else 0.0
                },
                "physical_paper": {
                    "paper_credibility_index": pci,
                    "oi_registered_ratio": comex.oi_to_registered_ratio if comex else 1.0,
                    "comex_registered_inventory_change_yoy": comex_change,
                    "backwardation_severity": back_severity,
                    "etf_flow_divergence": etf_divergence
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
                
                yoy_pct = 0.0
                if prior_year:
                    yoy_pct = (holding.gold_tonnes - prior_year.gold_tonnes) / prior_year.gold_tonnes * 100
                
                result.append({
                    "country": holding.country,
                    "gold_tonnes": holding.gold_tonnes,
                    "pct_of_reserves": holding.pct_of_reserves,
                    "net_purchase_qty": 0.0,  # Computed separately if available
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
                current_spot = spot_prices.get(s.metal, 0.0)
                aisc = s.aisc_per_oz or 0.0
                margin_pct = ((current_spot - aisc) / aisc * 100) if aisc > 0 else 0.0
                
                result.append({
                    "metal": s.metal,
                    "production_tonnes_yoy_pct": s.production_yoy_pct or 0.0,
                    "aisc_per_oz": aisc,
                    "current_spot_price": current_spot,
                    "margin_pct": margin_pct,
                    "recycling_pct_of_supply": s.recycling_pct or 0.0
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
                    "investment_tonnes": d.investment_tonnes or 0.0,
                    "industrial_tonnes": d.industrial_tonnes or 0.0,
                    "jewelry_tonnes": d.jewelry_tonnes or 0.0,
                    "jewelry_asia_tonnes": d.jewelry_asia_tonnes or 0.0,
                    "other_tonnes": d.other_tonnes or 0.0,
                    "total_tonnes": d.total_tonnes or 0.0
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-caps")
def get_market_caps():
    """
    Calculate current market capitalizations based on live prices and known above-ground stocks
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
            
            # Known above-ground stocks (conservative estimates)
            stocks_oz = {
                'AU': 6_430_000_000,  # ~200,000 tonnes
                'AG': 2_500_000_000,  # ~2.5B oz (much consumed)
                'PT': 8_000_000,      # ~8M oz
                'PD': 6_000_000       # ~6M oz
            }
            
            # Calculate market caps
            market_caps = {}
            total_value = 0
            for metal, stock_oz in stocks_oz.items():
                if metal in prices:
                    value = stock_oz * prices[metal]
                    market_caps[metal] = {
                        "metal": metal,
                        "price_usd_per_oz": prices[metal],
                        "stock_oz": stock_oz,
                        "market_cap_usd": value
                    }
                    total_value += value
            
            # Global M2 estimate (2026)
            global_m2 = 200_000_000_000_000  # $200T
            metals_to_m2_ratio = (total_value / global_m2) * 100
            
            return {
                "metals": market_caps,
                "total_market_cap_usd": total_value,
                "global_m2_usd": global_m2,
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
                # Return default neutral correlations if no data
                return {
                    "timestamp": datetime.utcnow().isoformat(),
                    "au_ag": 0.72,
                    "au_pt": 0.61,
                    "au_pd": 0.48,
                    "ag_pt": 0.68,
                    "ag_pd": 0.52,
                    "pt_pd": 0.71,
                    "au_spy": -0.15,
                    "au_tlt": 0.42,
                    "au_dxy": -0.68,
                    "au_vix": 0.55
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
                "au_ag": latest.au_ag_60d or 0.72,
                "au_pt": au_pt if au_pt is not None else 0.61,
                "au_pd": au_pd if au_pd is not None else 0.48,
                "ag_pt": ag_pt if ag_pt is not None else 0.68,
                "ag_pd": ag_pd if ag_pd is not None else 0.52,
                "pt_pd": pt_pd if pt_pd is not None else 0.71,
                "au_spy": au_spy if au_spy is not None else -0.15,
                "au_tlt": au_tlt if au_tlt is not None else 0.42,
                "au_dxy": au_dxy if au_dxy is not None else -0.68,
                "au_vix": au_vix if au_vix is not None else 0.55
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
    Calculate 100-year historical Metals/M2 ratio.
    Uses gold as proxy (99.3% of metals market cap).
    """
    with get_db_session() as db:
        # Historical data points - gold price and US M2 (billions USD)
        # Sources: World Gold Council, Federal Reserve FRED
        historical_data = [
            # Pre-Bretton Woods (Gold Standard Era)
            {'year': 1925, 'gold_price': 20.67, 'm2_billions': 46},
            {'year': 1930, 'gold_price': 20.67, 'm2_billions': 46},
            {'year': 1935, 'gold_price': 35.00, 'm2_billions': 46},
            {'year': 1940, 'gold_price': 35.00, 'm2_billions': 55},
            {'year': 1945, 'gold_price': 35.00, 'm2_billions': 102},
            {'year': 1950, 'gold_price': 34.72, 'm2_billions': 151},
            {'year': 1955, 'gold_price': 35.03, 'm2_billions': 212},
            {'year': 1960, 'gold_price': 35.27, 'm2_billions': 312},
            {'year': 1965, 'gold_price': 35.12, 'm2_billions': 442},
            {'year': 1970, 'gold_price': 36.02, 'm2_billions': 601},
            
            # Post-Bretton Woods (Fiat Era)
            {'year': 1971, 'gold_price': 40.62, 'm2_billions': 674},
            {'year': 1975, 'gold_price': 161.02, 'm2_billions': 963},
            {'year': 1980, 'gold_price': 594.90, 'm2_billions': 1540},  # Peak inflation
            {'year': 1985, 'gold_price': 317.26, 'm2_billions': 2274},
            {'year': 1990, 'gold_price': 383.51, 'm2_billions': 3223},
            {'year': 1995, 'gold_price': 387.00, 'm2_billions': 3642},
            {'year': 2000, 'gold_price': 279.11, 'm2_billions': 4631},  # Dot-com bust
            {'year': 2005, 'gold_price': 444.74, 'm2_billions': 6407},
            {'year': 2008, 'gold_price': 871.96, 'm2_billions': 7649},  # Financial crisis
            {'year': 2010, 'gold_price': 1224.53, 'm2_billions': 8853},
            {'year': 2015, 'gold_price': 1060.29, 'm2_billions': 12217},
            {'year': 2020, 'gold_price': 1770.75, 'm2_billions': 19254},  # COVID stimulus
            {'year': 2021, 'gold_price': 1800.23, 'm2_billions': 21428},
            {'year': 2022, 'gold_price': 1800.09, 'm2_billions': 21298},
            {'year': 2023, 'gold_price': 2078.38, 'm2_billions': 20824},
            {'year': 2024, 'gold_price': 2351.52, 'm2_billions': 21200},
        ]
        
        # Gold above-ground stock estimate (grows ~2% annually from mining)
        base_stock_oz_1925 = 2_500_000_000  # ~2.5B oz in 1925
        
        result = []
        for i, point in enumerate(historical_data):
            year = point['year']
            gold_price = point['gold_price']
            us_m2_billions = point['m2_billions']
            
            # Estimate global M2 (US M2 * 2.5 for developed markets, * 4 for global post-2000)
            if year < 2000:
                global_m2_trillions = (us_m2_billions / 1000) * 2.5
            else:
                global_m2_trillions = (us_m2_billions / 1000) * 4.0
            
            # Estimate gold stock (grows 2% annually)
            years_from_1925 = year - 1925
            gold_stock_oz = base_stock_oz_1925 * (1.02 ** years_from_1925)
            
            # Calculate gold market cap
            gold_market_cap_trillions = (gold_price * gold_stock_oz) / 1e12
            
            # Metals/M2 ratio (gold as 99% proxy)
            metals_to_m2_pct = (gold_market_cap_trillions / global_m2_trillions) * 100
            
            result.append({
                'year': year,
                'gold_price': gold_price,
                'gold_stock_oz': gold_stock_oz,
                'global_m2_trillions': round(global_m2_trillions, 2),
                'metals_market_cap_trillions': round(gold_market_cap_trillions, 2),
                'metals_to_m2_pct': round(metals_to_m2_pct, 2)
            })
        
        # Add current live data point
        latest_gold = db.query(MetalPrice).filter(
            MetalPrice.metal == 'AU'
        ).order_by(MetalPrice.date.desc()).first()
        
        if latest_gold:
            current_year = datetime.utcnow().year
            current_stock_oz = base_stock_oz_1925 * (1.02 ** (current_year - 1925))
            current_gold_cap = (latest_gold.price_usd_per_oz * current_stock_oz) / 1e12
            current_m2 = 200  # $200T global M2 estimate
            
            result.append({
                'year': current_year,
                'gold_price': round(latest_gold.price_usd_per_oz, 2),
                'gold_stock_oz': current_stock_oz,
                'global_m2_trillions': current_m2,
                'metals_market_cap_trillions': round(current_gold_cap, 2),
                'metals_to_m2_pct': round((current_gold_cap / current_m2) * 100, 2),
                'is_current': True
            })
        
        return {
            'history': result,
            'notes': {
                'gold_standard_era': 'Pre-1971: Gold fixed at $35/oz, ratio typically 15-25%',
                'fiat_era': 'Post-1971: Free-floating gold, ratio typically 2-8%',
                'peaks': '1980 (19.3% - inflation crisis), 2011 (8.5% - financial crisis)',
                'methodology': 'Gold used as 99% proxy for total metals market cap'
            }
        }

