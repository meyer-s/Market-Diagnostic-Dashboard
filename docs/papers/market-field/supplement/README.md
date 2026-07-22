# Market Field preliminary evaluation

This directory is a frozen, reproducible engineering and descriptive-empirical audit of the repository's Market Field implementation. It is suitable as preliminary evidence for a paper appendix, but it does **not** evaluate forecast skill, trading performance, statistical discovery, or economic value.

## Reproduce

From the repository root, using the repository virtual environment:

```powershell
.\.venv\Scripts\python.exe docs\papers\market-field\supplement\evaluate_market_field.py
.\.venv\Scripts\python.exe docs\papers\market-field\supplement\build_notebook.py
```

The default evaluation uses the checked-in frozen snapshot. It does not contact Yahoo. To create a new snapshot intentionally:

```powershell
.\.venv\Scripts\python.exe docs\papers\market-field\supplement\evaluate_market_field.py --force-fetch
```

`data/raw/manifest.json` records the observation time, provider, package versions, source hashes, repository commit, completion policy, per-file SHA-256 hashes, and exclusions. Re-fetching changes the experiment and should receive a new snapshot/version label before being compared with this run.

## Contents

- `evaluate_market_field.py`: deterministic evaluation harness and figure generator.
- `market_field_preliminary.ipynb`: executed, top-to-bottom notebook companion.
- `PRELIMINARY_EVALUATION.md`: result narrative, claim boundaries, and paper-ready table/figure plan.
- `data/raw/`: 15 frozen completed-bar OHLCV datasets plus their manifest.
- `results/`: machine-readable diagnostics, state sequence, shadow-boundary audit, and live endpoint probe.
- `figures/`: four paper-oriented diagnostic figures.
- `probe_live_endpoint.py`: operational probe of the deployed endpoint; this is not part of the frozen empirical experiment.

## Dependency snapshot

The run recorded Python 3.13.14, NumPy 2.4.2, pandas 3.0.0, yfinance 1.1.0, and Matplotlib 3.11.1. The implementation itself is imported from `backend/app/services`; the source hashes in the manifest are the authoritative link to the exact code evaluated.

## Interpretation guardrail

The evaluation supports statements about causal prefix behavior, repeatability, numerical sensitivity, descriptive cross-timeframe behavior, lexicon calibration diagnostics, and the option-integration safety boundary. It cannot support a claim that any state forecasts returns or that the system improves an options strategy.
