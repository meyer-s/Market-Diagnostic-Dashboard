from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from app.api.stock_projection import (
    HORIZONS,
    _analysis_input_fingerprint,
    _cache_matches_accuracy_contract,
    _cache_matches_analysis_inputs,
    _calendar_month_cutoff_frames,
    _build_price_history,
    _build_intraday_history,
    _compute_projection_targets,
    calculate_technical_indicators,
    _market_session_date,
    _price_on_or_before,
    _slice_price_history_window,
    _ttm_roe_snapshot,
    compute_fundamentals,
    compute_historical_volatility,
    compute_optionality_metrics,
    compute_options_flow,
    compute_stock_projection,
    get_stock_projections,
)
from app.api import stock_projection
from app.services.market_data.provider import OptionChainFrame
from tests.fake_market_data import FakeProvider


def _price_frame(
    *,
    periods: int = 260,
    raw_start: float = 100.0,
    raw_end: float = 100.0,
    adjusted_start: float = 90.0,
    adjusted_end: float = 110.0,
    start: str = "2025-01-02",
) -> pd.DataFrame:
    index = pd.date_range(start, periods=periods, freq="B")
    close = np.linspace(raw_start, raw_end, periods)
    adjusted = np.linspace(adjusted_start, adjusted_end, periods)
    return pd.DataFrame(
        {
            "Open": close,
            "High": close + 1,
            "Low": close - 1,
            "Close": close,
            "Adjusted Close": adjusted,
            "Volume": 1_000_000,
        },
        index=index,
    )


def test_market_session_date_uses_new_york_date_after_utc_midnight() -> None:
    assert _market_session_date(datetime(2026, 8, 4, 0, 30, tzinfo=timezone.utc)).isoformat() == "2026-08-03"
    assert _market_session_date(datetime(2026, 8, 4, 4, 30, tzinfo=timezone.utc)).isoformat() == "2026-08-04"
    assert _market_session_date(datetime(2026, 8, 4, 0, 30)).isoformat() == "2026-08-03"


def test_price_history_windows_distinguish_sessions_from_calendar_years() -> None:
    frame = _price_frame(periods=1_700, start="2019-01-02")
    frame.loc[frame.index[-1], "Close"] = np.nan

    sessions = _slice_price_history_window(frame, "252d")
    one_year = _slice_price_history_window(frame, "1y")
    five_year = _slice_price_history_window(frame, "5y")
    maximum = _slice_price_history_window(frame, "max")

    assert len(sessions) == 252
    assert len(_build_price_history(sessions, days=None)) == 252
    assert sessions.index.max() == frame.index[-2]
    assert one_year.index.min() >= one_year.index.max() - pd.DateOffset(years=1)
    assert five_year.index.min() >= five_year.index.max() - pd.DateOffset(years=5)
    assert 252 < len(one_year) < len(five_year) < len(maximum)
    assert len(maximum) == len(frame) - 1


def test_price_history_window_counts_unique_sessions_before_slicing() -> None:
    canonical = _price_frame(periods=300)
    legacy = canonical.copy()
    legacy.index = legacy.index + pd.Timedelta(hours=4)
    legacy[["Open", "High", "Low", "Close"]] *= 0.95
    # Both copies can carry valid adjusted values after a mixed-writer refresh;
    # canonical raw OHLC must still win over the later legacy timestamp.
    legacy["Adjusted Close"] = canonical["Adjusted Close"].to_numpy()
    doubled = pd.concat([canonical, legacy]).sort_index()

    sessions = _slice_price_history_window(doubled, "252d")
    history = _build_price_history(sessions, days=None)

    assert len(sessions) == 252
    assert sessions.index.is_unique
    assert sessions.index.normalize().nunique() == 252
    assert sessions.index[0] == canonical.index[-252]
    assert sessions.index[-1] == canonical.index[-1]
    assert len({point["date"] for point in history}) == 252
    assert sessions.iloc[-1]["Close"] == canonical.iloc[-1]["Close"]


def test_technical_indicators_are_invariant_to_legacy_session_duplicates() -> None:
    canonical = _price_frame(periods=300, raw_start=80.0, raw_end=120.0)
    legacy = canonical.copy()
    legacy.index = legacy.index + pd.Timedelta(hours=4)
    legacy[["Open", "High", "Low", "Close"]] *= 0.95
    legacy["Adjusted Close"] = np.nan
    doubled = pd.concat([canonical, legacy]).sort_index()

    expected = calculate_technical_indicators(canonical, 252)
    actual = calculate_technical_indicators(doubled, 252)

    assert actual["lookback_days"] == 252
    assert len(actual["candles"]) == 252
    assert len({candle["date"] for candle in actual["candles"]}) == 252
    assert actual["current_price"] == pytest.approx(expected["current_price"])
    assert actual["sma_50"] == pytest.approx(expected["sma_50"])
    assert actual["sma_200"] == pytest.approx(expected["sma_200"])
    assert actual["rsi"]["current"] == pytest.approx(expected["rsi"]["current"])


