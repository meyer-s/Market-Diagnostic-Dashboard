from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from math import isfinite
from typing import Optional


_HOLD_RE = re.compile(r"Hold\s*:\s*(\d+)\s*trading\s*days", re.IGNORECASE)
_MIN_HOLD_RE = re.compile(r"Min\s+Hold\s*:\s*(\d+)\s*trading\s*days", re.IGNORECASE)
_WINDOW_RE = re.compile(r"Review\s+Window\s*:\s*(\d+)\s*-\s*(\d+)\s*trading\s*days", re.IGNORECASE)


@dataclass(frozen=True)
class ReviewWindow:
    min_hold_days: int
    max_hold_days: int
    basis: str


@dataclass(frozen=True)
class DecisionWindow:
    next_review_date: Optional[date]
    decision_deadline: date
    next_review_sessions: int
    max_hold_sessions: int
    original_min_hold_days: int
    original_max_hold_days: int
    basis: str


def _finite_float(value: object) -> Optional[float]:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None


def _clamp_int(value: float, low: int, high: int) -> int:
    return max(low, min(high, int(round(value))))


def _add_weekdays(anchor: date, sessions: int) -> date:
    cursor = anchor
    remaining = max(0, int(sessions))
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return cursor


def _available_weekdays(anchor: date, through: date) -> int:
    if through <= anchor:
        return 0
    sessions = 0
    cursor = anchor
    while cursor < through:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5 and cursor <= through:
            sessions += 1
    return sessions


def compute_review_window(
    *,
    base_hold_days: int,
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float] = None,
    avg_edr: Optional[float] = None,
    trend_return: Optional[float] = None,
    selected_dte: Optional[int] = None,
) -> ReviewWindow:
    """Compute the earliest reasonable review day and latest model gate.

    The max gate keeps the existing dynamic scanner horizon, then shortens only
    when expiration is too close. The min gate is derived from how quickly the
    current setup can reasonably move: higher realized/implied vol, stronger
    recent trend, and larger expected daily range all lower the minimum hold.
    """

    base_hold = max(1, int(base_hold_days or 1))
    dte = int(selected_dte) if isinstance(selected_dte, int) and selected_dte > 0 else None
    max_hold = base_hold
    if dte is not None:
        max_hold = min(max_hold, max(1, dte - 14))

    iv = _finite_float(iv30)
    hv = _finite_float(hv30)
    percentile = _finite_float(iv_percentile)
    edr = _finite_float(avg_edr)
    trend = abs(_finite_float(trend_return) or 0.0)

    vol_candidates = [value for value in (iv, hv) if value is not None and value > 0]
    vol_pct = sum(vol_candidates) / len(vol_candidates) if vol_candidates else 30.0
    daily_move_pct = max(0.45, vol_pct / (252.0 ** 0.5))
    if edr is not None and edr > 0:
        daily_move_pct = (daily_move_pct * 0.65) + (edr * 0.35)

    speed_score = 0.0
    speed_score += min(2.0, max(0.0, (daily_move_pct - 1.2) / 0.7))
    speed_score += min(1.5, trend / 8.0)
    if percentile is not None:
        speed_score += min(1.0, max(0.0, (35.0 - percentile) / 20.0))

    if max_hold <= 4:
        min_hold = max(1, max_hold - 1)
    elif speed_score >= 3.0:
        min_hold = max(2, round(max_hold * 0.30))
    elif speed_score >= 1.5:
        min_hold = max(3, round(max_hold * 0.40))
    else:
        min_hold = max(4, round(max_hold * 0.50))

    min_hold = _clamp_int(min_hold, 1, max_hold)
    if max_hold >= 7:
        min_hold = min(min_hold, max_hold - 2)

    basis = (
        f"base {base_hold}d, daily move {daily_move_pct:.1f}%, "
        f"trend {trend:.1f}%, speed {speed_score:.1f}"
    )
    return ReviewWindow(min_hold_days=min_hold, max_hold_days=max_hold, basis=basis)


