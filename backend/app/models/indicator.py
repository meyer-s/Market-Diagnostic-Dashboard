from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from app.core.db import Base

class Indicator(Base):
    __tablename__ = "indicator"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    name = Column(String)
    source = Column(String)
    source_symbol = Column(String)
    category = Column(String)
    direction = Column(Integer)
    lookback_days_for_z = Column(Integer)
    threshold_green_max = Column(Float)
    threshold_yellow_max = Column(Float)
    weight = Column(Float)
    
    # Latest values
    last_raw_value = Column(Float, nullable=True)
    last_score = Column(Float, nullable=True)
    last_state = Column(String, nullable=True)
    last_updated = Column(DateTime, nullable=True)