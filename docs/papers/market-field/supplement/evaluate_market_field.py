from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, time as wall_time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.collections import LineCollection


HERE = Path(__file__).resolve().parent


def find_repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "backend").is_dir() and (candidate / "frontend").is_dir():
            return candidate
    raise RuntimeError(f"Could not locate repository root from {start}")


REPO_ROOT = find_repo_root(HERE)
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.market_data.yahoo_provider import YahooProvider  # noqa: E402
from app.services import market_weather as market_weather_module  # noqa: E402
from app.services import market_weather_research as market_weather_research_module  # noqa: E402
from app.services.market_weather import MarketWeatherSettings, build_market_weather  # noqa: E402
from app.services.option_field_context import (  # noqa: E402
    OPTION_FIELD_HORIZONS,
    OPTION_FIELD_MIN_BARS,
    build_option_field_context,
)


RAW_DIR = HERE / "data" / "raw"
RESULTS_DIR = HERE / "results"
FIGURES_DIR = HERE / "figures"
MANIFEST_PATH = RAW_DIR / "manifest.json"
RUN_RECEIPT_PATH = RESULTS_DIR / "run_receipt.json"

RECEIPT_SOURCE_PATHS = (
    Path("backend/app/services/market_weather.py"),
    Path("backend/app/services/market_weather_research.py"),
    Path("backend/app/services/market_weather_context.py"),
    Path("backend/app/services/option_field_context.py"),
    Path("backend/app/services/market_data/yahoo_provider.py"),
    Path("backend/app/api/market_weather.py"),
    Path("docs/papers/market-field/supplement/evaluate_market_field.py"),
)
RECEIPT_DEPENDENCIES = (
    "matplotlib",
    "numpy",
    "pandas",
    "scipy",
    "yfinance",
)

BASE_HORIZONS = tuple(range(12, 50, 2))
RESOLUTION_STEPS = (1, 2, 4, 8)
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W")
DAILY_SYMBOLS = ("SPY", "QQQ", "IWM", "TLT", "GLD", "USO", "BTC-USD")
PREFIX_FRACTIONS = (0.60, 0.80, 0.95)
PREFIX_TOLERANCE = 1e-4
FULL_PRECISION_TOLERANCE = 1e-12
HISTORY_WINDOWS = (60, 96, 128, 192, 256, 365)
ENTROPY_WINDOWS = (8, 12, 24, 48, 96)
PUBLIC_API_MIN_VISIBLE_BARS = 60
MARKET_TZ = ZoneInfo("America/New_York")
DAILY_COMPLETION_TIME = wall_time(16, 15)

PALETTE = {
    "blue": "#2F6B9A",
    "gold": "#C7932F",
    "orange": "#D8782D",
    "olive": "#768A3A",
    "pink": "#B75B7A",
    "ink": "#25303B",
    "muted": "#66727E",
    "grid": "#DDE2E7",
    "light": "#EEF2F5",
}


@dataclass(frozen=True)
class DatasetSpec:
    symbol: str
    timeframe: str
    bars: int

    @property
    def dataset_id(self) -> str:
        safe_symbol = self.symbol.lower().replace("^", "index-").replace("-", "_")
        return f"{safe_symbol}_{self.timeframe.lower()}"


def dataset_specs() -> list[DatasetSpec]:
    specs = [DatasetSpec("SPY", timeframe, 500 if timeframe != "1D" else 750) for timeframe in TIMEFRAMES]
    specs.extend(DatasetSpec(symbol, "1D", 750) for symbol in DAILY_SYMBOLS if symbol != "SPY")
    return specs


def ensure_directories() -> None:
    for directory in (RAW_DIR, RESULTS_DIR, FIGURES_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value)!r}")


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=json_default) + "\n",
        encoding="utf-8",
    )


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=json_default).encode("utf-8")
    return sha256_bytes(encoded)


