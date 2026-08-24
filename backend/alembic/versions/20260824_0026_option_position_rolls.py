"""Track option roll lineage and execution cash flow.

Revision ID: 20260824_0026
Revises: 20260818_0025
Create Date: 2026-08-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260824_0026"
down_revision = "20260818_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("option_position") as batch_op:
        batch_op.add_column(sa.Column("rolled_from_position_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("roll_source_closed_position_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("roll_entry_net_cash_flow", sa.Float(), nullable=True))
        batch_op.create_index(
            "ix_option_position_rolled_from_position_id",
            ["rolled_from_position_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_option_position_roll_source_closed_position_id",
            ["roll_source_closed_position_id"],
            unique=False,
        )

    with op.batch_alter_table("closed_position") as batch_op:
        batch_op.add_column(sa.Column("rolled_from_position_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("roll_source_closed_position_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("roll_entry_net_cash_flow", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("rolled_to_position_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("roll_exit_net_cash_flow", sa.Float(), nullable=True))
        batch_op.create_index(
            "ix_closed_position_rolled_from_position_id",
            ["rolled_from_position_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_closed_position_roll_source_closed_position_id",
            ["roll_source_closed_position_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_closed_position_rolled_to_position_id",
            ["rolled_to_position_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("closed_position") as batch_op:
        batch_op.drop_index("ix_closed_position_rolled_to_position_id")
        batch_op.drop_index("ix_closed_position_roll_source_closed_position_id")
        batch_op.drop_index("ix_closed_position_rolled_from_position_id")
        batch_op.drop_column("roll_exit_net_cash_flow")
        batch_op.drop_column("rolled_to_position_id")
        batch_op.drop_column("roll_entry_net_cash_flow")
        batch_op.drop_column("roll_source_closed_position_id")
        batch_op.drop_column("rolled_from_position_id")

    with op.batch_alter_table("option_position") as batch_op:
        batch_op.drop_index("ix_option_position_roll_source_closed_position_id")
        batch_op.drop_index("ix_option_position_rolled_from_position_id")
        batch_op.drop_column("roll_entry_net_cash_flow")
        batch_op.drop_column("roll_source_closed_position_id")
        batch_op.drop_column("rolled_from_position_id")
