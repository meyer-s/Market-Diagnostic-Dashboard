from datetime import datetime
import enum
from uuid import uuid4

from sqlalchemy import JSON, Boolean, Column, DateTime, Enum, String, Text

from app.core.db import Base


class UpdateStatus(str, enum.Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


class UpdatePost(Base):
    __tablename__ = "update_post"

    id = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid4()))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    title = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    summary = Column(String, nullable=False)
    status = Column(Enum(UpdateStatus), default=UpdateStatus.YELLOW, nullable=False, index=True)
    tags = Column(JSON, default=list, nullable=False)
    content_markdown = Column(Text, nullable=False)
    chart_urls = Column(JSON, default=list, nullable=False)
    published = Column(Boolean, default=True, nullable=False, index=True)
    pinned = Column(Boolean, default=False, nullable=False, index=True)
