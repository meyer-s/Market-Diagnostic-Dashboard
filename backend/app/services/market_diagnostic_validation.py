from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse


REQUIRED_H2_HEADINGS: tuple[str, ...] = (
    "## Earnings / EPS Revisions (S&P 500)",
    "## Credit Stress (HY OAS, IG Spreads, Bank CDS)",
    "## Growth (Nowcasts/PMIs + Sahm Rule Proximity)",
    "## Financial Conditions Indexes",
    "## Policy / Geopolitical Headlines",
    "## Risk Regime Assessment",
)

SLUG_RE = re.compile(r"^market-diagnostic-\d{4}-\d{2}-\d{2}$")


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
    try:
        parsed = urlparse((value or "").strip())
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


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

    # First 5 sections require Trend, 3-6 bullets, and Signal line with allowed emoji.
    for heading, section in sections[:5]:
        trend_ok = re.search(r"(?m)^Trend:\s+.+", section) is not None
        if not trend_ok:
            raise ValueError(f"{heading} must include a Trend line")

        signal_match = re.search(r"(?m)^Signal:\s+(.+)$", section)
        if not signal_match:
            raise ValueError(f"{heading} must include a Signal line")
        if not any(emoji in signal_match.group(1) for emoji in _ALLOWED_EMOJIS):
            raise ValueError(f"{heading} Signal line must include 🟢🟡🔴")

        bullets = re.findall(r"(?m)^- .+$", section)
        if not (3 <= len(bullets) <= 6):
            raise ValueError(f"{heading} must include 3-6 bullet points")

        for bullet in bullets:
            if re.search(r"\(Source:[^)]+\)\s*$", bullet) is None:
                raise ValueError(f"{heading} bullets must end with a citation '(Source: ...)'")

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
    if not (4 <= len(regime_bullets) <= 6):
        raise ValueError("Risk Regime Assessment must include 4-6 bullet points")

    for bullet in regime_bullets:
        if re.search(r"\(Source:[^)]+\)\s*$", bullet) is None:
            raise ValueError("Risk Regime Assessment bullets must end with a citation '(Source: ...)'")


def validate_allowed_emojis(text: str) -> None:
    if not text:
        return
    # Allow only the signal emojis used for Market Diagnostic posts.
    for match in _EMOJI_RE.finditer(text):
        if match.group(0) not in _ALLOWED_EMOJIS:
            raise ValueError("content_markdown contains unsupported emojis")
