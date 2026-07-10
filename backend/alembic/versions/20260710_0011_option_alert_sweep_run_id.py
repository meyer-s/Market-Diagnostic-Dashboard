from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260710_0011"
down_revision = "20260710_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.add_column(sa.Column("sweep_run_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_option_alert_event_sweep_run_id", ["sweep_run_id"])


def downgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.drop_index("ix_option_alert_event_sweep_run_id")
        batch_op.drop_column("sweep_run_id")
