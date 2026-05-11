# Agriculture Context Overhaul

## Purpose

This overhaul adds a modular agriculture market-context system alongside the existing agriculture index. The new path is designed for symbol-level contextual reads, source-health visibility, and thesis validation instead of a single monolithic dashboard calculation.

## New Architecture

### Reused surfaces

- `backend/app/services/ingestion/yahoo_client.py` remains the market-price input for the technical snapshot.
- `frontend/src/hooks/useApi.ts` remains the fetch primitive for frontend integration.
- `frontend/src/pages/AgricultureIndex.tsx` remains the existing agriculture landing page and now hosts the new context panel.

### New reusable backend modules

- `backend/app/services/market_context/types.py`
  Source descriptors, freshness classification, and normalized payload primitives.
- `backend/app/services/market_context/agriculture_metadata.py`
  Commodity metadata, mapped weather regions, and report relevance.
- `backend/app/services/market_context/session.py`
  Reusable CBOT grains and oilseeds session logic.
- `backend/app/services/market_context/crop_stage.py`
  Reusable crop-stage and weather-sensitivity logic.
- `backend/app/services/market_context/agriculture_adapters.py`
  Official-source adapters for NOAA weather, USDA AMS export inspections, WASDE parsing, global supply context, and report calendar projection.
- `backend/app/services/market_context/scoring.py`
  Explainable component scoring and setup synthesis.
- `backend/app/services/market_context/thesis.py`
  Market-read generation and structured thesis validation.
- `backend/app/services/agriculture_market_context.py`
  Aggregate orchestration for `/agriculture/context`.

### Extended API surface

- `backend/app/api/agriculture.py`
  Adds `/agriculture/context?symbol=...` while retaining the legacy overview and stability endpoints.

### New frontend surface

- `frontend/src/components/agriculture/AgricultureContextPanel.tsx`
  Symbol selector, live thesis panel, module cards, score breakdown, and thesis validation display.

## Official Data Decisions

### Implemented now

- NOAA National Weather Service forecast data via `api.weather.gov`
- USDA WASDE text reports for domestic balance-sheet and world-supply parsing
- USDA AMS export inspections text report `wa_gr101.txt`
- USDA report calendar projection using recurring release timing plus the WASDE page

### Intentionally insufficient instead of fabricated

- USDA NASS Crop Progress values are not reliably machine-readable from the current official PDF/chart surface in this environment.
- The Crop Progress module therefore reports a clear insufficiency state instead of invented values.

## Legacy Relationship

- The legacy agriculture index in `backend/app/services/agriculture_index.py` is still the source for stability, breadth, and multi-sector composite views.
- The new agriculture context path is the symbol-level contextual layer for thesis generation and validation.
- The existing page now exposes both, rather than replacing the legacy stability work outright.

## Validation Completed

- `backend/tests/test_agriculture_context_core.py`
- `backend/tests/test_agriculture_context_logic.py`
- Direct runtime probe of `build_agriculture_market_context("ZC")`

## Known Gaps

- Crop Progress remains metadata-only until a reliable parser or structured upstream feed is available.
- WASDE parsing is intentionally conservative and can return `insufficient_data` when a table shape changes.
- Deployment and SSH runtime validation still need to be completed through the repository's git-based workflow.
