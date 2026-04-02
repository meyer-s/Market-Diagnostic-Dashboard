from datetime import date

from app.services import market_psychology as mp


def test_filter_candidates_blocks_proxies_when_disabled():
    candidates = [
        ("PRIMARY", "Primary Series", False),
        ("FALLBACK", "Fallback Series", True),
    ]

    filtered = mp._filter_candidates(candidates, allow_proxies=False)

    assert filtered == [("PRIMARY", "Primary Series", False)]


def test_filter_candidates_keeps_all_when_enabled():
    candidates = [
        ("PRIMARY", "Primary Series", False),
        ("FALLBACK", "Fallback Series", True),
    ]

    filtered = mp._filter_candidates(candidates, allow_proxies=True)

    assert filtered == candidates


def test_cache_entry_expires(monkeypatch):
    mp._clear_cache()

    now = 1_000.0
    monkeypatch.setattr(mp.time, "time", lambda: now)
    mp._cache_set("k", {"v": 1}, ttl_seconds=10)

    assert mp._cache_get("k") == {"v": 1}

    monkeypatch.setattr(mp.time, "time", lambda: now + 11)
    assert mp._cache_get("k") is None


def test_resolve_weather_granularity_auto_thresholds():
    assert mp._resolve_weather_granularity(30, "auto") == "day"
    assert mp._resolve_weather_granularity(180, "auto") == "week"
    assert mp._resolve_weather_granularity(365, "auto") == "week"
    assert mp._resolve_weather_granularity(365 * 3, "auto") == "month"


def test_percentile_rank_is_bounded_and_ordered():
    values = [10.0, 20.0, 30.0, 40.0]

    assert mp._percentile_rank(values, 10.0) == 0.0
    assert mp._percentile_rank(values, 30.0) > mp._percentile_rank(values, 20.0)
    assert mp._percentile_rank(values, 40.0) == 100.0


def test_aggregate_weather_history_monthly_compacts_points():
    history = [
        {
            "date": "2024-01-02",
            "sp500_return_pct": 1.0,
            "sp500_abs_return_pct": 1.0,
            "pressure_hpa": 1000.0,
            "pressure_change_hpa": 3.0,
            "temp_anomaly_c": 2.0,
            "precip_mm": 1.0,
            "wind_kmh": 10.0,
            "pressure_shift_score": 0.5,
            "precipitation_stress_score": 0.1,
            "wind_stress_score": 0.2,
            "temperature_stress_score": 0.3,
            "weather_stress_score": 0.1,
            "weather_disruption_index": 0.1,
            "rolling_corr": 0.2,
            "rolling_p_value": 0.04,
            "rolling_significant": True,
            "signal_correlations": {
                "weather_stress_score": {"rolling_corr": 0.2, "rolling_p_value": 0.04, "rolling_significant": True},
                "pressure_hpa": {"rolling_corr": -0.1, "rolling_p_value": 0.2, "rolling_significant": False},
            },
        },
        {
            "date": "2024-01-15",
            "sp500_return_pct": -1.0,
            "sp500_abs_return_pct": 1.0,
            "pressure_hpa": 1010.0,
            "pressure_change_hpa": 5.0,
            "temp_anomaly_c": 4.0,
            "precip_mm": 2.0,
            "wind_kmh": 20.0,
            "pressure_shift_score": 0.7,
            "precipitation_stress_score": 0.2,
            "wind_stress_score": 0.3,
            "temperature_stress_score": 0.4,
            "weather_stress_score": 0.3,
            "weather_disruption_index": 0.3,
            "rolling_corr": 0.4,
            "rolling_p_value": 0.03,
            "rolling_significant": True,
            "signal_correlations": {
                "weather_stress_score": {"rolling_corr": 0.4, "rolling_p_value": 0.03, "rolling_significant": True},
                "pressure_hpa": {"rolling_corr": -0.25, "rolling_p_value": 0.04, "rolling_significant": True},
            },
        },
        {
            "date": "2024-02-01",
            "sp500_return_pct": 0.5,
            "sp500_abs_return_pct": 0.5,
            "pressure_hpa": 1020.0,
            "pressure_change_hpa": 2.0,
            "temp_anomaly_c": 3.0,
            "precip_mm": 0.5,
            "wind_kmh": 5.0,
            "pressure_shift_score": 0.3,
            "precipitation_stress_score": 0.1,
            "wind_stress_score": 0.1,
            "temperature_stress_score": 0.2,
            "weather_stress_score": 0.2,
            "weather_disruption_index": 0.2,
            "rolling_corr": 0.1,
            "rolling_p_value": 0.2,
            "rolling_significant": False,
            "signal_correlations": {
                "weather_stress_score": {"rolling_corr": 0.1, "rolling_p_value": 0.2, "rolling_significant": False},
                "pressure_hpa": {"rolling_corr": -0.05, "rolling_p_value": 0.7, "rolling_significant": False},
            },
        },
    ]

    aggregated = mp._aggregate_weather_history(history, "month")

    assert len(aggregated) == 2
    assert aggregated[0]["date"] == "2024-01-15"
    assert aggregated[0]["period_label"] == "2024-01"
    assert aggregated[0]["precip_mm"] == 3.0
    assert aggregated[0]["wind_kmh"] == 20.0
    assert aggregated[0]["pressure_change_hpa"] == 4.0
    assert aggregated[0]["pressure_shift_score"] == 0.6
    assert aggregated[0]["weather_stress_score"] == 0.2
    assert aggregated[0]["rolling_corr"] == 0.4
    assert aggregated[0]["signal_correlations"]["pressure_hpa"]["rolling_corr"] == -0.25


def test_pearson_summary_optional_ignores_missing_points():
    summary = mp._pearson_summary_optional([1.0, None, 3.0, 4.0], [1.0, 2.0, 3.0, 4.0], min_samples=3)

    assert summary["pearson_r"] == 1.0
    assert summary["samples"] == 3


def test_pearson_summary_rejects_non_finite_results():
    summary = mp._pearson_summary([1.0, 1.0, 1.0, 1.0, 1.0], [1.0, 2.0, 3.0, 4.0, 5.0], min_samples=3)

    assert summary["pearson_r"] is None
    assert summary["p_value"] is None
    assert summary["significant"] is False


def test_rolling_correlation_allows_small_valid_windows():
    points = mp._rolling_correlation(
        ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
        [1.0, 2.0, 3.0, 4.0, 5.0],
        [2.0, 4.0, 6.0, 8.0, 10.0],
        window=5,
    )

    assert points[-1]["rolling_corr"] == 1.0
    assert points[-1]["significant"] is True


def test_resolve_weather_analysis_window_for_calendar_year():
    analysis_start, analysis_end, fetch_start = mp._resolve_weather_analysis_window(
        days=365,
        window=10,
        calendar_year=2024,
        today=date(2026, 4, 2),
    )

    assert analysis_start == date(2024, 1, 1)
    assert analysis_end == date(2024, 12, 31)
    assert fetch_start == date(2023, 9, 3)


def test_resolve_weather_analysis_window_for_explicit_dates():
    analysis_start, analysis_end, fetch_start = mp._resolve_weather_analysis_window(
        days=365,
        window=5,
        calendar_year=None,
        start_date="2024-03-01",
        end_date="2024-05-15",
        today=date(2026, 4, 2),
    )

    assert analysis_start == date(2024, 3, 1)
    assert analysis_end == date(2024, 5, 15)
    assert fetch_start == date(2023, 11, 2)
