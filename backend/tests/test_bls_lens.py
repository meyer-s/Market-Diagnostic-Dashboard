from __future__ import annotations

import asyncio
from copy import deepcopy
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.bls_observation_vintage import BlsObservationVintage
from app.services import bls_lens
from app.services.endpoint_response_cache import ResponseSnapshot


def _bls_row(period: date, value: float | str, *, preliminary: bool = False):
    return {
        "year": str(period.year),
        "period": f"M{period.month:02d}",
        "periodName": period.strftime("%B"),
        "value": str(value),
        "footnotes": (
            [{"code": "P", "text": "preliminary"}] if preliminary else [{}]
        ),
    }


def _monthly_rows(start: date, count: int, *, base: float = 100.0, step: float = 1.0):
    rows = []
    period = start
    for index in range(count):
        rows.append(_bls_row(period, base + step * index))
        period = bls_lens._month_shift(period, 1)
    return rows


def _configure_vintage_database(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    BlsObservationVintage.__table__.create(bind=engine)
    session_factory = sessionmaker(bind=engine)

    @contextmanager
    def test_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(bls_lens, "get_db_session", test_session)
    return session_factory


def _fake_tracking_result(series_data):
    metadata = {}
    for series_id, rows in series_data.items():
        for row in rows:
            raw_value = row.get("raw_value")
            if raw_value is None:
                continue
            metadata[(series_id, row["observation_date"])] = {
                "first_seen_value": raw_value,
                "current_value": raw_value,
                "revision_delta": 0.0,
                "revision_count": 0,
                "first_seen_at": "2026-09-01T12:00:00Z",
                "last_seen_at": "2026-09-01T12:00:00Z",
                "revision_tracking_status": "tracked",
            }
    return metadata, {
        "observations_seen": len(metadata),
        "tracked_observations": len(metadata),
        "states_inserted": 0,
        "states_reused": len(metadata),
    }


def _quality_payload() -> dict:
    series = []
    observation_count = 0
    for config in bls_lens.SERIES_CONFIGS:
        observations = []
        period = date(2024, 1, 1)
        for index in range(30):
            observations.append(
                {
                    "period": period.isoformat(),
                    "raw_value": 100 + index,
                    "primary_value": 1 + index,
                    "relative_percentile": 50.0,
                    "change_1m": 1.0,
                    "change_12m_pct": 5.0,
                    "preliminary": False,
                    "footnotes": [],
                    "available": True,
                    "unavailable_reason": None,
                    "first_seen_value": 100 + index,
                    "current_value": 100 + index,
                    "revision_delta": 0.0,
                    "revision_count": 0,
                    "revision_tracking_status": "tracked",
                }
            )
            period = bls_lens._month_shift(period, 1)
        observation_count += len(observations)
        series.append(
            {
                **deepcopy(config),
                "coverage_start": observations[0]["period"],
                "coverage_end": observations[-1]["period"],
                "coverage": {
                    "start": observations[0]["period"],
                    "end": observations[-1]["period"],
                    "observation_count": len(observations),
                    "valid_primary_count": len(observations),
                },
                "latest": deepcopy(observations[-1]),
                "observations": observations,
            }
        )
    calendar = []
    for index, report in enumerate(bls_lens.REPORTS, start=1):
        scheduled_at = datetime(2026, 9, index, 8, 30, tzinfo=timezone.utc)
        calendar.append(
            {
                "report_id": report["report_id"],
                "report": report["report"],
                "scheduled_at": scheduled_at.isoformat(),
                "status": "scheduled",
                "provenance": {"uid": f"{report['report_id']}-old"},
            }
        )
    return {
        "as_of": "2026-09-01T12:00:00Z",
        "requested_years": 10,
        "data_quality": {
            "status": "complete",
            "stale": False,
            "payroll_revision_history_available": True,
            "release_calendar_available": True,
            "revision_tracking": {
                "status": "available",
                "observations_seen": observation_count,
                "tracked_observations": observation_count,
            },
        },
        "reports": deepcopy(list(bls_lens.REPORTS)),
        "series": series,
        "payroll_revisions": [
            {
                "period": "2024-01-01",
                "revision_stage": "third_estimate",
            },
            {
                "period": "2024-02-01",
                "revision_stage": "second_estimate",
            },
            {
                "period": "2024-03-01",
                "revision_stage": "first_estimate",
            },
        ],
        "release_calendar": calendar,
        "warnings": [],
    }


def test_bls_client_splits_unregistered_history_and_combines_ascending(monkeypatch) -> None:
    requests: list[dict[str, object]] = []

    class FakeResponse:
        def __init__(self, request_json):
            self.request_json = request_json

        def raise_for_status(self):
            return None

        def json(self):
            year = self.request_json["endyear"]
            return {
                "status": "REQUEST_SUCCEEDED",
                "message": [],
                "Results": {
                    "series": [
                        {
                            "seriesID": "CUUR0000SA0",
                            "data": [_bls_row(date(int(year), 1, 1), float(year))],
                        }
                    ]
                },
            }

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, *, json):
            requests.append(json)
            return FakeResponse(json)

    monkeypatch.setattr(bls_lens.httpx, "AsyncClient", FakeAsyncClient)
    client = bls_lens.BlsClient(api_key=None)

    result = asyncio.run(
        client.fetch_series(["CUUR0000SA0"], start_year=2011, end_year=2026)
    )

    assert [(request["startyear"], request["endyear"]) for request in requests] == [
        ("2011", "2020"),
        ("2021", "2026"),
    ]
    assert all("registrationkey" not in request for request in requests)
    assert [row["year"] for row in result["CUUR0000SA0"]] == ["2020", "2026"]


