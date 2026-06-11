from __future__ import annotations

import argparse
import time
from datetime import datetime

import httpx

from app.services.stock_price_cache import ensure_symbol_history


def _normalize_symbol(symbol: str) -> str:
    value = (symbol or "").strip().upper()
    if not value:
        return ""
    return value.replace("$", "").replace(".", "-")


def _parse_pipe_table(text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return []
    headers = [h.strip() for h in lines[0].split("|")]
    rows: list[dict[str, str]] = []
    for line in lines[1:]:
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != len(headers):
            continue
        row = dict(zip(headers, parts))
        if row.get(headers[0], "").startswith("File Creation Time"):
            continue
        rows.append(row)
    return rows


def fetch_us_listed_symbols() -> list[str]:
    nasdaq: set[str] = set()
    nyse_amex: set[str] = set()

    with httpx.Client(timeout=25) as client:
        nasdaq_text = client.get("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt").text
        other_text = client.get("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt").text

    for row in _parse_pipe_table(nasdaq_text):
        if row.get("Test Issue", "N") == "Y":
            continue
        symbol = _normalize_symbol(row.get("Symbol", ""))
        if symbol:
            nasdaq.add(symbol)

    for row in _parse_pipe_table(other_text):
        if row.get("Test Issue", "N") == "Y":
            continue
        raw_symbol = row.get("ACT Symbol") or row.get("NASDAQ Symbol") or row.get("CQS Symbol") or ""
        symbol = _normalize_symbol(raw_symbol)
        exch = (row.get("Exchange") or "").upper()
        if symbol and exch in {"N", "A", "P", "Q"}:
            nyse_amex.add(symbol)

    symbols = sorted(nasdaq | nyse_amex)
    return symbols


def build_symbol_list(phase: str, max_listed: int = 0) -> list[str]:
    phase = phase.lower()
    spy = ["SPY"]
    r2k = ["IWM", "^RUT"]

    if phase == "spy":
        return spy
    if phase == "r2k":
        return r2k

    listed = fetch_us_listed_symbols()
    if max_listed > 0:
        listed = listed[:max_listed]

    if phase == "listed":
        return listed

    # all: explicit ordering requested by user
    merged = []
    for symbol in spy + r2k + listed:
        if symbol not in merged:
            merged.append(symbol)
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill persistent stock_price_bar cache")
    parser.add_argument("--phase", choices=["spy", "r2k", "listed", "all"], default="spy")
    parser.add_argument("--years", type=int, default=10, help="Years of daily OHLC history to ingest")
    parser.add_argument(
        "--full-history",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Fetch full available daily history (period=max).",
    )
    parser.add_argument("--intraday-days", type=int, default=252, help="Target recent days for 2-hour bars")
    parser.add_argument("--max-listed", type=int, default=0, help="Cap listed symbols for phased rollouts")
    parser.add_argument("--sleep-ms", type=int, default=100, help="Delay between symbols to reduce upstream pressure")
    args = parser.parse_args()

    symbols = build_symbol_list(args.phase, max_listed=args.max_listed)
    total = len(symbols)
    print(f"[{datetime.utcnow().isoformat()}] Starting backfill phase={args.phase} symbols={total}")

    ok = 0
    failed = 0
    for idx, symbol in enumerate(symbols, start=1):
        try:
            result = ensure_symbol_history(
                symbol,
                years=max(args.years, 5),
                full_history=bool(args.full_history),
                include_2h=True,
                intraday_days=max(args.intraday_days, 30),
            )
            ok += 1
            print(
                f"[{idx}/{total}] {symbol}: "
                f"daily fetched={result['daily_rows_fetched']} inserted={result['daily_rows_inserted']} | "
                f"2h fetched={result['intraday_rows_fetched']} inserted={result['intraday_rows_inserted']}"
            )
        except Exception as exc:
            failed += 1
            print(f"[{idx}/{total}] {symbol}: ERROR {exc}")

        if args.sleep_ms > 0:
            time.sleep(args.sleep_ms / 1000.0)

    print(f"Done. ok={ok} failed={failed} total={total}")


if __name__ == "__main__":
    main()
