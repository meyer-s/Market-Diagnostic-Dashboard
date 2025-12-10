"""
Dow Theory API endpoints
"""

from fastapi import APIRouter
from app.services.dow_theory import get_dow_theory_data, get_dow_theory_history

router = APIRouter(prefix="/dow-theory", tags=["dow-theory"])


@router.get("")
async def get_dow_theory():
    """
    Get current Dow Theory market metrics.
    
    Returns:
    - market_direction: Composite direction score (-inf to +inf, smoothed)
    - direction_state: UP, DOWN, or NEUTRAL
    - signal_strength: WEAK, MODERATE, or STRONG
    - confirmation_state: BULL, BEAR, or MIXED (DJI/DJT alignment)
    - strain_score: Market strain (0-100+)
    - strain_level: LOW, MODERATE, HIGH, or CRITICAL
    - divergence: Absolute difference between DJI and DJT ROC
    - util_outperformance: Utility outperformance vs Industrials
    - etf_direction: ETF proxy direction (DIA/IYT)
    - futures_direction: Futures proxy direction (YM/CL/ZN)
    - components: Raw ROC values and alignment score
    """
    return get_dow_theory_data()


@router.get("/history")
async def get_dow_theory_hist():
    """
    Get historical Dow Theory market direction for charting.
    
    Returns 90 days of market direction data points.
    """
    return get_dow_theory_history()
