from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import market_weather as market_weather_api
from app.services import market_weather_comparison as comparison_service
from app.services.market_weather import build_market_weather
from app.services.market_weather_analysis_cache import reset_market_weather_analysis_cache
from app.services.market_weather_comparison import (
    PairLeg,
    _relative_price_series,
    build_market_weather_comparison,
    canonical_pair_symbol,
    validate_pair_alignment,
)
from app.services.market_weather_history_cache import (
    MarketWeatherHistoryCacheMetadata,
    MarketWeatherHistoryResult,
)


def _history(
    count: int = 180,
    *,
    start: str = "2025-01-02",
    drift: float = 0.12,
    phase_shift: float = 0.0,
    index: pd.DatetimeIndex | None = None,
) -> pd.DataFrame:
    if index is None:
        index = pd.date_range(start, periods=count, freq="B")
    phase = np.linspace(0.0, 16.0, count) + phase_shift
    close = (
        100.0
        + np.arange(count) * drift
        + 2.8 * np.sin(phase)
        + 0.65 * np.sin(phase * 2.7)
    )
    return pd.DataFrame(
        {
            "Open": close - 0.25,
            "High": close + 0.8,
            "Low": close - 0.75,
            "Close": close,
            "Volume": 1_000_000 + np.arange(count) * 1_000,
        },
        index=index,
    )


def _micro_history(count: int = 180, *, drift: float = 0.001) -> pd.DataFrame:
    index = pd.date_range("2025-01-02", periods=count, freq="B")
    close = 0.00001 * (1.0 + np.arange(count) * drift)
    return pd.DataFrame(
        {
            "Open": close * 0.995,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": 10_000_000 + np.arange(count) * 10_000,
        },
        index=index,
    )


def _leg(symbol: str, frame: pd.DataFrame) -> PairLeg:
    return PairLeg(
        symbol=canonical_pair_symbol(symbol),
        analysis=build_market_weather(frame, horizons=[4, 6, 8, 10]),
        data_source="test",
        history_cache={},
    )


def _history_result(
    frame: pd.DataFrame,
    *,
    symbol: str,
    timeframe: str,
) -> MarketWeatherHistoryResult:
    return MarketWeatherHistoryResult(
        frame=frame,
        metadata=MarketWeatherHistoryCacheMetadata(
            status="refreshed",
            symbol=symbol,
            timeframe=timeframe,
            storage_interval=timeframe.lower(),
            requested_rows=len(frame),
            minimum_rows=60,
            returned_rows=len(frame),
            cached_rows_before=0,
            fetched_rows=len(frame),
            inserted_rows=len(frame),
            provider_called=True,
            stale=False,
            refresh_reason="test",
            ttl_seconds=60,
            age_seconds=0.0,
            last_updated_at=None,
            data_source="test",
        ),
    )


@pytest.fixture(autouse=True)
def _clear_pair_cache() -> None:
    reset_market_weather_analysis_cache()
    yield
    reset_market_weather_analysis_cache()


def test_identity_pair_is_explicit_zero_control() -> None:
    target = _leg("SPY", _history())
    result = build_market_weather_comparison(
        target=target,
        benchmark=replace(target, symbol=canonical_pair_symbol("SPY")),
        timeframe="1D",
        visible_bars=120,
    )

    assert len(result["coordinates"]) == 15
    assert result["provenance"]["identity_control"] is True
    assert result["overlap"]["alignment_status"] == "identity_control"
    assert result["overlap"]["target_dropped"] == 0
    assert result["overlap"]["benchmark_dropped"] == 0
    assert result["overlap"]["support_fraction"] == 1.0
    assert all(point["relative_index"] == 100.0 for point in result["price_series"])
    volatility = next(
        coordinate
        for coordinate in result["coordinates"]
        if coordinate["id"] == "volatility_carrier"
    )
    assert volatility["latest"]["pair_supported"] is True
    for coordinate in result["coordinates"]:
        assert all(
            point["native_difference"] in {None, 0.0}
            and point["context_difference"] in {None, 0.0}
            for point in coordinate["series"]
        )


