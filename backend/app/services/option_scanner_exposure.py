from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
from typing import Any, Iterable, Mapping, Optional
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.option_scanner_exposure import (
    OptionScannerImpression,
    OptionScannerRankSnapshot,
)
from app.models.option_sweep_runs import OptionSweepRun


RANK_SNAPSHOT_SCHEMA_VERSION = "option_scanner_rank_snapshot_v1"
RANK_SNAPSHOT_SURFACE = "scanner_run_detail"
TERMINAL_SWEEP_STATUSES = {"completed", "stopped", "error"}
ALLOWED_IMPRESSION_TYPES = {
    "ranking_rendered",
    "candidate_visible",
    "candidate_detail_opened",
    "market_field_link_clicked",
    "trade_prefill_opened",
}
EVENT_REQUIRED_IMPRESSION_TYPES = ALLOWED_IMPRESSION_TYPES - {"ranking_rendered"}
_CLIENT_IMPRESSION_ID = re.compile(r"^[A-Za-z0-9._:-]{16,128}$")
_MAX_METADATA_KEYS = 12
_MAX_METADATA_BYTES = 2048


class ScannerImpressionReplayConflict(ValueError):
    """A client id was replayed with a materially different payload."""


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def _finite_number(value: object, *, digits: int = 8) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return round(parsed, digits)


def _positive_int(value: object) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _rank_candidate(
    opportunity: Mapping[str, Any],
    *,
    display_ordinal: int,
) -> dict[str, object]:
    evaluation = opportunity.get("learning_evaluation")
    learning = evaluation if isinstance(evaluation, Mapping) else {}
    field_context = opportunity.get("field_context")
    field = field_context if isinstance(field_context, Mapping) else {}
    event_id = _positive_int(opportunity.get("event_id"))
    if event_id is None:
        raise ValueError("Every scanner snapshot candidate requires a positive event_id.")

    applied_rank = _positive_int(learning.get("applied_rank")) or display_ordinal
    return {
        "event_id": event_id,
        "symbol": str(opportunity.get("symbol") or "").strip().upper(),
        "scan_ordinal": _positive_int(opportunity.get("scan_ordinal")) or display_ordinal,
        "display_ordinal": display_ordinal,
        "champion_rank": _positive_int(learning.get("champion_rank")),
        "counterfactual_rank": _positive_int(learning.get("counterfactual_rank")),
        "applied_rank": applied_rank,
        "champion_score": _finite_number(learning.get("champion_score")),
        "counterfactual_score": _finite_number(learning.get("counterfactual_score")),
        "applied_score": _finite_number(learning.get("applied_score")),
        "applied_weight": _finite_number(learning.get("applied_weight")),
        "opportunity_model_version": str(opportunity.get("model_version") or ""),
        "ranking_model_version": str(
            opportunity.get("ranking_model_version")
            or learning.get("version")
            or ""
        ),
        "learning_receipt_version": (
            str(learning.get("version") or "")
            if learning.get("point_in_time_receipt") is True
            else None
        ),
        "learning_receipt_captured_at": learning.get("captured_at"),
        "point_in_time_receipt": learning.get("point_in_time_receipt") is True,
        "field_context_version": str(field.get("version") or "") or None,
        "included": True,
        "eligibility_reason": "persisted_scanner_hit",
    }


