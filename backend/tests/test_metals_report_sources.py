from datetime import date
from types import SimpleNamespace

import pytest

from app.services.ingestion import metals_report_sources as reports


# Minimal table/header extracts from the USGS 2026 commodity chapters. The
# parenthetical/square-bracket unit markers differ between these real sources.
PGM = """PLATINUM-GROUP METALS
[Data in kilograms, platinum-group-metal (PGM) content, unless otherwise specified]
U.S. Geological Survey, Mineral Commodity Summaries, February 2026
World Mine Production and Reserves:
Mine production PGM reserves9
Palladium Platinum
2024 2025e 2024 2025e
World total (rounded) 217,000 190,000 179,000 170,000 >76,000,000
World Resources: Some omitted narrative.
"""
SILVER = """SILVER
(Data in metric tons,1 silver content, unless otherwise specified)
U.S. Geological Survey, Mineral Commodity Summaries, February 2026
World Mine Production and Reserves:
Mine production Reserves9
2024 2025e
World total (rounded) 25,300 26,000 610,000
World Resources: Some omitted narrative.
"""


def test_platinum_and_palladium_world_production_is_converted_from_kilograms():
    rows = reports.parse_usgs_mine_supply(PGM, 2026, "platinum-group", "https://pubs.usgs.gov/pgm.pdf")
    values = {(row["metal"], row["period"]): row for row in rows}
    assert values["PD", "2024"]["production_tonnes"] == 217
    assert values["PD", "2025"]["production_tonnes"] == 190
    assert values["PT", "2024"]["production_tonnes"] == 179
    assert values["PT", "2025"]["production_tonnes"] == 170
    assert values["PT", "2025"]["production_yoy_pct"] == pytest.approx(-5.02793296)
    for row in rows:
        assert row["aisc_per_oz"] is row["recycling_tonnes"] is row["recycling_pct"] is None
        assert "USGS_MCS_ANNUAL_ESTIMATE|" in row["source"]


def test_silver_already_uses_metric_tonnes_and_is_not_quarterly_demand():
    rows = reports.parse_usgs_mine_supply(SILVER, 2026, "silver", "https://pubs.usgs.gov/silver.pdf")
    assert [row["production_tonnes"] for row in rows] == [25300, 26000]
    assert rows[-1]["production_yoy_pct"] == pytest.approx(2.76679842)
    assert rows[-1]["period"] == "2025"
    assert "total_tonnes" not in rows[-1]


@pytest.mark.parametrize("altered", [
    PGM.replace("Palladium Platinum", "Platinum Palladium"),
    PGM.replace("2025e", "2026f"),
    PGM.replace("[Data in kilograms", "[Data in ounces"),
    PGM.replace("World total (rounded)", "Domestic total"),
    PGM.replace("170,000", "0"),
])
def test_schema_changes_and_forecast_columns_do_not_silently_import(altered):
    with pytest.raises(ValueError):
        reports.parse_usgs_mine_supply(altered, 2026, "platinum-group", "https://pubs.usgs.gov/pgm.pdf")


def test_missing_new_edition_falls_back_without_inventing_a_current_year(monkeypatch):
    requested = []
    class Session:
        def get(self, url, timeout):
            requested.append(url)
            assert timeout == (5, 20)
            if "mcs2027" in url:
                return SimpleNamespace(status_code=404)
            return SimpleNamespace(status_code=200, content=b"%PDF-silver" if "silver" in url else b"%PDF-pgm", raise_for_status=lambda: None)
    monkeypatch.setattr(reports, "PdfReader", lambda stream: SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: SILVER if b"silver" in stream.getvalue() else PGM)]))
    data = reports.fetch_usgs_mine_supply(Session(), today=date(2027, 1, 3))
    assert len(data["supply"]) == 6
    assert data["demand"] == []
    assert data["errors"] == []
    assert len(requested) == 4
    assert max(row["period"] for row in data["supply"]) == "2025"


def test_non_pdf_response_preserves_missingness_and_reports_no_rows():
    class Session:
        def get(self, url, timeout):
            return SimpleNamespace(status_code=200, content=b"<html>unavailable</html>", raise_for_status=lambda: None)
    data = reports.fetch_usgs_mine_supply(Session(), today=date(2026, 11, 20))
    assert data["supply"] == data["demand"] == []
    assert len(data["errors"]) == 2
