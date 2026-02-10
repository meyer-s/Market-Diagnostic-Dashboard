from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.update_post import UpdateStatus
from app.services.market_diagnostic_validation import (
    validate_chart_urls,
    validate_h2_headings_exactly_once_and_in_order,
    validate_required_tags,
    validate_slug,
)


class GPTActionPublishUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=1)
    status: UpdateStatus
    tags: list[str] = Field(default_factory=list)
    slug: str
    content_markdown: str = Field(..., min_length=1)
    chart_urls: list[str] = Field(default_factory=list)
    published: bool
    pinned: bool

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        validate_slug(value)
        return (value or "").strip()

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str]) -> list[str]:
        validate_required_tags(value)
        return value

    @field_validator("chart_urls")
    @classmethod
    def validate_chart_urls(cls, value: list[str]) -> list[str]:
        validate_chart_urls(value)
        return value

    @field_validator("content_markdown")
    @classmethod
    def validate_content_markdown(cls, value: str) -> str:
        validate_h2_headings_exactly_once_and_in_order(value or "")
        return value


class GPTActionPublishUpdateResponse(BaseModel):
    ok: bool = True
    id: Optional[str] = None
    slug: str
    action: Literal["posted", "skipped"]
