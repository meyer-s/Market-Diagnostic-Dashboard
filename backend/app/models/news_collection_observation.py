from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String

from app.core.db import Base


class NewsCollectionObservation(Base):
    """Append-only receipt for one symbol/source collection attempt.

    These receipts make negative evidence inspectable: an empty article window is
    only meaningful when the feed was actually checked successfully.
    """

    __tablename__ = "news_collection_observation"
    __table_args__ = (
        Index(
            "ix_news_collection_observation_symbol_checked_at",
            "symbol",
            "checked_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False, index=True)
    checked_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        index=True,
    )
    succeeded = Column(Boolean, nullable=False, default=False)
    item_count = Column(Integer, nullable=False, default=0)
    new_item_count = Column(Integer, nullable=False, default=0)
    latest_published_at = Column(DateTime, nullable=True)
    error_kind = Column(String, nullable=True)
