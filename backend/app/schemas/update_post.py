from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.update_post import UpdateStatus
from app.services.market_diagnostic_validation import validate_markdown_image_alt_text


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

    @field_validator("content_markdown")
    @classmethod
    def validate_content_markdown_field(cls, value: str) -> str:
        validate_markdown_image_alt_text(value or "")
        return value


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
