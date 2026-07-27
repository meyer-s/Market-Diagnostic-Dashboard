# Market Field Language

Status: experimental language version `0.1.2` over unchanged v1 field formulas

The Market Field Language is a machine-native description of recurring market-field geometry. It is deliberately learned without forward returns. Price outcomes are attached only after a form or phrase has been discovered, so the language describes what the field is doing before anyone decides what it might mean.

The interface is a translation layer. Numeric forms, motions, and phrases are canonical inside one analysis, but the primary interface always translates them into measured quantities, proper-fit-relative descriptions, support counts, and observed outcomes. Nonsemantic machine tokens are audit metadata, not user-facing state names. Version 0.1 does not yet reconcile identities across separate runs.

## Vocabulary

- **Atom**: one robust-normalized field measurement.
- **Form**: a learned prototype of the complete field state. The API exposes between one and five supported forms as `F.001` through at most `F.005`, each with a nonsemantic spoken token.
- **Fieldmark**: an experimental glyph generated from a form's prototype. It is no longer the primary explanation because its visual thresholds are not empirical units.
- **Motion**: a directed transition from one form to another.
- **Phrase**: a recurring run-collapsed sequence of two to four forms.
- **Relative Field**: a two-instrument, same-recipe comparison that keeps
  relative price progress separate from differences between the 15 measured
  field coordinates.
- **Native difference**: target minus benchmark in a coordinate's implemented
  scale, emitted only where both observations are measured and fully supported.
- **Context difference**: the target's proper-fit-relative coordinate minus the
  benchmark's independently proper-fit-relative coordinate on the shared
  evaluation interval. It is request-window-relative, not a universal score.
- **Shared support**: timestamps where both independently constructed fields
  have admissible, source-observed, full-dependency-supported evidence under the
  declared alignment rule.
- **Extreme calibration-distance tail**: an observation whose nearest-Form distance has an upper-tail rank below the documented cutoff on an independent same-Form chronological calibration slice. This does not mean coordinatewise or density-support exclusion.
- **Climate**: a future persistent distribution of phrases across symbols and windows. It is not implemented in version 0.1.

## State space

At bar `t`, the system constructs a state vector

```text
X(t) = [P, dP, d2P, d3P, d4P, S, K, G, I, R, C, A, V, Q, L]
```

where `P` is aggregate field pressure; the next four terms are its derivatives; `S, K, G, I, R` are the legacy trend-agreement composite, kinematics, geometry, information, and propagation strata; `C` is cascade bias; `A` is the local scaling exponent; and `V, Q, L` are volatility, participation, and liquidity-stress carriers. The v1.3 response also exposes activity and horizon agreement separately without adding them to this v1 vector. Because expanding the implemented realized-variation window only adds squared returns, `A` is nonnegative in exact arithmetic. Values below the declared floating-point tolerance are implementation-quality failures: raw storage retains defensive `[-2,2]` bounds, display and option translation withhold the invalid feature, and a request containing such a value emits no Form dictionary or retrospective relationship atlas.

The carrier baselines need up to twice the longest horizon. That warm-up is excluded before fitting whenever enough history is available; a clipped warm-up is reported as provisional. The pre-evaluation history is then split chronologically into a proper fit segment and a later held-out calibration segment. Every feature is centered and scaled using the proper fit segment only:

```text
Z_j(t) = (X_j(t) - median_fit(X_j)) / robust_scale_fit(X_j)
```

Correlated measurements do not get extra voting power merely because there are more of them. Features are divided into three families—pressure/state, transformed field, and OHLCV carriers—and each family receives one third of the total distance weight.

Semantic revision `1.3` makes initialization and source quality explicit. The public response distinguishes requested visible bars, bars actually supplied, and the larger calculation prefix; a provider shortfall is separate from minimum-input and initialization-target coverage. It reports the fixed 60-valid-bar API floor, the maximum-horizon observation floor, their effective maximum, the `2 × maximum horizon` initialization target, every dropped invalid-price category, and observed-volume coverage. Each of the 15 Form coordinates additionally separates finite internal computability, source/input observability, declared rolling-depth support, and the conjunction called full dependency support. It reports those per-time masks and first-supported indices alongside required inputs, retained-prefix depth, measured coverage, and neutral-placeholder use. A finite EWM seed or neutral carrier value can therefore be computable without being labeled measured. These masks describe conservative availability, not EWM convergence. Option snapshots require 96 completed bars for a 48-bar maximum horizon; 60–95 bars return unavailable context with canonical bars-needed metadata instead of silently presenting startup-heavy evidence. The older `maturity`/warm-up keys remain compatibility aliases only.