def test_swapping_pair_reverses_supported_field_differences_and_receipt() -> None:
    target = _leg("NVDA", _history(drift=0.18))
    benchmark = _leg("QQQ", _history(drift=0.08, phase_shift=0.6))
    forward = build_market_weather_comparison(
        target=target,
        benchmark=benchmark,
        timeframe="1D",
        visible_bars=120,
    )
    reverse = build_market_weather_comparison(
        target=benchmark,
        benchmark=target,
        timeframe="1D",
        visible_bars=120,
    )

    assert forward["comparison_hash"] != reverse["comparison_hash"]
    reverse_by_id = {row["id"]: row for row in reverse["coordinates"]}
    for coordinate in forward["coordinates"]:
        opposite = reverse_by_id[coordinate["id"]]
        for point, reverse_point in zip(
            coordinate["series"],
            opposite["series"],
            strict=True,
        ):
            if point["native_difference"] is not None:
                assert reverse_point["native_difference"] == pytest.approx(
                    -point["native_difference"],
                    abs=1e-6,
                )
            if point["context_difference"] is not None:
                assert reverse_point["context_difference"] == pytest.approx(
                    -point["context_difference"],
                    abs=1e-6,
                )


def test_pair_requires_the_same_field_recipe() -> None:
    frame = _history()
    target = _leg("SPY", frame)
    benchmark = PairLeg(
        symbol=canonical_pair_symbol("QQQ"),
        analysis=build_market_weather(frame, horizons=[4, 8, 12]),
        data_source="test",
        history_cache={},
    )

    with pytest.raises(ValueError, match="recipe_mismatch"):
        build_market_weather_comparison(
            target=target,
            benchmark=benchmark,
            timeframe="1D",
            visible_bars=120,
        )


def test_context_is_withheld_before_both_evaluation_segments_and_support_is_not_zero_filled() -> None:
    target = _leg("NVDA", _history(drift=0.18))
    benchmark = _leg("QQQ", _history(drift=0.08, phase_shift=0.6))
    result = build_market_weather_comparison(
        target=target,
        benchmark=benchmark,
        timeframe="1D",
        visible_bars=180,
    )
    target_evaluation = target.analysis["research"]["lexicon"]["training_split"]["evaluation_start"]
    benchmark_evaluation = benchmark.analysis["research"]["lexicon"]["training_split"]["evaluation_start"]
    first_context_date = max(
        pd.Timestamp(target_evaluation).date().isoformat(),
        pd.Timestamp(benchmark_evaluation).date().isoformat(),
    )

    assert any(
        point["native_difference"] is None
        and point["pair_supported"] is False
        for coordinate in result["coordinates"]
        for point in coordinate["series"][:12]
    )
    for coordinate in result["coordinates"]:
        assert all(
            point["context_difference"] is None
            for point in coordinate["series"]
            if point["date"] < first_context_date
        )
        assert all(
            point["context_difference"] is None
            or point["pair_supported"] is True
            for point in coordinate["series"]
        )


def test_daily_alignment_uses_date_but_intraday_requires_exact_timestamp() -> None:
    dates = pd.date_range("2025-01-02", periods=180, freq="B")
    target = _leg("SPY", _history(index=dates + pd.Timedelta(hours=16)))
    benchmark = _leg("DXY", _history(index=dates + pd.Timedelta(hours=23)))
    daily = build_market_weather_comparison(
        target=target,
        benchmark=benchmark,
        timeframe="1D",
        visible_bars=100,
    )
    assert daily["overlap"]["common_observations"] == 100
    assert daily["overlap"]["alignment_rule"] == "serialized_session_date"

    with pytest.raises(ValueError, match="insufficient_shared_history"):
        build_market_weather_comparison(
            target=target,
            benchmark=benchmark,
            timeframe="15m",
            visible_bars=100,
        )


