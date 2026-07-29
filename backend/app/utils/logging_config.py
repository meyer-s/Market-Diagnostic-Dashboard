from __future__ import annotations

import logging
import re


_SENSITIVE_QUERY_VALUE = re.compile(
    r"(?i)([?&](?:api[_-]?key|apikey|access[_-]?token|token|secret|password)=)"
    r"([^&\s\"']+)"
)


class SensitiveQueryRedactionFilter(logging.Filter):
    """Remove credentials embedded in logged request URLs."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True

        redacted = _SENSITIVE_QUERY_VALUE.sub(r"\1[REDACTED]", message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def configure_safe_dependency_logging() -> None:
    """Keep dependency request logs quiet and redact any URL that is emitted."""

    redaction_filter = SensitiveQueryRedactionFilter()
    for logger_name in ("httpx", "httpcore"):
        dependency_logger = logging.getLogger(logger_name)
        dependency_logger.setLevel(logging.WARNING)
        if not any(
            isinstance(existing, SensitiveQueryRedactionFilter)
            for existing in dependency_logger.filters
        ):
            dependency_logger.addFilter(redaction_filter)

    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if not any(
            isinstance(existing, SensitiveQueryRedactionFilter)
            for existing in handler.filters
        ):
            handler.addFilter(redaction_filter)