Each analysis also emits a canonical formula/settings recipe hash, a full-precision
normalized OHLCV input hash, and a combined analysis hash. These identities let
two reports prove whether they used the same declared computation and rows. They
do not certify provider truth, immutability, or exchange-session completion.

## Relative Field Pair v1

Relative Field Pair v1 is a deterministic descriptive comparison of two
independently constructed Market Fields under one declared recipe. For target
`A`, benchmark `B`, and coordinate `j`, its native difference is

```text
native_difference_j(t) = X_Aj(t) - X_Bj(t)
```

when both coordinate observations are finite, source-observed, and fully
dependency-supported. “Native” means the coordinate's implemented 15D scale,
not raw market units. In particular, the three carrier coordinates are bounded
causal-baseline relative levels rather than raw realized variation, volume, or
impact. Proper-fit-relative comparison uses each instrument's
own frozen fit reference:

```text
Z_Aj(t) = (X_Aj(t) - median_fit,A,j) / robust_scale_fit,A,j
Z_Bj(t) = (X_Bj(t) - median_fit,B,j) / robust_scale_fit,B,j
context_difference_j(t) = Z_Aj(t) - Z_Bj(t)
```

The context trace is emitted only on the intersection of the two evaluation
segments. Fit and held-out calibration observations are not backfilled with
later reference statistics and a zero or unavailable robust scale remains
unavailable. Consequently, the context trace is non-anticipative with respect
to the displayed evaluation interval but still conditional on each request's
fixed proper-fit sample; changing the requested history can change it.

Relative price progress is a separate economic description, normalized to 100
at the first aligned full-precision normalized close; it does not reuse the
four-decimal display serialization. Beta-adjusted log-return differentials
begin only after 20 prior aligned returns are available; each benchmark beta is
an intercept-inclusive covariance/variance slope estimated from at most the 60
strictly prior returns. The displayed differential does not subtract the fitted
intercept and is not an OLS residual or alpha. The estimate is unavailable when
the benchmark's population return standard deviation is below `1e-7`, is
nonfinite, or has absolute value above 25. Rejected estimates are not clipped
or carried forward: that row's differential is unavailable, the cumulative
beta-adjusted chain resets, and a later valid estimate begins a new chain. The
current beta/return summary reports only the latest aligned row and therefore
remains unavailable whenever that row's beta is unavailable. Neither price
progress nor a field-coordinate difference changes a Form, declares one
instrument “better,” or makes higher disorder, propagation, volatility,
participation, or liquidity stress desirable.

The pair service aligns daily and weekly observations by the serialized market
session date; it does not independently certify exchange calendars or
timezones. For intraday source timestamps that retain timezone information,
the service normalizes both sides to UTC and requires exact equality. When a
provider/cache timestamp is timezone-naive, the service instead requires an
exact match of the serialized naive timestamp and does not relabel it as UTC.
There is no nearest-neighbor match or forward fill, and nonidentity pairs keep
session compatibility `unknown` even when timestamps match. The live endpoint
uses provider/cache rows as returned and does not independently certify its
latest bar as exchange-complete. Incompatible
bar anchors remain unavailable and the response reports common observations,
dropped observations, latest shared timestamp, and the alignment rule. The
canonical `DXY` selector resolves to Yahoo's `DX-Y.NYB` index symbol and that
provider alias remains explicit in provenance; `UUP` is not silently
substituted. Provider, currency, adjustment, session, and forming-bar
differences can still limit comparability.

The compact fit-relative stretch label uses the same supported coordinate
intersection at the latest bar and five bars earlier. It first averages
absolute context gaps within each of the three coordinate families, then
averages those three family values. A change within
`max(0.05, 5% × earlier_stretch)` is labeled `mixed`; missing family coverage
makes the label unavailable.

Every pair receipt contains the two component analysis hashes and an ordered
comparison hash over target, benchmark, alignment, and normalization
contracts. Swapping target and benchmark therefore changes the hash and
reverses signed differences. Form IDs and centroids are never paired: a
request-local `F.001` for one instrument has no identity relationship to
`F.001` for another.