def test_projection_adjusted_basis_rejects_nonfinite_adjusted_values() -> None:
    stock = _price_frame()
    spy = _price_frame(
        raw_start=200.0,
        raw_end=200.0,
        adjusted_start=200.0,
        adjusted_end=200.0,
    )
    stock.loc[stock.index[-5], "Adjusted Close"] = float("inf")

    result = compute_stock_projection("TEST", stock, spy, 21, "YELLOW")

    assert result["return_basis"] == "raw_close_fallback"


def test_projection_uses_adjusted_total_return_but_raw_price_for_targets() -> None:
    stock = _price_frame()
    spy = _price_frame(raw_start=200.0, raw_end=200.0, adjusted_start=200.0, adjusted_end=200.0)

    result = compute_stock_projection("TEST", stock, spy, 21, "YELLOW")

    assert result["analysis_kind"] == "trailing_window"
    assert result["lookback_days"] == 21
    assert result["return_basis"] == "adjusted_close"
    assert result["trailing_return_pct"] > 0
    assert result["trailing_price_return_pct"] == 0.0
    assert result["raw_upper_reference"] == result["current_price"]
    assert result["stop_loss"] <= result["current_price"] <= result["raw_upper_reference"]


def test_all_upper_reference_fields_are_floored_at_current_price() -> None:
    result = _compute_projection_targets(
        current_price=100.0,
        raw_upper_reference=120.0,
        horizon_days=21,
        analyst_target=60.0,
        fundamentals={
            "snapshot": {
                "pe_ratio": {"value": 200.0},
                "market_cap": {"value": 1_000_000_000.0},
            }
        },
    )

    assert result["raw_upper_reference"] >= 100.0
    assert result["valuation_adjusted_target"] >= 100.0
    assert result["trade_target"] >= 100.0


def test_valuation_anchor_caps_trade_target_without_a_high_severity_flag() -> None:
    result = _compute_projection_targets(
        current_price=100.0,
        raw_upper_reference=150.0,
        horizon_days=21,
        analyst_target=130.0,
        fundamentals={"snapshot": {"market_cap": {"value": 1_000_000_000.0}}},
    )

    assert result["valuation_adjusted_target"] == pytest.approx(143.5)
    assert result["trade_target"] == result["valuation_adjusted_target"]
    assert result["trade_target"] < result["raw_upper_reference"]
    assert not any(flag["severity"] == "high" for flag in result["sanity_flags"])
    assert any(flag["type"] == "valuation_anchor_cap_applied" for flag in result["sanity_flags"])
    assert result["target_regime"] == "valuation_adjusted"
    assert result["speculative_extension"] == result["raw_upper_reference"]


def test_pe_only_constraint_caps_trade_target_without_a_high_severity_flag() -> None:
    result = _compute_projection_targets(
        current_price=100.0,
        raw_upper_reference=110.0,
        horizon_days=21,
        fundamentals={
            "snapshot": {
                "pe_ratio": {"value": 200.0},
                "market_cap": {"value": 1_000_000_000.0},
            }
        },
    )

    assert result["valuation_adjusted_target"] == 100.0
    assert result["trade_target"] == 100.0
    assert result["trade_target"] < result["raw_upper_reference"]
    assert not any(flag["severity"] == "high" for flag in result["sanity_flags"])
    assert any(flag["type"] == "implied_pe_outlier" for flag in result["sanity_flags"])
    assert any(flag["type"] == "valuation_anchor_cap_applied" for flag in result["sanity_flags"])
    assert result["target_regime"] == "valuation_adjusted"


def test_21_session_return_uses_22_shared_closes() -> None:
    index = pd.date_range("2026-01-02", periods=22, freq="B")
    prices = 100.0 * (1.01 ** np.arange(22))
    stock = pd.DataFrame(
        {
            "Open": prices,
            "High": prices + 1,
            "Low": prices - 1,
            "Close": prices,
            "Adjusted Close": prices,
            "Volume": 1_000_000,
        },
        index=index,
    )
    spy = stock.copy()
    spy[["Open", "High", "Low", "Close", "Adjusted Close"]] = 100.0

    result = compute_stock_projection("TEST", stock, spy, 21, "YELLOW")

    assert result["trailing_return_pct"] == pytest.approx((1.01 ** 21 - 1) * 100, abs=0.01)


def test_drawdown_includes_window_start_baseline() -> None:
    index = pd.date_range("2026-01-02", periods=22, freq="B")
    prices = 100.0 * (0.99 ** np.arange(22))
    stock = pd.DataFrame(
        {
            "Open": prices,
            "High": prices + 1,
            "Low": prices - 1,
            "Close": prices,
            "Adjusted Close": prices,
            "Volume": 1_000_000,
        },
        index=index,
    )
    spy = stock.copy()
    spy[["Open", "High", "Low", "Close", "Adjusted Close"]] = 100.0

    result = compute_stock_projection("TEST", stock, spy, 21, "YELLOW")

    expected = abs((0.99 ** 21 - 1) * 100)
    assert result["max_drawdown"] == pytest.approx(expected, abs=0.01)
    assert result["stop_loss"] <= result["current_price"] <= result["raw_upper_reference"]


def test_analysis_fails_closed_when_latest_benchmark_session_does_not_match() -> None:
    stock = _price_frame(periods=80, raw_start=100.0, raw_end=120.0)
    spy = _price_frame(periods=80, raw_start=200.0, raw_end=200.0)
    spy = spy.iloc[:-2]

    with pytest.raises(ValueError, match="latest observations do not match"):
        compute_stock_projection("TEST", stock, spy, 63, "YELLOW")


