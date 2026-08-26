from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
import math
import re
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit

import pandas as pd


NARRATIVE_SCHEMA_VERSION = "narrative_impulse_v1"
NARRATIVE_WINDOW_DAYS = 180
ACTIVE_IMPULSE_DAYS = 30
ATTENTION_WINDOW_DAYS = 7

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "a", "about", "after", "again", "against", "all", "amid", "an", "and",
    "are", "as", "at", "be", "because", "been", "before", "being", "but", "by",
    "can", "could", "despite", "do", "does", "for", "from", "has", "have", "how",
    "in", "into", "is", "it", "its", "more", "new", "not", "of", "on", "or",
    "over", "s", "said", "says", "shares", "should", "stock", "stocks", "than",
    "that", "the", "their", "this", "to", "up", "was", "were", "what", "when",
    "which", "while", "why", "will", "with", "would",
}

_POSITIVE_PHRASES = {
    "approval": 1.0,
    "approved": 1.0,
    "beat estimates": 1.2,
    "beats estimates": 1.2,
    "buy rating": 0.8,
    "demand strong": 0.8,
    "expands": 0.5,
    "growth": 0.45,
    "jumps": 0.7,
    "launches": 0.35,
    "outperform": 0.8,
    "partnership": 0.45,
    "profit rises": 0.8,
    "raises guidance": 1.2,
    "raises target": 0.65,
    "record revenue": 0.9,
    "surges": 0.8,
    "tops estimates": 1.1,
    "upgrade": 0.8,
    "upgraded": 0.8,
    "wins contract": 0.65,
}

_NEGATIVE_PHRASES = {
    "breach": -0.9,
    "cuts guidance": -1.2,
    "cuts jobs": -0.75,
    "declines": -0.5,
    "demand weak": -0.8,
    "downgrade": -0.8,
    "downgraded": -0.8,
    "drops": -0.7,
    "falls": -0.7,
    "investigation": -0.9,
    "layoffs": -0.75,
    "lawsuit": -0.8,
    "lowers guidance": -1.2,
    "misses estimates": -1.2,
    "outage": -0.8,
    "probe": -0.75,
    "profit falls": -0.8,
    "recall": -0.9,
    "sell rating": -0.8,
    "slumps": -0.8,
    "underperform": -0.8,
    "warning": -0.7,
}

_TOPIC_RULES = (
    ("earnings_guidance", ("earnings", "revenue", "profit", "guidance", "estimates", "margin")),
    ("analyst_ratings", ("analyst", "rating", "target", "upgrade", "downgrade", "outperform", "underperform")),
    ("product_ai", ("product", "launch", "platform", "software", "ai", "artificial intelligence", "model")),
    ("deals_partnerships", ("acquisition", "acquire", "merger", "deal", "partnership", "contract")),
    ("legal_regulatory", ("lawsuit", "court", "investigation", "probe", "regulator", "sec", "doj", "ftc")),
    ("operations_workforce", ("layoff", "jobs", "workforce", "outage", "breach", "recall")),
    ("capital_allocation", ("buyback", "dividend", "debt", "offering", "repurchase")),
    ("leadership", ("ceo", "cfo", "appoint", "resign", "leadership")),
)

_COMPANY_ATTRIBUTION = (
    "announces", "appoints", "expects", "forecasts", "introduces", "launches",
    "plans", "raises guidance", "reports", "says", "unveils",
)
_ANALYST_ATTRIBUTION = (
    "analyst", "price target", "rating", "upgrade", "downgrade", "outperform",
    "underperform", "wall street",
)
_REGULATORY_ATTRIBUTION = (
    "court", "doj", "ftc", "investigation", "lawsuit", "probe", "regulator", "sec",
)

