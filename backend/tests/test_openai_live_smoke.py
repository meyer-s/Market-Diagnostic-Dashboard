from __future__ import annotations

import os

import pytest


@pytest.mark.skipif(
    os.getenv("RUN_OPENAI_LIVE_TESTS", "").strip().lower() not in {"1", "true", "yes"},
    reason="Live OpenAI tests are opt-in. Set RUN_OPENAI_LIVE_TESTS=1 to enable.",
)
def test_openai_chat_completions_json_smoke():
    # This is intentionally tiny to keep cost and latency low.
    if not (os.getenv("OPENAI_API_KEY") or "").strip():
        pytest.skip("OPENAI_API_KEY not set in environment.")

    from app.services.market_diagnostic_runner import _openai_chat_completion_json

    system_prompt = "Return only valid JSON. No emojis."
    user_prompt = '{"task":"Return a single JSON object with keys ok (boolean) and note (string)."}'

    data = _openai_chat_completion_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        timeout_seconds=20,
        max_retries=0,
        overall_deadline_seconds=25,
    )

    assert isinstance(data, dict)
    assert data.get("ok") in {True, False}
    assert isinstance(data.get("note", ""), str)

