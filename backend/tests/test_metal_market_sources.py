from datetime import date, datetime

import pytest

from app.services import metal_market_sources as sources


def test_parses_shfe_daily_express_and_selects_most_active_contract() -> None:
    observations = sources._parse_shfe_payload(
        {
            "o_curinstrument": [
                {"PRODUCTID": "au_f", "DELIVERYMONTH": "2610", "SETTLEMENTPRICE": "980.5", "VOLUME": "900", "OPENINTEREST": "500"},
                {"PRODUCTID": "au_f", "DELIVERYMONTH": "2612", "SETTLEMENTPRICE": "990.5", "VOLUME": "100", "OPENINTEREST": "200"},
                {"PRODUCTID": "au_f", "DELIVERYMONTH": "小计", "SETTLEMENTPRICE": "999", "VOLUME": "9999"},
            ]
        },
        date(2026, 8, 21),
    )

    assert len(observations) == 1
    assert observations[0]["registry_id"] == "shfe_gold"
    assert observations[0]["contract_month"] == "Oct 2026"
    assert observations[0]["local_price"] == 980.5


def test_shfe_history_reuses_all_supported_metals_and_reports_bounded_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 8, 24, tzinfo=tz)

    def fake_day(quote_date: date) -> list[dict]:
        return [
            {"_metal": "CU", "registry_id": "shfe_copper", "quote_timestamp": f"{quote_date.isoformat()}T00:00:00+00:00"},
            {"_metal": "AL", "registry_id": "shfe_aluminum", "quote_timestamp": f"{quote_date.isoformat()}T00:00:00+00:00"},
        ]

    monkeypatch.setattr(sources, "datetime", FixedDatetime)
    monkeypatch.setattr(sources, "SHFE_HISTORY_DAYS", 4)
    monkeypatch.setattr(sources, "_fetch_shfe_history_day", fake_day)

    snapshot = sources._fetch_shfe_history_snapshot("CU")

    assert len(snapshot["observations"]) == 6
    assert {row["registry_id"] for row in snapshot["observations"]} == {"shfe_copper", "shfe_aluminum"}
    assert snapshot["source_tier"] == "official_primary"
    assert "Latest 4 calendar days" in snapshot["history_scope"]


def test_parses_sge_daily_table_products_and_units() -> None:
    document = """
    <table>
      <thead><tr><th>日期</th><th>合约</th><th>收盘价</th><th>成交量（kg）</th><th>市场持仓（手）</th></tr></thead>
      <tbody>
        <tr><td>2026-08-21</td><td>Au99.99</td><td>983.56</td><td>5466.9</td><td>-</td></tr>
        <tr><td>2026-08-21</td><td>Ag(T+D)</td><td>16730</td><td>101.2</td><td>52</td></tr>
      </tbody>
    </table>
    """

    observations = sources._parse_sge_html(document)

    assert [row["registry_id"] for row in observations] == ["sge_au9999", "sge_ag_td"]
    assert observations[0]["native_unit"] == "gram"
    assert observations[1]["native_unit"] == "kg"


def test_sge_history_requests_only_the_selected_metals_products(monkeypatch: pytest.MonkeyPatch) -> None:
    requested_products = []

    def fake_page(_start: date, _end: date, product: str, page: int) -> str:
        requested_products.append((product, page))
        return f"""
        <script>var totalPage=1;</script>
        <table>
          <tr><th>日期</th><th>合约</th><th>收盘价</th><th>成交量（kg）</th><th>市场持仓（手）</th></tr>
          <tr><td>2026-08-21</td><td>{product}</td><td>9000</td><td>10</td><td>5</td></tr>
        </table>
        """

    monkeypatch.setattr(sources, "_fetch_sge_history_page", fake_page)

    snapshot = sources._fetch_sge_history_snapshot("AG")

    assert set(requested_products) == {("Ag99.99", 1), ("Ag(T+D)", 1)}
    assert {row["registry_id"] for row in snapshot["observations"]} == {"sge_ag9999", "sge_ag_td"}


def test_parses_mcx_bhavcopy_and_selects_highest_volume_expiry() -> None:
    observations = sources._parse_mcx_rows([
        {"Symbol": "SILVER", "InstrumentName": "FUTCOM", "Date": "08/21/2026", "ExpiryDate": "04Sep2026", "Close": "246000", "Volume": "120", "OpenInterest": "90"},
        {"Symbol": "SILVER", "InstrumentName": "FUTCOM", "Date": "08/21/2026", "ExpiryDate": "04Dec2026", "Close": "247000", "Volume": "12", "OpenInterest": "30"},
    ])

    assert len(observations) == 1
    assert observations[0]["registry_id"] == "mcx_silver"
    assert observations[0]["contract_month"] == "Sep 2026"
    assert observations[0]["native_unit"] == "kg"


