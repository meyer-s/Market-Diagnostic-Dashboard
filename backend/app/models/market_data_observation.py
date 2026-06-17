from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, JSON, String

from app.core.db import Base


class MarketDataObservation(Base):
    """Raw market-data observations captured from provider responses."""

    __tablename__ = "market_data_observation"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False, index=True)
    data_type = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)
    expiry = Column(String, nullable=True, index=True)
    right = Column(String, nullable=True, index=True)
    interval = Column(String, nullable=True, index=True)
    quote_source = Column(String, nullable=True)
    row_count = Column(Integer, nullable=False, default=1)
    observed_at = Column(DateTime, nullable=True, index=True)
    captured_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    process_status = Column(String, nullable=False, default="pending", index=True)
    processed_at = Column(DateTime, nullable=True)
    error = Column(String, nullable=True)
    payload = Column(JSON, nullable=False)

    __table_args__ = (
        Index("ix_market_data_observation_provider_type_symbol", "provider", "data_type", "symbol"),
        Index("ix_market_data_observation_status_captured", "process_status", "captured_at"),
        Index("ix_market_data_observation_symbol_type_captured", "symbol", "data_type", "captured_at"),
    )
