"""Read-only Fidelity OCO references from saved single-leg training examples.

No broker connection, quote fetch, order placement, or new stop recommendation.
The published option-premium levels are preserved, never rebased to a fill.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import re
from zoneinfo import ZoneInfo

ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
CONTRACT = re.compile(r"^\s*Contract\s*:\s*(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)\s+(CALL|PUT)\s*$", re.M | re.I)
PREMIUM_LEVEL = re.compile(r"^\s*(Hump Exit|Base Tgt|Risk Cut)\s*:\s*opt\s*\$([\d.]+)\b", re.M | re.I)


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _iso(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else str(value) if value else None


def _contract_key(position):
    return (position.account, position.symbol, _iso(position.expiration), position.strike, position.option_type)


def _saved_levels(event, position):
    """Require both the structured contract and the printed training contract."""
    plain = ANSI.sub("", event.message or "")
    contracts = CONTRACT.findall(plain)
    expected = (_iso(position.expiration), float(position.strike), position.option_type.lower())
    if (
        (event.symbol or "").upper() != position.symbol.upper()
        or str(event.selected_expiry) != expected[0]
        or _number(event.selected_strike) != expected[1]
        or (event.selected_option_type or "").lower() != expected[2]
        or len(contracts) != 1
        or (contracts[0][0], float(contracts[0][1]), contracts[0][2].lower()) != expected
    ):
        return None, "Saved scanner contract differs from the held contract. No levels transferred."
    values = {}
    for label, raw in PREMIUM_LEVEL.findall(plain):
        label = label.lower()
        number = _number(raw)
        if number is None or number <= 0 or (label in values and values[label] != number):
            return None, "Saved option-premium exit levels are invalid or ambiguous."
        values[label] = number
    stop = values.get("risk cut")
    target = values.get("hump exit", values.get("base tgt"))
    entry = _number(event.selected_premium)
    if stop is None or target is None or entry is None or not 0 < stop < entry < target:
        return None, "The saved example has no complete, valid option-premium stop and target."
    return {
        "entry_premium": entry,
        "stop_premium": stop,
        "target_premium": target,
        "target_basis": "Hump Exit" if "hump exit" in values else "Base Tgt",
        "source": "saved_scanner_message",
    }, None


def build_exit_plan_queue(positions, events_by_id, metrics_by_id=None, *, proposals=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(ZoneInfo("America/New_York")).date()
    metrics_by_id = metrics_by_id or {}
    proposals = proposals or {}
    inventory = Counter()
    lot_counts = Counter()
    for position in positions:
        inventory[_contract_key(position)] += position.contracts
        lot_counts[_contract_key(position)] += 1
    rows = []
    for position in positions:
        proposal = proposals.get(position.id, {})
        event_id = position.source_event_id or proposal.get("source_event_id")
        event = events_by_id.get(event_id)
        method = position.source_match_method if position.source_event_id else proposal.get("source_match_method")
        reasons = []
        warnings = []
        levels = None
        if getattr(position, "strategy_type", None) not in (None, "single_leg"):
            reasons.append("Multi-leg positions need a strategy-level exit; single-leg OCO levels are withheld.")
        if not re.fullmatch(r"[A-Z]+", position.symbol) or position.symbol in {"VIX", "SPX", "SPXW", "NDX", "RUT", "XSP"}:
            reasons.append("Adjusted or index contract: confirm the broker contract and deliverable manually.")
        if position.contracts <= 0 or int(position.contracts) != position.contracts:
            reasons.append("Only positive whole-contract long positions are supported.")
        if getattr(position, "action", None) not in (None, "BUY", "BUY_TO_OPEN"):
            reasons.append("The tracker does not identify this as a long option position.")
        expiration = date.fromisoformat(_iso(position.expiration))
        if expiration < today:
            reasons.append("Contract expiration has passed; reconcile the holding before preparing an exit.")
        elif expiration == today:
            warnings.append("Expires today: verify the holding and any broker exercise or closing deadline.")
        if not position.account:
            reasons.append("Brokerage account is missing.")
        if event is None:
            reasons.append("No matching saved scanner example. No default stop or target has been invented.")
        else:
            event_day = event.triggered_at
            if event_day is None:
                reasons.append("The scanner example has no signal timestamp.")
            else:
                aware = event_day.replace(tzinfo=timezone.utc) if event_day.tzinfo is None else event_day
                if aware.astimezone(ZoneInfo("America/New_York")).date() > position.trade_date:
                    reasons.append("Scanner example was generated after this trade's entry date.")
            if not reasons:
                levels, issue = _saved_levels(event, position)
                if issue:
                    reasons.append(issue)
            if method != "manual_event_id":
                warnings.append("Scanner association is inferred. Confirm this is the plan you intended; execution time is unavailable.")
            if event.selected_strategy_type not in (None, "single_leg", "long_call", "long_put"):
                warnings.append("Scanner also proposed a multi-leg strategy. These levels belong only to its printed single-leg training example.")
        metrics = metrics_by_id.get(position.id) or {}
        quote = metrics.get("quote") or {}
        mark = _number(metrics.get("option_price"))
        if mark is None or mark <= 0:
            mark = None
        status = "needs_plan" if not levels else "review"
        if levels:
            if mark is not None and mark <= levels["stop_premium"]:
                status = "stop_crossed"
                warnings.append("Available mark is at or below the old stop. Do not reuse it as a new below-market stop without review.")
            elif mark is not None and mark >= levels["target_premium"]:
                status = "target_crossed"
                warnings.append("Available mark is at or above the old target. Review the current market before entering the bracket.")
        if reasons:
            status = "needs_plan"
            levels = None
        if mark is None:
            warnings.append("No indicative option mark is available; verify prices directly in Fidelity.")
        warnings.append("Quote and spread data are indicative, not a live order-eligibility check.")
        count = lot_counts[_contract_key(position)]
        if count > 1:
            warnings.append(f"{count} tracker lots share this account and contract ({inventory[_contract_key(position)]} contracts total). This reference covers only this lot's quantity; avoid overlapping exits.")
        symbol = None
        try:
            strike = Decimal(str(position.strike))
            if not strike.is_finite() or strike <= 0:
                raise InvalidOperation
            strike_text = format(strike.normalize(), "f")
            if re.fullmatch(r"[A-Z]+", position.symbol) and position.option_type in {"call", "put"}:
                symbol = f"-{position.symbol}{expiration:%y%m%d}{position.option_type[0].upper()}{strike_text}"
        except InvalidOperation:
            reasons.append("Invalid contract strike.")
            levels = None
            status = "needs_plan"
        fingerprint = hashlib.sha256(json.dumps({
            "position_id": position.id, "account": position.account, "contract": symbol,
            "contracts": position.contracts, "event": event_id, "levels": levels,
            "trade_date": _iso(position.trade_date), "cost": position.total_cost,
        }, sort_keys=True).encode()).hexdigest()[:24]
        rows.append({
            "position_id": position.id, "fingerprint": fingerprint, "account": position.account,
            "symbol": position.symbol, "contract_symbol": symbol, "expiration": _iso(position.expiration),
            "strike": position.strike, "option_type": position.option_type, "contracts": position.contracts,
            "account_contract_quantity": inventory[_contract_key(position)], "sibling_lots": count,
            "trade_date": _iso(position.trade_date), "actual_fill": position.fill_price,
            "source_event_id": event_id, "source_triggered_at": _iso(event.triggered_at) if event else None,
            "source_match_method": method, "source_is_candidate": not bool(position.source_event_id),
            "levels": levels, "status": status, "reasons": reasons, "warnings": warnings,
            "indicative_mark": mark, "mark_source": metrics.get("option_price_source"),
            "last_trade_at": quote.get("last_trade_at"), "quote_quality": quote.get("quality"),
            "broker_order_status": "unknown", "broker_available_quantity": None,
        })
    priority = {"stop_crossed": 0, "target_crossed": 1, "review": 2, "needs_plan": 3}
    rows.sort(key=lambda row: (priority[row["status"]], row["expiration"], row["symbol"], row["position_id"]))
    return {
        "schema_version": "option_exit_plan_queue_v1", "as_of": now.isoformat(), "rows": rows,
        "summary": {"lots": len(rows), "with_levels": sum(bool(r["levels"]) for r in rows),
                    "stop_crossed": sum(r["status"] == "stop_crossed" for r in rows),
                    "needs_plan": sum(r["status"] == "needs_plan" for r in rows)},
        "broker_connected": False, "order_submission_enabled": False,
        "broker_review": "Verify current holding, available quantity, existing orders, account restrictions, paid-for status and permitted price increments in Fidelity. Both OCO legs cover the same quantity. Stop-market execution can differ from the stop; a stop-limit can remain unfilled.",
        "fidelity_help_url": "https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/active-trader/things-to-know.pdf",
    }