def test_relative_analysis_fails_closed_when_benchmark_lags_over_two_sessions() -> None:
    stock = _price_frame(periods=80)
    spy = _price_frame(periods=80).iloc[:-3]

    with pytest.raises(ValueError, match="latest observations do not match"):
        compute_stock_projection("TEST", stock, spy, 63, "YELLOW")


def test_projection_falls_back_both_series_to_raw_when_adjusted_coverage_is_partial() -> None:
    stock = _price_frame()
    spy = _price_frame(raw_start=200.0, raw_end=200.0, adjusted_start=200.0, adjusted_end=200.0)
    stock.loc[stock.index[-5], "Adjusted Close"] = np.nan

    result = compute_stock_projection("TEST", stock, spy, 21, "YELLOW")

    assert result["return_basis"] == "raw_close_fallback"
    assert result["trailing_return_pct"] == 0.0
    assert result["benchmark_trailing_return_pct"] == 0.0


def test_hv_uses_recent_adjusted_window_despite_old_history_gap_or_cached_returns() -> None:
    frame = _price_frame(periods=60, raw_start=100.0, raw_end=100.0)
    recent_adjusted = pd.Series(
        100.0 * np.cumprod(1.0 + np.linspace(-0.015, 0.02, 31)),
        index=frame.index[-31:],
    )
    frame["Adjusted Close"] = np.nan
    frame.loc[recent_adjusted.index, "Adjusted Close"] = recent_adjusted
    frame["returns"] = 0.5  # Full-history cache basis must not control HV30.

    result = compute_historical_volatility(frame, 30)
    expected = recent_adjusted.pct_change(fill_method=None).dropna().std() * np.sqrt(252) * 100

    assert result == pytest.approx(round(float(expected), 2))


def test_stock_and_benchmark_are_aligned_by_shared_trading_date() -> None:
    stock = _price_frame(periods=80)
    spy = _price_frame(periods=80)
    spy = spy.drop(spy.index[-10])

    result = compute_stock_projection("TEST", stock, spy, 63, "YELLOW")

    assert result["lookback_days"] == 63
    assert result["return_basis"] == "adjusted_close"


def test_historical_cutoff_uses_three_calendar_months_not_ninety_rows() -> None:
    index = pd.date_range("2025-01-01", "2026-08-03", freq="B")
    frame = pd.DataFrame({"Close": np.arange(len(index)) + 100.0}, index=index)

    stock, spy, cutoff, observed = _calendar_month_cutoff_frames(frame, frame, months=3)

    assert cutoff == "2026-05-03"
    assert observed.startswith("2026-05-01")
    assert stock.index.max() == pd.Timestamp("2026-05-01")
    assert spy.index.max() == pd.Timestamp("2026-05-01")


def test_historical_cutoff_trims_both_series_to_actual_shared_session() -> None:
    stock_index = pd.date_range("2025-01-01", "2026-08-03", freq="B")
    spy_index = stock_index.drop(pd.Timestamp("2026-05-01"))
    stock_frame = pd.DataFrame({"Close": np.arange(len(stock_index)) + 100.0}, index=stock_index)
    spy_frame = pd.DataFrame({"Close": np.arange(len(spy_index)) + 200.0}, index=spy_index)

    stock, spy, cutoff, observed = _calendar_month_cutoff_frames(stock_frame, spy_frame, months=3)

    assert cutoff == "2026-05-03"
    assert observed.startswith("2026-04-30")
    assert stock.index.max() == pd.Timestamp("2026-04-30")
    assert spy.index.max() == pd.Timestamp("2026-04-30")


def test_daily_session_dates_do_not_lose_exact_cutoff_or_fiscal_day_from_timezone() -> None:
    index = pd.DatetimeIndex(
        ["2026-05-04 00:00", "2026-08-04 00:00"],
        tz="America/New_York",
    )
    frame = pd.DataFrame({"Close": [100.0, 110.0]}, index=index)

    historical, _, cutoff, observed = _calendar_month_cutoff_frames(frame, frame, months=3)

    assert cutoff == "2026-05-04"
    assert len(historical) == 1
    assert observed.startswith("2026-05-04")
    assert _price_on_or_before(frame, pd.Timestamp("2026-05-04")) == 100.0


