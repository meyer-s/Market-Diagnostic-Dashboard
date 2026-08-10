import math
import os
from datetime import datetime, timedelta
from math import sqrt
from typing import Optional
from urllib.parse import quote

import pandas as pd
import requests

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.models.options_alerts import OptionAlertWatch, OptionAlertEvent
from app.services.market_data.factory import get_market_data_provider
from app.services.market_data.provider import MarketDataProvider
from app.services.option_field_context import build_option_field_context, option_field_event_fields
from app.services.options_opportunity import compute_opportunity_score, opportunity_event_fields, selected_contract_signal_fields
from app.services.options_quotes import select_atm_contract, select_optimal_contract
from app.services.options_review_window import ReviewWindow, compute_review_window
from app.services.scanner_repeat_evidence import record_scanner_recurrence_events
from app.utils.db_helpers import get_db_session

ESC = "\u001b"
ANSI_RESET = f"{ESC}[0m"
HORIZON_WINDOWS = {
    "1m": 21,
    "3m": 63,
    "6m": 126,
    "1y+": 252,
}


def _get_current_price(provider: MarketDataProvider, symbol: str) -> Optional[float]:
    try:
        quote = provider.quote(symbol)
    except Exception:
        return None
    return quote.price


def _send_webhook(
    message: str,
    embed_url: Optional[str] = None,
    button_label: Optional[str] = None,
) -> tuple[bool, Optional[str], Optional[str]]:
    webhook_url = os.getenv("OPTIONS_ALERT_WEBHOOK_URL")
    discord_url = os.getenv("OPTIONS_ALERT_DISCORD_WEBHOOK")

    if not webhook_url and not discord_url:
        return False, None, "No webhook configured"

    try:
        if discord_url:
            payload: dict = {"content": message}
            if embed_url:
                label = (button_label or "Open in Stock Analyzer").strip()[:80] or "Open in Stock Analyzer"
                payload["components"] = [
                    {
                        "type": 1,
                        "components": [
                            {
                                "type": 2,
                                "style": 5,
                                "label": label,
                                "url": embed_url,
                            }
                        ],
                    }
                ]

            # Try full payload first, then gracefully degrade if Discord rejects components.
            variants: list[dict] = [payload]
            if payload.get("components"):
                no_components = dict(payload)
                no_components.pop("components", None)
                variants.append(no_components)
            variants.append({"content": message})

            last_response = None
            for candidate in variants:
                target_url = discord_url
                if candidate.get("components"):
                    sep = "&" if "?" in discord_url else "?"
                    target_url = f"{discord_url}{sep}with_components=true"
                response = requests.post(target_url, json=candidate, timeout=10)
                last_response = response
                if response.status_code < 400:
                    return True, "discord", None

            detail = (
                f"status={last_response.status_code} body={last_response.text[:240]}"
                if last_response is not None
                else "unknown discord webhook failure"
            )
            return False, None, detail
        payload = {"content": message}
        response = requests.post(webhook_url, json=payload, timeout=10)
        if response.status_code >= 400:
            detail = f"status={response.status_code} body={response.text[:240]}"
            return False, None, detail
        return True, "webhook", None
    except Exception as exc:
        return False, None, str(exc)


def _is_iv_data_valid(iv30: Optional[float], hv30: Optional[float], iv_percentile: Optional[float]) -> bool:
    try:
        iv30_value = float(iv30) if iv30 is not None else None
        percentile_value = float(iv_percentile) if iv_percentile is not None else None
    except (TypeError, ValueError):
        return False
    if iv30_value is None or not math.isfinite(iv30_value) or iv30_value <= 1:
        return False
    if percentile_value is None or not math.isfinite(percentile_value):
        return False
    return 0 <= percentile_value <= 100


def _scanner_iv_percentile(metrics: dict[str, object]) -> Optional[float]:
    """Return the scanner's explicit current-chain percentile.

    ``iv_percentile`` is retained only as a compatibility fallback for older
    providers and fixtures. The stock optionality contract intentionally
    retired that ambiguous field in favor of ``iv30_chain_percentile``.
    """
    for key in ("iv30_chain_percentile", "iv_percentile"):
        value = metrics.get(key)
        if value is None:
            continue
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(numeric) and 0 <= numeric <= 100:
            return numeric
    return None


def _passes_scanner_threshold(iv_percentile: Optional[float], threshold: Optional[float]) -> bool:
    if iv_percentile is None or threshold is None:
        return False
    try:
        return float(iv_percentile) <= float(threshold)
    except (TypeError, ValueError):
        return False


