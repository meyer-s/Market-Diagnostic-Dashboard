"""Add shared last-known-good endpoint response snapshots.

Revision ID: 20260729_0021
Revises: 20260729_0020
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_0021"
down_revision = "20260729_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "endpoint_response_snapshot",
        sa.Column("cache_key", sa.String(length=160), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("cached_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("cache_key"),
    )
    op.create_index(
        "ix_endpoint_response_snapshot_cached_at",
        "endpoint_response_snapshot",
        ["cached_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_endpoint_response_snapshot_cached_at",
        table_name="endpoint_response_snapshot",
    )
    op.drop_table("endpoint_response_snapshot")
