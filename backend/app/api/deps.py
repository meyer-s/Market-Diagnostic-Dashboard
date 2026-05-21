from __future__ import annotations

import hmac
from typing import Optional

from fastapi import Header, HTTPException

from app.core.config import settings


def _require_bearer_key(header_value: Optional[str], expected_key: Optional[str], missing_detail: str) -> None:
    configured_key = (expected_key or "").strip()
    if not configured_key:
        raise HTTPException(status_code=500, detail=missing_detail)

    header = (header_value or "").strip()
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    provided = header.split(" ", 1)[1].strip()
    if not provided or not hmac.compare_digest(provided, configured_key):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")


def require_admin_key(authorization: Optional[str] = Header(default=None, alias="Authorization")) -> None:
    _require_bearer_key(
        authorization,
        settings.ADMIN_API_KEY,
        "Admin API key is not configured.",
    )
