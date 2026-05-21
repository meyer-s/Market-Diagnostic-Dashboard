from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class IndicatorSpec:
    code: str
    name: str
    source: str
    source_symbol: str
    category: str
    direction: int
    lookback_days_for_z: int
    threshold_green_max: float
    threshold_yellow_max: float
    weight: float
    freshness_horizon_days: int
    formula_version: str
    missing_data_policy: str
    formula_summary: str
    is_core: bool = True

    def seed_payload(self) -> dict:
        payload = asdict(self)
        return {
            "code": payload["code"],
            "name": payload["name"],
            "source": payload["source"],
            "source_symbol": payload["source_symbol"],
            "category": payload["category"],
            "direction": payload["direction"],
            "lookback_days_for_z": payload["lookback_days_for_z"],
            "threshold_green_max": payload["threshold_green_max"],
            "threshold_yellow_max": payload["threshold_yellow_max"],
            "weight": payload["weight"],
        }


INDICATOR_SPECS = [
    IndicatorSpec("VIX", "CBOE Volatility Index (VIX)", "yahoo", "^VIX", "volatility", 1, 252, 40, 70, 1.0, 2, "v1", "exclude_from_composite", "Yahoo close series; rolling z-score mapped to stability."),
    IndicatorSpec("SPY", "S&P 500 ETF (SPY)", "yahoo", "SPY", "equity", -1, 252, 40, 70, 1.3, 2, "v2", "exclude_from_composite", "Stores price-vs-50EMA gap and scores the rolling trend gap."),
    IndicatorSpec("BREADTH_HEALTH", "Market Breadth Health", "DERIVED", "BREADTH_COMPOSITE", "equity", -1, 252, 40, 70, 1.8, 2, "v2", "exclude_from_composite", "RSP/SPY breadth composite with sector participation and return breadth."),
    IndicatorSpec("T10Y2Y", "10-Year minus 2-Year Treasury Spread", "fred", "T10Y2Y", "rates", -1, 252, 40, 70, 1.0, 3, "v1", "exclude_from_composite", "FRED curve slope normalized to a stability score."),
    IndicatorSpec("UNRATE", "U.S. Unemployment Rate", "fred", "UNRATE", "employment", 1, 252, 40, 70, 1.2, 40, "v2", "exclude_from_composite", "Scores six-month unemployment change instead of absolute level."),
    IndicatorSpec("CONSUMER_HEALTH", "Consumer Health Index", "DERIVED", "CONSUMER_COMPOSITE", "consumer", -1, 252, 40, 70, 1.4, 40, "v2", "exclude_from_composite", "Real-spending and real-income spread blended with XLY/XLP divergence."),
    IndicatorSpec("BOND_MARKET_STABILITY", "Bond Market Stability Composite", "DERIVED", "BOND_COMPOSITE", "bonds", 1, 252, 40, 70, 2.0, 3, "v2", "exclude_from_composite", "Canonical bond stress composite across credit, curve, momentum, and volatility."),
    IndicatorSpec("LIQUIDITY_PROXY", "Liquidity Proxy Indicator", "DERIVED", "LIQUIDITY_COMPOSITE", "liquidity", -1, 252, 40, 70, 1.8, 8, "v1", "exclude_from_composite", "M2, Fed balance sheet, and reverse repo liquidity composite."),
    IndicatorSpec("ANALYST_ANXIETY", "Analyst Confidence", "DERIVED", "ANALYST_ANXIETY_COMPOSITE", "sentiment", -1, 520, 40, 70, 1.9, 3, "v1", "exclude_from_composite", "VIX, MOVE, spreads, and ERP proxy blended into a confidence score."),
    IndicatorSpec("SENTIMENT_COMPOSITE", "Consumer & Corporate Sentiment", "DERIVED", "SENTIMENT_COMPOSITE", "sentiment", -1, 520, 40, 70, 1.8, 40, "v1", "exclude_from_composite", "Michigan, business confidence, new orders, and capex confidence composite."),
    IndicatorSpec("SECTOR_REGIME_ALIGNMENT", "Sector Divergence Alignment", "DERIVED", "SECTOR_REGIME_ALIGNMENT", "equity", -1, 252, 40, 70, 0.8, 7, "v1", "exclude_from_composite", "Sector leadership alignment against the prevailing system state.", is_core=False),
    IndicatorSpec("AAS", "Alternative Asset Stability", "DERIVED", "AAS_COMPOSITE", "alternative_assets", -1, 252, 40, 70, 2.0, 3, "v1", "exclude_from_composite", "Alternative-asset stability from metals and crypto cross-signals."),
    IndicatorSpec("AGRICULTURE_STABILITY", "Agriculture Stability", "DERIVED", "AGRICULTURE_OVERVIEW", "market_page", -1, 365, 40, 70, 0.6, 3, "v1", "exclude_from_composite", "Cached agriculture market-context stability surface.", is_core=False),
    IndicatorSpec("ENERGY_STABILITY", "Energy Stability", "DERIVED", "ENERGY_OVERVIEW", "market_page", -1, 365, 40, 70, 0.8, 3, "v1", "exclude_from_composite", "Cached energy market-context stability surface.", is_core=False),
    IndicatorSpec("REAL_ESTATE_STABILITY", "Real Estate Stability", "DERIVED", "REAL_ESTATE_OVERVIEW", "market_page", -1, 365, 40, 70, 1.0, 4, "v1", "exclude_from_composite", "Cached real-estate market-context stability surface.", is_core=False),
]

INDICATOR_SPECS_BY_CODE = {spec.code: spec for spec in INDICATOR_SPECS}


def get_indicator_spec(code: str) -> IndicatorSpec:
    return INDICATOR_SPECS_BY_CODE[code]


def iter_indicator_specs() -> list[IndicatorSpec]:
    return list(INDICATOR_SPECS)


def get_indicator_seed_rows() -> list[dict]:
    return [spec.seed_payload() for spec in INDICATOR_SPECS]