def _compute_option_bias(
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float],
    avg_edr: Optional[float],
) -> tuple[str, list[str]]:
    votes: list[str] = []

    if iv30 is not None and hv30 is not None:
        spread = iv30 - hv30
        if spread > 5:
            votes.append("EXPENSIVE:IV_SPREAD")
        elif spread < -5:
            votes.append("CHEAP:IV_SPREAD")
        else:
            votes.append("FAIR:IV_SPREAD")

    if iv_percentile is not None:
        if iv_percentile > 70:
            votes.append("EXPENSIVE:IV_PCTL")
        elif iv_percentile < 30:
            votes.append("CHEAP:IV_PCTL")
        else:
            votes.append("FAIR:IV_PCTL")

    if avg_edr is not None:
        if avg_edr > 60:
            votes.append("EXPENSIVE:EDR")
        elif avg_edr < 40:
            votes.append("CHEAP:EDR")
        else:
            votes.append("FAIR:EDR")

    if not votes:
        return "UNKNOWN", votes

    tally = {"CHEAP": 0, "FAIR": 0, "EXPENSIVE": 0}
    for vote in votes:
        bias = vote.split(":")[0]
        tally[bias] += 1

    sorted_votes = sorted(tally.items(), key=lambda item: item[1], reverse=True)
    if len(sorted_votes) > 1 and sorted_votes[0][1] == sorted_votes[1][1]:
        return "FAIR", votes
    return sorted_votes[0][0], votes


def _build_alert_reason(
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float],
    threshold: Optional[float],
    bias: Optional[str],
    votes: Optional[list[str]],
) -> str:
    reasons = []
    if iv_percentile is not None:
        limit = threshold if threshold is not None else 0
        reasons.append(f"30D IV chain percentile {iv_percentile:.1f}% <= {limit:.1f}%")
    if iv30 is not None and hv30 is not None:
        spread = iv30 - hv30
        if spread < 0:
            reasons.append(f"IV30 below HV30 by {abs(spread):.1f} pts")
    if not reasons and iv_percentile is not None:
        reasons.append(f"30D IV chain percentile {iv_percentile:.1f}%")
    return "; ".join(reasons) if reasons else "Low 30D IV chain percentile"


def _direction_hint(history: Optional[pd.DataFrame]) -> tuple[str, str]:
    if history is None or history.empty:
        return "Neutral", "Insufficient price history"
    close = history.get("Close")
    if close is None:
        return "Neutral", "Missing close data"
    close = close.dropna()
    if len(close) < 10:
        return "Neutral", "Limited price history"

    current = float(close.iloc[-1])
    window = 50 if len(close) >= 50 else 20
    ma = close.rolling(window).mean().iloc[-1]
    ma_value = float(ma) if pd.notna(ma) else None

    ret_window = 20 if len(close) >= 21 else 5
    if len(close) >= ret_window + 1:
        ret = (current / float(close.iloc[-(ret_window + 1)]) - 1) * 100
    else:
        ret = 0.0

    if ma_value is not None and current > ma_value and ret > 2:
        return "Calls", f"{ret_window}d return +{ret:.1f}%, price above {window}D MA"
    if ma_value is not None and current < ma_value and ret < -2:
        return "Puts", f"{ret_window}d return {ret:.1f}%, price below {window}D MA"
    return "Neutral", f"{ret_window}d return {ret:.1f}%"


def _compute_horizon_bias(
    history: Optional[pd.DataFrame],
) -> tuple[dict[str, str], dict[str, Optional[float]]]:
    if history is None or history.empty:
        return {}, {}
    close = history.get("Close")
    if close is None:
        return {}, {}
    close = close.dropna()
    if close.empty:
        return {}, {}

    current = float(close.iloc[-1])
    labels: dict[str, str] = {}
    returns: dict[str, Optional[float]] = {}

    for horizon, window in HORIZON_WINDOWS.items():
        if len(close) <= window:
            labels[horizon] = "n/a"
            returns[horizon] = None
            continue
        past = float(close.iloc[-(window + 1)])
        if past == 0:
            labels[horizon] = "n/a"
            returns[horizon] = None
            continue
        ret = (current / past - 1) * 100
        returns[horizon] = round(ret, 1)
        labels[horizon] = "Bullish" if ret >= 0 else "Bearish"

    return labels, returns


def _format_horizon_lines(
    labels: Optional[dict[str, str]],
    returns: Optional[dict[str, Optional[float]]],
) -> list[str]:
    if not labels:
        return []
    returns = returns or {}
    lines = []
    for horizon in HORIZON_WINDOWS.keys():
        label = labels.get(horizon, "n/a")
        ret_val = returns.get(horizon)
        ret_text = f"{ret_val:+.1f}%" if ret_val is not None else "n/a"
        lines.append(f"- **{horizon}**: {label} ({ret_text})")
    return lines


def _format_horizon_summary(labels: Optional[dict[str, str]]) -> str:
    if not labels:
        return "n/a"
    parts = []
    for horizon in HORIZON_WINDOWS.keys():
        label = labels.get(horizon)
        if not label or label == "n/a":
            parts.append(f"{horizon} n/a")
        else:
            parts.append(f"{horizon} {label}")
    return " | ".join(parts)


def _format_value(value: Optional[float], digits: int = 1) -> str:
    return f"{value:.{digits}f}" if value is not None else "n/a"


