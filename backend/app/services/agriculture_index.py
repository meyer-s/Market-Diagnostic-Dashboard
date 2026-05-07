"""Agriculture Index calculator.

V1 goals:
- Futures-first, Yahoo-backed agriculture diagnostic.
- Defensive handling for unsupported symbols and partial group availability.
- Transparent composite, stability, correlation, and regime outputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import tanh
from statistics import mean
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.ingestion.yahoo_client import YahooClient, YahooClientError


LOOKBACK_WINDOWS = (5, 20, 60, 120)

GROUP_WEIGHTS = {
    "grains_oilseeds": 45.0,
    "livestock": 20.0,
    "softs": 15.0,
    "dairy": 7.5,
    "lumber": 7.5,
    "fertilizer_inputs": 5.0,
}

GROUP_LABELS = {
    "grains_oilseeds": "Grains / Oilseeds",
    "livestock": "Livestock",
    "softs": "Softs",
    "dairy": "Dairy",
    "lumber": "Lumber",
    "fertilizer_inputs": "Fertilizer / Inputs",
}


@dataclass(frozen=True)
class AgricultureSymbol:
    code: str
    name: str
    group: str
    tickers: Tuple[str, ...]


AGRICULTURE_SYMBOLS: Tuple[AgricultureSymbol, ...] = (
    AgricultureSymbol("ZS", "Soybeans", "grains_oilseeds", ("ZS=F",)),
    AgricultureSymbol("ZC", "Corn", "grains_oilseeds", ("ZC=F",)),
    AgricultureSymbol("ZW", "Chicago Wheat", "grains_oilseeds", ("ZW=F",)),
    AgricultureSymbol("KE", "KC Hard Red Winter Wheat", "grains_oilseeds", ("KE=F", "KW=F")),
    AgricultureSymbol("MW", "Minneapolis Spring Wheat", "grains_oilseeds", ("MWE=F", "MW=F")),
    AgricultureSymbol("ZL", "Soybean Oil", "grains_oilseeds", ("ZL=F",)),
    AgricultureSymbol("ZM", "Soybean Meal", "grains_oilseeds", ("ZM=F",)),
    AgricultureSymbol("ZO", "Oats", "grains_oilseeds", ("ZO=F",)),
    AgricultureSymbol("ZR", "Rough Rice", "grains_oilseeds", ("ZR=F",)),
    AgricultureSymbol("LE", "Live Cattle", "livestock", ("LE=F",)),
    AgricultureSymbol("GF", "Feeder Cattle", "livestock", ("GF=F",)),
    AgricultureSymbol("HE", "Lean Hogs", "livestock", ("HE=F",)),
    AgricultureSymbol("DC", "Class III Milk", "dairy", ("DC=F",)),
    AgricultureSymbol("DAIRY_CLASS_IV", "Class IV Milk", "dairy", ("DY=F",)),
    AgricultureSymbol("LBR", "Lumber", "lumber", ("LBR=F",)),
    AgricultureSymbol("SYP", "Southern Yellow Pine", "lumber", ("SYP",)),
    AgricultureSymbol("KC", "Coffee", "softs", ("KC=F",)),
    AgricultureSymbol("CC", "Cocoa", "softs", ("CC=F",)),
    AgricultureSymbol("SB", "Sugar", "softs", ("SB=F",)),
    AgricultureSymbol("CT", "Cotton", "softs", ("CT=F",)),
    AgricultureSymbol("OJ", "Orange Juice", "softs", ("OJ=F",)),
    AgricultureSymbol("RS", "Canola", "softs", ("RS=F",)),
    AgricultureSymbol("FERT_N", "Nitrogen Proxy (CF Industries)", "fertilizer_inputs", ("CF",)),
    AgricultureSymbol("FERT_P", "Phosphate Proxy (Mosaic)", "fertilizer_inputs", ("MOS",)),
    AgricultureSymbol("FERT_K", "Potash Proxy (Nutrien)", "fertilizer_inputs", ("NTR",)),
)

MACRO_SERIES = {
    "crude_oil": ("CL=F",),
    "natural_gas": ("NG=F",),
    "heating_oil": ("HO=F",),
    "dxy": ("DX-Y.NYB", "DX=F"),
    "ten_year_yield": ("^TNX",),
    "broad_commodity": ("DBC",),
    "vix": ("^VIX",),
}


_CACHE: Dict[int, Dict[str, Any]] = {}
_CACHE_LOCK = Lock()
_CACHE_TTL_SECONDS = 15 * 60


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
    return pd.Series(frame["value"].values, index=frame["date"]).astype(float)


def fetch_agriculture_data(days: int) -> Tuple[Dict[str, pd.Series], List[Dict[str, Any]], List[Dict[str, Any]]]:
    client = YahooClient()
    start = (datetime.utcnow() - timedelta(days=days + 260)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    resolved: Dict[str, pd.Series] = {}
    availability: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []

    for instrument in AGRICULTURE_SYMBOLS:
        chosen_ticker: Optional[str] = None
        chosen_series = pd.Series(dtype="float64")

        for ticker in instrument.tickers:
            try:
                rows = client.fetch_series(ticker=ticker, start_date=start, end_date=end, interval="1d")
                series = _series_from_rows(rows)
                if len(series) >= 30:
                    chosen_ticker = ticker
                    chosen_series = series
                    break
            except YahooClientError:
                continue
            except Exception:
                continue

        if chosen_ticker is None:
            missing.append(
                {
                    "code": instrument.code,
                    "name": instrument.name,
                    "group": instrument.group,
                    "attempted_tickers": list(instrument.tickers),
                }
            )
            availability.append(
                {
                    "code": instrument.code,
                    "name": instrument.name,
                    "group": instrument.group,
                    "status": "missing",
                    "ticker": None,
                    "points": 0,
                }
            )
            continue

        resolved[instrument.code] = chosen_series
        availability.append(
            {
                "code": instrument.code,
                "name": instrument.name,
                "group": instrument.group,
                "status": "ok",
                "ticker": chosen_ticker,
                "points": int(len(chosen_series)),
            }
        )

    return resolved, availability, missing


def calculate_percent_changes(series: pd.Series) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    if series.empty:
        for lookback in LOOKBACK_WINDOWS:
            out[f"{lookback}d"] = None
        return out

    last = _safe_float(series.iloc[-1])
    for lookback in LOOKBACK_WINDOWS:
        key = f"{lookback}d"
        if last is None or len(series) <= lookback:
            out[key] = None
            continue
        prev = _safe_float(series.iloc[-(lookback + 1)])
        if prev is None or prev == 0:
            out[key] = None
            continue
        out[key] = ((last / prev) - 1.0) * 100.0
    return out


def normalize_series(changes: Dict[str, Optional[float]]) -> float:
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
    score = 50.0 + 45.0 * tanh(blended / 12.0)
    return _clamp(score, 0.0, 100.0)


def _series_volatility(series: pd.Series, lookback: int = 60) -> Optional[float]:
    if len(series) < 3:
        return None
    returns = series.pct_change().dropna().tail(lookback)
    if returns.empty:
        return None
    return float(returns.std(ddof=0) * (252.0 ** 0.5) * 100.0)


def _series_daily_returns(series: pd.Series) -> pd.Series:
    return series.pct_change().dropna()


def _effective_group_weights(group_members: Dict[str, List[str]]) -> Dict[str, float]:
    available_groups = [group for group, members in group_members.items() if members]
    if not available_groups:
        return {}
    total = sum(GROUP_WEIGHTS[group] for group in available_groups)
    if total <= 0:
        return {}
    return {group: (GROUP_WEIGHTS[group] / total) * 100.0 for group in available_groups}


def calculate_sector_scores(
    symbol_data: Dict[str, Dict[str, Any]],
    series_map: Dict[str, pd.Series],
    effective_weights: Dict[str, float],
) -> Dict[str, Dict[str, Any]]:
    group_members: Dict[str, List[str]] = {group: [] for group in GROUP_WEIGHTS.keys()}
    for code, payload in symbol_data.items():
        group_members[payload["group"]].append(code)

    groups: Dict[str, Dict[str, Any]] = {}
    for group, members in group_members.items():
        if not members or group not in effective_weights:
            continue

        lookback_changes: Dict[str, Optional[float]] = {}
        for lookback in LOOKBACK_WINDOWS:
            key = f"{lookback}d"
            values = [symbol_data[code]["changes"].get(key) for code in members]
            valid = [float(v) for v in values if v is not None]
            lookback_changes[key] = float(mean(valid)) if valid else None

        momentum_values = [symbol_data[code]["momentum_score"] for code in members]
        vol_values = [symbol_data[code]["volatility"] for code in members if symbol_data[code]["volatility"] is not None]

        breadth_candidates = []
        for code in members:
            c20 = symbol_data[code]["changes"].get("20d")
            c60 = symbol_data[code]["changes"].get("60d")
            if c20 is None and c60 is None:
                continue
            score = 0.0
            if c20 is not None:
                score += 50.0 if c20 > 0 else 0.0
            if c60 is not None:
                score += 50.0 if c60 > 0 else 0.0
            breadth_candidates.append(score)

        sorted_members = sorted(members, key=lambda code: symbol_data[code]["momentum_score"], reverse=True)
        strongest = [
            {
                "code": code,
                "name": symbol_data[code]["name"],
                "score": round(float(symbol_data[code]["momentum_score"]), 2),
                "ticker": symbol_data[code]["ticker"],
            }
            for code in sorted_members[:3]
        ]
        weakest = [
            {
                "code": code,
                "name": symbol_data[code]["name"],
                "score": round(float(symbol_data[code]["momentum_score"]), 2),
                "ticker": symbol_data[code]["ticker"],
            }
            for code in sorted_members[-3:]
        ]

        groups[group] = {
            "group": group,
            "label": GROUP_LABELS[group],
            "effective_weight": round(effective_weights[group], 2),
            "symbol_count": len(members),
            "group_composite": round(float(mean(momentum_values)), 2),
            "changes": {k: (round(v, 2) if v is not None else None) for k, v in lookback_changes.items()},
            "volatility": round(float(mean(vol_values)), 2) if vol_values else None,
            "breadth_score": round(float(mean(breadth_candidates)), 2) if breadth_candidates else None,
            "strongest": strongest,
            "weakest": weakest,
            "stability_contribution": 0.0,
        }

    return groups


def _group_return_series(groups: Dict[str, Dict[str, Any]], symbol_data: Dict[str, Dict[str, Any]], series_map: Dict[str, pd.Series]) -> Dict[str, pd.Series]:
    out: Dict[str, pd.Series] = {}
    for group in groups.keys():
        members = [code for code, payload in symbol_data.items() if payload["group"] == group]
        if not members:
            continue
        frame = pd.DataFrame({code: series_map[code] for code in members if code in series_map})
        if frame.empty:
            continue
        group_level = frame.mean(axis=1, skipna=True).dropna()
        returns = group_level.pct_change().dropna()
        if not returns.empty:
            out[group] = returns
    return out


def _composite_return_series(group_returns: Dict[str, pd.Series], effective_weights: Dict[str, float]) -> pd.Series:
    if not group_returns:
        return pd.Series(dtype="float64")
    frame = pd.DataFrame(group_returns).dropna(how="all")
    if frame.empty:
        return pd.Series(dtype="float64")
    weighted = pd.Series(0.0, index=frame.index)
    total = 0.0
    for group, weight in effective_weights.items():
        if group not in frame.columns:
            continue
        weighted = weighted.add(frame[group].fillna(0.0) * (weight / 100.0), fill_value=0.0)
        total += weight / 100.0
    if total <= 0:
        return pd.Series(dtype="float64")
    return weighted / total


def calculate_correlation_matrix(
    group_returns: Dict[str, pd.Series],
    symbol_returns: Dict[str, pd.Series],
    composite_returns: pd.Series,
    macro_returns: Dict[str, pd.Series],
) -> Dict[str, Any]:
    windows = [20, 60, 120]
    frame = pd.DataFrame(group_returns)
    matrices: Dict[str, List[Dict[str, Any]]] = {}

    for window in windows:
        rows: List[Dict[str, Any]] = []
        if not frame.empty:
            corr = frame.tail(window).corr()
            for row_name in corr.index:
                row_values: Dict[str, Optional[float]] = {}
                for col_name in corr.columns:
                    value = _safe_float(corr.loc[row_name, col_name])
                    row_values[col_name] = round(value, 3) if value is not None else None
                rows.append({"row": row_name, "values": row_values})
        matrices[str(window)] = rows

    def pair_corr(left: Optional[pd.Series], right: Optional[pd.Series], window: int) -> Optional[float]:
        if left is None or right is None:
            return None
        joined = pd.concat([left, right], axis=1).dropna().tail(window)
        if len(joined) < max(8, int(window * 0.4)):
            return None
        value = _safe_float(joined.iloc[:, 0].corr(joined.iloc[:, 1]))
        return round(value, 3) if value is not None else None

    pair_insights: Dict[str, Dict[str, Optional[float]]] = {}
    for window in windows:
        key = str(window)
        pair_insights[key] = {
            "grains_vs_livestock": pair_corr(group_returns.get("grains_oilseeds"), group_returns.get("livestock"), window),
            "grains_vs_soybean_oil": pair_corr(group_returns.get("grains_oilseeds"), symbol_returns.get("ZL"), window),
            "grains_vs_fertilizer": pair_corr(group_returns.get("grains_oilseeds"), group_returns.get("fertilizer_inputs"), window),
            "soybean_oil_vs_crude_oil": pair_corr(symbol_returns.get("ZL"), macro_returns.get("crude_oil"), window),
            "livestock_vs_corn": pair_corr(group_returns.get("livestock"), symbol_returns.get("ZC"), window),
            "softs_vs_dxy": pair_corr(group_returns.get("softs"), macro_returns.get("dxy"), window),
            "agriculture_vs_energy_composite": pair_corr(composite_returns, macro_returns.get("energy_composite"), window),
        }

    return {
        "group_matrix": matrices,
        "pair_insights": pair_insights,
    }


def _trend_agreement_score(groups: Dict[str, Dict[str, Any]], composite_change_20d: Optional[float]) -> float:
    if not groups or composite_change_20d is None:
        return 50.0
    comp_sign = 0 if abs(composite_change_20d) < 0.2 else (1 if composite_change_20d > 0 else -1)
    if comp_sign == 0:
        return 55.0
    matches = 0
    total = 0
    for group in groups.values():
        change = group["changes"].get("20d")
        if change is None:
            continue
        sign = 0 if abs(change) < 0.2 else (1 if change > 0 else -1)
        if sign == 0:
            continue
        total += 1
        if sign == comp_sign:
            matches += 1
    if total == 0:
        return 50.0
    return _clamp((matches / total) * 100.0, 0.0, 100.0)


def _volatility_stability_score(composite_returns: pd.Series) -> float:
    if composite_returns.empty:
        return 50.0
    daily_std_pct = float(composite_returns.tail(60).std(ddof=0) * 100.0)
    score = 100.0 - (daily_std_pct / 3.0) * 100.0
    return _clamp(score, 0.0, 100.0)


def _correlation_stability_score(group_returns: Dict[str, pd.Series]) -> float:
    if len(group_returns) < 2:
        return 50.0
    frame = pd.DataFrame(group_returns).dropna().tail(60)
    if frame.shape[0] < 12:
        return 50.0
    corr = frame.corr().values
    upper = corr[np.triu_indices_from(corr, k=1)]
    if upper.size == 0:
        return 50.0
    avg_corr = float(np.mean(upper))
    dispersion = float(np.std(upper))
    score = ((avg_corr + 1.0) / 2.0) * 100.0 - dispersion * 25.0
    return _clamp(score, 0.0, 100.0)


def _breadth_score(symbol_data: Dict[str, Dict[str, Any]]) -> float:
    points: List[float] = []
    for payload in symbol_data.values():
        c20 = payload["changes"].get("20d")
        c60 = payload["changes"].get("60d")
        if c20 is None and c60 is None:
            continue
        score = 0.0
        if c20 is not None:
            score += 50.0 if c20 > 0 else 0.0
        if c60 is not None:
            score += 50.0 if c60 > 0 else 0.0
        points.append(score)
    if not points:
        return 50.0
    return _clamp(float(mean(points)), 0.0, 100.0)


def _momentum_consistency_score(symbol_data: Dict[str, Dict[str, Any]]) -> float:
    per_symbol: List[float] = []
    for payload in symbol_data.values():
        signs: List[int] = []
        for key in ["5d", "20d", "60d", "120d"]:
            value = payload["changes"].get(key)
            if value is None:
                continue
            signs.append(1 if value > 0 else -1 if value < 0 else 0)
        if len(signs) < 2:
            continue
        agreement = max(signs.count(-1), signs.count(0), signs.count(1)) / len(signs)
        per_symbol.append(agreement * 100.0)
    if not per_symbol:
        return 50.0
    return _clamp(float(mean(per_symbol)), 0.0, 100.0)


def _cross_sector_divergence_penalty(groups: Dict[str, Dict[str, Any]]) -> float:
    changes = [group["changes"].get("20d") for group in groups.values() if group["changes"].get("20d") is not None]
    if len(changes) < 2:
        return 0.0
    dispersion = float(np.std(changes))
    opposed = any(c > 0 for c in changes) and any(c < 0 for c in changes)
    penalty = dispersion * 1.1 + (6.0 if opposed else 0.0)
    return _clamp(penalty, 0.0, 25.0)


def calculate_stability_score(
    groups: Dict[str, Dict[str, Any]],
    symbol_data: Dict[str, Dict[str, Any]],
    composite_returns: pd.Series,
    correlation_score: float,
) -> Dict[str, float]:
    composite_change_20d = None
    if not composite_returns.empty:
        composite_index = (1.0 + composite_returns).cumprod()
        if len(composite_index) > 20:
            composite_change_20d = ((composite_index.iloc[-1] / composite_index.iloc[-21]) - 1.0) * 100.0

    trend_agreement = _trend_agreement_score(groups, composite_change_20d)
    volatility_stability = _volatility_stability_score(composite_returns)
    breadth = _breadth_score(symbol_data)
    momentum_consistency = _momentum_consistency_score(symbol_data)
    divergence_penalty = _cross_sector_divergence_penalty(groups)

    score = (
        0.25 * trend_agreement
        + 0.20 * volatility_stability
        + 0.20 * correlation_score
        + 0.20 * breadth
        + 0.15 * momentum_consistency
        - divergence_penalty
    )

    return {
        "trend_agreement": round(trend_agreement, 2),
        "volatility_stability": round(volatility_stability, 2),
        "correlation_stability": round(correlation_score, 2),
        "breadth": round(breadth, 2),
        "momentum_consistency": round(momentum_consistency, 2),
        "divergence_penalty": round(divergence_penalty, 2),
        "stability_score": round(_clamp(score, 0.0, 100.0), 2),
    }


def classify_agriculture_regime(
    stability_score: float,
    composite_change_20d: Optional[float],
    volatility_stability: float,
    breadth: float,
    correlation_stability: float,
) -> str:
    change = composite_change_20d if composite_change_20d is not None else 0.0

    if volatility_stability < 28.0 and correlation_stability < 35.0 and abs(change) > 2.5:
        return "Shock Risk"

    if abs(change) < 1.0:
        return "Rotation / Mixed"

    if change > 0:
        if stability_score >= 65.0 and breadth >= 55.0 and volatility_stability >= 50.0:
            return "Stable Expansion"
        return "Unstable Expansion"

    if stability_score >= 65.0 and breadth <= 45.0 and volatility_stability >= 50.0:
        return "Stable Contraction"
    return "Unstable Contraction"


def _calc_change_from_returns(returns: pd.Series, lookback: int) -> Optional[float]:
    if len(returns) < lookback:
        return None
    index = (1.0 + returns).cumprod()
    if len(index) <= lookback:
        return None
    return ((index.iloc[-1] / index.iloc[-(lookback + 1)]) - 1.0) * 100.0


def _fetch_macro_returns(days: int) -> Tuple[Dict[str, pd.Series], List[str]]:
    client = YahooClient()
    start = (datetime.utcnow() - timedelta(days=days + 260)).strftime("%Y-%m-%d")
    end = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    returns: Dict[str, pd.Series] = {}
    missing: List[str] = []

    for key, tickers in MACRO_SERIES.items():
        resolved = None
        for ticker in tickers:
            try:
                rows = client.fetch_series(ticker=ticker, start_date=start, end_date=end, interval="1d")
                series = _series_from_rows(rows)
                if len(series) >= 20:
                    resolved = _series_daily_returns(series)
                    break
            except Exception:
                continue
        if resolved is None or resolved.empty:
            missing.append(key)
            continue
        returns[key] = resolved

    energy_parts = [returns.get("crude_oil"), returns.get("natural_gas"), returns.get("heating_oil")]
    available_parts = [s for s in energy_parts if s is not None and not s.empty]
    if available_parts:
        returns["energy_composite"] = pd.concat(available_parts, axis=1).mean(axis=1).dropna()
    else:
        missing.append("energy_composite")

    return returns, missing


def _macro_pressure(macro_returns: Dict[str, pd.Series], special_signals: Dict[str, Any]) -> Dict[str, Any]:
    def change_key(key: str, lookback: int = 20) -> Optional[float]:
        series = macro_returns.get(key)
        if series is None or series.empty:
            return None
        return _calc_change_from_returns(series, lookback)

    crude_20 = change_key("crude_oil")
    gas_20 = change_key("natural_gas")
    heating_20 = change_key("heating_oil")
    dxy_20 = change_key("dxy")
    tnx_20 = change_key("ten_year_yield")

    def pressure_text(name: str, value: Optional[float], positive_pressure: bool = True) -> Dict[str, Any]:
        if value is None:
            return {"name": name, "status": "insufficient data", "change_20d": None}
        pressure = value > 0 if positive_pressure else value < 0
        return {
            "name": name,
            "status": "pressuring" if pressure else "supportive",
            "change_20d": round(value, 2),
        }

    energy_blend = None
    energy_inputs = [v for v in [crude_20, gas_20, heating_20] if v is not None]
    if energy_inputs:
        energy_blend = float(mean(energy_inputs))

    return {
        "energy_prices": pressure_text("Energy Prices", energy_blend, positive_pressure=True),
        "dollar_strength": pressure_text("Dollar Index", dxy_20, positive_pressure=True),
        "interest_rates": pressure_text("10Y Yield", tnx_20, positive_pressure=True),
        "biofuel_proxy": {
            "name": "Soybean Oil vs Grains",
            "status": special_signals["soybean_oil_vs_grains"]["interpretation"],
            "spread_20d": special_signals["soybean_oil_vs_grains"]["spread_20d"],
        },
        "weather_stress": {
            "name": "Weather-sensitive stress",
            "status": "not included in v1 price-only model",
            "change_20d": None,
        },
        "input_costs": {
            "name": "Fertilizer / Inputs",
            "status": "included where symbols are supported",
            "change_20d": None,
        },
    }


def _special_signals(symbol_data: Dict[str, Dict[str, Any]], groups: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    zl_change = symbol_data.get("ZL", {}).get("changes", {}).get("20d")
    grains_changes = [
        symbol_data.get(code, {}).get("changes", {}).get("20d")
        for code in ["ZS", "ZC", "ZW", "KE"]
    ]
    grains_valid = [float(v) for v in grains_changes if v is not None]
    grains_avg = float(mean(grains_valid)) if grains_valid else None

    spread_20d = None
    if zl_change is not None and grains_avg is not None:
        spread_20d = float(zl_change - grains_avg)

    if spread_20d is None:
        spread_text = "insufficient data"
    elif spread_20d > 1.5:
        spread_text = "positive and rising: energy/biofuel pressure may be supporting agriculture"
    elif spread_20d < -1.5:
        spread_text = "negative and falling: grain weakness may be broadening"
    else:
        spread_text = "mixed / divergent: soybean oil and grains are not in a clean trend agreement"

    grains_group = groups.get("grains_oilseeds")
    livestock_group = groups.get("livestock")
    grains_strength = grains_group["changes"].get("20d") if grains_group else None
    livestock_strength = livestock_group["changes"].get("20d") if livestock_group else None

    feed_spread = None
    if grains_strength is not None and livestock_strength is not None:
        feed_spread = float(grains_strength - livestock_strength)

    if feed_spread is None:
        feed_text = "insufficient data"
    elif feed_spread > 1.0:
        feed_text = "grains rising faster than livestock: potential margin pressure"
    elif feed_spread < -1.0:
        feed_text = "livestock outperforming grains: feed-cost pressure appears absorbed"
    else:
        feed_text = "both markets are moving in a similar range"

    return {
        "soybean_oil_vs_grains": {
            "spread_20d": round(spread_20d, 2) if spread_20d is not None else None,
            "soybean_oil_20d": round(float(zl_change), 2) if zl_change is not None else None,
            "avg_grains_20d": round(grains_avg, 2) if grains_avg is not None else None,
            "interpretation": spread_text,
        },
        "livestock_feed_margin_pressure": {
            "spread_20d": round(feed_spread, 2) if feed_spread is not None else None,
            "grains_20d": round(float(grains_strength), 2) if grains_strength is not None else None,
            "livestock_20d": round(float(livestock_strength), 2) if livestock_strength is not None else None,
            "interpretation": feed_text,
        },
    }


def generate_agriculture_summary(
    regime: str,
    stability_score: float,
    groups: Dict[str, Dict[str, Any]],
    strongest: List[Dict[str, Any]],
    weakest: List[Dict[str, Any]],
    correlation_score: float,
) -> str:
    top_group = None
    if groups:
        top_group = max(groups.values(), key=lambda g: g["group_composite"])

    weakest_group = None
    if groups:
        weakest_group = min(groups.values(), key=lambda g: g["group_composite"])

    strongest_text = ", ".join(item["code"] for item in strongest[:3]) if strongest else "n/a"
    weakest_text = ", ".join(item["code"] for item in weakest[:3]) if weakest else "n/a"
    lead_text = top_group["label"] if top_group else "available groups"
    lag_text = weakest_group["label"] if weakest_group else "available groups"

    return (
        f"Agriculture is in {regime}. Stability is {stability_score:.1f}/100, "
        f"with correlation stability near {correlation_score:.1f}. "
        f"Leadership is centered in {lead_text} while {lag_text} is lagging. "
        f"Strongest symbols: {strongest_text}. Weakest symbols: {weakest_text}."
    )


def calculate_composite_index(days: int = 365) -> Dict[str, Any]:
    with _CACHE_LOCK:
        cached = _CACHE.get(days)
        if cached and (datetime.utcnow() - cached["timestamp"]).total_seconds() <= _CACHE_TTL_SECONDS:
            return cached["payload"]

    series_map, availability, missing_symbols = fetch_agriculture_data(days)

    symbol_data: Dict[str, Dict[str, Any]] = {}
    for instrument in AGRICULTURE_SYMBOLS:
        series = series_map.get(instrument.code)
        if series is None:
            continue
        changes = calculate_percent_changes(series)
        symbol_data[instrument.code] = {
            "code": instrument.code,
            "name": instrument.name,
            "group": instrument.group,
            "ticker": next((item["ticker"] for item in availability if item["code"] == instrument.code), None),
            "changes": changes,
            "momentum_score": normalize_series(changes),
            "volatility": _series_volatility(series),
        }

    group_members: Dict[str, List[str]] = {group: [] for group in GROUP_WEIGHTS.keys()}
    for code, payload in symbol_data.items():
        group_members[payload["group"]].append(code)

    effective_weights = _effective_group_weights(group_members)
    groups = calculate_sector_scores(symbol_data, series_map, effective_weights)

    group_returns = _group_return_series(groups, symbol_data, series_map)
    symbol_returns = {code: _series_daily_returns(series) for code, series in series_map.items()}
    composite_returns = _composite_return_series(group_returns, effective_weights)

    macro_returns, missing_macro = _fetch_macro_returns(days)
    correlations = calculate_correlation_matrix(group_returns, symbol_returns, composite_returns, macro_returns)

    correlation_score = _correlation_stability_score(group_returns)
    stability_components = calculate_stability_score(groups, symbol_data, composite_returns, correlation_score)
    stability_score = stability_components["stability_score"]

    composite_changes: Dict[str, Optional[float]] = {}
    for lookback in LOOKBACK_WINDOWS:
        composite_changes[f"{lookback}d"] = _calc_change_from_returns(composite_returns, lookback)

    regime = classify_agriculture_regime(
        stability_score=stability_score,
        composite_change_20d=composite_changes.get("20d"),
        volatility_stability=stability_components["volatility_stability"],
        breadth=stability_components["breadth"],
        correlation_stability=stability_components["correlation_stability"],
    )

    for group in groups.values():
        corr = None
        series = group_returns.get(group["group"])
        if series is not None and not composite_returns.empty:
            joined = pd.concat([series, composite_returns], axis=1).dropna().tail(120)
            if len(joined) >= 20:
                corr_val = _safe_float(joined.iloc[:, 0].corr(joined.iloc[:, 1]))
                corr = round(corr_val, 3) if corr_val is not None else None
        group["correlation_to_composite"] = corr
        trend_component = group["breadth_score"] if group["breadth_score"] is not None else 50.0
        group["stability_contribution"] = round((group["effective_weight"] / 100.0) * trend_component, 2)

    sorted_symbols = sorted(symbol_data.values(), key=lambda payload: payload["momentum_score"], reverse=True)
    strongest = [
        {
            "code": payload["code"],
            "name": payload["name"],
            "group": payload["group"],
            "score": round(float(payload["momentum_score"]), 2),
        }
        for payload in sorted_symbols[:3]
    ]
    weakest = [
        {
            "code": payload["code"],
            "name": payload["name"],
            "group": payload["group"],
            "score": round(float(payload["momentum_score"]), 2),
        }
        for payload in sorted_symbols[-3:]
    ]

    special = _special_signals(symbol_data, groups)
    macro_pressure = _macro_pressure(macro_returns, special)

    index_history: List[Dict[str, Any]] = []
    if not composite_returns.empty:
        index_series = (1.0 + composite_returns).cumprod()
        index_series = index_series.tail(days)
        if not index_series.empty:
            index_series = (index_series / index_series.iloc[0]) * 100.0
        for timestamp, value in index_series.items():
            index_history.append({"date": timestamp.strftime("%Y-%m-%d"), "value": round(float(value), 2)})

    summary = generate_agriculture_summary(
        regime=regime,
        stability_score=stability_score,
        groups=groups,
        strongest=strongest,
        weakest=weakest,
        correlation_score=stability_components["correlation_stability"],
    )

    payload = {
        "as_of": datetime.utcnow().isoformat(),
        "regime_label": regime,
        "stability_score": stability_score,
        "stability_components": stability_components,
        "summary": summary,
        "composite": {
            "group_weights": {group: round(weight, 2) for group, weight in effective_weights.items()},
            "changes": {
                key: (round(value, 2) if value is not None else None)
                for key, value in composite_changes.items()
            },
            "history": index_history,
            "volatility": round(float(composite_returns.tail(60).std(ddof=0) * 100.0), 3)
            if not composite_returns.empty
            else None,
        },
        "groups": sorted(groups.values(), key=lambda item: item["effective_weight"], reverse=True),
        "correlations": correlations,
        "macro_pressure": macro_pressure,
        "special_signals": special,
        "strongest_markets": strongest,
        "weakest_markets": weakest,
        "availability": {
            "symbols": availability,
            "missing_symbols": missing_symbols,
            "missing_macro_series": missing_macro,
            "available_group_count": len(groups),
            "total_configured_symbols": len(AGRICULTURE_SYMBOLS),
            "available_symbol_count": len(symbol_data),
        },
        "warnings": [
            "This is a macro diagnostic and not a trading signal.",
            "Unsupported symbols are skipped and group weights are automatically redistributed.",
        ],
    }

    with _CACHE_LOCK:
        _CACHE[days] = {"timestamp": datetime.utcnow(), "payload": payload}

    return payload
