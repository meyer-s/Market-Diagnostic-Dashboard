import calendar
import json
import logging
import os
import time
from datetime import datetime, timezone
from functools import lru_cache
from typing import Dict, Iterable, List, Optional

import feedparser
import requests
from dateutil import parser as dateparser

from app.models.news_article import NewsArticle
from app.models.news_collection_observation import NewsCollectionObservation
from app.models.news_ticker import NewsTicker

logger = logging.getLogger(__name__)

NEWS_SOURCE = "SeekingAlpha"
REQUEST_PAUSE = 0.6
MAX_ITEMS_PER_TICKER = 10

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardNews/1.0; +https://example.local/)"
}

# Static presets for index-wide ticker lists loaded from JSON.
PRESET_TICKERS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "data", "ticker_presets.json")
)

# Seed list for the ticker cache when no rows exist yet.
DEFAULT_TICKERS: Dict[str, List[str]] = {
    "ACTIVE_INVESTMENT": [
        "AAPL", "ABAT", "APH", "DVLT", "FIG", "GD", "GE", "GEV", "GME", "GOOGL", "GPRO",
        "GPUS", "INTU", "IONQ", "LAC", "LMT", "MA", "MP", "MSFT", "NVTS", "OPEN", "QBTS",
        "RGTI", "RKT", "RMBS", "RTX", "SNOW", "TJX", "TXN", "V", "VIXW", "VZ", "WULF"
    ],
    "LONG_HOLDS": [
        "VOO", "VXUS", "BNDX", "EMB", "HYG", "HYXU", "ISHG", "AFK", "EWH", "INDA", "KSA",
        "VGK", "VWO", "ASST", "NOW", "BOTZ", "BRKB", "BYND", "ETHA", "FAZ", "FIGFX",
        "FIVLX", "FSDAX", "GLW", "HACK", "IBIT", "IMSR", "LAES", "MADE", "MU", "NRGV",
        "NVDA", "NVNI", "NXXT", "OCGN", "PLB50", "PYPL", "RKLB", "RR", "SB1000", "T",
        "TCEHY", "TSM", "UMAC", "UUUU", "VDC", "VWELX", "XLV"
    ]
}


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


