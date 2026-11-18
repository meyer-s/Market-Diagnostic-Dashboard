from datetime import date
from unittest.mock import MagicMock

from app.services import yield_curve_comparison as comparison


def test_corporate_par_workbook_keeps_last_completed_month_and_observed_tenors(monkeypatch):
    rows = [
        ["Treasury HQM"],
        ["", "", "2 Years", "5 Years", "10 Years", "30 Years"],
        ["Sep 2026", "", 5.29, 5.67, 6.07, 6.58],
        ["Oct 2026", "", 5.03, 5.37, 5.79, 6.35],
        ["Nov 2026", "", 0, 0, 0, 0],
    ]
    workbook = MagicMock()
    sheet = workbook.__enter__.return_value.sheet_by_index.return_value
    sheet.nrows = len(rows)
    sheet.row_values.side_effect = rows.__getitem__
    monkeypatch.setattr(comparison.xlrd, "open_workbook", lambda **kwargs: workbook)

    data = comparison.parse_corporate_par_workbook(b"workbook", today=date(2026, 11, 18))

    assert data["period_end"] == "2026-10-31"
    assert [(point["maturity"], point["yield"]) for point in data["curve"]] == [
        ("2Y", 5.03), ("5Y", 5.37), ("10Y", 5.79), ("30Y", 6.35),
    ]
    assert data["data_quality"] == {"partial": False, "stale": False}


def test_usda_schedule_preserves_effective_quarter_and_excludes_open_ended_bucket():
    page = b"""
        <h4>Municipal Interest Rates for the 4th Quarter of CY 2026</h4>
        <table>
          <tr><th>Term ends in year</th><th>RUS Rate</th></tr>
          <tr><td>2027</td><td>2.500</td></tr>
          <tr><td>2028</td><td>2.625</td></tr>
          <tr><td>2046</td><td>4.375</td></tr>
          <tr><td>2047 or later</td><td>4.750</td></tr>
        </table>
    """
    data = comparison.parse_public_lending_schedule(page, today=date(2026, 11, 18))
    assert data["period_label"] == "Q4 2026"
    assert data["period_end"] == "2026-12-31"
    assert [(point["maturity"], point["yield"]) for point in data["curve"]] == [
        ("1Y", 2.500), ("2Y", 2.625), ("20Y", 4.375),
    ]
    assert data["data_quality"]["partial"]


def test_usda_published_copy_becomes_stale_after_its_effective_quarter():
    assert comparison.published_public_lending_snapshot(today=date(2026, 9, 30)) is None
    active = comparison.published_public_lending_snapshot(today=date(2026, 12, 31))
    expired = comparison.published_public_lending_snapshot(today=date(2027, 1, 1))
    assert active["data_quality"]["published_snapshot"]
    assert not active["data_quality"]["stale"]
    assert expired["data_quality"]["stale"]
