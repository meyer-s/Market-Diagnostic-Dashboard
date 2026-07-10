from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260710_0009"
down_revision = "20260625_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "option_sweep_run",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("universe_key", sa.String(), nullable=False),
        sa.Column("universe_label", sa.String(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("trigger_source", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("total_symbols", sa.Integer(), nullable=False),
        sa.Column("scanned_symbols", sa.Integer(), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("errors", sa.Integer(), nullable=False),
        sa.Column("rate_limit_errors", sa.Integer(), nullable=False),
        sa.Column("hit_symbols", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("last_event", sa.String(), nullable=True),
        sa.Column("last_symbol", sa.String(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_option_sweep_run_id", "option_sweep_run", ["id"], unique=False)
    op.create_index("ix_option_sweep_run_universe_key", "option_sweep_run", ["universe_key"], unique=False)
    op.create_index("ix_option_sweep_run_trigger_source", "option_sweep_run", ["trigger_source"], unique=False)
    op.create_index("ix_option_sweep_run_status", "option_sweep_run", ["status"], unique=False)
    op.create_index("ix_option_sweep_run_started_at", "option_sweep_run", ["started_at"], unique=False)
    op.create_index(
        "ix_option_sweep_run_status_started",
        "option_sweep_run",
        ["status", "started_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_option_sweep_run_status_started", table_name="option_sweep_run")
    op.drop_index("ix_option_sweep_run_started_at", table_name="option_sweep_run")
    op.drop_index("ix_option_sweep_run_status", table_name="option_sweep_run")
    op.drop_index("ix_option_sweep_run_trigger_source", table_name="option_sweep_run")
    op.drop_index("ix_option_sweep_run_universe_key", table_name="option_sweep_run")
    op.drop_index("ix_option_sweep_run_id", table_name="option_sweep_run")
    op.drop_table("option_sweep_run")
