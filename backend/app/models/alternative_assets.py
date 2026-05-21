"""Alternative Asset Stability (AAS) Indicator Models

Tracks systemic stability vs. pressure toward alternative assets (precious metals + crypto)
as a regime and trust diagnostic.

Higher stability score = more confidence in traditional system
Lower stability score = less stability, greater alternative asset adoption
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, Index
from sqlalchemy.ext.declarative import declarative_base
from app.core.db import Base
from datetime import datetime


class CryptoPrice(Base):
    """Daily crypto asset prices for AAS calculation"""
    __tablename__ = "crypto_prices"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    
    # Major crypto assets
    btc_usd = Column(Float)
    eth_usd = Column(Float)
    sol_usd = Column(Float)
    xrp_usd = Column(Float)
    total_crypto_mcap = Column(Float)  # Total crypto market cap in billions
    btc_dominance = Column(Float)  # BTC % of total crypto mcap
    
    # Ratio signals
    btc_gold_ratio = Column(Float)  # BTC price / Gold price
    
    # Volume and liquidity
    btc_volume_24h = Column(Float)
    
    source = Column(String, default="API")
    created_at = Column(DateTime, default=datetime.utcnow)


class BitcoinNetworkMetric(Base):
    """Daily Bitcoin network metrics for AAS calculation"""
    __tablename__ = "bitcoin_network_metric"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    hash_rate = Column(Float)  # Hashes per second (or EH/s depending on source)
    difficulty = Column(Float)
    source = Column(String, default="API")
    created_at = Column(DateTime, default=datetime.utcnow)


class CryptoEcosystemMetric(Base):
    """Daily crypto ecosystem metrics for AAS calculation"""
    __tablename__ = "crypto_ecosystem_metric"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    stablecoin_supply_usd = Column(Float)  # Total stablecoin market cap
    stablecoin_btc_ratio = Column(Float)
    defi_tvl_usd = Column(Float)
    exchange_net_outflow_btc = Column(Float)
    exchange_net_outflow_usd = Column(Float)
    btc_spy_corr_30d = Column(Float)
    source = Column(String, default="API")
    created_at = Column(DateTime, default=datetime.utcnow)


class EquityPrice(Base):
    """Daily equity prices for AAS correlation calculations"""
    __tablename__ = "equity_price"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    date = Column(DateTime, nullable=False, index=True)
    close = Column(Float)
    source = Column(String, default="YAHOO")
    created_at = Column(DateTime, default=datetime.utcnow)


class MacroLiquidityData(Base):
    """Global liquidity proxies for crypto correlation analysis"""
    __tablename__ = "macro_liquidity_data"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    
    # Central bank balance sheets (billions USD)
    fed_balance_sheet = Column(Float)
    ecb_balance_sheet = Column(Float)
    pboc_balance_sheet = Column(Float)
    boj_balance_sheet = Column(Float)
    
    # Global aggregates
    global_m2 = Column(Float)  # Estimated global M2 in trillions
    global_liquidity_index = Column(Float)  # Composite index
    
    # Policy regime signals
    fed_rate = Column(Float)
    real_rate_10y = Column(Float)  # 10Y yield - inflation
    
    source = Column(String, default="API")
    created_at = Column(DateTime, default=datetime.utcnow)


class AASComponent(Base):
    """Individual component calculations for AAS indicator"""
    __tablename__ = "aap_components"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    
    # Metals subsystem (50% total weight)
    # A. Monetary Metals Strength (20%)
    gold_usd_zscore = Column(Float)  # 3.5% weight
    gold_real_rate_divergence = Column(Float)  # 4.0% weight
    cb_gold_momentum = Column(Float)  # 2.5% weight
    silver_usd_zscore = Column(Float)  # 2.0% weight
    
    # B. Metals Ratio Signals (15%)
    gold_silver_ratio_signal = Column(Float)  # 6.0% weight
    platinum_gold_ratio = Column(Float)  # 5.0% weight
    palladium_gold_ratio = Column(Float)  # 4.0% weight
    
    # C. Physical vs Paper Stress (15%)
    comex_stress_ratio = Column(Float)  # 6.0% weight
    backwardation_signal = Column(Float)  # 5.0% weight
    etf_flow_divergence = Column(Float)  # 4.0% weight
    
    # Crypto subsystem (50% total weight)
    # A. Bitcoin as Monetary Barometer (20%)
    btc_usd_zscore = Column(Float)  # 7.0% weight
    btc_gold_zscore = Column(Float)  # 7.0% weight
    btc_real_rate_break = Column(Float)  # 6.0% weight
    
    # B. Crypto Market Structure (15%)
    crypto_m2_ratio = Column(Float)  # 7.0% weight
    btc_dominance_momentum = Column(Float)  # 5.0% weight
    altcoin_btc_signal = Column(Float)  # 3.0% weight
    
    # C. Crypto vs Liquidity (15%)
    crypto_vs_fed_bs = Column(Float)  # 8.0% weight
    crypto_qt_resilience = Column(Float)  # 7.0% weight
    
    # Aggregated subsystem scores
    metals_stability_score = Column(Float)  # 0-1 scale (inverted from pressure)
    crypto_stability_score = Column(Float)  # 0-1 scale (inverted from pressure)
    
    # Cross-asset confirmation
    cross_asset_multiplier = Column(Float)  # 0.6-1.4 range
    correlation_regime = Column(String)  # "coordinated", "divergent", "crypto_led", "metals_led"
    
    created_at = Column(DateTime, default=datetime.utcnow)


class AASComponentV2(Base):
    """V2 component calculations aligned to 9+9 AAS specification"""
    __tablename__ = "aap_component_v2"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)

    # Metals (9)
    gold_dxy_ratio = Column(Float)
    gold_real_rate_divergence = Column(Float)
    silver_outperformance = Column(Float)
    pgm_weakness = Column(Float)
    cb_gold_accumulation = Column(Float)
    comex_registered_inventory = Column(Float)
    oi_to_registered_ratio = Column(Float)
    gold_etf_flows = Column(Float)
    mining_stock_divergence = Column(Float)

    # Crypto (9)
    btc_dominance = Column(Float)
    btc_hash_rate = Column(Float)
    btc_difficulty = Column(Float)
    stablecoin_supply = Column(Float)
    stablecoin_btc_ratio = Column(Float)
    defi_tvl = Column(Float)
    exchange_outflows = Column(Float)
    btc_spy_correlation = Column(Float)
    altcoin_weakness = Column(Float)

    # Aggregated subsystem scores
    metals_pressure_score = Column(Float)
    crypto_pressure_score = Column(Float)

    # Cross-asset confirmation
    cross_asset_multiplier = Column(Float)
    correlation_regime = Column(String)

    created_at = Column(DateTime, default=datetime.utcnow)


class AASIndicator(Base):
    """Final Alternative Asset Stability indicator values and regime classification"""
    __tablename__ = "aap_indicator"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, unique=True, index=True)
    
    # Core output (INVARIANT: 0 = min stability, 100 = max stability)
    stability_score = Column(Float, nullable=False)  # 0-100 scale
    pressure_index = Column(Float, nullable=False)  # 0-1 scale (internal use only, inverted)
    
    # Component contributions
    metals_contribution = Column(Float)  # Weighted metals instability
    crypto_contribution = Column(Float)  # Weighted crypto instability
    
    # Regime classification
    regime = Column(String, nullable=False)  # "normal_confidence", "mild_caution", etc.
    regime_confidence = Column(Float)  # 0-1, confidence in regime classification
    regime_days_persistent = Column(Integer, default=1)  # Days in current regime
    
    # Interpretive signals
    primary_driver = Column(String)  # "metals", "crypto", "coordinated", "neither"
    stress_type = Column(String)  # "monetary", "liquidity", "speculative", "systemic"
    
    # Contextual modifiers
    vix_level = Column(Float)  # VIX at calculation time
    liquidity_regime = Column(String)  # "QE", "QT", "neutral"
    fed_pivot_signal = Column(Float)  # -1 to 1, policy change momentum
    
    # Rolling statistics
    score_1d_change = Column(Float)
    score_5d_change = Column(Float)
    score_20d_avg = Column(Float)
    score_90d_avg = Column(Float)
    
    # Alert flags
    is_critical = Column(Integer, default=0)  # Score < 30
    is_transitioning = Column(Integer, default=0)  # Regime change in progress
    circuit_breaker_active = Column(Integer, default=0)  # High volatility mode
    
    # Data quality
    data_completeness = Column(Float)  # 0-1, % of components available
    calculation_notes = Column(String)  # Any warnings or data issues
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AASRegimeHistory(Base):
    """Historical regime transitions for pattern analysis"""
    __tablename__ = "aap_regime_history"
    
    id = Column(Integer, primary_key=True, index=True)
    
    regime_start = Column(DateTime, nullable=False, index=True)
    regime_end = Column(DateTime)  # NULL if current regime
    regime_name = Column(String, nullable=False)
    
    duration_days = Column(Integer)
    avg_stability_score = Column(Float)
    min_stability_score = Column(Float)
    max_stability_score = Column(Float)
    
    primary_drivers = Column(String)  # JSON array of drivers during regime
    market_outcome = Column(String)  # What happened next (for backtesting)
    
    created_at = Column(DateTime, default=datetime.utcnow)
