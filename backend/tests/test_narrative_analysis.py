from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from app.services.narrative_analysis import build_narrative_analysis


NOW = datetime(2026, 8, 26, 16, 0, tzinfo=timezone.utc)


def _market_frames() -> tuple[pd.DataFrame, pd.DataFrame]:
    index = pd.bdate_range(end=NOW.date(), periods=360)
    benchmark_returns = np.array([0.0004 + 0.002 * np.sin(i / 11) for i in range(len(index))])
    stock_returns = benchmark_returns * 1.15 + np.array([0.0015 * np.cos(i / 7) for i in range(len(index))])
    stock_returns[-5:] += 0.018
    benchmark_close = 100 * np.exp(np.cumsum(benchmark_returns))
    stock_close = 80 * np.exp(np.cumsum(stock_returns))
    benchmark = pd.DataFrame(
        {
            "Open": benchmark_close * 0.998,
            "High": benchmark_close * 1.004,
            "Low": benchmark_close * 0.996,
            "Close": benchmark_close,
            "Adjusted Close": benchmark_close,
            "Volume": np.full(len(index), 8_000_000),
        },
        index=index,
    )
    stock_volume = np.full(len(index), 2_000_000.0)
    stock_volume[-5:] = 7_500_000
    stock = pd.DataFrame(
        {
            "Open": stock_close * 0.997,
            "High": stock_close * 1.008,
            "Low": stock_close * 0.994,
            "Close": stock_close,
            "Adjusted Close": stock_close,
            "Volume": stock_volume,
        },
        index=index,
    )
    return stock, benchmark


def _article(title: str, link: str, hours_ago: int, source: str = "SeekingAlpha") -> dict:
    return {
        "title": title,
        "link": link,
        "source": source,
        "published_at": NOW - timedelta(hours=hours_ago),
    }


def _check(hours_ago: int, succeeded: bool = True) -> dict:
    return {
        "source": "SeekingAlpha",
        "checked_at": NOW - timedelta(hours=hours_ago),
        "succeeded": succeeded,
        "item_count": 4,
    }


def test_claim_copies_increase_propagation_without_inflating_independence():
    stock, benchmark = _market_frames()
    articles = [
        _article(
            "ServiceNow raises guidance after earnings beat",
            "https://seekingalpha.com/news/now-guidance?utm_source=feed",
            10,
        ),
        _article(
            "ServiceNow raises guidance after earnings beat",
            "https://seekingalpha.com/news/now-guidance?ref=copy",
            9,
        ),
        _article(
            "ServiceNow raises guidance after earnings beat",
            "https://www.reuters.com/technology/servicenow-guidance",
            8,
            source="Reuters",
        ),
    ]

    result = build_narrative_analysis(
        "NOW",
        articles,
        [_check(2), _check(26), _check(50)],
        stock,
        benchmark,
        now=NOW,
    )

    assert result["counts"]["raw_items"] == 3
    assert result["counts"]["claim_clusters"] == 1
    assert result["counts"]["propagation_items"] == 2
    cluster = result["clusters"][0]
    assert cluster["propagation_count"] == 3
    assert cluster["independent_source_count"] == 2
    assert cluster["confidence"] > 0.9
    assert result["direction"] > 0
    assert result["market_confirmation"]["available_metric_count"] == 3
    assert result["market_confirmation"]["metrics"][3]["status"] == "unavailable"


def test_duplicate_titles_from_one_source_count_as_one_confidence_input():
    stock, benchmark = _market_frames()
    articles = [
        _article("ServiceNow raises guidance after earnings beat", "https://seekingalpha.com/news/one", 8),
        _article("ServiceNow raises guidance after earnings beat", "https://seekingalpha.com/news/two", 7),
        _article("ServiceNow raises guidance after earnings beat", "https://seekingalpha.com/news/three", 6),
    ]

    result = build_narrative_analysis("NOW", articles, [_check(1), _check(25)], stock, benchmark, now=NOW)

    cluster = result["clusters"][0]
    assert cluster["independent_source_count"] == 1
    assert cluster["confidence"] == 0.58
    assert result["evidence_confidence"] == 0.58


def test_silence_requires_successful_collection_receipts_and_a_baseline():
    stock, benchmark = _market_frames()
    articles = [
        _article(
            f"ServiceNow corporate update number {index}",
            f"https://example.com/now/{index}",
            24 * (14 + index * 9),
            source="Example News",
        )
        for index in range(7)
    ]

    supported = build_narrative_analysis(
        "NOW",
        articles,
        [_check(4), _check(28), _check(52)],
        stock,
        benchmark,
        now=NOW,
    )
    unsupported = build_narrative_analysis(
        "NOW",
        articles,
        [],
        stock,
        benchmark,
        now=NOW,
    )

    assert supported["silence"]["key"] == "unexpected_silence"
    assert supported["silence"]["successful_checks_7d"] == 3
    assert unsupported["silence"]["key"] == "collection_unobserved"


def test_empty_evidence_does_not_become_neutral_public_opinion():
    stock, benchmark = _market_frames()

    result = build_narrative_analysis("NOW", [], [_check(2), _check(30)], stock, benchmark, now=NOW)

    assert result["narrative_impulse"] == 0
    assert result["direction"] is None
    public_group = next(group for group in result["driver_groups"] if group["key"] == "community_public")
    assert public_group["available"] is False
    assert result["coverage"]["status"] == "unavailable"
