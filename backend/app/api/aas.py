"""Alternative Asset Stability (AAS) Indicator API Endpoints

Provides access to AAS indicator data, components, and regime analysis.

Note: The indicator measures systemic stability - lower scores indicate
less stability and greater alternative asset adoption.
"""

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, func
from datetime import datetime, timedelta
from typing import List, Optional
import numpy as np

from app.utils.db_helpers import get_db_session
from app.models.alternative_assets import (
    AASIndicator,
    AASComponentV2,
    AASRegimeHistory,
    CryptoPrice,
    MacroLiquidityData
)
from app.services.aas_calculator import AASCalculator

router = APIRouter(prefix="/aas", tags=["Alternative Asset Stability"])


@router.get("/current")
def get_current_aas():
    """
    Get the most recent AAS indicator reading.

    Returns:
        - stability_score: 0-100 (higher = more stable system)
        - regime: Current market regime classification
        - primary_driver: What's driving the signal (metals/crypto/coordinated)
        - stress_type: Type of stress being indicated
    """
    with get_db_session() as db:
        indicator = db.query(AASIndicator).order_by(
            desc(AASIndicator.date)
        ).first()
        
        if not indicator:
            raise HTTPException(status_code=404, detail="No AAS data available")
        
        return {
            "date": indicator.date.isoformat(),
            "stability_score": round(indicator.stability_score, 1),
        "pressure_index": round(indicator.pressure_index, 3),
        "regime": indicator.regime,
        "regime_confidence": round(indicator.regime_confidence, 2),
        "regime_days_persistent": indicator.regime_days_persistent,
        "primary_driver": indicator.primary_driver,
        "stress_type": indicator.stress_type,
        "metals_contribution": round(indicator.metals_contribution, 3),
        "crypto_contribution": round(indicator.crypto_contribution, 3),
        "is_critical": bool(indicator.is_critical),
        "is_transitioning": bool(indicator.is_transitioning),
        "changes": {
            "1d": round(indicator.score_1d_change, 1) if indicator.score_1d_change else None,
            "5d": round(indicator.score_5d_change, 1) if indicator.score_5d_change else None,
        },
        "averages": {
            "20d": round(indicator.score_20d_avg, 1) if indicator.score_20d_avg else None,
            "90d": round(indicator.score_90d_avg, 1) if indicator.score_90d_avg else None,
        },
        "context": {
            "vix_level": round(indicator.vix_level, 1) if indicator.vix_level else None,
            "liquidity_regime": indicator.liquidity_regime,
            "fed_pivot_signal": round(indicator.fed_pivot_signal, 2) if indicator.fed_pivot_signal else None,
        },
        "data_quality": {
            "completeness": round(indicator.data_completeness, 2),
            "notes": indicator.calculation_notes,
        },
            "interpretation": _get_regime_interpretation(indicator.regime, indicator.stress_type),
        }


@router.get("/history")
def get_aas_history(
    days: int = Query(90, ge=1, le=730, description="Number of days of history")
):
    """
    Get historical AAS indicator values.
    
    Query params:
        - days: Number of days to retrieve (default 90, max 730)
    """
    with get_db_session() as db:
        start_date = datetime.utcnow() - timedelta(days=days)
        
        indicators = db.query(AASIndicator).filter(
            AASIndicator.date >= start_date
        ).order_by(AASIndicator.date).all()

        if not indicators:
            raise HTTPException(status_code=404, detail="No historical data available")

        by_day = {}
        for ind in indicators:
            by_day[ind.date.date()] = ind
        indicators = sorted(by_day.values(), key=lambda ind: ind.date)
        
        # Calculate SMAs
        scores = [ind.stability_score for ind in indicators]
        sma_20 = []
        sma_200 = []
        
        for i, score in enumerate(scores):
            # 20-day SMA
            start_20 = max(0, i - 19)
            sma_20.append(np.mean(scores[start_20:i+1]))
            
            # 200-day SMA
            start_200 = max(0, i - 199)
            sma_200.append(np.mean(scores[start_200:i+1]))
        
        return {
            "period": {
            "start": indicators[0].date.isoformat(),
            "end": indicators[-1].date.isoformat(),
            "days": len(indicators),
        },
        "data": [
            {
                "date": ind.date.isoformat(),
                "stability_score": round(ind.stability_score, 1),
                "sma_20": round(sma_20[i], 1),
                "sma_200": round(sma_200[i], 1),
                "regime": ind.regime,
                "primary_driver": ind.primary_driver,
                "metals_contribution": round(ind.metals_contribution, 3),
                "crypto_contribution": round(ind.crypto_contribution, 3),
                "is_critical": bool(ind.is_critical),
            }
            for i, ind in enumerate(indicators)
        ],
        "summary": {
            "current_score": round(indicators[-1].stability_score, 1),
            "avg_score": round(sum(ind.stability_score for ind in indicators) / len(indicators), 1),
            "min_score": round(min(ind.stability_score for ind in indicators), 1),
            "max_score": round(max(ind.stability_score for ind in indicators), 1),
                "volatility": round(
                    np.std([ind.stability_score for ind in indicators]), 1
                ) if len(indicators) > 1 else 0,
            }
        }


