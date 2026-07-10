from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

from app.models.options_alerts import OptionAlertEvent


_PRESET_PATH = Path(__file__).resolve().parents[1] / "data" / "ticker_presets.json"

_THEME_SYMBOLS: dict[str, set[str]] = {
    "Hospitality & Travel": {
        "ABNB",
        "BKNG",
        "CCL",
        "CHH",
        "CZR",
        "EXPE",
        "H",
        "HGV",
        "HLT",
        "LVS",
        "MAR",
        "MGM",
        "NCLH",
        "PENN",
        "PRKS",
        "RCL",
        "RRR",
        "TRIP",
        "VAC",
        "VCSA",
        "WH",
        "WYNN",
    },
    "Restaurants & Leisure": {"CAKE", "CBRL", "CMG", "DRI", "DPZ", "EAT", "MCD", "PLAY", "SBUX", "SHAK", "TXRH", "YUM"},
    "Homebuilders & Housing": {"DHI", "LEN", "MDC", "MTH", "NVR", "PHM", "TOL", "KBH", "LGIH", "TMHC"},
    "Retail & Consumer": {"BBY", "BURL", "COST", "DG", "DLTR", "HD", "LOW", "ROST", "TGT", "TJX", "ULTA", "WMT"},
    "Autos & Mobility": {"APTV", "F", "GM", "LCID", "RIVN", "TSLA", "VC", "XPEV"},
    "Semiconductors": {"AMD", "AVGO", "INTC", "MU", "NVDA", "ON", "QCOM", "SMCI", "SOXX", "TSM"},
    "Banks & Credit": {"BAC", "C", "COF", "DFS", "GS", "JPM", "MS", "PNC", "SCHW", "USB", "WFC"},
    "Energy": {"APA", "COP", "CVX", "DVN", "EOG", "HAL", "MPC", "OXY", "PSX", "SLB", "VLO", "XOM"},
    "Health Care Services": {"CI", "CNC", "CRVL", "CVS", "ELV", "HCA", "HUM", "MOH", "UNH"},
    "Biotech & Pharma": {"ABBV", "AMGN", "BMY", "GILD", "LLY", "MRK", "PFE", "REGN", "VRTX"},
    "Real Estate": {"AMT", "AVB", "CBRE", "EQIX", "EXR", "O", "PLD", "SPG", "VTR", "XLRE"},
}


@dataclass(frozen=True)
class SymbolGroup:
    symbol: str
    sector: str
    group: str


