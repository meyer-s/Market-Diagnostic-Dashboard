from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260615_0005"
down_revision = "20260611_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_projection_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("cached_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", name="uq_stock_projection_snapshot_symbol"),
    )

    op.create_index("ix_stock_projection_snapshot_id", "stock_projection_snapshot", ["id"], unique=False)
    op.create_index("ix_stock_projection_snapshot_symbol", "stock_projection_snapshot", ["symbol"], unique=False)
    op.create_index("ix_stock_projection_snapshot_cached_at", "stock_projection_snapshot", ["cached_at"], unique=False)
    op.create_index(
        "ix_stock_projection_snapshot_symbol_cached_at",
        "stock_projection_snapshot",
        ["symbol", "cached_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_stock_projection_snapshot_symbol_cached_at", table_name="stock_projection_snapshot")
    op.drop_index("ix_stock_projection_snapshot_cached_at", table_name="stock_projection_snapshot")
    op.drop_index("ix_stock_projection_snapshot_symbol", table_name="stock_projection_snapshot")
    op.drop_index("ix_stock_projection_snapshot_id", table_name="stock_projection_snapshot")
    op.drop_table("stock_projection_snapshot")
