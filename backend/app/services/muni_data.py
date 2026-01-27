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


def _compute_scores(values: List[float], direction: int) -> List[int]:
    if not values:
        return []
    lookback = min(252, len(values))
    z_scores = compute_z_scores(values, lookback=lookback)
    adjusted = direction_adjusted(z_scores, direction)
    return [map_z_to_score(z) for z in adjusted]


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
    raw_series: List[Dict[str, Any]],
    direction: int,
    cutoff: datetime,
    notes: Optional[str] = None,
    is_proxy: bool = False,
) -> Dict[str, Any]:
    cleaned = [p for p in raw_series if p.get("value") is not None]
    values = [float(p["value"]) for p in cleaned]
    dates = [p["date"] for p in cleaned]
    scores = _compute_scores(values, direction)

    history = [
        {"date": date, "value": value, "score": score}
        for date, value, score in zip(dates, values, scores)
    ]
    history = _filter_history(history, cutoff)

    latest = history[-1] if history else None
    trend = _compute_trend([p["score"] for p in history if p.get("score") is not None])

    return {
        "key": key,
        "label": label,
        "source": source,
        "unit": unit,
        "is_proxy": is_proxy,
        "notes": notes,
        "latest": latest,
        "trend": trend,
        "history": history,
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

    level_values = [p["level"] for p in history if p.get("level") is not None]
    slope_values = [p["slope"] for p in history if p.get("slope") is not None]

    level_scores = _compute_scores(level_values, direction=1)
    slope_scores = _compute_scores(slope_values, direction=-1)

    level_iter = iter(level_scores)
    slope_iter = iter(slope_scores)

    for point in history:
        level_score = None
        slope_score = None
        if point.get("level") is not None:
            level_score = next(level_iter)
        if point.get("slope") is not None:
            slope_score = next(slope_iter)

        if level_score is not None and slope_score is not None:
            composite = (level_score + slope_score) / 2
        else:
            composite = level_score if level_score is not None else slope_score

        point["score"] = composite

    latest = history[-1] if history else None
    trend_scores = [p["score"] for p in history if p.get("score") is not None]
    trend = _compute_trend(trend_scores)

    return {
        "label": label,
        "source": source,
        "notes": notes,
        "latest": latest,
        "trend": trend,
        "history": history,
    }


async def get_muni_subsystem(days: int = 365) -> Dict[str, Any]:
    today = datetime.utcnow().date()
    cutoff = datetime.utcnow() - timedelta(days=days)
    lookback_start = datetime.utcnow() - timedelta(days=days + 365)
    start_date = lookback_start.strftime("%Y-%m-%d")

    fred = FredClient()

    bond_buyer_series = await fred.fetch_series("WSLB20", start_date=start_date)
    bond_buyer_source = "FRED WSLB20"
    if not [p for p in bond_buyer_series if p.get("value") is not None]:
        bond_buyer_series = await fred.fetch_series("MSLB20", start_date=start_date)
        bond_buyer_source = "FRED MSLB20"

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
                notes="Curve stability combines long-end level and 10y-2y slope.",
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
                    notes="Proxy curve when EMMA data is unavailable. Uses Treasury curve level + 10y-2y slope.",
                )
        except Exception:
            curve_payload = None

    series_payloads = [
        _build_series_payload(
            key="revdex_proxy",
            label="Revdex proxy (Nasdaq OMRX Muni Index)",
            source="FRED NASDAQOMRXMUNI",
            unit="index",
            raw_series=omrx_series,
            direction=-1,
            cutoff=cutoff,
            notes="Proxy for revenue bond stress using a broad muni price index.",
            is_proxy=True,
        ),
        _build_series_payload(
            key="bond_buyer_go_20",
            label="Bond Buyer GO 20",
            source=bond_buyer_source,
            unit="percent",
            raw_series=bond_buyer_series,
            direction=1,
            cutoff=cutoff,
            notes="FRED series discontinued in 2016. Included for historical stress context.",
            is_proxy=False,
        ),
        _build_series_payload(
            key="sifma_swap",
            label="SIFMA Municipal Swap Index",
            source="SIFMA historical XLSX",
            unit="percent",
            raw_series=sifma_series,
            direction=1,
            cutoff=cutoff,
            notes="Weekly tax-exempt swap index (VRDO proxy).",
            is_proxy=False,
        ),
    ]

    return {
        "as_of": today.isoformat(),
        "series": series_payloads,
        "curve": curve_payload or {
            "status": "unavailable",
            "reason": "EMMA_YIELD_CURVE_URL or EMMA_YIELD_CURVE_PATH not configured",
        },
    }
