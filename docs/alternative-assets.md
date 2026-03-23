# Alternative Assets

This document replaces the older AAS rollout summaries and keeps the active alternative-assets documentation in one place.

## Scope

The alternative-assets section now covers:

- the AAS backend and breakdown endpoints
- the frontend alternative-assets page
- precious metals diagnostics
- crypto diagnostics

Key frontend routes:

- `/alternative-assets`
- `/aap-breakdown`

Key backend routes from `backend/app/api/aap.py`:

- `GET /aap/current`
- `GET /aap/history`
- `GET /aap/components/breakdown`
- `GET /aap/components/current`
- `GET /aap/components/history`
- `GET /aap/regime/current`
- `GET /aap/regime/history`
- `GET /aap/dashboard`

## Current State

This repo no longer needs point-in-time "10 of 18" or "ready for deployment" memos at the top level. The live code and endpoints are the source of truth.

What matters now:

- AAS is a maintained subsystem with its own API surface.
- The frontend includes both the main alternative-assets page and the AAS breakdown view.
- crypto and precious metals each have their own diagnostic views under the broader alternative-assets section.

## Core Files

Backend:

- `backend/app/api/aap.py`
- `backend/app/services/aap_calculator.py`
- `backend/refresh_aap_data.py`
- `backend/backfill_aap.py`
- `backend/backfill_aap_weekly.py`

Frontend:

- `frontend/src/pages/AlternativeAssetStability.tsx`
- `frontend/src/pages/AAPComponentBreakdown.tsx`
- `frontend/src/pages/CryptoDiagnostic.tsx`

## Data and Refresh Flow

Alternative-assets data is refreshed through the broader ingestion and scheduler flow. For targeted work, use the backend scripts already in the repo instead of maintaining one-off doc-driven deployment playbooks.

Common scripts:

- `backend/refresh_aap_data.py`
- `backend/backfill_aap.py`
- `backend/backfill_aap_weekly.py`
- `backend/fetch_cb_holdings.py`
- `backend/fetch_comex_data.py`
- `backend/fetch_extended_crypto.py`

Use these deliberately. They are operational tools, not a separate deployment system.

## Precious Metals

The metals diagnostic remains part of the alternative-assets surface and relies on its own backend routes, history endpoints, and market-cap context.

If you need the historical specification work, that older material remains in `archive/`.

## Crypto

The crypto diagnostic is part of the active product now. It focuses on BTC, ETH, SOL, and XRP and uses dedicated backend routes for market overview and diagnostic context.

Current routes in the backend include:

- `GET /crypto/market-overview`
- `GET /crypto/diagnostic-context`

The current frontend implementation uses raw-price charting and relative leadership views rather than earlier rebased overview charts.

## Working Rules

When updating this part of the app:

1. Treat the API routes and frontend pages as the source of truth.
2. Avoid writing new status memos that freeze the system to one deployment moment.
3. Keep temporary rollout notes in commits or issue tracking, not in top-level docs.

## Related Docs

- `docs/deployment.md` for deploy and verification workflow
- `docs/api-contract.md` for API coverage
