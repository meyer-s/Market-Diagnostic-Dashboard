from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.orm import Session

from app.models.option_positions import OptionPosition
from app.models.option_trade_reminders import OptionTradeReminder
from app.models.options_alerts import OptionAlertEvent
from app.services.options_review_window import ReviewWindow, parse_review_window
from app.utils.db_helpers import get_db_session

logger = logging.getLogger(__name__)


def _review_window_from_event(event: OptionAlertEvent) -> Optional[ReviewWindow]:
    min_hold = getattr(event, "review_min_hold_days", None)
    max_hold = getattr(event, "review_max_hold_days", None)
    if isinstance(min_hold, int) and isinstance(max_hold, int) and min_hold > 0 and max_hold >= min_hold:
        return ReviewWindow(min_hold, max_hold, "event fields")
    return parse_review_window(event.message)


def _reminder_date_for_position(position: OptionPosition, event: OptionAlertEvent) -> tuple[date, Optional[ReviewWindow]]:
    review_window = _review_window_from_event(event)
    if review_window is not None:
        anchor = event.triggered_at.date() if event.triggered_at else position.trade_date
        return anchor + timedelta(days=review_window.max_hold_days), review_window
    return position.expiration, None


def sync_trade_sell_reminder(db: Session, position: OptionPosition) -> Optional[OptionTradeReminder]:
    """Create or refresh the pending sell reminder for an attributed option position."""
    existing = (
        db.query(OptionTradeReminder)
        .filter(OptionTradeReminder.position_id == position.id)
        .first()
    )

    if position.source_event_id is None:
        if existing and existing.status in {"pending", "error"}:
            existing.status = "skipped"
            existing.last_error = "Position is no longer linked to a scanner event."
            existing.updated_at = datetime.utcnow()
        return existing

    event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == position.source_event_id).first()
    if event is None:
        if existing and existing.status in {"pending", "error"}:
            existing.status = "error"
            existing.last_error = f"Scanner event {position.source_event_id} was not found."
            existing.updated_at = datetime.utcnow()
        return existing

    reminder_date, review_window = _reminder_date_for_position(position, event)
    reminder = existing or OptionTradeReminder(position_id=position.id)
    if reminder.status == "sent":
        return reminder

    reminder.source_event_id = event.id
    reminder.symbol = position.symbol
    reminder.option_type = position.option_type
    reminder.expiration = position.expiration
    reminder.strike = position.strike
    reminder.contracts = position.contracts
    reminder.fill_price = position.fill_price
    reminder.reminder_date = reminder_date
    reminder.min_hold_days = review_window.min_hold_days if review_window else None
    reminder.hold_days = review_window.max_hold_days if review_window else None
    reminder.status = "pending"
    reminder.last_error = None
    reminder.updated_at = datetime.utcnow()
    if reminder.created_at is None:
        reminder.created_at = datetime.utcnow()
    db.add(reminder)
    return reminder


def skip_trade_sell_reminder(db: Session, position_id: int, reason: str) -> Optional[OptionTradeReminder]:
    reminder = (
        db.query(OptionTradeReminder)
        .filter(OptionTradeReminder.position_id == position_id)
        .first()
    )
    if reminder and reminder.status in {"pending", "error"}:
        reminder.status = "skipped"
        reminder.last_error = reason
        reminder.updated_at = datetime.utcnow()
    return reminder


def _discord_webhook_url() -> Optional[str]:
    return os.getenv("OPTIONS_TRADE_REMINDER_DISCORD_WEBHOOK") or os.getenv("OPTIONS_ALERT_DISCORD_WEBHOOK")


def _evaluation_mention() -> str:
    raw = os.getenv("OPTIONS_TRADE_REMINDER_MENTION", "@_steve1234").strip()
    if not raw:
        return ""
    if raw.startswith("<@") or raw.startswith("@"):
        return raw
    return f"@{raw}"


def _format_reminder_message(reminder: OptionTradeReminder, position: OptionPosition) -> str:
    source = f" scanner event #{reminder.source_event_id}" if reminder.source_event_id else " scanner match"
    if reminder.hold_days is not None and reminder.min_hold_days is not None:
        hold = f" after review window {reminder.min_hold_days}-{reminder.hold_days} days"
    else:
        hold = f" after {reminder.hold_days} day hold" if reminder.hold_days is not None else ""
    mention = _evaluation_mention()
    prefix = f"{mention} " if mention else ""
    return (
        f"{prefix}Time to review/sell {reminder.symbol} {reminder.expiration.isoformat()} "
        f"${reminder.strike:g} {reminder.option_type.upper()} "
        f"({reminder.contracts} contract{'s' if reminder.contracts != 1 else ''} @ ${reminder.fill_price:g})"
        f"{hold}. Added from{source}; trade #{position.id}."
    )


def _send_discord_message(message: str) -> tuple[bool, Optional[str]]:
    webhook_url = _discord_webhook_url()
    if not webhook_url:
        return False, "No Discord webhook configured"

    try:
        response = requests.post(
            webhook_url,
            json={"content": message, "allowed_mentions": {"parse": ["users"]}},
            timeout=10,
        )
    except Exception as exc:
        return False, str(exc)

    if response.status_code >= 400:
        return False, f"status={response.status_code} body={response.text[:240]}"
    return True, None


def send_due_trade_sell_reminders(today: Optional[date] = None, limit: int = 25) -> dict[str, int]:
    """Send due Discord sell reminders for still-open scanner-attributed trades."""
    today = today or datetime.now(ZoneInfo("America/New_York")).date()
    stats = {"checked": 0, "sent": 0, "skipped": 0, "error": 0}

    with get_db_session() as db:
        reminders = (
            db.query(OptionTradeReminder)
            .filter(
                OptionTradeReminder.status.in_(["pending", "error"]),
                OptionTradeReminder.reminder_date <= today,
            )
            .order_by(OptionTradeReminder.reminder_date.asc(), OptionTradeReminder.id.asc())
            .limit(limit)
            .all()
        )

        for reminder in reminders:
            stats["checked"] += 1
            position = db.query(OptionPosition).filter(OptionPosition.id == reminder.position_id).first()
            if position is None:
                reminder.status = "skipped"
                reminder.last_error = "Position is no longer open."
                reminder.updated_at = datetime.utcnow()
                stats["skipped"] += 1
                continue

            ok, error = _send_discord_message(_format_reminder_message(reminder, position))
            reminder.attempts = int(reminder.attempts or 0) + 1
            reminder.updated_at = datetime.utcnow()
            if ok:
                reminder.status = "sent"
                reminder.sent_at = datetime.utcnow()
                reminder.last_error = None
                stats["sent"] += 1
            else:
                reminder.status = "error"
                reminder.last_error = error
                stats["error"] += 1

        db.commit()

    logger.info("Option trade sell reminders processed: %s", stats)
    return stats
