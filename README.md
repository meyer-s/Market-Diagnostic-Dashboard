# Market Diagnostic Dashboard

A real-time macro and market dashboard that turns rates, liquidity, credit, sentiment, alternative assets, and sector internals into a human-readable market regime view.

Live site: [marketdiagnostictool.com](https://marketdiagnostictool.com)

## What It Covers

The platform tracks 11 core indicators seeded by [backend/seed_indicators.py](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/seed_indicators.py), including:

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
- Alternative Asset Pressure

In addition to the core dashboard, the app now includes:

- Indicator detail pages with expanded methodology and history
- System Breakdown with weighting logic and historical state distribution
- Alternative Assets with precious metals and crypto diagnostics
- Market Map, sector projections, and stock analysis tools
- Recap pages for published updates
- Secret options tracking and options-alert infrastructure

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
- `/aap-breakdown` AAS component breakdown
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
- ingests AAP, crypto, metals, and sector-projection data
- recalculates the Alternative Asset Pressure / Stability framework

Representative data sources include:

- FRED for macro and rates data
- Yahoo Finance for equity and market pricing inputs
- CoinGecko for crypto market data
- DeFiLlama for DeFi and stablecoin context
- metals-specific sources including COMEX, ETF, and central-bank feeds

## Running Locally

Prerequisites:

- Docker
- Docker Compose

Start the stack:

```bash
git clone https://github.com/meyer-s/Market-Diagnostic-Dashboard.git
cd Market-Diagnostic-Dashboard
docker compose up -d --build
```

Default local endpoints from the current compose file:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`

Useful commands:

```bash
docker compose logs -f
docker exec market_backend python seed_indicators.py
curl -X POST http://localhost:8000/admin/backfill
```

## Production Deploy

The current production workflow is git-based:

```bash
cd ~/Market-Diagnostic-Dashboard
git pull origin main
docker compose up -d --build
```

There is also a heavier legacy deployment helper at [deploy_full_aap.sh](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/deploy_full_aap.sh), but the standard deploy path used now is pull plus rebuild.

## Key APIs

Representative API surface from [backend/app/main.py](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/app/main.py) and `backend/app/api/*`:

- `/health/`
- `/system`
- `/system/history`
- `/indicators`
- `/indicators/{code}`
- `/indicators/{code}/history`
- `/aap/components/breakdown`
- `/precious-metals/regime`
- `/crypto/market-overview`
- `/crypto/diagnostic-context`
- `/sectors/projections/latest`
- `/stocks/{ticker}/projections`
- `/news`
- `/updates` and `/updates/by-slug/{slug}`

## Tests

Backend tests live under [backend/tests](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/backend/tests).

Run them with:

```bash
cd backend
pytest
```

Frontend package scripts are defined in [frontend/package.json](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/frontend/package.json).

```bash
cd frontend
npm test
npm run build
```

## Notes

- The repository is public, but the project is not licensed as open-source software.
- Some older documentation files in the repo describe January-era architecture and workflows; this README is intended to reflect the current app surface more closely.

## Links

- Production: [marketdiagnostictool.com](https://marketdiagnostictool.com)
- Repository: [github.com/meyer-s/Market-Diagnostic-Dashboard](https://github.com/meyer-s/Market-Diagnostic-Dashboard)
- Deployment notes: [DEPLOYMENT_GUIDE.md](c:/Users/sjmey/OneDrive/Documents/GitHub/Market-Diagnostic-Dashboard/DEPLOYMENT_GUIDE.md)
