from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from app.core.db import Base


class OptionAlertWatch(Base):
    __tablename__ = "option_alert_watch"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True)
    iv_percentile_max = Column(Float, default=20.0)
    cooldown_minutes = Column(Integer, default=1440)
    active = Column(Boolean, default=True)
    last_triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OptionAlertEvent(Base):
    __tablename__ = "option_alert_event"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    triggered_at = Column(DateTime, default=datetime.utcnow)
    iv30 = Column(Float, nullable=True)
    hv30 = Column(Float, nullable=True)
    iv_percentile = Column(Float, nullable=True)
    avg_edr = Column(Float, nullable=True)
    selected_expiry = Column(String, nullable=True)
    selected_dte = Column(Integer, nullable=True)
    selected_strike = Column(Float, nullable=True)
    selected_option_type = Column(String, nullable=True)
    selected_premium = Column(Float, nullable=True)
    selected_price_source = Column(String, nullable=True)
    selected_bid = Column(Float, nullable=True)
    selected_ask = Column(Float, nullable=True)
    selected_last = Column(Float, nullable=True)
    selected_spread_pct = Column(Float, nullable=True)
    selected_volume = Column(Integer, nullable=True)
    selected_open_interest = Column(Integer, nullable=True)
    selected_implied_volatility = Column(Float, nullable=True)
    selected_last_trade_at = Column(String, nullable=True)
    selected_contract_score = Column(Float, nullable=True)
    selected_reward_risk = Column(Float, nullable=True)
    selected_convexity_profit_pct = Column(Float, nullable=True)
    selected_convexity_probability_itm = Column(Float, nullable=True)
    selected_planned_loss_pct = Column(Float, nullable=True)
    selected_target_profit_pct = Column(Float, nullable=True)
    opportunity_score = Column(Float, nullable=True)
    opportunity_grade = Column(String, nullable=True)
    opportunity_model_version = Column(String, nullable=True)
    opportunity_components = Column(Text, nullable=True)
    message = Column(String)
    delivered = Column(Boolean, default=False)
    delivery_channel = Column(String, nullable=True)
    delivery_error = Column(String, nullable=True)
