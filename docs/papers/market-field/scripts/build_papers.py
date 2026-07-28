"""Compile the Market Field papers and emit a source-bound PDF receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from pypdf import PdfReader


PAPER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
BUILD_TARGETS = (
    "main.tex",
    "share.tex",
    "relative-field-addendum.tex",
    "relative-field-addendum-share.tex",
)
ALIASES = {
    "share.pdf": "market-field-calculus-working-paper.pdf",
    "relative-field-addendum-share.pdf": "relative-field-pair-technical-addendum.pdf",
}
SOURCE_PATHS = (
    "main.tex",
    "share.tex",
    "relative-field-addendum.tex",
    "relative-field-addendum-share.tex",
    "references.bib",
    "relative-field-addendum-references.bib",
    "iclr2026_conference.sty",
    "iclr2026_conference.bst",
    "natbib.sty",
    "fancyhdr.sty",
    "requirements-paper.txt",
    "scripts/build_papers.py",
    "scripts/generate_research_contract.py",
    "figures/research_contract.pdf",
    "figures/spy_field_phase.pdf",
    "figures/synthetic_diagnostics.pdf",
    "figures/representation_sensitivity.pdf",
    "figures/calibration_rates.pdf",
    "tables/asset_summary.tex",
    "tables/validation_summary.tex",
)
OUTPUT_PATHS = (
    "main.pdf",
    "share.pdf",
    "market-field-calculus-working-paper.pdf",
    "relative-field-addendum.pdf",
    "relative-field-addendum-share.pdf",
    "relative-field-pair-technical-addendum.pdf",
)


def _run(
    command: list[str],
    *,
    cwd: Path,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_value(*args: str) -> str:
    return _run(["git", *args], cwd=REPO_ROOT, capture=True).stdout.strip()


def _resolve_tectonic(explicit: str | None) -> str:
    candidate = explicit or os.environ.get("TECTONIC_BIN") or shutil.which("tectonic")
    if not candidate:
        raise RuntimeError(
            "Tectonic was not found. Pass --tectonic, set TECTONIC_BIN, or add tectonic to PATH."
        )
    resolved = Path(candidate).expanduser().resolve()
    if not resolved.is_file():
        raise RuntimeError(f"Tectonic executable does not exist: {resolved}")
    return str(resolved)


def _file_record(relative_path: str) -> dict[str, Any]:
    path = PAPER_ROOT / relative_path
    return {
        "path": relative_path,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tectonic", help="Path to a Tectonic executable.")
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Build from a dirty repository and record that state instead of failing.",
    )
    args = parser.parse_args()

    tectonic = _resolve_tectonic(args.tectonic)
    version = _run([tectonic, "--version"], cwd=PAPER_ROOT, capture=True).stdout.strip()
    source_head = _git_value("rev-parse", "HEAD")
    dirty_paths = [
        line
        for line in _git_value("status", "--porcelain", "--untracked-files=all").splitlines()
        if line
    ]
    if dirty_paths and not args.allow_dirty:
        raise RuntimeError(
            "Refusing to create a clean-source receipt from a dirty repository. "
            "Commit/stash changes or pass --allow-dirty."
        )

    _run(
        [sys.executable, str(PAPER_ROOT / "scripts" / "generate_research_contract.py")],
        cwd=PAPER_ROOT,
    )
    for target in BUILD_TARGETS:
        _run([tectonic, "-X", "compile", target], cwd=PAPER_ROOT)

    for source_name, alias_name in ALIASES.items():
        shutil.copy2(PAPER_ROOT / source_name, PAPER_ROOT / alias_name)

    source_records = [_file_record(path) for path in SOURCE_PATHS]
    outputs: list[dict[str, Any]] = []
    for relative_path in OUTPUT_PATHS:
        record = _file_record(relative_path)
        record["pages"] = len(PdfReader(PAPER_ROOT / relative_path).pages)
        outputs.append(record)

    alias_checks = [
        {
            "source": source_name,
            "alias": alias_name,
            "byte_identical": _sha256(PAPER_ROOT / source_name)
            == _sha256(PAPER_ROOT / alias_name),
        }
        for source_name, alias_name in ALIASES.items()
    ]
    if not all(check["byte_identical"] for check in alias_checks):
        raise RuntimeError("A descriptive PDF alias does not match its named source build.")

    receipt = {
        "schema_version": "market_field_pdf_build_receipt_v1",
        "status": "ok",
        "source_head": source_head,
        "source_tree_clean_before_build": not dirty_paths,
        "dirty_paths_before_build": dirty_paths,
        "tectonic_version": version,
        "sources": source_records,
        "outputs": outputs,
        "alias_checks": alias_checks,
    }
    receipt_path = PAPER_ROOT / "results" / "pdf_build_receipt.json"
    receipt_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "source_head": source_head,
                "outputs": len(outputs),
                "receipt": receipt_path.relative_to(REPO_ROOT).as_posix(),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
