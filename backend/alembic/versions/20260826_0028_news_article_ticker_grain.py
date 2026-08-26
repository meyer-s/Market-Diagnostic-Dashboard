"""Make cached news identity ticker-scoped.

Revision ID: 20260826_0028
Revises: 20260826_0027
Create Date: 2026-08-26
"""

from alembic import op


revision = "20260826_0028"
down_revision = "20260826_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_news_article_guid", table_name="news_article")
    op.create_index(
        "ix_news_article_guid",
        "news_article",
        ["guid"],
        unique=False,
    )
    op.create_index(
        "uq_news_article_symbol_guid",
        "news_article",
        ["symbol", "guid"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_news_article_symbol_guid", table_name="news_article")
    op.drop_index("ix_news_article_guid", table_name="news_article")
    op.create_index(
        "ix_news_article_guid",
        "news_article",
        ["guid"],
        unique=True,
    )
