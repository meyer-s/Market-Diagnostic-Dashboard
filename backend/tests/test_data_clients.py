from __future__ import annotations

import asyncio

import httpx
import pytest

from app.services.ingestion.fred_client import FredClient, FredClientError


def test_fred_client_retries_transient_http_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    async def _fake_get(self, url, params=None):  # noqa: ANN001
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(500, json={"error": "server error"})
        return httpx.Response(200, json={"observations": [{"date": "2026-01-01", "value": "1.0"}]})

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get, raising=True)

    result = asyncio.run(FredClient(api_key="fred-key").fetch_series("TEST"))

    assert calls["count"] == 2
    assert result[0]["source"] == "fred"


def test_fred_client_retries_rate_limit_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    async def _fake_get(self, url, params=None):  # noqa: ANN001
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(200, json={"observations": [{"date": "2026-01-01", "value": "2.0"}]})

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get, raising=True)

    result = asyncio.run(FredClient(api_key="fred-key").fetch_series("TEST"))

    assert calls["count"] == 2
    assert result[0]["series_id"] == "TEST"


def test_fred_client_raises_structured_error_for_malformed_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_get(self, url, params=None):  # noqa: ANN001
        return httpx.Response(200, json={"unexpected": []})

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get, raising=True)

    with pytest.raises(FredClientError):
        asyncio.run(FredClient(api_key="fred-key").fetch_series("TEST"))
