# Preliminary empirical and engineering evaluation of Market Field Calculus v1

> Version note (2026-07-26): the executed supplement below evaluated semantic
> revision 1.2. Formula v1 is unchanged, but semantic 1.3 now adds
> coordinate-level coverage, deterministic recipe/input identities, explicit
> direct-versus-indirect option authority, terminal rank snapshots, and
> prospective impression logging. Those additive mechanisms have focused
> production tests; the numerical supplement has not been relabeled or
> retroactively rerun as 1.3 evidence.

## Result in one paragraph

On a locally retained snapshot containing 9,235 completed OHLCV bars across 15 symbol-timeframe datasets, the live Market Field transform was exactly prefix-invariant in 46/46 audits both at API precision and after response-only rounding was bypassed: 24,472 unrounded numeric comparisons had maximum deviation 0 at a `1e-12` tolerance. That supports the narrow engineering claim that the evaluated live computation is nonanticipative for the tested prefixes; it does not establish predictive or trading value. The initialization-sensitivity audits also show why prefix-only computation is not the same as numerical stability. Recomputing the last 32 measurements from only 60 trailing bars produced median IQR-normalized error 0.501 and 90th-percentile error 2.009 relative to full-history computation, while 96 bars reduced the median to 0.035 but left the 90th percentile at 0.931. Semantic revision 1.2 requires 96 completed bars for option context and exposes canonical minimum-input and initialization-target coverage; this is a disclosed heuristic, not a convergence guarantee. The serialized `maturity` object remains a compatibility alias. The public API separately requests up to 96 hidden prefix bars. The production order-3 permutation entropy has six possible ordinal patterns and is sensitive to its trailing-pattern window: median correlations with the 24-pattern setting ranged from 0.342 to 0.630 across alternatives. A constant-price path correctly produced pressure 0, yet formula anchors left Structure at 0.42 and display confidence at 0.68. These are material specification and interpretation findings, not performance evidence.

## Questions evaluated

1. Do future bars change already-computed live field values?
2. Does prefix invariance persist before response-only scalar and matrix rounding?
3. How sensitive are current measurements to trailing-history truncation and EWM initialization?
4. How sensitive are the audited 60-bar baseline and the 96-bar option initialization target relative to full retained history?
5. How much do results move when the log-horizon grid or permutation-entropy window changes?
6. What values do the named measures assign to a mathematically constant-price path?
7. Does fixed input produce bitwise-identical serialized output?
8. Does the same bounded representation remain numerically well-defined across all supported timeframes?
9. Are the learned retrospective states stable, supported, and calibrated out of sample?
10. Does the options wrapper preserve completed-bar, direction-alignment, and zero-algorithmic-authority boundaries?
11. What compute-only latency distribution is observed, and does the deployed endpoint expose still-forming bars?

## Data and protocol

The local snapshot was observed at `2026-07-22T15:48:24.325098+00:00` through the repository Yahoo provider. It contains SPY at 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W, plus daily QQQ, IWM, TLT, GLD, USO, and BTC-USD. There are 15 datasets and 9,235 retained bars. Fifteen latest rows were excluded by a predeclared completion policy. There were no duplicate timestamps, missing OHLCV cells, invalid OHLCV rows, or non-monotonic series. Yahoo data and adjustment behavior remain a source limitation; this is not an exchange-grade tick archive.

The raw CSV files are immutable local inputs for this run but are intentionally excluded from Git because Yahoo data cannot be redistributed with the repository. `data/raw/manifest.json` records their SHA-256 hashes, source-code hashes, provider/version information, completion rules, timestamp coverage, repository commit, and environment. An offline rerun means rerunning against the retained local files, not reproducing this historical snapshot from a fresh clone. A network re-fetch is an explicit, separate experiment and will not reproduce the recorded hashes.

### Causal prefix audit

For each dataset, the system was evaluated on the full completed-bar history and on prefixes ending at 60%, 80%, and 95% of the history. For every value available at a prefix endpoint, the audit computed

`max_j,t | f_j(X_1:t) - f_j(X_1:T)[t] |`,

where `j` spans live channels, derivatives, strata, carriers, and carrier ratios. One additional SPY-daily stress test replaced the entire future suffix with extreme synthetic values and rechecked the preserved prefix. The audit was run twice: once against the production API serialization at tolerance `1e-4`, and once with only the response serializers replaced by full-precision floats at tolerance `1e-12`. The latter leaves the production filters, transforms, reductions, and field construction unchanged. Exact zero is strong evidence for these fixed prefixes, not an analytic proof for every possible input.

### Determinism audit