def test_bls_client_uses_key_and_rejects_unsuccessful_payload(monkeypatch) -> None:
    requests = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "status": "REQUEST_NOT_PROCESSED",
                "message": ["bad registration key"],
                "Results": {},
            }

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, *, json):
            requests.append(json)
            return FakeResponse()

    monkeypatch.setattr(bls_lens.httpx, "AsyncClient", FakeAsyncClient)
    client = bls_lens.BlsClient(api_key="registered-key")

    with pytest.raises(bls_lens.BlsUpstreamError, match="bad registration key"):
        asyncio.run(
            client.fetch_series(["CUUR0000SA0"], start_year=2011, end_year=2026)
        )

    assert len(requests) == 1
    assert requests[0]["registrationkey"] == "registered-key"


def test_series_configuration_uses_official_adjustment_and_change_units() -> None:
    expected = {
        "CUUR0000SA0": ("not seasonally adjusted", "index points"),
        "CUUR0000SA0L1E": ("not seasonally adjusted", "index points"),
        "WPUFD4": ("not seasonally adjusted", "index points"),
        "CES0000000001": ("seasonally adjusted", "thousands of jobs"),
        "CES0500000003": (
            "seasonally adjusted",
            "U.S. dollars per hour",
        ),
        "LNS14000000": ("seasonally adjusted", "percentage points"),
        "JTS000000000000000JOR": (
            "seasonally adjusted",
            "percentage points",
        ),
        "JTS000000000000000JOL": (
            "seasonally adjusted",
            "thousands of openings",
        ),
        "JTS000000000000000QUR": (
            "seasonally adjusted",
            "percentage points",
        ),
    }

    actual = {
        config["series_id"]: (
            config["seasonal_adjustment"],
            config["change_1m_unit"],
        )
        for config in bls_lens.SERIES_CONFIGS
    }

    assert actual == expected
    assert {"CUSR0000SA0", "CUSR0000SA0L1E", "WPSFD4"}.isdisjoint(actual)
    assert next(report for report in bls_lens.REPORTS if report["report_id"] == "cpi")[
        "series_ids"
    ] == ["CUUR0000SA0", "CUUR0000SA0L1E"]
    assert next(report for report in bls_lens.REPORTS if report["report_id"] == "ppi")[
        "series_ids"
    ] == ["WPUFD4"]


def test_transforms_are_causal_and_percentiles_need_24_points() -> None:
    rows = _monthly_rows(date(2020, 1, 1), 72, base=100, step=1)
    config = next(
        item for item in bls_lens.SERIES_CONFIGS if item["series_id"] == "CUUR0000SA0"
    )

    observations = bls_lens.transform_bls_series("CUUR0000SA0", rows, config)

    assert [row["period"] for row in observations] == sorted(
        row["period"] for row in observations
    )
    assert observations[11]["primary_value"] is None
    assert observations[12]["primary_value"] == pytest.approx(12.0)
    assert observations[34]["relative_percentile"] is None
    assert observations[35]["relative_percentile"] is not None
    # A linearly rising index has a slowing year-over-year rate as its base
    # grows, so the latest inflation rate correctly ranks near the low end.
    assert observations[-1]["relative_percentile"] < 10


