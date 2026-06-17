"""
Sector Summary API - Aggregate Metrics for Dashboard Integration

Provides high-level sector analysis metrics for dashboard widgets and quick insights.
Focuses on macro positioning indicators rather than detailed sector-by-sector breakdowns.

Key Metrics:
- Defensive vs Cyclical Performance: Average scores for each category
- Regime Alignment: How well current positioning matches expected market behavior
- Sector Breadth: Count of improving vs deteriorating sectors across horizons

This endpoint powers the SectorDivergenceWidget on the main Dashboard.
"""

from fastapi import APIRouter, HTTPException
from app.utils.db_helpers import get_db_session
from app.models.sector_projection import SectorProjectionValue
from app.services.sector_projection import get_latest_sector_projection_run
from app.services.sector_divergence import (
    CYCLICAL_SECTORS,
    DEFENSIVE_SECTORS,
    compute_alignment_score,
    compute_breadth_counts,
)

router = APIRouter()


@router.get("/sectors/summary")
def get_sector_summary():
    """
    Get aggregate sector metrics for dashboard integration:
    - Defensive vs Cyclical performance split
    - Regime alignment score
    - Sector breadth (improving vs deteriorating)
    """
    with get_db_session() as db:
        # Get latest projection run
        run = get_latest_sector_projection_run(db)
        if not run:
            raise HTTPException(status_code=404, detail="No sector projections available")
        
        # Get all values for the latest run
        values = db.query(SectorProjectionValue).filter_by(run_id=run.id).all()
        
        # Organize by horizon
        by_horizon = {"T": [], "3m": [], "6m": [], "12m": []}
        for v in values:
            if v.horizon in by_horizon:
                by_horizon[v.horizon].append({
                    "symbol": v.sector_symbol,
                    "name": v.sector_name,
                    "score": v.score_total,
                    "rank": v.rank,
                })
        
        # Calculate defensive vs cyclical split (using 3m scores)
        data_3m = by_horizon["3m"]
        defensive_scores = [s["score"] for s in data_3m if s["symbol"] in DEFENSIVE_SECTORS]
        cyclical_scores = [s["score"] for s in data_3m if s["symbol"] in CYCLICAL_SECTORS]
        
        defensive_avg = sum(defensive_scores) / len(defensive_scores) if defensive_scores else 50
        cyclical_avg = sum(cyclical_scores) / len(cyclical_scores) if cyclical_scores else 50
        
        system_state = run.system_state
        spread = defensive_avg - cyclical_avg
        alignment_score = compute_alignment_score(system_state, spread)
        
        breadth = compute_breadth_counts(by_horizon)
        
        # Top defensive and cyclical sectors (3m)
        defensive_top = sorted([s for s in data_3m if s["symbol"] in DEFENSIVE_SECTORS], 
                               key=lambda x: x["score"], reverse=True)[:2]
        cyclical_top = sorted([s for s in data_3m if s["symbol"] in CYCLICAL_SECTORS], 
                              key=lambda x: x["score"], reverse=True)[:2]
        
        return {
            "as_of_date": str(run.as_of_date),
            "system_state": system_state,
            "defensive_avg": round(defensive_avg, 1),
            "cyclical_avg": round(cyclical_avg, 1),
            "defensive_vs_cyclical": round(spread, 1),
            "regime_alignment_score": round(alignment_score, 1),
            "sector_breadth": breadth,
            "top_defensive": defensive_top,
            "top_cyclical": cyclical_top,
        }
