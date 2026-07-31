from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from threading import Event, Thread
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.services import endpoint_response_cache as cache


def _configure_test_database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)

    @contextmanager
    def test_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(cache, "get_db_session", test_session)


def test_response_snapshot_round_trip_is_shared_and_age_aware(monkeypatch) -> None:
    _configure_test_database(monkeypatch)
    cached_at = datetime.utcnow() - timedelta(seconds=30)
    payload = {"as_of": "2026-07-29T15:00:00Z", "values": [1, 2, 3]}

    cache.store_response_snapshot("example:90", payload, cached_at=cached_at)
    snapshot = cache.load_response_snapshot("example:90")

    assert snapshot is not None
    assert snapshot.payload == payload
    assert snapshot.age_seconds >= 29
    assert snapshot.is_fresh(60)
    assert not snapshot.is_fresh(10)


def test_response_snapshot_upsert_replaces_payload(monkeypatch) -> None:
    _configure_test_database(monkeypatch)

    cache.store_response_snapshot("example:365", {"value": 1})
    cache.store_response_snapshot("example:365", {"value": 2})

    snapshot = cache.load_response_snapshot("example:365")
    assert snapshot is not None
    assert snapshot.payload == {"value": 2}


def test_mark_stale_snapshot_preserves_dict_contract_and_quality(monkeypatch) -> None:
    _configure_test_database(monkeypatch)
    cache.store_response_snapshot(
        "example:stale",
        {"warnings": [], "value": 42},
        cached_at=datetime.utcnow() - timedelta(hours=2),
    )
    snapshot = cache.load_response_snapshot("example:stale")
    assert snapshot is not None

    marked = cache.mark_stale_snapshot(
        snapshot.payload,
        snapshot,
        reason="upstream_refresh_failed",
    )

    assert marked["value"] == 42
    assert marked["data_quality"]["status"] == "stale"
    assert marked["data_quality"]["snapshot_age_seconds"] >= 7199
    assert marked["warnings"] == [
        "Live refresh failed; showing the last-known-good snapshot."
    ]


def test_mark_stale_snapshot_preserves_list_contract(monkeypatch) -> None:
    _configure_test_database(monkeypatch)
    cache.store_response_snapshot(
        "example:list",
        [{"date": "2026-07-28", "value": 10}],
        cached_at=datetime.utcnow() - timedelta(hours=1),
    )
    snapshot = cache.load_response_snapshot("example:list")
    assert snapshot is not None

    marked = cache.mark_stale_snapshot(
        snapshot.payload,
        snapshot,
        reason="provider_rate_limited",
    )

    assert isinstance(marked, list)
    assert marked[0]["value"] == 10
    assert marked[0]["data_quality"]["stale"] is True
    assert marked[0]["data_quality"]["reason"] == "provider_rate_limited"


def test_cache_database_absence_is_fail_open(monkeypatch) -> None:
    @contextmanager
    def unavailable_session():
        raise RuntimeError("database unavailable")
        yield

    monkeypatch.setattr(cache, "get_db_session", unavailable_session)

    assert cache.load_response_snapshot("missing") is None
    assert cache.store_response_snapshot("missing", {"still": "usable"}) is None


def test_oversized_snapshot_is_not_written(monkeypatch) -> None:
    _configure_test_database(monkeypatch)
    monkeypatch.setattr(cache, "MAX_SNAPSHOT_BYTES", 20)

    cache.store_response_snapshot("too-large", {"payload": "x" * 50})

    assert cache.load_response_snapshot("too-large") is None


@pytest.mark.parametrize(
    "payload",
    [
        {"when": datetime.utcnow()},
        {"value": Decimal("1.25")},
    ],
)
def test_non_json_snapshot_values_are_fail_open(monkeypatch, payload) -> None:
    _configure_test_database(monkeypatch)

    cache.store_response_snapshot("not-json", payload)

    assert cache.load_response_snapshot("not-json") is None


def test_snapshot_namespace_prunes_old_parameter_variants(monkeypatch) -> None:
    _configure_test_database(monkeypatch)
    monkeypatch.setattr(cache, "MAX_ENTRIES_PER_NAMESPACE", 2)
    base = datetime.utcnow()

    cache.store_response_snapshot(
        "bounded-family:90",
        {"days": 90},
        cached_at=base,
    )
    cache.store_response_snapshot(
        "bounded-family:180",
        {"days": 180},
        cached_at=base + timedelta(seconds=1),
    )
    cache.store_response_snapshot(
        "bounded-family:365",
        {"days": 365},
        cached_at=base + timedelta(seconds=2),
    )

    assert cache.load_response_snapshot("bounded-family:90") is None
    assert cache.load_response_snapshot("bounded-family:180") is not None
    assert cache.load_response_snapshot("bounded-family:365") is not None


