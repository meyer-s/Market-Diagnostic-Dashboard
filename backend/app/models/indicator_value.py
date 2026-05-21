from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.db import Base

class IndicatorValue(Base):
    __tablename__ = "indicator_value"
    __table_args__ = (
        UniqueConstraint("indicator_id", "timestamp", name="uq_indicator_value_indicator_timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)
    indicator_id = Column(Integer, ForeignKey("indicator.id"), index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

    raw_value = Column(Float)
    normalized_value = Column(Float)
    score = Column(Float)
    state = Column(String)

    indicator = relationship("Indicator")
