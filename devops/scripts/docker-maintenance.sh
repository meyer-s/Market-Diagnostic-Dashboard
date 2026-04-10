#!/usr/bin/env bash

set -euo pipefail

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting Docker maintenance"
df -h /

docker container prune -f
docker image prune -af
docker builder prune -af

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Docker maintenance complete"
df -h /