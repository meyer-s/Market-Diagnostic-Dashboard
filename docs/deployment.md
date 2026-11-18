# Deployment

This document describes the current runtime split for the Market Diagnostic Dashboard.

## Production services

The base production compose file is [`docker-compose.yml`](../docker-compose.yml). The
Lightsail deployment layers [`docker-compose.ibgateway.yml`](../docker-compose.ibgateway.yml)
on top so the application and IB Gateway share the intended Docker network. Use both files
for production inspection and deployment:

```bash
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml config
```

The base stack separates responsibilities into four application services:

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
- An application-only release may rebuild and recreate `frontend`, `backend`, and
  `scheduler` without restarting the independent `ibgateway` service.

### Live News

The News page mounts the Live News reader only after a visitor turns it on. Its
internal `live-news` service is shared across readers and is independent of
the API worker count. A visible reader renews demand every 20 seconds. Feed
polling goes idle within 45 seconds of the last renewal. The reader checks its
snapshot every five seconds. Upstream polls have a 20-second minimum per feed,
honor publisher cache and retry headers, and use at most four workers.

Nginx bounds traffic under `/live-news/`. Reader weights are browser-local.
The separate SQLite volume keeps up to 250 wire entries per feed and 5,000 total.
Wire entries expire after 72 hours. Cleanup runs on writes and every five minutes,
including when feed polling is idle. This does not affect the cached watchlist
news in PostgreSQL.

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
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml ps
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml logs backend --tail 100
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml logs scheduler --tail 100
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml logs frontend --tail 100
curl http://localhost/healthz
curl http://localhost/api/health/
```

## Admin operations

Admin refresh/backfill routes still exist, but they are bearer-token protected through `ADMIN_API_KEY`. Public dashboard traffic should never call them directly.

## Visual regression

Playwright coverage lives in [`frontend/tests/visual`](../frontend/tests/visual) with
config in [`frontend/playwright.config.ts`](../frontend/playwright.config.ts). The
GitHub Actions workflow runs the focused browser release gate on pushes and pull
requests.

The exact full-height route and material-state audits run weekly, and can also be
enabled from `workflow_dispatch` with `run_full_site_audit=true`. Desktop and mobile
run independently, proxy only GET requests to `audit_origin`, block other live
methods, and upload their JSON manifests plus screenshots as retained workflow
artifacts. The audit fails on missing supported or classified legacy routes, blank
or short captures, page overflow, unresolved loading, runtime/request failures,
unlabeled controls, unfocusable data scrollers, or Axe violations.

To run the same gate locally against the default read-only production origin:

```bash
cd frontend
pnpm build
pnpm test:site-audit
```
