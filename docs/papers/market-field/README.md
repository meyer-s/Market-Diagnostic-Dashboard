# Market Field working paper

This directory is a self-contained ICLR 2026-formatted research package for:

> Causal Market Field Calculus: An Auditable Multiscale Representation for
> Option-Path Decision Support

Status: preliminary systems and methods paper, as of 2026-07-21. The evidence
validates representation mechanics and software boundaries. It does not claim
forecast skill, profitable trading, arbitrage, or a physical market law.

## Shareable artifacts

- market-field-calculus-working-paper.pdf: descriptively named copy for direct
  sharing.
- share.pdf: named-author build target for the same working paper.
- main.pdf: anonymous conference-review version.
- main.tex and references.bib: paper source and bibliography.
- market_field_reproducibility.ipynb: executed companion notebook.
- figures, tables, and results: generated evidence used by the paper.
- supplement: broader nine-timeframe, resolution, window-stability, and live
  boundary audit with an executed notebook.

The official ICLR 2026 style and bibliography files are included unchanged from
the conference template. The main paper ends on page 7; references begin on
page 7 and the appendix begins on page 9. This is within the conference's
nine-page main-text limit, which excludes references and appendices.

## Rebuild

Run commands from the repository root with the repository virtual environment:

~~~powershell
.\.venv\Scripts\python.exe docs\papers\market-field\scripts\generate_assets.py --offline
.\.venv\Scripts\python.exe docs\papers\market-field\scripts\build_notebook.py --execute
~~~

Use --refresh instead of --offline to retrieve a fresh adjusted Yahoo Finance
snapshot. A refresh can change provider-revised history and therefore the
reported hashes and results.

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
- Implementation snapshot used for the first paper run:
  cd67fb48c1ee747fb8b447bc9d59fb8eaf7ec430
- Primary data: Yahoo Finance through yfinance 1.1.0 with auto_adjust=True.
- Sample: SPY, QQQ, IWM, TLT, GLD, USO, VNQ, and BTC-USD.
- Requested range: 2018-01-01 through 2026-07-21 inclusive.
- Canonical input hashes and actual coverage:
  results/validation_summary.json.
- Raw provider cache: cache; excluded from Git.

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
- The distance-tail statistic is descriptive, not a formal p-value or coverage
  guarantee.
- The option integration is shadow-only, has ranking weight zero, and cannot
  execute trades.

## Directory map

- scripts/generate_assets.py: cache-first empirical audit and figure/table
  generation.
- scripts/build_notebook.py: notebook construction and top-to-bottom execution.
- results/asset_summary.csv: asset-level dictionary and tail diagnostics.
- results/validation_summary.json: source manifest, diagnostics, synthetic
  controls, and local benchmark.
- docs/market-field-language.md at repository root: living implementation
  methodology.
- IMPLEMENTATION_MAP.md: paper claims mapped to production modules.
- supplement/PRELIMINARY_EVALUATION.md: independent broader audit narrative.