def test_primary_transforms_payroll_wages_and_openings_level() -> None:
    periods = [date(2024, 1, 1), date(2024, 2, 1), date(2025, 1, 1)]
    payroll_rows = [
        _bls_row(periods[0], 1000),
        _bls_row(periods[1], 1010),
        _bls_row(periods[2], 1100),
    ]
    payroll_config = next(
        item for item in bls_lens.SERIES_CONFIGS if item["series_id"] == "CES0000000001"
    )
    payroll = bls_lens.transform_bls_series(
        "CES0000000001", payroll_rows, payroll_config
    )
    payroll_by_period = {row["period"]: row for row in payroll}
    assert payroll[1]["primary_value"] == 10.0
    assert payroll_by_period["2024-03-01"]["primary_value"] is None
    assert payroll_by_period["2024-03-01"]["unavailable_reason"] == "missing_from_bls_api_response"
    assert payroll_by_period["2025-01-01"]["primary_value"] is None  # no December bridge across a gap
    assert payroll_by_period["2025-01-01"]["change_12m_pct"] == 10.0

    wage_config = next(
        item for item in bls_lens.SERIES_CONFIGS if item["series_id"] == "CES0500000003"
    )
    wages = bls_lens.transform_bls_series(
        "CES0500000003",
        [_bls_row(periods[0], 20), _bls_row(periods[2], 22)],
        wage_config,
    )
    assert wages[-1]["primary_value"] == 10.0

    openings_config = next(
        item
        for item in bls_lens.SERIES_CONFIGS
        if item["series_id"] == "JTS000000000000000JOL"
    )
    openings = bls_lens.transform_bls_series(
        "JTS000000000000000JOL",
        [_bls_row(periods[0], 8750)],
        openings_config,
    )
    assert openings[0]["primary_value"] == 8.75


def test_unavailable_bls_value_retains_footnote_without_inventing_measure() -> None:
    rows = [
        {
            **_bls_row(date(2025, 10, 1), "-"),
            "footnotes": [
                {"code": "X", "text": "Data unavailable due to lapse in appropriations"}
            ],
        }
    ]
    config = next(
        item for item in bls_lens.SERIES_CONFIGS if item["series_id"] == "CUUR0000SA0"
    )

    observation = bls_lens.transform_bls_series("CUUR0000SA0", rows, config)[0]

    assert observation["raw_value"] is None
    assert observation["primary_value"] is None
    assert observation["footnotes"][0]["code"] == "X"
    assert observation["available"] is False
    assert observation["unavailable_reason"] == "published_without_numeric_value"
    assert observation["revision_tracking_status"] == "not_applicable"


def test_missing_months_are_densified_as_explicit_unavailable_gaps() -> None:
    config = next(
        item for item in bls_lens.SERIES_CONFIGS if item["series_id"] == "LNS14000000"
    )

    observations = bls_lens.transform_bls_series(
        "LNS14000000",
        [
            _bls_row(date(2026, 1, 1), 4.0),
            _bls_row(date(2026, 3, 1), 4.2, preliminary=True),
        ],
        config,
    )

    assert [row["period"] for row in observations] == [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
    ]
    gap = observations[1]
    assert gap["raw_value"] is None
    assert gap["primary_value"] is None
    assert gap["available"] is False
    assert gap["unavailable_reason"] == "missing_from_bls_api_response"
    assert gap["footnotes"] == []
    assert observations[2]["preliminary"] is True
    assert observations[2]["change_1m"] is None


