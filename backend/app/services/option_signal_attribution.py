"""Scanner association for executions, distinct from broker fill provenance."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from app.models.closed_positions import ClosedPosition
from app.models.option_decision_learning import OptionPositionEvent
from app.models.option_positions import OptionPosition
from app.models.options_alerts import OptionAlertEvent

EASTERN = ZoneInfo("America/New_York")
FIELDS = ("source_event_id", "source_triggered_at", "source_match_method", "source_match_confidence", "source_match_notes")
IMPORT_METHODS = ("fidelity_activity", "fidelity_activity_unlinked")
ETF_DIRECTORY_PATH = Path(__file__).resolve().parents[1] / "data" / "etf_directory.json"


@lru_cache(maxsize=1)
def _personal_etf_symbols() -> frozenset[str]:
    # Mirrored from the tracker's sourced Nasdaq directory; a parity test keeps
    # the frontend visibility preference and automatic attribution consistent.
    return frozenset(json.loads(ETF_DIRECTORY_PATH.read_text(encoding="utf-8"))["symbols"])


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def resolve_signal_attribution(db, symbol: str, trade_date: date, explicit_event_id=None, *,
                               expiration=None, strike=None, option_type=None, strategy_type="single_leg",
                               latest_allowed_at=None) -> dict[str, object]:
    symbol = symbol.strip().upper()
    no_match = dict(source_event_id=None, source_triggered_at=None, source_match_method="no_match",
                    source_match_confidence=0.0, source_match_notes="No compatible scanner hit on or before the entry date.")
    if explicit_event_id is not None:
        event = db.query(OptionAlertEvent).filter(OptionAlertEvent.id == explicit_event_id).first()
        if event and (event.symbol or "").upper() == symbol and event.triggered_at:
            return dict(source_event_id=event.id, source_triggered_at=event.triggered_at,
                        source_match_method="manual_event_id", source_match_confidence=1.0,
                        source_match_notes="Manually linked scanner event; association supplied by the user.")
    if symbol in _personal_etf_symbols() or re.sub(r"\d+$", "", symbol) in _personal_etf_symbols():
        no_match["source_match_notes"] = "Personal ETF option: excluded from automatic scanner attribution."
        return no_match
    end = datetime.combine(trade_date, time.max, EASTERN).astimezone(timezone.utc)
    if latest_allowed_at is not None:
        end = min(end, _utc(latest_allowed_at))
    start = datetime.combine(trade_date-timedelta(days=21), time.min, EASTERN).astimezone(timezone.utc)
    events = db.query(OptionAlertEvent).filter(
        OptionAlertEvent.symbol == symbol, OptionAlertEvent.triggered_at.isnot(None),
        OptionAlertEvent.triggered_at >= start.replace(tzinfo=None),
        OptionAlertEvent.triggered_at <= end.replace(tzinfo=None),
    ).all()
    candidates = []
    for event in events:
        kind = (event.selected_option_type or "").lower()
        if strategy_type == "single_leg" and event.selected_strategy_type in {"long_straddle", "long_strangle"}:
            continue
        # A straddle or an untyped legacy hit does not establish call/put direction.
        if option_type and kind != option_type.lower():
            continue
        days = (trade_date-_utc(event.triggered_at).astimezone(EASTERN).date()).days
        if days < 0:
            continue
        contract = (expiration is not None and strike is not None
                    and str(event.selected_expiry) == str(expiration)
                    and event.selected_strike is not None
                    and abs(event.selected_strike-float(strike)) < 1e-6 and bool(kind))
        event_strategy = event.selected_strategy_type
        same_strategy = strategy_type == "single_leg" and event_strategy in {"single_leg", "long_call", "long_put"}
        method = "contract+entry_date" if contract and same_strategy else "contract_leg+entry_date" if contract else "symbol+direction+entry_date"
        cap = .95 if contract and same_strategy else .85 if contract else .70
        confidence = min(cap, .95 if days == 0 else .92-.04*days if days <= 7 else .45)
        candidates.append((confidence, int(contract), _utc(event.triggered_at), event.id, event, method, days))
    if not candidates:
        return no_match
    confidence, _, _, _, event, method, days = max(candidates, key=lambda row: row[:4])
    if confidence < .60:
        no_match["source_match_notes"] = f"Scanner hit #{event.id} is {days} days old; manual association required."
        return no_match
    basis = ("Selected option contract matches." if method == "contract+entry_date" else
             "Selected contract leg matches; full strategy equivalence is unverified." if method == "contract_leg+entry_date" else
             "Underlying and call/put direction match; selected contract or strategy differs.")
    timing = " Same-day execution time is unavailable; association is inferred, not proof of signal-before-fill." if days == 0 else " Association inferred from entry-date evidence."
    return dict(source_event_id=event.id, source_triggered_at=event.triggered_at, source_match_method=method,
                source_match_confidence=confidence, source_match_notes=basis+timing)


def _capture_bound(db, position) -> datetime | None:
    """Use a broker export's capture time as an upper bound when it is known."""
    pid = position.source_position_id if isinstance(position, ClosedPosition) else position.id
    if pid is None:
        return None
    events = db.query(OptionPositionEvent).filter(
        OptionPositionEvent.position_id == pid, OptionPositionEvent.event_type == "opened",
    ).order_by(OptionPositionEvent.id.asc()).all()
    for event in events:
        try:
            raw = json.loads(event.details_json).get("source_asof")
            parsed = datetime.fromisoformat(raw) if raw else None
            if parsed and parsed.tzinfo is not None:
                return parsed
        except (ValueError, TypeError, AttributeError):
            continue
    return None


