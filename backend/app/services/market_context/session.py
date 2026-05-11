from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


EASTERN_TZ = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class SessionProfile:
    profile_id: str
    label: str
    timezone_name: str
    overnight_open: time
    overnight_close: time
    day_open: time
    day_close: time
    break_start: time
    break_end: time


CBOT_GRAIN_SESSION_PROFILE = SessionProfile(
    profile_id="cbot_grains_et",
    label="CBOT grains/oilseeds",
    timezone_name="America/New_York",
    overnight_open=time(20, 0),
    overnight_close=time(8, 45),
    day_open=time(9, 30),
    day_close=time(14, 20),
    break_start=time(8, 45),
    break_end=time(9, 30),
)


def _to_eastern(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(EASTERN_TZ)


def _combine(reference: datetime, session_time: time) -> datetime:
    return datetime.combine(reference.date(), session_time, tzinfo=reference.tzinfo)


def _current_status(et_now: datetime, profile: SessionProfile) -> str:
    weekday = et_now.weekday()
    clock = et_now.timetz().replace(tzinfo=None)

    if weekday == 5:
        return "weekend_closed"
    if weekday == 6 and clock < profile.overnight_open:
        return "weekend_closed"
    if weekday == 4 and clock >= profile.day_close:
        return "weekend_closed"

    if profile.break_start <= clock < profile.break_end:
        return "break"

    if clock >= profile.overnight_open or clock < profile.overnight_close:
        return "open"

    if profile.day_open <= clock < profile.day_close:
        return "open"

    return "closed"


def _next_open(et_now: datetime, profile: SessionProfile) -> datetime:
    weekday = et_now.weekday()
    clock = et_now.timetz().replace(tzinfo=None)

    if weekday == 5:
        sunday = et_now + timedelta(days=1)
        return datetime.combine(sunday.date(), profile.overnight_open, tzinfo=et_now.tzinfo)
    if weekday == 6:
        if clock < profile.overnight_open:
            return datetime.combine(et_now.date(), profile.overnight_open, tzinfo=et_now.tzinfo)
        return datetime.combine((et_now + timedelta(days=1)).date(), profile.day_open, tzinfo=et_now.tzinfo)
    if clock < profile.overnight_close:
        return et_now
    if profile.break_start <= clock < profile.break_end:
        return datetime.combine(et_now.date(), profile.break_end, tzinfo=et_now.tzinfo)
    if profile.day_close <= clock < profile.overnight_open:
        if weekday == 4:
            sunday = et_now + timedelta(days=2)
            return datetime.combine(sunday.date(), profile.overnight_open, tzinfo=et_now.tzinfo)
        return datetime.combine(et_now.date(), profile.overnight_open, tzinfo=et_now.tzinfo)
    if clock < profile.day_open:
        return datetime.combine(et_now.date(), profile.day_open, tzinfo=et_now.tzinfo)
    return et_now


def _next_close(et_now: datetime, profile: SessionProfile) -> datetime | None:
    status = _current_status(et_now, profile)
    if status not in {"open", "break"}:
        return None

    clock = et_now.timetz().replace(tzinfo=None)
    if clock >= profile.overnight_open or clock < profile.overnight_close:
        close_day = et_now.date()
        if clock >= profile.overnight_open:
            close_day = (et_now + timedelta(days=1)).date()
        return datetime.combine(close_day, profile.overnight_close, tzinfo=et_now.tzinfo)
    return datetime.combine(et_now.date(), profile.day_close, tzinfo=et_now.tzinfo)


def get_market_session_status(moment: datetime, profile: SessionProfile = CBOT_GRAIN_SESSION_PROFILE) -> dict[str, object]:
    et_now = _to_eastern(moment)
    status = _current_status(et_now, profile)
    next_open = _next_open(et_now, profile)
    next_close = _next_close(et_now, profile)
    warnings: list[str] = []

    if status == "break":
        warnings.append("Market is in the morning maintenance break.")
        warnings.append("Market orders may queue until the day session reopens.")
    elif status in {"closed", "weekend_closed"}:
        warnings.append("Market is closed.")
        warnings.append("Market orders may queue and fill at the next available price.")

    if next_close is not None and 0 <= (next_close - et_now).total_seconds() <= 15 * 60:
        warnings.append("Session close is within 15 minutes.")

    if next_open is not None and 0 <= (next_open - et_now).total_seconds() <= 15 * 60 and status != "open":
        warnings.append("Session reopen is within 15 minutes.")

    if et_now.weekday() == 4 and et_now.timetz().replace(tzinfo=None) >= time(12, 0):
        warnings.append("Friday/weekend gap risk is elevated.")

    return {
        "profile_id": profile.profile_id,
        "timezone": profile.timezone_name,
        "status": status,
        "current_time_et": et_now.isoformat(),
        "next_open": next_open.isoformat() if next_open else None,
        "next_close": next_close.isoformat() if next_close else None,
        "warnings": warnings,
    }
