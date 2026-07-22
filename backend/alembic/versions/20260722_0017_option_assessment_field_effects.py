"""Persist the applied Market Field advisory effects on assessments.

Revision ID: 20260722_0017
Revises: 20260722_0016
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260722_0017"
down_revision = "20260722_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "option_thesis_assessment",
        sa.Column("market_field_effects_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("option_thesis_assessment", "market_field_effects_json")
