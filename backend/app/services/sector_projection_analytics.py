from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
import math
import statistics
from typing import Any, Iterable, Optional

from app.services.optionality_clusters import classify_optionality_symbol
from app.services.sector_projection import HORIZONS, SECTOR_ETFS


ANALYTICS_VERSION = "sector_stability_v4"
LEADERSHIP_BAND = 15.0

SECTOR_NAME_TO_ETF = {
    "Communication": "XLC",
    "Communication Services": "XLC",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Energy": "XLE",
    "Financials": "XLF",
    "Health Care": "XLV",
    "Industrials": "XLI",
    "Information Technology": "XLK",
    "Technology": "XLK",
    "Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
}

LEADERSHIP_COMPARISONS = (
    {
        "key": "cyclical_defensive",
        "title": "Cyclical vs defensive",
        "positive_label": "Cyclical leadership",
        "negative_label": "Defensive leadership",
        "positive_axis_label": "Cyclical",
        "negative_axis_label": "Defensive",
        "positive_symbols": ("XLY", "XLI", "XLB", "XLE", "XLF"),
        "negative_symbols": ("XLP", "XLV", "XLU"),
        "description": "Consumer and real-economy cyclicals minus classic defensive sectors.",
    },
    {
        "key": "broad_risk_appetite",
        "title": "Broad offense vs shelter",
        "positive_label": "Broad offense",
        "negative_label": "Capital shelter",
        "positive_axis_label": "Offense",
        "negative_axis_label": "Shelter",
        "positive_symbols": ("XLK", "XLC", "XLY", "XLI", "XLF", "XLE", "XLB"),
        "negative_symbols": ("XLP", "XLV", "XLU", "XLRE"),
        "description": "A complete 11-sector split that checks whether leadership is broadly offensive or sheltered.",
    },
    {
        "key": "growth_reflation",
        "title": "Growth vs reflation",
        "positive_label": "Growth leadership",
        "negative_label": "Reflation leadership",
        "positive_axis_label": "Growth",
        "negative_axis_label": "Reflation",
        "positive_symbols": ("XLK", "XLC", "XLY"),
        "negative_symbols": ("XLE", "XLB", "XLI", "XLF"),
        "description": "Long-duration growth leadership compared with nominal-growth and real-economy leadership.",
    },
    {
        "key": "consumer_appetite",
        "title": "Discretionary vs staples",
        "positive_label": "Consumer risk appetite",
        "negative_label": "Consumer defensiveness",
        "positive_axis_label": "Discretionary",
        "negative_axis_label": "Staples",
        "positive_symbols": ("XLY",),
        "negative_symbols": ("XLP",),
        "description": "The cleanest sector-level consumer risk-appetite pair.",
    },
)

HORIZON_SCANNER_DECAY = {"T": 1.0, "3m": 1.0, "6m": 0.5, "12m": 0.25}
HORIZON_UNCERTAINTY_SCALE = {"T": 0.55, "3m": 1.0, "6m": 1.35, "12m": 1.7}
FORWARD_SCENARIO_CONFIG = {
    "T": {"months": 0, "anchor": "T", "current_weight": 1.0, "momentum_cap": 0.0, "scanner_decay": 1.0, "uncertainty_scale": 0.55},
    "3m": {"months": 3, "anchor": "3m", "current_weight": 0.65, "momentum_cap": 3.0, "scanner_decay": 1.0, "uncertainty_scale": 1.0},
    "6m": {"months": 6, "anchor": "6m", "current_weight": 0.50, "momentum_cap": 5.0, "scanner_decay": 0.5, "uncertainty_scale": 1.35},
    "12m": {"months": 12, "anchor": "12m", "current_weight": 0.35, "momentum_cap": 7.0, "scanner_decay": 0.25, "uncertainty_scale": 1.7},
}