def test_response_refresh_lock_serializes_same_key(monkeypatch) -> None:
    @contextmanager
    def unavailable_session():
        raise RuntimeError("database unavailable")
        yield

    monkeypatch.setattr(cache, "get_db_session", unavailable_session)
    active = 0
    max_active = 0

    def worker():
        nonlocal active, max_active
        with cache.response_refresh_lock("shared-key"):
            active += 1
            max_active = max(max_active, active)
            time.sleep(0.02)
            active -= 1

    threads = [Thread(target=worker), Thread(target=worker)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert max_active == 1


def test_response_refresh_lock_has_bounded_local_contention(monkeypatch) -> None:
    @contextmanager
    def unavailable_session():
        raise RuntimeError("database unavailable")
        yield

    monkeypatch.setattr(cache, "get_db_session", unavailable_session)
    owner_ready = Event()
    release_owner = Event()

    def owner() -> None:
        with cache.response_refresh_lock("bounded-key") as acquired:
            assert acquired is True
            owner_ready.set()
            assert release_owner.wait(timeout=1)

    owner_thread = Thread(target=owner)
    owner_thread.start()
    assert owner_ready.wait(timeout=1)

    started_at = time.monotonic()
    with cache.response_refresh_lock(
        "bounded-key",
        wait_timeout_seconds=0.01,
    ) as acquired:
        elapsed = time.monotonic() - started_at
        assert acquired is False

    release_owner.set()
    owner_thread.join(timeout=1)
    assert not owner_thread.is_alive()
    assert elapsed < 0.2


def test_postgres_refresh_lock_uses_try_lock_and_same_session_unlock(
    monkeypatch,
) -> None:
    statements: list[str] = []

    class Result:
        def scalar(self):
            return True

    class Dialect:
        name = "postgresql"

    class Bind:
        dialect = Dialect()

    class FakeSession:
        bind = Bind()

        def execute(self, statement, _params):
            statements.append(str(statement))
            return Result()

        def commit(self):
            raise AssertionError(
                "committing would detach the session-level advisory lock "
                "from the Session's physical connection"
            )

        def rollback(self):
            raise AssertionError("an acquired advisory lock must not roll back")

    @contextmanager
    def fake_session():
        yield FakeSession()

    monkeypatch.setattr(cache, "get_db_session", fake_session)

    with cache.response_refresh_lock(
        "postgres-key",
        wait_timeout_seconds=0.25,
    ) as acquired:
        assert acquired is True

    assert any("pg_try_advisory_lock" in statement for statement in statements)
    assert any("pg_advisory_unlock" in statement for statement in statements)


def test_postgres_refresh_lock_reports_shared_contention(monkeypatch) -> None:
    statements: list[str] = []
    rollbacks = 0

    class Result:
        def scalar(self):
            return False

    class Dialect:
        name = "postgresql"

    class Bind:
        dialect = Dialect()

    class FakeSession:
        bind = Bind()

        def execute(self, statement, _params):
            statements.append(str(statement))
            return Result()

        def commit(self):
            raise AssertionError("a contended try-lock must not commit")

        def rollback(self):
            nonlocal rollbacks
            rollbacks += 1

    @contextmanager
    def fake_session():
        yield FakeSession()

    monkeypatch.setattr(cache, "get_db_session", fake_session)

    with cache.response_refresh_lock(
        "postgres-contended-key",
        wait_timeout_seconds=0.25,
    ) as acquired:
        assert acquired is False

    assert rollbacks == 1
    assert any("pg_try_advisory_lock" in statement for statement in statements)
    assert not any("pg_advisory_unlock" in statement for statement in statements)


def test_async_response_refresh_lock_is_nonblocking_and_serializes(
    monkeypatch,
) -> None:
    shared_lock_acquired = False

    @contextmanager
    def slow_shared_lock(_cache_key: str):
        nonlocal shared_lock_acquired
        time.sleep(0.03)
        shared_lock_acquired = True
        yield

    monkeypatch.setattr(cache, "response_refresh_lock", slow_shared_lock)
    active = 0
    max_active = 0
    heartbeat_ran_before_acquire = False

    async def scenario() -> None:
        async def heartbeat() -> None:
            nonlocal heartbeat_ran_before_acquire
            await asyncio.sleep(0.005)
            heartbeat_ran_before_acquire = not shared_lock_acquired

        async def worker() -> None:
            nonlocal active, max_active
            async with cache.async_response_refresh_lock("async-shared-key"):
                active += 1
                max_active = max(max_active, active)
                await asyncio.sleep(0.01)
                active -= 1

        await asyncio.gather(heartbeat(), worker(), worker())

    asyncio.run(scenario())

    assert heartbeat_ran_before_acquire is True
    assert max_active == 1
