import argparse

from app.services.market_data_capture import process_pending_daily_bar_observations


def main() -> None:
    parser = argparse.ArgumentParser(description="Process captured market-data observations.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum pending daily-bar observations to process.")
    parser.add_argument("--dry-run", action="store_true", help="Report processable rows without updating database.")
    args = parser.parse_args()

    summary = process_pending_daily_bar_observations(limit=args.limit, dry_run=args.dry_run)
    print(summary)


if __name__ == "__main__":
    main()
