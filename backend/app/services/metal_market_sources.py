"""Official daily source adapters for international metal-market evidence.

The adapters intentionally fetch published daily observations, not synthetic
proxies.  Each source is isolated behind a bounded cache so a slow or failed
venue cannot take down the dispersion endpoint.  Cached observations retain
their original quote timestamps and therefore still age normally downstream.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import date, datetime, timedelta, timezone
import io
import json
import logging
import re
from threading import RLock
import time
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urljoin

from curl_cffi import requests as browser_requests
from lxml import html as lxml_html
import requests


logger = logging.getLogger(__name__)

SOURCE_CACHE_TTL_SECONDS = 15 * 60
SOURCE_CACHE_MAX_STALE_SECONDS = 7 * 24 * 60 * 60
SOURCE_TIMEOUT_SECONDS = 20

_CACHE_LOCK = RLock()
_SOURCE_CACHE: dict[str, dict[str, Any]] = {}

PROVIDER_NAMES = {
    "shfe": "Shanghai Futures Exchange",
    "sge": "Shanghai Gold Exchange",
    "lbma": "London Bullion Market Association",
    "mcx": "Multi Commodity Exchange of India",
    "ose": "Japan Exchange Group / Osaka Exchange",
    "lme": "London Metal Exchange",
    "ecb_fx": "European Central Bank FX reference rates",
}

METAL_PROVIDERS = {
    "AU": ("shfe", "sge", "lbma", "mcx", "ose"),
    "AG": ("shfe", "sge", "lbma", "mcx", "ose"),
    "PT": ("sge", "lbma", "ose"),
    "PD": ("sge", "lbma", "ose"),
    "CU": ("shfe", "mcx", "lme"),
    "AL": ("shfe", "mcx", "lme"),
}

SHFE_PRODUCTS = {
    "au_f": ("AU", "shfe_gold", "gram", "AU"),
    "ag_f": ("AG", "shfe_silver", "kg", "AG"),
    "cu_f": ("CU", "shfe_copper", "metric tonne", "CU"),
    "al_f": ("AL", "shfe_aluminum", "metric tonne", "AL"),
}

SGE_PRODUCTS = {
    "Au99.99": ("AU", "sge_au9999", "gram"),
    "Ag99.99": ("AG", "sge_ag9999", "kg"),
    "Ag(T+D)": ("AG", "sge_ag_td", "kg"),
    "Pt99.95": ("PT", "sge_pt9995", "gram"),
    "Pd99.95": ("PD", "sge_pd9995", "gram"),
}

LBMA_PRODUCTS = {
    "AU": ("lbma_gold", "gold_pm", "LBMA Gold Price PM"),
    "AG": ("lbma_silver", "silver", "LBMA Silver Price"),
    "PT": ("lbma_platinum", "platinum_pm", "LBMA Platinum Price PM"),
    "PD": ("lbma_palladium", "palladium_pm", "LBMA Palladium Price PM"),
}

MCX_PRODUCTS = {
    "GOLD": ("AU", "mcx_gold", "10 gram"),
    "SILVER": ("AG", "mcx_silver", "kg"),
    "COPPER": ("CU", "mcx_copper", "kg"),
    "ALUMINIUM": ("AL", "mcx_aluminum", "kg"),
}

OSE_PRODUCTS = {
    "FUT_GLD_": ("AU", "ose_gold", "FUT_GLD"),
    "FUT_SILV_": ("AG", "ose_silver", "FUT_SILV"),
    "FUT_PLT_": ("PT", "ose_platinum", "FUT_PLT"),
    "FUT_PALD_": ("PD", "ose_palladium", "FUT_PALD"),
}

LME_PAGES = {
    "CU": ("lme_copper", "copper", "Copper", "LME_Cu_cash"),
    "AL": ("lme_aluminum", "aluminium", "Aluminium", "LME_Al_cash"),
}

ECB_FX_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.CNY+INR+JPY+USD.EUR.SP00.A"


class SourceUnavailable(RuntimeError):
    """Raised when a provider has no usable current response."""


def _browser_session() -> Any:
    return browser_requests.Session(impersonate="chrome")


def _float(value: Any) -> Optional[float]:
    if value in (None, "", "-", "--"):
        return None
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _trade_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%d %b %Y", "%d. %B %Y", "%Y%m%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _date_timestamp(value: date) -> str:
    return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc).isoformat()


def _month_label(year: int, month: int) -> str:
    return datetime(year, month, 1).strftime("%b %Y")


def _yymm_label(value: str) -> Optional[str]:
    digits = re.sub(r"\D", "", value)
    if len(digits) != 4:
        return None
    year = 2000 + int(digits[:2])
    month = int(digits[2:])
    if not 1 <= month <= 12:
        return None
    return _month_label(year, month)


def _expiry_label(value: str) -> Optional[str]:
    parsed = _trade_date(value)
    if parsed is None:
        try:
            parsed = datetime.strptime(value.strip(), "%d%b%Y").date()
        except ValueError:
            return None
    return _month_label(parsed.year, parsed.month)


def _base_observation(
    *,
    metal: str,
    registry_id: str,
    symbol: str,
    contract_month: Optional[str],
    local_price: float,
    currency: str,
    native_unit: str,
    quote_date: date,
    price_type: str,
    data_delay: str,
    volume: Optional[float] = None,
    open_interest: Optional[float] = None,
) -> dict[str, Any]:
    return {
        "_metal": metal,
        "registry_id": registry_id,
        "symbol": symbol,
        "contract_month": contract_month,
        "local_price": local_price,
        "currency": currency,
        "native_unit": native_unit,
        "fx_rate_local_per_usd": 1.0 if currency == "USD" else None,
        "fx_timestamp": _date_timestamp(quote_date) if currency == "USD" else None,
        "fx_source": "Identity conversion for USD quote" if currency == "USD" else None,
        "price_type": price_type,
        "quote_timestamp": _date_timestamp(quote_date),
        "timestamp_precision": "trading_date",
        "session_status": "closed",
        "data_delay": data_delay,
        "volume": volume,
        "open_interest": open_interest,
    }


def _parse_shfe_payload(payload: dict[str, Any], quote_date: date) -> list[dict[str, Any]]:
    candidates: dict[str, list[dict[str, Any]]] = {key: [] for key in SHFE_PRODUCTS}
    for row in payload.get("o_curinstrument") or []:
        product_id = str(row.get("PRODUCTID") or "").strip().lower()
        delivery_month = str(row.get("DELIVERYMONTH") or "").strip()
        if product_id not in candidates or _yymm_label(delivery_month) is None:
            continue
        if _float(row.get("SETTLEMENTPRICE")) is None:
            continue
        candidates[product_id].append(row)

    observations = []
    for product_id, rows in candidates.items():
        if not rows:
            continue
        row = max(rows, key=lambda item: _float(item.get("VOLUME")) or 0.0)
        metal, registry_id, native_unit, root_symbol = SHFE_PRODUCTS[product_id]
        delivery_month = str(row["DELIVERYMONTH"]).strip()
        observations.append(_base_observation(
            metal=metal,
            registry_id=registry_id,
            symbol=f"{root_symbol}{delivery_month}",
            contract_month=_yymm_label(delivery_month),
            local_price=float(row["SETTLEMENTPRICE"]),
            currency="CNY",
            native_unit=native_unit,
            quote_date=quote_date,
            price_type="official daily settlement",
            data_delay="Official SHFE Daily Express end-of-day settlement",
            volume=_float(row.get("VOLUME")),
            open_interest=_float(row.get("OPENINTEREST")),
        ))
    return observations


def _fetch_shfe(_metal: str) -> dict[str, Any]:
    session = _browser_session()
    config_url = "https://www.shfe.cn/data/config/currentTradingday.dat"
    config_response = session.get(config_url, timeout=SOURCE_TIMEOUT_SECONDS)
    config_response.raise_for_status()
    config = config_response.json()
    today = datetime.now(timezone.utc).date()
    configured_dates = [config.get("currentTradingday"), config.get("lastTradingday")]
    quote_date = next(
        (parsed for parsed in (_trade_date(value) for value in configured_dates) if parsed and parsed <= today),
        None,
    )
    if quote_date is None:
        raise SourceUnavailable("SHFE did not publish a usable trading date")
    data_url = f"https://www.shfe.cn/data/tradedata/future/dailydata/kx{quote_date:%Y%m%d}.dat"
    response = session.get(data_url, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    observations = _parse_shfe_payload(response.json(), quote_date)
    if not observations:
        raise SourceUnavailable("SHFE Daily Express contained no supported metal settlements")
    return {"observations": observations, "source_url": data_url}


def _table_rows(document: str) -> Iterable[dict[str, str]]:
    root = lxml_html.fromstring(document)
    for table in root.xpath("//table"):
        headers = [
            "".join(cell.itertext()).strip()
            for cell in table.xpath("(.//tr)[1]/*[self::th or self::td]")
        ]
        if "日期" not in headers or "合约" not in headers or "收盘价" not in headers:
            continue
        for tr in table.xpath("(.//tr)[position()>1]"):
            values = ["".join(cell.itertext()).strip() for cell in tr.xpath("./td")]
            if len(values) >= len(headers):
                yield dict(zip(headers, values))


def _parse_sge_html(document: str) -> list[dict[str, Any]]:
    observations = []
    for row in _table_rows(document):
        product = row.get("合约", "").strip()
        product_config = SGE_PRODUCTS.get(product)
        close = _float(row.get("收盘价"))
        quote_date = _trade_date(row.get("日期"))
        if not product_config or close is None or quote_date is None:
            continue
        metal, registry_id, native_unit = product_config
        observations.append(_base_observation(
            metal=metal,
            registry_id=registry_id,
            symbol=product,
            contract_month=None,
            local_price=close,
            currency="CNY",
            native_unit=native_unit,
            quote_date=quote_date,
            price_type="official daily close",
            data_delay="Official SGE daily quotation close",
            volume=_float(row.get("成交量（kg）")),
            open_interest=_float(row.get("市场持仓（手）")),
        ))
    return observations


def _fetch_sge(_metal: str) -> dict[str, Any]:
    index_url = "https://www.sge.com.cn/sjzx/mrhqsj"
    session = _browser_session()
    index_response = session.get(index_url, timeout=SOURCE_TIMEOUT_SECONDS)
    index_response.raise_for_status()
    root = lxml_html.fromstring(index_response.text)
    hrefs = root.xpath(
        '//a[contains(@href, "/sjzx/quotation_daily_new") '
        'and contains(@href, "start_date=")]/@href'
    )
    if not hrefs:
        raise SourceUnavailable("SGE daily quotation page did not publish a current table link")
    source_url = urljoin(index_url, hrefs[0])
    response = session.get(source_url, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    observations = _parse_sge_html(response.text)
    if not observations:
        raise SourceUnavailable("SGE daily quotation contained no supported products")
    return {"observations": observations, "source_url": source_url}


def _parse_lbma_payload(metal: str, payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
    registry_id, endpoint_name, product_name = LBMA_PRODUCTS[metal]
    for row in reversed(payload):
        quote_date = _trade_date(row.get("d"))
        values = row.get("v") or []
        usd_price = _float(values[0] if values else None)
        if quote_date and usd_price is not None:
            return [_base_observation(
                metal=metal,
                registry_id=registry_id,
                symbol=product_name,
                contract_month=None,
                local_price=usd_price,
                currency="USD",
                native_unit="troy oz",
                quote_date=quote_date,
                price_type="delayed official benchmark",
                data_delay="LBMA public benchmark JSON; published after the daily delay",
            )]
    raise SourceUnavailable(f"LBMA {endpoint_name} response had no usable USD benchmark")


def _fetch_lbma(metal: str) -> dict[str, Any]:
    _registry_id, endpoint_name, _product_name = LBMA_PRODUCTS[metal]
    source_url = f"https://prices.lbma.org.uk/json/{endpoint_name}.json"
    session = _browser_session()
    response = session.get(source_url, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    return {"observations": _parse_lbma_payload(metal, response.json()), "source_url": source_url}


def _parse_mcx_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in MCX_PRODUCTS}
    for row in rows:
        symbol = str(row.get("Symbol") or "").strip().upper()
        if symbol not in grouped or str(row.get("InstrumentName") or "").strip() != "FUTCOM":
            continue
        if _float(row.get("Close")) is None or _trade_date(row.get("Date")) is None:
            continue
        grouped[symbol].append(row)

    observations = []
    for symbol, product_rows in grouped.items():
        if not product_rows:
            continue
        traded = [row for row in product_rows if (_float(row.get("Volume")) or 0) > 0]
        row = max(traded or product_rows, key=lambda item: _float(item.get("Volume")) or 0.0)
        metal, registry_id, native_unit = MCX_PRODUCTS[symbol]
        expiry = str(row.get("ExpiryDate") or "").strip()
        quote_date = _trade_date(row["Date"])
        assert quote_date is not None
        observations.append(_base_observation(
            metal=metal,
            registry_id=registry_id,
            symbol=f"{symbol} {expiry}",
            contract_month=_expiry_label(expiry),
            local_price=float(row["Close"]),
            currency="INR",
            native_unit=native_unit,
            quote_date=quote_date,
            price_type="official bhavcopy close",
            data_delay="Official MCX end-of-day bhavcopy",
            volume=_float(row.get("Volume")),
            open_interest=_float(row.get("OpenInterest")),
        ))
    return observations


def _parse_mcx_html(document: str) -> list[dict[str, Any]]:
    root = lxml_html.fromstring(document)
    nodes = root.xpath('//*[@id="bhavcopy-data"]')
    if not nodes:
        raise SourceUnavailable("MCX bhavcopy page did not expose its official data payload")
    raw_payload = "".join(nodes[0].itertext()).strip()
    try:
        rows = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise SourceUnavailable("MCX bhavcopy payload was not valid JSON") from exc
    observations = _parse_mcx_rows(rows)
    if not observations:
        raise SourceUnavailable("MCX bhavcopy contained no supported futures closes")
    return observations


def _fetch_mcx(_metal: str) -> dict[str, Any]:
    source_url = "https://www.mcxindia.com/market-data/bhavcopy?slinkpage=y"
    session = _browser_session()
    response = session.get(source_url, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    return {"observations": _parse_mcx_html(response.text), "source_url": source_url}


def _parse_jpx_csv(payload: bytes, quote_date: date) -> list[dict[str, Any]]:
    text = payload.decode("cp932", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    header_index = next((index for index, row in enumerate(rows) if row and row[0] == "Issue Code"), None)
    if header_index is None:
        raise SourceUnavailable("JPX settlement CSV header was not found")

    candidates: dict[str, list[list[str]]] = {prefix: [] for prefix in OSE_PRODUCTS}
    for row in rows[header_index + 1:]:
        if len(row) < 12:
            continue
        issue_name = row[1].strip()
        settlement = _float(row[5])
        contract_month = row[3].strip()
        for prefix in OSE_PRODUCTS:
            if issue_name.startswith(prefix) and settlement is not None and re.fullmatch(r"\d{6}", contract_month):
                candidates[prefix].append(row)
                break

    observations = []
    for prefix, product_rows in candidates.items():
        if not product_rows:
            continue
        row = min(product_rows, key=lambda item: item[3])
        metal, registry_id, root_symbol = OSE_PRODUCTS[prefix]
        contract_value = row[3]
        observations.append(_base_observation(
            metal=metal,
            registry_id=registry_id,
            symbol=row[1].strip() or root_symbol,
            contract_month=_month_label(int(contract_value[:4]), int(contract_value[4:])),
            local_price=float(row[5]),
            currency="JPY",
            native_unit="gram",
            quote_date=quote_date,
            price_type="official daily settlement",
            data_delay="Official JPX/OSE settlement CSV; normally published around 16:45 JST",
        ))
    return observations


def _fetch_ose(_metal: str) -> dict[str, Any]:
    index_url = "https://www.jpx.co.jp/english/markets/derivatives/settlement-price/index.html"
    session = _browser_session()
    index_response = session.get(index_url, timeout=SOURCE_TIMEOUT_SECONDS)
    index_response.raise_for_status()
    root = lxml_html.fromstring(index_response.text)
    hrefs = root.xpath('//a[contains(@href, "rb_e") and contains(@href, ".csv")]/@href')
    if not hrefs:
        raise SourceUnavailable("JPX settlement page did not publish a current CSV link")
    data_url = urljoin(index_url, hrefs[0])
    match = re.search(r"rb_e(\d{8})\.csv", data_url)
    quote_date = _trade_date(match.group(1) if match else None)
    if quote_date is None:
        raise SourceUnavailable("JPX settlement CSV date could not be verified")
    response = session.get(data_url, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    observations = _parse_jpx_csv(response.content, quote_date)
    if not observations:
        raise SourceUnavailable("JPX settlement CSV contained no supported OSE products")
    return {"observations": observations, "source_url": data_url}


def _parse_lme_payload(metal: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    registry_id, _slug, metal_name, _fallback_field = LME_PAGES[metal]
    cash_row = next((row for row in payload.get("Rows") or [] if str(row.get("RowTitle")).lower() == "cash"), None)
    values = cash_row.get("Values") if cash_row else None
    offer = _float(values[1] if isinstance(values, list) and len(values) > 1 else None)
    quote_date = _trade_date(str(payload.get("DateOfData") or "")[:10])
    if cash_row is None or offer is None or quote_date is None:
        raise SourceUnavailable(f"LME {metal_name} official-price response had no cash offer")
    expiry = str(cash_row.get("HoverValue") or "").strip()
    observation = _base_observation(
        metal=metal,
        registry_id=registry_id,
        symbol=str(cash_row.get("Ric") or f"LME {metal_name} Cash"),
        contract_month=f"Cash - {_expiry_label(expiry)}" if _expiry_label(expiry) else "Cash",
        local_price=offer,
        currency="USD",
        native_unit="metric tonne",
        quote_date=quote_date,
        price_type="official cash offer settlement",
        data_delay="Official LME cash offer price; day-delayed publication",
    )
    observation["market_type"] = "physical cash benchmark"
    return [observation]


def _parse_westmetall_lme_html(metal: str, document: str) -> list[dict[str, Any]]:
    registry_id, _slug, metal_name, _fallback_field = LME_PAGES[metal]
    root = lxml_html.fromstring(document)
    for table in root.xpath("//table"):
        rows = table.xpath(".//tr")
        if not rows:
            continue
        headers = [" ".join("".join(cell.itertext()).split()) for cell in rows[0].xpath("./th|./td")]
        cash_index = next(
            (index for index, header in enumerate(headers) if f"LME {metal_name} Cash-Settlement" in header),
            None,
        )
        if cash_index is None:
            continue
        for tr in rows[1:]:
            values = [" ".join("".join(cell.itertext()).split()) for cell in tr.xpath("./th|./td")]
            if len(values) <= cash_index:
                continue
            quote_date = _trade_date(values[0])
            settlement = _float(values[cash_index])
            if quote_date is None or settlement is None:
                continue
            observation = _base_observation(
                metal=metal,
                registry_id=registry_id,
                symbol=f"LME {metal_name} Cash Settlement",
                contract_month=f"Cash - {_month_label(quote_date.year, quote_date.month)}",
                local_price=settlement,
                currency="USD",
                native_unit="metric tonne",
                quote_date=quote_date,
                price_type="secondary publication of LME cash settlement",
                data_delay="Westmetall daily table reproducing the LME cash settlement; used when LME.com is unavailable",
            )
            observation["market_type"] = "physical cash benchmark"
            observation["source_name"] = "Westmetall published LME cash-settlement table"
            return [observation]
    raise SourceUnavailable(f"Westmetall LME {metal_name} table contained no usable cash settlement")


def _fetch_lme(metal: str) -> dict[str, Any]:
    _registry_id, slug, metal_name, fallback_field = LME_PAGES[metal]
    page_url = f"https://www.lme.com/en/metals/non-ferrous/lme-{slug}"
    try:
        session = _browser_session()
        page_response = session.get(page_url, timeout=SOURCE_TIMEOUT_SECONDS)
        page_response.raise_for_status()
        root = lxml_html.fromstring(page_response.text)
        components = root.xpath(
            f'//*[@datasource-id and contains(@header, "LME {metal_name} Official Prices")]'
        )
        if not components:
            raise SourceUnavailable(f"LME {metal_name} page did not expose its official-price source")
        datasource_id = components[0].get("datasource-id")
        data_url = f"https://www.lme.com/api/trading-data/day-delayed?datasourceId={datasource_id}"
        response = session.get(
            data_url,
            headers={"Referer": page_url, "Accept": "application/json, text/plain, */*"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return {
            "observations": _parse_lme_payload(metal, response.json()),
            "source_url": page_url,
            "source_tier": "official_primary",
        }
    except Exception as exc:
        upstream_error = _safe_error(exc)
        fallback_url = (
            "https://www.westmetall.com/en/markdaten.php"
            f"?action=table&field={fallback_field}"
        )
        response = requests.get(
            fallback_url,
            headers={"User-Agent": "Market-Diagnostic-Dashboard/1.0"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return {
            "observations": _parse_westmetall_lme_html(metal, response.text),
            "source_url": fallback_url,
            "source_tier": "secondary_fallback",
            "upstream_error": upstream_error,
        }


def _parse_ecb_fx_csv(payload: str) -> dict[str, dict[date, float]]:
    series: dict[str, dict[date, float]] = {}
    for row in csv.DictReader(io.StringIO(payload)):
        currency = str(row.get("CURRENCY") or "").upper()
        quote_date = _trade_date(row.get("TIME_PERIOD"))
        value = _float(row.get("OBS_VALUE"))
        if currency and quote_date and value is not None:
            series.setdefault(currency, {})[quote_date] = value
    return series


def _fetch_ecb_fx(_metal: str) -> dict[str, Any]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=45)
    response = requests.get(
        ECB_FX_URL,
        params={"startPeriod": start.isoformat(), "endPeriod": end.isoformat(), "format": "csvdata"},
        headers={"User-Agent": "Market-Diagnostic-Dashboard/1.0", "Accept": "text/csv"},
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    series = _parse_ecb_fx_csv(response.text)
    if "USD" not in series:
        raise SourceUnavailable("ECB FX response did not include the USD reference series")
    return {"fx_series": series, "source_url": ECB_FX_URL}


PROVIDER_LOADERS: dict[str, Callable[[str], dict[str, Any]]] = {
    "shfe": _fetch_shfe,
    "sge": _fetch_sge,
    "lbma": _fetch_lbma,
    "mcx": _fetch_mcx,
    "ose": _fetch_ose,
    "lme": _fetch_lme,
    "ecb_fx": _fetch_ecb_fx,
}


def _cache_key(provider_id: str, metal: str) -> str:
    return f"{provider_id}:{metal}" if provider_id in {"lbma", "lme"} else provider_id


def _safe_error(exc: Exception) -> str:
    text = re.sub(r"\s+", " ", str(exc)).strip()
    return (text or exc.__class__.__name__)[:240]


def _load_cached(provider_id: str, metal: str) -> tuple[dict[str, Any], dict[str, Any]]:
    key = _cache_key(provider_id, metal)
    now_monotonic = time.monotonic()
    with _CACHE_LOCK:
        cached = _SOURCE_CACHE.get(key)
        if cached and now_monotonic - cached["stored_monotonic"] <= SOURCE_CACHE_TTL_SECONDS:
            snapshot = cached["snapshot"]
            return snapshot, {
                "provider_id": provider_id,
                "provider_name": PROVIDER_NAMES[provider_id],
                "status": "cached",
                "fetched_at": cached["fetched_at"],
                "source_url": snapshot.get("source_url"),
                "source_tier": snapshot.get("source_tier", "official_primary"),
                "upstream_error": snapshot.get("upstream_error"),
                "error": None,
            }

    try:
        snapshot = PROVIDER_LOADERS[provider_id](metal)
        fetched_at = datetime.now(timezone.utc).isoformat()
        with _CACHE_LOCK:
            _SOURCE_CACHE[key] = {
                "snapshot": snapshot,
                "stored_monotonic": time.monotonic(),
                "fetched_at": fetched_at,
            }
        return snapshot, {
            "provider_id": provider_id,
            "provider_name": PROVIDER_NAMES[provider_id],
            "status": "live",
            "fetched_at": fetched_at,
            "source_url": snapshot.get("source_url"),
            "source_tier": snapshot.get("source_tier", "official_primary"),
            "upstream_error": snapshot.get("upstream_error"),
            "error": None,
        }
    except Exception as exc:
        error = _safe_error(exc)
        logger.warning("Metal source %s failed: %s", provider_id, error)
        with _CACHE_LOCK:
            cached = _SOURCE_CACHE.get(key)
            if cached and now_monotonic - cached["stored_monotonic"] <= SOURCE_CACHE_MAX_STALE_SECONDS:
                snapshot = cached["snapshot"]
                return snapshot, {
                    "provider_id": provider_id,
                    "provider_name": PROVIDER_NAMES[provider_id],
                    "status": "stale_cache",
                    "fetched_at": cached["fetched_at"],
                    "source_url": snapshot.get("source_url"),
                    "source_tier": snapshot.get("source_tier", "official_primary"),
                    "upstream_error": snapshot.get("upstream_error"),
                    "error": error,
                }
        return {}, {
            "provider_id": provider_id,
            "provider_name": PROVIDER_NAMES[provider_id],
            "status": "unavailable",
            "fetched_at": None,
            "source_url": None,
            "error": error,
        }


def _latest_common_fx_date(
    series: dict[str, dict[date, float]],
    currency: str,
    quote_date: date,
) -> Optional[date]:
    local_dates = set(series.get(currency, {}))
    usd_dates = set(series.get("USD", {}))
    eligible = [value for value in local_dates & usd_dates if value <= quote_date]
    return max(eligible) if eligible else None


def _attach_fx(
    observations: list[dict[str, Any]],
    snapshot: dict[str, Any],
) -> None:
    series = snapshot.get("fx_series") or {}
    for observation in observations:
        currency = str(observation.get("currency") or "").upper()
        if currency == "USD":
            continue
        quote_date = _trade_date(str(observation.get("quote_timestamp") or "")[:10])
        if quote_date is None:
            continue
        fx_date = _latest_common_fx_date(series, currency, quote_date)
        if fx_date is None:
            continue
        local_per_eur = series[currency][fx_date]
        usd_per_eur = series["USD"][fx_date]
        observation["fx_rate_local_per_usd"] = local_per_eur / usd_per_eur
        observation["fx_timestamp"] = _date_timestamp(fx_date)
        observation["fx_source"] = "ECB daily reference rates via EUR cross"


def fetch_international_metal_observations(metal: str) -> dict[str, Any]:
    """Fetch a metal's international observations plus inspectable source health."""
    metal = metal.upper()
    if metal not in METAL_PROVIDERS:
        raise ValueError(f"Unsupported metal: {metal}")

    provider_ids = METAL_PROVIDERS[metal]
    requested_provider_ids = (*provider_ids, "ecb_fx")
    snapshots: dict[str, dict[str, Any]] = {}
    status_by_provider: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=len(requested_provider_ids)) as executor:
        future_by_provider = {
            executor.submit(_load_cached, provider_id, metal): provider_id
            for provider_id in requested_provider_ids
        }
        for future in as_completed(future_by_provider):
            provider_id = future_by_provider[future]
            snapshot, status = future.result()
            snapshots[provider_id] = snapshot
            status_by_provider[provider_id] = status

    observations = []
    for provider_id in provider_ids:
        matches = [
            dict(row)
            for row in snapshots.get(provider_id, {}).get("observations", [])
            if row.get("_metal") == metal
        ]
        for row in matches:
            row.pop("_metal", None)
            row["provider_id"] = provider_id
        observations.extend(matches)
        status_by_provider[provider_id]["observation_count"] = len(matches)

    fx_snapshot = snapshots["ecb_fx"]
    fx_status = status_by_provider["ecb_fx"]
    _attach_fx(observations, fx_snapshot)
    fx_status["observation_count"] = sum(row.get("currency") != "USD" for row in observations)
    status_by_provider["ecb_fx"] = fx_status

    missing_fx = sum(
        row.get("currency") != "USD" and not row.get("fx_rate_local_per_usd")
        for row in observations
    )
    fx_status["missing_conversions"] = missing_fx

    source_statuses = [status_by_provider[provider_id] for provider_id in requested_provider_ids]
    return {"observations": observations, "sources": source_statuses}


def clear_metal_source_cache() -> None:
    """Clear adapter cache for deterministic tests and operator diagnostics."""
    with _CACHE_LOCK:
        _SOURCE_CACHE.clear()
