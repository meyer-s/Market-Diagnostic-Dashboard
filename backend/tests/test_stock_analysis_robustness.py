from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import sleep
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.api import stock_projection as stock
from app.services.market_data import yahoo_provider as yahoo
from app.services.narrative_analysis import _market_confirmation


def frame(count=650):
    close = np.linspace(50, 150, count) + np.sin(np.arange(count) / 8)
    return pd.DataFrame({"Open": close, "High": close + 2, "Low": close - 2, "Close": close, "Volume": 100}, index=pd.bdate_range(end="2026-11-18", periods=count))


def test_daily_indicators_do_not_change_when_display_window_changes():
    source = frame()
    long = stock.calculate_technical_indicators(source, 252)
    short = stock.calculate_technical_indicators(source, 63)
    for key in ["sma_50", "sma_200"]:
        assert short[key] == pytest.approx(long[key])
    assert short["rsi"]["current"] == long["rsi"]["current"]
    assert short["macd"]["current"] == long["macd"]["current"]
    assert len(short["rsi"]["series"]) == len(short["candles"]) == 63
    assert short["candles"][-1]["ema50"] == short["sma_50"]
    assert short["candles"][-1]["ema200"] == short["sma_200"]


def test_wilder_rsi_reference_sequence_and_seed():
    closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00]
    current, values = stock.calculate_rsi(pd.DataFrame({"Close": closes}))
    assert values.iloc[:14].isna().all()
    assert values.iloc[14] == pytest.approx(70.464135, abs=0.000001)
    assert current == pytest.approx(66.249619, abs=0.000001)


@pytest.mark.parametrize("closes,expected", [([100] * 30, 50), (list(range(1, 31)), 100), (list(range(30, 0, -1)), 0)])
def test_rsi_flat_and_one_direction_series_are_finite(closes, expected):
    current, _ = stock.calculate_rsi(pd.DataFrame({"Close": closes}))
    assert current == expected


def test_yahoo_strike_discovery_and_filtered_chains_share_one_snapshot(monkeypatch):
    calls = []
    original = pd.DataFrame({"strike": [95.0, 100.0, 105.0], "bid": [1.0, 2.0, 3.0]})
    def fetch(expiry):
        calls.append(expiry)
        return SimpleNamespace(calls=original.copy(), puts=original.copy())
    monkeypatch.setattr(yahoo.yf, "Ticker", lambda symbol: SimpleNamespace(option_chain=fetch, options=["2026-12-18"]))
    provider = yahoo.YahooProvider()
    assert provider.option_strikes("TGT", "2026-12-18") == [95, 100, 105]
    one = provider.option_chain("TGT", "2026-12-18", strikes=[100])
    one.calls.loc[:, "bid"] = 999
    two = provider.option_chain("TGT", "2026-12-18", strikes=[100, 105])
    assert calls == ["2026-12-18"]
    assert len(two.calls) == 2
    assert two.calls.iloc[0]["bid"] == 2
    assert one.retrieved_at == two.retrieved_at
    assert two.observed_at is None


def test_yahoo_options_cache_expiry_and_concurrent_requests(monkeypatch):
    now = [100.0]
    calls = []
    def fetch(expiry):
        calls.append(expiry)
        sleep(0.02)
        return SimpleNamespace(calls=pd.DataFrame({"strike": [100]}), puts=pd.DataFrame())
    monkeypatch.setattr(yahoo, "monotonic", lambda: now[0])
    monkeypatch.setattr(yahoo.yf, "Ticker", lambda symbol: SimpleNamespace(option_chain=fetch))
    provider = yahoo.YahooProvider()
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: provider.option_strikes("TGT", "2026-12-18"), range(6)))
    assert len(calls) == 1
    now[0] += 121
    provider.option_strikes("TGT", "2026-12-18")
    assert len(calls) == 2
    assert provider._options_pending == {}


def test_analysis_cache_keeps_original_database_age_and_returns_isolated_copy(monkeypatch):
    cached_at = datetime.utcnow() - timedelta(seconds=299)
    row = SimpleNamespace(cached_at=cached_at, payload={"nested": {"value": 1}})
    query = SimpleNamespace(filter=lambda *args: query, first=lambda: row)
    @contextmanager
    def session():
        yield SimpleNamespace(query=lambda *args: query)
    monkeypatch.setattr(stock, "get_db_session", session)
    monkeypatch.setattr(stock, "_stock_projection_cache", {})
    monkeypatch.setattr(stock, "_cache_matches_accuracy_contract", lambda payload: True)
    monkeypatch.setattr(stock, "_cache_matches_market_data_provider", lambda payload: True)
    first = stock._get_stock_projection_cache("TGT")
    first["nested"]["value"] = 99
    second = stock._get_stock_projection_cache("TGT")
    assert second["nested"]["value"] == 1
    assert stock._stock_projection_cache["TGT"]["cached_at"] == cached_at.replace(tzinfo=timezone.utc).timestamp()


