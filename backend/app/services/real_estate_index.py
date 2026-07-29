"""Real estate market diagnostic built from public market and macro series.

The page is intentionally proxy-first: liquid ETFs and listed REITs supply the
high-frequency market read, while FRED series provide the rates, credit,
construction, and shelter-inflation context used to explain the regime.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO
from math import tanh
from statistics import mean
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests
import yfinance as yf

try:
    from curl_cffi import requests as curl_requests
except ImportError:  # pragma: no cover - fallback dependency is present in deployment image
    curl_requests = None

from app.core.config import settings
from app.services.endpoint_response_cache import (
    load_response_snapshot,
    mark_stale_snapshot,
    response_refresh_lock,
    store_response_snapshot,
)


LOOKBACK_WINDOWS: Tuple[int, ...] = (5, 20, 60, 120)

GROUP_WEIGHTS: Dict[str, float] = {
    "residential": 30.0,
    "reits": 30.0,
    "commercial": 20.0,
    "financing": 20.0,
}

GROUP_LABELS: Dict[str, str] = {
    "residential": "Residential Builders",
    "reits": "Listed REITs",
    "commercial": "Office REIT Proxy",
    "financing": "Financing Proxies",
}

FACTOR_WEIGHTS: Dict[str, float] = {
    "financing_pressure": 35.0,
    "listed_market_confirmation": 30.0,
    "demand_affordability": 20.0,
    "supply_balance": 15.0,
}

FACTOR_LABELS: Dict[str, str] = {
    "financing_pressure": "Financing Pressure",
    "listed_market_confirmation": "Listed-Market Confirmation",
    "demand_affordability": "Demand and Affordability",
    "supply_balance": "Construction Pipeline",
}

FRED_SERIES: Dict[str, str] = {
    "mortgage_rate_30y": "MORTGAGE30US",
    "treasury_10y": "DGS10",
    "credit_spread": "BAMLH0A0HYM2",
    "housing_starts": "HOUST",
    "building_permits": "PERMIT",
    "completions": "COMPUTSA",
    "shelter_cpi_index": "CUSR0000SAH1",
    "rent_cpi_index": "CUSR0000SEHA",
    "housing_cpi_index": "CPIEHOUSE",
    "median_housing_cpi_index": "MEDCPIM158SFRBCLE",
    "new_home_sales": "HSN1F",
}

FRED_LABELS: Dict[str, str] = {
    "mortgage_rate_30y": "30Y mortgage rate",
    "treasury_10y": "10Y Treasury yield",
    "credit_spread": "HY credit spread",
    "housing_starts": "housing starts",
    "building_permits": "building permits",
    "completions": "housing completions",
    "shelter_cpi_index": "shelter CPI",
    "rent_cpi_index": "rent CPI",
    "housing_cpi_index": "housing CPI",
    "median_housing_cpi_index": "median housing CPI",
    "new_home_sales": "new home sales",
}

HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (real-estate-index)",
    "Accept": "application/json,text/csv,*/*",
}

FRED_TIMEOUT_SECONDS = 8
YAHOO_BATCH_TIMEOUT_SECONDS = 8
COMMERCIAL_LONG_CONTEXT_DAYS = 30 * 365

_CACHE: Dict[int, Dict[str, Any]] = {}
_CACHE_LOCK = Lock()
_COMPUTE_LOCK = Lock()
_CACHE_TTL_SECONDS = 20 * 60
_MAX_STALE_AGE_SECONDS = 48 * 60 * 60
_MAX_MEMORY_CACHE_ENTRIES = 6

_CONTEXT_CACHE: Dict[int, Dict[str, Any]] = {}
_CONTEXT_CACHE_LOCK = Lock()
_CONTEXT_COMPUTE_LOCK = Lock()

_COMMERCIAL_CACHE: Dict[int, Dict[str, Any]] = {}
_COMMERCIAL_CACHE_LOCK = Lock()
_COMMERCIAL_COMPUTE_LOCK = Lock()


def _set_bounded_memory_cache(
    cache: Dict[int, Dict[str, Any]],
    key: int,
    timestamp: datetime,
    data: Dict[str, Any],
) -> None:
    cache[key] = {"timestamp": timestamp, "data": data}
    if len(cache) <= _MAX_MEMORY_CACHE_ENTRIES:
        return
    oldest_key = min(
        cache,
        key=lambda item: cache[item].get("timestamp") or datetime.min,
    )
    cache.pop(oldest_key, None)


def _load_usable_shared_snapshot(cache_key: str):
    snapshot = load_response_snapshot(cache_key)
    if (
        snapshot is not None
        and not snapshot.is_within_stale_limit(_MAX_STALE_AGE_SECONDS)
    ):
        return None
    return snapshot


@dataclass(frozen=True)
class RealEstateProxy:
    code: str
    ticker: str
    name: str
    group: str


REAL_ESTATE_PROXIES: Tuple[RealEstateProxy, ...] = (
    RealEstateProxy("XHB", "XHB", "SPDR Homebuilders ETF", "residential"),
    RealEstateProxy("ITB", "ITB", "iShares U.S. Home Construction ETF", "residential"),
    RealEstateProxy("VNQ", "VNQ", "Vanguard Real Estate ETF", "reits"),
    RealEstateProxy("IYR", "IYR", "iShares U.S. Real Estate ETF", "reits"),
    RealEstateProxy("XLRE", "XLRE", "Real Estate Select Sector SPDR", "reits"),
    RealEstateProxy("BXP", "BXP", "BXP office REIT", "commercial"),
    RealEstateProxy("SLG", "SLG", "SL Green office REIT", "commercial"),
    RealEstateProxy("KRC", "KRC", "Kilroy Realty office REIT", "commercial"),
    RealEstateProxy("KRE", "KRE", "Regional Bank ETF", "financing"),
    RealEstateProxy("MBB", "MBB", "Agency MBS ETF", "financing"),
    RealEstateProxy("REM", "REM", "Mortgage REIT ETF", "financing"),
)


COMMERCIAL_GROUP_WEIGHTS: Dict[str, float] = {
    "office": 20.0,
    "industrial": 20.0,
    "retail": 20.0,
    "multifamily": 20.0,
    "digital": 20.0,
}

COMMERCIAL_GROUP_LABELS: Dict[str, str] = {
    "office": "Office",
    "industrial": "Industrial / Logistics",
    "retail": "Retail",
    "multifamily": "Multifamily",
    "digital": "Digital Infrastructure",
}

COMMERCIAL_REAL_ESTATE_PROXIES: Tuple[RealEstateProxy, ...] = (
    RealEstateProxy("BXP", "BXP", "BXP", "office"),
    RealEstateProxy("VNO", "VNO", "Vornado Realty Trust", "office"),
    RealEstateProxy("SLG", "SLG", "SL Green Realty", "office"),
    RealEstateProxy("PLD", "PLD", "Prologis", "industrial"),
    RealEstateProxy("STAG", "STAG", "STAG Industrial", "industrial"),
    RealEstateProxy("FR", "FR", "First Industrial Realty", "industrial"),
    RealEstateProxy("SPG", "SPG", "Simon Property Group", "retail"),
    RealEstateProxy("REG", "REG", "Regency Centers", "retail"),
    RealEstateProxy("KIM", "KIM", "Kimco Realty", "retail"),
    RealEstateProxy("AVB", "AVB", "AvalonBay Communities", "multifamily"),
    RealEstateProxy("EQR", "EQR", "Equity Residential", "multifamily"),
    RealEstateProxy("ESS", "ESS", "Essex Property Trust", "multifamily"),
    RealEstateProxy("EQIX", "EQIX", "Equinix", "digital"),
    RealEstateProxy("DLR", "DLR", "Digital Realty", "digital"),
    RealEstateProxy("AMT", "AMT", "American Tower", "digital"),
)

COMMERCIAL_FRED_SERIES: Dict[str, str] = {
    "cre_price_yoy": "BOGZ1FL010000386Q",
    "cre_price_level": "BOGZ1FL075035503Q",
    "cre_loans": "CREACBM027NBOG",
    "cre_delinquency": "DRCRELEXFACBS",
    "treasury_10y": "DGS10",
    "credit_spread": "BAMLH0A0HYM2",
    "nonres_rent_ppi": "PCU531120531120",
    "rent_cpi_index": "CUSR0000SEHA",
    "office_construction": "TLOFCONS",
    "office_professional_employment": "USPBS",
    "office_financial_employment": "USFIRE",
    "office_information_employment": "USINFO",
    "industrial_construction": "TLMFGCONS",
    "industrial_production": "INDPRO",
    "retail_construction": "TLCOMCONS",
    "retail_sales": "RETAILSMSA",
    "multifamily_starts": "HOUST5F",
    "multifamily_permits": "PERMIT5",
    "multifamily_completions": "COMPU5MUSA",
    "multifamily_vacancy": "RRVRUSQ156N",
    "multifamily_price_level": "BOGZ1FL075035403Q",
    "digital_power_construction": "TLPWRCONS",
    "digital_demand_employment": "CES5051800001",
}

COMMERCIAL_FRED_LABELS: Dict[str, str] = {
    "cre_price_yoy": "commercial real-estate prices",
    "cre_price_level": "commercial real-estate price index",
    "cre_loans": "commercial real-estate loans",
    "cre_delinquency": "commercial real-estate loan delinquencies",
    "treasury_10y": "10Y Treasury yield",
    "credit_spread": "HY credit spread",
    "nonres_rent_ppi": "nonresidential building rents",
    "rent_cpi_index": "rent CPI",
    "office_construction": "office construction spending",
    "office_professional_employment": "professional-services employment",
    "office_financial_employment": "financial-activities employment",
    "office_information_employment": "information employment",
    "industrial_construction": "manufacturing construction spending",
    "industrial_production": "industrial production",
    "retail_construction": "commercial construction spending",
    "retail_sales": "retail sales",
    "multifamily_starts": "multifamily housing starts",
    "multifamily_permits": "multifamily building permits",
    "multifamily_completions": "multifamily completions",
    "multifamily_vacancy": "rental vacancy rate",
    "multifamily_price_level": "multifamily property price index",
    "digital_power_construction": "power infrastructure construction",
    "digital_demand_employment": "computing-infrastructure employment",
}

COMMERCIAL_SECTOR_CONTEXT_CONFIG: Dict[str, Dict[str, Any]] = {
    "office": {
        "label": "Office",
        "coverage": "Direct construction + operating proxies",
        "supply_title": "Office development pipeline",
        "supply_note": "Office construction spending is a direct Census measure of development activity.",
        "supply": (("office_construction", "Office Construction", "$M SAAR"),),
        "demand": (
            "office_professional_employment",
            "office_financial_employment",
            "office_information_employment",
        ),
        "demand_label": "Office-using Employment",
        "demand_note": "Demand is an equal-weighted employment proxy across professional services, financial activities, and information.",
        "price_key": "cre_price_level",
        "price_label": "Broad CRE Price Index",
        "rent_key": "nonres_rent_ppi",
        "rent_label": "Nonresidential Rent PPI",
    },
    "industrial": {
        "label": "Industrial / Logistics",
        "coverage": "Operating and development proxies",
        "supply_title": "Industrial development pipeline",
        "supply_note": "Manufacturing construction is a logistics-adjacent supply proxy, not a warehouse inventory count.",
        "supply": (("industrial_construction", "Manufacturing Construction", "$M SAAR"),),
        "demand": ("industrial_production",),
        "demand_label": "Industrial Production",
        "demand_note": "Industrial production is used as the public operating-demand proxy for logistics space.",
        "price_key": "cre_price_level",
        "price_label": "Broad CRE Price Index",
        "rent_key": "nonres_rent_ppi",
        "rent_label": "Nonresidential Rent PPI",
    },
    "retail": {
        "label": "Retail",
        "coverage": "Direct activity + broad construction proxy",
        "supply_title": "Retail development pipeline",
        "supply_note": "Commercial construction spending is broader than retail alone and is labeled as a supply proxy.",
        "supply": (("retail_construction", "Commercial Construction", "$M SAAR"),),
        "demand": ("retail_sales",),
        "demand_label": "Retail Sales",
        "demand_note": "Monthly retailer sales provide the operating-demand side of the retail property read.",
        "price_key": "cre_price_level",
        "price_label": "Broad CRE Price Index",
        "rent_key": "nonres_rent_ppi",
        "rent_label": "Nonresidential Rent PPI",
    },
    "multifamily": {
        "label": "Multifamily",
        "coverage": "Mostly direct property-market series",
        "supply_title": "Multifamily construction pipeline",
        "supply_note": "Starts, permits, and completions are direct measures for buildings with five units or more.",
        "supply": (
            ("multifamily_starts", "5+ Unit Starts", "K SAAR"),
            ("multifamily_permits", "5+ Unit Permits", "K SAAR"),
            ("multifamily_completions", "5+ Unit Completions", "K SAAR"),
        ),
        "demand": ("multifamily_vacancy",),
        "demand_label": "Rental Demand (Inverse Vacancy)",
        "demand_invert": True,
        "demand_note": "The rental vacancy rate is inverted so a falling vacancy rate reads as stronger demand.",
        "price_key": "multifamily_price_level",
        "price_label": "Multifamily Price Index",
        "rent_key": "rent_cpi_index",
        "rent_label": "Rent CPI",
    },
    "digital": {
        "label": "Digital Infrastructure",
        "coverage": "Proxy-led public-data read",
        "supply_title": "Digital infrastructure pipeline",
        "supply_note": "Power construction is an enabling-infrastructure proxy; public data do not isolate national data-center completions cleanly.",
        "supply": (("digital_power_construction", "Power Construction", "$M SAAR"),),
        "demand": ("digital_demand_employment",),
        "demand_label": "Computing Infrastructure Employment",
        "demand_note": "Computing-infrastructure and hosting employment is used as a public activity proxy for digital demand.",
        "price_key": "cre_price_level",
        "price_label": "Broad CRE Price Index",
        "rent_key": "nonres_rent_ppi",
        "rent_label": "Nonresidential Rent PPI",
    },
}


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        cast = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(cast):
        return None
    return cast


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _format_yoy_text(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    if abs(value) < 0.05:
        return "flat YoY"
    return f"{value:+.1f}% YoY"


def _format_new_home_sales_level(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    return f"{value:.0f}K SAAR"


def _series_from_rows(rows: List[Dict[str, Any]]) -> pd.Series:
    if not rows:
        return pd.Series(dtype="float64")
    frame = pd.DataFrame(rows)
    if "date" not in frame.columns or "value" not in frame.columns:
        return pd.Series(dtype="float64")
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["date", "value"]).drop_duplicates(subset=["date"], keep="last")
    if frame.empty:
        return pd.Series(dtype="float64")
    frame = frame.sort_values("date")
    return pd.Series(frame["value"].values, index=pd.DatetimeIndex(frame["date"])).astype(float)


def _fred_fetch_api(series_id: str, start: str) -> pd.Series:
    if not settings.FRED_API_KEY:
        return pd.Series(dtype="float64")

    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": settings.FRED_API_KEY,
        "file_type": "json",
        "observation_start": start,
    }
    resp = requests.get(url, params=params, headers=HTTP_HEADERS, timeout=FRED_TIMEOUT_SECONDS)
    resp.raise_for_status()
    rows = [
        {"date": obs["date"], "value": obs["value"]}
        for obs in resp.json().get("observations", [])
        if obs.get("value") not in (".", "", None)
    ]
    return _series_from_rows(rows)


def _fred_fetch_public_csv(series_id: str, start: str) -> pd.Series:
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    params = {"id": series_id, "cosd": start}
    try:
        resp = requests.get(
            url,
            params=params,
            headers=HTTP_HEADERS,
            timeout=FRED_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        payload = resp.text
    except requests.RequestException:
        if curl_requests is None:
            raise
        resp = curl_requests.get(
            url,
            params=params,
            headers=HTTP_HEADERS,
            timeout=FRED_TIMEOUT_SECONDS,
            impersonate="chrome",
        )
        if resp.status_code >= 400:
            raise requests.HTTPError(f"FRED public CSV returned {resp.status_code} for {series_id}")
        payload = resp.text

    frame = pd.read_csv(StringIO(payload))
    if frame.empty or "observation_date" not in frame.columns or series_id not in frame.columns:
        return pd.Series(dtype="float64")
    rows = [
        {"date": row["observation_date"], "value": row[series_id]}
        for _, row in frame.iterrows()
        if str(row[series_id]) not in (".", "", "nan")
    ]
    return _series_from_rows(rows)


def _fred_fetch(series_id: str, start: str) -> pd.Series:
    try:
        series = _fred_fetch_api(series_id, start)
        if not series.empty:
            return series
    except Exception:
        pass

    try:
        return _fred_fetch_public_csv(series_id, start)
    except Exception:
        return pd.Series(dtype="float64")


def _series_points(series: pd.Series, decimals: int = 2, multiplier: float = 1.0) -> List[Dict[str, Any]]:
    if series.empty:
        return []
    return [
        {"date": str(idx.date()), "value": round(float(value) * multiplier, decimals)}
        for idx, value in series.dropna().items()
    ]


def _latest(series: pd.Series) -> Optional[float]:
    if series.empty:
        return None
    return _safe_float(series.dropna().iloc[-1])


def _point_delta(series: pd.Series, lookback: int) -> Optional[float]:
    clean = series.dropna()
    if len(clean) <= lookback:
        return None
    current = _safe_float(clean.iloc[-1])
    previous = _safe_float(clean.iloc[-(lookback + 1)])
    if current is None or previous is None:
        return None
    return current - previous


def _pct_change_observations(series: pd.Series, lookback: int) -> Optional[float]:
    clean = series.dropna()
    if len(clean) <= lookback:
        return None
    current = _safe_float(clean.iloc[-1])
    previous = _safe_float(clean.iloc[-(lookback + 1)])
    if current is None or previous in (None, 0):
        return None
    return ((current / previous) - 1.0) * 100.0


def calculate_percent_changes(series: pd.Series) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    clean = series.dropna()
    for lookback in LOOKBACK_WINDOWS:
        out[f"{lookback}d"] = _pct_change_observations(clean, lookback)
    return out


def equity_pressure_score(changes: Dict[str, Optional[float]]) -> float:
    """Convert listed proxy returns to pressure: negative returns lift pressure."""
    weights = {"5d": 0.30, "20d": 0.30, "60d": 0.25, "120d": 0.15}
    values: List[float] = []
    applied: List[float] = []
    for key, weight in weights.items():
        value = changes.get(key)
        if value is None:
            continue
        values.append(value * weight)
        applied.append(weight)
    if not applied:
        return 50.0
    blended = sum(values) / sum(applied)
    return _clamp(50.0 - 45.0 * tanh(blended / 12.0), 0.0, 100.0)


def _level_pressure(value: Optional[float], low: float, high: float) -> Optional[float]:
    if value is None:
        return None
    return _clamp(((value - low) / (high - low)) * 100.0, 0.0, 100.0)


def _rate_trend_pressure(delta: Optional[float], scale: float = 1.0) -> Optional[float]:
    if delta is None:
        return None
    return _clamp(50.0 + 45.0 * tanh(delta / scale), 0.0, 100.0)


def _inverse_activity_pressure(change_pct: Optional[float], scale: float = 10.0) -> Optional[float]:
    if change_pct is None:
        return None
    return _clamp(50.0 - 45.0 * tanh(change_pct / scale), 0.0, 100.0)


def _weighted_score(scores: List[Tuple[Optional[float], float]]) -> Optional[float]:
    valid = [(score, weight) for score, weight in scores if score is not None and weight > 0]
    if not valid:
        return None
    total_w = sum(weight for _, weight in valid)
    return sum(float(score) * weight for score, weight in valid) / total_w


def _average_optional(values: List[Optional[float]]) -> Optional[float]:
    clean = [float(value) for value in values if value is not None]
    if not clean:
        return None
    return mean(clean)


def _volatility(series: pd.Series, lookback: int = 60) -> Optional[float]:
    clean = series.dropna()
    if len(clean) < 3:
        return None
    returns = clean.pct_change().dropna().tail(lookback)
    if returns.empty:
        return None
    return float(returns.std(ddof=0) * (252.0 ** 0.5) * 100.0)


def _fetch_proxy_batch(
    proxies: Tuple[RealEstateProxy, ...],
    days: int,
) -> Tuple[Dict[str, pd.Series], List[Dict[str, Any]], List[Dict[str, Any]]]:
    start = (datetime.utcnow() - timedelta(days=days + 260)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
    resolved: Dict[str, pd.Series] = {}
    availability: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []

    close_frame: pd.DataFrame | None = None
    try:
        downloaded = yf.download(
            tickers=" ".join(proxy.ticker for proxy in proxies),
            start=start,
            end=end,
            interval="1d",
            progress=False,
            auto_adjust=True,
            group_by="column",
            threads=True,
            timeout=YAHOO_BATCH_TIMEOUT_SECONDS,
        )
        if downloaded is not None and not downloaded.empty:
            if isinstance(downloaded.columns, pd.MultiIndex):
                level0 = downloaded.columns.get_level_values(0)
                level1 = downloaded.columns.get_level_values(1)
                if "Close" in level0:
                    close_frame = downloaded["Close"]
                elif "Close" in level1:
                    close_frame = downloaded.swaplevel(axis=1)["Close"]
            elif "Close" in downloaded.columns and len(proxies) == 1:
                close_frame = pd.DataFrame(
                    {proxies[0].ticker: downloaded["Close"]}
                )
    except Exception:
        close_frame = None

    for proxy in proxies:
        chosen_series = pd.Series(dtype="float64")
        if close_frame is not None and proxy.ticker in close_frame.columns:
            chosen_series = close_frame[proxy.ticker].dropna().astype("float64")

        if len(chosen_series) >= 30:
            resolved[proxy.code] = chosen_series
            availability.append({
                "code": proxy.code,
                "name": proxy.name,
                "group": proxy.group,
                "status": "ok",
                "ticker": proxy.ticker,
                "points": int(len(chosen_series)),
            })
            continue

        missing.append({
            "code": proxy.code,
            "name": proxy.name,
            "group": proxy.group,
            "attempted_tickers": [proxy.ticker],
        })
        availability.append({
            "code": proxy.code,
            "name": proxy.name,
            "group": proxy.group,
            "status": "missing",
            "ticker": None,
            "points": 0,
        })

    return resolved, availability, missing


def fetch_real_estate_proxy_data(days: int) -> Tuple[Dict[str, pd.Series], List[Dict[str, Any]], List[Dict[str, Any]]]:
    return _fetch_proxy_batch(REAL_ESTATE_PROXIES, days)


def fetch_fred_context(days: int) -> Tuple[Dict[str, pd.Series], List[str]]:
    start = (datetime.utcnow() - timedelta(days=days + 450)).strftime("%Y-%m-%d")
    series_map: Dict[str, pd.Series] = {key: pd.Series(dtype="float64") for key in FRED_SERIES}
    missing: List[str] = []

    max_workers = min(8, max(1, len(FRED_SERIES)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_fred_fetch, series_id, start): key
            for key, series_id in FRED_SERIES.items()
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                series = future.result()
            except Exception:
                series = pd.Series(dtype="float64")
            if series.empty:
                missing.append(key)
            series_map[key] = series

    def _yoy(series: pd.Series) -> pd.Series:
        if series.empty:
            return pd.Series(dtype="float64")
        return (series.pct_change(12) * 100.0).dropna()

    shelter = series_map.get("shelter_cpi_index", pd.Series(dtype="float64"))
    series_map["shelter_cpi_yoy"] = _yoy(shelter)
    series_map["rent_cpi_yoy"] = _yoy(series_map.get("rent_cpi_index", pd.Series(dtype="float64")))
    series_map["housing_cpi_yoy"] = _yoy(series_map.get("housing_cpi_index", pd.Series(dtype="float64")))

    new_home_sales = series_map.get("new_home_sales", pd.Series(dtype="float64"))
    if not new_home_sales.empty:
        series_map["new_home_sales_yoy"] = _yoy(new_home_sales)
        series_map["new_home_sales"] = new_home_sales.rolling(3, min_periods=1).mean().dropna()
    else:
        series_map["new_home_sales"] = pd.Series(dtype="float64")
        series_map["new_home_sales_yoy"] = pd.Series(dtype="float64")

    return series_map, missing


def fetch_commercial_proxy_data(
    days: int,
) -> Tuple[Dict[str, pd.Series], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch the listed CRE property-type universe without changing the broad page score."""
    return _fetch_proxy_batch(COMMERCIAL_REAL_ESTATE_PROXIES, days)


