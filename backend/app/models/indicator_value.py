from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, String
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.db import Base

class IndicatorValue(Base):
    __tablename__ = "indicator_value"

    id = Column(Integer, primary_key=True, index=True)
    indicator_id = Column(Integer, ForeignKey("indicator.id"))
    timestamp = Column(DateTime, default=datetime.utcnow)

    raw_value = Column(Float)
    normalized_value = Column(Float)
    score = Column(Float)
    state = Column(String)

    indicator = relationship("Indicator")