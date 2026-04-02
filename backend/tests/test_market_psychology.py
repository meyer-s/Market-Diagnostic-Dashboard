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
    assert mp._resolve_weather_granularity(180, "auto") == "day"
    assert mp._resolve_weather_granularity(365 * 3, "auto") == "week"
    assert mp._resolve_weather_granularity(365 * 10, "auto") == "month"


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
