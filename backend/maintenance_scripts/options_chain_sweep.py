import argparse
import os
import time
from datetime import datetime
from typing import Any, Callable, Iterable, List, Optional

import pandas as pd

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.services.options_alerts import (
    _build_alert_reason,
    _build_stock_analyzer_url,
    _compute_option_bias,
    _compute_horizon_bias,
    _direction_hint,
    _format_alert_message,
    _is_iv_data_valid,
    _provider_source,
    _review_window_for_plan,
    _select_training_contract,
    _selected_contract_event_fields,
    _training_plan_inputs,
)
from app.models.options_alerts import OptionAlertEvent
from app.services.market_data.factory import get_market_data_provider
from app.services.option_field_context import build_option_field_context, option_field_event_fields
from app.services.options_opportunity import opportunity_event_fields
from app.services.scanner_repeat_evidence import record_scanner_recurrence_events
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


def _parse_float_list(value: Optional[str], default: list[float]) -> list[float]:
    if not value:
        return list(default)
    parsed: list[float] = []
    for part in value.split(","):
        try:
            number = float(part.strip())
        except Exception:
            continue
        if number > 0:
            parsed.append(number)
    return parsed or list(default)


def _int_env(name: str, default: Optional[int]) -> Optional[int]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return value if value > 0 else None


def _sweep_market_data_provider_key(default: str = "yahoo") -> str:
    return (
        os.getenv("OPTION_SWEEP_MARKET_DATA_PROVIDER")
        or os.getenv("SWEEP_MARKET_DATA_PROVIDER")
        or default
    ).strip().lower() or default


def _sweep_optionality_config(provider_name: str) -> dict[str, Any]:
    provider_key = (provider_name or "").strip().lower()
    if provider_key == "ibkr":
        return {
            "max_expiries": _int_env("IBKR_SWEEP_OPTIONALITY_MAX_EXPIRIES", 3),
            "strike_thresholds": _parse_float_list(
                os.getenv("IBKR_SWEEP_STRIKE_WINDOWS"),
                [0.08, 0.15],
            ),
            "contract_max_expiries": _int_env("IBKR_SWEEP_CONTRACT_MAX_EXPIRIES", 3),
        }
    return {
        "max_expiries": _int_env("SWEEP_OPTIONALITY_MAX_EXPIRIES", None),
        "strike_thresholds": _parse_float_list(os.getenv("SWEEP_STRIKE_WINDOWS"), [0.05, 0.1, 0.2]),
        "contract_max_expiries": _int_env("SWEEP_CONTRACT_MAX_EXPIRIES", None),
    }


