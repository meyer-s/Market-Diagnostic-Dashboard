"""Persist append-only BLS observation vintages.

Revision ID: 20260901_0029
Revises: 20260826_0028
Create Date: 2026-09-01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260901_0029"
down_revision = "20260826_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bls_observation_vintage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.String(length=32), nullable=False),
        sa.Column("observation_date", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("revision_key", sa.String(length=64), nullable=False),
        sa.Column("preliminary", sa.Boolean(), nullable=False),
        sa.Column("footnotes", sa.JSON(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "series_id",
            "observation_date",
            "revision_key",
            name="uq_bls_observation_vintage_state",
        ),
    )
    op.create_index(
        "ix_bls_observation_vintage_id",
        "bls_observation_vintage",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_bls_observation_vintage_series_id",
        "bls_observation_vintage",
        ["series_id"],
        unique=False,
    )
    op.create_index(
        "ix_bls_observation_vintage_observation_date",
        "bls_observation_vintage",
        ["observation_date"],
        unique=False,
    )
    op.create_index(
        "ix_bls_observation_vintage_series_date",
        "bls_observation_vintage",
        ["series_id", "observation_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bls_observation_vintage_series_date",
        table_name="bls_observation_vintage",
    )
    op.drop_index(
        "ix_bls_observation_vintage_observation_date",
        table_name="bls_observation_vintage",
    )
    op.drop_index(
        "ix_bls_observation_vintage_series_id",
        table_name="bls_observation_vintage",
    )
    op.drop_index(
        "ix_bls_observation_vintage_id",
        table_name="bls_observation_vintage",
    )
    op.drop_table("bls_observation_vintage")
