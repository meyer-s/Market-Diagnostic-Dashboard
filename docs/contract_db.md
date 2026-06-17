# Options Contract Database Design

This document defines the proposed database structure for tracking purchased
options contracts and safely triggering timed exits. It is designed for the
current `marketdash` deployment and for the rapid-prototyping agent workflow in
`docs/Agent_IBKR_interface.md`.

## Current Server Constraints

`marketdash` currently runs the dashboard, scheduler, Postgres, and IB Gateway
on one Docker host.

- Hostname: `ip-172-26-7-242`
- CPU: 4 vCPU, Intel Xeon Platinum 8124M
- Memory: 7.5 GiB total, about 5.1 GiB available at the last check
- Disk: 310 GB root volume, about 256 GB available at the last check
- Active containers: `market_backend`, `market_scheduler`, `market_frontend`, `market_ibgateway`, `market_postgres`
- Postgres container: `market_postgres`, image `postgres:16-alpine`
- Persistent DB volume: `market-diagnostic-dashboard_market_db`

Because the machine is compute-limited but not overloaded, the safest first
step is to use the existing Postgres instance rather than adding another
database service.

## Database Decision

Use the existing database and add a dedicated schema named `trading`.

Do not create a separate Postgres container for this phase. A second container
would consume more memory and complicate backup, monitoring, and deployment
without materially improving security on a single-host setup.

Do not store automated trading state directly in the existing
`option_position` and `closed_position` tables. Those tables are useful for the
current UI and manual tracking, but they do not provide broker order state,
idempotency, lifecycle locking, or an append-only execution audit.

The intended split is:

- `trading.*`: source of truth for automated option execution and timed exits.
- `option_position`: optional UI/reporting mirror of confirmed open lots.
- `closed_position`: optional UI/reporting mirror of confirmed closed lots.
- `option_alert_event`: source signal attribution for trades.

## Security Model

Create a dedicated database role for automated trading state.

Suggested role:

```sql
CREATE USER trading_user WITH PASSWORD '<strong generated password>';
CREATE SCHEMA IF NOT EXISTS trading AUTHORIZATION market_user;

GRANT USAGE ON SCHEMA trading TO trading_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA trading TO trading_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA trading TO trading_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA trading
  GRANT SELECT, INSERT, UPDATE ON TABLES TO trading_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA trading
  GRANT USAGE, SELECT ON SEQUENCES TO trading_user;
```

For append-only audit tables, the application should never perform updates or
deletes. If this is enforced at the database layer later, grant only
`SELECT, INSERT` on `trading.broker_event`.

Use two connection strings:

- `DATABASE_URL`: existing app database connection.
- `TRADING_DATABASE_URL`: restricted connection for automated trading code.

The database must remain private to the Docker network. Do not publish
Postgres on a public host port.

## Tables

### `trading.option_contract`

Canonical option contract identity.

```sql
CREATE TABLE trading.option_contract (
  id BIGSERIAL PRIMARY KEY,
  underlying_symbol TEXT NOT NULL,
  right TEXT NOT NULL CHECK (right IN ('CALL', 'PUT')),
  strike NUMERIC(18, 6) NOT NULL,
  expiration DATE NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'SMART',
  currency TEXT NOT NULL DEFAULT 'USD',
  multiplier INTEGER NOT NULL DEFAULT 100,
  ibkr_con_id BIGINT,
  ibkr_local_symbol TEXT,
  trading_class TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (underlying_symbol, right, strike, expiration, exchange, currency),
  UNIQUE (ibkr_con_id)
);

CREATE INDEX option_contract_lookup_idx
  ON trading.option_contract (underlying_symbol, expiration, right, strike);
```

Store `ibkr_con_id` whenever it is available. The scheduler should prefer
`ibkr_con_id` for execution/reconciliation because it is less ambiguous than
symbol, expiry, right, and strike.

### `trading.option_lot`

A purchased group of option contracts that can be managed and eventually sold.

