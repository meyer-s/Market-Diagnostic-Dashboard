from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.services import agriculture_report_desk as desk


def _row(release: str, value: str, market_year: str = "2026/27") -> dict[str, str]:
    return {
        "ReleaseDate": release,
        "ReportDate": release,
        "ReportTitle": "U.S. Feed Grain and Corn Supply and Use",
        "Attribute": "Ending Stocks",
        "Commodity": "Corn",
        "Region": "United States",
        "MarketYear": market_year,
        "ProjEstFlag": "Proj.",
        "Value": value,
        "Unit": "Million Bushels",
    }


def test_metric_history_preserves_as_reported_releases_and_orients_supply() -> None:
    points = desk._select_metric_rows(
        [_row("2026-05-12", "2100"), _row("2026-06-11", "2050"), _row("2026-07-10", "2150")],
        "Corn",
        ("Ending Stocks",),
    )

    desk._standardize_metric(points, orientation=-1)

    assert [point["value"] for point in points] == [2100.0, 2050.0, 2150.0]
    assert points[1]["revision"] == -50.0
    assert points[1]["bullish_signal_z"] > 0
    assert points[2]["bullish_signal_z"] < 0
    assert points[0]["bullish_signal_z"] is None


def test_report_desk_combines_official_history_and_price_reactions(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        _row("2026-05-12", "2100"),
        _row("2026-06-11", "2050"),
        _row("2026-07-10", "2150"),
    ]
    monkeypatch.setattr(desk, "_load_wasde_history", lambda years, reference: rows)
    monkeypatch.setattr(
        desk,
        "_price_history",
        lambda ticker, start, end: ([
            {"date": "2026-05-11", "value": 400.0, "rebased": 100.0, "ticker": ticker},
            {"date": "2026-05-12", "value": 404.0, "rebased": 101.0, "ticker": ticker},
            {"date": "2026-06-10", "value": 410.0, "rebased": 102.5, "ticker": ticker},
            {"date": "2026-06-11", "value": 414.1, "rebased": 103.525, "ticker": ticker},
            {"date": "2026-07-09", "value": 420.0, "rebased": 105.0, "ticker": ticker},
            {"date": "2026-07-10", "value": 415.8, "rebased": 103.95, "ticker": ticker},
        ], []),
    )

    payload = desk.build_report_desk("ZC", years=1, selected_metric="ending_stocks")

    assert payload["commodity"]["name"] == "Corn"
    assert payload["methodology"]["expectations"].startswith("User-entered only")
    assert len(payload["reports"]) >= 7
    ending_stocks = next(layer for layer in payload["series"] if layer["metric_id"] == "ending_stocks")
    assert ending_stocks["points"][0]["reaction_1d_pct"] == 1.0
    assert payload["takeaways"][-1]["title"] == "Interpretation boundary"


def test_calendar_labels_official_recurring_and_expected_dates() -> None:
    events = desk.build_release_calendar(date(2026, 8, 13))

    assert any(event["report"] == "WASDE" and event["confidence"] == "official" for event in events)
    assert any(event["report"] == "Export Sales" and event["confidence"] == "recurring" for event in events)
    assert any(event["report"] == "Grain Stocks" and event["confidence"] == "expected" for event in events)
    assert "BEGIN:VCALENDAR" in desk.build_calendar_ics(date(2026, 8, 13))


def test_calendar_skips_a_recurring_release_after_its_time_passes() -> None:
    reference = datetime(2026, 8, 13, 11, 0, tzinfo=ZoneInfo("America/New_York"))

    events = desk.build_release_calendar(reference)
    export_sales = next(event for event in events if event["report_id"] == "export_sales")

    assert export_sales["date"] == "2026-08-20"


def test_unknown_symbol_is_rejected() -> None:
    with pytest.raises(KeyError, match="not yet chart-ready"):
        desk.build_report_desk("LE")


def test_soybean_mapping_matches_the_official_wasde_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    soybean_rows = [{**_row("2026-08-12", "330"), "Commodity": "Oilseed, Soybean"}]
    monkeypatch.setattr(desk, "_load_wasde_history", lambda years, reference: soybean_rows)
    monkeypatch.setattr(desk, "_price_history", lambda ticker, start, end: ([], []))

    payload = desk.build_report_desk("ZS", years=1, selected_metric="ending_stocks")

    assert payload["commodity"]["name"] == "Soybeans"
    assert payload["series"][0]["points"][0]["value"] == 330.0
