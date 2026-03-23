# Deployment

This document covers the deployment and runtime workflow for the Market Diagnostic Dashboard.

## Current Deployment Model

Production deploys are git-based. Changes are committed locally, pushed to `main`, then pulled and rebuilt on the server.

Typical production flow:

```bash
cd ~/Market-Diagnostic-Dashboard
git pull origin main
docker compose up -d --build
```

This is the current standard path. Legacy helper scripts such as `deploy_full_aas.sh` still exist for specific maintenance cases, but the default workflow is pull plus rebuild.

## Local Runtime

Prerequisites:

- Docker
- Docker Compose

Start the full stack locally:

```bash
git clone https://github.com/meyer-s/Market-Diagnostic-Dashboard.git
cd Market-Diagnostic-Dashboard
docker compose up -d --build
```

Default local endpoints from the current compose file:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

Useful commands:

```bash
docker compose logs -f
docker exec market_backend python seed_indicators.py
curl -X POST http://localhost:8000/admin/backfill
```

## Production Checklist

Before deploy:

- Confirm the branch state locally.
- Review changed files.
- Push to `origin/main`.

On the server:

- Pull latest code.
- Rebuild containers.
- Check backend and frontend logs.
- Verify the key API routes you touched.

Basic verification commands:

```bash
docker compose ps
docker compose logs backend --tail 100
docker compose logs frontend --tail 100
curl http://localhost:8000/health/
```

## Data Refresh and Maintenance

The backend startup path is defined in `backend/startup.sh`. Scheduled ingestion and recurring jobs are handled in `backend/app/services/scheduler.py`.

Common maintenance entry points:

- `POST /admin/ingest/run`
- `POST /admin/ingest/{code}`
- `POST /admin/backfill`
- `POST /admin/clear-refetch/{code}?days=365`

Use those when you need to force a refresh without changing application code.

## Feature-Specific Deploy Notes

### Alternative Assets and AAS

The repository still includes a heavier helper at `deploy_full_aas.sh`. Keep it for recovery or backfill-heavy work, not as the primary deployment path.

The active AAS and alternative-assets reference now lives in `docs/alternative-assets.md`.

### Discord Bot

Discord setup and follow-up operational details live in `docs/discord.md`.

### Secret Options

Secret Options, trade management, and Greeks documentation live in `docs/secret-options.md` and `docs/greeks_model.md`.

## Troubleshooting

If a deploy looks healthy but the app does not:

1. Check `docker compose ps` for container restarts.
2. Read backend logs first, then frontend logs.
3. Verify the exact endpoint used by the affected page.
4. If the issue is data-related, run the appropriate admin refresh endpoint or backfill.

If a server-side rebuild is not enough:

1. Confirm environment values in `devops/env`.
2. Confirm the container has the latest image layers by rebuilding again.
3. Confirm the route or API module is still wired in `backend/app/main.py` or `frontend/src/App.tsx`.