```sql
CREATE TABLE trading.option_lot (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES trading.option_contract(id),
  source_alert_event_id INTEGER,
  account TEXT,
  strategy TEXT,
  quantity_initial INTEGER NOT NULL CHECK (quantity_initial > 0),
  quantity_open INTEGER NOT NULL CHECK (quantity_open >= 0),
  avg_entry_price NUMERIC(18, 6) NOT NULL CHECK (avg_entry_price >= 0),
  entry_order_intent_id BIGINT,
  entry_ibkr_order_id BIGINT,
  entry_ibkr_perm_id BIGINT,
  entry_filled_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (
    status IN ('open', 'closing', 'closed', 'expired', 'error', 'manual_hold')
  ),
  ripen_at TIMESTAMPTZ NOT NULL,
  min_hold_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  close_before_expiration_days INTEGER NOT NULL DEFAULT 1,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantity_open <= quantity_initial)
);

CREATE INDEX option_lot_due_idx
  ON trading.option_lot (next_check_at, status)
  WHERE status IN ('open', 'manual_hold');

CREATE INDEX option_lot_contract_idx
  ON trading.option_lot (contract_id);
```

`ripen_at` is the primary timer for selling. `expires_at` should normally be the
option expiration date at market close in `America/New_York`, stored as
`TIMESTAMPTZ`.

`manual_hold` blocks automatic sell-intent creation until explicitly released.

### `trading.exit_rule`

Optional rule details for deciding when an open lot is ripe.

```sql
CREATE TABLE trading.exit_rule (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES trading.option_lot(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rule_type TEXT NOT NULL CHECK (
    rule_type IN ('time', 'dte', 'profit_target', 'stop_loss', 'manual')
  ),
  sell_after TIMESTAMPTZ,
  max_dte INTEGER,
  target_return_pct NUMERIC(10, 4),
  stop_return_pct NUMERIC(10, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX exit_rule_lot_idx ON trading.exit_rule (lot_id, enabled);
```

For the first prototype, use `time` and `dte` rules only. Profit target and stop
loss rules require reliable current option marks and should be enabled after
the timed exit path is proven.

### `trading.order_intent`

Idempotent queue of broker actions.

```sql
CREATE TABLE trading.order_intent (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT REFERENCES trading.option_lot(id),
  contract_id BIGINT NOT NULL REFERENCES trading.option_contract(id),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  order_type TEXT NOT NULL CHECK (order_type IN ('MKT', 'LMT')),
  limit_price NUMERIC(18, 6),
  tif TEXT NOT NULL DEFAULT 'DAY',
  outside_rth BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'previewed',
      'pending_submit',
      'submitted',
      'partially_filled',
      'filled',
      'cancelled',
      'rejected',
      'error'
    )
  ),
  idempotency_key TEXT NOT NULL,
  ibkr_profile TEXT NOT NULL,
  ibkr_account TEXT,
  ibkr_order_id BIGINT,
  ibkr_perm_id BIGINT,
  avg_fill_price NUMERIC(18, 6),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  filled_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX order_intent_status_idx
  ON trading.order_intent (status, requested_at);

CREATE INDEX order_intent_ibkr_order_idx
  ON trading.order_intent (ibkr_order_id);
```

The idempotency key is the main protection against duplicate trades when an
agent, scheduler, or container restarts.

Suggested sell key:

```text
sell:{lot_id}:{quantity_open}:{contract_id}:{ripen_at_iso_date}
```

Suggested buy key:

```text
buy:{source_alert_event_id}:{contract_id}:{quantity}:{requested_at_iso_minute}
```

### `trading.broker_event`

Append-only broker audit trail.

```sql
CREATE TABLE trading.broker_event (
  id BIGSERIAL PRIMARY KEY,
  order_intent_id BIGINT REFERENCES trading.order_intent(id),
  lot_id BIGINT REFERENCES trading.option_lot(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX broker_event_order_idx
  ON trading.broker_event (order_intent_id, created_at);
```

Every IBKR response, preview result, submission result, fill update, rejection,
and reconciliation observation should be inserted here.

### `trading.position_reconciliation`

Periodic snapshot comparing local DB state with IBKR positions.

