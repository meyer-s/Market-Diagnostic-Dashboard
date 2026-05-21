#!/bin/bash
set -e

echo "🗃️ Running database migrations..."
alembic upgrade head

echo "🌱 Seeding indicators..."
python /app/seed_indicators.py

echo "🚀 Starting API server..."
if [[ "${UVICORN_RELOAD}" == "1" || "${UVICORN_RELOAD}" == "true" ]]; then
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
else
  UVICORN_WORKERS="${UVICORN_WORKERS:-2}"
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${UVICORN_WORKERS}"
fi
