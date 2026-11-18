import io
import json

import pytest

from app.services.wsb_reader import WsbReader, pin_id


def test_wsb_access_requires_configured_app_and_exact_private_key(monkeypatch):
    for name in ("CLIENT_ID", "CLIENT_SECRET", "USER_AGENT"):
        monkeypatch.setenv(f"WSB_REDDIT_{name}", "configured")
    monkeypatch.setenv("WSB_READER_ACCESS_KEY", "reader-key")
    reader = WsbReader()
    assert reader.authorized("Bearer reader-key")
    assert not reader.authorized(None)
    assert not reader.authorized("Bearer mismatched")
    monkeypatch.delenv("WSB_REDDIT_CLIENT_SECRET")
    assert not WsbReader().authorized("Bearer reader-key")


def test_pinned_threads_only_resolve_within_wsb_on_reddit():
    assert pin_id("/r/wallstreetbets/comments/abc123/thread/") == "abc123"
    assert pin_id("https://oauth.reddit.com/r/wallstreetbets/comments/abc123/thread/.json") == "abc123"
    with pytest.raises(ValueError):
        pin_id("https://example.com/r/wallstreetbets/comments/abc123/thread/")
    with pytest.raises(ValueError):
        pin_id("/r/stocks/comments/abc123/thread/")


def test_reader_sorts_newest_and_omits_deleted_replies(monkeypatch):
    reader = WsbReader()
    monkeypatch.setattr(reader, "get_token", lambda: "fixture-token")
    monkeypatch.setattr(reader, "pinned_id", lambda *_: "abc123")
    post = {"id": "abc123", "subreddit": "wallstreetbets",
            "title": "Daily Discussion Thread for November 18, 2026", "created_utc": 1794996000}

    def comment(ident, published, *, author="reader", body="Reply"):
        return {"kind": "t1", "data": {"id": ident, "author": author, "body": body, "created_utc": published}}

    def response(url, **_):
        assert "/comments/abc123?sort=new" in url
        values = [
            {"data": {"children": [{"data": post}]}},
            {"data": {"children": [
                comment("older", 1794996020), comment("newer", 1794996040),
                comment("deleted", 1794996030, author="[deleted]"),
                comment("removed", 1794996050, body="[removed]"),
                {"kind": "more"},
            ]}},
        ]
        return io.BytesIO(json.dumps(values).encode())

    monkeypatch.setattr(reader, "request", response)
    result = reader.read()
    assert [reply["id"] for reply in result["discussion"]["replies"]] == ["newer", "older"]
    assert result["discussion"]["url"].endswith("/comments/abc123/?sort=new")
    assert reader.read()["discussion"] is result["discussion"]
