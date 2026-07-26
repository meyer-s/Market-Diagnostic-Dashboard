"""Persist scanner rank snapshots and authenticated browser impressions.

Revision ID: 20260726_0019
Revises: 20260723_0018
Create Date: 2026-07-26
"""

from alembic import op
import sqlalchemy as sa


revision = "20260726_0019"
down_revision = "20260723_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "option_scanner_rank_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_uuid", sa.String(length=36), nullable=False),
        sa.Column("schema_version", sa.String(length=80), nullable=False),
        sa.Column("surface", sa.String(length=80), nullable=False),
        sa.Column("scope_key", sa.String(length=160), nullable=False),
        sa.Column("sweep_run_id", sa.Integer(), nullable=False),
        sa.Column("learning_policy_version", sa.String(length=120), nullable=True),
        sa.Column(
            "opportunity_model_versions_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "ranking_model_versions_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_generated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["sweep_run_id"], ["option_sweep_run.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sweep_run_id",
            name="uq_option_scanner_rank_snapshot_sweep_run",
        ),
        sa.UniqueConstraint(
            "surface",
            "scope_key",
            "payload_sha256",
            name="uq_option_scanner_rank_snapshot_payload",
        ),
    )
    for column in (
        "id",
        "snapshot_uuid",
        "surface",
        "scope_key",
        "sweep_run_id",
        "payload_sha256",
        "source_generated_at",
        "created_at",
    ):
        op.create_index(
            f"ix_option_scanner_rank_snapshot_{column}",
            "option_scanner_rank_snapshot",
            [column],
            unique=column == "snapshot_uuid",
        )

    op.create_table(
        "option_scanner_impression",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_impression_id", sa.String(length=128), nullable=False),
        sa.Column("client_payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("snapshot_id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=True),
        sa.Column("exposure_type", sa.String(length=80), nullable=False),
        sa.Column("surface", sa.String(length=80), nullable=False),
        sa.Column("actor", sa.String(length=80), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("page_session_hash", sa.String(length=64), nullable=False),
        sa.Column("client_occurred_at", sa.DateTime(), nullable=True),
        sa.Column("visibility_ratio", sa.Float(), nullable=True),
        sa.Column("visible_ms", sa.Integer(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["option_alert_event.id"]),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["option_scanner_rank_snapshot.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "id",
        "client_impression_id",
        "client_payload_sha256",
        "snapshot_id",
        "event_id",
        "exposure_type",
        "surface",
        "actor",
        "request_id",
        "page_session_hash",
        "received_at",
    ):
        op.create_index(
            f"ix_option_scanner_impression_{column}",
            "option_scanner_impression",
            [column],
            unique=column == "client_impression_id",
        )


def downgrade() -> None:
    op.drop_table("option_scanner_impression")
    op.drop_table("option_scanner_rank_snapshot")
