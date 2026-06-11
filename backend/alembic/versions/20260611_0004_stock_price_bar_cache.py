from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260611_0004"
down_revision = "20260601_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_price_bar",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("interval", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("open", sa.Float(), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="YAHOO"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "symbol",
            "interval",
            "timestamp",
            name="uq_stock_price_bar_symbol_interval_timestamp",
        ),
    )

    op.create_index("ix_stock_price_bar_id", "stock_price_bar", ["id"], unique=False)
    op.create_index("ix_stock_price_bar_symbol", "stock_price_bar", ["symbol"], unique=False)
    op.create_index("ix_stock_price_bar_interval", "stock_price_bar", ["interval"], unique=False)
    op.create_index("ix_stock_price_bar_timestamp", "stock_price_bar", ["timestamp"], unique=False)
    op.create_index(
        "ix_stock_price_bar_symbol_interval_ts",
        "stock_price_bar",
        ["symbol", "interval", "timestamp"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_stock_price_bar_symbol_interval_ts", table_name="stock_price_bar")
    op.drop_index("ix_stock_price_bar_timestamp", table_name="stock_price_bar")
    op.drop_index("ix_stock_price_bar_interval", table_name="stock_price_bar")
    op.drop_index("ix_stock_price_bar_symbol", table_name="stock_price_bar")
    op.drop_index("ix_stock_price_bar_id", table_name="stock_price_bar")
    op.drop_table("stock_price_bar")
