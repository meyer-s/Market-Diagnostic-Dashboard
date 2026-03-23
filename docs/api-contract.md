# API Contract

Working reference for the current backend API surface used by the frontend.

## Conventions

- Base URL: `/api`
- Response naming: snake_case unless a legacy endpoint already returns a different shape
- Time series fields usually use `timestamp` or `date` in ISO-8601 form
- State values, when present, are `GREEN`, `YELLOW`, or `RED`

## Health

- `GET /health`
  - Response: `{ status: "ok" }`
  - Consumers: deployment checks

## System Status

- `GET /system`
  - Response fields: `timestamp`, `composite_score`, `state`, `red_count`, `yellow_count`, `green_count`
  - Consumers: dashboard and system overview widgets
- `GET /system/history?days=365`
  - Params: `days`
  - Response fields: `timestamp`, `composite_score`, `state`, `red_count`, `yellow_count`
  - Consumers: system overview and system breakdown views

## Indicators

- `GET /indicators`
  - Response fields: `code`, `name`, `description`, `weight`, `state`, `score`
  - Consumers: dashboard, indicators page, system breakdown
- `GET /indicators/{code}`
  - Response fields: `code`, `name`, `latest`, `metadata`
  - Consumers: indicator detail
- `GET /indicators/{code}/history?days=365`
  - Params: `days`
  - Response fields: `timestamp`, `raw_value`, `normalized_value`, `score`, `state`
  - Consumers: indicator detail and system breakdown
- `GET /indicators/{code}/components`
  - Includes special component payloads for bond market stability, liquidity proxy, analyst anxiety, analyst confidence, and sentiment composite
  - Consumers: indicator detail

## Dow Theory

- `GET /dow-theory`
  - Response fields: `signal`, `strain_level`, `primary_trend`, `confirmation_status`, `last_updated`
  - Consumers: Dow Theory widget
- `GET /dow-theory/history?days=365`
  - Params: `days`
  - Response fields: time series of strain and confirmation metrics
  - Consumers: Dow Theory widget

## News

- `GET /news?hours=24&limit=200&symbol=...`
  - Params: `hours`, `limit`, optional `symbol`
  - Response fields: `id`, `title`, `source`, `published_at`, `url`, `summary`, `symbol`
  - Consumers: dashboard, market news, stock analysis
- `POST /news/refresh`
  - Response fields: refresh status and counts
  - Consumers: market news
- `GET /news/tickers`
- `PUT /news/tickers`
- `GET /news/ticker-presets`
  - Response fields: ticker lists and preset metadata
  - Consumers: market news

## Market Map

- `GET /market-map/data?days=5`
  - Params: `days`
  - Response fields: `sectors`, `week_performance`
  - Consumers: market map
- `GET /market-map/spy-intraday`
  - Response fields: intraday time series for indices
  - Consumers: market map

## Sectors

- `GET /sectors/summary`
  - Response fields: `as_of`, `spread`, `alignment_score`, `defensive_avg`, `cyclical_avg`
  - Consumers: sector divergence widgets
- `GET /sectors/alerts`
  - Response fields: alert list with `type`, `severity`, `message`, `timestamp`
  - Consumers: sector alerts widgets
- `GET /sectors/projections/latest`
  - Response fields: `projections`, `system_state`, `as_of_date`
  - Consumers: sector projections and market map
- `GET /sectors/projections/history?days=365`
  - Params: `days`
  - Response fields: history keyed by sector and horizon
  - Consumers: sector projections
- `GET /sectors/projections/warnings`
  - Response fields: warning list
  - Consumers: sector projections where wired

## Stocks

- `GET /stocks/{ticker}/projections`
  - Response fields: projections plus `technicals`, `history`, `news`
  - Consumers: stock analysis

## Precious Metals

- `GET /precious-metals/regime`
  - Response fields: `regime`, `overall_regime`, `paper_physical_risk`, `gold_bias`
  - Consumers: precious metals widget and diagnostic page
- `GET /precious-metals/projections/latest`
  - Response fields: metal list with `score_total`, `classification`, `relative_classification`
  - Consumers: precious metals widget and diagnostic page
- `GET /precious-metals/cb-holdings`
- `GET /precious-metals/supply`
- `GET /precious-metals/demand`
- `GET /precious-metals/market-caps`
- `GET /precious-metals/market-caps/history`
- `GET /precious-metals/correlations`
  - Response fields: metals-specific tables, history, and correlation data
  - Consumers: precious metals diagnostic page
- `GET /precious-metals/history/{metal}?days=365`
  - Params: `metal`, `days`
  - Response fields: `{ date, price }`
  - Consumers: precious metals diagnostic page

## Alternative Assets

- `GET /aas/current`
  - Response fields: `stability_score`, `regime`, `components`, `metals_contribution`, `crypto_contribution`
  - Consumers: AAS widget and alternative-assets page
- `GET /aas/history?days=365`
  - Params: `days`
  - Response fields: stability-score history and subsystem history
  - Consumers: alternative-assets page
- `GET /aas/components/breakdown`
- `GET /aas/components/history?days=365`
  - Params: `days` where supported
  - Response fields: component breakdowns and histories
  - Consumers: alternative-assets page and AAS breakdown page
- `GET /aas/regime/current`
- `GET /aas/regime/history`
  - Response fields: regime snapshots and history
  - Consumers: alternative-assets page
- `GET /aas/dashboard`
  - Response fields: dashboard-facing AAS snapshot
  - Consumers: dashboard where wired

## Crypto

- `GET /crypto/market-overview`
  - Response fields: basket overview, price history, market structure history, liquidity context
  - Consumers: crypto diagnostic page
- `GET /crypto/diagnostic-context`
  - Response fields: narrative and supporting diagnostic context
  - Consumers: crypto diagnostic page

## Secret Options

- `GET /secret/options/positions`
- `POST /secret/options/positions`
- `PUT /secret/options/positions/{position_id}`
- `DELETE /secret/options/positions/{position_id}`
- `GET /secret/options/greeks/{position_id}`
- `GET /secret/options/closed-positions`
- `POST /secret/options/attribution/backfill`
  - Consumers: secret options page

## Admin

- `POST /admin/ingest/run`
- `POST /admin/ingest/{code}`
- `POST /admin/backfill`
  - Response fields: job status and counts
  - Consumers: dashboard and maintenance flows
- `POST /admin/clear-refetch/{code}?days=365`
  - Params: `days`
  - Response fields: clear and refetch status
  - Consumers: indicator detail maintenance actions
