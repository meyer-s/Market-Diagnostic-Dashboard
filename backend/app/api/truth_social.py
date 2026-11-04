from fastapi import APIRouter, HTTPException, Query

from app.services.truth_social import get_truth_social

router = APIRouter(prefix="/research/truth-social")


@router.get("")
def truth_social(year: int | None = Query(None, ge=2022, le=2100)):
    try:
        return get_truth_social(year)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