def test_analysis_cache_is_bounded_even_when_persistence_is_unavailable(monkeypatch):
    @contextmanager
    def unavailable():
        raise RuntimeError("isolated test persistence unavailable")
        yield
    monkeypatch.setattr(stock, "get_db_session", unavailable)
    monkeypatch.setattr(stock, "_stock_projection_cache", {})
    for index in range(150):
        stock._set_stock_projection_cache(f"T{index}", {"value": index})
    assert len(stock._stock_projection_cache) == 128
    assert "T149" in stock._stock_projection_cache
    assert "T0" not in stock._stock_projection_cache


def test_same_symbol_requests_do_not_run_duplicate_cold_calculations(monkeypatch):
    state = {"active": 0, "peak": 0}
    guard = Lock()
    def calculate(ticker, window):
        with guard:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        sleep(0.02)
        with guard:
            state["active"] -= 1
        return ticker
    monkeypatch.setattr(stock, "_get_stock_projections", calculate)
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(lambda _: stock.get_stock_projections("TGT", "252d"), range(4))) == ["TGT"] * 4
    assert state["peak"] == 1


def test_narrative_benchmark_identity_matches_the_supplied_series():
    data = frame()
    result = _market_confirmation(data, data, None, benchmark_symbol="SPY")
    assert result["benchmark"] == "SPY"
    assert "SPY" in result["metrics"][0]["label"]


def test_invalid_symbol_does_not_trigger_upstream_work(monkeypatch):
    monkeypatch.setattr(stock, "_get_stock_projections", lambda *args: pytest.fail("Invalid symbol reached provider"))
    with pytest.raises(stock.HTTPException) as error:
        stock.get_stock_projections("TGT / invalid", "252d")
    assert error.value.status_code == 400


@pytest.mark.parametrize("invalid", [0, -1, float("inf"), float("nan")])
def test_invalid_closes_cannot_turn_into_high_model_scores(invalid):
    data = frame()
    data.iloc[-1, data.columns.get_loc("Close")] = invalid
    with pytest.raises(ValueError, match="positive finite prices"):
        stock.compute_stock_projection("TEST", data, frame(), 21, "YELLOW")


def test_failed_primary_options_requests_cool_down_and_can_recover(monkeypatch):
    from app.services.market_data import factory
    from tests.fake_market_data import FakeProvider
    now = [100.0]
    attempts = []
    def fail(symbol):
        attempts.append(symbol)
        raise TimeoutError("Primary options connection timed out")
    monkeypatch.setattr(factory.time, "monotonic", lambda: now[0])
    monkeypatch.setenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60")
    primary = SimpleNamespace(name="ibkr", option_expirations=fail)
    provider = factory.FallbackMarketDataProvider(primary, FakeProvider())
    first = stock.compute_options_flow(provider, "TEST", 100)
    second = stock.compute_options_flow(provider, "TEST", 100)
    assert first is not None and second is not None
    assert first["primary_data_source"] == second["primary_data_source"] == "ibkr_option_chain"
    assert second["fallback_reason"] == "Primary options connection timed out"
    assert attempts == ["TEST"]
    now[0] += 61
    stock.compute_options_flow(provider, "TEST", 100)
    assert attempts == ["TEST", "TEST"]


def test_live_option_quotes_are_not_priced_against_a_previous_session_close():
    raw = {"mispricing_usable": True, "observed_at": "2026-11-19T15:00:00Z", "component_usable": {"mispricing": True, "avg_edr": True}, "quality_status": "good"}
    result = stock._apply_underlying_basis_quality(raw, price=165.93, price_metadata={"observed_at": "2026-11-18T00:00:00Z", "stale": False})
    assert result["underlying_basis_usable"] is False
    assert result["mispricing_usable"] is False
    assert result["component_usable"]["avg_edr"] is False
    assert "underlying_quote_session_mismatch" in result["quality_reasons"]
    assert raw["mispricing_usable"] is True


def test_daily_close_label_is_compared_as_a_session_date_not_new_york_midnight():
    result = stock._apply_underlying_basis_quality({"mispricing_usable": True, "observed_at": "2026-11-18T20:59:00Z"}, price=165.93, price_metadata={"observed_at": "2026-11-18T00:00:00Z", "stale": False})
    assert result["underlying_basis_usable"] is True
    assert result["mispricing_usable"] is True
