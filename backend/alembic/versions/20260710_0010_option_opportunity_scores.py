from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260710_0010"
down_revision = "20260710_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.add_column(sa.Column("selected_contract_score", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_reward_risk", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_convexity_profit_pct", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_convexity_probability_itm", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_planned_loss_pct", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_target_profit_pct", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("opportunity_score", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("opportunity_grade", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("opportunity_model_version", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("opportunity_components", sa.Text(), nullable=True))
        batch_op.create_index("ix_option_alert_event_opportunity_score", ["opportunity_score"])


def downgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.drop_index("ix_option_alert_event_opportunity_score")
        batch_op.drop_column("opportunity_components")
        batch_op.drop_column("opportunity_model_version")
        batch_op.drop_column("opportunity_grade")
        batch_op.drop_column("opportunity_score")
        batch_op.drop_column("selected_target_profit_pct")
        batch_op.drop_column("selected_planned_loss_pct")
        batch_op.drop_column("selected_convexity_probability_itm")
        batch_op.drop_column("selected_convexity_profit_pct")
        batch_op.drop_column("selected_reward_risk")
        batch_op.drop_column("selected_contract_score")
