from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String, Text

from app.core.db import Base


class OptionPositionReview(Base):
    """Append-only decision record for an open option position.

    Position fields are copied into every row so the review remains intelligible
    after the live position is resized, edited, or moved to the closed log.
    """

    __tablename__ = "option_position_review"

    id = Column(Integer, primary_key=True, index=True)
    position_id = Column(Integer, index=True, nullable=False)
    supersedes_review_id = Column(Integer, index=True, nullable=True)
    review_sequence = Column(Integer, nullable=False)
    review_date = Column(Date, index=True, nullable=False, default=date.today)
    review_type = Column(String, nullable=False, default="reassessment")
    selected_assessment_id = Column(Integer, index=True, nullable=True)
    decision_source = Column(String, nullable=False, default="human")
    human_override = Column(String, nullable=False, default="none")
    override_reason = Column(Text, nullable=True)
    threshold_approval_status = Column(String, nullable=False, default="draft")

    symbol = Column(String, index=True, nullable=False)
    expiration = Column(Date, nullable=False)
    strike = Column(Float, nullable=False)
    option_type = Column(String, nullable=False)
    contracts_snapshot = Column(Integer, nullable=False)

    trade_role = Column(String, nullable=False, default="unclassified")
    original_thesis = Column(Text, nullable=True)
    contract_thesis = Column(Text, nullable=True)
    expected_path = Column(Text, nullable=True)
    catalyst = Column(Text, nullable=True)
    confirmation_condition = Column(Text, nullable=True)
    invalidation_condition = Column(Text, nullable=True)
    risk_budget = Column(Float, nullable=True)

    evidence_since_last = Column(Text, nullable=True)
    thesis_status = Column(String, nullable=False, default="unassessed")
    fresh_entry_answer = Column(String, nullable=False, default="unassessed")
    portfolio_fit = Column(Text, nullable=True)
    data_quality_notes = Column(Text, nullable=True)

    verdict = Column(String, nullable=False, default="manual_review")
    target_contracts = Column(Integer, nullable=False)
    quality = Column(String, nullable=False, default="unrated")
    urgency = Column(String, nullable=False, default="medium")
    confidence = Column(String, nullable=False, default="low")
    continuation_condition = Column(Text, nullable=True)
    next_review_date = Column(Date, index=True, nullable=True)
    decision_deadline = Column(Date, index=True, nullable=True)
    decision_notes = Column(Text, nullable=True)

    underlying_price_snapshot = Column(Float, nullable=True)
    option_price_snapshot = Column(Float, nullable=True)
    remaining_capital_snapshot = Column(Float, nullable=True)
    pnl_dollar_snapshot = Column(Float, nullable=True)
    pnl_percent_snapshot = Column(Float, nullable=True)
    dte_snapshot = Column(Integer, nullable=True)
    delta_snapshot = Column(Float, nullable=True)
    theta_snapshot = Column(Float, nullable=True)
    implied_volatility_snapshot = Column(Float, nullable=True)
    quote_quality_snapshot = Column(String, nullable=True)
    market_data_as_of = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