def test_intraday_receipt_exposes_unmatched_latest_tails_and_returns_utc_dates() -> None:
    shared = pd.date_range("2026-07-20 13:30", periods=180, freq="15min", tz="UTC")
    benchmark_index = shared[:178].append(
        pd.DatetimeIndex(
            [
                shared[178] + pd.Timedelta(minutes=1),
                shared[179] + pd.Timedelta(minutes=1),
            ]
        )
    )
    target = _leg("SPY", _history(index=shared))
    benchmark = _leg("QQQ", _history(index=benchmark_index, phase_shift=0.4))

    result = build_market_weather_comparison(
        target=target,
        benchmark=benchmark,
        timeframe="15m",
        visible_bars=100,
    )

    assert result["overlap"]["target_dropped"] == 2
    assert result["overlap"]["benchmark_dropped"] == 2
    assert result["overlap"]["target_unmatched_after_latest_aligned"] == 2
    assert result["overlap"]["benchmark_unmatched_after_latest_aligned"] == 2
    assert result["overlap"]["target_latest_returned_at"].endswith("+00:00")
    assert result["overlap"]["benchmark_latest_returned_at"].endswith("+00:00")
    assert all(point["date"].endswith("+00:00") for point in result["price_series"])
    assert result["target"]["latest_aligned_close"] != result["target"]["latest_returned_close"]
    assert result["benchmark"]["latest_aligned_close"] != result["benchmark"]["latest_returned_close"]


def test_naive_intraday_rows_keep_exact_serialized_timestamps_without_claiming_utc() -> None:
    index = pd.date_range("2026-07-20 09:30", periods=180, freq="15min")
    result = build_market_weather_comparison(
        target=_leg("SPY", _history(index=index)),
        benchmark=_leg("QQQ", _history(index=index, phase_shift=0.4)),
        timeframe="15m",
        visible_bars=100,
    )

    assert (
        result["overlap"]["alignment_rule"]
        == "exact_serialized_timestamp_timezone_unavailable"
    )
    assert result["overlap"]["session_compatibility"] == "unknown"
    assert all(
        not point["date"].endswith("+00:00")
        for point in result["price_series"]
    )


def test_dxy_alias_is_canonical_and_incompatible_hourly_anchors_are_rejected() -> None:
    symbol = canonical_pair_symbol("^DXY")
    assert symbol.canonical_symbol == "DXY"
    assert symbol.provider_symbol == "DX-Y.NYB"
    assert symbol.provider_override == "yahoo"

    with pytest.raises(ValueError, match="alignment_unsupported"):
        validate_pair_alignment(
            canonical_pair_symbol("SPY"),
            symbol,
            "1h",
        )


def test_dxy_identity_control_remains_available_at_hourly_anchors() -> None:
    dxy = canonical_pair_symbol("DXY")
    validate_pair_alignment(dxy, canonical_pair_symbol("^DXY"), "2h")


def test_prior_return_beta_does_not_change_when_future_prices_change() -> None:
    count = 100
    keys = [
        (
            pd.Timestamp("2025-01-02", tz="UTC")
            + pd.Timedelta(days=index)
        ).isoformat()
        for index in range(count)
    ]
    target_close = 100.0 * np.exp(np.cumsum(np.sin(np.arange(count) / 8) * 0.004 + 0.001))
    benchmark_close = 100.0 * np.exp(np.cumsum(np.sin(np.arange(count) / 8) * 0.002 + 0.0004))

    def rows(values: np.ndarray) -> dict[str, dict[str, object]]:
        return {
            key: {"date": key, "close": float(value)}
            for key, value in zip(keys, values, strict=True)
        }

    baseline, _summary = _relative_price_series(
        common_keys=keys,
        target_rows=rows(target_close),
        benchmark_rows=rows(benchmark_close),
        timeframe="15m",
    )
    changed_target = target_close.copy()
    changed_target[75:] *= np.linspace(1.0, 1.35, count - 75)
    changed, _changed_summary = _relative_price_series(
        common_keys=keys,
        target_rows=rows(changed_target),
        benchmark_rows=rows(benchmark_close),
        timeframe="15m",
    )

    assert [
        row["prior_return_beta"] for row in baseline[:75]
    ] == [
        row["prior_return_beta"] for row in changed[:75]
    ]
    assert [
        row["beta_adjusted_cumulative_return"] for row in baseline[:75]
    ] == [
        row["beta_adjusted_cumulative_return"] for row in changed[:75]
    ]


