"""Preserve the open-position snapshot needed to reverse an accidental close.

Revision ID: 20260729_0020
Revises: 20260726_0019
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_0020"
down_revision = "20260726_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "closed_position",
        sa.Column("source_position_snapshot_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("closed_position", "source_position_snapshot_json")
