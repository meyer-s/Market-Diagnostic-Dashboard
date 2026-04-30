from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


REQUIRED_H2_HEADINGS: tuple[str, ...] = (
    "## Earnings / EPS Revisions (S&P 500)",
    "## Credit Stress (HY OAS, IG Spreads, Bank CDS)",
    "## Growth (Nowcasts/PMIs + Sahm Rule Proximity)",
    "## Financial Conditions Indexes",
    "## Policy / Geopolitical Headlines",
    "## Risk Regime Assessment",
)

SLUG_RE = re.compile(r"^market-diagnostic-\d{4}-\d{2}-\d{2}$")
SOURCE_CITATION_RE = re.compile(r"\(Source:\s*([^)]+)\)\s*$")


def validate_required_tags(tags: list[str]) -> None:
    normalized = {(t or "").strip().lower() for t in (tags or []) if (t or "").strip()}
    required = {"market-diagnostic", "macro"}
    missing = sorted(required - normalized)
    if missing:
        raise ValueError(f"tags must include: {', '.join(missing)}")


def validate_slug(slug: str, *, run_date_utc: str | None = None) -> None:
    candidate = (slug or "").strip()
    if not SLUG_RE.match(candidate):
        raise ValueError("slug must match ^market-diagnostic-\\d{4}-\\d{2}-\\d{2}$")
    try:
        slug_date = datetime.strptime(candidate[-10:], "%Y-%m-%d").date()
    except ValueError:
        slug_date = None
    if slug_date is not None:
        today_utc = datetime.now(timezone.utc).date()
        if slug_date > today_utc:
            raise ValueError("slug date must not be in the future")
    if run_date_utc is not None:
        expected = f"market-diagnostic-{run_date_utc}"
        if candidate != expected:
            raise ValueError(f"slug must equal {expected} for run_date_utc={run_date_utc}")


def _is_valid_http_url(value: str) -> bool:
    candidate = (value or "").strip()
    if not candidate or "..." in candidate:
        return False
    try:
        parsed = urlparse(candidate)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False

    host = parsed.hostname or ""
    if not host or "." not in host or not any(ch.isalpha() for ch in host):
        return False

    return True


def normalize_http_url(value: str) -> str:
    parsed = urlparse((value or "").strip())
    filtered_query = [
        (key, item_value)
        for key, item_value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_")
    ]
    normalized_path = parsed.path.rstrip("/") or "/"
    return urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            normalized_path,
            parsed.params,
            urlencode(filtered_query, doseq=True),
            "",
        )
    )


def extract_citation_urls(content_markdown: str) -> list[str]:
    citations: list[str] = []
    for line in (content_markdown or "").splitlines():
        match = SOURCE_CITATION_RE.search(line.strip())
        if match:
            citations.append((match.group(1) or "").strip())
    return citations


def validate_citations_match_sources(content_markdown: str, source_urls: list[str] | tuple[str, ...]) -> None:
    allowed = {
        normalize_http_url(url)
        for url in (source_urls or [])
        if isinstance(url, str) and _is_valid_http_url(url)
    }
    if not allowed:
        raise ValueError("OpenAI response must include web search source URLs")

    for cited_url in extract_citation_urls(content_markdown):
        if not _is_valid_http_url(cited_url):
            continue
        if normalize_http_url(cited_url) not in allowed:
            raise ValueError(f"citation URL must match a returned web search source: {cited_url}")


def validate_chart_urls(chart_urls: list[str]) -> None:
    bad = [u for u in (chart_urls or []) if not isinstance(u, str) or not _is_valid_http_url(u)]
    if bad:
        raise ValueError("chart_urls must be empty or contain only valid http(s) URLs")


def validate_h2_headings_exactly_once_and_in_order(content_markdown: str) -> None:
    text = content_markdown or ""
    matches: list[int] = []
    missing: list[str] = []
    duplicates: list[str] = []

    for heading in REQUIRED_H2_HEADINGS:
        # Exact line match: "## Heading"
        pattern = rf"(?m)^{re.escape(heading)}\s*$"
        found = list(re.finditer(pattern, text))
        if len(found) == 0:
            missing.append(heading)
            continue
        if len(found) > 1:
            duplicates.append(heading)
            continue
        matches.append(found[0].start())

    if missing or duplicates:
        parts: list[str] = []
        if missing:
            parts.append(f"missing headings: {', '.join(missing)}")
        if duplicates:
            parts.append(f"duplicate headings: {', '.join(duplicates)}")
        raise ValueError(
            "content_markdown must include each required Markdown H2 heading exactly once; " + "; ".join(parts)
        )

    if matches != sorted(matches):
        raise ValueError(
            "content_markdown must contain required headings in this order: "
            + ", ".join(REQUIRED_H2_HEADINGS)
        )


_EMOJI_RE = re.compile(
    "["  # broad brush emoji ranges
    "\U0001F300-\U0001FAFF"  # Misc Symbols and Pictographs + Supplemental Symbols
    "\U00002700-\U000027BF"  # Dingbats
    "\U00002600-\U000026FF"  # Misc symbols
    "]"
)

