from sqlalchemy import Column, Integer, Float, DateTime, String
from datetime import datetime
from app.core.db import Base

class SystemStatus(Base):
    __tablename__ = "system_status"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    composite_score = Column(Float)
    state = Column(String)
    red_count = Column(Integer)
    yellow_count = Column(Integer)