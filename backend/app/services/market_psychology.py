from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import sqrt
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
import time
import asyncio

import httpx
from scipy.stats import pearsonr
import yfinance as yf

from app.services.ingestion.fred_client import FredClient, FredClientError
from app.utils.data_helpers import series_to_dict

NYC_LAT = 40.7128
NYC_LON = -74.0060
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
WEATHER_CACHE_TTL_SECONDS = 15 * 60
RATES_CACHE_TTL_SECONDS = 15 * 60


@dataclass
class CacheEntry:
    expires_at: float
    payload: Dict[str, Any]


_CACHE: Dict[str, CacheEntry] = {}


@dataclass
class SeriesResult:
    key: str
    label: str
    source: str
    is_proxy: bool
    values: Dict[str, float]


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    entry = _CACHE.get(key)
    if not entry:
        return None
    if time.time() >= entry.expires_at:
        _CACHE.pop(key, None)
        return None
    return entry.payload


def _cache_set(key: str, payload: Dict[str, Any], ttl_seconds: int) -> Dict[str, Any]:
    _CACHE[key] = CacheEntry(expires_at=time.time() + ttl_seconds, payload=payload)
    return payload


def _clear_cache() -> None:
    _CACHE.clear()


def _parse_iso_date(date_str: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(date_str)
    except ValueError:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _zscore(values: Sequence[float]) -> List[float]:
    if len(values) < 2:
        return [0.0 for _ in values]
    mu = mean(values)
    variance = sum((x - mu) ** 2 for x in values) / len(values)
    sigma = sqrt(variance)
    if sigma == 0:
        return [0.0 for _ in values]
    return [(x - mu) / sigma for x in values]


def _pearson_summary(x: Sequence[float], y: Sequence[float], min_samples: int = 20) -> Dict[str, Any]:
    if len(x) != len(y):
        raise ValueError("x and y must have the same length")
    if len(x) < min_samples:
        return {
            "pearson_r": None,
            "p_value": None,
            "samples": len(x),
            "significant": False,
        }
    try:
        r_value, p_value = pearsonr(x, y)
    except Exception:
        return {
            "pearson_r": None,
            "p_value": None,
            "samples": len(x),
            "significant": False,
        }

    return {
        "pearson_r": round(float(r_value), 4),
        "p_value": round(float(p_value), 6),
        "samples": len(x),
        "significant": bool(p_value < 0.05),
    }


def _rolling_correlation(
    dates: Sequence[str],
    x: Sequence[float],
    y: Sequence[float],
    window: int,
    min_samples: int = 20,
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    if len(dates) != len(x) or len(dates) != len(y):
        return points

    for idx in range(len(dates)):
        if idx + 1 < window:
            points.append(
                {
                    "date": dates[idx],
                    "rolling_corr": None,
                    "rolling_p_value": None,
                    "significant": False,
                }
            )
            continue

        x_window = x[idx - window + 1 : idx + 1]
        y_window = y[idx - window + 1 : idx + 1]
        corr = _pearson_summary(x_window, y_window, min_samples=min_samples)

        points.append(
            {
                "date": dates[idx],
                "rolling_corr": corr["pearson_r"],
                "rolling_p_value": corr["p_value"],
                "significant": corr["significant"],
            }
        )

    return points


async def _fetch_first_available_fred_series(
    fred: FredClient,
    key: str,
    label: str,
    candidates: Sequence[Tuple[str, str, bool]],
    start_date: str,
) -> SeriesResult:
    for series_id, source_label, is_proxy in candidates:
        try:
            rows = await fred.fetch_series(series_id, start_date=start_date)
            values = series_to_dict(rows)
            if values:
                return SeriesResult(
                    key=key,
                    label=label,
                    source=source_label,
                    is_proxy=is_proxy,
                    values=values,
                )
        except FredClientError:
            continue

    raise FredClientError(f"No usable FRED series found for {key}")


def _filter_candidates(candidates: Sequence[Tuple[str, str, bool]], allow_proxies: bool) -> List[Tuple[str, str, bool]]:
    if allow_proxies:
        return list(candidates)
    return [candidate for candidate in candidates if not candidate[2]]


def _forward_fill_lookup(dates: Sequence[str], raw: Dict[str, float]) -> List[Optional[float]]:
    filled: List[Optional[float]] = []
    last: Optional[float] = None
    for date in dates:
        if date in raw:
            last = raw[date]
        filled.append(last)
    return filled


async def _fetch_sp500_series(start_date: str, end_date: str) -> Tuple[Dict[str, float], str]:
    fred = FredClient()
    source = "FRED SP500"
    series: Dict[str, float] = {}

    try:
        fred_rows = await fred.fetch_series("SP500", start_date=start_date, end_date=end_date)
        series = series_to_dict(fred_rows)
    except Exception:
        series = {}

    desired_start = _parse_iso_date(start_date)
    oldest = _parse_iso_date(min(series.keys())) if series else None
    needs_long_history = bool(desired_start and (oldest is None or oldest > desired_start + timedelta(days=60)))

    if not needs_long_history:
        return series, source

    def _download_yahoo() -> Dict[str, float]:
        hist = yf.download(
            "^GSPC",
            start=start_date,
            end=(datetime.fromisoformat(end_date) + timedelta(days=1)).date().isoformat(),
            interval="1d",
            progress=False,
            auto_adjust=False,
            threads=False,
        )
        if hist is None or hist.empty:
            return {}
        closes = hist.get("Close")
        if closes is None:
            return {}
        result: Dict[str, float] = {}
        for idx, value in closes.items():
            if value is None:
                continue
            try:
                dt = idx.to_pydatetime().date().isoformat()
                result[dt] = float(value)
            except Exception:
                continue
        return result

    yahoo_series = await asyncio.to_thread(_download_yahoo)
    if yahoo_series:
        return yahoo_series, "Yahoo Finance ^GSPC"

    return series, source


async def _fetch_nyc_weather_history(start_date: str, end_date: str) -> List[Dict[str, Any]]:
    params = {
        "latitude": NYC_LAT,
        "longitude": NYC_LON,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "pressure_msl_mean,temperature_2m_mean,precipitation_sum,wind_speed_10m_max",
        "timezone": "America/New_York",
    }

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.get(OPEN_METEO_ARCHIVE_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    pressure_series = daily.get("pressure_msl_mean") or []
    temp_series = daily.get("temperature_2m_mean") or []
    precip_series = daily.get("precipitation_sum") or []
    wind_series = daily.get("wind_speed_10m_max") or []

    rows: List[Dict[str, Any]] = []
    temps: List[float] = []

    for idx, day in enumerate(dates):
        avg_pressure = _safe_float(pressure_series[idx]) if idx < len(pressure_series) else None
        avg_temp = _safe_float(temp_series[idx]) if idx < len(temp_series) else None
        total_precip = _safe_float(precip_series[idx]) if idx < len(precip_series) else 0.0
        peak_wind = _safe_float(wind_series[idx]) if idx < len(wind_series) else 0.0
        if total_precip is None:
            total_precip = 0.0
        if peak_wind is None:
            peak_wind = 0.0

        if avg_temp is not None:
            temps.append(avg_temp)
        trailing = temps[-30:] if temps else []
        temp_baseline = mean(trailing) if trailing else avg_temp
        temp_anomaly = (avg_temp - temp_baseline) if (avg_temp is not None and temp_baseline is not None) else 0.0

        rows.append(
            {
                "date": day,
                "pressure_hpa": round(avg_pressure, 3) if avg_pressure is not None else None,
                "temp_c": round(avg_temp, 3) if avg_temp is not None else None,
                "temp_anomaly_c": round(float(temp_anomaly), 3),
                "precip_mm": round(total_precip, 3),
                "wind_kmh": round(peak_wind, 3),
            }
        )

    precip_z = _zscore([row["precip_mm"] for row in rows])
    wind_z = _zscore([row["wind_kmh"] for row in rows])
    temp_z = _zscore([abs(row["temp_anomaly_c"]) for row in rows])

    for row, z_precip, z_wind, z_temp in zip(rows, precip_z, wind_z, temp_z):
        disruption = 0.45 * z_precip + 0.35 * z_wind + 0.20 * z_temp
        row["weather_disruption_index"] = round(disruption, 4)

    return rows


async def get_weather_market_correlation(days: int = 365, window: int = 30, force_refresh: bool = False) -> Dict[str, Any]:
    cache_key = f"weather:{days}:{window}"
    if not force_refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "from_cache": True}

    today = datetime.utcnow().date()
    start_date = (today - timedelta(days=days + 120)).isoformat()
    end_date = today.isoformat()

    weather_rows = await _fetch_nyc_weather_history(start_date=start_date, end_date=end_date)

    sp500_dict, market_source = await _fetch_sp500_series(start_date=start_date, end_date=end_date)

    weather_by_date = {row["date"]: row for row in weather_rows}
    common_dates = sorted(set(weather_by_date.keys()) & set(sp500_dict.keys()))

    closes = [sp500_dict[date] for date in common_dates]
    disruptions = [weather_by_date[date]["weather_disruption_index"] for date in common_dates]

    returns: List[float] = []
    abs_returns: List[float] = []
    valid_dates: List[str] = []
    valid_disruptions: List[float] = []

    for idx in range(1, len(common_dates)):
        prev_close = closes[idx - 1]
        close = closes[idx]
        if prev_close == 0:
            continue
        ret = ((close / prev_close) - 1.0) * 100.0
        returns.append(ret)
        abs_returns.append(abs(ret))
        valid_dates.append(common_dates[idx])
        valid_disruptions.append(disruptions[idx])

    cutoff = datetime.utcnow() - timedelta(days=days)
    filtered_dates: List[str] = []
    filtered_disruptions: List[float] = []
    filtered_returns: List[float] = []
    filtered_abs_returns: List[float] = []

    for date, disruption, ret, abs_ret in zip(valid_dates, valid_disruptions, returns, abs_returns):
        parsed = _parse_iso_date(date)
        if parsed and parsed >= cutoff:
            filtered_dates.append(date)
            filtered_disruptions.append(disruption)
            filtered_returns.append(ret)
            filtered_abs_returns.append(abs_ret)

    rolling = _rolling_correlation(
        filtered_dates,
        filtered_disruptions,
        filtered_abs_returns,
        window=window,
    )

    same_day_direction = _pearson_summary(filtered_disruptions, filtered_returns)
    same_day_sensitivity = _pearson_summary(filtered_disruptions, filtered_abs_returns)

    lag_results: Dict[str, Dict[str, Any]] = {}
    for lag in (1, 2):
        if len(filtered_disruptions) <= lag:
            lag_results[f"lag_{lag}d"] = {
                "pearson_r": None,
                "p_value": None,
                "samples": 0,
                "significant": False,
            }
            continue

        lead_x = filtered_disruptions[:-lag]
        lead_y = filtered_abs_returns[lag:]
        lag_results[f"lag_{lag}d"] = _pearson_summary(lead_x, lead_y)

    history: List[Dict[str, Any]] = []
    rolling_by_date = {point["date"]: point for point in rolling}

    for date, disruption, ret, abs_ret in zip(
        filtered_dates,
        filtered_disruptions,
        filtered_returns,
        filtered_abs_returns,
    ):
        row = weather_by_date.get(date)
        if not row:
            continue
        roll = rolling_by_date.get(date, {})
        history.append(
            {
                "date": date,
                "sp500_return_pct": round(ret, 4),
                "sp500_abs_return_pct": round(abs_ret, 4),
                "pressure_hpa": row["pressure_hpa"],
                "temp_anomaly_c": row["temp_anomaly_c"],
                "precip_mm": row["precip_mm"],
                "wind_kmh": row["wind_kmh"],
                "weather_disruption_index": disruption,
                "rolling_corr": roll.get("rolling_corr"),
                "rolling_p_value": roll.get("rolling_p_value"),
                "rolling_significant": roll.get("significant", False),
            }
        )

    latest = history[-1] if history else None

    payload = {
        "location": "NYC Metro Proxy",
        "source": {
            "weather": "Open-Meteo Archive (free public)",
            "market": market_source,
        },
        "window_days": window,
        "days": days,
        "generated_at": datetime.utcnow().isoformat(),
        "from_cache": False,
        "latest": latest,
        "correlations": {
            "same_day_direction": same_day_direction,
            "same_day_sensitivity": same_day_sensitivity,
            **lag_results,
        },
        "history": history,
    }

    return _cache_set(cache_key, payload, WEATHER_CACHE_TTL_SECONDS)


async def get_rates_spread_dashboard(
    days: int = 365,
    allow_proxies: bool = False,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    cache_key = f"rates:{days}:{allow_proxies}"
    if not force_refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "from_cache": True}

    today = datetime.utcnow().date()
    start_date = (today - timedelta(days=days + 180)).isoformat()

    fred = FredClient()
    fed_series = await _fetch_first_available_fred_series(
        fred,
        key="fed_rate",
        label="Fed Policy Rate",
        candidates=_filter_candidates([
            ("DFF", "FRED DFF", False),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
    )

    cd_series = await _fetch_first_available_fred_series(
        fred,
        key="cd_proxy",
        label="CD Yield Proxy",
        candidates=_filter_candidates([
            ("IR3TCD01USM156N", "FRED IR3TCD01USM156N", False),
            ("TB3MS", "FRED TB3MS (proxy)", True),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
    )

    muni_series = await _fetch_first_available_fred_series(
        fred,
        key="muni_proxy",
        label="Municipal Yield Proxy",
        candidates=_filter_candidates([
            ("MUNI20Y", "FRED MUNI20Y", False),
            ("MUNI10Y", "FRED MUNI10Y (proxy)", True),
            ("AAA", "FRED AAA (corporate proxy)", True),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
    )

    all_dates = sorted(
        set(fed_series.values.keys())
        | set(cd_series.values.keys())
        | set(muni_series.values.keys())
    )

    fed_filled = _forward_fill_lookup(all_dates, fed_series.values)
    cd_filled = _forward_fill_lookup(all_dates, cd_series.values)
    muni_filled = _forward_fill_lookup(all_dates, muni_series.values)

    cutoff = datetime.utcnow() - timedelta(days=days)
    history: List[Dict[str, Any]] = []

    for date, fed, cd, muni in zip(all_dates, fed_filled, cd_filled, muni_filled):
        if fed is None or cd is None or muni is None:
            continue
        parsed = _parse_iso_date(date)
        if not parsed or parsed < cutoff:
            continue

        fed_cd_spread = fed - cd
        cd_muni_spread = cd - muni
        fed_muni_spread = fed - muni

        history.append(
            {
                "date": date,
                "fed_rate": round(fed, 4),
                "cd_proxy_rate": round(cd, 4),
                "muni_proxy_rate": round(muni, 4),
                "spread_fed_minus_cd": round(fed_cd_spread, 4),
                "spread_cd_minus_muni": round(cd_muni_spread, 4),
                "spread_fed_minus_muni": round(fed_muni_spread, 4),
            }
        )

    if not history:
        payload = {
            "days": days,
            "allow_proxies": allow_proxies,
            "generated_at": datetime.utcnow().isoformat(),
            "from_cache": False,
            "series_meta": {
                "fed_rate": {
                    "label": fed_series.label,
                    "source": fed_series.source,
                    "is_proxy": fed_series.is_proxy,
                },
                "cd_proxy": {
                    "label": cd_series.label,
                    "source": cd_series.source,
                    "is_proxy": cd_series.is_proxy,
                },
                "muni_proxy": {
                    "label": muni_series.label,
                    "source": muni_series.source,
                    "is_proxy": muni_series.is_proxy,
                },
            },
            "latest": None,
            "history": [],
            "radar_snapshot": [],
        }
        return _cache_set(cache_key, payload, RATES_CACHE_TTL_SECONDS)

    spread_strength = [
        abs(point["spread_fed_minus_cd"]) + abs(point["spread_cd_minus_muni"]) + abs(point["spread_fed_minus_muni"])
        for point in history
    ]
    spread_z = _zscore(spread_strength)

    for point, z_value in zip(history, spread_z):
        point["spread_regime_score"] = round(50 + z_value * 15, 2)

    latest = history[-1]

    fed_values = [point["fed_rate"] for point in history]
    cd_values = [point["cd_proxy_rate"] for point in history]
    muni_values = [point["muni_proxy_rate"] for point in history]

    def _min_max_norm(value: float, values: Iterable[float]) -> float:
        values_list = list(values)
        lo = min(values_list)
        hi = max(values_list)
        if hi == lo:
            return 50.0
        return ((value - lo) / (hi - lo)) * 100.0

    radar_snapshot = [
        {
            "metric": "Fed",
            "value": round(_min_max_norm(latest["fed_rate"], fed_values), 2),
            "raw_value": latest["fed_rate"],
        },
        {
            "metric": "CD Proxy",
            "value": round(_min_max_norm(latest["cd_proxy_rate"], cd_values), 2),
            "raw_value": latest["cd_proxy_rate"],
        },
        {
            "metric": "Muni Proxy",
            "value": round(_min_max_norm(latest["muni_proxy_rate"], muni_values), 2),
            "raw_value": latest["muni_proxy_rate"],
        },
    ]

    payload = {
        "days": days,
        "allow_proxies": allow_proxies,
        "generated_at": datetime.utcnow().isoformat(),
        "from_cache": False,
        "series_meta": {
            "fed_rate": {
                "label": fed_series.label,
                "source": fed_series.source,
                "is_proxy": fed_series.is_proxy,
            },
            "cd_proxy": {
                "label": cd_series.label,
                "source": cd_series.source,
                "is_proxy": cd_series.is_proxy,
            },
            "muni_proxy": {
                "label": muni_series.label,
                "source": muni_series.source,
                "is_proxy": muni_series.is_proxy,
            },
        },
        "latest": latest,
        "history": history,
        "radar_snapshot": radar_snapshot,
    }
    return _cache_set(cache_key, payload, RATES_CACHE_TTL_SECONDS)