@lru_cache(maxsize=1)
def _load_ticker_presets() -> List[Dict[str, object]]:
    try:
        with open(PRESET_TICKERS_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        logger.warning("Ticker preset file missing: %s", PRESET_TICKERS_PATH)
        return []
    except Exception as exc:
        logger.warning("Failed to load ticker presets: %s", exc)
        return []

    presets = payload.get("presets")
    if isinstance(presets, list):
        return presets
    return []


def list_news_presets() -> List[Dict[str, object]]:
    presets = _load_ticker_presets()
    results: List[Dict[str, object]] = []

    for preset in presets:
        preset_id = preset.get("id")
        label = preset.get("label") or preset_id
        sectors = preset.get("sectors") or {}
        tickers: List[Dict[str, str]] = []

        if not preset_id:
            continue

        for sector, symbols in sectors.items():
            sector_name = str(sector).strip() or "GENERAL"
            for symbol in symbols or []:
                if not symbol:
                    continue
                tickers.append({
                    "symbol": normalize_symbol(str(symbol)),
                    "sector": sector_name,
                })

        results.append({
            "id": preset_id,
            "label": label,
            "count": len(tickers),
            "tickers": tickers,
        })

    return results


def ensure_default_tickers(db) -> None:
    # Only seed once to preserve user edits.
    if db.query(NewsTicker).count() > 0:
        return

    for sector, symbols in DEFAULT_TICKERS.items():
        for symbol in symbols:
            db.add(NewsTicker(symbol=normalize_symbol(symbol), sector=sector))
    db.commit()


def list_news_tickers(db) -> List[NewsTicker]:
    return (
        db.query(NewsTicker)
        .order_by(NewsTicker.sector.asc(), NewsTicker.symbol.asc())
        .all()
    )


def replace_news_tickers(db, tickers: Iterable[Dict[str, str]]) -> List[NewsTicker]:
    db.query(NewsTicker).delete()

    seen = set()
    for ticker in tickers:
        raw_symbol = (ticker.get("symbol") or "").strip()
        if not raw_symbol:
            continue
        sector = (ticker.get("sector") or "GENERAL").strip() or "GENERAL"
        symbol = normalize_symbol(raw_symbol)
        key = (symbol, sector)
        if key in seen:
            continue
        seen.add(key)
        db.add(NewsTicker(symbol=symbol, sector=sector))

    db.commit()
    return list_news_tickers(db)


def _parse_entry_datetime(entry: dict) -> datetime:
    published = entry.get("published") or entry.get("updated")
    if published:
        try:
            parsed = dateparser.parse(published)
            if parsed and parsed.tzinfo:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            if parsed:
                return parsed
        except Exception:
            pass

    parsed_struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed_struct:
        try:
            timestamp = calendar.timegm(parsed_struct)
            return datetime.fromtimestamp(timestamp, tz=timezone.utc).replace(tzinfo=None)
        except Exception:
            pass

    return datetime.utcnow()


def _fetch_news_evidence_for_symbol(
    symbol: str,
    max_items: int = MAX_ITEMS_PER_TICKER,
) -> Dict[str, object]:
    """Fetch one feed and retain a success receipt for negative-evidence checks."""

    rss_url = f"https://seekingalpha.com/api/sa/combined/{requests.utils.quote(symbol)}.xml"
    try:
        response = requests.get(rss_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", symbol, exc)
        return {
            "source": NEWS_SOURCE,
            "succeeded": False,
            "entries": [],
            "error_kind": type(exc).__name__,
        }

    feed = feedparser.parse(response.content)
    entries: List[Dict[str, object]] = []
    for entry in feed.get("entries", [])[:max_items]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        guid = str(entry.get("id") or entry.get("guid") or link)
        entries.append({
            "title": title,
            "link": link,
            "guid": guid,
            "source": NEWS_SOURCE,
            "published_at": _parse_entry_datetime(entry),
        })

    time.sleep(REQUEST_PAUSE)
    if getattr(feed, "bozo", False) and not entries:
        error = getattr(feed, "bozo_exception", None)
        return {
            "source": NEWS_SOURCE,
            "succeeded": False,
            "entries": [],
            "error_kind": type(error).__name__ if error is not None else "FeedParseError",
        }
    return {
        "source": NEWS_SOURCE,
        "succeeded": True,
        "entries": entries,
        "error_kind": None,
    }


def fetch_news_for_symbol(
    symbol: str,
    max_items: int = MAX_ITEMS_PER_TICKER,
) -> List[Dict[str, object]]:
    """Compatibility wrapper returning only fetched entries."""

    evidence = _fetch_news_evidence_for_symbol(symbol, max_items=max_items)
    return list(evidence.get("entries") or [])


def cache_news_entries(
    db,
    symbol: str,
    sector: Optional[str],
    entries: List[Dict[str, object]]
) -> int:
    # Deduplicate by GUID so refreshes do not create duplicates.
    if not entries:
        return 0

    guids = [entry["guid"] for entry in entries if entry.get("guid")]
    existing_guids = set()
    if guids:
        existing_guids = {
            row[0]
            for row in db.query(NewsArticle.guid)
            .filter(
                NewsArticle.symbol == normalize_symbol(symbol),
                NewsArticle.guid.in_(guids),
            )
            .all()
        }

    new_count = 0
    for entry in entries:
        guid = entry.get("guid")
        if not guid or guid in existing_guids:
            continue
        article = NewsArticle(
            symbol=normalize_symbol(symbol),
            sector=sector,
            source=str(entry.get("source") or NEWS_SOURCE),
            title=entry.get("title") or "",
            link=entry.get("link") or "",
            guid=str(guid),
            published_at=entry.get("published_at") or datetime.utcnow(),
        )
        db.add(article)
        new_count += 1

    if new_count:
        db.commit()
    return new_count


def refresh_news_cache(
    db,
    symbol: Optional[str] = None,
    sector: Optional[str] = None,
    max_items_per_ticker: int = MAX_ITEMS_PER_TICKER
) -> Dict[str, int]:
    # Fetch and cache the latest items for the selected tickers.
    ensure_default_tickers(db)
    tickers = list_news_tickers(db)

    if symbol:
        normalized = normalize_symbol(symbol)
        tickers = [ticker for ticker in tickers if ticker.symbol == normalized]

    if sector:
        filtered_sector = sector.strip()
        tickers = [ticker for ticker in tickers if ticker.sector == filtered_sector]

    new_items = 0
    successful_checks = 0
    failed_checks = 0
    for ticker in tickers:
        try:
            checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            evidence = _fetch_news_evidence_for_symbol(
                ticker.symbol,
                max_items=max_items_per_ticker,
            )
            entries = list(evidence.get("entries") or [])
            succeeded = bool(evidence.get("succeeded"))
            added = cache_news_entries(db, ticker.symbol, ticker.sector, entries) if succeeded else 0
            new_items += added
            successful_checks += int(succeeded)
            failed_checks += int(not succeeded)
            published_values = [
                entry.get("published_at")
                for entry in entries
                if isinstance(entry.get("published_at"), datetime)
            ]
            db.add(
                NewsCollectionObservation(
                    symbol=normalize_symbol(ticker.symbol),
                    source=str(evidence.get("source") or NEWS_SOURCE),
                    checked_at=checked_at,
                    succeeded=succeeded,
                    item_count=len(entries),
                    new_item_count=added,
                    latest_published_at=max(published_values) if published_values else None,
                    error_kind=str(evidence.get("error_kind")) if evidence.get("error_kind") else None,
                )
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning("Failed caching news for %s: %s", ticker.symbol, exc)
            failed_checks += 1

    return {
        "tickers_checked": len(tickers),
        "new_items": new_items,
        "successful_checks": successful_checks,
        "failed_checks": failed_checks,
    }
