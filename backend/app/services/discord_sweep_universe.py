"""
Ticker-universe builder for Discord sweep commands.
"""
from __future__ import annotations

import io
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd
import requests

logger = logging.getLogger(__name__)


SP500_IVV_URL = (
    "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund"
)
R2K_IWM_URL = (
    "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
)

CBOE_INTRADAY_OPTIONS_VOLUME_URL = (
    "https://www.cboe.com/us/options/market_statistics/intraday_contract_volume/"
)
NASDAQ_EARNINGS_CALENDAR_URL = "https://api.nasdaq.com/api/calendar/earnings"
NASDAQ_LATEST_NEWS_URL = "https://api.nasdaq.com/api/news/topic/latestnews"
FINVIZ_SCREENER_URL = "https://finviz.com/screener.ashx"

TICKER_PRESETS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "ticker_presets.json"
)

MAJOR_SECTOR_ETFS = [
    "XLB",  # Materials
    "XLC",  # Communication Services
    "XLE",  # Energy
    "XLF",  # Financials
    "XLI",  # Industrials
    "XLK",  # Technology
    "XLP",  # Consumer Staples
    "XLRE",  # Real Estate
    "XLU",  # Utilities
    "XLV",  # Health Care
    "XLY",  # Consumer Discretionary
]

SUPPORTED_SWEEP_UNIVERSES: Dict[str, str] = {
    "SP500": "S&P 500",
    "NASDAQ100": "Nasdaq 100",
    "RUSSELL2000": "Russell 2000",
    "SECTOR_ETFS": "Major Sector ETFs",
    "ALL": "All Optionable Equities",
    "TOP_OPT_VOL_200": "Top 200 Options Volume Stocks",
    "UPCOMING_EARNINGS_21D": "Upcoming Earnings (21-day window)",
    "TOP_SHORT_INTEREST_100": "Top 100 Short Interest",
    "MAJOR_NEWS_21D": "Major Headline News (past 21 days)",
}

UNIVERSE_ALIASES: Dict[str, str] = {
    "SPY": "SP500",
    "IWM": "RUSSELL2000",
    "SP500": "SP500",
    "NASDAQ100": "NASDAQ100",
    "RUSSELL2000": "RUSSELL2000",
    "SECTOR_ETFS": "SECTOR_ETFS",
    "ALL": "ALL",
    "NYSE": "ALL",
    "TOP_OPT_VOL_200": "TOP_OPT_VOL_200",
    "UPCOMING_EARNINGS_21D": "UPCOMING_EARNINGS_21D",
    "TOP_SHORT_INTEREST_100": "TOP_SHORT_INTEREST_100",
    "MAJOR_NEWS_21D": "MAJOR_NEWS_21D",
}

MAJOR_PUBLISHERS = {
    "REUTERS",
    "BLOOMBERG",
    "CNBC",
    "THE WALL STREET JOURNAL",
    "WALL STREET JOURNAL",
    "MARKETWATCH",
    "BARRON'S",
    "BARRONS",
    "ASSOCIATED PRESS",
    "AP",
    "FINANCIAL TIMES",
    "THE NEW YORK TIMES",
    "WASHINGTON POST",
    "BUSINESS INSIDER",
    "YAHOO FINANCE",
    "FORBES",
    "INVESTOPEDIA",
    "THE STREET",
    "DOW JONES",
}

STANDARD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardDiscordSweep/1.0)",
}

NASDAQ_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}

FINVIZ_HEADERS = {
    "User-Agent": "Mozilla/5.0",
}

EQUITY_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}(?:-[A-Z])?$")

_CACHE: Dict[str, Tuple[datetime, List[str], List[str]]] = {}
_STATIC_TTL = timedelta(hours=6)
_DYNAMIC_TTL = timedelta(minutes=30)
_ALL_OPTIONABLE_MIN_EXPECTED = 1200


@dataclass
class SweepUniverse:
    key: str
    label: str
    tickers: List[str]
    notes: List[str]


def canonical_universe_key(value: str) -> Optional[str]:
    if not value:
        return None
    return UNIVERSE_ALIASES.get(value.strip().upper())


def supported_universe_description() -> str:
    return ", ".join(f"{k} ({v})" for k, v in SUPPORTED_SWEEP_UNIVERSES.items())


