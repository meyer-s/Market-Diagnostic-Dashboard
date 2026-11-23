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
    exact = live.Story("NVDA earnings", source.home, now, "releases", source, "exact")
    qualified = live.Story(
        "U.S. retail sales", source.home, now, "releases", source, "qualified",
    )
    duplicate = replace(qualified, guid="duplicate", title=qualified.title + "!", published=now - timedelta(minutes=1))
    archived = replace(qualified, guid="old", title="CPI and rate cuts lift GLD", published=now - timedelta(hours=3))
    statuses = {source: live.SourceStatus(story_list=(exact, qualified, duplicate, archived), checked=now, success=now, latest=now)}
    assert live.relevance(exact, live.DEFAULTS).points == 45
    assert live.relevance(qualified, live.DEFAULTS).points == 46

    def snapshot(preferences):
        return json.loads(live.snapshot_payload(
            [], statuses, now, "tech", "wire", {}, {"q": "AI", "page": "4"}, "", preferences,
        ))

    body = snapshot(live.DEFAULTS)
    assert body["articles"] == []
    assert [(alert["title"], alert["score"]) for alert in body["alerts"]["headlines"]] == [(qualified.title, 46)]
    assert body["alerts"]["threshold"] == 45

    low_weight = replace(live.DEFAULTS, weights={**live.DEFAULTS.weights, "releases": 3})
    assert snapshot(low_weight)["alerts"]["headlines"] == []
    assert live.alert_payload(statuses, None, live.DEFAULTS, now)["headlines"] == []


def test_raw_sources_are_independent_of_existing_topic_weights_and_allowlisted():
    custom = live.load_preferences("market_live_weights=11111111.tight; market_live_sources_v2=hn.ransomware.unknown")
    assert custom.weights == dict.fromkeys(live.TOPICS, 1)
    assert custom.focus == "tight"
    assert custom.raw_sources == ("ransomware", "hn")
    assert live.load_preferences(None).raw_sources == live.RAW_SOURCE_KEYS
    assert live.load_preferences("market_live_sources_v2=zerohedge").raw_sources == ("zerohedge",)
    malformed_weights = live.load_preferences("market_live_weights=bad; market_live_sources_v2=hn")
    assert malformed_weights.weights == live.DEFAULTS.weights
    assert malformed_weights.raw_sources == ("hn",)


def test_gray_defaults_migrate_enabled_profiles_and_preserve_explicit_off():
    assert live.load_preferences("market_live_sources=").raw_sources == ()
    assert live.load_preferences("market_live_sources_v2=").raw_sources == ()
    assert live.load_preferences("market_live_sources=unknown").raw_sources == ()
    migrated = live.load_preferences("market_live_sources=zerohedge.hn")
    assert migrated.raw_sources == ("zerohedge", "hn", *live.NEW_GRAY_SOURCE_KEYS)
    current = live.load_preferences("market_live_sources=zerohedge; market_live_sources_v2=hn")
    assert current.raw_sources == ("hn",)


def test_raw_cached_stories_do_not_leak_to_other_readers_or_alerts():
    now = live.now_utc()
    raw = next(source for source in live.SOURCES if source.raw_key == "zerohedge")
    story = live.Story("U.S. retail sales lift gold futures and GLD", raw.home, now, "metals", raw, "claim")
    status = live.SourceStatus(story_list=(story,), checked=now, success=now, latest=now)
    statuses = {raw: status}
    enabled = replace(live.DEFAULTS, raw_sources=("zerohedge",))
    disabled = replace(live.DEFAULTS, raw_sources=())
    assert live.available_stories(statuses, preferences=disabled) == []
    assert live.available_stories(statuses, wire_only=True, preferences=disabled) == []
    assert live.alert_payload(statuses, now, disabled, now)["headlines"] == []
    assert live.available_stories(statuses, preferences=enabled) == [story]
    alerts = live.alert_payload(statuses, now, enabled, now)["headlines"]
    assert alerts[0]["score"] == 61
    assert alerts[0]["report_label"] == "Commentary / unverified"

    def snapshot(preferences):
        return json.loads(live.snapshot_payload([story], statuses, now, "", "all", {}, {}, "", preferences))
    assert snapshot(disabled)["articles"] == []
    assert snapshot(disabled)["gray"]["articles"] == []
    assert snapshot(disabled)["sources"][0]["state"] == "Off"
    assert snapshot(enabled)["articles"] == []
    assert snapshot(enabled)["gray"]["articles"][0]["report_label"] == raw.report_label
    assert snapshot(enabled)["raw_sources"] == ["zerohedge"]