def test_vintage_persistence_is_idempotent_and_tracks_changed_state(monkeypatch) -> None:
    session_factory = _configure_vintage_database(monkeypatch)
    period = date(2026, 7, 1)
    first_rows = {
        "CES0000000001": [
            {
                "observation_date": period,
                "raw_value": 158800.0,
                "preliminary": True,
                "footnotes": [{"code": "P", "text": "preliminary"}],
            }
        ]
    }
    first_seen = datetime(2026, 8, 7, 12, tzinfo=timezone.utc)
    second_seen = first_seen + timedelta(hours=6)

    metadata, stats = bls_lens.persist_bls_observation_vintages(
        first_rows, observed_at=first_seen
    )
    assert stats == {
        "observations_seen": 1,
        "tracked_observations": 1,
        "states_inserted": 1,
        "states_reused": 0,
    }
    assert metadata[("CES0000000001", period)]["revision_count"] == 0

    metadata, stats = bls_lens.persist_bls_observation_vintages(
        first_rows, observed_at=second_seen
    )
    assert stats["states_inserted"] == 0
    assert stats["states_reused"] == 1
    assert metadata[("CES0000000001", period)]["last_seen_at"].startswith("2026-08-07T18:00")

    revised_rows = {
        "CES0000000001": [
            {
                "observation_date": period,
                "raw_value": 158825.0,
                "preliminary": False,
                "footnotes": [],
            }
        ]
    }
    metadata, stats = bls_lens.persist_bls_observation_vintages(
        revised_rows, observed_at=second_seen + timedelta(days=30)
    )
    tracked = metadata[("CES0000000001", period)]
    assert stats["states_inserted"] == 1
    assert tracked["first_seen_value"] == 158800
    assert tracked["current_value"] == 158825
    assert tracked["revision_delta"] == 25.0
    assert tracked["revision_count"] == 1

    with session_factory() as db:
        assert db.query(BlsObservationVintage).count() == 2


PAYROLL_HTML = """
<html><body>
  <table id="revision-table">
    <caption>Nonfarm Payroll Employment: Revisions between over-the-month estimates, 2026</caption>
    <thead>
      <tr><th>Month</th><th>Year</th><th colspan="6">Seasonally adjusted over-the-month change</th></tr>
      <tr><th></th><th></th><th>1st</th><th>2nd</th><th>3rd</th><th>2nd - 1st</th><th>3rd - 2nd</th><th>3rd - 1st</th></tr>
    </thead>
    <tbody>
      <tr><td>Jan.</td><td>2026</td><td>130</td><td>126</td><td>160</td><td>-4</td><td>34</td><td>30</td><td>-2600</td></tr>
      <tr><td>Feb.</td><td>2026</td><td>-92</td><td>-133</td><td></td><td>-41</td><td></td><td></td><td>500</td></tr>
      <tr><td colspan="9"><table><tr><td>Mar.</td><td>1900</td><td>999</td><td>999</td><td>999</td><td>0</td><td>0</td><td>0</td></tr></table></td></tr>
    </tbody>
  </table>
</body></html>
"""


def test_payroll_parser_reads_official_sa_columns_and_ignores_nested_rows() -> None:
    rows = bls_lens.parse_payroll_revision_history(PAYROLL_HTML)

    assert len(rows) == 2
    assert rows[0] == {
        "period": "2026-01-01",
        "first_estimate": 130,
        "second_estimate": 126,
        "third_estimate": 160,
        "revision_2_minus_1": -4,
        "revision_3_minus_2": 34,
        "revision_3_minus_1": 30,
        "second_minus_first": -4,
        "third_minus_second": 34,
        "total_revision": 30,
        "latest_estimate": 160,
        "revision_stage": "third_estimate",
        "status": "third_estimate",
        "unit": "thousands of jobs",
        "seasonal_adjustment": "seasonally adjusted",
        "source_url": bls_lens.BLS_PAYROLL_REVISIONS_URL,
    }
    assert rows[1]["revision_stage"] == "second_estimate"
    assert rows[1]["total_revision"] is None


ICS_TEXT = """BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:employment-1\r
SUMMARY:Employment Situation\r
DTSTART;TZID=America/New_York:20260904T083000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cpi-1\r
SUMMARY:Consumer Price Index\r
DTSTART;TZID=America/New_York:20260910T083000\r
STATUS:CONFIRMED\r
URL:https://www.bls.gov/news.release/cpi.nr0.htm\r
DESCRIPTION:Consumer price\r
 index release\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:ppi-1\r
SUMMARY:Producer Price Index\r
DTSTART;TZID=America/New_York:20260911T083000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:jolts-1\r
SUMMARY:Job Openings and Labor Turnover Survey\r
DTSTART:20260929T140000Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:irrelevant\r
SUMMARY:Productivity and Costs\r
DTSTART;TZID=America/New_York:20260903T083000\r
END:VEVENT\r
END:VCALENDAR\r
"""


