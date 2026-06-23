from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Index, Integer, String

from app.core.db import Base


class OptionTrainingOutcome(Base):
    """Persisted scanner training outcome for one option alert event."""

    __tablename__ = "option_training_outcome"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, nullable=False, unique=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    triggered_at = Column(DateTime, nullable=True, index=True)

    option_type = Column(String, nullable=True)
    contract_expiry = Column(Date, nullable=True)
    contract_strike = Column(Float, nullable=True)
    hold_days = Column(Integer, nullable=True)

    entry_date = Column(Date, nullable=True)
    exit_date = Column(Date, nullable=True)
    recommended_exit_date = Column(Date, nullable=True)
    hold_days_realized = Column(Integer, nullable=True)
    days_elapsed_calendar = Column(Integer, nullable=True)

    entry_underlying = Column(Float, nullable=True)
    exit_underlying = Column(Float, nullable=True)
    underlying_directional_return_pct = Column(Float, nullable=True)
    entry_option_price_est = Column(Float, nullable=True)
    exit_option_price_est = Column(Float, nullable=True)
    option_return_pct_est = Column(Float, nullable=True)
    option_pnl_per_contract_est = Column(Float, nullable=True)

    status = Column(String, nullable=False, index=True)
    compute_status = Column(String, nullable=False, default="ok", index=True)
    compute_error = Column(String, nullable=True)
    computed_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_option_training_outcome_symbol_status", "symbol", "status"),
        Index("ix_option_training_outcome_triggered_status", "triggered_at", "status"),
    )