def resolve_sweep_universe(selection: str) -> SweepUniverse:
    key = canonical_universe_key(selection)
    if not key:
        raise ValueError(f"Unsupported universe: {selection}")

    ttl = _STATIC_TTL if key in {"SP500", "NASDAQ100", "RUSSELL2000", "SECTOR_ETFS"} else _DYNAMIC_TTL
    cached = _get_cached_universe(key, ttl)
    if cached:
        return cached

    if key == "SP500":
        tickers, notes = _build_sp500()
    elif key == "NASDAQ100":
        tickers, notes = _build_nasdaq100()
    elif key == "RUSSELL2000":
        tickers, notes = _build_russell2000()
    elif key == "SECTOR_ETFS":
        tickers, notes = _build_sector_etfs()
    elif key == "ALL":
        tickers, notes = _build_all_optionable()
    elif key == "TOP_OPT_VOL_200":
        tickers, notes = _build_top_options_volume_200()
    elif key == "UPCOMING_EARNINGS_21D":
        tickers, notes = _build_upcoming_earnings_21d()
    elif key == "TOP_SHORT_INTEREST_100":
        tickers, notes = _build_top_short_interest_100()
    elif key == "MAJOR_NEWS_21D":
        tickers, notes = _build_major_news_21d()
    else:
        tickers, notes = [], [f"No universe builder configured for key: {key}"]

    universe = SweepUniverse(
        key=key,
        label=SUPPORTED_SWEEP_UNIVERSES[key],
        tickers=tickers,
        notes=notes,
    )
    _CACHE[key] = (datetime.utcnow(), tickers[:], notes[:])
    return universe


def _get_cached_universe(key: str, ttl: timedelta) -> Optional[SweepUniverse]:
    payload = _CACHE.get(key)
    if not payload:
        return None
    cached_at, tickers, notes = payload
    if datetime.utcnow() - cached_at > ttl:
        return None
    return SweepUniverse(
        key=key,
        label=SUPPORTED_SWEEP_UNIVERSES[key],
        tickers=tickers[:],
        notes=notes[:],
    )


def _build_sp500() -> Tuple[List[str], List[str]]:
    preset = _symbols_from_preset("sp500")
    if preset:
        return preset, ["Loaded from local ticker preset: sp500."]
    fallback = _fetch_ishares_tickers(SP500_IVV_URL)
    notes = ["Loaded from iShares IVV holdings CSV."] if fallback else ["Failed to load S&P 500 symbols."]
    return fallback, notes


def _build_nasdaq100() -> Tuple[List[str], List[str]]:
    preset = _symbols_from_preset("nasdaq100")
    if preset:
        return preset, ["Loaded from local ticker preset: nasdaq100."]
    return [], ["Failed to load Nasdaq 100 symbols from local preset."]


def _build_russell2000() -> Tuple[List[str], List[str]]:
    symbols = _fetch_ishares_tickers(R2K_IWM_URL)
    notes = ["Loaded from iShares IWM holdings CSV."] if symbols else ["Failed to load Russell 2000 symbols."]
    return symbols, notes


def _build_sector_etfs() -> Tuple[List[str], List[str]]:
    return MAJOR_SECTOR_ETFS[:], ["Loaded built-in major sector ETF basket."]


def _build_all_optionable() -> Tuple[List[str], List[str]]:
    merged: List[str] = []
    notes: List[str] = []
    scans = [
        ("NYSE", "exch_nyse,sh_opt_option", 4000),
        ("NASDAQ", "exch_nasd,sh_opt_option", 4000),
        ("AMEX", "exch_amex,sh_opt_option", 1200),
    ]

    for exchange, filters, limit in scans:
        symbols = _fetch_finviz_sorted_symbols(
            sort_key="marketcap",
            limit=limit,
            filters=filters,
        )
        notes.append(f"{exchange}: loaded {len(symbols)} optionable symbols from Finviz screener.")
        merged = _merge_symbol_lists(merged, symbols)

    if merged:
        notes.append(f"Merged optionable universe size: {len(merged)} symbols.")

    if len(merged) < _ALL_OPTIONABLE_MIN_EXPECTED:
        fallback = _fetch_finviz_sorted_symbols(
            sort_key="marketcap",
            limit=5000,
            filters="sh_opt_option",
        )
        if not merged:
            notes.append("Primary exchange-filtered fetch returned 0 symbols.")
        notes.append(f"Fallback loaded {len(fallback)} optionable symbols from Finviz.")
        merged = _merge_symbol_lists(merged, fallback)

    if len(merged) < _ALL_OPTIONABLE_MIN_EXPECTED:
        fallback_union, fallback_notes = _build_non_all_universe_union()
        notes.append(
            f"Coverage guard triggered at {len(merged)} symbols (< {_ALL_OPTIONABLE_MIN_EXPECTED}); "
            "merged all other configured universes."
        )
        notes.extend(fallback_notes)
        merged = _merge_symbol_lists(merged, fallback_union)

    if merged:
        notes.append(f"Final ALL universe size: {len(merged)} symbols.")
        return merged, notes
    return [], notes + ["Failed to build ALL optionable universe."]


