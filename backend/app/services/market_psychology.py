from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
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
WEATHER_SCORE_COMPONENTS = (
    {
        "key": "pressure_shift",
        "label": "Pressure swing",
        "description": "Absolute day-over-day move in mean sea-level pressure.",
        "weight": 0.35,
        "raw_field": "pressure_change_hpa",
        "score_field": "pressure_shift_score",
        "unit": "hPa",
    },
    {
        "key": "precipitation_shock",
        "label": "Rainfall shock",
        "description": "Rainfall relative to the full sample history.",
        "weight": 0.30,
        "raw_field": "precip_mm",
        "score_field": "precipitation_stress_score",
        "unit": "mm",
    },
    {
        "key": "wind_stress",
        "label": "Wind stress",
        "description": "Peak daily wind speed relative to the full sample history.",
        "weight": 0.20,
        "raw_field": "wind_kmh",
        "score_field": "wind_stress_score",
        "unit": "km/h",
    },
    {
        "key": "temperature_departure",
        "label": "Temperature departure",
        "description": "Absolute difference versus the seasonal average for the same calendar day.",
        "weight": 0.15,
        "raw_field": "temp_anomaly_c",
        "score_field": "temperature_stress_score",
        "unit": "C",
    },
)
RATES_SCORE_COMPONENTS = (
    {
        "key": "policy_vs_bank_gap",
        "label": "Policy vs bank CD gap",
        "description": "Effective fed funds rate minus the bank CD leg used in this study.",
        "field": "spread_fed_minus_cd",
        "unit": "pct",
    },
    {
        "key": "bank_vs_muni_gap",
        "label": "Bank CD vs municipal gap",
        "description": "Bank CD leg minus the municipal bond leg used in this study.",
        "field": "spread_cd_minus_muni",
        "unit": "pct",
    },
    {
        "key": "policy_vs_muni_gap",
        "label": "Policy vs municipal gap",
        "description": "Effective fed funds rate minus the municipal bond leg used in this study.",
        "field": "spread_fed_minus_muni",
        "unit": "pct",
    },
    {
        "key": "cross_market_dispersion",
        "label": "Cross-market dispersion percentile",
        "description": "Percentile rank of the combined adjacent gaps over the selected lookback window.",
        "field": "spread_regime_score",
        "unit": "score",
    },
)


@dataclass
class CacheEntry:
    expires_at: float
    payload: Dict[str, Any]


_CACHE: Dict[str, CacheEntry] = {}
WEATHER_GRANULARITIES = {"day", "week", "month", "auto"}
WEATHER_SIGNAL_KEYS = (
    "weather_stress_score",
    "pressure_hpa",
    "precip_mm",
    "temp_c",
    "wind_kmh",
)


@dataclass
class SeriesResult:
    key: str
    label: str
    source: str
    is_proxy: bool
    values: Dict[str, float]
    last_observation_date: Optional[str] = None


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


def _resolve_weather_granularity(days: int, granularity: str) -> str:
    normalized = (granularity or "auto").lower()
    if normalized not in WEATHER_GRANULARITIES:
        normalized = "auto"
    if normalized != "auto":
        return normalized
    if days <= 31:
        return "day"
    if days <= 366:
        return "week"
    return "month"


def _calendar_key(date_str: str) -> str:
    parsed = _parse_iso_date(date_str)
    if not parsed:
        return date_str
    return parsed.strftime("%m-%d")


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


def _percentile_rank(values: Sequence[float], current_value: float) -> float:
    if not values or len(values) == 1:
        return 50.0

    below = sum(1 for value in values if value < current_value)
    equal = sum(1 for value in values if value == current_value)
    percentile = ((below + max(equal - 1, 0) * 0.5) / (len(values) - 1)) * 100.0
    return max(0.0, min(100.0, percentile))


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


