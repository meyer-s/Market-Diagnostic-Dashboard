from __future__ import annotations

import zipfile
from datetime import date, datetime
from statistics import mean
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.agriculture_wasde_observation import AgricultureWasdeObservation
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
    assert len(payload["impact_model"]["reports"]) == 8
    assert "not a forecast or causal estimate" in payload["impact_model"]["methodology"]["scenario"]
    assert payload["takeaways"][-1]["title"] == "Interpretation boundary"


def test_five_session_reaction_waits_for_a_complete_forward_window() -> None:
    series = [{"points": [{"release_date": "2026-08-12"}]}]
    incomplete_prices = [
        {"date": "2026-08-11", "value": 400.0},
        {"date": "2026-08-12", "value": 404.0},
        {"date": "2026-08-13", "value": 408.0},
    ]

    desk._attach_reactions(series, incomplete_prices)

    point = series[0]["points"][0]
    assert point["reaction_1d_pct"] == 1.0
    assert point["reaction_5d_pct"] is None

    complete_prices = incomplete_prices + [
        {"date": "2026-08-14", "value": 412.0},
        {"date": "2026-08-17", "value": 416.0},
        {"date": "2026-08-18", "value": 420.0},
    ]
    desk._attach_reactions(series, complete_prices)

    assert point["reaction_5d_pct"] == 5.0


def test_report_price_reactions_use_publication_session_and_after_close_rules() -> None:
    price_dates = [date(2026, 8, day) for day in (6, 7, 10, 11, 12, 13, 14, 17, 18, 19)]
    closes = [100.0, 101.0, 102.0, 104.0, 105.0, 107.1, 108.0, 109.0, 110.0, 111.0]

    export_sales = desk._report_price_reaction("export_sales", date(2026, 8, 6), price_dates, closes)
    crop_progress = desk._report_price_reaction("crop_progress", date(2026, 8, 10), price_dates, closes)

    assert export_sales["price_event_date"] == "2026-08-13"
    assert export_sales["reaction_1d_pct"] == 2.0
    assert crop_progress["price_event_date"] == "2026-08-10"
    assert crop_progress["reaction_1d_pct"] == pytest.approx(1.961, abs=0.001)


def test_relationship_statistics_calibrate_directional_signal_to_forward_return() -> None:
    observations = [
        {"signal_z": signal, "reaction_5d_pct": signal * 1.5}
        for signal in (-2.0, -1.5, -1.0, -0.5, 0.5, 1.0, 1.5, 2.0)
    ]

    stats = desk._relationship_statistics(observations, "reaction_5d_pct")
    confidence, reliability = desk._impact_confidence(stats["sample_size"], stats["correlation"])

    assert stats["sample_size"] == 8
    assert stats["correlation"] == 1.0
    assert stats["slope"] == 1.5
    assert stats["alignment_rate"] == 1.0
    assert confidence == "Moderate"
    assert reliability > 0


def test_non_wasde_signals_are_centered_standard_scores() -> None:
    history = {
        "releases": [
            {"release_date": f"2026-0{index}-01", "metrics": [{"id": "production_yoy_pct", "value": value}]}
            for index, value in enumerate((-8.0, -2.0, 4.0, 10.0), start=1)
        ],
        "analysis": {"primary_metric_id": "production_yoy_pct"},
    }

    rows = desk._non_wasde_signal_inputs("crop_production", history)

    assert mean(row["signal_z"] for row in rows) == pytest.approx(0.0, abs=0.001)
    assert desk.pstdev(row["signal_z"] for row in rows) == pytest.approx(1.0, abs=0.001)


def test_same_session_reports_share_one_event_weight() -> None:
    reports = [
        {"report_id": "wasde", "price_event_date": "2026-08-12", "reliability": 0.8, "freshness": 1.0},
        {"report_id": "crop_production", "price_event_date": "2026-08-12", "reliability": 0.4, "freshness": 1.0},
        {"report_id": "export_sales", "price_event_date": "2026-08-13", "reliability": 0.6, "freshness": 1.0},
    ]

    effective = desk._same_session_effective_weights(reports)

    assert effective["wasde"] + effective["crop_production"] == pytest.approx(0.8)
    assert effective["export_sales"] == pytest.approx(0.6)


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


def test_archive_selection_keeps_latest_projected_market_year() -> None:
    rows = [
        {**_row("2010-04-09", "1900", "2009/10"), "ProjEstFlag": "Est."},
        _row("2010-04-09", "1800", "2010/11"),
        {**_row("2010-04-09", "9999", "2011/12"), "Region": "World"},
    ]

    observations, rows_scanned = desk._select_backfill_observations(
        rows,
        source_url="https://www.usda.gov/archive.zip",
        since=date(2010, 4, 9),
        through=date(2010, 4, 9),
    )

    assert rows_scanned == 3
    assert len(observations) == 1
    assert observations[0]["value"] == 1800.0
    assert observations[0]["market_year"] == "2010/11"


