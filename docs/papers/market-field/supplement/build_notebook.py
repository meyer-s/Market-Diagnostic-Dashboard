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
# Market Field Calculus v1: preliminary validation v2

## tl;dr

This notebook reruns an engineering and descriptive-empirical audit from a locally retained, hash-identified data snapshot. The tested field passed **{summary['prefix_invariance_full_precision']['passes']}/{summary['prefix_invariance_full_precision']['checks']}** unrounded prefix checks across **{summary['prefix_invariance_full_precision']['numeric_value_comparisons']:,}** numeric comparisons with maximum error **{summary['prefix_invariance_full_precision']['max_abs_error']:.1f}**. That strong non-anticipative-computation result coexists with material initialization sensitivity: the current **{summary['history_truncation']['option_minimum_window_bars']}-bar** option availability threshold produced median IQR-normalized error **{summary['history_truncation']['option_minimum_median_iqr_normalized_mae']:.3f}** against full-history endpoints. A constant-price path still anchors Structure at **{summary['null_state_anchor']['structure']:.2f}** and display confidence at **{summary['null_state_anchor']['display_confidence']:.2f}**. These are implementation, initialization-coverage, and semantic diagnostics—not evidence of forecast skill or trading performance.
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

The audit asks whether the current implementation is nonanticipative at tested prefixes, repeatable, sensitive to limited retained history, sensitive to horizon-grid and permutation-entropy choices, well-defined across supported timeframes, and semantically honest at a constant-price anchor. It also measures same-state calibration support, the options wrapper's completed-bar and zero-algorithmic-authority boundaries, and the sequential compute-only latency distribution.

The prefix check compares full-history outputs with outputs recomputed from 60%, 80%, and 95% prefixes for all live channels, derivatives, strata, carriers, and carrier ratios. A separate stress test mutates the full future suffix after a SPY-daily cutoff. It runs at both API precision and with only response rounding bypassed. The history audit recomputes the last 32 values from trailing windows of 60–365 bars. The resolution check treats horizons 8–64 at step 1 as a numerical reference, while the entropy audit compares trailing-pattern windows against the production setting of 24. Lexicons use chronological fit, calibration, and evaluation partitions.

### Key Assumptions

- The locally retained Yahoo snapshot is adequate for engineering diagnostics but is not exchange-grade data. Raw CSVs are not redistributed, so a fresh clone cannot reproduce the historical hashes offline.
- A bar is eligible only under the completion rules recorded in the manifest.
- Exact-zero audit results include unrounded float outputs from the production transform, but still describe finite tested prefixes rather than a theorem over all possible input series.
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
    {"diagnostic": "unrounded prefix invariance", **summary["prefix_invariance_full_precision"]},
    {"diagnostic": "determinism", **summary["determinism"]},
])
display(audit)
display(Image(filename=str(HERE / "figures" / "fig_causal_prefix_audit.png")))
"""
        ),
        code(
            """
history = pd.read_csv(HERE / "results" / "history_truncation_sensitivity.csv")
entropy = pd.read_csv(HERE / "results" / "entropy_window_sensitivity.csv")
initialization = pd.read_csv(HERE / "results" / "initialization_contracts.csv")
null_state = pd.read_csv(HERE / "results" / "null_state_anchor.csv")
display(pd.DataFrame(summary["history_truncation"]["window_summary"]))
display(initialization)
display(null_state)
display(
    entropy[entropy["window_patterns"] != 24]
    .groupby("window_patterns", as_index=False)["entropy_correlation_vs_window24"]
    .median()
)
display(Image(filename=str(HERE / "figures" / "fig_sensitivity_audits.png")))
"""
        ),
        code(
            """
resolution = pd.read_csv(HERE / "results" / "resolution_convergence.csv")
resolution_counts = pd.read_csv(HERE / "results" / "resolution_comparison_counts.csv")
step4 = resolution[resolution["horizon_step"] == 4].sort_values("iqr_normalized_mae", ascending=False)
display(resolution_counts)
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
latency = pd.read_csv(HERE / "results" / "option_snapshot_latency.csv")
display(pd.DataFrame([shadow]))
display(pd.DataFrame([summary["option_snapshot_latency"]]))
display(pd.DataFrame([live["summary"]]))
"""
        ),
        markdown(
            """
## Takeaways

1. **Tested nonanticipativity and determinism are strong.** Fixed local inputs yielded exact prefix agreement before response rounding and exact repeated hashes in every audit performed.
2. **Computable is not converged.** The audited 60-bar option baseline was much more initialization-sensitive than 128–365-bar histories. Semantic revision 1.2 requires 96 completed bars and discloses minimum-input and initialization-target coverage, but that threshold is not a convergence guarantee. The serialized `maturity` object remains only a legacy alias.
3. **Grid density and entropy window are model parameters.** Neither has been shown optimal, and both materially alter descriptive measurements.
4. **Flat-state formula floors need semantic care.** Structure 0.42 and display confidence 0.68 on constant prices are coherence-derived anchors, not evidence of direction or conviction.
5. **Cross-timeframe rendering is feasible, but adjacent bars are not independent evidence.** Every evaluated feature was finite, while pressure lag-one autocorrelation exceeded 0.995 on every SPY timeframe.
6. **The dictionary is currently descriptive.** It is sparse, window-native, has 277 unsupported evaluation bars in this snapshot, and its 0.05 distance-tail rank is not uniformly calibrated forward in time.
7. **Options context has zero algorithmic authority, not zero human influence.** The wrapper passed completed-bar, sign-alignment, no-retrospective-state, no-ranking-influence, and no-automation checks. No option performance was tested.
8. **Latency evidence is deliberately narrow.** The measured distribution is sequential and compute-only; live, cold-start, concurrent, and production-tail performance remain unevaluated.

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