def _build_non_all_universe_union() -> Tuple[List[str], List[str]]:
    builders = [
        ("SP500", _build_sp500),
        ("NASDAQ100", _build_nasdaq100),
        ("RUSSELL2000", _build_russell2000),
        ("SECTOR_ETFS", _build_sector_etfs),
        ("TOP_OPT_VOL_200", _build_top_options_volume_200_fallback_only),
        ("UPCOMING_EARNINGS_21D", _build_upcoming_earnings_21d),
        ("TOP_SHORT_INTEREST_100", _build_top_short_interest_100),
        ("MAJOR_NEWS_21D", _build_major_news_21d),
    ]

    merged: List[str] = []
    notes: List[str] = []

    for key, builder in builders:
        symbols, _ = builder()
        merged = _merge_symbol_lists(merged, symbols)
        notes.append(f"{key}: merged {len(symbols)} symbols.")

    notes.append(f"Union size from non-ALL universes: {len(merged)} symbols.")
    return merged, notes


def _build_top_options_volume_200_fallback_only() -> Tuple[List[str], List[str]]:
    symbols = _fetch_finviz_sorted_symbols(
        sort_key="volume",
        limit=200,
        filters="sh_opt_option",
    )
    notes = ["Fallback-only TOP_OPT_VOL_200 source: Finviz optionable stocks sorted by stock volume."]
    return symbols[:200], notes


def _build_top_options_volume_200() -> Tuple[List[str], List[str]]:
    candidates, candidate_notes = _build_master_equity_universe()
    if not candidates:
        return [], candidate_notes + ["Unable to build candidate equities for options volume ranking."]

    ranked = _rank_by_cboe_intraday_options_volume(candidates)
    ranked_symbols = [symbol for symbol, _ in ranked if symbol]

    notes = candidate_notes + [
        f"Ranked {len(ranked_symbols)} symbols via Cboe intraday options volume.",
    ]
    if len(ranked_symbols) >= 200:
        return ranked_symbols[:200], notes

    fallback = _fetch_finviz_sorted_symbols(
        sort_key="volume",
        limit=200,
        filters="sh_opt_option",
    )
    if fallback:
        notes.append("Fallback applied: Finviz optionable stocks sorted by stock volume.")
        merged = _merge_symbol_lists(ranked_symbols, fallback)
        return merged[:200], notes

    notes.append("Fallback unavailable; returning reduced list.")
    return ranked_symbols[:200], notes


def _build_upcoming_earnings_21d() -> Tuple[List[str], List[str]]:
    tickers: List[str] = []
    seen = set()
    today = datetime.utcnow().date()

    for day_offset in range(21):
        date_value = today + timedelta(days=day_offset)
        params = {"date": date_value.strftime("%Y-%m-%d")}
        try:
            response = requests.get(
                NASDAQ_EARNINGS_CALENDAR_URL,
                params=params,
                headers=NASDAQ_HEADERS,
                timeout=20,
            )
            response.raise_for_status()
            rows = response.json().get("data", {}).get("rows", []) or []
        except Exception as exc:
            logger.warning("Earnings fetch failed for %s: %s", date_value, exc)
            continue

        for row in rows:
            symbol = normalize_symbol(str(row.get("symbol") or ""))
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            tickers.append(symbol)

    return tickers, [f"Loaded {len(tickers)} unique symbols from Nasdaq earnings calendar (21-day window)."]


def _build_top_short_interest_100() -> Tuple[List[str], List[str]]:
    symbols = _fetch_finviz_sorted_symbols(
        sort_key="shortinterestshare",
        limit=100,
        filters="sh_opt_option",
    )
    notes = ["Loaded from Finviz sorted by short interest share (optionable filter)."]
    if not symbols:
        notes.append("Failed to fetch Finviz short-interest symbols.")
    return symbols[:100], notes


