from __future__ import annotations

import asyncio
import random
import time
from typing import Any, Awaitable, Callable, Optional, Sequence, TypeVar

T = TypeVar("T")

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class ProviderRequestError(Exception):
    def __init__(
        self,
        *,
        source: str,
        identifier: str,
        message: str,
        status_code: Optional[int] = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.source = source
        self.identifier = identifier
        self.status_code = status_code
        self.request_id = request_id


def _is_retryable(exc: Exception, retryable_status_codes: Sequence[int]) -> bool:
    status_code = getattr(exc, "status_code", None)
    return bool(status_code in retryable_status_codes)


def _backoff_delay(attempt: int, status_code: Optional[int]) -> float:
    base_delay = 1.5 if status_code == 429 else 0.5
    return min(base_delay * (2 ** max(attempt - 1, 0)) + random.uniform(0, 0.15), 8.0)


async def retry_async(
    operation: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    retryable_status_codes: Sequence[int] = tuple(RETRYABLE_STATUS_CODES),
) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= attempts or not _is_retryable(exc, retryable_status_codes):
                raise
            await asyncio.sleep(_backoff_delay(attempt, getattr(exc, "status_code", None)))
    assert last_error is not None
    raise last_error


def retry_sync(
    operation: Callable[[], T],
    *,
    attempts: int = 3,
    retryable_status_codes: Sequence[int] = tuple(RETRYABLE_STATUS_CODES),
) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= attempts or not _is_retryable(exc, retryable_status_codes):
                raise
            time.sleep(_backoff_delay(attempt, getattr(exc, "status_code", None)))
    assert last_error is not None
    raise last_error
