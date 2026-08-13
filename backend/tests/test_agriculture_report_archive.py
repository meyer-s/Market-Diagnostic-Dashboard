from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.agriculture_report_release import AgricultureReportRelease
from app.services import agriculture_report_archive as archive
from app.services import agriculture_report_desk as desk


def _release(
    report_id: str = "crop_progress",
    scope_key: str = "ALL",
    released: date = date(2026, 8, 10),
    value: int | None = None,
) -> dict:
    return {
        "report_id": report_id,
        "scope_key": scope_key,
        "release_date": released,
        "title": "Official release",
        "source_url": "https://example.com/release",
        "documents": [{"label": "TXT", "format": "txt", "url": "https://example.com/release.txt"}],
        "metrics": [] if value is None else [{"id": "volume", "label": "Volume", "value": value, "unit": "Metric Tons"}],
    }


def test_nass_page_parser_preserves_each_official_document() -> None:
    content = b"""
    <table><tbody><tr>
      <td>Aug 10 2026</td>
      <td>
        <a href="/sites/default/release-files/123/prog3326.pdf">PDF</a>
        <a href="/sites/default/release-files/123/prog3326.txt">TXT</a>
        <a href="/sites/default/release-files/123/prog3326.zip">ZIP</a>
      </td>
      <td><a href="/publication/crop-progress/2026-08-10">View</a></td>
    </tr></tbody></table>
    """

    releases = archive._parse_nass_page("crop_progress", "Crop Progress", "crop-progress", content)

    assert len(releases) == 1
    assert releases[0]["release_date"] == date(2026, 8, 10)
    assert [document["format"] for document in releases[0]["documents"]] == ["pdf", "txt", "zip"]
    assert releases[0]["source_url"].endswith("/publication/crop-progress/2026-08-10")


def test_report_release_backfill_is_idempotent() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    AgricultureReportRelease.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    try:
        first = archive.persist_report_releases(db, [_release()])
        second = archive.persist_report_releases(db, [_release()])
        stored = db.query(AgricultureReportRelease).all()
    finally:
        db.close()
        engine.dispose()

    assert first["inserted"] == 1
    assert second["inserted"] == 0
    assert second["unchanged"] == 1
    assert len(stored) == 1


def test_report_viewer_prefers_selected_commodity_and_falls_back_to_universal(monkeypatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    AgricultureReportRelease.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    try:
        db.add_all([
            AgricultureReportRelease(**_release()),
            AgricultureReportRelease(**_release("export_inspections", "ALL", value=900)),
            AgricultureReportRelease(**_release("export_inspections", "ZC", value=400)),
        ])
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(desk, "SessionLocal", session_local)

    corn = desk._load_report_histories("ZC", 3, date(2026, 8, 13))
    rice = desk._load_report_histories("ZR", 3, date(2026, 8, 13))
    engine.dispose()

    assert corn["crop_progress"]["release_count"] == 1
    assert corn["export_inspections"]["scope_key"] == "ZC"
    assert corn["export_inspections"]["releases"][0]["metrics"][0]["value"] == 400
    assert rice["export_inspections"]["scope_key"] == "ALL"
    assert rice["export_inspections"]["scope_label"] == "All covered grains"


def test_nass_metrics_enrich_full_universal_archive_without_shortening_it(monkeypatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    AgricultureReportRelease.__table__.create(bind=engine)
    session_local = sessionmaker(bind=engine)
    db = session_local()
    try:
        db.add_all([
            AgricultureReportRelease(**_release("crop_production", "ALL", date(2026, 7, 10))),
            AgricultureReportRelease(**_release("crop_production", "ALL", date(2026, 8, 12))),
            AgricultureReportRelease(**{
                **_release("crop_production", "ZC", date(2026, 8, 12)),
                "metrics": [
                    {"id": "production", "label": "Production", "value": 16000, "unit": "Million bushels"},
                    {"id": "production_yoy_pct", "label": "Production vs year ago", "value": -6, "unit": "Percent"},
                ],
            }),
        ])
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(desk, "SessionLocal", session_local)

    history = desk._load_report_histories("ZC", 3, date(2026, 8, 13))["crop_production"]
    engine.dispose()

    assert history["release_count"] == 2
    assert history["scope_key"] == "ZC"
    assert history["releases"][0]["metrics"][0]["id"] == "production"
    assert history["releases"][1]["metrics"] == []
    assert history["analysis"]["chart_kind"] == "production_trend"
    assert "6.0% below" in history["analysis"]["body"]
