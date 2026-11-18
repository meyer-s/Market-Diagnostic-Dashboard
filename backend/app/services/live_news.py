"""Demand-driven live news service for the dashboard's embedded News view."""

from base64 import b64encode
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import ExitStack
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime, parsedate_to_datetime
from functools import lru_cache
from hashlib import sha256
from html import escape, unescape
from html.parser import HTMLParser
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from os import environ
from pathlib import Path
import re
from secrets import compare_digest, token_urlsafe
import sqlite3
from threading import BoundedSemaphore, Event, Lock, Thread
from time import monotonic
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


HOST = environ.get("LIVE_NEWS_BIND", "127.0.0.1")
PORT = 8765
PREFIX = "/live-news"
PUBLIC_ORIGIN = environ.get("LIVE_NEWS_ORIGIN", "https://marketdiagnostictool.com")
PUBLIC_HOSTS = {
    urlsplit(PUBLIC_ORIGIN).netloc, "www.marketdiagnostictool.com",
    "localhost:5173", "127.0.0.1:5173", "localhost:8765", "127.0.0.1:8765",
}
REFRESH_SECONDS = 120
VIEW_REFRESH_SECONDS = 5
FEED_WORKERS = 4
MIN_SOURCE_INTERVAL = 20
ACTIVE_SECONDS = 45
JANITOR_SECONDS = 300
MAX_FEED_STORIES = 250
MAX_ARCHIVE_STORIES = 5000
FEED_TITLE = "Market News Live"
UTC = timezone.utc
ATOM = "{http://www.w3.org/2005/Atom}"
SITEMAP = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
NEWS_SITEMAP = "{http://www.google.com/schemas/sitemap-news/0.9}"
WIRE_HISTORY_FILE = Path(environ.get("LIVE_NEWS_ARCHIVE", "/app/live-news/wire.sqlite3"))
VIEWS = {"focused": "Focused", "wire": "Wires", "all": "All News"}
try:
    EASTERN = ZoneInfo("America/New_York")
except ZoneInfoNotFoundError:
    EASTERN = None

TOPICS = {
    "releases": "Official releases",
    "markets": "Markets & earnings",
    "metals": "Rates, dollar & metals",
    "crypto": "Bitcoin, Ethereum & ETFs",
    "world": "Geopolitics & policy",
    "tech": "Technology & AI",
    "energy": "Energy & commodities",
    "general": "General news",
}
FOCUSED_LIMITS = dict.fromkeys(TOPICS, 30)
PAGE_SIZE = 32
TOPIC_TABS = dict(zip(TOPICS, ("Releases", "Markets", "Rates & metals", "Crypto & ETFs",
                              "World", "Tech & AI", "Energy", "General")))
DATE_FILTERS = {"": ("Any recent date", None), "24h": ("Last 24 hours", 24), "72h": ("Last 72 hours", 72)}
WEIGHT_LEVELS = ("Off", "Low", "Normal", "High", "Priority")
FOCUS_LEVELS = {"broad": ("Broad", 24), "balanced": ("Balanced", 32), "tight": ("Tight", 40)}


@dataclass(frozen=True)
class Preferences:
    weights: dict[str, int]
    focus: str


DEFAULTS = Preferences({
    "releases": 4, "markets": 3, "metals": 4, "crypto": 3,
    "world": 2, "tech": 2, "energy": 2, "general": 1,
}, "balanced")


def load_preferences(cookie_header):
    try:
        cookie = SimpleCookie(cookie_header or "")
        encoded, focus = cookie["market_live_weights"].value.split(".")
        weights = [int(value) for value in encoded]
    except (CookieError, ValueError, KeyError):
        return DEFAULTS
    if len(weights) != len(TOPICS) or any(not 0 <= w < len(WEIGHT_LEVELS) for w in weights):
        return DEFAULTS
    return Preferences(dict(zip(TOPICS, weights)), focus if focus in FOCUS_LEVELS else DEFAULTS.focus)


def pattern(terms):
    return re.compile(r"\b(?:" + terms + r")\b", re.IGNORECASE)


METALS = pattern(
    r"(?:gold|silver|platinum|palladium|copper) (?:price[s]?|futures|bullion|rall\w+|"
    r"gain\w*|rise\w*|fall\w*|drop\w*|jump\w*|hit\w*|slid\w*|slip\w*|"
    r"tumble\w*|soar\w*|settle\w*|slump\w*|sink\w*|climb\w*|edg\w*|hold\w*|"
    r"demand|surplus|deficit|fund[s]?|ETF[s]?)|precious metals|bullion|SLV|GLD|"
    r"Treasury (?:yield[s]?|bond[s]?|note[s]?|auction[s]?|selloff)|"
    r"bond (?:yield[s]?|market[s]?|selloff)|(?:10|30)[- ]year yield[s]?|real yield[s]?|"
    r"(?:U\.S\. )?dollar (?:index|strengthens|weakens|falls|rises|slides|rallies|gains|"
    r"hits|holds|edges|sinks|slips)|greenback|yen|Bank of Japan|ECB"
)
CRYPTO = pattern(r"Bitcoin|BTC|Ethereum|Ether|ETH|IBIT|ETHA1?|FBTC|FETH|crypto(?:currency)?")
CRYPTO_EVENT = pattern(
    r"ETF[s]?|ETP[s]?|(?:in|out)flow[s]?|liquidation[s]?|"
    r"SEC|CFTC|regulat\w+|legislation|custody|staking|stablecoin[s]?|"
    r"plung\w+|selloff|rall\w+|tumble\w+|record high|all-time high"
)
WORLD = pattern(
    r"tariff[s]?|trade (?:war|deal|talks?|restrictions?)|"
    r"export (?:controls?|curbs?|bans?)|sanction[s]?|OPEC(?:\+)?|"
    r"oil (?:price[s]?|supply|output|shipment[s]?)|Hormuz|"
    r"shipping (?:lane[s]?|disruption[s]?)|ceasefire|government shutdown|debt ceiling"
)
MARKETS = pattern(
    r"stock[s]?|stock market[s]?|shares|futures|Wall Street|S&P(?: 500)?|Nasdaq|"
    r"Dow(?: Jones)?|earnings|quarterly results|profit forecast|revenue forecast|"
    r"outlook|guidance|selloff|Federal Reserve|the Fed|FOMC|interest rates|rate (?:cut[s]?|hike[s]?)|"
    r"inflation|consumer prices|producer prices|payrolls|jobless claims|"
    r"job[s]? report|labor market|GDP|PCE|retail sales|implied move|options volume|short interest|"
    r"volatility index|VIX|credit spreads?"
)
ENERGY = pattern(
    r"crude oil|oil (?:prices?|supply|output|shipments?|inventor\w+)|Brent|WTI|OPEC|"
    r"natural gas|LNG|gasoline inventories|uranium|commodity futures|copper|iron ore"
)
TECH = pattern(
    r"artificial intelligence|AI|semiconductor[s]?|chipmakers?|Nvidia|Broadcom|ServiceNow|"
    r"OpenAI|Anthropic|data cent(?:er|re)s?|cybersecurity|cloud computing"
)
PROMOTIONAL = pattern(r"sponsored content|advertorial|paid partnership|press release distribution|coupon codes?")
LOW_SIGNAL = pattern(
    r"personal finance|credit card[s]?|"
    r"my portfolio|Jim Cramer|Mad Money|here.s (?:what|where|how) (?:I|to buy)|"
    r"these \d+ stocks|stocks to buy|analyst picks|price prediction|"
    r"technical analysis|market minute|what to watch (?:today|this week)|"
    r"will benefit from|says (?:an )?analyst"
)
COMMENTARY_PREFIX = re.compile(r"^\s*(?:column|opinion|analysis)\s*:", re.IGNORECASE)
CORE_RELEASE = pattern(
    r"FOMC (?:statement|minutes|decision)|consumer price index|producer price index|CPI(?!\s*\((?:M|ML)\)|-M\b)|"
    r"PPI|PCE|personal income and outlays|gross domestic product|GDP|payroll(?:s| employment)?|"
    r"jobless claims|jobs report|job openings|unemployment rate|retail sales|"
    r"sales for retail and food services|Treasury auction results"
)
MAJOR_RELEASES = {
    "U.S. Census Bureau": pattern(r"U\.S\. retail sales"),
    "Federal Reserve": pattern(r"FOMC statement|minutes of the Federal Open Market Committee"),
    "BLS · CPI": pattern(r"CPI|consumer price index"),
    "BLS · Employment": pattern(r"employment situation|payroll|unemployment rate"),
    "BLS · PPI": pattern(r"PPI|producer price index"),
    "BEA": pattern(r"gross domestic product|personal income and outlays"),
}
FED_POLICY = pattern(
    r"rate (?:cuts?|hikes?|decision|path)|(?:cut|raise|hold|lower)\w* (?:interest |policy )?rates|"
    r"monetary policy|Fed.{0,60}(?:rates|inflation|outlook)|interest rates"
)
OPTIONS = pattern(
    r"implied (?:move|volatility)|options (?:traders?|prices?|markets?|volumes?|open interest)|"
    r"volatility skew|VIX|short interest"
)
EARNINGS = pattern(
    r"earnings|quarterly results|(?:raises?|cuts?|lowers?|boosts?) (?:\w+ ){0,2}(?:outlook|guidance)|"
    r"(?:revenue|profit|margin[s]?) (?:forecast|miss\w*|beat\w*)|capex"
)
WATCHLIST = re.compile(
    r"\b(?:(?i:Nvidia|Broadcom|ServiceNow)|NVDA|AVGO|SPY|QQQ|SLV|GLD|IBIT|ETHA1?)\b|\$NOW\b"
)
CORE_CRYPTO = pattern(r"Bitcoin|BTC|Ethereum|Ether|ETH|IBIT|ETHA1?|FBTC|FETH")
ETF = pattern(r"ETF[s]?|ETP[s]?|(?:in|out)flow[s]?|SEC|custody|staking")
METAL_DRIVER = pattern(
    r"(?:gold|silver) (?:prices?|futures|trades?|rises?|falls?)|bullion|SLV|GLD|"
    r"real yield[s]?|Treasury yields?|(?:10|30)[- ]year yields?|dollar index|"
    r"greenback|Bank of Japan|ECB (?:rate|decision)"
)
SUPPLY_RISK = pattern(
    r"Hormuz|OPEC|oil (?:suppl\w+|output|inventor\w+|production|imports?|exports?)|"
    r"natural gas storage|shipping disruption[s]?|"
    r"export (?:controls?|curbs?|bans?)|government shutdown|debt ceiling|"
    r"U\.S\..{0,38}tariff[s]?|tariff[s]?.{0,38}U\.S\."
)
TECH_CATALYST = pattern(
    r"AI (?:spending|investment|capex|infrastructure)|chip shortages?|"
    r"data cent(?:er|re)s? (?:spending|investment|demand|boom)"
)


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    home: str
    topic: str = ""
    include: re.Pattern | None = None
    via: str = ""
    recurring: bool = False
    dated_identity: bool = False
    news_days: int = 3
    wire: bool = False
    interval: int = REFRESH_SECONDS
    publisher: str = ""
    sitemap_prefix: str = ""


