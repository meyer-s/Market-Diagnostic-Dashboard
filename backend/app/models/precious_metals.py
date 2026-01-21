from sqlalchemy import Column, Integer, String, Float, DateTime, Enum
from datetime import datetime
from app.core.db import Base
import enum

# ==================== ENUMS ====================

class RegimeType(str, enum.Enum):
    MONETARY_STRESS = "MONETARY_STRESS"
    INFLATION_HEDGE = "INFLATION_HEDGE"
    GROWTH_REFLATION = "GROWTH_REFLATION"
    LIQUIDITY_CRISIS = "LIQUIDITY_CRISIS"
    INDUSTRIAL_COMMODITY = "INDUSTRIAL_COMMODITY"


class GoldBiasType(str, enum.Enum):
    MONETARY_HEDGE = "MONETARY_HEDGE"
    NEUTRAL = "NEUTRAL"
    FINANCIAL_ASSET = "FINANCIAL_ASSET"


class SilverBiasType(str, enum.Enum):
    INDUSTRIAL_MONETARY = "INDUSTRIAL_MONETARY"
    INDUSTRIAL = "INDUSTRIAL"
    MONETARY = "MONETARY"


class PGMBiasType(str, enum.Enum):
    GROWTH = "GROWTH"
    NEUTRAL = "NEUTRAL"
    RECESSION = "RECESSION"


