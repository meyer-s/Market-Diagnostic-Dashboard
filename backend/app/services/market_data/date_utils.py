from __future__ import annotations

from datetime import date, datetime
from typing import Optional


def parse_option_expiry(value: str) -> Optional[date]:
    if not value:
        return None
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except Exception:
            pass
    return None


def expiry_to_ibkr(value: str) -> str:
    parsed = parse_option_expiry(value)
    if parsed is None:
        raise ValueError(f"Invalid option expiry: {value}")
    return parsed.strftime("%Y%m%d")


def expiry_to_iso(value: str) -> str:
    parsed = parse_option_expiry(value)
    if parsed is None:
        raise ValueError(f"Invalid option expiry: {value}")
    return parsed.isoformat()
