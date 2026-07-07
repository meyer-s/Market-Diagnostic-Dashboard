import argparse
from typing import List, Optional

from maintenance_scripts.options_chain_sweep import _scan_tickers
from app.services.options_alerts import _send_webhook
from app.services.discord_sweep_universe import resolve_sweep_universe


def _resolve_tickers(selection: str) -> List[str]:
    try:
        universe = resolve_sweep_universe(selection)
    except Exception as exc:
        print(f"Failed to resolve {selection} universe: {exc}")
        return []
    if universe.notes:
        print(f"{universe.label} source: {' | '.join(universe.notes[:2])}")
    return universe.tickers


def _run_sweep(
    tickers: List[str],
    label: str,
    threshold: float,
    max_count: Optional[int],
    pause_seconds: float,
) -> int:
    if not tickers:
        print(f"Failed to fetch {label} tickers.")
        return 0
    print(f"{label} tickers: {len(tickers)}")
    return _scan_tickers(tickers, label, threshold, max_count, pause_seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=20.0)
    parser.add_argument("--max", type=int, default=0, help="Limit tickers scanned (0 = all).")
    parser.add_argument("--pause", type=float, default=0.2)
    parser.add_argument("--r2k-only", action="store_true", help="Only run Russell 2000 (IWM) sweep.")
    parser.add_argument("--sp500-only", action="store_true", help="Only run S&P 500 (IVV) sweep.")
    args = parser.parse_args()

    max_count = args.max if args.max and args.max > 0 else None
    if args.r2k_only and not args.sp500_only:
        _send_webhook(
            f":mag: Options sweep started (IWM holdings). Threshold {args.threshold:.1f}%"
            f"{'' if max_count is None else f', max {max_count}'}."
        )
        r2k_hits = _run_sweep(
            _resolve_tickers("RUSSELL2000"),
            "Russell 2000 (IWM)",
            args.threshold,
            max_count,
            args.pause,
        )
        _send_webhook(f":white_check_mark: Options sweep finished. Russell 2000 (IWM) hits: {r2k_hits}.")
        return
    if args.sp500_only and not args.r2k_only:
        _send_webhook(
            f":mag: Options sweep started (IVV holdings). Threshold {args.threshold:.1f}%"
            f"{'' if max_count is None else f', max {max_count}'}."
        )
        hits = _run_sweep(
            _resolve_tickers("SP500"),
            "S&P 500 (IVV)",
            args.threshold,
            max_count,
            args.pause,
        )
        _send_webhook(f":white_check_mark: Options sweep finished. S&P 500 (IVV) hits: {hits}.")
        return
    _send_webhook(
        f":mag: Options sweep started (IVV holdings). Threshold {args.threshold:.1f}%"
        f"{'' if max_count is None else f', max {max_count}'}."
    )
    hits = _run_sweep(
        _resolve_tickers("SP500"),
        "S&P 500 (IVV)",
        args.threshold,
        max_count,
        args.pause,
    )
    if hits > 0:
        _send_webhook(f":white_check_mark: Options sweep finished. S&P 500 (IVV) hits: {hits}.")
        return

    r2k_hits = _run_sweep(
        _resolve_tickers("RUSSELL2000"),
        "Russell 2000 (IWM)",
        args.threshold,
        max_count,
        args.pause,
    )
    _send_webhook(
        f":white_check_mark: Options sweep finished. S&P 500 (IVV) hits: {hits}. "
        f"Russell 2000 (IWM) hits: {r2k_hits}."
    )


if __name__ == "__main__":
    main()
