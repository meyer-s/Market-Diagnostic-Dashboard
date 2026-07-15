# Agent IBKR Interface

This document tells coding agents how to interact with the current Dockerized
IBKR setup and how to keep the proposed trading database in sync while buying
and selling option contracts.

This is a rapid-prototyping interface. The long-term target is a robust backend
API that owns all validation, idempotency, order placement, reconciliation, and
audit logging.

## Hard Rules

- Do not restart, recreate, or modify `market_ibgateway` unless explicitly told.
- Use paper profiles only unless explicitly told otherwise.
- For automated trading work, prefer the scheduler profile:
  `gateway-paper-scheduler`.
- Do not use `ibkr buy AAPL ...` or `ibkr sell AAPL ...` to trade options. In
  the current installed `ibkr-cli`, top-level `buy` and `sell` are stock-order
  commands.
- For option orders, use `ibkr-cli` for config/session access and either a
  local option-order wrapper or direct Python code built on `ibkr_cli.config`,
  `ibkr_cli.ib_service.ib_session`, and `ib_async.Option`.
- Every broker action must have a matching row in `trading.order_intent`.
- Every broker response must be inserted into `trading.broker_event`.
- Never submit a duplicate order when an existing `idempotency_key` exists.

## Current Runtime

Server SSH alias:

```bash
ssh marketdash
```

Repository on server:

```text
/home/ubuntu/Market-Diagnostic-Dashboard
```

Relevant containers:

- `market_ibgateway`: logged-in IB Gateway with noVNC and API proxy.
- `market_backend`: FastAPI backend, Docker IP `172.18.0.5`.
- `market_scheduler`: scheduler worker, Docker IP `172.18.0.4`.
- `market_postgres`: Postgres database.

The compose override mounts an untracked config file into backend and scheduler:

```text
devops/env/ibkr-cli-config.toml
```

Expected profile shape:

```toml
default_profile = "gateway-paper"

[profiles.gateway-paper]
host = "ibgateway"
port = 4003
client_id = 11
mode = "paper"

[profiles.gateway-paper-scheduler]
host = "ibgateway"
port = 4003
client_id = 12
mode = "paper"

[profiles.gateway-live]
host = "ibgateway"
port = 4001
client_id = 11
mode = "live"
```

Port `4003` is the in-container API proxy. It is reachable from backend and
scheduler on the Docker network. It is not published to the host.

## Where To Run Commands

Run read-only checks inside `market_backend` or `market_scheduler`.

Backend profile check:

```bash
ssh marketdash 'docker exec market_backend ibkr connect --profile gateway-paper --json'
```

Scheduler profile check:

```bash
ssh marketdash 'docker exec market_scheduler ibkr connect --profile gateway-paper-scheduler --json'
```

For trading automation, prefer:

```bash
ssh marketdash 'docker exec market_scheduler <command>'
```

This keeps order client ID usage separate from backend quote and API work.

## Read-Side IBKR Commands

Underlying quote:

```bash
ssh marketdash 'docker exec market_scheduler ibkr quote AAPL --profile gateway-paper-scheduler --json'
```

Historical bars:

```bash
ssh marketdash 'docker exec market_scheduler ibkr bars AAPL --profile gateway-paper-scheduler --duration "1 Y" --bar-size "1 day" --json'
```

Option chain metadata:

```bash
ssh marketdash 'docker exec market_scheduler ibkr options chain AAPL --profile gateway-paper-scheduler --json'
```

Option quotes:

```bash
ssh marketdash 'docker exec market_scheduler ibkr options quotes AAPL 20260320 --profile gateway-paper-scheduler --right C --strike 150 --strike 155 --json'
```

Open orders:

```bash
ssh marketdash 'docker exec market_scheduler ibkr orders open --profile gateway-paper-scheduler --json'
```

Completed orders:

```bash
ssh marketdash 'docker exec market_scheduler ibkr orders completed --profile gateway-paper-scheduler --api-only --json'
```

Executions:

```bash
ssh marketdash 'docker exec market_scheduler ibkr orders executions --profile gateway-paper-scheduler --json'
```

Positions:

```bash
ssh marketdash 'docker exec market_scheduler ibkr positions --profile gateway-paper-scheduler --json'
```

## Current Option-Order Limitation

The installed `ibkr-cli` exposes top-level `buy` and `sell`, but those commands
call `submit_stock_order` internally. They qualify a stock contract from the
symbol argument.

That means this is appropriate for stock orders:

```bash
ibkr buy AAPL 1 --profile gateway-paper-scheduler --type MKT --preview --json
```