Every live-only dataset was evaluated twice, normalized into a canonical JSON representation, and hashed with SHA-256. The SPY daily retrospective lexicon was evaluated three times. A check passed only if all hashes for the fixed input matched exactly.

### Horizon-resolution audit

The dense horizon grid, bars 8 through 64 at step 1, was treated as a numerical reference. Grids with steps 2, 4, and 8 were compared after a 128-bar warm-up across 12 live features and all 15 datasets. The principal scale-free error is mean absolute error divided by the within-reference interquartile range. Correlation is reported separately because high path agreement does not imply equal field levels.

There are 180 dataset-feature rows for each grid step: 180 reference rows for step 1 and 180 rows each for steps 2, 4, and 8. Thus the non-reference total is 540, while the step-4 result alone contains 180 comparisons.

### History-truncation and initialization-coverage audit

For each of the 15 datasets, the full retained history was the endpoint reference. The field was recomputed from trailing windows of 60, 96, 128, 192, 256, and 365 bars, and the final 32 aggregate derivative, stratum, carrier, and carrier-ratio observations were compared with the same timestamps from the full-history computation. Errors were divided by each feature's full-history IQR. This measures initialization and retained-history sensitivity; it does not designate the full-history result as economic truth.

The static initialization contract separately records the option wrapper's minimum, the public endpoint's hidden prefix request, the longest horizon, and the 96-bar carrier reference span. The audited semantic-1.2 payload emitted no feature-level initialization-coverage mask; semantic 1.3 adds that mask without changing the audited formulas.

### Entropy-window and null-anchor audit

Order-3 causal Bandt--Pompe entropy was recomputed with trailing windows of 8, 12, 24, 48, and 96 observed ordinal patterns. There are six possible order-3 permutations; `window=24` is a count of recent pattern observations, not a count of distinct pattern types. Each alternative was compared with the production 24-pattern series after the standard evaluation warm-up.

The semantic-anchor audit passes a 256-bar constant OHLCV path through the unmodified transform, with both positive-volume and zero-volume variants. It records directional, structural, disorder, information, propagation, display-confidence, and carrier-availability outputs. The purpose is to distinguish mathematical formula floors from detected market organization.

### Compute-only latency audit

The options snapshot was timed sequentially ten times for each of seven locally retained daily datasets using 365 input bars. All 70 raw durations and payload sizes are retained. The reported warm distribution excludes the first measured call per symbol. Imports were already loaded, so this is neither a fresh-process cold-start benchmark nor a concurrent production load test; retrieval, persistence, network delay, and queueing are excluded.

### Timeframe behavior audit

The same settings were run on all nine SPY timeframes. We measured finite-value share, distributional summaries, lag-one autocorrelation, median absolute changes, and threshold-based directional phase turnover. Clock spans differ radically, so these are numerical-behavior diagnostics, not direct economic comparisons across timeframes.

### Retrospective lexicon audit

For each of seven daily datasets, 96 warm-up bars were followed by a chronological 236-bar fit segment, 117-bar calibration segment, and 300-bar evaluation segment. The learned dictionary was never used as an input to the live field. We recorded selected archetype count, fit silhouette, evaluation state changes and run lengths, availability of a same-state empirical distance rank, upper calibration-distance-tail frequency (lower empirical rank below the nominal 0.05 cutoff), transition support, and current-state support. SPY window sensitivity was assessed by comparing prefix-trained and full-window state labels on their overlapping evaluation bars with adjusted Rand index (ARI).

### Options shadow-boundary audit

The daily options context was evaluated after appending an intentionally extreme, incomplete synthetic session. The audit required that the wrapper exclude that row, leave all stable context fields unchanged, reverse aligned directional pressure between call and put, omit retrospective dictionary sections, retain rank influence 0.0, and disable automated execution.

## Results

### 1. Causal and deterministic behavior passed the tested scope

| Diagnostic | Checks | Passes | Numeric comparisons | Worst observed deviation |
|---|---:|---:|---:|---:|
| Serialized prefix invariance, including suffix mutation | 46 | 46 | response-rounded | 0.0 at `1e-4` |
| Unrounded prefix invariance, including suffix mutation | 46 | 46 | 24,472 | 0.0 at `1e-12` |
| Canonical repeated-run determinism | 16 | 16 | canonical payload hashes | 1 unique hash per fixed input |

This is strong implementation evidence for the evaluated input families. It should be phrased as tested prefix invariance or nonanticipativity, not as causal inference or a theorem about every possible input and later code revision. The audit covers the live matrices and aggregate derivatives, strata, carriers, and carrier ratios. It does not claim that a retrospective dictionary fitted on a longer window will preserve its earlier labels; the separate window-stability audit shows that it does not.

