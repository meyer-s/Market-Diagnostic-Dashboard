from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models.news_article import NewsArticle
from app.models.news_collection_observation import NewsCollectionObservation
from app.models.news_ticker import NewsTicker
from app.services import news_service


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)()


def test_refresh_records_successful_collection_receipt(monkeypatch):
    db = _session()
    db.add(NewsTicker(symbol="NOW", sector="TEST"))
    db.commit()
    monkeypatch.setattr(news_service, "ensure_default_tickers", lambda session: None)
    monkeypatch.setattr(
        news_service,
        "_fetch_news_evidence_for_symbol",
        lambda symbol, max_items: {
            "source": "SeekingAlpha",
            "succeeded": True,
            "error_kind": None,
            "entries": [{
                "title": "ServiceNow raises guidance",
                "link": "https://example.com/now",
                "guid": "now-1",
                "source": "Example Wire",
                "published_at": datetime(2026, 8, 26, 12, 0),
            }],
        },
    )

    result = news_service.refresh_news_cache(db)

    receipt = db.query(NewsCollectionObservation).one()
    article = db.query(NewsArticle).one()
    assert result == {
        "tickers_checked": 1,
        "new_items": 1,
        "successful_checks": 1,
        "failed_checks": 0,
    }
    assert receipt.succeeded is True
    assert receipt.item_count == 1
    assert receipt.new_item_count == 1
    assert article.source == "Example Wire"
    db.close()


def test_refresh_records_failed_check_without_calling_it_silence(monkeypatch):
    db = _session()
    db.add(NewsTicker(symbol="NOW", sector="TEST"))
    db.commit()
    monkeypatch.setattr(news_service, "ensure_default_tickers", lambda session: None)
    monkeypatch.setattr(
        news_service,
        "_fetch_news_evidence_for_symbol",
        lambda symbol, max_items: {
            "source": "SeekingAlpha",
            "succeeded": False,
            "error_kind": "Timeout",
            "entries": [],
        },
    )

    result = news_service.refresh_news_cache(db)

    receipt = db.query(NewsCollectionObservation).one()
    assert result["successful_checks"] == 0
    assert result["failed_checks"] == 1
    assert receipt.succeeded is False
    assert receipt.error_kind == "Timeout"
    assert db.query(NewsArticle).count() == 0
    db.close()


def test_same_publisher_guid_is_retained_for_each_ticker(monkeypatch):
    db = _session()
    db.add_all([
        NewsTicker(symbol="NOW", sector="TEST"),
        NewsTicker(symbol="MSFT", sector="TEST"),
    ])
    db.commit()
    monkeypatch.setattr(news_service, "ensure_default_tickers", lambda session: None)
    monkeypatch.setattr(
        news_service,
        "_fetch_news_evidence_for_symbol",
        lambda symbol, max_items: {
            "source": "SeekingAlpha",
            "succeeded": True,
            "error_kind": None,
            "entries": [{
                "title": f"Shared cloud article for {symbol}",
                "link": "https://example.com/shared-cloud-story",
                "guid": "shared-guid",
                "source": "Example Wire",
                "published_at": datetime(2026, 8, 26, 12, 0),
            }],
        },
    )

    result = news_service.refresh_news_cache(db)

    rows = db.query(NewsArticle).order_by(NewsArticle.symbol.asc()).all()
    assert result["new_items"] == 2
    assert [(row.symbol, row.guid) for row in rows] == [
        ("MSFT", "shared-guid"),
        ("NOW", "shared-guid"),
    ]
    db.close()
