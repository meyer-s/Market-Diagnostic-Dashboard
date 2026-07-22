from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.market_weather_context import (
    ContextSource,
    build_cross_market_relationships,
    build_technical_context,
)


def _frame(close: np.ndarray, start: str = "2024-01-02") -> pd.DataFrame:
    index = pd.date_range(start, periods=len(close), freq="B", tz="UTC")
    return pd.DataFrame(
        {
            "Open": close - 0.2,
            "High": close + 0.8,
            "Low": close - 0.7,
            "Close": close,
            "Volume": 1_000_000,
        },
        index=index,
    )


def test_technical_context_uses_prior_boundaries_without_future_leak() -> None:
    close = np.linspace(100.0, 130.0, 90)
    history = _frame(close)
    baseline = build_technical_context(history)
    inspected = baseline["series"][45]

    prior = history.iloc[25:45]
    assert inspected["support20"] == round(float(prior["Low"].min()), 4)
    assert inspected["resistance20"] == round(float(prior["High"].max()), 4)

    changed = history.copy()
    changed.iloc[60:, changed.columns.get_loc("High")] += 100.0
    changed.iloc[60:, changed.columns.get_loc("Close")] += 100.0
    changed_context = build_technical_context(changed)
    assert changed_context["series"][45] == inspected


def test_cross_market_relationship_selects_lag_on_calibration_and_checks_holdout() -> None:
    count = 420
    index = pd.date_range("2024-01-02", periods=count, freq="B", tz="UTC")
    phase = np.linspace(0.0, 45.0, count)
    pressure_change = np.sin(phase) + 0.35 * np.sin(phase * 2.7)
    target_return = np.r_[0.0, pressure_change[:-1] * 0.006]
    close = 100.0 * np.exp(np.cumsum(target_return))
    history = _frame(close)
    source = ContextSource(
        id="synthetic",
        label="Synthetic pressure",
        family="test",
        source="test",
        level_label="Synthetic level",
        unit="points",
        freshness_days=99_999,
        values=pd.Series(np.cumsum(pressure_change), index=index),
        pressure_multiplier=1.0,
    )

    payload = build_cross_market_relationships(history, symbol="TEST", sources=[source])
    relationship = payload["relationships"][0]

    assert relationship["selected_lag_days"] == 1
    assert relationship["calibration_rho"] > 0.95
    assert relationship["holdout_rho"] > 0.95
    assert relationship["holdout_q_value"] <= 0.10
    assert relationship["status"] == "persistent"
    assert relationship["rolling_association"]


def test_cross_market_relationship_does_not_forward_fill_missing_source_dates() -> None:
    count = 180
    close = np.linspace(100.0, 125.0, count)
    history = _frame(close)
    sparse_index = history.index[::30]
    source = ContextSource(
        id="sparse",
        label="Sparse source",
        family="test",
        source="test",
        level_label="Sparse level",
        unit="points",
        freshness_days=99_999,
        values=pd.Series(np.arange(len(sparse_index), dtype=float), index=sparse_index),
        pressure_multiplier=1.0,
    )

    payload = build_cross_market_relationships(history, symbol="TEST", sources=[source])
    relationship = payload["relationships"][0]

    assert relationship["status"] == "insufficient"
    assert relationship["holdout_observations"] == 0
