# Market Field prequential evaluation scaffold

This package implements the parts of the paper's planned economic-evaluation
method that can be audited today with retained adjusted OHLCV. It is a
**retrospective development dry run**, not a preregistration, untouched
holdout, forecast-performance result, trading study, or options-economics
evaluation.

## What is implemented

- Expanding rolling origins with a 20-bar purge before calibration and a
  20-bar embargo before each scored origin.
- Fit-only robust scaling and model fitting, later calibration of descriptive
  90% residual bands, and origin-only evaluation every 20 bars.
- Future-only 1-, 5-, and 20-bar forward return, realized variation, and
  pressure-aligned maximum-adverse-excursion definitions.
- Zero and fit-mean naive references, an EMA-only ridge, the paper's causal
  five-coordinate technical ridge, a fixed causal two-window
  location/scale/range/volume break-score ridge, a fit-only two-state
  diagonal-Gaussian HMM, a fit-only Market Field dictionary, the raw
  15-dimensional ridge, and three leave-one-family-out raw-vector ablations.
- Exact pending/unsupported/scored case accounting.
- Seeded IID-random-walk, AR(1), alternating-return, volatility-shift, and
  missing-volume construction checks, kept separate from outcomes.
- Dataset-local paired stationary-bootstrap intervals and centered diagnostic
  p-values for absolute-error differences versus the technical baseline.
- Benjamini--Hochberg and Holm metadata. Both are reported for auditability;
  no decision threshold is active and every row is `decision_eligible=false`.
- A deterministic-core receipt binding the protocol, retained inputs, source
  files, and generated artifacts.

The runner deliberately does not fetch data. It fails if any retained cache
row count, date, or canonical OHLCV hash differs from `protocol_v0.json`.

## Run

From the repository root:

```powershell
.\.venv\Scripts\python.exe docs\papers\market-field\evaluation\evaluate_prequential.py
```

Focused tests:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests\test_market_field_prequential_evaluation.py -q
```

Generated files live under `results/`:

- `input_manifest.csv`
- `split_audit.csv`
- `development_predictions.csv.gz`
- `development_metric_summary.csv`
- `unsupported_case_accounting.csv`
- `paired_bootstrap_and_multiplicity.csv`
- `synthetic_reference_checks.csv`
- `summary.json`
- `run_receipt.json`

The compressed prediction ledger is bounded by the protocol and contains every
scheduled model/outcome/origin case. Summary tables are derived from that
ledger rather than filtering unsupported rows before denominators are formed.

The HMM is a transparent cap-truncated development comparator. Every origin
reached the protocol's eight-iteration maximum and produced finite, fully
accounted predictions, but none satisfied the source-fixed `1e-6` relative
stopping tolerance. It must not be described as a converged latent-state
result.

## Chronology

For origin \(o\), the default chronology is:

1. 128 bars are excluded as feature initialization context.
2. The expanding proper-fit segment contains at least 504 bars.
3. A 20-bar gap prevents the maximum forward label in proper fit from reaching
   calibration.
4. Calibration contains 252 bars.
5. A second 20-bar gap prevents calibration labels from reaching the origin.
6. One completed origin is scored; the next origin is 20 bars later.

No outcome, interval, state outcome mean, scale, or coefficient from a later
segment is used to fit an earlier segment. Calibration residuals set the
descriptive interval radius only; they do not tune models.

## Outcome conventions

For adjusted close \(C\), high \(H\), low \(L\), pressure sign \(s_t\), and
horizon \(h\):

- Forward return is \(C_{t+h}/C_t-1\).
- Forward realized variation is the square root of the sum of squared
  close-to-close log returns from \(t+1\) through \(t+h\).
- For positive pressure, adverse excursion is the minimum future
  \(L/C_t-1\). For negative pressure it is the minimum future
  \(1-H/C_t\). A zero or unavailable direction is unscored.

Outcomes are unannualized and bar-native. Datasets are never pooled into one
inferential estimate; BTC daily bars and US-session daily bars therefore
remain separate results.

## Claim and holdout boundary

The retained histories end on 2026-07-21 and have already informed system and
paper development. Their outputs can validate code paths and expose design
fragility, but cannot be described as untouched evidence.

`protocol_v0.json` reserves completed observations no earlier than 2026-07-27
for a separately receipted prospective study. This package does not download,
inspect, or evaluate that holdout. A future options study additionally needs
timestamped executable quotes, spreads, costs, stale-quote handling,
exercise/assignment conventions, and normalized exposures; OHLCV cannot
substitute for those inputs.

Wavelet/scattering and persistent-homology baselines remain future work. The
current dependency set does not identify a canonical transform, scale bank, or
boundary convention, and adding an arbitrary hand-built transform to an
already-inspected sample would enlarge the development search rather than
create a defensible comparator. IV and cross-market connectedness baselines
likewise require point-in-time inputs and vintage rules that these retained
single-symbol OHLCV files do not supply.
