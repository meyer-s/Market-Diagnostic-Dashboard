from sqlalchemy import Column, Integer, String, DateTime, JSON
from datetime import datetime
from app.core.db import Base

class Alert(Base):
    __tablename__ = "alert"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    type = Column(String)
    message = Column(String)
    affected_indicators = Column(JSON)