def _pearson_summary_optional(
    x: Sequence[Optional[float]],
    y: Sequence[float],
    min_samples: int = 20,
) -> Dict[str, Any]:
    pairs = [(x_value, y_value) for x_value, y_value in zip(x, y) if x_value is not None]
    if len(pairs) < min_samples:
        return {
            "pearson_r": None,
            "p_value": None,
            "samples": len(pairs),
            "significant": False,
        }

    filtered_x = [x_value for x_value, _ in pairs]
    filtered_y = [y_value for _, y_value in pairs]
    return _pearson_summary(filtered_x, filtered_y, min_samples=min_samples)


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
    effective_min_samples = min(min_samples, max(window, 3))

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
        corr = _pearson_summary(x_window, y_window, min_samples=effective_min_samples)

        points.append(
            {
                "date": dates[idx],
                "rolling_corr": corr["pearson_r"],
                "rolling_p_value": corr["p_value"],
                "significant": corr["significant"],
            }
        )

    return points


def _rolling_correlation_optional(
    dates: Sequence[str],
    x: Sequence[Optional[float]],
    y: Sequence[float],
    window: int,
    min_samples: int = 20,
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    if len(dates) != len(x) or len(dates) != len(y):
        return points
    effective_min_samples = min(min_samples, max(window, 3))

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
        corr = _pearson_summary_optional(x_window, y_window, min_samples=effective_min_samples)

        points.append(
            {
                "date": dates[idx],
                "rolling_corr": corr["pearson_r"],
                "rolling_p_value": corr["p_value"],
                "significant": corr["significant"],
            }
        )

    return points


def _bucket_label(date_str: str, granularity: str) -> str:
    parsed = _parse_iso_date(date_str)
    if not parsed:
        return date_str
    if granularity == "month":
        return parsed.strftime("%Y-%m")
    if granularity == "week":
        iso_year, iso_week, _ = parsed.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    return parsed.date().isoformat()


def _aggregate_weather_history(history: List[Dict[str, Any]], granularity: str) -> List[Dict[str, Any]]:
    if granularity == "day":
        return history

    buckets: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    def _flush(bucket: Dict[str, Any]) -> Dict[str, Any]:
        count = bucket["count"] or 1
        pressure_count = bucket["pressure_count"] or 1
        avg_temp_count = bucket["avg_temp_count"] or 1
        temp_count = bucket["temp_count"] or 1
        return {
            "date": bucket["last_date"],
            "period_label": bucket["period_label"],
            "sp500_return_pct": round(bucket["sum_return"] / count, 4),
            "sp500_abs_return_pct": round(bucket["sum_abs_return"] / count, 4),
            "pressure_hpa": round(bucket["sum_pressure"] / pressure_count, 3) if bucket["pressure_count"] else None,
            "pressure_change_hpa": round(bucket["sum_pressure_change"] / count, 3),
            "temp_c": round(bucket["sum_temp"] / avg_temp_count, 3) if bucket["avg_temp_count"] else None,
            "temp_anomaly_c": round(bucket["sum_temp_anomaly"] / temp_count, 3) if bucket["temp_count"] else 0.0,
            "precip_mm": round(bucket["sum_precip"], 3) if granularity in {"week", "month"} else round(bucket["sum_precip"] / count, 3),
            "wind_kmh": round(bucket["max_wind"], 3),
            "pressure_shift_score": round(bucket["sum_pressure_score"] / count, 4),
            "precipitation_stress_score": round(bucket["sum_precip_score"] / count, 4),
            "wind_stress_score": round(bucket["sum_wind_score"] / count, 4),
            "temperature_stress_score": round(bucket["sum_temp_score"] / count, 4),
            "weather_stress_score": round(bucket["sum_stress"] / count, 4),
            "weather_disruption_index": round(bucket["sum_disruption"] / count, 4),
            "rolling_corr": bucket["last_rolling_corr"],
            "rolling_p_value": bucket["last_rolling_p_value"],
            "rolling_significant": bucket["last_rolling_significant"],
            "signal_correlations": bucket["last_signal_correlations"],
        }

    for point in history:
        label = _bucket_label(point["date"], granularity)
        if current is None or current["period_label"] != label:
            if current is not None:
                buckets.append(_flush(current))
            current = {
                "period_label": label,
                "last_date": point["date"],
                "count": 0,
                "sum_return": 0.0,
                "sum_abs_return": 0.0,
                "sum_pressure": 0.0,
                "sum_pressure_change": 0.0,
                "pressure_count": 0,
                "sum_temp": 0.0,
                "avg_temp_count": 0,
                "sum_temp_anomaly": 0.0,
                "temp_count": 0,
                "sum_precip": 0.0,
                "max_wind": 0.0,
                "sum_pressure_score": 0.0,
                "sum_precip_score": 0.0,
                "sum_wind_score": 0.0,
                "sum_temp_score": 0.0,
                "sum_stress": 0.0,
                "sum_disruption": 0.0,
                "last_rolling_corr": None,
                "last_rolling_p_value": None,
                "last_rolling_significant": False,
                "last_signal_correlations": {},
            }

        current["last_date"] = point["date"]
        current["count"] += 1
        current["sum_return"] += point.get("sp500_return_pct", 0.0)
        current["sum_abs_return"] += point.get("sp500_abs_return_pct", 0.0)
        pressure = point.get("pressure_hpa")
        if pressure is not None:
            current["sum_pressure"] += pressure
            current["pressure_count"] += 1
        current["sum_pressure_change"] += point.get("pressure_change_hpa", 0.0) or 0.0
        temp_c = point.get("temp_c")
        if temp_c is not None:
            current["sum_temp"] += temp_c
            current["avg_temp_count"] += 1
        temp_anomaly = point.get("temp_anomaly_c")
        if temp_anomaly is not None:
            current["sum_temp_anomaly"] += temp_anomaly
            current["temp_count"] += 1
        current["sum_precip"] += point.get("precip_mm", 0.0)
        current["max_wind"] = max(current["max_wind"], point.get("wind_kmh", 0.0) or 0.0)
        current["sum_pressure_score"] += point.get("pressure_shift_score", 0.0) or 0.0
        current["sum_precip_score"] += point.get("precipitation_stress_score", 0.0) or 0.0
        current["sum_wind_score"] += point.get("wind_stress_score", 0.0) or 0.0
        current["sum_temp_score"] += point.get("temperature_stress_score", 0.0) or 0.0
        current["sum_stress"] += point.get("weather_stress_score", point.get("weather_disruption_index", 0.0)) or 0.0
        current["sum_disruption"] += point.get("weather_disruption_index", 0.0)
        if point.get("signal_correlations"):
            current["last_signal_correlations"] = point.get("signal_correlations") or {}
        if point.get("rolling_corr") is not None:
            current["last_rolling_corr"] = point.get("rolling_corr")
            current["last_rolling_p_value"] = point.get("rolling_p_value")
            current["last_rolling_significant"] = point.get("rolling_significant", False)

    if current is not None:
        buckets.append(_flush(current))

    return buckets


async def _fetch_first_available_fred_series(
    fred: FredClient,
    key: str,
    label: str,
    candidates: Sequence[Tuple[str, str, bool]],
    start_date: str,
    end_date: Optional[str] = None,
    max_staleness_days: Optional[int] = None,
) -> SeriesResult:
    for series_id, source_label, is_proxy in candidates:
        try:
            rows = await fred.fetch_series(series_id, start_date=start_date)
            values = series_to_dict(rows)
            if values:
                last_observation_date = max(values.keys())
                if max_staleness_days is not None:
                    reference = datetime.fromisoformat(end_date).date() if end_date else datetime.utcnow().date()
                    latest = _parse_iso_date(last_observation_date)
                    if latest is None or (reference - latest.date()).days > max_staleness_days:
                        continue
                return SeriesResult(
                    key=key,
                    label=label,
                    source=source_label,
                    is_proxy=is_proxy,
                    values=values,
                    last_observation_date=last_observation_date,
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


def _chunk_date_ranges(start_date: str, end_date: str, chunk_days: int = 1825) -> List[Tuple[str, str]]:
    start = datetime.fromisoformat(start_date).date()
    end = datetime.fromisoformat(end_date).date()
    ranges: List[Tuple[str, str]] = []

    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=chunk_days - 1))
        ranges.append((cursor.isoformat(), chunk_end.isoformat()))
        cursor = chunk_end + timedelta(days=1)

    return ranges


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
        close_data = hist.get("Close")
        if close_data is None:
            return {}
        closes = close_data
        if hasattr(close_data, "columns"):
            columns = list(getattr(close_data, "columns", []))
            if not columns:
                return {}
            if "^GSPC" in columns:
                closes = close_data["^GSPC"]
            else:
                closes = close_data[columns[0]]
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
    all_rows: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=60) as client:
        for chunk_start, chunk_end in _chunk_date_ranges(start_date, end_date, chunk_days=1825):
            params = {
                "latitude": NYC_LAT,
                "longitude": NYC_LON,
                "start_date": chunk_start,
                "end_date": chunk_end,
                "daily": "pressure_msl_mean,temperature_2m_mean,precipitation_sum,wind_speed_10m_max",
                "timezone": "America/New_York",
            }
            response = await client.get(OPEN_METEO_ARCHIVE_URL, params=params)
            response.raise_for_status()
            payload = response.json()

            daily = payload.get("daily") or {}
            dates = daily.get("time") or []
            pressure_series = daily.get("pressure_msl_mean") or []
            temp_series = daily.get("temperature_2m_mean") or []
            precip_series = daily.get("precipitation_sum") or []
            wind_series = daily.get("wind_speed_10m_max") or []

            for idx, day in enumerate(dates):
                avg_pressure = _safe_float(pressure_series[idx]) if idx < len(pressure_series) else None
                avg_temp = _safe_float(temp_series[idx]) if idx < len(temp_series) else None
                total_precip = _safe_float(precip_series[idx]) if idx < len(precip_series) else 0.0
                peak_wind = _safe_float(wind_series[idx]) if idx < len(wind_series) else 0.0
                if total_precip is None:
                    total_precip = 0.0
                if peak_wind is None:
                    peak_wind = 0.0

                all_rows.append(
                    {
                        "date": day,
                        "pressure_hpa": round(avg_pressure, 3) if avg_pressure is not None else None,
                        "temp_c": round(avg_temp, 3) if avg_temp is not None else None,
                        "precip_mm": round(total_precip, 3),
                        "wind_kmh": round(peak_wind, 3),
                    }
                )

    deduped_by_date = {row["date"]: row for row in all_rows}
    ordered_rows = [deduped_by_date[date] for date in sorted(deduped_by_date.keys())]

    temp_climatology: Dict[str, float] = {}
    climatology_buckets: Dict[str, List[float]] = {}
    for row in ordered_rows:
        avg_temp = row.get("temp_c")
        if avg_temp is None:
            continue
        climatology_buckets.setdefault(_calendar_key(row["date"]), []).append(avg_temp)
    for key, values in climatology_buckets.items():
        temp_climatology[key] = mean(values)

    rows: List[Dict[str, Any]] = []
    previous_pressure: Optional[float] = None

    for row in ordered_rows:
        day = row["date"]
        avg_pressure = row["pressure_hpa"]
        avg_temp = row["temp_c"]
        total_precip = row["precip_mm"]
        peak_wind = row["wind_kmh"]

        temp_baseline = temp_climatology.get(_calendar_key(day), avg_temp)
        temp_anomaly = (avg_temp - temp_baseline) if (avg_temp is not None and temp_baseline is not None) else 0.0
        pressure_change = abs(avg_pressure - previous_pressure) if (avg_pressure is not None and previous_pressure is not None) else 0.0
        if avg_pressure is not None:
            previous_pressure = avg_pressure

        rows.append(
            {
                "date": day,
                "pressure_hpa": round(avg_pressure, 3) if avg_pressure is not None else None,
                "pressure_change_hpa": round(float(pressure_change), 3),
                "temp_c": round(avg_temp, 3) if avg_temp is not None else None,
                "temp_anomaly_c": round(float(temp_anomaly), 3),
                "precip_mm": round(total_precip, 3),
                "wind_kmh": round(peak_wind, 3),
            }
        )

    pressure_z = _zscore([row["pressure_change_hpa"] for row in rows])
    precip_z = _zscore([row["precip_mm"] for row in rows])
    wind_z = _zscore([row["wind_kmh"] for row in rows])
    temp_z = _zscore([abs(row["temp_anomaly_c"]) for row in rows])

    for row, z_pressure, z_precip, z_wind, z_temp in zip(rows, pressure_z, precip_z, wind_z, temp_z):
        disruption = (
            WEATHER_SCORE_COMPONENTS[0]["weight"] * z_pressure
            + WEATHER_SCORE_COMPONENTS[1]["weight"] * z_precip
            + WEATHER_SCORE_COMPONENTS[2]["weight"] * z_wind
            + WEATHER_SCORE_COMPONENTS[3]["weight"] * z_temp
        )
        row["pressure_shift_score"] = round(float(z_pressure), 4)
        row["precipitation_stress_score"] = round(float(z_precip), 4)
        row["wind_stress_score"] = round(float(z_wind), 4)
        row["temperature_stress_score"] = round(float(z_temp), 4)
        row["weather_stress_score"] = round(disruption, 4)
        row["weather_disruption_index"] = round(disruption, 4)

    return rows


