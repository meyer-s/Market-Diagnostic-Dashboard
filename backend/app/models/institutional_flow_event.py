from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, UniqueConstraint

from app.core.db import Base


class InstitutionalFlowEvent(Base):
    __tablename__ = "institutional_flow_event"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    event_date = Column(DateTime, nullable=False, index=True)
    side = Column(String, nullable=False, index=True)  # buy/sell/neutral

    price = Column(Float, nullable=False)
    volume = Column(Integer, nullable=False)
    notional = Column(Float, nullable=False)
    volume_z = Column(Float, nullable=False)
    clv = Column(Float, nullable=False)
    price_change_pct = Column(Float, nullable=False)
    strength = Column(Float, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "symbol",
            "event_date",
            "side",
            "price",
            "volume",
            name="uq_institutional_flow_event_symbol_date_side_price_volume",
        ),
    )
