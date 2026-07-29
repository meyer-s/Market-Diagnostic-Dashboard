from __future__ import annotations

import asyncio
from copy import deepcopy
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
import logging
from threading import Event, Lock
from typing import Any, Optional
from weakref import WeakKeyDictionary, WeakValueDictionary

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models.endpoint_response_snapshot import EndpointResponseSnapshot
from app.utils.db_helpers import get_db_session


logger = logging.getLogger(__name__)
# Six recent parameter variants per endpoint family at 2 MiB each bounds the
# current six cached families to 72 MiB in the theoretical all-max-payload case.
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
MAX_ENTRIES_PER_NAMESPACE = 6
MAX_SNAPSHOT_RETENTION_SECONDS = 7 * 24 * 60 * 60
_LOCAL_REFRESH_LOCKS: WeakValueDictionary[str, Lock] = WeakValueDictionary()
_LOCAL_REFRESH_LOCKS_GUARD = Lock()
_ASYNC_REFRESH_LOCKS: WeakKeyDictionary[
    asyncio.AbstractEventLoop,
    WeakValueDictionary[str, asyncio.Lock],
] = WeakKeyDictionary()
_ASYNC_REFRESH_LOCKS_GUARD = Lock()


@dataclass(frozen=True)
class ResponseSnapshot:
    cache_key: str
    payload: Any
    cached_at: datetime
    age_seconds: float

    def is_fresh(self, ttl_seconds: float) -> bool:
        return self.age_seconds <= max(float(ttl_seconds), 0.0)

    def is_within_stale_limit(self, max_stale_age_seconds: float) -> bool:
        return self.age_seconds <= max(float(max_stale_age_seconds), 0.0)


