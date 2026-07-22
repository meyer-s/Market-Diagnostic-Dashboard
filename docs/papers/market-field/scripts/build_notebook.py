"""Build and optionally execute the Market Field reproducibility notebook."""

from __future__ import annotations

import argparse
from pathlib import Path

import nbformat
from nbclient import NotebookClient


PAPER_ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = PAPER_ROOT / "market_field_reproducibility.ipynb"


def markdown(text: str) -> nbformat.NotebookNode:
    return nbformat.v4.new_markdown_cell(text.strip())


def code(source: str) -> nbformat.NotebookNode:
    return nbformat.v4.new_code_cell(source.strip())


def build_notebook() -> nbformat.NotebookNode:
    notebook = nbformat.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python", "version": "3"},
    }
    notebook["cells"] = [
        markdown(
            """
# Market Field reproducibility companion

## TL;DR

This notebook rebuilds and inspects the evidence reported in the ICLR-formatted
working paper. The tests cover causal-prefix invariance, deterministic state
learning, controlled representation behavior, descriptive calibration
diagnostics, and local snapshot cost. They do not test return predictability,
option profitability, or a physical theory of markets.
"""
        ),
        markdown(
            """
## Context and methods

The notebook calls the repository's production Market Field functions through
the paper asset script. The default rerun is offline and requires the frozen
cache produced by a prior refresh. Provider retrieval, canonical row hashes,
sample dates, and adjustment mode are recorded in validation_summary.json.

The daily study covers SPY, QQQ, IWM, TLT, GLD, USO, VNQ, and BTC-USD from
2018-01-01 through the paper as-of date 2026-07-21. Chronological
fit/calibration/evaluation segmentation is performed by production code.
"""
        ),
        code(
            """
from pathlib import Path
import json
import subprocess
import sys

import pandas as pd
from IPython.display import Image, display

PAPER_ROOT = Path.cwd().resolve()
assert (PAPER_ROOT / "scripts" / "generate_assets.py").exists(), (
    "Run this notebook with docs/papers/market-field as the working directory."
)
print("Paper package:", PAPER_ROOT.name)
print("Python:", sys.version.split()[0])
"""
        ),
        markdown("## Data and artifact rebuild"),
        code(
            """
completed = subprocess.run(
    [sys.executable, str(PAPER_ROOT / "scripts" / "generate_assets.py"), "--offline"],
    cwd=PAPER_ROOT,
    check=True,
    capture_output=True,
    text=True,
)
print(completed.stdout)
"""
        ),
        code(
            """
summary = json.loads(
    (PAPER_ROOT / "results" / "validation_summary.json").read_text(encoding="utf-8")
)
assets = pd.read_csv(PAPER_ROOT / "results" / "asset_summary.csv")
manifest = pd.DataFrame(summary["market_data"])
manifest[
    ["symbol", "rows", "first_observation", "last_observation",
     "adjustment", "canonical_ohlcv_sha256"]
]
"""
        ),
        markdown(
            """
## Results

The following assertions are executable claim guards. They intentionally stop
short of any predictive or economic-performance assertion.
"""
        ),
        code(
            """
validation = summary["validation"]
synthetic = summary["synthetic"]
benchmark = summary["option_snapshot_benchmark"]

assert validation["prefix_invariance"]["nonzero_differences"] == 0
assert validation["prefix_invariance"]["serialized_value_comparisons"] == 6688
assert validation["determinism"]["exact_lexicon_matches"] == 8
assert synthetic["horizon_delay_spearman_rho"] == 1.0
assert benchmark["rank_influence"] == 0.0
assert benchmark["automated_execution_enabled"] is False

pd.DataFrame(
    [
        {
            "diagnostic": "Prefix invariance",
            "result": (
                f'{validation["prefix_invariance"]["serialized_value_comparisons"]:,} '
                "comparisons; zero mismatches"
            ),
        },
        {
            "diagnostic": "Dictionary determinism",
            "result": (
                f'{validation["determinism"]["exact_lexicon_matches"]}/'
                f'{validation["determinism"]["symbols"]} exact reruns'
            ),
        },
        {
            "diagnostic": "Synthetic horizon delay",
            "result": f'Spearman rho = {synthetic["horizon_delay_spearman_rho"]:.3f}',
        },
        {
            "diagnostic": "Supported distance tails",
            "result": (
                f'{100 * validation["distance_tail"]["pooled_outside_range_rate"]:.2f}% '
                "outside descriptive range"
            ),
        },
        {
            "diagnostic": "Compact snapshot",
            "result": (
                f'{benchmark["median_ms"]:.1f} ms median; '
                f'{benchmark["median_payload_bytes"]:,} bytes'
            ),
        },
    ]
)
"""
        ),
        code(
            """
asset_display = assets[
    [
        "symbol", "bars", "forms", "fit_silhouette",
        "tail_supported_bars", "outside_range_rate",
        "transitions_per_100_bars",
    ]
].copy()
asset_display["fit_silhouette"] = asset_display["fit_silhouette"].map("{:.3f}".format)
asset_display["outside_range_rate"] = asset_display["outside_range_rate"].map("{:.2%}".format)
asset_display["transitions_per_100_bars"] = asset_display[
    "transitions_per_100_bars"
].map("{:.2f}".format)
asset_display
"""
        ),
        code(
            """
for filename in [
    "system_overview.png",
    "synthetic_diagnostics.png",
    "spy_field_phase.png",
    "calibration_rates.png",
]:
    display(Image(filename=str(PAPER_ROOT / "figures" / filename), width=1050))
"""
        ),
        markdown(
            """
## Takeaways

1. Tested serialized channels are prefix-invariant for the selected assets and
   cut points.
2. Fixed inputs produce deterministic request-local dictionaries.
3. Controlled paths generate the intended directional and scale response.
4. Six of eight daily assets fall back to one Form, demonstrating restraint
   and also limiting the current dictionary's descriptive contribution.
5. Distance-tail rates are heterogeneous and must not be read as calibrated
   probabilities.
6. The option snapshot is operationally compact in a local compute-only test,
   while ranking and execution remain disabled.

Future evidence must be rolling-origin, purged, cost-aware, and prospectively
registered before any statement about option outcomes or trading value.
"""
        ),
    ]
    return notebook


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute all cells from top to bottom before saving.",
    )
    args = parser.parse_args()

    notebook = build_notebook()
    if args.execute:
        client = NotebookClient(
            notebook,
            timeout=900,
            kernel_name="python3",
            resources={"metadata": {"path": str(PAPER_ROOT)}},
        )
        client.execute(cwd=str(PAPER_ROOT))

    nbformat.write(notebook, NOTEBOOK_PATH)
    print(f"Wrote {NOTEBOOK_PATH}")


if __name__ == "__main__":
    main()
