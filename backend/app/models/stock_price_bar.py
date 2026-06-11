from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Index, Integer, String, UniqueConstraint

from app.core.db import Base


class StockPriceBar(Base):
    """Persistent per-ticker OHLCV bars for stock-analysis cache."""

    __tablename__ = "stock_price_bar"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    interval = Column(String, nullable=False, index=True)  # 1d, 2h
    timestamp = Column(DateTime, nullable=False, index=True)

    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=True)

    source = Column(String, nullable=False, default="YAHOO")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "symbol",
            "interval",
            "timestamp",
            name="uq_stock_price_bar_symbol_interval_timestamp",
        ),
        Index("ix_stock_price_bar_symbol_interval_ts", "symbol", "interval", "timestamp"),
    )
