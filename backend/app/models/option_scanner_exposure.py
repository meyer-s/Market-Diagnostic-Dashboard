from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from app.core.db import Base


class OptionScannerRankSnapshot(Base):
    """Immutable rank order captured when a scanner run becomes terminal."""

    __tablename__ = "option_scanner_rank_snapshot"
    __table_args__ = (
        UniqueConstraint(
            "sweep_run_id",
            name="uq_option_scanner_rank_snapshot_sweep_run",
        ),
        UniqueConstraint(
            "surface",
            "scope_key",
            "payload_sha256",
            name="uq_option_scanner_rank_snapshot_payload",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    snapshot_uuid = Column(String(36), nullable=False, unique=True, index=True)
    schema_version = Column(String(80), nullable=False)
    surface = Column(String(80), nullable=False, index=True)
    scope_key = Column(String(160), nullable=False, index=True)
    sweep_run_id = Column(
        Integer,
        ForeignKey("option_sweep_run.id"),
        nullable=False,
        index=True,
    )
    learning_policy_version = Column(String(120), nullable=True)
    opportunity_model_versions_json = Column(Text, nullable=False, default="[]")
    ranking_model_versions_json = Column(Text, nullable=False, default="[]")
    candidate_count = Column(Integer, nullable=False, default=0)
    payload_json = Column(Text, nullable=False)
    payload_sha256 = Column(String(64), nullable=False, index=True)
    source_generated_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


class OptionScannerImpression(Base):
    """Append-only, authenticated browser exposure tied to a frozen snapshot."""

    __tablename__ = "option_scanner_impression"

    id = Column(Integer, primary_key=True, index=True)
    client_impression_id = Column(String(128), nullable=False, unique=True, index=True)
    client_payload_sha256 = Column(String(64), nullable=False, index=True)
    snapshot_id = Column(
        Integer,
        ForeignKey("option_scanner_rank_snapshot.id"),
        nullable=False,
        index=True,
    )
    event_id = Column(
        Integer,
        ForeignKey("option_alert_event.id"),
        nullable=True,
        index=True,
    )
    exposure_type = Column(String(80), nullable=False, index=True)
    surface = Column(String(80), nullable=False, index=True)
    actor = Column(String(80), nullable=False, index=True)
    request_id = Column(String(128), nullable=False, index=True)
    page_session_hash = Column(String(64), nullable=False, index=True)
    client_occurred_at = Column(DateTime, nullable=True)
    visibility_ratio = Column(Float, nullable=True)
    visible_ms = Column(Integer, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    received_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
