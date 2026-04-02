from app.services import market_psychology as mp


def test_filter_candidates_blocks_proxies_when_disabled():
    candidates = [
        ("PRIMARY", "Primary Series", False),
        ("FALLBACK", "Fallback Series", True),
    ]

    filtered = mp._filter_candidates(candidates, allow_proxies=False)

    assert filtered == [("PRIMARY", "Primary Series", False)]


def test_filter_candidates_keeps_all_when_enabled():
    candidates = [
        ("PRIMARY", "Primary Series", False),
        ("FALLBACK", "Fallback Series", True),
    ]

    filtered = mp._filter_candidates(candidates, allow_proxies=True)

    assert filtered == candidates


def test_cache_entry_expires(monkeypatch):
    mp._clear_cache()

    now = 1_000.0
    monkeypatch.setattr(mp.time, "time", lambda: now)
    mp._cache_set("k", {"v": 1}, ttl_seconds=10)

    assert mp._cache_get("k") == {"v": 1}

    monkeypatch.setattr(mp.time, "time", lambda: now + 11)
    assert mp._cache_get("k") is None
