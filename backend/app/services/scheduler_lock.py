from __future__ import annotations

import hashlib
import logging
import threading
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine

logger = logging.getLogger(__name__)

_SQLITE_LOCKS: dict[str, threading.Lock] = {}
_SQLITE_LOCKS_GUARD = threading.Lock()


def _job_lock_key(job_name: str) -> int:
    digest = hashlib.sha256(job_name.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False) & 0x7FFFFFFF


@contextmanager
def scheduler_job_lock(job_name: str) -> Generator[bool, None, None]:
    if "postgresql" in settings.DATABASE_URL:
        lock_key = _job_lock_key(job_name)
        acquired = False
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            try:
                acquired = bool(
                    connection.execute(
                        text("SELECT pg_try_advisory_lock(:lock_key)"),
                        {"lock_key": lock_key},
                    ).scalar()
                )
                if not acquired:
                    logger.info("Skipping %s because another scheduler instance holds the lock.", job_name)
                yield acquired
            finally:
                if acquired:
                    unlocked = bool(
                        connection.execute(
                            text("SELECT pg_advisory_unlock(:lock_key)"),
                            {"lock_key": lock_key},
                        ).scalar()
                    )
                    if not unlocked:
                        logger.error("Failed to release the advisory lock for %s.", job_name)
    else:
        with _SQLITE_LOCKS_GUARD:
            lock = _SQLITE_LOCKS.setdefault(job_name, threading.Lock())
        acquired = lock.acquire(blocking=False)
        try:
            if not acquired:
                logger.info("Skipping %s because another local scheduler instance holds the lock.", job_name)
            yield acquired
        finally:
            if acquired:
                lock.release()