class RiskLevel(str, enum.Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"


# ==================== MODELS ====================

class MetalPrice(Base):
    """Daily precious metals spot prices"""
    __tablename__ = "metal_price"

    id = Column(Integer, primary_key=True, index=True)
    metal = Column(String, index=True)  # AU, AG, PT, PD
    date = Column(DateTime, index=True)
    price_usd_per_oz = Column(Float)
    volume = Column(Float, nullable=True)
    source = Column(String)  # FRED, YAHOO, etc
    created_at = Column(DateTime, default=datetime.utcnow)


class MetalRatio(Base):
    """Computed metal ratios and z-scores"""
    __tablename__ = "metal_ratio"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    metal1 = Column(String)  # e.g., "AU"
    metal2 = Column(String)  # e.g., "AG"
    ratio_value = Column(Float)
    zscore_2y = Column(Float)
    zscore_5y = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CBHolding(Base):
    """Central Bank gold holdings and purchases"""
    __tablename__ = "cb_holding"

    id = Column(Integer, primary_key=True, index=True)
    country = Column(String, index=True)
    country_iso = Column(String, nullable=True)
    date = Column(DateTime, index=True)
    gold_tonnes = Column(Float)
    pct_of_reserves = Column(Float)
    source = Column(String)  # IMF, WGC, etc
    created_at = Column(DateTime, default=datetime.utcnow)


class CBPurchase(Base):
    """Quarterly/Annual central bank net purchases"""
    __tablename__ = "cb_purchase"

    id = Column(Integer, primary_key=True, index=True)
    country = Column(String, index=True)
    period = Column(String)  # YYYY-Q1, YYYY-Q2, etc
    tonnes_net = Column(Float)
    tonnes_net_yoy_pct = Column(Float, nullable=True)
    source = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class COMEXInventory(Base):
    """COMEX registered and eligible inventory"""
    __tablename__ = "comex_inventory"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    metal = Column(String)  # AU, AG
    registered_oz = Column(Float)
    eligible_oz = Column(Float)
    total_oz = Column(Float)
    open_interest = Column(Float, nullable=True)
    oi_to_registered_ratio = Column(Float, nullable=True)
    source = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class ETFHolding(Base):
    """ETF holdings and flows"""
    __tablename__ = "etf_holding"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    ticker = Column(String)  # GLD, SLV, PPLT, PALL
    holdings = Column(Float)  # In grams for gold, oz for others
    daily_flow = Column(Float, nullable=True)
    daily_flow_pct = Column(Float, nullable=True)
    source = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class SupplyData(Base):
    """Mine production, AISC, recycling"""
    __tablename__ = "supply_data"

    id = Column(Integer, primary_key=True, index=True)
    metal = Column(String)  # AU, AG, PT, PD
    period = Column(String)  # YYYY-Q1 or YYYY format
    production_tonnes = Column(Float)
    production_yoy_pct = Column(Float, nullable=True)
    aisc_per_oz = Column(Float, nullable=True)
    recycling_tonnes = Column(Float, nullable=True)
    recycling_pct = Column(Float, nullable=True)
    source = Column(String)  # USGS, WGC, etc
    created_at = Column(DateTime, default=datetime.utcnow)


class DemandData(Base):
    """Demand decomposition by category"""
    __tablename__ = "demand_data"

    id = Column(Integer, primary_key=True, index=True)
    metal = Column(String)
    period = Column(String)  # YYYY-Q1 format
    investment_tonnes = Column(Float, nullable=True)
    industrial_tonnes = Column(Float, nullable=True)
    jewelry_tonnes = Column(Float, nullable=True)
    jewelry_asia_tonnes = Column(Float, nullable=True)  # Separate tracking for jewelry
    other_tonnes = Column(Float, nullable=True)
    total_tonnes = Column(Float)
    source = Column(String)  # WGC, Silver Institute, etc
    created_at = Column(DateTime, default=datetime.utcnow)


class MetalCorrelation(Base):
    """Rolling correlation matrix"""
    __tablename__ = "metal_correlation"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    au_ag_30d = Column(Float, nullable=True)
    au_ag_60d = Column(Float, nullable=True)
    au_pt_30d = Column(Float, nullable=True)
    au_pt_60d = Column(Float, nullable=True)
    au_pd_30d = Column(Float, nullable=True)
    au_pd_60d = Column(Float, nullable=True)
    ag_pt_30d = Column(Float, nullable=True)
    ag_pt_60d = Column(Float, nullable=True)
    ag_pd_30d = Column(Float, nullable=True)
    ag_pd_60d = Column(Float, nullable=True)
    pt_pd_30d = Column(Float, nullable=True)
    pt_pd_60d = Column(Float, nullable=True)
    au_spy_30d = Column(Float, nullable=True)
    au_spy_60d = Column(Float, nullable=True)
    au_tlt_30d = Column(Float, nullable=True)
    au_tlt_60d = Column(Float, nullable=True)
    au_dxy_30d = Column(Float, nullable=True)
    au_dxy_60d = Column(Float, nullable=True)
    au_vix_30d = Column(Float, nullable=True)
    au_vix_60d = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class MetalRegimeClassification(Base):
    """Computed regime classification"""
    __tablename__ = "metal_regime_classification"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    overall_regime = Column(Enum(RegimeType))
    gold_bias = Column(Enum(GoldBiasType))
    silver_bias = Column(Enum(SilverBiasType))
    pgm_bias = Column(Enum(PGMBiasType))
    paper_physical_risk = Column(Enum(RiskLevel))
    confidence_score = Column(Float)  # 0-100, how confident is the classification
    structural_monetary_bid = Column(Float)
    monetary_hedge_strength = Column(Float)
    paper_credibility_index = Column(Float)
    industrial_demand_proxy = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)


class BackwardationData(Base):
    """Futures curve: backwardation/contango"""
    __tablename__ = "backwardation_data"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    metal = Column(String)
    front_month_price = Column(Float)
    six_month_price = Column(Float)
    backwardation_bps = Column(Float)  # Negative = contango, positive = backwardation
    source = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class LBMAPremium(Base):
    """LBMA premiums (bid-ask spreads)"""
    __tablename__ = "lbma_premium"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    metal = Column(String)
    premium_usd_per_oz = Column(Float)
    bid_ask_spread_bps = Column(Float)
    source = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class MetalVolatility(Base):
    """Historical volatility by metal"""
    __tablename__ = "metal_volatility"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    metal = Column(String)
    volatility_30d = Column(Float)
    volatility_60d = Column(Float)
    volatility_252d = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
