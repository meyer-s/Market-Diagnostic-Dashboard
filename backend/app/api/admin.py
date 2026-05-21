from fastapi import APIRouter, Depends, HTTPException
from app.services.ingestion.etl_runner import ETLRunner
from app.services.indicator_metadata import normalize_indicator_code, get_display_indicator_name
from app.utils.db_helpers import get_db_session
from app.api.deps import require_admin_key

router = APIRouter(dependencies=[Depends(require_admin_key)])
etl = ETLRunner()


@router.post("/ingest/run")
async def run_all_indicators():
    """Trigger ingestion for ALL indicators."""
    try:
        results = await etl.ingest_all_indicators()
        status = etl.update_system_status()
        return {
            "message": "Ingestion completed",
            "results": results,
            "system_status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ingest/{code}")
async def run_single_indicator(code: str):
    """Trigger ingestion for a single indicator."""
    try:
        canonical_code = normalize_indicator_code(code)
        result = await etl.ingest_indicator(canonical_code)
        status = etl.update_system_status()
        display_label = get_display_indicator_name(canonical_code, canonical_code)
        return {
            "message": f"Ingestion completed for {display_label}",
            "result": result,
            "system_status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/status/update")
def update_system_status():
    """Re-run only the system status aggregation."""
    try:
        status = etl.update_system_status()
        return {
            "message": "System status updated",
            "system_status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backfill")
async def backfill_historical_data(days: int = 365):
    """Backfill historical data for all indicators."""
    try:
        results = await etl.backfill_all_indicators(days=days)
        status = etl.update_system_status()
        
        success_count = sum(1 for r in results if "error" not in r)
        total_backfilled = sum(r.get("backfilled", 0) for r in results if "backfilled" in r)
        
        return {
            "message": f"Backfill completed for {days} days",
            "success_count": success_count,
            "total_count": len(results),
            "total_datapoints": total_backfilled,
            "results": results,
            "system_status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear-refetch/{code}")
async def clear_and_refetch_indicator(code: str, days: int = 365):
    """Clear all data for an indicator and refetch it. Useful for fixing corrupt data."""
    from app.models.indicator_value import IndicatorValue
    from app.models.indicator import Indicator

    canonical_code = normalize_indicator_code(code)
    display_label = get_display_indicator_name(canonical_code, canonical_code)

    # Delete phase — session is closed before the long-running ETL starts
    with get_db_session() as db:
        indicator = db.query(Indicator).filter(Indicator.code == canonical_code).first()
        if not indicator:
            raise HTTPException(status_code=404, detail=f"Indicator {code} not found")

        deleted_count = db.query(IndicatorValue).filter(
            IndicatorValue.indicator_id == indicator.id
        ).delete()
        db.commit()

    # Refetch phase — runs after session is fully closed
    try:
        result = await etl.ingest_indicator(canonical_code, backfill_days=days)
        status = etl.update_system_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "message": f"Cleared {deleted_count} records and refetched {display_label}",
        "deleted_records": deleted_count,
        "result": result,
        "system_status": status
    }
