from datetime import datetime
from io import BytesIO

import pandas as pd

from app.services.ingestion.aas_data_ingestion import MacroDataIngestion
from app.services.ingestion.precious_metals_ingester import PreciousMetalsIngester


def test_wgc_snapshot_parser_keeps_real_quarterly_observations() -> None:
    payload = {
        "chartData": {
            "table": {
                "QTD_FULL": {
                    "2026-06-30": {
                        "headers": [[
                            {"filterId": "countryNameDefault"},
                            {"filterId": "gold_reserves_tns"},
                            {"filterId": "holdings_pct"},
                        ]],
                        "rows": [[
                            {"val": "Poland", "rowId": "POL"},
                            {"val": "515.30", "rowId": "POL"},
                            {"val": "24.10", "rowId": "POL"},
                        ]],
                    },
                    "2026-03-31": {
                        "headers": [[
                            {"filterId": "countryNameDefault"},
                            {"filterId": "gold_reserves_tns"},
                            {"filterId": "holdings_pct"},
                        ]],
                        "rows": [[
                            {"val": "Poland", "rowId": "POL"},
                            {"val": "500.00", "rowId": "POL"},
                            {"val": "23.50", "rowId": "POL"},
                        ]],
                    },
                }
            }
        }
    }

    rows = PreciousMetalsIngester._parse_wgc_cb_snapshots(payload)

    assert rows == [
        {
            "country": "Poland",
            "country_iso": "POL",
            "date": datetime(2026, 6, 30),
            "gold_tonnes": 515.3,
            "pct_of_reserves": 24.1,
        },
        {
            "country": "Poland",
            "country_iso": "POL",
            "date": datetime(2026, 3, 31),
            "gold_tonnes": 500.0,
            "pct_of_reserves": 23.5,
        },
    ]


def test_spdr_archive_parser_returns_sorted_official_ounce_history() -> None:
    content = BytesIO()
    frame = pd.DataFrame({
        "Date": ["08-Oct-2026", "07-Oct-2026"],
        "Total Ounces of Gold in the Trust": ["33,932,506.41", "33,900,000.00"],
    })
    with pd.ExcelWriter(content, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="US GLD Historical Archive", index=False)

    rows = PreciousMetalsIngester._parse_spdr_gld_history(content.getvalue())

    assert rows[0]["date"] == datetime(2026, 10, 7)
    assert rows[-1]["holdings"] == 33_932_506.41


def test_cme_requests_use_document_headers() -> None:
    headers = PreciousMetalsIngester().session.headers

    assert headers["Sec-Fetch-Dest"] == "document"
    assert "application/vnd.ms-excel" in headers["Accept"]
    assert headers["Referer"].startswith("https://www.cmegroup.com/")


def test_m2_components_are_normalized_to_usd_trillions() -> None:
    convert = MacroDataIngestion._convert_m2_to_usd_trillions

    assert convert("us_m2", 21_000) == 21
    assert convert("eurozone_m2", 15_000_000_000_000) == 16.5
    assert round(convert("japan_m2", 1_400_000_000_000_000) or 0, 2) == 10
    assert convert("japan_m2", 1_400_000_000_000_000_000) is None
