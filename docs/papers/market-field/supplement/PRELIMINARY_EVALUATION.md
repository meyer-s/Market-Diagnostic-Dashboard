# Preliminary empirical and engineering evaluation of Market Field Calculus v1

## Result in one paragraph

On a frozen public snapshot containing 9,235 completed OHLCV bars across 15 symbol-timeframe datasets, the tested live Market Field channels were exactly prefix-invariant at serialized precision in 46/46 audits and exactly deterministic by canonical SHA-256 in 16/16 repeated-run audits. That supports the narrow engineering claim that the evaluated computation is causal with respect to future input suffixes and reproducible for fixed inputs. It does not establish predictive or trading value. A dense-to-sparse horizon-grid study shows that the representation is materially resolution-sensitive: at grid step 4, the median IQR-normalized error was 0.203, the 95th percentile was 0.428, and median correlation with the dense reference was 0.940. Retrospective learned states were deterministic but not uniformly calibrated or stable: daily out-of-calibration alert rates ranged from 0% to 42.7%, only two reliable next-state entries were available across seven dictionaries, and SPY state agreement with the full-window dictionary moved from ARI 0.000 at a 70% prefix to 0.873 at an 85% prefix. The current evidence therefore supports a causal descriptive instrument and shadow-only options context, not a forecaster.

## Questions evaluated

1. Do future bars change already-computed live field values?
2. Does fixed input produce bitwise-identical serialized output?
3. How much do results move when the log-horizon grid is sampled more sparsely?
4. Does the same bounded representation remain numerically well-defined across all supported timeframes?
5. Are the learned retrospective states stable and is their empirical distance score calibrated out of sample?
6. Does the options wrapper preserve completed-bar, direction-alignment, and shadow-only boundaries?
7. Does the deployed endpoint return all supported timeframes, and does it expose still-forming bars?

## Data and protocol

The frozen snapshot was observed at `2026-07-22T15:48:24.325098+00:00` through the repository Yahoo provider. It contains SPY at 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W, plus daily QQQ, IWM, TLT, GLD, USO, and BTC-USD. There are 15 datasets and 9,235 retained bars. Fifteen latest rows were excluded by a predeclared completion policy. There were no duplicate timestamps, missing OHLCV cells, invalid OHLCV rows, or non-monotonic series. Yahoo data and adjustment behavior remain a source limitation; this is not an exchange-grade tick archive.

The raw CSV files are immutable inputs for this run. `data/raw/manifest.json` records their SHA-256 hashes, source-code hashes, provider/version information, completion rules, timestamp coverage, repository commit, and environment. The default evaluation reads only these files. A network re-fetch is an explicit, separate action.

### Causal prefix audit

For each dataset, the system was evaluated on the full completed-bar history and on prefixes ending at 60%, 80%, and 95% of the history. For every value available at a prefix endpoint, the audit computed

`max_j,t | f_j(X_1:t) - f_j(X_1:T)[t] |`,

where `j` spans live channels, derivatives, strata, carriers, and carrier ratios. One additional SPY-daily stress test replaced the entire future suffix with extreme synthetic values and rechecked the preserved prefix. The tolerance was `1e-4`; exact zero means zero at the implementation's serialized precision, not an analytic proof for all inputs.

### Determinism audit

Every live-only dataset was evaluated twice, normalized into a canonical JSON representation, and hashed with SHA-256. The SPY daily retrospective lexicon was evaluated three times. A check passed only if all hashes for the fixed input matched exactly.

### Horizon-resolution audit

The dense horizon grid, bars 8 through 64 at step 1, was treated as a numerical reference. Grids with steps 2, 4, and 8 were compared after a 128-bar warm-up across 12 live features and all 15 datasets. The principal scale-free error is mean absolute error divided by the within-reference interquartile range. Correlation is reported separately because high path agreement does not imply equal field levels.

### Timeframe behavior audit

The same settings were run on all nine SPY timeframes. We measured finite-value share, distributional summaries, lag-one autocorrelation, median absolute changes, and threshold-based directional phase turnover. Clock spans differ radically, so these are numerical-behavior diagnostics, not direct economic comparisons across timeframes.

### Retrospective lexicon audit