def fetch_commercial_fred_context(days: int) -> Tuple[Dict[str, pd.Series], List[str]]:
    start = (datetime.utcnow() - timedelta(days=days + 450)).strftime("%Y-%m-%d")
    long_context_start = (datetime.utcnow() - timedelta(days=10950 + 450)).strftime("%Y-%m-%d")
    core_keys = {
        "cre_price_yoy",
        "cre_loans",
        "cre_delinquency",
        "treasury_10y",
        "credit_spread",
    }
    series_map: Dict[str, pd.Series] = {
        key: pd.Series(dtype="float64") for key in COMMERCIAL_FRED_SERIES
    }
    missing: List[str] = []

    max_workers = min(6, len(COMMERCIAL_FRED_SERIES))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _fred_fetch,
                series_id,
                start if key in core_keys else long_context_start,
            ): key
            for key, series_id in COMMERCIAL_FRED_SERIES.items()
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                series = future.result()
            except Exception:
                series = pd.Series(dtype="float64")
            if series.empty:
                missing.append(key)
            series_map[key] = series

    return series_map, missing


def _build_context_payload(fred_series: Dict[str, pd.Series]) -> Dict[str, Any]:
    return {
        "housing_starts": _series_points(fred_series.get("housing_starts", pd.Series(dtype="float64")), decimals=0),
        "building_permits": _series_points(fred_series.get("building_permits", pd.Series(dtype="float64")), decimals=0),
        "completions": _series_points(fred_series.get("completions", pd.Series(dtype="float64")), decimals=0),
        "shelter_cpi": _series_points(fred_series.get("shelter_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
        "rent_cpi": _series_points(fred_series.get("rent_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
        "housing_cpi": _series_points(fred_series.get("housing_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
        "median_housing_cpi": _series_points(fred_series.get("median_housing_cpi_index", pd.Series(dtype="float64")), decimals=2),
        "new_home_sales": _series_points(fred_series.get("new_home_sales", pd.Series(dtype="float64")), decimals=0),
    }


def _build_real_estate_context_payload(days: int = 1095) -> Dict[str, Any]:
    now = datetime.utcnow()
    with _CONTEXT_CACHE_LOCK:
        cached = _CONTEXT_CACHE.get(days)
        if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["data"]

    with _CONTEXT_COMPUTE_LOCK:
        now = datetime.utcnow()
        with _CONTEXT_CACHE_LOCK:
            cached = _CONTEXT_CACHE.get(days)
            if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
                return cached["data"]

        fred_series, _ = fetch_fred_context(days)
        payload = {
            "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            **_build_context_payload(fred_series),
        }
        with _CONTEXT_CACHE_LOCK:
            _set_bounded_memory_cache(
                _CONTEXT_CACHE,
                days,
                now,
                payload,
            )
        return payload


def _resolve_real_estate_context_payload(
    days: int,
    shared_snapshot,
) -> Dict[str, Any]:
    cache_key = f"real-estate:context:{days}"
    try:
        payload = _build_real_estate_context_payload(days=days)
    except Exception:
        if shared_snapshot is None:
            raise
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="real_estate_context_refresh_failed",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )

    context_keys = [
        key
        for key in payload.keys()
        if key not in {"as_of", "data_quality", "warnings"}
    ]
    coverage = sum(bool(payload.get(key)) for key in context_keys)
    prior_coverage = (
        sum(
            bool(shared_snapshot.payload.get(key))
            for key in context_keys
        )
        if shared_snapshot is not None
        and isinstance(shared_snapshot.payload, dict)
        else 0
    )
    payload["data_quality"] = {
        "status": (
            "complete"
            if coverage == len(context_keys)
            else "partial"
            if coverage
            else "unavailable"
        ),
        "stale": False,
        "coverage_live": coverage,
        "coverage_total": len(context_keys),
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "max_stale_age_seconds": _MAX_STALE_AGE_SECONDS,
    }
    if shared_snapshot is not None and coverage < prior_coverage:
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="real_estate_context_refresh_incomplete",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )
    if coverage:
        store_response_snapshot(cache_key, payload)
    return payload


def get_real_estate_context_payload(days: int = 1095) -> Dict[str, Any]:
    cache_key = f"real-estate:context:{days}"
    shared_snapshot = _load_usable_shared_snapshot(cache_key)
    if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
        return shared_snapshot.payload

    with response_refresh_lock(cache_key):
        shared_snapshot = _load_usable_shared_snapshot(cache_key)
        if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
            return shared_snapshot.payload
        return _resolve_real_estate_context_payload(days, shared_snapshot)


def _build_symbol_data_for_proxies(
    series_map: Dict[str, pd.Series],
    proxies: Tuple[RealEstateProxy, ...],
) -> Dict[str, Dict[str, Any]]:
    symbol_data: Dict[str, Dict[str, Any]] = {}
    proxy_by_code = {proxy.code: proxy for proxy in proxies}

    for code, series in series_map.items():
        proxy = proxy_by_code.get(code)
        if proxy is None or series.empty:
            continue
        changes = calculate_percent_changes(series)
        score = equity_pressure_score(changes)
        current = _latest(series)
        vol = _volatility(series)
        symbol_data[code] = {
            "ticker": proxy.ticker,
            "name": proxy.name,
            "group": proxy.group,
            "current_price": round(current, 2) if current is not None else None,
            "changes": {k: round(v, 2) if v is not None else None for k, v in changes.items()},
            "momentum_score": round(score, 2),
            "volatility": round(vol, 2) if vol is not None else None,
        }

    return symbol_data


def _build_symbol_data(series_map: Dict[str, pd.Series]) -> Dict[str, Dict[str, Any]]:
    return _build_symbol_data_for_proxies(series_map, REAL_ESTATE_PROXIES)


def _effective_weights_for(
    symbol_data: Dict[str, Dict[str, Any]],
    configured_weights: Dict[str, float],
) -> Dict[str, float]:
    available_groups = {data["group"] for data in symbol_data.values()}
    total_weight = sum(configured_weights.get(group, 0.0) for group in available_groups)
    if total_weight <= 0:
        return {}
    return {
        group: (configured_weights[group] / total_weight) * 100.0
        for group in available_groups
        if group in configured_weights
    }


def _effective_group_weights(symbol_data: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
    return _effective_weights_for(symbol_data, GROUP_WEIGHTS)


def _build_groups_for(
    symbol_data: Dict[str, Dict[str, Any]],
    effective_weights: Dict[str, float],
    group_labels: Dict[str, str],
) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}
    for group, label in group_labels.items():
        members = [code for code, data in symbol_data.items() if data["group"] == group]
        if not members or group not in effective_weights:
            continue
        scores = [symbol_data[code]["momentum_score"] for code in members]
        group_changes: Dict[str, Optional[float]] = {}
        for lookback in LOOKBACK_WINDOWS:
            key = f"{lookback}d"
            values = [symbol_data[code]["changes"].get(key) for code in members]
            group_changes[key] = _average_optional(values)
        sorted_members = sorted(members, key=lambda code: symbol_data[code]["momentum_score"], reverse=True)

        groups[group] = {
            "group": group,
            "label": label,
            "weight": round(effective_weights[group], 2),
            "score": round(float(mean(scores)), 2),
            "components": [symbol_data[code]["ticker"] for code in sorted_members],
            "changes": {key: round(value, 2) if value is not None else None for key, value in group_changes.items()},
        }
    return groups


def _build_groups(symbol_data: Dict[str, Dict[str, Any]], effective_weights: Dict[str, float]) -> Dict[str, Dict[str, Any]]:
    return _build_groups_for(symbol_data, effective_weights, GROUP_LABELS)


def _indexed_history(series: pd.Series, days: int) -> List[Dict[str, Any]]:
    clean = series.dropna().tail(days)
    if clean.empty:
        return []
    base = _safe_float(clean.iloc[0])
    if base in (None, 0):
        return []
    return [
        {"date": str(idx.date()), "value": round((float(value) / float(base)) * 100.0, 2)}
        for idx, value in clean.items()
        if pd.notna(value)
    ]


def _build_listed_history(
    series_map: Dict[str, pd.Series],
    symbol_data: Dict[str, Dict[str, Any]],
    effective_weights: Dict[str, float],
    days: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    frames = {code: series for code, series in series_map.items() if code in symbol_data}
    if not frames:
        return [], []

    df = pd.DataFrame(frames).sort_index().dropna(how="all").tail(days + 5)
    if len(df) < 25:
        return [], []

    score_cols: Dict[str, pd.Series] = {}
    for code, col in df.items():
        pct_5 = col.pct_change(5) * 100.0
        pct_20 = col.pct_change(20) * 100.0
        pct_60 = col.pct_change(60) * 100.0
        pct_120 = col.pct_change(120) * 100.0

        available_weight = (
            0.30 * pct_5.notna().astype(float)
            + 0.30 * pct_20.notna().astype(float)
            + 0.25 * pct_60.notna().astype(float)
            + 0.15 * pct_120.notna().astype(float)
        )
        blended = (
            0.30 * pct_5.fillna(0)
            + 0.30 * pct_20.fillna(0)
            + 0.25 * pct_60.fillna(0)
            + 0.15 * pct_120.fillna(0)
        )
        blended = blended.div(available_weight.replace(0, np.nan))
        score_cols[code] = (50.0 - 45.0 * np.tanh(blended / 12.0)).clip(0, 100)

    score_df = pd.DataFrame(score_cols)
    group_series: Dict[str, pd.Series] = {}
    for group in GROUP_LABELS:
        codes = [code for code in score_cols if symbol_data[code]["group"] == group]
        if codes:
            group_series[group] = score_df[codes].mean(axis=1)

    if not group_series:
        return [], []

    composite = pd.Series(0.0, index=score_df.index)
    total_weight = 0.0
    for group, series in group_series.items():
        weight = effective_weights.get(group, 0.0)
        if weight <= 0:
            continue
        composite += series * (weight / 100.0)
        total_weight += weight / 100.0
    if total_weight > 0:
        composite = composite / total_weight

    composite = composite.dropna()
    composite_history = [
        {"date": str(idx.date()), "value": round(float(value), 2)}
        for idx, value in composite.items()
        if pd.notna(value)
    ]

    factor_history: List[Dict[str, Any]] = []
    combined_groups = pd.DataFrame(group_series).sort_index().dropna(how="all")
    for idx, row in combined_groups.iterrows():
        point: Dict[str, Any] = {"date": str(idx.date())}
        for group in GROUP_LABELS:
            value = row.get(group)
            point[group] = round(float(value), 2) if value is not None and pd.notna(value) else None
        factor_history.append(point)

    return composite_history, factor_history


def _build_factors(
    groups: Dict[str, Dict[str, Any]],
    symbol_data: Dict[str, Dict[str, Any]],
    fred: Dict[str, pd.Series],
) -> Tuple[List[Dict[str, Any]], Dict[str, Optional[float]]]:
    mortgage = fred.get("mortgage_rate_30y", pd.Series(dtype="float64"))
    treasury = fred.get("treasury_10y", pd.Series(dtype="float64"))
    credit = fred.get("credit_spread", pd.Series(dtype="float64"))
    starts = fred.get("housing_starts", pd.Series(dtype="float64"))
    permits = fred.get("building_permits", pd.Series(dtype="float64"))
    completions = fred.get("completions", pd.Series(dtype="float64"))
    shelter_yoy = fred.get("shelter_cpi_yoy", pd.Series(dtype="float64"))
    new_home_sales = fred.get("new_home_sales", pd.Series(dtype="float64"))
    new_home_sales_yoy = fred.get("new_home_sales_yoy", pd.Series(dtype="float64"))

    mortgage_latest = _latest(mortgage)
    mortgage_delta = _point_delta(mortgage, 26)
    treasury_latest = _latest(treasury)
    treasury_delta = _point_delta(treasury, 60)
    credit_latest = _latest(credit)
    credit_delta = _point_delta(credit, 60)
    shelter_latest = _latest(shelter_yoy)
    shelter_delta = _point_delta(shelter_yoy, 6)
    new_home_sales_latest = _latest(new_home_sales)
    new_home_sales_yoy_latest = _latest(new_home_sales_yoy)
    starts_6m = _pct_change_observations(starts, 6)
    permits_6m = _pct_change_observations(permits, 6)
    completions_6m = _pct_change_observations(completions, 6)

    metrics: Dict[str, Optional[float]] = {
        "mortgage_rate_30y": round(mortgage_latest, 3) if mortgage_latest is not None else None,
        "mortgage_rate_delta_26w": round(mortgage_delta, 3) if mortgage_delta is not None else None,
        "treasury_10y": round(treasury_latest, 3) if treasury_latest is not None else None,
        "treasury_10y_delta_60d": round(treasury_delta, 3) if treasury_delta is not None else None,
        "credit_spread_bps": round(credit_latest * 100.0, 1) if credit_latest is not None else None,
        "credit_spread_delta_60d_bps": round(credit_delta * 100.0, 1) if credit_delta is not None else None,
        "shelter_cpi_yoy": round(shelter_latest, 2) if shelter_latest is not None else None,
        "shelter_cpi_yoy_delta_6m": round(shelter_delta, 2) if shelter_delta is not None else None,
        "new_home_sales": round(new_home_sales_latest, 0) if new_home_sales_latest is not None else None,
        "new_home_sales_yoy": round(new_home_sales_yoy_latest, 2) if new_home_sales_yoy_latest is not None else None,
        "housing_starts_6m": round(starts_6m, 2) if starts_6m is not None else None,
        "building_permits_6m": round(permits_6m, 2) if permits_6m is not None else None,
        "completions_6m": round(completions_6m, 2) if completions_6m is not None else None,
        "xhb_60d": symbol_data.get("XHB", {}).get("changes", {}).get("60d"),
        "vnq_60d": symbol_data.get("VNQ", {}).get("changes", {}).get("60d"),
    }

    financing_scores: List[Tuple[Optional[float], float]] = [
        (_level_pressure(mortgage_latest, 4.0, 7.5), 0.35),
        (_rate_trend_pressure(mortgage_delta, 1.25), 0.25),
        (_rate_trend_pressure(treasury_delta, 0.90), 0.15),
        (_weighted_score([
            (_level_pressure(credit_latest, 2.5, 5.5), 0.60),
            (_rate_trend_pressure(credit_delta, 1.00), 0.40),
        ]), 0.25),
    ]
    financing_score = _weighted_score(financing_scores)
    financing_evidence: List[str] = []
    if mortgage_latest is not None:
        mortgage_text = f"30Y mortgage is {mortgage_latest:.2f}%"
        if mortgage_delta is not None:
            mortgage_text += f", {mortgage_delta:+.2f} pp versus about six months ago"
        financing_evidence.append(mortgage_text + ".")
    if credit_latest is not None:
        credit_text = f"HY OAS is {credit_latest * 100.0:.0f} bps"
        if credit_delta is not None:
            credit_text += f", {credit_delta * 100.0:+.0f} bps over 60 observations"
        financing_evidence.append(credit_text + ".")
    if financing_score is None and "financing" in groups:
        financing_score = groups["financing"]["score"]
        financing_evidence.append(
            f"Financing proxy basket pressure is {groups['financing']['score']:.0f} from KRE, MBB, and REM."
        )

    listed_score = None
    listed_evidence: List[str] = []
    if groups:
        listed_score = _weighted_score([(group["score"], group["weight"]) for group in groups.values()])
        ordered_groups = sorted(groups.values(), key=lambda group: group["score"], reverse=True)
        high = ordered_groups[0]
        low = ordered_groups[-1]
        listed_evidence.append(
            f"{high['label']} is the highest-pressure segment at {high['score']:.0f}, "
            f"{high['score'] - low['score']:.0f} pts above {low['label']}."
        )

    demand_score = _weighted_score([
        (groups.get("residential", {}).get("score"), 0.45),
        (_level_pressure(shelter_latest, 2.5, 6.0), 0.25),
        (_inverse_activity_pressure(new_home_sales_yoy_latest, 20.0), 0.30),
    ])
    demand_evidence: List[str] = []
    if "residential" in groups and "reits" in groups:
        spread = groups["residential"]["score"] - groups["reits"]["score"]
        demand_evidence.append(
            f"Residential pressure is {groups['residential']['score']:.0f}, "
            f"{spread:+.0f} pts versus listed REIT pressure."
        )
    elif "residential" in groups:
        demand_evidence.append(f"Residential proxy pressure is {groups['residential']['score']:.0f}.")
    if shelter_latest is not None:
        shelter_text = f"Shelter CPI is running {shelter_latest:.1f}% YoY"
        if shelter_delta is not None:
            shelter_text += f", {shelter_delta:+.1f} pts over six observations"
        demand_evidence.append(shelter_text + ".")
    if new_home_sales_latest is not None:
        sales_level = _format_new_home_sales_level(new_home_sales_latest)
        sales_text = f"New home sales are running at {sales_level}"
        yoy_text = _format_yoy_text(new_home_sales_yoy_latest)
        if yoy_text is not None:
            sales_text += f", {yoy_text}"
        demand_evidence.append(sales_text + ".")

    supply_score = _weighted_score([
        (_inverse_activity_pressure(starts_6m, 12.0), 0.35),
        (_inverse_activity_pressure(permits_6m, 12.0), 0.45),
        (_inverse_activity_pressure(completions_6m, 12.0), 0.20),
    ])
    supply_evidence: List[str] = []
    if starts_6m is not None:
        supply_evidence.append(f"Housing starts are {starts_6m:+.1f}% over six observations.")
    if permits_6m is not None:
        supply_evidence.append(f"Building permits are {permits_6m:+.1f}% over six observations.")

    factor_specs = [
        ("financing_pressure", financing_score, financing_evidence),
        ("listed_market_confirmation", listed_score, listed_evidence),
        ("demand_affordability", demand_score, demand_evidence),
        ("supply_balance", supply_score, supply_evidence),
    ]
    factors = [
        {
            "key": key,
            "label": FACTOR_LABELS[key],
            "weight": FACTOR_WEIGHTS[key],
            "score": round(float(score), 2),
            "evidence": evidence,
        }
        for key, score, evidence in factor_specs
        if score is not None
    ]
    return factors, metrics


def _regime_label(score: float) -> str:
    if score >= 68:
        return "Financing Stress"
    if score >= 58:
        return "Late-Cycle Squeeze"
    if score >= 42:
        return "Mixed Stabilization"
    return "Financing Easing"


def _summary(
    score: float,
    regime_label: str,
    factors: List[Dict[str, Any]],
    groups: Dict[str, Dict[str, Any]],
    metrics: Dict[str, Optional[float]],
) -> str:
    parts: List[str] = []

    if factors:
        ordered = sorted(factors, key=lambda factor: factor["score"], reverse=True)
        high = ordered[0]
        low = ordered[-1]
        parts.append(
            f"Composite pressure is {score:.0f}; {high['label']} is the largest factor at "
            f"{high['score']:.0f}, {high['score'] - low['score']:.0f} pts above {low['label']}."
        )
    else:
        parts.append(f"Composite pressure is {score:.0f}, but source coverage is too thin for a factor read.")

    mortgage = metrics.get("mortgage_rate_30y")
    mortgage_delta = metrics.get("mortgage_rate_delta_26w")
    if mortgage is not None:
        text = f"30Y mortgage rates are {mortgage:.2f}%"
        if mortgage_delta is not None:
            text += f", {mortgage_delta:+.2f} pp versus about six months ago"
        parts.append(text + ".")

    xhb_60d = metrics.get("xhb_60d")
    vnq_60d = metrics.get("vnq_60d")
    new_home_sales_yoy = metrics.get("new_home_sales_yoy")
    if xhb_60d is not None and vnq_60d is not None:
        relative = xhb_60d - vnq_60d
        parts.append(
            f"XHB is {xhb_60d:+.1f}% over 60 sessions versus VNQ at {vnq_60d:+.1f}%, "
            f"a {relative:+.1f} pt residential/listed-REIT spread."
        )
    if new_home_sales_yoy is not None:
        yoy_text = _format_yoy_text(new_home_sales_yoy)
        parts.append(
            f"New home sales are {yoy_text}, "
            "so buyer demand is being checked directly instead of inferred only from builders."
        )

    credit = metrics.get("credit_spread_bps")
    credit_delta = metrics.get("credit_spread_delta_60d_bps")
    if credit is not None:
        text = f"HY credit spreads are {credit:.0f} bps"
        if credit_delta is not None:
            text += f", {credit_delta:+.0f} bps over 60 observations"
        parts.append(text + ".")

    starts = metrics.get("housing_starts_6m")
    permits = metrics.get("building_permits_6m")
    if starts is not None and permits is not None:
        parts.append(
            f"Starts are {starts:+.1f}% and permits are {permits:+.1f}% over six observations, "
            "so the construction pipeline is included as confirmation rather than as a standalone conclusion."
        )

    if groups:
        ordered_groups = sorted(groups.values(), key=lambda group: group["score"], reverse=True)
        high_group = ordered_groups[0]
        low_group = ordered_groups[-1]
        parts.append(
            f"The regime label is {regime_label.lower()} because {high_group['label']} pressure "
            f"({high_group['score']:.0f}) is being compared against the most resilient group, "
            f"{low_group['label']} ({low_group['score']:.0f}), not read in isolation."
        )

    return " ".join(parts)


def _build_real_estate_index(days: int = 365) -> Dict[str, Any]:
    now = datetime.utcnow()
    with _CACHE_LOCK:
        cached = _CACHE.get(days)
        if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["data"]

    with _COMPUTE_LOCK:
        now = datetime.utcnow()
        with _CACHE_LOCK:
            cached = _CACHE.get(days)
            if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
                return cached["data"]

        proxy_series, availability, missing_proxies = fetch_real_estate_proxy_data(days)
        fred_series, missing_fred = fetch_fred_context(days)
        symbol_data = _build_symbol_data(proxy_series)
        effective_weights = _effective_group_weights(symbol_data)
        groups = _build_groups(symbol_data, effective_weights)
        factors, metrics = _build_factors(groups, symbol_data, fred_series)

        composite_score = 50.0
        if factors:
            total_weight = sum(FACTOR_WEIGHTS.get(factor["key"], 0.0) for factor in factors)
            if total_weight > 0:
                composite_score = sum(
                    factor["score"] * FACTOR_WEIGHTS[factor["key"]]
                    for factor in factors
                ) / total_weight
        elif groups:
            composite_score = _weighted_score([(group["score"], group["weight"]) for group in groups.values()]) or 50.0
        composite_score = round(float(composite_score), 2)
        stability_score = round(float(_clamp(100.0 - composite_score, 0.0, 100.0)), 2)

        composite_history, factor_history = _build_listed_history(proxy_series, symbol_data, effective_weights, days)
        stability_history = [
            {"date": point["date"], "value": round(float(_clamp(100.0 - point["value"], 0.0, 100.0)), 2)}
            for point in composite_history
            if point.get("value") is not None
        ]
        regime = _regime_label(composite_score)

        mortgage = fred_series.get("mortgage_rate_30y", pd.Series(dtype="float64"))
        treasury = fred_series.get("treasury_10y", pd.Series(dtype="float64"))
        credit = fred_series.get("credit_spread", pd.Series(dtype="float64"))

        warnings: List[str] = []
        if missing_proxies:
            warnings.append(f"Missing listed proxies: {', '.join(proxy['code'] for proxy in missing_proxies)}")
        if missing_fred:
            labels = [FRED_LABELS.get(key, key) for key in missing_fred]
            warnings.append(f"Missing FRED macro series: {', '.join(labels)}")

        data: Dict[str, Any] = {
            "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "regime_label": regime,
            "composite_score": composite_score,
            "stability_score": stability_score,
            "summary": _summary(composite_score, regime, factors, groups, metrics),
            "groups": list(groups.values()),
            "symbols": list(symbol_data.values()),
            "factors": factors,
            "metrics": metrics,
            "composite_history": composite_history,
            "stability_history": stability_history,
            "factor_history": factor_history,
            "transmission": {
                "mortgage_rate_30y": _series_points(mortgage, decimals=3),
                "treasury_10y": _series_points(treasury, decimals=3),
                "indexed_xhb": _indexed_history(proxy_series.get("XHB", pd.Series(dtype="float64")), days),
                "indexed_vnq": _indexed_history(proxy_series.get("VNQ", pd.Series(dtype="float64")), days),
                "credit_spread": _series_points(credit, decimals=1, multiplier=100.0),
            },
            "context": _build_context_payload(fred_series),
            "availability": {
                "symbols": availability,
                "missing_symbols": missing_proxies,
                "missing_macro_series": missing_fred,
                "available_count": len(proxy_series),
                "total_configured": len(REAL_ESTATE_PROXIES),
            },
            "warnings": warnings,
        }

        with _CACHE_LOCK:
            _set_bounded_memory_cache(_CACHE, days, now, data)

        return data


def _resolve_real_estate_index(
    days: int,
    shared_snapshot,
) -> Dict[str, Any]:
    cache_key = f"real-estate:overview:{days}"
    try:
        payload = _build_real_estate_index(days=days)
    except Exception:
        if shared_snapshot is None:
            raise
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="real_estate_overview_refresh_failed",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )

    availability = payload.get("availability") or {}
    coverage = int(availability.get("available_count") or 0)
    coverage_total = int(availability.get("total_configured") or 0)
    missing_macro_count = len(availability.get("missing_macro_series") or [])
    payload["data_quality"] = {
        "status": (
            "complete"
            if coverage_total
            and coverage == coverage_total
            and missing_macro_count == 0
            else "partial"
            if coverage
            else "unavailable"
        ),
        "stale": False,
        "coverage_live": coverage,
        "coverage_total": coverage_total,
        "missing_macro_series": missing_macro_count,
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "max_stale_age_seconds": _MAX_STALE_AGE_SECONDS,
    }

    prior_availability = (
        shared_snapshot.payload.get("availability") or {}
        if shared_snapshot is not None
        and isinstance(shared_snapshot.payload, dict)
        else {}
    )
    prior_coverage = int(prior_availability.get("available_count") or 0)
    prior_missing_macro = len(
        prior_availability.get("missing_macro_series") or []
    )
    refresh_is_worse = (
        coverage < prior_coverage
        or (
            coverage == prior_coverage
            and missing_macro_count > prior_missing_macro
        )
    )
    if shared_snapshot is not None and refresh_is_worse:
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="real_estate_overview_refresh_incomplete",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )
    if coverage:
        store_response_snapshot(cache_key, payload)
    return payload


def calculate_real_estate_index(days: int = 365) -> Dict[str, Any]:
    cache_key = f"real-estate:overview:{days}"
    shared_snapshot = _load_usable_shared_snapshot(cache_key)
    if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
        return shared_snapshot.payload

    with response_refresh_lock(cache_key):
        shared_snapshot = _load_usable_shared_snapshot(cache_key)
        if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
            return shared_snapshot.payload
        return _resolve_real_estate_index(days, shared_snapshot)


def _build_commercial_group_history(
    series_map: Dict[str, pd.Series],
    symbol_data: Dict[str, Dict[str, Any]],
    days: int,
) -> List[Dict[str, Any]]:
    group_series: Dict[str, pd.Series] = {}
    for group in COMMERCIAL_GROUP_LABELS:
        indexed_members: Dict[str, pd.Series] = {}
        for code, data in symbol_data.items():
            if data["group"] != group:
                continue
            clean = series_map.get(code, pd.Series(dtype="float64")).dropna().tail(days)
            if clean.empty:
                continue
            base = _safe_float(clean.iloc[0])
            if base in (None, 0):
                continue
            indexed_members[code] = (clean / float(base)) * 100.0
        if indexed_members:
            group_series[group] = pd.DataFrame(indexed_members).sort_index().mean(axis=1)

    if not group_series:
        return []

    combined = pd.DataFrame(group_series).sort_index().dropna(how="all")
    history: List[Dict[str, Any]] = []
    for idx, row in combined.iterrows():
        point: Dict[str, Any] = {"date": str(idx.date())}
        for group in COMMERCIAL_GROUP_LABELS:
            value = row.get(group)
            point[group] = round(float(value), 2) if value is not None and pd.notna(value) else None
        history.append(point)
    return history


def _build_commercial_long_group_history(
    series_map: Dict[str, pd.Series],
    symbol_data: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Build monthly, equal-weight listed-sector indexes across available constituents.

    Chaining the mean daily return avoids artificial level jumps when a newer
    constituent enters a sector basket. Monthly endpoints keep the long-horizon
    payload compact and comparable with the monthly and quarterly context series.
    """
    group_series: Dict[str, pd.Series] = {}
    for group in COMMERCIAL_GROUP_LABELS:
        member_returns: Dict[str, pd.Series] = {}
        for code, data in symbol_data.items():
            if data["group"] != group:
                continue
            clean = series_map.get(code, pd.Series(dtype="float64")).dropna().sort_index()
            if len(clean) < 2:
                continue
            member_returns[code] = clean.pct_change(fill_method=None)

        if not member_returns:
            continue
        equal_weight_return = (
            pd.DataFrame(member_returns)
            .sort_index()
            .mean(axis=1, skipna=True)
            .dropna()
        )
        if equal_weight_return.empty:
            continue
        chained = (1.0 + equal_weight_return).cumprod()
        group_series[group] = (chained / float(chained.iloc[0])) * 100.0

    if not group_series:
        return []

    combined = pd.DataFrame(group_series).sort_index().dropna(how="all")
    combined = combined.groupby(combined.index.to_period("M"), sort=True).tail(1)
    history: List[Dict[str, Any]] = []
    for idx, row in combined.iterrows():
        point: Dict[str, Any] = {"date": str(idx.date())}
        for group in COMMERCIAL_GROUP_LABELS:
            value = row.get(group)
            point[group] = round(float(value), 2) if value is not None and pd.notna(value) else None
        history.append(point)
    return history


def _indexed_series(series: pd.Series, *, invert: bool = False) -> pd.Series:
    clean = series.dropna().sort_index()
    if clean.empty:
        return pd.Series(dtype="float64")
    base = _safe_float(clean.iloc[0])
    if base in (None, 0):
        return pd.Series(dtype="float64")
    if invert:
        valid = clean.replace(0, np.nan).dropna()
        return (float(base) / valid) * 100.0
    return (clean / float(base)) * 100.0


def _average_indexed_series(
    series_list: List[pd.Series],
    *,
    invert: bool = False,
) -> pd.Series:
    indexed = {
        str(index): _indexed_series(series, invert=invert)
        for index, series in enumerate(series_list)
        if not series.empty
    }
    indexed = {key: series for key, series in indexed.items() if not series.empty}
    if not indexed:
        return pd.Series(dtype="float64")
    return pd.DataFrame(indexed).sort_index().mean(axis=1).dropna()


def _build_commercial_sector_context(
    fred_series: Dict[str, pd.Series],
    property_type_history: List[Dict[str, Any]],
    groups: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    contexts: Dict[str, Dict[str, Any]] = {}

    for group, config in COMMERCIAL_SECTOR_CONTEXT_CONFIG.items():
        supply_specs = config["supply"]
        supply_series = [
            fred_series.get(key, pd.Series(dtype="float64"))
            for key, _, _ in supply_specs
        ]
        supply_payload = []
        for (key, label, unit), series in zip(supply_specs, supply_series):
            latest = _latest(series)
            change_yoy = _pct_change_observations(series, 12)
            supply_payload.append({
                "key": key,
                "label": label,
                "unit": unit,
                "latest": round(latest, 1) if latest is not None else None,
                "change_yoy": round(change_yoy, 2) if change_yoy is not None else None,
                "data": _series_points(series, decimals=2),
            })

        demand_source_series = [
            fred_series.get(key, pd.Series(dtype="float64"))
            for key in config["demand"]
        ]
        demand_index = _average_indexed_series(
            demand_source_series,
            invert=bool(config.get("demand_invert", False)),
        )
        supply_index = _average_indexed_series(supply_series)
        demand_latest = _latest(demand_index)
        supply_latest = _latest(supply_index)
        divergence = (
            demand_latest - supply_latest
            if demand_latest is not None and supply_latest is not None
            else None
        )

        listed_index = [
            {"date": point["date"], "value": point[group]}
            for point in property_type_history
            if point.get(group) is not None
        ]
        price_series = fred_series.get(config["price_key"], pd.Series(dtype="float64"))
        rent_series = fred_series.get(config["rent_key"], pd.Series(dtype="float64"))
        group_60d = groups.get(group, {}).get("changes", {}).get("60d")
        price_change_1y = _pct_change_observations(price_series, 4)
        rent_change_1y = _pct_change_observations(rent_series, 12)

        source_keys = {
            *(key for key, _, _ in supply_specs),
            *config["demand"],
            config["price_key"],
            config["rent_key"],
        }
        contexts[group] = {
            "group": group,
            "label": config["label"],
            "coverage": config["coverage"],
            "supply": {
                "title": config["supply_title"],
                "note": config["supply_note"],
                "series": supply_payload,
            },
            "demand_supply": {
                "demand_label": config["demand_label"],
                "supply_label": "Development Pipeline",
                "demand_index": _series_points(demand_index, decimals=2),
                "supply_index": _series_points(supply_index, decimals=2),
                "demand_latest": round(demand_latest, 2) if demand_latest is not None else None,
                "supply_latest": round(supply_latest, 2) if supply_latest is not None else None,
                "divergence": round(divergence, 2) if divergence is not None else None,
                "note": config["demand_note"],
            },
            "price": {
                "listed_label": f"{config['label']} Listed Basket",
                "listed_index": listed_index,
                "listed_change_60d": group_60d,
                "property_price_label": config["price_label"],
                "property_price_index": _series_points(_indexed_series(price_series), decimals=2),
                "property_price_change_1y": round(price_change_1y, 2) if price_change_1y is not None else None,
                "rent_label": config["rent_label"],
                "rent_index": _series_points(_indexed_series(rent_series), decimals=2),
                "rent_change_1y": round(rent_change_1y, 2) if rent_change_1y is not None else None,
                "note": (
                    "Listed pricing is sector-specific. The appraisal and rent series are direct for multifamily "
                    "and broad nonresidential context for the other property types."
                ),
            },
            "sources": [
                {"key": key, "series_id": COMMERCIAL_FRED_SERIES[key], "label": COMMERCIAL_FRED_LABELS[key]}
                for key in sorted(source_keys)
            ],
        }

    return contexts


def _commercial_regime_label(pressure_score: float) -> str:
    if pressure_score >= 65:
        return "Broad CRE Stress"
    if pressure_score >= 55:
        return "CRE Pressure"
    if pressure_score >= 45:
        return "Mixed CRE Conditions"
    if pressure_score >= 35:
        return "CRE Stabilization"
    return "CRE Expansion"


def _commercial_summary(
    pressure_score: float,
    groups: Dict[str, Dict[str, Any]],
    metrics: Dict[str, Optional[float]],
) -> str:
    parts = [f"Commercial real-estate pressure is {pressure_score:.0f} on the 0-100 scale."]

    if groups:
        ordered = sorted(groups.values(), key=lambda group: group["score"], reverse=True)
        high = ordered[0]
        low = ordered[-1]
        parts.append(
            f"{high['label']} is the weakest listed property type at {high['score']:.0f}, "
            f"{high['score'] - low['score']:.0f} pts above {low['label']}."
        )

    price_yoy = metrics.get("cre_price_yoy")
    if price_yoy is not None:
        direction = "rising" if price_yoy >= 0 else "falling"
        parts.append(f"Broad CRE prices are {direction} {abs(price_yoy):.1f}% year over year.")

    delinquency = metrics.get("cre_delinquency_rate")
    delinquency_delta = metrics.get("cre_delinquency_delta_1y")
    if delinquency is not None:
        text = f"Bank CRE delinquencies are {delinquency:.2f}%"
        if delinquency_delta is not None:
            text += f", {delinquency_delta:+.2f} pp versus four quarters earlier"
        parts.append(text + ".")

    loan_balance = metrics.get("cre_loan_balance_bil")
    loan_growth = metrics.get("cre_loan_growth_yoy")
    if loan_balance is not None:
        text = f"Commercial-bank CRE loans total ${loan_balance:,.0f}B"
        if loan_growth is not None:
            text += f", {loan_growth:+.1f}% year over year"
        parts.append(text + ".")

    treasury = metrics.get("treasury_10y")
    credit = metrics.get("credit_spread_bps")
    if treasury is not None or credit is not None:
        funding_parts: List[str] = []
        if treasury is not None:
            funding_parts.append(f"the 10Y Treasury at {treasury:.2f}%")
        if credit is not None:
            funding_parts.append(f"HY OAS at {credit:.0f} bps")
        parts.append("The funding backdrop has " + " and ".join(funding_parts) + ".")

    return " ".join(parts)


def _build_commercial_real_estate(days: int = 365) -> Dict[str, Any]:
    now = datetime.utcnow()
    with _COMMERCIAL_CACHE_LOCK:
        cached = _COMMERCIAL_CACHE.get(days)
        if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["data"]

    with _COMMERCIAL_COMPUTE_LOCK:
        now = datetime.utcnow()
        with _COMMERCIAL_CACHE_LOCK:
            cached = _COMMERCIAL_CACHE.get(days)
            if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
                return cached["data"]

        proxy_series, availability, missing_proxies = fetch_commercial_proxy_data(
            max(days, COMMERCIAL_LONG_CONTEXT_DAYS)
        )
        fred_series, missing_fred = fetch_commercial_fred_context(days)
        symbol_data = _build_symbol_data_for_proxies(proxy_series, COMMERCIAL_REAL_ESTATE_PROXIES)
        effective_weights = _effective_weights_for(symbol_data, COMMERCIAL_GROUP_WEIGHTS)
        groups = _build_groups_for(symbol_data, effective_weights, COMMERCIAL_GROUP_LABELS)

        price_series = fred_series.get("cre_price_yoy", pd.Series(dtype="float64"))
        loan_series = fred_series.get("cre_loans", pd.Series(dtype="float64"))
        delinquency_series = fred_series.get("cre_delinquency", pd.Series(dtype="float64"))
        treasury_series = fred_series.get("treasury_10y", pd.Series(dtype="float64"))
        credit_series = fred_series.get("credit_spread", pd.Series(dtype="float64"))

        price_yoy = _latest(price_series)
        loan_balance = _latest(loan_series)
        loan_growth = _pct_change_observations(loan_series, 12)
        delinquency = _latest(delinquency_series)
        delinquency_delta = _point_delta(delinquency_series, 4)
        treasury = _latest(treasury_series)
        treasury_delta = _point_delta(treasury_series, 60)
        credit = _latest(credit_series)
        credit_delta = _point_delta(credit_series, 60)

        listed_pressure = _weighted_score([
            (group["score"], group["weight"])
            for group in groups.values()
        ])
        delinquency_pressure = _weighted_score([
            (_level_pressure(delinquency, 0.5, 5.0), 0.60),
            (_rate_trend_pressure(delinquency_delta, 0.75), 0.40),
        ])
        price_pressure = _inverse_activity_pressure(price_yoy, 8.0)
        funding_pressure = _weighted_score([
            (_level_pressure(treasury, 2.5, 6.0), 0.35),
            (_rate_trend_pressure(treasury_delta, 0.75), 0.20),
            (_level_pressure(credit, 2.5, 5.5), 0.25),
            (_rate_trend_pressure(credit_delta, 1.0), 0.20),
        ])

        factor_specs = [
            ("listed_property_types", "Listed Property Types", 45.0, listed_pressure),
            ("loan_performance", "Loan Performance", 20.0, delinquency_pressure),
            ("property_prices", "Property Prices", 15.0, price_pressure),
            ("funding_backdrop", "Funding Backdrop", 20.0, funding_pressure),
        ]
        factors = [
            {
                "key": key,
                "label": label,
                "weight": weight,
                "score": round(float(score), 2),
            }
            for key, label, weight, score in factor_specs
            if score is not None
        ]
        pressure_score = _weighted_score([
            (factor["score"], factor["weight"])
            for factor in factors
        ]) or 50.0
        pressure_score = round(float(_clamp(pressure_score, 0.0, 100.0)), 2)
        stability_score = round(100.0 - pressure_score, 2)

        metrics: Dict[str, Optional[float]] = {
            "cre_price_yoy": round(price_yoy, 2) if price_yoy is not None else None,
            "cre_loan_balance_bil": round(loan_balance, 1) if loan_balance is not None else None,
            "cre_loan_growth_yoy": round(loan_growth, 2) if loan_growth is not None else None,
            "cre_delinquency_rate": round(delinquency, 2) if delinquency is not None else None,
            "cre_delinquency_delta_1y": round(delinquency_delta, 2) if delinquency_delta is not None else None,
            "treasury_10y": round(treasury, 3) if treasury is not None else None,
            "treasury_10y_delta_60d": round(treasury_delta, 3) if treasury_delta is not None else None,
            "credit_spread_bps": round(credit * 100.0, 1) if credit is not None else None,
            "credit_spread_delta_60d_bps": round(credit_delta * 100.0, 1) if credit_delta is not None else None,
        }

        warnings: List[str] = []
        if missing_proxies:
            warnings.append(f"Missing CRE proxies: {', '.join(proxy['code'] for proxy in missing_proxies)}")
        if missing_fred:
            labels = [COMMERCIAL_FRED_LABELS.get(key, key) for key in missing_fred]
            warnings.append(f"Missing CRE macro series: {', '.join(labels)}")

        property_type_history = _build_commercial_group_history(
            proxy_series,
            symbol_data,
            days,
        )
        sector_property_type_history = _build_commercial_long_group_history(
            proxy_series,
            symbol_data,
        )
        sector_context = _build_commercial_sector_context(
            fred_series,
            sector_property_type_history,
            groups,
        )

        data: Dict[str, Any] = {
            "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "regime_label": _commercial_regime_label(pressure_score),
            "pressure_score": pressure_score,
            "stability_score": stability_score,
            "summary": _commercial_summary(pressure_score, groups, metrics),
            "groups": list(groups.values()),
            "symbols": list(symbol_data.values()),
            "factors": factors,
            "metrics": metrics,
            "property_type_history": property_type_history,
            "sector_context": sector_context,
            "macro": {
                "cre_price_yoy": _series_points(price_series, decimals=2),
                "cre_loans": _series_points(loan_series, decimals=1),
                "cre_delinquency": _series_points(delinquency_series, decimals=2),
                "treasury_10y": _series_points(treasury_series, decimals=3),
                "credit_spread": _series_points(credit_series, decimals=1, multiplier=100.0),
            },
            "availability": {
                "symbols": availability,
                "missing_symbols": missing_proxies,
                "missing_macro_series": missing_fred,
                "available_count": len(proxy_series),
                "total_configured": len(COMMERCIAL_REAL_ESTATE_PROXIES),
            },
            "warnings": warnings,
        }

        with _COMMERCIAL_CACHE_LOCK:
            _set_bounded_memory_cache(
                _COMMERCIAL_CACHE,
                days,
                now,
                data,
            )
        return data


def _resolve_commercial_real_estate(
    days: int,
    shared_snapshot,
) -> Dict[str, Any]:
    cache_key = f"real-estate:commercial:{days}"
    try:
        payload = _build_commercial_real_estate(days=days)
    except Exception:
        if shared_snapshot is None:
            raise
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="commercial_real_estate_refresh_failed",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )

    availability = payload.get("availability") or {}
    coverage = int(availability.get("available_count") or 0)
    coverage_total = int(availability.get("total_configured") or 0)
    missing_macro_count = len(availability.get("missing_macro_series") or [])
    payload["data_quality"] = {
        "status": (
            "complete"
            if coverage_total
            and coverage == coverage_total
            and missing_macro_count == 0
            else "partial"
            if coverage
            else "unavailable"
        ),
        "stale": False,
        "coverage_live": coverage,
        "coverage_total": coverage_total,
        "missing_macro_series": missing_macro_count,
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "max_stale_age_seconds": _MAX_STALE_AGE_SECONDS,
    }

    prior_availability = (
        shared_snapshot.payload.get("availability") or {}
        if shared_snapshot is not None
        and isinstance(shared_snapshot.payload, dict)
        else {}
    )
    prior_coverage = int(prior_availability.get("available_count") or 0)
    prior_missing_macro = len(
        prior_availability.get("missing_macro_series") or []
    )
    refresh_is_worse = (
        coverage < prior_coverage
        or (
            coverage == prior_coverage
            and missing_macro_count > prior_missing_macro
        )
    )
    if shared_snapshot is not None and refresh_is_worse:
        return mark_stale_snapshot(
            shared_snapshot.payload,
            shared_snapshot,
            reason="commercial_real_estate_refresh_incomplete",
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_stale_age_seconds=_MAX_STALE_AGE_SECONDS,
        )
    if coverage:
        store_response_snapshot(cache_key, payload)
    return payload


def calculate_commercial_real_estate(days: int = 365) -> Dict[str, Any]:
    cache_key = f"real-estate:commercial:{days}"
    shared_snapshot = _load_usable_shared_snapshot(cache_key)
    if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
        return shared_snapshot.payload

    with response_refresh_lock(cache_key):
        shared_snapshot = _load_usable_shared_snapshot(cache_key)
        if shared_snapshot and shared_snapshot.is_fresh(_CACHE_TTL_SECONDS):
            return shared_snapshot.payload
        return _resolve_commercial_real_estate(days, shared_snapshot)
