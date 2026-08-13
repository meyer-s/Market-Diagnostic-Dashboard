from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint

from app.core.db import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgricultureWasdeObservation(Base):
    """Chart-ready, as-reported USDA WASDE observation for one release."""

    __tablename__ = "agriculture_wasde_observation"

    id = Column(Integer, primary_key=True, index=True)
    commodity = Column(String(64), nullable=False, index=True)
    metric_id = Column(String(32), nullable=False, index=True)
    source_attribute = Column(String(96), nullable=False)
    release_date = Column(Date, nullable=False, index=True)
    value = Column(Float, nullable=False)
    unit = Column(String(96), nullable=False, default="")
    market_year = Column(String(24), nullable=False, default="")
    projection_status = Column(String(32), nullable=True)
    source_url = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_utc_now)
    updated_at = Column(DateTime, nullable=False, default=_utc_now, onupdate=_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "commodity",
            "metric_id",
            "release_date",
            name="uq_ag_wasde_commodity_metric_release",
        ),
        Index(
            "ix_ag_wasde_commodity_metric_release",
            "commodity",
            "metric_id",
            "release_date",
        ),
    )