It is not sufficient for buying or selling an option contract selected by
expiration, strike, right, or `ibkr_con_id`.

For the prototype, option execution should use a small project-local wrapper
that reuses `ibkr-cli` connection config and `ib_session` but places an
`ib_async.Option` order. The wrapper should accept:

- `--profile gateway-paper-scheduler`
- `--action BUY|SELL`
- `--symbol AAPL`
- `--expiration 20260320`
- `--right C|P`
- `--strike 150`
- `--quantity 1`
- `--type LMT|MKT`
- `--limit <price>` for limit orders
- `--account <account>` when needed
- `--preview` or `--submit`
- `--json`

Until that wrapper exists, agents may use `ibkr-cli` to quote, reconcile, and
record database state, but should not claim automated option execution is fully
implemented.

## Database Contract

The database state model is defined in `docs/contract_db.md`.

Agent code and manual agent operations must use these tables:

- `trading.option_contract`
- `trading.option_lot`
- `trading.exit_rule`
- `trading.order_intent`
- `trading.broker_event`
- `trading.position_reconciliation`

Important fields:

- Timed sell trigger: `trading.option_lot.ripen_at`
- Expiration guard: `trading.option_lot.close_before_expiration_days`
- Open quantity: `trading.option_lot.quantity_open`
- Duplicate order guard: `trading.order_intent.idempotency_key`
- Broker order tracking: `trading.order_intent.ibkr_order_id`,
  `trading.order_intent.ibkr_perm_id`

## Buy Workflow

Use this workflow when an agent buys a paper option contract.

### 1. Resolve And Quote Contract

Fetch the option quote:

```bash
ssh marketdash 'docker exec market_scheduler ibkr options quotes AAPL 20260320 --profile gateway-paper-scheduler --right C --strike 150 --json'
```

From the JSON row, capture:

- `symbol`
- `local_symbol`
- `con_id`
- `expiration`
- `strike`
- `right` from IBKR JSON, stored in the database as `option_right`
- `trading_class`
- `multiplier`
- `bid`
- `ask`
- `last`
- `implied_vol`
- `delta`

Use bid/ask mid for limit-price planning when both are positive. Use last only
as fallback.

### 2. Upsert `trading.option_contract`

Normalize:

- `option_right`: IBKR `right` value `C` becomes `CALL`; `P` becomes `PUT`.
- `expiration`: store as `DATE`.
- `strike`: store numeric.
- `multiplier`: store `100` unless IBKR reports otherwise.

The unique key should be:

```text
underlying_symbol, option_right, strike, expiration, exchange, currency
```

Store `ibkr_con_id` when present.

### 3. Insert `trading.order_intent`

Insert a `BUY` intent before submitting the broker order.

Required values:

- `contract_id`
- `side = 'BUY'`
- `quantity`
- `order_type`
- `limit_price` when `order_type = 'LMT'`
- `status = 'draft'` or `status = 'pending_submit'`
- `ibkr_profile = 'gateway-paper-scheduler'`
- `idempotency_key`

Suggested key:

```text
buy:{source_alert_event_id}:{contract_id}:{quantity}:{requested_at_iso_minute}
```

If the insert fails on the unique constraint, fetch the existing intent and do
not submit a second order.

### 4. Preview Then Submit

For prototypes, preview first whenever possible. Once an option-order wrapper is
available, the command should look conceptually like:

```bash
ssh marketdash 'docker exec market_scheduler python -m app.tools.ibkr_option_order \
  --profile gateway-paper-scheduler \
  --action BUY \
  --symbol AAPL \
  --expiration 20260320 \
  --right C \
  --strike 150 \
  --quantity 1 \
  --type LMT \
  --limit 2.10 \
  --preview \
  --json'
```

Then submit:

```bash
ssh marketdash 'docker exec market_scheduler python -m app.tools.ibkr_option_order \
  --profile gateway-paper-scheduler \
  --action BUY \
  --symbol AAPL \
  --expiration 20260320 \
  --right C \
  --strike 150 \
  --quantity 1 \
  --type LMT \
  --limit 2.10 \
  --submit \
  --json'
```

After each preview or submit response:

- Update `trading.order_intent.status`.
- Store `ibkr_order_id` and `ibkr_perm_id` when present.
- Insert the complete JSON response into `trading.broker_event`.

### 5. Create `trading.option_lot` On Fill

Only create or open a lot after a confirmed fill.

Use:

- `quantity_initial = filled quantity`
- `quantity_open = filled quantity`
- `avg_entry_price = average fill price`
- `status = 'open'`
- `ripen_at = intended sell time`
- `expires_at = option expiration close timestamp`
- `close_before_expiration_days = configured safety value`

