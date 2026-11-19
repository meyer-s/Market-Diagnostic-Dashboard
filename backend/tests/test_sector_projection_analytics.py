from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.sector_projection import HORIZONS, SECTOR_ETFS
from app.services.sector_projection_analytics import (
    LEADERSHIP_COMPARISONS,
    build_scanner_sector_signals,
    build_sector_projection_analytics,
)


def _history(days: int = 30):
    start = date(2026, 6, 1)
    payload = {}
    for sector_index, etf in enumerate(SECTOR_ETFS):
        payload[etf["symbol"]] = {}
        for horizon_index, horizon in enumerate(HORIZONS):
            entries = []
            for day_index in range(days):
                score = 42.0 + sector_index * 3.0 + horizon_index + ((day_index % 5) - 2) * 0.7
                rank = max(1, min(11, 11 - sector_index))
                if etf["symbol"] == "XLK":
                    score = 58.0 + day_index * 0.12
                    rank = max(2, 9 - day_index // 4)
                entries.append(
                    {
                        "as_of_date": (start + timedelta(days=day_index)).isoformat(),
                        "score_total": score,
                        "rank": rank,
                    }
                )
            payload[etf["symbol"]][horizon] = entries
    return payload


def _latest(history):
    latest = {horizon: [] for horizon in HORIZONS}
    for etf in SECTOR_ETFS:
        for horizon in HORIZONS:
            entry = history[etf["symbol"]][horizon][-1]
            score = 95.0 if etf["symbol"] == "XLK" and horizon == "3m" else entry["score_total"]
            latest[horizon].append(
                {
                    "sector_symbol": etf["symbol"],
                    "sector_name": etf["name"],
                    "score_total": score,
                    "rank": entry["rank"],
                }
            )
    return latest


def test_sector_analytics_stabilizes_spikes_and_bounds_scanner_overlay() -> None:
    history = _history()
    as_of = date(2026, 6, 30)
    events = [
        SimpleNamespace(
            symbol=symbol,
            triggered_at=datetime.combine(as_of - timedelta(days=index), datetime.min.time()),
            selected_option_type="call",
            opportunity_score=82.0,
        )
        for index, symbol in enumerate(["AAPL", "MSFT", "NVDA", "AVGO"])
    ]

    payload = build_sector_projection_analytics(
        history=history,
        latest_by_horizon=_latest(history),
        scanner_events=events,
        as_of=as_of,
    )

    xlk = payload["sectors"]["XLK"]
    three_month = xlk["horizons"]["3m"]
    assert three_month["raw_score"] == 95.0
    assert three_month["stable_score"] < 80.0
    assert 0.0 < three_month["scanner_overlay"] <= 4.0
    assert xlk["persistence"]["direction"] == "improving"
    assert three_month["uncertainty_high"] - three_month["stable_score"] > three_month["stable_score"] - three_month["uncertainty_low"]
    forward = xlk["forward_scenarios"]
    assert set(forward) == set(HORIZONS)
    assert forward["T"]["months_forward"] == 0
    assert forward["3m"]["months_forward"] == 3
    assert forward["6m"]["months_forward"] == 6
    assert forward["12m"]["months_forward"] == 12
    assert forward["3m"]["momentum_points"] > 0
    assert forward["12m"]["projected_high"] - forward["12m"]["projected_low"] > forward["3m"]["projected_high"] - forward["3m"]["projected_low"]
    assert all(1 <= scenario["projected_rank"] <= 11 for scenario in forward.values())
    assert "trailing-window anchors" in payload["forward_scenario_method"]


def test_sector_analytics_builds_bounded_multi_comparison_oscillators() -> None:
    history = _history()
    payload = build_sector_projection_analytics(
        history=history,
        latest_by_horizon=_latest(history),
        scanner_events=[],
        as_of=date(2026, 6, 30),
    )

    comparisons = {row["key"]: row for row in payload["leadership_comparisons"]}
    assert set(comparisons) == {row["key"] for row in LEADERSHIP_COMPARISONS}
    broad = comparisons["broad_risk_appetite"]
    assert len(broad["positive_symbols"]) + len(broad["negative_symbols"]) == 11
    assert broad["sample_count"] == 30
    assert all(-100.0 <= point["oscillator"] <= 100.0 for point in broad["series"])
    assert all(point["oscillator"] == point["smoothed_spread"] for point in broad["series"])
    assert broad["positive_axis_label"] == "Offense"
    assert broad["negative_axis_label"] == "Shelter"
    assert payload["leadership_band"] == 15.0
    assert "native sector score points" in payload["leadership_method"]
    assert payload["scanner_coverage"]["max_overlay_points"] == 4.0


def test_scanner_signal_deduplicates_repeated_hits_and_preserves_direction() -> None:
    as_of = date(2026, 6, 30)
    event_time = datetime.combine(as_of, datetime.min.time())
    events = [
        SimpleNamespace(
            symbol="XOM",
            triggered_at=event_time,
            selected_option_type="put",
            opportunity_score=score,
        )
        for score in (55.0, 84.0, 61.0)
    ]

    signals, coverage = build_scanner_sector_signals(events, as_of=as_of)

    assert coverage["total_events"] == 3
    assert coverage["deduplicated_events"] == 1
    assert signals["XLE"]["hits"] == 1
    assert signals["XLE"]["directional_balance"] == -1.0
    assert -4.0 <= signals["XLE"]["overlay_points"] < 0.0


def test_scanner_signal_requires_observed_timestamps_inside_inclusive_run_day_window() -> None:
    as_of = date(2026, 6, 30)
    timestamps = [
        datetime(2026, 6, 16),  # inclusive 14-day cutoff
        datetime(2026, 6, 30, 23, 59),
        datetime(2026, 6, 15, 23, 59),
        datetime(2026, 7, 1),
        # Still June 30 locally, but after the declared UTC run-day.
        datetime(2026, 6, 30, 23, tzinfo=timezone(timedelta(hours=-5))),
        None,
        "not-a-timestamp",
    ]
    events = [
        SimpleNamespace(symbol="XOM", triggered_at=timestamp, selected_option_type="call", opportunity_score=85)
        for timestamp in timestamps
    ]

    signals, coverage = build_scanner_sector_signals(events, as_of=as_of, lookback_days=14)

    assert coverage["total_events"] == 2
    assert coverage["deduplicated_events"] == 2
    assert signals["XLE"]["hits"] == 2
    assert signals["XLE"]["distinct_days"] == 2


def test_scanner_unknown_sides_remain_activity_without_inflating_directional_coverage() -> None:
    as_of = date(2026, 6, 30)
    known = SimpleNamespace(symbol="NVDA", triggered_at=datetime(2026, 6, 30), selected_option_type="call", opportunity_score=90)
    unknown = [
        SimpleNamespace(
            symbol=symbol,
            triggered_at=datetime(2026, 6, 30) - timedelta(days=index // 2),
            selected_option_type="null",
            opportunity_score=90,
        )
        for index, symbol in enumerate(["NVDA", "AAPL", "MSFT", "AVGO", "NVDA", "AAPL", "MSFT", "AVGO"])
    ]

    baseline, _ = build_scanner_sector_signals([known], as_of=as_of)
    signals, coverage = build_scanner_sector_signals([known, *unknown], as_of=as_of)
    only_unknown, _ = build_scanner_sector_signals(unknown, as_of=as_of)

    assert signals["XLK"]["hits"] == 9
    assert signals["XLK"]["unknown_side_hits"] == 8
    assert signals["XLK"]["directional_hits"] == 1
    assert signals["XLK"]["unique_symbols"] == 4
    assert signals["XLK"]["directional_unique_symbols"] == 1
    assert signals["XLK"]["directional_distinct_days"] == 1
    assert signals["XLK"]["reliability"] == baseline["XLK"]["reliability"]
    assert signals["XLK"]["overlay_points"] == baseline["XLK"]["overlay_points"]
    assert coverage["directional_deduplicated_events"] == 1
    assert coverage["unknown_side_deduplicated_events"] == 8
    assert only_unknown["XLK"]["reliability"] == 0
    assert only_unknown["XLK"]["overlay_points"] == 0
    assert only_unknown["XLK"]["evidence_status"] == "thin"