def compute_decision_window(
    *,
    as_of: date,
    expiration: date,
    initial_window: ReviewWindow,
    verdict: str,
    urgency: str,
    contract_status: str,
) -> DecisionWindow:
    """Rebase the entry window into an actionable, decision-aware hold window.

    The original scanner window is the ceiling. Current decision risk may only
    shorten it, never extend it. The deadline is the maximum recommended hold
    for the exact contract; the next review is an earlier process checkpoint.
    """

    original_max = max(1, int(initial_window.max_hold_days or 1))
    original_min = max(1, min(original_max, int(initial_window.min_hold_days or 1)))
    normalized_verdict = str(verdict or "manual_review").lower()
    normalized_urgency = str(urgency or "medium").lower()
    normalized_contract = str(contract_status or "marginal").lower()

    if normalized_verdict in {"close", "replacement_candidate"} or expiration <= as_of:
        reason = "close decision" if expiration > as_of else "contract expired"
        return DecisionWindow(
            next_review_date=None,
            decision_deadline=as_of,
            next_review_sessions=0,
            max_hold_sessions=0,
            original_min_hold_days=original_min,
            original_max_hold_days=original_max,
            basis=(
                f"Initial {original_min}-{original_max} session window ({initial_window.basis}); "
                f"{reason} reduces maximum recommended hold to today."
            ),
        )

    buffered_stop = expiration - timedelta(days=14)
    hard_stop = buffered_stop if buffered_stop > as_of else expiration - timedelta(days=1)
    available_sessions = _available_weekdays(as_of, hard_stop)
    if available_sessions <= 0:
        available_sessions = max(1, _available_weekdays(as_of, expiration))

    decision_caps = {
        "reduce": 3,
        "manual_review": 2,
        "conditional_hold": 5,
    }
    urgency_caps = {"critical": 2, "high": 3, "medium": 5}
    contract_caps = {"nonviable": 1, "marginal": 5}

    max_hold = min(
        original_max,
        available_sessions,
        decision_caps.get(normalized_verdict, original_max),
        urgency_caps.get(normalized_urgency, original_max),
        contract_caps.get(normalized_contract, original_max),
    )
    max_hold = max(1, max_hold)

    review_cap = original_min
    if normalized_verdict in {"reduce", "manual_review"}:
        review_cap = 1
    elif normalized_verdict == "conditional_hold":
        review_cap = min(review_cap, 2)
    if normalized_urgency in {"critical", "high"}:
        review_cap = 1
    elif normalized_urgency == "medium":
        review_cap = min(review_cap, 2)
    if normalized_contract == "nonviable":
        review_cap = 1

    next_review_sessions = max(1, min(original_min, review_cap, max_hold))
    deadline = min(_add_weekdays(as_of, max_hold), expiration)
    next_review = min(_add_weekdays(as_of, next_review_sessions), deadline)
    modifiers = ", ".join(
        item
        for item in (
            normalized_verdict.replace("_", " "),
            f"{normalized_urgency} urgency",
            f"{normalized_contract} contract",
            "14-day expiry buffer" if buffered_stop > as_of else "expiry hard stop",
        )
        if item
    )
    return DecisionWindow(
        next_review_date=next_review,
        decision_deadline=deadline,
        next_review_sessions=next_review_sessions,
        max_hold_sessions=max_hold,
        original_min_hold_days=original_min,
        original_max_hold_days=original_max,
        basis=(
            f"Initial {original_min}-{original_max} session window ({initial_window.basis}); "
            f"rebased from {as_of.isoformat()} and shortened by {modifiers}."
        ),
    )


def parse_review_window(message: Optional[str]) -> Optional[ReviewWindow]:
    if not message:
        return None

    window_match = _WINDOW_RE.search(message)
    if window_match:
        min_hold = int(window_match.group(1))
        max_hold = int(window_match.group(2))
        if min_hold > 0 and max_hold >= min_hold:
            return ReviewWindow(min_hold, max_hold, "message review window")

    hold_match = _HOLD_RE.search(message)
    if not hold_match:
        return None
    max_hold = int(hold_match.group(1))
    if max_hold <= 0:
        return None

    min_match = _MIN_HOLD_RE.search(message)
    min_hold = int(min_match.group(1)) if min_match else max(1, min(max_hold, round(max_hold * 0.4)))
    min_hold = max(1, min(min_hold, max_hold))
    return ReviewWindow(min_hold, max_hold, "message hold")
