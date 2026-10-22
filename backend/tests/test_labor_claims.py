import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest

from app.services import labor_claims
from app.services.endpoint_response_cache import ResponseSnapshot

RELEASE = """
8:30 A.M. (Eastern) Thursday, October 22, 2026
In the week ending October 17, the advance figure for seasonally adjusted initial
claims was 194,000, a decrease of 6,000 from the previous week's revised level.
The advance number for seasonally adjusted insured unemployment during the week
ending October 10 was 1,728,000, an increase of 25,000 from the previous week's revised level.
UNADJUSTED DATA initial claims 172,390
"""
NOW = datetime(2026, 10, 22, 13, tzinfo=timezone.utc)


def test_reads_adjusted_figures_and_revised_comparison_from_dol_narrative():
    payload = labor_claims.parse_claims_release(RELEASE, now=NOW)
    assert payload["released_on"] == "2026-10-22"
    assert payload["initial_claims"] == {"week_ending": "2026-10-17", "value": 194000,
                                         "change": -6000, "prior_revised": 200000}
    assert payload["continuing_claims"] == {"week_ending": "2026-10-10", "value": 1728000,
                                            "change": 25000, "prior_revised": 1703000}


def test_unchanged_weeks_are_valid_observations():
    text = RELEASE.replace("a decrease of 6,000", "unchanged").replace("an increase of 25,000", "unchanged")
    payload = labor_claims.parse_claims_release(text, now=NOW)
    assert payload["initial_claims"]["change"] == 0
    assert payload["continuing_claims"]["prior_revised"] == 1728000


@pytest.mark.parametrize("text", [RELEASE.replace("October 22, 2026", "November 22, 2026"),
                                  RELEASE.replace("October 22, 2026", "September 22, 2026"),
                                  RELEASE.replace("October 17", "September 17"), "access denied"])
def test_rejects_future_stale_malformed_and_inconsistent_releases(text):
    with pytest.raises(ValueError):
        labor_claims.parse_claims_release(text, now=NOW)


def test_january_release_resolves_december_reference_week():
    text = RELEASE.replace("Thursday, October 22, 2026", "Thursday, January 7, 2027").replace("October 17", "January 2").replace("October 10", "December 26")
    payload = labor_claims.parse_claims_release(text, now=datetime(2027, 1, 7, tzinfo=timezone.utc))
    assert payload["continuing_claims"]["week_ending"] == "2026-12-26"


@pytest.mark.parametrize("age, expected", [(600, "stale"), (9 * 86400, "unavailable")])
def test_failure_uses_bounded_marked_stale_cache(monkeypatch, age, expected):
    @asynccontextmanager
    async def lock(_key):
        yield
    async def fail():
        raise RuntimeError("upstream unavailable")
    snapshot = ResponseSnapshot(labor_claims.CACHE_KEY,
                                {"released_on": "2026-10-22", "status": "current"}, NOW, age)
    monkeypatch.setattr(labor_claims, "async_response_refresh_lock", lock)
    monkeypatch.setattr(labor_claims, "load_response_snapshot", lambda _: snapshot)
    monkeypatch.setattr(labor_claims, "_fetch_claims", fail)
    assert asyncio.run(labor_claims.get_labor_claims())["status"] == expected