def _format_source_text(data_source: object = None, quote_source: object = None) -> str:
    source = str(data_source).strip() if data_source else "unknown"
    quote = str(quote_source).strip() if quote_source else ""
    return f"{source} / {quote}" if quote and quote != source else source


def _provider_source(provider: MarketDataProvider, method: str) -> str:
    source_for = getattr(provider, "source_for", None)
    if callable(source_for):
        try:
            return str(source_for(method) or getattr(provider, "name", "unknown"))
        except Exception:
            pass
    return str(getattr(provider, "name", "unknown"))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _hold_days_from_returns(horizon_returns: Optional[dict[str, Optional[float]]]) -> int:
    trend_return = None
    if horizon_returns:
        trend_return = horizon_returns.get("1m")
        if trend_return is None:
            trend_return = horizon_returns.get("3m")

    if trend_return is not None and abs(trend_return) >= 12:
        return 7
    if trend_return is not None and abs(trend_return) >= 8:
        return 10
    if trend_return is not None and abs(trend_return) >= 4:
        return 14
    if trend_return is not None and abs(trend_return) >= 1.5:
        return 21
    return 28


def _trend_return_for_review(horizon_returns: Optional[dict[str, Optional[float]]]) -> Optional[float]:
    if not horizon_returns:
        return None
    return horizon_returns.get("1m") if horizon_returns.get("1m") is not None else horizon_returns.get("3m")


def _review_window_for_plan(
    *,
    base_hold_days: int,
    iv30: Optional[float],
    hv30: Optional[float],
    iv_percentile: Optional[float],
    avg_edr: Optional[float],
    horizon_returns: Optional[dict[str, Optional[float]]],
    selected_contract: Optional[dict[str, object]],
) -> ReviewWindow:
    selected_dte = None
    if selected_contract and isinstance(selected_contract.get("dte"), int):
        selected_dte = int(selected_contract["dte"])
    return compute_review_window(
        base_hold_days=base_hold_days,
        iv30=iv30,
        hv30=hv30,
        iv_percentile=iv_percentile,
        avg_edr=avg_edr,
        trend_return=_trend_return_for_review(horizon_returns),
        selected_dte=selected_dte,
    )


def _contract_side_from_direction(direction: str) -> Optional[str]:
    normalized = str(direction or "").strip().lower()
    if normalized == "calls":
        return "CALL"
    if normalized == "puts":
        return "PUT"
    return None


def _select_training_contract(
    provider: MarketDataProvider,
    symbol: str,
    current_price: Optional[float],
    contract_side: str,
    target_dte: int,
    min_remaining_after_hold: int,
    hold_days: Optional[int] = None,
    target_move_pct: Optional[float] = None,
    stop_move_pct: Optional[float] = None,
    iv30: Optional[float] = None,
    hv30: Optional[float] = None,
    max_expiries: Optional[int] = None,
) -> Optional[dict[str, object]]:
    if hold_days is not None and target_move_pct is not None and stop_move_pct is not None:
        optimized = select_optimal_contract(
            provider=provider,
            symbol=symbol,
            current_price=current_price,
            contract_side=contract_side,
            hold_days=hold_days,
            target_move_pct=target_move_pct,
            stop_move_pct=stop_move_pct,
            fallback_iv_pct=iv30,
            fallback_hv_pct=hv30,
            min_dte=30,
            max_dte=90,
            max_expiries=max_expiries,
        )
        if optimized:
            return optimized

    return select_atm_contract(
        provider=provider,
        symbol=symbol,
        current_price=current_price,
        contract_side=contract_side,
        target_dte=target_dte,
        min_remaining_after_hold=min_remaining_after_hold,
    )


def _training_plan_inputs(
    direction: str,
    iv30: Optional[float],
    hv30: Optional[float],
    horizon_returns: Optional[dict[str, Optional[float]]],
    history: Optional[pd.DataFrame],
) -> dict[str, Optional[float] | int | str]:
    close = history.get("Close") if history is not None else None
    price = None
    if close is not None:
        close = close.dropna()
        if not close.empty:
            price = float(close.iloc[-1])

    hold_days = _hold_days_from_returns(horizon_returns)
    hv_move_pct = float(hv30) * sqrt(hold_days / 252.0) if hv30 is not None else None
    iv_move_pct = float(iv30) * sqrt(hold_days / 252.0) if iv30 is not None else None
    move_candidates = [value for value in [hv_move_pct, iv_move_pct] if value is not None]
    expected_underlying_move = _clamp(
        (sum(move_candidates) / len(move_candidates)) if move_candidates else 4.0,
        2.0,
        14.0,
    )

    target_move = expected_underlying_move
    stop_move = _clamp(expected_underlying_move * 0.55, 1.2, 8.0)
    contract_side = _contract_side_from_direction(direction)

    stop_price = None
    target_price = None
    if price is not None:
        if contract_side == "CALL":
            stop_price = price * (1 - stop_move / 100.0)
            target_price = price * (1 + target_move / 100.0)
        elif contract_side == "PUT":
            stop_price = price * (1 + stop_move / 100.0)
            target_price = price * (1 - target_move / 100.0)

    return {
        "price": price,
        "hold_days": hold_days,
        "target_move": target_move,
        "stop_move": stop_move,
        "contract_side": contract_side,
        "target_price": target_price,
        "stop_price": stop_price,
    }


