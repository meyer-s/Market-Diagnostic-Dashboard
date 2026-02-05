from datetime import datetime
import re
from typing import Iterable, List
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.update_post import UpdatePost, UpdateStatus


DEFAULT_UPDATE_POSTS = [
    {
        "created_at": datetime(2026, 1, 21, 13, 30, 0),
        "title": "Market Diagnostic — Jan 21",
        "slug": "market-diagnostic-jan-21",
        "summary": "Risk conditions remain mixed as credit stress rises while growth data stays resilient.",
        "status": UpdateStatus.YELLOW,
        "tags": ["market-diagnostic", "credit", "growth"],
        "content_markdown": """## Earnings
- Q4 guides are tracking near consensus, but revisions breadth has narrowed.
- Cyclical leadership remains selective rather than broad.

## Credit
- High-yield spreads widened modestly this week.
- Primary issuance cleared, but with weaker demand quality.

## Growth
- Labor demand is decelerating without a hard rollover signal.
- Services activity stays above contraction thresholds.

## Financial Conditions
- Real rates remain restrictive and liquidity is uneven across risk assets.
- Volatility term structure is stable but fragile around macro catalysts.

## Policy/Geo
- Policy path remains data dependent; terminal-rate certainty is still low.
- Geopolitical risk is elevated but not currently driving broad de-risking.
""",
        "chart_urls": [
            "https://placehold.co/1200x675/1a202c/9ca3af?text=Credit+Spread+Trend",
            "https://placehold.co/1200x675/1a202c/9ca3af?text=Liquidity+Conditions",
        ],
        "published": True,
        "pinned": True,
    },
    {
        "created_at": datetime(2026, 1, 18, 14, 5, 0),
        "title": "Market Diagnostic — Jan 18",
        "slug": "market-diagnostic-jan-18",
        "summary": "Financial conditions eased slightly, but earnings quality remains uneven across sectors.",
        "status": UpdateStatus.GREEN,
        "tags": ["market-diagnostic", "earnings", "conditions"],
        "content_markdown": """## Earnings
- Megacap beats supported index-level momentum.
- Margin guidance improved in defensive sectors.

## Credit
- Investment-grade funding reopened with tighter concessions.
- Distress ratio remained contained.

## Growth
- Household spending held steady despite softer confidence surveys.
- Manufacturing contraction stabilized.

## Financial Conditions
- Cross-asset volatility cooled from recent highs.
- Equity breadth improved versus the prior week.

## Policy/Geo
- Rate-cut timing expectations shifted later but remained orderly.
- No new policy shock from major central banks.
""",
        "chart_urls": [],
        "published": True,
        "pinned": False,
    },
    {
        "created_at": datetime(2026, 1, 15, 12, 15, 0),
        "title": "Market Diagnostic — Jan 15",
        "slug": "market-diagnostic-jan-15",
        "summary": "Credit and policy uncertainty drove a short-lived risk-off phase across cyclicals.",
        "status": UpdateStatus.RED,
        "tags": ["market-diagnostic", "policy", "risk-off"],
        "content_markdown": """## Earnings
- Forward revisions turned negative in cyclicals.
- Dispersion rose sharply after mixed guidance.

## Credit
- Lower-quality spreads widened quickly and dealer balance sheets tightened.
- Funding liquidity declined in high beta pockets.

## Growth
- Soft data rolled over, especially in hiring intentions.
- Hard data lagged but momentum weakened.

## Financial Conditions
- Volatility shock compressed risk appetite.
- Market depth thinned during macro headline windows.

## Policy/Geo
- Policy communication uncertainty lifted term-premium volatility.
- Geopolitical headlines increased cross-asset correlation to the downside.
""",
        "chart_urls": [
            "https://placehold.co/1200x675/1a202c/9ca3af?text=Risk-Off+Pulse",
        ],
        "published": True,
        "pinned": False,
    },
]


def normalize_string_list(values: Iterable[str]) -> List[str]:
    return [value.strip() for value in values if isinstance(value, str) and value.strip()]


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if normalized:
        return normalized
    return f"update-{uuid4().hex[:8]}"


def slugify_with_utc_date(title: str, created_at: datetime | None = None) -> str:
    timestamp = created_at or datetime.utcnow()
    base_slug = slugify(title)
    return f"{base_slug}-{timestamp.strftime('%Y-%m-%d')}"


def ensure_unique_slug(db: Session, base_slug: str) -> str:
    candidate = base_slug
    suffix = 2
    while db.query(UpdatePost).filter(UpdatePost.slug == candidate).first():
        candidate = f"{base_slug}-{suffix}"
        suffix += 1
    return candidate


def seed_default_update_posts(db: Session) -> int:
    seed_slugs = [item["slug"] for item in DEFAULT_UPDATE_POSTS]
    existing_slugs = {
        slug
        for (slug,) in db.query(UpdatePost.slug).filter(UpdatePost.slug.in_(seed_slugs)).all()
    }

    created = 0
    for payload in DEFAULT_UPDATE_POSTS:
        if payload["slug"] in existing_slugs:
            continue
        db.add(UpdatePost(**payload))
        created += 1

    if created:
        db.commit()

    return created
