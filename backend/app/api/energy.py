from fastapi import APIRouter, Query

from app.services.energy_index import calculate_energy_index, fetch_generation_mix

router = APIRouter(prefix="/energy")


@router.get("/overview")
def get_energy_overview(days: int = Query(365, ge=90, le=1095)):
    data = calculate_energy_index(days=days)
    return {
        "as_of": data["as_of"],
        "regime_label": data["regime_label"],
        "composite_score": data["composite_score"],
        "summary": data["summary"],
        "groups": data["groups"],
        "symbols": data["symbols"],
        "availability": data["availability"],
        "warnings": data["warnings"],
    }


@router.get("/history")
def get_energy_history(days: int = Query(365, ge=90, le=1095)):
    data = calculate_energy_index(days=days)
    return {
        "as_of": data["as_of"],
        "composite_history": data["composite_history"],
        "alt_comparison": data["alt_comparison"],
        "alt_symbols": data["alt_symbols"],
    }


@router.get("/prices")
def get_energy_prices(days: int = Query(365, ge=90, le=1095)):
    data = calculate_energy_index(days=days)
    return {
        "as_of": data["as_of"],
        "fred_prices": data["fred_prices"],
    }


@router.get("/mix")
def get_generation_mix():
    """US electricity generation mix by fuel type (from FRED/EIA)."""
    return fetch_generation_mix()