class _FundamentalStock:
    def __init__(self) -> None:
        dates = pd.to_datetime(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"])
        self._income = pd.DataFrame(
            {
                date: [10.0, 100.0, 1.0, 10.0]
                for date in dates
            },
            index=["Net Income", "Total Revenue", "Diluted EPS", "Diluted Average Shares"],
        )
        self._balance = pd.DataFrame(
            {
                date: [80.0 + index * 5.0, 10.0]
                for index, date in enumerate(dates)
            },
            index=["Total Stockholder Equity", "Ordinary Shares Number"],
        )
        self._cashflow = pd.DataFrame(
            {date: [10.0] for date in dates},
            index=["Free Cash Flow"],
        )
        self.info = {"sharesOutstanding": 10.0}
        self.fast_info = {"shares": 10.0}

    @property
    def quarterly_financials(self):
        return self._income

    @property
    def quarterly_balance_sheet(self):
        return self._balance

    @property
    def quarterly_cashflow(self):
        return self._cashflow

    @property
    def income_stmt(self):
        return pd.DataFrame()

    @property
    def balance_sheet(self):
        return pd.DataFrame()

    @property
    def cashflow(self):
        return pd.DataFrame()

    def get_income_stmt(self, freq="quarterly"):
        return self._income if freq == "quarterly" else pd.DataFrame()

    def get_balance_sheet(self, freq="quarterly"):
        return self._balance if freq == "quarterly" else pd.DataFrame()

    def get_cashflow(self, freq="quarterly"):
        return self._cashflow if freq == "quarterly" else pd.DataFrame()

    def get_shares_full(self, start=None):
        return None

    def get_earnings_dates(self, limit=12):
        # Deliberately incompatible announcement-date values: these must not be
        # merged into a statement-period EPS series.
        index = pd.to_datetime(["2025-05-01", "2025-08-01", "2025-11-01", "2026-02-01", "2026-05-01"])
        return pd.DataFrame({"Reported EPS": [99.0] * len(index)}, index=index)


def test_fundamental_snapshot_uses_unique_fiscal_periods_and_current_derived_values() -> None:
    price = _price_frame(periods=20, raw_start=100.0, raw_end=100.0, adjusted_start=100.0, adjusted_end=100.0, start="2026-03-10")

    result = compute_fundamentals(_FundamentalStock(), price)

    assert len(result["eps"]["series"]) == 5
    assert all(point["value"] == 1.0 for point in result["eps"]["series"])
    assert result["as_of"] == "2026-03-31"
    assert result["retrieved_at"].endswith("+00:00")
    assert result["snapshot"]["eps_ttm"]["value"] == 4.0
    assert result["snapshot"]["revenue_ttm"]["value"] == 400.0
    assert result["snapshot"]["free_cash_flow_ttm"]["value"] == 40.0
    assert result["snapshot"]["roe_ttm"]["value"] == 44.4444
    assert result["snapshot"]["pe_ratio"]["value"] == 25.0
    assert result["snapshot"]["pe_ratio"]["period_end"] == price.index[-1].date().isoformat()
    assert result["snapshot"]["pe_ratio"]["earnings_period_end"] == "2026-03-31"
    assert result["snapshot"]["market_cap"]["value"] == 1000.0
    assert result["snapshot"]["roe_ttm"]["change_pct"] is None
    assert result["roe"]["series"][0]["date"] == "2026-03-31"
    assert result["roe"]["series"][0]["value"] == pytest.approx(44.4444, abs=0.001)


def test_derived_eps_uses_weighted_average_shares_while_market_cap_uses_period_end_shares() -> None:
    stock = _FundamentalStock()
    stock._income = stock._income.drop(index="Diluted EPS")
    stock._income.loc["Diluted Average Shares"] = 5.0
    price = _price_frame(
        periods=20,
        raw_start=100.0,
        raw_end=100.0,
        adjusted_start=100.0,
        adjusted_end=100.0,
        start="2026-03-10",
    )

    result = compute_fundamentals(stock, price)

    assert all(point["value"] == 2.0 for point in result["eps"]["series"])
    assert result["snapshot"]["eps_ttm"]["value"] == 8.0
    assert result["snapshot"]["eps_ttm"]["source"] == "net_income_divided_by_weighted_average_shares"
    assert result["snapshot"]["market_cap"]["value"] == 1000.0


def test_ttm_roe_requires_period_aligned_beginning_and_ending_equity() -> None:
    income = [
        {"date": date, "value": 10.0}
        for date in ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
    ]
    # The beginning snapshot for the Q2-2025 through Q1-2026 TTM window
    # should be Q1-2025; same-window equity alone is insufficient.
    equity = [
        {"date": date, "value": 100.0}
        for date in ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
    ]

    result = _ttm_roe_snapshot(income, equity)

    assert result["value"] is None
    assert result["change_pct"] is None


def test_intraday_history_serializes_cached_naive_utc_with_offset() -> None:
    frame = pd.DataFrame(
        {"Open": [10.0], "High": [11.0], "Low": [9.0], "Close": [10.5]},
        index=pd.DatetimeIndex([datetime(2026, 8, 3, 14, 0)]),
    )

    payload = _build_intraday_history(frame)

    assert payload[0]["timestamp"] == "2026-08-03T14:00:00+00:00"


class _LastOnlyProvider(FakeProvider):
    def option_chain(self, *args, **kwargs):
        chain = super().option_chain(*args, **kwargs)

        def last_only(frame: pd.DataFrame) -> pd.DataFrame:
            output = frame.copy()
            output["bid"] = np.nan
            output["ask"] = np.nan
            output["quoteSource"] = None
            return output

        return OptionChainFrame(
            symbol=chain.symbol,
            expiry=chain.expiry,
            calls=last_only(chain.calls),
            puts=last_only(chain.puts),
            source=chain.source,
            quote_source=None,
        )


def test_optionality_preserves_raw_metrics_but_fails_closed_for_last_only_quotes() -> None:
    metrics = compute_optionality_metrics(_LastOnlyProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] is None
    assert metrics["raw_iv30"] == 35.0
    assert metrics["hv30"] == 20.0
    assert metrics["mispricing_usable"] is False
    assert metrics["component_usable"]["mispricing"] is False
    assert "last_trade_only_pricing" in metrics["quality_reasons"]
    assert "missing_quote_source" in metrics["quality_reasons"]


def test_optionality_requires_recent_observation_even_with_good_mids() -> None:
    class StaleProvider(FakeProvider):
        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            stale = pd.Timestamp.now(tz="UTC") - pd.offsets.BDay(10)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls["lastTradeDate"] = stale
            puts["lastTradeDate"] = stale
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                chain.quote_source,
                observed_at=stale.isoformat(),
                retrieved_at=stale.isoformat(),
            )

    metrics = compute_optionality_metrics(StaleProvider(), "FAKE", 100.0, 20.0)

    assert metrics["mispricing_usable"] is False
    assert "stale_quote_observation" in metrics["quality_reasons"]


