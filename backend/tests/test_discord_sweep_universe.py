from __future__ import annotations

import requests

from app.services import discord_sweep_universe as universe


class _Response:
    def __init__(self, text: str = "", json_payload: dict | None = None, status_code: int = 200) -> None:
        self.text = text
        self._json_payload = json_payload or {}
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error")

    def json(self) -> dict:
        return self._json_payload


def test_ishares_csv_parser_rejects_html_shell(monkeypatch) -> None:
    def fake_get(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return _Response("<!DOCTYPE html>\nTicker,Name\nAAPL,Apple Inc")

    monkeypatch.setattr(universe.requests, "get", fake_get)

    assert universe._fetch_ishares_tickers("https://example.test/holdings.csv") == []


def test_product_data_extraction_filters_non_listed_holdings() -> None:
    payload = {
        "componentsByNameMap": {
            "holdings": {
                "containersByNameMap": {
                    "all": {
                        "dataPointsByNameMap": {
                            "ticker": {
                                "value": ["AAA", "BBB", "CAD", "RTYU6", "OTCQ", "UNL", "BRK.B", None]
                            },
                            "assetClass": {
                                "value": [
                                    "Equity",
                                    "Equity",
                                    "Cash",
                                    "Futures",
                                    "Equity",
                                    "Equity",
                                    "Equity",
                                    "Equity",
                                ]
                            },
                            "exchange": {
                                "value": [
                                    "NASDAQ",
                                    "Nyse Mkt Llc",
                                    None,
                                    "Chicago Mercantile Exchange",
                                    "Non-Nms Quotation Service (Nnqs)",
                                    "NO MARKET (E.G. UNLISTED)",
                                    "NYSE",
                                    "NYSE",
                                ]
                            },
                        }
                    }
                }
            }
        }
    }

    assert universe._extract_ishares_product_data_tickers(payload) == ["AAA", "BBB", "BRK-B"]


def test_russell2000_builder_uses_product_data_before_fallbacks(monkeypatch) -> None:
    product_symbols = [f"R{i:04d}" for i in range(1300)]

    monkeypatch.setattr(universe, "_symbols_from_preset", lambda _preset_id: [])
    monkeypatch.setattr(universe, "_fetch_ishares_product_data_tickers", lambda _product_id: product_symbols)

    def fail_if_called(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("fallback should not be called when product-data coverage is sufficient")

    monkeypatch.setattr(universe, "_fetch_ishares_tickers", fail_if_called)
    monkeypatch.setattr(universe, "_fetch_wikipedia_constituent_symbols", fail_if_called)
    monkeypatch.setattr(universe, "_fetch_finviz_sorted_symbols", fail_if_called)

    tickers, notes = universe._build_russell2000()

    assert tickers == product_symbols
    assert notes == ["Loaded from iShares IWM product-data holdings."]
