from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, Index, Integer, JSON, String, Text, UniqueConstraint

from app.core.db import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgricultureReportRelease(Base):
    """Persisted official release or weekly dataset snapshot for the report desk."""

    __tablename__ = "agriculture_report_release"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(String(32), nullable=False, index=True)
    scope_key = Column(String(16), nullable=False, default="ALL", index=True)
    release_date = Column(Date, nullable=False, index=True)
    title = Column(String(192), nullable=False)
    source_url = Column(Text, nullable=False)
    documents = Column(JSON, nullable=False, default=list)
    metrics = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, nullable=False, default=_utc_now)
    updated_at = Column(DateTime, nullable=False, default=_utc_now, onupdate=_utc_now)

    __table_args__ = (
        UniqueConstraint(
            "report_id",
            "scope_key",
            "release_date",
            name="uq_ag_report_release_scope_date",
        ),
        Index(
            "ix_ag_report_release_report_scope_date",
            "report_id",
            "scope_key",
            "release_date",
        ),
    )
