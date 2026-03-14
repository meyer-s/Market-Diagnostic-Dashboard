"""
Alternative Asset Pressure (AAP) Calculator Service

Implements the AAP indicator calculation logic with regime classification.
This is a slow-moving structural indicator, not a day-trading signal.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
import numpy as np
import logging

from app.models.alternative_assets import (
    CryptoPrice,
    MacroLiquidityData,
    BitcoinNetworkMetric,
    CryptoEcosystemMetric,
    EquityPrice,
    AAPComponentV2,
    AAPIndicator,
    AAPRegimeHistory
)
from app.models.precious_metals import MetalPrice, MetalRatio, COMEXInventory, CBHolding, ETFHolding

logger = logging.getLogger(__name__)
COMEX_PLACEHOLDER_SOURCES = ["SEED", "ESTIMATED_FROM_PRICES"]


class AAPCalculator:
    """
    Calculates the Alternative Asset Stability indicator.
    
    INVARIANT: Higher stability score = more systemic stability
               0 = minimum stability (max pressure), 100 = maximum stability
    """
    
    # Component weights (equal weighting within subsystem)
    EQUAL_WEIGHT = 1.0 / 18.0
    WEIGHTS = {
        # Metals subsystem (9)
        'gold_dxy_ratio': EQUAL_WEIGHT,
        'gold_real_rate_divergence': EQUAL_WEIGHT,
        'silver_outperformance': EQUAL_WEIGHT,
        'pgm_weakness': EQUAL_WEIGHT,
        'cb_gold_accumulation': EQUAL_WEIGHT,
        'comex_registered_inventory': EQUAL_WEIGHT,
        'oi_to_registered_ratio': EQUAL_WEIGHT,
        'gold_etf_flows': EQUAL_WEIGHT,
        'mining_stock_divergence': EQUAL_WEIGHT,

        # Crypto subsystem (9)
        'btc_dominance': EQUAL_WEIGHT,
        'btc_hash_rate': EQUAL_WEIGHT,
        'btc_difficulty': EQUAL_WEIGHT,
        'stablecoin_supply': EQUAL_WEIGHT,
        'stablecoin_btc_ratio': EQUAL_WEIGHT,
        'defi_tvl': EQUAL_WEIGHT,
        'exchange_outflows': EQUAL_WEIGHT,
        'btc_spy_correlation': EQUAL_WEIGHT,
        'altcoin_weakness': EQUAL_WEIGHT,
    }
    
    # Regime thresholds
    REGIME_THRESHOLDS = {
        'normal_confidence': 90,
        'mild_caution': 70,
        'monetary_stress': 40,
        'liquidity_crisis': 20,
        'systemic_breakdown': 0,
    }
    
    def __init__(self, db: Session):
        self.db = db

    def _normalize_date(self, target_date: datetime) -> datetime:
        return target_date.replace(hour=0, minute=0, second=0, microsecond=0)

    def _get_latest_daily_record(self, model, date_field, target_date: datetime):
        day = target_date.date()
        rows = (
            self.db.query(model)
            .filter(func.date(date_field) == day)
            .order_by(desc(date_field))
            .all()
        )
        for extra in rows[1:]:
            self.db.delete(extra)
        return rows[0] if rows else None
    
    def calculate_for_date(self, target_date: datetime) -> Optional[AAPIndicator]:
        """
        Calculate AAP indicator for a specific date.
        
        Returns:
            AAPIndicator object or None if insufficient data
        """
        try:
            target_date = self._normalize_date(target_date)

            # Step 1: Calculate all components
            components = self._calculate_components(target_date)
            if not components:
                logger.warning(f"Insufficient data for AAP calculation on {target_date}")
                return None
            
            # Step 2: Compute subsystem instability scores
            metals_instability = self._compute_metals_instability(components)
            crypto_instability = self._compute_crypto_instability(components)
            
            # Step 3: Apply cross-asset confirmation
            multiplier, correlation_regime = self._compute_cross_asset_multiplier(
                components, metals_instability, crypto_instability, target_date
            )
            
            # Step 4: Calculate aggregate instability index
            pressure_index = (
                0.50 * metals_instability +
                0.50 * crypto_instability
            ) * multiplier
            
            # Clamp to [0, 1]
            pressure_index = max(0.0, min(1.0, pressure_index))
            
            # Step 5: Convert to stability score (INVARIANT: invert pressure to stability)
            stability_score = 100 - (pressure_index * 100)
            
            # Step 6: Classify regime
            regime, regime_confidence = self._classify_regime(
                stability_score, components, metals_instability, crypto_instability
            )
            
            # Step 7: Determine drivers and stress type
            primary_driver = self._identify_primary_driver(
                metals_instability, crypto_instability, correlation_regime
            )
            stress_type = self._identify_stress_type(
                components, regime, primary_driver
            )
            
            # Step 8: Get contextual data
            vix_level = self._get_vix_level(target_date)
            liquidity_regime = self._get_liquidity_regime(target_date)
            fed_pivot = self._calculate_fed_pivot_signal(target_date)
            
            # Step 9: Calculate rolling statistics
            rolling_stats = self._calculate_rolling_stats(target_date, stability_score)
            
            # Step 10: Check for alerts
            is_critical = 1 if stability_score < 30 else 0
            is_transitioning = self._check_regime_transition(target_date, regime)
            circuit_breaker = 1 if vix_level and vix_level > 40 else 0
            
            # Step 11: Assess data quality
            data_completeness = self._assess_data_completeness(components)
            
            # Helper to convert numpy types to Python types
            def to_python_type(val):
                if val is None:
                    return None
                return float(val) if hasattr(val, 'item') else val
            
            indicator_data = {
                "date": target_date,
                "stability_score": to_python_type(stability_score),
                "pressure_index": to_python_type(pressure_index),
                "metals_contribution": to_python_type(metals_instability * 0.50 * multiplier),
                "crypto_contribution": to_python_type(crypto_instability * 0.50 * multiplier),
                "regime": regime,
                "regime_confidence": to_python_type(regime_confidence),
                "primary_driver": primary_driver,
                "stress_type": stress_type,
                "vix_level": to_python_type(vix_level),
                "liquidity_regime": liquidity_regime,
                "fed_pivot_signal": to_python_type(fed_pivot),
                "score_1d_change": to_python_type(rolling_stats.get('change_1d')),
                "score_5d_change": to_python_type(rolling_stats.get('change_5d')),
                "score_20d_avg": to_python_type(rolling_stats.get('avg_20d')),
                "score_90d_avg": to_python_type(rolling_stats.get('avg_90d')),
                "is_critical": is_critical,
                "is_transitioning": is_transitioning,
                "circuit_breaker_active": circuit_breaker,
                "data_completeness": to_python_type(data_completeness),
            }

            indicator = self._get_latest_daily_record(AAPIndicator, AAPIndicator.date, target_date)
            if indicator:
                self._apply_model_updates(indicator, indicator_data)
            else:
                indicator = AAPIndicator(**indicator_data)
            
            # Persist component details
            component_record = self._create_component_record(
                target_date, components, metals_instability, crypto_instability,
                multiplier, correlation_regime
            )

            existing_component = self._get_latest_daily_record(AAPComponentV2, AAPComponentV2.date, target_date)
            if existing_component:
                self._apply_component_updates(existing_component, component_record)
            else:
                self.db.add(component_record)
            self.db.add(indicator)
            
            # Also create IndicatorValue record for dashboard display
            from app.models.indicator_value import IndicatorValue
            from app.models.indicator import Indicator
            
            # Get AAP indicator definition
            aap_indicator_def = self.db.query(Indicator).filter_by(code='AAP').first()
            if aap_indicator_def:
                # Map stability_score to indicator value
                # Stability score is 0-100 (higher = less pressure = better)
                # So we can use it directly as the indicator score
                indicator_values = self.db.query(IndicatorValue).filter(
                    IndicatorValue.indicator_id == aap_indicator_def.id,
                    func.date(IndicatorValue.timestamp) == target_date.date()
                ).order_by(desc(IndicatorValue.timestamp)).all()
                indicator_value = indicator_values[0] if indicator_values else None
                for extra in indicator_values[1:]:
                    self.db.delete(extra)
                if indicator_value:
                    indicator_value.raw_value = to_python_type(pressure_index)
                    indicator_value.score = to_python_type(stability_score)
                    indicator_value.state = self._map_regime_to_state(regime)
                else:
                    indicator_value = IndicatorValue(
                        indicator_id=aap_indicator_def.id,
                        timestamp=target_date,
                        raw_value=to_python_type(pressure_index),  # 0-1 pressure index
                        score=to_python_type(stability_score),  # 0-100 stability score
                        state=self._map_regime_to_state(regime)
                    )
                    self.db.add(indicator_value)
            
            # Update regime history if needed
            regime_start = self._update_regime_history(target_date, regime)
            if regime_start:
                indicator.regime_days_persistent = (target_date - regime_start).days + 1
            
            self.db.commit()
            
            logger.info(
                f"AAP calculated for {target_date.date()}: "
                f"Score={stability_score:.1f}, Regime={regime}, Driver={primary_driver}"
            )
            
            return indicator
            
        except Exception as e:
            logger.error(f"Error calculating AAP for {target_date}: {e}", exc_info=True)
            self.db.rollback()
            return None
    
    def _calculate_components(self, date: datetime) -> Optional[Dict[str, float]]:
        """
        Calculate all individual components for the AAP indicator.
        
        Returns dict with normalized component values (0-1 scale, higher = less stability)
        """
        components = {}
        
        try:
            # METALS SUBSYSTEM (9)
            try:
                components['gold_dxy_ratio'] = self._calc_gold_dxy_ratio(date)
            except Exception as e:
                logger.debug(f"gold_dxy_ratio failed: {e}")

            try:
                components['gold_real_rate_divergence'] = self._calc_gold_real_rate_divergence(date)
            except Exception as e:
                logger.debug(f"gold_real_rate_divergence failed: {e}")

            try:
                components['silver_outperformance'] = self._calc_silver_outperformance(date)
            except Exception as e:
                logger.debug(f"silver_outperformance failed: {e}")

            try:
                components['pgm_weakness'] = self._calc_pgm_weakness(date)
            except Exception as e:
                logger.debug(f"pgm_weakness failed: {e}")

            try:
                components['cb_gold_accumulation'] = self._calc_cb_gold_accumulation(date)
            except Exception as e:
                logger.debug(f"cb_gold_accumulation failed: {e}")

            try:
                components['comex_registered_inventory'] = self._calc_comex_registered_inventory(date)
            except Exception as e:
                logger.debug(f"comex_registered_inventory failed: {e}")

            try:
                components['oi_to_registered_ratio'] = self._calc_oi_to_registered_ratio(date)
            except Exception as e:
                logger.debug(f"oi_to_registered_ratio failed: {e}")

            try:
                components['gold_etf_flows'] = self._calc_gold_etf_flows(date)
            except Exception as e:
                logger.debug(f"gold_etf_flows failed: {e}")

            try:
                components['mining_stock_divergence'] = self._calc_mining_stock_divergence(date)
            except Exception as e:
                logger.debug(f"mining_stock_divergence failed: {e}")

            # CRYPTO SUBSYSTEM (9)
            try:
                components['btc_dominance'] = self._calc_btc_dominance(date)
            except Exception as e:
                logger.debug(f"btc_dominance failed: {e}")

            try:
                components['btc_hash_rate'] = self._calc_btc_hash_rate(date)
            except Exception as e:
                logger.debug(f"btc_hash_rate failed: {e}")

            try:
                components['btc_difficulty'] = self._calc_btc_difficulty(date)
            except Exception as e:
                logger.debug(f"btc_difficulty failed: {e}")

            try:
                components['stablecoin_supply'] = self._calc_stablecoin_supply(date)
            except Exception as e:
                logger.debug(f"stablecoin_supply failed: {e}")

            try:
                components['stablecoin_btc_ratio'] = self._calc_stablecoin_btc_ratio(date)
            except Exception as e:
                logger.debug(f"stablecoin_btc_ratio failed: {e}")

            try:
                components['defi_tvl'] = self._calc_defi_tvl(date)
            except Exception as e:
                logger.debug(f"defi_tvl failed: {e}")

            try:
                components['exchange_outflows'] = self._calc_exchange_outflows(date)
            except Exception as e:
                logger.debug(f"exchange_outflows failed: {e}")

            try:
                components['btc_spy_correlation'] = self._calc_btc_spy_correlation(date)
            except Exception as e:
                logger.debug(f"btc_spy_correlation failed: {e}")

            try:
                components['altcoin_weakness'] = self._calc_altcoin_weakness(date)
            except Exception as e:
                logger.debug(f"altcoin_weakness failed: {e}")
            
            # Filter out None values
            components = {k: v for k, v in components.items() if v is not None}
            
            # Log availability
            logger.info(f"AAP components: {len(components)}/{len(self.WEIGHTS)} available")
            
            # Need at least 70% of components for reliable signal
            required = int(np.ceil(len(self.WEIGHTS) * 0.70))
            if len(components) < required:
                logger.warning(f"Insufficient components: {len(components)}/{required} required")
                return None
            
            return components
            
        except Exception as e:
            logger.error(f"Error calculating components: {e}", exc_info=True)
            # Return partial components if we have enough
            components = {k: v for k, v in components.items() if v is not None}
            if len(components) >= int(len(self.WEIGHTS) * 0.50):
                logger.info(f"Returning {len(components)} partial components despite error")
                return components
            return None
    
    # ===== METALS COMPONENT CALCULATIONS =====

    def _calc_gold_dxy_ratio(self, date: datetime) -> Optional[float]:
        """Gold vs DXY ratio (high = monetary hedge bid)"""
        latest = self.db.query(MetalRatio).filter(
            MetalRatio.metal1 == 'AU',
            MetalRatio.metal2 == 'DXY',
            MetalRatio.date <= date
        ).order_by(desc(MetalRatio.date)).first()

        if not latest or not latest.ratio_value:
            return None

        zscore = latest.zscore_2y
        if zscore is None:
            history = self.db.query(MetalRatio).filter(
                MetalRatio.metal1 == 'AU',
                MetalRatio.metal2 == 'DXY',
                MetalRatio.date >= date - timedelta(days=730),
                MetalRatio.date <= date
            ).all()
            values = [r.ratio_value for r in history if r.ratio_value]
            if len(values) < 20:
                return None
            mean = np.mean(values)
            std = np.std(values)
            if std == 0:
                return 0.5
            zscore = (latest.ratio_value - mean) / std

        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_silver_outperformance(self, date: datetime) -> Optional[float]:
        """Silver outperformance vs gold (low = monetary hedge dominance)"""
        gold_prices = self._get_metal_prices('AU', date, days=730)
        silver_prices = self._get_metal_prices('AG', date, days=730)

        if len(gold_prices) < 30 or len(silver_prices) < 30:
            return None

        gold_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices if p.price_usd_per_oz}
        silver_map = {p.date.date(): p.price_usd_per_oz for p in silver_prices if p.price_usd_per_oz}

        common_dates = sorted(set(gold_map.keys()) & set(silver_map.keys()))
        if len(common_dates) < 30:
            return None

        values = [(silver_map[d] / gold_map[d]) for d in common_dates]
        current_ratio = values[-1]
        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (current_ratio - mean) / std
        normalized = (-zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_pgm_weakness(self, date: datetime) -> Optional[float]:
        """Platinum/palladium weakness vs gold"""
        start_date = date - timedelta(days=730)

        au_prices = self._get_metal_prices('AU', date, days=730)
        pt_prices = self._get_metal_prices('PT', date, days=730)
        pd_prices = self._get_metal_prices('PD', date, days=730)

        if len(au_prices) < 30 or len(pt_prices) < 30 or len(pd_prices) < 30:
            return None

        au_map = {p.date.date(): p.price_usd_per_oz for p in au_prices if p.price_usd_per_oz}
        pt_map = {p.date.date(): p.price_usd_per_oz for p in pt_prices if p.price_usd_per_oz}
        pd_map = {p.date.date(): p.price_usd_per_oz for p in pd_prices if p.price_usd_per_oz}

        common_dates = sorted(set(au_map.keys()) & set(pt_map.keys()) & set(pd_map.keys()))
        if len(common_dates) < 30:
            return None

        ratios = []
        for d in common_dates:
            ratios.append(((pt_map[d] / au_map[d]) + (pd_map[d] / au_map[d])) / 2)

        mean = np.mean(ratios)
        std = np.std(ratios)
        if std == 0:
            return 0.5

        current_ratio = ratios[-1]
        zscore = (current_ratio - mean) / std
        normalized = (-zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_cb_gold_accumulation(self, date: datetime) -> Optional[float]:
        """Central bank net accumulation momentum"""
        return self._calc_cb_gold_momentum(date)

    def _calc_gld_holdings_score(self, date: datetime, window_days: int = 180) -> Optional[float]:
        """GLD holdings z-score normalized to 0-1 (low holdings = higher pressure)."""
        records = self.db.query(ETFHolding).filter(
            ETFHolding.ticker == 'GLD',
            ETFHolding.holdings.isnot(None),
            ETFHolding.date >= date - timedelta(days=window_days),
            ETFHolding.date <= date
        ).order_by(ETFHolding.date).all()

        values = [r.holdings for r in records if r.holdings is not None]
        if len(values) < 20:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return None

        zscore = (values[-1] - mean) / std
        normalized = (-zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_gld_flow_score(self, date: datetime, window_days: int = 180) -> Optional[float]:
        """GLD flow z-score normalized to 0-1 (higher inflows = higher pressure)."""
        records = self.db.query(ETFHolding).filter(
            ETFHolding.ticker == 'GLD',
            ETFHolding.date >= date - timedelta(days=window_days),
            ETFHolding.date <= date
        ).order_by(ETFHolding.date).all()

        flows_pct = [r.daily_flow_pct for r in records if r.daily_flow_pct is not None]
        values = flows_pct if len(flows_pct) >= 20 else [r.daily_flow for r in records if r.daily_flow is not None]
        if len(values) < 20:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return None

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_comex_registered_inventory(self, date: datetime) -> Optional[float]:
        """COMEX registered inventory (low inventory = high pressure)"""
        gld_score = self._calc_gld_holdings_score(date)
        if gld_score is not None:
            return gld_score

        records = self.db.query(COMEXInventory).filter(
            COMEXInventory.metal == 'AU',
            COMEXInventory.date >= date - timedelta(days=180),
            COMEXInventory.date <= date,
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).order_by(COMEXInventory.date).all()

        values = [r.registered_oz for r in records if r.registered_oz]
        if not values:
            return None
        if len(values) < 2:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return None

        zscore = (values[-1] - mean) / std
        normalized = (-zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_oi_to_registered_ratio(self, date: datetime) -> Optional[float]:
        """Open interest to registered inventory ratio"""
        gld_flow_score = self._calc_gld_flow_score(date)
        if gld_flow_score is not None:
            return gld_flow_score

        records = self.db.query(COMEXInventory).filter(
            COMEXInventory.metal == 'AU',
            COMEXInventory.date >= date - timedelta(days=180),
            COMEXInventory.date <= date,
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).order_by(COMEXInventory.date).all()

        values = [r.oi_to_registered_ratio for r in records if r.oi_to_registered_ratio]
        if not values:
            return None
        if len(values) < 2:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return None

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_gold_etf_flows(self, date: datetime) -> Optional[float]:
        """Gold ETF flows (positive flows = high pressure)"""
        records = self.db.query(ETFHolding).filter(
            ETFHolding.ticker == 'GLD',
            ETFHolding.date >= date - timedelta(days=180),
            ETFHolding.date <= date
        ).order_by(ETFHolding.date).all()

        flows = [r.daily_flow for r in records if r.daily_flow is not None]
        if len(flows) < 15:
            gld_prices = self.db.query(EquityPrice).filter(
                EquityPrice.symbol == 'GLD',
                EquityPrice.date >= date - timedelta(days=90),
                EquityPrice.date <= date
            ).order_by(EquityPrice.date).all()

            values = [p.close for p in gld_prices if p.close]
            if len(values) < 20:
                return None

            mean = np.mean(values)
            std = np.std(values)
            if std == 0:
                return 0.5

            zscore = (values[-1] - mean) / std
            normalized = (zscore + 2) / 4
            return max(0.0, min(1.0, normalized))

        mean = np.mean(flows)
        std = np.std(flows)
        if std == 0:
            return 0.5

        zscore = (flows[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_mining_stock_divergence(self, date: datetime) -> Optional[float]:
        """Mining stocks (GDX) vs gold divergence"""
        gdx_prices = self.db.query(EquityPrice).filter(
            EquityPrice.symbol == 'GDX',
            EquityPrice.date >= date - timedelta(days=45),
            EquityPrice.date <= date
        ).order_by(EquityPrice.date).all()

        gold_prices = self._get_metal_prices('AU', date, days=45)

        if len(gdx_prices) < 20 or len(gold_prices) < 20:
            return None

        gdx_map = {p.date.date(): p.close for p in gdx_prices if p.close}
        gold_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices if p.price_usd_per_oz}

        common_dates = sorted(set(gdx_map.keys()) & set(gold_map.keys()))
        if len(common_dates) < 20:
            return None

        start = common_dates[0]
        end = common_dates[-1]
        gdx_return = (gdx_map[end] / gdx_map[start]) - 1
        gold_return = (gold_map[end] / gold_map[start]) - 1

        divergence = gdx_return - gold_return

        if divergence <= -0.15:
            return 0.85
        if divergence <= -0.05:
            return 0.65
        if divergence >= 0.05:
            return 0.35
        return 0.50
    
    def _calc_gold_usd_zscore(self, date: datetime) -> Optional[float]:
        """Gold/USD z-score over 20-day window"""
        prices = self._get_metal_prices('AU', date, days=30)
        if len(prices) < 20:
            return None
        
        recent = [p.price_usd_per_oz for p in prices[-20:]]
        mean = np.mean(recent)
        std = np.std(recent)
        
        if std == 0:
            return 0.5
        
        current = prices[-1].price_usd_per_oz
        zscore = (current - mean) / std
        
        # Normalize to 0-1, higher = more pressure
        # zscore > 2 = high pressure (1.0), zscore < -2 = low pressure (0.0)
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))
    
    def _calc_gold_real_rate_divergence(self, date: datetime) -> Optional[float]:
        """
        Gold performance vs real rates.
        When gold rises despite high real rates = high pressure signal.
        """
        # Get gold price change
        gold_prices = self._get_metal_prices('AU', date, days=60)
        if len(gold_prices) < 30:
            # Not enough data - return None
            return None
        
        gold_return = (gold_prices[-1].price_usd_per_oz / gold_prices[-30].price_usd_per_oz) - 1
        
        # Get real rate level
        macro_data = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date
        ).order_by(desc(MacroLiquidityData.date)).first()
        
        if not macro_data or macro_data.real_rate_10y is None:
            return None
        
        real_rate = macro_data.real_rate_10y
        
        # Expected: gold down when real rates high, gold up when real rates low
        # Divergence = gold up + real rates high = pressure signal
        if gold_return > 0 and real_rate > 1.5:
            # Strong divergence
            pressure = 0.8
        elif gold_return > 0.05 and real_rate > 0.5:
            pressure = 0.6
        elif gold_return > 0:
            pressure = 0.5
        elif gold_return < -0.05:
            pressure = 0.2
        else:
            pressure = 0.4
        
        return pressure
    
    def _calc_cb_gold_momentum(self, date: datetime) -> Optional[float]:
        """
        Central bank gold accumulation momentum.
        Quarterly data, so we look at trend.
        """
        # Get last 4 quarters of CB holdings
        holdings = self.db.query(CBHolding).filter(
            CBHolding.date <= date,
            CBHolding.date > date - timedelta(days=400)
        ).order_by(CBHolding.date).all()
        
        if len(holdings) < 10:
            return None
        
        # Group by country and calculate net change
        by_country = {}
        for h in holdings:
            if h.country not in by_country:
                by_country[h.country] = []
            by_country[h.country].append((h.date, h.gold_tonnes))
        
        # Calculate accumulation momentum
        accumulation_score = 0
        for country, data in by_country.items():
            if len(data) >= 2:
                data.sort(key=lambda x: x[0])
                latest = data[-1][1]
                earlier = data[0][1]
                change_pct = (latest - earlier) / earlier if earlier > 0 else 0
                
                # Heavy accumulators get more weight
                if change_pct > 0.10:
                    accumulation_score += 1.0
                elif change_pct > 0.05:
                    accumulation_score += 0.6
                elif change_pct > 0:
                    accumulation_score += 0.3
        
        # Normalize: 4+ countries accumulating heavily = max pressure
        normalized = min(1.0, accumulation_score / 4.0)
        return normalized
    
    def _calc_silver_usd_zscore(self, date: datetime) -> Optional[float]:
        """Silver/USD z-score over 20-day window"""
        prices = self._get_metal_prices('AG', date, days=30)
        if len(prices) < 20:
            return None
        
        recent = [p.price_usd_per_oz for p in prices[-20:]]
        mean = np.mean(recent)
        std = np.std(recent)
        
        if std == 0:
            return 0.5
        
        current = prices[-1].price_usd_per_oz
        zscore = (current - mean) / std
        
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))
    
    def _calc_gsr_signal(self, date: datetime) -> Optional[float]:
        """
        Gold/Silver ratio signal.
        High GSR (>85) = monetary stress = high pressure
        Low GSR (<70) = growth optimism = low pressure
        """
        gold_price = self._get_latest_metal_price('AU', date)
        silver_price = self._get_latest_metal_price('AG', date)
        
        if not gold_price or not silver_price:
            return None
        
        gsr = gold_price.price_usd_per_oz / silver_price.price_usd_per_oz
        
        # Get 2-year historical mean
        historical = self._get_historical_gsr(date, days=730)
        if historical:
            mean_gsr = np.mean(historical)
            std_gsr = np.std(historical)
            
            if std_gsr > 0:
                zscore = (gsr - mean_gsr) / std_gsr
                # High GSR = high pressure
                normalized = (zscore + 2) / 4
                return max(0.0, min(1.0, normalized))
        
        # Fallback: absolute thresholds
        if gsr > 90:
            return 0.9
        elif gsr > 85:
            return 0.75
        elif gsr > 80:
            return 0.6
        elif gsr < 70:
            return 0.3
        elif gsr < 75:
            return 0.4
        else:
            return 0.5
    
    def _calc_pt_au_signal(self, date: datetime) -> Optional[float]:
        """
        Platinum/Gold ratio.
        Falling Pt/Au = industrial pessimism, flight to monetary metal = pressure
        """
        pt_price = self._get_latest_metal_price('PT', date)
        au_price = self._get_latest_metal_price('AU', date)
        
        if not pt_price or not au_price:
            return None
        
        ratio = pt_price.price_usd_per_oz / au_price.price_usd_per_oz
        
        # Typical range: 0.4 - 1.2
        # Low ratio (<0.5) = defensive, high pressure
        if ratio < 0.45:
            return 0.8
        elif ratio < 0.55:
            return 0.6
        elif ratio > 0.9:
            return 0.3
        else:
            return 0.5
    
    def _calc_pd_au_signal(self, date: datetime) -> Optional[float]:
        """Palladium/Gold ratio - industrial cycle proxy"""
        pd_price = self._get_latest_metal_price('PD', date)
        au_price = self._get_latest_metal_price('AU', date)
        
        if not pd_price or not au_price:
            return None
        
        ratio = pd_price.price_usd_per_oz / au_price.price_usd_per_oz
        
        # Pd typically 0.5-1.5x gold
        # Low Pd/Au = weak industrial demand = defensive = pressure
        if ratio < 0.5:
            return 0.7
        elif ratio < 0.7:
            return 0.6
        elif ratio > 1.2:
            return 0.3
        else:
            return 0.5
    
    def _calc_comex_stress(self, date: datetime) -> Optional[float]:
        """
        COMEX registered inventory vs open interest.
        High OI/registered = paper vs physical stress
        """
        comex = self.db.query(COMEXInventory).filter(
            COMEXInventory.date <= date,
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).order_by(desc(COMEXInventory.date)).first()
        
        if not comex or not comex.oi_to_registered_ratio:
            return None
        
        ratio = comex.oi_to_registered_ratio
        
        # High ratio = stress
        # >0.8 = extreme, <0.3 = normal
        if ratio > 1.0:
            return 0.95
        elif ratio > 0.8:
            return 0.80
        elif ratio > 0.6:
            return 0.65
        elif ratio > 0.4:
            return 0.50
        else:
            return 0.30
    
    def _calc_backwardation_signal(self, date: datetime) -> Optional[float]:
        """
        Futures backwardation persistence.
        Backwardation = physical premium = stress
        (Not implemented yet - requires futures curve data)
        """
        return None
    
    def _calc_etf_divergence(self, date: datetime) -> Optional[float]:
        """
        ETF flow vs price divergence.
        Outflows + rising price = physical shortage = pressure
        (Not implemented yet - requires ETF flow data)
        """
        return None
    
    # ===== CRYPTO COMPONENT CALCULATIONS =====

    def _calc_btc_dominance(self, date: datetime) -> Optional[float]:
        """BTC dominance momentum (rising = pressure)"""
        prices = self._get_crypto_prices(date, days=60)
        if len(prices) < 30:
            return None

        dominance = [p.btc_dominance for p in prices if p.btc_dominance is not None]
        if len(dominance) < 30:
            return None

        mean = np.mean(dominance)
        std = np.std(dominance)
        if std == 0:
            return 0.5

        zscore = (dominance[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_btc_hash_rate(self, date: datetime) -> Optional[float]:
        """BTC hash rate (higher = more pressure)"""
        metrics = self.db.query(BitcoinNetworkMetric).filter(
            BitcoinNetworkMetric.date >= date - timedelta(days=180),
            BitcoinNetworkMetric.date <= date
        ).order_by(BitcoinNetworkMetric.date).all()

        values = [m.hash_rate for m in metrics if m.hash_rate]
        if len(values) < 20:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_btc_difficulty(self, date: datetime) -> Optional[float]:
        """BTC difficulty (higher = more pressure)"""
        metrics = self.db.query(BitcoinNetworkMetric).filter(
            BitcoinNetworkMetric.date >= date - timedelta(days=180),
            BitcoinNetworkMetric.date <= date
        ).order_by(BitcoinNetworkMetric.date).all()

        values = [m.difficulty for m in metrics if m.difficulty]
        if len(values) < 20:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_stablecoin_supply(self, date: datetime) -> Optional[float]:
        """Stablecoin supply (higher = more pressure)"""
        metrics = self.db.query(CryptoEcosystemMetric).filter(
            CryptoEcosystemMetric.date >= date - timedelta(days=180),
            CryptoEcosystemMetric.date <= date
        ).order_by(CryptoEcosystemMetric.date).all()

        values = [m.stablecoin_supply_usd for m in metrics if m.stablecoin_supply_usd]
        if len(values) < 10:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_stablecoin_btc_ratio(self, date: datetime) -> Optional[float]:
        """Stablecoin supply vs BTC market cap ratio"""
        metrics = self.db.query(CryptoEcosystemMetric).filter(
            CryptoEcosystemMetric.date >= date - timedelta(days=180),
            CryptoEcosystemMetric.date <= date
        ).order_by(CryptoEcosystemMetric.date).all()

        values = [m.stablecoin_btc_ratio for m in metrics if m.stablecoin_btc_ratio]
        if len(values) < 10:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_defi_tvl(self, date: datetime) -> Optional[float]:
        """DeFi TVL (higher = more pressure)"""
        metrics = self.db.query(CryptoEcosystemMetric).filter(
            CryptoEcosystemMetric.date >= date - timedelta(days=180),
            CryptoEcosystemMetric.date <= date
        ).order_by(CryptoEcosystemMetric.date).all()

        values = [m.defi_tvl_usd for m in metrics if m.defi_tvl_usd]
        if len(values) < 10:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_exchange_outflows(self, date: datetime) -> Optional[float]:
        """BTC exchange net outflows (higher = more pressure)"""
        metrics = self.db.query(CryptoEcosystemMetric).filter(
            CryptoEcosystemMetric.date >= date - timedelta(days=180),
            CryptoEcosystemMetric.date <= date
        ).order_by(CryptoEcosystemMetric.date).all()

        values = [m.exchange_net_outflow_btc for m in metrics if m.exchange_net_outflow_btc is not None]
        if len(values) < 10:
            return None

        mean = np.mean(values)
        std = np.std(values)
        if std == 0:
            return 0.5

        zscore = (values[-1] - mean) / std
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))

    def _calc_btc_spy_correlation(self, date: datetime) -> Optional[float]:
        """BTC-SPY correlation (negative = high pressure)"""
        metric = self.db.query(CryptoEcosystemMetric).filter(
            CryptoEcosystemMetric.date <= date
        ).order_by(CryptoEcosystemMetric.date.desc()).first()

        if not metric or metric.btc_spy_corr_30d is None:
            return None

        corr = metric.btc_spy_corr_30d
        pressure = (1 - corr) / 2
        return max(0.0, min(1.0, pressure))

    def _calc_altcoin_weakness(self, date: datetime) -> Optional[float]:
        """Altcoin weakness vs BTC (underperformance = pressure)"""
        prices = self._get_crypto_prices(date, days=60)
        if len(prices) < 31:
            return None

        current = prices[-1]
        past = prices[-31]

        if not current.total_crypto_mcap or not past.total_crypto_mcap:
            return None
        if current.btc_dominance is None or past.btc_dominance is None:
            return None

        current_alt = current.total_crypto_mcap * (1 - current.btc_dominance / 100)
        past_alt = past.total_crypto_mcap * (1 - past.btc_dominance / 100)

        if not past_alt or not past.btc_usd or not current.btc_usd:
            return None

        alt_return = (current_alt / past_alt) - 1
        btc_return = (current.btc_usd / past.btc_usd) - 1

        relative = alt_return - btc_return

        if relative < -0.15:
            return 0.80
        if relative < -0.05:
            return 0.65
        if relative > 0.10:
            return 0.30
        return 0.50
    
    def _calc_btc_usd_zscore(self, date: datetime) -> Optional[float]:
        """BTC/USD z-score over 30-day window"""
        prices = self._get_crypto_prices(date, days=40)
        if len(prices) < 30:
            return None
        
        recent = [p.btc_usd for p in prices[-30:] if p.btc_usd]
        if len(recent) < 30:
            return None
        
        # Use log returns to handle crypto volatility
        log_prices = np.log(recent)
        mean = np.mean(log_prices)
        std = np.std(log_prices)
        
        if std == 0:
            return 0.5
        
        current = np.log(prices[-1].btc_usd)
        zscore = (current - mean) / std
        
        # Cap at ±2σ to avoid contamination
        zscore = max(-2, min(2, zscore))
        
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))
    
    def _calc_btc_gold_zscore(self, date: datetime) -> Optional[float]:
        """BTC/Gold ratio z-score"""
        crypto = self._get_latest_crypto_price(date)
        gold = self._get_latest_metal_price('AU', date)
        
        if not crypto or not gold or not crypto.btc_usd:
            return None
        
        ratio = crypto.btc_usd / gold.price_usd_per_oz
        
        # Get historical ratios
        historical = self._get_historical_btc_gold_ratio(date, days=365)
        if len(historical) < 30:
            return None
        
        mean = np.mean(historical)
        std = np.std(historical)
        
        if std == 0:
            return 0.5
        
        zscore = (ratio - mean) / std
        zscore = max(-2, min(2, zscore))
        
        normalized = (zscore + 2) / 4
        return max(0.0, min(1.0, normalized))
    
    def _calc_btc_real_rate_break(self, date: datetime) -> Optional[float]:
        """
        BTC performance vs real rates correlation break.
        BTC rising despite high real rates = monetary distrust
        """
        crypto_prices = self._get_crypto_prices(date, days=60)
        if len(crypto_prices) < 30:
            return None
        
        btc_return = (crypto_prices[-1].btc_usd / crypto_prices[-30].btc_usd) - 1 if crypto_prices[-30].btc_usd else 0
        
        macro = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date
        ).order_by(desc(MacroLiquidityData.date)).first()
        
        if not macro or macro.real_rate_10y is None:
            return None
        
        real_rate = macro.real_rate_10y
        
        # Strong divergence scoring
        if btc_return > 0.15 and real_rate > 1.5:
            return 0.85
        elif btc_return > 0.10 and real_rate > 1.0:
            return 0.70
        elif btc_return > 0.05 and real_rate > 0.5:
            return 0.60
        elif btc_return > 0:
            return 0.50
        else:
            return 0.35
    
    def _calc_crypto_m2_ratio(self, date: datetime) -> Optional[float]:
        """Total crypto mcap / global M2 ratio"""
        crypto = self._get_latest_crypto_price(date)
        macro = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date
        ).order_by(desc(MacroLiquidityData.date)).first()
        
        if not crypto or not macro or not crypto.total_crypto_mcap or not macro.global_m2:
            return None
        
        # Crypto mcap in billions, M2 in trillions
        ratio = crypto.total_crypto_mcap / (macro.global_m2 * 1000)
        
        # Historical context
        historical_ratios = self._get_historical_crypto_m2_ratios(date, days=365)
        if len(historical_ratios) > 30:
            mean_ratio = np.mean(historical_ratios)
            std_ratio = np.std(historical_ratios)
            
            if std_ratio > 0:
                zscore = (ratio - mean_ratio) / std_ratio
                normalized = (zscore + 2) / 4
                return max(0.0, min(1.0, normalized))
        
        # Fallback: absolute scale (typical range 0.5% - 3%)
        normalized = ratio / 0.03
        return max(0.0, min(1.0, normalized))
    
    def _calc_btc_dominance_momentum(self, date: datetime) -> Optional[float]:
        """
        BTC dominance momentum.
        Rising dominance during stress = flight to hardest crypto = pressure
        """
        prices = self._get_crypto_prices(date, days=60)
        if len(prices) < 31:
            return None
        
        current_dom = prices[-1].btc_dominance
        past_dom = prices[-31].btc_dominance
        
        if not current_dom or not past_dom:
            return None
        
        change = current_dom - past_dom
        
        # Check if crypto market is down overall
        crypto_down = prices[-1].total_crypto_mcap < prices[-31].total_crypto_mcap
        
        if crypto_down and change > 3:
            # Flight to BTC during stress
            return 0.80
        elif crypto_down and change > 1:
            return 0.65
        elif change > 2:
            return 0.60
        elif change < -3:
            # Dominance falling = alt season = speculative
            return 0.30
        else:
            return 0.50
    
    def _calc_altcoin_signal(self, date: datetime) -> Optional[float]:
        """
        Altcoin performance vs BTC.
        Weak alts = defensive crypto posture = pressure
        """
        prices = self._get_crypto_prices(date, days=40)
        if len(prices) < 31:  # Need at least 31 days for 30-day lookback
            return None
        
        # Approximate altcoin mcap
        current_alt = prices[-1].total_crypto_mcap * (1 - prices[-1].btc_dominance/100) if prices[-1].btc_dominance else None
        past_alt = prices[-31].total_crypto_mcap * (1 - prices[-31].btc_dominance/100) if prices[-31].btc_dominance else None
        
        if not current_alt or not past_alt or past_alt == 0:
            return 0.5
        
        alt_return = (current_alt / past_alt) - 1
        btc_return = (prices[-1].btc_usd / prices[-31].btc_usd) - 1 if prices[-31].btc_usd else 0
        
        relative = alt_return - btc_return
        
        if relative < -0.15:
            # Alts underperforming badly = defensive = pressure
            return 0.75
        elif relative < -0.05:
            return 0.60
        elif relative > 0.10:
            # Alts outperforming = speculative = low pressure
            return 0.30
        else:
            return 0.50
    
    def _calc_crypto_vs_fed(self, date: datetime) -> Optional[float]:
        """Crypto performance vs Fed balance sheet changes"""
        crypto_prices = self._get_crypto_prices(date, days=90)
        macro_data = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date,
            MacroLiquidityData.date >= date - timedelta(days=100)
        ).order_by(MacroLiquidityData.date).all()
        
        if len(crypto_prices) < 61 or len(macro_data) < 2:
            return None
        
        # Crypto return
        crypto_return = (crypto_prices[-1].total_crypto_mcap / crypto_prices[-61].total_crypto_mcap) - 1
        
        # Fed BS change
        if not macro_data[-1].fed_balance_sheet or not macro_data[0].fed_balance_sheet:
            return None
        fed_change = (macro_data[-1].fed_balance_sheet / macro_data[0].fed_balance_sheet) - 1
        
        # Divergence scoring
        if crypto_return > 0.20 and fed_change < -0.05:
            # Crypto up, Fed shrinking = strong decoupling = pressure
            return 0.85
        elif crypto_return > 0.10 and fed_change < 0:
            return 0.70
        elif crypto_return > 0 and fed_change < 0:
            return 0.60
        elif crypto_return < 0 and fed_change > 0.05:
            # Crypto down, Fed expanding = responding to liquidity = low pressure
            return 0.30
        else:
            return 0.50
    
    def _calc_crypto_qt_resilience(self, date: datetime) -> Optional[float]:
        """
        Crypto performance during QT regimes.
        Strength during tightening = deep distrust signal
        """
        liquidity_regime = self._get_liquidity_regime(date)
        
        if liquidity_regime != "QT":
            # Not applicable outside QT
            return None
        
        crypto_prices = self._get_crypto_prices(date, days=60)
        if len(crypto_prices) < 31:
            return None
        
        crypto_return = (crypto_prices[-1].total_crypto_mcap / crypto_prices[-31].total_crypto_mcap) - 1
        
        if crypto_return > 0.15:
            return 0.85
        elif crypto_return > 0.05:
            return 0.65
        elif crypto_return > 0:
            return 0.55
        else:
            return 0.35
    
    # ===== AGGREGATION & REGIME CLASSIFICATION =====
    
    def _compute_metals_instability(self, components: Dict[str, float]) -> float:
        """Aggregate metals subsystem into 0-1 instability score (lower stability)"""
        metals_keys = [
            'gold_dxy_ratio', 'gold_real_rate_divergence', 'silver_outperformance',
            'pgm_weakness', 'cb_gold_accumulation', 'comex_registered_inventory',
            'oi_to_registered_ratio', 'gold_etf_flows', 'mining_stock_divergence'
        ]
        
        total_weight = sum(self.WEIGHTS[k] for k in metals_keys if k in components)
        if total_weight == 0:
            return 0.5
        
        weighted_sum = sum(
            components[k] * self.WEIGHTS[k]
            for k in metals_keys if k in components
        )
        
        # Normalize to 0-1 subsystem scale
        return weighted_sum / total_weight
    
    def _compute_crypto_instability(self, components: Dict[str, float]) -> float:
        """Aggregate crypto subsystem into 0-1 instability score (lower stability)"""
        crypto_keys = [
            'btc_dominance', 'btc_hash_rate', 'btc_difficulty',
            'stablecoin_supply', 'stablecoin_btc_ratio', 'defi_tvl',
            'exchange_outflows', 'btc_spy_correlation', 'altcoin_weakness'
        ]
        
        total_weight = sum(self.WEIGHTS[k] for k in crypto_keys if k in components)
        if total_weight == 0:
            return 0.5
        
        weighted_sum = sum(
            components[k] * self.WEIGHTS[k]
            for k in crypto_keys if k in components
        )
        
        return weighted_sum / total_weight
    
    def _compute_cross_asset_multiplier(
        self, components: Dict, metals_instability: float, 
        crypto_instability: float, date: datetime
    ) -> Tuple[float, str]:
        """
        Compute cross-asset confirmation multiplier.
        Returns: (multiplier, correlation_regime)
        """
        diff = abs(metals_instability - crypto_instability)
        
        # Base correlation regime
        if metals_instability > 0.6 and crypto_instability > 0.6:
            regime = "coordinated"
            base_mult = 1.3
        elif metals_instability > 0.6 and crypto_instability < 0.4:
            regime = "metals_led"
            base_mult = 1.0
        elif crypto_instability > 0.6 and metals_instability < 0.4:
            regime = "crypto_led"
            base_mult = 0.7  # Likely speculative
        elif diff < 0.15:
            regime = "coordinated"
            base_mult = 1.1
        else:
            regime = "divergent"
            base_mult = 0.9
        
        # Regime modifiers
        liquidity_regime = self._get_liquidity_regime(date)
        vix = self._get_vix_level(date)
        
        modifier = 0.0
        
        if liquidity_regime == "QT" and regime == "coordinated":
            modifier += 0.1
        elif liquidity_regime == "QE" and regime == "coordinated":
            modifier -= 0.1
        
        if vix and vix > 30 and regime == "coordinated":
            modifier += 0.15
        
        final_mult = base_mult + modifier
        final_mult = max(0.6, min(1.4, final_mult))
        
        return final_mult, regime
    
    def _classify_regime(
        self, stability_score: float, components: Dict,
        metals_instability: float, crypto_instability: float
    ) -> Tuple[str, float]:
        """
        Classify regime based on stability score.
        Returns: (regime_name, confidence)
        """
        if stability_score >= 90:
            return "normal_confidence", 0.95
        elif stability_score >= 70:
            return "mild_caution", 0.85
        elif stability_score >= 40:
            # Need to distinguish monetary stress from speculative
            if metals_instability > crypto_instability:
                return "monetary_stress", 0.80
            else:
                return "mild_caution", 0.70  # Likely crypto speculation
        elif stability_score >= 20:
            return "liquidity_crisis", 0.85
        else:
            return "systemic_breakdown", 0.90
    
    def _identify_primary_driver(
        self, metals_instability: float, crypto_instability: float, correlation_regime: str
    ) -> str:
        """Identify which asset class is driving the signal"""
        if correlation_regime == "coordinated":
            return "coordinated"
        elif metals_instability > crypto_instability + 0.15:
            return "metals"
        elif crypto_instability > metals_instability + 0.15:
            return "crypto"
        else:
            return "mixed"
    
    def _identify_stress_type(
        self, components: Dict, regime: str, primary_driver: str
    ) -> str:
        """Identify the type of stress being signaled"""
        if regime == "normal_confidence":
            return "none"
        elif regime == "systemic_breakdown":
            return "systemic"
        
        # Check specific signals
        comex_inventory = components.get('comex_registered_inventory', 0.5)
        oi_ratio = components.get('oi_to_registered_ratio', 0.5)
        etf_flows = components.get('gold_etf_flows', 0.5)
        exchange_outflows = components.get('exchange_outflows', 0.5)
        btc_corr_pressure = components.get('btc_spy_correlation', 0.5)

        if comex_inventory > 0.7 or oi_ratio > 0.7:
            return "liquidity"
        if primary_driver == "metals" and etf_flows > 0.65:
            return "monetary"
        if primary_driver == "crypto" and exchange_outflows > 0.65:
            return "monetary"
        if primary_driver == "crypto" and btc_corr_pressure > 0.65:
            return "speculative"
        if primary_driver == "coordinated":
            return "monetary"
        return "mixed"
    
    # ===== HELPER FUNCTIONS =====
    
    def _get_metal_prices(self, metal: str, date: datetime, days: int = 30) -> List[MetalPrice]:
        """Get metal prices for lookback window"""
        start_date = date - timedelta(days=days)
        return self.db.query(MetalPrice).filter(
            MetalPrice.metal == metal,
            MetalPrice.date >= start_date,
            MetalPrice.date <= date
        ).order_by(MetalPrice.date).all()
    
    def _get_latest_metal_price(self, metal: str, date: datetime) -> Optional[MetalPrice]:
        """Get most recent metal price on or before date"""
        return self.db.query(MetalPrice).filter(
            MetalPrice.metal == metal,
            MetalPrice.date <= date
        ).order_by(desc(MetalPrice.date)).first()
    
    def _get_crypto_prices(self, date: datetime, days: int = 30) -> List[CryptoPrice]:
        """Get crypto prices for lookback window"""
        start_date = date - timedelta(days=days)
        return self.db.query(CryptoPrice).filter(
            CryptoPrice.date >= start_date,
            CryptoPrice.date <= date
        ).order_by(CryptoPrice.date).all()
    
    def _get_latest_crypto_price(self, date: datetime) -> Optional[CryptoPrice]:
        """Get most recent crypto price on or before date"""
        return self.db.query(CryptoPrice).filter(
            CryptoPrice.date <= date
        ).order_by(desc(CryptoPrice.date)).first()
    
    def _get_historical_gsr(self, date: datetime, days: int) -> List[float]:
        """Get historical gold/silver ratios"""
        start_date = date - timedelta(days=days)
        
        ratios = self.db.query(MetalRatio).filter(
            MetalRatio.metal1 == 'AU',
            MetalRatio.metal2 == 'AG',
            MetalRatio.date >= start_date,
            MetalRatio.date <= date
        ).all()
        
        return [r.ratio_value for r in ratios if r.ratio_value]
    
    def _get_historical_btc_gold_ratio(self, date: datetime, days: int) -> List[float]:
        """Calculate historical BTC/Gold ratios"""
        start_date = date - timedelta(days=days)
        
        ratios = []
        crypto_prices = self._get_crypto_prices(date, days=days)

        gold_prices = self.db.query(MetalPrice).filter(
            MetalPrice.metal == 'AU',
            MetalPrice.date >= start_date,
            MetalPrice.date <= date
        ).order_by(MetalPrice.date).all()

        if not gold_prices:
            return ratios

        gold_idx = 0
        for cp in crypto_prices:
            while (gold_idx + 1) < len(gold_prices) and gold_prices[gold_idx + 1].date <= cp.date:
                gold_idx += 1
            gold = gold_prices[gold_idx]
            if cp.btc_usd and gold and gold.price_usd_per_oz:
                ratios.append(cp.btc_usd / gold.price_usd_per_oz)
        
        return ratios
    
    def _get_historical_crypto_m2_ratios(self, date: datetime, days: int) -> List[float]:
        """Calculate historical crypto/M2 ratios"""
        start_date = date - timedelta(days=days)
        
        ratios = []
        crypto_prices = self._get_crypto_prices(date, days=days)
        macro_data = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date >= start_date,
            MacroLiquidityData.date <= date
        ).order_by(MacroLiquidityData.date).all()

        if not macro_data:
            return ratios

        macro_idx = 0
        for cp in crypto_prices:
            while (macro_idx + 1) < len(macro_data) and macro_data[macro_idx + 1].date <= cp.date:
                macro_idx += 1
            macro = macro_data[macro_idx]
            if cp.total_crypto_mcap and macro and macro.global_m2:
                ratio = cp.total_crypto_mcap / (macro.global_m2 * 1000)
                ratios.append(ratio)
        
        return ratios
    
    def _get_vix_level(self, date: datetime) -> Optional[float]:
        """Get VIX level (placeholder - would need market data integration)"""
        return None
    
    def _get_liquidity_regime(self, date: datetime) -> str:
        """
        Determine current liquidity regime (QE/QT/neutral).
        Based on Fed balance sheet trend.
        """
        macro_data = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date,
            MacroLiquidityData.date >= date - timedelta(days=120)
        ).order_by(MacroLiquidityData.date).all()
        
        if len(macro_data) < 2:
            return "neutral"
        
        recent_bs = macro_data[-1].fed_balance_sheet
        past_bs = macro_data[0].fed_balance_sheet
        
        if not recent_bs or not past_bs:
            return "neutral"
        
        change_pct = (recent_bs - past_bs) / past_bs
        
        if change_pct > 0.03:
            return "QE"
        elif change_pct < -0.03:
            return "QT"
        else:
            return "neutral"
    
    def _calculate_fed_pivot_signal(self, date: datetime) -> float:
        """
        Calculate Fed policy pivot momentum.
        Returns -1 to 1 (negative = tightening, positive = easing)
        """
        macro_data = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date <= date,
            MacroLiquidityData.date >= date - timedelta(days=180)
        ).order_by(MacroLiquidityData.date).all()
        
        if len(macro_data) < 3:
            return 0.0
        
        # Rate of change in balance sheet; fallback to neutral if data is missing
        if len(macro_data) > 30:
            recent_latest = macro_data[-1].fed_balance_sheet
            recent_base = macro_data[-30].fed_balance_sheet
            if recent_latest is None or recent_base is None:
                return 0.0
            recent_slope = recent_latest - recent_base
        else:
            recent_slope = 0.0

        if len(macro_data) > 60:
            earlier_latest = macro_data[-30].fed_balance_sheet
            earlier_base = macro_data[-60].fed_balance_sheet
            if earlier_latest is None or earlier_base is None:
                return 0.0
            earlier_slope = earlier_latest - earlier_base
        else:
            earlier_slope = 0.0
        
        if recent_slope > earlier_slope:
            pivot = 0.5
        elif recent_slope < earlier_slope:
            pivot = -0.5
        else:
            pivot = 0.0
        
        return max(-1.0, min(1.0, pivot))
    
    def _calculate_rolling_stats(self, date: datetime, current_score: float) -> Dict:
        """Calculate rolling statistics for the indicator"""
        historical = self.db.query(AAPIndicator).filter(
            AAPIndicator.date < date,
            AAPIndicator.date >= date - timedelta(days=100)
        ).order_by(desc(AAPIndicator.date)).all()
        
        stats = {}
        
        if len(historical) >= 1:
            stats['change_1d'] = current_score - historical[0].stability_score
        
        if len(historical) >= 5:
            stats['change_5d'] = current_score - historical[4].stability_score
        
        if len(historical) >= 20:
            stats['avg_20d'] = np.mean([h.stability_score for h in historical[:20]])
        
        if len(historical) >= 90:
            stats['avg_90d'] = np.mean([h.stability_score for h in historical[:90]])
        
        return stats
    
    def _check_regime_transition(self, date: datetime, current_regime: str) -> int:
        """Check if we're transitioning between regimes"""
        recent = self.db.query(AAPIndicator).filter(
            AAPIndicator.date < date,
            AAPIndicator.date >= date - timedelta(days=10)
        ).order_by(desc(AAPIndicator.date)).limit(5).all()
        
        if len(recent) < 3:
            return 0
        
        regimes = [r.regime for r in recent]
        
        # Check for regime instability
        unique_regimes = len(set(regimes))
        if unique_regimes >= 3:
            return 1
        
        return 0
    
    def _assess_data_completeness(self, components: Dict[str, float]) -> float:
        """Calculate data completeness percentage"""
        total_components = len(self.WEIGHTS)
        available_components = len(components)
        return available_components / total_components
    
    def _create_component_record(
        self, date: datetime, components: Dict, metals_instability: float,
        crypto_instability: float, multiplier: float, correlation_regime: str
    ) -> AAPComponentV2:
        """Create detailed component record for audit trail"""
        # Convert numpy types to Python types for PostgreSQL compatibility
        def to_python_float(val):
            if val is None:
                return None
            return float(val)
        
        return AAPComponentV2(
            date=date,
            # Metals components
            gold_dxy_ratio=to_python_float(components.get('gold_dxy_ratio')),
            gold_real_rate_divergence=to_python_float(components.get('gold_real_rate_divergence')),
            silver_outperformance=to_python_float(components.get('silver_outperformance')),
            pgm_weakness=to_python_float(components.get('pgm_weakness')),
            cb_gold_accumulation=to_python_float(components.get('cb_gold_accumulation')),
            comex_registered_inventory=to_python_float(components.get('comex_registered_inventory')),
            oi_to_registered_ratio=to_python_float(components.get('oi_to_registered_ratio')),
            gold_etf_flows=to_python_float(components.get('gold_etf_flows')),
            mining_stock_divergence=to_python_float(components.get('mining_stock_divergence')),
            # Crypto components
            btc_dominance=to_python_float(components.get('btc_dominance')),
            btc_hash_rate=to_python_float(components.get('btc_hash_rate')),
            btc_difficulty=to_python_float(components.get('btc_difficulty')),
            stablecoin_supply=to_python_float(components.get('stablecoin_supply')),
            stablecoin_btc_ratio=to_python_float(components.get('stablecoin_btc_ratio')),
            defi_tvl=to_python_float(components.get('defi_tvl')),
            exchange_outflows=to_python_float(components.get('exchange_outflows')),
            btc_spy_correlation=to_python_float(components.get('btc_spy_correlation')),
            altcoin_weakness=to_python_float(components.get('altcoin_weakness')),
            # Aggregates (stored as instability scores)
            metals_pressure_score=to_python_float(metals_instability),
            crypto_pressure_score=to_python_float(crypto_instability),
            cross_asset_multiplier=to_python_float(multiplier),
            correlation_regime=correlation_regime,
        )
    
    def _map_regime_to_state(self, regime: str) -> str:
        """Map AAP regime to indicator state (RED/YELLOW/GREEN)"""
        regime_to_state = {
            'normal_confidence': 'GREEN',
            'mild_caution': 'YELLOW',
            'monetary_stress': 'YELLOW',
            'liquidity_crisis': 'RED',
            'systemic_breakdown': 'RED',
        }
        return regime_to_state.get(regime, 'YELLOW')
    
    def _update_regime_history(self, date: datetime, regime: str) -> Optional[datetime]:
        """Update regime history tracking"""
        # Get most recent regime history entry
        current = self.db.query(AAPRegimeHistory).filter(
            AAPRegimeHistory.regime_end.is_(None)
        ).order_by(desc(AAPRegimeHistory.regime_start)).first()
        
        if not current:
            # First entry
            new_regime = AAPRegimeHistory(
                regime_start=date,
                regime_name=regime,
                duration_days=1
            )
            self.db.add(new_regime)
            return new_regime.regime_start
        elif current.regime_name != regime:
            # Regime change - close old, open new
            current.regime_end = date
            
            # Calculate statistics for completed regime
            regime_indicators = self.db.query(AAPIndicator).filter(
                AAPIndicator.date >= current.regime_start,
                AAPIndicator.date < date
            ).all()
            
            if regime_indicators:
                scores = [ind.stability_score for ind in regime_indicators]
                current.avg_stability_score = float(np.mean(scores))
                current.min_stability_score = float(min(scores))
                current.max_stability_score = float(max(scores))
                current.duration_days = (date - current.regime_start).days
            
            # Start new regime
            new_regime = AAPRegimeHistory(
                regime_start=date,
                regime_name=regime,
                duration_days=1
            )
            self.db.add(new_regime)
            return new_regime.regime_start
        else:
            # Same regime continues
            current.duration_days = (date - current.regime_start).days + 1
            return current.regime_start

    def _apply_model_updates(self, model, updates: Dict) -> None:
        for key, value in updates.items():
            setattr(model, key, value)

    def _apply_component_updates(self, target: AAPComponentV2, source: AAPComponentV2) -> None:
        for column in AAPComponentV2.__table__.columns:
            if column.name in ("id", "created_at"):
                continue
            setattr(target, column.name, getattr(source, column.name))