def google_news(query):
    return "https://news.google.com/rss/search?" + urlencode(
        {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}
    )


AP_MAGAZINES = (
    ("Business", "business-and-finance-pbj3bpclz", "markets"),
    ("International", "international-news-miluvhmaz", "world"),
    ("Politics", "politics-h8vn14lnz", "world"),
    ("U.S.", "u.s.-news-lhl4uphvz", "general"),
    ("Technology", "technology-uvt65hdqz", "tech"),
    ("Asia", "asia-c2h6qh4lz", "world"),
    ("Health", "health-l59qepnvz", "general"),
    ("Sports", "sports-uv5v9mtcz", "general"),
    ("Entertainment", "entertainment-qju7ofhsz", "general"),
)


SOURCES = (
    Source("Federal Reserve", "https://www.federalreserve.gov/feeds/press_monetary.xml",
           "https://www.federalreserve.gov/feeds/feeds.htm", "releases"),
    Source("Fed speeches", "https://www.federalreserve.gov/feeds/speeches_and_testimony.xml",
           "https://www.federalreserve.gov/feeds/feeds.htm", "releases",
           pattern(r"economic outlook|monetary policy|inflation|labor market|financial stability|Treasury market")),
    Source("Bank of England", "https://www.bankofengland.co.uk/rss/news",
           "https://www.bankofengland.co.uk/news", "releases",
           pattern(r"monetary policy|inflation|Bank Rate|policy statement")),
    Source("Bank of Japan", "https://www.boj.or.jp/en/rss/whatsnew.xml",
           "https://www.boj.or.jp/en/", "releases",
           pattern(r"monetary policy|outlook for economic activity|policy rate")),
    Source("BLS · CPI", "https://www.bls.gov/feed/cpi.rss", "https://www.bls.gov/feed/",
           "releases", recurring=True),
    Source("BLS · Employment", "https://www.bls.gov/feed/empsit.rss", "https://www.bls.gov/feed/",
           "releases", recurring=True),
    Source("BLS · PPI", "https://www.bls.gov/feed/ppi.rss", "https://www.bls.gov/feed/",
           "releases", recurring=True),
    Source("BLS · JOLTS", "https://www.bls.gov/feed/jolts.rss", "https://www.bls.gov/feed/",
           "releases", recurring=True),
    Source("BEA", "https://apps.bea.gov/rss/rss.xml", "https://www.bea.gov/news/schedule",
           "releases", pattern(r"gross domestic product|personal income and outlays|international trade")),
    Source("U.S. Census Bureau", "https://www.census.gov/economic-indicators/indicator.xml",
           "https://www.census.gov/economic-indicators/", "releases", recurring=True, dated_identity=True),
    Source("SEC", "https://www.sec.gov/news/pressreleases.rss", "https://www.sec.gov/newsroom/press-releases",
           "releases", pattern(r"crypto\w*|digital assets?|exchange.traded|market structure|options clearing")),
    Source("U.S. Treasury", "https://treasurydirect.gov/TA_WS/securities/auctioned/rss",
           "https://treasurydirect.gov/rss/", "releases", pattern(r"(?:10|20|30)-Year|TIPS"), recurring=True),
    Source("CNBC · Top News", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "https://www.cnbc.com/",
           wire=True, interval=15),
    Source("CNBC · Earnings", "https://www.cnbc.com/id/15839135/device/rss/rss.html",
           "https://www.cnbc.com/earnings/", wire=True),
    Source("CNBC · Business", "https://www.cnbc.com/id/10001147/device/rss/rss.html",
           "https://www.cnbc.com/business/", "markets", wire=True, interval=15),
    Source("Bloomberg · Economics", "https://www.bloomberg.com/feeds/economics/news.rss",
           "https://www.bloomberg.com/economics", "markets", wire=True),
    Source("Bloomberg · Markets", "https://www.bloomberg.com/feeds/markets/news.rss",
           "https://www.bloomberg.com/markets", "markets", wire=True, interval=5),
    Source("Benzinga", "https://www.benzinga.com/feed", "https://www.benzinga.com/", "markets", wire=True, interval=10),
    Source("FinancialJuice · Public RSS", "https://www.financialjuice.com/feed.ashx?xy=rss",
           "https://www.financialjuice.com/", "markets", wire=True, interval=60),
    Source("FXStreet", "https://xml.fxstreet.com/news/forex-news/index.xml",
           "https://www.fxstreet.com/news", "metals", wire=True, interval=60),
    Source("Seeking Alpha · Market News", "https://seekingalpha.com/market_currents.xml",
           "https://seekingalpha.com/market-news", "markets", wire=True, interval=5),
    Source("Seeking Alpha · News Index", "https://seekingalpha.com/sitemap_news.xml",
           "https://seekingalpha.com/market-news", "markets", wire=True,
           publisher="Seeking Alpha", sitemap_prefix="/news/"),
    Source("Seeking Alpha · Analysis", "https://seekingalpha.com/feed.xml",
           "https://seekingalpha.com/", "markets", wire=True),
    Source("Seeking Alpha · Transcripts", "https://seekingalpha.com/sector/transcripts.xml",
           "https://seekingalpha.com/earnings/earnings-call-transcripts", "markets", wire=True),
    Source("Financial Times · Markets", "https://www.ft.com/markets?format=rss",
           "https://www.ft.com/markets", "markets", wire=True),
    Source("Financial Times · Companies", "https://www.ft.com/companies?format=rss",
           "https://www.ft.com/companies", "markets"),
    Source("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories",
           "https://www.marketwatch.com/", "markets", wire=True),
    Source("Cboe", "https://www.cboe.com/insights/rss/", "https://www.cboe.com/insights/", "markets", news_days=10),
    Source("Nvidia · Newsroom", "https://nvidianews.nvidia.com/cats/press_release.xml",
           "https://nvidianews.nvidia.com/", "tech"),
    Source("ServiceNow · Investor Relations", "https://investor.servicenow.com/rss/pressrelease.aspx",
           "https://investor.servicenow.com/", "tech", news_days=14),
    Source("Kitco", "https://www.kitco.com/news/rss/kitconewsfeedextended.xml", "https://www.kitco.com/news",
           "metals"),
    Source("U.S. EIA", "https://www.eia.gov/rss/todayinenergy.xml", "https://www.eia.gov/todayinenergy/", "energy"),
    Source("Oilprice", "https://oilprice.com/rss/main", "https://oilprice.com/", "energy"),
    Source("Rigzone", "https://www.rigzone.com/news/rss/rigzone_latest.aspx", "https://www.rigzone.com/news/", "energy"),
    Source("Associated Press", "https://flipboard.com/@AssociatedPress.rss", "https://apnews.com/",
           via="Flipboard", wire=True, interval=60),
    *(Source(f"Associated Press · {name}", f"https://flipboard.com/@associatedpress/{slug}.rss",
             "https://apnews.com/", topic, via="Flipboard", wire=True, interval=90)
      for name, slug, topic in AP_MAGAZINES),
    Source("Associated Press · News Index", google_news("when:24h site:apnews.com"),
           "https://apnews.com/", via="Google News", wire=True, interval=180, publisher="AP News"),
    Source("Reuters", google_news("site:reuters.com when:24h"), "https://www.reuters.com/",
           via="Google News", wire=True, publisher="Reuters"),
    Source("Reuters · Business", google_news("site:reuters.com/business when:2d"),
           "https://www.reuters.com/business/", "markets", via="Google News",
           wire=True, interval=180, publisher="Reuters"),
    Source("BBC · World", "https://feeds.bbci.co.uk/news/world/rss.xml", "https://www.bbc.com/news/world", "world"),
    Source("NPR", "https://feeds.npr.org/1001/rss.xml", "https://www.npr.org/sections/news/"),
    Source("Guardian · World", "https://www.theguardian.com/world/rss", "https://www.theguardian.com/world", "world"),
    Source("Al Jazeera · English", "https://www.aljazeera.com/xml/rss/all.xml", "https://www.aljazeera.com/", "world"),
    Source("Le Monde · International", "https://www.lemonde.fr/en/international/rss_full.xml",
           "https://www.lemonde.fr/en/international/", "world"),
    Source("CNA · Asia", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511",
           "https://www.channelnewsasia.com/asia", "world"),
    Source("South China Morning Post", "https://www.scmp.com/rss/91/feed/", "https://www.scmp.com/", "world"),
    Source("The Hindu", "https://www.thehindu.com/news/feeder/default.rss", "https://www.thehindu.com/news/", "world"),
    Source("TechCrunch", "https://techcrunch.com/feed/", "https://techcrunch.com/", "tech"),
    Source("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index/", "https://arstechnica.com/", "tech"),
    Source("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "https://www.coindesk.com/",
           "crypto", wire=True),
    Source("Cointelegraph · ETFs", "https://cointelegraph.com/rss/tag/etf", "https://cointelegraph.com/tags/etf",
           "crypto"),
)