def test_optionality_good_quotes_are_explicitly_usable() -> None:
    metrics = compute_optionality_metrics(FakeProvider(), "FAKE", 100.0, 20.0)

    assert metrics["mispricing_usable"] is True
    assert metrics["quality_status"] == "good"
    assert metrics["sample_counts"]["acceptable_mid_calls"] >= 2
    assert metrics["sample_counts"]["acceptable_mid_puts"] >= 2


def test_iv_percentile_contract_names_current_chain_midrank_not_historical_rank() -> None:
    metrics = compute_optionality_metrics(FakeProvider(), "FAKE", 100.0, 20.0)

    # A flat chain belongs at the midrank, not at the 100th percentile merely
    # because every tied contract IV is <= IV30.
    assert metrics["iv30_chain_percentile"] == 50.0
    assert metrics["iv30_chain_position"] == "middle_cross_section"
    assert metrics["iv30_chain_percentile_kind"] == "current_chain_cross_section"
    assert metrics["iv30_chain_percentile_metadata"] == {
        "scope": "current_near_money_chain_cross_section",
        "method": "midrank_empirical_cdf",
        "historical_series": False,
        "classification_thresholds": {
            "lower_cross_section_lt": 30.0,
            "upper_cross_section_gt": 70.0,
        },
    }
    assert metrics["iv_percentile"] is None
    assert metrics["iv_percentile_kind"] == "retired_ambiguous_field"
    assert metrics["iv_percentile_metadata"] == {
        "canonical_field": "iv30_chain_percentile",
        "retired": True,
        "reason": "ambiguous_with_historical_iv_rank",
    }
    assert metrics["component_usable"]["iv30_chain_percentile"] is True
    assert metrics["component_usable"]["iv_percentile"] is False


def test_iv_metrics_exclude_last_only_rows_even_in_mixed_chain() -> None:
    class MixedProvider(FakeProvider):
        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)

            def mixed(frame: pd.DataFrame) -> pd.DataFrame:
                output = frame.copy()
                output["impliedVolatility"] = 4.0
                output.loc[output.index[:2], "impliedVolatility"] = 0.30
                output.loc[output.index[2:], ["bid", "ask"]] = np.nan
                return output

            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                mixed(chain.calls),
                mixed(chain.puts),
                chain.source,
                chain.quote_source,
                observed_at=chain.observed_at,
                retrieved_at=chain.retrieved_at,
            )

    metrics = compute_optionality_metrics(
        MixedProvider(),
        "FAKE",
        100.0,
        20.0,
        strike_thresholds=[0.2],
    )

    assert metrics["iv30"] == 30.0
    assert metrics["raw_iv30"] == 400.0
    assert metrics["mispricing_usable"] is True


def test_ibkr_snapshot_provenance_is_usable_without_contract_last_trade_dates() -> None:
    class IbkrShapedProvider(FakeProvider):
        name = "ibkr"

        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls["lastTradeDate"] = None
            puts["lastTradeDate"] = None
            calls["quoteSource"] = "delayed"
            puts["quoteSource"] = "delayed"
            observed_at = pd.Timestamp.now(tz="UTC").isoformat()
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                "ibkr",
                "delayed",
                observed_at=observed_at,
                retrieved_at=observed_at,
            )

    metrics = compute_optionality_metrics(IbkrShapedProvider(), "FAKE", 100.0, 20.0)

    assert metrics["mispricing_usable"] is True
    assert metrics["quote_observation_provenance"] == "chain_observed_at"
    assert metrics["latest_contract_trade_at"] is None


def test_retrieval_only_chain_fails_freshness_closed_without_quote_observation() -> None:
    class RetrievalOnlyProvider(FakeProvider):
        name = "yahoo"

        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            retrieved_at = pd.Timestamp.now(tz="UTC").isoformat()
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                chain.calls,
                chain.puts,
                "yahoo",
                "yahoo",
                observed_at=None,
                retrieved_at=retrieved_at,
            )

    metrics = compute_optionality_metrics(RetrievalOnlyProvider(), "FAKE", 100.0, 20.0)

    assert metrics["retrieved_at"] is not None
    assert metrics["mispricing_usable"] is False
    assert "quote_observation_unavailable" in metrics["quality_reasons"]