```sql
CREATE TABLE trading.position_reconciliation (
  id BIGSERIAL PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ibkr_profile TEXT NOT NULL,
  ibkr_account TEXT,
  contract_id BIGINT REFERENCES trading.option_contract(id),
  ibkr_con_id BIGINT,
  db_quantity_open INTEGER,
  broker_quantity NUMERIC(18, 6),
  status TEXT NOT NULL CHECK (
    status IN ('match', 'missing_in_broker', 'missing_in_db', 'quantity_mismatch')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX position_reconciliation_latest_idx
  ON trading.position_reconciliation (checked_at DESC, status);
```

The automated seller should not sell a lot unless the latest reconciliation
confirms that the broker has at least `quantity_open` contracts for the same
`ibkr_con_id`.

## Lifecycle

### Buy Recording

1. Resolve the option contract through IBKR quote data.
2. Upsert `trading.option_contract`.
3. Insert a `BUY` `trading.order_intent` with status `draft` or
   `pending_submit`.
4. Preview or submit the broker order.
5. Insert the broker response into `trading.broker_event`.
6. When the fill is confirmed, create or update `trading.option_lot`.
7. Optionally mirror the open lot to `option_position` for the current UI.

### Sell Timer

The scheduler should run a lightweight loop every 30-60 seconds:

```sql
SELECT *
FROM trading.option_lot
WHERE status = 'open'
  AND quantity_open > 0
  AND next_check_at <= now()
ORDER BY next_check_at ASC
LIMIT 20
FOR UPDATE SKIP LOCKED;
```

For each locked lot:

1. Check `manual_hold` status and enabled `exit_rule` rows.
2. Mark ripe if `now() >= ripen_at`.
3. Also mark ripe if expiration is within `close_before_expiration_days`.
4. Confirm broker position reconciliation.
5. Insert one `SELL` `order_intent` using a deterministic idempotency key.
6. Change lot status from `open` to `closing`.
7. Submit only when `AUTO_SELL_ENABLED=true`.
8. When the sell fills, set `quantity_open = 0` and `status = 'closed'`.
9. Optionally mirror the closed result into `closed_position`.

### Expiration Handling

If a lot reaches expiration without a confirmed sale:

- Set `status = 'expired'` only after confirming the broker no longer shows the
  position or after manual review.
- Insert a `broker_event` explaining the reason.
- Do not silently delete lots.

## Environment Flags

Use explicit kill switches for trading behavior.

```env
TRADING_DATABASE_URL=postgresql+psycopg2://trading_user:<password>@db:5432/market_db
AUTO_TRADING_ENABLED=false
AUTO_BUY_ENABLED=false
AUTO_SELL_ENABLED=false
IBKR_TRADING_PROFILE=gateway-paper-scheduler
IBKR_TRADING_ACCOUNT=
TRADING_MAX_CONTRACTS_PER_ORDER=1
TRADING_SELL_CHECK_INTERVAL_SECONDS=60
TRADING_CLOSE_BEFORE_EXPIRATION_DAYS=1
```

Initial rollout should use:

```env
AUTO_TRADING_ENABLED=false
AUTO_BUY_ENABLED=false
AUTO_SELL_ENABLED=false
```

This allows agents to create order intents and audit rows without submitting
broker orders.

## Compatibility With Agent Workflow

`docs/Agent_IBKR_interface.md` must use these exact concepts:

- Contract identity: `trading.option_contract`.
- Open lot: `trading.option_lot`.
- Broker action queue: `trading.order_intent`.
- Audit trail: `trading.broker_event`.
- Reconciliation table: `trading.position_reconciliation`.
- Timed exit field: `option_lot.ripen_at`.
- Expiration guard: `option_lot.close_before_expiration_days`.
- Duplicate prevention: `order_intent.idempotency_key`.

Agent-managed prototypes may insert and update these rows directly. The later
robust API should preserve the same state model and hide direct SQL writes
behind service methods.

## Deployment Notes

Schema changes should be introduced with Alembic migrations. Do not rely on
runtime `Base.metadata.create_all()` for these trading tables.

Before enabling live submissions:

- Verify backup coverage for `market-diagnostic-dashboard_market_db`.
- Verify `market_ibgateway` is logged in and paper mode is active.
- Verify `ibkr-cli` can connect from `market_scheduler`.
- Verify `AUTO_SELL_ENABLED` is false until preview and reconciliation flows are
  proven.
- Verify no public port exposes Postgres or IB Gateway API access.

