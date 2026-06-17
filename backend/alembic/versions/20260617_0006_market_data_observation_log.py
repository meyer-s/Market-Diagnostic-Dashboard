from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260617_0006"
down_revision = "20260615_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_data_observation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("data_type", sa.String(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("expiry", sa.String(), nullable=True),
        sa.Column("right", sa.String(), nullable=True),
        sa.Column("interval", sa.String(), nullable=True),
        sa.Column("quote_source", sa.String(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("observed_at", sa.DateTime(), nullable=True),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("process_status", sa.String(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_market_data_observation_id", "market_data_observation", ["id"], unique=False)
    op.create_index("ix_market_data_observation_provider", "market_data_observation", ["provider"], unique=False)
    op.create_index("ix_market_data_observation_data_type", "market_data_observation", ["data_type"], unique=False)
    op.create_index("ix_market_data_observation_symbol", "market_data_observation", ["symbol"], unique=False)
    op.create_index("ix_market_data_observation_expiry", "market_data_observation", ["expiry"], unique=False)
    op.create_index("ix_market_data_observation_right", "market_data_observation", ["right"], unique=False)
    op.create_index("ix_market_data_observation_interval", "market_data_observation", ["interval"], unique=False)
    op.create_index("ix_market_data_observation_observed_at", "market_data_observation", ["observed_at"], unique=False)
    op.create_index("ix_market_data_observation_captured_at", "market_data_observation", ["captured_at"], unique=False)
    op.create_index("ix_market_data_observation_process_status", "market_data_observation", ["process_status"], unique=False)
    op.create_index(
        "ix_market_data_observation_provider_type_symbol",
        "market_data_observation",
        ["provider", "data_type", "symbol"],
        unique=False,
    )
    op.create_index(
        "ix_market_data_observation_status_captured",
        "market_data_observation",
        ["process_status", "captured_at"],
        unique=False,
    )
    op.create_index(
        "ix_market_data_observation_symbol_type_captured",
        "market_data_observation",
        ["symbol", "data_type", "captured_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_market_data_observation_symbol_type_captured", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_status_captured", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_provider_type_symbol", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_process_status", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_captured_at", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_observed_at", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_interval", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_right", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_expiry", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_symbol", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_data_type", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_provider", table_name="market_data_observation")
    op.drop_index("ix_market_data_observation_id", table_name="market_data_observation")
    op.drop_table("market_data_observation")
