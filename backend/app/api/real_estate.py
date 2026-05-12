from fastapi import APIRouter, Query

from app.services.real_estate_index import calculate_real_estate_index


router = APIRouter(prefix="/real-estate")


@router.get("/overview")
def get_real_estate_overview(days: int = Query(365, ge=90, le=1095)):
    data = calculate_real_estate_index(days=days)
    return {
        "as_of": data["as_of"],
        "regime_label": data["regime_label"],
        "composite_score": data["composite_score"],
        "summary": data["summary"],
        "groups": data["groups"],
        "symbols": data["symbols"],
        "factors": data["factors"],
        "metrics": data["metrics"],
        "availability": data["availability"],
        "warnings": data["warnings"],
    }


@router.get("/history")
def get_real_estate_history(days: int = Query(365, ge=90, le=1095)):
    data = calculate_real_estate_index(days=days)
    return {
        "as_of": data["as_of"],
        "composite_history": data["composite_history"],
        "factor_history": data["factor_history"],
    }


@router.get("/transmission")
def get_real_estate_transmission(days: int = Query(365, ge=90, le=1095)):
    data = calculate_real_estate_index(days=days)
    return {
        "as_of": data["as_of"],
        **data["transmission"],
    }


@router.get("/context")
def get_real_estate_context(days: int = Query(1095, ge=365, le=3650)):
    data = calculate_real_estate_index(days=days)
    return {
        "as_of": data["as_of"],
        **data["context"],
    }