_ALLOWED_EMOJIS = {"🟢", "🟡", "🔴"}


def _split_sections(content_markdown: str) -> list[tuple[str, str]]:
    text = content_markdown or ""
    matches = list(re.finditer(r"(?m)^## .+$", text))
    sections: list[tuple[str, str]] = []
    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        heading = match.group(0).strip()
        sections.append((heading, text[start:end].strip()))
    return sections


def validate_market_diagnostic_structure(content_markdown: str) -> None:
    text = content_markdown or ""
    validate_h2_headings_exactly_once_and_in_order(text)

    sections = _split_sections(text)
    if len(sections) < len(REQUIRED_H2_HEADINGS):
        raise ValueError("content_markdown must include all required Market Diagnostic sections")

    # First 5 sections require Trend + Signal lines and either 3-7 bullets or an explicit No Change line.
    for heading, section in sections[:5]:
        trend_ok = re.search(r"(?m)^Trend:\s+.+", section) is not None
        if not trend_ok:
            raise ValueError(f"{heading} must include a Trend line")

        signal_match = re.search(r"(?m)^Signal:\s+(.+)$", section)
        if not signal_match:
            raise ValueError(f"{heading} must include a Signal line")
        if not any(emoji in signal_match.group(1) for emoji in _ALLOWED_EMOJIS):
            raise ValueError(f"{heading} Signal line must include 🟢🟡🔴")

        no_change_match = re.search(r"(?m)^No Change:\s+.+", section)
        bullets = re.findall(r"(?m)^- .+$", section)
        if no_change_match:
            # Allow explicit no-change sections without fresh bullet points.
            if len(bullets) > 0:
                for bullet in bullets:
                    match = SOURCE_CITATION_RE.search(bullet)
                    if match is None:
                        raise ValueError(f"{heading} bullets must end with a citation '(Source: ...)'")
                    source_value = (match.group(1) or "").strip()
                    if not _is_valid_http_url(source_value):
                        raise ValueError(f"{heading} citations must be valid http(s) URLs")
            continue

        if not (3 <= len(bullets) <= 7):
            raise ValueError(f"{heading} must include 3-7 bullet points or an explicit No Change line")

        for bullet in bullets:
            match = SOURCE_CITATION_RE.search(bullet)
            if match is None:
                raise ValueError(f"{heading} bullets must end with a citation '(Source: ...)'")
            source_value = (match.group(1) or "").strip()
            if not _is_valid_http_url(source_value):
                raise ValueError(f"{heading} citations must be valid http(s) URLs")

    # Risk Regime Assessment section checks.
    _, regime_section = sections[5]
    if re.search(r"(?m)^Risk Regime:\s+.+", regime_section) is None:
        raise ValueError("Risk Regime Assessment must include a 'Risk Regime:' line")

    regime_match = re.search(r"(?m)^Risk Regime:\s+(.+)$", regime_section)
    if not regime_match or not any(emoji in regime_match.group(1) for emoji in _ALLOWED_EMOJIS):
        raise ValueError("Risk Regime line must include 🟢🟡🔴")

    if re.search(r"(?m)^Correction risk elevated\?:\s+(Yes|No)\b", regime_section, re.IGNORECASE) is None:
        raise ValueError("Risk Regime Assessment must include 'Correction risk elevated?: Yes/No'")

    if re.search(r"(?m)^Recession risk elevated\?:\s+(Yes|No)\b", regime_section, re.IGNORECASE) is None:
        raise ValueError("Risk Regime Assessment must include 'Recession risk elevated?: Yes/No'")

    final_match = re.search(r"(?m)^Final Regime:\s+(.+)$", regime_section)
    if not final_match or not any(emoji in final_match.group(1) for emoji in _ALLOWED_EMOJIS):
        raise ValueError("Final Regime line must include 🟢🟡🔴")

    if re.search(r"(?m)^Confidence:\s+.+", regime_section) is not None:
        if re.search(r"(?m)^Confidence:\s+(Low|Medium|High)\b", regime_section, re.IGNORECASE) is None:
            raise ValueError("Confidence must be Low, Medium, or High when provided")

    regime_bullets = re.findall(r"(?m)^- .+$", regime_section)
    if not (4 <= len(regime_bullets) <= 7):
        raise ValueError("Risk Regime Assessment must include 4-7 bullet points")

    for bullet in regime_bullets:
        match = SOURCE_CITATION_RE.search(bullet)
        if match is None:
            raise ValueError("Risk Regime Assessment bullets must end with a citation '(Source: ...)'")
        source_value = (match.group(1) or "").strip()
        if not _is_valid_http_url(source_value):
            raise ValueError("Risk Regime Assessment citations must be valid http(s) URLs")


def validate_allowed_emojis(text: str) -> None:
    if not text:
        return
    # Allow only the signal emojis used for Market Diagnostic posts.
    for match in _EMOJI_RE.finditer(text):
        if match.group(0) not in _ALLOWED_EMOJIS:
            raise ValueError("content_markdown contains unsupported emojis")