Pair v1 is display and research instrumentation only. It has zero direct
scanner weight, is excluded from the outcome-learning canary, and cannot
create eligibility, impose a veto, change a manager verdict or target size, or
execute a trade. Basket fields, cross-sectional peer ranks, persistent
cross-symbol Forms, cross-timeframe fusion, connectedness, and economic value
remain future research.

Field EWMs use the production-pinned pandas 2.2.3 convention `adjust=False`, `ignore_na=False`, and `min_periods=0`. Fully observed rows follow the standard recursive form. Masked carrier gaps retain absolute-position decay; missing observations are neither zeros nor removed from the time axis.

The option payload also carries an authority contract. The current Market Field snapshot has no direct scanner-rank, hard-veto, manager-verdict, target-size, or execution authority. It may advise displayed assessment confidence and review priority; higher advisory urgency can recompute the next human review date, so it is directly shadowed but still behaviorally visible. A separately versioned outcome-learning canary may use historical point-in-time Market Field cohorts alongside four other learning families; all families together are capped at 10% of applied scanner score, and per-family score/rank attribution is emitted. Alignment uses signed delta when supplied, otherwise explicit action plus option type, otherwise a labeled legacy long-single-leg assumption; unsupported exposure abstains. Outcome cohorts retain revision, initialization, alignment, and input-quality metadata. Complete stored v1.1/v1.2 snapshots remain comparable without relabeling; new v1.3 snapshots require canonical minimum-input and initialization-target coverage. Legacy, incomplete, or directionally unsupported snapshots are excluded from named state cohorts.

Successful finalization of completed, stopped, or errored scanner runs freezes
an append-only candidate/rank snapshot with display, champion, counterfactual,
and applied order plus canonical hashes. Stale runs, runs predating the schema,
and any run whose finalization fails remain explicitly unsnapshotted; GET
requests never manufacture a receipt. Authenticated ranking-rendered,
candidate-visible, and detail-open browser impressions reference a frozen
receipt. Collection starts at the rank/exposure-schema deployment boundary,
which is independent of a candidate's Market Field semantic revision; earlier
exposure is not recoverable.

Stored event snapshots that predate `semantic_revision` remain labeled `1.0` when read. They receive safe display fallbacks for authority, initialization aliases, and alignment, but are not silently promoted into a current outcome cohort.

## Forms and resonance

Up to five prototypes are learned from the proper fit interval before the held-out calibration interval and the evaluation history. Candidate codebooks require at least 20 bars and 5% of fit history per Form, distinct quantized identities, and mean fit silhouette of at least `0.25`. The most separated supported candidate is selected, with one Form as the honest fallback; a flat or weakly separated field therefore does not manufacture five labels. For prototype `lambda_k`, family-balanced distance is

```text
D_k(t)^2 = sum_j w_j * (Z_j(t) - lambda_kj)^2
Form(t) = argmin_k D_k(t)
```

Nearest-Form distance is the primary measurement. `resonance_index` (legacy alias `match`) is an uncalibrated bounded transform of that distance, not a probability. `novelty` measures how far distance lies beyond the held-out calibration distribution's median toward its 95th percentile. The calibration check uses a state-conditional chronological held-out empirical upper-tail rank:

```text
tail_score(x | Form k) = (1 + count(D_cal,k >= D(x,k))) / (n_cal,k + 1)
```

The rank is available only when the later held-out calibration segment contains at least 20 bars assigned to the same Form. Below that support floor, calibration evidence is unavailable rather than inferred. When the rank is below `0.05`, the observation is still assigned to its nearest Form for bookkeeping, but its historical analog is withheld as an **extreme calibration-distance tail**. Legacy `distance_tail_score` and `outside_learned_range` fields remain exact compatibility aliases.

This is an empirical chronological rank, not a conformal p-value. Overlapping, autocorrelated, and nonstationary market bars are not exchangeable, so the `0.05` cutoff has no exact false-alert or coverage guarantee. It is a descriptive calibration-distance rule that must be evaluated by symbol, timeframe, and fitting window.

The spoken token and `lx1` signature are hashes of a coarsely quantized prototype. They have no bullish or bearish semantics. In version 0.1 they are native to the selected rolling window, not durable global identities.

## Grounded translation

The website does not expose a hash token as if it were a market diagnosis. A learned Form is named from its measured centroid and its robust deviation from the proper-fit baseline:

```text
relative_feature_j(Form k)
  = (centroid_kj - fit_median(X_j)) / fit_robust_scale(X_j)
```

