# Market Field working paper

This directory is an ICLR 2026-formatted source and derived-artifact package
for:

> Non-Anticipative Market Field Calculus: An Auditable Multiscale Representation for
> Option-Path Decision Support

Status: preliminary systems and methods paper, revised 2026-07-23. The evidence
supports reconstructibility and selected implementation properties, not a
representation-learning advance. A matched five-coordinate, single-horizon
baseline produces stronger fit separation under the same codebook gate; the
paper reports that negative result directly. It does not claim forecast skill,
profitable trading, arbitrage, natural latent states, or a physical market law.
Raw provider snapshots are not redistributed, so the package is not a
self-contained copy of the exact market-data inputs.

## Shareable artifacts

- market-field-calculus-working-paper.pdf: descriptively named copy for direct
  sharing.
- share.pdf: named-author build target for the same working paper.
- main.pdf: anonymous conference-review version.
- main.tex and references.bib: paper source and bibliography.
- market_field_reproducibility.ipynb: executed companion notebook.
- figures, tables, and results: generated evidence used by the paper.
- results/representation_baseline.csv: eight-asset Market Field versus cheap
  24-bar feature comparison under the shared chronology and clustering gate.
- results/representation_window_stability.csv: SPY prefix/full assignment
  stability for both representations.
- results/entropy_dictionary_sensitivity.csv: complete SPY dictionary
  recomputations at entropy windows 8, 12, 24, 48, and 96.
- results/bibliography_audit.csv and bibliography_audit_notes.md: recorded
  38-entry DOI/ISBN/source-page metadata audit and discrepancy resolution.
- requirements-paper.txt: direct paper dependencies.
- requirements-paper-lock.txt: full version capture of the repository Python
  environment used for the revision audit; this is an environment record, not
  a claim of cross-platform solver reproducibility.
- supplement: broader nine-timeframe, resolution, window-stability, and live
  boundary audit with an executed notebook.

The official ICLR 2026 style and bibliography files are included unchanged from
the conference template. In the 22-page Tectonic 0.16.9 build, all main text,
including the conclusion, reproducibility statement, and ethics statement, ends
on page 9; references begin on page 10, and Appendix A begins on page 12. This
remains within the conference's nine-page main-text limit, which excludes
references and appendices.

## Rebuild

Run commands from the repository root with the repository virtual environment.
An exact `--offline` rerun requires the original local `cache` directory; that
directory is intentionally excluded from Git:

~~~powershell
.\.venv\Scripts\python.exe docs\papers\market-field\scripts\generate_assets.py --offline
.\.venv\Scripts\python.exe docs\papers\market-field\scripts\audit_references.py
.\.venv\Scripts\python.exe docs\papers\market-field\scripts\build_notebook.py --execute
~~~

Use --refresh instead of --offline on a fresh clone to retrieve a new adjusted
Yahoo Finance snapshot. A refresh can change provider-revised history and
therefore the reported hashes and results; it does not reconstruct the paper's
original inputs unless the canonical row hashes happen to match.

Compile from the paper directory with Tectonic 0.16.9 or a standard LaTeX
distribution:

~~~powershell
cd docs\papers\market-field
tectonic -X compile main.tex
tectonic -X compile share.tex
~~~

For a conventional TeX installation, BibTeX and repeated LaTeX passes may be
used instead. The checked PDFs were built with Tectonic 0.16.9.

## Provenance

- Implementation repository:
  https://github.com/meyer-s/Market-Diagnostic-Dashboard
- Primary data: Yahoo Finance through yfinance 1.1.0 with auto_adjust=True.
- Sample: SPY, QQQ, IWM, TLT, GLD, USO, VNQ, and BTC-USD.
- Requested range: 2018-01-01 through 2026-07-21 inclusive.
- Canonical input hashes and actual coverage:
  results/validation_summary.json.
- Raw provider cache: cache; retained locally and excluded from Git. Yahoo
  Finance data is not redistributed by this package.

The revised package has an explicit implementation, execution, and artifact
lineage:

