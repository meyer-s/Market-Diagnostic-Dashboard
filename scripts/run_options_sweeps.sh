#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/run_options_sweeps.sh [wiki|etf|both] [--background]

Examples:
  ./scripts/run_options_sweeps.sh etf
  ./scripts/run_options_sweeps.sh both --background
USAGE
}

mode="${1:-both}"
background="${2:-}"

run_cmd() {
  local script="$1"
  if [[ "${background}" == "--background" ]]; then
    docker exec -d -e PYTHONPATH=/app market_backend \
      /bin/sh -lc "python /app/maintenance_scripts/${script} > /tmp/${script}.log 2>&1"
    echo "Started ${script} in background. Log: /tmp/${script}.log"
  else
    docker exec -e PYTHONPATH=/app market_backend python "/app/maintenance_scripts/${script}"
  fi
}

case "${mode}" in
  wiki)
    run_cmd "options_chain_sweep.py"
    ;;
  etf)
    run_cmd "options_chain_sweep_etf.py"
    ;;
  both)
    run_cmd "options_chain_sweep.py"
    run_cmd "options_chain_sweep_etf.py"
    ;;
  *)
    usage
    exit 1
    ;;
esac
