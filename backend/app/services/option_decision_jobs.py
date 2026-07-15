from __future__ import annotations

from datetime import date
import logging
from typing import Any

from app.models.option_decision_learning import OptionThesisAssessment
from app.models.option_position_reviews import OptionPositionReview
from app.models.option_positions import OptionPosition
from app.services.market_data.factory import get_market_data_provider
from app.services.option_decision_learning import (
    backfill_trade_outcomes,
    learning_summary,
    mature_decision_outcomes,
)
from app.services.option_thesis_engine import ensure_model_registry, serialize_assessment
from app.services.stock_price_cache import get_or_refresh_daily_frame
from app.utils.db_helpers import get_db_session


logger = logging.getLogger(__name__)


def _position_is_due(db: Any, position: OptionPosition, as_of: date) -> bool:
    latest_assessment = (
        db.query(OptionThesisAssessment)
        .filter(OptionThesisAssessment.position_id == position.id)
        .order_by(OptionThesisAssessment.as_of.desc(), OptionThesisAssessment.id.desc())
        .first()
    )
    if latest_assessment is None:
        return True
    if latest_assessment.next_review_date and latest_assessment.next_review_date <= as_of:
        return True
    latest_review = (
        db.query(OptionPositionReview)
        .filter(OptionPositionReview.position_id == position.id)
        .order_by(OptionPositionReview.review_sequence.desc(), OptionPositionReview.id.desc())
        .first()
    )
    if latest_review and latest_review.next_review_date and latest_review.next_review_date <= as_of:
        return True
    return False


def refresh_due_option_assessments(limit: int = 500) -> dict[str, object]:
    """Grade due open positions in shadow mode; never submit or stage orders."""
    # Local import avoids making the HTTP module part of scheduler startup cost.
    from app.api.secret_options import _compute_position_metrics, _generate_position_assessment

    today = date.today()
    with get_db_session() as db:
        positions = db.query(OptionPosition).order_by(OptionPosition.id.asc()).limit(limit).all()
        due = [position for position in positions if _position_is_due(db, position, today)]
        provider = get_market_data_provider()
        assessed: list[dict[str, object]] = []
        errors: list[dict[str, object]] = []
        for position in due:
            try:
                metrics = _compute_position_metrics(position, provider)
                _, assessment, _ = _generate_position_assessment(
                    db,
                    position,
                    metrics,
                    trigger="scheduled_due_review",
                )
                assessed.append(
                    {
                        "position_id": position.id,
                        "symbol": position.symbol,
                        "assessment": serialize_assessment(assessment),
                    }
                )
            except Exception as exc:
                logger.exception("Automatic thesis grading failed for position %s", position.id)
                errors.append({"position_id": position.id, "symbol": position.symbol, "error": str(exc)})
        db.commit()
        return {
            "checked": len(positions),
            "due": len(due),
            "assessed": assessed,
            "errors": errors,
            "automated_execution_enabled": False,
        }


def update_option_learning_outcomes(limit: int = 5000) -> dict[str, object]:
    """Classify actual closes and mature pre-declared decision horizons."""
    with get_db_session() as db:
        ensure_model_registry(db)
        trades = backfill_trade_outcomes(db, limit=limit)
        decisions = mature_decision_outcomes(
            db,
            history_loader=lambda symbol: get_or_refresh_daily_frame(symbol, days=730),
            limit=limit,
        )
        summary = learning_summary(db)
        db.commit()
        return {
            "trade_outcomes": trades,
            "decision_outcomes": decisions,
            "summary": summary,
            "automated_model_promotion": False,
            "automated_execution_enabled": False,
        }