def test_current_beta_summary_never_carries_a_stale_estimate() -> None:
    count = 120
    keys = [
        (
            pd.Timestamp("2025-01-02", tz="UTC")
            + pd.Timedelta(days=index)
        ).isoformat()
        for index in range(count)
    ]
    target = 100.0 * np.exp(np.cumsum(np.sin(np.arange(count) / 7) * 0.003 + 0.001))
    benchmark_returns = np.sin(np.arange(count) / 7) * 0.002 + 0.0004
    benchmark_returns[-70:] = 0.0
    benchmark = 100.0 * np.exp(np.cumsum(benchmark_returns))

    def rows(values: np.ndarray) -> dict[str, dict[str, object]]:
        return {
            key: {"date": key, "close": float(value)}
            for key, value in zip(keys, values, strict=True)
        }

    series, summary = _relative_price_series(
        common_keys=keys,
        target_rows=rows(target),
        benchmark_rows=rows(benchmark),
        timeframe="15m",
    )

    assert any(row["prior_return_beta"] is not None for row in series)
    assert series[-1]["prior_return_beta"] is None
    assert series[-1]["beta_adjusted_cumulative_return"] is None
    assert summary["latest_beta"] is None
    assert summary["cumulative_residual_pct"] is None
    assert summary["status"] == "unavailable"


def test_pair_leg_requests_enough_rows_for_the_largest_horizon(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[int] = []
    frame = _history(220)

    def direct_history(
        _provider: object,
        symbol: str,
        timeframe: str,
        bars: int,
        *,
        minimum_rows: int,
    ) -> MarketWeatherHistoryResult:
        captured.append(minimum_rows)
        return _history_result(frame.tail(bars), symbol=symbol, timeframe=timeframe)

    monkeypatch.setattr(
        comparison_service,
        "get_or_refresh_market_weather_history",
        direct_history,
    )
    comparison_service.build_pair_leg(
        provider=object(),
        symbol=canonical_pair_symbol("SPY"),
        timeframe="1D",
        requested_bars=220,
        horizons=[8, 160],
        settings=comparison_service.MarketWeatherSettings(),
    )

    assert captured == [161]


def test_pair_leg_preserves_full_precision_for_low_priced_instruments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    histories = {
        "MICROA": _micro_history(drift=0.0015),
        "MICROB": _micro_history(drift=0.0008),
    }

    def direct_history(
        _provider: object,
        symbol: str,
        timeframe: str,
        bars: int,
        *,
        minimum_rows: int,
    ) -> MarketWeatherHistoryResult:
        return _history_result(
            histories[symbol].tail(bars),
            symbol=symbol,
            timeframe=timeframe,
        )

    monkeypatch.setattr(
        comparison_service,
        "get_or_refresh_market_weather_history",
        direct_history,
    )
    settings = comparison_service.MarketWeatherSettings()
    target = comparison_service.build_pair_leg(
        provider=object(),
        symbol=canonical_pair_symbol("MICROA"),
        timeframe="1D",
        requested_bars=180,
        horizons=[4, 6, 8, 10],
        settings=settings,
    )
    benchmark = comparison_service.build_pair_leg(
        provider=object(),
        symbol=canonical_pair_symbol("MICROB"),
        timeframe="1D",
        requested_bars=180,
        horizons=[4, 6, 8, 10],
        settings=settings,
    )

    assert target.analysis["price"][-1]["close"] == 0.0
    result = build_market_weather_comparison(
        target=target,
        benchmark=benchmark,
        timeframe="1D",
        visible_bars=120,
    )
    assert result["target"]["latest_aligned_close"] > 0
    assert result["benchmark"]["latest_aligned_close"] > 0
    assert result["price_series"][-1]["relative_index"] > 100


def test_pair_endpoint_uses_one_fetch_for_identity_and_reuses_analysis_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, int]] = []
    frame = _history(260)

    class Provider:
        name = "pair-test"

    provider = Provider()

    def direct_history(
        _provider: object,
        symbol: str,
        timeframe: str,
        bars: int,
        *,
        minimum_rows: int,
    ) -> MarketWeatherHistoryResult:
        calls.append((symbol, timeframe, bars))
        assert minimum_rows == 60
        return _history_result(
            frame.tail(bars),
            symbol=symbol,
            timeframe=timeframe,
        )

    monkeypatch.setattr(
        market_weather_api,
        "get_market_data_provider",
        lambda _override=None: provider,
    )
    monkeypatch.setattr(
        comparison_service,
        "get_or_refresh_market_weather_history",
        direct_history,
    )
    app = FastAPI()
    app.include_router(market_weather_api.router)
    client = TestClient(app)
    endpoint = (
        "/market-weather/compare?target_symbol=PAIRIDENTITY"
        "&benchmark_symbol=PAIRIDENTITY&timeframe=1D&bars=120"
        "&horizon_min=4&horizon_max=10&horizon_step=2"
    )

    first = client.get(endpoint)
    second = client.get(endpoint)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["provenance"]["identity_control"] is True
    assert first.headers["x-market-weather-comparison-cache"] == "miss"
    assert second.headers["x-market-weather-comparison-cache"] == "hit"
    assert calls == [("PAIRIDENTITY", "1D", 192)]


