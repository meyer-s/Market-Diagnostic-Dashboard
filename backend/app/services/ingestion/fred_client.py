"""
FRED API Client
Atlas → Agent A

Handles data fetching from the Federal Reserve Economic Data API using
the free FRED API token.
"""

import httpx
from typing import Optional, List
from app.core.config import settings
from app.services.ingestion.retry import ProviderRequestError, retry_async, retry_sync

FRED_API_KEY = settings.FRED_API_KEY
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"


class FredClientError(Exception):
    pass


class FredClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or FRED_API_KEY
        # Note: API key validation happens when methods are called

    def _build_params(
        self,
        series_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> dict:
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
        }
        if start_date:
            params["observation_start"] = start_date
        if end_date:
            params["observation_end"] = end_date
        return params

    def _parse_series_response(self, response: httpx.Response, series_id: str) -> List[dict]:
        request_id = response.headers.get("x-request-id") or response.headers.get("x-amzn-requestid")
        if response.status_code != 200:
            raise ProviderRequestError(
                source="fred",
                identifier=series_id,
                message=f"Failed to fetch FRED series {series_id}: {response.text}",
                status_code=response.status_code,
                request_id=request_id,
            )

        data = response.json()
        if "observations" not in data:
            raise ProviderRequestError(
                source="fred",
                identifier=series_id,
                message=f"Unexpected FRED response for {series_id}",
                status_code=response.status_code,
                request_id=request_id,
            )

        return [
            {
                "date": obs["date"],
                "value": float(obs["value"]) if obs["value"] not in ("", ".") else None,
                "source": "fred",
                "series_id": series_id,
                "request_id": request_id,
            }
            for obs in data["observations"]
        ]

    async def fetch_series(
        self,
        series_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[dict]:
        """Fetch a full FRED time series."""
        if not self.api_key:
            raise FredClientError("FRED_API_KEY is required to fetch data")

        params = self._build_params(series_id, start_date, end_date)

        async def _request() -> List[dict]:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(FRED_BASE_URL, params=params)
            return self._parse_series_response(response, series_id)

        try:
            return await retry_async(_request)
        except ProviderRequestError as exc:
            raise FredClientError(str(exc)) from exc

    def fetch_series_sync(
        self,
        series_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[dict]:
        if not self.api_key:
            raise FredClientError("FRED_API_KEY is required to fetch data")

        params = self._build_params(series_id, start_date, end_date)

        def _request() -> List[dict]:
            with httpx.Client(timeout=20) as client:
                response = client.get(FRED_BASE_URL, params=params)
            return self._parse_series_response(response, series_id)

        try:
            return retry_sync(_request)
        except ProviderRequestError as exc:
            raise FredClientError(str(exc)) from exc
