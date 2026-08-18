"""Persist risk-defined option strategy plans and multi-leg positions.

Revision ID: 20260818_0025
Revises: 20260813_0024
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa


revision = "20260818_0025"
down_revision = "20260813_0024"
branch_labels = None
depends_on = None


POSITION_COLUMN_NAMES = (
    "strategy_type",
    "strategy_model_version",
    "strategy_legs_json",
    "strategy_net_premium",
    "strategy_max_loss",
    "strategy_max_profit",
    "strategy_breakevens_json",
    "strategy_direction",
    "strategy_volatility_exposure",
)


def _position_columns() -> tuple[sa.Column, ...]:
    return (
        sa.Column("strategy_type", sa.String(), nullable=False, server_default="single_leg"),
        sa.Column("strategy_model_version", sa.String(), nullable=True),
        sa.Column("strategy_legs_json", sa.Text(), nullable=True),
        sa.Column("strategy_net_premium", sa.Float(), nullable=True),
        sa.Column("strategy_max_loss", sa.Float(), nullable=True),
        sa.Column("strategy_max_profit", sa.Float(), nullable=True),
        sa.Column("strategy_breakevens_json", sa.Text(), nullable=True),
        sa.Column("strategy_direction", sa.String(), nullable=True),
        sa.Column("strategy_volatility_exposure", sa.String(), nullable=True),
    )


def upgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.add_column(sa.Column("selected_strategy_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("strategy_model_version", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("strategy_plan_json", sa.Text(), nullable=True))

    for table_name in ("option_position", "closed_position"):
        with op.batch_alter_table(table_name) as batch_op:
            for column in _position_columns():
                batch_op.add_column(column)


def downgrade() -> None:
    for table_name in ("closed_position", "option_position"):
        with op.batch_alter_table(table_name) as batch_op:
            for column_name in reversed(POSITION_COLUMN_NAMES):
                batch_op.drop_column(column_name)

    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.drop_column("strategy_plan_json")
        batch_op.drop_column("strategy_model_version")
        batch_op.drop_column("selected_strategy_type")
