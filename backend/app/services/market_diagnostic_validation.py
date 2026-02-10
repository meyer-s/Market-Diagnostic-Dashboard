from __future__ import annotations

import re
from urllib.parse import urlparse


REQUIRED_H2_HEADINGS: tuple[str, ...] = (
    "## Earnings",
    "## Credit",
    "## Growth",
    "## Financial Conditions",
    "## Policy/Geo",
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
    "["  # broad brush emoji ranges (good enough for "no emojis" gate)
    "\U0001F300-\U0001FAFF"  # Misc Symbols and Pictographs + Supplemental Symbols
    "\U00002700-\U000027BF"  # Dingbats
    "\U00002600-\U000026FF"  # Misc symbols
    "]"
)


def validate_no_emojis(text: str) -> None:
    if not text:
        return
    if _EMOJI_RE.search(text):
        raise ValueError("content_markdown must not contain emojis")

