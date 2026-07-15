from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from app.core.db import Base


class OptionPositionMandate(Base):
    """Versioned statement of what an option position is meant to accomplish."""

    __tablename__ = "option_position_mandate"

    id = Column(Integer, primary_key=True, index=True)
    position_id = Column(Integer, nullable=False, index=True)
    supersedes_mandate_id = Column(Integer, nullable=True, index=True)
    mandate_version = Column(Integer, nullable=False)
    captured_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    capture_kind = Column(String, nullable=False, default="reconstructed")
    confirmation_status = Column(String, nullable=False, default="draft")

    source_event_id = Column(Integer, nullable=True, index=True)
    source_kind = Column(String, nullable=False, default="position_record")
    source_confidence = Column(String, nullable=False, default="low")
    threshold_origin = Column(String, nullable=False, default="system_draft")
    threshold_approval_status = Column(String, nullable=False, default="draft")

    trade_role = Column(String, nullable=False, default="unclassified")
    original_thesis = Column(Text, nullable=True)
    contract_thesis = Column(Text, nullable=True)
    expected_path = Column(Text, nullable=True)
    catalyst = Column(Text, nullable=True)
    confirmation_condition = Column(Text, nullable=True)
    invalidation_condition = Column(Text, nullable=True)
    decision_deadline = Column(Date, nullable=True, index=True)
    risk_budget = Column(Float, nullable=True)
    thresholds_json = Column(Text, nullable=False, default="{}")
    source_snapshot_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "position_id",
            "mandate_version",
            name="uq_option_position_mandate_position_version",
        ),
    )


class OptionThesisAssessment(Base):
    """Immutable automatic assessment generated from point-in-time evidence."""

    __tablename__ = "option_thesis_assessment"

    id = Column(Integer, primary_key=True, index=True)
    position_id = Column(Integer, nullable=False, index=True)
    mandate_id = Column(Integer, nullable=True, index=True)
    supersedes_assessment_id = Column(Integer, nullable=True, index=True)
    trigger = Column(String, nullable=False, default="manual_refresh")
    as_of = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    grader_version = Column(String, nullable=False, index=True)
    feature_schema_version = Column(String, nullable=False)
    input_hash = Column(String, nullable=False, index=True)

    data_quality_status = Column(String, nullable=False)
    company_thesis_status = Column(String, nullable=False)
    security_thesis_readiness = Column(String, nullable=False)
    path_status = Column(String, nullable=False)
    contract_status = Column(String, nullable=False)
    portfolio_fit_status = Column(String, nullable=False)

    proposed_verdict = Column(String, nullable=False)
    proposed_target_contracts = Column(Integer, nullable=False)
    target_contracts_min = Column(Integer, nullable=False)
    target_contracts_max = Column(Integer, nullable=False)
    quality = Column(String, nullable=False)
    urgency = Column(String, nullable=False)
    confidence = Column(String, nullable=False)
    continuation_condition = Column(Text, nullable=True)
    next_review_date = Column(Date, nullable=True, index=True)
    decision_deadline = Column(Date, nullable=True, index=True)

    vetoes_json = Column(Text, nullable=False, default="[]")
    reasons_json = Column(Text, nullable=False, default="[]")
    missing_inputs_json = Column(Text, nullable=False, default="[]")
    input_snapshot_json = Column(Text, nullable=False, default="{}")
    axis_results_json = Column(Text, nullable=False, default="{}")
    evidence_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index(
            "ix_option_thesis_assessment_position_as_of",
            "position_id",
            "as_of",
        ),
    )


class OptionPositionEvent(Base):
    """Append-only lifecycle ledger for opens, changes, reviews and closes."""

    __tablename__ = "option_position_event"

    id = Column(Integer, primary_key=True, index=True)
    position_id = Column(Integer, nullable=False, index=True)
    closed_position_id = Column(Integer, nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    event_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    source = Column(String, nullable=False, default="dashboard")
    related_review_id = Column(Integer, nullable=True, index=True)
    related_assessment_id = Column(Integer, nullable=True, index=True)
    related_alert_event_id = Column(Integer, nullable=True, index=True)
    quantity_before = Column(Integer, nullable=True)
    quantity_after = Column(Integer, nullable=True)
    execution_price = Column(Float, nullable=True)
    total_cost_before = Column(Float, nullable=True)
    total_cost_after = Column(Float, nullable=True)
    details_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "position_id",
            "event_type",
            "related_alert_event_id",
            name="uq_option_position_event_position_type_alert",
        ),
    )