def build_rank_snapshot_payload(
    run_payload: Mapping[str, Any],
    opportunities: Iterable[Mapping[str, Any]],
    learning_policy: Mapping[str, Any],
) -> dict[str, object]:
    """Build the canonical, minimal rank receipt for one terminal run."""

    ordered = sorted(
        opportunities,
        key=lambda row: (
            _positive_int(
                (
                    row.get("learning_evaluation")
                    if isinstance(row.get("learning_evaluation"), Mapping)
                    else {}
                ).get("applied_rank")
            )
            or 10**9,
            str(row.get("triggered_at") or ""),
            _positive_int(row.get("event_id")) or 10**9,
        ),
    )
    candidates = [
        _rank_candidate(row, display_ordinal=index)
        for index, row in enumerate(ordered, start=1)
    ]
    opportunity_versions = sorted(
        {
            str(candidate["opportunity_model_version"])
            for candidate in candidates
            if candidate["opportunity_model_version"]
        }
    )
    ranking_versions = sorted(
        {
            str(candidate["ranking_model_version"])
            for candidate in candidates
            if candidate["ranking_model_version"]
        }
    )
    source_generated_at = (
        run_payload.get("completed_at")
        or run_payload.get("updated_at")
        or datetime.utcnow().isoformat()
    )
    return {
        "schema_version": RANK_SNAPSHOT_SCHEMA_VERSION,
        "surface": RANK_SNAPSHOT_SURFACE,
        "scope_key": f"run:{int(run_payload['id'])}",
        "sweep_run_id": int(run_payload["id"]),
        "source_generated_at": source_generated_at,
        "candidate_count": len(candidates),
        "opportunity_model_versions": opportunity_versions,
        "ranking_model_versions": ranking_versions,
        "learning_policy_version": str(learning_policy.get("version") or "") or None,
        "learning_policy": dict(learning_policy),
        "candidates": candidates,
    }


def persist_rank_snapshot(
    db: Session,
    run: OptionSweepRun,
    payload: Mapping[str, Any],
) -> tuple[OptionScannerRankSnapshot, bool]:
    """Persist once per run; repeated finalization returns the original receipt."""

    existing = (
        db.query(OptionScannerRankSnapshot)
        .filter(OptionScannerRankSnapshot.sweep_run_id == int(run.id))
        .first()
    )
    if existing is not None:
        return existing, False
    if str(run.status or "").lower() not in TERMINAL_SWEEP_STATUSES:
        raise ValueError("Rank snapshots can only be persisted for terminal scanner runs.")
    if run.completed_at is None:
        raise ValueError("A terminal scanner run must have completed_at before snapshotting.")

    canonical = _canonical_json(dict(payload))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    record = OptionScannerRankSnapshot(
        snapshot_uuid=str(uuid4()),
        schema_version=RANK_SNAPSHOT_SCHEMA_VERSION,
        surface=RANK_SNAPSHOT_SURFACE,
        scope_key=f"run:{int(run.id)}",
        sweep_run_id=int(run.id),
        learning_policy_version=str(payload.get("learning_policy_version") or "") or None,
        opportunity_model_versions_json=_canonical_json(
            list(payload.get("opportunity_model_versions") or [])
        ),
        ranking_model_versions_json=_canonical_json(
            list(payload.get("ranking_model_versions") or [])
        ),
        candidate_count=int(payload.get("candidate_count") or 0),
        payload_json=canonical,
        payload_sha256=digest,
        source_generated_at=run.completed_at,
        created_at=datetime.utcnow(),
    )
    try:
        with db.begin_nested():
            db.add(record)
            db.flush()
        db.commit()
        db.refresh(record)
        return record, True
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(OptionScannerRankSnapshot)
            .filter(OptionScannerRankSnapshot.sweep_run_id == int(run.id))
            .first()
        )
        if existing is None:
            raise
        return existing, False


def snapshot_for_run(
    db: Session,
    run_id: int,
) -> Optional[OptionScannerRankSnapshot]:
    return (
        db.query(OptionScannerRankSnapshot)
        .filter(OptionScannerRankSnapshot.sweep_run_id == int(run_id))
        .first()
    )


