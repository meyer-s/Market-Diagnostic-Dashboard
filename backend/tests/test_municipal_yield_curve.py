import asyncio
from datetime import date

import httpx
import pytest

from app.services import municipal_yield_curve as muni


def table(day="11/18/26", *, tenors=range(1, 31), rate=None, basis="Benchmark 5% Non-Call 10yr Curve"):
    rows = "".join(
        f"<tr id='bCRVrow{tenor}'><td class='col_tenor'>{tenor}</td>"
        f"<td class='col_yield'>{rate if rate is not None else 3 + tenor / 100}</td></tr>"
        for tenor in tenors
    )
    return f"<h3>{basis}</h3><p>Rates as of 06:00 PM {day}</p><table>{rows}</table>".encode()


def test_complete_benchmark_preserves_all_tenors_basis_and_publisher_time():
    payload = muni.parse_municipal_curve(table(), requested_date=date(2026, 11, 18))
    assert payload["as_of"] == "2026-11-18T18:00:00-05:00"
    assert payload["period_start"] == "2026-11-18"
    assert payload["basis"] == "5% coupon, non-call 10 years"
    assert payload["curve"] == [{"maturity": f"{year}Y", "yield": 3 + year / 100} for year in range(1, 31)]
    assert payload["source"]["url"] == muni.MUNICIPAL_SOURCE


@pytest.mark.parametrize("content", [
    table(tenors=range(1, 30)),
    table(tenors=[*range(1, 31), 30]),
    table(rate="NaN"),
    table(rate="inf"),
    table(rate=16),
    table(basis="AAA non-callable par curve"),
    table().replace(b"Rates as of", b"Fetched at"),
    table("11/19/26"),
    b"<html>Please sign in</html>",
])
def test_rejects_incomplete_invalid_wrong_basis_undated_or_future_data(content):
    with pytest.raises(muni.MunicipalCurveUnavailable):
        muni.parse_municipal_curve(content, requested_date=date(2026, 11, 18))


def test_holiday_carryforwards_are_deduplicated_and_request_failures_are_visible(monkeypatch):
    client_type = httpx.AsyncClient
    requested = []

    def respond(request):
        day = request.url.params["dtinput"]
        requested.append(day)
        assert request.url.params["curve"] == "ap_benchmark"
        if day == "11/18/2026":
            return httpx.Response(503)
        # Veterans Day is carried from Nov 10, not a new curve observation.
        published = "11/10/26" if day in ("11/11/2026", "11/10/2026") else day.replace("/2026", "/26")
        return httpx.Response(200, content=table(published))

    monkeypatch.setattr(muni.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(respond), **kwargs))
    data = asyncio.run(muni.fetch_municipal_curve(today=date(2026, 11, 18)))

    assert len(requested) == 7
    assert data["period_start"] == "2026-11-17"
    assert [entry["period_start"] for entry in data["history"]] == ["2026-11-16", "2026-11-13", "2026-11-12", "2026-11-10"]
    assert data["data_quality"]["refresh_partial"]
    assert not data["data_quality"]["history_partial"]
    assert data["data_quality"]["maturities_received"] == 30


def test_exposes_limited_history_and_old_observation_instead_of_inventing_curves(monkeypatch):
    client_type = httpx.AsyncClient
    monkeypatch.setattr(muni.httpx, "AsyncClient", lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=table("11/05/26"))), **kwargs,
    ))
    data = asyncio.run(muni.fetch_municipal_curve(today=date(2026, 11, 18)))
    assert data["period_start"] == "2026-11-05"
    assert data["history"] == []
    assert data["data_quality"]["stale"]
    assert data["data_quality"]["history_partial"]


def test_total_publisher_failure_raises_for_the_api_last_known_good_fallback(monkeypatch):
    client_type = httpx.AsyncClient
    monkeypatch.setattr(muni.httpx, "AsyncClient", lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"maintenance")), **kwargs,
    ))
    with pytest.raises(muni.MunicipalCurveUnavailable, match="no usable"):
        asyncio.run(muni.fetch_municipal_curve(today=date(2026, 11, 18)))
