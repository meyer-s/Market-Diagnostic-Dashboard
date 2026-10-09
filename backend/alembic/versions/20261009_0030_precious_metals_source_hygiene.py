"""Replace synthetic central-bank rows and enforce snapshot grain.

Revision ID: 20261009_0030
Revises: 20260901_0029
Create Date: 2026-10-09
"""

from alembic import op


revision = "20261009_0030"
down_revision = "20260901_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM cb_holding
        WHERE source IN ('WGC_IMF_2025Q4', 'ESTIMATED_HISTORICAL', 'SEED')
        """
    )
    op.execute(
        """
        DELETE FROM cb_holding older
        USING cb_holding newer
        WHERE older.country = newer.country
          AND older.date = newer.date
          AND older.id < newer.id
        """
    )
    op.create_unique_constraint(
        "uq_cb_holding_country_date",
        "cb_holding",
        ["country", "date"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_cb_holding_country_date",
        "cb_holding",
        type_="unique",
    )
