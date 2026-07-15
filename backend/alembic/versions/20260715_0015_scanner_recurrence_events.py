from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260715_0015"
down_revision = "20260715_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "option_position_event",
        sa.Column("related_alert_event_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_option_position_event_related_alert_event_id",
        "option_position_event",
        ["related_alert_event_id"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_option_position_event_position_type_alert",
        "option_position_event",
        ["position_id", "event_type", "related_alert_event_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_option_position_event_position_type_alert",
        "option_position_event",
        type_="unique",
    )
    op.drop_index(
        "ix_option_position_event_related_alert_event_id",
        table_name="option_position_event",
    )
    op.drop_column("option_position_event", "related_alert_event_id")
