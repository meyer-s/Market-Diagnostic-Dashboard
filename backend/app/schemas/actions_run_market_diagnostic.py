from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class GPTActionRunMarketDiagnosticRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_date_utc: Optional[str] = Field(default=None, description="YYYY-MM-DD (UTC)")
    dry_run: bool = False
    mode: Literal["manual", "backfill"] = "manual"

    @field_validator("run_date_utc")
    @classmethod
    def validate_run_date(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        candidate = value.strip()
        if not _DATE_RE.match(candidate):
            raise ValueError("run_date_utc must be YYYY-MM-DD")
        return candidate

