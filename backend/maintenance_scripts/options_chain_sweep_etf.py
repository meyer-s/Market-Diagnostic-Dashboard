import argparse
import io
from typing import List, Optional

import pandas as pd
import requests

from maintenance_scripts.options_chain_sweep import _scan_tickers
from app.services.options_alerts import _send_webhook

SP500_IVV_URL = (
    "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund"
)
R2K_IWM_URL = (
    "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
)


def _fetch_ishares_tickers(url: str) -> List[str]:
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
    except Exception:
        return []

    lines = response.text.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("Ticker,"):
            header_idx = i
            break
    if header_idx is None:
        return []

    frame = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])))
    tickers = frame.get("Ticker")
    if tickers is None:
        return []
    return [
        value.strip()
        for value in tickers.dropna().astype(str).tolist()
        if value.strip() and value.strip().upper() != "NAN"
    ]


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
    args = parser.parse_args()

    max_count = args.max if args.max and args.max > 0 else None
    _send_webhook(
        f":mag: Options sweep started (IVV holdings). Threshold {args.threshold:.1f}%"
        f"{'' if max_count is None else f', max {max_count}'}."
    )
    hits = _run_sweep(
        _fetch_ishares_tickers(SP500_IVV_URL),
        "S&P 500 (IVV)",
        args.threshold,
        max_count,
        args.pause,
    )
    if hits > 0:
        _send_webhook(f":white_check_mark: Options sweep finished. S&P 500 (IVV) hits: {hits}.")
        return

    r2k_hits = _run_sweep(
        _fetch_ishares_tickers(R2K_IWM_URL),
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