@router.get("/components/breakdown")
def get_component_breakdown():
    """
    Get structured component breakdown for the AAS breakdown page.
    Returns all 18 components with status, weights, and current values.
    """
    with get_db_session() as db:
        # Get latest indicator and component data
        indicator = db.query(AASIndicator).order_by(desc(AASIndicator.date)).first()
        if not indicator:
            raise HTTPException(status_code=404, detail="No AAS data available")
        
        component = db.query(AASComponentV2).filter(
            AASComponentV2.date == indicator.date
        ).first()
        
        # Define all 18 components with their weights
        component_weights = AASCalculator.WEIGHTS
        
        # Build component list with status
        components_list = []
        
        # Metals components (9)
        metals_comps = [
            ('gold_dxy_ratio', 'metals', getattr(component, 'gold_dxy_ratio', None) if component else None),
            ('gold_real_rate_divergence', 'metals', getattr(component, 'gold_real_rate_divergence', None) if component else None),
            ('silver_outperformance', 'metals', getattr(component, 'silver_outperformance', None) if component else None),
            ('pgm_weakness', 'metals', getattr(component, 'pgm_weakness', None) if component else None),
            ('cb_gold_accumulation', 'metals', getattr(component, 'cb_gold_accumulation', None) if component else None),
            ('comex_registered_inventory', 'metals', getattr(component, 'comex_registered_inventory', None) if component else None),
            ('oi_to_registered_ratio', 'metals', getattr(component, 'oi_to_registered_ratio', None) if component else None),
            ('gold_etf_flows', 'metals', getattr(component, 'gold_etf_flows', None) if component else None),
            ('mining_stock_divergence', 'metals', getattr(component, 'mining_stock_divergence', None) if component else None),
        ]
        
        # Crypto components (9)
        crypto_comps = [
            ('btc_dominance', 'crypto', getattr(component, 'btc_dominance', None) if component else None),
            ('btc_hash_rate', 'crypto', getattr(component, 'btc_hash_rate', None) if component else None),
            ('btc_difficulty', 'crypto', getattr(component, 'btc_difficulty', None) if component else None),
            ('stablecoin_supply', 'crypto', getattr(component, 'stablecoin_supply', None) if component else None),
            ('stablecoin_btc_ratio', 'crypto', getattr(component, 'stablecoin_btc_ratio', None) if component else None),
            ('defi_tvl', 'crypto', getattr(component, 'defi_tvl', None) if component else None),
            ('exchange_outflows', 'crypto', getattr(component, 'exchange_outflows', None) if component else None),
            ('btc_spy_correlation', 'crypto', getattr(component, 'btc_spy_correlation', None) if component else None),
            ('altcoin_weakness', 'crypto', getattr(component, 'altcoin_weakness', None) if component else None),
        ]
        
        all_components = metals_comps + crypto_comps
        
        for name, category, value in all_components:
            weight = component_weights.get(name, 0)
            is_active = value is not None
            contribution = (value * weight) if is_active else 0
            
            components_list.append({
                'name': name,
                'category': category,
                'value': round(value, 4) if is_active else 0,
                'weight': weight,
                'contribution': contribution,
                'status': 'active' if is_active else 'missing',
                'description': _get_component_description(name)
            })
        
        return {
            'date': indicator.date.isoformat(),
            'stability_score': round(indicator.stability_score, 1),
            'pressure_index': round(indicator.pressure_index, 3),
            'regime': indicator.regime,
            'primary_driver': indicator.primary_driver,
            'metals_contribution': round(indicator.metals_contribution, 3),
            'crypto_contribution': round(indicator.crypto_contribution, 3),
            'data_completeness': round(indicator.data_completeness, 2),
            'components': components_list
        }