def backfill_signal_links(db, *, limit=1000, from_date=None, imported_only=False, dry_run=False):
    """Repair missing links with append-only evidence; never change fill economics."""
    from app.services.option_decision_learning import create_trade_outcome, record_position_event

    result = {"dry_run": dry_run, "open_positions_checked": 0, "open_positions_linked": 0,
              "closed_positions_checked": 0, "closed_positions_linked": 0,
              "unlinked_confidence_corrected": 0, "links": []}
    for kind, model in (("open", OptionPosition), ("closed", ClosedPosition)):
        query = db.query(model).filter(model.source_event_id.is_(None))
        if from_date:
            query = query.filter(model.trade_date >= from_date)
        if imported_only:
            query = query.filter(model.source_match_method.in_(IMPORT_METHODS))
        query = query.order_by(model.trade_date.desc(), model.id.desc()).limit(limit)
        if not dry_run:
            query = query.with_for_update(skip_locked=True)
        for position in query.all():
            result[f"{kind}_positions_checked"] += 1
            attribution = resolve_signal_attribution(db, position.symbol, position.trade_date,
                expiration=position.expiration, strike=position.strike, option_type=position.option_type,
                strategy_type=position.strategy_type or "single_leg", latest_allowed_at=_capture_bound(db, position))
            linked = attribution["source_event_id"] is not None
            if not linked:
                if position.source_match_method not in IMPORT_METHODS or position.source_match_confidence == 0.0:
                    continue
                # Broker verification is not scanner-match confidence. Keep the import
                # marker so later maintenance may still retry a missing association.
                attribution["source_match_method"] = position.source_match_method
                result["unlinked_confidence_corrected"] += 1
            else:
                result[f"{kind}_positions_linked"] += 1
                result["links"].append(dict(kind=kind, position_id=position.id, symbol=position.symbol,
                    event_id=attribution["source_event_id"], method=attribution["source_match_method"],
                    confidence=attribution["source_match_confidence"]))
            if dry_run:
                continue
            before = {name: getattr(position, name) for name in FIELDS}
            # Execution provenance is independent of the scanner association.
            notes = attribution["source_match_notes"]
            attribution["source_match_notes"] = (position.source_match_notes or "") + "\nScanner attribution: " + notes
            for name in FIELDS:
                setattr(position, name, attribution[name])
            snapshot_before = None
            if kind == "closed" and position.source_position_snapshot_json:
                snapshot_before = position.source_position_snapshot_json
                snapshot = json.loads(snapshot_before)
                snapshot.update({name: value.isoformat() if isinstance(value, datetime) else value for name, value in attribution.items()})
                position.source_position_snapshot_json = json.dumps(snapshot)
            record_position_event(db, position_id=(position.source_position_id or 0) if kind == "closed" else position.id,
                closed_position_id=position.id if kind == "closed" else None,
                event_type="scanner_attribution_repaired" if linked else "scanner_attribution_checked",
                # related_alert_event_id has a recurrence-specific uniqueness key;
                # several partial closes may legitimately share this same source hit.
                source="scanner_attribution_v2",
                quantity_before=position.contracts, quantity_after=position.contracts,
                total_cost_before=position.total_cost, total_cost_after=position.total_cost,
                details={"before": {k: v.isoformat() if isinstance(v, datetime) else v for k, v in before.items()},
                         "after": {k: v.isoformat() if isinstance(v, datetime) else v for k, v in attribution.items()},
                         "source_position_snapshot_before": snapshot_before})
            if kind == "closed" and linked:
                from app.models.option_decision_learning import OptionTradeOutcome
                latest = db.query(OptionTradeOutcome).filter(OptionTradeOutcome.closed_position_id == position.id).order_by(
                    OptionTradeOutcome.outcome_version.desc(), OptionTradeOutcome.id.desc()).first()
                overrides = json.loads(latest.attribution_json or "{}").get("human_overrides") if latest else None
                create_trade_outcome(db, position, force=True, human_overrides=overrides)
    return result