def _resolve_weather_analysis_window(
    days: int,
    window: int,
    calendar_year: Optional[int],
    today: Optional[date] = None,
) -> Tuple[date, date, date]:
    resolved_today = today or datetime.utcnow().date()
    warmup_days = max(window, 120)

    if calendar_year is not None:
        if calendar_year < 2000:
            raise ValueError("calendar_year must be 2000 or later")
        if calendar_year > resolved_today.year:
            raise ValueError("calendar_year cannot be in the future")

        analysis_start = date(calendar_year, 1, 1)
        analysis_end = resolved_today if calendar_year == resolved_today.year else date(calendar_year, 12, 31)
        fetch_start = analysis_start - timedelta(days=warmup_days)
        return analysis_start, analysis_end, fetch_start

    analysis_end = resolved_today
    analysis_start = resolved_today - timedelta(days=days)
    fetch_start = analysis_start - timedelta(days=warmup_days)
    return analysis_start, analysis_end, fetch_start


async def get_weather_market_correlation(
    days: int = 365,
    window: int = 30,
    calendar_year: Optional[int] = None,
    granularity: str = "auto",
    force_refresh: bool = False,
) -> Dict[str, Any]:
    resolved_granularity = _resolve_weather_granularity(days, granularity)
    analysis_start, analysis_end, fetch_start = _resolve_weather_analysis_window(days, window, calendar_year)
    cache_key = f"weather:{days}:{window}:{resolved_granularity}:{analysis_start.isoformat()}:{analysis_end.isoformat()}"
    if not force_refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "from_cache": True}

    start_date = fetch_start.isoformat()
    end_date = analysis_end.isoformat()

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

    filtered_dates: List[str] = []
    filtered_disruptions: List[float] = []
    filtered_returns: List[float] = []
    filtered_abs_returns: List[float] = []
    filtered_pressure: List[Optional[float]] = []
    filtered_precip: List[Optional[float]] = []
    filtered_temp: List[Optional[float]] = []
    filtered_wind: List[Optional[float]] = []

    for date, disruption, ret, abs_ret in zip(valid_dates, valid_disruptions, returns, abs_returns):
        parsed = _parse_iso_date(date)
        if parsed and analysis_start <= parsed.date() <= analysis_end:
            filtered_dates.append(date)
            filtered_disruptions.append(disruption)
            filtered_returns.append(ret)
            filtered_abs_returns.append(abs_ret)
            weather_row = weather_by_date.get(date) or {}
            filtered_pressure.append(weather_row.get("pressure_hpa"))
            filtered_precip.append(weather_row.get("precip_mm"))
            filtered_temp.append(weather_row.get("temp_c"))
            filtered_wind.append(weather_row.get("wind_kmh"))

    rolling = _rolling_correlation(
        filtered_dates,
        filtered_disruptions,
        filtered_returns,
        window=window,
    )

    rolling_by_signal = {
        "weather_stress_score": rolling,
        "pressure_hpa": _rolling_correlation_optional(filtered_dates, filtered_pressure, filtered_returns, window=window),
        "precip_mm": _rolling_correlation_optional(filtered_dates, filtered_precip, filtered_returns, window=window),
        "temp_c": _rolling_correlation_optional(filtered_dates, filtered_temp, filtered_returns, window=window),
        "wind_kmh": _rolling_correlation_optional(filtered_dates, filtered_wind, filtered_returns, window=window),
    }

    same_day_direction = _pearson_summary(filtered_disruptions, filtered_returns)
    same_day_sensitivity = _pearson_summary(filtered_disruptions, filtered_abs_returns)

    signal_correlations = {
        "weather_stress_score": {
            "same_day_direction": same_day_direction,
        },
        "pressure_hpa": {
            "same_day_direction": _pearson_summary_optional(filtered_pressure, filtered_returns),
        },
        "precip_mm": {
            "same_day_direction": _pearson_summary_optional(filtered_precip, filtered_returns),
        },
        "temp_c": {
            "same_day_direction": _pearson_summary_optional(filtered_temp, filtered_returns),
        },
        "wind_kmh": {
            "same_day_direction": _pearson_summary_optional(filtered_wind, filtered_returns),
        },
    }

    lag_results: Dict[str, Dict[str, Any]] = {}
    for lag in (1, 2):
        if len(filtered_disruptions) <= lag:
            lag_results[f"lag_{lag}d"] = {
                "pearson_r": None,
                "p_value": None,
                "samples": 0,
                "significant": False,
            }
            for signal_key in WEATHER_SIGNAL_KEYS:
                signal_correlations[signal_key][f"lag_{lag}d"] = {
                    "pearson_r": None,
                    "p_value": None,
                    "samples": 0,
                    "significant": False,
                }
            continue

        lead_x = filtered_disruptions[:-lag]
        lead_y = filtered_returns[lag:]
        lag_results[f"lag_{lag}d"] = _pearson_summary(lead_x, lead_y)
        signal_correlations["weather_stress_score"][f"lag_{lag}d"] = lag_results[f"lag_{lag}d"]
        signal_correlations["pressure_hpa"][f"lag_{lag}d"] = _pearson_summary_optional(filtered_pressure[:-lag], lead_y)
        signal_correlations["precip_mm"][f"lag_{lag}d"] = _pearson_summary_optional(filtered_precip[:-lag], lead_y)
        signal_correlations["temp_c"][f"lag_{lag}d"] = _pearson_summary_optional(filtered_temp[:-lag], lead_y)
        signal_correlations["wind_kmh"][f"lag_{lag}d"] = _pearson_summary_optional(filtered_wind[:-lag], lead_y)

    history: List[Dict[str, Any]] = []
    rolling_by_date = {point["date"]: point for point in rolling}
    rolling_by_signal_and_date = {
        signal_key: {point["date"]: point for point in signal_points}
        for signal_key, signal_points in rolling_by_signal.items()
    }

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
        signal_rolls = {
            signal_key: {
                "rolling_corr": rolling_by_signal_and_date.get(signal_key, {}).get(date, {}).get("rolling_corr"),
                "rolling_p_value": rolling_by_signal_and_date.get(signal_key, {}).get(date, {}).get("rolling_p_value"),
                "rolling_significant": rolling_by_signal_and_date.get(signal_key, {}).get(date, {}).get("significant", False),
            }
            for signal_key in WEATHER_SIGNAL_KEYS
        }
        history.append(
            {
                "date": date,
                "sp500_return_pct": round(ret, 4),
                "sp500_abs_return_pct": round(abs_ret, 4),
                "pressure_hpa": row["pressure_hpa"],
                "pressure_change_hpa": row["pressure_change_hpa"],
                "temp_c": row["temp_c"],
                "temp_anomaly_c": row["temp_anomaly_c"],
                "precip_mm": row["precip_mm"],
                "wind_kmh": row["wind_kmh"],
                "pressure_shift_score": row["pressure_shift_score"],
                "precipitation_stress_score": row["precipitation_stress_score"],
                "wind_stress_score": row["wind_stress_score"],
                "temperature_stress_score": row["temperature_stress_score"],
                "weather_stress_score": row["weather_stress_score"],
                "weather_disruption_index": disruption,
                "rolling_corr": roll.get("rolling_corr"),
                "rolling_p_value": roll.get("rolling_p_value"),
                "rolling_significant": roll.get("significant", False),
                "signal_correlations": signal_rolls,
            }
        )

    display_history = _aggregate_weather_history(history, resolved_granularity)
    latest = display_history[-1] if display_history else None

    payload = {
        "location": "NYC Metro Proxy",
        "source": {
            "weather": "Open-Meteo Archive (free public)",
            "market": market_source,
        },
        "window_days": window,
        "days": days,
        "calendar_year": calendar_year,
        "period_start": analysis_start.isoformat(),
        "period_end": analysis_end.isoformat(),
        "display_granularity": resolved_granularity,
        "raw_history_points": len(history),
        "display_history_points": len(display_history),
        "score_components": WEATHER_SCORE_COMPONENTS,
        "generated_at": datetime.utcnow().isoformat(),
        "from_cache": False,
        "latest": latest,
        "correlations": {
            "same_day_direction": same_day_direction,
            "same_day_sensitivity": same_day_sensitivity,
            **lag_results,
        },
        "signal_correlations": signal_correlations,
        "history": display_history,
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
    end_date = today.isoformat()

    fred = FredClient()
    fed_series = await _fetch_first_available_fred_series(
        fred,
        key="fed_rate",
        label="Effective Fed Funds Rate",
        candidates=_filter_candidates([
            ("DFF", "FRED DFF", False),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
        end_date=end_date,
        max_staleness_days=7,
    )

    cd_series = await _fetch_first_available_fred_series(
        fred,
        key="cd_proxy",
        label="3-Month Bank CD Yield",
        candidates=_filter_candidates([
            ("IR3TCD01USM156N", "FRED IR3TCD01USM156N", False),
            ("DGS3MO", "FRED DGS3MO (Treasury proxy)", True),
            ("TB3MS", "FRED TB3MS (Treasury proxy)", True),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
        end_date=end_date,
        max_staleness_days=45,
    )

    muni_series = await _fetch_first_available_fred_series(
        fred,
        key="muni_proxy",
        label="Long Municipal Bond Yield",
        candidates=_filter_candidates([
            ("M13050USM156NNBR", "FRED M13050USM156NNBR", False),
            ("M13043USM156NNBR", "FRED M13043USM156NNBR (proxy)", True),
            ("AAA", "FRED AAA (corporate proxy)", True),
        ], allow_proxies=allow_proxies),
        start_date=start_date,
        end_date=end_date,
        max_staleness_days=45,
    )

    all_dates = sorted(
        set(fed_series.values.keys())
        | set(cd_series.values.keys())
        | set(muni_series.values.keys())
    )

    fed_filled = _forward_fill_lookup(all_dates, fed_series.values)
    cd_filled = _forward_fill_lookup(all_dates, cd_series.values)
    muni_filled = _forward_fill_lookup(all_dates, muni_series.values)

    cutoff = today - timedelta(days=days)
    history: List[Dict[str, Any]] = []

    for date, fed, cd, muni in zip(all_dates, fed_filled, cd_filled, muni_filled):
        if fed is None or cd is None or muni is None:
            continue
        parsed = _parse_iso_date(date)
        if not parsed or parsed.date() < cutoff:
            continue

        fed_cd_spread = fed - cd
        cd_muni_spread = cd - muni
        fed_muni_spread = fed - muni
        adjacent_dispersion_bps = (abs(fed_cd_spread) + abs(cd_muni_spread)) * 100.0

        history.append(
            {
                "date": date,
                "fed_rate": round(fed, 4),
                "cd_proxy_rate": round(cd, 4),
                "muni_proxy_rate": round(muni, 4),
                "spread_fed_minus_cd": round(fed_cd_spread, 4),
                "spread_cd_minus_muni": round(cd_muni_spread, 4),
                "spread_fed_minus_muni": round(fed_muni_spread, 4),
                "adjacent_dispersion_bps": round(adjacent_dispersion_bps, 2),
            }
        )

    if not history:
        payload = {
            "status": "unavailable",
            "days": days,
            "allow_proxies": allow_proxies,
            "generated_at": datetime.utcnow().isoformat(),
            "from_cache": False,
            "series_meta": {
                "fed_rate": {
                    "label": fed_series.label,
                    "source": fed_series.source,
                    "is_proxy": fed_series.is_proxy,
                    "last_observation_date": fed_series.last_observation_date,
                },
                "cd_proxy": {
                    "label": cd_series.label,
                    "source": cd_series.source,
                    "is_proxy": cd_series.is_proxy,
                    "last_observation_date": cd_series.last_observation_date,
                },
                "muni_proxy": {
                    "label": muni_series.label,
                    "source": muni_series.source,
                    "is_proxy": muni_series.is_proxy,
                    "last_observation_date": muni_series.last_observation_date,
                },
            },
            "latest": None,
            "history": [],
            "radar_snapshot": [],
            "score_components": RATES_SCORE_COMPONENTS,
        }
        return _cache_set(cache_key, payload, RATES_CACHE_TTL_SECONDS)

    dispersion_series = [point["adjacent_dispersion_bps"] for point in history]

    for point in history:
        point["spread_regime_score"] = round(_percentile_rank(dispersion_series, point["adjacent_dispersion_bps"]), 2)
        point["regime_label"] = (
            "Wide dispersion"
            if point["spread_regime_score"] >= 67
            else "Compressed dispersion"
            if point["spread_regime_score"] <= 33
            else "Typical dispersion"
        )

    latest = history[-1]

    fed_values = [point["fed_rate"] for point in history]
    cd_values = [point["cd_proxy_rate"] for point in history]
    muni_values = [point["muni_proxy_rate"] for point in history]

    radar_snapshot = [
        {
            "metric": "Policy rate",
            "value": round(_percentile_rank(fed_values, latest["fed_rate"]), 2),
            "raw_value": latest["fed_rate"],
        },
        {
            "metric": "Bank CD yield",
            "value": round(_percentile_rank(cd_values, latest["cd_proxy_rate"]), 2),
            "raw_value": latest["cd_proxy_rate"],
        },
        {
            "metric": "Municipal yield",
            "value": round(_percentile_rank(muni_values, latest["muni_proxy_rate"]), 2),
            "raw_value": latest["muni_proxy_rate"],
        },
    ]

    payload = {
        "status": "ok",
        "days": days,
        "allow_proxies": allow_proxies,
        "generated_at": datetime.utcnow().isoformat(),
        "from_cache": False,
        "series_meta": {
            "fed_rate": {
                "label": fed_series.label,
                "source": fed_series.source,
                "is_proxy": fed_series.is_proxy,
                "last_observation_date": fed_series.last_observation_date,
            },
            "cd_proxy": {
                "label": cd_series.label,
                "source": cd_series.source,
                "is_proxy": cd_series.is_proxy,
                "last_observation_date": cd_series.last_observation_date,
            },
            "muni_proxy": {
                "label": muni_series.label,
                "source": muni_series.source,
                "is_proxy": muni_series.is_proxy,
                "last_observation_date": muni_series.last_observation_date,
            },
        },
        "score_components": RATES_SCORE_COMPONENTS,
        "latest": latest,
        "history": history,
        "radar_snapshot": radar_snapshot,
    }
    return _cache_set(cache_key, payload, RATES_CACHE_TTL_SECONDS)
