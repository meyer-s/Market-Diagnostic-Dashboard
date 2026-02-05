from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.update_post import UpdateStatus


class UpdatePostCreate(BaseModel):
    title: str = Field(..., min_length=1)
    slug: Optional[str] = None
    summary: str = Field(..., min_length=1)
    status: UpdateStatus = UpdateStatus.YELLOW
    tags: List[str] = Field(default_factory=list)
    content_markdown: str = Field(..., min_length=1)
    chart_urls: List[str] = Field(default_factory=list)
    published: bool = True
    pinned: bool = False


class UpdatePostPatch(BaseModel):
    pinned: Optional[bool] = None
    published: Optional[bool] = None


class UpdatePostListItem(BaseModel):
    id: str
    created_at: datetime
    title: str
    slug: str
    summary: str
    status: UpdateStatus
    tags: List[str] = Field(default_factory=list)
    pinned: bool = False

    model_config = {"from_attributes": True}


class UpdatePostDetail(UpdatePostListItem):
    content_markdown: str
    chart_urls: List[str] = Field(default_factory=list)
    published: bool