def _finite(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _mean(values: Iterable[float]) -> Optional[float]:
    rows = list(values)
    return sum(rows) / len(rows) if rows else None


def _ewma(values: list[float], alpha: float = 0.25) -> Optional[float]:
    if not values:
        return None
    level = values[0]
    for value in values[1:]:
        level = alpha * value + (1.0 - alpha) * level
    return level


def _robust_level(values: list[float]) -> Optional[float]:
    if not values:
        return None
    recent = values[-20:]
    ewma = _ewma(recent, alpha=0.25) or recent[-1]
    median = statistics.median(recent[-5:])
    return 0.55 * ewma + 0.30 * median + 0.15 * recent[-1]


def _linear_slope(values: list[float]) -> float:
    if len(values) < 3:
        return 0.0
    n = len(values)
    mean_x = (n - 1) / 2.0
    mean_y = sum(values) / n
    denominator = sum((index - mean_x) ** 2 for index in range(n))
    if denominator <= 0:
        return 0.0
    return sum((index - mean_x) * (value - mean_y) for index, value in enumerate(values)) / denominator


def _entry_date(entry: dict[str, Any]) -> str:
    return str(entry.get("as_of_date") or "")


def _sorted_valid_entries(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    valid = []
    for entry in entries:
        score = _finite(entry.get("score_total"))
        if not _entry_date(entry) or score is None:
            continue
        valid.append({**entry, "score_total": score})
    return sorted(valid, key=_entry_date)


def _smoothed_history(entries: list[dict[str, Any]], limit: int = 120) -> list[dict[str, Any]]:
    output = []
    running: list[float] = []
    for entry in entries:
        running.append(float(entry["score_total"]))
        stable = _robust_level(running[-20:])
        output.append(
            {
                "as_of_date": entry["as_of_date"],
                "raw_score": round(float(entry["score_total"]), 2),
                "stable_score": round(float(stable), 2) if stable is not None else None,
                "rank": int(entry["rank"]) if entry.get("rank") is not None else None,
            }
        )
    return output[-limit:]


def build_scanner_sector_signals(
    events: Iterable[object],
    *,
    as_of: date,
    lookback_days: int = 45,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    cutoff = as_of - timedelta(days=max(14, int(lookback_days)))
    candidates: dict[tuple[str, date, str], dict[str, Any]] = {}
    total_events = 0
    classified_events = 0

    for event in events:
        symbol = str(getattr(event, "symbol", "") or "").strip().upper()
        triggered_at = getattr(event, "triggered_at", None)
        event_day = triggered_at.date() if isinstance(triggered_at, datetime) else as_of
        if not symbol or event_day < cutoff:
            continue
        total_events += 1
        classification = classify_optionality_symbol(symbol)
        sector_symbol = SECTOR_NAME_TO_ETF.get(classification.sector)
        if not sector_symbol:
            continue
        classified_events += 1
        option_type = str(getattr(event, "selected_option_type", "") or "").strip().lower()
        key = (symbol, event_day, option_type)
        score = _finite(getattr(event, "opportunity_score", None))
        existing = candidates.get(key)
        if existing is None or (score or 0.0) > (existing.get("opportunity_score") or 0.0):
            candidates[key] = {
                "sector_symbol": sector_symbol,
                "symbol": symbol,
                "day": event_day,
                "option_type": option_type,
                "opportunity_score": score,
            }

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates.values():
        grouped[candidate["sector_symbol"]].append(candidate)

    signals: dict[str, dict[str, Any]] = {}
    for etf in SECTOR_ETFS:
        sector_symbol = etf["symbol"]
        rows = grouped.get(sector_symbol, [])
        signed_weight = 0.0
        directional_weight = 0.0
        recent_hits = 0
        prior_hits = 0
        symbols: set[str] = set()
        days: set[date] = set()
        for row in rows:
            age_days = max(0, (as_of - row["day"]).days)
            recency = math.exp(-age_days / 14.0)
            score_strength = _clamp((_finite(row.get("opportunity_score")) or 50.0) / 100.0, 0.2, 1.0)
            direction = 1.0 if row["option_type"] == "call" else -1.0 if row["option_type"] == "put" else 0.0
            if direction:
                weight = recency * score_strength
                signed_weight += direction * weight
                directional_weight += weight
            if age_days <= 13:
                recent_hits += 1
            elif age_days <= 27:
                prior_hits += 1
            symbols.add(row["symbol"])
            days.add(row["day"])

        directional_balance = signed_weight / directional_weight if directional_weight else 0.0
        sample_reliability = min(1.0, len(rows) / 8.0)
        breadth_reliability = min(1.0, len(symbols) / 4.0)
        persistence_reliability = min(1.0, len(days) / 4.0)
        reliability = sample_reliability * breadth_reliability * persistence_reliability
        scanner_score = 50.0 + directional_balance * 25.0
        overlay_points = directional_balance * 4.0 * reliability
        signals[sector_symbol] = {
            "hits": len(rows),
            "recent_hits": recent_hits,
            "prior_hits": prior_hits,
            "unique_symbols": len(symbols),
            "distinct_days": len(days),
            "directional_balance": round(directional_balance, 4),
            "scanner_score": round(scanner_score, 2),
            "reliability": round(reliability, 4),
            "overlay_points": round(overlay_points, 2),
            "evidence_status": "usable" if reliability >= 0.35 else "thin",
        }

    return signals, {
        "lookback_days": lookback_days,
        "total_events": total_events,
        "classified_events": classified_events,
        "deduplicated_events": len(candidates),
        "classification_coverage_pct": round(classified_events / total_events * 100.0, 1) if total_events else 0.0,
        "max_overlay_points": 4.0,
    }


def _leadership_series(
    history: dict[str, dict[str, list[dict[str, Any]]]],
    comparison: dict[str, Any],
) -> list[dict[str, Any]]:
    by_date: dict[str, dict[str, float]] = defaultdict(dict)
    symbols = set(comparison["positive_symbols"]) | set(comparison["negative_symbols"])
    for symbol in symbols:
        entries = _sorted_valid_entries((history.get(symbol) or {}).get("3m") or [])
        for entry in entries:
            by_date[entry["as_of_date"]][symbol] = float(entry["score_total"])

    raw_points = []
    for date_key, values in sorted(by_date.items()):
        positive = [values[symbol] for symbol in comparison["positive_symbols"] if symbol in values]
        negative = [values[symbol] for symbol in comparison["negative_symbols"] if symbol in values]
        positive_required = max(1, math.ceil(len(comparison["positive_symbols"]) * 0.6))
        negative_required = max(1, math.ceil(len(comparison["negative_symbols"]) * 0.6))
        if len(positive) < positive_required or len(negative) < negative_required:
            continue
        positive_avg = _mean(positive) or 0.0
        negative_avg = _mean(negative) or 0.0
        raw_points.append(
            {
                "as_of_date": date_key,
                "positive_avg": positive_avg,
                "negative_avg": negative_avg,
                "raw_spread": positive_avg - negative_avg,
            }
        )

    output = []
    level: Optional[float] = None
    for point in raw_points:
        raw_spread = float(point["raw_spread"])
        level = raw_spread if level is None else 0.25 * raw_spread + 0.75 * level
        # The underlying sector scores already share a common 0-100 scale. The
        # smoothed basket spread is therefore directly comparable across lenses.
        # Re-standardizing it by each lens's rolling dispersion caused persistent
        # leadership to saturate at +/-100 and erased useful changes in magnitude.
        oscillator = _clamp(level, -100.0, 100.0)
        output.append(
            {
                "as_of_date": point["as_of_date"],
                "positive_avg": round(float(point["positive_avg"]), 2),
                "negative_avg": round(float(point["negative_avg"]), 2),
                "raw_spread": round(raw_spread, 2),
                "smoothed_spread": round(level, 2),
                "oscillator": round(oscillator, 2),
            }
        )
    return output


def build_sector_projection_analytics(
    *,
    history: dict[str, dict[str, list[dict[str, Any]]]],
    latest_by_horizon: dict[str, list[dict[str, Any]]],
    scanner_events: Iterable[object],
    as_of: date,
    scanner_lookback_days: int = 45,
) -> dict[str, Any]:
    scanner_signals, scanner_coverage = build_scanner_sector_signals(
        scanner_events,
        as_of=as_of,
        lookback_days=scanner_lookback_days,
    )
    latest_lookup = {
        horizon: {str(row["sector_symbol"]): row for row in rows}
        for horizon, rows in latest_by_horizon.items()
    }
    sector_payload: dict[str, dict[str, Any]] = {}

    for etf in SECTOR_ETFS:
        symbol = etf["symbol"]
        rank_entries = _sorted_valid_entries((history.get(symbol) or {}).get("3m") or [])[-20:]
        ranks = [float(entry["rank"]) for entry in rank_entries if entry.get("rank") is not None]
        rank_slope = _linear_slope(ranks)
        rank_reliability = min(1.0, len(ranks) / 12.0)
        rank_signal = _clamp(-rank_slope / 0.30, -1.0, 1.0) * rank_reliability
        top3_rate = sum(rank <= 3 for rank in ranks) / len(ranks) if ranks else 0.0
        scanner = scanner_signals[symbol]
        horizons_payload: dict[str, dict[str, Any]] = {}

        for horizon in HORIZONS:
            latest = latest_lookup.get(horizon, {}).get(symbol)
            if latest is None:
                continue
            raw_score = _finite(latest.get("score_total"))
            if raw_score is None:
                continue
            entries = _sorted_valid_entries((history.get(symbol) or {}).get(horizon) or [])
            scores = [float(entry["score_total"]) for entry in entries[-20:]]
            if not scores or abs(scores[-1] - raw_score) > 1e-6:
                scores.append(raw_score)
            stable_core = _robust_level(scores) or raw_score
            scanner_decay = HORIZON_SCANNER_DECAY.get(horizon, 0.5)
            scanner_overlay = float(scanner["overlay_points"]) * scanner_decay
            stable_score = _clamp(stable_core + scanner_overlay, 0.0, 100.0)
            score_std = statistics.pstdev(scores) if len(scores) >= 3 else 4.0
            base_width = _clamp(max(4.0, score_std * 1.3), 4.0, 18.0)
            base_width *= HORIZON_UNCERTAINTY_SCALE.get(horizon, 1.0)
            scanner_skew = float(scanner["directional_balance"]) * float(scanner["reliability"])
            skew = _clamp(rank_signal * 0.70 + scanner_skew * 0.30, -1.0, 1.0)
            upper_factor = 1.0 + 0.40 * max(skew, 0.0) - 0.20 * max(-skew, 0.0)
            lower_factor = 1.0 + 0.40 * max(-skew, 0.0) - 0.20 * max(skew, 0.0)
            horizons_payload[horizon] = {
                "raw_score": round(raw_score, 2),
                "stable_core_score": round(stable_core, 2),
                "stable_score": round(stable_score, 2),
                "scanner_overlay": round(scanner_overlay, 2),
                "uncertainty_low": round(_clamp(stable_score - base_width * lower_factor, 0.0, 100.0), 2),
                "uncertainty_high": round(_clamp(stable_score + base_width * upper_factor, 0.0, 100.0), 2),
                "observed_score_std": round(score_std, 2),
                "sample_count": len(scores),
                "raw_rank": int(latest["rank"]) if latest.get("rank") is not None else None,
            }

        # Convert trailing-window evidence into a separate forward scenario path.
        # The current stabilized score is blended toward the corresponding
        # longer-run anchor, then adjusted by bounded rank persistence and the
        # reliability-gated scanner signal. These are score scenarios, not price
        # targets or calibrated return forecasts.
        current_signal = horizons_payload.get("T") or horizons_payload.get("3m")
        forward_scenarios: dict[str, dict[str, Any]] = {}
        if current_signal is not None:
            current_core = float(current_signal["stable_core_score"])
            variability_reference = horizons_payload.get("3m") or current_signal
            reference_std = float(variability_reference.get("observed_score_std") or 4.0)
            base_scenario_width = _clamp(max(4.0, reference_std * 1.3), 4.0, 18.0)
            scanner_skew = float(scanner["directional_balance"]) * float(scanner["reliability"])
            scenario_skew = _clamp(rank_signal * 0.70 + scanner_skew * 0.30, -1.0, 1.0)
            upper_factor = 1.0 + 0.40 * max(scenario_skew, 0.0) - 0.20 * max(-scenario_skew, 0.0)
            lower_factor = 1.0 + 0.40 * max(-scenario_skew, 0.0) - 0.20 * max(scenario_skew, 0.0)

            for scenario_horizon, config in FORWARD_SCENARIO_CONFIG.items():
                anchor = horizons_payload.get(str(config["anchor"])) or current_signal
                if scenario_horizon == "T":
                    projected_score = float(current_signal["stable_score"])
                    anchor_score = current_core
                    momentum_points = 0.0
                    scanner_points = float(current_signal["scanner_overlay"])
                else:
                    anchor_score = float(anchor["stable_core_score"])
                    current_weight = float(config["current_weight"])
                    momentum_points = rank_signal * float(config["momentum_cap"])
                    scanner_points = float(scanner["overlay_points"]) * float(config["scanner_decay"])
                    projected_score = _clamp(
                        current_weight * current_core
                        + (1.0 - current_weight) * anchor_score
                        + momentum_points
                        + scanner_points,
                        0.0,
                        100.0,
                    )

                scenario_width = base_scenario_width * float(config["uncertainty_scale"])
                forward_scenarios[scenario_horizon] = {
                    "months_forward": int(config["months"]),
                    "projected_score": round(projected_score, 2),
                    "projected_low": round(_clamp(projected_score - scenario_width * lower_factor, 0.0, 100.0), 2),
                    "projected_high": round(_clamp(projected_score + scenario_width * upper_factor, 0.0, 100.0), 2),
                    "current_core_score": round(current_core, 2),
                    "anchor_score": round(anchor_score, 2),
                    "momentum_points": round(momentum_points, 2),
                    "scanner_points": round(scanner_points, 2),
                }

        sector_payload[symbol] = {
            "sector_symbol": symbol,
            "sector_name": etf["name"],
            "horizons": horizons_payload,
            "persistence": {
                "sample_count": len(ranks),
                "rank_slope_per_run": round(rank_slope, 4),
                "rank_signal": round(rank_signal, 4),
                "top3_rate": round(top3_rate, 4),
                "direction": "improving" if rank_signal > 0.15 else "weakening" if rank_signal < -0.15 else "stable",
            },
            "scanner": scanner,
            "history_3m": _smoothed_history(rank_entries, limit=90),
            "forward_scenarios": forward_scenarios,
        }

    for horizon in HORIZONS:
        ranked = sorted(
            (
                (symbol, payload["horizons"][horizon]["stable_score"])
                for symbol, payload in sector_payload.items()
                if horizon in payload["horizons"]
            ),
            key=lambda item: (-item[1], item[0]),
        )
        for rank, (symbol, _score) in enumerate(ranked, start=1):
            sector_payload[symbol]["horizons"][horizon]["stable_rank"] = rank

    for horizon in FORWARD_SCENARIO_CONFIG:
        ranked = sorted(
            (
                (symbol, payload["forward_scenarios"][horizon]["projected_score"])
                for symbol, payload in sector_payload.items()
                if horizon in payload["forward_scenarios"]
            ),
            key=lambda item: (-item[1], item[0]),
        )
        for rank, (symbol, _score) in enumerate(ranked, start=1):
            sector_payload[symbol]["forward_scenarios"][horizon]["projected_rank"] = rank

    comparisons = []
    for comparison in LEADERSHIP_COMPARISONS:
        series = _leadership_series(history, comparison)
        comparisons.append(
            {
                **comparison,
                "positive_symbols": list(comparison["positive_symbols"]),
                "negative_symbols": list(comparison["negative_symbols"]),
                "series": series,
                "sample_count": len(series),
            }
        )

    return {
        "as_of_date": as_of.isoformat(),
        "analytics_version": ANALYTICS_VERSION,
        "leadership_method": "25% EWMA of the positive-basket mean minus the negative-basket mean, expressed in native sector score points.",
        "leadership_band": LEADERSHIP_BAND,
        "forward_scenario_method": "Current stabilized score blended toward trailing-window anchors, with bounded recent-rank persistence and reliability-gated scanner confirmation.",
        "score_method": "55% EWMA + 30% five-run median + 15% latest raw score",
        "scanner_method": "Directional scanner evidence is deduplicated by symbol/day/side and capped at +/-4 score points before horizon decay.",
        "uncertainty_method": "Observed 20-run score variability with asymmetric scenario width from persistent rank direction and reliable scanner breadth; not a probability confidence interval.",
        "scanner_coverage": scanner_coverage,
        "sectors": sector_payload,
        "leadership_comparisons": comparisons,
    }
