"""
Response Helper Functions

Utilities for formatting API responses consistently.
"""
from typing import Any, Dict, List, Optional
from datetime import datetime
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.models.alert import Alert
from app.models.news_article import NewsArticle
from app.models.news_ticker import NewsTicker
from app.services.indicator_metadata import get_display_indicator_name


def format_indicator_basic(indicator: Indicator) -> Dict[str, Any]:
    """
    Format an Indicator model for basic listing endpoints.
    
    Args:
        indicator: Indicator model instance
    
    Returns:
        Dictionary with basic indicator metadata
    """
    display_name = get_display_indicator_name(indicator.code, indicator.name)
    return {
        "code": indicator.code,
        "name": display_name,
        "source": indicator.source,
        "source_symbol": indicator.source_symbol,
        "category": indicator.category,
        "direction": indicator.direction,
        "lookback_days_for_z": indicator.lookback_days_for_z,
        "threshold_green_max": indicator.threshold_green_max,
        "threshold_yellow_max": indicator.threshold_yellow_max,
        "weight": indicator.weight,
    }


def format_indicator_value(value: IndicatorValue) -> Dict[str, Any]:
    """
    Format an IndicatorValue model for API responses.
    
    Args:
        value: IndicatorValue model instance
    
    Returns:
        Dictionary with value data
    """
    return {
        "timestamp": value.timestamp.isoformat(),
        "raw_value": value.raw_value,
        "normalized_value": value.normalized_value,
        "score": value.score,
        "state": value.state,
    }


def format_indicator_detail(
    indicator: Indicator,
    latest_value: Optional[IndicatorValue] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Format an Indicator with its latest value for detail endpoints.
    
    Args:
        indicator: Indicator model instance
        latest_value: Latest IndicatorValue instance (optional)
        metadata: Additional metadata dictionary (optional)
    
    Returns:
        Dictionary with full indicator details
    """
    base = format_indicator_basic(indicator)
    
    if latest_value is None:
        return {
            **base,
            "has_data": False,
            "metadata": metadata or {},
        }
    
    return {
        **base,
        "latest": format_indicator_value(latest_value),
        "metadata": metadata or {},
    }


def format_indicator_history(values: List[IndicatorValue]) -> List[Dict[str, Any]]:
    """
    Format a list of IndicatorValues for history endpoints.
    
    Args:
        values: List of IndicatorValue instances
    
    Returns:
        List of formatted history points
    """
    return [
        {
            "timestamp": v.timestamp.isoformat(),
            "raw_value": v.raw_value,
            "score": v.score,
            "state": v.state,
        }
        for v in values
    ]


def format_alert(alert: Alert) -> Dict[str, Any]:
    """
    Format an Alert model for API responses.
    
    Args:
        alert: Alert model instance
    
    Returns:
        Dictionary with alert data
    """
    return {
        "id": alert.id,
        "timestamp": alert.timestamp.isoformat() if isinstance(alert.timestamp, datetime) else alert.timestamp,
        "type": alert.type,
        "message": alert.message,
        "affected_indicators": alert.affected_indicators,
    }


def format_news_article(article: NewsArticle) -> Dict[str, Any]:
    """
    Format a NewsArticle model for API responses.
    """
    return {
        "id": article.id,
        "symbol": article.symbol,
        "sector": article.sector,
        "title": article.title,
        "link": article.link,
        "source": article.source,
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "created_at": article.created_at.isoformat() if article.created_at else None,
    }


def format_news_ticker(ticker: NewsTicker) -> Dict[str, Any]:
    """
    Format a NewsTicker model for API responses.
    """
    return {
        "symbol": ticker.symbol,
        "sector": ticker.sector,
    }


def format_system_status(status: Any) -> Dict[str, Any]:
    """
    Format a SystemStatus model for API responses.
    
    Args:
        status: SystemStatus model instance
    
    Returns:
        Dictionary with system status data
    """
    if not status:
        return {
            "state": "UNKNOWN",
            "composite_score": None,
            "red_count": 0,
            "yellow_count": 0,
            "confidence": "LOW",
            "coverage_ratio": 0.0,
            "core_coverage_ratio": 0.0,
            "missing_codes": [],
            "stale_codes": [],
            "weights_used": {},
        }
    if isinstance(status, dict):
        return status

    return {
        "timestamp": status.timestamp.isoformat() if hasattr(status, 'timestamp') else None,
        "state": status.state,
        "composite_score": status.composite_score,
        "red_count": status.red_count,
        "yellow_count": status.yellow_count,
        "confidence": getattr(status, "confidence", "LOW"),
        "coverage_ratio": getattr(status, "coverage_ratio", 0.0),
        "core_coverage_ratio": getattr(status, "core_coverage_ratio", 0.0),
        "missing_codes": getattr(status, "missing_codes", []),
        "stale_codes": getattr(status, "stale_codes", []),
        "weights_used": getattr(status, "weights_used", {}),
    }


def format_indicator_status(indicator: Indicator, value: Optional[IndicatorValue]) -> Dict[str, Any]:
    """
    Format an indicator with its latest value for status endpoints.
    
    Args:
        indicator: Indicator model instance
        value: Latest IndicatorValue instance
    
    Returns:
        Dictionary with indicator status
    """
    display_name = get_display_indicator_name(indicator.code, indicator.name)
    if not value:
        return {
            "code": indicator.code,
            "name": display_name,
            "weight": indicator.weight,
            "raw_value": None,
            "score": None,
            "state": "UNKNOWN",
            "timestamp": None,
        }
    
    return {
        "code": indicator.code,
        "name": display_name,
        "weight": indicator.weight,
        "raw_value": value.raw_value,
        "score": value.score,
        "state": value.state,
        "timestamp": value.timestamp.isoformat(),
    }