def test_options_flow_as_of_uses_frozen_chain_retrieval_time_not_compute_time() -> None:
    class FrozenChainProvider(FakeProvider):
        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls["lastTradeDate"] = pd.Timestamp("2026-06-30T19:00:00Z")
            puts["lastTradeDate"] = pd.Timestamp("2026-06-30T19:00:00Z")
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                chain.quote_source,
                observed_at=None,
                retrieved_at="2026-07-01T14:30:00+00:00",
            )

    flow = compute_options_flow(FrozenChainProvider(), "FAKE", 100.0)

    assert flow is not None
    assert flow["as_of"] == "2026-07-01T14:30:00+00:00"
    assert flow["observed_at"] == "2026-06-30T19:00:00+00:00"
    assert flow["retrieved_at"] == "2026-07-01T14:30:00+00:00"


def test_options_flow_totals_use_full_chain_while_walls_use_spot_band() -> None:
    class WideChainProvider(FakeProvider):
        def __init__(self) -> None:
            super().__init__()
            self.strikes = [50.0, 90.0, 100.0, 110.0, 150.0]

        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            call_oi = {50.0: 5_000, 90.0: 90, 100.0: 100, 110.0: 110, 150.0: 1_500}
            put_oi = {50.0: 2_500, 90.0: 180, 100.0: 200, 110.0: 220, 150.0: 750}
            calls["openInterest"] = calls["strike"].map(call_oi)
            puts["openInterest"] = puts["strike"].map(put_oi)
            calls["volume"] = calls["strike"]
            puts["volume"] = puts["strike"] * 2
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                chain.quote_source,
                observed_at=chain.observed_at,
                retrieved_at=chain.retrieved_at,
            )

    flow = compute_options_flow(WideChainProvider(), "FAKE", 100.0)

    assert flow is not None
    assert flow["call_open_interest_total"] == 6_800
    assert flow["put_open_interest_total"] == 3_850
    assert flow["put_call_oi_ratio"] == 0.57
    assert flow["call_volume_total"] == 500
    assert flow["put_volume_total"] == 1_000
    assert {wall["strike"] for wall in flow["call_walls"]} == {90.0, 100.0, 110.0}
    assert {wall["strike"] for wall in flow["put_walls"]} == {90.0, 100.0, 110.0}
    assert flow["coverage"] == {
        "totals_scope": "full_valid_chain",
        "wall_scope": "within_15_percent_of_spot",
        "wall_strike_band_pct": 15.0,
        "spot": 100.0,
        "requested_strikes": 5,
        "contracts_returned": {"calls": 5, "puts": 5, "total": 10},
        "contracts_valid": {"calls": 5, "puts": 5, "total": 10},
        "open_interest_observations": {"calls": 5, "puts": 5},
        "volume_observations": {"calls": 5, "puts": 5},
        "wall_candidates": {"calls": 3, "puts": 3, "total": 6},
    }


def test_iv30_interpolates_total_variance_across_term_bracket() -> None:
    class CurvedTermProvider(FakeProvider):
        def __init__(self):
            super().__init__()
            today = datetime.now(timezone.utc).date()
            self.expiries = [
                (today + timedelta(days=20)).isoformat(),
                (today + timedelta(days=40)).isoformat(),
            ]

        def option_chain(self, symbol, expiry, **kwargs):
            chain = super().option_chain(symbol, expiry, **kwargs)
            iv = 0.20 if expiry == self.expiries[0] else 0.40
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls["impliedVolatility"] = iv
            puts["impliedVolatility"] = iv
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                chain.quote_source,
                observed_at=chain.observed_at,
                retrieved_at=chain.retrieved_at,
            )

    metrics = compute_optionality_metrics(CurvedTermProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] == pytest.approx(34.64, abs=0.01)
    assert metrics["iv30_method"] == "total_variance_interpolation"


def test_iv30_interpolation_uses_oldest_contributing_observation_for_quality() -> None:
    class MixedFreshnessTermProvider(FakeProvider):
        def __init__(self) -> None:
            super().__init__()
            today = datetime.now(timezone.utc).date()
            self.expiries = [
                (today + timedelta(days=20)).isoformat(),
                (today + timedelta(days=40)).isoformat(),
            ]
            self.stale = (pd.Timestamp.now(tz="UTC") - pd.offsets.BDay(10)).floor("s")
            self.fresh = pd.Timestamp.now(tz="UTC").floor("s")

        def option_chain(self, symbol, expiry, **kwargs):
            chain = super().option_chain(symbol, expiry, **kwargs)
            observed_at = self.stale if expiry == self.expiries[0] else self.fresh
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                chain.calls,
                chain.puts,
                chain.source,
                chain.quote_source,
                observed_at=observed_at.isoformat(),
                retrieved_at=observed_at.isoformat(),
            )

    provider = MixedFreshnessTermProvider()
    metrics = compute_optionality_metrics(provider, "FAKE", 100.0, 20.0)

    assert metrics["iv30"] == 35.0
    assert metrics["iv30_method"] == "total_variance_interpolation"
    assert metrics["latest_chain_observed_at"] == provider.fresh.isoformat()
    assert metrics["iv30_observed_at"] == provider.stale.isoformat()
    assert metrics["observed_at"] == provider.stale.isoformat()
    assert metrics["iv30_observation_complete"] is True
    assert metrics["iv30_observation_business_session_lag"] >= 9
    assert metrics["component_usable"]["iv30"] is False
    assert metrics["mispricing_usable"] is False
    assert "stale_quote_observation" in metrics["quality_reasons"]