def test_ics_parser_filters_reports_and_preserves_eastern_time_and_provenance() -> None:
    events = bls_lens.parse_bls_release_calendar(
        ICS_TEXT,
        now=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )

    assert [event["report_id"] for event in events] == [
        "employment_situation",
        "cpi",
        "ppi",
        "jolts",
    ]
    cpi = events[1]
    assert cpi["scheduled_at"] == "2026-09-10T08:30:00-04:00"
    assert cpi["time_label"] == "8:30 AM ET"
    assert cpi["status"] == "scheduled"
    assert cpi["calendar_status"] == "confirmed"
    assert cpi["provenance"]["uid"] == "cpi-1"
    assert events[-1]["scheduled_at"] == "2026-09-29T10:00:00-04:00"


def test_calendar_elapsed_clock_is_past_scheduled_never_released() -> None:
    events = bls_lens.parse_bls_release_calendar(
        ICS_TEXT,
        now=datetime(2026, 9, 20, 12, tzinfo=timezone.utc),
    )

    assert [event["status"] for event in events] == [
        "past_scheduled",
        "past_scheduled",
        "past_scheduled",
        "scheduled",
    ]
    assert all(event["status"] != "released" for event in events)


def test_official_document_fetch_falls_back_to_browser_transport(monkeypatch) -> None:
    calls = []

    class FailingAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            raise bls_lens.httpx.ConnectError("blocked")

    class BrowserResponse:
        status_code = 200
        text = "official document"

    class BrowserTransport:
        @staticmethod
        def get(url, *, headers, timeout, impersonate):
            calls.append((url, headers, timeout, impersonate))
            return BrowserResponse()

    monkeypatch.setattr(bls_lens.httpx, "AsyncClient", FailingAsyncClient)
    monkeypatch.setattr(bls_lens, "curl_requests", BrowserTransport)

    result = asyncio.run(
        bls_lens._fetch_official_text(
            bls_lens.BLS_RELEASE_CALENDAR_URL,
            accept="text/calendar",
        )
    )

    assert result == "official document"
    assert calls[0][0] == bls_lens.BLS_RELEASE_CALENDAR_URL
    assert calls[0][1]["Accept"] == "text/calendar"
    assert calls[0][3] == "chrome"


def test_build_payload_has_complete_contract_and_explicit_relative_semantics(monkeypatch) -> None:
    async def fake_fetch(self, series_ids, *, start_year, end_year):
        assert start_year == 2010
        assert end_year == 2026
        return {
            series_id: _monthly_rows(date(2011, 1, 1), 188, base=1000, step=1)
            for series_id in series_ids
        }

    async def fake_payroll():
        return bls_lens.parse_payroll_revision_history(PAYROLL_HTML)

    async def fake_calendar(_now=None):
        return bls_lens.parse_bls_release_calendar(
            ICS_TEXT, now=datetime(2026, 9, 1, tzinfo=timezone.utc)
        )

    def fake_persist(series_data, *, observed_at=None):
        return _fake_tracking_result(series_data)

    monkeypatch.setattr(bls_lens.BlsClient, "fetch_series", fake_fetch)
    monkeypatch.setattr(bls_lens, "fetch_payroll_revision_history", fake_payroll)
    monkeypatch.setattr(bls_lens, "fetch_release_calendar", fake_calendar)
    monkeypatch.setattr(bls_lens, "persist_bls_observation_vintages", fake_persist)

    payload = asyncio.run(
        bls_lens.build_bls_lens_payload(
            years=10,
            now=datetime(2026, 9, 1, 12, tzinfo=timezone.utc),
        )
    )

    assert set(payload) == {
        "as_of",
        "requested_years",
        "coverage",
        "data_quality",
        "reports",
        "series",
        "payroll_revisions",
        "release_calendar",
        "methodology",
        "warnings",
    }
    assert payload["data_quality"]["status"] == "complete"
    assert payload["coverage"]["series_available"] == 9
    assert len(payload["series"]) == 9
    assert all(series["key"] and series["higher_means"] for series in payload["series"])
    assert payload["methodology"]["series_source"]["sample_data_used"] is False
    assert "never means inherently good or bad" in payload["methodology"]["relative_percentile"]["interpretation"]