For each of seven daily datasets, 96 warm-up bars were followed by a chronological 236-bar fit segment, 117-bar calibration segment, and 300-bar evaluation segment. The learned dictionary was never used as an input to the live field. We recorded selected archetype count, fit silhouette, evaluation state changes and run lengths, availability of a same-state empirical distance score, outside-range frequency at a nominal 0.05 threshold, transition support, and current-state support. SPY window sensitivity was assessed by comparing prefix-trained and full-window state labels on their overlapping evaluation bars with adjusted Rand index (ARI).

### Options shadow-boundary audit

The daily options context was evaluated after appending an intentionally extreme, incomplete synthetic session. The audit required that the wrapper exclude that row, leave all stable context fields unchanged, reverse aligned directional pressure between call and put, omit retrospective dictionary sections, retain rank influence 0.0, and disable automated execution.

## Results

### 1. Causal and deterministic behavior passed the tested scope

| Diagnostic | Checks | Passes | Worst observed deviation |
|---|---:|---:|---:|
| Prefix invariance, including suffix mutation | 46 | 46 | 0.0 |
| Canonical repeated-run determinism | 16 | 16 | 1 unique hash |

This is strong implementation evidence for the evaluated input families. It should be phrased as a tested invariant, not as a theorem about every possible input or later code revision.

### 2. Horizon-grid density is a model parameter, not a presentation choice

Across 540 non-reference feature comparisons, grid step 4 produced median IQR-normalized MAE 0.203, 95th-percentile error 0.428, and median correlation 0.940. The worst step-4 case was SPY 15m `scaling_exponent`, with normalized MAE 0.730 and correlation 0.911. Geometry, propagation, scaling exponent, and cascade-related measurements were more sensitive than pressure itself.

The paper and implementation should freeze a horizon grid in the model specification. Results from different grids should not be pooled without an explicit recalibration or sensitivity analysis.

### 3. All timeframes were finite, but the trajectories are deliberately smooth

Across all nine SPY timeframes, the minimum finite-feature share was 1.000. Median absolute velocity ranged from 0.355 to 0.406, median geometry from 0.374 to 0.385, and median structure from 0.436 to 0.495. Directional phase turnover ranged from 2.99 to 5.72 changes per 100 evaluation bars. Pressure lag-one autocorrelation was 0.9954 to 0.9976.

The bounded scales behave similarly enough to render on a common visual language, especially for geometry, but the extreme autocorrelation means adjacent values are not independent evidence. Confidence intervals and future validation must use time-series-aware resampling or genuinely forward data.

### 4. The learned dictionary is sparse and not nominally calibrated out of sample

| Dataset | Archetypes | Tail-score coverage | Outside-range rate | Fit transitions | Reliable next states |
|---|---:|---:|---:|---:|---:|
| SPY 1D | 2 | 100.0% | 36.7% | 6 | 0 |
| QQQ 1D | 2 | 100.0% | 42.7% | 12 | 2 |
| IWM 1D | 2 | 75.3% | 0.0% | 4 | 0 |
| TLT 1D | 2 | 100.0% | 1.3% | 2 | 0 |
| GLD 1D | 1 | 100.0% | 5.3% | 0 | 0 |
| USO 1D | 1 | 100.0% | 16.0% | 0 | 0 |
| BTC-USD 1D | 2 | 32.3% | 11.3% when scored | 2 | 0 |

Only one or two archetypes survived the current support/silhouette gates despite a maximum of five, and only two reliable next-state entries existed across all seven dictionaries. The 0.05 state-conditional calibration threshold did not imply a 5% alert frequency in the forward evaluation segment: SPY and QQQ were far above it. This is consistent with distribution shift and serial dependence. The score should be called an empirical state-conditional distance rank, not a p-value, and no next-state prediction claim is currently supportable.

SPY dictionary agreement with the full-window fit was ARI 0.000 for a 70% history prefix, where the prefix selected one archetype versus two, and ARI 0.873 for an 85% prefix, where both selected two. The dictionary is therefore window-native. State IDs should always be versioned with the symbol, timeframe, training interval, feature set, and clustering settings.

### 5. The options integration boundary behaved as designed

The synthetic incomplete daily session was excluded, had zero influence on stable field context, and left 365 completed bars through 2026-07-21. Call and put aligned pressure were exact sign opposites (+0.0255 and -0.0255). The payload remained `shadow_only`, `rank_influence=0.0`, `automated_execution_enabled=false`, and excluded retrospective lexicon sections. This validates wiring and safety boundaries only; it says nothing about option-selection performance.

### 6. Live operational probe succeeded but exposed a reproducibility boundary

