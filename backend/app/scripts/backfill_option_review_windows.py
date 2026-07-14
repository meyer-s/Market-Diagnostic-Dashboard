from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


try:
    from app.api.secret_options import _backfill_review_windows
except ModuleNotFoundError:
    repo_root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(repo_root / "backend"))
    from app.api.secret_options import _backfill_review_windows


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill option sweep review windows.")
    parser.add_argument("--lookback-days", type=int, default=3650)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--all-events", action="store_true", help="Backfill all events, not only linked/evaluated events.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing review windows.")
    parser.add_argument("--no-recompute-training", action="store_true", help="Only stamp training rows; do not recompute outcomes.")
    parser.add_argument("--dry-run", action="store_true", help="Preview updates without committing.")
    args = parser.parse_args()

    result = _backfill_review_windows(
        lookback_days=args.lookback_days,
        limit=args.limit,
        linked_only=not args.all_events,
        force=args.force,
        recompute_training=not args.no_recompute_training,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