def test_build_payload_marks_missing_official_auxiliary_source_partial(monkeypatch) -> None:
    async def fake_fetch(self, series_ids, *, start_year, end_year):
        return {
            series_id: _monthly_rows(date(2023, 1, 1), 44, base=1000, step=1)
            for series_id in series_ids
        }

    async def missing_payroll():
        raise bls_lens.BlsUpstreamError("blocked")

    async def fake_calendar(_now=None):
        return bls_lens.parse_bls_release_calendar(
            ICS_TEXT, now=datetime(2026, 9, 1, tzinfo=timezone.utc)
        )

    monkeypatch.setattr(bls_lens.BlsClient, "fetch_series", fake_fetch)
    monkeypatch.setattr(bls_lens, "fetch_payroll_revision_history", missing_payroll)
    monkeypatch.setattr(bls_lens, "fetch_release_calendar", fake_calendar)
    monkeypatch.setattr(
        bls_lens,
        "persist_bls_observation_vintages",
        lambda series_data, *, observed_at=None: _fake_tracking_result(series_data),
    )

    payload = asyncio.run(
        bls_lens.build_bls_lens_payload(
            years=3,
            now=datetime(2026, 9, 1, tzinfo=timezone.utc),
        )
    )

    assert payload["data_quality"]["status"] == "partial"
    assert payload["data_quality"]["payroll_revision_history_available"] is False
    assert payload["payroll_revisions"] == []
    assert "Official national payroll revision history is temporarily unavailable." in payload["warnings"]