def _git_command(*args: str) -> tuple[int, str, str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode, completed.stdout.strip(), completed.stderr.strip()


def repository_run_context() -> dict[str, Any]:
    head_code, head, head_error = _git_command("rev-parse", "HEAD")
    branch_code, branch, branch_error = _git_command("branch", "--show-current")
    status_code, status, status_error = _git_command(
        "status",
        "--short",
        "--untracked-files=all",
    )
    status_entries = status.splitlines() if status_code == 0 and status else []
    status_summary: dict[str, int] = {}
    for entry in status_entries:
        code = entry[:2] if len(entry) >= 2 else "??"
        status_summary[code] = status_summary.get(code, 0) + 1
    dirty = bool(status_entries) if status_code == 0 else None
    if dirty is True:
        provenance_note = (
            "The evaluation used working-tree files. HEAD is recorded only as a repository "
            "reference and must not be described as the exact evaluated source snapshot."
        )
    elif dirty is False:
        provenance_note = (
            "The working tree was clean at capture time; HEAD identifies the evaluated "
            "repository state, subject to the per-file hashes in this receipt."
        )
    else:
        provenance_note = (
            "Git status was unavailable. Use the per-file hashes, not HEAD, as the evaluated "
            "source identity."
        )
    errors = [
        message
        for code, message in (
            (head_code, head_error),
            (branch_code, branch_error),
            (status_code, status_error),
        )
        if code != 0 and message
    ]
    return {
        "head": head if head_code == 0 else None,
        "branch": branch if branch_code == 0 else None,
        "dirty": dirty,
        "status_entry_count": len(status_entries),
        "status_summary": dict(sorted(status_summary.items())),
        "status_entries": status_entries,
        "provenance_note": provenance_note,
        "git_errors": errors,
    }


def receipt_source_hashes() -> dict[str, str | None]:
    return {
        path.as_posix(): sha256_file(REPO_ROOT / path) if (REPO_ROOT / path).is_file() else None
        for path in RECEIPT_SOURCE_PATHS
    }


def receipt_dependency_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for distribution in RECEIPT_DEPENDENCIES:
        try:
            versions[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            versions[distribution] = None
    return versions


def artifact_receipt_entry(path: Path, *, kind: str) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(HERE)).replace("\\", "/"),
        "kind": kind,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def build_run_receipt(
    *,
    started_at_utc: datetime,
    repository_at_start: Mapping[str, Any],
    source_hashes_at_start: Mapping[str, str | None],
    manifest: Mapping[str, Any],
    tables: Mapping[str, pd.DataFrame],
    figures: Sequence[Path],
) -> dict[str, Any]:
    completed_at_utc = datetime.now(timezone.utc)
    source_hashes_at_completion = receipt_source_hashes()
    source_changes = sorted(
        path
        for path in set(source_hashes_at_start).union(source_hashes_at_completion)
        if source_hashes_at_start.get(path) != source_hashes_at_completion.get(path)
    )
    generated_artifacts = [
        artifact_receipt_entry(RESULTS_DIR / filename, kind="table")
        for filename in tables
    ]
    generated_artifacts.extend(
        artifact_receipt_entry(path, kind="figure")
        for path in figures
    )
    generated_artifacts.extend(
        artifact_receipt_entry(RESULTS_DIR / filename, kind="result")
        for filename in ("summary.json", "shadow_boundary.json")
    )
    return {
        "receipt_version": "market_field_supplement_run_receipt_v1",
        "started_at_utc": started_at_utc.isoformat().replace("+00:00", "Z"),
        "completed_at_utc": completed_at_utc.isoformat().replace("+00:00", "Z"),
        "elapsed_seconds": (completed_at_utc - started_at_utc).total_seconds(),
        "repository_at_start": dict(repository_at_start),
        "sources": {
            "sha256_at_start": dict(source_hashes_at_start),
            "sha256_at_completion": source_hashes_at_completion,
            "changed_during_run": source_changes,
            "stable_for_run": not source_changes,
            "identity_rule": (
                "Per-file SHA-256 values identify evaluated source. A dirty HEAD is a parent "
                "reference only, not an exact source snapshot."
            ),
        },
        "input_snapshot": {
            "manifest_path": str(MANIFEST_PATH.relative_to(HERE)).replace("\\", "/"),
            "manifest_sha256": sha256_file(MANIFEST_PATH),
            "snapshot_version": manifest.get("snapshot_version"),
            "observed_at_utc": manifest.get("observed_at_utc"),
            "dataset_count": len(manifest.get("datasets", [])),
            "frozen_manifest_was_not_rewritten_by_receipt": True,
        },
        "environment": {
            "python": platform.python_version(),
            "python_implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine() or None,
            "processor": platform.processor() or None,
            "dependencies": receipt_dependency_versions(),
        },
        "generated_artifacts": generated_artifacts,
        "artifact_count": len(generated_artifacts),
        "receipt_self_hash_excluded": True,
    }


def git_context() -> dict[str, Any]:
    def command(*args: str) -> str:
        completed = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip()

    tracked_sources = [
        BACKEND_ROOT / "app" / "services" / "market_weather.py",
        BACKEND_ROOT / "app" / "services" / "market_weather_research.py",
        BACKEND_ROOT / "app" / "services" / "option_field_context.py",
    ]
    return {
        "commit": command("rev-parse", "HEAD"),
        "branch": command("branch", "--show-current"),
        "working_tree_status": command("status", "--short"),
        "source_sha256": {
            str(path.relative_to(REPO_ROOT)).replace("\\", "/"): sha256_file(path)
            for path in tracked_sources
            if path.exists()
        },
    }


def _normalize_ohlcv(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    lookup = {str(column).lower(): column for column in frame.columns}
    required = ("open", "high", "low", "close")
    if any(column not in lookup for column in required):
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    normalized = pd.DataFrame(index=pd.to_datetime(frame.index, errors="coerce"))
    for column in required:
        normalized[column.capitalize()] = pd.to_numeric(frame[lookup[column]], errors="coerce").to_numpy()
    normalized["Volume"] = (
        pd.to_numeric(frame[lookup["volume"]], errors="coerce").fillna(0.0).to_numpy()
        if "volume" in lookup
        else 0.0
    )
    normalized = normalized[normalized.index.notna()]
    normalized = normalized.dropna(subset=["Open", "High", "Low", "Close"])
    return normalized[~normalized.index.duplicated(keep="last")].sort_index()


def _intraday_duration(timeframe: str) -> timedelta:
    mapping = {
        "1m": timedelta(minutes=1),
        "5m": timedelta(minutes=5),
        "15m": timedelta(minutes=15),
        "30m": timedelta(minutes=30),
        "1h": timedelta(hours=1),
        "2h": timedelta(hours=2),
        "4h": timedelta(hours=4),
    }
    return mapping[timeframe]


def _as_market_timestamp(value: pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize(MARKET_TZ)
    return timestamp.tz_convert(MARKET_TZ)


def completed_bar_mask(index: pd.DatetimeIndex, timeframe: str, observed_at: datetime) -> np.ndarray:
    observed_utc = pd.Timestamp(observed_at).tz_convert("UTC")
    if timeframe in {"1m", "5m", "15m", "30m", "1h", "2h", "4h"}:
        duration = _intraday_duration(timeframe)
        return np.asarray([
            _as_market_timestamp(pd.Timestamp(value)).tz_convert("UTC") + duration <= observed_utc
            for value in index
        ])
    observed_local = observed_at.astimezone(MARKET_TZ)
    if timeframe == "1D":
        completed_date = observed_local.date()
        if observed_local.time().replace(tzinfo=None) < DAILY_COMPLETION_TIME:
            completed_date -= timedelta(days=1)
        return np.asarray([pd.Timestamp(value).date() <= completed_date for value in index])
    if timeframe == "1W":
        keep: list[bool] = []
        for value in index:
            label = _as_market_timestamp(pd.Timestamp(value))
            friday = label.normalize() + pd.Timedelta(days=4, hours=16, minutes=15)
            keep.append(friday <= pd.Timestamp(observed_local))
        return np.asarray(keep)
    raise ValueError(f"Unsupported timeframe {timeframe!r}")


def fetch_public_snapshot(*, force: bool = False) -> dict[str, Any]:
    ensure_directories()
    if MANIFEST_PATH.exists() and not force:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    provider = YahooProvider()
    observed_at = datetime.now(timezone.utc)
    entries: list[dict[str, Any]] = []
    for spec in dataset_specs():
        last_error: Exception | None = None
        frame = pd.DataFrame()
        for attempt in range(3):
            try:
                frame = provider.historical_bars(spec.symbol, spec.timeframe, bars=spec.bars)
                if frame is None or frame.empty:
                    raise ValueError("empty response")
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt < 2:
                    time.sleep(1.0 + attempt)
        if frame is None or frame.empty:
            raise RuntimeError(f"Unable to fetch {spec.dataset_id}: {last_error}")

        normalized = _normalize_ohlcv(frame)
        fetched_rows = len(normalized)
        mask = completed_bar_mask(normalized.index, spec.timeframe, observed_at)
        completed = normalized.loc[mask].tail(spec.bars)
        if len(completed) < 60:
            raise RuntimeError(f"{spec.dataset_id} has only {len(completed)} completed bars")
        path = RAW_DIR / f"{spec.dataset_id}.csv"
        completed.to_csv(path, index_label="timestamp", date_format="%Y-%m-%dT%H:%M:%S%z")
        entries.append(
            {
                **asdict(spec),
                "dataset_id": spec.dataset_id,
                "path": str(path.relative_to(HERE)).replace("\\", "/"),
                "fetched_rows": fetched_rows,
                "completed_rows": len(completed),
                "excluded_incomplete_rows": int(fetched_rows - len(completed)),
                "coverage_start": pd.Timestamp(completed.index[0]).isoformat(),
                "coverage_end": pd.Timestamp(completed.index[-1]).isoformat(),
                "sha256": sha256_file(path),
            }
        )

    import yfinance as yf

    manifest = {
        "snapshot_version": "market_field_public_snapshot_v1",
        "observed_at_utc": observed_at.isoformat(),
        "provider": "Yahoo Finance via yfinance YahooProvider",
        "provider_package": f"yfinance {yf.__version__}",
        "adjustment_note": "YahooProvider uses yfinance Ticker.history defaults; prices may be adjusted for corporate actions.",
        "completion_policy": {
            "intraday": "Bar-start timestamp plus nominal duration must be no later than snapshot time; conservative for partial 2h/4h closing buckets.",
            "daily": "US session label is retained only after 16:15 America/New_York; otherwise the current session is excluded.",
            "weekly": "Monday-labeled weekly bar is retained only after Friday 16:15 America/New_York.",
        },
        "datasets": entries,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "repository": git_context(),
    }
    write_json(MANIFEST_PATH, manifest)
    return manifest


def load_snapshot(manifest: Mapping[str, Any]) -> dict[str, pd.DataFrame]:
    missing_paths = [
        HERE / entry["path"]
        for entry in manifest["datasets"]
        if not (HERE / entry["path"]).exists()
    ]
    if missing_paths:
        missing = ", ".join(path.name for path in missing_paths[:4])
        if len(missing_paths) > 4:
            missing += f", and {len(missing_paths) - 4} more"
        raise FileNotFoundError(
            "The local retained Yahoo snapshot is not present "
            f"({missing}). Raw Yahoo CSVs are intentionally not redistributed. "
            "Run evaluate_market_field.py --force-fetch to create a new, explicitly "
            "versioned local snapshot; it will not reproduce the historical hashes."
        )
    frames: dict[str, pd.DataFrame] = {}
    for entry in manifest["datasets"]:
        path = HERE / entry["path"]
        if sha256_file(path) != entry["sha256"]:
            raise RuntimeError(f"Frozen input hash mismatch: {path}")
        frame = pd.read_csv(path, index_col="timestamp")
        frame.index = pd.to_datetime(frame.index, utc=True)
        frames[str(entry["dataset_id"])] = frame
    return frames


def profile_snapshot(manifest: Mapping[str, Any], frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    entries = {str(entry["dataset_id"]): entry for entry in manifest["datasets"]}
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        entry = entries[dataset_id]
        numeric = frame[["Open", "High", "Low", "Close", "Volume"]].apply(pd.to_numeric, errors="coerce")
        invalid_ohlc = (
            (numeric["High"] < numeric[["Open", "Low", "Close"]].max(axis=1))
            | (numeric["Low"] > numeric[["Open", "High", "Close"]].min(axis=1))
            | (numeric[["Open", "High", "Low", "Close"]] <= 0).any(axis=1)
            | (numeric["Volume"] < 0)
        )
        rows.append(
            {
                "dataset_id": dataset_id,
                "symbol": entry["symbol"],
                "timeframe": entry["timeframe"],
                "rows": len(frame),
                "coverage_start": frame.index.min().isoformat(),
                "coverage_end": frame.index.max().isoformat(),
                "duplicate_timestamps": int(frame.index.duplicated().sum()),
                "missing_ohlcv_cells": int(numeric.isna().sum().sum()),
                "invalid_ohlcv_rows": int(invalid_ohlc.sum()),
                "monotonic_time": bool(frame.index.is_monotonic_increasing),
                "positive_volume_share": float((numeric["Volume"] > 0).mean()),
                "excluded_incomplete_rows": int(entry["excluded_incomplete_rows"]),
                "source_sha256": entry["sha256"],
            }
        )
    return pd.DataFrame(rows).sort_values(["symbol", "timeframe"]).reset_index(drop=True)


def _numeric_max_error(left: Sequence[Any], right: Sequence[Any]) -> float:
    left_values = np.asarray([np.nan if value is None else float(value) for value in left], dtype=float)
    right_values = np.asarray([np.nan if value is None else float(value) for value in right], dtype=float)
    valid = np.isfinite(left_values) & np.isfinite(right_values)
    if not np.any(valid):
        return 0.0
    return float(np.max(np.abs(left_values[valid] - right_values[valid])))


def _mapping_max_error(left: Mapping[str, Any], right: Mapping[str, Any], excluded: Iterable[str] = ("date",)) -> float:
    excluded_set = set(excluded)
    values = []
    for key in sorted(set(left).intersection(right) - excluded_set):
        if isinstance(left[key], (int, float)) and isinstance(right[key], (int, float)):
            values.append(abs(float(left[key]) - float(right[key])))
        elif left[key] is None and right[key] is None:
            values.append(0.0)
    return max(values, default=0.0)


def build_field(
    frame: pd.DataFrame,
    *,
    horizons: Sequence[int] = BASE_HORIZONS,
    retrospective: bool = False,
    history_payload: bool = False,
) -> dict[str, Any]:
    return build_market_weather(
        frame,
        horizons=horizons,
        settings=MarketWeatherSettings(),
        include_retrospective_research=retrospective,
        include_history_payload=history_payload,
    )


def _full_precision_value(value: Any, digits: int = 4) -> float | None:
    del digits
    if value is None or not np.isfinite(float(value)):
        return None
    return float(value)


def build_field_full_precision(
    frame: pd.DataFrame,
    *,
    horizons: Sequence[int] = BASE_HORIZONS,
    retrospective: bool = False,
    history_payload: bool = True,
) -> dict[str, Any]:
    """Build the production transform while bypassing response-only rounding.

    The production modules intentionally serialize matrices to four decimals and
    scalar research series to four or six decimals. This single-threaded audit
    temporarily replaces only those serializers; it does not replace any field
    transform, filter, reduction, or clustering operation.
    """

    original_matrix_serializer = market_weather_module._rounded_matrix
    original_scalar_serializer = market_weather_research_module._rounded
    market_weather_module._rounded_matrix = lambda values: np.nan_to_num(  # type: ignore[assignment]
        values,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    ).tolist()
    market_weather_research_module._rounded = _full_precision_value  # type: ignore[assignment]
    try:
        return build_field(
            frame,
            horizons=horizons,
            retrospective=retrospective,
            history_payload=history_payload,
        )
    finally:
        market_weather_module._rounded_matrix = original_matrix_serializer  # type: ignore[assignment]
        market_weather_research_module._rounded = original_scalar_serializer  # type: ignore[assignment]


def _finite_pair_count(left: Sequence[Any], right: Sequence[Any]) -> int:
    left_values = np.asarray([np.nan if value is None else float(value) for value in left], dtype=float)
    right_values = np.asarray([np.nan if value is None else float(value) for value in right], dtype=float)
    return int(np.sum(np.isfinite(left_values) & np.isfinite(right_values)))


def _mapping_pair_count(
    left: Mapping[str, Any],
    right: Mapping[str, Any],
    excluded: Iterable[str] = ("date",),
) -> int:
    excluded_set = set(excluded)
    return sum(
        1
        for key in set(left).intersection(right) - excluded_set
        if isinstance(left[key], (int, float))
        and isinstance(right[key], (int, float))
        and np.isfinite(float(left[key]))
        and np.isfinite(float(right[key]))
    )


def _endpoint_component_audit(
    left: Mapping[str, Any],
    right: Mapping[str, Any],
    *,
    left_index: int,
    right_index: int,
) -> dict[str, Any]:
    channel_error = 0.0
    channel_comparisons = 0
    left_channels = left.get("channels") if isinstance(left.get("channels"), dict) else {}
    right_channels = right.get("channels") if isinstance(right.get("channels"), dict) else {}
    for channel in sorted(set(left_channels).intersection(right_channels)):
        left_values = [row[left_index] for row in left_channels[channel]]
        right_values = [row[right_index] for row in right_channels[channel]]
        channel_error = max(channel_error, _numeric_max_error(left_values, right_values))
        channel_comparisons += _finite_pair_count(left_values, right_values)

    component_specs = {
        "derivative": (
            left["research"]["derivative_series"][left_index],
            right["research"]["derivative_series"][right_index],
        ),
        "strata": (
            left["research"]["strata"]["series"][left_index],
            right["research"]["strata"]["series"][right_index],
        ),
        "carrier": (
            left["research"]["carriers"]["series"][left_index],
            right["research"]["carriers"]["series"][right_index],
        ),
        "carrier_ratio": (
            left["research"]["carriers"]["ratios"]["series"][left_index],
            right["research"]["carriers"]["ratios"]["series"][right_index],
        ),
    }
    errors = {
        f"{name}_max_abs_error": _mapping_max_error(left_row, right_row)
        for name, (left_row, right_row) in component_specs.items()
    }
    comparisons = {
        f"{name}_comparisons": _mapping_pair_count(left_row, right_row)
        for name, (left_row, right_row) in component_specs.items()
    }
    overall = max(channel_error, *errors.values())
    return {
        "channel_max_abs_error": channel_error,
        **errors,
        "overall_max_abs_error": overall,
        "channel_comparisons": channel_comparisons,
        **comparisons,
        "numeric_value_comparisons": channel_comparisons + sum(comparisons.values()),
    }


def prefix_invariance_full_precision_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        full = build_field_full_precision(frame, retrospective=False, history_payload=True)
        count = len(frame)
        cutoffs = sorted({max(60, min(count - 1, int(round(count * fraction)))) for fraction in PREFIX_FRACTIONS})
        for cutoff in cutoffs:
            prefix = build_field_full_precision(
                frame.iloc[:cutoff],
                retrospective=False,
                history_payload=True,
            )
            audit = _endpoint_component_audit(
                prefix,
                full,
                left_index=-1,
                right_index=cutoff - 1,
            )
            rows.append(
                {
                    "dataset_id": dataset_id,
                    "audit_kind": "historical_prefix",
                    "cutoff_bars": cutoff,
                    "total_bars": count,
                    **audit,
                    "tolerance": FULL_PRECISION_TOLERANCE,
                    "passes_tolerance": audit["overall_max_abs_error"] <= FULL_PRECISION_TOLERANCE,
                }
            )

    mutation_frame = frames["spy_1d"].copy()
    cutoff = int(len(mutation_frame) * 0.75)
    baseline = build_field_full_precision(mutation_frame, retrospective=False, history_payload=True)
    mutated = mutation_frame.astype(
        {"Open": "float64", "High": "float64", "Low": "float64", "Close": "float64", "Volume": "float64"}
    ).copy()
    suffix = mutated.index[cutoff:]
    multiplier = np.linspace(0.35, 2.75, len(suffix))
    for column in ("Open", "High", "Low", "Close"):
        mutated.loc[suffix, column] = mutated.loc[suffix, column].to_numpy() * multiplier
    mutated.loc[suffix, "Volume"] = mutated.loc[suffix, "Volume"].to_numpy() * multiplier[::-1]
    stressed = build_field_full_precision(mutated, retrospective=False, history_payload=True)
    mutation_audit = _endpoint_component_audit(
        baseline,
        stressed,
        left_index=cutoff - 1,
        right_index=cutoff - 1,
    )
    rows.append(
        {
            "dataset_id": "spy_1d_future_suffix_mutation",
            "audit_kind": "future_suffix_mutation",
            "cutoff_bars": cutoff,
            "total_bars": len(mutation_frame),
            **mutation_audit,
            "tolerance": FULL_PRECISION_TOLERANCE,
            "passes_tolerance": mutation_audit["overall_max_abs_error"] <= FULL_PRECISION_TOLERANCE,
        }
    )
    return pd.DataFrame(rows)


def prefix_invariance_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        full = build_field(frame, retrospective=False, history_payload=True)
        count = len(frame)
        cutoffs = sorted({max(60, min(count - 1, int(round(count * fraction)))) for fraction in PREFIX_FRACTIONS})
        for cutoff in cutoffs:
            prefix = build_field(frame.iloc[:cutoff], retrospective=False, history_payload=True)
            channel_error = 0.0
            for channel in prefix["channels"]:
                prefix_values = [row[-1] for row in prefix["channels"][channel]]
                full_values = [row[cutoff - 1] for row in full["channels"][channel]]
                channel_error = max(channel_error, _numeric_max_error(prefix_values, full_values))
            derivative_error = _mapping_max_error(
                prefix["research"]["derivative_series"][-1],
                full["research"]["derivative_series"][cutoff - 1],
            )
            strata_error = _mapping_max_error(
                prefix["research"]["strata"]["series"][-1],
                full["research"]["strata"]["series"][cutoff - 1],
            )
            carrier_error = _mapping_max_error(
                prefix["research"]["carriers"]["series"][-1],
                full["research"]["carriers"]["series"][cutoff - 1],
            )
            ratio_error = _mapping_max_error(
                prefix["research"]["carriers"]["ratios"]["series"][-1],
                full["research"]["carriers"]["ratios"]["series"][cutoff - 1],
            )
            overall = max(channel_error, derivative_error, strata_error, carrier_error, ratio_error)
            rows.append(
                {
                    "dataset_id": dataset_id,
                    "cutoff_bars": cutoff,
                    "total_bars": count,
                    "channel_max_abs_error": channel_error,
                    "derivative_max_abs_error": derivative_error,
                    "strata_max_abs_error": strata_error,
                    "carrier_max_abs_error": carrier_error,
                    "carrier_ratio_max_abs_error": ratio_error,
                    "overall_max_abs_error": overall,
                    "passes_1e_4": overall <= PREFIX_TOLERANCE,
                }
            )

    mutation_frame = frames["spy_1d"].copy()
    cutoff = int(len(mutation_frame) * 0.75)
    baseline = build_field(mutation_frame, retrospective=False, history_payload=True)
    mutated = mutation_frame.astype({
        "Open": "float64",
        "High": "float64",
        "Low": "float64",
        "Close": "float64",
        "Volume": "float64",
    }).copy()
    suffix = mutated.index[cutoff:]
    multiplier = np.linspace(0.35, 2.75, len(suffix))
    for column in ("Open", "High", "Low", "Close"):
        mutated.loc[suffix, column] = mutated.loc[suffix, column].to_numpy() * multiplier
    mutated.loc[suffix, "Volume"] = mutated.loc[suffix, "Volume"].to_numpy() * multiplier[::-1]
    stressed = build_field(mutated, retrospective=False, history_payload=True)
    mutation_error = 0.0
    for channel in baseline["channels"]:
        mutation_error = max(
            mutation_error,
            _numeric_max_error(
                [row[cutoff - 1] for row in baseline["channels"][channel]],
                [row[cutoff - 1] for row in stressed["channels"][channel]],
            ),
        )
    rows.append(
        {
            "dataset_id": "spy_1d_future_suffix_mutation",
            "cutoff_bars": cutoff,
            "total_bars": len(mutation_frame),
            "channel_max_abs_error": mutation_error,
            "derivative_max_abs_error": 0.0,
            "strata_max_abs_error": 0.0,
            "carrier_max_abs_error": 0.0,
            "carrier_ratio_max_abs_error": 0.0,
            "overall_max_abs_error": mutation_error,
            "passes_1e_4": mutation_error <= PREFIX_TOLERANCE,
        }
    )
    return pd.DataFrame(rows)


def determinism_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        runs = [build_field(frame, retrospective=False, history_payload=False) for _ in range(2)]
        hashes = [canonical_hash(run) for run in runs]
        rows.append(
            {
                "dataset_id": dataset_id,
                "mode": "live_only",
                "runs": len(hashes),
                "unique_hashes": len(set(hashes)),
                "deterministic": len(set(hashes)) == 1,
                "sha256": hashes[0],
            }
        )
    retrospective_runs = [build_field(frames["spy_1d"], retrospective=True, history_payload=True) for _ in range(3)]
    retrospective_hashes = [canonical_hash(run) for run in retrospective_runs]
    rows.append(
        {
            "dataset_id": "spy_1d",
            "mode": "retrospective_lexicon",
            "runs": len(retrospective_hashes),
            "unique_hashes": len(set(retrospective_hashes)),
            "deterministic": len(set(retrospective_hashes)) == 1,
            "sha256": retrospective_hashes[0],
        }
    )
    return pd.DataFrame(rows)


def _series_frame(field: Mapping[str, Any]) -> pd.DataFrame:
    derivative = pd.DataFrame(field["research"]["derivative_series"])
    strata = pd.DataFrame(field["research"]["strata"]["series"])
    return derivative.merge(strata, on="date", suffixes=("", "_strata"))


def _safe_corr(left: np.ndarray, right: np.ndarray) -> float | None:
    valid = np.isfinite(left) & np.isfinite(right)
    if int(valid.sum()) < 3 or np.std(left[valid]) <= 1e-12 or np.std(right[valid]) <= 1e-12:
        return None
    return float(np.corrcoef(left[valid], right[valid])[0, 1])


def resolution_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        fields = {
            step: build_field(
                frame,
                horizons=tuple(range(8, 65, step)),
                retrospective=False,
                history_payload=False,
            )
            for step in RESOLUTION_STEPS
        }
        reference = _series_frame(fields[1])
        warmup = min(128, max(60, len(reference) // 3))
        features = [
            "pressure",
            "velocity",
            "acceleration",
            "jerk",
            "snap",
            "structure",
            "kinematics",
            "geometry",
            "information",
            "propagation",
            "cascade_bias",
            "scaling_exponent",
        ]
        for step, field in fields.items():
            candidate = _series_frame(field)
            for feature in features:
                left = pd.to_numeric(reference[feature].iloc[warmup:], errors="coerce").to_numpy(dtype=float)
                right = pd.to_numeric(candidate[feature].iloc[warmup:], errors="coerce").to_numpy(dtype=float)
                valid = np.isfinite(left) & np.isfinite(right)
                difference = left[valid] - right[valid]
                mae = float(np.mean(np.abs(difference))) if len(difference) else math.nan
                rmse = float(np.sqrt(np.mean(np.square(difference)))) if len(difference) else math.nan
                iqr = float(np.quantile(left[valid], 0.75) - np.quantile(left[valid], 0.25)) if np.any(valid) else math.nan
                normalized_mae = mae / iqr if np.isfinite(iqr) and iqr > 1e-9 else math.nan
                rows.append(
                    {
                        "dataset_id": dataset_id,
                        "horizon_step": step,
                        "reference_step": 1,
                        "feature": feature,
                        "comparison_bars": int(valid.sum()),
                        "mae": mae,
                        "rmse": rmse,
                        "iqr_normalized_mae": normalized_mae,
                        "correlation": _safe_corr(left, right),
                        "final_abs_error": abs(float(left[-1]) - float(right[-1])) if len(left) else math.nan,
                    }
                )
    return pd.DataFrame(rows)


def _research_measure_frame(field: Mapping[str, Any]) -> pd.DataFrame:
    derivative = pd.DataFrame(field["research"]["derivative_series"])
    strata = pd.DataFrame(field["research"]["strata"]["series"])
    carriers = pd.DataFrame(field["research"]["carriers"]["series"]).rename(
        columns=lambda name: name if name == "date" else f"carrier_{name}"
    )
    ratios = pd.DataFrame(field["research"]["carriers"]["ratios"]["series"]).rename(
        columns=lambda name: name if name == "date" else f"ratio_{name}"
    )
    return derivative.merge(strata, on="date").merge(carriers, on="date").merge(ratios, on="date")


def history_truncation_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    """Compare trailing-history recomputations with the same full-history endpoint."""

    family_by_feature = {
        **{name: "derivative" for name in ("pressure", "velocity", "acceleration", "jerk", "snap")},
        **{
            name: "stratum"
            for name in (
                "structure",
                "kinematics",
                "geometry",
                "information",
                "propagation",
                "cascade_bias",
                "scaling_exponent",
            )
        },
    }
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        full = _research_measure_frame(
            build_field_full_precision(frame, retrospective=False, history_payload=False)
        )
        feature_names = [name for name in full.columns if name != "date"]
        reference_start = min(128, max(0, len(full) // 3))
        reference_iqr: dict[str, float] = {}
        for feature in feature_names:
            values = pd.to_numeric(full[feature].iloc[reference_start:], errors="coerce").to_numpy(dtype=float)
            finite = values[np.isfinite(values)]
            reference_iqr[feature] = (
                float(np.quantile(finite, 0.75) - np.quantile(finite, 0.25))
                if len(finite)
                else math.nan
            )

        for requested_window in HISTORY_WINDOWS:
            if requested_window > len(frame):
                continue
            candidate = _research_measure_frame(
                build_field_full_precision(
                    frame.iloc[-requested_window:],
                    retrospective=False,
                    history_payload=False,
                )
            )
            comparison_tail = min(32, len(candidate))
            for feature in feature_names:
                left = pd.to_numeric(full[feature].iloc[-comparison_tail:], errors="coerce").to_numpy(dtype=float)
                right = pd.to_numeric(candidate[feature].iloc[-comparison_tail:], errors="coerce").to_numpy(dtype=float)
                valid = np.isfinite(left) & np.isfinite(right)
                difference = np.abs(left[valid] - right[valid])
                scale = reference_iqr[feature]
                mae = float(np.mean(difference)) if len(difference) else math.nan
                rows.append(
                    {
                        "dataset_id": dataset_id,
                        "input_window_bars": requested_window,
                        "full_history_bars": len(frame),
                        "comparison_tail_bars": int(valid.sum()),
                        "feature_family": family_by_feature.get(
                            feature,
                            "carrier_ratio" if feature.startswith("ratio_") else "carrier",
                        ),
                        "feature": feature,
                        "mae": mae,
                        "reference_iqr": scale,
                        "iqr_normalized_mae": (
                            mae / scale if np.isfinite(mae) and np.isfinite(scale) and scale > 1e-9 else math.nan
                        ),
                        "final_abs_error": float(difference[-1]) if len(difference) else math.nan,
                    }
                )
    return pd.DataFrame(rows)


def entropy_window_checks(frames: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for dataset_id, frame in frames.items():
        field = build_field_full_precision(frame, retrospective=False, history_payload=True)
        pressure = np.asarray(field["channels"]["pressure"], dtype=float)
        legacy_disorder = np.asarray(field["channels"]["entropy"], dtype=float)
        permutation_by_window = {
            window: market_weather_research_module.rolling_permutation_entropy(
                pressure,
                order=3,
                window=window,
            )
            for window in ENTROPY_WINDOWS
        }
        aggregate_entropy = {
            window: np.mean(values, axis=0)
            for window, values in permutation_by_window.items()
        }
        aggregate_information = {
            window: np.mean(np.clip(0.72 * values + 0.28 * legacy_disorder, 0.0, 1.0), axis=0)
            for window, values in permutation_by_window.items()
        }
        evaluation = slice(min(128, max(0, len(frame) // 3)), None)
        entropy_reference = aggregate_entropy[24][evaluation]
        information_reference = aggregate_information[24][evaluation]
        for window in ENTROPY_WINDOWS:
            entropy = aggregate_entropy[window][evaluation]
            information = aggregate_information[window][evaluation]
            rows.append(
                {
                    "dataset_id": dataset_id,
                    "order": 3,
                    "possible_ordinal_patterns": math.factorial(3),
                    "window_patterns": window,
                    "comparison_bars": len(entropy),
                    "entropy_mean": float(np.mean(entropy)),
                    "entropy_mae_vs_window24": float(np.mean(np.abs(entropy - entropy_reference))),
                    "entropy_correlation_vs_window24": _safe_corr(entropy, entropy_reference),
                    "information_mae_vs_window24": float(np.mean(np.abs(information - information_reference))),
                    "information_correlation_vs_window24": _safe_corr(information, information_reference),
                }
            )
    return pd.DataFrame(rows)


def initialization_contract_checks() -> pd.DataFrame:
    longest_horizon = max(int(value) for value in OPTION_FIELD_HORIZONS)
    reference_span = max(34, longest_horizon * 2)
    api_visible = PUBLIC_API_MIN_VISIBLE_BARS
    api_prefetch = max(72, longest_horizon * 2)
    scenarios = [
        {
            "path": "option_snapshot_minimum",
            "visible_bars": OPTION_FIELD_MIN_BARS,
            "hidden_prefetch_bars": 0,
            "computation_bars": OPTION_FIELD_MIN_BARS,
            "aggregate_initialization_contract": "initialization (maturity is a legacy alias)",
            "note": "Accepted by the option wrapper; minimum-input and initialization-target coverage metadata are emitted, but no per-coordinate initialization mask is available.",
        },
        {
            "path": "public_api_min_visible_60_h48",
            "visible_bars": api_visible,
            "hidden_prefetch_bars": api_prefetch,
            "computation_bars": api_visible + api_prefetch,
            "aggregate_initialization_contract": "history_context",
            "note": "The endpoint computes on the fetched prefix plus visible bars, trims the response, and emits minimum-input and initialization-target coverage metadata.",
        },
        {
            "path": "paper_compute_benchmark_365",
            "visible_bars": 365,
            "hidden_prefetch_bars": 0,
            "computation_bars": 365,
            "aggregate_initialization_contract": "history_context",
            "note": "The paper's cached option-snapshot timing window; the core response reports aggregate initialization coverage.",
        },
    ]
    rows: list[dict[str, Any]] = []
    for scenario in scenarios:
        computation_bars = int(scenario["computation_bars"])
        rows.append(
            {
                **scenario,
                "longest_horizon_bars": longest_horizon,
                "carrier_reference_span_bars": reference_span,
                "bars_per_longest_horizon": computation_bars / longest_horizon,
                "reference_span_coverage": min(1.0, computation_bars / reference_span),
                "post_longest_horizon_observations": max(0, computation_bars - longest_horizon),
                "meets_reference_span": computation_bars >= reference_span,
                "aggregate_initialization_metadata_emitted": True,
                "per_coordinate_initialization_mask_emitted": False,
            }
        )
    return pd.DataFrame(rows)


def null_state_anchor_checks() -> pd.DataFrame:
    index = pd.date_range("2020-01-01", periods=256, freq="D", tz="UTC")
    rows: list[dict[str, Any]] = []
    for scenario, volume in (("constant_price_positive_volume", 1_000_000.0), ("constant_price_zero_volume", 0.0)):
        frame = pd.DataFrame(
            {
                "Open": np.full(len(index), 100.0),
                "High": np.full(len(index), 100.0),
                "Low": np.full(len(index), 100.0),
                "Close": np.full(len(index), 100.0),
                "Volume": np.full(len(index), volume),
            },
            index=index,
        )
        field = build_field_full_precision(frame, retrospective=False, history_payload=True)
        derivative = field["research"]["derivative_series"][-1]
        strata = field["research"]["strata"]["series"][-1]
        channels = field["channels"]
        availability = field["research"]["carriers"]["availability"]
        rows.append(
            {
                "scenario": scenario,
                "bars": len(frame),
                "pressure": float(derivative["pressure"]),
                "velocity": float(derivative["velocity"]),
                "structural_strength": float(np.mean(np.asarray(channels["structural_strength"], dtype=float)[:, -1])),
                "coherence": float(np.mean(np.asarray(channels["coherence"], dtype=float)[:, -1])),
                "legacy_disorder": float(np.mean(np.asarray(channels["entropy"], dtype=float)[:, -1])),
                "permutation_entropy": float(np.mean(np.asarray(channels["permutation_entropy"], dtype=float)[:, -1])),
                "structure": float(strata["structure"]),
                "information": float(strata["information"]),
                "propagation": float(strata["propagation"]),
                "display_confidence": float(np.mean(np.asarray(channels["confidence"], dtype=float)[:, -1])),
                "volume_carriers_available": bool(availability["participation"]),
                "semantic_interpretation": "Nonzero structure/confidence are formula anchors from coherence, not detected market organization.",
            }
        )
    return pd.DataFrame(rows)


def option_snapshot_latency_checks(
    frames: Mapping[str, pd.DataFrame],
    observed_at: datetime,
    *,
    repetitions: int = 10,
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for symbol in DAILY_SYMBOLS:
        dataset_id = f"{symbol.lower().replace('-', '_')}_1d"
        compact = frames[dataset_id].iloc[-365:].copy()
        for repetition in range(repetitions):
            started = time.perf_counter()
            payload = build_option_field_context(
                compact,
                option_type="call",
                observed_at=observed_at,
                data_source="local_retained_yahoo_snapshot",
            )
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            rows.append(
                {
                    "dataset_id": dataset_id,
                    "symbol": symbol,
                    "repetition": repetition,
                    "measurement_phase": "first_measured" if repetition == 0 else "warm",
                    "input_bars": len(compact),
                    "elapsed_ms": elapsed_ms,
                    "payload_bytes": len(
                        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=json_default).encode("utf-8")
                    ),
                    "rank_influence": payload.get("rank_influence"),
                    "automated_execution_enabled": payload.get("automated_execution_enabled"),
                }
            )
    return pd.DataFrame(rows)


def _run_lengths(states: Sequence[str]) -> list[int]:
    if not states:
        return []
    lengths: list[int] = []
    current = states[0]
    length = 1
    for state in states[1:]:
        if state == current:
            length += 1
        else:
            lengths.append(length)
            current = state
            length = 1
    lengths.append(length)
    return lengths


def _phase_label(value: float) -> str:
    if value > 0.02:
        return "positive"
    if value < -0.02:
        return "negative"
    return "neutral"


def timeframe_checks(frames: Mapping[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    nominal_minutes = {
        "1m": 1,
        "5m": 5,
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "4h": 240,
        "1D": 390,
        "1W": 1950,
    }
    rows: list[dict[str, Any]] = []
    series_by_timeframe: dict[str, pd.DataFrame] = {}
    for timeframe in TIMEFRAMES:
        dataset_id = f"spy_{timeframe.lower()}"
        frame = frames[dataset_id]
        field = build_field(frame, retrospective=False, history_payload=False)
        series = _series_frame(field)
        series["date"] = pd.to_datetime(series["date"], utc=True)
        series_by_timeframe[timeframe] = series
        evaluation = series.iloc[min(96, len(series) // 3) :].copy()
        pressure = pd.to_numeric(evaluation["pressure"], errors="coerce").to_numpy(dtype=float)
        velocity = pd.to_numeric(evaluation["velocity"], errors="coerce").to_numpy(dtype=float)
        phases = [_phase_label(value) for value in pressure]
        transitions = sum(left != right for left, right in zip(phases, phases[1:]))
        lengths = _run_lengths(phases)
        coverage_days = (frame.index.max() - frame.index.min()).total_seconds() / 86400.0
        rows.append(
            {
                "timeframe": timeframe,
                "bars": len(frame),
                "evaluation_bars": len(evaluation),
                "coverage_days": coverage_days,
                "finite_feature_share": float(np.isfinite(evaluation.select_dtypes(include=[np.number]).to_numpy()).mean()),
                "pressure_median": float(np.nanmedian(pressure)),
                "pressure_iqr": float(np.nanquantile(pressure, 0.75) - np.nanquantile(pressure, 0.25)),
                "pressure_lag1_autocorrelation": _safe_corr(pressure[:-1], pressure[1:]),
                "median_abs_pressure_change": float(np.nanmedian(np.abs(np.diff(pressure)))),
                "median_abs_velocity": float(np.nanmedian(np.abs(velocity))),
                "structure_median": float(pd.to_numeric(evaluation["structure"], errors="coerce").median()),
                "geometry_median": float(pd.to_numeric(evaluation["geometry"], errors="coerce").median()),
                "information_median": float(pd.to_numeric(evaluation["information"], errors="coerce").median()),
                "phase_transitions_per_100_bars": 100.0 * transitions / max(1, len(phases) - 1),
                "median_phase_run_bars": float(np.median(lengths)) if lengths else math.nan,
                "median_phase_run_nominal_minutes": float(np.median(lengths) * nominal_minutes[timeframe]) if lengths else math.nan,
                "positive_phase_share": phases.count("positive") / max(1, len(phases)),
                "neutral_phase_share": phases.count("neutral") / max(1, len(phases)),
                "negative_phase_share": phases.count("negative") / max(1, len(phases)),
            }
        )
    return pd.DataFrame(rows), series_by_timeframe


def _adjusted_rand_index(left: Sequence[str], right: Sequence[str]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_levels = {value: index for index, value in enumerate(sorted(set(left)))}
    right_levels = {value: index for index, value in enumerate(sorted(set(right)))}
    contingency = np.zeros((len(left_levels), len(right_levels)), dtype=int)
    for left_value, right_value in zip(left, right):
        contingency[left_levels[left_value], right_levels[right_value]] += 1

    def choose_two(values: np.ndarray) -> float:
        return float(np.sum(values * (values - 1) / 2.0))

    sum_cells = choose_two(contingency)
    sum_rows = choose_two(contingency.sum(axis=1))
    sum_columns = choose_two(contingency.sum(axis=0))
    total_pairs = len(left) * (len(left) - 1) / 2.0
    expected = (sum_rows * sum_columns / total_pairs) if total_pairs else 0.0
    maximum = 0.5 * (sum_rows + sum_columns)
    denominator = maximum - expected
    if abs(denominator) <= 1e-12:
        return 1.0 if list(left) == list(right) else 0.0
    return float((sum_cells - expected) / denominator)


def lexicon_checks(frames: Mapping[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    state_sequence = pd.DataFrame()
    spy_field: dict[str, Any] | None = None
    for symbol in DAILY_SYMBOLS:
        dataset_id = f"{symbol.lower().replace('-', '_')}_1d"
        field = build_field(frames[dataset_id], retrospective=True, history_payload=False)
        lexicon = field["research"]["lexicon"]
        split = lexicon["training_split"]
        sequence = lexicon["evaluation_sequence"]
        available_tail = [row for row in sequence if row["distance_tail_score"] is not None]
        states = [str(row["state_id"]) for row in sequence]
        grammar_counts = np.asarray(lexicon["grammar"]["counts"], dtype=int)
        diagnostics.append(
            {
                "dataset_id": dataset_id,
                "archetype_count": int(split["archetype_count"]),
                "fit_mean_silhouette": float(split["fit_mean_silhouette"]),
                "fit_bars": int(split["fit_bars"]),
                "calibration_bars": int(split["calibration_bars"]),
                "evaluation_bars": int(split["evaluation_bars"]),
                "distance_tail_supported_bars": len(available_tail),
                "distance_tail_unsupported_bars": len(sequence) - len(available_tail),
                "distance_tail_coverage": len(available_tail) / max(1, len(sequence)),
                "lower_calibration_tail_count": sum(
                    bool(row["outside_learned_range"]) for row in available_tail
                ),
                "outside_range_rate_when_scored": (
                    sum(bool(row["outside_learned_range"]) for row in available_tail) / len(available_tail)
                    if available_tail
                    else math.nan
                ),
                "evaluation_state_changes": sum(left != right for left, right in zip(states, states[1:])),
                "evaluation_median_run_bars": float(np.median(_run_lengths(states))) if states else math.nan,
                "fit_transition_count": int(grammar_counts.sum()),
                "reliable_next_state_count": sum(bool(row["reliable"]) for row in lexicon["grammar"]["likely_next"]),
                "current_state": lexicon["current"]["state_id"],
                "current_distance_tail_score": lexicon["current"]["distance_tail_score"],
                "current_distance_tail_support": lexicon["current"]["distance_tail_support"],
            }
        )
        if symbol == "SPY":
            spy_field = field
            state_sequence = pd.DataFrame(sequence)
            close_by_date = pd.DataFrame(
                {
                    "date": [pd.Timestamp(value).isoformat() for value in frames[dataset_id].index],
                    "close": frames[dataset_id]["Close"].to_numpy(dtype=float),
                }
            )
            state_sequence = state_sequence.merge(close_by_date, on="date", how="left")
            state_sequence["token"] = state_sequence["state_id"].map(
                {row["id"]: row["token"] for row in lexicon["archetypes"]}
            )

    if spy_field is None:
        raise RuntimeError("SPY lexicon result is missing")
    full_sequence = pd.DataFrame(spy_field["research"]["lexicon"]["evaluation_sequence"])
    stability_rows: list[dict[str, Any]] = []
    spy_frame = frames["spy_1d"]
    for fraction in (0.70, 0.85):
        cutoff = int(round(len(spy_frame) * fraction))
        prefix = build_field(spy_frame.iloc[:cutoff], retrospective=True, history_payload=False)
        prefix_sequence = pd.DataFrame(prefix["research"]["lexicon"]["evaluation_sequence"])
        overlap = full_sequence[["date", "state_id"]].merge(
            prefix_sequence[["date", "state_id"]],
            on="date",
            suffixes=("_full", "_prefix"),
        )
        stability_rows.append(
            {
                "prefix_fraction": fraction,
                "prefix_bars": cutoff,
                "overlap_bars": len(overlap),
                "full_archetypes": spy_field["research"]["lexicon"]["training_split"]["archetype_count"],
                "prefix_archetypes": prefix["research"]["lexicon"]["training_split"]["archetype_count"],
                "adjusted_rand_index": _adjusted_rand_index(
                    overlap["state_id_full"].astype(str).tolist(),
                    overlap["state_id_prefix"].astype(str).tolist(),
                ),
                "interpretation": "Window-native dictionary stability diagnostic; not a causal-core failure criterion.",
            }
        )
    return pd.DataFrame(diagnostics), pd.DataFrame(stability_rows), state_sequence, spy_field


def shadow_boundary_check(frame: pd.DataFrame, observed_at: datetime) -> dict[str, Any]:
    baseline_call = build_option_field_context(
        frame,
        option_type="call",
        observed_at=observed_at,
        data_source="frozen_yahoo",
        timeframe="1D",
    )
    observed_local = observed_at.astimezone(MARKET_TZ)
    synthetic_index = pd.Timestamp(observed_local.date(), tz=MARKET_TZ).tz_convert("UTC")
    augmented = frame.copy()
    synthetic_row = augmented.iloc[-1].copy()
    synthetic_row[["Open", "High", "Low", "Close"]] = synthetic_row[["Open", "High", "Low", "Close"]] * 1.75
    synthetic_row["Volume"] = float(synthetic_row["Volume"]) * 2.25
    augmented.loc[synthetic_index] = synthetic_row
    call = build_option_field_context(
        augmented,
        option_type="call",
        observed_at=observed_at,
        data_source="frozen_yahoo_plus_synthetic_incomplete_session",
        timeframe="1D",
    )
    put = build_option_field_context(
        augmented,
        option_type="put",
        observed_at=observed_at,
        data_source="frozen_yahoo_plus_synthetic_incomplete_session",
        timeframe="1D",
    )
    stable_keys = ("direction", "strata", "carriers", "price_action", "hypotheses", "classification")
    return {
        "schema_version": call.get("schema_version"),
        "model_version": call.get("model_version"),
        "mode": call.get("mode"),
        "rank_influence": call.get("rank_influence"),
        "automated_execution_enabled": call.get("automated_execution_enabled"),
        "completed_bars_only": call.get("quality", {}).get("completed_bars_only"),
        "completed_bars": call.get("completed_bars"),
        "excluded_incomplete_bars": call.get("excluded_incomplete_bars"),
        "synthetic_incomplete_session_appended": True,
        "incomplete_session_has_zero_field_influence": all(call.get(key) == baseline_call.get(key) for key in stable_keys),
        "as_of_bar": call.get("as_of_bar"),
        "call_path_state": call.get("classification", {}).get("path_state"),
        "put_path_state": put.get("classification", {}).get("path_state"),
        "call_aligned_pressure": call.get("direction", {}).get("option_aligned_pressure"),
        "put_aligned_pressure": put.get("direction", {}).get("option_aligned_pressure"),
        "alignment_sign_flip_holds": (
            call.get("direction", {}).get("option_aligned_pressure") is not None
            and put.get("direction", {}).get("option_aligned_pressure") is not None
            and abs(
                float(call["direction"]["option_aligned_pressure"])
                + float(put["direction"]["option_aligned_pressure"])
            )
            <= 1e-9
        ),
        "retrospective_sections_excluded": True,
        "performance_claim_evaluated": False,
    }


def _style_axes(ax: plt.Axes) -> None:
    ax.set_facecolor("white")
    ax.grid(True, color=PALETTE["grid"], linewidth=0.7, alpha=0.75)
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(PALETTE["muted"])
    ax.tick_params(colors=PALETTE["muted"], labelsize=8)
    ax.title.set_color(PALETTE["ink"])
    ax.xaxis.label.set_color(PALETTE["ink"])
    ax.yaxis.label.set_color(PALETTE["ink"])


def figure_prefix_audit(prefix: pd.DataFrame) -> Path:
    grouped = prefix.groupby("dataset_id", as_index=False)["overall_max_abs_error"].max().sort_values("dataset_id")
    display = np.maximum(grouped["overall_max_abs_error"].to_numpy(dtype=float), 1e-12)
    fig, ax = plt.subplots(figsize=(8.2, 5.6), constrained_layout=True)
    y = np.arange(len(grouped))
    exact = grouped["overall_max_abs_error"].to_numpy(dtype=float) == 0.0
    ax.scatter(display[~exact], y[~exact], color=PALETTE["blue"], marker="D", s=34, label="non-zero deviation")
    ax.scatter(display[exact], y[exact], facecolors="none", edgecolors=PALETTE["blue"], marker="o", s=38, label="exact zero (shown at floor)")
    ax.axvline(PREFIX_TOLERANCE, color=PALETTE["gold"], linestyle="--", linewidth=1.4, label="audit tolerance 1e-4")
    ax.set_xscale("log")
    ax.set_yticks(y, grouped["dataset_id"])
    ax.set_xlabel("Maximum absolute deviation (log scale)")
    ax.set_title("Causal prefix-invariance audit", pad=22)
    ax.text(0.0, 1.005, "Frozen Yahoo OHLCV; all live channels and aggregate research features; three cutoffs per dataset", transform=ax.transAxes, color=PALETTE["muted"], fontsize=8)
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    _style_axes(ax)
    path = FIGURES_DIR / "fig_causal_prefix_audit.png"
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
    return path


def _phase_segments(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    points = np.column_stack([x, y]).reshape(-1, 1, 2)
    return np.concatenate([points[:-1], points[1:]], axis=1)


def figure_timeframe_phase_portraits(series_by_timeframe: Mapping[str, pd.DataFrame]) -> Path:
    fig, axes = plt.subplots(3, 3, figsize=(11.2, 8.8), constrained_layout=False)
    for ax, timeframe in zip(axes.flat, TIMEFRAMES):
        series = series_by_timeframe[timeframe].iloc[-180:]
        pressure = pd.to_numeric(series["pressure"], errors="coerce").to_numpy(dtype=float)
        velocity = pd.to_numeric(series["velocity"], errors="coerce").to_numpy(dtype=float)
        segments = _phase_segments(pressure, velocity)
        collection = LineCollection(
            segments,
            cmap="viridis",
            norm=plt.Normalize(0, max(1, len(segments) - 1)),
            linewidth=1.45,
            alpha=0.88,
        )
        collection.set_array(np.arange(len(segments)))
        ax.add_collection(collection)
        ax.scatter([pressure[0]], [velocity[0]], facecolors="none", edgecolors=PALETTE["ink"], s=30, linewidth=1.1, label="start")
        ax.scatter([pressure[-1]], [velocity[-1]], color=PALETTE["gold"], marker="D", s=30, edgecolors="white", linewidth=0.5, label="latest")
        ax.axhline(0, color=PALETTE["grid"], linewidth=0.8)
        ax.axvline(0, color=PALETTE["grid"], linewidth=0.8)
        x_margin = max(0.02, float(np.ptp(pressure)) * 0.08)
        y_margin = max(0.02, float(np.ptp(velocity)) * 0.08)
        ax.set_xlim(float(np.min(pressure)) - x_margin, float(np.max(pressure)) + x_margin)
        ax.set_ylim(float(np.min(velocity)) - y_margin, float(np.max(velocity)) + y_margin)
        ax.set_title(timeframe, fontsize=10, fontweight="semibold")
        ax.set_xlabel("pressure", fontsize=8)
        ax.set_ylabel("pressure change", fontsize=8)
        _style_axes(ax)
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", bbox_to_anchor=(0.5, 0.006), ncol=2, frameon=False, fontsize=8)
    fig.suptitle("SPY field trajectories across supported timeframes", fontsize=14, color=PALETTE["ink"], y=0.992)
    fig.text(0.5, 0.962, "Last 180 completed bars per panel; newer trajectory segments move from purple toward yellow", ha="center", fontsize=9, color=PALETTE["muted"])
    fig.tight_layout(rect=(0, 0.035, 1, 0.935), h_pad=1.0, w_pad=1.0)
    path = FIGURES_DIR / "fig_timeframe_phase_portraits.png"
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
    return path


def figure_resolution_convergence(resolution: pd.DataFrame) -> Path:
    selected = resolution[resolution["feature"].isin(["pressure", "structure", "geometry", "propagation", "scaling_exponent"])].copy()
    summary = selected.groupby(["feature", "horizon_step"], as_index=False)["iqr_normalized_mae"].median()
    fig, ax = plt.subplots(figsize=(8.4, 5.2), constrained_layout=True)
    styles = {
        "pressure": (PALETTE["blue"], "o", "-"),
        "structure": (PALETTE["blue"], "s", "--"),
        "geometry": (PALETTE["gold"], "D", "-"),
        "propagation": (PALETTE["gold"], "^", "--"),
        "scaling_exponent": (PALETTE["ink"], "x", ":"),
    }
    for feature, group in summary.groupby("feature"):
        color, marker, line = styles[feature]
        ax.plot(group["horizon_step"], group["iqr_normalized_mae"], color=color, marker=marker, linestyle=line, linewidth=1.5, label=feature.replace("_", " "))
    ax.set_xticks(RESOLUTION_STEPS)
    ax.set_xlabel("Log-horizon grid step (bars)")
    ax.set_ylabel("Median MAE / within-series IQR")
    ax.set_title("Horizon-grid resolution convergence", pad=22)
    ax.text(0.0, 1.005, "Step 1 is the reference; medians span 15 symbol-timeframe datasets after a 128-bar warm-up", transform=ax.transAxes, color=PALETTE["muted"], fontsize=8)
    ax.legend(frameon=False, fontsize=8, ncol=2)
    _style_axes(ax)
    path = FIGURES_DIR / "fig_resolution_convergence.png"
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
    return path


def figure_sensitivity_audits(
    history: pd.DataFrame,
    entropy: pd.DataFrame,
    null_state: pd.DataFrame,
) -> Path:
    fig, axes = plt.subplots(1, 3, figsize=(13.4, 4.2), constrained_layout=True)

    history_clean = history.dropna(subset=["iqr_normalized_mae"])
    history_summary = history_clean.groupby("input_window_bars")["iqr_normalized_mae"].agg(
        median="median",
        p90=lambda values: values.quantile(0.90),
    )
    axes[0].plot(history_summary.index, history_summary["median"], marker="o", color=PALETTE["blue"], label="median")
    axes[0].plot(history_summary.index, history_summary["p90"], marker="o", color=PALETTE["orange"], label="90th percentile")
    axes[0].set_xlabel("Trailing input history (bars)")
    axes[0].set_ylabel("IQR-normalized MAE")
    axes[0].set_title("A. History initialization sensitivity", loc="left", fontweight="bold")
    axes[0].legend(frameon=False, fontsize=8)
    _style_axes(axes[0])

    entropy_nonreference = entropy[entropy["window_patterns"] != 24].copy()
    entropy_summary = entropy_nonreference.groupby("window_patterns")["entropy_correlation_vs_window24"].agg(
        median="median",
        lower=lambda values: values.quantile(0.25),
        upper=lambda values: values.quantile(0.75),
    )
    axes[1].plot(entropy_summary.index, entropy_summary["median"], marker="o", color=PALETTE["blue"])
    axes[1].fill_between(
        entropy_summary.index,
        entropy_summary["lower"],
        entropy_summary["upper"],
        color=PALETTE["blue"],
        alpha=0.18,
        label="dataset IQR",
    )
    axes[1].axhline(1.0, color=PALETTE["muted"], linewidth=0.8, linestyle="--")
    axes[1].set_xlabel("Trailing ordinal patterns")
    axes[1].set_ylabel("Correlation with window 24")
    axes[1].set_ylim(0.0, 1.04)
    axes[1].set_title("B. Entropy-window sensitivity", loc="left", fontweight="bold")
    axes[1].legend(frameon=False, fontsize=8)
    _style_axes(axes[1])

    anchor = null_state[null_state["scenario"] == "constant_price_positive_volume"].iloc[0]
    labels = ["Pressure", "Structure", "Display\nconfidence", "Information"]
    values = [anchor["pressure"], anchor["structure"], anchor["display_confidence"], anchor["information"]]
    colors = [PALETTE["blue"], PALETTE["gold"], PALETTE["orange"], PALETTE["olive"]]
    bars = axes[2].bar(labels, values, color=colors, width=0.66)
    axes[2].set_ylim(0.0, 1.0)
    axes[2].set_ylabel("Observed formula value")
    axes[2].set_title("C. Constant-price semantic anchor", loc="left", fontweight="bold")
    for bar, value in zip(bars, values):
        axes[2].text(bar.get_x() + bar.get_width() / 2, value + 0.025, f"{value:.2f}", ha="center", fontsize=8)
    _style_axes(axes[2])

    fig.suptitle(
        "Sensitivity and semantic-anchor audits (descriptive; no performance target)",
        x=0.01,
        ha="left",
        fontsize=13,
        fontweight="bold",
        color=PALETTE["ink"],
    )
    path = FIGURES_DIR / "fig_sensitivity_audits.png"
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
    return path


def figure_state_timeline(state_sequence: pd.DataFrame) -> Path:
    sequence = state_sequence.copy()
    sequence["date"] = pd.to_datetime(sequence["date"], utc=True)
    states = list(dict.fromkeys(sequence["state_id"].astype(str)))
    state_colors = [PALETTE["blue"], PALETTE["gold"], PALETTE["orange"], PALETTE["olive"], PALETTE["pink"]]
    color_map = {state: state_colors[index % len(state_colors)] for index, state in enumerate(states)}
    fig, (price_ax, tail_ax) = plt.subplots(2, 1, figsize=(10.8, 6.2), sharex=True, gridspec_kw={"height_ratios": [2.1, 1]}, constrained_layout=True)

    start = 0
    state_values = sequence["state_id"].astype(str).tolist()
    for index in range(1, len(sequence) + 1):
        if index == len(sequence) or state_values[index] != state_values[start]:
            left = sequence["date"].iloc[start]
            right = sequence["date"].iloc[index - 1] + pd.Timedelta(days=1)
            price_ax.axvspan(left, right, color=color_map[state_values[start]], alpha=0.11, linewidth=0)
            start = index
    price_ax.plot(sequence["date"], sequence["close"], color=PALETTE["ink"], linewidth=1.25)
    price_ax.set_ylabel("SPY close (USD)")
    price_ax.set_title("SPY learned-state assignments in the chronological evaluation segment")
    handles = [plt.Line2D([0], [0], color=color_map[state], linewidth=7, alpha=0.35, label=state) for state in states]
    price_ax.legend(handles=handles, frameon=False, fontsize=8, ncol=min(5, len(states)), loc="upper left")

    tail = pd.to_numeric(sequence["distance_tail_score"], errors="coerce")
    tail_ax.plot(sequence["date"], tail, color=PALETTE["gold"], linewidth=1.1, label="state-conditional calibration-distance upper-tail rank")
    tail_ax.axhline(0.05, color=PALETTE["ink"], linestyle="--", linewidth=1.0, label="lower-rank cutoff (upper distance tail)")
    unscored = tail.isna()
    if unscored.any():
        tail_ax.scatter(sequence.loc[unscored, "date"], np.full(int(unscored.sum()), 0.01), facecolors="none", edgecolors=PALETTE["muted"], s=16, label="insufficient same-state support")
    tail_ax.set_ylim(-0.02, 1.02)
    tail_ax.set_ylabel("upper-tail rank (lower = farther)")
    tail_ax.set_xlabel("evaluation date")
    tail_ax.legend(frameon=False, fontsize=8, ncol=2, loc="upper left")
    tail_ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=9))
    tail_ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(tail_ax.xaxis.get_major_locator()))
    for ax in (price_ax, tail_ax):
        _style_axes(ax)
    path = FIGURES_DIR / "fig_spy_state_timeline.png"
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
    return path


def summarize_results(
    *,
    manifest: Mapping[str, Any],
    profile: pd.DataFrame,
    prefix: pd.DataFrame,
    prefix_full_precision: pd.DataFrame,
    determinism: pd.DataFrame,
    resolution: pd.DataFrame,
    history: pd.DataFrame,
    entropy: pd.DataFrame,
    initialization: pd.DataFrame,
    null_state: pd.DataFrame,
    latency: pd.DataFrame,
    timeframe: pd.DataFrame,
    lexicon: pd.DataFrame,
    stability: pd.DataFrame,
    shadow: Mapping[str, Any],
    runtime_seconds: float,
) -> dict[str, Any]:
    nonreference_resolution = resolution[resolution["horizon_step"] > 1]
    step4 = resolution[resolution["horizon_step"] == 4]
    available_tail = lexicon["distance_tail_coverage"].dropna()
    history_clean = history.dropna(subset=["iqr_normalized_mae"])
    history_summary = (
        history_clean.groupby("input_window_bars")["iqr_normalized_mae"]
        .agg(median="median", p90=lambda values: values.quantile(0.90))
        .reset_index()
    )
    entropy_nonreference = entropy[entropy["window_patterns"] != 24]
    entropy_summary = (
        entropy_nonreference.groupby("window_patterns")["entropy_correlation_vs_window24"]
        .median()
        .reset_index(name="median_correlation_vs_window24")
    )
    warm_latency = latency[latency["measurement_phase"] == "warm"]["elapsed_ms"]
    all_latency = latency["elapsed_ms"]
    resolution_counts = {
        str(int(step)): int(count)
        for step, count in resolution.groupby("horizon_step").size().items()
    }
    anchor = null_state[null_state["scenario"] == "constant_price_positive_volume"].iloc[0]
    return {
        "evaluation_version": "market_field_preliminary_v2",
        "snapshot_observed_at_utc": manifest["observed_at_utc"],
        "dataset_count": int(profile["dataset_id"].nunique()),
        "completed_bar_count": int(profile["rows"].sum()),
        "data_quality": {
            "duplicate_timestamps": int(profile["duplicate_timestamps"].sum()),
            "missing_ohlcv_cells": int(profile["missing_ohlcv_cells"].sum()),
            "invalid_ohlcv_rows": int(profile["invalid_ohlcv_rows"].sum()),
            "all_monotonic": bool(profile["monotonic_time"].all()),
            "incomplete_rows_excluded": int(profile["excluded_incomplete_rows"].sum()),
        },
        "prefix_invariance": {
            "checks": len(prefix),
            "passes": int(prefix["passes_1e_4"].sum()),
            "max_abs_error": float(prefix["overall_max_abs_error"].max()),
            "tolerance": PREFIX_TOLERANCE,
        },
        "prefix_invariance_full_precision": {
            "checks": len(prefix_full_precision),
            "passes": int(prefix_full_precision["passes_tolerance"].sum()),
            "numeric_value_comparisons": int(prefix_full_precision["numeric_value_comparisons"].sum()),
            "max_abs_error": float(prefix_full_precision["overall_max_abs_error"].max()),
            "tolerance": FULL_PRECISION_TOLERANCE,
            "scope": "Live field matrices plus aggregate derivatives, strata, carriers, and carrier ratios; response-only rounding bypassed.",
        },
        "determinism": {
            "checks": len(determinism),
            "passes": int(determinism["deterministic"].sum()),
            "max_unique_hashes": int(determinism["unique_hashes"].max()),
        },
        "resolution": {
            "comparisons": len(nonreference_resolution),
            "comparisons_by_step": resolution_counts,
            "reference_comparisons": int(resolution_counts.get("1", 0)),
            "nonreference_comparisons": int(sum(value for key, value in resolution_counts.items() if key != "1")),
            "step4_median_iqr_normalized_mae": float(step4["iqr_normalized_mae"].median()),
            "step4_p95_iqr_normalized_mae": float(step4["iqr_normalized_mae"].quantile(0.95)),
            "step4_median_correlation": float(step4["correlation"].median()),
            "step4_worst_feature_dataset": step4.sort_values("iqr_normalized_mae", ascending=False).iloc[0][["dataset_id", "feature", "iqr_normalized_mae", "correlation"]].to_dict(),
        },
        "history_truncation": {
            "comparison_tail_bars": 32,
            "window_summary": history_summary.to_dict(orient="records"),
            "option_minimum_window_bars": OPTION_FIELD_MIN_BARS,
            "option_minimum_median_iqr_normalized_mae": float(
                history_clean.loc[
                    history_clean["input_window_bars"] == OPTION_FIELD_MIN_BARS,
                    "iqr_normalized_mae",
                ].median()
            ),
            "option_minimum_p90_iqr_normalized_mae": float(
                history_clean.loc[
                    history_clean["input_window_bars"] == OPTION_FIELD_MIN_BARS,
                    "iqr_normalized_mae",
                ].quantile(0.90)
            ),
        },
        "entropy_window_sensitivity": {
            "order": 3,
            "possible_ordinal_patterns": math.factorial(3),
            "production_window_patterns": 24,
            "median_correlations_vs_window24": entropy_summary.to_dict(orient="records"),
            "minimum_dataset_correlation_vs_window24": float(
                entropy_nonreference["entropy_correlation_vs_window24"].min()
            ),
        },
        "initialization_contracts": initialization.to_dict(orient="records"),
        "null_state_anchor": {
            "pressure": float(anchor["pressure"]),
            "structure": float(anchor["structure"]),
            "display_confidence": float(anchor["display_confidence"]),
            "information": float(anchor["information"]),
            "interpretation": str(anchor["semantic_interpretation"]),
        },
        "timeframe_behavior": {
            "timeframes": int(timeframe["timeframe"].nunique()),
            "finite_feature_share_min": float(timeframe["finite_feature_share"].min()),
            "phase_turnover_min_per_100": float(timeframe["phase_transitions_per_100_bars"].min()),
            "phase_turnover_max_per_100": float(timeframe["phase_transitions_per_100_bars"].max()),
            "pressure_lag1_autocorrelation_min": float(timeframe["pressure_lag1_autocorrelation"].min()),
            "pressure_lag1_autocorrelation_max": float(timeframe["pressure_lag1_autocorrelation"].max()),
            "median_abs_velocity_min": float(timeframe["median_abs_velocity"].min()),
            "median_abs_velocity_max": float(timeframe["median_abs_velocity"].max()),
            "structure_median_min": float(timeframe["structure_median"].min()),
            "structure_median_max": float(timeframe["structure_median"].max()),
            "geometry_median_min": float(timeframe["geometry_median"].min()),
            "geometry_median_max": float(timeframe["geometry_median"].max()),
        },
        "lexicon": {
            "daily_datasets": len(lexicon),
            "archetype_count_min": int(lexicon["archetype_count"].min()),
            "archetype_count_max": int(lexicon["archetype_count"].max()),
            "tail_score_coverage_median": float(available_tail.median()) if len(available_tail) else None,
            "outside_range_rate_min_when_scored": float(lexicon["outside_range_rate_when_scored"].min()),
            "outside_range_rate_max_when_scored": float(lexicon["outside_range_rate_when_scored"].max()),
            "distance_tail_supported_bars": int(lexicon["distance_tail_supported_bars"].sum()),
            "distance_tail_unsupported_bars": int(lexicon["distance_tail_unsupported_bars"].sum()),
            "lower_calibration_tail_count": int(lexicon["lower_calibration_tail_count"].sum()),
            "reliable_next_state_count_total": int(lexicon["reliable_next_state_count"].sum()),
            "window_stability_ari": stability[["prefix_fraction", "adjusted_rand_index"]].to_dict(orient="records"),
        },
        "option_snapshot_latency": {
            "runs": len(latency),
            "symbols": int(latency["symbol"].nunique()),
            "warm_runs": len(warm_latency),
            "warm_p50_ms": float(warm_latency.quantile(0.50)),
            "warm_p95_ms": float(warm_latency.quantile(0.95)),
            "warm_p99_ms": float(warm_latency.quantile(0.99)),
            "all_max_ms": float(all_latency.max()),
            "first_measured_max_ms": float(
                latency.loc[latency["measurement_phase"] == "first_measured", "elapsed_ms"].max()
            ),
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "processor": platform.processor() or "not_reported",
                "process_model": "single process, sequential, imports already loaded",
            },
            "exclusions": [
                "data retrieval",
                "persistence",
                "concurrent load",
                "fresh-process import time",
                "network and production queueing",
            ],
        },
        "shadow_boundary": dict(shadow),
        "runtime_seconds": runtime_seconds,
        "claim_boundary": "Engineering and descriptive empirical evidence only; no trading performance, forecast skill, or statistical discovery claim was evaluated.",
    }


def run_analysis(*, fetch: bool = False, force_fetch: bool = False) -> dict[str, Any]:
    started_at_utc = datetime.now(timezone.utc)
    started = time.perf_counter()
    ensure_directories()
    repository_at_start = repository_run_context()
    source_hashes_at_start = receipt_source_hashes()
    manifest = fetch_public_snapshot(force=force_fetch) if fetch or not MANIFEST_PATH.exists() else json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    frames = load_snapshot(manifest)

    profile = profile_snapshot(manifest, frames)
    observed_at = datetime.fromisoformat(str(manifest["observed_at_utc"]).replace("Z", "+00:00"))
    latency = option_snapshot_latency_checks(frames, observed_at)
    prefix = prefix_invariance_checks(frames)
    prefix_full_precision = prefix_invariance_full_precision_checks(frames)
    determinism = determinism_checks(frames)
    resolution = resolution_checks(frames)
    history = history_truncation_checks(frames)
    entropy = entropy_window_checks(frames)
    initialization = initialization_contract_checks()
    null_state = null_state_anchor_checks()
    timeframe, series_by_timeframe = timeframe_checks(frames)
    lexicon, stability, state_sequence, _spy_field = lexicon_checks(frames)
    shadow = shadow_boundary_check(frames["spy_1d"], observed_at)
    resolution_counts = (
        resolution.groupby(["reference_step", "horizon_step"], as_index=False)
        .agg(
            comparisons=("feature", "size"),
            datasets=("dataset_id", "nunique"),
            features=("feature", "nunique"),
        )
        .sort_values("horizon_step")
    )

    tables = {
        "dataset_profile.csv": profile,
        "prefix_invariance.csv": prefix,
        "prefix_invariance_full_precision.csv": prefix_full_precision,
        "determinism.csv": determinism,
        "resolution_convergence.csv": resolution,
        "resolution_comparison_counts.csv": resolution_counts,
        "history_truncation_sensitivity.csv": history,
        "entropy_window_sensitivity.csv": entropy,
        "initialization_contracts.csv": initialization,
        "null_state_anchor.csv": null_state,
        "option_snapshot_latency.csv": latency,
        "timeframe_behavior.csv": timeframe,
        "lexicon_diagnostics.csv": lexicon,
        "lexicon_window_stability.csv": stability,
        "spy_1d_state_sequence.csv": state_sequence,
    }
    for filename, table in tables.items():
        table.to_csv(RESULTS_DIR / filename, index=False)

    figures = [
        figure_prefix_audit(prefix),
        figure_timeframe_phase_portraits(series_by_timeframe),
        figure_resolution_convergence(resolution),
        figure_sensitivity_audits(history, entropy, null_state),
        figure_state_timeline(state_sequence),
    ]
    runtime_seconds = time.perf_counter() - started
    summary = summarize_results(
        manifest=manifest,
        profile=profile,
        prefix=prefix,
        prefix_full_precision=prefix_full_precision,
        determinism=determinism,
        resolution=resolution,
        history=history,
        entropy=entropy,
        initialization=initialization,
        null_state=null_state,
        latency=latency,
        timeframe=timeframe,
        lexicon=lexicon,
        stability=stability,
        shadow=shadow,
        runtime_seconds=runtime_seconds,
    )
    summary["artifacts"] = {
        "tables": [str((RESULTS_DIR / filename).relative_to(HERE)).replace("\\", "/") for filename in tables],
        "figures": [str(path.relative_to(HERE)).replace("\\", "/") for path in figures],
        "run_receipt": str(RUN_RECEIPT_PATH.relative_to(HERE)).replace("\\", "/"),
    }
    write_json(RESULTS_DIR / "summary.json", summary)
    write_json(RESULTS_DIR / "shadow_boundary.json", shadow)
    receipt = build_run_receipt(
        started_at_utc=started_at_utc,
        repository_at_start=repository_at_start,
        source_hashes_at_start=source_hashes_at_start,
        manifest=manifest,
        tables=tables,
        figures=figures,
    )
    write_json(RUN_RECEIPT_PATH, receipt)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproducible preliminary Market Field diagnostics")
    parser.add_argument("--fetch", action="store_true", help="Fetch and freeze public Yahoo data when no snapshot exists")
    parser.add_argument("--force-fetch", action="store_true", help="Replace the existing frozen public-data snapshot")
    args = parser.parse_args()
    summary = run_analysis(fetch=args.fetch or args.force_fetch, force_fetch=args.force_fetch)
    print(json.dumps(summary, indent=2, sort_keys=True, default=json_default))


if __name__ == "__main__":
    main()
