from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260617_0008"
down_revision = "20260617_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "option_lot_entry_order_intent_uidx",
        "option_lot",
        ["entry_order_intent_id"],
        unique=True,
        schema="trading",
        postgresql_where=sa.text("entry_order_intent_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "option_lot_entry_order_intent_uidx",
        table_name="option_lot",
        schema="trading",
    )
