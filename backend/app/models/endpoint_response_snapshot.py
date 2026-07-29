from sqlalchemy import Column, DateTime, JSON, String

from app.core.db import Base


class EndpointResponseSnapshot(Base):
    """Last-known-good response payload shared by all API workers."""

    __tablename__ = "endpoint_response_snapshot"

    cache_key = Column(String(160), primary_key=True)
    payload = Column(JSON, nullable=False)
    cached_at = Column(DateTime, nullable=False, index=True)