def test_refresh_returns_marked_stale_snapshot_when_live_refresh_fails(monkeypatch) -> None:
    cached_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=7)
    snapshot = ResponseSnapshot(
        cache_key=bls_lens.BLS_LENS_CACHE_KEY,
        payload={
            "as_of": "2026-09-01T12:00:00Z",
            "requested_years": 10,
            "data_quality": {"status": "complete", "stale": False},
            "warnings": [],
            "series": [],
            "payroll_revisions": [],
        },
        cached_at=cached_at,
        age_seconds=7 * 60 * 60,
    )

    @asynccontextmanager
    async def no_op_lock(_key):
        yield

    async def failing_build(**_kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(bls_lens, "_usable_snapshot", lambda: snapshot)
    monkeypatch.setattr(bls_lens, "async_response_refresh_lock", no_op_lock)
    monkeypatch.setattr(bls_lens, "build_bls_lens_payload", failing_build)

    payload = asyncio.run(bls_lens.refresh_bls_lens_snapshot())

    assert payload["data_quality"]["status"] == "stale"
    assert payload["data_quality"]["reason"] == "bls_lens_refresh_failed"
    assert payload["warnings"] == [
        "Live refresh failed; showing the last-known-good snapshot."
    ]


def test_quality_guard_rejects_revision_and_series_history_regressions() -> None:
    prior = _quality_payload()
    assert bls_lens._completeness_details(prior)["complete"] is True
    assert bls_lens._loses_quality_dimension(deepcopy(prior), prior) is False

    persistence_failed = deepcopy(prior)
    persistence_failed["data_quality"]["revision_tracking"] = {
        "status": "unavailable",
        "observations_seen": 0,
        "tracked_observations": 0,
    }
    for series in persistence_failed["series"]:
        for observation in series["observations"]:
            observation["revision_tracking_status"] = "unavailable"
    assert bls_lens._loses_quality_dimension(persistence_failed, prior) is True

    tracking_thinned = deepcopy(prior)
    tracking_thinned["data_quality"]["revision_tracking"][
        "tracked_observations"
    ] -= 1
    assert bls_lens._loses_quality_dimension(tracking_thinned, prior) is True

    later_start = deepcopy(prior)
    later_start["series"][0]["observations"].pop(0)
    assert bls_lens._loses_quality_dimension(later_start, prior) is True

    lower_count = deepcopy(prior)
    lower_count["series"][0]["observations"].pop(10)
    assert bls_lens._loses_quality_dimension(lower_count, prior) is True

    lower_valid_count = deepcopy(prior)
    lower_valid_count["series"][0]["observations"][10]["primary_value"] = None
    assert bls_lens._loses_quality_dimension(lower_valid_count, prior) is True

    missing_declared_start = deepcopy(prior)
    missing_declared_start["series"][0]["coverage_start"] = None
    assert bls_lens._loses_quality_dimension(missing_declared_start, prior) is True

    lower_declared_count = deepcopy(prior)
    lower_declared_count["series"][0]["coverage"]["observation_count"] -= 1
    assert bls_lens._loses_quality_dimension(lower_declared_count, prior) is True

    lower_declared_valid_count = deepcopy(prior)
    lower_declared_valid_count["series"][0]["coverage"][
        "valid_primary_count"
    ] -= 1
    assert bls_lens._loses_quality_dimension(lower_declared_valid_count, prior) is True

    missing_latest_metadata = deepcopy(prior)
    missing_latest_metadata["series"][0]["latest"] = None
    assert bls_lens._loses_quality_dimension(missing_latest_metadata, prior) is True

    earlier_latest = deepcopy(prior)
    earlier_latest["series"][0]["latest"] = deepcopy(
        earlier_latest["series"][0]["observations"][-2]
    )
    earlier_latest["series"][0]["observations"][-1]["primary_value"] = None
    assert bls_lens._loses_quality_dimension(earlier_latest, prior) is True

    swapped_required_series = deepcopy(prior)
    swapped_required_series["series"].pop(0)
    replacement = deepcopy(swapped_required_series["series"][0])
    replacement["series_id"] = "NOT_A_REQUIRED_SERIES"
    swapped_required_series["series"].append(replacement)
    assert bls_lens._loses_quality_dimension(swapped_required_series, prior) is True


def test_quality_guard_rejects_report_payroll_and_calendar_regressions() -> None:
    prior = _quality_payload()

    missing_report = deepcopy(prior)
    missing_report["reports"].pop(0)
    assert bls_lens._loses_quality_dimension(missing_report, prior) is True

    thinned_report_mapping = deepcopy(prior)
    thinned_report_mapping["reports"][0]["series_ids"].pop()
    assert bls_lens._loses_quality_dimension(thinned_report_mapping, prior) is True

    thinner_payroll = deepcopy(prior)
    thinner_payroll["payroll_revisions"].pop(0)
    assert bls_lens._loses_quality_dimension(thinner_payroll, prior) is True

    downgraded_payroll_stage = deepcopy(prior)
    downgraded_payroll_stage["payroll_revisions"][0][
        "revision_stage"
    ] = "second_estimate"
    assert bls_lens._loses_quality_dimension(downgraded_payroll_stage, prior) is True

    malformed_payroll_period = deepcopy(prior)
    malformed_payroll_period["payroll_revisions"][0]["period"] = "not-a-period"
    assert bls_lens._loses_quality_dimension(malformed_payroll_period, prior) is True

    entirely_unparseable_payroll = deepcopy(prior)
    for row in entirely_unparseable_payroll["payroll_revisions"]:
        row["period"] = "not-a-period"
    assert (
        bls_lens._payroll_quality(entirely_unparseable_payroll)["end"] is None
    )
    assert bls_lens._loses_quality_dimension(entirely_unparseable_payroll, prior) is True

    missing_calendar_report = deepcopy(prior)
    missing_calendar_report["release_calendar"].pop(0)
    assert bls_lens._loses_live_calendar_coverage(missing_calendar_report, prior) is True
    assert bls_lens._loses_quality_dimension(missing_calendar_report, prior) is True

    malformed_calendar_time = deepcopy(prior)
    malformed_calendar_time["release_calendar"][0][
        "scheduled_at"
    ] = "not-a-timestamp"
    assert bls_lens._loses_live_calendar_coverage(malformed_calendar_time, prior) is True
    assert bls_lens._loses_quality_dimension(malformed_calendar_time, prior) is True

    inferred_release_status = deepcopy(prior)
    inferred_release_status["release_calendar"][0]["status"] = "released"
    assert bls_lens._loses_live_calendar_coverage(inferred_release_status, prior) is True
    assert bls_lens._loses_quality_dimension(inferred_release_status, prior) is True

    stale_calendar_report = deepcopy(prior)
    stale_calendar_report["release_calendar"][0][
        "scheduled_at"
    ] = "2026-08-01T08:30:00-04:00"
    assert bls_lens._loses_live_calendar_coverage(stale_calendar_report, prior) is True


def test_calendar_history_merge_preserves_depth_with_schedule_only_statuses() -> None:
    prior = _quality_payload()
    candidate = deepcopy(prior)
    candidate["as_of"] = "2026-09-15T12:00:00Z"
    for index, event in enumerate(candidate["release_calendar"], start=1):
        event["scheduled_at"] = datetime(
            2026,
            10,
            index,
            12,
            30,
            tzinfo=timezone.utc,
        ).isoformat()
        event["provenance"]["uid"] += "-new"

    assert bls_lens._loses_live_calendar_coverage(candidate, prior) is False
    merged = bls_lens._merge_calendar_history(candidate, prior)

    assert len(merged["release_calendar"]) == 8
    assert merged["data_quality"]["calendar_history_preserved_count"] == 4
    assert {event["status"] for event in merged["release_calendar"]} == {
        "past_scheduled",
        "scheduled",
    }
    assert all(
        event["status"] != "released" for event in merged["release_calendar"]
    )
    assert bls_lens._loses_quality_dimension(merged, prior) is False


@pytest.mark.parametrize("regression", ["persistence", "series_history"])
def test_refresh_never_stores_lower_quality_candidate(monkeypatch, regression) -> None:
    prior = _quality_payload()
    candidate = deepcopy(prior)
    if regression == "persistence":
        candidate["data_quality"]["status"] = "partial"
        candidate["data_quality"]["revision_tracking"] = {
            "status": "unavailable",
            "observations_seen": 0,
            "tracked_observations": 0,
        }
        for series in candidate["series"]:
            for observation in series["observations"]:
                observation["revision_tracking_status"] = "unavailable"
    else:
        candidate["series"][0]["observations"].pop(0)

    snapshot = ResponseSnapshot(
        cache_key=bls_lens.BLS_LENS_CACHE_KEY,
        payload=prior,
        cached_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=7),
        age_seconds=7 * 60 * 60,
    )
    stored = []

    @asynccontextmanager
    async def no_op_lock(_key):
        yield

    async def fake_build(**kwargs):
        assert kwargs["retain_history"] is True
        return candidate

    monkeypatch.setattr(bls_lens, "_usable_snapshot", lambda: snapshot)
    monkeypatch.setattr(bls_lens, "async_response_refresh_lock", no_op_lock)
    monkeypatch.setattr(bls_lens, "build_bls_lens_payload", fake_build)
    monkeypatch.setattr(
        bls_lens,
        "store_response_snapshot",
        lambda *args, **kwargs: stored.append((args, kwargs)),
    )

    payload = asyncio.run(bls_lens.refresh_bls_lens_snapshot(force=True))

    assert payload["data_quality"]["status"] == "stale"
    assert payload["data_quality"]["reason"] == "bls_lens_refresh_lower_quality"
    assert payload["series"] == prior["series"]
    assert stored == []