At `2026-07-22T15:52:42.340042+00:00`, the deployed endpoint returned HTTP 200 for all nine supported timeframes and declared `Market Field Calculus v1`, causal computation, and Yahoo as its data source. Median response time was 6,409.8 ms. Under this audit's conservative completion rules, the latest returned bar was possibly still forming in 9/9 responses. That may be useful for a live screen, but any paper experiment or option-decision audit should pin an `as_of` time and use completed bars only.

The focused repository checks also passed: 32 market-weather/context tests and 9 option-field-context tests, with no failures.

## Paper-ready tables and figures

| Proposed item | Artifact | Intended claim |
|---|---|---|
| Table 1: dataset and integrity profile | `results/dataset_profile.csv` | Coverage, exclusions, and basic input quality |
| Table 2: invariant and repeatability audit | `results/prefix_invariance.csv`, `results/determinism.csv` | Tested causal prefix behavior and deterministic execution |
| Table 3: timeframe behavior | `results/timeframe_behavior.csv` | Numerical stability and smoothness across supported horizons |
| Table 4: lexicon calibration and support | `results/lexicon_diagnostics.csv`, `results/lexicon_window_stability.csv` | Sparse grammar, calibration limits, and window dependence |
| Figure 1: causal audit | `figures/fig_causal_prefix_audit.png` | All tested deviations lie at exact-zero display floor, below tolerance |
| Figure 2: phase portraits | `figures/fig_timeframe_phase_portraits.png` | The state-space trajectory changes shape across clock horizons |
| Figure 3: resolution convergence | `figures/fig_resolution_convergence.png` | Sparse horizon grids materially alter several features |
| Figure 4: state timeline | `figures/fig_spy_state_timeline.png` | Learned states are descriptive regimes; distance alerts cluster through time |

For the main paper, Table 2 and Figure 3 are the strongest engineering evidence. Figure 4 belongs in a limitations or diagnostics section unless future prequential validation shows stable calibration.

## Claims that are currently supportable

- For the frozen datasets and implementation hashes in the manifest, live field outputs passed the specified future-prefix and repeated-run audits.
- The implementation yields finite bounded measurements on every supported SPY timeframe in this snapshot.
- Horizon-grid density materially affects several feature families and must be fixed or reported.
- The learned state layer is retrospective, data-window dependent, and currently better interpreted as a descriptive compression than a predictive grammar.
- The options integration is wired as completed-bar, direction-aware, retrospective-free, and shadow-only in the tested wrapper.

## Claims that are not currently supportable

- That the field, learned state, transition grammar, or tail score predicts future returns, volatility, option P&L, drawdowns, or execution quality.
- That the 0.05 distance threshold is a valid p-value or a uniformly calibrated anomaly probability.
- That state IDs represent universal market regimes across symbols, timeframes, samples, or code versions.
- That performance generalizes beyond this single frozen snapshot or survives costs, spreads, latency, and revisions.
- That highly autocorrelated bar-level observations provide independent sample size.

## Required next evaluation before a performance claim

1. Freeze the feature code, horizon grid, completion policy, and state-training protocol before seeing the test period.
2. Run a walk-forward or prequential evaluation with training, calibration, and test windows separated chronologically; never rebuild a dictionary using future test bars.
3. Report naive baselines, simple technical baselines, and ablations for each feature family. Evaluate both incremental calibration and incremental decision utility.
4. Use block bootstrap, stationary bootstrap, or a dependence-aware model for uncertainty; treat overlapping forward-return windows as serially dependent.
5. Predefine outcomes such as forward return, realized volatility, maximum adverse excursion, and option-specific outcomes. Correct for the multiplicity of symbols, timeframes, horizons, states, and thresholds.
6. For options, replay only quotes available at the decision timestamp; include bid/ask spread, liquidity filters, slippage, commissions, assignment/exercise rules, and delisting/missing-quote handling.
7. Keep the first options experiment shadow-only. Compare the scanner's frozen baseline rank with a separately logged field overlay; do not let the overlay change capital until a preregistered sample is complete.
8. Publish every failed, unsupported, and unscored case. State support and coverage are part of the result, not rows to discard.

## Reproducibility note

Run `evaluate_market_field.py` without flags to reproduce from the frozen inputs and regenerate all result tables and figures. `market_field_preliminary.ipynb` is the executed narrative companion. A forced fetch creates a different dataset and should never silently replace evidence cited by the paper.
