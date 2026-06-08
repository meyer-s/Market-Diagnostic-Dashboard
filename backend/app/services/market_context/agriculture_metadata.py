from __future__ import annotations

from app.services.agriculture_index import AGRICULTURE_SYMBOLS
from app.services.market_context.types import CommodityMetadata, WeatherRegion


CBOT_GRAIN_SESSION_PROFILE_ID = "cbot_grains_et"


_REGIONS = {
    # Coordinates are centered on production belts (not state capitals), and grouped by
    # historically high-volume USDA/NASS production concentration.
    "iowa": WeatherRegion("iowa", "Iowa Corn Belt", "IA", 42.07, -93.53),
    "illinois": WeatherRegion("illinois", "Central Illinois Corn Belt", "IL", 40.00, -89.20),
    "nebraska": WeatherRegion("nebraska", "Eastern Nebraska Corn Belt", "NE", 41.30, -98.00),
    "indiana": WeatherRegion("indiana", "Central Indiana Corn Belt", "IN", 39.90, -86.50),
    "minnesota": WeatherRegion("minnesota", "Southern Minnesota Corn Belt", "MN", 44.30, -94.60),
    "south_dakota": WeatherRegion("south_dakota", "Eastern South Dakota Corn Belt", "SD", 44.20, -97.00),
    "kansas": WeatherRegion("kansas", "Kansas Wheat Belt", "KS", 38.50, -98.30),
    "ohio": WeatherRegion("ohio", "Northwest Ohio Soy Belt", "OH", 41.30, -83.70),
    "missouri": WeatherRegion("missouri", "Northern Missouri Soy Belt", "MO", 39.10, -92.60),
    "oklahoma": WeatherRegion("oklahoma", "Oklahoma Wheat Belt", "OK", 36.00, -97.50),
    "north_dakota": WeatherRegion("north_dakota", "North Dakota Plains", "ND", 47.40, -100.50),
    "montana": WeatherRegion("montana", "North-Central Montana Wheat Belt", "MT", 47.00, -109.80),
    "washington": WeatherRegion("washington", "Washington Palouse Wheat Belt", "WA", 46.80, -117.20),
    "texas": WeatherRegion("texas", "Texas Panhandle/Plains", "TX", 35.30, -101.80),
    "arkansas": WeatherRegion("arkansas", "Arkansas Delta", "AR", 34.80, -91.50),
    "louisiana": WeatherRegion("louisiana", "Louisiana Rice Belt", "LA", 30.90, -91.80),
    "mississippi": WeatherRegion("mississippi", "Mississippi Delta", "MS", 33.40, -90.70),
    "california": WeatherRegion("california", "California Central Valley", "CA", 36.60, -119.70),
    "georgia": WeatherRegion("georgia", "South Georgia Cotton Belt", "GA", 31.60, -83.50),
    "north_carolina": WeatherRegion("north_carolina", "Eastern North Carolina Cotton Belt", "NC", 35.50, -77.80),
    "wisconsin": WeatherRegion("wisconsin", "Central Wisconsin Oats Belt", "WI", 44.50, -89.60),
    "pennsylvania": WeatherRegion("pennsylvania", "Central Pennsylvania Oats Belt", "PA", 40.80, -77.80),
    "florida": WeatherRegion("florida", "Florida Citrus Belt", "FL", 27.90, -81.70),
    "arizona": WeatherRegion("arizona", "Arizona Desert Citrus Belt", "AZ", 32.70, -114.60),
}

_CORN_REGIONS = (
    _REGIONS["iowa"],
    _REGIONS["illinois"],
    _REGIONS["nebraska"],
    _REGIONS["indiana"],
    _REGIONS["minnesota"],
    _REGIONS["south_dakota"],
    _REGIONS["kansas"],
)

_SOY_REGIONS = (
    _REGIONS["illinois"],
    _REGIONS["iowa"],
    _REGIONS["minnesota"],
    _REGIONS["indiana"],
    _REGIONS["nebraska"],
    _REGIONS["ohio"],
    _REGIONS["missouri"],
)

_WHEAT_REGIONS = (
    _REGIONS["kansas"],
    _REGIONS["north_dakota"],
    _REGIONS["montana"],
    _REGIONS["washington"],
    _REGIONS["oklahoma"],
    _REGIONS["texas"],
    _REGIONS["south_dakota"],
)

_RICE_REGIONS = (
    _REGIONS["arkansas"],
    _REGIONS["california"],
    _REGIONS["louisiana"],
    _REGIONS["missouri"],
    _REGIONS["mississippi"],
    _REGIONS["texas"],
)

