"""Energy Index calculator — futures-based energy market diagnostic.

Covers WTI crude, Brent crude, natural gas, heating oil, and RBOB gasoline
futures via Yahoo Finance plus retail price and generation-mix context
from the FRED API.  Alternative-energy ETF performance (ICLN, TAN, FAN, PHO)
is included for a side-by-side renewables vs traditional comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import tanh
from statistics import mean
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

from app.core.config import settings
from app.services.ingestion.yahoo_client import YahooClient, YahooClientError


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOOKBACK_WINDOWS: Tuple[int, ...] = (5, 20, 60, 120)

GROUP_WEIGHTS: Dict[str, float] = {
    "crude": 50.0,
    "nat_gas": 30.0,
    "refined": 20.0,
}

GROUP_LABELS: Dict[str, str] = {
    "crude": "Crude Oil",
    "nat_gas": "Natural Gas",
    "refined": "Refined Products",
}

HTTP_HEADERS = {
    "User-Agent": "MarketDiagnosticDashboard/1.0 (energy-index)",
    "Accept": "application/json",
}

_CACHE: Dict[int, Dict[str, Any]] = {}
_CACHE_LOCK = Lock()
_CACHE_TTL_SECONDS = 20 * 60  # 20 minutes

_MIX_CACHE: Dict[str, Any] = {}
_MIX_CACHE_LOCK = Lock()
_MIX_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours


# ---------------------------------------------------------------------------
# Symbol definitions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EnergySymbol:
    code: str
    name: str
    group: str
    tickers: Tuple[str, ...]
    unit: str = "USD"


ENERGY_FUTURES: Tuple[EnergySymbol, ...] = (
    EnergySymbol("CL", "WTI Crude Oil",   "crude",   ("CL=F",),  "$/bbl"),
    EnergySymbol("BZ", "Brent Crude Oil", "crude",   ("BZ=F",),  "$/bbl"),
    EnergySymbol("NG", "Natural Gas",     "nat_gas", ("NG=F",),  "$/MMBtu"),
    EnergySymbol("HO", "Heating Oil",     "refined", ("HO=F",),  "$/gal"),
    EnergySymbol("RB", "RBOB Gasoline",   "refined", ("RB=F",),  "$/gal"),
)

ALT_ENERGY_SYMBOLS: Tuple[EnergySymbol, ...] = (
    EnergySymbol("XLE",  "Energy Select SPDR (Traditional)", "traditional", ("XLE",),  "USD"),
    EnergySymbol("ICLN", "iShares Global Clean Energy",      "clean",       ("ICLN",), "USD"),
    EnergySymbol("TAN",  "Invesco Solar ETF",                "solar",       ("TAN",),  "USD"),
    EnergySymbol("FAN",  "First Trust Global Wind Energy",   "wind",        ("FAN",),  "USD"),
    EnergySymbol("PHO",  "Invesco Water Resources (Hydro)",  "hydro_water", ("PHO",),  "USD"),
)

# ---------------------------------------------------------------------------
# FRED series for retail prices and inventory
# ---------------------------------------------------------------------------

FRED_PRICE_SERIES: Dict[str, str] = {
    "retail_gasoline": "GASREGCOVW",   # Weekly US Regular Conventional Gas, $/gal
    "retail_diesel":   "GASDESW",       # Weekly US No. 2 Diesel, $/gal
    "crude_wti_spot":  "DCOILWTICO",   # Daily WTI spot, $/bbl
    "nat_gas_spot":    "DHHNGSP",      # Daily Henry Hub, $/MMBtu
    "crude_inventory": "WCESTUS1",     # Weekly crude stocks excl. SPR, mln bbl
}

# EIA US electricity net generation by fuel type (via FRED), annual, thousand MWh
GENERATION_MIX_SERIES: Dict[str, str] = {
    "coal":      "ELEC.GEN.COW-US-99.A",
    "nat_gas":   "ELEC.GEN.NG-US-99.A",
    "nuclear":   "ELEC.GEN.NUC-US-99.A",
    "hydro":     "ELEC.GEN.HYC-US-99.A",
    "wind":      "ELEC.GEN.WND-US-99.A",
    "solar":     "ELEC.GEN.SUN-US-99.A",
    "petroleum": "ELEC.GEN.PEL-US-99.A",
    "geothermal":"ELEC.GEN.GEO-US-99.A",
}

# 2023 EIA Annual Energy Review fallback values (thousand MWh)
# Used when FRED series are unavailable / key not configured
GENERATION_MIX_FALLBACK_2023: Dict[str, float] = {
    "coal":       756_825,
    "nat_gas":  1_783_650,
    "nuclear":    775_395,
    "hydro":      244_720,
    "wind":       425_140,
    "solar":      238_080,
    "petroleum":   23_180,
    "geothermal":  16_820,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
    return pd.Series(
        frame.sort_values("date")["value"].values,
        index=pd.DatetimeIndex(frame.sort_values("date")["date"]),
    ).astype(float)


def _fred_fetch(series_id: str, start: str) -> pd.Series:
    api_key = settings.FRED_API_KEY
    if not api_key:
        return pd.Series(dtype="float64")
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={api_key}&file_type=json"
        f"&observation_start={start}"
    )
    try:
        resp = requests.get(url, headers=HTTP_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        rows = [
            {"date": obs["date"], "value": float(obs["value"])}
            for obs in data.get("observations", [])
            if obs.get("value") not in (".", None)
        ]
        return _series_from_rows(rows)
    except Exception:
        return pd.Series(dtype="float64")


def calculate_percent_changes(series: pd.Series) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    if series.empty:
        for lb in LOOKBACK_WINDOWS:
            out[f"{lb}d"] = None
        return out
    last = _safe_float(series.iloc[-1])
    for lb in LOOKBACK_WINDOWS:
        key = f"{lb}d"
        if last is None or len(series) <= lb:
            out[key] = None
            continue
        prev = _safe_float(series.iloc[-(lb + 1)])
        out[key] = ((last / prev) - 1.0) * 100.0 if prev else None
    return out


def normalize_score(changes: Dict[str, Optional[float]]) -> float:
    weights = {"5d": 0.35, "20d": 0.30, "60d": 0.20, "120d": 0.15}
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
    return _clamp(50.0 + 45.0 * tanh(blended / 12.0), 0.0, 100.0)


def _volatility(series: pd.Series, lookback: int = 60) -> Optional[float]:
    if len(series) < 3:
        return None
    returns = series.pct_change().dropna().tail(lookback)
    if returns.empty:
        return None
    return float(returns.std(ddof=0) * (252.0 ** 0.5) * 100.0)


# ---------------------------------------------------------------------------
# Data fetchers
# ---------------------------------------------------------------------------

def fetch_energy_futures_data(days: int) -> Tuple[Dict[str, pd.Series], List[Dict], List[Dict]]:
    client = YahooClient()
    start = (datetime.utcnow() - timedelta(days=days + 260)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    resolved: Dict[str, pd.Series] = {}
    availability: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []

    for instrument in ENERGY_FUTURES:
        chosen_ticker: Optional[str] = None
        chosen_series = pd.Series(dtype="float64")
        for ticker in instrument.tickers:
            try:
                rows = client.fetch_series(
                    ticker=ticker, start_date=start, end_date=end, interval="1d"
                )
                series = _series_from_rows(rows)
                if len(series) >= 30:
                    chosen_ticker = ticker
                    chosen_series = series
                    break
            except (YahooClientError, Exception):
                continue

        if chosen_ticker is None:
            missing.append({
                "code": instrument.code, "name": instrument.name,
                "group": instrument.group, "attempted_tickers": list(instrument.tickers),
            })
            availability.append({
                "code": instrument.code, "name": instrument.name,
                "group": instrument.group, "status": "missing", "ticker": None, "points": 0,
            })
        else:
            resolved[instrument.code] = chosen_series
            availability.append({
                "code": instrument.code, "name": instrument.name,
                "group": instrument.group, "status": "ok",
                "ticker": chosen_ticker, "points": int(len(chosen_series)),
            })

    return resolved, availability, missing


def fetch_alt_energy_data(days: int) -> Dict[str, pd.Series]:
    client = YahooClient()
    start = (datetime.utcnow() - timedelta(days=days + 30)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
    resolved: Dict[str, pd.Series] = {}
    for instrument in ALT_ENERGY_SYMBOLS:
        for ticker in instrument.tickers:
            try:
                rows = client.fetch_series(
                    ticker=ticker, start_date=start, end_date=end, interval="1d"
                )
                series = _series_from_rows(rows)
                if len(series) >= 20:
                    resolved[instrument.code] = series
                    break
            except Exception:
                continue
    return resolved


def fetch_fred_prices(days: int) -> Dict[str, List[Dict[str, Any]]]:
    start = (datetime.utcnow() - timedelta(days=days + 30)).strftime("%Y-%m-%d")
    out: Dict[str, List[Dict[str, Any]]] = {}
    for key, series_id in FRED_PRICE_SERIES.items():
        series = _fred_fetch(series_id, start)
        if not series.empty:
            out[key] = [
                {"date": str(idx.date()), "value": round(float(v), 4)}
                for idx, v in series.items()
            ]
    return out


def fetch_generation_mix() -> Dict[str, Any]:
    """Fetch recent US electricity generation mix from FRED/EIA series.

    Returns annual generation by fuel type (thousand MWh) for the past 6
    years, plus a summary of the most recent year.  Falls back to static
    2023 EIA data if FRED is unavailable.
    """
    now = datetime.utcnow()
    with _MIX_CACHE_LOCK:
        cached = _MIX_CACHE.get("mix")
        if cached and (now - cached["timestamp"]).total_seconds() < _MIX_CACHE_TTL_SECONDS:
            return cached["data"]

    start = "2018-01-01"
    series_data: Dict[str, List[Dict[str, Any]]] = {}
    fallback_used = False

    for fuel, series_id in GENERATION_MIX_SERIES.items():
        series = _fred_fetch(series_id, start)
        if not series.empty:
            series_data[fuel] = [
                {"year": int(idx.year), "value": round(float(v), 0)}
                for idx, v in series.items()
            ]
        else:
            fallback_used = True

    # Fill missing fuels with fallback
    for fuel, fallback_val in GENERATION_MIX_FALLBACK_2023.items():
        if fuel not in series_data or not series_data[fuel]:
            series_data[fuel] = [{"year": 2023, "value": fallback_val}]
            fallback_used = True

    # Build most-recent-year snapshot
    latest_by_fuel: Dict[str, float] = {}
    for fuel, rows in series_data.items():
        if rows:
            latest_by_fuel[fuel] = rows[-1]["value"]

    total = sum(latest_by_fuel.values())
    latest_pct: Dict[str, float] = {
        fuel: round((v / total) * 100.0, 1)
        for fuel, v in latest_by_fuel.items()
        if total > 0
    }

    # Group into fossil / nuclear / renewables
    fossil = sum(latest_by_fuel.get(f, 0) for f in ("coal", "nat_gas", "petroleum"))
    renewables = sum(latest_by_fuel.get(f, 0) for f in ("hydro", "wind", "solar", "geothermal"))
    nuclear = latest_by_fuel.get("nuclear", 0)
    fossil_pct = round((fossil / total) * 100.0, 1) if total else 0.0
    renewables_pct = round((renewables / total) * 100.0, 1) if total else 0.0
    nuclear_pct = round((nuclear / total) * 100.0, 1) if total else 0.0

    data = {
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fallback_used": fallback_used,
        "series": series_data,
        "latest_by_fuel": latest_by_fuel,
        "latest_pct": latest_pct,
        "summary": {
            "fossil_pct": fossil_pct,
            "renewables_pct": renewables_pct,
            "nuclear_pct": nuclear_pct,
            "notes": (
                "Renewables include hydro (conventional + pumped storage), wind, solar (utility + small-scale), "
                "and geothermal. Pumped-storage hydroelectric is the dominant form of grid-scale energy storage "
                "and accounts for ~93% of US energy storage capacity — often described as 'gravity storage' "
                "due to its elevation-based mechanics. Emerging gravity storage (dropped weights, compressed "
                "air) remains below 0.1% of installed US capacity."
            ),
        },
    }

    with _MIX_CACHE_LOCK:
        _MIX_CACHE["mix"] = {"timestamp": now, "data": data}

    return data


# ---------------------------------------------------------------------------
# Scoring and composite
# ---------------------------------------------------------------------------

def _build_composite_history(
    series_map: Dict[str, pd.Series],
    symbol_data: Dict[str, Dict[str, Any]],
    weights: Dict[str, float],
    days: int,
) -> List[Dict[str, Any]]:
    """Build vectorized daily composite-score history."""
    frames = {code: s for code, s in series_map.items() if code in symbol_data}
    if not frames:
        return []

    df = pd.DataFrame(frames).sort_index()
    df = df.dropna(how="all").tail(days + 5)
    if len(df) < 25:
        return []

    score_cols: Dict[str, pd.Series] = {}
    for code, col in df.items():
        pct_5   = col.pct_change(5)   * 100.0
        pct_20  = col.pct_change(20)  * 100.0
        pct_60  = col.pct_change(60)  * 100.0
        pct_120 = col.pct_change(120) * 100.0

        avail_w = (
            0.35 * pct_5.notna().astype(float) +
            0.30 * pct_20.notna().astype(float) +
            0.20 * pct_60.notna().astype(float) +
            0.15 * pct_120.notna().astype(float)
        )
        blended = (
            0.35 * pct_5.fillna(0) +
            0.30 * pct_20.fillna(0) +
            0.20 * pct_60.fillna(0) +
            0.15 * pct_120.fillna(0)
        )
        blended_norm = blended.div(avail_w.replace(0, np.nan))
        score = (50.0 + 45.0 * np.tanh(blended_norm / 12.0)).clip(0, 100)
        score_cols[code] = score

    score_df = pd.DataFrame(score_cols)

    # Aggregate by group then weight groups
    group_frames: Dict[str, pd.DataFrame] = {}
    for code in score_cols:
        grp = symbol_data[code]["group"]
        group_frames.setdefault(grp, []).append(score_df[code])  # type: ignore[arg-type]

    composite = pd.Series(0.0, index=score_df.index)
    total_w = 0.0
    for grp, cols in group_frames.items():
        w = weights.get(grp, 0.0)
        if w <= 0:
            continue
        grp_mean = pd.concat(cols, axis=1).mean(axis=1)
        composite += grp_mean * (w / 100.0)
        total_w += w / 100.0

    if total_w > 0:
        composite = composite / total_w

    composite = composite.dropna()
    return [
        {"date": str(idx.date()), "value": round(float(v), 2)}
        for idx, v in composite.items()
        if not np.isnan(v)
    ]


def _build_alt_comparison(
    series_map: Dict[str, pd.Series], days: int
) -> List[Dict[str, Any]]:
    """Index alt-energy ETF prices to 100 at the start of the period."""
    if not series_map:
        return []
    df = pd.DataFrame(series_map).sort_index().dropna(how="all").tail(days)
    if df.empty:
        return []

    first_valid = {col: df[col].dropna().iloc[0] for col in df.columns if not df[col].dropna().empty}
    history: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        point: Dict[str, Any] = {"date": str(idx.date())}
        for col in df.columns:
            base = first_valid.get(col)
            val = row[col]
            if base is not None and base != 0 and pd.notna(val):
                point[col] = round((float(val) / float(base)) * 100.0, 2)
        history.append(point)
    return history


# ---------------------------------------------------------------------------
# Regime labelling
# ---------------------------------------------------------------------------

def _regime_label(score: float) -> str:
    if score >= 68:
        return "Energy Tightening"
    if score >= 58:
        return "Prices Elevated"
    if score >= 42:
        return "Balanced Supply"
    if score >= 32:
        return "Demand Softening"
    return "Supply Glut / Oversupply"


def _regime_summary(
    score: float,
    wti_20d: Optional[float],
    ng_20d: Optional[float],
    gas_latest: Optional[float],
    inv_latest: Optional[float],
) -> str:
    parts: List[str] = []
    if wti_20d is not None:
        direction = "up" if wti_20d > 0 else "down"
        parts.append(f"WTI crude is {direction} {abs(wti_20d):.1f}% over the past 20 sessions.")
    if ng_20d is not None:
        direction = "higher" if ng_20d > 0 else "lower"
        parts.append(f"Natural gas is {direction} {abs(ng_20d):.1f}% over the same window.")
    if gas_latest is not None:
        parts.append(f"Retail regular gasoline averages ${gas_latest:.2f}/gal nationally.")
    if inv_latest is not None:
        parts.append(f"US crude inventories stand at {inv_latest:.0f} million barrels.")
    if score >= 60:
        parts.append(
            "The energy composite indicates above-average price pressure across crude, "
            "natural gas, and refined products."
        )
    elif score <= 40:
        parts.append(
            "The composite signals below-average price momentum, consistent with "
            "softer demand or elevated supply."
        )
    else:
        parts.append(
            "The energy complex is broadly balanced with no strong directional consensus."
        )
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Main composite calculation
# ---------------------------------------------------------------------------

def calculate_energy_index(days: int = 365) -> Dict[str, Any]:
    """Build the full energy index payload — cached for 20 minutes."""
    now = datetime.utcnow()
    with _CACHE_LOCK:
        cached = _CACHE.get(days)
        if cached and (now - cached["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["data"]

    series_map, availability, missing = fetch_energy_futures_data(days)
    alt_series = fetch_alt_energy_data(days)
    fred_prices = fetch_fred_prices(days)

    # Build per-symbol metadata
    symbol_data: Dict[str, Dict[str, Any]] = {}
    for instrument in ENERGY_FUTURES:
        if instrument.code not in series_map:
            continue
        series = series_map[instrument.code]
        changes = calculate_percent_changes(series)
        score = normalize_score(changes)
        current = _safe_float(series.iloc[-1]) if not series.empty else None
        vol = _volatility(series)
        symbol_data[instrument.code] = {
            "code": instrument.code,
            "name": instrument.name,
            "group": instrument.group,
            "unit": instrument.unit,
            "ticker": instrument.tickers[0],
            "current_price": round(current, 4) if current is not None else None,
            "changes": {k: round(v, 2) if v is not None else None for k, v in changes.items()},
            "momentum_score": round(score, 2),
            "volatility": round(vol, 2) if vol is not None else None,
        }

    # Effective group weights
    available_groups = {d["group"] for d in symbol_data.values()}
    total_gw = sum(GROUP_WEIGHTS.get(g, 0) for g in available_groups)
    effective_weights: Dict[str, float] = {}
    if total_gw > 0:
        effective_weights = {
            g: (GROUP_WEIGHTS[g] / total_gw) * 100.0
            for g in available_groups
            if g in GROUP_WEIGHTS
        }

    # Group scores
    groups: Dict[str, Dict[str, Any]] = {}
    for group, label in GROUP_LABELS.items():
        members = [c for c, d in symbol_data.items() if d["group"] == group]
        if not members or group not in effective_weights:
            continue
        scores = [symbol_data[c]["momentum_score"] for c in members]
        group_changes: Dict[str, Optional[float]] = {}
        for lb in LOOKBACK_WINDOWS:
            key = f"{lb}d"
            vals = [symbol_data[c]["changes"].get(key) for c in members]
            valid = [float(v) for v in vals if v is not None]
            group_changes[key] = round(mean(valid), 2) if valid else None

        vols = [symbol_data[c]["volatility"] for c in members if symbol_data[c]["volatility"] is not None]
        sorted_m = sorted(members, key=lambda c: symbol_data[c]["momentum_score"], reverse=True)

        groups[group] = {
            "group": group,
            "label": label,
            "effective_weight": round(effective_weights[group], 2),
            "symbol_count": len(members),
            "group_composite": round(float(mean(scores)), 2),
            "changes": group_changes,
            "volatility": round(float(mean(vols)), 2) if vols else None,
            "components": [
                {
                    "code": c,
                    "name": symbol_data[c]["name"],
                    "unit": symbol_data[c]["unit"],
                    "score": symbol_data[c]["momentum_score"],
                    "current_price": symbol_data[c]["current_price"],
                    "changes": symbol_data[c]["changes"],
                    "ticker": symbol_data[c]["ticker"],
                }
                for c in sorted_m
            ],
        }

    # Composite score (weighted sum of group scores)
    composite_score = 50.0
    if effective_weights and symbol_data:
        weighted_sum = 0.0
        total_w = 0.0
        for code, data in symbol_data.items():
            grp = data["group"]
            w = effective_weights.get(grp, 0.0)
            weighted_sum += data["momentum_score"] * (w / 100.0)
            total_w += w / 100.0
        composite_score = round(weighted_sum / total_w if total_w > 0 else 50.0, 2)

    history = _build_composite_history(series_map, symbol_data, effective_weights, days)
    alt_comparison = _build_alt_comparison(alt_series, days)

    wti_20d = symbol_data.get("CL", {}).get("changes", {}).get("20d")
    ng_20d = symbol_data.get("NG", {}).get("changes", {}).get("20d")
    gas_latest: Optional[float] = None
    gas_rows = fred_prices.get("retail_gasoline", [])
    if gas_rows:
        gas_latest = gas_rows[-1]["value"]
    inv_latest: Optional[float] = None
    inv_rows = fred_prices.get("crude_inventory", [])
    if inv_rows:
        inv_latest = inv_rows[-1]["value"]

    data: Dict[str, Any] = {
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "regime_label": _regime_label(composite_score),
        "composite_score": composite_score,
        "summary": _regime_summary(composite_score, wti_20d, ng_20d, gas_latest, inv_latest),
        "groups": list(groups.values()),
        "symbols": list(symbol_data.values()),
        "composite_history": history,
        "fred_prices": fred_prices,
        "alt_comparison": alt_comparison,
        "alt_symbols": [
            {"code": s.code, "name": s.name, "group": s.group}
            for s in ALT_ENERGY_SYMBOLS
        ],
        "availability": {
            "symbols": availability,
            "missing_symbols": missing,
            "available_count": len(series_map),
            "total_configured": len(ENERGY_FUTURES),
        },
        "warnings": [f"Missing: {', '.join(m['code'] for m in missing)}"] if missing else [],
    }

    with _CACHE_LOCK:
        _CACHE[days] = {"timestamp": now, "data": data}

    return data