@router.get("/components/current")
def get_current_components():
    """
    Get detailed component breakdown for the most recent AAS calculation.
    Useful for understanding what's driving the signal.
    """
    with get_db_session() as db:
        component = db.query(AASComponentV2).order_by(
            desc(AASComponentV2.date)
        ).first()
        
        if not component:
            raise HTTPException(status_code=404, detail="No component data available")
        
        return {
            "date": component.date.isoformat(),
            "subsystems": {
                "metals": {
                    "pressure_score": round(component.metals_pressure_score, 3) if component.metals_pressure_score is not None else None,
                    "components": {
                        "gold_dxy_ratio": round(component.gold_dxy_ratio, 3) if component.gold_dxy_ratio is not None else None,
                        "gold_real_rate_divergence": round(component.gold_real_rate_divergence, 3) if component.gold_real_rate_divergence is not None else None,
                        "silver_outperformance": round(component.silver_outperformance, 3) if component.silver_outperformance is not None else None,
                        "pgm_weakness": round(component.pgm_weakness, 3) if component.pgm_weakness is not None else None,
                        "cb_gold_accumulation": round(component.cb_gold_accumulation, 3) if component.cb_gold_accumulation is not None else None,
                        "comex_registered_inventory": round(component.comex_registered_inventory, 3) if component.comex_registered_inventory is not None else None,
                        "oi_to_registered_ratio": round(component.oi_to_registered_ratio, 3) if component.oi_to_registered_ratio is not None else None,
                        "gold_etf_flows": round(component.gold_etf_flows, 3) if component.gold_etf_flows is not None else None,
                        "mining_stock_divergence": round(component.mining_stock_divergence, 3) if component.mining_stock_divergence is not None else None,
                    }
                },
                "crypto": {
                    "pressure_score": round(component.crypto_pressure_score, 3) if component.crypto_pressure_score is not None else None,
                    "components": {
                        "btc_dominance": round(component.btc_dominance, 3) if component.btc_dominance is not None else None,
                        "btc_hash_rate": round(component.btc_hash_rate, 3) if component.btc_hash_rate is not None else None,
                        "btc_difficulty": round(component.btc_difficulty, 3) if component.btc_difficulty is not None else None,
                        "stablecoin_supply": round(component.stablecoin_supply, 3) if component.stablecoin_supply is not None else None,
                        "stablecoin_btc_ratio": round(component.stablecoin_btc_ratio, 3) if component.stablecoin_btc_ratio is not None else None,
                        "defi_tvl": round(component.defi_tvl, 3) if component.defi_tvl is not None else None,
                        "exchange_outflows": round(component.exchange_outflows, 3) if component.exchange_outflows is not None else None,
                        "btc_spy_correlation": round(component.btc_spy_correlation, 3) if component.btc_spy_correlation is not None else None,
                        "altcoin_weakness": round(component.altcoin_weakness, 3) if component.altcoin_weakness is not None else None,
                    }
                }
            },
            "cross_asset": {
                "multiplier": round(component.cross_asset_multiplier, 2),
                "correlation_regime": component.correlation_regime,
            }
        }


@router.get("/components/history")
def get_component_history(
    days: int = Query(365, ge=30, le=730, description="Number of days of history")
):
    """
    Get historical values for all AAS components.
    Returns per-component time series for charting.
    """
    with get_db_session() as db:
        start_date = datetime.utcnow() - timedelta(days=days)
        rows = db.query(AASComponentV2).filter(
            AASComponentV2.date >= start_date
        ).order_by(AASComponentV2.date).all()

        if not rows:
            raise HTTPException(status_code=404, detail="No component history available")

        rows_by_day = {}
        for row in rows:
            rows_by_day[row.date.date()] = row
        rows = sorted(rows_by_day.values(), key=lambda row: row.date)

        component_keys = list(AASCalculator.WEIGHTS.keys())
        history = {key: [] for key in component_keys}

        for row in rows:
            date_value = row.date.isoformat()
            for key in component_keys:
                value = getattr(row, key, None)
                history[key].append({
                    "date": date_value,
                    "value": float(value) if value is not None else None
                })

        return {
            "period": {
                "start": rows[0].date.isoformat(),
                "end": rows[-1].date.isoformat(),
                "days": len(rows),
            },
            "data": history
        }


