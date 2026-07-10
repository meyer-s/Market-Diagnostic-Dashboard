from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260617_0007"
down_revision = "20260617_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS trading")

    op.create_table(
        "option_contract",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("underlying_symbol", sa.Text(), nullable=False),
        sa.Column("option_right", sa.Text(), nullable=False),
        sa.Column("strike", sa.Numeric(18, 6), nullable=False),
        sa.Column("expiration", sa.Date(), nullable=False),
        sa.Column("exchange", sa.Text(), nullable=False, server_default="SMART"),
        sa.Column("currency", sa.Text(), nullable=False, server_default="USD"),
        sa.Column("multiplier", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("ibkr_con_id", sa.BigInteger(), nullable=True),
        sa.Column("ibkr_local_symbol", sa.Text(), nullable=True),
        sa.Column("trading_class", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("option_right IN ('CALL', 'PUT')", name="ck_option_contract_right"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "underlying_symbol",
            "option_right",
            "strike",
            "expiration",
            "exchange",
            "currency",
            name="uq_option_contract_identity",
        ),
        sa.UniqueConstraint("ibkr_con_id", name="uq_option_contract_ibkr_con_id"),
        schema="trading",
    )
    op.create_index(
        "option_contract_lookup_idx",
        "option_contract",
        ["underlying_symbol", "expiration", "option_right", "strike"],
        schema="trading",
    )

    op.create_table(
        "option_lot",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("contract_id", sa.BigInteger(), nullable=False),
        sa.Column("source_alert_event_id", sa.Integer(), nullable=True),
        sa.Column("account", sa.Text(), nullable=True),
        sa.Column("strategy", sa.Text(), nullable=True),
        sa.Column("quantity_initial", sa.Integer(), nullable=False),
        sa.Column("quantity_open", sa.Integer(), nullable=False),
        sa.Column("avg_entry_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("entry_order_intent_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_ibkr_order_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_ibkr_perm_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("ripen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("min_hold_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("close_before_expiration_days", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("quantity_initial > 0", name="ck_option_lot_quantity_initial_positive"),
        sa.CheckConstraint("quantity_open >= 0", name="ck_option_lot_quantity_open_nonnegative"),
        sa.CheckConstraint("avg_entry_price >= 0", name="ck_option_lot_avg_entry_price_nonnegative"),
        sa.CheckConstraint("quantity_open <= quantity_initial", name="ck_option_lot_open_lte_initial"),
        sa.CheckConstraint(
            "status IN ('open', 'closing', 'closed', 'expired', 'error', 'manual_hold')",
            name="ck_option_lot_status",
        ),
        sa.ForeignKeyConstraint(["contract_id"], ["trading.option_contract.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="trading",
    )
    op.create_index("option_lot_contract_idx", "option_lot", ["contract_id"], schema="trading")
    op.create_index(
        "option_lot_due_idx",
        "option_lot",
        ["next_check_at", "status"],
        schema="trading",
        postgresql_where=sa.text("status IN ('open', 'manual_hold')"),
    )

    op.create_table(
        "exit_rule",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("lot_id", sa.BigInteger(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("rule_type", sa.Text(), nullable=False),
        sa.Column("sell_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_dte", sa.Integer(), nullable=True),
        sa.Column("target_return_pct", sa.Numeric(10, 4), nullable=True),
        sa.Column("stop_return_pct", sa.Numeric(10, 4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "rule_type IN ('time', 'dte', 'profit_target', 'stop_loss', 'manual')",
            name="ck_exit_rule_rule_type",
        ),
        sa.ForeignKeyConstraint(["lot_id"], ["trading.option_lot.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="trading",
    )
    op.create_index("exit_rule_lot_idx", "exit_rule", ["lot_id", "enabled"], schema="trading")

    op.create_table(
        "order_intent",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("lot_id", sa.BigInteger(), nullable=True),
        sa.Column("contract_id", sa.BigInteger(), nullable=False),
        sa.Column("side", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("order_type", sa.Text(), nullable=False),
        sa.Column("limit_price", sa.Numeric(18, 6), nullable=True),
        sa.Column("tif", sa.Text(), nullable=False, server_default="DAY"),
        sa.Column("outside_rth", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("ibkr_profile", sa.Text(), nullable=False),
        sa.Column("ibkr_account", sa.Text(), nullable=True),
        sa.Column("ibkr_order_id", sa.BigInteger(), nullable=True),
        sa.Column("ibkr_perm_id", sa.BigInteger(), nullable=True),
        sa.Column("avg_fill_price", sa.Numeric(18, 6), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False, server_default="agent"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("side IN ('BUY', 'SELL')", name="ck_order_intent_side"),
        sa.CheckConstraint("quantity > 0", name="ck_order_intent_quantity_positive"),
        sa.CheckConstraint("order_type IN ('MKT', 'LMT')", name="ck_order_intent_order_type"),
        sa.CheckConstraint(
            "status IN ("
            "'draft', 'previewed', 'pending_submit', 'submitted', "
            "'partially_filled', 'filled', 'cancelled', 'rejected', 'error'"
            ")",
            name="ck_order_intent_status",
        ),
        sa.ForeignKeyConstraint(["contract_id"], ["trading.option_contract.id"]),
        sa.ForeignKeyConstraint(["lot_id"], ["trading.option_lot.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_order_intent_idempotency_key"),
        schema="trading",
    )
    op.create_index("order_intent_ibkr_order_idx", "order_intent", ["ibkr_order_id"], schema="trading")
    op.create_index("order_intent_status_idx", "order_intent", ["status", "requested_at"], schema="trading")

    op.create_table(
        "broker_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("order_intent_id", sa.BigInteger(), nullable=True),
        sa.Column("lot_id", sa.BigInteger(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["lot_id"], ["trading.option_lot.id"]),
        sa.ForeignKeyConstraint(["order_intent_id"], ["trading.order_intent.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="trading",
    )
    op.create_index("broker_event_order_idx", "broker_event", ["order_intent_id", "created_at"], schema="trading")

    op.create_table(
        "position_reconciliation",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ibkr_profile", sa.Text(), nullable=False),
        sa.Column("ibkr_account", sa.Text(), nullable=True),
        sa.Column("contract_id", sa.BigInteger(), nullable=True),
        sa.Column("ibkr_con_id", sa.BigInteger(), nullable=True),
        sa.Column("db_quantity_open", sa.Integer(), nullable=True),
        sa.Column("broker_quantity", sa.Numeric(18, 6), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.CheckConstraint(
            "status IN ('match', 'missing_in_broker', 'missing_in_db', 'quantity_mismatch')",
            name="ck_position_reconciliation_status",
        ),
        sa.ForeignKeyConstraint(["contract_id"], ["trading.option_contract.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="trading",
    )
    op.execute(
        "CREATE INDEX position_reconciliation_latest_idx "
        "ON trading.position_reconciliation (checked_at DESC, status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS trading.position_reconciliation_latest_idx")
    op.drop_table("position_reconciliation", schema="trading")
    op.drop_index("broker_event_order_idx", table_name="broker_event", schema="trading")
    op.drop_table("broker_event", schema="trading")
    op.drop_index("order_intent_status_idx", table_name="order_intent", schema="trading")
    op.drop_index("order_intent_ibkr_order_idx", table_name="order_intent", schema="trading")
    op.drop_table("order_intent", schema="trading")
    op.drop_index("exit_rule_lot_idx", table_name="exit_rule", schema="trading")
    op.drop_table("exit_rule", schema="trading")
    op.drop_index("option_lot_due_idx", table_name="option_lot", schema="trading")
    op.drop_index("option_lot_contract_idx", table_name="option_lot", schema="trading")
    op.drop_table("option_lot", schema="trading")
    op.drop_index("option_contract_lookup_idx", table_name="option_contract", schema="trading")
    op.drop_table("option_contract", schema="trading")
    op.execute("DROP SCHEMA IF EXISTS trading")
