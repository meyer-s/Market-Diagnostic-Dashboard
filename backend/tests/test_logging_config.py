from __future__ import annotations

import logging

from app.utils.logging_config import (
    SensitiveQueryRedactionFilter,
    configure_safe_dependency_logging,
)


def test_sensitive_query_redaction_filter_masks_common_credentials() -> None:
    record = logging.LogRecord(
        name="httpx",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg=(
            "GET https://example.test/data?series_id=ABC"
            "&api_key=top-secret&access_token=also-secret"
        ),
        args=(),
        exc_info=None,
    )

    assert SensitiveQueryRedactionFilter().filter(record)
    message = record.getMessage()
    assert "top-secret" not in message
    assert "also-secret" not in message
    assert "api_key=[REDACTED]" in message
    assert "access_token=[REDACTED]" in message


def test_safe_dependency_logging_is_idempotent_and_suppresses_info() -> None:
    httpx_logger = logging.getLogger("httpx")
    original_level = httpx_logger.level
    original_filters = list(httpx_logger.filters)
    try:
        configure_safe_dependency_logging()
        configure_safe_dependency_logging()

        assert httpx_logger.level == logging.WARNING
        assert (
            sum(
                isinstance(item, SensitiveQueryRedactionFilter)
                for item in httpx_logger.filters
            )
            == 1
        )
    finally:
        httpx_logger.setLevel(original_level)
        httpx_logger.filters[:] = original_filters
