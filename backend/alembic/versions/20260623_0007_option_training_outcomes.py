from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_0007"
down_revision = "20260617_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "option_training_outcome",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("triggered_at", sa.DateTime(), nullable=True),
        sa.Column("option_type", sa.String(), nullable=True),
        sa.Column("contract_expiry", sa.Date(), nullable=True),
        sa.Column("contract_strike", sa.Float(), nullable=True),
        sa.Column("hold_days", sa.Integer(), nullable=True),
        sa.Column("entry_date", sa.Date(), nullable=True),
        sa.Column("exit_date", sa.Date(), nullable=True),
        sa.Column("recommended_exit_date", sa.Date(), nullable=True),
        sa.Column("hold_days_realized", sa.Integer(), nullable=True),
        sa.Column("days_elapsed_calendar", sa.Integer(), nullable=True),
        sa.Column("entry_underlying", sa.Float(), nullable=True),
        sa.Column("exit_underlying", sa.Float(), nullable=True),
        sa.Column("underlying_directional_return_pct", sa.Float(), nullable=True),
        sa.Column("entry_option_price_est", sa.Float(), nullable=True),
        sa.Column("exit_option_price_est", sa.Float(), nullable=True),
        sa.Column("option_return_pct_est", sa.Float(), nullable=True),
        sa.Column("option_pnl_per_contract_est", sa.Float(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("compute_status", sa.String(), nullable=False),
        sa.Column("compute_error", sa.String(), nullable=True),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_option_training_outcome_event_id"),
    )
    op.create_index("ix_option_training_outcome_id", "option_training_outcome", ["id"], unique=False)
    op.create_index("ix_option_training_outcome_event_id", "option_training_outcome", ["event_id"], unique=False)
    op.create_index("ix_option_training_outcome_symbol", "option_training_outcome", ["symbol"], unique=False)
    op.create_index("ix_option_training_outcome_triggered_at", "option_training_outcome", ["triggered_at"], unique=False)
    op.create_index("ix_option_training_outcome_status", "option_training_outcome", ["status"], unique=False)
    op.create_index("ix_option_training_outcome_compute_status", "option_training_outcome", ["compute_status"], unique=False)
    op.create_index("ix_option_training_outcome_computed_at", "option_training_outcome", ["computed_at"], unique=False)
    op.create_index(
        "ix_option_training_outcome_symbol_status",
        "option_training_outcome",
        ["symbol", "status"],
        unique=False,
    )
    op.create_index(
        "ix_option_training_outcome_triggered_status",
        "option_training_outcome",
        ["triggered_at", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_option_training_outcome_triggered_status", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_symbol_status", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_computed_at", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_compute_status", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_status", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_triggered_at", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_symbol", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_event_id", table_name="option_training_outcome")
    op.drop_index("ix_option_training_outcome_id", table_name="option_training_outcome")
    op.drop_table("option_training_outcome")