@lru_cache(maxsize=1)
def _preset_sector_map() -> dict[str, str]:
    try:
        payload = json.loads(_PRESET_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

    mapping: dict[str, str] = {}
    for preset in payload.get("presets", []):
        sectors = preset.get("sectors") or {}
        for sector, symbols in sectors.items():
            sector_name = str(sector).strip() or "Unclassified"
            for symbol in symbols or []:
                normalized = str(symbol).strip().upper()
                if normalized and normalized not in mapping:
                    mapping[normalized] = sector_name
    return mapping


@lru_cache(maxsize=1)
def _theme_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for theme, symbols in _THEME_SYMBOLS.items():
        for symbol in symbols:
            mapping[symbol] = theme
    return mapping


def classify_optionality_symbol(symbol: str) -> SymbolGroup:
    normalized = str(symbol or "").strip().upper()
    sector = _preset_sector_map().get(normalized, "Unclassified")
    group = _theme_map().get(normalized) or sector
    return SymbolGroup(symbol=normalized, sector=sector, group=group)


def _event_date(event: OptionAlertEvent) -> date:
    triggered = event.triggered_at
    if isinstance(triggered, datetime):
        return triggered.date()
    return date.today()


def _float_or_none(value: object) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _avg(values: Iterable[Optional[float]]) -> Optional[float]:
    valid = [value for value in values if value is not None]
    if not valid:
        return None
    return round(sum(valid) / len(valid), 2)


def _bucket_start(day: date, anchor: date, bucket_days: int) -> date:
    delta_days = max(0, (day - anchor).days)
    return anchor + timedelta(days=(delta_days // bucket_days) * bucket_days)


def build_optionality_cluster_payload(
    events: list[OptionAlertEvent],
    *,
    today: Optional[date] = None,
    lookback_days: int = 45,
    bucket_days: int = 7,
    min_hits: int = 1,
) -> dict[str, object]:
    today = today or date.today()
    bucket_days = max(1, int(bucket_days or 7))
    min_hits = max(1, int(min_hits or 1))
    cutoff = today - timedelta(days=max(1, int(lookback_days or 45)))
    recent_cutoff = today - timedelta(days=bucket_days)
    prior_cutoff = today - timedelta(days=bucket_days * 2)

    grouped: dict[str, dict[str, object]] = {}
    timeline: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    anchor = cutoff

    for event in events:
        symbol = str(event.symbol or "").strip().upper()
        if not symbol:
            continue
        day = _event_date(event)
        if day < cutoff:
            continue

        classification = classify_optionality_symbol(symbol)
        spread = None
        iv30 = _float_or_none(event.iv30)
        hv30 = _float_or_none(event.hv30)
        if iv30 is not None and hv30 is not None:
            spread = round(iv30 - hv30, 2)

        group = grouped.setdefault(
            classification.group,
            {
                "group": classification.group,
                "sector": classification.sector,
                "hits": 0,
                "recent_hits": 0,
                "prior_hits": 0,
                "symbols": set(),
                "events": [],
                "_iv_percentiles": [],
                "_spreads": [],
                "_latest": None,
            },
        )
        group["hits"] = int(group["hits"]) + 1
        if day >= recent_cutoff:
            group["recent_hits"] = int(group["recent_hits"]) + 1
        elif prior_cutoff <= day < recent_cutoff:
            group["prior_hits"] = int(group["prior_hits"]) + 1
        group["symbols"].add(symbol)
        group["_iv_percentiles"].append(_float_or_none(event.iv_percentile))
        group["_spreads"].append(spread)
        latest = group["_latest"]
        if latest is None or (event.triggered_at and event.triggered_at > latest):
            group["_latest"] = event.triggered_at
        group["events"].append(
            {
                "event_id": event.id,
                "symbol": symbol,
                "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
                "sector": classification.sector,
                "group": classification.group,
                "iv_percentile": _float_or_none(event.iv_percentile),
                "iv_hv_spread": spread,
                "avg_edr": _float_or_none(event.avg_edr),
                "selected_option_type": event.selected_option_type,
            }
        )
        timeline[_bucket_start(day, anchor, bucket_days)][classification.group] += 1

    clusters = []
    for group in grouped.values():
        hits = int(group["hits"])
        if hits < min_hits:
            continue
        symbols = sorted(group["symbols"])
        avg_spread = _avg(group["_spreads"])
        avg_iv_percentile = _avg(group["_iv_percentiles"])
        recent_hits = int(group["recent_hits"])
        prior_hits = int(group["prior_hits"])
        strength_score = round(
            hits
            + len(symbols) * 0.5
            + recent_hits * 0.75
            + max(0.0, -(avg_spread or 0.0)) / 6.0,
            2,
        )
        clusters.append(
            {
                "group": group["group"],
                "sector": group["sector"],
                "hits": hits,
                "recent_hits": recent_hits,
                "prior_hits": prior_hits,
                "momentum": recent_hits - prior_hits,
                "symbols": symbols,
                "avg_iv_percentile": avg_iv_percentile,
                "avg_iv_hv_spread": avg_spread,
                "latest_triggered_at": group["_latest"].isoformat() if group["_latest"] else None,
                "strength_score": strength_score,
                "events": sorted(group["events"], key=lambda row: row.get("triggered_at") or "", reverse=True)[:8],
            }
        )

    clusters.sort(
        key=lambda row: (
            row["group"] != "Unclassified",
            int(row["recent_hits"]),
            float(row["strength_score"]),
            int(row["hits"]),
            len(row["symbols"]),
        ),
        reverse=True,
    )

    timeline_rows = []
    for bucket, groups in sorted(timeline.items()):
        timeline_rows.append(
            {
                "bucket_start": bucket.isoformat(),
                "bucket_end": min(bucket + timedelta(days=bucket_days - 1), today).isoformat(),
                "groups": [
                    {"group": group, "hits": hits}
                    for group, hits in sorted(groups.items(), key=lambda item: item[1], reverse=True)
                ],
            }
        )

    return {
        "lookback_days": lookback_days,
        "bucket_days": bucket_days,
        "generated_at": datetime.utcnow().isoformat(),
        "clusters": clusters,
        "timeline": timeline_rows,
    }