_SOCIAL_HOSTS = {"reddit.com", "stocktwits.com", "x.com", "twitter.com"}
_FILING_HOSTS = {"sec.gov", "www.sec.gov"}
_DISTRIBUTION_HOSTS = {
    "businesswire.com", "www.businesswire.com", "globenewswire.com",
    "www.globenewswire.com", "prnewswire.com", "www.prnewswire.com",
}
_HIGH_CONFIDENCE_HOSTS = {
    "apnews.com", "bloomberg.com", "www.bloomberg.com", "reuters.com",
    "www.reuters.com", "wsj.com", "www.wsj.com",
}


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    try:
        timestamp = pd.Timestamp(value)
    except Exception:
        return None
    if pd.isna(timestamp):
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.to_pydatetime()


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.astimezone(timezone.utc).isoformat() if value is not None else None


def _finite(value: Any) -> Optional[float]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _round(value: Optional[float], digits: int = 3) -> Optional[float]:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _tokens(title: str, symbol: str) -> set[str]:
    symbol_token = symbol.lower()
    output: set[str] = set()
    for raw in _TOKEN_RE.findall(title.lower()):
        if raw in _STOPWORDS or raw == symbol_token or len(raw) < 2:
            continue
        token = raw[:-1] if len(raw) > 4 and raw.endswith("s") else raw
        output.add(token)
    return output


def _similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _canonical_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except Exception:
        return ""
    host = (parsed.hostname or "").lower()
    path = re.sub(r"/+$", "", parsed.path or "/")
    return f"{host}{path}" if host else ""


def _hostname(value: str) -> str:
    try:
        return (urlsplit(value).hostname or "").lower()
    except Exception:
        return ""


def _source_profile(source: str, link: str) -> dict[str, Any]:
    host = _hostname(link)
    normalized_source = source.strip().lower()
    if host in _FILING_HOSTS:
        return {"channel": "filing", "confidence": 0.95, "half_life_hours": 336.0}
    if host in _SOCIAL_HOSTS or normalized_source in {"reddit", "stocktwits", "x", "twitter"}:
        return {"channel": "community_public", "confidence": 0.35, "half_life_hours": 12.0}
    if host in _DISTRIBUTION_HOSTS:
        return {"channel": "company_distribution", "confidence": 0.68, "half_life_hours": 120.0}
    if host in _HIGH_CONFIDENCE_HOSTS:
        return {"channel": "publisher", "confidence": 0.85, "half_life_hours": 120.0}
    if "seekingalpha" in normalized_source or host.endswith("seekingalpha.com"):
        return {"channel": "publisher", "confidence": 0.58, "half_life_hours": 72.0}
    return {"channel": "publisher", "confidence": 0.55, "half_life_hours": 72.0}


def _headline_direction(title: str) -> float:
    lowered = title.lower()
    score = sum(weight for phrase, weight in _POSITIVE_PHRASES.items() if phrase in lowered)
    score += sum(weight for phrase, weight in _NEGATIVE_PHRASES.items() if phrase in lowered)
    if score == 0:
        return 0.0
    return math.tanh(score / 1.4)


def _headline_relevance(title: str) -> float:
    lowered = title.lower()
    if any(term in lowered for term in ("earnings", "guidance", "acquisition", "merger", "investigation", "lawsuit", "outage", "breach", "recall")):
        return 1.0
    if any(term in lowered for term in ("revenue", "profit", "analyst", "rating", "target", "contract", "partnership", "launch", "layoff")):
        return 0.82
    return 0.58


def _topics(title: str) -> list[str]:
    lowered = title.lower()
    matches = [name for name, phrases in _TOPIC_RULES if any(phrase in lowered for phrase in phrases)]
    return matches[:2] or ["corporate_update"]


def _origin_role(title: str, channel: str) -> str:
    lowered = title.lower()
    if channel == "community_public":
        return "community_public"
    if any(term in lowered for term in _REGULATORY_ATTRIBUTION):
        return "regulatory_legal"
    if any(term in lowered for term in _ANALYST_ATTRIBUTION):
        return "analyst_publisher"
    if channel in {"company_distribution", "filing"} or any(term in lowered for term in _COMPANY_ATTRIBUTION):
        return "company_attributed"
    return "publisher_editorial"


def _combine_confidence(values: Iterable[float]) -> float:
    remaining = 1.0
    for value in values:
        remaining *= 1.0 - max(0.0, min(1.0, value))
    return 1.0 - remaining


