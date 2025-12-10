"""
FRED API Client
Atlas → Agent A

Handles data fetching from the Federal Reserve Economic Data API using
the free FRED API token.
"""

import httpx
from datetime import datetime
from typing import Optional, List
from app.core.config import settings

FRED_API_KEY = settings.FRED_API_KEY
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"


class FredClientError(Exception):
    pass


class FredClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or FRED_API_KEY
        # Note: API key validation happens when methods are called

    async def fetch_series(
        self,
        series_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[dict]:
        """Fetch a full FRED time series."""
        if not self.api_key:
            raise FredClientError("FRED_API_KEY is required to fetch data")
        
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json"
        }

        if start_date:
            params["observation_start"] = start_date
        if end_date:
            params["observation_end"] = end_date

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(FRED_BASE_URL, params=params)

        if r.status_code != 200:
            raise FredClientError(
                f"Failed to fetch FRED series {series_id}: {r.text}"
            )

        data = r.json()

        if "observations" not in data:
            raise FredClientError(f"Unexpected FRED response: {data}")

        # Return list of {date, value}
        clean = [
            {
                "date": obs["date"],
                "value": float(obs["value"]) if obs["value"] not in ("", ".") else None
            }
            for obs in data["observations"]
        ]

        return clean