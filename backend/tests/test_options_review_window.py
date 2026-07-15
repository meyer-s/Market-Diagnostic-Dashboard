from datetime import date

from app.services.options_review_window import ReviewWindow, compute_decision_window


def test_reassessment_window_keeps_original_window_as_ceiling() -> None:
    schedule = compute_decision_window(
        as_of=date(2026, 7, 15),
        expiration=date(2026, 9, 18),
        initial_window=ReviewWindow(6, 21, "scanner volatility and trend model"),
        verdict="hold",
        urgency="low",
        contract_status="attractive",
    )

    assert schedule.next_review_date == date(2026, 7, 23)
    assert schedule.decision_deadline == date(2026, 8, 13)
    assert schedule.max_hold_sessions == 21
    assert schedule.original_max_hold_days == 21


def test_critical_conditional_hold_shortens_both_clocks_into_the_future() -> None:
    schedule = compute_decision_window(
        as_of=date(2026, 7, 15),
        expiration=date(2026, 8, 21),
        initial_window=ReviewWindow(6, 21, "scanner volatility and trend model"),
        verdict="conditional_hold",
        urgency="critical",
        contract_status="marginal",
    )

    assert schedule.next_review_date == date(2026, 7, 16)
    assert schedule.decision_deadline == date(2026, 7, 17)
    assert schedule.next_review_sessions == 1
    assert schedule.max_hold_sessions == 2
    assert "Initial 6-21 session window" in schedule.basis


def test_close_decision_has_no_future_review_and_zero_remaining_hold() -> None:
    schedule = compute_decision_window(
        as_of=date(2026, 7, 15),
        expiration=date(2026, 8, 21),
        initial_window=ReviewWindow(6, 21, "scanner model"),
        verdict="close",
        urgency="critical",
        contract_status="nonviable",
    )

    assert schedule.next_review_date is None
    assert schedule.decision_deadline == date(2026, 7, 15)
    assert schedule.max_hold_sessions == 0
