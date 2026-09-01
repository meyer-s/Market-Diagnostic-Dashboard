from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from app.core.db import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class BlsObservationVintage(Base):
    """Append-only observed states for a published BLS observation."""

    __tablename__ = "bls_observation_vintage"

    id = Column(Integer, primary_key=True, index=True)
    series_id = Column(String(32), nullable=False, index=True)
    observation_date = Column(Date, nullable=False, index=True)
    value = Column(Float, nullable=False)
    revision_key = Column(String(64), nullable=False)
    preliminary = Column(Boolean, nullable=False, default=False)
    footnotes = Column(JSON, nullable=False, default=list)
    source_url = Column(Text, nullable=False)
    first_seen_at = Column(DateTime, nullable=False, default=_utc_now)
    last_seen_at = Column(DateTime, nullable=False, default=_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "series_id",
            "observation_date",
            "revision_key",
            name="uq_bls_observation_vintage_state",
        ),
        Index(
            "ix_bls_observation_vintage_series_date",
            "series_id",
            "observation_date",
        ),
    )
