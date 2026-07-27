"""Machine-readable live probe for the Relative Field Pair endpoint.

Example, from the backend directory:

    python -m app.scripts.probe_market_weather_pair \
      --endpoint http://127.0.0.1:8000/market-weather/compare \
      --target SPY --benchmark RSP --samples 5

The probe validates the response/receipt boundary and reports observed client
and backend response-ready durations. It does not claim to measure browser
rendering, framework JSON serialization, compression, or network transfer as
separate server stages.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from datetime import datetime, timezone
from typing import Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


PROBE_SCHEMA_VERSION = "market_field_pair_probe_v1"
PAIR_SCHEMA_VERSION = "market_field_pair_v1"
PAIR_RECEIPT_VERSION = "market_field_pair_receipt_v1"
PAIR_RUNTIME_SCHEMA_VERSION = "market_field_pair_runtime_v1"


def _canonical_sha256(payload: object) -> str:
    encoded = json.dumps(
        _normalize_signed_zero(payload),
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalize_signed_zero(payload: object) -> object:
    if isinstance(payload, float):
        return 0.0 if payload == 0.0 else payload
    if isinstance(payload, Mapping):
        return {
            str(key): _normalize_signed_zero(value)
            for key, value in payload.items()
        }
    if isinstance(payload, (list, tuple)):
        return [_normalize_signed_zero(value) for value in payload]
    return payload


def validate_pair_response(
    payload: object,
    headers: Mapping[str, str],
) -> list[dict[str, object]]:
    """Return stable, machine-readable checks without raising on bad payloads."""
    normalized_headers = {
        str(key).lower(): str(value)
        for key, value in headers.items()
    }
    checks: list[dict[str, object]] = []

    def check(check_id: str, passed: bool, detail: str) -> None:
        checks.append({"id": check_id, "ok": bool(passed), "detail": detail})

    if not isinstance(payload, Mapping):
        check("response_object", False, "Response JSON is not an object.")
        return checks
    check("response_object", True, "Response JSON is an object.")
    check(
        "pair_schema",
        payload.get("schema_version") == PAIR_SCHEMA_VERSION,
        f"Expected {PAIR_SCHEMA_VERSION}.",
    )

    runtime = payload.get("runtime")
    runtime_payload = runtime if isinstance(runtime, Mapping) else {}
    check(
        "runtime_schema",
        runtime_payload.get("schema_version") == PAIR_RUNTIME_SCHEMA_VERSION,
        f"Expected {PAIR_RUNTIME_SCHEMA_VERSION}.",
    )
    cache = runtime_payload.get("cache")
    cache_payload = cache if isinstance(cache, Mapping) else {}
    cache_status = str(cache_payload.get("status") or "")
    check(
        "cache_status",
        cache_status in {"hit", "miss", "wait"},
        f"Observed cache status {cache_status or 'missing'}.",
    )
    check(
        "cache_header",
        normalized_headers.get("x-market-weather-comparison-cache")
        == cache_status,
        "Comparison-cache header matches runtime metadata.",
    )
    check(
        "runtime_header",
        normalized_headers.get("x-market-weather-runtime-schema")
        == PAIR_RUNTIME_SCHEMA_VERSION,
        "Runtime-schema header matches the response contract.",
    )
    check(
        "server_timing",
        "pair-ready;dur=" in normalized_headers.get("server-timing", ""),
        "Server-Timing exposes the response-ready boundary.",
    )

    receipt = payload.get("frozen_receipt")
    receipt_payload = receipt if isinstance(receipt, Mapping) else {}
    receipt_hash = str(receipt_payload.get("receipt_hash") or "")
    receipt_body = dict(receipt_payload)
    receipt_body.pop("receipt_hash", None)
    calculated_receipt_hash = (
        _canonical_sha256(receipt_body)
        if receipt_payload and receipt_hash
        else ""
    )
    check(
        "receipt_schema",
        receipt_payload.get("schema_version") == PAIR_RECEIPT_VERSION,
        f"Expected {PAIR_RECEIPT_VERSION}.",
    )
    check(
        "receipt_self_check",
        bool(receipt_hash) and receipt_hash == calculated_receipt_hash,
        "Compact receipt checksum recomputes from its canonical JSON body.",
    )
    check(
        "receipt_header",
        normalized_headers.get("x-market-weather-receipt-hash")
        == receipt_hash,
        "Receipt header matches the response receipt.",
    )

    alignment = receipt_payload.get("alignment")
    alignment_payload = alignment if isinstance(alignment, Mapping) else {}
    shared_keys = alignment_payload.get("shared_keys")
    shared_key_values = shared_keys if isinstance(shared_keys, list) else []
    check(
        "shared_keys_hash",
        bool(shared_key_values)
        and alignment_payload.get("shared_keys_hash")
        == _canonical_sha256(shared_key_values),
        "Exact shared-key sequence matches its checksum.",
    )
    window = payload.get("window")
    window_payload = window if isinstance(window, Mapping) else {}
    returned_observations = window_payload.get("returned_exact_shared_observations")
    check(
        "shared_key_count",
        isinstance(returned_observations, int)
        and returned_observations == len(shared_key_values),
        "Returned exact observation count matches the receipt key sequence.",
    )

    support = payload.get("support")
    support_payload = support if isinstance(support, Mapping) else {}
    supported_cells = support_payload.get("supported_coordinate_cells")
    total_cells = support_payload.get("total_coordinate_cells")
    support_valid = (
        isinstance(supported_cells, int)
        and isinstance(total_cells, int)
        and 0 <= supported_cells <= total_cells
        and total_cells == len(shared_key_values) * 15
    )
    check(
        "support_denominator",
        support_valid,
        "Window-cell support is bounded and uses 15 coordinates per shared row.",
    )

    latest_coordinates = receipt_payload.get("latest_coordinates")
    latest_coordinate_values = (
        latest_coordinates if isinstance(latest_coordinates, list) else []
    )
    check(
        "coordinate_count",
        len(latest_coordinate_values) == 15,
        "Compact receipt contains all 15 latest coordinate records.",
    )

    authority = payload.get("authority")
    authority_payload = authority if isinstance(authority, Mapping) else {}
    zero_authority = (
        authority_payload.get("mode") == "research_display_only"
        and authority_payload.get("scanner_weight") == 0.0
        and authority_payload.get("option_learning_weight") == 0.0
        and authority_payload.get("veto") is False
        and authority_payload.get("sizing") is False
        and authority_payload.get("execution") is False
    )
    check(
        "zero_authority",
        zero_authority,
        "Pair response remains research-display-only.",
    )
    return checks


def _nearest_rank(values: Sequence[float], percentile: float) -> float | None:
    finite = sorted(float(value) for value in values if math.isfinite(float(value)))
    if not finite:
        return None
    rank = max(1, math.ceil((percentile / 100.0) * len(finite)))
    return round(finite[min(rank, len(finite)) - 1], 3)


def _build_url(args: argparse.Namespace) -> str:
    query = urlencode(
        {
            "target_symbol": args.target,
            "benchmark_symbol": args.benchmark,
            "timeframe": args.timeframe,
            "bars": args.bars,
            "horizon_min": args.horizon_min,
            "horizon_max": args.horizon_max,
            "horizon_step": args.horizon_step,
        }
    )
    return f"{args.endpoint.rstrip('?&')}?{query}"


def _read_once(url: str, timeout_seconds: float) -> dict[str, object]:
    started = time.perf_counter()
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "market-field-pair-probe/1",
        },
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw_body = response.read()
            status = int(response.status)
            headers = {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as exc:
        raw_body = exc.read()
        status = int(exc.code)
        headers = {key.lower(): value for key, value in exc.headers.items()}
    client_ms = (time.perf_counter() - started) * 1000.0
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = None
    return {
        "http_status": status,
        "client_duration_ms": round(client_ms, 3),
        "headers": headers,
        "payload": payload,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and time a deployed Relative Field Pair response.",
    )
    parser.add_argument(
        "--endpoint",
        default="http://127.0.0.1:8000/market-weather/compare",
    )
    parser.add_argument("--target", default="SPY")
    parser.add_argument("--benchmark", default="RSP")
    parser.add_argument("--timeframe", default="1D")
    parser.add_argument("--bars", type=int, default=180)
    parser.add_argument("--horizon-min", type=int, default=8)
    parser.add_argument("--horizon-max", type=int, default=64)
    parser.add_argument("--horizon-step", type=int, default=4)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.samples = max(1, min(50, int(args.samples)))
    url = _build_url(args)
    samples: list[dict[str, object]] = []
    try:
        for sample_index in range(args.samples):
            observed = _read_once(url, max(0.1, float(args.timeout_seconds)))
            payload = observed.pop("payload")
            headers = observed.pop("headers")
            checks = validate_pair_response(
                payload,
                headers if isinstance(headers, Mapping) else {},
            )
            runtime = (
                payload.get("runtime")
                if isinstance(payload, Mapping)
                and isinstance(payload.get("runtime"), Mapping)
                else None
            )
            samples.append(
                {
                    "sample": sample_index + 1,
                    **observed,
                    "cache_status": (
                        headers.get("x-market-weather-comparison-cache")
                        if isinstance(headers, Mapping)
                        else None
                    ),
                    "server_timing": (
                        headers.get("server-timing")
                        if isinstance(headers, Mapping)
                        else None
                    ),
                    "runtime": runtime,
                    "checks": checks,
                    "ok": (
                        observed.get("http_status") == 200
                        and bool(checks)
                        and all(bool(check.get("ok")) for check in checks)
                    ),
                }
            )
    except (OSError, URLError, TimeoutError) as exc:
        output = {
            "schema_version": PROBE_SCHEMA_VERSION,
            "ok": False,
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "endpoint": url,
            "error": f"{type(exc).__name__}: {exc}",
            "samples": samples,
        }
        print(json.dumps(output, indent=2, sort_keys=True))
        return 1

    client_durations = [
        float(sample["client_duration_ms"])
        for sample in samples
        if isinstance(sample.get("client_duration_ms"), (int, float))
    ]
    backend_ready_durations: list[float] = []
    for sample in samples:
        runtime = sample.get("runtime")
        response = runtime.get("response") if isinstance(runtime, Mapping) else None
        duration = (
            response.get("handler_to_response_ready_ms")
            if isinstance(response, Mapping)
            else None
        )
        if isinstance(duration, (int, float)):
            backend_ready_durations.append(float(duration))
    output = {
        "schema_version": PROBE_SCHEMA_VERSION,
        "ok": all(bool(sample.get("ok")) for sample in samples),
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": url,
        "sample_count": len(samples),
        "percentile_rule": "nearest_rank",
        "client_duration_ms": {
            "p50": _nearest_rank(client_durations, 50),
            "p95": _nearest_rank(client_durations, 95),
        },
        "backend_handler_to_response_ready_ms": {
            "p50": _nearest_rank(backend_ready_durations, 50),
            "p95": _nearest_rank(backend_ready_durations, 95),
        },
        "samples": samples,
        "measurement_boundary": (
            "Client duration includes transport and response-body read. Backend "
            "response-ready duration excludes framework JSON serialization, "
            "compression, transport, and browser rendering."
        ),
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
