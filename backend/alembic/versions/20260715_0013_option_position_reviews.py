from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260715_0013"
down_revision = "20260713_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "option_position_review",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("supersedes_review_id", sa.Integer(), nullable=True),
        sa.Column("review_sequence", sa.Integer(), nullable=False),
        sa.Column("review_date", sa.Date(), nullable=False),
        sa.Column("review_type", sa.String(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("expiration", sa.Date(), nullable=False),
        sa.Column("strike", sa.Float(), nullable=False),
        sa.Column("option_type", sa.String(), nullable=False),
        sa.Column("contracts_snapshot", sa.Integer(), nullable=False),
        sa.Column("trade_role", sa.String(), nullable=False),
        sa.Column("original_thesis", sa.Text(), nullable=True),
        sa.Column("contract_thesis", sa.Text(), nullable=True),
        sa.Column("expected_path", sa.Text(), nullable=True),
        sa.Column("catalyst", sa.Text(), nullable=True),
        sa.Column("confirmation_condition", sa.Text(), nullable=True),
        sa.Column("invalidation_condition", sa.Text(), nullable=True),
        sa.Column("risk_budget", sa.Float(), nullable=True),
        sa.Column("evidence_since_last", sa.Text(), nullable=True),
        sa.Column("thesis_status", sa.String(), nullable=False),
        sa.Column("fresh_entry_answer", sa.String(), nullable=False),
        sa.Column("portfolio_fit", sa.Text(), nullable=True),
        sa.Column("data_quality_notes", sa.Text(), nullable=True),
        sa.Column("verdict", sa.String(), nullable=False),
        sa.Column("target_contracts", sa.Integer(), nullable=False),
        sa.Column("quality", sa.String(), nullable=False),
        sa.Column("urgency", sa.String(), nullable=False),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("continuation_condition", sa.Text(), nullable=True),
        sa.Column("next_review_date", sa.Date(), nullable=True),
        sa.Column("decision_deadline", sa.Date(), nullable=True),
        sa.Column("decision_notes", sa.Text(), nullable=True),
        sa.Column("underlying_price_snapshot", sa.Float(), nullable=True),
        sa.Column("option_price_snapshot", sa.Float(), nullable=True),
        sa.Column("remaining_capital_snapshot", sa.Float(), nullable=True),
        sa.Column("pnl_dollar_snapshot", sa.Float(), nullable=True),
        sa.Column("pnl_percent_snapshot", sa.Float(), nullable=True),
        sa.Column("dte_snapshot", sa.Integer(), nullable=True),
        sa.Column("delta_snapshot", sa.Float(), nullable=True),
        sa.Column("theta_snapshot", sa.Float(), nullable=True),
        sa.Column("implied_volatility_snapshot", sa.Float(), nullable=True),
        sa.Column("quote_quality_snapshot", sa.String(), nullable=True),
        sa.Column("market_data_as_of", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_option_position_review_id", "option_position_review", ["id"], unique=False)
    op.create_index("ix_option_position_review_position_id", "option_position_review", ["position_id"], unique=False)
    op.create_index("ix_option_position_review_supersedes_review_id", "option_position_review", ["supersedes_review_id"], unique=False)
    op.create_index("ix_option_position_review_review_date", "option_position_review", ["review_date"], unique=False)
    op.create_index("ix_option_position_review_symbol", "option_position_review", ["symbol"], unique=False)
    op.create_index("ix_option_position_review_next_review_date", "option_position_review", ["next_review_date"], unique=False)
    op.create_index("ix_option_position_review_decision_deadline", "option_position_review", ["decision_deadline"], unique=False)
    op.create_index(
        "ix_option_position_review_position_sequence",
        "option_position_review",
        ["position_id", "review_sequence"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_option_position_review_position_sequence", table_name="option_position_review")
    op.drop_index("ix_option_position_review_decision_deadline", table_name="option_position_review")
    op.drop_index("ix_option_position_review_next_review_date", table_name="option_position_review")
    op.drop_index("ix_option_position_review_symbol", table_name="option_position_review")
    op.drop_index("ix_option_position_review_review_date", table_name="option_position_review")
    op.drop_index("ix_option_position_review_supersedes_review_id", table_name="option_position_review")
    op.drop_index("ix_option_position_review_position_id", table_name="option_position_review")
    op.drop_index("ix_option_position_review_id", table_name="option_position_review")
    op.drop_table("option_position_review")
