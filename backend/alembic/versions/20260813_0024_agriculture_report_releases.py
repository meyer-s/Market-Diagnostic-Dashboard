"""Persist official agriculture report release history.

Revision ID: 20260813_0024
Revises: 20260813_0023
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa


revision = "20260813_0024"
down_revision = "20260813_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agriculture_report_release",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_id", sa.String(length=32), nullable=False),
        sa.Column("scope_key", sa.String(length=16), nullable=False),
        sa.Column("release_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=192), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("documents", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "report_id",
            "scope_key",
            "release_date",
            name="uq_ag_report_release_scope_date",
        ),
    )
    op.create_index("ix_agriculture_report_release_id", "agriculture_report_release", ["id"], unique=False)
    op.create_index("ix_agriculture_report_release_report_id", "agriculture_report_release", ["report_id"], unique=False)
    op.create_index("ix_agriculture_report_release_scope_key", "agriculture_report_release", ["scope_key"], unique=False)
    op.create_index("ix_agriculture_report_release_release_date", "agriculture_report_release", ["release_date"], unique=False)
    op.create_index(
        "ix_ag_report_release_report_scope_date",
        "agriculture_report_release",
        ["report_id", "scope_key", "release_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ag_report_release_report_scope_date", table_name="agriculture_report_release")
    op.drop_index("ix_agriculture_report_release_release_date", table_name="agriculture_report_release")
    op.drop_index("ix_agriculture_report_release_scope_key", table_name="agriculture_report_release")
    op.drop_index("ix_agriculture_report_release_report_id", table_name="agriculture_report_release")
    op.drop_index("ix_agriculture_report_release_id", table_name="agriculture_report_release")
    op.drop_table("agriculture_report_release")
