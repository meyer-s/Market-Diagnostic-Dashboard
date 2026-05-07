from fastapi import APIRouter, Query

from app.services.agriculture_index import build_agriculture_long_view, calculate_composite_index


router = APIRouter(prefix="/agriculture")


@router.get("/overview")
def get_agriculture_overview(days: int = Query(365, ge=90, le=1095)):
    data = calculate_composite_index(days=days)
    return {
        "as_of": data["as_of"],
        "regime_label": data["regime_label"],
        "stability_score": data["stability_score"],
        "stability_components": data["stability_components"],
        "component_history": data.get("component_history", []),
        "summary": data["summary"],
        "composite": data["composite"],
        "groups": data["groups"],
        "strongest_markets": data["strongest_markets"],
        "weakest_markets": data["weakest_markets"],
        "availability": data["availability"],
        "warnings": data["warnings"],
    }


@router.get("/history")
def get_agriculture_history(days: int = Query(365, ge=90, le=1095)):
    data = calculate_composite_index(days=days)
    return {
        "as_of": data["as_of"],
        "history": data["composite"].get("history", []),
        "changes": data["composite"].get("changes", {}),
        "volatility": data["composite"].get("volatility"),
    }


@router.get("/sectors")
def get_agriculture_sectors(days: int = Query(365, ge=90, le=1095)):
    data = calculate_composite_index(days=days)
    return {
        "as_of": data["as_of"],
        "groups": data["groups"],
        "group_weights": data["composite"].get("group_weights", {}),
        "availability": data["availability"],
    }


@router.get("/correlations")
def get_agriculture_correlations(days: int = Query(365, ge=90, le=1095)):
    data = calculate_composite_index(days=days)
    return {
        "as_of": data["as_of"],
        "correlations": data["correlations"],
        "special_signals": data["special_signals"],
    }


@router.get("/long-view")
def get_agriculture_long_view():
    """Monthly stability history for 30-year lookback."""
    history = build_agriculture_long_view(years=30)
    return {"history": history}


@router.get("/macro")
def get_agriculture_macro(days: int = Query(365, ge=90, le=1095)):
    data = calculate_composite_index(days=days)
    return {
        "as_of": data["as_of"],
        "macro_pressure": data["macro_pressure"],
        "special_signals": data["special_signals"],
        "availability": {
            "missing_macro_series": data["availability"].get("missing_macro_series", []),
        },
    }