def _build_major_news_21d() -> Tuple[List[str], List[str]]:
    cutoff = datetime.utcnow().date() - timedelta(days=21)
    mention_counts: Counter[str] = Counter()
    considered = 0
    offsets = [0, 100, 200, 300, 400]

    for offset in offsets:
        params = {"limit": 100, "offset": offset}
        try:
            response = requests.get(
                NASDAQ_LATEST_NEWS_URL,
                params=params,
                headers=NASDAQ_HEADERS,
                timeout=20,
            )
            if response.status_code >= 400:
                logger.warning("News fetch failed for offset %s: %s", offset, response.status_code)
                break
            rows = response.json().get("data", {}).get("rows", []) or []
        except Exception as exc:
            logger.warning("News fetch failed for offset %s: %s", offset, exc)
            break

        if not rows:
            break

        oldest_in_page: Optional[datetime.date] = None
        for row in rows:
            created = _parse_nasdaq_created_date(str(row.get("created") or ""))
            if created is None:
                continue

            oldest_in_page = created if oldest_in_page is None else min(oldest_in_page, created)
            if created < cutoff:
                continue

            publisher = str(row.get("publisher") or "").strip().upper()
            if publisher and publisher not in MAJOR_PUBLISHERS:
                continue

            symbols = _extract_symbols_from_nasdaq_news_row(row)
            for symbol in symbols:
                mention_counts[symbol] += 1
            considered += 1

        if oldest_in_page is not None and oldest_in_page < cutoff:
            break

    ranked_symbols = [symbol for symbol, _ in mention_counts.most_common(200)]
    notes = [
        f"Loaded {len(ranked_symbols)} symbols from Nasdaq latest-news mentions within 21 days.",
        f"Headlines considered: {considered}.",
    ]

    if ranked_symbols:
        return ranked_symbols, notes

    fallback = _fetch_finviz_major_news_symbols(limit=200)
    if fallback:
        return fallback[:200], [
            f"Loaded {len(fallback[:200])} symbols from Finviz Major News screener.",
            f"Nasdaq major-publisher matches in 21 days: {len(ranked_symbols)}.",
        ]

    notes.append("Failed to build major-news universe from all configured sources.")
    return [], notes


def _build_master_equity_universe() -> Tuple[List[str], List[str]]:
    notes: List[str] = []
    sp500, sp_notes = _build_sp500()
    ndx, ndx_notes = _build_nasdaq100()
    r2k, r2k_notes = _build_russell2000()

    notes.extend(sp_notes)
    notes.extend(ndx_notes)
    notes.extend(r2k_notes)

    symbols = _unique_symbols(sp500 + ndx + r2k)
    notes.append(f"Master candidate universe size: {len(symbols)} symbols.")
    return symbols, notes


def _fetch_ishares_tickers(url: str) -> List[str]:
    try:
        response = requests.get(url, timeout=20, headers=STANDARD_HEADERS)
        response.raise_for_status()
    except Exception as exc:
        logger.warning("Failed to fetch iShares holdings from %s: %s", url, exc)
        return []

    lines = response.text.splitlines()
    header_idx = None
    for idx, line in enumerate(lines):
        if line.startswith("Ticker,"):
            header_idx = idx
            break
    if header_idx is None:
        return []

    frame = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])))
    tickers = frame.get("Ticker")
    if tickers is None:
        return []

    return _unique_symbols(str(value) for value in tickers.dropna().astype(str).tolist())