@dataclass(frozen=True)
class Story:
    title: str
    url: str
    published: datetime
    topic: str
    source: Source
    guid: str
    summary: str = ""
    feed_preview: str = ""


@dataclass(frozen=True)
class Relevance:
    points: int
    reasons: tuple[str, ...]


def relevance(story, preferences):
    title = story.title
    weight = preferences.weights[story.topic]
    if not weight:
        return Relevance(0, (f"{TOPICS[story.topic]} is off in your weights",))
    bonuses = (
        (CORE_RELEASE.search(title), 14, "Economic release" if story.topic == "releases" else "Economic data coverage"),
        (FED_POLICY.search(title), 12, "Rate policy"),
        (OPTIONS.search(title), 14, "Options or positioning"),
        (EARNINGS.search(title), 8, "Earnings or guidance"),
        (WATCHLIST.search(title), 5, "Watched ticker"),
        (CORE_CRYPTO.search(title) and ETF.search(title), 18, "BTC or ETH funds and policy"),
        (METAL_DRIVER.search(title), 10, "Metals, dollar or yields"),
        (SUPPLY_RISK.search(title), 17, "Trade, supply or policy risk"),
        (TECH_CATALYST.search(title), 16, "AI investment or chip supply"),
    )
    matched = [(points, reason) for match, points, reason in bonuses if match]
    matched.sort(key=lambda match: -match[0])
    topic_reason = f"{TOPICS[story.topic]} priority" if weight == 4 else f"{TOPICS[story.topic]} weight"
    penalty = 12 if LOW_SIGNAL.search(title) or COMMENTARY_PREFIX.search(title) else 0
    score = max(0, weight * 8 + min(24, sum(points for points, _ in matched)) - penalty)
    reasons = tuple(reason for _, reason in matched[:2]) or (topic_reason,)
    if penalty:
        reasons += ("Commentary discount",)
    return Relevance(score, reasons)


def priority_level(points):
    if points >= 46:
        return "Top"
    if points >= 32:
        return "High"
    return "Standard"


@dataclass(frozen=True)
class SourceStatus:
    story_list: tuple[Story, ...] = ()
    checked: datetime | None = None
    success: datetime | None = None
    latest: datetime | None = None
    read_count: int = 0
    error: str = ""
    retry_seconds: float = 0
    matched_count: int = 0
    etag: str = ""
    last_modified: str = ""
    cache_seconds: int = 0
    unchanged: bool = False


def now_utc():
    return datetime.now(UTC)


def clean_text(text):
    return " ".join(unescape(re.sub(r"<[^>]+>", "", text)).split())


def publication_time(raw):
    try:
        date = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            date = parsedate_to_datetime(raw)
        except (ValueError, IndexError, TypeError):
            return None
    return date.astimezone(UTC) if date and date.tzinfo else None


def article_url(raw, base):
    url = urlsplit(urljoin(base, raw))
    if not raw or url.scheme not in {"http", "https"} or not url.hostname or url.username:
        return ""
    query = [(name, value) for name, value in parse_qsl(url.query, keep_blank_values=True)
             if not name.lower().startswith("utm_") and name.lower() not in {"fbclid", "gclid", "__source"}]
    if url.hostname == "seekingalpha.com":
        query = [(name, value) for name, value in query if name != "feed_item_type"]
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), url.fragment))


def classify(source, title):
    if PROMOTIONAL.search(title):
        return None
    if source.include and not source.include.search(title):
        return None
    if source.topic == "releases":
        return "releases"
    if CRYPTO.search(title) and (source.topic == "crypto" or CRYPTO_EVENT.search(title)):
        return "crypto"
    if METALS.search(title):
        return "metals"
    if WORLD.search(title):
        return "world"
    if ENERGY.search(title):
        return "energy"
    if MARKETS.search(title):
        return "markets"
    if TECH.search(title):
        return "tech"
    return source.topic or "general"


def node_values(node, feed_format):
    if feed_format == "sitemap":
        return (
            node.findtext(f"{NEWS_SITEMAP}news/{NEWS_SITEMAP}title", ""),
            node.findtext(SITEMAP + "loc", ""),
            node.findtext(f"{NEWS_SITEMAP}news/{NEWS_SITEMAP}publication_date", ""),
        )
    if feed_format == "atom":
        for link in node.findall(ATOM + "link"):
            if link.get("rel", "alternate") == "alternate":
                break
        else:
            link = {}
        return (
            node.findtext(ATOM + "title", ""),
            link.get("href", ""),
            node.findtext(ATOM + "published") or node.findtext(ATOM + "updated", ""),
        )
    return (node.findtext("title", ""), node.findtext("link", ""), node.findtext("pubDate", ""))


def census_retail_headline(description):
    # The Census feed puts the release summary before its HTML comparison table.
    summary, *comparison = re.split(r"<p\b[^>]*>", description, maxsplit=1, flags=re.IGNORECASE)
    summary = clean_text(summary)
    period = re.search(r"retail and food services sales for ([A-Z][a-z]+ \d{4})\b", summary)
    title = f"U.S. retail sales · {period.group(1)}" if period else "U.S. retail sales"
    for line in re.split(r"<br\s*/?>", "".join(comparison), flags=re.IGNORECASE):
        previous = re.fullmatch(
            r"([A-Z][a-z]+ \d{4})(?: \(r\))?: ([+-]?\d+(?:\.\d+)?)\s*% Change",
            clean_text(line),
        )
        if period and previous and previous.group(1) != period.group(1):
            summary += f" {previous.group(1)}: {previous.group(2)}% month over month."
            break
    return title, summary


def cache_lifetime(headers, default=0):
    match = re.search(r'(?:^|,)\s*max-age\s*=\s*"?(\d{1,9})', headers.get("Cache-Control", ""), re.IGNORECASE)
    return int(match.group(1)) if match else default


