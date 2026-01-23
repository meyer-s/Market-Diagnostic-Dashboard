from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String

from app.core.db import Base


class OptionPosition(Base):
    __tablename__ = "option_position"

    id = Column(Integer, primary_key=True, index=True)
    trade_date = Column(Date, nullable=False)
    account = Column(String, nullable=True)
    action = Column(String, nullable=True)
    contracts = Column(Integer, nullable=False)
    symbol = Column(String, index=True, nullable=False)
    expiration = Column(Date, nullable=False)
    strike = Column(Float, nullable=False)
    option_type = Column(String, nullable=False)
    fill_price = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    underlying_at_entry = Column(Float, nullable=True)
    estimated_delta = Column(Float, nullable=True)
    shares_equivalent = Column(Integer, nullable=True)
    dte_at_entry = Column(Integer, nullable=True)
    underlying_reference = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
