from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String

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
    message = Column(String)
    delivered = Column(Boolean, default=False)
    delivery_channel = Column(String, nullable=True)
    delivery_error = Column(String, nullable=True)
