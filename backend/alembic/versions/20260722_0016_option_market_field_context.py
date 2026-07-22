"""Persist immutable Market Field context on scanner events.

Revision ID: 20260722_0016
Revises: 20260715_0015
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260722_0016"
down_revision = "20260715_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("option_alert_event", sa.Column("field_context_version", sa.String(), nullable=True))
    op.add_column("option_alert_event", sa.Column("field_context_as_of", sa.DateTime(), nullable=True))
    op.add_column("option_alert_event", sa.Column("field_context_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("option_alert_event", "field_context_json")
    op.drop_column("option_alert_event", "field_context_as_of")
    op.drop_column("option_alert_event", "field_context_version")