@router.get("/regime/current")
def get_current_regime():
    """
    Get detailed information about the current market regime.
    """
    with get_db_session() as db:
        indicator = db.query(AASIndicator).order_by(
            desc(AASIndicator.date)
        ).first()
        
        if not indicator:
            raise HTTPException(status_code=404, detail="No regime data available")
        
        regime_history = db.query(AASRegimeHistory).filter(
            AASRegimeHistory.regime_end.is_(None)
        ).first()
        
        return {
            "current_regime": {
                "name": indicator.regime,
            "confidence": round(indicator.regime_confidence, 2),
            "days_persistent": indicator.regime_days_persistent,
            "started": regime_history.regime_start.isoformat() if regime_history else None,
        },
        "signals": {
            "primary_driver": indicator.primary_driver,
            "stress_type": indicator.stress_type,
            "stability_score": round(indicator.stability_score, 1),
        },
            "interpretation": _get_regime_interpretation(indicator.regime, indicator.stress_type),
            "context": {
                "liquidity_regime": indicator.liquidity_regime,
                "is_critical": bool(indicator.is_critical),
                "is_transitioning": bool(indicator.is_transitioning),
                "circuit_breaker_active": bool(indicator.circuit_breaker_active),
            }
        }


@router.get("/regime/history")
def get_regime_history(
    limit: int = Query(10, ge=1, le=50, description="Number of regime periods")
):
    """
    Get historical regime transitions and their characteristics.
    """
    with get_db_session() as db:
        regimes = db.query(AASRegimeHistory).order_by(
            desc(AASRegimeHistory.regime_start)
        ).limit(limit).all()
        
        if not regimes:
            raise HTTPException(status_code=404, detail="No regime history available")
        
        return {
            "regimes": [
                {
                    "name": regime.regime_name,
                    "started": regime.regime_start.isoformat(),
                    "ended": regime.regime_end.isoformat() if regime.regime_end else "ongoing",
                    "duration_days": regime.duration_days,
                    "stability_scores": {
                        "average": round(regime.avg_stability_score, 1) if regime.avg_stability_score else None,
                        "min": round(regime.min_stability_score, 1) if regime.min_stability_score else None,
                        "max": round(regime.max_stability_score, 1) if regime.max_stability_score else None,
                    },
                    "outcome": regime.market_outcome,
                }
                for regime in regimes
            ]
        }


@router.get("/dashboard")
def get_dashboard_summary():
    """
    Get comprehensive AAS dashboard summary with all key metrics.
    Designed for main dashboard display.
    """
    with get_db_session() as db:
        # Current indicator
        current = db.query(AASIndicator).order_by(
            desc(AASIndicator.date)
        ).first()
        
        if not current:
            raise HTTPException(status_code=404, detail="No AAS data available")
        
        # Recent history for trend
        recent = db.query(AASIndicator).filter(
            AASIndicator.date >= current.date - timedelta(days=30)
        ).order_by(AASIndicator.date).all()
        
        # Current regime details
        regime_history = db.query(AASRegimeHistory).filter(
            AASRegimeHistory.regime_end.is_(None)
        ).first()
        
        # Components
        components = db.query(AASComponentV2).filter(
            AASComponentV2.date == current.date
        ).first()
        
        return {
            "headline": {
            "stability_score": round(current.stability_score, 1),
            "regime": current.regime,
            "status": _get_status_level(current.stability_score),
            "trend": _calculate_trend(recent),
            "alert_level": "CRITICAL" if current.is_critical else "WATCH" if current.is_transitioning else "NORMAL",
        },
        "current_state": {
            "date": current.date.isoformat(),
            "regime": {
                "name": current.regime,
                "confidence": round(current.regime_confidence, 2),
                "days_persistent": current.regime_days_persistent,
            },
            "drivers": {
                "primary": current.primary_driver,
                "metals_pressure": round(current.metals_contribution, 2),
                "crypto_pressure": round(current.crypto_contribution, 2),
            },
            "stress_type": current.stress_type,
        },
        "subsystem_breakdown": {
            "metals": {
                "pressure": round(components.metals_pressure_score, 2) if components else None,
                "key_signals": _get_top_metal_signals(components) if components else []
            },
            "crypto": {
                "pressure": round(components.crypto_pressure_score, 2) if components else None,
                "key_signals": _get_top_crypto_signals(components) if components else []
            }
        },
        "context": {
            "liquidity_regime": current.liquidity_regime,
            "vix_level": round(current.vix_level, 1) if current.vix_level else None,
            "fed_pivot_signal": round(current.fed_pivot_signal, 2) if current.fed_pivot_signal else None,
        },
        "recent_changes": {
            "1d": round(current.score_1d_change, 1) if current.score_1d_change else None,
            "5d": round(current.score_5d_change, 1) if current.score_5d_change else None,
            "20d_avg": round(current.score_20d_avg, 1) if current.score_20d_avg else None,
        },
            "interpretation": _get_regime_interpretation(current.regime, current.stress_type),
            "chart_data": [
                {
                    "date": ind.date.isoformat(),
                    "score": round(ind.stability_score, 1),
                    "regime": ind.regime,
                }
                for ind in recent
            ]
        }


