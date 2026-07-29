from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from io import BytesIO
import logging
from typing import Any, Dict, List, Optional
import zipfile
import xml.etree.ElementTree as ET

import httpx

from app.core.config import settings
from app.core.indicator_constants import (
    MUNI_PUBLIC_SECTOR_COMPONENTS,
    MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL,
    MUNI_PUBLIC_SECTOR_NEAR_THRESHOLD_DELTA,
    MUNI_PUBLIC_SECTOR_STRESS_CUES,
    MUNI_PUBLIC_SECTOR_THRESHOLDS,
)
from app.services.analytics import compute_z_scores, direction_adjusted, map_z_to_score
from app.services.endpoint_response_cache import (
    async_response_refresh_lock,
    load_response_snapshot,
    mark_stale_snapshot,
    store_response_snapshot,
)
from app.services.ingestion.fred_client import FredClient
from app.utils.data_helpers import series_to_dict, find_common_dates

SIFMA_SWAP_DEFAULT_URL = "https://www.sifma.org/wp-content/uploads/2024/01/Muni-Swap-Historical-Data.xlsx"
_MUNI_CACHE_TTL_SECONDS = 6 * 60 * 60
_MUNI_MAX_STALE_AGE_SECONDS = 7 * 24 * 60 * 60
_SIFMA_TIMEOUT_SECONDS = 8
logger = logging.getLogger(__name__)


def _excel_serial_to_date(serial_value: float) -> str:
    """Convert Excel serial date to ISO date string."""
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=int(serial_value))).date().isoformat()


def _parse_shared_strings(xml_bytes: bytes) -> List[str]:
    root = ET.fromstring(xml_bytes)
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    strings: List[str] = []
    for si in root.findall("m:si", ns):
        texts = [t.text or "" for t in si.findall(".//m:t", ns)]
        strings.append("".join(texts))
    return strings


def _parse_sifma_xlsx(content: bytes) -> List[Dict[str, Any]]:
    """Parse SIFMA XLSX file with Date and Index Value columns."""
    results: List[Dict[str, Any]] = []
    with zipfile.ZipFile(BytesIO(content)) as zip_file:
        shared_strings = _parse_shared_strings(zip_file.read("xl/sharedStrings.xml"))
        sheet_xml = zip_file.read("xl/worksheets/sheet1.xml")

    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ET.fromstring(sheet_xml)

    for row in root.findall(".//m:sheetData/m:row", ns):
        row_data: Dict[str, Any] = {}
        for cell in row.findall("m:c", ns):
            cell_ref = cell.get("r") or ""
            col = "".join(ch for ch in cell_ref if ch.isalpha())
            if not col:
                continue
            value_node = cell.find("m:v", ns)
            if value_node is None or value_node.text is None:
                continue
            cell_type = cell.get("t")
            if cell_type == "s":
                try:
                    row_data[col] = shared_strings[int(value_node.text)]
                except (ValueError, IndexError):
                    continue
            else:
                try:
                    row_data[col] = float(value_node.text)
                except ValueError:
                    continue

        if "A" not in row_data or "B" not in row_data:
            continue
        if isinstance(row_data["A"], str):
            # Header row
            continue

        results.append({
            "date": _excel_serial_to_date(row_data["A"]),
            "value": float(row_data["B"]),
        })

    results.sort(key=lambda x: x["date"])
    return results


def _compute_scores(values: List[float], direction: int, lookback: int) -> List[int]:
    if not values:
        return []
    lookback = min(lookback, len(values))
    z_scores = compute_z_scores(values, lookback=lookback)
    adjusted = direction_adjusted(z_scores, direction)
    return [map_z_to_score(z) for z in adjusted]


def _compute_z_scores(values: List[float], lookback: int) -> List[float]:
    if not values:
        return []
    lookback = min(lookback, len(values))
    return compute_z_scores(values, lookback=lookback)


