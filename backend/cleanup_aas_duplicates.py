"""
Cleanup duplicate AAS records by calendar date.

Keeps the latest record per day (based on timestamp), deletes the rest,
and normalizes the kept record to midnight for consistency.
"""

from datetime import datetime
import logging
from sqlalchemy import func, desc
from sqlalchemy.exc import OperationalError

from app.core.db import SessionLocal
from app.models.alternative_assets import AASIndicator, AASComponentV2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _normalize_day(day_value) -> datetime:
    if isinstance(day_value, datetime):
        day_value = day_value.date()
    if isinstance(day_value, str):
        day_value = datetime.strptime(day_value, "%Y-%m-%d").date()
    return datetime.combine(day_value, datetime.min.time())


def _dedupe_model(db, model, date_field, label: str) -> None:
    duplicates = (
        db.query(func.date(date_field), func.count(model.id))
        .group_by(func.date(date_field))
        .having(func.count(model.id) > 1)
        .all()
    )
    if not duplicates:
        logger.info("No duplicates found for %s.", label)
        return

    removed_total = 0
    for day_value, count in duplicates:
        rows = (
            db.query(model)
            .filter(func.date(date_field) == day_value)
            .order_by(desc(date_field))
            .all()
        )
        if not rows:
            continue
        keep = rows[0]
        keep.date = _normalize_day(day_value)
        for extra in rows[1:]:
            db.delete(extra)
        removed_total += max(0, len(rows) - 1)
        logger.info("Deduped %s %s: kept 1, removed %s.", label, day_value, len(rows) - 1)

    logger.info("Removed %s duplicate rows from %s.", removed_total, label)


def cleanup_aas_duplicates() -> None:
    db = SessionLocal()
    try:
        _dedupe_model(db, AASIndicator, AASIndicator.date, "aas_indicator")
        try:
            _dedupe_model(db, AASComponentV2, AASComponentV2.date, "aas_component_v2")
        except OperationalError as exc:
            logger.warning("Skipping aas_component_v2 cleanup: %s", exc)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    cleanup_aas_duplicates()