def _symbols_from_preset(preset_id: str) -> List[str]:
    try:
        payload = json.loads(TICKER_PRESETS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to load ticker presets: %s", exc)
        return []

    for preset in payload.get("presets", []):
        if str(preset.get("id") or "").lower() != preset_id.lower():
            continue
        sectors = preset.get("sectors") or {}
        symbols: List[str] = []
        for values in sectors.values():
            if not isinstance(values, list):
                continue
            symbols.extend(str(item) for item in values)
        return _unique_symbols(symbols)
    return []


def _rank_by_cboe_intraday_options_volume(symbols: Sequence[str]) -> List[Tuple[str, int]]:
    ranked: Dict[str, int] = {}
    for batch in _chunked(symbols, 15):
        payload = _fetch_cboe_intraday_batch(batch)
        for row in payload:
            symbol = normalize_symbol(str(row.get("underlying_symbol") or ""))
            if not symbol:
                continue
            try:
                volume = int(float(row.get("total") or 0))
            except Exception:
                volume = 0
            if volume <= 0:
                continue
            ranked[symbol] = max(ranked.get(symbol, 0), volume)

    return sorted(ranked.items(), key=lambda item: item[1], reverse=True)


def _fetch_cboe_intraday_batch(symbols: Sequence[str]) -> List[dict]:
    clean = [normalize_symbol(symbol) for symbol in symbols]
    clean = [symbol for symbol in clean if symbol]
    if not clean:
        return []

    params = {"symbols": ",".join(clean)}
    try:
        response = requests.get(
            CBOE_INTRADAY_OPTIONS_VOLUME_URL,
            params=params,
            headers=STANDARD_HEADERS,
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("Cboe intraday options volume fetch failed: %s", exc)
        return []

    return payload.get("data", []) or []


def _fetch_finviz_sorted_symbols(
    sort_key: str,
    limit: int,
    filters: Optional[str] = None,
) -> List[str]:
    symbols: List[str] = []
    for start in range(1, max(limit, 20) + 20, 20):
        params = {
            "v": "111",
            "o": f"-{sort_key}",
            "r": str(start),
        }
        if filters:
            params["f"] = filters
        try:
            response = requests.get(
                FINVIZ_SCREENER_URL,
                params=params,
                headers=FINVIZ_HEADERS,
                timeout=20,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning("Finviz fetch failed (sort=%s, start=%s): %s", sort_key, start, exc)
            break

        page_symbols = _extract_finviz_symbols(response.text)
        if not page_symbols:
            break

        symbols = _merge_symbol_lists(symbols, page_symbols)
        if len(symbols) >= limit:
            return symbols[:limit]

    return symbols[:limit]


def _fetch_finviz_major_news_symbols(limit: int) -> List[str]:
    symbols: List[str] = []
    for start in range(1, max(limit, 20) + 20, 20):
        params = {
            "v": "111",
            "s": "n_majornews",
            "o": "-news_date",
            "r": str(start),
        }
        try:
            response = requests.get(
                FINVIZ_SCREENER_URL,
                params=params,
                headers=FINVIZ_HEADERS,
                timeout=20,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning("Finviz major news fetch failed (start=%s): %s", start, exc)
            break

        page_symbols = _extract_finviz_symbols(response.text)
        if not page_symbols:
            break
        symbols = _merge_symbol_lists(symbols, page_symbols)
        if len(symbols) >= limit:
            return symbols[:limit]

    return symbols[:limit]


def _extract_finviz_symbols(html: str) -> List[str]:
    matches = re.findall(r"quote\.ashx\?t=([A-Z\.\-]+)", html)
    return _unique_symbols(matches)


def _extract_symbols_from_nasdaq_news_row(row: dict) -> List[str]:
    symbols: List[str] = []

    primary = normalize_symbol(str(row.get("primarysymbol") or ""))
    if primary:
        symbols.append(primary)

    for raw in row.get("related_symbols") or []:
        value = str(raw).split("|", 1)[0]
        symbol = normalize_symbol(value)
        if symbol:
            symbols.append(symbol)

    return _unique_symbols(symbols)


def _parse_nasdaq_created_date(value: str) -> Optional[datetime.date]:
    value = value.strip()
    if not value:
        return None
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def normalize_symbol(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if not cleaned:
        return ""
    cleaned = cleaned.replace(".", "-").replace("/", "-")
    if cleaned in {"NAN", "NONE", "NULL"}:
        return ""
    return cleaned


def _is_reasonable_equity_symbol(symbol: str) -> bool:
    return bool(EQUITY_SYMBOL_PATTERN.match(symbol))


def _unique_symbols(symbols: Iterable[str]) -> List[str]:
    ordered: List[str] = []
    seen = set()
    for raw in symbols:
        symbol = normalize_symbol(str(raw))
        if not symbol or symbol in seen or not _is_reasonable_equity_symbol(symbol):
            continue
        seen.add(symbol)
        ordered.append(symbol)
    return ordered


def _chunked(values: Sequence[str], size: int) -> Iterable[List[str]]:
    for idx in range(0, len(values), size):
        yield list(values[idx: idx + size])


def _merge_symbol_lists(primary: Sequence[str], secondary: Sequence[str]) -> List[str]:
    return _unique_symbols(list(primary) + list(secondary))
