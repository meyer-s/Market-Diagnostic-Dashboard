from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260625_0008"
down_revision = "20260623_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "option_trade_reminder",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("source_event_id", sa.Integer(), nullable=True),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("option_type", sa.String(), nullable=False),
        sa.Column("expiration", sa.Date(), nullable=False),
        sa.Column("strike", sa.Float(), nullable=False),
        sa.Column("contracts", sa.Integer(), nullable=False),
        sa.Column("fill_price", sa.Float(), nullable=False),
        sa.Column("reminder_date", sa.Date(), nullable=False),
        sa.Column("hold_days", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("position_id", name="uq_option_trade_reminder_position_id"),
    )
    op.create_index("ix_option_trade_reminder_id", "option_trade_reminder", ["id"], unique=False)
    op.create_index("ix_option_trade_reminder_position_id", "option_trade_reminder", ["position_id"], unique=False)
    op.create_index("ix_option_trade_reminder_source_event_id", "option_trade_reminder", ["source_event_id"], unique=False)
    op.create_index("ix_option_trade_reminder_symbol", "option_trade_reminder", ["symbol"], unique=False)
    op.create_index("ix_option_trade_reminder_reminder_date", "option_trade_reminder", ["reminder_date"], unique=False)
    op.create_index("ix_option_trade_reminder_status", "option_trade_reminder", ["status"], unique=False)
    op.create_index(
        "ix_option_trade_reminder_status_due",
        "option_trade_reminder",
        ["status", "reminder_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_option_trade_reminder_status_due", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_status", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_reminder_date", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_symbol", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_source_event_id", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_position_id", table_name="option_trade_reminder")
    op.drop_index("ix_option_trade_reminder_id", table_name="option_trade_reminder")
    op.drop_table("option_trade_reminder")