Also insert an `exit_rule` row:

```text
rule_type = 'time'
sell_after = option_lot.ripen_at
enabled = true
```

Optionally mirror the open lot into the current `option_position` UI table, but
the `trading.option_lot` row remains the execution source of truth.

## Automatic Sell Workflow

The automatic seller should run inside `market_scheduler`.

### 1. Find Due Lots

Use row locks so only one worker processes a lot:

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

A lot is ripe when:

- `now() >= ripen_at`, or
- expiration is within `close_before_expiration_days`.

Do not process lots in `manual_hold`.

### 2. Reconcile Before Selling

Fetch positions:

```bash
ssh marketdash 'docker exec market_scheduler ibkr positions --profile gateway-paper-scheduler --json'
```

Compare broker positions to `trading.option_contract.ibkr_con_id`.

Insert a row into `trading.position_reconciliation` for every checked contract.

Do not submit a sell if:

- broker quantity is missing,
- broker quantity is less than `quantity_open`,
- `ibkr_con_id` cannot be matched,
- there is already an active `SELL` intent for the lot.

### 3. Insert A `SELL` Intent

Use a deterministic idempotency key:

```text
sell:{lot_id}:{quantity_open}:{contract_id}:{ripen_at_iso_date}
```

Insert:

- `side = 'SELL'`
- `quantity = option_lot.quantity_open`
- `status = 'pending_submit'`
- `order_type = 'LMT'` when a reliable quote exists, otherwise `MKT` only if
  explicitly allowed by config
- `ibkr_profile = 'gateway-paper-scheduler'`

If the unique key already exists, do not submit another sell.

Set the lot status to `closing`.

### 4. Submit The Sell

Only submit when all are true:

- `AUTO_TRADING_ENABLED=true`
- `AUTO_SELL_ENABLED=true`
- reconciliation status is `match`
- the order intent is still `pending_submit`

Conceptual wrapper command:

```bash
ssh marketdash 'docker exec market_scheduler python -m app.tools.ibkr_option_order \
  --profile gateway-paper-scheduler \
  --action SELL \
  --symbol AAPL \
  --expiration 20260320 \
  --right C \
  --strike 150 \
  --quantity 1 \
  --type LMT \
  --limit 2.35 \
  --submit \
  --json'
```

After submission:

- Update `trading.order_intent.status = 'submitted'`.
- Store `ibkr_order_id` and `ibkr_perm_id`.
- Insert the complete broker response into `trading.broker_event`.

### 5. Confirm Fill

Poll:

```bash
ssh marketdash 'docker exec market_scheduler ibkr orders completed --profile gateway-paper-scheduler --api-only --json'
ssh marketdash 'docker exec market_scheduler ibkr orders executions --profile gateway-paper-scheduler --json'
```

When filled:

- Set `order_intent.status = 'filled'`.
- Set `order_intent.avg_fill_price`.
- Set `order_intent.filled_at`.
- Reduce `option_lot.quantity_open`.
- If `quantity_open = 0`, set `option_lot.status = 'closed'`.
- Insert fill payload into `trading.broker_event`.
- Optionally mirror the closed trade into `closed_position`.

## Failure Handling

If IBKR is unreachable:

- Do not mark the lot closed.
- Keep or return the lot to `open`.
- Set `next_check_at` to a short backoff, such as `now() + interval '5 minutes'`.
- Insert a `broker_event` with the error payload.

If order submission is rejected:

- Set `order_intent.status = 'rejected'` or `error`.
- Return the lot to `open` unless the broker shows an active order.
- Set `next_check_at` for retry or manual review.
- Insert the rejection JSON into `broker_event`.

If a duplicate intent exists:

- Use the existing row.
- Do not create a second broker order.
- Reconcile the existing intent through `orders open`, `orders completed`, and
  `orders executions`.

If a lot is near expiration and cannot be sold:

- Leave a visible `error` or `manual_hold` state.
- Do not silently expire it without reconciliation.

## Prototype-To-API Migration

The agent-managed workflow is intentionally direct:

- agents query IBKR,
- agents insert/update `trading.*` rows,
- agents submit orders through a wrapper,
- agents reconcile and update status.

The future API should keep the same durable model but move these actions behind
backend service methods:

- `POST /trading/contracts/resolve`
- `POST /trading/lots`
- `POST /trading/order-intents/{id}/preview`
- `POST /trading/order-intents/{id}/submit`
- `POST /trading/reconcile`
- `POST /trading/lots/{id}/hold`
- `POST /trading/lots/{id}/release`

Until that API exists, agents must treat `docs/contract_db.md` and this file as
the operational contract.