def test_gray_feed_has_independent_pages_and_respects_shared_filters():
    now = live.now_utc()
    raw = next(source for source in live.SOURCES if source.raw_key == "ransomlook")
    direct = live.SOURCES[0]
    normal = live.Story("Main market headline", direct.home, now, "markets", direct, "normal")
    gray = [live.Story(f"Claim {index}", raw.home, now - timedelta(minutes=index), "tech", raw, str(index))
            for index in range(live.GRAY_PAGE_SIZE + 2)]
    statuses = {source: live.SourceStatus(checked=now, success=now, latest=now) for source in (raw, direct)}
    def snapshot(**params):
        return json.loads(live.snapshot_payload([normal], statuses, now, "", "focused", {}, params, "", live.DEFAULTS,
                                                gray_stories=gray))
    first = snapshot()
    assert [article["id"] for article in first["articles"]] == ["normal"]
    assert first["gray"]["total"] == live.GRAY_PAGE_SIZE + 2
    assert len(first["gray"]["articles"]) == live.GRAY_PAGE_SIZE
    last = snapshot(gray_page="999")
    assert last["page"] == 1
    assert last["gray"]["page"] == 2
    assert len(last["gray"]["articles"]) == 2
    filtered = snapshot(q="Claim 13")
    assert filtered["articles"] == []
    assert [article["title"] for article in filtered["gray"]["articles"]] == ["Claim 13"]
    assert snapshot(when="24h")["gray"]["total"] == len(gray)
    assert snapshot(gray_stream="leaks")["gray"]["total"] == len(gray)
    assert snapshot(gray_stream="community")["gray"]["articles"] == []
    assert snapshot(gray_stream="community")["articles"][0]["id"] == "normal"


def test_direct_reporting_wins_over_raw_reposts_and_rss_carries_claim_label():
    now = live.now_utc()
    raw = next(source for source in live.SOURCES if source.raw_key == "hn")
    direct = live.SOURCES[0]
    story = live.Story("Breaking headline", raw.home, now, "tech", raw, "raw")
    official = replace(story, source=direct, guid="official", url=direct.home, published=now - timedelta(seconds=1))
    statuses = {source: live.SourceStatus(story_list=(item,), checked=now, success=now, latest=now)
                for source, item in ((raw, story), (direct, official))}
    preferences = replace(live.DEFAULTS, raw_sources=("hn",))
    assert live.available_stories(statuses, preferences=preferences) == [official]
    payload = live.rss_payload([story], {}, statuses, now, "", "all").decode()
    assert "Gray · Community submission" in payload
    assert "Personal relevance is not a confidence score" in payload


def test_optional_polls_require_a_source_lease_and_follow_background_cadence(tmp_path):
    raw = next(source for source in live.SOURCES if source.raw_key == "ransomware")
    with patch.object(live, "monotonic", return_value=100.0) as clock:
        news = live.News()
        news.renew()
        assert news.source_mode(raw) == "idle"
        news.renew(background=True, raw_sources=("ransomware",))
        assert news.source_mode(raw) == "background"
        assert news.source_mode(next(source for source in live.SOURCES if source.raw_key == "hn")) == "idle"
        news.renew(raw_sources=("ransomware",))
        assert news.source_mode(raw) == "foreground"
        clock.return_value += live.ACTIVE_SECONDS
        assert news.source_mode(raw) == "background"
        clock.return_value = 100 + live.BACKGROUND_ACTIVE_SECONDS
        assert news.source_mode(raw) == "idle"

    with (patch.object(live, "SOURCES", (raw,)),
          patch.object(live, "WIRE_HISTORY_FILE", tmp_path / "raw.sqlite3"),
          patch.object(live, "fetch", return_value=live.SourceStatus()) as fetch):
        news = live.News()
        news.renew()
        worker = Thread(target=news.refresh)
        worker.start()
        try:
            news.stop.wait(0.08)
            assert not fetch.called
            news.renew(raw_sources=("ransomware",))
            for _ in range(40):
                if fetch.called:
                    break
                news.stop.wait(0.025)
            fetch.assert_called_once()
        finally:
            news.stop.set()
            news.wakeup.set()
            worker.join(timeout=2)
        assert not worker.is_alive()