def test_crossed_option_markets_cannot_feed_validated_iv_or_mispricing() -> None:
    class CrossedProvider(FakeProvider):
        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls[["bid", "ask"]] = [3.0, 2.0]
            puts[["bid", "ask"]] = [3.0, 2.0]
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                chain.quote_source,
                observed_at=chain.observed_at,
                retrieved_at=chain.retrieved_at,
            )

    metrics = compute_optionality_metrics(CrossedProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] is None
    assert metrics["raw_iv30"] == 35.0
    assert metrics["price_source_counts"]["crossed"] > 0
    assert metrics["mispricing_usable"] is False


@pytest.mark.parametrize("quote_source", ["frozen", "frozen,live", "delayed_frozen,live"])
def test_frozen_quote_source_cannot_be_marked_as_fresh_mispricing(quote_source: str) -> None:
    class FrozenQuoteProvider(FakeProvider):
        def option_chain(self, *args, **kwargs):
            chain = super().option_chain(*args, **kwargs)
            calls = chain.calls.copy()
            puts = chain.puts.copy()
            calls["quoteSource"] = quote_source
            puts["quoteSource"] = quote_source
            return OptionChainFrame(
                chain.symbol,
                chain.expiry,
                calls,
                puts,
                chain.source,
                quote_source,
                observed_at=pd.Timestamp.now(tz="UTC").isoformat(),
                retrieved_at=pd.Timestamp.now(tz="UTC").isoformat(),
            )

    metrics = compute_optionality_metrics(FrozenQuoteProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] == 35.0
    assert metrics["mispricing_usable"] is False
    assert "frozen_quote_source" in metrics["quality_reasons"]


def test_iv30_is_suppressed_without_near_expiry_or_term_bracket() -> None:
    class FarExpiryProvider(FakeProvider):
        def __init__(self):
            super().__init__()
            today = pd.Timestamp.now(tz="UTC").date()
            self.expiries = [
                (today + timedelta(days=60)).isoformat(),
                (today + timedelta(days=90)).isoformat(),
            ]

    metrics = compute_optionality_metrics(FarExpiryProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] is None
    assert metrics["mispricing_usable"] is False
    assert "no_usable_30d_expiry_or_bracket" in metrics["quality_reasons"]


def test_projection_cache_rejects_pre_accuracy_payloads() -> None:
    assert not _cache_matches_accuracy_contract({"projections": {}})
    assert not _cache_matches_accuracy_contract(
        {
            "schema_version": 2,
            "optionality": {"iv30": 25.0},
            "projections": {"3m": {"analysis_kind": "trailing_window"}},
            "analysis_input_fingerprint": "input-hash",
        }
    )
    assert not _cache_matches_accuracy_contract(
        {
            "schema_version": 2,
            "optionality": {"mispricing_usable": False},
            "projections": {"3m": {"analysis_kind": "trailing_window"}},
            "analysis_input_fingerprint": "input-hash",
        }
    )
    assert not _cache_matches_accuracy_contract(
        {
            "schema_version": 3,
            "optionality": {
                "mispricing_usable": False,
                "iv30_chain_percentile": 20.0,
                "iv30_chain_percentile_kind": "current_chain_cross_section",
                "iv_percentile": 20.0,
            },
            "projections": {
                horizon: {"analysis_kind": "trailing_window"}
                for horizon in HORIZONS
            },
            "analysis_input_fingerprint": "input-hash",
        }
    )
    assert not _cache_matches_accuracy_contract(
        {
            "schema_version": 3,
            "optionality": {
                "mispricing_usable": False,
                "iv30_chain_percentile": None,
                "iv30_chain_percentile_kind": "current_chain_cross_section",
                "iv_percentile": None,
            },
            "projections": {
                horizon: {"analysis_kind": "trailing_window"}
                for horizon in HORIZONS
            },
            "analysis_input_fingerprint": "input-hash",
        }
    )
    assert _cache_matches_accuracy_contract(
        {
            "schema_version": 4,
            "optionality": {
                "mispricing_usable": False,
                "iv30_chain_percentile": None,
                "iv30_chain_percentile_kind": "current_chain_cross_section",
                "iv_percentile": None,
            },
            "projections": {
                horizon: {"analysis_kind": "trailing_window"}
                for horizon in HORIZONS
            },
            "analysis_input_fingerprint": "input-hash",
        }
    )


