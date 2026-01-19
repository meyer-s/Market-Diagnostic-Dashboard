# API Contract (Draft)
Date: 2026-01-19

## Conventions
- Base URL: `/api`
- Response naming: snake_case (frontend consumes fields as-is).
- Time series: use `timestamp` or `date` strings in ISO-8601, plus numeric projections where needed.
- When present, `state` values are `GREEN`, `YELLOW`, `RED`.

## Health
- `GET /health`
  - Response: `{ status: "ok" }`
  - Consumers: deployment checks

## System Status
- `GET /system`
  - Response fields: `timestamp`, `composite_score`, `state`, `red_count`, `yellow_count`, `green_count` (as formatted)
  - Consumers: `SystemOverviewWidget`, `Dashboard`
- `GET /system/history?days=365`
  - Params: `days` (int)
  - Response fields: `timestamp`, `composite_score`, `state`, `red_count`, `yellow_count`
  - Consumers: `SystemOverviewWidget`, `SystemBreakdown`

## Indicators
- `GET /indicators`
  - Response fields: `code`, `name`, `description`, `weight`, `state`, `score` (when available)
  - Consumers: `Dashboard`, `Indicators`, `SystemBreakdown`
- `GET /indicators/{code}`
  - Response fields: `code`, `name`, `latest` (with `timestamp`, `raw_value`, `normalized_value`, `score`, `state`), `metadata`
  - Consumers: `IndicatorDetail`
- `GET /indicators/{code}/history?days=365`
  - Params: `days` (int)
  - Response fields: list of `{ timestamp, raw_value, normalized_value, score, state }`
  - Consumers: `IndicatorDetail`, `SystemBreakdown`
- `GET /indicators/{code}/components` and special cases:
  - `/indicators/BOND_MARKET_STABILITY/components`
  - `/indicators/LIQUIDITY_PROXY/components`
  - `/indicators/ANALYST_ANXIETY/components`
  - `/indicators/ANALYST_CONFIDENCE/components`
  - `/indicators/SENTIMENT_COMPOSITE/components`
  - Response fields: component-specific nested fields (see `IndicatorDetail`)
  - Consumers: `IndicatorDetail`

## Dow Theory
- `GET /dow-theory`
  - Response fields: `signal`, `strain_level`, `primary_trend`, `confirmation_status`, `last_updated`
  - Consumers: `DowTheoryWidget`
- `GET /dow-theory/history?days=365`
  - Params: `days` (int)
  - Response fields: time series of strain/confirmation metrics
  - Consumers: `DowTheoryWidget`

## News
- `GET /news?hours=24&limit=200&symbol=...`
  - Params: `hours`, `limit`, `symbol` (optional)
  - Response fields: list of `{ id, title, source, published_at, url, summary, symbol }`
  - Consumers: `Dashboard`, `MarketNews`, `StockAnalysis`
- `POST /news/refresh`
  - Response fields: refresh status and counts
  - Consumers: `MarketNews`
- `GET /news/tickers`, `PUT /news/tickers`, `GET /news/ticker-presets`
  - Response fields: ticker lists and preset metadata
  - Consumers: `MarketNews`

## Market Map
- `GET /market-map/data?days=5`
  - Params: `days` (int)
  - Response fields: `sectors` (list of sector + stocks), `week_performance`
  - Consumers: `MarketMap`
- `GET /market-map/spy-intraday`
  - Response fields: intraday time series for indices
  - Consumers: `MarketMap`

## Sectors
- `GET /sectors/summary`
  - Response fields: `as_of`, `spread`, `alignment_score`, `defensive_avg`, `cyclical_avg`
  - Consumers: `SectorDivergenceWidget`
- `GET /sectors/alerts`
  - Response fields: alert list with `type`, `severity`, `message`, `timestamp`
  - Consumers: `SectorAlertsWidget`, `SectorDivergenceWidget`
- `GET /sectors/projections/latest`
  - Response fields: `projections` by horizon (`T`, `3m`, `6m`, `12m`), `system_state`, `as_of_date`
  - Consumers: `SectorProjections`, `MarketMap`
- `GET /sectors/projections/history?days=365`
  - Params: `days` (int)
  - Response fields: history keyed by sector + horizon
  - Consumers: `SectorProjections`
- `GET /sectors/projections/warnings`
  - Response fields: warning list
  - Consumers: `SectorProjections` (if wired)

## Stocks
- `GET /stocks/{ticker}/projections`
  - Response fields: projections across horizons plus `technicals`, `history`, `news`
  - Consumers: `StockAnalysis`

## Precious Metals
- `GET /precious-metals/regime`
  - Response fields: `regime`, `overall_regime`, `paper_physical_risk`, `gold_bias`
  - Consumers: `PreciousMetalsWidget`, `PreciousMetalsDiagnostic`
- `GET /precious-metals/projections/latest`
  - Response fields: list of metals with `score_total`, `classification`, `relative_classification`
  - Consumers: `PreciousMetalsWidget`, `PreciousMetalsDiagnostic`
- `GET /precious-metals/cb-holdings`, `/precious-metals/supply`, `/precious-metals/demand`
  - Response fields: per-metal data tables
  - Consumers: `PreciousMetalsDiagnostic`
- `GET /precious-metals/market-caps`, `/precious-metals/market-caps/history`
  - Response fields: aggregate caps + history
  - Consumers: `PreciousMetalsDiagnostic`
- `GET /precious-metals/correlations`
  - Response fields: correlation matrix
  - Consumers: `PreciousMetalsDiagnostic`
- `GET /precious-metals/history/{metal}?days=365`
  - Params: `metal`, `days`
  - Response fields: time series of `{ date, price }`
  - Consumers: `PreciousMetalsDiagnostic`

## Alternative Assets (AAP)
- `GET /aap/current`
  - Response fields: `stability_score`, `regime`, `components`, `metals_contribution`, `crypto_contribution`
  - Consumers: `AASWidget`, `AlternativeAssetStability`
- `GET /aap/history?days=365`
  - Params: `days`
  - Response fields: time series of stability scores and subsystems
  - Consumers: `AlternativeAssetStability`
- `GET /aap/components/breakdown`, `/aap/components/history?days=365`
  - Params: `days`
  - Response fields: component breakdowns and histories
  - Consumers: `AlternativeAssetStability`, `AAPComponentBreakdown`
- `GET /aap/regime/current`, `/aap/regime/history`
  - Response fields: regime history
  - Consumers: `AlternativeAssetStability`
- `GET /aap/dashboard`
  - Response fields: AAP snapshot for dashboard
  - Consumers: `Dashboard` (if wired)

## Admin (internal)
- `POST /admin/ingest/run`, `POST /admin/ingest/{code}`, `POST /admin/backfill`
  - Response fields: job status, counts
  - Consumers: `Dashboard`
- `POST /admin/clear-refetch/{code}?days=365`
  - Params: `days`
  - Response fields: clear + refetch status
  - Consumers: `IndicatorDetail`