### 2. Sixty bars were materially history-sensitive; 96 is better but not converged

| Trailing input bars | Median IQR-normalized MAE | 90th percentile |
|---:|---:|---:|
| 60 | 0.501 | 2.009 |
| 96 | 0.035 | 0.931 |
| 128 | 0.006 | 0.457 |
| 192 | 0.0004 | 0.118 |
| 256 | 0.00002 | 0.030 |
| 365 | 0.0000003 | 0.003 |

The audited baseline accepted 60 completed bars. At that point it had only 12 observations after the 48-bar shift boundary and covered 62.5% of the 96-bar carrier reference span. The computation returned finite values because rolling operations permit partial windows and EWMs initialize at their first observation; finiteness must not be translated as convergence. Semantic revision 1.2 requires 96 completed bars for option context and emits minimum-input and initialization-target coverage metadata. The public endpoint still permits a 60-visible-bar request, but requests 96 additional hidden prefix bars and can compute on up to 156 bars before trimming the visible response.

The practical research conclusion is not that 365 is universally sufficient or that 96 has converged. Revision 1.2 closed the clearest aggregate availability gap. Follow-on semantic 1.3 now separates finite internal computability, source observability, declared rolling-depth support, and full dependency support for all 15 coordinates, alongside required inputs, retained-prefix depth, and neutral-placeholder flags. These fields expose startup and missingness; they do not turn the 96-bar target into convergence or make a 96-bar option snapshot equivalent to a 365-bar snapshot.

### 3. The entropy window is a material model parameter

Relative to the production 24-pattern setting, the median dataset correlation was 0.451 at window 8, 0.630 at window 12, 0.606 at window 48, and 0.342 at window 96. The weakest individual alternative-window correlation was -0.014. This is not evidence that window 24 is optimal; it shows that the parameter changes the descriptive path enough to require freezing, reporting, and prospective sensitivity analysis.

The manuscript must also distinguish six possible order-3 ordinal patterns from a trailing window containing 24 observed pattern instances. Startup behavior uses a growing causal count until the selected window is filled.

### 4. Constant prices expose nonzero semantic floors

The 256-bar constant-price path produced aggregate pressure 0, velocity 0, permutation entropy 0, information 0, and propagation 0. Cross-horizon coherence was 1.0, however, so the current blend produced Structure 0.42 and display confidence 0.68 even though there was no directional market organization to detect. The same field values held with zero volume, while the participation and liquidity carriers were correctly marked unavailable.

These outputs are mathematically consistent with the formulas. They are semantically unsafe if Structure or confidence is described to a reader as observed organization or conviction. Version 1 should document them as coherence-derived formula anchors. A changed formula should be introduced only as a versioned, ablated model revision rather than silently altering the published representation.

### 5. Horizon-grid density is a model parameter, not a presentation choice

Across 540 non-reference feature comparisons (180 at each of steps 2, 4, and 8), the 180 step-4 comparisons produced median IQR-normalized MAE 0.203, 95th-percentile error 0.428, and median correlation 0.940. The worst step-4 case was SPY 15m `scaling_exponent`, with normalized MAE 0.730 and correlation 0.911. Geometry, propagation, scaling exponent, and cascade-related measurements were more sensitive than pressure itself.

The paper and implementation should freeze a horizon grid in the model specification. Results from different grids should not be pooled without an explicit recalibration or sensitivity analysis.

### 6. All timeframes were finite, but the trajectories are deliberately smooth

Across all nine SPY timeframes, the minimum finite-feature share was 1.000. Median absolute velocity ranged from 0.355 to 0.406, median geometry from 0.374 to 0.385, and median structure from 0.436 to 0.495. Directional phase turnover ranged from 2.99 to 5.72 changes per 100 evaluation bars. Pressure lag-one autocorrelation was 0.9954 to 0.9976.

The bounded scales behave similarly enough to render on a common visual language, especially for geometry, but the extreme autocorrelation means adjacent values are not independent evidence. Confidence intervals and future validation must use time-series-aware resampling or genuinely forward data.

### 7. The learned dictionary is sparse, partly unsupported, and not nominally calibrated out of sample

| Dataset | Archetypes | Calibration-rank coverage | Upper distance-tail rate (rank < 0.05) | Fit transitions | Reliable next states |
|---|---:|---:|---:|---:|---:|
| SPY 1D | 2 | 100.0% | 36.7% | 6 | 0 |
| QQQ 1D | 2 | 100.0% | 42.7% | 12 | 2 |
| IWM 1D | 2 | 75.3% | 0.0% | 4 | 0 |
| TLT 1D | 2 | 100.0% | 1.3% | 2 | 0 |
| GLD 1D | 1 | 100.0% | 5.3% | 0 | 0 |
| USO 1D | 1 | 100.0% | 16.0% | 0 | 0 |
| BTC-USD 1D | 2 | 32.3% | 11.3% when scored | 2 | 0 |

