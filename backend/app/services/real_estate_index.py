"""Real estate market diagnostic built from public market and macro series.

The page is intentionally proxy-first: liquid ETFs and listed REITs supply the
high-frequency market read, while FRED series provide the rates, credit,
construction, and shelter-inflation context used to explain the regime.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from io import StringIO
from math import tanh
from statistics import mean
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

from app.core.config import settings
from app.services.ingestion.yahoo_client import YahooClient, YahooClientError


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
    "existing_home_mortgage_applications": "M0263AUSM500NNBR",
    "new_home_mortgage_applications": "M0264AUSM500NNBR",
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
    "existing_home_mortgage_applications": "existing home mortgage applications",
    "new_home_mortgage_applications": "new home mortgage applications",
}

HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (real-estate-index)",
    "Accept": "application/json,text/csv,*/*",
}

FRED_TIMEOUT_SECONDS = 60

_CACHE: Dict[int, Dict[str, Any]] = {}
_CACHE_LOCK = Lock()
_CACHE_TTL_SECONDS = 20 * 60


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
    resp = requests.get(
        url,
        params={"id": series_id, "cosd": start},
        headers=HTTP_HEADERS,
        timeout=FRED_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    frame = pd.read_csv(StringIO(resp.text))
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


def fetch_real_estate_proxy_data(days: int) -> Tuple[Dict[str, pd.Series], List[Dict[str, Any]], List[Dict[str, Any]]]:
    client = YahooClient()
    start = (datetime.utcnow() - timedelta(days=days + 260)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    resolved: Dict[str, pd.Series] = {}
    availability: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []

    for proxy in REAL_ESTATE_PROXIES:
        chosen_series = pd.Series(dtype="float64")
        try:
            for _attempt in range(3):
                try:
                    rows = client.fetch_series(ticker=proxy.ticker, start_date=start, end_date=end, interval="1d")
                    chosen_series = _series_from_rows(rows)
                except Exception:
                    chosen_series = pd.Series(dtype="float64")
                if len(chosen_series) >= 30:
                    break
            if len(chosen_series) < 30:
                raise YahooClientError(f"Insufficient data returned for {proxy.ticker}")
            resolved[proxy.code] = chosen_series
            availability.append({
                "code": proxy.code,
                "name": proxy.name,
                "group": proxy.group,
                "status": "ok",
                "ticker": proxy.ticker,
                "points": int(len(chosen_series)),
            })
        except Exception:
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


def fetch_fred_context(days: int) -> Tuple[Dict[str, pd.Series], List[str]]:
    start = (datetime.utcnow() - timedelta(days=days + 450)).strftime("%Y-%m-%d")
    series_map: Dict[str, pd.Series] = {}
    missing: List[str] = []

    for key, series_id in FRED_SERIES.items():
        series = _fred_fetch(series_id, start)
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

    existing_apps = series_map.get("existing_home_mortgage_applications", pd.Series(dtype="float64"))
    new_apps = series_map.get("new_home_mortgage_applications", pd.Series(dtype="float64"))
    if not existing_apps.empty or not new_apps.empty:
        combined_apps = existing_apps.add(new_apps, fill_value=0.0).sort_index().dropna()
        series_map["mortgage_applications_combined"] = combined_apps
        series_map["mortgage_applications"] = combined_apps.rolling(3, min_periods=1).mean().dropna()
        series_map["mortgage_applications_yoy"] = _yoy(combined_apps)
    else:
        series_map["mortgage_applications_combined"] = pd.Series(dtype="float64")
        series_map["mortgage_applications"] = pd.Series(dtype="float64")
        series_map["mortgage_applications_yoy"] = pd.Series(dtype="float64")

    return series_map, missing


def _build_symbol_data(series_map: Dict[str, pd.Series]) -> Dict[str, Dict[str, Any]]:
    symbol_data: Dict[str, Dict[str, Any]] = {}
    proxy_by_code = {proxy.code: proxy for proxy in REAL_ESTATE_PROXIES}

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


def _effective_group_weights(symbol_data: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
    available_groups = {data["group"] for data in symbol_data.values()}
    total_weight = sum(GROUP_WEIGHTS.get(group, 0.0) for group in available_groups)
    if total_weight <= 0:
        return {}
    return {
        group: (GROUP_WEIGHTS[group] / total_weight) * 100.0
        for group in available_groups
        if group in GROUP_WEIGHTS
    }


def _build_groups(symbol_data: Dict[str, Dict[str, Any]], effective_weights: Dict[str, float]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}
    for group, label in GROUP_LABELS.items():
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
    mortgage_apps = fred.get("mortgage_applications_combined", pd.Series(dtype="float64"))
    mortgage_apps_yoy = fred.get("mortgage_applications_yoy", pd.Series(dtype="float64"))

    mortgage_latest = _latest(mortgage)
    mortgage_delta = _point_delta(mortgage, 26)
    treasury_latest = _latest(treasury)
    treasury_delta = _point_delta(treasury, 60)
    credit_latest = _latest(credit)
    credit_delta = _point_delta(credit, 60)
    shelter_latest = _latest(shelter_yoy)
    shelter_delta = _point_delta(shelter_yoy, 6)
    mortgage_apps_latest = _latest(mortgage_apps)
    mortgage_apps_yoy_latest = _latest(mortgage_apps_yoy)
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
        "mortgage_applications": round(mortgage_apps_latest, 0) if mortgage_apps_latest is not None else None,
        "mortgage_applications_yoy": round(mortgage_apps_yoy_latest, 2) if mortgage_apps_yoy_latest is not None else None,
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
        (_inverse_activity_pressure(mortgage_apps_yoy_latest, 20.0), 0.30),
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
    if mortgage_apps_latest is not None:
        apps_text = f"Combined mortgage applications are {mortgage_apps_latest:.0f} per workday"
        if mortgage_apps_yoy_latest is not None:
            apps_text += f", {mortgage_apps_yoy_latest:+.1f}% YoY"
        demand_evidence.append(apps_text + ".")

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
    mortgage_apps_yoy = metrics.get("mortgage_applications_yoy")
    if xhb_60d is not None and vnq_60d is not None:
        relative = xhb_60d - vnq_60d
        parts.append(
            f"XHB is {xhb_60d:+.1f}% over 60 sessions versus VNQ at {vnq_60d:+.1f}%, "
            f"a {relative:+.1f} pt residential/listed-REIT spread."
        )
    if mortgage_apps_yoy is not None:
        parts.append(
            f"Combined mortgage applications are {mortgage_apps_yoy:+.1f}% YoY, "
            "so borrower demand is being checked directly instead of inferred only from builders."
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


def calculate_real_estate_index(days: int = 365) -> Dict[str, Any]:
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

    composite_history, factor_history = _build_listed_history(proxy_series, symbol_data, effective_weights, days)
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
        "summary": _summary(composite_score, regime, factors, groups, metrics),
        "groups": list(groups.values()),
        "symbols": list(symbol_data.values()),
        "factors": factors,
        "metrics": metrics,
        "composite_history": composite_history,
        "factor_history": factor_history,
        "transmission": {
            "mortgage_rate_30y": _series_points(mortgage, decimals=3),
            "treasury_10y": _series_points(treasury, decimals=3),
            "indexed_xhb": _indexed_history(proxy_series.get("XHB", pd.Series(dtype="float64")), days),
            "indexed_vnq": _indexed_history(proxy_series.get("VNQ", pd.Series(dtype="float64")), days),
            "credit_spread": _series_points(credit, decimals=1, multiplier=100.0),
        },
        "context": {
            "housing_starts": _series_points(fred_series.get("housing_starts", pd.Series(dtype="float64")), decimals=0),
            "building_permits": _series_points(fred_series.get("building_permits", pd.Series(dtype="float64")), decimals=0),
            "completions": _series_points(fred_series.get("completions", pd.Series(dtype="float64")), decimals=0),
            "shelter_cpi": _series_points(fred_series.get("shelter_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
            "rent_cpi": _series_points(fred_series.get("rent_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
            "housing_cpi": _series_points(fred_series.get("housing_cpi_yoy", pd.Series(dtype="float64")), decimals=2),
            "median_housing_cpi": _series_points(fred_series.get("median_housing_cpi_index", pd.Series(dtype="float64")), decimals=2),
            "mortgage_applications": _series_points(fred_series.get("mortgage_applications", pd.Series(dtype="float64")), decimals=0),
        },
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
        _CACHE[days] = {"timestamp": now, "data": data}

    return data