def serialize_rank_snapshot(
    snapshot: Optional[OptionScannerRankSnapshot],
) -> Optional[dict[str, object]]:
    if snapshot is None:
        return None
    try:
        payload = json.loads(snapshot.payload_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    canonical = _canonical_json(payload)
    computed_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {
        "id": int(snapshot.id),
        "snapshot_uuid": snapshot.snapshot_uuid,
        "schema_version": snapshot.schema_version,
        "surface": snapshot.surface,
        "scope_key": snapshot.scope_key,
        "sweep_run_id": int(snapshot.sweep_run_id),
        "learning_policy_version": snapshot.learning_policy_version,
        "opportunity_model_versions": list(
            json.loads(snapshot.opportunity_model_versions_json or "[]")
        ),
        "ranking_model_versions": list(
            json.loads(snapshot.ranking_model_versions_json or "[]")
        ),
        "candidate_count": int(snapshot.candidate_count or 0),
        "payload_sha256": snapshot.payload_sha256,
        "integrity_verified": computed_hash == snapshot.payload_sha256,
        "source_generated_at": (
            snapshot.source_generated_at.isoformat()
            if snapshot.source_generated_at
            else None
        ),
        "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
        "candidates": list(payload.get("candidates") or []),
        "learning_policy": (
            payload.get("learning_policy")
            if isinstance(payload.get("learning_policy"), dict)
            else {}
        ),
    }


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _bounded_metadata(value: object) -> str:
    if value is None:
        return "{}"
    if not isinstance(value, Mapping):
        raise ValueError("Impression metadata must be a JSON object.")
    if len(value) > _MAX_METADATA_KEYS:
        raise ValueError(f"Impression metadata is limited to {_MAX_METADATA_KEYS} keys.")
    metadata: dict[str, object] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key)
        if not key or len(key) > 80:
            raise ValueError("Impression metadata keys must be 1-80 characters.")
        if raw_value is not None and not isinstance(raw_value, (str, bool, int, float)):
            raise ValueError("Impression metadata values must be JSON primitives.")
        if isinstance(raw_value, float) and not math.isfinite(raw_value):
            raise ValueError("Impression metadata numbers must be finite.")
        if isinstance(raw_value, str) and len(raw_value) > 256:
            raise ValueError("Impression metadata strings are limited to 256 characters.")
        metadata[key] = raw_value
    encoded = _canonical_json(metadata)
    if len(encoded.encode("utf-8")) > _MAX_METADATA_BYTES:
        raise ValueError(
            f"Impression metadata is limited to {_MAX_METADATA_BYTES} encoded bytes."
        )
    return encoded


