# Major-revision response map

This file maps the 13 major peer-review points to the research revision and the
subsequent backward-compatible v1.1 implementation. The manuscript specifies
the current formula model `market_field_calculus_v1`; `semantic_revision=1.1`
adds contracts and aliases without changing that vector, while the expanded
`market_field_preliminary_v2` evaluation harness is not a v2 field formula.
Disposition labels are **MC** (manuscript correction), **NE** (new evidence),
**PF** (production follow-up), and **DE** (deferred efficacy work).

| # | Review point | Research correction | Disposition after v1.1 |
|---|---|---|---|
| 1 | The field calculus did not reconstruct the 15-dimensional vector | Appendix A now gives the exact EWM recursion, numerical clip, nonuniform log-horizon stencils, temporal/scale normalization, reductions, carrier transforms, state vector, robust scaling, distance weights, and deterministic clustering rules. | **MC/PF complete; DE:** Production exposes semantic revision and applied settings. Exact raw-input reproduction still depends on locally retained data. |
| 2 | `h +/- 1` was invalid for the actual grid | The paper now indexes an ordered grid by row `j`, gives interior/edge kernels, and declares equal row adjacency to be a v1 model choice rather than a log-distance-invariant smoother. | **MC/DE:** A log-distance kernel is a versioned v2 ablation, not a manuscript-only change. |
| 3 | Zero denominators and domains were undefined | The paper now defines epsilon, first-bar true range, zero TR/path/difference/propagation/match cases, positive-close flooring, tight OHLC boundary tolerance, and masked volume formulas. Invalid volume is unavailable, rolling means use admissible observations, and zero volume makes its impact observation unavailable rather than zero. | **MC/PF complete:** Production validates finite positive and internally consistent OHLC, reports rejected rows and volume coverage, and distinguishes unavailable direct ratios from the internal neutral clustering fill. |
| 4 | Minimum history conflicted with long horizons | The paper documents hidden prefetch, startup, carrier span, and missing maturity masks. A new truncation audit shows median/p90 IQR-normalized error falling from 0.501/2.009 at 60 bars to approximately 0/0.003 at 365. | **MC/NE/PF complete; DE:** History metadata is returned and option availability now requires 96 completed bars. Per-coordinate masks and convergence studies remain future work. |
| 5 | Flat fields had counterintuitive Structure/organization baselines | The exact synthetic null anchor (Structure 0.42, legacy display organization 0.68) is now reported, and the structure-information scope is distinguished from `O`. | **MC/NE/PF complete; DE:** Activity, agreement, composite, and flat anchors are now separate response/UI concepts. Gated Structure is a versioned ablation. |
| 6 | Scaling exponent lacked a reference baseline | The paper now specifies epsilon, stencil, reduction, the ordinary 0.5 reference, and interpretations of values near 0, 1, and negative numerical estimates. | **MC/NE/PF complete; DE:** Response/UI expose reference, excess, and degenerate validity. More synthetic reference-process tests remain deferred. |
| 7 | Permutation-entropy wording and startup were wrong | The revision states six possible patterns and all startup/tie/reduction conventions. A new 8/12/48/96-versus-24 sensitivity audit finds material window dependence. | **MC/NE/PF complete:** Maturity is exposed and the fixed 24-instance v1 window is explicitly versioned and documented. |
| 8 | Calibration-distance language overstated support | The paper replaces substantive “outside learned range” language with “upper state-conditional calibration-distance tail,” explains discrete ranks, reports unsupported observations separately, emphasizes asset/window instability, and specifies the match denominator. | **MC/PF complete; DE:** Canonical names and analog status were added while legacy keys remain aliases; no efficacy or coverage guarantee is claimed. |
| 9 | “Causal” lacked a formal definition and tests were overstated | The title now uses “Non-Anticipative”; Proposition 1 formalizes prefix-only live computation. A new audit passes 46/46 prefixes and 24,472 full-precision live values at tolerance `1e-12`; the original 32/6,688 serialized audit is still described accurately. | **MC/NE/PF:** Extend coverage to maturity metadata, hypotheses, lexicon fields, and complete option snapshots; this is not causal inference. |
| 10 | Figure reference and 540-count statements were wrong | The asset sentence now references the tail-rate figure. Step 4 is reported as 180 pairs; 540 is reserved for all three nonreference grids. | **MC/NE:** The comparison-count artifact independently records 180 pairs per step. |
| 11 | Codebook rhetoric and attribution were too strong | The revision gives metric/family/support/silhouette-conditioned wording, enumerates candidate selection and tie handling, and separately cites k-means and farthest-point initialization. | **MC/DE:** Comparative clustering and continuous-vector baselines belong to efficacy work. |
| 12 | Option and latency safeguards were overstated | The paper separates algorithmic authority from human influence, narrows side alignment, specifies recurrence and pressure-aligned exhaustion velocity, and points to run-receipted latency/payload artifacts instead of treating volatile point estimates as a contract. It also states that advisory urgency can recompute the next-review date. | **MC/NE/PF partial; DE:** Authority, action/delta alignment, applied-effect metadata, scanner-score checks, and manager verdict/target-size comparisons shipped. A complete eligibility-through-execution metamorphic proof, impression-level exposure logging, and cold/concurrent/SLA testing remain deferred. |
| 13 | Attribution and multiplicity language needed audit | Kaufman, Wilder, Gonzalez, Hubert--Arabie, and purge/embargo references were added. Benjamini--Hochberg is identified as FDR rather than family-wise control. | **MC:** A final human bibliographic audit remains required. |

## Evidence boundary

The revision preserves the existing efficacy boundary while extending the
engineering audit with full-precision prefix, truncation, maturity, entropy,
null-anchor, resolution-count, and latency diagnostics. Forecast value, option
profitability, comparative advantage, and
production service levels remain deferred until the corresponding preregistered,
cost-aware, dependence-aware experiments exist.

The v1.1 program revision is additive: existing schema/model IDs and legacy
fields remain readable, while `semantic_revision`, history/input quality,
calibration-distance aliases, option authority, alignment, maturity, and
applied-effect metadata make the reviewed boundaries machine-readable. The
supplementary v2 harness expands audits and receipts; it does not change the v1
field formula.
