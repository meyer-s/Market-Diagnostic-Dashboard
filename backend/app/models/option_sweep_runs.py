from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, Text

from app.core.db import Base


class OptionSweepRun(Base):
    __tablename__ = "option_sweep_run"

    id = Column(Integer, primary_key=True, index=True)
    universe_key = Column(String, index=True, nullable=False)
    universe_label = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    trigger_source = Column(String, index=True, nullable=False, default="dashboard")
    status = Column(String, index=True, nullable=False, default="queued")
    total_symbols = Column(Integer, nullable=False, default=0)
    scanned_symbols = Column(Integer, nullable=False, default=0)
    hits = Column(Integer, nullable=False, default=0)
    errors = Column(Integer, nullable=False, default=0)
    rate_limit_errors = Column(Integer, nullable=False, default=0)
    hit_symbols = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    last_event = Column(String, nullable=True)
    last_symbol = Column(String, nullable=True)
    last_error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