| Commit | Role | Claim boundary |
|---|---|---|
| `cd67fb48c1ee747fb8b447bc9d59fb8eaf7ec430` | Repository reference recorded for the first paper run and retained raw-input manifest | Historical first-run context only; it is not the source identity for the current derived primary artifacts. |
| `f5d3884c9112e9cd5aa9442bc546194db9314697` | Reviewed implementation source | Contains the round-two mathematics, semantics, application security boundary, tests, and notebook generators. |
| `05e64332414585bd9cc15a28b36c81adf1dd3b71` | Clean primary execution head | `results/primary_run_receipt.json` records a clean tree, pandas 2.2.3, evaluated source hashes, the matched baseline, entropy ablation, and generated artifact hashes. Its evaluated implementation files are byte-identical to `f5d3884`. |
| `205fda042f5e3a0e6a3598b6aab5b84a1437aa8e` | Clean supplementary execution head | `supplement/results/run_receipt.json` records a clean tree, stable start/completion source hashes, and hashes for the broader derived evidence. Its evaluated implementation files are byte-identical to `f5d3884`. |
| `42e0a24919504de7fed9f928728bef5157f5ef34` | Executed primary notebook commit | Contains the top-to-bottom notebook execution after the clean primary receipt; all 15 cells are present, eight code cells executed, and no error output is stored. |

Evaluated implementation source: `f5d3884c9112e9cd5aa9442bc546194db9314697`;
the clean execution heads bind the same implementation files by SHA-256. The
shareable PDF build commit is recorded in the release-lineage update immediately
following that build.

The committed manifest, hashes, derived CSVs, figures, tables, executed
notebooks, direct requirements, and full environment version capture document
the run. They permit implementation and arithmetic review, but a fresh clone
cannot exactly reconstruct the raw sample without an independently matching
provider response. The environment capture records installed versions and does
not guarantee that every wheel is available on another platform.

No IBKR credentials, proprietary IBKR responses, open positions, scanner
secrets, or secret-option records are part of this package.

## Interpretation guardrails

- Causal means prefix-only or prefix-invariant computation, not causal
  inference.
- Pressure and its higher derivatives are bounded engineered measurements, not
  literal market forces or physical dimensions.
- Scope loops are trajectories, not detected cycles or attractors.
- Forms are request-local calibration descriptors, not universal market
  regimes.
- Under the matched diagnostic, the cheap baseline passes the multi-Form gate
  for 8/8 assets versus 2/8 for Market Field. The dictionary is a translation
  mechanism, not evidence of superior unsupervised separation.
- SPY Form assignments are less entropy-window-sensitive than the underlying
  Information coordinate, but calibration-distance tails still move
  materially; interpretation remains tied to the fixed v1 definition.
- The upper calibration-distance-tail statistic is descriptive, not a formal
  p-value, coordinatewise range test, or coverage guarantee. The payload's
  `outside_learned_range` field name is a legacy label.
- The option integration has algorithmic ranking weight zero and cannot execute
  trades. Human-visible confidence or urgency can still influence a decision,
  so `shadow_only` does not mean zero behavioral exposure.
- Production Secret Options requests use distinct memory-only, non-cookie bearer
  credentials for read and mutation scopes. The application boundary fails
  closed and emits redacted structured audit events, but the shared configured
  actor is not proof of an individual identity and log retention is operational.

## Directory map

- scripts/generate_assets.py: cache-first empirical audit and figure/table
  generation.
- scripts/build_notebook.py: notebook construction and top-to-bottom execution.
- scripts/audit_references.py: Crossref/ISBN/source-page bibliography metadata
  audit.
- results/asset_summary.csv: asset-level dictionary and tail diagnostics.
- results/validation_summary.json: source manifest, diagnostics, synthetic
  controls, and local benchmark.
- docs/market-field-language.md at repository root: living implementation
  methodology.
- IMPLEMENTATION_MAP.md: paper claims mapped to production modules.
- supplement/PRELIMINARY_EVALUATION.md: independent broader audit narrative.
