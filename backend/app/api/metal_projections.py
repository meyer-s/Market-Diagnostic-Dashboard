"""
Metal Projections API
Provides technical projections and classification for precious metals
"""

from fastapi import APIRouter
from typing import Dict, Any

from app.services.metal_projections import compute_all_metal_projections

router = APIRouter()


@router.get("/projections/latest")
def get_metal_projections() -> Dict[str, Any]:
    """
    Get latest technical projections for all precious metals
    
    Returns:
    - Projections for AU, AG, PT, PD with technical scores
    - Support/resistance levels
    - Winner/Neutral/Loser classification
    - Technical indicators (RSI, SMAs, momentum)
    """
    return compute_all_metal_projections()
