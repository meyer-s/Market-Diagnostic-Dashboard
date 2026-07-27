# Market Field working paper

This directory is an ICLR 2026-formatted source and derived-artifact package
for:

> Non-Anticipative Market Field Calculus: An Auditable Multiscale Representation for
> Option-Path Decision Support

Status: preliminary systems and methods paper, revised 2026-07-27. The evidence
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
- relative-field-pair-technical-addendum.pdf: descriptively named, named-author
  copy of the standalone Pair-v1 methods and reconstructibility addendum.
- relative-field-addendum-share.pdf: named-author addendum build.
- relative-field-addendum.pdf: anonymous-review addendum build.
- relative-field-addendum.tex, relative-field-addendum-share.tex, and
  relative-field-addendum-references.bib: addendum source, named wrapper, and
  addendum-only bibliography entries.
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
- evaluation: frozen development-only prequential protocol, runner, tests, and
  machine-readable receipts. The current dry run contains 53,856 unique cases
  across 11 model variants and 544 purged origins; retained-cache results are
  not an untouched holdout.
- FUTURE_WORK_TRIAGE.md: item-by-item separation of current engineering,
  prospective data collection, blocked retrospective evidence, and genuinely
  longer-horizon research.
- The production research page also contains Relative Field Pair v1: a
  two-instrument, same-recipe descriptive comparison with explicit alignment,
  exact window/support/compatibility disclosures, component and ordered
  comparison identities, a deterministic `pair_summary_v1`, and a compact
  self-verifying `market_field_pair_receipt_v1`. It is implementation scope,
  not an additional empirical result in this package.

The official ICLR 2026 style and bibliography files are included unchanged from
the conference template. In the 24-page Tectonic 0.16.9 build, all main text,
including the conclusion, reproducibility statement, and ethics statement, ends
on page 9; references begin on page 10, and Appendix A begins on page 13. This
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
.\.venv\Scripts\python.exe docs\papers\market-field\evaluation\evaluate_prequential.py --protocol docs\papers\market-field\evaluation\protocol_v0.json
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
tectonic -X compile relative-field-addendum.tex
tectonic -X compile relative-field-addendum-share.tex
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
| `d19ededff412d78873cf73724c2d5528961dd811` | Shareable paper build | Contains the 22-page anonymous and named PDFs compiled after the clean primary receipt, executed notebook, and final claim-boundary revision. |
| `b6fb1a873c1d4eb072ac9b8923cdaa95e2d4043b` | Semantic 1.3 implementation and clean development-evaluation head | Contains coordinate-support evidence, analysis identities, the governed option-learning canary, rank/exposure logging, conventional and state-model comparators, and the rebuilt 22-page papers. `evaluation/results/run_receipt.json` binds the clean-tree development run to this exact head and stable start/completion source hashes. |
| `4c848dafecd41a64bd52844c9a12140e6534a784` | Relative Field Pair v1 implementation source audited by the addendum | Contains the ordered same-recipe pair service and research UI through the final mobile-label correction. The standalone addendum reconstructs this numerical backend; the addendum PR adds terminology, schema-contract, and regression-test corrections without changing its numerical formulas. |

Evaluated implementation source: `f5d3884c9112e9cd5aa9442bc546194db9314697`;
the historical primary and supplementary clean execution heads bind the same
implementation files by SHA-256. The current prequential development receipt
records a separate clean-tree run at
`b6fb1a873c1d4eb072ac9b8923cdaa95e2d4043b`. That receipt exercises the
evaluation machinery on already-inspected retained data; it does not alter the
historical primary receipts or establish predictive or economic efficacy.

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
- A current Market Field snapshot has zero direct scanner weight and cannot
  create eligibility, impose a veto, size, issue a manager verdict, or execute
  a trade. Historical point-in-time field cohorts may participate indirectly
  inside the separately governed outcome-learning canary whose total applied
  weight is capped at 10%, only when the default-off
  `OPTION_LEARNING_CANARY_ENABLED` operator gate and every evidence gate pass.
  The cap is fixed by policy while each event weight is evidence-scaled and
  receipted. Human-visible context can also influence a decision, so
  `shadow_only` does not mean zero downstream or behavioral exposure.
- Semantic revision 1.3 separates finite startup computations from
  coordinate-level full-dependency-support masks and adds deterministic
  recipe/input/analysis hashes without changing formula v1. Dependency support
  is not convergence, and identity hashes do not certify provider truth or
  exchange-session completion.
