from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260601_0003"
down_revision = "20260521_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.add_column(sa.Column("selected_expiry", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("selected_dte", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("selected_strike", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_option_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("selected_premium", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_price_source", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("selected_bid", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_ask", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_last", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_spread_pct", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_volume", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("selected_open_interest", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("selected_implied_volatility", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("selected_last_trade_at", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("option_alert_event") as batch_op:
        batch_op.drop_column("selected_last_trade_at")
        batch_op.drop_column("selected_implied_volatility")
        batch_op.drop_column("selected_open_interest")
        batch_op.drop_column("selected_volume")
        batch_op.drop_column("selected_spread_pct")
        batch_op.drop_column("selected_last")
        batch_op.drop_column("selected_ask")
        batch_op.drop_column("selected_bid")
        batch_op.drop_column("selected_price_source")
        batch_op.drop_column("selected_premium")
        batch_op.drop_column("selected_option_type")
        batch_op.drop_column("selected_strike")
        batch_op.drop_column("selected_dte")
        batch_op.drop_column("selected_expiry")