def record_scanner_impressions(
    db: Session,
    *,
    snapshot_id: int,
    page_session_id: str,
    actor: str,
    request_id: str,
    exposures: Iterable[Mapping[str, Any]],
) -> dict[str, object]:
    """Validate and append a bounded, idempotent browser impression batch."""

    snapshot = (
        db.query(OptionScannerRankSnapshot)
        .filter(OptionScannerRankSnapshot.id == int(snapshot_id))
        .first()
    )
    if snapshot is None:
        raise LookupError(f"Scanner rank snapshot #{snapshot_id} was not found.")
    serialized = serialize_rank_snapshot(snapshot) or {}
    candidate_event_ids = {
        int(candidate["event_id"])
        for candidate in serialized.get("candidates", [])
        if isinstance(candidate, Mapping) and _positive_int(candidate.get("event_id"))
    }
    batch = list(exposures)
    if not batch:
        raise ValueError("At least one scanner impression is required.")
    if len(batch) > 50:
        raise ValueError("Scanner impression batches are limited to 50 entries.")
    session = str(page_session_id or "").strip()
    if len(session) < 16 or len(session) > 128:
        raise ValueError("page_session_id must contain 16-128 characters.")
    page_session_hash = hashlib.sha256(
        f"scanner-impression:v1:{session}".encode("utf-8")
    ).hexdigest()

    client_ids = [str(row.get("client_impression_id") or "") for row in batch]
    if len(set(client_ids)) != len(client_ids):
        raise ValueError("client_impression_id values must be unique within a batch.")
    existing_by_id = {
        str(row.client_impression_id): row
        for row in (
            db.query(OptionScannerImpression)
            .filter(OptionScannerImpression.client_impression_id.in_(client_ids))
            .all()
        )
    }
    now = datetime.utcnow()
    earliest = (
        snapshot.source_generated_at
        or snapshot.created_at
        or now
    ) - timedelta(minutes=5)
    inserted = 0
    skipped = 0
    for exposure in batch:
        client_id = str(exposure.get("client_impression_id") or "").strip()
        if not _CLIENT_IMPRESSION_ID.fullmatch(client_id):
            raise ValueError(
                "client_impression_id must be 16-128 safe identifier characters."
            )
        exposure_type = str(exposure.get("exposure_type") or "").strip()
        if exposure_type not in ALLOWED_IMPRESSION_TYPES:
            raise ValueError(f"Unsupported scanner impression type '{exposure_type}'.")
        event_id = _positive_int(exposure.get("event_id"))
        if exposure_type in EVENT_REQUIRED_IMPRESSION_TYPES and event_id is None:
            raise ValueError(f"{exposure_type} requires an event_id.")
        if event_id is not None and event_id not in candidate_event_ids:
            raise ValueError(
                f"Event #{event_id} does not belong to scanner rank snapshot #{snapshot_id}."
            )
        visibility_ratio = _finite_number(exposure.get("visibility_ratio"), digits=4)
        if visibility_ratio is not None and not 0.0 <= visibility_ratio <= 1.0:
            raise ValueError("visibility_ratio must be between 0 and 1.")
        visible_ms = exposure.get("visible_ms")
        if visible_ms is not None:
            try:
                visible_ms = int(visible_ms)
            except (TypeError, ValueError) as exc:
                raise ValueError("visible_ms must be an integer.") from exc
            if visible_ms < 0 or visible_ms > 3_600_000:
                raise ValueError("visible_ms must be between 0 and 3600000.")
        occurred = _naive_utc(exposure.get("client_occurred_at"))
        if occurred is not None:
            if occurred > now + timedelta(minutes=5):
                raise ValueError(
                    "client_occurred_at cannot be more than five minutes in the future."
                )
            occurred = max(occurred, earliest)
        metadata_json = _bounded_metadata(exposure.get("metadata"))
        client_payload = {
            "snapshot_id": int(snapshot.id),
            "page_session_hash": page_session_hash,
            "event_id": event_id,
            "exposure_type": exposure_type,
            "client_occurred_at": occurred.isoformat() if occurred else None,
            "visibility_ratio": visibility_ratio,
            "visible_ms": visible_ms,
            "metadata": json.loads(metadata_json),
        }
        client_payload_sha256 = hashlib.sha256(
            _canonical_json(client_payload).encode("utf-8")
        ).hexdigest()
        existing = existing_by_id.get(client_id)
        if existing is not None:
            if existing.client_payload_sha256 != client_payload_sha256:
                raise ScannerImpressionReplayConflict(
                    f"client_impression_id '{client_id}' was already used with a different payload."
                )
            skipped += 1
            continue
        record = OptionScannerImpression(
            client_impression_id=client_id,
            client_payload_sha256=client_payload_sha256,
            snapshot_id=int(snapshot.id),
            event_id=event_id,
            exposure_type=exposure_type,
            surface=snapshot.surface,
            actor=str(actor or "anonymous")[:80],
            request_id=str(request_id or "")[:128],
            page_session_hash=page_session_hash,
            client_occurred_at=occurred,
            visibility_ratio=visibility_ratio,
            visible_ms=visible_ms,
            metadata_json=metadata_json,
            received_at=now,
        )
        try:
            with db.begin_nested():
                db.add(record)
                db.flush()
            inserted += 1
            existing_by_id[client_id] = record
        except IntegrityError:
            existing = (
                db.query(OptionScannerImpression)
                .filter(OptionScannerImpression.client_impression_id == client_id)
                .first()
            )
            if existing is None:
                raise
            if existing.client_payload_sha256 != client_payload_sha256:
                raise ScannerImpressionReplayConflict(
                    f"client_impression_id '{client_id}' was already used with a different payload."
                )
            skipped += 1
            existing_by_id[client_id] = existing
    db.commit()
    return {
        "snapshot_id": int(snapshot.id),
        "inserted": inserted,
        "skipped_duplicates": skipped,
        "received": len(batch),
    }
