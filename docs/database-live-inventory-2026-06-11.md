# State Inventory (Live): Cached, Saved, Stored Data

Generated from production host + code inspection on 2026-06-11.

This is a full storage inventory, not just SQL tables.

## Executive Summary
- Durable history lives primarily in Postgres (market_db).
- You also have file-backed artifacts (JSON presets, SQL backup dump).
- Several backend endpoints and services maintain in-process caches with TTLs.
- Some frontend pages keep short-lived in-memory client caches for UX.
- A SQLite file path exists but is currently empty in this deployment.

## 1) Durable Primary Store (Postgres)

### Live Snapshot
- Database: market_db
- Public tables: 37
- Size: about 50 MB

### Highest-Volume Stored History
1. sector_projection_value: 51,656 rows
2. metal_price: 26,690 rows
3. news_article: 17,277 rows
4. indicator_value: 8,423 rows
5. metal_ratio: 4,596 rows

### Stock + Sector History (Confirmed)
- equity_price: 1,331 rows with persistent symbol/date history.
- sector_projection_run: 1,174 historical runs (2025-01-13 to 2026-06-10).
- sector_projection_value: persisted per-sector/per-horizon outputs tied to each run.

### Durable Domain Buckets
- Core diagnostics: indicator, indicator_value, system_status, alert
- Options: option_position, closed_position, option_alert_watch, option_alert_event
- News cache store: news_ticker, news_article
- Institutional flow: institutional_flow_event
- Metals: metal_price, metal_ratio, metal_correlation, metal_volatility, comex_inventory, cb_holding, cb_purchase, backwardation_data, lbma_premium, supply_data, demand_data, metal_regime_classification, etf_holding
- Alternative assets: crypto_prices, bitcoin_network_metric, crypto_ecosystem_metric, macro_liquidity_data, equity_price, aap_components, aap_component_v2, aap_indicator, aap_regime_history
- Sector projections: sector_projection_run, sector_projection_value
- Publishing/meta: update_post, alembic_version

## 2) Durable Embedded Snapshots Inside Postgres Rows

These are stored JSON payloads that preserve previous context even when in-memory cache resets.

- sector_projection_run.config_json includes previous_run_cache snapshots used by projection history paths.
- sector_projection_run.config_json also stores projection run warnings and weights metadata.

## 3) File-Backed Stored Artifacts (Server + Repo)

### Confirmed on Server
- Home backup dump: ~/market_db_backup_20260521_190811.sql (about 28 MB)
- Legacy sqlite file: ~/market.db (0 bytes)

### Confirmed in Repo Deployment Path
- backend/app/data/ticker_presets.json (about 12 KB): news ticker preset definitions
- backend/market.db (0 bytes): local sqlite path exists but not active in this production setup
- backend/migrations/add_closed_positions.sql: standalone SQL migration artifact

## 4) Backend In-Memory Caches (Ephemeral, Process-Local)

These caches are not persisted and reset on backend restart/deploy.

### API Layer Caches
- market_map API: 5-minute cache for daily and intraday market-map payloads
- crypto API: 15-minute per-days cache for market overview payloads
- institutional_flow API: 5-minute cache keyed by symbols + lookback
- market_internals API:
	- breadth payload cache: 4 hours
	- exchange listing universe cache: 24 hours
- sector_projection API: daily cache for historical scores (non-durable)

### Service Layer Caches
- agriculture_index:
	- composite payload cache: 15 minutes
	- long view cache: 1 hour
- agriculture_market_context: 10-minute context cache per symbol
- agriculture adapters:
	- daily source cache: 30 hours
	- WASDE lookup cache: 6 hours
	- WASDE failure cache: 30 minutes
- energy_index:
	- composite cache: 20 minutes
	- generation mix cache: 6 hours (15-minute retry TTL when fallback used)
- real_estate_index:
	- composite/context caches: 20 minutes
- news_service:
	- ticker preset file loaded with lru_cache(maxsize=1)
- discord_sweep_universe: in-memory cached universes with TTL logic

## 5) Frontend In-Memory Caches (Browser Session Scope)

Not durable server storage; these are UX/perf caches in the client runtime.

- Updates tool page caches fetched post details in component state (detailCache).
- Market news page applies client-side filters over fetched cached article payloads.
- Market map page messaging and behavior assume fast responses from backend cache hits.

## 6) What Is Durable Vs Ephemeral

### Durable (survives restart)
- Postgres tables and row history
- JSON content stored in DB columns (for example run config snapshots)
- File artifacts (SQL dump, JSON presets, migration SQL)

### Ephemeral (clears on process restart)
- All Python module-level dict caches and lru_cache state
- Frontend React state caches

## 7) Practical Interpretation: "Everything Built Up Over Time"

If you mean "what has accumulated historically and will still be there tomorrow":
- Postgres row history + DB-embedded snapshots + SQL backup dumps + file presets

If you mean "what is currently speeding up responses right now":
- Backend memory caches + frontend memory caches

Both are part of your system state, but only the first category is durable archival history.
