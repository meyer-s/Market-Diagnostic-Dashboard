"""API endpoints for internal Market Diagnostic update posts."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import String, cast, desc, func, or_
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.update_post import UpdatePost, UpdateStatus
from app.schemas.update_post import (
    UpdatePostCreate,
    UpdatePostDetail,
    UpdatePostListItem,
    UpdatePostPatch,
)
from app.services.update_posts import (
    ensure_unique_slug,
    normalize_string_list,
    slugify,
    slugify_with_utc_date,
)
from app.utils.db_helpers import get_db_session

router = APIRouter()


def require_updates_publish_key(x_updates_key: Optional[str]) -> None:
    expected_key = (settings.UPDATES_PUBLISH_KEY or "").strip()
    if not expected_key or x_updates_key != expected_key:
        raise HTTPException(status_code=401, detail="Invalid updates publish key.")


@router.get("/updates", response_model=List[UpdatePostListItem])
def list_updates(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: Optional[UpdateStatus] = None,
    q: Optional[str] = None,
):
    """List published update posts for the Tools -> Updates feed."""
    with get_db_session() as db:
        query = db.query(UpdatePost).filter(UpdatePost.published.is_(True))

        if status:
            query = query.filter(UpdatePost.status == status)

        if q:
            query_text = f"%{q.strip().lower()}%"
            query = query.filter(
                or_(
                    func.lower(UpdatePost.title).like(query_text),
                    func.lower(cast(UpdatePost.tags, String)).like(query_text),
                )
            )

        posts = query.order_by(desc(UpdatePost.pinned), desc(UpdatePost.created_at)).offset(offset).limit(limit).all()
        return posts


@router.get("/updates/{post_id}", response_model=UpdatePostDetail)
def get_update(post_id: str):
    """Return a full update post payload including markdown and chart URLs."""
    with get_db_session() as db:
        post = db.query(UpdatePost).filter(UpdatePost.id == post_id).first()
        if not post:
            raise HTTPException(status_code=404, detail="Update post not found.")
        return post


@router.post("/updates", response_model=UpdatePostDetail)
def create_update(
    payload: UpdatePostCreate,
    x_updates_key: Optional[str] = Header(default=None, alias="X-Updates-Key"),
):
    """Create a new update post for the internal updates feed."""
    require_updates_publish_key(x_updates_key)

    with get_db_session() as db:
        if payload.slug:
            requested_slug = slugify(payload.slug)
            existing = db.query(UpdatePost).filter(UpdatePost.slug == requested_slug).first()
            if existing:
                return existing
            resolved_slug = requested_slug
        else:
            resolved_slug = ensure_unique_slug(
                db,
                slugify_with_utc_date(payload.title, datetime.utcnow()),
            )

        post = UpdatePost(
            title=payload.title.strip(),
            slug=resolved_slug,
            summary=payload.summary.strip(),
            status=payload.status,
            tags=normalize_string_list(payload.tags),
            content_markdown=payload.content_markdown,
            chart_urls=normalize_string_list(payload.chart_urls),
            published=payload.published,
            pinned=payload.pinned,
        )
        try:
            db.add(post)
            db.commit()
            db.refresh(post)
            return post
        except IntegrityError:
            db.rollback()
            existing = db.query(UpdatePost).filter(UpdatePost.slug == resolved_slug).first()
            if existing:
                return existing
            raise HTTPException(status_code=409, detail="Update post with this slug already exists.")


@router.patch("/updates/{post_id}", response_model=UpdatePostDetail)
def patch_update(
    post_id: str,
    payload: UpdatePostPatch,
    x_updates_key: Optional[str] = Header(default=None, alias="X-Updates-Key"),
):
    """Update mutable post flags (pin and published)."""
    require_updates_publish_key(x_updates_key)

    if payload.pinned is None and payload.published is None:
        raise HTTPException(status_code=400, detail="At least one field must be provided.")

    with get_db_session() as db:
        post = db.query(UpdatePost).filter(UpdatePost.id == post_id).first()
        if not post:
            raise HTTPException(status_code=404, detail="Update post not found.")

        if payload.pinned is not None:
            post.pinned = payload.pinned
        if payload.published is not None:
            post.published = payload.published

        db.add(post)
        db.commit()
        db.refresh(post)
        return post
