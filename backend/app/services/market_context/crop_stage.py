from __future__ import annotations

from datetime import date, datetime


def _as_date(moment: date | datetime | None) -> date:
    if moment is None:
        return datetime.utcnow().date()
    if isinstance(moment, datetime):
        return moment.date()
    return moment


def get_crop_stage(symbol: str, moment: date | datetime | None = None) -> dict[str, str]:
    current = _as_date(moment)
    month = current.month
    root_symbol = symbol.upper().lstrip("/")
    if root_symbol in {"ZM", "ZL"}:
        root_symbol = "ZS"

    if root_symbol == "ZC":
        if month in {4, 5}:
            return {
                "stage": "planting",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Weather matters mainly through fieldwork delays and early stand establishment.",
                "stage_explanation": "Corn is in the planting window, so rain and soil conditions matter more than heat stress.",
            }
        if month in {6, 7}:
            return {
                "stage": "pollination",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Weather premium is usually highest when pollination is exposed to heat and dryness.",
                "stage_explanation": "Corn is in its most weather-sensitive stretch; hot and dry conditions can threaten yield quickly.",
            }
        if month == 8:
            return {
                "stage": "grain_fill",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Late-summer weather still matters through grain fill and yield confirmation.",
                "stage_explanation": "Corn is filling grain, so sustained stress still matters but sensitivity is fading from peak pollination levels.",
            }
        if month in {9, 10, 11}:
            return {
                "stage": "harvest",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Harvest delays can tighten nearby logistics even when outright yield risk has faded.",
                "stage_explanation": "Corn is in harvest, so rain matters mainly through field access and basis/logistics impacts.",
            }
        return {
            "stage": "post_harvest",
            "weather_sensitivity": "low",
            "seasonal_pressure": "Weather usually has low direct pricing power outside U.S. growing windows.",
            "stage_explanation": "Corn is outside the main U.S. growing season, so weather should carry less weight than demand and stocks data.",
        }

    if root_symbol == "ZS":
        if month in {4, 5, 6}:
            return {
                "stage": "planting",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Rain and fieldwork pace matter during planting, but yield risk is not yet dominant.",
                "stage_explanation": "Soybeans are in planting season, so persistent wet conditions can delay progress and alter acreage confidence.",
            }
        if month in {7, 8}:
            return {
                "stage": "flowering_pod_set",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Weather premium rises during flowering and pod-setting because moisture stress can cap yield potential.",
                "stage_explanation": "Soybeans are in a high-sensitivity reproductive window, so heat and dryness can meaningfully threaten yield.",
            }
        if month in {9, 10, 11}:
            return {
                "stage": "harvest",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Rain matters more for harvest delays and quality than for fresh yield-setting risk.",
                "stage_explanation": "Soybeans are in harvest, so weather mostly affects harvest pace, quality, and short-term logistics.",
            }
        return {
            "stage": "post_harvest",
            "weather_sensitivity": "low",
            "seasonal_pressure": "Direct U.S. weather sensitivity usually fades after harvest unless South American weather becomes dominant.",
            "stage_explanation": "Soybeans are outside the main U.S. weather window, so balance-sheet and demand data should dominate context.",
        }

    if root_symbol == "ZW":
        if month in {12, 1, 2}:
            return {
                "stage": "winter_dormancy",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Winterkill and snow cover matter, but day-to-day weather usually has lower sensitivity than spring growth.",
                "stage_explanation": "Winter wheat is dormant, so weather risk centers on winterkill, snow cover, and hard-freeze events.",
            }
        if month in {3, 4, 5}:
            return {
                "stage": "heading_fill",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Spring weather drives heading, fill, and disease risk across U.S. winter wheat areas.",
                "stage_explanation": "Wheat is in spring growth and heading/fill, making weather highly relevant for final yield outcomes.",
            }
        if month in {6, 7, 8}:
            return {
                "stage": "harvest",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Weather matters through harvest pace, quality, and spring-wheat development in northern Plains.",
                "stage_explanation": "Wheat is in harvest or late development, so weather still matters but with more quality and logistics emphasis.",
            }
        return {
            "stage": "post_harvest",
            "weather_sensitivity": "low",
            "seasonal_pressure": "Outside active growth windows, wheat trades lean more on global supply and export signals.",
            "stage_explanation": "Wheat is outside peak U.S. weather sensitivity, so global supply and export news should carry more weight.",
        }

    if root_symbol == "ZO":
        if month in {4, 5}:
            return {
                "stage": "planting",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Fieldwork pace matters more than outright stress during planting.",
                "stage_explanation": "Oats are in planting season, so moisture and field conditions mainly affect progress.",
            }
        if month in {6, 7, 8}:
            return {
                "stage": "grain_fill",
                "weather_sensitivity": "high",
                "seasonal_pressure": "Northern Plains summer weather matters for yield and quality.",
                "stage_explanation": "Oats are in the active growing window, where heat and rainfall can materially alter yield.",
            }
        if month in {9, 10}:
            return {
                "stage": "harvest",
                "weather_sensitivity": "medium",
                "seasonal_pressure": "Harvest weather affects pace and quality more than fresh yield setting.",
                "stage_explanation": "Oats are in harvest, so weather mostly affects progress and quality.",
            }
        return {
            "stage": "post_harvest",
            "weather_sensitivity": "low",
            "seasonal_pressure": "Weather is usually a secondary driver outside the growing season.",
            "stage_explanation": "Oats are outside the main weather-sensitive window, so fundamental carry and demand matter more.",
        }

    raise KeyError(f"Unsupported agriculture symbol: {symbol}")