def _selected_contract_event_fields(selected_contract: Optional[dict[str, object]]) -> dict[str, object]:
    if not selected_contract:
        return {}
    return {
        "selected_expiry": selected_contract.get("expiry"),
        "selected_dte": selected_contract.get("dte"),
        "selected_strike": selected_contract.get("strike"),
        "selected_option_type": str(selected_contract.get("side") or "").lower() or None,
        "selected_premium": selected_contract.get("premium"),
        "selected_price_source": selected_contract.get("price_source"),
        "selected_bid": selected_contract.get("bid"),
        "selected_ask": selected_contract.get("ask"),
        "selected_last": selected_contract.get("last"),
        "selected_spread_pct": selected_contract.get("spread_pct"),
        "selected_volume": selected_contract.get("volume"),
        "selected_open_interest": selected_contract.get("open_interest"),
        "selected_implied_volatility": selected_contract.get("implied_volatility"),
        "selected_last_trade_at": selected_contract.get("last_trade_date"),
    }


def _build_training_trade_lines(
    direction: str,
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    threshold: Optional[float],
    horizon_returns: Optional[dict[str, Optional[float]]],
    history: Optional[pd.DataFrame],
    provider: Optional[MarketDataProvider] = None,
    symbol: Optional[str] = None,
    selected_contract: Optional[dict[str, object]] = None,
    review_window: Optional[ReviewWindow] = None,
) -> list[str]:
    plan = _training_plan_inputs(direction, iv30, hv30, horizon_returns, history)
    price = plan["price"]
    base_hold_days = int(plan["hold_days"])
    target_move = float(plan["target_move"])
    stop_move = float(plan["stop_move"])
    contract_side = plan["contract_side"] if isinstance(plan["contract_side"], str) else None

    if plan["stop_price"] is None or plan["target_price"] is None:
        stop_target_text = "n/a"
    else:
        stop_target_text = f"{float(plan['stop_price']):.2f} / {float(plan['target_price']):.2f}"

    if contract_side and selected_contract is None and provider is not None and symbol:
        selected_contract = _select_training_contract(
            provider=provider,
            symbol=symbol,
            current_price=float(price) if isinstance(price, (int, float)) else None,
            contract_side=contract_side,
            target_dte=60,
            min_remaining_after_hold=base_hold_days + 3,
            hold_days=base_hold_days,
            target_move_pct=target_move,
            stop_move_pct=stop_move,
            iv30=iv30,
            hv30=hv30,
        )

    if review_window is None:
        review_window = _review_window_for_plan(
            base_hold_days=base_hold_days,
            iv30=iv30,
            hv30=hv30,
            iv_percentile=iv_percentile,
            avg_edr=avg_edr,
            horizon_returns=horizon_returns,
            selected_contract=selected_contract,
        )
    hold_days = review_window.max_hold_days

    if contract_side is None:
        return [
            "  Setup     : direction neutral; no CALL/PUT training contract selected",
            "  Contract  : withheld until a directional signal is present",
            f"  Review Window: {review_window.min_hold_days}-{review_window.max_hold_days} trading days",
            f"  Hold      : {hold_days} trading days (max review gate)",
        ]

    if selected_contract:
        est_premium = float(selected_contract["premium"])
        premium_source = f"chain {selected_contract['price_source']}"
        contract_source_text = _format_source_text(
            selected_contract.get("data_source"),
            selected_contract.get("quote_source"),
        )
    elif price is None:
        est_premium = 2.5
        premium_source = "fallback"
    else:
        iv_scale = _clamp((float(iv30) / 30.0) if iv30 is not None else 1.0, 0.65, 1.9)
        est_premium = _clamp(price * 0.012 * iv_scale, 0.35, 18.0)
        premium_source = "formula fallback"

    effective_threshold = threshold if threshold is not None else 20.0
    cheapness_edge = (
        max(0.0, float(effective_threshold) - float(iv_percentile))
        if iv_percentile is not None
        else 0.0
    )
    target_premium_pct = _clamp(35.0 + cheapness_edge * 1.2, 28.0, 90.0)
    stop_premium_pct = _clamp(24.0 + (12.0 - min(12.0, cheapness_edge)) * 1.4, 25.0, 55.0)
    est_profit = float(selected_contract.get("convexity_profit", selected_contract.get("target_profit", 0.0))) if selected_contract else est_premium * 100.0 * (target_premium_pct / 100.0)
    est_loss = float(selected_contract.get("planned_loss", 0.0)) if selected_contract else est_premium * 100.0 * (stop_premium_pct / 100.0)

    lines = [
        f"  Setup     : 1x optimized {contract_side} (training example)",
    ]
    if selected_contract:
        bid = selected_contract.get("bid")
        ask = selected_contract.get("ask")
        spread_pct = selected_contract.get("spread_pct")
        bid_text = f"{float(bid):.2f}" if isinstance(bid, (int, float)) else "n/a"
        ask_text = f"{float(ask):.2f}" if isinstance(ask, (int, float)) else "n/a"
        spread_text = f"{float(spread_pct):.1f}%" if isinstance(spread_pct, (int, float)) else "n/a"
        iv = selected_contract.get("implied_volatility")
        iv_text = f"{float(iv) * 100:.1f}%" if isinstance(iv, (int, float)) else "n/a"
        target_option = selected_contract.get("target_option_price")
        convexity_option = selected_contract.get("convexity_exit_option_price")
        convexity_underlying = selected_contract.get("convexity_exit_underlying")
        stop_option = selected_contract.get("stop_option_price")
        rr = selected_contract.get("reward_risk")
        profit_pct = selected_contract.get("convexity_profit_pct", selected_contract.get("target_profit_pct"))
        loss_pct = selected_contract.get("planned_loss_pct")
        target_option_text = f"{float(target_option):.2f}" if isinstance(target_option, (int, float)) else "n/a"
        convexity_option_text = f"{float(convexity_option):.2f}" if isinstance(convexity_option, (int, float)) else target_option_text
        stop_option_text = f"{float(stop_option):.2f}" if isinstance(stop_option, (int, float)) else "n/a"
        rr_text = f"{float(rr):.2f}R" if isinstance(rr, (int, float)) else "n/a"
        profit_pct_text = f"{float(profit_pct):+.0f}%" if isinstance(profit_pct, (int, float)) else "n/a"
        loss_pct_text = f"-{float(loss_pct):.0f}%" if isinstance(loss_pct, (int, float)) else "n/a"
        target_underlying_text = (
            f"{float(plan['target_price']):.2f}" if isinstance(plan.get("target_price"), (int, float)) else "n/a"
        )
        convexity_underlying_text = (
            f"{float(convexity_underlying):.2f}" if isinstance(convexity_underlying, (int, float)) else target_underlying_text
        )
        stop_underlying_text = (
            f"{float(plan['stop_price']):.2f}" if isinstance(plan.get("stop_price"), (int, float)) else "n/a"
        )
        probability = selected_contract.get("convexity_probability_itm")
        delta = selected_contract.get("convexity_delta")
        theta_pct = selected_contract.get("convexity_theta_daily_pct")
        probability_text = f"{float(probability) * 100:.0f}%" if isinstance(probability, (int, float)) else "n/a"
        delta_text = f"{float(delta):.2f}" if isinstance(delta, (int, float)) else "n/a"
        theta_text = f"{float(theta_pct):.1f}%/day" if isinstance(theta_pct, (int, float)) else "n/a"
        lines.extend(
            [
                f"  Contract  : {selected_contract['expiry']} {float(selected_contract['strike']):.2f} {contract_side}",
                f"  Quote     : bid {bid_text} / ask {ask_text} / spread {spread_text}",
                f"  Data Src  : {contract_source_text}",
                f"  OI/Vol/IV : {selected_contract['open_interest']} / {selected_contract['volume']} / {iv_text}",
                f"  Hump Exit : opt ${convexity_option_text} ({profit_pct_text}) @ und ${convexity_underlying_text}",
                f"  Hump Prob : ITM {probability_text} / delta {delta_text} / theta {theta_text}",
                f"  Base Tgt  : opt ${target_option_text} @ und ${target_underlying_text}",
                f"  Risk Cut  : opt ${stop_option_text} ({loss_pct_text}) @ und ${stop_underlying_text}",
                f"  Max Profit: +${est_profit:.0f} convexity harvest",
                f"  Reward/Risk: {rr_text}",
            ]
        )
    else:
        lines.append("  Contract  : market data chain quote unavailable")

    lines.extend(
        [
            f"  Est Prem  : ${est_premium:.2f} ({premium_source})",
            f"  Est G/L   : +${est_profit:.0f} / -${est_loss:.0f}",
            f"  Stop/Tgt  : {stop_target_text}",
            f"  Review Window: {review_window.min_hold_days}-{review_window.max_hold_days} trading days",
            f"  Hold      : {hold_days} trading days (max review gate, 30-90 DTE scan)",
        ]
    )
    return lines


