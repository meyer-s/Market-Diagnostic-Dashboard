# Implementation and claim map

This map connects paper sections to the implementation that generated them. It
is an audit aid, not part of the ICLR page-limited main text.

Version legend: `market_field_calculus_v1` is the formula model;
`semantic_revision=1.3` is the current additive coverage, identity, and
direct-versus-indirect authority contract (legacy 1.0--1.2 payloads remain
immutable/readable); and
`market_field_preliminary_v2` is the evaluation harness, not a v2 formula.

| Paper topic | Production source | Claim boundary |
|---|---|---|
| Pressure surface, prefix-only smoothing, base channels, input quality, analysis identity, and initialization coverage | backend/app/services/market_weather.py | Engineered bounded representation with canonical recipe/input/analysis hashes; identity does not certify provider truth; `maturity` remains a legacy serialized alias |
| Derivative hierarchy, log-horizon geometry, permutation entropy, strata, carriers, semantic anchors, and coordinate coverage | backend/app/services/market_weather_research.py | Finite differences and operational analogues; finite-computation and full-dependency-support masks are reported separately and are not convergence certificates |
| Form dictionary, chronology, distance tails | backend/app/services/market_weather_research.py | Request-local empirical codebook; upper calibration-distance tail, not a coordinatewise range test, universal latent regime, or formal p-value |
| Scope projections and display smoothing | frontend/src/components/marketWeather/MarketWeatherResearchLab.tsx | Visualization only; loops are not detected cycles or attractors |
| Pairwise Relative Field construction and API | backend/app/services/market_weather_comparison.py and backend/app/api/market_weather.py; exact supplement in docs/papers/market-field/relative-field-addendum.tex | Ordered, same-recipe comparison of two independently computed fields; supported coordinate-scale differences, evaluation-only proper-fit-relative differences, full-precision normalized relative price context, same-intersection family-balanced stretch, exact timezone-aware-UTC or serialized-naive intraday alignment, and alignment/provenance receipts. The optional prior-only beta uses 20--60 prior aligned returns, is unavailable below benchmark return standard deviation `1e-7` or for nonfinite/absolute estimates above 25, and never clips or carries unavailable values. Its centered slope is intercept-inclusive, but the displayed beta-adjusted return does not subtract that intercept and is not OLS alpha. This is not a basket, cross-symbol Form identity, connectedness estimate, or efficacy result. |
| Pairwise scopes and comparison controls | frontend/src/components/marketWeather/MarketWeatherComparisonLab.tsx and frontend/src/pages/MarketWeatherRadar.tsx | Common-axis target/benchmark/difference views and linkable selectors; visual relationship traces do not establish leadership, cycles, causation, or forecast skill |
| Human labels | frontend/src/utils/marketWeatherLexicon.ts | Translation of measured profiles; not independently learned semantics |
| Prior-bar support, resistance, optionality and cross-market context | backend/app/services/market_weather_context.py | Context and association screening; not order-book structure or causation |
| Completed-bar option snapshot | backend/app/services/option_field_context.py | Prefix-only daily evidence with signed-delta/action alignment and explicit zero direct rank/veto/verdict/size/execution authority; downstream historical-cohort canary use is declared separately |
| Scanner persistence | backend/maintenance_scripts/options_chain_sweep.py and backend/app/services/options_alerts.py | Field cannot create scanner eligibility |
| Opportunity score, bounded learning attribution, and sweep serialization | backend/app/services/options_opportunity.py, backend/app/services/option_decision_learning.py, and backend/app/services/option_sweep_runs.py | Champion formula remains unchanged; a separately governed total canary of at most 10% may alter applied score/order and exposes per-family marginal effects |
| Terminal rank and exposure ledger | backend/app/models/option_scanner_exposure.py, backend/app/services/option_scanner_exposure.py, backend/app/services/option_sweep_runs.py, backend/app/api/secret_options.py, and frontend/src/pages/SecretOptions.tsx | Normally finalized completed/stopped/error runs freeze candidate sets; authenticated browser impressions are append-only; stale, pre-schema, or failed-finalization runs remain explicitly unsnapshotted, and earlier exposure cannot be recovered |
| Manager shadow challenger | backend/app/services/option_thesis_engine.py and backend/app/api/secret_options.py | Human-visible confidence and urgency only; urgency may recompute the next-review date, but there is no algorithmic verdict, sizing, target, or execution authority |
| Replacement display | backend/app/services/option_replacement_classifier.py | Explicit pass/watch/fail context; implementation_ready remains false |
| Point-in-time outcome cohorts | backend/app/services/option_decision_learning.py | Descriptive cohorts; no dependence, exposure, duration, or cost adjustment yet |
| Primary paper evidence generation | docs/papers/market-field/scripts/generate_assets.py | Mechanics, controlled behavior, matched five-coordinate baseline, SPY prefix stability, and downstream entropy-window sensitivity; the negative baseline does not test returns or option performance |
| Bibliography metadata audit | docs/papers/market-field/scripts/audit_references.py and results/bibliography_audit_notes.md | DOI/ISBN/source-page consistency and recorded discrepancy resolution; substantive citation interpretation remains the author's responsibility |
| Supplementary v2 evaluation and run receipt | docs/papers/market-field/supplement/evaluate_market_field.py | Per-file source hashes identify dirty-working-tree runs; latency/payload distributions are run-specific, not service contracts |
| Frozen prequential development harness | docs/papers/market-field/evaluation | Purged chronological origins, naive/EMA/technical, fixed-break, and cap-truncated fit-only two-state HMM comparators, raw-vector/family ablations, stationary-bootstrap intervals, BH/Holm correction, and deterministic receipts; the HMM did not satisfy its source-fixed stopping tolerance within eight iterations, and retained-cache runs are development evidence, not a no-touch holdout |
| Future-work evidence triage | docs/papers/market-field/FUTURE_WORK_TRIAGE.md | Separates implementable instrumentation from unavailable retrospective evidence and longer-horizon research claims |

The public research API supports 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W
single-symbol requests plus a bounded two-symbol Pair v1 comparison under one
timeframe and recipe. Horizon rows remain bar counts inside that timeframe.
Daily/weekly pairs align by declared session date. Intraday pairs match exact
UTC timestamps when the source is timezone-aware; timezone-naive rows instead
match exact serialized timestamps without a UTC claim. Neither path carries
values, and session compatibility remains unknown for nonidentity pairs. The
implementation is not a constituent-weighted basket, cross-sectional peer
model, connectedness model, or fused nine-timeframe system.
