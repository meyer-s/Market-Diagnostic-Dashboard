from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path


try:
    from app.core.db import SessionLocal
    from app.services.agriculture_report_desk import (
        WASDE_STRUCTURED_START,
        backfill_wasde_history,
    )
except ModuleNotFoundError:
    repo_root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(repo_root / "backend"))
    from app.core.db import SessionLocal
    from app.services.agriculture_report_desk import (
        WASDE_STRUCTURED_START,
        backfill_wasde_history,
    )


def _iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected an ISO date such as 2010-04-09") from exc


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill chart-ready USDA WASDE history from the official bulk and monthly archives."
    )
    parser.add_argument("--since", type=_iso_date, default=WASDE_STRUCTURED_START)
    parser.add_argument("--through", type=_iso_date, default=date.today())
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = backfill_wasde_history(
            db,
            since=args.since,
            through=args.through,
            max_workers=args.workers,
            dry_run=args.dry_run,
        )
    finally:
        db.close()
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
