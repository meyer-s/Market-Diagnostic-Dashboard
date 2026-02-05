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
