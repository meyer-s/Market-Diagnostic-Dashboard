# Market Diagnostic Dashboard

Market Diagnostic Dashboard is a live market-intelligence system that compresses rates, liquidity, credit, sentiment, and cross-asset internals into a single regime read.

Live site: [marketdiagnostictool.com](https://marketdiagnostictool.com)

## What it covers

The weighted indicator framework is seeded from [`backend/seed_indicators.py`](backend/seed_indicators.py) and documented in [`docs/indicator-specification.md`](docs/indicator-specification.md).

Core and supporting indicators include:

- VIX
- SPY trend
- Breadth Health
- 10Y minus 2Y Treasury spread
- Unemployment
- Consumer Health
- Bond Market Stability
- Liquidity Proxy
- Analyst Confidence
- Sentiment Composite
- Alternative Asset Stability (internal aggregate feeding the separate metals and crypto views)
- Agriculture, energy, and real-estate stability overlays

## Current product surface

Route, navigation, and analytics metadata are centralized in [`frontend/src/routes/registry.tsx`](frontend/src/routes/registry.tsx).

- `/` Dashboard
- `/indicators` indicator library
- `/indicators/:code` indicator detail
- `/system-breakdown` system methodology and state view
- `/vision` product framing
- `/market-map`, `/sector-projections`, `/stock-analysis`
- `/institutional-flow`, `/market-weather`
- `/metals-indicators`, `/crypto-indicators`
- `/news`
- `/tools/recap`, `/tools/volume-breadth`
- `/agriculture`, `/energy`, `/real-estate`

The retired `/aas-breakdown` research route is intentionally not registered. A legacy
`/indicators/AAS` deep link now shows transition guidance only; Metals and Crypto are the
supported replacement research surfaces.

## Stack

| Surface | Technology |
| --- | --- |
| Backend | FastAPI, SQLAlchemy, Alembic, PostgreSQL |
| Frontend | React, TypeScript, Vite, Recharts |
| Deployment | Docker Compose, Nginx |
| Testing | Pytest, Vitest, Playwright |

Key entry points:

- Backend app: [`backend/app/main.py`](backend/app/main.py)
- Frontend app: [`frontend/src/App.tsx`](frontend/src/App.tsx)
- Route registry: [`frontend/src/routes/registry.tsx`](frontend/src/routes/registry.tsx)
- Deployment manifests: [`docker-compose.yml`](docker-compose.yml), [`docker-compose.dev.yml`](docker-compose.dev.yml)

## Local architecture graph

The optional [`graphify-codebase`](.agents/skills/graphify-codebase/SKILL.md)
agent skill provides a guarded, code-only dependency graph for cross-layer
impact analysis. It installs the pinned tool in an isolated per-repository cache
under local application data, outside the OneDrive workspace:

```powershell
.\.agents\skills\graphify-codebase\scripts\graphify.ps1 build
.\.agents\skills\graphify-codebase\scripts\graphify.ps1 explain -Text compute_optionality_metrics
```

Use graph results as leads, then verify them against source, tests, and runtime
evidence. The integration does not install hooks, MCP, semantic document
extraction, query memory, or Obsidian artifacts.

## Runtime model

- **Web and scheduler are split.** The FastAPI web service runs with `RUN_SCHEDULER=false`; scheduled ETL and publishing run in the dedicated scheduler worker.
- **Admin mutations are protected.** Admin endpoints require a bearer token via `ADMIN_API_KEY`.
- **Schema changes run through Alembic.** Startup applies `alembic upgrade head` before metadata seeding.
- **Production frontend is static.** The production image builds the Vite app and serves it through Nginx, which proxies `/api` to the backend.

## Local development

Start the stack with bind mounts and Vite dev server:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Useful endpoints:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- Backend health: `http://localhost:8000/health/`

## Production deployment

Production includes the IB Gateway overlay. Build and recreate only the service being released:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.ibgateway.yml \
  build frontend

docker compose \
  -f docker-compose.yml \
  -f docker-compose.ibgateway.yml \
  up -d --no-deps frontend
```

Environment examples live in [`devops/env`](devops/env):

- [`backend.env.example`](devops/env/backend.env.example)
- [`frontend.env.example`](devops/env/frontend.env.example)
- [`db.env.example`](devops/env/db.env.example)

More operational detail lives in [`docs/deployment.md`](docs/deployment.md).

## Documentation

- Indicator methodology: [`docs/indicator-specification.md`](docs/indicator-specification.md)
- Deployment workflow: [`docs/deployment.md`](docs/deployment.md)
- API draft: [`docs/api-contract.md`](docs/api-contract.md)
- Metals and crypto: [`docs/alternative-assets.md`](docs/alternative-assets.md)
- Visual system: [`DESIGN.md`](DESIGN.md)
- Secret Options: [`docs/secret-options.md`](docs/secret-options.md)
- Discord integration: [`docs/discord.md`](docs/discord.md)

## License

This repository is **source-available, not open source**.

All rights reserved. No permission is granted to use, copy, modify, distribute, sublicense, sell, or create derivative works from this code without prior written permission from the copyright holder.

See [`LICENSE`](LICENSE).