def fetch(source, previous):
    checked = now_utc()
    try:
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/rss+xml, application/atom+xml, text/xml, */*",
        }
        if previous.etag:
            headers["If-None-Match"] = previous.etag
        if previous.last_modified:
            headers["If-Modified-Since"] = previous.last_modified
        request = Request(source.url, headers=headers)
        with urlopen(request, timeout=9) as response:
            payload = response.read(1_500_001)
            if len(payload) > 1_500_000:
                raise ValueError("feed exceeds size limit")
            base = response.geturl()
            etag = response.headers.get("ETag", "")
            last_modified = response.headers.get("Last-Modified", "")
            cache_seconds = cache_lifetime(response.headers)
        # Kitco's feed includes HTML non-breaking spaces in its XML.
        root = ET.fromstring(payload.replace(b"&nbsp;", b"&#160;"))
        if root.tag == SITEMAP + "urlset" and source.sitemap_prefix:
            feed_format, selector = "sitemap", SITEMAP + "url"
        elif root.tag == ATOM + "feed":
            feed_format, selector = "atom", ATOM + "entry"
        else:
            feed_format, selector = "rss", "./channel/item"
        nodes = root.findall(selector)
        if not nodes:
            raise ValueError("no entries in the expected feed format")
        valid_dates = []
        stories = []
        for node in nodes:
            raw_title, raw_url, raw_date = node_values(node, feed_format)
            if feed_format == "sitemap":
                location = urlsplit(raw_url)
                publisher = node.findtext(f"{NEWS_SITEMAP}news/{NEWS_SITEMAP}publication/{NEWS_SITEMAP}name", "")
                if (location.hostname != urlsplit(source.home).hostname
                        or not location.path.startswith(source.sitemap_prefix) or publisher.strip() != source.publisher):
                    continue
            elif source.publisher:
                if node.findtext("source", "").strip().casefold() != source.publisher.casefold():
                    continue
                raw_title = re.sub(r"\s+-\s+" + re.escape(source.publisher) + r"\s*$", "", raw_title,
                                   flags=re.IGNORECASE)
            published = publication_time(raw_date)
            if not published or published > checked + timedelta(minutes=2):
                continue
            valid_dates.append(published)
            title = clean_text(raw_title)
            if not title:
                continue
            topic = classify(source, title)
            if not topic:
                continue
            if source.name == "U.S. Treasury":
                # The top-level link is a generic auction page. The details carry the result PDF.
                details = node.findtext("description", "")
                result = re.search(
                    r'https://(?:www\.)?treasurydirect\.gov/(?:[\w-]+/)*R_\d+_\d+\.pdf', details
                )
                if not result:
                    raise ValueError("eligible Treasury auction is missing its result PDF")
                raw_url = result.group()
                high_yield = re.search(r"High Yield:</strong>\s*(\d+(?:\.\d+)?%)", details)
                if high_yield:
                    title += f" · High yield {high_yield.group(1)}"
            url = article_url(raw_url, base)
            if not url:
                continue
            identity = f"{url}|{published.isoformat()}" if source.dated_identity else url
            guid = "urn:sha256:" + sha256(identity.encode()).hexdigest()
            summary = ""
            if source.name == "U.S. Census Bureau" and node.findtext("guid") == "retail_sales":
                title, summary = census_retail_headline(node.findtext("description", ""))
            elif source.recurring:
                title += " · " + published.date().isoformat()
            preview_node = ATOM + "summary" if feed_format == "atom" else "description"
            feed_preview = clean_text(node.findtext(preview_node, "")[:4000])
            stories.append(Story(title, url, published, topic, source, guid, summary, feed_preview))
        if not valid_dates:
            raise ValueError("no usable publication timestamps")
        return SourceStatus(tuple(stories), checked, now_utc(), max(valid_dates), len(nodes),
                            matched_count=len(stories), etag=etag, last_modified=last_modified,
                            cache_seconds=cache_seconds)
    except HTTPError as error:
        headers = error.headers or {}
        if error.code == 304 and previous.success:
            return replace(previous, checked=checked, success=now_utc(), error="", retry_seconds=0,
                           etag=headers.get("ETag", previous.etag),
                           last_modified=headers.get("Last-Modified", previous.last_modified),
                           cache_seconds=cache_lifetime(headers, previous.cache_seconds), unchanged=True)
        retry_seconds = max(30, min(300, previous.retry_seconds * 2))
        if error.code in {429, 503}:
            retry = headers.get("Retry-After", "")
            retry_time = publication_time(retry)
            seconds = float(retry) if retry.isascii() and retry.isdecimal() else 0
            if retry_time:
                seconds = (retry_time - now_utc()).total_seconds()
            retry_seconds = max(300, seconds)
        return replace(previous, checked=checked, error=str(error), retry_seconds=retry_seconds)
    except (OSError, ET.ParseError, ValueError) as error:
        return replace(previous, checked=checked, error=str(error),
                       retry_seconds=max(30, min(300, previous.retry_seconds * 2)))


def fresh_until(story):
    days = 24 if story.topic == "releases" else story.source.news_days
    return story.published + timedelta(days=days)


class PreviewMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.head = True
        self.descriptions = {}

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.head = False
        if self.head and tag == "meta":
            fields = dict(attrs)
            name = (fields.get("property") or fields.get("name") or "").casefold()
            if name in {"og:description", "twitter:description", "description"} and fields.get("content"):
                self.descriptions.setdefault(name, fields["content"])

    def handle_endtag(self, tag):
        if tag == "head":
            self.head = False


def preview_origin(url):
    location = urlsplit(url)
    if location.scheme != "https" or location.username or location.password or location.port not in {443, None}:
        return ""
    return (location.hostname or "").removeprefix("www.")


class SamePublisherRedirect(HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if preview_origin(req.full_url) != preview_origin(newurl):
            raise HTTPError(req.full_url, code, "Different publisher", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@lru_cache(maxsize=192)
def public_descriptions(url, publisher, cache_period):
    try:
        if not publisher or publisher != preview_origin(url):
            return ()
        request = Request(url, headers={"User-Agent": "MarketNewsLive/1.0", "Accept": "text/html"})
        with build_opener(SamePublisherRedirect()).open(request, timeout=3) as response:
            if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
                return ()
            raw = response.read(196608)
            encoding = response.headers.get_content_charset() or "utf-8"
        parser = PreviewMetadata()
        parser.feed(raw.decode(encoding, errors="replace"))
        return tuple(parser.descriptions.get(key, "") for key in ("og:description", "twitter:description", "description"))
    except (OSError, LookupError, ValueError):
        return ()


def preview_excerpt(candidate, title):
    text = clean_text(candidate)
    words = text.split()
    if len(words) < 6 or PROMOTIONAL.search(text):
        return ""
    headline = set(re.findall(r"\w+", title.casefold()))
    preview = set(re.findall(r"\w+", text.casefold()))
    if len(preview - headline) < 4:
        return ""
    return text if len(words) <= 24 else " ".join(words[:24]).rstrip(" ,;:—") + "…"


def article_preview(story):
    if story.summary:
        return {"text": story.summary, "origin": "Official release"}
    try:
        publisher = preview_origin(story.source.home)
    except ValueError:
        publisher = ""
    descriptions = public_descriptions(story.url, publisher, int(monotonic()) // 900)
    for candidate in descriptions:
        excerpt = preview_excerpt(candidate, story.title)
        if excerpt:
            return {"text": excerpt, "origin": "Publisher preview"}
    excerpt = preview_excerpt(story.feed_preview, story.title)
    if excerpt:
        return {"text": excerpt, "origin": "Publisher feed"}
    return {"text": "A public preview is unavailable for this story.", "origin": ""}


def source_state(source, status, now):
    if not status.checked:
        return "Checking"
    if status.error:
        limit = timedelta(hours=6 if source.topic == "releases" else 1)
        return "Cached" if status.success and now - status.success < limit else "Unavailable"
    max_age = timedelta(days=45 if source.topic == "releases" else source.news_days)
    return "Quiet" if now - status.latest > max_age else "Online"


def available_stories(statuses, *, wire_only=False):
    now = now_utc()
    candidates = []
    for source, status in statuses.items():
        eligible = source.wire if wire_only else source_state(source, status, now) in {"Online", "Cached"}
        if eligible:
            candidates.extend(story for story in status.story_list if fresh_until(story) > now)
    # Direct articles win over redirect URLs for the same headline.
    candidates.sort(key=lambda story: (story.source.via == "Google News", bool(story.source.via),
                                       bool(story.source.sitemap_prefix), -story.published.timestamp()))
    stories = []
    seen_guids = set()
    seen_titles = set()
    for story in candidates:
        headline = re.sub(r"[^\w]+", " ", story.title.casefold()).strip()
        if wire_only:
            publisher = story.source.name.split(" · ", 1)[0]
            headline = (publisher, headline)
        if story.guid in seen_guids or headline in seen_titles:
            continue
        stories.append(story)
        seen_guids.add(story.guid)
        seen_titles.add(headline)
    return stories


def story_index(stories, scores, preferences, focused, rank):
    threshold = FOCUS_LEVELS[preferences.focus][1]
    if focused:
        stories = [story for story in stories if scores[story.guid].points >= threshold]
    if rank:
        now = now_utc()

        def priority(story):
            age_hours = (now - story.published).total_seconds() / 3600
            freshness = max(0, 8 - age_hours / 6)
            return scores[story.guid].points + freshness, story.published

        stories = sorted(stories, key=priority, reverse=True)
    else:
        stories = sorted(stories, key=lambda story: story.published, reverse=True)
    by_topic = {topic: [] for topic in TOPICS}
    selected = []
    for story in stories:
        group = by_topic[story.topic]
        if not focused or len(group) < FOCUSED_LIMITS[story.topic]:
            group.append(story)
            selected.append(story)
    return selected, by_topic


def key_releases(stories, now):
    recent = []
    for story in stories:
        pattern = MAJOR_RELEASES.get(story.source.name)
        if story.topic == "releases" and pattern and pattern.search(story.title) and now - story.published < timedelta(hours=24):
            recent.append(story)
    return sorted(recent, key=lambda story: story.published, reverse=True)[:2]


def restore_wire_history(database, statuses, now):
    with database:
        database.execute("PRAGMA auto_vacuum = INCREMENTAL")
        database.execute("""
            CREATE TABLE IF NOT EXISTS wire_entries (
                feed TEXT, guid TEXT, title TEXT, link TEXT, published TEXT, topic TEXT,
                summary TEXT, expires TEXT, PRIMARY KEY (feed, guid)
            )
        """)
        database.execute("CREATE INDEX IF NOT EXISTS wire_expiry ON wire_entries (expires)")
        prune_wire_history(database, now)
    sources = {source.url: source for source in statuses if source.wire}
    restored = {source: [] for source in sources.values()}
    for feed, guid, title, link, published, summary in database.execute(
        "SELECT feed, guid, title, link, published, summary FROM wire_entries"
    ):
        source = sources.get(feed)
        stamp = publication_time(published)
        if not source or not stamp:
            continue
        topic = classify(source, title)
        if topic:
            restored[source].append(Story(title, link, stamp, topic, source, guid, summary))
    for source, entries in restored.items():
        statuses[source] = SourceStatus(story_list=tuple(entries))


def prune_wire_history(database, now):
    database.execute("DELETE FROM wire_entries WHERE expires <= ?", (now.isoformat(),))
    database.execute("""
        DELETE FROM wire_entries WHERE rowid IN (
            SELECT rowid FROM (
                SELECT rowid, row_number() OVER (PARTITION BY feed ORDER BY published DESC, guid) AS position
                FROM wire_entries
            ) WHERE position > ?
        )
    """, (MAX_FEED_STORIES,))
    database.execute("""
        DELETE FROM wire_entries WHERE rowid IN (
            SELECT rowid FROM wire_entries ORDER BY published DESC, feed, guid LIMIT -1 OFFSET ?
        )
    """, (MAX_ARCHIVE_STORIES,))


def save_wire_history(database, stories, now):
    rows = [
        (story.source.url, story.guid, story.title, story.url, story.published.isoformat(),
         story.topic, story.summary, fresh_until(story).isoformat())
        for story in stories if fresh_until(story) > now
    ]
    with database:
        database.executemany("""
            INSERT INTO wire_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (feed, guid) DO UPDATE SET title=excluded.title, link=excluded.link,
                published=excluded.published, topic=excluded.topic, summary=excluded.summary,
                expires=excluded.expires
        """, rows)
        prune_wire_history(database, now)


class News:
    def __init__(self):
        self.snapshot = ({source: SourceStatus() for source in SOURCES}, None)
        self.preference_token = token_urlsafe(24)
        self.stop = Event()
        self.wakeup = Event()
        self.activity_lock = Lock()
        self.active_until = 0.0
        self.preview_slots = BoundedSemaphore(2)
        self.archive_error = ""

    def renew(self):
        with self.activity_lock:
            self.active_until = monotonic() + ACTIVE_SECONDS
        self.wakeup.set()

    def active(self):
        return monotonic() < self.active_until

    def refresh(self):
        with ThreadPoolExecutor(max_workers=FEED_WORKERS) as pool, ExitStack() as cleanup:
            archive = None
            try:
                WIRE_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
                archive = sqlite3.connect(WIRE_HISTORY_FILE)
                cleanup.callback(archive.close)
                restored = self.snapshot[0].copy()
                restore_wire_history(archive, restored, now_utc())
                self.snapshot = restored, None
            except (OSError, sqlite3.Error):
                self.archive_error = "Archive storage is unavailable."
                archive = None
            next_poll = dict.fromkeys(SOURCES, 0.0)
            pending = {}
            next_log = 0.0
            next_cleanup = monotonic() + JANITOR_SECONDS
            while not self.stop.is_set():
                started = monotonic()
                previous, _ = self.snapshot
                if started >= next_cleanup:
                    now = now_utc()
                    previous = {
                        source: replace(status, story_list=tuple(story for story in status.story_list if fresh_until(story) > now))
                        for source, status in previous.items()
                    }
                    self.snapshot = previous, self.snapshot[1]
                    if archive:
                        try:
                            with archive:
                                prune_wire_history(archive, now)
                                archive.execute("PRAGMA incremental_vacuum(64)")
                            self.archive_error = ""
                        except sqlite3.Error:
                            self.archive_error = "Archive cleanup is delayed."
                    next_cleanup = started + JANITOR_SECONDS
                active = self.active()
                due = sorted((source for source, deadline in next_poll.items()
                              if active and source not in pending and deadline <= started),
                             key=lambda source: source.interval)
                for source in due[:FEED_WORKERS - len(pending)]:
                    pending[source] = pool.submit(fetch, source, previous[source]), started
                idle = [deadline for source, deadline in next_poll.items() if active and source not in pending]
                timeout = min(5, max(0, min(idle, default=started + 5) - started))
                if len(pending) == FEED_WORKERS:
                    timeout = 5
                if not pending:
                    self.wakeup.wait(timeout)
                    self.wakeup.clear()
                    continue
                wait([future for future, _ in pending.values()], timeout=timeout, return_when=FIRST_COMPLETED)
                completed = [source for source, (future, _) in pending.items() if future.done()]
                if not completed:
                    continue
                statuses = previous.copy()
                captured = []
                for source in completed:
                    future, requested = pending.pop(source)
                    result = future.result()
                    finished = monotonic()
                    next_poll[source] = max(
                        requested + max(MIN_SOURCE_INTERVAL, source.interval, result.cache_seconds),
                        finished + result.retry_seconds,
                    )
                    if source.wire and not result.error and not result.unchanged:
                        entries = {story.guid: story for story in previous[source].story_list
                                   if fresh_until(story) > result.success}
                        captured.extend(story for story in result.story_list if entries.get(story.guid) != story)
                        entries.update((story.guid, story) for story in result.story_list)
                        retained = sorted(entries.values(), key=lambda story: story.published, reverse=True)
                        result = replace(result, story_list=tuple(retained[:MAX_FEED_STORIES]))
                    statuses[source] = result
                updated = now_utc()
                self.snapshot = statuses, updated
                if archive and captured:
                    try:
                        save_wire_history(archive, captured, updated)
                        self.archive_error = ""
                    except sqlite3.Error:
                        self.archive_error = "Archive writes are delayed."
                if monotonic() >= next_log:
                    online = sum(bool(status.success) and not status.error for status in statuses.values())
                    print(f"{updated.isoformat()} Sources responding: {online}/{len(statuses)}", flush=True)
                    next_log = monotonic() + 60


def display_source(source):
    return f"{source.name} via {source.via}" if source.via else source.name


def display_time(value, *, seconds=False):
    if not value:
        return "—"
    return value.astimezone(EASTERN or UTC).strftime("%b %d, %I:%M:%S %p %Z" if seconds else "%b %d, %I:%M %p %Z")


def view_path(path, topic="", view="focused", *, search="", date_range="", page=1):
    query = {}
    if topic:
        query["topic"] = topic
    if view != "focused":
        query["view"] = view
    if search:
        query["q"] = search
    if date_range:
        query["when"] = date_range
    if page > 1:
        query["page"] = page
    url = PREFIX + path
    return f"{url}?{urlencode(query)}" if query else url


def rss_payload(stories, scores, statuses, updated, topic, view):
    focused = view == "focused"
    title = f"{FEED_TITLE} · {TOPICS[topic]}" if topic else FEED_TITLE
    if not focused:
        title += f" · {VIEWS[view]}"
    root = ET.Element("rss", version="2.0")
    channel = ET.SubElement(root, "channel")
    ET.SubElement(channel, "title").text = title
    ET.SubElement(channel, "link").text = PUBLIC_ORIGIN + view_path("/", topic, view)
    failed = sum(bool(status.error) for status in statuses.values())
    description = {
        "focused": "Headlines selected by your relevance settings.",
        "wire": "Newest headlines available from public wire and publisher feeds.",
        "all": "Broad coverage with source feed timestamps and links.",
    }[view]
    if failed:
        description += f" {failed} source(s) degraded. See source status in the browser view."
    ET.SubElement(channel, "description").text = description
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "ttl").text = "1" if view == "wire" else str(REFRESH_SECONDS // 60)
    if updated:
        ET.SubElement(channel, "lastBuildDate").text = format_datetime(updated, usegmt=True)
    now = now_utc()
    for story in sorted(stories, key=lambda story: story.published, reverse=True):
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = f"[{TOPICS[story.topic]}] {story.title}"
        ET.SubElement(item, "link").text = story.url
        ET.SubElement(item, "guid", isPermaLink="false").text = story.guid
        ET.SubElement(item, "pubDate").text = format_datetime(story.published, usegmt=True)
        ET.SubElement(item, "category").text = TOPICS[story.topic]
        source_url = story.source.home if story.source.sitemap_prefix else story.source.url
        ET.SubElement(item, "source", url=source_url).text = display_source(story.source)
        desc = display_source(story.source)
        if focused:
            score = scores[story.guid]
            desc += f" · Relevance {score.points} · {', '.join(score.reasons)}"
        state = source_state(story.source, statuses[story.source], now)
        if state == "Cached" or view == "wire" and state in {"Checking", "Unavailable"}:
            desc += " · Cached"
        if story.summary:
            desc += "\n\n" + story.summary
        ET.SubElement(item, "description").text = desc
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


STYLE = """
:root { color-scheme:dark; --bg:#121614; --panel:#191f1c; --hover:#222a25; --line:#303a34;
  --text:#edf2ee; --muted:#afbbb2; --accent:#c2ef8a; --warn:#f8c18d; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.46 'Geist', 'Segoe UI', sans-serif; }
::selection { background:#3d5530; color:var(--text); }
main { width:min(100%,1280px); margin:auto; padding:0 32px 56px; }
header { display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:24px 0 20px; border-bottom:1px solid var(--line); }
h1 { margin:0; font-size:1.75rem; line-height:1.16; letter-spacing:-.03em; }
p { margin:0; }
.updated { margin-top:5px; }
.updated,.meta { color:var(--muted); font-size:.82rem; }
.key-release { padding:12px 0; border-bottom:1px solid var(--line); }
.key-release h2 { color:var(--accent); font-size:.8rem; font-weight:650; margin:0 0 3px; }
.key-release article + article { margin-top:8px; }
.key-release .headline { font-size:1.03rem; font-weight:650; }
.release-summary { max-width:80ch; margin-top:3px; font-size:.875rem; }
.release-meta { margin-top:5px; }
a { color:inherit; text-underline-offset:.19em; }
a:hover { color:var(--accent); }
:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden;
  clip-path:inset(50%); white-space:nowrap; }
.actions,.mode,.topics,.filters,.results,.pagination { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.control,.mode a,.topics a,.pagination a { display:inline-flex; align-items:center; justify-content:center;
  min-height:36px; padding:6px 10px; border:1px solid transparent; border-radius:5px; text-decoration:none;
  font:inherit; font-size:.875rem; white-space:nowrap; }
.control { background:var(--panel); border-color:#4a574e; color:var(--text); }
.control:hover,.mode a:hover,.topics a:hover,.pagination a:hover { background:var(--hover); color:var(--text); }
.primary { background:var(--accent); border-color:var(--accent); color:#182311; font-weight:650; }
.primary:hover { background:#d5f6aa; color:#182311; }
button { cursor:pointer; }
.tools { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:16px 0 12px; }
.mode { gap:2px; padding:2px; background:var(--panel); border:1px solid var(--line); border-radius:7px; }
.mode a { min-height:32px; padding:4px 12px; color:var(--muted); }
.mode a[aria-current] { background:#30402a; border-color:#51634a; color:var(--accent); font-weight:650; }
.filters { justify-content:end; min-width:0; }
.topic-filter { display:none; }
input[type=search] { width:min(29vw,330px); min-width:160px; caret-color:var(--accent); }
input,select { background:var(--panel); color:var(--text); border:1px solid #4a574e;
  border-radius:5px; font:inherit; font-size:.875rem; min-height:36px; padding:6px 10px; }
input::placeholder { color:var(--muted); opacity:1; }
.topics { gap:4px; padding-bottom:10px; border-bottom:1px solid var(--line); }
.topics a { color:var(--muted); }
.topics a[aria-current] { color:var(--accent); border-color:#465743; background:#263324; font-weight:650; }
.results { justify-content:space-between; gap:4px 12px; padding:16px 0 8px; }
.result-count,.when { font-variant-numeric:tabular-nums; }
.headline-table { width:100%; table-layout:fixed; border-collapse:collapse; }
.headline-table th { position:sticky; top:0; z-index:1; background:var(--panel);
  color:var(--muted); font-size:.78rem; font-weight:650; text-align:left; }
.headline-table th,.headline-table td { padding:9px 12px; border-bottom:1px solid var(--line); }
.headline-table td { vertical-align:middle; }
.headline-table tbody tr:hover { background:var(--panel); }
.time-col { width:112px; }
.headline-table .headline-col { padding-left:74px; }
.when { color:var(--text); font-size:.83rem; white-space:nowrap; }
.when small { display:block; color:var(--muted); font-size:.77rem; }
.headline-row { display:grid; grid-template-columns:18px 32px minmax(0,1fr); align-items:start; gap:6px; }
.headline { font-weight:625; font-size:.96rem; line-height:1.35; overflow-wrap:anywhere;
  text-decoration:none; }
.headline:hover { color:var(--accent); }
.byline { margin-top:3px; overflow-wrap:anywhere; }
.headline-row[data-priority="high"] :is(.headline,.byline) { opacity:.89; }
.headline-row[data-priority="standard"] :is(.headline,.byline) { opacity:.72; }
.headline-row:is([data-priority="high"],[data-priority="standard"]):is(:hover,:focus-within) :is(.headline,.byline) {
  opacity:1; }
@media(prefers-reduced-motion:no-preference) { .headline,.byline { transition:opacity 120ms ease-out; } }
.topic-releases { --topic-ink:#86dfc8; }
.topic-markets { --topic-ink:#a9bcff; }
.topic-metals { --topic-ink:#edc574; }
.topic-crypto { --topic-ink:#d2b0fa; }
.topic-world { --topic-ink:#f3aeb6; }
.topic-tech { --topic-ink:#84d0eb; }
.topic-energy { --topic-ink:#f2ac7e; }
.topic-general { --topic-ink:#bac5be; }
.topic-rail { position:relative; align-self:stretch; min-height:24px; pointer-events:none; }
.topic-rail-face { position:absolute; top:0; left:0; display:flex; align-items:center; justify-content:center;
  width:4px; height:100%; overflow:hidden; border-radius:3px; background:var(--topic-ink); color:#121614;
  transition:width 140ms ease-out; }
.topic-rail-label { display:none; writing-mode:vertical-rl; transform:rotate(180deg);
  font-size:.625rem; font-weight:700; line-height:1; white-space:nowrap; }
.headline-row:is(:hover,:focus-within) .topic-rail-face {
  z-index:2; width:18px; height:auto; min-height:100%; padding-block:5px; }
.headline-row:is(:hover,:focus-within) .topic-rail-label { display:block; }
@media(prefers-reduced-motion:reduce) { .topic-rail-face { transition:none; } }
.topic-mark { display:inline-flex; align-items:center; gap:6px; white-space:nowrap;
  color:var(--topic-ink,var(--muted)); }
.topic-link { font-weight:600; font-size:.81rem; text-decoration:none; }
.topic-link:hover { text-decoration:underline; }
.topics a .topic-mark { color:inherit; }
.topic-dot { width:7px; height:7px; border-radius:50%; flex:none; background:var(--topic-ink,var(--muted)); }
.why { position:relative; }
.why summary { display:grid; place-items:center; width:32px; height:25px; border-radius:4px;
  color:var(--priority-ink,var(--muted)); list-style:none; }
.why summary::-webkit-details-marker { display:none; }
.why summary:hover,.why[open] summary { background:var(--hover); }
.why-top { --priority-ink:#ffe3ad; }
.why-high { --priority-ink:#c6edae; }
.priority-bars { display:inline-flex; align-items:flex-end; gap:2px; height:14px; }
.priority-bars i { width:3px; height:5px; border-radius:1px; background:currentColor; }
.priority-bars i:nth-child(2) { height:9px; opacity:.24; }
.priority-bars i:nth-child(3) { height:14px; opacity:.24; }
.why-high .priority-bars i:nth-child(2),.why-top .priority-bars i { opacity:1; }
.why-detail { position:absolute; z-index:2; left:0; top:100%; width:min(240px,calc(100vw - 110px)); padding:9px 12px;
  color:var(--text); background:#263029; border:1px solid #526257; border-radius:6px; font-size:.82rem; }
.why-detail p { margin-top:4px; }
.article-tooltip { position:fixed; z-index:12; width:min(360px,calc(100vw - 24px)); padding:12px 14px;
  pointer-events:none; background:#1e1b15; border:1px solid #806940; border-radius:7px;
  color:#f1e9dc; box-shadow:0 8px 24px #0007; font-size:.88rem; }
.article-tooltip strong,.preview-inline strong { color:#ffe3ad; font-size:.8rem; }
.article-tooltip p,.preview-inline p { margin-top:5px; overflow-wrap:anywhere; }
.preview-origin { display:block; margin-top:6px; color:#c3b78f; font-size:.74rem; }
.preview-inline { border-top:1px solid #526257; margin-top:8px; padding-top:7px; }
.warn { color:var(--warn); }
.empty { padding:32px 12px; border-block:1px solid var(--line); }
.empty p + p { margin-top:5px; }
.pagination { justify-content:end; padding-top:12px; }
.pagination a { border-color:var(--line); }
summary { cursor:pointer; }
.source-status { margin-top:20px; padding-top:12px; border-top:1px solid var(--line); }
.source-status summary { width:max-content; max-width:100%; color:var(--muted); font-size:.85rem; }
.sources { list-style:none; padding:0; margin:8px 0 0; }
.sources li { border-bottom:1px solid var(--line); font-size:.84rem; padding:7px 0; display:flex;
  flex-wrap:wrap; gap:4px 12px; overflow-wrap:anywhere; }
.weight-form { max-width:640px; margin-top:18px; }
.weight-form fieldset { padding:0; border:0; margin:0 0 18px; }
.weight-form legend { font-weight:650; padding:6px 0; }
.field { display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:8px 0; border-bottom:1px solid var(--line); }
.field select { min-width:115px; }
.notice { margin:14px 0; color:var(--accent); }
@media(max-width:720px) {
  main { padding:0 16px 40px; }
  header { align-items:flex-start; flex-direction:column; padding:12px 0; gap:8px; }
  h1 { font-size:1.5rem; }
  .tools { align-items:flex-start; flex-direction:column; gap:8px; padding:12px 0;
    border-bottom:1px solid var(--line); }
  .filters { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; gap:6px; width:100%; }
  input[type=search] { grid-area:1 / 1 / 2 / 3; width:100%; min-width:0; }
  .filters button { grid-area:1 / 3; }
  .topic-filter { display:block; grid-area:2 / 2 / 3 / 4; min-width:0; }
  #date-filter { grid-area:2 / 1; width:100%; min-width:0; }
  .topics { display:none; }
  .headline-table th,.headline-table td { padding-inline:6px; }
  .headline-table .headline-col { padding-left:68px; }
  .time-col { width:72px; }
}
@media(max-width:390px) {
  .time-col { width:64px; }
  .when { font-size:.75rem; }
}
"""


NEWS_AUTO_REFRESH = """
<script>
(() => {
  if (window.parent === window) return;
  let checking = false;
  let nextActivity = 0;
  let retryAt = 0;
  function readingDetails() {
    return document.querySelector("#headline-results details[open], #featured-releases details[open]") ||
      document.activeElement?.closest("#headline-results, #featured-releases") ||
      !document.getElementById("article-tooltip").hidden;
  }
  function visibleStory() {
    if (window.scrollY < 24) return null;
    const tableHead = document.querySelector(".headline-table thead");
    const boundary = Math.max(0, tableHead?.getBoundingClientRect().bottom || 0);
    for (const row of document.querySelectorAll("tr[data-story]")) {
      const box = row.getBoundingClientRect();
      if (box.bottom > boundary && box.top < innerHeight) return [row.dataset.story, box.top];
    }
    return null;
  }
  function update(next, selector) {
    const current = document.querySelector(selector);
    const replacement = next.querySelector(selector);
    if (current && replacement && current.outerHTML !== replacement.outerHTML) current.replaceWith(replacement);
  }
  async function refresh() {
    if (checking || document.visibilityState !== "visible" || Date.now() < retryAt) return;
    checking = true;
    try {
      if (Date.now() >= nextActivity) {
        nextActivity = Date.now() + 20000;
        const activity = await fetch(new URL("activity", location.href), {
          method: "POST", headers: {"X-Live-News": "1"}
        });
        if (activity.status === 429) {
          retryAt = Date.now() + 15000;
          nextActivity = retryAt;
          return;
        }
      }
      const response = await fetch(window.location.href, {cache: "no-cache"});
      if (response.status === 429) retryAt = Date.now() + 15000;
      if (!response.ok || document.visibilityState !== "visible") return;
      const next = new DOMParser().parseFromString(await response.text(), "text/html");
      update(next, "header .updated");
      if (!document.querySelector(".source-status[open]")) update(next, ".source-status");
      if (readingDetails()) return;
      const anchor = visibleStory();
      const currentStyle = document.querySelector("head style");
      const nextStyle = next.querySelector("head style");
      if (currentStyle && nextStyle && currentStyle.textContent !== nextStyle.textContent) {
        currentStyle.textContent = nextStyle.textContent;
      }
      update(next, "#featured-releases");
      update(next, "#headline-results");
      if (anchor) {
        const row = document.querySelector(`tr[data-story="${CSS.escape(anchor[0])}"]`);
        if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor[1]);
      }
    } catch {
      // Keep the last rendered headlines visible during an interruption.
    } finally {
      checking = false;
    }
  }
  setInterval(refresh, __VIEW_REFRESH_MS__);
  document.addEventListener("visibilitychange", refresh);
  refresh();
})();
</script>
""".replace("__VIEW_REFRESH_MS__", str(VIEW_REFRESH_SECONDS * 1000))


ARTICLE_TOOLTIPS = """
<aside class="article-tooltip" id="article-tooltip" role="tooltip" hidden>
<strong>Article preview</strong><p></p><small class="preview-origin"></small></aside>
<script>
(() => {
  const tooltip = document.getElementById("article-tooltip");
  const previews = new Map();
  let active = null;
  let timer;
  const loading = {text: "Loading preview…", origin: ""};
  const unavailable = {text: "A public preview is unavailable for this story.", origin: ""};
  function preview(id) {
    if (!previews.has(id)) {
      if (previews.size >= 64) previews.delete(previews.keys().next().value);
      const url = new URL("preview", location.href);
      url.search = new URLSearchParams({id});
      previews.set(id, fetch(url)
        .then(r => r.ok ? r.json() : unavailable).catch(() => unavailable));
    }
    return previews.get(id);
  }
  function render(card, result) {
    card.querySelector("p").textContent = result.text;
    card.querySelector(".preview-origin").textContent = result.origin;
  }
  function position(anchor) {
    const box = anchor.getBoundingClientRect();
    const edge = 12;
    tooltip.style.left = Math.max(edge, Math.min(box.left, innerWidth - tooltip.offsetWidth - edge)) + "px";
    const below = box.bottom + 8;
    const above = box.top - tooltip.offsetHeight - 8;
    tooltip.style.top = (below + tooltip.offsetHeight <= innerHeight - edge ? below : Math.max(edge, above)) + "px";
  }
  function hide() {
    clearTimeout(timer);
    active = null;
    tooltip.hidden = true;
  }
  function queue(anchor) {
    if (anchor === active) return;
    hide();
    active = anchor;
    timer = setTimeout(async () => {
      if (active !== anchor || !anchor.isConnected) return;
      render(tooltip, loading);
      tooltip.hidden = false;
      position(anchor);
      const result = await preview(anchor.dataset.preview);
      if (active !== anchor || !anchor.isConnected) return;
      render(tooltip, result);
      position(anchor);
    }, 300);
  }
  document.addEventListener("pointerover", event => {
    const anchor = event.target.closest("a[data-preview]");
    if (anchor && event.pointerType !== "touch") queue(anchor);
  });
  document.addEventListener("pointerout", event => {
    if (active && active.contains(event.target) && !active.contains(event.relatedTarget)) hide();
  });
  document.addEventListener("focusin", event => {
    const anchor = event.target.closest("a[data-preview]");
    if (anchor && anchor.matches(":focus-visible")) queue(anchor);
  });
  document.addEventListener("focusout", event => {
    if (event.target === active) hide();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, {passive: true});
  window.addEventListener("resize", hide);
  document.addEventListener("toggle", async event => {
    const details = event.target;
    if (!details.dataset.preview || !details.open) return;
    const card = details.querySelector(".preview-inline");
    render(card, loading);
    render(card, await preview(details.dataset.preview));
  }, true);
})();
</script>
"""


def article_link(story, score):
    preview = f' data-preview="{story.guid}"' if priority_level(score.points) == "Top" else ""
    described = "article-link-behavior article-tooltip" if preview else "article-link-behavior"
    return (f'<a class="headline" href="{escape(story.url)}" target="_blank" '
            f'rel="noopener noreferrer" title="{escape(TOPICS[story.topic])}" '
            f'aria-describedby="{described}"{preview}>{escape(story.title)}</a>')


def topic_mark(topic):
    return (f'<span class="topic-mark topic-{topic}"><span class="topic-dot" aria-hidden="true"></span>'
            f'{escape(TOPIC_TABS[topic])}</span>')


def topic_rail(topic):
    return (f'<div class="topic-rail topic-{topic}" aria-hidden="true"><span class="topic-rail-face">'
            f'<span class="topic-rail-label">{escape(TOPIC_TABS[topic])}</span></span></div>')


def priority_signal(story, score, topic_path):
    level = priority_level(score.points)
    label = escape(f"{level} priority · {TOPICS[story.topic]}")
    explanation = escape(" · ".join(score.reasons))
    data = f' data-preview="{story.guid}"' if level == "Top" else ""
    preview = ('<div class="preview-inline"><strong>Article preview</strong><p></p>'
               '<small class="preview-origin"></small></div>' if data else "")
    return (
        f'<details class="why why-{level.lower()}"{data}>'
        f'<summary aria-label="{label}. Show relevance details" title="{label}">'
        f'<span class="priority-bars" aria-hidden="true"><i></i><i></i><i></i></span></summary>'
        f'<div class="why-detail"><a class="topic-link" href="{escape(topic_path)}">{topic_mark(story.topic)}</a>'
        f'<p>{level} priority · Relevance {score.points}</p><p>{explanation}</p>{preview}</div></details>'
    )


def headline_table(stories, statuses, scores, view, search, date_range):
    rows = []
    now = now_utc()
    for story in stories:
        path = view_path("/", story.topic, view, search=search, date_range=date_range)
        state = source_state(story.source, statuses[story.source], now)
        cached = (' · <strong class="warn">Cached</strong>' if state == "Cached"
                  or view == "wire" and state in {"Checking", "Unavailable"} else "")
        score = scores[story.guid]
        priority = priority_signal(story, score, path)
        stamp = story.published.astimezone(EASTERN or UTC)
        rows.append(
            f'<tr data-story="{story.guid}"><td><time class="when" title="Publisher feed timestamp" datetime="{stamp.isoformat()}">'
            f'{stamp.strftime("%I:%M %p").lstrip("0")}<small>{stamp.strftime("%b %d")}</small></time></td>'
            f'<td><div class="headline-row" data-priority="{priority_level(score.points).lower()}">'
            f'{topic_rail(story.topic)}{priority}<div>{article_link(story, score)}'
            f'<p class="meta byline">{escape(display_source(story.source))}{cached}</p></div></div></td></tr>'
        )
    zone = "ET" if EASTERN else "UTC"
    return (f'<table class="headline-table"><caption class="sr-only">News headlines</caption>'
            f'<thead><tr><th scope="col" class="time-col">Time ({zone})</th>'
            f'<th scope="col" class="headline-col">Headline &amp; source</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table>')


def release_panel(stories, statuses, scores, now):
    if not stories:
        return ""
    releases = []
    for story in stories:
        cached = ' · <strong class="warn">Cached</strong>' if source_state(
            story.source, statuses[story.source], now
        ) == "Cached" else ""
        summary = f'<p class="release-summary">{escape(story.summary)}</p>' if story.summary else ""
        score = scores[story.guid]
        priority = priority_signal(story, score, view_path("/", story.topic))
        releases.append(
            f'<article class="headline-row" data-priority="{priority_level(score.points).lower()}">'
            f'{topic_rail(story.topic)}{priority}<div>{article_link(story, score)}{summary}'
            f'<p class="meta release-meta">{escape(story.source.name)} · '
            f'<time datetime="{story.published.isoformat()}">{display_time(story.published)}</time>{cached}</p>'
            f'</div></article>'
        )
    heading = "Key release" if len(releases) == 1 else "Key releases"
    return f'<section class="key-release" aria-labelledby="key-releases"><h2 id="key-releases">{heading}</h2>{"".join(releases)}</section>'


def page_payload(stories, statuses, updated, topic, view, scores, params, archive_error, preferences):
    now = now_utc()
    focused = view == "focused"
    search = params.get("q", "")[:120].strip()
    date_range = params.get("when", "")
    if date_range not in DATE_FILTERS:
        date_range = ""
    hours = DATE_FILTERS[date_range][1]
    if hours:
        cutoff = now - timedelta(hours=hours)
        stories = [story for story in stories if story.published >= cutoff]
    if search:
        terms = search.casefold().split()
        matches = []
        for story in stories:
            text = f"{story.title} {story.source.name} {TOPICS[story.topic]}".casefold()
            if all(term in text for term in terms):
                matches.append(story)
        stories = matches

    featured = key_releases(stories, now) if focused and topic in {"", "releases"} and not search else []
    if featured:
        featured_ids = {story.guid for story in featured}
        stories = [story for story in stories if story.guid not in featured_ids]

    def link(selected_topic=topic, selected_view=view, *, page=1):
        return escape(view_path("/", selected_topic, selected_view, search=search, date_range=date_range, page=page))

    raw_page = params.get("page", "")
    page = int(raw_page) if raw_page.isdecimal() and len(raw_page) < 7 else 1
    num_pages = max(1, (len(stories) + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(num_pages, max(1, page))
    start = (page - 1) * PAGE_SIZE
    visible = stories[start:start + PAGE_SIZE]
    featured_panel = release_panel(featured, statuses, scores, now) if page == 1 else ""
    pagination = []
    if page > 1:
        pagination.append(f'<a rel="prev" href="{link(page=page - 1)}">Previous</a>')
    if page < num_pages:
        pagination.append(f'<a rel="next" href="{link(page=page + 1)}">Next</a>')
    pager = f'<nav aria-label="Pages" class="pagination">{"".join(pagination)}</nav>' if pagination else ""
    count_label = "other headlines" if featured else "headlines"
    result_count = (f"{start + 1:,}–{start + len(visible):,} of {len(stories):,} {count_label}"
                    if visible else f"0 {count_label}")
    if visible:
        visible_scores = scores if focused else {story.guid: relevance(story, preferences) for story in visible}
        content = headline_table(visible, statuses, visible_scores, view, search, date_range)
    elif featured:
        content = ""
    elif not updated:
        content = '<div class="empty"><p>Fetching headlines. Check back in a moment.</p></div>'
    else:
        help_link = (f'<a href="{link(selected_view="all")}">Check All News</a>' if focused else
                     f'<a href="{escape(view_path("/", topic, view))}">Clear search and date filters</a>')
        content = f'<div class="empty"><p>No headlines match these filters.</p><p>{help_link}</p></div>'

    tabs = {"": "All topics", **TOPIC_TABS}
    tab_links = []
    for key, name in tabs.items():
        current = ' aria-current="page"' if key == topic else ""
        label = topic_mark(key) if key else escape(name)
        tab_links.append(f'<a href="{link(key)}"{current}>{label}</a>')

    source_items = []
    online = 0
    for source, status in statuses.items():
        state = source_state(source, status, now)
        online += state == "Online"
        warning = ' class="warn"' if state in {"Unavailable", "Cached"} else ""
        diagnostic = f' <span class="meta">{escape(status.error)}</span>' if status.error else ""
        source_items.append(
            f'<li><a href="{escape(source.home)}">{escape(display_source(source))}</a>'
            f'<span{warning}>{state}</span><span class="meta">Latest item '
            f'{display_time(status.latest)}</span>{diagnostic}</li>'
        )
    rss_path = escape(view_path("/rss.xml", topic, view))
    modes = []
    for key, label in VIEWS.items():
        current = ' aria-current="page"' if key == view else ""
        modes.append(f'<a href="{link(selected_view=key)}"{current}>{label}</a>')
    view_input = f'<input type="hidden" name="view" value="{view}">' if not focused else ""
    dates = "".join(option(value, label, date_range) for value, (label, _) in DATE_FILTERS.items())
    topics = "".join(option(value, label, topic) for value, label in tabs.items())
    updated_text = f"Last checked {display_time(updated, seconds=True)}" if updated else "Checking sources…"
    ordering = "Relevance + recency" if focused else "Newest first"
    scope = VIEWS[view]
    archive_notice = ('<p class="warn">Wire headlines are being held in memory. Disk storage is unavailable.</p>'
                      if archive_error and view == "wire" else "")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="alternate" type="application/rss+xml" title="{scope} RSS" href="{rss_path}">
<title>{FEED_TITLE}</title><style>{STYLE}</style></head>
<body><main><header><div><h1>{FEED_TITLE}</h1><p class="updated">{updated_text}</p></div>
<div class="actions"><a class="control" href="{link()}">Refresh</a>
<a class="control" href="{PREFIX}/weights">Weights</a><a class="control" href="{rss_path}">{scope} RSS</a></div></header>
<span class="sr-only" id="article-link-behavior">Opens in a new tab.</span>
<div id="featured-releases">{featured_panel}</div>
{archive_notice}<div class="tools"><nav class="mode" aria-label="News view">{"".join(modes)}</nav>
<form class="filters" method="get" action="{PREFIX}/" role="search">{view_input}
<label class="sr-only" for="headline-search">Search headlines and sources</label>
<input id="headline-search" type="search" name="q" value="{escape(search)}" placeholder="Search headlines or tickers">
<label class="sr-only" for="date-filter">Date range</label><select id="date-filter" name="when">{dates}</select>
<label class="sr-only" for="topic-filter">Topic</label><select id="topic-filter" class="topic-filter" name="topic">{topics}</select>
<button class="control" type="submit">Search</button></form></div>
<nav class="topics" aria-label="Headline topics">{''.join(tab_links)}</nav>
<div id="headline-results">
<div class="results"><p class="meta result-count">{result_count}</p><p class="meta">{ordering}</p></div>
{content}{pager}</div>
<details class="source-status"><summary>Source status · {online} of {len(statuses)} current</summary>
<ul class="sources">{''.join(source_items)}</ul></details>
</main>{ARTICLE_TOOLTIPS}{NEWS_AUTO_REFRESH}</body></html>""".encode()


def option(value, label, selected):
    marker = " selected" if value == selected else ""
    return f'<option value="{value}"{marker}>{escape(label)}</option>'


def weights_payload(preferences, token, saved):
    fields = []
    for topic, label in TOPICS.items():
        options = "".join(option(weight, name, preferences.weights[topic])
                          for weight, name in enumerate(WEIGHT_LEVELS))
        fields.append(f'<label class="field">{escape(label)}<select name="{topic}">{options}</select></label>')
    focus_options = "".join(option(key, label, preferences.focus)
                            for key, (label, _) in FOCUS_LEVELS.items())
    confirmation = '<p class="notice" role="status">Weights saved.</p>' if saved else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relevance weights · {FEED_TITLE}</title><style>{STYLE}</style></head>
<body><main><header><div><h1>Relevance weights</h1>
<p class="updated">Changes apply to the Focused view and its RSS feed.</p></div>
<a class="control" href="{PREFIX}/">Back to news</a></header>{confirmation}
<form action="{PREFIX}/weights" method="post" class="weight-form">
<input type="hidden" name="token" value="{token}">
<fieldset><legend>Topic priority</legend>{''.join(fields)}</fieldset>
<fieldset><legend>Relevance filter</legend><label class="field">Filter strength
<select name="focus">{focus_options}</select></label></fieldset>
<div class="actions"><button class="control primary" type="submit">Save weights</button>
<button class="control" type="submit" name="reset" value="1">Reset defaults</button></div>
</form></main></body></html>""".encode()


def status_payload(statuses, updated, stories, all_count, wire_count, archive_error):
    now = now_utc()
    result = {"last_update": updated.isoformat() if updated else None,
              "stories": len(stories), "all_stories": all_count, "wire_stories": wire_count,
              "wire_archive_error": archive_error or None, "sources": []}
    for source, status in statuses.items():
        result["sources"].append({
            "name": display_source(source), "url": source.url, "wire": source.wire,
            "poll_seconds": max(MIN_SOURCE_INTERVAL, source.interval, status.cache_seconds),
            "last_checked": status.checked.isoformat() if status.checked else None,
            "state": source_state(source, status, now), "items_read": status.read_count,
            "items_matched": status.matched_count,
            "items_retained": len(status.story_list),
            "latest": status.latest.isoformat() if status.latest else None,
            "error": status.error or None,
        })
    return json.dumps(result, ensure_ascii=False, indent=2).encode()


def main():
    news = News()
    hashes = [b64encode(sha256(script.encode()).digest()).decode()
              for script in re.findall(r"<script>(.*?)</script>", ARTICLE_TOOLTIPS + NEWS_AUTO_REFRESH, re.S)]
    csp = ("default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'; "
           "connect-src 'self'; style-src 'unsafe-inline'; script-src " +
           " ".join(f"'sha256-{digest}'" for digest in hashes))

    class Handler(BaseHTTPRequestHandler):
        def do_HEAD(self):
            self.do_GET()

        def do_POST(self):
            host = self.headers.get("Host")
            if host not in PUBLIC_HOSTS:
                self.send_error(400)
                return
            origin = self.headers.get("Origin", "")
            if origin not in {f"https://{host}", f"http://{host}"}:
                self.send_error(403)
                return
            if self.path == PREFIX + "/activity":
                if self.headers.get("X-Live-News") != "1":
                    self.send_error(403)
                    return
                news.renew()
                self.send_response(204)
                self.end_headers()
                return
            if self.path != PREFIX + "/weights":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192 or self.headers.get_content_type() != "application/x-www-form-urlencoded":
                    raise ValueError("invalid form")
                self.connection.settimeout(5)
                form = dict(parse_qsl(self.rfile.read(length).decode("utf-8"), max_num_fields=20))
            except (OSError, ValueError):
                self.send_error(400, "Invalid weight form")
                return
            if not compare_digest(form.get("token", "").encode(), news.preference_token.encode()):
                self.send_error(403, "Reload the settings page and try again")
                return
            if form.get("reset") == "1":
                preferences = DEFAULTS
            else:
                try:
                    weights = {topic: int(form[topic]) for topic in TOPICS}
                    focus = form["focus"]
                    if focus not in FOCUS_LEVELS or any(not 0 <= w < len(WEIGHT_LEVELS) for w in weights.values()):
                        raise ValueError("weight or focus outside allowed range")
                except (KeyError, ValueError):
                    self.send_error(400, "Choose a valid priority for each topic and a filter strength")
                    return
                preferences = Preferences(weights, focus)
            encoded = "".join(str(preferences.weights[topic]) for topic in TOPICS)
            secure = "; Secure" if origin.startswith("https:") else ""
            self.send_response(303)
            self.send_header("Location", PREFIX + "/weights?saved=1")
            self.send_header("Set-Cookie", f"market_live_weights={encoded}.{preferences.focus}; "
                             f"Path={PREFIX}/; Max-Age=31536000; HttpOnly; SameSite=Lax{secure}")
            self.end_headers()

        def do_GET(self):
            if self.path == "/healthz":
                self.send_payload(b"ok", "text/plain")
                return
            if self.headers.get("Host") not in PUBLIC_HOSTS:
                self.send_error(400)
                return
            request = urlsplit(self.path)
            path = request.path.removeprefix(PREFIX) if request.path.startswith(PREFIX + "/") else ""
            try:
                params = dict(parse_qsl(request.query, max_num_fields=10))
            except ValueError:
                self.send_error(400)
                return
            topic = params.get("topic", "")
            if topic and topic not in TOPICS:
                self.send_error(404, "Unknown topic")
                return
            if path not in {"/", "/rss.xml", "/status.json", "/weights", "/preview"}:
                self.send_error(404)
                return
            preferences = load_preferences(self.headers.get("Cookie"))
            if path == "/weights":
                body = weights_payload(preferences, news.preference_token, params.get("saved") == "1")
                self.send_payload(body, "text/html")
                return
            statuses, updated = news.snapshot
            if path == "/preview":
                guid = params.get("id", "")
                if not re.fullmatch(r"urn:sha256:[a-f0-9]{64}", guid):
                    self.send_error(404)
                    return
                now = now_utc()
                story = next((item for status in statuses.values() for item in status.story_list
                              if item.guid == guid and fresh_until(item) > now
                              and priority_level(relevance(item, preferences).points) == "Top"), None)
                if story is None:
                    self.send_error(404)
                    return
                if self.command == "HEAD":
                    self.send_payload(b"", "application/json")
                    return
                if news.active() and news.preview_slots.acquire(blocking=False):
                    try:
                        preview = article_preview(story)
                    finally:
                        news.preview_slots.release()
                else:
                    preview = {"text": story.summary or preview_excerpt(story.feed_preview, story.title), "origin": "Publisher feed"}
                    if not preview["text"]:
                        preview = {"text": "A public preview is unavailable for this story.", "origin": ""}
                body = json.dumps(preview, ensure_ascii=False).encode()
                self.send_payload(body, "application/json")
                return
            view = params.get("view", "focused")
            if view not in VIEWS:
                self.send_error(404, "Unknown view")
                return
            focused = view == "focused"
            candidates = available_stories(statuses, wire_only=view == "wire")
            scores = {story.guid: relevance(story, preferences) for story in candidates} if focused else {}
            stories, groups = story_index(candidates, scores, preferences, focused, rank=focused)
            all_count = sum(story.topic == topic for story in candidates) if topic else len(candidates)
            if path == "/rss.xml":
                selected = groups[topic] if topic else stories
                body = rss_payload(selected, scores, statuses, updated, topic, view)
                content_type = "application/rss+xml"
            elif path == "/":
                selected = groups[topic] if topic else stories
                body = page_payload(selected, statuses, updated, topic, view, scores, params, news.archive_error,
                                    preferences)
                content_type = "text/html"
            else:
                wire_count = len(available_stories(statuses, wire_only=True))
                info = json.loads(status_payload(statuses, updated, stories, all_count, wire_count, news.archive_error))
                info["active"] = news.active()
                body = json.dumps(info, ensure_ascii=False).encode()
                content_type = "application/json"
            self.send_payload(body, content_type)

        def send_payload(self, body, content_type):
            self.send_response(200)
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", csp)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def log_message(self, format_string, *args):
            pass

    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        Thread(target=news.refresh, name="feed-refresh", daemon=True).start()
        print(f"{FEED_TITLE} listening on port {PORT}", flush=True)
        try:
            server.serve_forever()
        finally:
            news.stop.set()


if __name__ == "__main__":
    main()
