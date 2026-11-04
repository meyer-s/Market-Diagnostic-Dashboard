import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.services import truth_social as service

NOW = datetime(2026, 1, 9, 3, tzinfo=timezone.utc)  # Jan 8, 10 p.m. Eastern


def page(labels=None, counts=None, through="January 8, 2026"):
    labels = labels if labels is not None else [f"2026-01-{i:02d}" for i in range(1, 10)]
    counts = counts if counts is not None else [1] * len(labels)
    chart = {"labels": labels, "datasets": [{"label": label, "data": counts} for label in ("Originals", "Quotes", "Reblogs")]}
    return f'<p class="stats-page__summary-coverage">February 14, 2022 — {through}</p><script>window.statsChartData = {json.dumps(chart)};</script>'


def test_coverage_clips_source_zero_padding_and_eastern_current_day():
    result = service.parse_archive(page(), 2026, NOW)
    assert len(result["days"]) == 8
    assert result["end_date"] == "2026-01-08"
    assert result["days"][-1] == {"date": "2026-01-08", "originals": 1, "quotes": 1, "retruths": 1, "total": 3, "partial": True}
    assert not result["days"][0]["partial"]


def test_published_zero_is_preserved():
    result = service.parse_archive(page(counts=[0] * 9), 2026, NOW)
    assert all(row["total"] == 0 for row in result["days"])


@pytest.mark.parametrize("counts", [[1] * 8, [None] * 9, [-1] * 9, [True] * 9, [1.2] * 9])
def test_missing_invalid_or_misaligned_counts_fail_closed(counts):
    with pytest.raises(ValueError):
        service.parse_archive(page(counts=counts), 2026, NOW)


@pytest.mark.parametrize("labels", [
    ["2026-01-01", "2026-01-01"],
    ["2026-01-01", "2026-01-03"],
    ["2025-12-31", "2026-01-01"],
    ["2026-01-02", "2026-01-01"],
])
def test_duplicate_gap_wrong_year_and_unsorted_dates_rejected(labels):
    with pytest.raises(ValueError):
        service.parse_archive(page(labels=labels), 2026, NOW)


def test_future_coverage_and_changed_categories_rejected():
    with pytest.raises(ValueError):
        service.parse_archive(page(through="January 10, 2026"), 2026, NOW)
    with pytest.raises(ValueError):
        service.parse_archive(page().replace('"Quotes"', '"Unknown"'), 2026, NOW)


def test_stale_cache_is_explicit_and_bounded():
    payload = service.parse_archive(page(), 2026, NOW)
    with patch.dict(service._CACHE, {2026: (0, payload)}, clear=True), patch.object(service.time, "monotonic", return_value=1000), patch.object(service.requests, "get", side_effect=service.requests.ConnectionError()):
        result = service.get_truth_social(2026)
        assert result["stale"] and result["refresh_error"]
        assert result["fetched_at"] == payload["fetched_at"]
        assert not payload["stale"]
    with patch.dict(service._CACHE, {2026: (0, payload)}, clear=True), patch.object(service.time, "monotonic", return_value=22000), patch.object(service.requests, "get", side_effect=service.requests.ConnectionError()):
        with pytest.raises(ValueError):
            service.get_truth_social(2026)
