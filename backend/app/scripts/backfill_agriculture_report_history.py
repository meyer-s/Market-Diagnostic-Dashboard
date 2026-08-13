from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path


try:
    from app.core.db import SessionLocal
    from app.services.agriculture_report_archive import REPORT_ARCHIVE_START, backfill_report_releases
except ModuleNotFoundError:
    repo_root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(repo_root / "backend"))
    from app.core.db import SessionLocal
    from app.services.agriculture_report_archive import REPORT_ARCHIVE_START, backfill_report_releases


def _iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected an ISO date such as 1986-01-01") from exc


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill every non-WASDE Agriculture Report Desk family from official archives."
    )
    parser.add_argument("--since", type=_iso_date, default=REPORT_ARCHIVE_START)
    parser.add_argument("--through", type=_iso_date, default=date.today())
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--report",
        action="append",
        dest="reports",
        help="Limit the import to one report id; repeat for more than one.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = backfill_report_releases(
            db,
            since=args.since,
            through=args.through,
            max_workers=args.workers,
            report_ids=args.reports,
            dry_run=args.dry_run,
        )
    finally:
        db.close()
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
