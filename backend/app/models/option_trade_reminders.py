from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String

from app.core.db import Base


class OptionTradeReminder(Base):
    __tablename__ = "option_trade_reminder"

    id = Column(Integer, primary_key=True, index=True)
    position_id = Column(Integer, unique=True, index=True, nullable=False)
    source_event_id = Column(Integer, index=True, nullable=True)
    symbol = Column(String, index=True, nullable=False)
    option_type = Column(String, nullable=False)
    expiration = Column(Date, nullable=False)
    strike = Column(Float, nullable=False)
    contracts = Column(Integer, nullable=False)
    fill_price = Column(Float, nullable=False)
    reminder_date = Column(Date, index=True, nullable=False)
    hold_days = Column(Integer, nullable=True)
    status = Column(String, index=True, nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(String, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