@router.post("/calculate")
def trigger_calculation(
    date: Optional[str] = Query(None, description="Date to calculate (YYYY-MM-DD), defaults to today")
):
    """
    Manually trigger AAS calculation for a specific date.
    Admin/development endpoint.
    """
    if date:
        try:
            target_date = datetime.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    with get_db_session() as db:
        calculator = AASCalculator(db)
        indicator = calculator.calculate_for_date(target_date)
        
        if not indicator:
            raise HTTPException(
                status_code=500,
                detail="Calculation failed - insufficient data or error occurred"
            )
        
        return {
            "success": True,
            "date": indicator.date.isoformat(),
            "stability_score": round(indicator.stability_score, 1),
            "regime": indicator.regime,
        }
# ===== HELPER FUNCTIONS =====

def _get_regime_interpretation(regime: str, stress_type: str) -> dict:
    """Generate human-readable regime interpretation"""
    interpretations = {
        "normal_confidence": {
            "summary": "Traditional financial system functioning normally",
            "meaning": "Alternative assets behaving as portfolio diversifiers, not flight-to-safety vehicles. No systemic trust issues detected.",
            "implications": "Equities and credit markets likely stable. Normal risk-taking behavior.",
            "watch_for": "Early signs of monetary stress or liquidity tightening.",
        },
        "mild_caution": {
            "summary": "Early alternative asset accumulation detected",
            "meaning": "Hedging behavior emerging. Some participants questioning traditional asset valuations or monetary policy.",
            "implications": "Monitor for acceleration. May be precursor to broader stress or temporary volatility.",
            "watch_for": "Coordinated moves in metals and crypto. Liquidity conditions tightening.",
        },
        "monetary_stress": {
            "summary": "Significant pressure toward alternative assets",
            "meaning": "Fiat currency credibility questions emerging. Inflation fears or policy uncertainty driving allocation shifts.",
            "implications": "Elevated risk of market volatility. Traditional assets under pressure.",
            "watch_for": "Physical/paper divergences. Central bank policy errors. Regime transition signals.",
        },
        "liquidity_crisis": {
            "summary": "Sharp reallocation to alternative stores of value",
            "meaning": "System plumbing under strain. Paper markets disconnecting from physical. Dollar shortage or collateral stress likely.",
            "implications": "High-risk environment. Forced liquidations possible. Credit spreads widening.",
            "watch_for": "Systemic breaks. Intervention from central banks. Flight to ultimate liquidity.",
        },
        "systemic_breakdown": {
            "summary": "CRITICAL: Flight from fiat accelerating",
            "meaning": "Deep crisis of confidence in traditional monetary system. Monetary regime questions active.",
            "implications": "Extreme volatility. Potential for policy regime change. Historical inflection point.",
            "watch_for": "Central bank emergency actions. Currency crises. Political instability.",
        }
    }
    
    base = interpretations.get(regime, interpretations["normal_confidence"])
    
    # Add stress-type specific context
    stress_context = {
        "monetary": "Driven by inflation fears or currency debasement concerns",
        "liquidity": "Driven by tightness in financial plumbing and collateral markets",
        "speculative": "May be driven by risk-on speculation rather than systemic distrust",
        "systemic": "Fundamental questions about monetary regime sustainability",
    }
    
    base["stress_context"] = stress_context.get(stress_type, "Mixed signals")
    
    return base


def _get_status_level(stability_score: float) -> str:
    """Convert stability score to status level"""
    if stability_score >= 90:
        return "STABLE"
    elif stability_score >= 70:
        return "WATCH"
    elif stability_score >= 40:
        return "CAUTION"
    elif stability_score >= 20:
        return "WARNING"
    else:
        return "CRITICAL"


