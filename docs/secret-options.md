# Secret Options

This document consolidates the operational notes that were previously split between the trade-management and Greeks summary files.

## Scope

The Secret Options feature lives at `/secret/options` and is backed by `backend/app/api/secret_options.py`.

Current API surface includes:

- `GET /secret/options/positions`
- `POST /secret/options/positions`
- `PUT /secret/options/positions/{position_id}`
- `DELETE /secret/options/positions/{position_id}`
- `GET /secret/options/greeks/{position_id}`
- `GET /secret/options/closed-positions`
- `POST /secret/options/attribution/backfill`
- `GET /secret/options/scanner-summary`
- `POST /secret/options/scanner-run`
- `GET /secret/options/scanner-run/{run_id}`
- `POST /secret/options/scanner-run/{run_id}/stop`

## Trade Management

The current implementation supports:

- adding positions
- editing active positions
- closing positions
- tracking closed-position history
- calculating realized dollar and percent P/L

The close-position flow moves an active record into the closed-position history model and stores the realized result.

Relevant backend pieces:

- `backend/app/api/secret_options.py`
- `backend/app/models/closed_positions.py`
- `backend/migrations/add_closed_positions.sql`

Relevant frontend page:

- `frontend/src/pages/SecretOptions.tsx`

## Scanner Workspace

Desktop Secret Options has separate **Positions** and **Scanner** tabs. Mobile
retains the Positions / Scanner / Insights workspace switcher. Scanner history
groups persisted runs by the America/New_York calendar day and labels each run
with its Eastern time and trigger source, so intraday sweeps can be reviewed as
one daily evidence set. After basic data validation, candidate admission uses
one rule: the canonical 30-day IV current-chain percentile must be at or below
the selected threshold. IV/HV, EDR, contract quality, execution quality,
recurrence, and learned context rank and explain admitted candidates; they do
not veto admission. Bounded sweeps select expiries nearest the 30-day target
instead of consuming their budget on the first few daily or weekly expiries.

The scheduler worker starts an S&P 500 sweep on market weekdays at 10:00 AM,
12:00 PM, and 2:00 PM America/New_York. Scheduled sweeps use the same persisted
run and hit pipeline as manually started dashboard sweeps. The 30-day IV
current-chain percentile threshold defaults to 30 and can be overridden with
`SCHEDULED_SP500_SCANNER_THRESHOLD`.

## Greeks Model

The Greeks calculation work was moved out of summary form and into the actual technical reference at `docs/greeks_model.md`.

That document is the detailed source for:

- model assumptions
- units and conventions
- volatility sourcing
- curve generation
- limitations and troubleshooting

## Operational Checks

For the Secret Options feature, verify the API before assuming a frontend issue.

Useful checks:

```bash
curl http://localhost:8000/secret/options/positions
curl http://localhost:8000/secret/options/closed-positions
```

For a specific position's Greeks:

```bash
curl http://localhost:8000/secret/options/greeks/<position_id>
```

## When To Update This Doc

Update this file when the feature set changes at the product level.

Do not add another implementation-summary document for a single patch or deployment. If the change is temporary or tied to one release, keep it in the commit history instead.

## Related Docs

- `docs/greeks_model.md`
- `docs/options-alerts.md`
- `docs/api-contract.md`
