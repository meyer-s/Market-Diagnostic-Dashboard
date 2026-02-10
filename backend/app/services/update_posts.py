from datetime import datetime
import re
from typing import Iterable, List
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.update_post import UpdatePost


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


def create_update_post_if_absent(
    db: Session,
    *,
    title: str,
    summary: str,
    status,
    tags: Iterable[str],
    slug: str | None,
    content_markdown: str,
    chart_urls: Iterable[str],
    published: bool,
    pinned: bool,
) -> tuple[UpdatePost, bool]:
    """
    Create an update post, returning (post, created).

    If slug is provided and already exists, returns the existing post and created=False.
    """
    from datetime import datetime

    from sqlalchemy.exc import IntegrityError

    if slug:
        requested_slug = slugify(slug)
        existing = db.query(UpdatePost).filter(UpdatePost.slug == requested_slug).first()
        if existing:
            return existing, False
        resolved_slug = requested_slug
    else:
        resolved_slug = ensure_unique_slug(
            db,
            slugify_with_utc_date(title, datetime.utcnow()),
        )

    post = UpdatePost(
        title=title.strip(),
        slug=resolved_slug,
        summary=summary.strip(),
        status=status,
        tags=normalize_string_list(tags),
        content_markdown=content_markdown,
        chart_urls=normalize_string_list(chart_urls),
        published=published,
        pinned=pinned,
    )

    try:
        db.add(post)
        db.commit()
        db.refresh(post)
        return post, True
    except IntegrityError:
        db.rollback()
        existing = db.query(UpdatePost).filter(UpdatePost.slug == resolved_slug).first()
        if existing:
            return existing, False
        raise
