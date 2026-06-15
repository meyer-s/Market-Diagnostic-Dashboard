from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, JSON, String, UniqueConstraint

from app.core.db import Base


class StockProjectionSnapshot(Base):
    """Persistent stock-analysis projection cache payload keyed by ticker."""

    __tablename__ = "stock_projection_snapshot"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    cached_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("symbol", name="uq_stock_projection_snapshot_symbol"),
        Index("ix_stock_projection_snapshot_symbol_cached_at", "symbol", "cached_at"),
    )