def test_pair_endpoint_routes_dxy_through_yahoo_and_preserves_alias_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    providers: list[str | None] = []
    calls: list[tuple[str, str]] = []

    class Provider:
        name = "pair-test"

    default_provider = Provider()
    yahoo_provider = Provider()

    def provider_factory(override: str | None = None) -> Provider:
        providers.append(override)
        return yahoo_provider if override == "yahoo" else default_provider

    def direct_history(
        provider: object,
        symbol: str,
        timeframe: str,
        bars: int,
        *,
        minimum_rows: int,
    ) -> MarketWeatherHistoryResult:
        calls.append(("yahoo" if provider is yahoo_provider else "default", symbol))
        return _history_result(
            _history(max(180, bars), drift=0.08 if symbol == "DX-Y.NYB" else 0.12).tail(bars),
            symbol=symbol,
            timeframe=timeframe,
        )

    monkeypatch.setattr(market_weather_api, "get_market_data_provider", provider_factory)
    monkeypatch.setattr(
        comparison_service,
        "get_or_refresh_market_weather_history",
        direct_history,
    )
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/compare?target_symbol=SPY&benchmark_symbol=DXY"
        "&timeframe=1D&bars=100&horizon_min=4&horizon_max=10&horizon_step=2"
    )
    alias_response = TestClient(app).get(
        "/market-weather/compare?target_symbol=SPY&benchmark_symbol=%5EDXY"
        "&timeframe=1D&bars=100&horizon_min=4&horizon_max=10&horizon_step=2"
    )

    assert response.status_code == 200
    assert alias_response.status_code == 200
    payload = response.json()
    alias_payload = alias_response.json()
    assert providers == [None, "yahoo", None, "yahoo"]
    assert ("default", "SPY") in calls
    assert ("yahoo", "DX-Y.NYB") in calls
    assert payload["benchmark"]["symbol"] == "DXY"
    assert payload["benchmark"]["provider_symbol"] == "DX-Y.NYB"
    assert payload["provenance"]["benchmark_provider_symbol"] == "DX-Y.NYB"
    assert payload["benchmark"]["requested_symbol"] == "DXY"
    assert alias_payload["benchmark"]["requested_symbol"] == "^DXY"
    assert alias_response.headers["x-market-weather-comparison-cache"] == "miss"


def test_pair_endpoint_rejects_unsupported_dxy_hourly_alignment_without_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        market_weather_api,
        "get_market_data_provider",
        lambda _override=None: pytest.fail("provider should not be initialized"),
    )
    app = FastAPI()
    app.include_router(market_weather_api.router)
    response = TestClient(app).get(
        "/market-weather/compare?target_symbol=SPY&benchmark_symbol=DXY"
        "&timeframe=1h&bars=100"
    )

    assert response.status_code == 422
    assert "alignment_unsupported" in response.json()["detail"]
