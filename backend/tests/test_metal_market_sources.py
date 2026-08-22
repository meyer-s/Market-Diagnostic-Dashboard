from datetime import date

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

