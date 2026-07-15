from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260715_0014"
down_revision = "20260715_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("closed_position", sa.Column("source_position_id", sa.Integer(), nullable=True))
    op.create_index(
        "ix_closed_position_source_position_id",
        "closed_position",
        ["source_position_id"],
        unique=False,
    )

    op.add_column("option_position_review", sa.Column("selected_assessment_id", sa.Integer(), nullable=True))
    op.add_column(
        "option_position_review",
        sa.Column("decision_source", sa.String(), nullable=False, server_default="human"),
    )
    op.add_column(
        "option_position_review",
        sa.Column("human_override", sa.String(), nullable=False, server_default="none"),
    )
    op.add_column("option_position_review", sa.Column("override_reason", sa.Text(), nullable=True))
    op.add_column(
        "option_position_review",
        sa.Column("threshold_approval_status", sa.String(), nullable=False, server_default="draft"),
    )
    op.create_index(
        "ix_option_position_review_selected_assessment_id",
        "option_position_review",
        ["selected_assessment_id"],
        unique=False,
    )

    op.create_table(
        "option_position_mandate",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("supersedes_mandate_id", sa.Integer(), nullable=True),
        sa.Column("mandate_version", sa.Integer(), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("capture_kind", sa.String(), nullable=False),
        sa.Column("confirmation_status", sa.String(), nullable=False),
        sa.Column("source_event_id", sa.Integer(), nullable=True),
        sa.Column("source_kind", sa.String(), nullable=False),
        sa.Column("source_confidence", sa.String(), nullable=False),
        sa.Column("threshold_origin", sa.String(), nullable=False),
        sa.Column("threshold_approval_status", sa.String(), nullable=False),
        sa.Column("trade_role", sa.String(), nullable=False),
        sa.Column("original_thesis", sa.Text(), nullable=True),
        sa.Column("contract_thesis", sa.Text(), nullable=True),
        sa.Column("expected_path", sa.Text(), nullable=True),
        sa.Column("catalyst", sa.Text(), nullable=True),
        sa.Column("confirmation_condition", sa.Text(), nullable=True),
        sa.Column("invalidation_condition", sa.Text(), nullable=True),
        sa.Column("decision_deadline", sa.Date(), nullable=True),
        sa.Column("risk_budget", sa.Float(), nullable=True),
        sa.Column("thresholds_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("source_snapshot_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "position_id",
            "mandate_version",
            name="uq_option_position_mandate_position_version",
        ),
    )
    for column in ("id", "position_id", "supersedes_mandate_id", "captured_at", "source_event_id", "decision_deadline"):
        op.create_index(f"ix_option_position_mandate_{column}", "option_position_mandate", [column], unique=False)

    op.create_table(
        "option_thesis_assessment",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("mandate_id", sa.Integer(), nullable=True),
        sa.Column("supersedes_assessment_id", sa.Integer(), nullable=True),
        sa.Column("trigger", sa.String(), nullable=False),
        sa.Column("as_of", sa.DateTime(), nullable=False),
        sa.Column("grader_version", sa.String(), nullable=False),
        sa.Column("feature_schema_version", sa.String(), nullable=False),
        sa.Column("input_hash", sa.String(), nullable=False),
        sa.Column("data_quality_status", sa.String(), nullable=False),
        sa.Column("company_thesis_status", sa.String(), nullable=False),
        sa.Column("security_thesis_readiness", sa.String(), nullable=False),
        sa.Column("path_status", sa.String(), nullable=False),
        sa.Column("contract_status", sa.String(), nullable=False),
        sa.Column("portfolio_fit_status", sa.String(), nullable=False),
        sa.Column("proposed_verdict", sa.String(), nullable=False),
        sa.Column("proposed_target_contracts", sa.Integer(), nullable=False),
        sa.Column("target_contracts_min", sa.Integer(), nullable=False),
        sa.Column("target_contracts_max", sa.Integer(), nullable=False),
        sa.Column("quality", sa.String(), nullable=False),
        sa.Column("urgency", sa.String(), nullable=False),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("continuation_condition", sa.Text(), nullable=True),
        sa.Column("next_review_date", sa.Date(), nullable=True),
        sa.Column("decision_deadline", sa.Date(), nullable=True),
        sa.Column("vetoes_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("reasons_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("missing_inputs_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("input_snapshot_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("axis_results_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("evidence_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "id",
        "position_id",
        "mandate_id",
        "supersedes_assessment_id",
        "as_of",
        "grader_version",
        "input_hash",
        "next_review_date",
        "decision_deadline",
    ):
        op.create_index(f"ix_option_thesis_assessment_{column}", "option_thesis_assessment", [column], unique=False)
    op.create_index(
        "ix_option_thesis_assessment_position_as_of",
        "option_thesis_assessment",
        ["position_id", "as_of"],
        unique=False,
    )

    op.create_table(
        "option_position_event",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("closed_position_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("event_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("related_review_id", sa.Integer(), nullable=True),
        sa.Column("related_assessment_id", sa.Integer(), nullable=True),
        sa.Column("quantity_before", sa.Integer(), nullable=True),
        sa.Column("quantity_after", sa.Integer(), nullable=True),
        sa.Column("execution_price", sa.Float(), nullable=True),
        sa.Column("total_cost_before", sa.Float(), nullable=True),
        sa.Column("total_cost_after", sa.Float(), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "position_id", "closed_position_id", "event_type", "event_at", "related_review_id", "related_assessment_id"):
        op.create_index(f"ix_option_position_event_{column}", "option_position_event", [column], unique=False)

    op.create_table(
        "option_decision_outcome",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("closed_position_id", sa.Integer(), nullable=True),
        sa.Column("supersedes_outcome_id", sa.Integer(), nullable=True),
        sa.Column("evaluation_horizon", sa.String(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("outcome_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("decided_verdict", sa.String(), nullable=False),
        sa.Column("recommended_verdict", sa.String(), nullable=True),
        sa.Column("contracts_at_decision", sa.Integer(), nullable=False),
        sa.Column("target_contracts", sa.Integer(), nullable=False),
        sa.Column("underlying_price_at_decision", sa.Float(), nullable=True),
        sa.Column("underlying_price_outcome", sa.Float(), nullable=True),
        sa.Column("option_price_at_decision", sa.Float(), nullable=True),
        sa.Column("option_price_outcome", sa.Float(), nullable=True),
        sa.Column("underlying_directional_return_pct", sa.Float(), nullable=True),
        sa.Column("option_return_pct", sa.Float(), nullable=True),
        sa.Column("incremental_value_pct", sa.Float(), nullable=True),
        sa.Column("valuation_method", sa.String(), nullable=False),
        sa.Column("process_quality", sa.String(), nullable=False),
        sa.Column("outcome_quality", sa.String(), nullable=False),
        sa.Column("attribution_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "review_id", "position_id", "closed_position_id", "supersedes_outcome_id", "target_date", "status"):
        op.create_index(f"ix_option_decision_outcome_{column}", "option_decision_outcome", [column], unique=False)
    op.create_index(
        "ix_option_decision_outcome_review_horizon",
        "option_decision_outcome",
        ["review_id", "evaluation_horizon"],
        unique=False,
    )

    op.create_table(
        "option_trade_outcome",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("closed_position_id", sa.Integer(), nullable=False),
        sa.Column("source_position_id", sa.Integer(), nullable=True),
        sa.Column("supersedes_outcome_id", sa.Integer(), nullable=True),
        sa.Column("outcome_version", sa.Integer(), nullable=False),
        sa.Column("outcome_status", sa.String(), nullable=False),
        sa.Column("process_quality", sa.String(), nullable=False),
        sa.Column("financial_outcome", sa.String(), nullable=False),
        sa.Column("primary_lesson", sa.String(), nullable=False),
        sa.Column("decision_alignment", sa.String(), nullable=False),
        sa.Column("thesis_result", sa.String(), nullable=False),
        sa.Column("contract_result", sa.String(), nullable=False),
        sa.Column("timing_result", sa.String(), nullable=False),
        sa.Column("sizing_result", sa.String(), nullable=False),
        sa.Column("portfolio_result", sa.String(), nullable=False),
        sa.Column("entry_execution_result", sa.String(), nullable=False),
        sa.Column("exit_discipline_result", sa.String(), nullable=False),
        sa.Column("event_result", sa.String(), nullable=False),
        sa.Column("review_discipline", sa.String(), nullable=False),
        sa.Column("metrics_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("attribution_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("model_version", sa.String(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "closed_position_id",
            "outcome_version",
            name="uq_option_trade_outcome_closed_version",
        ),
    )
    for column in ("id", "closed_position_id", "source_position_id", "supersedes_outcome_id"):
        op.create_index(f"ix_option_trade_outcome_{column}", "option_trade_outcome", [column], unique=False)

    op.create_table(
        "option_risk_policy",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("approval_status", sa.String(), nullable=False),
        sa.Column("portfolio_capital", sa.Float(), nullable=True),
        sa.Column("default_trade_risk_budget", sa.Float(), nullable=True),
        sa.Column("max_single_position_premium_pct", sa.Float(), nullable=True),
        sa.Column("max_directional_premium_pct", sa.Float(), nullable=True),
        sa.Column("max_expiry_bucket_premium_pct", sa.Float(), nullable=True),
        sa.Column("max_option_spread_pct", sa.Float(), nullable=True),
        sa.Column("min_dte_for_add", sa.Integer(), nullable=True),
        sa.Column("settings_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("policy_version"),
    )
    op.create_index("ix_option_risk_policy_id", "option_risk_policy", ["id"], unique=False)
    op.create_index("ix_option_risk_policy_active", "option_risk_policy", ["active"], unique=False)

    op.create_table(
        "option_model_registry",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("model_key", sa.String(), nullable=False),
        sa.Column("model_version", sa.String(), nullable=False),
        sa.Column("model_status", sa.String(), nullable=False),
        sa.Column("feature_schema_version", sa.String(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("training_start", sa.Date(), nullable=True),
        sa.Column("training_end", sa.Date(), nullable=True),
        sa.Column("metrics_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("promotion_gates_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("code_commit", sa.String(), nullable=True),
        sa.Column("promoted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("model_key", "model_version", name="uq_option_model_registry_key_version"),
    )
    op.create_index("ix_option_model_registry_id", "option_model_registry", ["id"], unique=False)
    op.create_index("ix_option_model_registry_model_key", "option_model_registry", ["model_key"], unique=False)
    op.create_index("ix_option_model_registry_model_status", "option_model_registry", ["model_status"], unique=False)


def downgrade() -> None:
    op.drop_table("option_model_registry")
    op.drop_table("option_risk_policy")
    op.drop_table("option_trade_outcome")
    op.drop_table("option_decision_outcome")
    op.drop_table("option_position_event")
    op.drop_table("option_thesis_assessment")
    op.drop_table("option_position_mandate")

    op.drop_index("ix_option_position_review_selected_assessment_id", table_name="option_position_review")
    op.drop_column("option_position_review", "threshold_approval_status")
    op.drop_column("option_position_review", "override_reason")
    op.drop_column("option_position_review", "human_override")
    op.drop_column("option_position_review", "decision_source")
    op.drop_column("option_position_review", "selected_assessment_id")

    op.drop_index("ix_closed_position_source_position_id", table_name="closed_position")
    op.drop_column("closed_position", "source_position_id")
