from datetime import date, timedelta

import pandas as pd
import pytest

from app.services import institutional_flow as flow


def bars(periods=100, freq="D", end="2026-11-19", price=75942.125):
    index = pd.date_range(end=end, periods=periods, freq=freq)
    return pd.DataFrame({
        "Open": price, "High": price + 1, "Low": price - 9, "Close": price,
        "Volume": [100 + (i % 7) for i in range(periods)],
    }, index=index)


def test_crypto_usd_turnover_is_not_multiplied_by_coin_price():
    frame = bars()
    frame.iloc[-1, frame.columns.get_loc("Volume")] = 48_407_763_452
    crypto = flow.build_price_volume_signal("BTC-USD", frame)
    stock = flow.build_price_volume_signal("NVDA", frame)
    assert crypto["recent_events"][0]["notional"] == 48_407_763_452
    assert stock["recent_events"][0]["notional"] == pytest.approx(48_407_763_452 * 75942.125)
    assert crypto["volume_unit"] == "USD"
    assert "net_flow_usd" not in crypto
    assert "confidence" not in crypto


def test_outlier_is_compared_only_with_prior_bars():
    frame = bars(100)
    frame.iloc[-1, frame.columns.get_loc("Volume")] = 250
    previous = frame["Volume"].iloc[-21:-1]
    event = flow.detect_flow_events_from_frame(frame)[-1]
    assert event["volume_z"] == round((250 - previous.mean()) / previous.std(ddof=0), 2)


@pytest.mark.parametrize("freq", ["D", "B"])
def test_calendar_window_has_warmup_and_includes_first_day(freq):
    frame = bars(500, freq)
    finish = date(2026, 11, 19)
    start = finish - timedelta(days=119)
    first = next(index for index in frame.index if index.date() >= start)
    frame.loc[first, "Volume"] = 10_000
    result = flow.build_price_volume_signal("TEST", frame, 120, end=finish)
    assert result["window_start"] == start.isoformat()
    assert result["window_end"] == finish.isoformat()
    assert result["observed_bars"] == len(frame[frame.index.date >= start])
    assert result["event_history"][0]["date"] == first.date().isoformat()
    assert all(start.isoformat() <= event["date"] <= finish.isoformat() for event in result["event_history"])
    assert result["baseline_bars"] == 20


def test_max_window_covers_full_year_and_does_not_drop_early_sessions():
    frame = bars(600, "B")
    result = flow.build_price_volume_signal("TEST", frame, 365)
    assert result["window_start"] == "2025-11-20"
    assert result["eligible_bars"] > 250


def test_timeline_preserves_empty_weeks_and_source_coverage():
    events = [{"date": "2026-09-14", "side": "buy", "notional": 20}, {"date": "2026-11-02", "side": "buy", "notional": 30}]
    weeks = flow._build_flow_timeline(events, date(2026, 9, 14), date(2026, 11, 8), bars())
    assert len(weeks) == 8
    assert weeks[1]["signed_turnover_usd"] == 0
    assert weeks[1]["observed_bars"] == 7
    assert sum(week["signed_turnover_usd"] for week in weeks) == 50
    assert all((date.fromisoformat(b["bucket"]) - date.fromisoformat(a["bucket"])).days == 7 for a, b in zip(weeks, weeks[1:]))


def test_reference_distances_share_current_price_denominator():
    events = [{"date": "2026-11-12", "side": "buy", "price": 227.98, "notional": 100, "volume_z": 3.2}, {"date": "2026-11-10", "side": "sell", "price": 182.4256, "notional": 50, "volume_z": 2.5}]
    summary = flow.summarize_flow_events(events, latest_price=150.96)
    assert summary["change_to_positive_reference_pct"] == 51.02
    assert summary["change_to_negative_reference_pct"] == round((182.4256 / 150.96 - 1) * 100, 2)
    assert summary["pressure_balance_pct"] == 33.33
    assert summary["mean_volume_z"] == 2.85


def test_invalid_and_constant_bars_never_generate_nonfinite_scores():
    frame = bars()
    frame["Volume"] = 100
    frame.iloc[-1, frame.columns.get_loc("Close")] = float("inf")
    result = flow.build_price_volume_signal("TEST", frame)
    assert result["status"] == "insufficient_data"
    assert result["mean_volume_z"] is None
    assert result["event_count"] == 0
    assert result["latest_bar_date"] == "2026-11-18"


def test_empty_source_retains_calendar_buckets_without_claiming_observations():
    result = flow.build_price_volume_signal("TEST", pd.DataFrame(), end=date(2026, 11, 19))
    assert result["latest_price"] is None
    assert result["status"] == "insufficient_data"
    assert all(week["observed_bars"] == 0 for week in result["flow_timeline"])


def test_overview_has_explicit_utc_common_dates_and_basket_provenance(monkeypatch):
    frame = bars(600)
    monkeypatch.setattr(flow, "_download_universe", lambda *args: frame)
    payload = flow.build_institutional_flow_overview(["NVDA"], lookback_days=365)
    assert payload["as_of"].endswith("+00:00")
    assert payload["method"]["name"] == "daily_price_volume_v2"
    assert payload["method"]["thresholds"]["lookback_calendar_days"] == 365
    bounds = {(row["window_start"], row["window_end"]) for rows in payload["groups"].values() for row in rows}
    assert len(bounds) == 1
    assert payload["stock_selection"]["candidate_count"] == 1
    assert payload["method"]["direct_institutional_tape"] is False
