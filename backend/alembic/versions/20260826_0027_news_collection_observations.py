"""Add append-only news collection receipts for narrative silence checks.

Revision ID: 20260826_0027
Revises: 20260824_0026
Create Date: 2026-08-26
"""

from alembic import op
import sqlalchemy as sa


revision = "20260826_0027"
down_revision = "20260824_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "news_collection_observation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("new_item_count", sa.Integer(), nullable=False),
        sa.Column("latest_published_at", sa.DateTime(), nullable=True),
        sa.Column("error_kind", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_news_collection_observation_symbol",
        "news_collection_observation",
        ["symbol"],
        unique=False,
    )
    op.create_index(
        "ix_news_collection_observation_source",
        "news_collection_observation",
        ["source"],
        unique=False,
    )
    op.create_index(
        "ix_news_collection_observation_checked_at",
        "news_collection_observation",
        ["checked_at"],
        unique=False,
    )
    op.create_index(
        "ix_news_collection_observation_symbol_checked_at",
        "news_collection_observation",
        ["symbol", "checked_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_news_collection_observation_symbol_checked_at",
        table_name="news_collection_observation",
    )
    op.drop_index(
        "ix_news_collection_observation_checked_at",
        table_name="news_collection_observation",
    )
    op.drop_index(
        "ix_news_collection_observation_source",
        table_name="news_collection_observation",
    )
    op.drop_index(
        "ix_news_collection_observation_symbol",
        table_name="news_collection_observation",
    )
    op.drop_table("news_collection_observation")
