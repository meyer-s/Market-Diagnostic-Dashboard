from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String, Text

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
    source_event_id = Column(Integer, nullable=True, index=True)
    source_triggered_at = Column(DateTime, nullable=True)
    source_match_method = Column(String, nullable=True)
    source_match_confidence = Column(Float, nullable=True)
    source_match_notes = Column(String, nullable=True)
    strategy_type = Column(String, nullable=False, default="single_leg")
    strategy_model_version = Column(String, nullable=True)
    strategy_legs_json = Column(Text, nullable=True)
    strategy_net_premium = Column(Float, nullable=True)
    strategy_max_loss = Column(Float, nullable=True)
    strategy_max_profit = Column(Float, nullable=True)
    strategy_breakevens_json = Column(Text, nullable=True)
    strategy_direction = Column(String, nullable=True)
    strategy_volatility_exposure = Column(String, nullable=True)
    rolled_from_position_id = Column(Integer, nullable=True, index=True)
    roll_source_closed_position_id = Column(Integer, nullable=True, index=True)
    roll_entry_net_cash_flow = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
