# Market Field Language

Status: experimental language version `0.1.0`

The Market Field Language is a machine-native description of recurring market-field geometry. It is deliberately learned without forward returns. Price outcomes are attached only after a form or phrase has been discovered, so the language describes what the field is doing before anyone decides what it might mean.

The interface is a translation layer. Numeric forms, motions, and phrases are canonical inside one analysis, but the primary interface always translates them into measured quantities, proper-fit-relative descriptions, support counts, and observed outcomes. Nonsemantic machine tokens are audit metadata, not user-facing state names. Version 0.1 does not yet reconcile identities across separate runs.

## Vocabulary

- **Atom**: one robust-normalized field measurement.
- **Form**: a learned prototype of the complete field state. The API exposes between one and five supported forms as `F.001` through at most `F.005`, each with a nonsemantic spoken token.
- **Fieldmark**: an experimental glyph generated from a form's prototype. It is no longer the primary explanation because its visual thresholds are not empirical units.
- **Motion**: a directed transition from one form to another.
- **Phrase**: a recurring run-collapsed sequence of two to four forms.
- **Outside learned range**: an observation whose same-state distance-tail score is below the documented cutoff on an independent chronological calibration slice.
- **Climate**: a future persistent distribution of phrases across symbols and windows. It is not implemented in version 0.1.

## State space

At bar `t`, the system constructs a state vector

```text
X(t) = [P, dP, d2P, d3P, d4P, S, K, G, I, R, C, A, V, Q, L]
```

where `P` is aggregate field pressure; the next four terms are its derivatives; `S, K, G, I, R` are structure, kinematics, geometry, information, and propagation strata; `C` is cascade bias; `A` is the local scaling exponent; and `V, Q, L` are volatility, participation, and liquidity-stress carriers.

The carrier baselines need up to twice the longest horizon. That warm-up is excluded before fitting whenever enough history is available; a clipped warm-up is reported as provisional. The pre-evaluation history is then split chronologically into a proper fit segment and a later held-out calibration segment. Every feature is centered and scaled using the proper fit segment only:

```text
Z_j(t) = (X_j(t) - median_fit(X_j)) / robust_scale_fit(X_j)
```

Correlated measurements do not get extra voting power merely because there are more of them. Features are divided into three families—pressure/state, transformed field, and OHLCV carriers—and each family receives one third of the total distance weight.

## Forms and resonance

Up to five prototypes are learned from the proper fit interval before the held-out calibration interval and the evaluation history. Candidate codebooks require at least 20 bars and 5% of fit history per Form, distinct quantized identities, and mean fit silhouette of at least `0.25`. The most separated supported candidate is selected, with one Form as the honest fallback; a flat or weakly separated field therefore does not manufacture five labels. For prototype `lambda_k`, family-balanced distance is

```text
D_k(t)^2 = sum_j w_j * (Z_j(t) - lambda_kj)^2
Form(t) = argmin_k D_k(t)
```

`match` is an uncalibrated bounded resonance index derived from nearest-prototype distance, not a probability. `novelty` measures how far that distance lies beyond the held-out calibration distribution's median toward its 95th percentile. The learned-range decision uses a state-conditional chronological held-out empirical distance-tail score:

```text
tail_score(x | Form k) = (1 + count(D_cal,k >= D(x,k))) / (n_cal,k + 1)
```

The score is available only when the later held-out calibration segment contains at least 20 bars assigned to the same Form. Below that support floor, the score and learned-range decision are unavailable rather than inferred. When the score is below `0.05`, the observation is still assigned to its nearest Form for bookkeeping, but the interface says **outside the learned range** rather than pretending that assignment is familiar.

This is an empirical chronological rank, not a conformal p-value. Overlapping, autocorrelated, and nonstationary market bars are not exchangeable, so the `0.05` cutoff has no exact false-alert or coverage guarantee. It is a descriptive learned-range rule that must be backtested by symbol and timeframe.

The spoken token and `lx1` signature are hashes of a coarsely quantized prototype. They have no bullish or bearish semantics. In version 0.1 they are native to the selected rolling window, not durable global identities.

## Grounded translation

The website does not expose a hash token as if it were a market diagnosis. A learned Form is named from its measured centroid and its robust deviation from the proper-fit baseline:

```text
relative_feature_j(Form k)
  = (centroid_kj - median_fit(X_j)) / robust_scale_fit(X_j)
```

The interface leads with directional pressure and its change, then identifies the most distinctive interpretable characteristic—such as lower realized volatility, higher organization, or lower participation—relative to the proper fit segment. Learned states keep a stable order inside one analysis for traceability. Forward returns never affect this description.

The primary Dictionary uses explicit quantities:

- directional pressure and pressure change on bounded signed scales;
- organization, reorganization, boundary activity, disorder, and propagation on bounded field indices;
- propagation direction on the signed log-horizon axis;
- realized volatility, volume participation, and liquidity stress as direct multiples on Now and as proper-fit-relative state features in Dictionary. Each direct multiple is the arithmetic mean across configured horizons of the current measure divided by its causal EWM baseline, which includes the current bar; `1.0×` means equal to baseline and output is capped at `10.0×`. Participation and liquidity stress are explicitly unavailable when the source contains no positive volume observations.

When the supported held-out distance-tail score is below the cutoff, the current observation is described as **outside the learned range**. Its nearest Form may be shown as context, but it cannot become the headline. The older similarity and novelty transforms remain API audit fields; the primary interface does not present them as evidence.

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
5. outcomes never change Form identity or Motion probability.

This makes the language inspectable, but not validated as a trading system. The next major version should persist append-only forms across analyses, reconcile similar prototypes without renaming prior forms, and test a global Climate layer on untouched symbols and later dates.
