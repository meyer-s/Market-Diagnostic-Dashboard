from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO, StringIO
from typing import Any, Dict, List, Optional, Tuple
import csv
import json
import os
import re
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
from app.services.analytics_stub import compute_z_scores, direction_adjusted, map_z_to_score
from app.services.ingestion.fred_client import FredClient
from app.utils.data_helpers import series_to_dict, find_common_dates

SIFMA_SWAP_DEFAULT_URL = "https://www.sifma.org/wp-content/uploads/2024/01/Muni-Swap-Historical-Data.xlsx"


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
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not dates or not metric_values:
        return {
            "key": key,
            "label": label,
            "source": source,
            "unit": unit,
            "is_proxy": is_proxy,
            "is_live": is_live,
            "notes": notes,
            "latest": None,
            "trend": "insufficient_data",
            "history": [],
            **(extra or {}),
        }
    lookback = _infer_series_lookback(dates)
    z_scores = _compute_z_scores(metric_values, lookback)
    adjusted = direction_adjusted(z_scores, direction)
    stability_scores = [map_z_to_score(z) for z in adjusted]

    history = [
        {
            "date": date,
            "value": float(value),
            "stability_score": float(score),
            "z_score": float(z_score),
        }
        for date, value, score, z_score in zip(dates, metric_values, stability_scores, z_scores)
    ]
    history = _filter_history(history, cutoff)

    filtered_dates = [p["date"] for p in history]
    filtered_values = [p["value"] for p in history]
    latest = history[-1] if history else None
    trend = _compute_trend_from_metric(
        filtered_dates,
        filtered_values,
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


def _normalize_maturity_label(label: str) -> Optional[str]:
    cleaned = label.strip().lower()
    if "mo" in cleaned or "month" in cleaned:
        return None
    cleaned = cleaned.replace("years", "y").replace("year", "y").replace("yr", "y")
    cleaned = cleaned.replace(" ", "")
    match = re.search(r"(\\d{1,2})", cleaned)
    if not match:
        return None
    value = match.group(1)
    if value in {"1", "2", "5", "10", "20", "30"}:
        return value
    return None


async def _build_fred_curve_points(start_date: str) -> List[Dict[str, Any]]:
    fred = FredClient()
    series_map = {
        "1": await fred.fetch_series("DGS1", start_date=start_date),
        "2": await fred.fetch_series("DGS2", start_date=start_date),
        "5": await fred.fetch_series("DGS5", start_date=start_date),
        "10": await fred.fetch_series("DGS10", start_date=start_date),
        "20": await fred.fetch_series("DGS20", start_date=start_date),
        "30": await fred.fetch_series("DGS30", start_date=start_date),
    }

    series_dicts = {key: series_to_dict(values) for key, values in series_map.items()}
    common_dates = find_common_dates(*series_dicts.values())

    points: List[Dict[str, Any]] = []
    for date in common_dates:
        yields = {maturity: series_dicts[maturity].get(date) for maturity in series_dicts}
        points.append({"date": date, "yields": yields})
    return points


def _parse_emma_curve_csv(text: str) -> List[Dict[str, Any]]:
    reader = csv.DictReader(StringIO(text))
    rows: List[Dict[str, Any]] = []
    for row in reader:
        date = row.get("date") or row.get("Date") or row.get("As Of") or row.get("as_of")
        if not date:
            continue
        yields: Dict[str, Optional[float]] = {}
        for key, value in row.items():
            if key is None or value is None:
                continue
            maturity = _normalize_maturity_label(key)
            if not maturity:
                continue
            try:
                yields[maturity] = float(str(value).strip())
            except ValueError:
                yields[maturity] = None
        rows.append({"date": date, "yields": yields})
    return rows


def _parse_emma_curve_json(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, dict) and "data" in payload:
        payload = payload["data"]
    if not isinstance(payload, list):
        return []

    rows: List[Dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        date = row.get("date") or row.get("Date") or row.get("as_of") or row.get("asOf")
        if not date:
            continue
        yields: Dict[str, Optional[float]] = {}
        raw_yields = row.get("yields")
        if isinstance(raw_yields, dict):
            for key, value in raw_yields.items():
                maturity = _normalize_maturity_label(str(key))
                if not maturity:
                    continue
                try:
                    yields[maturity] = float(value)
                except (TypeError, ValueError):
                    yields[maturity] = None
        else:
            for key, value in row.items():
                if key in {"date", "Date", "as_of", "asOf"}:
                    continue
                maturity = _normalize_maturity_label(str(key))
                if not maturity:
                    continue
                try:
                    yields[maturity] = float(value)
                except (TypeError, ValueError):
                    yields[maturity] = None
        rows.append({"date": date, "yields": yields})
    return rows


async def _load_emma_curve_payload() -> Optional[str]:
    if settings.EMMA_YIELD_CURVE_URL and settings.EMMA_YIELD_CURVE_URL.startswith("file://"):
        file_path = settings.EMMA_YIELD_CURVE_URL.replace("file://", "", 1)
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as handle:
                return handle.read()

    if settings.EMMA_YIELD_CURVE_PATH and os.path.exists(settings.EMMA_YIELD_CURVE_PATH):
        with open(settings.EMMA_YIELD_CURVE_PATH, "r", encoding="utf-8") as handle:
            return handle.read()

    if settings.EMMA_YIELD_CURVE_URL:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                settings.EMMA_YIELD_CURVE_URL,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            return response.text

    return None


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


def compute_muni_long_spread(
    muni_levels: Dict[str, float],
    ust_levels: Dict[str, float],
) -> Tuple[List[str], List[float]]:
    if not muni_levels or not ust_levels:
        return [], []
    common_dates = sorted(set(muni_levels.keys()) & set(ust_levels.keys()))
    spread_dates: List[str] = []
    spread_values: List[float] = []
    for date in common_dates:
        muni_val = muni_levels.get(date)
        ust_val = ust_levels.get(date)
        if muni_val is None or ust_val is None:
            continue
        spread_dates.append(date)
        spread_values.append(float(muni_val) - float(ust_val))
    return spread_dates, spread_values


async def get_muni_subsystem(days: int = 365) -> Dict[str, Any]:
    today = datetime.utcnow().date()
    cutoff = datetime.utcnow() - timedelta(days=days)
    lookback_start = datetime.utcnow() - timedelta(days=days + 365)
    start_date = lookback_start.strftime("%Y-%m-%d")

    fred = FredClient()

    omrx_series = await fred.fetch_series("NASDAQOMRXMUNI", start_date=start_date)

    sifma_series: List[Dict[str, Any]] = []
    sifma_url = settings.SIFMA_SWAP_URL or SIFMA_SWAP_DEFAULT_URL
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(sifma_url, headers={"User-Agent": "Mozilla/5.0"})
            response.raise_for_status()
            sifma_series = _parse_sifma_xlsx(response.content)
    except Exception:
        sifma_series = []

    try:
        emma_payload = await _load_emma_curve_payload()
    except Exception:
        emma_payload = None
    curve_payload: Optional[Dict[str, Any]] = None
    if emma_payload:
        emma_payload_stripped = emma_payload.strip()
        if emma_payload_stripped.startswith("{") or emma_payload_stripped.startswith("["):
            curve_points = _parse_emma_curve_json(json.loads(emma_payload_stripped))
        else:
            curve_points = _parse_emma_curve_csv(emma_payload_stripped)

        if curve_points:
            curve_payload = _build_curve_payload(
                curve_points,
                cutoff,
                label="Municipal Yield Curve (EMMA export)",
                source="EMMA export",
                notes="Curve stability uses slope volatility (10y-2y) with level/slope readouts.",
                is_muni=True,
            )

    if curve_payload is None:
        try:
            fred_curve_points = await _build_fred_curve_points(start_date)
            if fred_curve_points:
                curve_payload = _build_curve_payload(
                    fred_curve_points,
                    cutoff,
                    label="Municipal Curve Proxy (Treasury/FRED)",
                    source="FRED DGS1/DGS2/DGS5/DGS10/DGS20/DGS30",
                    notes="Proxy curve when EMMA data is unavailable. Uses Treasury curve level + slope volatility.",
                    is_muni=False,
                )
        except Exception:
            curve_payload = None

    # Normalize series ordering
    def _sorted_series(raw_series: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(
            [p for p in raw_series if p.get("value") is not None],
            key=lambda x: x.get("date", ""),
        )

    omrx_clean = _sorted_series(omrx_series)
    sifma_clean = _sorted_series(sifma_series)

    # MUNI_LEVEL_STRESS: drawdown magnitude from 252d high
    omrx_dates = [p["date"] for p in omrx_clean]
    omrx_values = [float(p["value"]) for p in omrx_clean]
    drawdown_metric = []
    rolling_max = None
    for value in omrx_values:
        rolling_max = value if rolling_max is None else max(rolling_max, value)
        drawdown_pct = ((value / rolling_max) - 1) * 100 if rolling_max else 0.0
        drawdown_metric.append(abs(min(drawdown_pct, 0.0)))

    # Volatility cue for Revdex proxy
    omrx_returns = []
    for i in range(1, len(omrx_values)):
        prev = omrx_values[i - 1]
        curr = omrx_values[i]
        if prev == 0:
            omrx_returns.append(0.0)
        else:
            omrx_returns.append((curr / prev - 1) * 100)
    revdex_vol = []
    window = 21
    for i in range(len(omrx_returns)):
        start_idx = max(0, i - window + 1)
        window_vals = omrx_returns[start_idx : i + 1]
        if len(window_vals) < 2:
            revdex_vol.append(0.0)
        else:
            mean = sum(window_vals) / len(window_vals)
            var = sum((v - mean) ** 2 for v in window_vals) / len(window_vals)
            revdex_vol.append(var ** 0.5)
    revdex_vol_z = _compute_z_scores(revdex_vol, _infer_series_lookback(omrx_dates))

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

    # MUNI_LONG_SPREAD: muni long-end yield minus UST long-end yield (only if EMMA curve)
    muni_spread_dates: List[str] = []
    muni_spread_values: List[float] = []
    if curve_payload and curve_payload.get("is_muni"):
        muni_level_series = {
            p["date"]: p.get("level")
            for p in (curve_payload.get("history") or [])
            if p.get("level") is not None
        }
        try:
            ust_long = await fred.fetch_series("DGS20", start_date=start_date)
            ust_source = "FRED DGS20"
        except Exception:
            ust_long = []
            ust_source = "FRED DGS30"
        if not [p for p in ust_long if p.get("value") is not None]:
            ust_long = await fred.fetch_series("DGS30", start_date=start_date)
            ust_source = "FRED DGS30"
        ust_dict = {p["date"]: p["value"] for p in ust_long if p.get("value") is not None}
        muni_spread_dates, muni_spread_values = compute_muni_long_spread(
            muni_level_series,
            ust_dict,
        )
    else:
        ust_source = None

    # SIFMA data cadence settings
    sifma_trend_window = 91 if _infer_series_lookback([p["date"] for p in sifma_clean]) == 104 else 30

    series_payloads = []

    series_payloads.append(
        _build_series_payload(
            key="MUNI_LEVEL_STRESS",
            label="Muni Level Stress (Revdex drawdown)",
            source="FRED NASDAQOMRXMUNI",
            unit="percent",
            dates=omrx_dates,
            metric_values=drawdown_metric,
            direction=1,
            cutoff=cutoff,
            notes="Derived from Revdex proxy drawdown from 252d high.",
            is_proxy=True,
            is_live=True,
            trend_window_days=30,
            trend_threshold=0.5,
            extra={
                "stress_cues": {
                    "drawdown_pct": ((omrx_values[-1] / max(omrx_values)) - 1) * 100 if omrx_values else None,
                    "vol_z_score": revdex_vol_z[-1] if revdex_vol_z else None,
                    "stress_level": _stress_level(
                        stress=(
                            omrx_values
                            and ((omrx_values[-1] / max(omrx_values)) - 1) * 100
                            <= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LEVEL_STRESS"]["stress_drawdown"]
                        )
                        or (
                            revdex_vol_z
                            and revdex_vol_z[-1] >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LEVEL_STRESS"]["stress_vol_z"]
                        ),
                        severe=revdex_vol_z and revdex_vol_z[-1] >= 2.0,
                    ),
                }
            },
        )
    )

    series_payloads.append(
        _build_series_payload(
            key="SIFMA_INDEX",
            label="SIFMA Municipal Swap Index",
            source="SIFMA historical XLSX",
            unit="percent",
            dates=[p["date"] for p in sifma_clean],
            metric_values=[float(p["value"]) for p in sifma_clean],
            direction=1,
            cutoff=cutoff,
            notes="Weekly tax-exempt swap index (VRDO proxy).",
            is_proxy=False,
            is_live=True,
            trend_window_days=sifma_trend_window,
            trend_threshold=0.02,
            extra={
                "stress_cues": {
                    "percentile": (
                        (sum(1 for v in [float(p["value"]) for p in sifma_clean] if v <= float(sifma_clean[-1]["value"])) / len(sifma_clean)) * 100
                        if sifma_clean
                        else None
                    ),
                    "stress_level": _stress_level(
                        stress=(
                            sifma_clean
                            and (sum(1 for v in [float(p["value"]) for p in sifma_clean] if v <= float(sifma_clean[-1]["value"])) / len(sifma_clean)) * 100
                            >= MUNI_PUBLIC_SECTOR_STRESS_CUES["SIFMA_INDEX"]["stress_percentile"]
                        ),
                        severe=(
                            sifma_clean
                            and (sum(1 for v in [float(p["value"]) for p in sifma_clean] if v <= float(sifma_clean[-1]["value"])) / len(sifma_clean)) * 100
                            >= MUNI_PUBLIC_SECTOR_STRESS_CUES["SIFMA_INDEX"]["severe_percentile"]
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

    if muni_spread_dates and muni_spread_values:
        series_payloads.append(
            _build_series_payload(
                key="MUNI_LONG_SPREAD",
                label="Muni–Treasury Long Spread",
                source=f"EMMA long-end vs {ust_source}",
                unit="percent",
                dates=muni_spread_dates,
                metric_values=muni_spread_values,
                direction=1,
                cutoff=cutoff,
                notes="Long-end muni yield minus long-end Treasury yield.",
                is_proxy=False,
                is_live=True,
                trend_window_days=30,
                trend_threshold=0.05,
                extra={
                    "stress_cues": {
                        "z_score": _compute_z_scores(muni_spread_values, _infer_series_lookback(muni_spread_dates))[-1]
                        if muni_spread_values
                        else None,
                        "change_30d": muni_spread_values[-1] - muni_spread_values[-31]
                        if len(muni_spread_values) > 31
                        else None,
                        "stress_level": _stress_level(
                            stress=(
                                muni_spread_values
                                and _compute_z_scores(muni_spread_values, _infer_series_lookback(muni_spread_dates))[-1]
                                >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LONG_SPREAD"]["stress_z"]
                            )
                            or (
                                len(muni_spread_values) > 31
                                and muni_spread_values[-1] - muni_spread_values[-31]
                                >= MUNI_PUBLIC_SECTOR_STRESS_CUES["MUNI_LONG_SPREAD"]["stress_change_30d"]
                            ),
                            severe=(
                                muni_spread_values
                                and _compute_z_scores(muni_spread_values, _infer_series_lookback(muni_spread_dates))[-1]
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
                label="Muni–Treasury Long Spread",
                source="Unavailable (requires EMMA curve + Treasury long-end)",
                unit="percent",
                dates=[],
                metric_values=[],
                direction=1,
                cutoff=cutoff,
                notes="Requires EMMA muni curve to compute long-end spread.",
                is_proxy=False,
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

    return {
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
        "curve": curve_payload or {
            "status": "unavailable",
            "reason": "EMMA_YIELD_CURVE_URL or EMMA_YIELD_CURVE_PATH not configured",
        },
    }