def _scan_tickers(
    tickers: List[str],
    label: str,
    threshold: float,
    max_count: Optional[int],
    pause_seconds: float,
    capture_hit_symbols: bool = False,
    capture_hit_details: bool = False,
    progress_callback: Optional[Callable[[dict[str, Any]], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
    rate_limit_backoff_seconds: Optional[float] = None,
    rate_limit_backoff_multiplier: Optional[float] = None,
    rate_limit_backoff_max_seconds: Optional[float] = None,
    rate_limit_max_retries: Optional[int] = None,
    market_data_provider: Optional[str] = None,
    sweep_run_id: Optional[int] = None,
) -> int | tuple[int, list[str]] | tuple[int, list[dict[str, Any]]] | tuple[int, list[str], list[dict[str, Any]]]:
    hits = 0
    total = 0
    hit_symbols: list[str] = []
    hit_details: list[dict[str, Any]] = []
    errors = 0
    rate_limit_errors = 0
    consecutive_rate_limits = 0
    total_expected = min(len(tickers), max_count) if max_count else len(tickers)
    provider_key = (market_data_provider or _sweep_market_data_provider_key()).strip().lower()
    provider = get_market_data_provider(provider_key)
    optionality_config = _sweep_optionality_config(getattr(provider, "name", "unknown"))
    rate_limit_backoff_seconds = (
        rate_limit_backoff_seconds
        if rate_limit_backoff_seconds is not None
        else float(os.getenv("IBKR_TRANSIENT_RETRY_SECONDS", os.getenv("SWEEP_RATE_LIMIT_BACKOFF_SECONDS", "5")))
    )
    rate_limit_backoff_multiplier = (
        rate_limit_backoff_multiplier
        if rate_limit_backoff_multiplier is not None
        else float(os.getenv("SWEEP_RATE_LIMIT_BACKOFF_MULTIPLIER", "2"))
    )
    rate_limit_backoff_max_seconds = (
        rate_limit_backoff_max_seconds
        if rate_limit_backoff_max_seconds is not None
        else float(os.getenv("SWEEP_RATE_LIMIT_BACKOFF_MAX_SECONDS", "600"))
    )
    rate_limit_max_retries = (
        rate_limit_max_retries
        if rate_limit_max_retries is not None
        else int(os.getenv("IBKR_TRANSIENT_MAX_RETRIES", os.getenv("SWEEP_RATE_LIMIT_MAX_RETRIES", "1")))
    )

    def _emit_progress(event: dict[str, Any]) -> None:
        if not progress_callback:
            return
        payload = {
            "label": label,
            "scanned": total,
            "total_expected": total_expected,
            "hits": hits,
            "hit_symbols": list(hit_symbols),
            "errors": errors,
            "rate_limit_errors": rate_limit_errors,
            "market_data_provider": provider_key,
        }
        payload.update(event)
        try:
            progress_callback(payload)
        except Exception as exc:
            print(f"[Sweep Progress] callback failed: {exc}")

    _emit_progress({"event": "started"})

    def _should_stop() -> bool:
        if not should_stop:
            return False
        try:
            return bool(should_stop())
        except Exception as exc:
            print(f"[Sweep Progress] stop callback failed: {exc}")
            return False

    def _sleep_interruptibly(seconds: float) -> bool:
        deadline = time.monotonic() + max(seconds, 0)
        while True:
            if _should_stop():
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            time.sleep(min(remaining, 1.0))

    def _scan_symbol(symbol: str) -> None:
        nonlocal hits

        current_price = _get_current_price(provider, symbol)
        if current_price is None:
            return

        history = provider.daily_bars(symbol, days=365)
        hv30 = compute_historical_volatility(history, 30) if history is not None else None
        metrics = compute_optionality_metrics(
            provider,
            symbol,
            current_price,
            hv30,
            max_expiries=optionality_config.get("max_expiries"),
            strike_thresholds=optionality_config.get("strike_thresholds"),
        )
        iv_percentile = metrics.get("iv_percentile")
        iv30 = metrics.get("iv30")

        if not _is_iv_data_valid(iv30, hv30, iv_percentile):
            return

        bias, votes = _compute_option_bias(iv30, hv30, iv_percentile, metrics.get("avg_edr"))
        if iv_percentile is None or iv_percentile > threshold or bias != "CHEAP":
            return

        reason = _build_alert_reason(iv30, hv30, iv_percentile, threshold, bias, votes)
        direction, direction_reason = _direction_hint(history)
        horizon_labels, horizon_returns = _compute_horizon_bias(history)
        plan = _training_plan_inputs(direction, iv30, hv30, horizon_returns, history)
        hold_days = int(plan["hold_days"])
        contract_side = plan.get("contract_side")
        selected_contract = (
            _select_training_contract(
                provider=provider,
                symbol=symbol,
                current_price=current_price,
                contract_side=contract_side,
                target_dte=60,
                min_remaining_after_hold=hold_days + 3,
                hold_days=hold_days,
                target_move_pct=float(plan["target_move"]),
                stop_move_pct=float(plan["stop_move"]),
                iv30=iv30,
                hv30=hv30,
                max_expiries=optionality_config.get("contract_max_expiries"),
            )
            if contract_side in {"CALL", "PUT"}
            else None
        )
        review_window = _review_window_for_plan(
            base_hold_days=hold_days,
            iv30=iv30,
            hv30=metrics.get("hv30"),
            iv_percentile=iv_percentile,
            avg_edr=metrics.get("avg_edr"),
            horizon_returns=horizon_returns,
            selected_contract=selected_contract,
        )
        event_time = datetime.utcnow()
        field_context = build_option_field_context(
            history,
            option_type=contract_side,
            observed_at=event_time,
            data_source=_provider_source(provider, "daily_bars"),
            timeframe="1D",
        )
        analyzer_url = _build_stock_analyzer_url(symbol)
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
            provider=provider,
            selected_contract=selected_contract,
            analyzer_url=analyzer_url,
            options_data_source=metrics.get("data_source"),
            options_quote_source=metrics.get("quote_source"),
            review_window=review_window,
        )
        delivered, channel, error = _send_webhook(
            message,
            embed_url=analyzer_url,
            button_label=symbol,
        )
        if not delivered:
            print(
                f"[Sweep Delivery] {symbol} failed delivery: "
                f"channel={channel or 'n/a'} error={error or 'unknown'}"
            )
        with get_db_session() as db:
            event = OptionAlertEvent(
                    symbol=symbol,
                    triggered_at=event_time,
                    iv30=iv30,
                    hv30=metrics.get("hv30"),
                    iv_percentile=iv_percentile,
                    avg_edr=metrics.get("avg_edr"),
                    sweep_run_id=sweep_run_id,
                    message=message,
                    delivered=delivered,
                    delivery_channel=channel,
                    delivery_error=error,
                    review_min_hold_days=review_window.min_hold_days,
                    review_max_hold_days=review_window.max_hold_days,
                    review_window_basis=review_window.basis,
                    **option_field_event_fields(field_context),
                    **_selected_contract_event_fields(selected_contract),
                    **opportunity_event_fields(
                        iv_percentile=iv_percentile,
                        iv30=iv30,
                        hv30=metrics.get("hv30"),
                        avg_edr=metrics.get("avg_edr"),
                        selected_contract=selected_contract,
                    ),
                )
            db.add(event)
            db.flush()
            record_scanner_recurrence_events(db, event)
            db.commit()
        hits += 1
        hit_symbols.append(symbol)
        hit_details.append(
            {
                "symbol": symbol,
                "price": current_price,
                "iv30": iv30,
                "hv30": metrics.get("hv30"),
                "iv_percentile": iv_percentile,
                "avg_edr": metrics.get("avg_edr"),
                "data_source": metrics.get("data_source"),
                "quote_source": metrics.get("quote_source"),
                "direction": direction,
                "direction_reason": direction_reason,
                "horizon_labels": horizon_labels,
                "horizon_returns": horizon_returns,
                "votes": votes,
                "selected_contract": selected_contract,
            }
        )

    for symbol in tickers:
        if _should_stop():
            _emit_progress({"event": "cancelled"})
            break
        if max_count and total >= max_count:
            break
        symbol = _normalize_symbol(symbol)
        if not symbol or symbol == "NAN":
            continue
        total += 1
        retry_count = 0
        while True:
            try:
                _scan_symbol(symbol)
                consecutive_rate_limits = 0
                break
            except Exception as exc:
                errors += 1
                if _is_transient_market_data_error(exc):
                    rate_limit_errors += 1
                    consecutive_rate_limits += 1
                    wait_seconds = min(
                        rate_limit_backoff_seconds
                        * (rate_limit_backoff_multiplier ** max(consecutive_rate_limits - 1, 0)),
                        rate_limit_backoff_max_seconds,
                    )
                    will_retry = retry_count < rate_limit_max_retries
                    _emit_progress(
                        {
                            "event": "rate_limit",
                            "symbol": symbol,
                            "error": str(exc),
                            "retry_count": retry_count,
                            "max_retries": rate_limit_max_retries,
                            "retry_after_seconds": wait_seconds,
                            "will_retry": will_retry,
                        }
                    )
                    if will_retry:
                        retry_count += 1
                        if _sleep_interruptibly(wait_seconds):
                            _emit_progress(
                                {
                                    "event": "cancelled",
                                    "symbol": symbol,
                                    "during": "rate_limit_backoff",
                                }
                            )
                            break
                        continue
                    break
                consecutive_rate_limits = 0
                _emit_progress(
                    {
                        "event": "error",
                        "symbol": symbol,
                        "error": str(exc),
                    }
                )
                break

        _emit_progress({"event": "progress", "symbol": symbol})
        if pause_seconds:
            if _sleep_interruptibly(pause_seconds):
                _emit_progress({"event": "cancelled", "symbol": symbol, "during": "pause"})
                break

    _emit_progress({"event": "finished"})
    print(f"{label} scan finished: {hits} hits over {total} symbols.")
    if capture_hit_symbols and capture_hit_details:
        return hits, hit_symbols, hit_details
    if capture_hit_symbols:
        return hits, hit_symbols
    if capture_hit_details:
        return hits, hit_details
    return hits


def _is_transient_market_data_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        token in message
        for token in (
            "timeout",
            "pacing",
            "market data",
            "not connected",
            "connection reset",
            "no security definition",
            "no option chains",
            "rate limit",
            "rate limited",
            "too many requests",
            "429",
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=20.0)
    parser.add_argument("--max", type=int, default=0, help="Limit tickers scanned (0 = all).")
    parser.add_argument("--pause", type=float, default=float(os.getenv("IBKR_SWEEP_PAUSE_SECONDS", "0.25")))
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
