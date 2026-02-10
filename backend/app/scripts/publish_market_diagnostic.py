from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
import sys

# Support both module invocations:
# - python -m app.scripts.publish_market_diagnostic
# - python -m backend.app.scripts.publish_market_diagnostic
if __package__ and __package__.startswith("backend.app"):
    backend_root = Path(__file__).resolve().parents[2]
    backend_root_str = str(backend_root)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)

from app.services.market_diagnostic_runner import run_market_diagnostic


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish a Market Diagnostic update.")
    parser.add_argument(
        "--date",
        help="Optional UTC date in YYYY-MM-DD format. Defaults to today's UTC date.",
    )
    return parser.parse_args()


def _resolve_run_date(date_arg: str | None) -> datetime:
    if not date_arg:
        return datetime.now(timezone.utc)
    parsed = datetime.strptime(date_arg, "%Y-%m-%d")
    return parsed.replace(tzinfo=timezone.utc)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    args = _parse_args()
    run_date = _resolve_run_date(args.date)
    run_date_utc = run_date.date().isoformat()
    day_of_week = run_date.strftime("%a").upper()
    result = run_market_diagnostic(run_date_utc=run_date_utc, day_of_week=day_of_week, mode="manual", dry_run=False)
    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