def _advisory_lock_id(cache_key: str) -> int:
    digest = hashlib.sha256(cache_key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


@contextmanager
def response_refresh_lock(cache_key: str):
    """Serialize expensive sync refreshes locally and across Postgres workers."""

    with _LOCAL_REFRESH_LOCKS_GUARD:
        local_lock = _LOCAL_REFRESH_LOCKS.get(cache_key)
        if local_lock is None:
            local_lock = Lock()
            _LOCAL_REFRESH_LOCKS[cache_key] = local_lock

    local_lock.acquire()
    session_manager = None
    db = None
    advisory_acquired = False
    advisory_id = _advisory_lock_id(cache_key)
    try:
        try:
            session_manager = get_db_session()
            db = session_manager.__enter__()
            dialect_name = getattr(getattr(db, "bind", None), "dialect", None)
            if getattr(dialect_name, "name", "") == "postgresql":
                db.execute(
                    text("SELECT pg_advisory_lock(:lock_id)"),
                    {"lock_id": advisory_id},
                )
                advisory_acquired = True
        except Exception as exc:
            logger.warning(
                "Unable to acquire shared refresh lock %s; using local lock: %s",
                cache_key,
                exc,
            )
            if session_manager is not None:
                try:
                    session_manager.__exit__(None, None, None)
                except Exception:
                    pass
            session_manager = None
            db = None

        yield
    finally:
        if advisory_acquired and db is not None:
            try:
                db.execute(
                    text("SELECT pg_advisory_unlock(:lock_id)"),
                    {"lock_id": advisory_id},
                )
            except Exception as exc:
                logger.warning(
                    "Unable to release shared refresh lock %s: %s",
                    cache_key,
                    exc,
                )
        if session_manager is not None:
            try:
                session_manager.__exit__(None, None, None)
            except Exception:
                pass
        local_lock.release()


def _get_async_refresh_lock(cache_key: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    with _ASYNC_REFRESH_LOCKS_GUARD:
        locks_for_loop = _ASYNC_REFRESH_LOCKS.get(loop)
        if locks_for_loop is None:
            locks_for_loop = WeakValueDictionary()
            _ASYNC_REFRESH_LOCKS[loop] = locks_for_loop
        lock = locks_for_loop.get(cache_key)
        if lock is None:
            lock = asyncio.Lock()
            locks_for_loop[cache_key] = lock
        return lock


@asynccontextmanager
async def async_response_refresh_lock(cache_key: str):
    """Serialize async refreshes without blocking the serving event loop.

    A per-event-loop asyncio lock coalesces same-process callers. The existing
    synchronous PostgreSQL advisory lock is then held by one worker-pool thread
    for the duration of the async refresh, keeping all database operations on
    that same thread. Database or advisory-lock failures remain fail-open via
    ``response_refresh_lock`` while the local async lock still provides
    in-process single-flight behavior.
    """

    local_lock = _get_async_refresh_lock(cache_key)
    async with local_lock:
        loop = asyncio.get_running_loop()
        acquired = loop.create_future()
        release = Event()

        def signal_acquired(lock_active: bool) -> None:
            if not acquired.done():
                acquired.set_result(lock_active)

        def hold_shared_lock() -> None:
            try:
                with response_refresh_lock(cache_key):
                    loop.call_soon_threadsafe(signal_acquired, True)
                    release.wait()
            except Exception as exc:
                logger.warning(
                    "Unable to hold async shared refresh lock %s; "
                    "using local async lock: %s",
                    cache_key,
                    exc,
                )
                loop.call_soon_threadsafe(signal_acquired, False)

        holder = asyncio.create_task(asyncio.to_thread(hold_shared_lock))
        try:
            await acquired
            yield
        finally:
            release.set()
            try:
                await asyncio.shield(holder)
            except asyncio.CancelledError:
                # The worker thread observes ``release`` and exits even when
                # the request task itself has been cancelled.
                pass


def load_response_snapshot(cache_key: str) -> Optional[ResponseSnapshot]:
    """Load a cross-process response snapshot.

    Cache storage is deliberately best-effort: an unavailable database must
    never turn an otherwise usable upstream response into an API failure.
    """

    try:
        with get_db_session() as db:
            row = db.get(EndpointResponseSnapshot, cache_key)
            if row is None or not isinstance(row.cached_at, datetime):
                return None
            now = datetime.utcnow()
            age_seconds = max((now - row.cached_at).total_seconds(), 0.0)
            return ResponseSnapshot(
                cache_key=cache_key,
                payload=deepcopy(row.payload),
                cached_at=row.cached_at,
                age_seconds=age_seconds,
            )
    except Exception as exc:
        logger.warning("Unable to read response snapshot %s: %s", cache_key, exc)
        return None


def store_response_snapshot(
    cache_key: str,
    payload: Any,
    *,
    cached_at: Optional[datetime] = None,
) -> None:
    """Upsert a JSON response snapshot for reuse by every API worker."""

    snapshot_time = cached_at or datetime.utcnow()
    serializable_payload = deepcopy(payload)
    try:
        serialized_size = len(
            json.dumps(
                serializable_payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
    except (TypeError, ValueError) as exc:
        logger.warning("Response snapshot %s is not JSON serializable: %s", cache_key, exc)
        return
    if serialized_size > MAX_SNAPSHOT_BYTES:
        logger.warning(
            "Response snapshot %s exceeds the %d-byte storage limit (%d bytes)",
            cache_key,
            MAX_SNAPSHOT_BYTES,
            serialized_size,
        )
        return

    try:
        with get_db_session() as db:
            row = db.get(EndpointResponseSnapshot, cache_key)
            if row is None:
                row = EndpointResponseSnapshot(
                    cache_key=cache_key,
                    payload=serializable_payload,
                    cached_at=snapshot_time,
                )
                db.add(row)
            else:
                row.payload = serializable_payload
                row.cached_at = snapshot_time
            try:
                db.flush()
            except IntegrityError:
                # A second worker can win the first insert. Retry as an update
                # so either worker's complete payload becomes immediately
                # available to both processes.
                db.rollback()
                row = db.get(EndpointResponseSnapshot, cache_key)
                if row is None:
                    raise
                row.payload = serializable_payload
                row.cached_at = snapshot_time
                db.flush()

            namespace = cache_key.rsplit(":", 1)[0]
            retention_cutoff = snapshot_time - timedelta(
                seconds=MAX_SNAPSHOT_RETENTION_SECONDS
            )
            (
                db.query(EndpointResponseSnapshot)
                .filter(
                    EndpointResponseSnapshot.cache_key.like(f"{namespace}:%"),
                    EndpointResponseSnapshot.cached_at < retention_cutoff,
                )
                .delete(synchronize_session=False)
            )
            overflow = (
                db.query(EndpointResponseSnapshot)
                .filter(EndpointResponseSnapshot.cache_key.like(f"{namespace}:%"))
                .order_by(EndpointResponseSnapshot.cached_at.desc())
                .offset(MAX_ENTRIES_PER_NAMESPACE)
                .all()
            )
            for stale_row in overflow:
                db.delete(stale_row)
            db.commit()
    except Exception as exc:
        logger.warning("Unable to store response snapshot %s: %s", cache_key, exc)


def mark_stale_snapshot(
    payload: Any,
    snapshot: ResponseSnapshot,
    *,
    reason: str,
    ttl_seconds: Optional[float] = None,
    max_stale_age_seconds: Optional[float] = None,
) -> Any:
    """Mark reused evidence as stale without changing an endpoint's shape."""

    marked = deepcopy(payload)
    metadata = {
        "status": "stale",
        "stale": True,
        "reason": reason,
        "snapshot_cached_at": snapshot.cached_at.isoformat() + "Z",
        "snapshot_age_seconds": round(snapshot.age_seconds, 1),
    }
    if ttl_seconds is not None:
        metadata["snapshot_ttl_seconds"] = round(max(float(ttl_seconds), 0.0), 1)
    if max_stale_age_seconds is not None:
        metadata["snapshot_max_stale_age_seconds"] = round(
            max(float(max_stale_age_seconds), 0.0),
            1,
        )

    if isinstance(marked, dict):
        existing = marked.get("data_quality")
        marked["data_quality"] = {
            **(existing if isinstance(existing, dict) else {}),
            **metadata,
        }
        warnings = marked.get("warnings")
        warning = "Live refresh failed; showing the last-known-good snapshot."
        if isinstance(warnings, list) and warning not in warnings:
            warnings.append(warning)
        return marked

    if isinstance(marked, list):
        # Component endpoints have an established list contract. Put the
        # provenance on every observation rather than wrapping the response.
        for row in marked:
            if isinstance(row, dict):
                existing = row.get("data_quality")
                row["data_quality"] = {
                    **(existing if isinstance(existing, dict) else {}),
                    **metadata,
                }
        return marked

    return marked