Across 2,100 evaluation bars, 1,823 had sufficient same-state calibration support and 277 were unscored; 317 of the supported bars entered the upper calibration-distance tail because their empirical upper-tail rank was below 0.05. IWM contributed 74 unsupported bars and BTC-USD 203. Unsupported bars are not non-events and must be reported separately from the conditional tail rate.

Only one or two archetypes survived the current support/silhouette gates despite a maximum of five, and only two reliable next-state entries existed across all seven dictionaries. The 0.05 state-conditional calibration threshold did not imply a 5% alert frequency in the forward evaluation segment: SPY and QQQ were far above it. This is consistent with distribution shift and serial dependence. The score should be called an empirical state-conditional calibration-distance tail rank, not a p-value or a literal range test, and no next-state prediction claim is currently supportable.

SPY dictionary agreement with the full-window fit was ARI 0.000 for a 70% history prefix, where the prefix selected one archetype versus two, and ARI 0.873 for an 85% prefix, where both selected two. The dictionary is therefore window-native. State IDs should always be versioned with the symbol, timeframe, training interval, feature set, and clustering settings.

### 8. The audited direct option wrapper preserved zero algorithmic authority

The synthetic incomplete daily session was excluded, had zero influence on stable field context, and left 365 completed bars through 2026-07-21. Call and put aligned pressure were exact sign opposites (+0.0255 and -0.0255). The payload remained `shadow_only`, `rank_influence=0.0`, `automated_execution_enabled=false`, and excluded retrospective lexicon sections. This validates the tested direct-wrapper wiring only. A later, separately versioned outcome-learning canary can use historical point-in-time field cohorts inside a total score weight capped at 10%; that canary was not part of this executed supplement and is not evidence of option-selection performance.

### 9. Compute-only latency is plausible but is not a production SLA

Across 63 warm sequential measurements over seven symbols in the final recorded run, compute-only option snapshots had p50 105.2 ms, p95 106.8 ms, and p99 107.4 ms; the maximum across all 70 measurements was 107.7 ms. The platform was Windows 11, Python 3.13.14, on an AMD64 processor. All raw measurements and payload sizes are in `results/option_snapshot_latency.csv`; reruns are expected to vary with local machine load.

This distribution excludes retrieval, persistence, concurrency, network delay, production queueing, and fresh-process imports. It supports only the statement that cached sequential computation is modest on the measured machine. It cannot be compared directly with the live endpoint's multi-second response time and is not a latency SLA.

### 10. Live operational probe succeeded but exposed a reproducibility boundary

At `2026-07-22T15:52:42.340042+00:00`, the deployed endpoint returned HTTP 200 for all nine supported timeframes and declared `Market Field Calculus v1`, causal computation, and Yahoo as its data source. Median response time was 6,409.8 ms. Under this audit's conservative completion rules, the latest returned bar was possibly still forming in 9/9 responses. That may be useful for a live screen, but any paper experiment or option-decision audit should pin an `as_of` time and use completed bars only.

The focused repository checks also passed: 32 market-weather/context tests and 9 option-field-context tests, with no failures.

## Paper-ready tables and figures

| Proposed item | Artifact | Intended claim |
|---|---|---|
| Table 1: dataset and integrity profile | `results/dataset_profile.csv` | Coverage, exclusions, and basic input quality |
| Table 2: invariant and repeatability audit | `results/prefix_invariance.csv`, `results/prefix_invariance_full_precision.csv`, `results/determinism.csv` | Tested prefix behavior before and after response serialization; deterministic execution |
| Table 3: initialization coverage and entropy sensitivity | `results/history_truncation_sensitivity.csv`, `results/initialization_contracts.csv`, `results/entropy_window_sensitivity.csv` | Limited-history and entropy-window parameters materially change descriptive measurements |
| Table 4: horizon-resolution accounting | `results/resolution_convergence.csv`, `results/resolution_comparison_counts.csv` | Exactly 180 comparisons per grid step; sparse grids alter several features |
| Table 5: semantic anchors and latency | `results/null_state_anchor.csv`, `results/option_snapshot_latency.csv` | Formula floors on flat input and a bounded compute-only benchmark |
| Table 6: lexicon calibration and support | `results/lexicon_diagnostics.csv`, `results/lexicon_window_stability.csv` | Sparse grammar, unsupported rows, calibration limits, and window dependence |
| Table 7: timeframe behavior | `results/timeframe_behavior.csv` | Numerical stability and smoothness across supported horizons |
| Figure 1: causal audit | `figures/fig_causal_prefix_audit.png` | All tested deviations lie at exact-zero display floor, below tolerance |
| Figure 2: phase portraits | `figures/fig_timeframe_phase_portraits.png` | The state-space trajectory changes shape across clock horizons |
| Figure 3: resolution convergence | `figures/fig_resolution_convergence.png` | Sparse horizon grids materially alter several features |
| Figure 4: sensitivity and semantic anchors | `figures/fig_sensitivity_audits.png` | History depth, entropy window, and flat-state formula anchors must be disclosed |
| Figure 5: Form timeline | `figures/fig_spy_state_timeline.png` | Request-local Forms are descriptive prototypes; upper calibration-distance-tail flags cluster through time |