def test_slicing_preserves_stale_quality_status() -> None:
    payload = _quality_payload()
    payload["data_quality"]["stale"] = True
    payload["data_quality"]["status"] = "stale"

    sliced = bls_lens._slice_payload(payload, 3)

    assert sliced["data_quality"]["status"] == "stale"
    assert sliced["data_quality"]["stale"] is True


def test_api_validates_horizon_and_returns_service_payload(monkeypatch) -> None:
    async def fake_payload(years: int):
        return {
            "as_of": "2026-09-01T12:00:00Z",
            "requested_years": years,
            "coverage": {},
            "data_quality": {"status": "complete"},
            "reports": [],
            "series": [],
            "payroll_revisions": [],
            "release_calendar": [],
            "methodology": {},
            "warnings": [],
        }

    monkeypatch.setattr("app.api.bls.get_bls_lens_payload", fake_payload)
    client = TestClient(app)

    response = client.get("/bls/lens?years=4")
    assert response.status_code == 200
    assert response.json()["requested_years"] == 4
    assert client.get("/bls/lens?years=2").status_code == 422
    assert client.get("/bls/lens?years=11").status_code == 422


def test_api_returns_503_instead_of_sample_data_when_cold_refresh_fails(monkeypatch) -> None:
    async def unavailable(_years: int):
        raise bls_lens.BlsLensUnavailable(
            "Official BLS data could not be refreshed and no cached snapshot is available."
        )

    monkeypatch.setattr("app.api.bls.get_bls_lens_payload", unavailable)

    response = TestClient(app).get("/bls/lens?years=10")

    assert response.status_code == 503
    assert "no cached snapshot" in response.json()["detail"]