def _ansi(text: str, color: int, fmt: int = 1) -> str:
    return f"{ESC}[{fmt};{color}m{text}{ANSI_RESET}"


def _bias_color(bias: str) -> int:
    code = (bias or "").upper()
    if code == "CHEAP":
        return 32
    if code == "EXPENSIVE":
        return 31
    if code == "FAIR":
        return 33
    return 30


def _direction_color(direction: str) -> int:
    code = (direction or "").lower()
    if code == "calls":
        return 32
    if code == "puts":
        return 31
    return 33


def _sparkline(values: list[float]) -> str:
    blocks = "▁▂▃▄▅▆▇█"
    if not values:
        return "n/a"
    max_abs = max(abs(value) for value in values)
    if max_abs < 1e-9:
        mid = blocks[len(blocks) // 2]
        return "".join(_ansi(mid, 33, fmt=1) for _ in values)

    out: list[str] = []
    for value in values:
        # Zero-centered scaling: 0.0 maps to 50% height.
        pct = (value + max_abs) / (2 * max_abs)
        pct = max(0.0, min(1.0, pct))
        idx = int(round(pct * (len(blocks) - 1)))
        idx = max(0, min(len(blocks) - 1, idx))
        bar = blocks[idx]
        color = 31 if pct < 0.5 else 32 if pct > 0.5 else 33
        out.append(_ansi(bar, color, fmt=1))
    return "".join(out)


def _compute_weekly_macd_bundle_norm(
    history: Optional[pd.DataFrame],
    points: int = 24,
) -> dict[str, list[float]]:
    if history is None or history.empty:
        return {}
    close = history.get("Close")
    if close is None:
        return {}
    close = close.dropna()
    if close.empty:
        return {}

    weekly = close.resample("W-FRI").last().dropna()
    if len(weekly) < 30:
        return {}

    ema_fast = weekly.ewm(span=12, adjust=False).mean()
    ema_slow = weekly.ewm(span=26, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal = macd.ewm(span=9, adjust=False).mean()
    histo = macd - signal

    range_window = weekly.tail(52)
    prange = float(range_window.max() - range_window.min()) if not range_window.empty else 0.0
    if prange <= 0:
        return {}

    scale = 100.0 / prange
    macd_norm = (macd * scale).tail(points)
    signal_norm = (signal * scale).tail(points)
    histo_norm = (histo * scale).tail(points)
    return {
        "macd": [float(value) for value in macd_norm.tolist()],
        "signal": [float(value) for value in signal_norm.tolist()],
        "hist": [float(value) for value in histo_norm.tolist()],
    }


def _compute_weekly_macd_series_norm(
    history: Optional[pd.DataFrame],
    points: int = 24,
) -> list[float]:
    return _compute_weekly_macd_bundle_norm(history, points=points).get("hist", [])


def _compute_weekly_macd_oscillator(history: Optional[pd.DataFrame]) -> tuple[Optional[float], str]:
    series = _compute_weekly_macd_series_norm(history, points=24)
    if not series:
        return None, "n/a"
    latest = float(series[-1])
    spark_values = series[-16:] if len(series) >= 16 else series
    return latest, _sparkline(spark_values)


def _horizon_compact_text(returns: Optional[dict[str, Optional[float]]]) -> str:
    if not returns:
        return "1m n/a  3m n/a  6m n/a  1y+ n/a"
    parts: list[str] = []
    for horizon in HORIZON_WINDOWS.keys():
        value = returns.get(horizon)
        if value is None:
            parts.append(f"{horizon} n/a")
        else:
            parts.append(f"{horizon} {value:+.1f}%")
    return "  ".join(parts)


def _wrap_text(text: str, width: int = 64, indent: str = "  ") -> list[str]:
    if not text:
        return [f"{indent}n/a"]
    words = text.split()
    lines: list[str] = []
    current = indent
    for word in words:
        candidate = f"{current} {word}" if current.strip() else f"{indent}{word}"
        if len(candidate) > width and current != indent:
            lines.append(current)
            current = f"{indent}{word}"
        else:
            current = candidate
    lines.append(current)
    return lines


def _compact_votes(votes: list[str]) -> str:
    if not votes:
        return "n/a"
    mapping = {
        "CHEAP:IV_SPREAD": "IV<HV",
        "EXPENSIVE:IV_SPREAD": "IV>HV",
        "FAIR:IV_SPREAD": "IV~HV",
        "CHEAP:IV_PCTL": "Low 30D chain pct",
        "EXPENSIVE:IV_PCTL": "High 30D chain pct",
        "FAIR:IV_PCTL": "Mid 30D chain pct",
        "CHEAP:EDR": "Low EDR",
        "EXPENSIVE:EDR": "High EDR",
        "FAIR:EDR": "Mid EDR",
    }
    return " | ".join(mapping.get(vote, vote) for vote in votes)


def _is_exceptional_sweep_setup(
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    threshold: Optional[float],
    votes: Optional[list[str]],
) -> bool:
    """Identify very strong mispricing setups for visual emphasis in Discord formatting."""
    if iv_percentile is None:
        return False

    effective_threshold = threshold if threshold is not None else 20.0
    percentile_cutoff = min(12.0, max(5.0, effective_threshold * 0.5))

    spread_ok = iv30 is not None and hv30 is not None and (iv30 - hv30) <= -4.0
    edr_ok = avg_edr is not None and avg_edr <= 35.0
    vote_ok = any(str(vote).startswith("CHEAP:") for vote in (votes or []))

    ultra_cheap = iv_percentile <= 5.0
    strong_cheap = iv_percentile <= percentile_cutoff and (spread_ok or edr_ok)
    return vote_ok and (ultra_cheap or strong_cheap)


def _format_opportunity_rank_lines(
    *,
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    selected_contract: Optional[dict[str, object]],
) -> list[str]:
    selected_fields = selected_contract_signal_fields(selected_contract)
    score = compute_opportunity_score(
        iv_percentile=iv_percentile,
        iv30=iv30,
        hv30=hv30,
        avg_edr=avg_edr,
        selected_spread_pct=(selected_contract or {}).get("spread_pct"),
        selected_open_interest=(selected_contract or {}).get("open_interest"),
        selected_volume=(selected_contract or {}).get("volume"),
        selected_reward_risk=selected_fields.get("selected_reward_risk"),
        selected_convexity_profit_pct=selected_fields.get("selected_convexity_profit_pct"),
        selected_convexity_probability_itm=selected_fields.get("selected_convexity_probability_itm"),
        selected_contract_score=selected_fields.get("selected_contract_score"),
    )
    components = score.get("components") or {}
    return [
        f"  Score     : {float(score['rank_score']):.0f} / {score.get('grade') or 'n/a'}",
        "  Drivers   : "
        f"cheap {float(components.get('cheapness') or 0):.0f} | "
        f"edge {float(components.get('volatility_edge') or 0):.0f} | "
        f"contract {float(components.get('contract_quality') or 0):.0f} | "
        f"exec {float(components.get('execution_quality') or 0):.0f}",
    ]


def _format_alert_message(
    label: str,
    symbol: str,
    iv_percentile: Optional[float],
    iv30: Optional[float],
    hv30: Optional[float],
    avg_edr: Optional[float],
    bias: str,
    votes: list[str],
    reason: str,
    direction: str,
    direction_reason: str,
    threshold: Optional[float],
    horizon_labels: Optional[dict[str, str]] = None,
    horizon_returns: Optional[dict[str, Optional[float]]] = None,
    history: Optional[pd.DataFrame] = None,
    provider: Optional[MarketDataProvider] = None,
    selected_contract: Optional[dict[str, object]] = None,
    analyzer_url: Optional[str] = None,
    options_data_source: Optional[object] = None,
    options_quote_source: Optional[object] = None,
    review_window: Optional[ReviewWindow] = None,
) -> str:
    threshold_text = _format_value(threshold, 1) if threshold is not None else "n/a"
    exceptional = _is_exceptional_sweep_setup(
        iv_percentile=iv_percentile,
        iv30=iv30,
        hv30=hv30,
        avg_edr=avg_edr,
        threshold=threshold,
        votes=votes,
    )
    direction_label = "NEUTRAL"
    if direction.lower() == "calls":
        direction_label = "BULLISH"
    elif direction.lower() == "puts":
        direction_label = "BEARISH"

    macd_osc_pct, macd_spark = _compute_weekly_macd_oscillator(history)
    macd_text = f"{macd_osc_pct:+.2f}%" if macd_osc_pct is not None else "n/a"
    bias_colored = _ansi(bias, _bias_color(bias))
    direction_colored = _ansi(direction_label, _direction_color(direction))
    macd_color = _direction_color(
        "calls" if (macd_osc_pct or 0) > 0 else "puts" if (macd_osc_pct or 0) < 0 else "neutral"
    )
    macd_colored = _ansi(macd_text, macd_color)

    headline = f"{symbol} - {label}"
    horizons = _horizon_compact_text(horizon_returns)
    direction_lines = _wrap_text(direction_reason, width=66, indent="    ")
    training_lines = _build_training_trade_lines(
        direction=direction,
        iv_percentile=iv_percentile,
        iv30=iv30,
        hv30=hv30,
        avg_edr=avg_edr,
        threshold=threshold,
        horizon_returns=horizon_returns,
        history=history,
        provider=provider,
        symbol=symbol,
        selected_contract=selected_contract,
        review_window=review_window,
    )
    section_title_color = 97 if exceptional else 37
    separator_line = (
        "════════════════════════════════════════════════════════"
        if exceptional
        else "────────────────────────────────────────────────────────"
    )
    accent_line = _ansi("▓" * len(separator_line), 93) if exceptional else None
    iv_line = f"  30D Ch Pct: {_format_value(iv_percentile, 1)}% (<= {threshold_text}%)"
    if exceptional:
        iv_line = _ansi(iv_line, 92)
    metrics_source_text = _format_source_text(
        options_data_source or (selected_contract or {}).get("data_source"),
        options_quote_source or (selected_contract or {}).get("quote_source"),
    )

    ansi_lines = [
        *([accent_line] if accent_line else []),
        _ansi(headline, 93 if exceptional else 36),
        separator_line,
        "",
        _ansi("MISPRICING", section_title_color),
        f"  Consensus : {bias_colored}",
        iv_line,
        f"  IV/HV/EDR : {_format_value(iv30, 2)} / {_format_value(hv30, 2)} / {_format_value(avg_edr, 2)}",
        f"  Data Src  : {metrics_source_text}",
        "",
        _ansi("OPPORTUNITY RANK", section_title_color),
        *_format_opportunity_rank_lines(
            iv_percentile=iv_percentile,
            iv30=iv30,
            hv30=hv30,
            avg_edr=avg_edr,
            selected_contract=selected_contract,
        ),
        "",
        _ansi("DIRECTION", section_title_color),
        f"  Bias      : {direction_colored}",
        *direction_lines,
        "",
        _ansi("MACD 1W (Normalized by 52W Range)", section_title_color),
        f"  Oscillator: {macd_colored}",
        f"  Sparkline : {macd_spark}",
        "",
        _ansi("HORIZONS", section_title_color),
        f"  {horizons}",
        "",
        _ansi("EXAMPLE TRADE (TRAINING)", section_title_color),
        *training_lines,
        *([accent_line] if accent_line else []),
    ]

    lines = ["```ansi", *ansi_lines, "```"]
    return "\n".join(lines)


def _build_stock_analyzer_url(symbol: str) -> str:
    base = (
        os.getenv("STOCK_ANALYZER_BASE_URL")
        or os.getenv("FRONTEND_BASE_URL")
        or "https://marketdiagnostictool.com"
    ).strip()
    base = base.rstrip("/")
    normalized = quote((symbol or "").strip().upper(), safe="")
    return f"{base}/stock-analysis/{normalized}?symbol={normalized}"


def _should_trigger(watch: OptionAlertWatch, iv_percentile: Optional[float]) -> bool:
    if not watch.active:
        return False
    return _passes_scanner_threshold(iv_percentile, watch.iv_percentile_max)


def run_options_alert_scan() -> dict:
    results = {"checked": 0, "triggered": 0, "errors": 0}
    provider = get_market_data_provider()
    with get_db_session() as db:
        watches = db.query(OptionAlertWatch).filter(OptionAlertWatch.active.is_(True)).all()

        for watch in watches:
            results["checked"] += 1
            symbol = watch.symbol.upper()
            try:
                current_price = _get_current_price(provider, symbol)
                if current_price is None:
                    continue

                hist = provider.daily_bars(symbol, days=365)
                hv30 = compute_historical_volatility(hist, 30) if hist is not None else None
                metrics = compute_optionality_metrics(provider, symbol, current_price, hv30)
                iv_percentile = _scanner_iv_percentile(metrics)
                iv30 = metrics.get("iv30")
                avg_edr = metrics.get("avg_edr")

                if not _is_iv_data_valid(iv30, hv30, iv_percentile):
                    continue

                if not _should_trigger(watch, iv_percentile):
                    continue
                bias, votes = _compute_option_bias(iv30, hv30, iv_percentile, avg_edr)

                reason = _build_alert_reason(
                    iv30,
                    hv30,
                    iv_percentile,
                    watch.iv_percentile_max,
                    bias,
                    votes,
                )
                direction, direction_reason = _direction_hint(hist)
                horizon_labels, horizon_returns = _compute_horizon_bias(hist)
                plan = _training_plan_inputs(direction, iv30, hv30, horizon_returns, hist)
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
                    )
                    if contract_side in {"CALL", "PUT"}
                    else None
                )
                review_window = _review_window_for_plan(
                    base_hold_days=hold_days,
                    iv30=iv30,
                    hv30=metrics.get("hv30"),
                    iv_percentile=iv_percentile,
                    avg_edr=avg_edr,
                    horizon_returns=horizon_returns,
                    selected_contract=selected_contract,
                )
                if watch.last_triggered_at:
                    cooldown = timedelta(minutes=watch.cooldown_minutes or 0)
                    if datetime.utcnow() - watch.last_triggered_at < cooldown:
                        continue
                event_time = datetime.utcnow()
                field_context = build_option_field_context(
                    hist,
                    option_type=contract_side,
                    position_action="buy_to_open",
                    strategy_scope="single_leg",
                    observed_at=event_time,
                    data_source=_provider_source(provider, "daily_bars"),
                    timeframe="1D",
                )
                analyzer_url = _build_stock_analyzer_url(symbol)

                message = _format_alert_message(
                    "Watchlist",
                    symbol,
                    iv_percentile,
                    iv30,
                    metrics.get("hv30"),
                    avg_edr,
                    bias,
                    votes,
                    reason,
                    direction,
                    direction_reason,
                    watch.iv_percentile_max,
                    horizon_labels,
                    horizon_returns,
                    hist,
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
                event = OptionAlertEvent(
                    symbol=symbol,
                    triggered_at=event_time,
                    iv30=iv30,
                    hv30=metrics.get("hv30"),
                    iv_percentile=iv_percentile,
                    avg_edr=metrics.get("avg_edr"),
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
                watch.last_triggered_at = datetime.utcnow()
                db.add(watch)
                db.commit()
                results["triggered"] += 1
            except Exception:
                results["errors"] += 1
                db.rollback()
    return results
