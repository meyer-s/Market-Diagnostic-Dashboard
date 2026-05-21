from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.main import app
from app.services.scheduler_lock import scheduler_job_lock


def test_scheduler_lock_only_allows_single_holder() -> None:
    with scheduler_job_lock("test-job") as acquired_first:
        with scheduler_job_lock("test-job") as acquired_second:
            assert acquired_first is True
            assert acquired_second is False


def test_web_lifespan_skips_scheduler_when_flag_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"start": 0, "stop": 0}

    monkeypatch.setattr(settings, "RUN_SCHEDULER", False)
    monkeypatch.setattr("app.services.scheduler.start_scheduler", lambda: calls.__setitem__("start", calls["start"] + 1))
    monkeypatch.setattr("app.services.scheduler.stop_scheduler", lambda: calls.__setitem__("stop", calls["stop"] + 1))

    with TestClient(app):
        pass

    assert calls["start"] == 0
    assert calls["stop"] == 0


def test_web_lifespan_starts_scheduler_when_flag_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"start": 0, "stop": 0}

    monkeypatch.setattr(settings, "RUN_SCHEDULER", True)
    monkeypatch.setattr("app.services.scheduler.start_scheduler", lambda: calls.__setitem__("start", calls["start"] + 1))
    monkeypatch.setattr("app.services.scheduler.stop_scheduler", lambda: calls.__setitem__("stop", calls["stop"] + 1))

    async def _noop() -> None:
        return None

    monkeypatch.setattr("app.services.scheduler.run_initial_etl", _noop)

    with TestClient(app):
        pass

    assert calls["start"] == 1
    assert calls["stop"] == 1
