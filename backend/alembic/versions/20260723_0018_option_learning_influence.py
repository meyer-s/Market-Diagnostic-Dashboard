"""Persist point-in-time option-learning canary receipts.

Revision ID: 20260723_0018
Revises: 20260722_0017
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260723_0018"
down_revision = "20260722_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "option_alert_event",
        sa.Column("learning_influence_version", sa.String(), nullable=True),
    )
    op.add_column(
        "option_alert_event",
        sa.Column("learning_influence_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("option_alert_event", "learning_influence_json")
    op.drop_column("option_alert_event", "learning_influence_version")
