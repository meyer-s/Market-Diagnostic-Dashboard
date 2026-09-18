from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

import httpx
import pytest

from app.services import treasury_yield_curve as curve_service
from app.api import indicators
from app.services.endpoint_response_cache import ResponseSnapshot


def _atom_feed(observation_date: str = "2026-09-17") -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <entry>
    <content type="application/xml">
      <m:properties>
        <d:NEW_DATE>{observation_date}T00:00:00</d:NEW_DATE>
        <d:BC_1MONTH>3.97</d:BC_1MONTH>
        <d:BC_2YEAR>4.67</d:BC_2YEAR>
        <d:BC_10YEAR>4.94</d:BC_10YEAR>
        <d:BC_30YEAR>5.29</d:BC_30YEAR>
      </m:properties>
    </content>
  </entry>
</feed>"""


def test_treasury_curve_requests_use_supported_xml_feed_and_minimal_years() -> None:
    cutoff, requests = curve_service.build_treasury_curve_requests(
        6,
        reference_date=date(2026, 2, 15),
    )

    assert cutoff == "2025-09-01"
    assert [period for period, _url in requests] == ["2025", "2026"]
    assert all("/pages/xml?" in url for _period, url in requests)
    assert all("xmlview" not in url for _period, url in requests)


def test_parse_treasury_curve_xml_keeps_supported_maturities() -> None:
    parsed = curve_service.parse_treasury_curve_xml(
        _atom_feed(),
        cutoff_date="2026-09-01",
    )

    assert parsed == [
        {
            "date": "2026-09-17",
            "curve": [
                {"maturity": "1M", "yield": 3.97},
                {"maturity": "2Y", "yield": 4.67},
                {"maturity": "10Y", "yield": 4.94},
                {"maturity": "30Y", "yield": 5.29},
            ],
        }
    ]


def test_fetch_treasury_curve_preserves_good_period_when_another_fails(monkeypatch) -> None:
    requested_urls: list[str] = []

    class FakeResponse:
        def __init__(self, status_code: int, text: str = "") -> None:
            self.status_code = status_code
            self.text = text

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                request = httpx.Request("GET", "https://home.treasury.gov")
                response = httpx.Response(self.status_code, request=request)
                raise httpx.HTTPStatusError(
                    "Treasury unavailable",
                    request=request,
                    response=response,
                )

    class FakeAsyncClient:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url: str):
            requested_urls.append(url)
            if "field_tdr_date_value=2025" in url:
                return FakeResponse(503)
            return FakeResponse(200, _atom_feed("2026-02-13"))

    monkeypatch.setattr(curve_service.httpx, "AsyncClient", FakeAsyncClient)

    payload = asyncio.run(
        curve_service.fetch_treasury_yield_curve(
            6,
            reference_date=date(2026, 2, 15),
        )
    )

    assert len(requested_urls) == 2
    assert payload["as_of"] == "2026-02-13"
    assert payload["data_quality"]["status"] == "partial"
    assert payload["data_quality"]["periods_received"] == ["2026"]
    assert payload["warnings"] == ["Treasury data for 2025 could not be refreshed."]


def test_fetch_treasury_curve_rejects_empty_official_response(monkeypatch) -> None:
    class FakeResponse:
        text = '<feed xmlns="http://www.w3.org/2005/Atom" />'

        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url: str):
            return FakeResponse()

    monkeypatch.setattr(curve_service.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(curve_service.TreasuryYieldCurveUnavailable):
        asyncio.run(
            curve_service.fetch_treasury_yield_curve(
                1,
                reference_date=date(2026, 9, 18),
            )
        )


def test_curve_endpoint_reuses_bounded_stale_snapshot_on_refresh_failure(monkeypatch) -> None:
    prior = {
        "as_of": "2026-09-17",
        "data_quality": {"status": "complete", "stale": False},
        "warnings": [],
        "curves": [{"date": "2026-09-17", "curve": [{"maturity": "10Y", "yield": 4.94}]}],
    }
    snapshot = ResponseSnapshot(
        cache_key="treasury-yield-curve:3",
        payload=prior,
        cached_at=datetime.utcnow() - timedelta(hours=5),
        age_seconds=5 * 60 * 60,
    )

    @asynccontextmanager
    async def no_op_lock(_cache_key: str):
        yield

    async def failed_refresh(_months: int):
        raise curve_service.TreasuryYieldCurveUnavailable("upstream unavailable")

    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: snapshot)
    monkeypatch.setattr(indicators, "async_response_refresh_lock", no_op_lock)
    monkeypatch.setattr(indicators, "fetch_treasury_yield_curve", failed_refresh)

    result = asyncio.run(indicators.get_treasury_yield_curve(months=3))

    assert result["as_of"] == "2026-09-17"
    assert result["data_quality"]["status"] == "stale"
    assert result["data_quality"]["reason"] == "treasury_yield_curve_refresh_failed"
    assert result["warnings"] == [
        "Live refresh failed; showing the last-known-good snapshot."
    ]


def test_curve_endpoint_persists_successful_refresh(monkeypatch) -> None:
    refreshed = {
        "as_of": "2026-09-18",
        "data_quality": {"status": "complete", "stale": False},
        "warnings": [],
        "curves": [{"date": "2026-09-18", "curve": [{"maturity": "10Y", "yield": 4.91}]}],
    }
    stored: list[tuple[str, dict]] = []

    @asynccontextmanager
    async def no_op_lock(_cache_key: str):
        yield

    async def successful_refresh(months: int):
        assert months == 3
        return refreshed

    monkeypatch.setattr(indicators, "load_response_snapshot", lambda _key: None)
    monkeypatch.setattr(indicators, "async_response_refresh_lock", no_op_lock)
    monkeypatch.setattr(indicators, "fetch_treasury_yield_curve", successful_refresh)
    monkeypatch.setattr(
        indicators,
        "store_response_snapshot",
        lambda key, payload: stored.append((key, payload)),
    )

    result = asyncio.run(indicators.get_treasury_yield_curve(months=3))

    assert result == refreshed
    assert stored == [("treasury-yield-curve:3", refreshed)]