_CITRUS_REGIONS = (
    _REGIONS["florida"],
    _REGIONS["california"],
    _REGIONS["texas"],
    _REGIONS["arizona"],
)

_OATS_REGIONS = (
    _REGIONS["north_dakota"],
    _REGIONS["minnesota"],
    _REGIONS["south_dakota"],
    _REGIONS["wisconsin"],
    _REGIONS["iowa"],
    _REGIONS["pennsylvania"],
)

_COTTON_REGIONS = (
    _REGIONS["texas"],
    _REGIONS["georgia"],
    _REGIONS["mississippi"],
    _REGIONS["arkansas"],
    _REGIONS["california"],
    _REGIONS["north_carolina"],
)

_SPRING_WHEAT_REGIONS = (
    _REGIONS["north_dakota"],
    _REGIONS["montana"],
    _REGIONS["minnesota"],
    _REGIONS["south_dakota"],
)

_INDEX_SYMBOL_MAP = {symbol.code: symbol for symbol in AGRICULTURE_SYMBOLS}

_DERIVED_WEATHER_REGIONS: dict[str, tuple[WeatherRegion, ...]] = {
    "KE": _WHEAT_REGIONS,
    "MW": _SPRING_WHEAT_REGIONS,
    "ZR": _RICE_REGIONS,
    "CT": _COTTON_REGIONS,
    "OJ": _CITRUS_REGIONS,
}

_DERIVED_RELATED_REPORTS: dict[str, tuple[str, ...]] = {
    "KE": ("WASDE", "Crop Progress", "Crop Production", "Export Inspections"),
    "MW": ("WASDE", "Crop Progress", "Crop Production", "Export Inspections"),
    "ZR": ("WASDE", "Crop Progress", "Crop Production"),
    "CT": ("WASDE", "Crop Progress", "Crop Production", "Acreage"),
    "RS": ("WASDE", "Crop Production"),
}

_DERIVED_EXCHANGES: dict[str, str] = {
    "KE": "KCBT",
    "MW": "MGEX",
    "LE": "CME",
    "GF": "CME",
    "HE": "CME",
    "DC": "CME",
    "DAIRY_CLASS_IV": "CME",
    "KC": "ICE US",
    "CC": "ICE US",
    "SB": "ICE US",
    "CT": "ICE US",
    "OJ": "ICE US",
    "RS": "ICE US",
    "LBR": "CME",
    "SYP": "NASDAQ",
    "FERT_N": "NYSE",
    "FERT_P": "NYSE",
    "FERT_K": "NYSE",
}


def _fallback_group_defaults(group: str) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    if group == "livestock":
        return (
            ("feed costs", "herd expansion", "consumer protein demand"),
            ("beef and pork demand", "packer margins", "export demand"),
            ("herd size", "weights", "feed availability"),
        )
    if group == "dairy":
        return (
            ("milk production", "feed costs", "global dairy trade"),
            ("cheese demand", "butter demand", "export demand"),
            ("milk output", "cow inventories", "processing capacity"),
        )
    if group == "softs":
        return (
            ("weather risk", "export flows", "currency sensitivity"),
            ("global consumption", "import demand", "refining demand"),
            ("crop size", "quality", "harvest pace"),
        )
    if group == "lumber":
        return (
            ("housing demand", "mill curtailments", "construction activity"),
            ("housing starts", "repair demand", "builder sentiment"),
            ("mill output", "inventories", "log supply"),
        )
    if group == "fertilizer_inputs":
        return (
            ("crop margins", "natural gas costs", "global nutrient trade"),
            ("planting demand", "inventory restocking", "export demand"),
            ("production rates", "input costs", "global supply"),
        )
    return (
        ("weather risk", "export flows", "global supply"),
        ("domestic demand", "export demand", "processing demand"),
        ("yield", "acreage", "ending stocks"),
    )


def _fallback_metadata(symbol: str) -> CommodityMetadata | None:
    instrument = _INDEX_SYMBOL_MAP.get(symbol)
    if instrument is None:
        return None

    global_drivers, demand_drivers, supply_drivers = _fallback_group_defaults(instrument.group)
    return CommodityMetadata(
        root_symbol=instrument.code,
        display_name=instrument.name,
        commodity_group=instrument.group,
        exchange=_DERIVED_EXCHANGES.get(instrument.code, "CME"),
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=_DERIVED_RELATED_REPORTS.get(instrument.code, ()),
        weather_regions=_DERIVED_WEATHER_REGIONS.get(instrument.code, ()),
        crop_stages=("production_cycle",),
        global_drivers=global_drivers,
        demand_drivers=demand_drivers,
        supply_drivers=supply_drivers,
    )