class OptionDecisionOutcome(Base):
    """Matured result for a decision review at a pre-declared horizon."""

    __tablename__ = "option_decision_outcome"

    id = Column(Integer, primary_key=True, index=True)
    review_id = Column(Integer, nullable=False, index=True)
    position_id = Column(Integer, nullable=False, index=True)
    closed_position_id = Column(Integer, nullable=True, index=True)
    supersedes_outcome_id = Column(Integer, nullable=True, index=True)
    evaluation_horizon = Column(String, nullable=False)
    target_date = Column(Date, nullable=False, index=True)
    outcome_date = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="matured", index=True)

    decided_verdict = Column(String, nullable=False)
    recommended_verdict = Column(String, nullable=True)
    contracts_at_decision = Column(Integer, nullable=False)
    target_contracts = Column(Integer, nullable=False)
    underlying_price_at_decision = Column(Float, nullable=True)
    underlying_price_outcome = Column(Float, nullable=True)
    option_price_at_decision = Column(Float, nullable=True)
    option_price_outcome = Column(Float, nullable=True)
    underlying_directional_return_pct = Column(Float, nullable=True)
    option_return_pct = Column(Float, nullable=True)
    incremental_value_pct = Column(Float, nullable=True)
    valuation_method = Column(String, nullable=False, default="underlying_only")
    process_quality = Column(String, nullable=False, default="unrated")
    outcome_quality = Column(String, nullable=False, default="unrated")
    attribution_json = Column(Text, nullable=False, default="{}")
    computed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index(
            "ix_option_decision_outcome_review_horizon",
            "review_id",
            "evaluation_horizon",
        ),
    )


class OptionTradeOutcome(Base):
    """Versioned postmortem for an actual closed option trade."""

    __tablename__ = "option_trade_outcome"

    id = Column(Integer, primary_key=True, index=True)
    closed_position_id = Column(Integer, nullable=False, index=True)
    source_position_id = Column(Integer, nullable=True, index=True)
    supersedes_outcome_id = Column(Integer, nullable=True, index=True)
    outcome_version = Column(Integer, nullable=False, default=1)
    outcome_status = Column(String, nullable=False, default="complete")
    process_quality = Column(String, nullable=False)
    financial_outcome = Column(String, nullable=False)
    primary_lesson = Column(String, nullable=False)
    decision_alignment = Column(String, nullable=False)
    thesis_result = Column(String, nullable=False)
    contract_result = Column(String, nullable=False)
    timing_result = Column(String, nullable=False)
    sizing_result = Column(String, nullable=False)
    portfolio_result = Column(String, nullable=False)
    entry_execution_result = Column(String, nullable=False)
    exit_discipline_result = Column(String, nullable=False)
    event_result = Column(String, nullable=False)
    review_discipline = Column(String, nullable=False)
    metrics_json = Column(Text, nullable=False, default="{}")
    attribution_json = Column(Text, nullable=False, default="{}")
    model_version = Column(String, nullable=False)
    computed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "closed_position_id",
            "outcome_version",
            name="uq_option_trade_outcome_closed_version",
        ),
    )


class OptionRiskPolicy(Base):
    """Versioned portfolio-wide sizing guardrails; inactive until confirmed."""

    __tablename__ = "option_risk_policy"

    id = Column(Integer, primary_key=True, index=True)
    policy_version = Column(Integer, nullable=False, unique=True)
    name = Column(String, nullable=False, default="Default option risk policy")
    active = Column(Boolean, nullable=False, default=False, index=True)
    approval_status = Column(String, nullable=False, default="draft")
    portfolio_capital = Column(Float, nullable=True)
    default_trade_risk_budget = Column(Float, nullable=True)
    max_single_position_premium_pct = Column(Float, nullable=True)
    max_directional_premium_pct = Column(Float, nullable=True)
    max_expiry_bucket_premium_pct = Column(Float, nullable=True)
    max_option_spread_pct = Column(Float, nullable=True)
    min_dte_for_add = Column(Integer, nullable=True)
    settings_json = Column(Text, nullable=False, default="{}")
    effective_from = Column(Date, nullable=False, default=date.today)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class OptionModelRegistry(Base):
    """Champion/challenger registry. Promotion is always explicit and auditable."""

    __tablename__ = "option_model_registry"

    id = Column(Integer, primary_key=True, index=True)
    model_key = Column(String, nullable=False, index=True)
    model_version = Column(String, nullable=False)
    model_status = Column(String, nullable=False, default="challenger", index=True)
    feature_schema_version = Column(String, nullable=False)
    sample_count = Column(Integer, nullable=False, default=0)
    training_start = Column(Date, nullable=True)
    training_end = Column(Date, nullable=True)
    metrics_json = Column(Text, nullable=False, default="{}")
    promotion_gates_json = Column(Text, nullable=False, default="{}")
    code_commit = Column(String, nullable=True)
    promoted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "model_key",
            "model_version",
            name="uq_option_model_registry_key_version",
        ),
    )
