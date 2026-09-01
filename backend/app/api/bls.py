from fastapi import APIRouter, HTTPException, Query

from app.services.bls_lens import BlsLensUnavailable, get_bls_lens_payload


router = APIRouter(prefix="/bls")


@router.get("/lens")
async def get_bls_lens(years: int = Query(10, ge=3, le=10)):
    """Return a coherent, revision-aware view of official monthly BLS data."""

    try:
        return await get_bls_lens_payload(years)
    except BlsLensUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
