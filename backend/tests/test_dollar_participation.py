from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.dollar_participation import build_dollar_participation_from_frames


def _frame(
    *,
    sessions: int = 220,
    start_price: float,
    daily_change: float,
    volume_scale: float,
    final_volume_multiple: float = 1.0,
) -> pd.DataFrame:
    dates = pd.bdate_range("2025-01-02", periods=sessions, tz="America/New_York")
    sequence = np.arange(sessions)
    close = start_price + sequence * daily_change + np.sin(sequence / 9) * 0.15
    volume = volume_scale * (1.0 + 0.12 * np.sin(sequence / 6) + 0.06 * np.cos(sequence / 11))
    volume[-1] *= final_volume_multiple
    return pd.DataFrame({"Close": close, "Volume": volume}, index=dates)


def _frames(*, uup_spike: float = 1.0, udn_spike: float = 1.0, dxy_change: float = 0.08):
    return {
        "DXY": _frame(start_price=100, daily_change=dxy_change, volume_scale=10_000),
        "UUP": _frame(start_price=28, daily_change=0.01, volume_scale=1_200_000, final_volume_multiple=uup_spike),
        "UDN": _frame(start_price=17, daily_change=-0.004, volume_scale=180_000, final_volume_multiple=udn_spike),
    }


def test_self_normalized_activity_does_not_compare_raw_fund_volume() -> None:
    payload = build_dollar_participation_from_frames(
        _frames(uup_spike=1.0, udn_spike=8.0),
        days=126,
        provider="fixture",
    )

    current = payload["current"]
    assert current["bear_dollar_activity"] < current["bull_dollar_activity"]
    assert current["bear_activity_z"] > current["bull_activity_z"]
    assert current["participation_tilt"] < 0
    assert current["regime"] == "bear_against_price"


def test_matched_bull_activity_can_align_with_rising_dxy() -> None:
    payload = build_dollar_participation_from_frames(
        _frames(uup_spike=8.0),
        days=126,
        provider="fixture",
    )

    assert payload["current"]["dxy_return_20d_pct"] > 1
    assert payload["current"]["bull_activity_z"] >= 2.5
    assert payload["current"]["regime"] == "aligned_bull"
    assert payload["history"][-1]["bear_plot"] <= 0


def test_simultaneous_abnormal_activity_is_not_hidden_by_net_tilt() -> None:
    payload = build_dollar_participation_from_frames(
        _frames(uup_spike=8.0, udn_spike=8.0),
        days=126,
        provider="fixture",
    )

    current = payload["current"]
    assert current["regime"] == "two_sided"
    assert current["participation_intensity"] >= 5
    assert abs(current["participation_tilt"]) < 0.5


def test_payload_discloses_provenance_and_method_limits() -> None:
    payload = build_dollar_participation_from_frames(
        _frames(),
        days=126,
        provider="fixture",
    )

    assert payload["data_quality"]["alignment"] == "Exact shared market date; no forward fill"
    assert "not creations, holdings, or net flow" in payload["methodology"]["activity"]
    assert "Historical daily AUM" in payload["methodology"]["fund_size"]
    assert "carry and roll" in payload["methodology"]["tracking"]
    assert [row["code"] for row in payload["instruments"]] == ["DXY", "UUP", "UDN"]
