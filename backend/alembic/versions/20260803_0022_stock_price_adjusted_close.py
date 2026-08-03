"""Persist adjusted closes for total-return calculations.

Revision ID: 20260803_0022
Revises: 20260729_0021
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260803_0022"
down_revision = "20260729_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stock_price_bar",
        sa.Column("adjusted_close", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("stock_price_bar", "adjusted_close")
