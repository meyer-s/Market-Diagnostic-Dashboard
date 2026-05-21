# Deployment

This document describes the current runtime split for the Market Diagnostic Dashboard.

## Production services

The production compose file is [`docker-compose.yml`](../docker-compose.yml). It now separates responsibilities into four services:

| Service | Purpose | Exposure |
| --- | --- | --- |
| `frontend` | Static Vite build served by Nginx | public port |
| `backend` | FastAPI web application | internal only |
| `scheduler` | Scheduled ETL and publishing worker | internal only |
| `db` | PostgreSQL | internal only |

Key production properties:

- The backend is no longer published directly to `0.0.0.0`.
- Nginx proxies `/api` traffic from the frontend container to the backend service.
- Scheduler work runs only in the dedicated `scheduler` container with `RUN_SCHEDULER=true`.
- Web workers run with `RUN_SCHEDULER=false`.
- Startup runs `alembic upgrade head` before indicator seeding.

## Local development

For bind mounts, hot reload, and the Vite dev server, layer the dev override on top of production:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

That override:

- mounts `./backend` into the backend and scheduler containers
- runs the frontend as `pnpm dev`
- exposes the backend directly on `localhost:8000`
- keeps the scheduler available behind the `scheduler` profile

## Environment files

Example environment files live in [`devops/env`](../devops/env):

- [`backend.env.example`](../devops/env/backend.env.example)
- [`frontend.env.example`](../devops/env/frontend.env.example)
- [`db.env.example`](../devops/env/db.env.example)

Copy them into your deploy environment and replace placeholder values before shipping.

## Verification commands

Typical runtime checks:

```bash
docker compose ps
docker compose logs backend --tail 100
docker compose logs scheduler --tail 100
docker compose logs frontend --tail 100
curl http://localhost/healthz
curl http://localhost/api/health/
```

## Admin operations

Admin refresh/backfill routes still exist, but they are bearer-token protected through `ADMIN_API_KEY`. Public dashboard traffic should never call them directly.

## Visual regression

Playwright coverage lives in [`frontend/tests/visual/routes.spec.ts`](../frontend/tests/visual/routes.spec.ts) with config in [`frontend/playwright.config.ts`](../frontend/playwright.config.ts). The GitHub Actions workflow keeps backend and frontend checks on every push/PR, and exposes the visual suite through manual `workflow_dispatch`.
