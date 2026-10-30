from __future__ import annotations

import pytest
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


def _short_interest_html(rows: list[tuple[str, str]]) -> str:
    body = "".join(f"<tr><td>{symbol}</td><td>{short_float}</td></tr>" for symbol, short_float in rows)
    return "<table><tr><th>Symbol</th><th>Short % Float</th></tr>" + body + "</table>"


def test_short_interest_keeps_finviz_primary_and_reports_partial_coverage(monkeypatch) -> None:
    monkeypatch.setattr(universe, "_fetch_finviz_sorted_symbols", lambda **_: ["AAA", "BBB"])

    def unexpected_fallback(**_kwargs):
        raise AssertionError("Finviz results should retain their own ranking")

    monkeypatch.setattr(universe, "_fetch_stockanalysis_short_interest_symbols", unexpected_fallback)
    symbols, notes = universe._build_top_short_interest_100()

    assert symbols == ["AAA", "BBB"]
    assert "Finviz" in notes[0]
    assert "2 of 100" in notes[1]


def test_short_interest_falls_back_after_real_finviz_http_failure(monkeypatch) -> None:
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if url == universe.FINVIZ_SCREENER_URL:
            assert kwargs["params"]["o"] == "-shortinterestshare"
            assert kwargs["params"]["f"] == "sh_opt_option"
            return _Response(status_code=403)
        assert url == universe.CBOE_OPTION_DIRECTORY_URL
        return _Response("Company Name, Stock Symbol\nAlpha,AAA\nBeta,BBB\n")

    monkeypatch.setattr(universe.requests, "get", fake_get)
    monkeypatch.setattr(
        universe.browser_requests, "get",
        lambda *_args, **_kwargs: _Response(_short_interest_html([("AAA", "45%"), ("BBB", "30%"), ("CCC", "60%")]))
    )

    symbols, notes = universe._build_top_short_interest_100()

    assert symbols == ["AAA", "BBB"]
    assert calls == [universe.FINVIZ_SCREENER_URL, universe.CBOE_OPTION_DIRECTORY_URL]
    assert "Finviz screener unavailable" in notes[0]
    assert "Stock Analysis" in notes[1]
    assert "Reduced coverage" in notes[1]  # Discord displays only the first two notes on completion.
    assert universe.STOCKANALYSIS_SHORT_INTEREST_URL in notes[1]
    assert "not a complete top-100" in notes[2]
    assert universe.CBOE_OPTION_DIRECTORY_URL in notes[2]
    assert not any("Loaded from Finviz" in note for note in notes)


def test_short_interest_fallback_validates_ranking_optionability_and_limit(monkeypatch) -> None:
    rows = [
        ("LOW", "9%"), ("NOOPT", "95%"), ("HIGH", "110%"), ("BRK.B", "30%"),
        ("HIGH", "110%"), ("MISSING", "-"), ("ZERO", "0%"), ("BAD", "inf%"), ("NEG", "-5%"),
    ]
    monkeypatch.setattr(universe.browser_requests, "get", lambda *_args, **_kwargs: _Response(_short_interest_html(rows)))
    monkeypatch.setattr(
        universe.requests, "get",
        lambda *_args, **_kwargs: _Response("Company Name, Stock Symbol\nLow,LOW\nHigh,HIGH\nBerkshire,BRK.B\nMissing,MISSING\nBad,BAD\n"),
    )

    symbols, _ = universe._fetch_stockanalysis_short_interest_symbols(limit=2)

    assert symbols == ["HIGH", "BRK-B"]


@pytest.mark.parametrize("html", [
    "<html>Just a moment...</html>",
    "<table><tr><th>Symbol</th></tr><tr><td>AAA</td></tr></table>",
    _short_interest_html([("AAA", "-")]),
])
def test_short_interest_fallback_rejects_unverified_ranking(monkeypatch, html) -> None:
    monkeypatch.setattr(universe.browser_requests, "get", lambda *_args, **_kwargs: _Response(html))

    def unexpected_directory(*_args, **_kwargs):
        raise AssertionError("No directory request needed when ranking is invalid")

    monkeypatch.setattr(universe.requests, "get", unexpected_directory)
    symbols, notes = universe._fetch_stockanalysis_short_interest_symbols(limit=100)

    assert symbols == []
    assert "no verified ranking" in notes[0]


@pytest.mark.parametrize("directory", [
    _Response(status_code=503),
    _Response("<html>Unavailable</html>"),
    _Response("Company Name, Stock Symbol\nAlpha,\n"),
])
def test_short_interest_fallback_withheld_without_optionability(monkeypatch, directory) -> None:
    monkeypatch.setattr(
        universe.browser_requests, "get",
        lambda *_args, **_kwargs: _Response(_short_interest_html([("AAA", "45%")]))
    )
    monkeypatch.setattr(universe.requests, "get", lambda *_args, **_kwargs: directory)

    symbols, notes = universe._fetch_stockanalysis_short_interest_symbols(limit=100)

    assert symbols == []
    assert "Unable to verify optionability" in notes[0]


def test_short_interest_fallback_network_failure_is_not_cached(monkeypatch) -> None:
    monkeypatch.setattr(universe, "_fetch_finviz_sorted_symbols", lambda **_: [])

    def unavailable(*_args, **_kwargs):
        raise requests.Timeout("upstream timeout")

    monkeypatch.setattr(universe.browser_requests, "get", unavailable)
    monkeypatch.setattr(universe, "_CACHE", {})
    result = universe.resolve_sweep_universe("TOP_SHORT_INTEREST_100")

    assert result.tickers == []
    assert "TOP_SHORT_INTEREST_100" not in universe._CACHE
    assert not any("Loaded" in note for note in result.notes)
