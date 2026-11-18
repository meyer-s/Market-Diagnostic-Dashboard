from dataclasses import replace
from datetime import timedelta
import json
import sqlite3
from threading import Thread
from unittest.mock import patch

from app.services import live_news as live


def test_poller_waits_for_demand(tmp_path):
    source = live.SOURCES[0]
    with (
        patch.object(live, "SOURCES", (source,)),
        patch.object(live, "WIRE_HISTORY_FILE", tmp_path / "live.sqlite3"),
        patch.object(live, "fetch", return_value=live.SourceStatus()) as fetch,
    ):
        news = live.News()
        worker = Thread(target=news.refresh)
        worker.start()
        try:
            assert not news.active()
            assert not fetch.called
            news.renew()
            for _ in range(40):
                if fetch.called:
                    break
                news.stop.wait(0.025)
            fetch.assert_called_once()
            assert news.active()
        finally:
            news.stop.set()
            news.wakeup.set()
            worker.join(timeout=2)
        assert not worker.is_alive()


def test_background_demand_slows_polling_until_a_foreground_reader_arrives(tmp_path):
    source = replace(live.SOURCES[0], interval=0.01)
    with (
        patch.object(live, "SOURCES", (source,)),
        patch.object(live, "MIN_SOURCE_INTERVAL", 0.01),
        patch.object(live, "WIRE_HISTORY_FILE", tmp_path / "background.sqlite3"),
        patch.object(live, "fetch", return_value=live.SourceStatus()) as fetch,
    ):
        news = live.News()
        worker = Thread(target=news.refresh)
        worker.start()
        try:
            news.renew(background=True)
            for _ in range(40):
                if fetch.called:
                    break
                news.stop.wait(0.025)
            news.stop.wait(0.07)
            fetch.assert_called_once()
            assert news.activity_mode() == "background"

            news.renew()
            for _ in range(40):
                if fetch.call_count >= 2:
                    break
                news.stop.wait(0.025)
            assert fetch.call_count >= 2
            assert news.activity_mode() == "foreground"
        finally:
            news.stop.set()
            news.wakeup.set()
            worker.join(timeout=2)
        assert not worker.is_alive()


def test_demand_uses_separate_foreground_and_background_expiration():
    with patch.object(live, "monotonic", return_value=200.0) as clock:
        news = live.News()
        news.renew(background=True)
        assert news.activity_mode() == "background"
        news.renew()
        assert news.activity_mode() == "foreground"

        clock.return_value = 200.0 + live.ACTIVE_SECONDS
        assert news.activity_mode() == "background"
        clock.return_value = 200.0 + live.BACKGROUND_ACTIVE_SECONDS
        assert news.activity_mode() == "idle"


def test_prune_wire_archive_keeps_newest_unexpired_entries():
    now = live.now_utc()
    statuses = {}
    with sqlite3.connect(":memory:") as db:
        live.restore_wire_history(db, statuses, now)
        for feed in ("a", "b"):
            for index in range(4):
                timestamp = now - timedelta(minutes=index)
                expiry = now - timedelta(minutes=1) if index == 0 else now + timedelta(days=1)
                db.execute("INSERT INTO wire_entries VALUES (?, ?, '', '', ?, '', '', ?)",
                           (feed, str(index), timestamp.isoformat(), expiry.isoformat()))

        with patch.object(live, "MAX_FEED_STORIES", 2), patch.object(live, "MAX_ARCHIVE_STORIES", 3):
            live.prune_wire_history(db, now)

        assert list(db.execute("SELECT feed, guid FROM wire_entries ORDER BY feed, guid")) == [
            ("a", "1"), ("a", "2"), ("b", "1"),
        ]


def test_weights_are_isolated_by_cookie():
    custom = live.load_preferences("market_live_weights=11111111.tight")
    assert set(custom.weights.values()) == {1}
    assert custom.focus == "tight"
    assert live.load_preferences(None) == live.DEFAULTS


def test_native_snapshot_keeps_release_priority_and_bounds_headline_pages():
    now = live.now_utc()
    source = next(source for source in live.SOURCES if source.name == "U.S. Census Bureau")
    release = live.Story(
        "U.S. retail sales rose 0.5%", source.home, now, "releases", source, "retail", "Official summary",
    )
    stories = [
        live.Story(f"Markets headline {index}", source.home, now, "markets", source, str(index))
        for index in range(live.PAGE_SIZE + 2)
    ]
    statuses = {source: live.SourceStatus(success=now, latest=now)}
    scores = {release.guid: live.Relevance(61, ("Economic release",))}

    def snapshot(**params):
        return json.loads(live.snapshot_payload(
            [release, *stories], statuses, now, "", "focused", scores, params, "", live.DEFAULTS,
        ))

    first = snapshot()
    assert first["total"] == live.PAGE_SIZE + 2
    assert len(first["articles"]) == live.PAGE_SIZE
    assert [(story["id"], story["priority"], story["summary"]) for story in first["featured"]] == [
        ("retail", "Top", "Official summary"),
    ]
    last = snapshot(page="999")
    assert (last["page"], last["pages"], len(last["articles"]), last["featured"]) == (2, 2, 2, [])
    search = snapshot(q="retail sales")
    assert [story["id"] for story in search["articles"]] == ["retail"]
    assert search["featured"] == []


def test_relevance_alerts_use_personal_weights_before_view_filters():
    now = live.now_utc()
    source = next(source for source in live.SOURCES if source.name == "U.S. Census Bureau")
    exact = live.Story("U.S. retail sales lift options volume", source.home, now, "releases", source, "exact")
    qualified = live.Story(
        "U.S. retail sales lift gold futures and GLD", source.home, now, "releases", source, "qualified",
    )
    duplicate = replace(qualified, guid="duplicate", title=qualified.title + "!", published=now - timedelta(minutes=1))
    archived = replace(qualified, guid="old", title="CPI and rate cuts lift GLD", published=now - timedelta(hours=3))
    statuses = {source: live.SourceStatus(story_list=(exact, qualified, duplicate, archived), checked=now, success=now, latest=now)}
    assert live.relevance(exact, live.DEFAULTS).points == 60
    assert live.relevance(qualified, live.DEFAULTS).points == 61

    def snapshot(preferences):
        return json.loads(live.snapshot_payload(
            [], statuses, now, "tech", "wire", {}, {"q": "AI", "page": "4"}, "", preferences,
        ))

    body = snapshot(live.DEFAULTS)
    assert body["articles"] == []
    assert [(alert["title"], alert["score"]) for alert in body["alerts"]["headlines"]] == [(qualified.title, 61)]
    assert body["alerts"]["threshold"] == 60

    low_weight = replace(live.DEFAULTS, weights={**live.DEFAULTS.weights, "releases": 3})
    assert snapshot(low_weight)["alerts"]["headlines"] == []
    assert live.alert_payload(statuses, None, live.DEFAULTS, now)["headlines"] == []
