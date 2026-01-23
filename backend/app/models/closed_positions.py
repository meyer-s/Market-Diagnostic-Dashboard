from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String

from app.core.db import Base


class ClosedPosition(Base):
    __tablename__ = "closed_position"

    id = Column(Integer, primary_key=True, index=True)
    # Original position info
    symbol = Column(String, index=True, nullable=False)
    option_type = Column(String, nullable=False)
    strike = Column(Float, nullable=False)
    expiration = Column(Date, nullable=False)
    contracts = Column(Integer, nullable=False)
    
    # Entry details
    trade_date = Column(Date, nullable=False)
    fill_price = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    underlying_at_entry = Column(Float, nullable=True)
    
    # Exit details
    close_date = Column(Date, nullable=False)
    exit_price = Column(Float, nullable=False)
    total_proceeds = Column(Float, nullable=False)
    underlying_at_exit = Column(Float, nullable=True)
    
    # P/L
    dollar_pnl = Column(Float, nullable=False)
    percent_pnl = Column(Float, nullable=False)
    
    # Metadata
    account = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
