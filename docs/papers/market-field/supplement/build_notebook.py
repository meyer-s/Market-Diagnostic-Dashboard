from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import nbformat as nbf
from nbclient import NotebookClient


HERE = Path(__file__).resolve().parent


def find_repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "backend").is_dir() and (candidate / "frontend").is_dir():
            return candidate
    raise RuntimeError(f"Could not locate repository root from {start}")


REPO_ROOT = find_repo_root(HERE)
NOTEBOOK_PATH = HERE / "market_field_preliminary.ipynb"


def markdown(text: str):
    return nbf.v4.new_markdown_cell(text.strip())


def code(text: str):
    return nbf.v4.new_code_cell(text.strip())


def build_notebook():
    summary = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
    resolution = summary["resolution"]
    lexicon = summary["lexicon"]
    notebook = nbf.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {"display_name": "Python 3 (ipykernel)", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": sys.version.split()[0]},
    }
    notebook["cells"] = [
        markdown(
            f"""
# Market Field Calculus v1: preliminary reproducible evaluation

## tl;dr

This notebook reruns the engineering and descriptive-empirical audit from a frozen public-data snapshot. The tested field passed **{summary['prefix_invariance']['passes']}/{summary['prefix_invariance']['checks']}** causal prefix checks and **{summary['determinism']['passes']}/{summary['determinism']['checks']}** fixed-input determinism checks. Horizon-grid step 4 nevertheless produced median IQR-normalized MAE **{resolution['step4_median_iqr_normalized_mae']:.3f}** and p95 **{resolution['step4_p95_iqr_normalized_mae']:.3f}**, so grid density is a model parameter. Daily retrospective dictionaries selected only **{lexicon['archetype_count_min']}–{lexicon['archetype_count_max']}** states and supplied just **{lexicon['reliable_next_state_count_total']}** reliable next-state entries across seven assets. These are implementation and calibration diagnostics—not evidence of forecast skill or trading performance.
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

HERE = Path.cwd()
run = subprocess.run(
    [sys.executable, "evaluate_market_field.py"],
    cwd=HERE,
    check=True,
    capture_output=True,
    text=True,
)
summary = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
print(f"Executed with Python {sys.version.split()[0]}")
print(f"Recomputed {summary['dataset_count']} datasets / {summary['completed_bar_count']:,} completed bars in {summary['runtime_seconds']:.1f}s")
"""
        ),
        markdown(
            """
## Context & Methods

The audit asks whether the current implementation is causally computable, repeatable, numerically stable to horizon-grid resolution, well-defined across all supported timeframes, and honest about the retrospective state layer. It also tests the options wrapper's completed-bar and shadow-only boundaries.

The causal check compares full-history outputs with outputs recomputed from 60%, 80%, and 95% prefixes for all live channels, derivatives, strata, carriers, and carrier ratios. A separate stress test mutates the full future suffix after a SPY-daily cutoff. The resolution check treats horizons 8–64 at step 1 as a numerical reference and compares steps 2, 4, and 8 after a 128-bar warm-up. Lexicons use chronological fit, calibration, and evaluation partitions.

### Key Assumptions

- The frozen Yahoo snapshot is adequate for engineering diagnostics but is not exchange-grade data.
- A bar is eligible only under the completion rules recorded in the manifest.
- Exact-zero audit results mean equality at serialized implementation precision, not a theorem over all possible input series.
- Highly autocorrelated bars and overlapping outcomes are not independent samples.
- The learned lexicon is retrospective and excluded from the options field overlay.
- No P&L, forecast target, transaction cost, or statistical discovery hypothesis is evaluated here.
"""
        ),
        markdown("## Data"),
        code(
            """
manifest = json.loads((HERE / "data" / "raw" / "manifest.json").read_text(encoding="utf-8"))
profile = pd.read_csv(HERE / "results" / "dataset_profile.csv")
quality = pd.DataFrame([summary["data_quality"]])
display(quality)
display(profile[["dataset_id", "symbol", "timeframe", "rows", "coverage_start", "coverage_end"]])
print("Snapshot:", manifest["observed_at_utc"])
print("Provider:", manifest["provider"], "/", manifest["provider_package"])
"""
        ),
        markdown("## Results"),
        code(
            """
audit = pd.DataFrame([
    {"diagnostic": "prefix invariance", **summary["prefix_invariance"]},
    {"diagnostic": "determinism", **summary["determinism"]},
])
display(audit)
display(Image(filename=str(HERE / "figures" / "fig_causal_prefix_audit.png")))
"""
        ),
        code(
            """
resolution = pd.read_csv(HERE / "results" / "resolution_convergence.csv")
step4 = resolution[resolution["horizon_step"] == 4].sort_values("iqr_normalized_mae", ascending=False)
display(step4[["dataset_id", "feature", "iqr_normalized_mae", "correlation", "final_abs_error"]].head(12))
display(Image(filename=str(HERE / "figures" / "fig_resolution_convergence.png")))
"""
        ),
        code(
            """
timeframes = pd.read_csv(HERE / "results" / "timeframe_behavior.csv")
display(timeframes)
display(Image(filename=str(HERE / "figures" / "fig_timeframe_phase_portraits.png")))
"""
        ),
        code(
            """
lexicon = pd.read_csv(HERE / "results" / "lexicon_diagnostics.csv")
stability = pd.read_csv(HERE / "results" / "lexicon_window_stability.csv")
display(lexicon)
display(stability)
display(Image(filename=str(HERE / "figures" / "fig_spy_state_timeline.png")))
"""
        ),
        code(
            """
shadow = json.loads((HERE / "results" / "shadow_boundary.json").read_text(encoding="utf-8"))
live = json.loads((HERE / "results" / "live_endpoint_probe.json").read_text(encoding="utf-8"))
display(pd.DataFrame([shadow]))
display(pd.DataFrame([live["summary"]]))
"""
        ),
        markdown(
            """
## Takeaways

1. **Tested causal behavior and determinism are strong.** Fixed frozen inputs yielded exact prefix agreement and exact repeated hashes in every audit performed.
2. **The representation is not grid-invariant.** Pressure is comparatively stable, but geometry, propagation, scaling, and cascade-related measurements move enough that horizon resolution must be frozen and reported.
3. **Cross-timeframe rendering is feasible, but adjacent bars are not independent evidence.** Every evaluated feature was finite, while pressure lag-one autocorrelation exceeded 0.995 on every SPY timeframe.
4. **The dictionary is currently descriptive.** It is sparse, window-native, sometimes poorly covered, and its nominal 0.05 distance cutoff is not uniformly calibrated forward in time.
5. **Options use must remain shadow-only.** The wrapper passed its completed-bar, sign-alignment, no-retrospective-state, no-ranking-influence, and no-automation checks. No option performance was tested.
6. **Live and paper modes differ.** The deployed endpoint worked on all timeframes but exposed possibly forming latest bars; reproducible experiments should continue to use frozen completed bars and explicit `as_of` timestamps.

See `PRELIMINARY_EVALUATION.md` for exact claim boundaries and the proposed walk-forward performance protocol.
"""
        ),
    ]
    return notebook


def main() -> None:
    notebook = build_notebook()
    scripts_dir = REPO_ROOT / ".venv" / "Scripts"
    os.environ["PATH"] = str(scripts_dir) + os.pathsep + os.environ.get("PATH", "")
    client = NotebookClient(
        notebook,
        timeout=300,
        kernel_name="python3",
        resources={"metadata": {"path": str(HERE)}},
    )
    client.execute()
    nbf.write(notebook, NOTEBOOK_PATH)
    print(f"Wrote executed notebook: {NOTEBOOK_PATH}")


if __name__ == "__main__":
    main()
