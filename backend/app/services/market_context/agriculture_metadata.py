from __future__ import annotations

from app.services.agriculture_index import AGRICULTURE_SYMBOLS
from app.services.market_context.types import CommodityMetadata, WeatherRegion


CBOT_GRAIN_SESSION_PROFILE_ID = "cbot_grains_et"


_REGIONS = {
    "iowa": WeatherRegion("iowa", "Iowa Corn Belt", "IA", 41.878, -93.097),
    "illinois": WeatherRegion("illinois", "Illinois Corn Belt", "IL", 40.633, -89.398),
    "nebraska": WeatherRegion("nebraska", "Nebraska Plains", "NE", 41.492, -99.901),
    "indiana": WeatherRegion("indiana", "Indiana Belt", "IN", 40.267, -86.134),
    "minnesota": WeatherRegion("minnesota", "Minnesota Belt", "MN", 46.730, -94.686),
    "missouri": WeatherRegion("missouri", "Missouri Soybelt", "MO", 37.964, -91.831),
    "kansas": WeatherRegion("kansas", "Kansas Wheat Belt", "KS", 39.011, -98.484),
    "oklahoma": WeatherRegion("oklahoma", "Oklahoma Wheat Belt", "OK", 35.468, -97.516),
    "north_dakota": WeatherRegion("north_dakota", "North Dakota Plains", "ND", 47.551, -101.002),
    "montana": WeatherRegion("montana", "Montana Plains", "MT", 46.879, -110.362),
    "texas": WeatherRegion("texas", "Texas Southern Plains", "TX", 31.969, -99.901),
    "arkansas": WeatherRegion("arkansas", "Arkansas Delta", "AR", 34.746, -92.290),
    "louisiana": WeatherRegion("louisiana", "Louisiana Delta", "LA", 30.984, -91.962),
    "mississippi": WeatherRegion("mississippi", "Mississippi Delta", "MS", 32.355, -89.399),
    "florida": WeatherRegion("florida", "Florida Citrus Belt", "FL", 27.994, -81.760),
}

_CORN_REGIONS = (
    _REGIONS["iowa"],
    _REGIONS["illinois"],
    _REGIONS["nebraska"],
    _REGIONS["indiana"],
    _REGIONS["minnesota"],
)

_SOY_REGIONS = (
    _REGIONS["iowa"],
    _REGIONS["illinois"],
    _REGIONS["indiana"],
    _REGIONS["minnesota"],
    _REGIONS["missouri"],
)

_WHEAT_REGIONS = (
    _REGIONS["kansas"],
    _REGIONS["oklahoma"],
    _REGIONS["north_dakota"],
    _REGIONS["montana"],
    _REGIONS["texas"],
)

_RICE_REGIONS = (
    _REGIONS["arkansas"],
    _REGIONS["louisiana"],
    _REGIONS["mississippi"],
)

_CITRUS_REGIONS = (_REGIONS["florida"],)

_INDEX_SYMBOL_MAP = {symbol.code: symbol for symbol in AGRICULTURE_SYMBOLS}

_DERIVED_WEATHER_REGIONS: dict[str, tuple[WeatherRegion, ...]] = {
    "KE": _WHEAT_REGIONS,
    "MW": (_REGIONS["north_dakota"], _REGIONS["montana"], _REGIONS["minnesota"]),
    "ZR": _RICE_REGIONS,
    "CT": (_REGIONS["texas"],),
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
        weather_regions=(_REGIONS["north_dakota"], _REGIONS["montana"], _REGIONS["minnesota"]),
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