def _normalize_articles(
    symbol: str,
    articles: Iterable[Any],
    now: datetime,
) -> list[dict[str, Any]]:
    earliest = now - timedelta(days=NARRATIVE_WINDOW_DAYS)
    normalized: list[dict[str, Any]] = []
    for article in articles:
        title = str(_value(article, "title", "") or "").strip()
        link = str(_value(article, "link", "") or "").strip()
        published_at = _as_utc(_value(article, "published_at"))
        if not title or published_at is None or published_at < earliest or published_at > now + timedelta(hours=12):
            continue
        source = str(_value(article, "source", "Unknown publisher") or "Unknown publisher").strip()
        profile = _source_profile(source, link)
        normalized.append({
            "id": _value(article, "id"),
            "title": title,
            "link": link,
            "source": source,
            "published_at": published_at,
            "canonical_url": _canonical_url(link),
            "host": _hostname(link),
            "tokens": _tokens(title, symbol),
            "direction": _headline_direction(title),
            "relevance": _headline_relevance(title),
            **profile,
        })
    return sorted(normalized, key=lambda item: item["published_at"])


def _cluster_articles(symbol: str, articles: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for article in articles:
        best: Optional[dict[str, Any]] = None
        best_similarity = 0.0
        for cluster in clusters:
            shared_url = bool(article["canonical_url"] and article["canonical_url"] in cluster["urls"])
            age_hours = abs((article["published_at"] - cluster["first_seen"]).total_seconds()) / 3600.0
            similarity = _similarity(article["tokens"], cluster["tokens"])
            if shared_url or (age_hours <= 72.0 and similarity >= 0.42):
                rank = 1.0 if shared_url else similarity
                if rank > best_similarity:
                    best = cluster
                    best_similarity = rank
        if best is None:
            clusters.append({
                "items": [article],
                "first_seen": article["published_at"],
                "last_seen": article["published_at"],
                "tokens": set(article["tokens"]),
                "urls": {article["canonical_url"]} if article["canonical_url"] else set(),
            })
        else:
            best["items"].append(article)
            best["last_seen"] = max(best["last_seen"], article["published_at"])
            best["tokens"].update(article["tokens"])
            if article["canonical_url"]:
                best["urls"].add(article["canonical_url"])

    prior_tokens: list[set[str]] = []
    for index, cluster in enumerate(clusters):
        items = cluster["items"]
        unique_titles: dict[str, dict[str, Any]] = {}
        for item in items:
            unique_titles.setdefault(" ".join(sorted(item["tokens"])), item)
        claims = list(unique_titles.values())
        directions = [item["direction"] for item in claims]
        relevances = [item["relevance"] for item in claims]
        direction = sum(directions) / len(directions) if directions else 0.0
        relevance = sum(relevances) / len(relevances) if relevances else 0.0
        maximum_prior_similarity = max((_similarity(cluster["tokens"], tokens) for tokens in prior_tokens), default=0.0)
        novelty = max(0.25, 1.0 - 0.75 * maximum_prior_similarity)

        independent_sources: dict[str, dict[str, Any]] = {}
        for item in items:
            identity = item["host"] or item["source"].lower()
            current = independent_sources.get(identity)
            if current is None or item["confidence"] > current["confidence"]:
                independent_sources[identity] = item
        confidence = _combine_confidence(item["confidence"] for item in independent_sources.values())
        half_life = max((item["half_life_hours"] for item in independent_sources.values()), default=72.0)
        age_hours = max(0.0, (now - cluster["first_seen"]).total_seconds() / 3600.0)
        time_decay = math.exp(-math.log(2.0) * age_hours / half_life)
        impulse = direction * relevance * novelty * confidence * time_decay

        origin_votes = Counter(_origin_role(item["title"], item["channel"]) for item in claims)
        origin = origin_votes.most_common(1)[0][0] if origin_votes else "publisher_editorial"
        representative = max(claims, key=lambda item: (abs(item["direction"]), item["relevance"], -items.index(item)))
        cluster.update({
            "cluster_id": f"{symbol}-{index + 1:03d}",
            "title": representative["title"],
            "link": representative["link"],
            "source": representative["source"],
            "direction": direction,
            "relevance": relevance,
            "novelty": novelty,
            "confidence": confidence,
            "time_decay": time_decay,
            "impulse": impulse,
            "propagation_count": len(items),
            "independent_source_count": len(independent_sources),
            "source_names": sorted({item["source"] for item in independent_sources.values()}),
            "origin_role": origin,
            "topics": _topics(representative["title"]),
        })
        prior_tokens.append(set(cluster["tokens"]))
    return clusters


def _attention_read(clusters: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    current_start = now - timedelta(days=ATTENTION_WINDOW_DAYS)
    current_count = sum(cluster["first_seen"] >= current_start for cluster in clusters)
    historical_counts: list[int] = []
    for offset in range(1, 13):
        window_end = current_start - timedelta(days=ATTENTION_WINDOW_DAYS * (offset - 1))
        window_start = window_end - timedelta(days=ATTENTION_WINDOW_DAYS)
        historical_counts.append(sum(window_start <= cluster["first_seen"] < window_end for cluster in clusters))
    observed_span_days = (
        (max(cluster["last_seen"] for cluster in clusters) - min(cluster["first_seen"] for cluster in clusters)).days
        if clusters else 0
    )
    supported = observed_span_days >= 28 and sum(historical_counts) >= 4
    baseline = sum(historical_counts) / len(historical_counts) if supported else None
    surprise = None
    if supported and baseline is not None:
        mean = baseline
        variance = sum((count - mean) ** 2 for count in historical_counts) / max(1, len(historical_counts) - 1)
        denominator = max(math.sqrt(variance), math.sqrt(max(mean, 0.25)))
        surprise = (current_count - mean) / denominator
    if surprise is None:
        status = "insufficient_baseline"
    elif surprise >= 1.5:
        status = "elevated"
    elif surprise <= -1.0:
        status = "quiet"
    else:
        status = "normal"
    return {
        "z_score": _round(surprise, 2),
        "status": status,
        "recent_cluster_count": current_count,
        "baseline_clusters_per_week": _round(baseline, 2),
        "baseline_weeks": len(historical_counts) if supported else 0,
        "observed_span_days": observed_span_days,
    }


def _collection_read(checks: Iterable[Any], now: datetime) -> dict[str, Any]:
    recent_start = now - timedelta(days=7)
    normalized: list[dict[str, Any]] = []
    for check in checks:
        checked_at = _as_utc(_value(check, "checked_at"))
        if checked_at is None or checked_at > now + timedelta(hours=1):
            continue
        normalized.append({
            "checked_at": checked_at,
            "succeeded": bool(_value(check, "succeeded", False)),
            "source": str(_value(check, "source", "Unknown") or "Unknown"),
            "item_count": int(_value(check, "item_count", 0) or 0),
        })
    recent = [check for check in normalized if check["checked_at"] >= recent_start]
    successful = [check for check in recent if check["succeeded"]]
    latest = max((check["checked_at"] for check in normalized), default=None)
    return {
        "successful_checks_7d": len(successful),
        "failed_checks_7d": len(recent) - len(successful),
        "latest_check_at": _iso(latest),
        "sources_checked": sorted({check["source"] for check in successful}),
        "continuity_status": "observed" if len(successful) >= 2 else "warming" if successful else "unobserved",
    }


def _z_score(current: Optional[float], history: pd.Series) -> Optional[float]:
    if current is None:
        return None
    clean = pd.to_numeric(history, errors="coerce").dropna()
    if len(clean) < 40:
        return None
    mean = _finite(clean.mean())
    std = _finite(clean.std(ddof=1))
    if mean is None or std is None or std <= 1e-9:
        return None
    return (current - mean) / std


def _market_confirmation(stock_df: pd.DataFrame, benchmark_df: pd.DataFrame, direction: Optional[float]) -> dict[str, Any]:
    metrics: list[dict[str, Any]] = []
    residual_z: Optional[float] = None
    volume_z: Optional[float] = None
    vwap_z: Optional[float] = None

    try:
        stock = stock_df.sort_index().copy()
        benchmark = benchmark_df.sort_index().copy()
        stock_close_name = "Adjusted Close" if "Adjusted Close" in stock and stock["Adjusted Close"].notna().all() else "Close"
        benchmark_close_name = "Adjusted Close" if "Adjusted Close" in benchmark and benchmark["Adjusted Close"].notna().all() else "Close"
        aligned = pd.concat(
            [
                pd.to_numeric(stock[stock_close_name], errors="coerce").rename("stock"),
                pd.to_numeric(benchmark[benchmark_close_name], errors="coerce").rename("benchmark"),
            ],
            axis=1,
            join="inner",
        ).dropna()
        returns = aligned.where(aligned > 0).apply(lambda series: series.map(math.log)).diff().dropna()
        beta = returns["stock"].rolling(60, min_periods=40).cov(returns["benchmark"])
        beta = beta / returns["benchmark"].rolling(60, min_periods=40).var()
        residual = returns["stock"] - beta.shift(1) * returns["benchmark"]
        residual_5 = residual.rolling(5, min_periods=5).sum()
        current_residual = _finite(residual_5.iloc[-1]) if not residual_5.empty else None
        residual_z = _z_score(current_residual, residual_5.iloc[:-1].tail(252))
        current_beta = _finite(beta.shift(1).iloc[-1]) if not beta.empty else None
        metrics.append({
            "key": "beta_adjusted_residual",
            "label": "5-session residual vs IGV",
            "status": "available" if residual_z is not None else "unavailable",
            "z_score": _round(residual_z, 2),
            "value": _round(current_residual * 100.0 if current_residual is not None else None, 2),
            "unit": "% log return",
            "detail": f"Prior-only 60-session beta {current_beta:.2f}." if current_beta is not None else "At least 40 prior aligned sessions are required.",
        })
    except Exception:
        metrics.append({
            "key": "beta_adjusted_residual",
            "label": "5-session residual vs IGV",
            "status": "unavailable",
            "z_score": None,
            "value": None,
            "unit": "% log return",
            "detail": "Aligned stock and IGV history is unavailable.",
        })

    try:
        stock = stock_df.sort_index().copy()
        volume = pd.to_numeric(stock.get("Volume"), errors="coerce").where(lambda series: series > 0)
        log_volume_5 = volume.map(math.log).rolling(5, min_periods=5).mean()
        current_volume = _finite(log_volume_5.iloc[-1]) if not log_volume_5.empty else None
        volume_z = _z_score(current_volume, log_volume_5.iloc[:-1].tail(252))
        metrics.append({
            "key": "abnormal_volume",
            "label": "5-session abnormal volume",
            "status": "available" if volume_z is not None else "unavailable",
            "z_score": _round(volume_z, 2),
            "value": None,
            "unit": "sigma",
            "detail": "Five-session mean log volume versus the prior 252 supported sessions.",
        })
    except Exception:
        metrics.append({
            "key": "abnormal_volume",
            "label": "5-session abnormal volume",
            "status": "unavailable",
            "z_score": None,
            "value": None,
            "unit": "sigma",
            "detail": "Daily volume history is unavailable.",
        })

    try:
        stock = stock_df.sort_index().copy()
        close = pd.to_numeric(stock["Close"], errors="coerce")
        high = pd.to_numeric(stock["High"], errors="coerce")
        low = pd.to_numeric(stock["Low"], errors="coerce")
        volume = pd.to_numeric(stock["Volume"], errors="coerce").where(lambda series: series > 0)
        typical = (high + low + close) / 3.0
        vwap = (typical * volume).rolling(20, min_periods=15).sum() / volume.rolling(20, min_periods=15).sum()
        displacement = (close - vwap) / vwap
        current_displacement = _finite(displacement.iloc[-1]) if not displacement.empty else None
        vwap_z = _z_score(current_displacement, displacement.iloc[:-1].tail(252))
        metrics.append({
            "key": "anchored_vwap_displacement",
            "label": "20-session VWAP displacement",
            "status": "available" if vwap_z is not None else "unavailable",
            "z_score": _round(vwap_z, 2),
            "value": _round(current_displacement * 100.0 if current_displacement is not None else None, 2),
            "unit": "%",
            "detail": "Daily typical-price volume weighting; a session-level proxy, not an intraday VWAP.",
        })
    except Exception:
        metrics.append({
            "key": "anchored_vwap_displacement",
            "label": "20-session VWAP displacement",
            "status": "unavailable",
            "z_score": None,
            "value": None,
            "unit": "%",
            "detail": "OHLCV history is unavailable.",
        })

    metrics.extend([
        {
            "key": "atm_iv_change",
            "label": "ATM-IV change",
            "status": "unavailable",
            "z_score": None,
            "value": None,
            "unit": "vol points",
            "detail": "The current options snapshot has no timestamped ATM-IV history.",
        },
        {
            "key": "term_structure_skew",
            "label": "Term structure and skew change",
            "status": "unavailable",
            "z_score": None,
            "value": None,
            "unit": None,
            "detail": "Timestamped multi-expiry, moneyness-aligned option surfaces are not stored.",
        },
    ])

    directional_values: list[tuple[float, float]] = []
    if residual_z is not None:
        directional_values.append((residual_z, 0.55))
    if vwap_z is not None:
        directional_values.append((vwap_z, 0.30))
    if volume_z is not None and volume_z > 0:
        direction_anchor = residual_z if residual_z is not None and abs(residual_z) >= 0.1 else vwap_z
        if direction_anchor is not None:
            directional_values.append((math.copysign(volume_z, direction_anchor), 0.15))
    weight_total = sum(weight for _, weight in directional_values)
    market_impulse = (
        sum(value * weight for value, weight in directional_values) / weight_total
        if weight_total > 0 else None
    )
    market_impulse = max(-4.0, min(4.0, market_impulse)) if market_impulse is not None else None
    confirmation = (
        market_impulse * math.copysign(1.0, direction)
        if market_impulse is not None and direction is not None and abs(direction) >= 0.1
        else None
    )
    available_count = sum(metric["status"] == "available" for metric in metrics)
    return {
        "status": "available" if available_count >= 3 else "limited" if available_count else "unavailable",
        "benchmark": "IGV",
        "market_impulse_z": _round(market_impulse, 2),
        "confirmation_z": _round(confirmation, 2),
        "available_metric_count": available_count,
        "total_metric_count": len(metrics),
        "metrics": metrics,
    }


def _classification(
    impulse: float,
    direction: Optional[float],
    confidence: float,
    attention_z: Optional[float],
    market: dict[str, Any],
) -> dict[str, str]:
    narrative_strong = bool(
        direction is not None
        and confidence >= 0.35
        and (abs(impulse) >= 0.22 or (abs(direction) >= 0.35 and (attention_z or 0.0) >= 1.0))
    )
    market_impulse = market.get("market_impulse_z")
    market_strong = market_impulse is not None and abs(market_impulse) >= 1.0
    confirmation = market.get("confirmation_z")
    if narrative_strong and market_strong and confirmation is not None and confirmation >= 0.75:
        return {"key": "confirmed_catalyst", "label": "Confirmed catalyst", "detail": "Narrative and market response are strong and directionally aligned."}
    if narrative_strong and market_strong and confirmation is not None and confirmation <= -0.75:
        return {"key": "contradicted_narrative", "label": "Contradicted narrative", "detail": "Narrative is strong, but the market response is strong in the opposite direction."}
    if narrative_strong and not market_strong:
        return {"key": "chatter_unconfirmed", "label": "Chatter / unconfirmed", "detail": "Narrative evidence is strong without a matching market response."}
    if not narrative_strong and market_strong:
        return {"key": "hidden_or_mechanical", "label": "Hidden information or mechanical flow", "detail": "Market behavior is strong while observed narrative evidence is weak."}
    if market.get("status") == "unavailable":
        return {"key": "insufficient_market_evidence", "label": "Market cross-check unavailable", "detail": "Narrative evidence cannot be checked against supported market history."}
    return {"key": "no_meaningful_signal", "label": "No meaningful signal", "detail": "Neither independent narrative events nor market behavior clears the alert threshold."}


def build_narrative_analysis(
    symbol: str,
    articles: Iterable[Any],
    collection_checks: Iterable[Any],
    stock_df: pd.DataFrame,
    benchmark_df: pd.DataFrame,
    *,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Build an auditable narrative-event read without counting reposts as corroboration."""

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    else:
        current = current.astimezone(timezone.utc)
    normalized = _normalize_articles(symbol, articles, current)
    clusters = _cluster_articles(symbol, normalized, current)
    active_start = current - timedelta(days=ACTIVE_IMPULSE_DAYS)
    active = [cluster for cluster in clusters if cluster["first_seen"] >= active_start]
    gross_weight = sum(
        cluster["relevance"] * cluster["novelty"] * cluster["confidence"] * cluster["time_decay"]
        for cluster in active
    )
    impulse = sum(cluster["impulse"] for cluster in active)
    direction = impulse / gross_weight if gross_weight > 0 else None
    confidence_weights = [
        cluster["relevance"] * cluster["novelty"] * cluster["time_decay"]
        for cluster in active
    ]
    confidence_weight_total = sum(confidence_weights)
    evidence_confidence = (
        sum(cluster["confidence"] * weight for cluster, weight in zip(active, confidence_weights))
        / confidence_weight_total
        if confidence_weight_total > 0 else 0.0
    )

    attention = _attention_read(clusters, current)
    collection = _collection_read(collection_checks, current)
    recent_clusters = attention["recent_cluster_count"]
    baseline = attention["baseline_clusters_per_week"]
    if collection["continuity_status"] == "unobserved":
        silence_key = "collection_unobserved"
        silence_label = "Silence cannot be assessed"
        silence_detail = "No successful collection receipt was observed in the last seven days."
    elif collection["continuity_status"] == "warming":
        silence_key = "collection_warming"
        silence_label = "Silence baseline warming"
        silence_detail = "One successful recent feed check is not enough to treat missing mentions as evidence."
    elif recent_clusters == 0 and baseline is not None and baseline >= 0.5:
        silence_key = "unexpected_silence"
        silence_label = "Potentially unusual silence"
        silence_detail = "The feed was checked successfully, no independent event was observed this week, and the prior observed rate was higher."
    elif recent_clusters == 0:
        silence_key = "observed_no_mentions"
        silence_label = "No recent observed claims"
        silence_detail = "Successful feed checks found no independent event, but the historical baseline is too thin to call the silence unusual."
    elif attention["status"] == "quiet":
        silence_key = "quieter_than_usual"
        silence_label = "Quieter than observed baseline"
        silence_detail = "Independent claim arrivals are below the symbol's observed weekly rate."
    else:
        silence_key = "mentions_observed"
        silence_label = "Narrative events observed"
        silence_detail = "Recent independent claim events are present."
    silence = {
        "key": silence_key,
        "label": silence_label,
        "detail": silence_detail,
        "recent_cluster_count": recent_clusters,
        "baseline_clusters_per_week": baseline,
        **collection,
    }

    market = _market_confirmation(stock_df, benchmark_df, direction)
    classification = _classification(
        impulse,
        direction,
        evidence_confidence,
        attention.get("z_score"),
        market,
    )

    origin_labels = {
        "company_attributed": "Company-attributed claims",
        "analyst_publisher": "Analyst framing",
        "publisher_editorial": "Publisher framing",
        "regulatory_legal": "Regulatory / legal",
        "community_public": "Community / public opinion",
    }
    driver_groups: list[dict[str, Any]] = []
    for key, label in origin_labels.items():
        group = [cluster for cluster in active if cluster["origin_role"] == key]
        group_impulse = sum(cluster["impulse"] for cluster in group)
        group_weight = sum(abs(cluster["impulse"]) for cluster in group)
        channel_available = key != "community_public" or any(item["channel"] == "community_public" for item in normalized)
        driver_groups.append({
            "key": key,
            "label": label,
            "available": channel_available,
            "cluster_count": len(group),
            "impulse": _round(group_impulse),
            "direction": _round(group_impulse / group_weight if group_weight > 0 else None),
            "basis": "Headline attribution inference; it does not establish intent.",
        })

    channels_present = Counter(item["channel"] for item in normalized)
    channel_definitions = (
        ("publisher", "Publisher headlines"),
        ("company_distribution", "Company-distributed releases"),
        ("filing", "Regulatory filings"),
        ("community_public", "Community / public opinion"),
    )
    coverage_channels = [
        {"key": key, "label": label, "available": channels_present[key] > 0, "item_count": channels_present[key]}
        for key, label in channel_definitions
    ]
    coverage_status = "good" if sum(channel["available"] for channel in coverage_channels) >= 3 else "limited" if normalized else "unavailable"

    visible_clusters = sorted(active, key=lambda cluster: (abs(cluster["impulse"]), cluster["last_seen"]), reverse=True)[:6]
    cluster_payload = [
        {
            "cluster_id": cluster["cluster_id"],
            "title": cluster["title"],
            "link": cluster["link"],
            "source": cluster["source"],
            "first_seen": _iso(cluster["first_seen"]),
            "last_seen": _iso(cluster["last_seen"]),
            "direction": _round(cluster["direction"]),
            "relevance": _round(cluster["relevance"]),
            "novelty": _round(cluster["novelty"]),
            "confidence": _round(cluster["confidence"]),
            "time_decay": _round(cluster["time_decay"]),
            "impulse": _round(cluster["impulse"]),
            "propagation_count": cluster["propagation_count"],
            "independent_source_count": cluster["independent_source_count"],
            "source_names": cluster["source_names"],
            "origin_role": cluster["origin_role"],
            "topics": cluster["topics"],
        }
        for cluster in visible_clusters
    ]

    return {
        "schema_version": NARRATIVE_SCHEMA_VERSION,
        "symbol": symbol.upper(),
        "as_of": _iso(current),
        "window_days": NARRATIVE_WINDOW_DAYS,
        "active_impulse_days": ACTIVE_IMPULSE_DAYS,
        "narrative_impulse": _round(impulse),
        "direction": _round(direction),
        "attention": attention,
        "evidence_confidence": _round(evidence_confidence),
        "market_confirmation": market,
        "classification": classification,
        "silence": silence,
        "counts": {
            "raw_items": len(normalized),
            "claim_clusters": len(clusters),
            "active_claim_clusters": len(active),
            "propagation_items": sum(max(0, cluster["propagation_count"] - 1) for cluster in clusters),
            "independent_sources": len({item["host"] or item["source"].lower() for item in normalized}),
        },
        "driver_groups": driver_groups,
        "clusters": cluster_payload,
        "coverage": {
            "status": coverage_status,
            "channels": coverage_channels,
            "published_start": _iso(normalized[0]["published_at"]) if normalized else None,
            "published_end": _iso(normalized[-1]["published_at"]) if normalized else None,
            "successful_checks_7d": collection["successful_checks_7d"],
            "failed_checks_7d": collection["failed_checks_7d"],
            "latest_check_at": collection["latest_check_at"],
            "limitations": [
                "Headline language is scored; full-article tone and audience reaction are not observed.",
                "Observed publishers are not a representative sample of public opinion.",
                "Attribution describes who appears to carry a claim; it does not infer motive or coordination.",
            ],
        },
        "methodology": {
            "cluster_keys": ["symbol", "topic tokens", "canonical URL", "semantic title overlap", "first-seen time"],
            "impulse_formula": "direction × relevance × novelty × confidence × time decay",
            "confidence_formula": "1 - product(1 - independent source confidence)",
            "evidence_confidence_aggregation": "relevance-, novelty-, and time-decay-weighted mean of cluster confidence",
            "attention_window_days": ATTENTION_WINDOW_DAYS,
            "headline_model": "deterministic_headline_lexicon_v1",
            "market_benchmark": "IGV",
        },
    }
