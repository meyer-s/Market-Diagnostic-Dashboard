from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.main import app
from app.services.scheduler_lock import scheduler_job_lock
from app.services import scheduler as scheduler_module
from app.services import scheduler_worker


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


def test_scheduler_worker_registers_jobs_before_startup_etl(monkeypatch: pytest.MonkeyPatch) -> None:
    order: list[str] = []

    class StartupProbeComplete(RuntimeError):
        pass

    async def _probe_initial_etl() -> None:
        order.append("initial_etl")
        raise StartupProbeComplete

    monkeypatch.setattr(scheduler_worker, "start_scheduler", lambda: order.append("start_scheduler"))
    monkeypatch.setattr(scheduler_worker, "run_initial_etl", _probe_initial_etl)
    monkeypatch.setattr(scheduler_worker, "stop_scheduler", lambda: order.append("stop_scheduler"))

    with pytest.raises(StartupProbeComplete):
        asyncio.run(scheduler_worker.run_scheduler_worker())

    assert order == ["start_scheduler", "initial_etl", "stop_scheduler"]


def test_scheduled_sp500_scanner_uses_persisted_dashboard_sweep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, float, str]] = []

    monkeypatch.setenv("SCHEDULED_SP500_SCANNER_THRESHOLD", "30")
    monkeypatch.setattr(
        scheduler_module,
        "start_dashboard_sweep",
        lambda universe, threshold, *, trigger_source: (
            calls.append((universe, threshold, trigger_source)) or {"id": 42}
        ),
    )

    scheduler_module.scheduled_sp500_option_scanner_job()

    assert calls == [("SP500", 30.0, "scheduled")]


def test_scheduler_registers_three_weekday_sp500_scans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SchedulerProbe:
        running = True

        def __init__(self) -> None:
            self.jobs: dict[str, object] = {}

        def get_job(self, _job_id: str):
            return None

        def add_job(self, _func, trigger, *, id: str, **_kwargs) -> None:
            self.jobs[id] = trigger

    probe = SchedulerProbe()
    monkeypatch.setattr(scheduler_module, "scheduler", probe)
    monkeypatch.delenv("OPTIONS_ALERTS_ENABLED", raising=False)

    scheduler_module.start_scheduler()

    trigger = probe.jobs["sp500_options_scanner"]
    assert "day_of_week='mon-fri'" in str(trigger)
    assert "hour='10,12,14'" in str(trigger)
    assert "minute='0'" in str(trigger)
    assert str(trigger.timezone) == "America/New_York"


def test_scheduler_registers_two_weekday_bls_refreshes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SchedulerProbe:
        running = True

        def __init__(self) -> None:
            self.jobs: dict[str, object] = {}

        def get_job(self, _job_id: str):
            return None

        def add_job(self, _func, trigger, *, id: str, **_kwargs) -> None:
            self.jobs[id] = trigger

    probe = SchedulerProbe()
    monkeypatch.setattr(scheduler_module, "scheduler", probe)

    scheduler_module.start_scheduler()

    trigger = probe.jobs["bls_lens_refresh"]
    assert "day_of_week='mon-fri'" in str(trigger)
    assert "hour='8,10'" in str(trigger)
    assert "minute='45'" in str(trigger)
    assert str(trigger.timezone) == "America/New_York"