The interface leads with directional pressure and its change, then identifies the most distinctive interpretable characteristic—such as lower realized volatility, higher trend agreement, or lower participation—relative to the proper fit segment. Learned states keep a stable order inside one analysis for traceability. Forward returns never affect this description.

The primary Dictionary uses explicit quantities:

- directional pressure and pressure change on bounded signed scales;
- directional activity, horizon agreement, their legacy weighted composite, reorganization, boundary activity, disorder, and propagation on bounded field indices. A flat coherent field anchors the composite at `0.42` and the legacy renderer score at `0.68`; neither is standalone evidence of an active organized trend;
- propagation direction on the signed log-horizon axis;
- realized volatility, volume participation, and liquidity stress as direct multiples on Now and as proper-fit-relative state features in Dictionary. Each available direct multiple is the arithmetic mean across configured horizons of the current measure divided by its causal EWM baseline, which includes the current observation; `1.0×` means equal to baseline and output is capped at `10.0×`. Invalid or missing volume remains missing rather than becoming zero participation. Rolling carrier inputs use available observations, and direct participation or impact is unavailable when its current rolling support is absent. Neutral `0.5` internal levels only keep retrospective clustering finite and are never displayed as measured `1.0×` signals.

When the supported held-out calibration-distance rank is below the cutoff, the current historical analog is **withheld for an extreme calibration-distance tail**. The nearest Form remains bookkeeping context, not the headline. Resonance and novelty remain distance transforms; the primary interface does not present them as probabilities.

## Motion grammar

The run-collapsed proper-fit sequence teaches an exit grammar: persistence is measured separately, and only changes from one Form into a different Form count as Motions. With additive smoothing `alpha` over non-self destinations:

```text
Gamma(i,j) = 0                                      when i = j
Gamma(i,j) = (exit_count_fit(i -> j) + alpha)
             / sum_(q != i) (exit_count_fit(i -> q) + alpha)
```

The information carried by an observed motion is its transition surprise:

```text
Surprise(t) = -log Gamma(Form(t-1), Form(t))
```

Expected motions have low surprise. Rare grammatical breaks have high surprise. A likely Motion is withheld unless one destination is uniquely dominant and the source Form has at least five observed exits; lower-support rows remain unresolved. This is a property of the learned field language, not a directional trade score.

## Phrases

Consecutive repeats of one form are collapsed into a single run. Repeated two-, three-, and four-form sequences in the visible evaluation segment become candidate phrases. The system records support, typical duration, whether the phrase is currently active, and forward outcomes beginning on entry into the final Form—the first bar when the Phrase can be recognized without looking ahead to that Form's eventual exit.

Those outcomes are annotations only. They are not used to choose prototypes, fit the grammar, or select phrases. Form outcomes sample every assigned bar, and Phrase windows can overlap, so observations are serially dependent and are not corrected for search. They remain hypotheses until they recur across symbols, timeframes, and later untouched samples.

## Experimental Fieldmark grammar

One prototype generates the same visual mark everywhere. This experimental encoding uses redundant shape rather than color alone:

- spine orientation: pressure direction;
- core size: pressure magnitude;
- shell count and radius: structure;
- facet count: geometry;
- halo width: kinematics;
- edge texture: information disorder;
- trail count and length: propagation;
- tail tilt: cascade bias;
- solid versus broken boundary: match;
- detached outer ring: novelty.

These marks are retained only as a research encoding. The default Now and Dictionary views use price and state history, proper-fit-relative feature bars, direct state durations, raw transition counts, and holdout sample sizes. Methods exposes the formulas and evidence boundary.

## Leakage boundary

The implementation preserves a strict chronology:

1. carrier warm-up is excluded when the fetched history is long enough;
2. robust scaling, prototypes, and exit probabilities use the proper-fit bars only; the later calibration slice is reserved for the distance-tail reference;
3. evaluation bars are assigned against the frozen codebook, and API syntax is cropped and rebased to the visible response window;
4. forward five-bar returns are calculated only after assignment or Phrase detection;
5. outcomes never change Form identity or Motion probability;
6. pair-native differences require shared supported observations under one
   recipe, while pair-context differences begin only after both frozen
   proper-fit and calibration partitions;
7. pair residual returns use only prior aligned returns to estimate beta, and
   neither pair output refits either component field.

This makes the language inspectable, but not validated as a trading system. The next major version should persist append-only forms across analyses, reconcile similar prototypes without renaming prior forms, and test a global Climate layer on untouched symbols and later dates.
