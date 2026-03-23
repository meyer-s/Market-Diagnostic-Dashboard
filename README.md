# Market Diagnostic Dashboard

Market Diagnostic Dashboard is a live market intelligence tool built to answer the question most dashboards dodge: what kind of tape are we actually trading right now?

Instead of dumping raw charts, it pulls rates, liquidity, credit, sentiment, alternative assets, and sector internals into a single regime read that is fast to scan and hard to misinterpret. The goal is not more noise. The goal is a cleaner market view, tighter context, and better decisions.

Live site: [marketdiagnostictool.com](https://marketdiagnostictool.com)

## What It Covers

At the core is a weighted indicator framework seeded by [backend/seed_indicators.py](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/seed_indicators.py). It tracks the pressure points that actually shape market behavior, including:

- VIX
- SPY trend
- Breadth Health
- 10Y minus 2Y Treasury spread
- Unemployment
- Consumer Health
- Bond Market Stability
- Liquidity Proxy
- Analyst Anxiety / Confidence
- Sentiment Composite
- Alternative Asset Stability

Around that core signal engine, the platform expands into a broader operating system for market context:

- Indicator detail pages that explain the why behind the signal, not just the score
- System Breakdown views that expose weighting logic, regime state, and historical drift
- Alternative asset diagnostics for precious metals and crypto when trust in the core system starts to wobble
- Market Map, sector projections, and stock analysis tools for moving from macro context into tradable follow-through
- Recap pages for publishing market updates in a format that is actually readable
- Secret Options tooling and alert infrastructure for higher-touch options workflows

## Current Product Surface

Primary frontend routes live in [frontend/src/App.tsx](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/frontend/src/App.tsx).

- `/` Dashboard
- `/indicators` indicator library
- `/indicators/:code` indicator detail
- `/system-breakdown` system methodology and state view
- `/market-map` market-map and intraday sector context
- `/sector-projections` sector model output
- `/stock-analysis` and `/stock-analysis/:symbol` stock analysis
- `/alternative-assets` alternative-asset diagnostics
- `/aas-breakdown` AAS component breakdown
- `/tools/recap` published recap index and posts
- `/news` cached market news
- `/secret/options` secret options page

## Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL
- Frontend: React, TypeScript, Vite, Recharts
- Deployment: Docker Compose

Code entry points:

- Backend app: [backend/app/main.py](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/app/main.py)
- Frontend app: [frontend/src/App.tsx](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/frontend/src/App.tsx)
- Docker services: [docker-compose.yml](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docker-compose.yml)

## Data Pipeline

At startup, the backend seeds indicator metadata and launches the API via [backend/startup.sh](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/startup.sh).

The scheduler in [backend/app/services/scheduler.py](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/app/services/scheduler.py):

- runs an initial ETL job on startup
- refreshes indicators on a recurring schedule
- ingests AAS, crypto, metals, and sector-projection data
- recalculates the Alternative Asset Stability framework

Representative data sources include:

- FRED for macro and rates data
- Yahoo Finance for equity and market pricing inputs
- CoinGecko for crypto market data
- DeFiLlama for DeFi and stablecoin context
- metals-specific sources including COMEX, ETF, and central-bank feeds

## Docs

Active project documentation now lives under the `docs/` folder.

- Alternative assets and AAS: [docs/alternative-assets.md](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docs/alternative-assets.md)
- Discord integration: [docs/discord.md](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docs/discord.md)
- Secret Options: [docs/secret-options.md](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docs/secret-options.md)
- API reference draft: [docs/api-contract.md](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docs/api-contract.md)

## Notes

- The repository is public, but the project is not licensed as open-source software.
- Historical or superseded planning material remains under `archive/`.

## Links

- Production: [marketdiagnostictool.com](https://marketdiagnostictool.com)
- Repository: [github.com/meyer-s/Market-Diagnostic-Dashboard](https://github.com/meyer-s/Market-Diagnostic-Dashboard)
- Docs folder: [docs](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/docs)