def test_cache_input_contract_rejects_benchmark_advance_and_same_date_close_revision() -> None:
    stock = _price_frame(periods=40)
    benchmark = _price_frame(periods=40, raw_start=200.0, raw_end=200.0)
    as_of = pd.Timestamp(stock.index[-1]).tz_localize("UTC").isoformat()
    benchmark_as_of = pd.Timestamp(benchmark.index[-1]).tz_localize("UTC").isoformat()
    fingerprint = _analysis_input_fingerprint(stock, benchmark)
    payload = {
        "as_of_date": as_of,
        "benchmark_as_of_date": benchmark_as_of,
        "analysis_input_fingerprint": fingerprint,
    }

    assert _cache_matches_analysis_inputs(
        payload,
        as_of_date=as_of,
        benchmark_as_of_date=benchmark_as_of,
        analysis_input_fingerprint=fingerprint,
    )
    assert not _cache_matches_analysis_inputs(
        payload,
        as_of_date=as_of,
        benchmark_as_of_date="2026-08-04T00:00:00+00:00",
        analysis_input_fingerprint=fingerprint,
    )

    revised_stock = stock.copy()
    revised_stock.iloc[-1, revised_stock.columns.get_loc("Close")] += 1.0
    revised_fingerprint = _analysis_input_fingerprint(revised_stock, benchmark)
    assert revised_fingerprint != fingerprint
    assert not _cache_matches_analysis_inputs(
        payload,
        as_of_date=as_of,
        benchmark_as_of_date=benchmark_as_of,
        analysis_input_fingerprint=revised_fingerprint,
    )


def test_endpoint_exposes_truthful_metadata_and_withholds_stale_intraday(monkeypatch) -> None:
    stock = _price_frame()
    spy = _price_frame(raw_start=200.0, raw_end=200.0, adjusted_start=200.0, adjusted_end=200.0)
    as_of = pd.Timestamp(stock.index.max()).tz_localize("UTC").isoformat()
    stock.attrs["metadata"] = {
        "symbol": "TEST",
        "interval": "1d",
        "source": "YAHOO",
        "observed_at": as_of,
        "retrieved_at": "2026-01-02T12:00:00+00:00",
        "cache_updated_at": "2026-01-02T11:00:00+00:00",
        "cache_age_seconds": 3600.0,
        "observation_age_seconds": 86400.0,
        "business_session_lag": 3,
        "stale": True,
        "refresh_attempted": True,
        "refresh_succeeded": False,
        "refresh_error": "daily refresh failed",
        "adjusted_close_coverage_pct": 100.0,
    }
    spy.attrs["metadata"] = {
        **stock.attrs["metadata"],
        "symbol": "SPY",
        "refresh_error": "benchmark refresh failed",
    }
    intraday = stock.tail(10).copy()
    intraday.attrs["metadata"] = {
        "symbol": "TEST",
        "interval": "2h",
        "source": "YAHOO",
        "observed_at": "2025-06-11T18:00:00+00:00",
        "retrieved_at": "2026-01-02T12:00:00+00:00",
        "cache_updated_at": "2025-06-11T18:05:00+00:00",
        "business_session_lag": 140,
        "stale": True,
        "refresh_attempted": True,
        "refresh_succeeded": False,
        "refresh_error": "intraday refresh failed",
    }
    cached = {
        "schema_version": 2,
        "name": "Test Company",
        "as_of_date": as_of,
        "benchmark_as_of_date": as_of,
        "analysis_input_fingerprint": _analysis_input_fingerprint(stock, spy),
        "created_at": "2026-01-02T11:55:00+00:00",
        "computed_at": "2026-01-02T11:55:00+00:00",
        "data_warnings": [],
        "analyst_target": None,
        "analyst_count": None,
        "options_flow": None,
        "optionality": {
            "iv30": 25.0,
            "hv30": 20.0,
            "mispricing_usable": True,
            "component_usable": {"mispricing": True},
            "quality_status": "good",
            "quality_reasons": [],
            "data_source": "yahoo_option_chain",
        },
        "institutional_flow": None,
        "projections": {
            horizon: {
                "score_total": 50.0,
                "analysis_kind": "trailing_window",
                "lookback_days": 21 if horizon == "T" else HORIZONS[horizon],
            }
            for horizon in HORIZONS
        },
        "historical_score": 48.0,
        "historical_cutoff_date": "2025-10-01",
        "historical_observed_at": "2025-10-01T00:00:00+00:00",
        "technical": None,
        "fundamentals": {},
    }

    monkeypatch.setattr(stock_projection, "_get_stock_projection_cache", lambda ticker: cached)
    monkeypatch.setattr(
        stock_projection,
        "fetch_stock_data",
        lambda ticker, days=2000: spy if ticker == "SPY" else stock,
    )
    monkeypatch.setattr(stock_projection, "get_cached_intraday_frame", lambda *args, **kwargs: intraday)

    result = get_stock_projections("TEST", "252d")

    assert result["as_of_date"] == as_of
    assert result["created_at"].endswith("+00:00")
    assert result["computed_at"].endswith("+00:00")
    assert result["price_metadata"]["observed_at"] == as_of
    assert result["benchmark_metadata"]["symbol"] == "SPY"
    assert result["intraday_metadata"]["stale"] is True
    assert result["intraday_history_2h"] == []
    assert len(result["price_history"]) == 252
    assert result["historical"]["cutoff_date"] == "2025-10-01"
    assert result["historical"]["analysis_kind"] == "trailing_window"
    assert result["optionality"]["mispricing_usable"] is False
    assert "stale_underlying_basis" in result["optionality"]["quality_reasons"]
    stale_symbols = {
        warning["details"].get("symbol")
        for warning in result["data_warnings"]
        if warning["type"] == "stale_series"
    }
    assert stale_symbols == {"TEST", "SPY"}
    assert any(warning["type"] == "optionality_quality" for warning in result["data_warnings"])
