import argparse
import time
from typing import Iterable, List, Optional

import pandas as pd
import yfinance as yf

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.services.options_alerts import (
    _build_alert_reason,
    _compute_option_bias,
    _compute_horizon_bias,
    _direction_hint,
    _format_alert_message,
    _is_iv_data_valid,
)
from app.models.options_alerts import OptionAlertEvent
from app.services.options_alerts import _send_webhook, _get_current_price
from app.utils.db_helpers import get_db_session


SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
RUSSELL_URLS = [
    "https://en.wikipedia.org/wiki/List_of_Russell_2000_companies",
    "https://en.wikipedia.org/wiki/Russell_2000_Index",
]


def _read_ticker_table(url: str) -> List[str]:
    try:
        tables = pd.read_html(url)
    except Exception:
        return []
    for table in tables:
        for col in table.columns:
            col_name = str(col).lower()
            if "symbol" in col_name or "ticker" in col_name:
                series = table[col].dropna().astype(str)
                return [value.strip() for value in series.tolist() if value.strip()]
    return []


def _fetch_tickers(urls: Iterable[str]) -> List[str]:
    for url in urls:
        tickers = _read_ticker_table(url)
        if tickers:
            return tickers
    return []


def _normalize_symbol(symbol: str) -> str:
    return symbol.replace(".", "-").upper()


def _scan_tickers(
    tickers: List[str],
    label: str,
    threshold: float,
    max_count: Optional[int],
    pause_seconds: float,
) -> int:
    hits = 0
    total = 0

    for symbol in tickers:
        if max_count and total >= max_count:
            break
        symbol = _normalize_symbol(symbol)
        if not symbol or symbol == "NAN":
            continue
        total += 1
        try:
            stock = yf.Ticker(symbol)
            if not stock.options:
                continue

            current_price = _get_current_price(stock)
            if current_price is None:
                continue

            history = stock.history(period="1y")
            hv30 = compute_historical_volatility(history, 30) if history is not None else None
            metrics = compute_optionality_metrics(stock, current_price, hv30)
            iv_percentile = metrics.get("iv_percentile")
            iv30 = metrics.get("iv30")

            if not _is_iv_data_valid(iv30, hv30, iv_percentile):
                continue

            bias, votes = _compute_option_bias(iv30, hv30, iv_percentile, metrics.get("avg_edr"))
            if iv_percentile is None or iv_percentile > threshold or bias != "CHEAP":
                continue

            reason = _build_alert_reason(iv30, hv30, iv_percentile, threshold, bias, votes)
            direction, direction_reason = _direction_hint(history)
            horizon_labels, horizon_returns = _compute_horizon_bias(history)
            message = _format_alert_message(
                label,
                symbol,
                iv_percentile,
                iv30,
                metrics.get("hv30"),
                metrics.get("avg_edr"),
                bias,
                votes,
                reason,
                direction,
                direction_reason,
                threshold,
                horizon_labels,
                horizon_returns,
                history,
            )
            delivered, channel, error = _send_webhook(message)
            with get_db_session() as db:
                db.add(
                    OptionAlertEvent(
                        symbol=symbol,
                        iv30=iv30,
                        hv30=metrics.get("hv30"),
                        iv_percentile=iv_percentile,
                        avg_edr=metrics.get("avg_edr"),
                        message=message,
                        delivered=delivered,
                        delivery_channel=channel,
                        delivery_error=error,
                    )
                )
                db.commit()
            hits += 1
        except Exception:
            continue
        finally:
            if pause_seconds:
                time.sleep(pause_seconds)

    print(f"{label} scan finished: {hits} hits over {total} symbols.")
    return hits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=20.0)
    parser.add_argument("--max", type=int, default=0, help="Limit tickers scanned (0 = all).")
    parser.add_argument("--pause", type=float, default=0.2)
    args = parser.parse_args()

    max_count = args.max if args.max and args.max > 0 else None
    _send_webhook(
        f":mag: Options sweep started (S&P 500). Threshold {args.threshold:.1f}%"
        f"{'' if max_count is None else f', max {max_count}'}."
    )
    sp500 = _fetch_tickers([SP500_URL])
    if not sp500:
        print("Failed to fetch S&P 500 tickers.")
        _send_webhook(":warning: Options sweep aborted. Failed to fetch S&P 500 tickers.")
        return

    hits = _scan_tickers(sp500, "S&P 500", args.threshold, max_count, args.pause)
    if hits > 0:
        _send_webhook(f":white_check_mark: Options sweep finished. S&P 500 hits: {hits}.")
        return

    russell = _fetch_tickers(RUSSELL_URLS)
    if not russell:
        print("Failed to fetch Russell 2000 tickers.")
        _send_webhook(
            f":warning: Options sweep ended. S&P 500 hits: {hits}. Failed to fetch Russell 2000 tickers."
        )
        return

    r2k_hits = _scan_tickers(russell, "Russell 2000", args.threshold, max_count, args.pause)
    _send_webhook(
        f":white_check_mark: Options sweep finished. S&P 500 hits: {hits}. Russell 2000 hits: {r2k_hits}."
    )


if __name__ == "__main__":
    main()