For the main paper, the unrounded prefix row, initialization contract, per-step comparison count, and Figure 4 are the strongest peer-review responses. The state timeline belongs in a limitations or diagnostics section unless future prequential validation shows stable calibration.

## Claims that are currently supportable

- For the locally retained datasets and implementation hashes in the manifest, live field outputs passed the specified future-prefix audit before and after response-only rounding was removed, and fixed inputs passed repeated-run audits.
- The implementation yields finite bounded measurements on every supported SPY timeframe in this snapshot.
- Horizon-grid density materially affects several feature families and must be fixed or reported.
- Trailing-history depth materially affects current measurements; semantic revision 1.2's 96-bar option initialization target materially improves the audited 60-bar baseline but remains a heuristic rather than a convergence result.
- The production permutation-entropy window is a material parameter and has not been shown optimal.
- Structure 0.42 and display confidence 0.68 are formula anchors on constant prices, not evidence of market organization.
- The learned state layer is retrospective, data-window dependent, and currently better interpreted as a descriptive compression than a predictive grammar.
- The options integration is wired as completed-bar, direction-aware, retrospective-free, and zero-ranking/zero-execution-authority in the tested wrapper.

## Claims that are not currently supportable

- That the field, learned state, transition grammar, or tail score predicts future returns, volatility, option P&L, drawdowns, or execution quality.
- That the 0.05 distance threshold is a valid p-value or a uniformly calibrated anomaly probability.
- That state IDs represent universal market regimes across symbols, timeframes, samples, or code versions.
- That any minimum input length is converged merely because the computation returns finite values.
- That window 24 is an optimal entropy setting, or that the current Structure/confidence anchors have a uniquely correct semantic interpretation.
- That performance generalizes beyond this single local snapshot or survives costs, spreads, latency, and revisions.
- That highly autocorrelated bar-level observations provide independent sample size.

## Required next evaluation before a performance claim

1. Freeze the feature code, horizon grid, completion policy, and state-training protocol before seeing the test period.
2. Promote the new development-only prequential harness to a preregistered no-touch study with training, calibration, and test windows separated chronologically; never rebuild a dictionary using future test bars.
3. Report naive baselines, simple technical baselines, and ablations for each feature family. Evaluate both incremental calibration and incremental decision utility.
4. Use block bootstrap, stationary bootstrap, or a dependence-aware model for uncertainty; treat overlapping forward-return windows as serially dependent.
5. Predefine outcomes such as forward return, realized volatility, maximum adverse excursion, and option-specific outcomes. Correct for the multiplicity of symbols, timeframes, horizons, states, and thresholds.
6. For options, replay only quotes available at the decision timestamp; include bid/ask spread, liquidity filters, slippage, commissions, assignment/exercise rules, and delisting/missing-quote handling.
7. Keep the first options experiment non-executing. Compare frozen champion and applied ranks using the append-only terminal snapshot and impression ledger; do not let the bounded canary change capital, vetoes, sizing, or execution until a preregistered sample is complete.
8. Publish every failed, unsupported, and unscored case. State support and coverage are part of the result, not rows to discard.

## Reproducibility note

Run `evaluate_market_field.py` without flags to rerun against the retained local inputs and regenerate all result tables, figures, and `results/run_receipt.json`. The receipt distinguishes the current Git HEAD from dirty working-tree source, records per-file source hashes and dependency versions, and hashes the generated artifacts. The frozen data manifest and hashes are tracked, but raw Yahoo CSVs are not redistributed; therefore a fresh clone cannot recreate the historical snapshot offline. If local files are absent, the harness fails with explicit refresh instructions. `market_field_preliminary.ipynb` is the executed narrative companion. A forced fetch creates a different dataset and should never silently replace evidence cited by the paper.
