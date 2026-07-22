from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


HERE = Path(__file__).resolve().parent
RESULTS_DIR = HERE / "results"
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W")
MARKET_TZ = ZoneInfo("America/New_York")


def possibly_incomplete(timeframe: str, coverage_end: str | None, observed_at: datetime) -> bool | None:
    if not coverage_end:
        return None
    timestamp = pd.Timestamp(coverage_end)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(MARKET_TZ)
    observed = pd.Timestamp(observed_at)
    if timeframe == "1D":
        local = observed.astimezone(MARKET_TZ)
        return timestamp.date() == local.date() and local.time() < datetime.strptime("16:15", "%H:%M").time()
    if timeframe == "1W":
        monday = observed.astimezone(MARKET_TZ).date() - timedelta(days=observed.astimezone(MARKET_TZ).weekday())
        return timestamp.date() >= monday and observed.astimezone(MARKET_TZ).weekday() < 4
    minutes = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240}[timeframe]
    return timestamp.tz_convert("UTC") + pd.Timedelta(minutes=minutes) > observed


def probe(base_url: str) -> dict[str, object]:
    observed_at = datetime.now(timezone.utc)
    rows: list[dict[str, object]] = []
    for timeframe in TIMEFRAMES:
        query = urllib.parse.urlencode(
            {
                "symbol": "SPY",
                "timeframe": timeframe,
                "bars": 120,
                "horizon_min": 12,
                "horizon_max": 48,
                "horizon_step": 2,
            }
        )
        url = f"{base_url.rstrip('/')}?{query}"
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(url, timeout=90) as response:  # noqa: S310 - explicit public endpoint
                payload = json.loads(response.read().decode("utf-8"))
                elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)
                rows.append(
                    {
                        "timeframe": timeframe,
                        "http_status": int(response.status),
                        "elapsed_ms": elapsed_ms,
                        "available_bars": payload.get("available_bars"),
                        "coverage_start": payload.get("coverage_start"),
                        "coverage_end": payload.get("coverage_end"),
                        "data_source": payload.get("data_source"),
                        "causal_declared": payload.get("methodology", {}).get("causal"),
                        "model": payload.get("research", {}).get("model"),
                        "possibly_incomplete_latest_bar": possibly_incomplete(
                            timeframe,
                            payload.get("coverage_end"),
                            observed_at,
                        ),
                        "error": None,
                    }
                )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            rows.append(
                {
                    "timeframe": timeframe,
                    "http_status": getattr(exc, "code", None),
                    "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 1),
                    "available_bars": None,
                    "coverage_start": None,
                    "coverage_end": None,
                    "data_source": None,
                    "causal_declared": None,
                    "model": None,
                    "possibly_incomplete_latest_bar": None,
                    "error": str(exc),
                }
            )
    return {
        "probe_version": "market_field_live_probe_v1",
        "observed_at_utc": observed_at.isoformat(),
        "endpoint": base_url,
        "rows": rows,
        "summary": {
            "successful_timeframes": sum(row["http_status"] == 200 for row in rows),
            "timeframes": len(rows),
            "median_elapsed_ms": float(pd.Series([row["elapsed_ms"] for row in rows]).median()),
            "possible_incomplete_latest_bars": sum(row["possibly_incomplete_latest_bar"] is True for row in rows),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe the deployed Market Field endpoint across supported timeframes")
    parser.add_argument(
        "--endpoint",
        default="https://marketdiagnostictool.com/api/market-weather/analyze",
    )
    args = parser.parse_args()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = probe(args.endpoint)
    (RESULTS_DIR / "live_endpoint_probe.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    pd.DataFrame(payload["rows"]).to_csv(RESULTS_DIR / "live_endpoint_probe.csv", index=False)
    print(json.dumps(payload["summary"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
