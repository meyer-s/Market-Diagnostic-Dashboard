# Alternative Assets

This document replaces the older AAS rollout summaries and records the active split between the metals and crypto research surfaces.

## Scope

The cross-asset subsystem now covers:

- the legacy AAS backend aggregate used by dashboard evidence
- precious metals diagnostics
- crypto diagnostics

Key frontend routes:

- `/metals-indicators`
- `/crypto-indicators`

`/aas-breakdown` is retired and intentionally absent from the route registry.
`/indicators/AAS` is transition guidance rather than an aggregate research surface, and
`/precious-metals` remains only as a redirect to `/metals-indicators` for older bookmarks.

Key backend routes from `backend/app/api/aas.py`:

- `GET /aas/current`
- `GET /aas/history`
- `GET /aas/components/breakdown`
- `GET /aas/components/current`
- `GET /aas/components/history`
- `GET /aas/regime/current`
- `GET /aas/regime/history`
- `GET /aas/dashboard`

## Current State

This repo no longer needs point-in-time "10 of 18" or "ready for deployment" memos at the top level. The live code and endpoints are the source of truth.

What matters now:

- AAS remains a backend aggregate with its own API surface and a compact dashboard contributor.
- Metals and crypto each have a supported, independent frontend diagnostic.
- New navigation, documentation, and tests must point to the split routes rather than reviving the retired aggregate page.

## Core Files

Backend:

- `backend/app/api/aas.py`
- the AAS calculation service in `backend/app/services/`
- `backend/backfill_aas.py`
- `backend/backfill_aas_weekly.py`

Frontend:

- `frontend/src/pages/PreciousMetalsDiagnostic.tsx`
- `frontend/src/pages/CryptoDiagnostic.tsx`
- `frontend/src/components/widgets/AASWidget.tsx` (dashboard summary only)

## Data and Refresh Flow

Alternative-assets data is refreshed through the broader ingestion and scheduler flow. For targeted work, use the backend scripts already in the repo instead of maintaining one-off doc-driven deployment playbooks.

Common targeted scripts:

- `backend/backfill_aas.py`
- `backend/backfill_aas_weekly.py`
- `backend/fetch_cb_holdings.py`
- `backend/fetch_comex_data.py`
- `backend/fetch_extended_crypto.py`

Use these deliberately. They are operational tools, not a separate deployment system. The former
interactive `refresh_aas_data.py` orchestrator was removed because it referenced retired models and
estimated legacy components; scheduled ingestion and the targeted scripts above are the supported
refresh paths.

## Precious Metals

The metals diagnostic is the supported `/metals-indicators` surface and relies on its own backend routes, history endpoints, and market-cap context.

If you need the historical specification work, that older material remains in `archive/`.

## Crypto

The crypto diagnostic is the supported `/crypto-indicators` surface. It focuses on BTC, ETH, SOL, and XRP and uses dedicated backend routes for market overview and diagnostic context.

Current routes in the backend include:

- `GET /crypto/market-overview`
- `GET /crypto/diagnostic-context`

The current frontend implementation uses raw-price charting and relative leadership views rather than earlier rebased overview charts.

## Working Rules

When updating this part of the app:

1. Treat the API routes and frontend pages as the source of truth.
2. Do not restore a combined AAS research surface; legacy deep links may only point users separately to metals and crypto.
3. Avoid writing new status memos that freeze the system to one deployment moment.
4. Keep temporary rollout notes in commits or issue tracking, not in top-level docs.

## Related Docs

- `docs/deployment.md` for deploy and verification workflow
- `docs/api-contract.md` for API coverage
