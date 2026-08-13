"""Persist chart-ready USDA WASDE release history.

Revision ID: 20260813_0023
Revises: 20260803_0022
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa


revision = "20260813_0023"
down_revision = "20260803_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agriculture_wasde_observation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("commodity", sa.String(length=64), nullable=False),
        sa.Column("metric_id", sa.String(length=32), nullable=False),
        sa.Column("source_attribute", sa.String(length=96), nullable=False),
        sa.Column("release_date", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=96), nullable=False),
        sa.Column("market_year", sa.String(length=24), nullable=False),
        sa.Column("projection_status", sa.String(length=32), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "commodity",
            "metric_id",
            "release_date",
            name="uq_ag_wasde_commodity_metric_release",
        ),
    )
    op.create_index(
        "ix_agriculture_wasde_observation_id",
        "agriculture_wasde_observation",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_agriculture_wasde_observation_commodity",
        "agriculture_wasde_observation",
        ["commodity"],
        unique=False,
    )
    op.create_index(
        "ix_agriculture_wasde_observation_metric_id",
        "agriculture_wasde_observation",
        ["metric_id"],
        unique=False,
    )
    op.create_index(
        "ix_agriculture_wasde_observation_release_date",
        "agriculture_wasde_observation",
        ["release_date"],
        unique=False,
    )
    op.create_index(
        "ix_ag_wasde_commodity_metric_release",
        "agriculture_wasde_observation",
        ["commodity", "metric_id", "release_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ag_wasde_commodity_metric_release",
        table_name="agriculture_wasde_observation",
    )
    op.drop_index(
        "ix_agriculture_wasde_observation_release_date",
        table_name="agriculture_wasde_observation",
    )
    op.drop_index(
        "ix_agriculture_wasde_observation_metric_id",
        table_name="agriculture_wasde_observation",
    )
    op.drop_index(
        "ix_agriculture_wasde_observation_commodity",
        table_name="agriculture_wasde_observation",
    )
    op.drop_index(
        "ix_agriculture_wasde_observation_id",
        table_name="agriculture_wasde_observation",
    )
    op.drop_table("agriculture_wasde_observation")