def _calculate_trend(indicators: List[AASIndicator]) -> str:
    """Calculate recent trend direction"""
    if len(indicators) < 5:
        return "insufficient_data"
    
    recent_scores = [ind.stability_score for ind in indicators[-5:]]
    
    # Simple linear trend
    trend = recent_scores[-1] - recent_scores[0]
    
    if trend > 5:
        return "improving"
    elif trend < -5:
        return "deteriorating"
    else:
        return "stable"


def _get_top_metal_signals(component: AASComponentV2) -> List[dict]:
    """Identify top metal signals driving pressure"""
    signals = []
    
    if component.oi_to_registered_ratio and component.oi_to_registered_ratio > 0.65:
        signals.append({
            "name": "Paper vs Physical Stress",
            "value": round(component.oi_to_registered_ratio, 2),
            "interpretation": "Open interest elevated vs registered inventory"
        })
    
    if component.gold_dxy_ratio and component.gold_dxy_ratio > 0.65:
        signals.append({
            "name": "Gold vs Dollar",
            "value": round(component.gold_dxy_ratio, 2),
            "interpretation": "Gold strength against dollar"
        })
    
    if component.gold_real_rate_divergence and component.gold_real_rate_divergence > 0.65:
        signals.append({
            "name": "Gold vs Real Rates",
            "value": round(component.gold_real_rate_divergence, 2),
            "interpretation": "Gold rising despite high real rates"
        })

    if component.gold_etf_flows and component.gold_etf_flows > 0.65:
        signals.append({
            "name": "Gold ETF Inflows",
            "value": round(component.gold_etf_flows, 2),
            "interpretation": "Institutional gold demand rising"
        })

    return signals[:3]  # Top 3


def _get_top_crypto_signals(component: AASComponentV2) -> List[dict]:
    """Identify top crypto signals driving pressure"""
    signals = []
    
    if component.btc_dominance and component.btc_dominance > 0.65:
        signals.append({
            "name": "BTC Dominance",
            "value": round(component.btc_dominance, 2),
            "interpretation": "Flight to digital gold"
        })
    
    if component.exchange_outflows and component.exchange_outflows > 0.65:
        signals.append({
            "name": "Exchange Outflows",
            "value": round(component.exchange_outflows, 2),
            "interpretation": "Self-custody preference rising"
        })
    
    if component.btc_spy_correlation and component.btc_spy_correlation > 0.65:
        signals.append({
            "name": "BTC vs SPY Decoupling",
            "value": round(component.btc_spy_correlation, 2),
            "interpretation": "BTC behaving as alternative asset"
        })
    
    return signals[:3]  # Top 3


def _get_component_description(component_key: str) -> str:
    descriptions = {
        # Metals
        "gold_dxy_ratio": "Gold price normalized by dollar strength; higher implies hedge demand.",
        "gold_real_rate_divergence": "Gold strength versus real rates; divergence implies monetary stress.",
        "silver_outperformance": "Silver vs gold ratio; low values signal defensive posture.",
        "pgm_weakness": "Platinum/palladium underperformance vs gold; indicates industrial weakness.",
        "cb_gold_accumulation": "Central bank net gold buying momentum; sustained purchases signal concern.",
        "comex_registered_inventory": "Deliverable COMEX inventory; declines indicate physical stress.",
        "oi_to_registered_ratio": "Open interest vs registered inventory; high ratios signal squeeze risk.",
        "gold_etf_flows": "Net GLD flows; positive flows reflect institutional flight to safety.",
        "mining_stock_divergence": "Gold miners vs gold; underperformance implies stress in risk assets.",
        # Crypto
        "btc_dominance": "BTC share of total crypto market cap; rising implies flight to quality.",
        "btc_hash_rate": "Network security proxy; rising indicates infrastructure commitment.",
        "btc_difficulty": "Mining competition; higher difficulty implies stronger incentives.",
        "stablecoin_supply": "USDT+USDC supply; growth shows fiat entering crypto rails.",
        "stablecoin_btc_ratio": "Stablecoins vs BTC market cap; high values suggest dry powder.",
        "defi_tvl": "Total value locked in DeFi protocols; growth signals adoption.",
        "exchange_outflows": "BTC leaving exchanges; net outflows indicate self-custody preference.",
        "btc_spy_correlation": "BTC-SPY correlation; negative indicates alternative behavior.",
        "altcoin_weakness": "Altcoins underperforming BTC; weakness signals risk-off crypto.",
    }
    return descriptions.get(component_key, f"Component: {component_key}")
