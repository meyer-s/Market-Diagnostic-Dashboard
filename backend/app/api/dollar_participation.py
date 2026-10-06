from fastapi import APIRouter, HTTPException, Query

from app.services.dollar_participation import get_dollar_participation


router = APIRouter(prefix="/dollar-participation")


@router.get("")
def dollar_participation(days: int = Query(504, ge=126, le=1260)):
    try:
        return get_dollar_participation(days=days)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Dollar participation data is temporarily unavailable.",
        ) from exc