- Relative Field Pair v1 compares two independently computed same-recipe fields
  only where both coordinates are measured and fully supported. Native
  target-minus-benchmark differences remain separate from each instrument's
  fixed proper-fit-relative difference and from normalized relative price
  progress. Pair context begins only on the shared evaluation interval; it is
  request-window-relative, not a universal or cross-sectional score. “Native”
  denotes the implemented 15D coordinate scale, not raw market units; carrier
  coordinates are bounded causal-baseline relative levels.
- Daily and weekly pairs align by serialized market-session date; the service
  does not independently certify exchange calendars or timezones. Intraday
  timestamps are normalized to UTC and matched exactly only when the source
  timestamps are timezone-aware. Timezone-naive rows instead require an exact
  serialized naive-timestamp match and are not relabeled as UTC. Neither branch
  uses nearest-neighbor matching or forward fill, and session compatibility
  remains unknown for nonidentity pairs. Nonidentity DXY comparisons at 1h,
  2h, and 4h are explicitly unavailable under the current provider anchors;
  DXY/DXY remains an explicit identity control. The live endpoint
  uses provider/cache rows as returned and does not independently certify its
  latest bar as exchange-complete. The canonical DXY selector
  preserves Yahoo `DX-Y.NYB` as an explicit provider alias rather than silently
  substituting `UUP`. Provider, session, adjustment, and currency differences
  remain visible limitations.
- Requested, available, and returned exact shared-window counts are distinct.
  The response also reports both leg counts, truncation, dropped observations,
  unmatched tails, latest-returned timestamps, and all-window bilateral
  coordinate-cell support with `missing_values_carried=false`. Daily/weekly
  session-date alignment reports timezone metadata as not applicable rather
  than inferred available.
- The optional prior-only beta-adjusted path needs at least 20 prior aligned
  log-return pairs and uses at most 60. Its centered covariance/variance slope
  is equivalent to the slope from an intercept-inclusive fit, but the displayed
  increment does not subtract the fitted intercept and is therefore not an OLS
  residual, abnormal return, or alpha. The beta is unavailable when the
  benchmark population return standard deviation is below `1e-7`, the estimate
  is nonfinite, or its absolute value exceeds 25. Rejected values are never
  clipped or carried forward: the row is unavailable, the cumulative
  beta-adjusted chain resets, and the current beta/return summary remains
  unavailable when the current beta is unavailable. Per-row actual sample
  counts and chain start/reset markers plus current-chain start/end,
  observations, chain/reset counts, and last reset make this discontinuity
  explicit; the retained `lookback_bars` alias is not the actual sample count.
- Relative price uses the full-precision normalized aligned closes rather than
  the four-decimal display serialization. Coordinate gaps separately consume
  the public component receipt: four-decimal coordinate series and six-decimal
  fit references, with six-decimal standardized values and gaps. The
  own-history-relative field-separation summary
  family-balances mean absolute context gaps over the same supported coordinate
  intersection and returns the latest value, five-bar-prior value, change,
  tolerance, classification, and participating support.
- The ordered `comparison_hash` identifies the component calculations and
  comparison contract. The distinct `market_field_pair_receipt_v1` freezes
  exact shared keys, latest values, support, compatibility disclosures, and
  zero authority under an unkeyed SHA-256 checksum also exposed in the response
  header. It excludes summary wording, cache/generation metadata, caveats, and
  full chart histories, so it is not a signed attestation or complete replay
  archive. Live URLs preserve selectors and rerun with current data; JSON
  export preserves this compact receipt. Request-local Form IDs are never
  matched across instruments.
- Pair v1 has zero scanner, canary, veto, verdict, sizing, and execution
  authority. It does not establish relative leadership, connectedness,
  prediction, or economic value. Basket fields, cross-sectional peer ranks, and
  cross-timeframe fusion remain future work.
- Successful finalization of completed, stopped, or errored scanner runs now
  freezes applied and counterfactual rank receipts; stale, pre-schema, or
  failed-finalization runs remain unsnapshotted. Authenticated
  ranking-rendered, candidate-visible, and detail-open impressions are
  append-only. Historical exposure before this collection boundary cannot be
  reconstructed.
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
- evaluation/README.md: frozen rolling-origin development protocol and receipt
  interpretation.
- FUTURE_WORK_TRIAGE.md: implementation-versus-evidence decision record.