def test_wasde_backfill_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    AgricultureWasdeObservation.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    source = desk.WasdeArchiveSource(
        url="https://www.usda.gov/archive.zip",
        start=date(2010, 4, 1),
        end=date(2010, 4, 30),
        kind="bulk_zip",
    )
    observation = {
        "commodity": "Corn",
        "metric_id": "ending_stocks",
        "source_attribute": "Ending Stocks",
        "release_date": date(2010, 4, 9),
        "value": 1900.0,
        "unit": "Million Bushels",
        "market_year": "2010/11",
        "projection_status": "Proj.",
        "source_url": source.url,
    }
    monkeypatch.setattr(desk, "_wasde_archive_sources", lambda since, through: [source])
    monkeypatch.setattr(
        desk,
        "_download_backfill_source",
        lambda archive, since, through, source_dir: {
            "source": archive,
            "missing": False,
            "loaded_from_local": False,
            "rows_scanned": 10,
            "observations": [observation],
        },
    )

    db = session_local()
    try:
        first = desk.backfill_wasde_history(
            db,
            since=date(2010, 4, 9),
            through=date(2010, 4, 9),
        )
        second = desk.backfill_wasde_history(
            db,
            since=date(2010, 4, 9),
            through=date(2010, 4, 9),
        )
        stored = db.query(AgricultureWasdeObservation).all()
    finally:
        db.close()
        engine.dispose()

    assert first["inserted"] == 1
    assert second["inserted"] == 0
    assert second["unchanged"] == 1
    assert len(stored) == 1


def test_archive_manifest_preserves_official_filename_exceptions() -> None:
    sources = desk._wasde_archive_sources(date(2025, 10, 1), date(2026, 6, 30))
    urls = {source.url for source in sources}

    assert not any("2025-10" in url for url in urls)
    assert any("2026-05-V2.csv" in url for url in urls)
    assert any("2026-06-V2.csv" in url for url in urls)


def test_staged_official_archive_bypasses_blocked_network(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = desk.WasdeArchiveSource(
        url="https://www.usda.gov/sites/default/files/documents/archive.zip",
        start=date(2010, 4, 1),
        end=date(2010, 4, 30),
        kind="bulk_zip",
    )
    csv_text = "\n".join([
        "ReleaseDate,ReportDate,ReportTitle,Attribute,Commodity,Region,MarketYear,ProjEstFlag,Value,Unit",
        "2010-04-09,2010-04-09,U.S. Corn,Ending Stocks,Corn,United States,2010/11,Proj.,1900,Million Bushels",
    ])
    with zipfile.ZipFile(tmp_path / "archive.zip", "w") as archive:
        archive.writestr("archive.csv", csv_text)
    monkeypatch.setattr(
        desk.requests,
        "get",
        lambda *args, **kwargs: pytest.fail("a staged source must not hit the network"),
    )

    result = desk._download_backfill_source(
        source,
        since=date(2010, 4, 9),
        through=date(2010, 4, 9),
        source_dir=tmp_path,
    )

    assert result["loaded_from_local"] is True
    assert result["observations"][0]["value"] == 1900.0


def test_long_history_reads_persisted_observations(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    AgricultureWasdeObservation.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    try:
        db.add(
            AgricultureWasdeObservation(
                commodity="Corn",
                metric_id="ending_stocks",
                source_attribute="Ending Stocks",
                release_date=date(2010, 4, 9),
                value=1900.0,
                unit="Million Bushels",
                market_year="2010/11",
                projection_status="Proj.",
                source_url="https://www.usda.gov/archive.zip",
            )
        )
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(desk, "SessionLocal", session_local)
    monkeypatch.setattr(desk, "_download_wasde_months", lambda months: [])

    rows = desk._load_wasde_history(20, date(2026, 8, 13))
    engine.dispose()

    assert len(rows) == 1
    assert rows[0]["ReleaseDate"] == "2010-04-09"
    assert rows[0]["Value"] == "1900.0"


def test_all_history_window_reaches_the_structured_archive_boundary(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [_row("2010-04-09", "1900", "2010/11"), _row("2026-08-12", "2117", "2026/27")]
    monkeypatch.setattr(desk, "_load_wasde_history", lambda years, reference: rows)
    monkeypatch.setattr(desk, "_price_history", lambda ticker, start, end: ([], []))

    payload = desk.build_report_desk("ZC", years=20, selected_metric="ending_stocks")

    assert payload["years"] == 20
    assert payload["history_coverage"]["structured_start_date"] == "2010-04-09"
    assert payload["history_coverage"]["observed_start_date"] == "2010-04-09"
    assert payload["history_coverage"]["complete"] is True
