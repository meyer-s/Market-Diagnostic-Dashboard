from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260713_0012"
down_revision = "20260710_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.add_column(sa.Column("review_min_hold_days", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("review_max_hold_days", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("review_window_basis", sa.String(), nullable=True))

    with op.batch_alter_table("option_trade_reminder") as batch_op:
        batch_op.add_column(sa.Column("min_hold_days", sa.Integer(), nullable=True))

    with op.batch_alter_table("option_training_outcome") as batch_op:
        batch_op.add_column(sa.Column("review_min_hold_days", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("review_max_hold_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("option_training_outcome") as batch_op:
        batch_op.drop_column("review_max_hold_days")
        batch_op.drop_column("review_min_hold_days")

    with op.batch_alter_table("option_trade_reminder") as batch_op:
        batch_op.drop_column("min_hold_days")

    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.drop_column("review_window_basis")
        batch_op.drop_column("review_max_hold_days")
        batch_op.drop_column("review_min_hold_days")
