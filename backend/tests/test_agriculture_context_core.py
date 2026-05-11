from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.market_context.crop_stage import get_crop_stage
from app.services.market_context.session import CBOT_GRAIN_SESSION_PROFILE, get_market_session_status


ET = ZoneInfo("America/New_York")


def _et(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=ET)


def test_friday_afternoon_is_weekend_closed_for_corn() -> None:
    status = get_market_session_status(_et(2026, 5, 15, 16, 0), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "weekend_closed"
    assert "Market is closed." in status["warnings"]


def test_monday_nine_am_is_break_for_soybeans() -> None:
    status = get_market_session_status(_et(2026, 5, 11, 9, 0), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "break"
    assert status["next_open"] is not None


def test_monday_ten_am_is_open_for_wheat() -> None:
    status = get_market_session_status(_et(2026, 5, 11, 10, 0), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "open"
    assert status["next_close"] is not None


def test_monday_three_pm_is_closed_for_corn() -> None:
    status = get_market_session_status(_et(2026, 5, 11, 15, 0), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "closed"
    assert any("queue" in warning.lower() for warning in status["warnings"])


def test_sunday_reopen_warning_triggers() -> None:
    status = get_market_session_status(_et(2026, 5, 10, 19, 55), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "weekend_closed"
    assert any("reopen" in warning.lower() for warning in status["warnings"])


def test_friday_close_warning_triggers() -> None:
    status = get_market_session_status(_et(2026, 5, 15, 14, 10), CBOT_GRAIN_SESSION_PROFILE)
    assert status["status"] == "open"
    assert any("close" in warning.lower() for warning in status["warnings"])
    assert any("weekend gap" in warning.lower() for warning in status["warnings"])


def test_corn_july_maps_to_pollination_sensitivity() -> None:
    stage = get_crop_stage("ZC", _et(2026, 7, 15, 12, 0))
    assert stage["stage"] == "pollination"
    assert stage["weather_sensitivity"] == "high"


def test_soybeans_august_maps_to_pod_setting_sensitivity() -> None:
    stage = get_crop_stage("ZS", _et(2026, 8, 15, 12, 0))
    assert stage["stage"] == "flowering_pod_set"
    assert stage["weather_sensitivity"] == "high"


def test_wheat_winter_maps_to_dormancy() -> None:
    stage = get_crop_stage("ZW", _et(2026, 1, 15, 12, 0))
    assert stage["stage"] == "winter_dormancy"


def test_corn_december_maps_to_post_harvest() -> None:
    stage = get_crop_stage("ZC", _et(2026, 12, 15, 12, 0))
    assert stage["stage"] == "post_harvest"
    assert stage["weather_sensitivity"] == "low"