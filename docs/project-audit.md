# Project Audit: Market Stability Diagnostic
Date: 2026-01-19

## Architecture Map (High Level)

### Backend (FastAPI)
- App entry: `backend/app/main.py`
- API routers: `backend/app/api/*.py` (indicators, system status, market map, sector projections, metals, AAP)
- Services:
  - Core calculations: `backend/app/services/*.py`
  - Ingestion/scheduler: `backend/app/services/ingestion/*`, `backend/app/services/scheduler.py`
- Models: `backend/app/models/*.py`
- Utilities: `backend/app/utils/*.py`
- Data/config: `backend/app/data/*`
- One-off scripts and backfills: `backend/*.py`, `backend/maintenance_scripts/*`

### Frontend (React + Vite)
- Routing: `frontend/src/App.tsx`
- Pages: `frontend/src/pages/*.tsx`
- Widgets/cards: `frontend/src/components/widgets/*`
- AAP subsystem UI: `frontend/src/components/aap/*`
- Hooks: `frontend/src/hooks/*`
- Shared utils + theme: `frontend/src/utils/*`, `frontend/src/theme/*`

### Shared (Cross-layer)
- No shared package; API contract is implicit between FastAPI responses and frontend fetches.

## Key Routes and Endpoints

### Frontend Routes -> Pages
- `/` -> `Dashboard`
- `/indicators` -> `Indicators`
- `/indicators/:code` -> `IndicatorDetail`
- `/news` -> `MarketNews`
- `/system-breakdown` -> `SystemBreakdown`
- `/market-map` -> `MarketMap`
- `/sector-projections` -> `SectorProjections`
- `/stock-analysis` -> `StockAnalysis`
- `/precious-metals` -> redirect to `/alternative-assets?tab=metals`
- `/alternative-assets` -> `AlternativeAssetStability`
- `/aap-breakdown` -> `AAPComponentBreakdown`

### Backend Endpoints -> Pages/Widgets
- `/health` -> deployment health checks
- `/system`, `/system/history` -> `SystemOverviewWidget`, `Dashboard`
- `/indicators`, `/indicators/{code}`, `/indicators/{code}/history` -> `Dashboard`, `Indicators`, `IndicatorDetail`, `SystemBreakdown`
- `/indicators/{code}/components` and special cases:
  - `/indicators/BOND_MARKET_STABILITY/components`
  - `/indicators/LIQUIDITY_PROXY/components`
  - `/indicators/ANALYST_ANXIETY/components`
  - `/indicators/ANALYST_CONFIDENCE/components`
  - `/indicators/SENTIMENT_COMPOSITE/components`
  -> `IndicatorDetail`
- `/dow-theory`, `/dow-theory/history` -> `DowTheoryWidget`
- `/news`, `/news/refresh`, `/news/tickers`, `/news/ticker-presets` -> `MarketNews`, `Dashboard`, `StockAnalysis`
- `/market-map/data`, `/market-map/spy-intraday` -> `MarketMap`
- `/sectors/summary`, `/sectors/alerts` -> `SectorDivergenceWidget`, `SectorAlertsWidget`
- `/sectors/projections/latest`, `/sectors/projections/history`, `/sectors/projections/warnings` -> `SectorProjections`, `MarketMap`
- `/stocks/{ticker}/projections` -> `StockAnalysis`
- `/precious-metals/regime`, `/precious-metals/projections/latest` -> `PreciousMetalsWidget`, `PreciousMetalsDiagnostic`
- `/precious-metals/cb-holdings`, `/precious-metals/supply`, `/precious-metals/demand`, `/precious-metals/market-caps`, `/precious-metals/market-caps/history`, `/precious-metals/correlations`, `/precious-metals/history/{metal}` -> `PreciousMetalsDiagnostic`
- `/aap/current`, `/aap/history`, `/aap/components/breakdown`, `/aap/components/history`, `/aap/regime/*` -> `AASWidget`, `AlternativeAssetStability`, `AAPComponentBreakdown`
- `/admin/ingest/*`, `/admin/clear-refetch/*` -> admin actions in `Dashboard`, `IndicatorDetail`

## Bloat and Duplication Checklist

### Frontend
- API calls use multiple patterns (`useApi`, `fetch` + `getLegacyApiUrl`, `buildApiUrl`, direct `/api/*`).
- Repeated chart axis/tooltip styling and date formatting across pages.
- Repeated "state" color/pill logic across `styleUtils`, `stabilityConstants`, and component-local helpers.
- Multiple page variants for AAP (e.g., `AlternativeAssetPressure` vs `AlternativeAssetStability`).
- Redundant date formatting helpers: `styleUtils` vs inline `new Date().toLocaleDateString`.

### Backend
- Multiple indicator component endpoints in `indicators.py` plus a second `/indicators` in `status.py`.
- ETL/backfill scripts live in multiple locations (`backend/*.py`, `backend/maintenance_scripts/*`) without a shared registry.
- Response shape conventions vary (snake_case vs camelCase, timestamps named differently).

### Cross-layer
- No single API contract document; implicit coupling between frontend and backend.
- Mixed naming for time range parameters (`days`, `hours`, implicit ranges).
