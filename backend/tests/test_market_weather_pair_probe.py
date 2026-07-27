from __future__ import annotations

import json

from app.scripts import probe_market_weather_pair as probe


def _valid_probe_fixture() -> tuple[dict[str, object], dict[str, str]]:
    shared_keys = ["2026-07-24", "2026-07-25"]
    receipt_body: dict[str, object] = {
        "schema_version": "market_field_pair_receipt_v1",
        "alignment": {
            "shared_keys": shared_keys,
            "shared_keys_hash": probe._canonical_sha256(shared_keys),
        },
        "latest_coordinates": [
            {"id": f"coordinate-{index}", "latest": {"pair_supported": True}}
            for index in range(15)
        ],
    }
    receipt = {
        **receipt_body,
        "receipt_hash": probe._canonical_sha256(receipt_body),
    }
    payload: dict[str, object] = {
        "schema_version": "market_field_pair_v1",
        "runtime": {
            "schema_version": "market_field_pair_runtime_v1",
            "cache": {"status": "hit", "stages_ms": {"lookup": 0.1}},
            "response": {"handler_to_response_ready_ms": 1.5},
        },
        "frozen_receipt": receipt,
        "window": {"returned_exact_shared_observations": 2},
        "support": {
            "supported_coordinate_cells": 30,
            "total_coordinate_cells": 30,
        },
        "authority": {
            "mode": "research_display_only",
            "scanner_weight": 0.0,
            "option_learning_weight": 0.0,
            "veto": False,
            "sizing": False,
            "execution": False,
        },
    }
    headers = {
        "X-Market-Weather-Comparison-Cache": "hit",
        "X-Market-Weather-Runtime-Schema": "market_field_pair_runtime_v1",
        "X-Market-Weather-Receipt-Hash": receipt["receipt_hash"],
        "Server-Timing": 'pair-ready;dur=1.500;desc="response ready"',
    }
    return payload, headers


def test_probe_validator_accepts_consistent_pair_contract() -> None:
    payload, headers = _valid_probe_fixture()

    checks = probe.validate_pair_response(payload, headers)

    assert checks
    assert all(check["ok"] for check in checks)


def test_probe_validator_reports_receipt_and_authority_tampering() -> None:
    payload, headers = _valid_probe_fixture()
    payload["authority"]["scanner_weight"] = 0.1
    payload["frozen_receipt"]["latest_coordinates"][0]["id"] = "tampered"

    checks = {
        check["id"]: check
        for check in probe.validate_pair_response(payload, headers)
    }

    assert checks["receipt_self_check"]["ok"] is False
    assert checks["zero_authority"]["ok"] is False


def test_probe_main_emits_machine_readable_percentiles(
    monkeypatch,
    capsys,
) -> None:
    payload, headers = _valid_probe_fixture()
    durations = iter((10.0, 20.0, 30.0))

    def read_once(_url: str, _timeout_seconds: float) -> dict[str, object]:
        return {
            "http_status": 200,
            "client_duration_ms": next(durations),
            "headers": headers,
            "payload": payload,
        }

    monkeypatch.setattr(probe, "_read_once", read_once)

    exit_code = probe.main(["--samples", "3"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["schema_version"] == "market_field_pair_probe_v1"
    assert output["ok"] is True
    assert output["sample_count"] == 3
    assert output["percentile_rule"] == "nearest_rank"
    assert output["client_duration_ms"] == {"p50": 20.0, "p95": 30.0}
    assert output["backend_handler_to_response_ready_ms"] == {
        "p50": 1.5,
        "p95": 1.5,
    }