AGRICULTURE_COMMODITY_METADATA: dict[str, CommodityMetadata] = {
    "ZC": CommodityMetadata(
        root_symbol="ZC",
        display_name="Corn",
        commodity_group="grains",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=(
            "WASDE",
            "Crop Progress",
            "Export Sales",
            "Export Inspections",
            "Grain Stocks",
            "Acreage",
            "Prospective Plantings",
        ),
        weather_regions=_CORN_REGIONS,
        crop_stages=("planting", "pollination", "grain_fill", "harvest", "post_harvest"),
        global_drivers=("Brazil corn", "Argentina corn", "China demand", "Ukraine exports"),
        demand_drivers=("ethanol", "feed", "exports"),
        supply_drivers=("yield", "acreage", "ending stocks"),
    ),
    "ZS": CommodityMetadata(
        root_symbol="ZS",
        display_name="Soybeans",
        commodity_group="grains",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=(
            "WASDE",
            "Crop Progress",
            "Export Sales",
            "Export Inspections",
            "Grain Stocks",
            "Acreage",
            "Prospective Plantings",
        ),
        weather_regions=_SOY_REGIONS,
        crop_stages=("planting", "flowering_pod_set", "harvest", "post_harvest"),
        global_drivers=("Brazil soybeans", "Argentina soybeans", "China imports"),
        demand_drivers=("exports", "crush", "China demand"),
        supply_drivers=("yield", "acreage", "ending stocks"),
        aliases=("ZM", "ZL"),
    ),
    "ZW": CommodityMetadata(
        root_symbol="ZW",
        display_name="Wheat",
        commodity_group="grains",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=(
            "WASDE",
            "Crop Progress",
            "Export Sales",
            "Export Inspections",
            "Grain Stocks",
            "Crop Production",
        ),
        weather_regions=_WHEAT_REGIONS,
        crop_stages=("winter_dormancy", "heading_fill", "harvest", "post_harvest"),
        global_drivers=("Russia wheat", "Ukraine exports", "EU wheat", "Australia wheat", "Black Sea supply"),
        demand_drivers=("exports", "feed use"),
        supply_drivers=("yield", "acreage", "ending stocks"),
    ),
    "ZM": CommodityMetadata(
        root_symbol="ZM",
        display_name="Soybean Meal",
        commodity_group="oilseeds",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=("WASDE", "Export Inspections", "Crop Progress"),
        weather_regions=_SOY_REGIONS,
        crop_stages=("planting", "flowering_pod_set", "harvest", "post_harvest"),
        global_drivers=("Argentina soymeal", "Brazil soybeans", "China demand"),
        demand_drivers=("feed demand", "crush margin"),
        supply_drivers=("soybean crush", "soybean supply"),
    ),
    "ZL": CommodityMetadata(
        root_symbol="ZL",
        display_name="Soybean Oil",
        commodity_group="oilseeds",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=("WASDE", "Export Inspections", "Crop Progress"),
        weather_regions=_SOY_REGIONS,
        crop_stages=("planting", "flowering_pod_set", "harvest", "post_harvest"),
        global_drivers=("vegetable oil balance", "biofuel demand", "Brazil soybeans"),
        demand_drivers=("biofuel", "food demand"),
        supply_drivers=("soybean crush", "veg oil stocks"),
    ),
    "ZO": CommodityMetadata(
        root_symbol="ZO",
        display_name="Oats",
        commodity_group="grains",
        exchange="CBOT",
        trading_hours_profile=CBOT_GRAIN_SESSION_PROFILE_ID,
        related_reports=("WASDE", "Crop Progress", "Export Inspections"),
        weather_regions=_OATS_REGIONS,
        crop_stages=("planting", "grain_fill", "harvest", "post_harvest"),
        global_drivers=("Canadian oats",),
        demand_drivers=("feed demand", "food demand"),
        supply_drivers=("yield", "acreage", "ending stocks"),
    ),
}


def resolve_agriculture_commodity(symbol: str) -> CommodityMetadata:
    normalized = symbol.upper().lstrip("/")
    for code, metadata in AGRICULTURE_COMMODITY_METADATA.items():
        if normalized == code or normalized in metadata.aliases:
            return metadata if normalized == code else AGRICULTURE_COMMODITY_METADATA[code]

    fallback = _fallback_metadata(normalized)
    if fallback is not None:
        return fallback

    raise KeyError(f"Unsupported agriculture symbol: {symbol}")
