# Market Field Language

Status: experimental language version `0.1.0`

The Market Field Language is a machine-native description of recurring market-field geometry. It is deliberately learned without forward returns. Price outcomes are attached only after a form or phrase has been discovered, so the language describes what the field is doing before anyone decides what it might mean.

The interface is a translation layer. Numeric forms, motions, and phrases are canonical inside one analysis; plain-English labels are optional interpretations. Version 0.1 does not yet reconcile identities across separate runs.

## Vocabulary

- **Atom**: one robust-normalized field measurement.
- **Form**: a learned prototype of the complete field state. The API exposes between one and five supported forms as `F.001` through at most `F.005`, each with a nonsemantic spoken token.
- **Fieldmark**: the canonical glyph generated from a form's prototype.
- **Motion**: a directed transition from one form to another.
- **Phrase**: a recurring run-collapsed sequence of two to four forms.
- **Unknown**: an observation far enough from every calibrated form to carry high novelty.
- **Climate**: a future persistent distribution of phrases across symbols and windows. It is not implemented in version 0.1.

## State space

At bar `t`, the system constructs a state vector

```text
X(t) = [P, dP, d2P, d3P, d4P, S, K, G, I, R, C, A, V, Q, L]
```

where `P` is aggregate field pressure; the next four terms are its derivatives; `S, K, G, I, R` are structure, kinematics, geometry, information, and propagation strata; `C` is cascade bias; `A` is the local scaling exponent; and `V, Q, L` are volatility, participation, and liquidity-stress carriers.

The carrier baselines need up to twice the longest horizon. That warm-up is excluded before fitting whenever enough history is available; a clipped warm-up is reported as provisional. Every feature is then centered and scaled using only the chronological calibration segment:

```text
Z_j(t) = (X_j(t) - median_cal(X_j)) / robust_scale_cal(X_j)
```

Correlated measurements do not get extra voting power merely because there are more of them. Features are divided into three families—pressure/state, transformed field, and OHLCV carriers—and each family receives one third of the total distance weight.

## Forms and resonance

Up to five prototypes are learned from the post-warm-up calibration interval ending at 60% of the buffered analysis history. The richest codebook is accepted only when every Form has minimum support and a distinct quantized identity; a flat field therefore produces one Form, not five artificial labels. For prototype `lambda_k`, family-balanced distance is

```text
D_k(t)^2 = sum_j w_j * (Z_j(t) - lambda_kj)^2
Form(t) = argmin_k D_k(t)
```

`match` is an uncalibrated bounded resonance index derived from nearest-prototype distance, not a probability. `novelty` measures how far that distance lies beyond the calibration distribution's median toward its 95th percentile. A high-novelty observation is still assigned to its nearest form, but the interface marks it as an Unknown rather than pretending the fit is familiar.

The spoken token and `lx1` signature are hashes of a coarsely quantized prototype. They have no bullish or bearish semantics. In version 0.1 they are native to the selected rolling window, not durable global identities.

## Motion grammar

The run-collapsed calibration sequence teaches an exit grammar: persistence is measured separately, and only changes from one Form into a different Form count as Motions. With additive smoothing `alpha` over non-self destinations:

```text
Gamma(i,j) = 0                                      when i = j
Gamma(i,j) = (exit_count_cal(i -> j) + alpha)
             / sum_(q != i) (exit_count_cal(i -> q) + alpha)
```

The information carried by an observed motion is its transition surprise:

```text
Surprise(t) = -log Gamma(Form(t-1), Form(t))
```

Expected motions have low surprise. Rare grammatical breaks have high surprise. A likely Motion is withheld unless one destination is uniquely dominant and the source Form has at least five observed exits; lower-support rows remain unresolved. This is a property of the learned field language, not a directional trade score.

## Phrases

Consecutive repeats of one form are collapsed into a single run. Repeated two-, three-, and four-form sequences in the visible evaluation segment become candidate phrases. The system records support, typical duration, whether the phrase is currently active, and forward outcomes beginning on entry into the final Form—the first bar when the Phrase can be recognized without looking ahead to that Form's eventual exit.

Those outcomes are annotations only. They are not used to choose prototypes, fit the grammar, or select phrases. Form outcomes sample every assigned bar, and Phrase windows can overlap, so observations are serially dependent and are not corrected for search. They remain hypotheses until they recur across symbols, timeframes, and later untouched samples.

## Fieldmark grammar

One prototype must generate the same visual mark everywhere. The current encoding uses redundant shape rather than color alone:

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

The syntax ribbon then becomes a sentence: width is duration, adjacent Fieldmarks are motions, seam intensity is surprise, and the lower lane is novelty. The Dictionary is the learned codebook; Translate exposes a human paraphrase; Audit exposes the measurements and evidence behind it.

## Leakage boundary

The implementation preserves a strict chronology:

1. carrier warm-up is excluded when the fetched history is long enough;
2. robust scaling, prototypes, and exit probabilities use calibration bars only;
3. evaluation bars are assigned against the frozen codebook, and API syntax is cropped and rebased to the visible response window;
4. forward five-bar returns are calculated only after assignment or Phrase detection;
5. outcomes never change Form identity or Motion probability.

This makes the language inspectable, but not validated as a trading system. The next major version should persist append-only forms across analyses, reconcile similar prototypes without renaming prior forms, and test a global Climate layer on untouched symbols and later dates.