def _infer_series_lookback(dates: List[str], default_daily: int = 252, default_weekly: int = 104) -> int:
    if len(dates) < 3:
        return default_daily
    parsed = []
    for d in dates[-10:]:
        parsed_date = _parse_date(d)
        if parsed_date:
            parsed.append(parsed_date)
    if len(parsed) < 3:
        return default_daily
    deltas = [
        (parsed[i] - parsed[i - 1]).days
        for i in range(1, len(parsed))
        if (parsed[i] - parsed[i - 1]).days > 0
    ]
    if not deltas:
        return default_daily
    median_delta = sorted(deltas)[len(deltas) // 2]
    return default_weekly if median_delta >= 6 else default_daily


def _compute_trend_from_metric(
    dates: List[str],
    values: List[float],
    window_days: int,
    threshold: float = 0.0,
) -> str:
    if len(values) < 2 or len(dates) < 2:
        return "insufficient_data"
    latest_value = values[-1]
    latest_date = _parse_date(dates[-1])
    if latest_date is None:
        return "insufficient_data"
    cutoff = latest_date - timedelta(days=window_days)
    prior_idx = None
    for i in range(len(dates) - 2, -1, -1):
        date = _parse_date(dates[i])
        if date and date <= cutoff:
            prior_idx = i
            break
    if prior_idx is None:
        prior_idx = max(0, len(values) - 2)
    delta = latest_value - values[prior_idx]
    if delta > threshold:
        return "worsening"
    if delta < -threshold:
        return "improving"
    return "stable"


def _compute_trend(scores: List[float], threshold: float = 5.0) -> str:
    if len(scores) < 5:
        return "insufficient_data"
    delta = scores[-1] - scores[-5]
    if delta > threshold:
        return "improving"
    if delta < -threshold:
        return "deteriorating"
    return "stable"


def _parse_date(date_value: str) -> Optional[datetime]:
    if not date_value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(date_value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(date_value)
    except ValueError:
        return None


def _filter_history(history: List[Dict[str, Any]], cutoff: datetime) -> List[Dict[str, Any]]:
    filtered = []
    for point in history:
        point_date = _parse_date(point.get("date"))
        if not point_date:
            continue
        if point_date >= cutoff:
            filtered.append(point)
    return filtered


def _build_series_payload(
    key: str,
    label: str,
    source: str,
    unit: str,
    dates: List[str],
    metric_values: List[float],
    direction: int,
    cutoff: datetime,
    notes: Optional[str] = None,
    is_proxy: bool = False,
    is_live: bool = True,
    trend_window_days: int = 30,
    trend_threshold: float = 0.0,
    display_values: Optional[List[float]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not dates or not metric_values:
        return {
            "key": key,
            "name": label,
            "label": label,
            "source": source,
            "unit": unit,
            "is_proxy": is_proxy,
            "is_live": is_live,
            "notes": notes,
            "latest": None,
            "as_of": None,
            "value": None,
            "stability_score": None,
            "trend": "insufficient_data",
            "history": [],
            **(extra or {}),
        }
    lookback = _infer_series_lookback(dates)
    z_scores = _compute_z_scores(metric_values, lookback)
    adjusted = direction_adjusted(z_scores, direction)
    stability_scores = [map_z_to_score(z) for z in adjusted]

    if display_values is None:
        display_values = metric_values

    history = [
        {
            "date": date,
            "value": float(display),
            "stability_score": float(score),
            "z_score": float(z_score),
        }
        for date, display, score, z_score in zip(dates, display_values, stability_scores, z_scores)
    ]
    history = _filter_history(history, cutoff)

    filtered_dates = [p["date"] for p in history]
    trend_metric_values = metric_values if direction == 1 else [-value for value in metric_values]
    trend_metric_by_date = {date: value for date, value in zip(dates, trend_metric_values)}
    trend_values = [trend_metric_by_date.get(date) for date in filtered_dates]
    trend_values = [value for value in trend_values if value is not None]
    latest = history[-1] if history else None
    trend = _compute_trend_from_metric(
        filtered_dates,
        trend_values,
        window_days=trend_window_days,
        threshold=trend_threshold,
    )

    return {
        "key": key,
        "name": label,
        "label": label,
        "source": source,
        "unit": unit,
        "is_proxy": is_proxy,
        "is_live": is_live,
        "notes": notes,
        "latest": latest,
        "as_of": latest.get("date") if latest else None,
        "value": latest.get("value") if latest else None,
        "stability_score": latest.get("stability_score") if latest else None,
        "trend": trend,
        "history": history,
        **(extra or {}),
    }


async def _build_fred_curve_points(start_date: str) -> List[Dict[str, Any]]:
    fred = FredClient()
    maturities = {
        "1": "DGS1",
        "2": "DGS2",
        "5": "DGS5",
        "10": "DGS10",
        "20": "DGS20",
        "30": "DGS30",
    }
    fetched = await asyncio.gather(
        *[
            fred.fetch_series(series_id, start_date=start_date)
            for series_id in maturities.values()
        ],
        return_exceptions=True,
    )
    series_map = {
        maturity: values
        for maturity, values in zip(maturities, fetched)
        if isinstance(values, list)
    }
    if len(series_map) < 2:
        return []

    series_dicts = {key: series_to_dict(values) for key, values in series_map.items()}
    common_dates = find_common_dates(*series_dicts.values())

    points: List[Dict[str, Any]] = []
    for date in common_dates:
        yields = {maturity: series_dicts[maturity].get(date) for maturity in series_dicts}
        points.append({"date": date, "yields": yields})
    return points


def _build_curve_payload(
    points: List[Dict[str, Any]],
    cutoff: datetime,
    label: str,
    source: str,
    notes: Optional[str] = None,
    is_muni: bool = False,
) -> Dict[str, Any]:
    points_sorted = sorted(points, key=lambda x: x.get("date", ""))
    history: List[Dict[str, Any]] = []

    for point in points_sorted:
        point_date = _parse_date(point.get("date"))
        if not point_date:
            continue
        yields = point.get("yields") or {}
        long_end = [yields.get(k) for k in ("10", "20", "30") if yields.get(k) is not None]
        level = sum(long_end) / len(long_end) if long_end else None

        slope_long = yields.get("10") if yields.get("10") is not None else yields.get("30")
        slope_short = yields.get("2") if yields.get("2") is not None else yields.get("1")
        slope = (slope_long - slope_short) if (slope_long is not None and slope_short is not None) else None

        history.append({
            "date": point_date.date().isoformat(),
            "yields": yields,
            "level": level,
            "slope": slope,
        })

    history = _filter_history(history, cutoff)

    slope_values = [p["slope"] for p in history if p.get("slope") is not None]
    slope_dates = [p["date"] for p in history if p.get("slope") is not None]
    if slope_values:
        median_lookback = _infer_series_lookback(slope_dates)
        window = 13 if median_lookback == 104 else 21
        slope_vol = []
        for i in range(len(slope_values)):
            start_idx = max(0, i - window + 1)
            window_vals = slope_values[start_idx : i + 1]
            if len(window_vals) < 2:
                slope_vol.append(0.0)
            else:
                mean = sum(window_vals) / len(window_vals)
                var = sum((v - mean) ** 2 for v in window_vals) / len(window_vals)
                slope_vol.append(var ** 0.5)
    else:
        slope_vol = []

    if slope_values and slope_vol:
        slope_vol_scores = _compute_scores(
            slope_vol,
            direction=1,
            lookback=_infer_series_lookback(slope_dates),
        )
    else:
        slope_vol_scores = []

    slope_vol_iter = iter(slope_vol_scores)
    slope_val_iter = iter(slope_values)
    slope_vol_values = iter(slope_vol)

    for point in history:
        if point.get("slope") is None:
            point["slope_vol"] = None
            point["slope_stability_score"] = None
            point["score"] = None
            continue
        slope_val = next(slope_val_iter)
        slope_vol_value = next(slope_vol_values)
        slope_score = next(slope_vol_iter) if slope_vol_scores else None
        point["slope"] = slope_val
        point["slope_vol"] = slope_vol_value
        point["slope_stability_score"] = slope_score
        point["score"] = slope_score

    latest = history[-1] if history else None
    trend_metric = [p["slope_vol"] for p in history if p.get("slope_vol") is not None]
    trend_dates = [p["date"] for p in history if p.get("slope_vol") is not None]
    trend_window = 91 if (_infer_series_lookback(trend_dates) == 104) else 30
    trend = _compute_trend_from_metric(trend_dates, trend_metric, window_days=trend_window)

    return {
        "label": label,
        "source": source,
        "notes": notes,
        "is_muni": is_muni,
        "latest": latest,
        "trend": trend,
        "history": history,
    }


def normalize_component_weights(
    base_weights: Dict[str, float],
    available_keys: List[str],
) -> Dict[str, float]:
    total_weight = sum(base_weights.get(key, 0.0) for key in available_keys)
    if total_weight == 0:
        return {key: 0.0 for key in available_keys}
    return {key: base_weights[key] / total_weight for key in available_keys}


def compute_composite_score(
    latest_scores: Dict[str, Optional[float]],
    weights_used: Dict[str, float],
) -> Optional[float]:
    if not weights_used:
        return None
    total = 0.0
    for key, weight in weights_used.items():
        score = latest_scores.get(key)
        if score is None:
            return None
        total += score * weight
    return total


def _compute_drawdown_series(values: List[float]) -> List[float]:
    drawdowns: List[float] = []
    peak = None
    for value in values:
        if peak is None or value > peak:
            peak = value
        if peak and peak > 0:
            drawdown = (peak - value) / peak * 100
        else:
            drawdown = 0.0
        drawdowns.append(drawdown)
    return drawdowns


def _compute_return_volatility(values: List[float], window: int) -> List[float]:
    if not values:
        return []
    returns: List[float] = [0.0]
    for i in range(1, len(values)):
        prev = values[i - 1]
        curr = values[i]
        if prev == 0:
            returns.append(0.0)
        else:
            returns.append(((curr / prev) - 1) * 100)
    vol: List[float] = []
    for i in range(len(returns)):
        start_idx = max(0, i - window + 1)
        window_vals = returns[start_idx : i + 1]
        if len(window_vals) < 2:
            vol.append(0.0)
        else:
            mean = sum(window_vals) / len(window_vals)
            var = sum((v - mean) ** 2 for v in window_vals) / len(window_vals)
            vol.append(var ** 0.5)
    return vol


async def _fetch_sifma_series() -> List[Dict[str, Any]]:
    sifma_url = settings.SIFMA_SWAP_URL or SIFMA_SWAP_DEFAULT_URL
    try:
        async with httpx.AsyncClient(timeout=_SIFMA_TIMEOUT_SECONDS) as client:
            response = await client.get(
                sifma_url,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            return _parse_sifma_xlsx(response.content)
    except Exception as exc:
        logger.warning("SIFMA component fetch failed: %s", exc)
        return []


async def _build_muni_subsystem(days: int = 365) -> Dict[str, Any]:
    today = datetime.utcnow().date()
    cutoff = datetime.utcnow() - timedelta(days=days)
    lookback_start = datetime.utcnow() - timedelta(days=days + 365)
    start_date = lookback_start.strftime("%Y-%m-%d")

    fred = FredClient()

    omrx_result, sifma_result, curve_result = await asyncio.gather(
        fred.fetch_series("NASDAQOMRXMUNI", start_date=start_date),
        _fetch_sifma_series(),
        _build_fred_curve_points(start_date),
        return_exceptions=True,
    )
    omrx_series = omrx_result if isinstance(omrx_result, list) else []
    sifma_series = sifma_result if isinstance(sifma_result, list) else []
    fred_curve_points = curve_result if isinstance(curve_result, list) else []

    curve_payload: Optional[Dict[str, Any]] = None
    if fred_curve_points:
        curve_payload = _build_curve_payload(
            fred_curve_points,
            cutoff,
            label="Treasury Curve Proxy (FRED)",
            source="FRED DGS1/DGS2/DGS5/DGS10/DGS20/DGS30",
            notes="Treasury curve proxy used for slope volatility; not a municipal curve feed.",
            is_muni=False,
        )

    # Normalize series ordering
    def _sorted_series(raw_series: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(
            [p for p in raw_series if p.get("value") is not None],
            key=lambda x: x.get("date", ""),
        )

    omrx_clean = _sorted_series(omrx_series)
    sifma_clean = _sorted_series(sifma_series)

    # MUNI_REVENUE_PROXY: revenue bond price proxy (Revdex)
    omrx_dates = [p["date"] for p in omrx_clean]
    omrx_values = [float(p["value"]) for p in omrx_clean]
    revenue_proxy_metric = omrx_values[:]

    def _stress_level(stress: bool, severe: bool) -> str:
        if severe:
            return "severe"
        if stress:
            return "stress"
        return "normal"

    # MUNI_CURVE_SLOPE_STABILITY: from slope volatility (curve payload)
    slope_vol_dates = []
    slope_vol_values = []
    if curve_payload and curve_payload.get("history"):
        for point in curve_payload["history"]:
            if point.get("slope_vol") is None:
                continue
            slope_vol_dates.append(point["date"])
            slope_vol_values.append(float(point["slope_vol"]))

    # MUNI_LONG_SPREAD: derived long-end municipal stress proxy (price-based)
    muni_proxy_dates: List[str] = []
    muni_proxy_values: List[float] = []
    if omrx_dates and omrx_values:
        muni_proxy_dates = omrx_dates
        drawdowns = _compute_drawdown_series(omrx_values)
        proxy_lookback = _infer_series_lookback(omrx_dates)
        vol_window = 13 if proxy_lookback == 104 else 21
        vol = _compute_return_volatility(omrx_values, vol_window)
        muni_proxy_values = [d + v for d, v in zip(drawdowns, vol)]

    # SIFMA data cadence settings
    sifma_dates = [p["date"] for p in sifma_clean]
    sifma_levels = [float(p["value"]) for p in sifma_clean]
    sifma_is_weekly = _infer_series_lookback(sifma_dates) == 104
    sifma_trend_window = 91 if sifma_is_weekly else 30

    # SIFMA stability metric: rolling volatility of rate changes + positive drift penalty
    sifma_changes = []
    for i in range(1, len(sifma_levels)):
        sifma_changes.append(sifma_levels[i] - sifma_levels[i - 1])
    sifma_vol_window = 13 if sifma_is_weekly else 21
    sifma_volatility = []
    for i in range(len(sifma_changes)):
        start_idx = max(0, i - sifma_vol_window + 1)
        window_vals = sifma_changes[start_idx : i + 1]
        if len(window_vals) < 2:
            sifma_volatility.append(0.0)
        else:
            mean = sum(window_vals) / len(window_vals)
            var = sum((v - mean) ** 2 for v in window_vals) / len(window_vals)
            sifma_volatility.append(var ** 0.5)
    # Align volatility series length with levels (pad leading 0)
    if sifma_levels:
        sifma_volatility = [0.0] + sifma_volatility

    sifma_drift = []
    drift_window = 13 if sifma_is_weekly else 30
    for i in range(len(sifma_levels)):
        if i < drift_window:
            sifma_drift.append(0.0)
        else:
            delta = sifma_levels[i] - sifma_levels[i - drift_window]
            sifma_drift.append(max(0.0, delta))

    sifma_metric = [
        vol + drift
        for vol, drift in zip(sifma_volatility, sifma_drift)
    ]
    sifma_vol_z = _compute_z_scores(sifma_volatility, _infer_series_lookback(sifma_dates))

    series_payloads = []

    series_payloads.append(
        _build_series_payload(
            key="MUNI_REVENUE_PROXY",
            label="Revenue Bond Price Proxy (Revdex)",
            source="FRED NASDAQOMRXMUNI",
            unit="index",
            dates=omrx_dates,
            metric_values=revenue_proxy_metric,
            direction=-1,
            cutoff=cutoff,
            notes="Revdex proxy for revenue-bond pricing; higher levels = stronger demand.",
            is_proxy=True,
            is_live=True,
            trend_window_days=30,
            trend_threshold=0.02,
            extra={},
        )
    )

    series_payloads.append(
        _build_series_payload(
            key="SIFMA_INDEX",
            label="SIFMA Rate Stability",
            source="SIFMA historical XLSX",
            unit="percent",
            dates=sifma_dates,
            metric_values=sifma_metric,
            direction=1,
            cutoff=cutoff,
            notes="Weekly tax-exempt swap index (VRDO proxy). Stability penalizes volatility and sharp increases.",
            is_proxy=False,
            is_live=True,
            trend_window_days=sifma_trend_window,
            trend_threshold=0.02,
            display_values=sifma_levels,
            extra={
                "stress_cues": {
                    "vol_z_score": sifma_vol_z[-1] if sifma_vol_z else None,
                    "stress_level": _stress_level(
                        stress=(
                            sifma_vol_z
                            and sifma_vol_z[-1] >= MUNI_PUBLIC_SECTOR_STRESS_CUES["SIFMA_INDEX"]["stress_vol_z"]
                        ),
                        severe=(
                            sifma_vol_z
                            and sifma_vol_z[-1] >= MUNI_PUBLIC_SECTOR_STRESS_CUES["SIFMA_INDEX"]["severe_vol_z"]
                        ),
                    ),
                }
            },
        )
    )

    series_payloads.append(
        _build_series_payload(
            key="MUNI_CURVE_SLOPE_STABILITY",
            label="Muni Curve Slope Stability (volatility)",
            source=curve_payload["source"] if curve_payload else "Curve unavailable",
            unit="percent",
            dates=slope_vol_dates,
            metric_values=slope_vol_values,
            direction=1,
            cutoff=cutoff,
            notes="Stability from slope volatility (10y-2y).",
            is_proxy=bool(curve_payload and not curve_payload.get("is_muni")),
            is_live=True,
            trend_window_days=30,
            trend_threshold=0.01,
            extra={
                "stress_cues": {
                    "z_score": _compute_z_scores(slope_vol_values, _infer_series_lookback(slope_vol_dates))[-1]
                    if slope_vol_values
                    else None,
                    "stress_level": _stress_level(
                        stress=(
                            slope_vol_values
                            and _compute_z_scores(slope_vol_values, _infer_series_lookback(slope_vol_dates))[-1]
                            >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_CURVE_SLOPE_STABILITY"]["stress_z"]
                        ),
                        severe=(
                            slope_vol_values
                            and _compute_z_scores(slope_vol_values, _infer_series_lookback(slope_vol_dates))[-1]
                            >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_CURVE_SLOPE_STABILITY"]["severe_z"]
                        ),
                    ),
                }
            },
        )
    )

    if muni_proxy_dates and muni_proxy_values:
        series_payloads.append(
            _build_series_payload(
                key="MUNI_LONG_SPREAD",
                label="Long-end municipal stress (proxy)",
                source="FRED NASDAQOMRXMUNI",
                unit="percent",
                dates=muni_proxy_dates,
                metric_values=muni_proxy_values,
                direction=1,
                cutoff=cutoff,
                notes="Derived from Revdex price drawdowns and volatility. Public proxy (not a yield).",
                is_proxy=True,
                is_live=True,
                trend_window_days=30,
                trend_threshold=0.05,
                extra={
                    "stress_cues": {
                        "z_score": _compute_z_scores(muni_proxy_values, _infer_series_lookback(muni_proxy_dates))[-1]
                        if muni_proxy_values
                        else None,
                        "change_60d": muni_proxy_values[-1] - muni_proxy_values[-61]
                        if len(muni_proxy_values) > 61
                        else None,
                        "stress_level": _stress_level(
                            stress=(
                                muni_proxy_values
                                and _compute_z_scores(muni_proxy_values, _infer_series_lookback(muni_proxy_dates))[-1]
                                >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LONG_SPREAD"]["stress_z"]
                            )
                            or (
                                len(muni_proxy_values) > 61
                                and muni_proxy_values[-1] - muni_proxy_values[-61]
                                >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LONG_SPREAD"]["stress_change_60d"]
                            ),
                            severe=(
                                muni_proxy_values
                                and _compute_z_scores(muni_proxy_values, _infer_series_lookback(muni_proxy_dates))[-1]
                                >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LONG_SPREAD"]["severe_z"]
                            ),
                        ),
                    }
                },
            )
        )
    else:
        series_payloads.append(
            _build_series_payload(
                key="MUNI_LONG_SPREAD",
                label="Long-end municipal stress (proxy)",
                source="Unavailable (requires public Revdex proxy from FRED)",
                unit="percent",
                dates=[],
                metric_values=[],
                direction=1,
                cutoff=cutoff,
                notes="Uses public price-based proxy (drawdown + volatility). No proprietary muni curve ingested.",
                is_proxy=True,
                is_live=True,
                extra={},
            )
        )

    # Coverage + composite
    live_series = {s["key"]: s for s in series_payloads if s.get("is_live")}
    missing_keys = [
        key for key in MUNI_PUBLIC_SECTOR_COMPONENTS.keys()
        if not live_series.get(key) or live_series.get(key, {}).get("latest") is None
    ]
    available_keys = [key for key in MUNI_PUBLIC_SECTOR_COMPONENTS.keys() if key not in missing_keys]
    coverage_live = len(available_keys)

    base_weights = {key: meta["weight"] for key, meta in MUNI_PUBLIC_SECTOR_COMPONENTS.items()}
    raw_weights = normalize_component_weights(base_weights, available_keys)
    weights_used = {key: round(weight, 4) for key, weight in raw_weights.items()}

    latest_scores = {
        key: live_series[key]["latest"].get("stability_score")
        if live_series.get(key) and live_series[key].get("latest")
        else None
        for key in available_keys
    }
    composite_score = compute_composite_score(latest_scores, raw_weights)
    composite_score = round(composite_score, 2) if composite_score is not None else None

    composite_history: List[Dict[str, Any]] = []
    if live_series:
        history_dates = sorted({
            point["date"]
            for series in live_series.values()
            for point in (series.get("history") or [])
            if point.get("stability_score") is not None
        })
        history_lookup = {
            series_key: {point["date"]: point.get("stability_score") for point in (series.get("history") or [])}
            for series_key, series in live_series.items()
        }
        for date in history_dates:
            available_for_date = []
            scores_for_date: Dict[str, Optional[float]] = {}
            for series_key in live_series.keys():
                score = history_lookup.get(series_key, {}).get(date)
                if score is None:
                    continue
                available_for_date.append(series_key)
                scores_for_date[series_key] = score
            if not available_for_date:
                continue
            weights_for_date = normalize_component_weights(base_weights, available_for_date)
            composite = compute_composite_score(scores_for_date, weights_for_date)
            if composite is None:
                continue
            composite_history.append({
                "date": date,
                "stability_score": round(composite, 2),
            })

    if composite_score is None:
        state = "UNKNOWN"
    elif composite_score >= MUNI_PUBLIC_SECTOR_THRESHOLDS["GREEN"]:
        state = "GREEN"
    elif composite_score >= MUNI_PUBLIC_SECTOR_THRESHOLDS["YELLOW"]:
        state = "YELLOW"
    else:
        state = "RED"

    near_threshold = None
    if composite_score is not None:
        if abs(composite_score - MUNI_PUBLIC_SECTOR_THRESHOLDS["GREEN"]) <= MUNI_PUBLIC_SECTOR_NEAR_THRESHOLD_DELTA:
            near_threshold = "GREEN"
        elif abs(composite_score - MUNI_PUBLIC_SECTOR_THRESHOLDS["YELLOW"]) <= MUNI_PUBLIC_SECTOR_NEAR_THRESHOLD_DELTA:
            near_threshold = "RED"

    latest_dates = [
        _parse_date(series.get("latest", {}).get("date"))
        for series in live_series.values()
        if series.get("latest") and series["latest"].get("date")
    ]
    latest_dates = [d for d in latest_dates if d is not None]
    as_of_date = max(latest_dates).date().isoformat() if latest_dates else today.isoformat()

    payload = {
        "as_of": as_of_date,
        "series": series_payloads,
        "composite": {
            "score": composite_score,
            "state": state,
            "as_of": as_of_date,
            "coverage_live": coverage_live,
            "coverage_total": MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL,
            "missing_keys": missing_keys,
            "weights_used": weights_used,
            "near_threshold": near_threshold,
        },
        "composite_history": composite_history,
        "curve": curve_payload or {
            "status": "unavailable",
            "reason": "Treasury curve proxy unavailable (FRED fetch failed).",
        },
    }
    payload["data_quality"] = {
        "status": (
            "complete"
            if coverage_live == MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL
            else "partial"
            if coverage_live
            else "unavailable"
        ),
        "stale": False,
        "coverage_live": coverage_live,
        "coverage_total": MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL,
        "missing_keys": missing_keys,
        "cache_ttl_seconds": _MUNI_CACHE_TTL_SECONDS,
        "max_stale_age_seconds": _MUNI_MAX_STALE_AGE_SECONDS,
    }
    return payload


async def get_muni_subsystem(days: int = 365) -> Dict[str, Any]:
    cache_key = f"indicator-components:public-credit:{days}"
    shared_snapshot = load_response_snapshot(cache_key)
    if (
        shared_snapshot is not None
        and not shared_snapshot.is_within_stale_limit(
            _MUNI_MAX_STALE_AGE_SECONDS
        )
    ):
        shared_snapshot = None
    if (
        shared_snapshot is not None
        and shared_snapshot.is_fresh(_MUNI_CACHE_TTL_SECONDS)
    ):
        return shared_snapshot.payload

    async with async_response_refresh_lock(cache_key):
        # Re-read after acquiring the shared lock so only the first worker
        # performs a cold or expired refresh.
        shared_snapshot = load_response_snapshot(cache_key)
        if (
            shared_snapshot is not None
            and not shared_snapshot.is_within_stale_limit(
                _MUNI_MAX_STALE_AGE_SECONDS
            )
        ):
            shared_snapshot = None
        if (
            shared_snapshot is not None
            and shared_snapshot.is_fresh(_MUNI_CACHE_TTL_SECONDS)
        ):
            return shared_snapshot.payload

        try:
            payload = await _build_muni_subsystem(days=days)
        except Exception:
            if shared_snapshot is None:
                raise
            logger.exception(
                "Public-credit refresh failed; reusing snapshot aged %.1fs",
                shared_snapshot.age_seconds,
            )
            return mark_stale_snapshot(
                shared_snapshot.payload,
                shared_snapshot,
                reason="public_credit_refresh_failed",
                ttl_seconds=_MUNI_CACHE_TTL_SECONDS,
                max_stale_age_seconds=_MUNI_MAX_STALE_AGE_SECONDS,
            )

        coverage = int((payload.get("composite") or {}).get("coverage_live") or 0)
        prior_coverage = (
            int(
                ((shared_snapshot.payload.get("composite") or {}).get("coverage_live"))
                or 0
            )
            if shared_snapshot is not None
            and isinstance(shared_snapshot.payload, dict)
            else 0
        )
        if shared_snapshot is not None and coverage < prior_coverage:
            return mark_stale_snapshot(
                shared_snapshot.payload,
                shared_snapshot,
                reason="public_credit_refresh_incomplete",
                ttl_seconds=_MUNI_CACHE_TTL_SECONDS,
                max_stale_age_seconds=_MUNI_MAX_STALE_AGE_SECONDS,
            )

        if coverage:
            store_response_snapshot(cache_key, payload)
        return payload