def test_parses_jpx_settlement_csv_including_palladium() -> None:
    payload = (
        "Issue Code,Issue Name,Reserved,Contract Month,Reserved,Settlement Price,"
        "Reserved,Reserved,Reserved,Reserved,Reserved,Reserved\r\n"
        "1,FUT_GLD_STANDARD,0,202610,0,22100,0,0,0,0,0,0\r\n"
        "2,FUT_PALD_STANDARD,0,202610,0,8100,0,0,0,0,0,0\r\n"
    ).encode("cp932")

    observations = sources._parse_jpx_csv(payload, date(2026, 8, 21))

    assert [row["registry_id"] for row in observations] == ["ose_gold", "ose_palladium"]
    assert all(row["native_unit"] == "gram" for row in observations)


def test_parses_lme_cash_offer_not_bid() -> None:
    observations = sources._parse_lme_payload("CU", {
        "DateOfData": "2026-08-21T00:00:00Z",
        "Rows": [{"RowTitle": "Cash", "Values": [14280, 14291], "Ric": "CMCU0", "HoverValue": "25Aug2026"}],
    })

    assert observations[0]["registry_id"] == "lme_copper"
    assert observations[0]["local_price"] == 14291
    assert observations[0]["market_type"] == "physical cash benchmark"


def test_parses_secondary_lme_cash_settlement_fallback() -> None:
    document = """
    <table>
      <tr><th>date</th><th>LME Copper Cash-Settlement</th><th>LME Copper 3-month</th></tr>
      <tr><td>21. August 2026</td><td>14,291.00</td><td>14,235.00</td></tr>
    </table>
    """

    observations = sources._parse_westmetall_lme_html("CU", document)

    assert observations[0]["registry_id"] == "lme_copper"
    assert observations[0]["local_price"] == 14291
    assert observations[0]["quote_timestamp"].startswith("2026-08-21")
    assert observations[0]["source_name"].startswith("Westmetall")


def test_parses_full_secondary_lme_history_oldest_first() -> None:
    document = """
    <table>
      <tr><th>date</th><th>LME Copper Cash-Settlement</th></tr>
      <tr><td>21. August 2026</td><td>14,291.00</td></tr>
      <tr><td>20. August 2026</td><td>14,100.00</td></tr>
    </table>
    """

    observations = sources._parse_westmetall_lme_history("CU", document)

    assert [row["local_price"] for row in observations] == [14100, 14291]
    assert observations[0]["quote_timestamp"].startswith("2026-08-20")


def test_parses_full_lbma_history_oldest_first() -> None:
    observations = sources._parse_lbma_history("AG", [
        {"d": "2026-08-20", "v": [37.5, 0]},
        {"d": "2026-08-21", "v": [38.25, 0]},
    ])

    assert len(observations) == 2
    assert observations[0]["registry_id"] == "lbma_silver"
    assert observations[-1]["local_price"] == 38.25


def test_lme_uses_labeled_secondary_fallback_when_primary_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BlockedResponse:
        def raise_for_status(self) -> None:
            raise RuntimeError("primary blocked")

    class BlockedSession:
        def get(self, *_args, **_kwargs) -> BlockedResponse:
            return BlockedResponse()

    class FallbackResponse:
        text = """
        <table>
          <tr><th>date</th><th>LME Aluminium Cash-Settlement</th></tr>
          <tr><td>21. August 2026</td><td>3,227.00</td></tr>
        </table>
        """

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr(sources, "_browser_session", lambda: BlockedSession())
    monkeypatch.setattr(sources.requests, "get", lambda *_args, **_kwargs: FallbackResponse())

    snapshot = sources._fetch_lme("AL")

    assert snapshot["source_tier"] == "secondary_fallback"
    assert snapshot["upstream_error"] == "primary blocked"
    assert snapshot["observations"][0]["local_price"] == 3227


def test_uses_ecb_eur_cross_for_quote_date_fx() -> None:
    series = sources._parse_ecb_fx_csv(
        "CURRENCY,TIME_PERIOD,OBS_VALUE\n"
        "USD,2026-08-21,1.2\n"
        "CNY,2026-08-21,8.4\n"
    )
    observation = {
        "currency": "CNY",
        "quote_timestamp": "2026-08-21T00:00:00+00:00",
        "fx_rate_local_per_usd": None,
    }

    sources._attach_fx([observation], {"fx_series": series})

    assert observation["fx_rate_local_per_usd"] == pytest.approx(7.0)
    assert observation["fx_source"] == "ECB daily reference rates via EUR cross"


def test_provider_failure_uses_bounded_stale_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    sources.clear_metal_source_cache()
    snapshot = {"observations": [{"_metal": "AG"}], "source_url": "https://example.test/data"}
    monkeypatch.setitem(sources.PROVIDER_LOADERS, "lbma", lambda _metal: snapshot)

    first_snapshot, first_status = sources._load_cached("lbma", "AG")
    assert first_snapshot == snapshot
    assert first_status["status"] == "live"

    sources._SOURCE_CACHE["lbma:AG"]["stored_monotonic"] -= sources.SOURCE_CACHE_TTL_SECONDS + 1

    def fail(_metal: str) -> dict:
        raise sources.SourceUnavailable("temporary provider outage")

    monkeypatch.setitem(sources.PROVIDER_LOADERS, "lbma", fail)
    stale_snapshot, stale_status = sources._load_cached("lbma", "AG")

    assert stale_snapshot == snapshot
    assert stale_status["status"] == "stale_cache"
    assert stale_status["error"] == "temporary provider outage"
