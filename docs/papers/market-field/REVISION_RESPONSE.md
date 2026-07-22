# Major-revision response map

This file maps the 13 major peer-review points to the research revision and the
backward-compatible semantic closeout through v1.2. The manuscript specifies
the current formula model `market_field_calculus_v1`; `semantic_revision=1.2`
adds contracts and aliases without changing that vector, while legacy 1.0/1.1
payloads remain immutable and readable and the expanded
`market_field_preliminary_v2` evaluation harness is not a v2 field formula.
Disposition labels are **MC** (manuscript correction), **NE** (new evidence),
**PF** (production follow-up), and **DE** (deferred efficacy work).

| # | Review point | Research correction | Disposition after v1.2 |
|---|---|---|---|
| 1 | The field calculus did not reconstruct the 15-dimensional vector | Appendix A now gives the exact EWM recursion, numerical clip, nonuniform log-horizon stencils, temporal/scale normalization, reductions, carrier transforms, state vector, robust scaling, distance weights, and deterministic clustering rules. | **MC/PF complete; DE:** Production exposes semantic revision and applied settings. Exact raw-input reproduction still depends on locally retained data. |
| 2 | `h +/- 1` was invalid for the actual grid | The paper now indexes an ordered grid by row `j`, gives interior/edge kernels, and declares equal row adjacency to be a v1 model choice rather than a log-distance-invariant smoother. | **MC/DE:** A log-distance kernel is a versioned v2 ablation, not a manuscript-only change. |
| 3 | Zero denominators and domains were undefined | The paper now defines epsilon, first-bar true range, zero TR/path/difference/propagation/match cases, positive-close flooring, tight OHLC boundary tolerance, and masked volume formulas. Invalid volume is unavailable, rolling means use admissible observations, and zero volume makes its impact observation unavailable rather than zero. | **MC/PF complete:** Production validates finite positive and internally consistent OHLC, reports rejected rows and volume coverage, and distinguishes unavailable direct ratios from the internal neutral clustering fill. |
| 4 | Minimum history conflicted with long horizons | The paper documents hidden prefetch, startup, carrier span, and missing per-coordinate initialization-coverage masks. A new truncation audit shows median/p90 IQR-normalized error falling from 0.501/2.009 at 60 bars to approximately 0/0.003 at 365. | **MC/NE/PF complete; DE:** Minimum-input/initialization-coverage metadata is returned and option availability now requires 96 completed bars. Per-coordinate masks and convergence studies remain future work; `maturity` is only a legacy serialized alias. |
| 5 | Flat fields had counterintuitive Structure/organization baselines | The exact synthetic null anchor (Structure 0.42, legacy display organization 0.68) is now reported, and the structure-information scope is distinguished from `O`. | **MC/NE/PF complete; DE:** Activity, agreement, composite, and flat anchors are now separate response/UI concepts. Gated Structure is a versioned ablation. |
| 6 | Scaling exponent lacked a reference baseline | The paper now specifies epsilon, stencil, reduction, the ordinary 0.5 reference, interpretations near 0 and 1, and the exact nonnegativity invariant; a materially negative value is a quality failure, not a state. | **MC/NE/PF complete; DE:** Response/UI expose reference, excess, and degenerate validity. More synthetic reference-process tests remain deferred. |
| 7 | Permutation-entropy wording and startup were wrong | The revision states six possible patterns and all startup/tie/reduction conventions. A new 8/12/48/96-versus-24 sensitivity audit finds material window dependence. | **MC/NE/PF complete:** Initialization coverage is exposed and the fixed 24-instance v1 window is explicitly versioned and documented. |
| 8 | Calibration-distance language overstated support | The paper replaces substantive “outside learned range” language with “upper state-conditional calibration-distance tail,” explains discrete ranks, reports unsupported observations separately, emphasizes asset/window instability, and specifies the match denominator. | **MC/PF complete; DE:** Canonical names and analog status were added while legacy keys remain aliases; no efficacy or coverage guarantee is claimed. |
| 9 | “Causal” lacked a formal definition and tests were overstated | The title now uses “Non-Anticipative”; Proposition 1 formalizes prefix-only live computation. A new audit passes 46/46 prefixes and 24,472 full-precision live values at tolerance `1e-12`; the original 32/6,688 serialized audit is still described accurately. | **MC/NE/PF:** Extend coverage to minimum-input/initialization-coverage metadata, hypotheses, lexicon fields, and complete option snapshots; this is not causal inference. |
| 10 | Figure reference and 540-count statements were wrong | The asset sentence now references the tail-rate figure. Step 4 is reported as 180 pairs; 540 is reserved for all three nonreference grids. | **MC/NE:** The comparison-count artifact independently records 180 pairs per step. |
| 11 | Codebook rhetoric and attribution were too strong | The revision gives metric/family/support/silhouette-conditioned wording, enumerates candidate selection and tie handling, and separately cites k-means and farthest-point initialization. | **MC/DE:** Comparative clustering and continuous-vector baselines belong to efficacy work. |
| 12 | Option and latency safeguards were overstated | The paper separates algorithmic authority from human influence, narrows side alignment, specifies recurrence and pressure-aligned exhaustion velocity, and points to run-receipted latency/payload artifacts instead of treating volatile point estimates as a contract. It also states that advisory urgency can recompute the next-review date. | **MC/NE/PF partial; DE:** Authority, action/delta alignment, applied-effect metadata, scanner-score checks, and manager verdict/target-size comparisons shipped. A complete eligibility-through-execution metamorphic proof, impression-level exposure logging, and cold/concurrent/SLA testing remain deferred. |
| 13 | Attribution and multiplicity language needed audit | Kaufman, Wilder, Gonzalez, Hubert--Arabie, and purge/embargo references were added. Benjamini--Hochberg is identified as FDR rather than family-wise control. | **MC:** A final human bibliographic audit remains required. |

## Evidence boundary

The revision preserves the existing efficacy boundary while extending the
engineering audit with full-precision prefix, truncation, initialization-coverage, entropy,
null-anchor, resolution-count, and latency diagnostics. Forecast value, option
profitability, comparative advantage, and
production service levels remain deferred until the corresponding preregistered,
cost-aware, dependence-aware experiments exist.

The v1.2 program revision is additive: existing schema/model IDs and legacy
1.0/1.1 fields remain readable without mutation, while `semantic_revision`, history/input quality,
calibration-distance aliases, option authority, alignment, initialization coverage, and
applied-effect metadata make the reviewed boundaries machine-readable. The
supplementary v2 harness expands audits and receipts; it does not change the v1
field formula.

## Second-round precision corrections

The mathematical items are paper/reproducibility corrections to the already
evaluated v1 formula and are labeled by the additive 1.2 semantic closeout.
They do not silently change the field vector or create new efficacy evidence.
The security row is an application-boundary change, independently tested and
kept outside the representation formula.

| Round-2 point | Correction | Remaining boundary |
|---|---|---|
| Negative scaling-exponent interpretation | Appendix A now proves that nested-window realized variation is nondecreasing and rewrites the interior stencil as a positive weighted average of adjacent nonnegative secants. Therefore `gamma >= 0` in exact arithmetic at edges and interiors. A materially negative estimate remains only in the invalid diagnostic series; option translation withholds it, and that request emits neither a Form dictionary nor a retrospective relationship atlas. | A materially negative preclip value is a numerical, ordering, window-consistency, or implementation-quality failure to investigate, not an interpretable state. |
| EWM missing values | The manuscript gives the exact pandas 2.2.3 options, initialization, held output across missing cells, absolute-position decay, and the closed-form next update after a gap. The paper and deployed backend now share that pinned dependency. | The price field rejects missing OHLC; this convention matters principally for masked carrier paths. |
| Coherence floor | The effective range `Coh in (7/27, 1]` and its strictly positive Structure contribution `>49/450` are now explicit in the appendix and main limitations. | The existing v1 composite is unchanged; a gated Structure remains future work. |
| Entropy sensitivity placement | Exact alternative-window correlations now appear in the main discussion, not only the appendix. | The 24-instance window has not been shown optimal. |
| Statistical conventions | Resolution and entropy correlations are identified as pairwise-finite Pearson correlations, with minimum-pair and variance guards. IQRs, medians, and percentiles state linear interpolation and missing-value omission. | These sensitivity summaries are descriptive, not inferential tests. |
| One-row horizon grid | The `J=1` convention now sets log-horizon derivatives and scaling exponent to zero. | This is a degenerate supported representation, not multiscale evidence. |
| Lexicon signature ties | The 0.35-bin rule is specified as `np.rint(mu/0.35)` to little-endian int32, including nearest-even exact half ties. | Signatures remain request-local and nonsemantic. |
| Provenance | The README separates the first-run commit from the clean current primary evidence commit and explains why the dirty supplementary parent is not source identity. | Exact raw-input replay still requires the retained nonredistributed cache. |
| Reader-facing terminology and attribution | The primary notebook generator replaces “outside descriptive range” with the upper state-conditional calibration-distance-tail term, and the Wilder BibTeX name now uses the correct suffix form. | Legacy serialized field/CSV keys remain unchanged for compatibility. |
| Secret Options production access | A router-wide application dependency now requires distinct non-cookie bearer credentials for read and mutation scopes, fails closed in production, returns `401` for missing/invalid credentials and `403` for read credentials on mutations, and emits redacted structured events with actor, route, object, request ID, result, and hashed before/after metadata. Tests cover the real router, both scopes, denial logs, and successful access. Because authentication is bearer-header based rather than cookie based, browser CSRF credentials are not involved. | No external identity-aware edge gateway was demonstrated. Each configured actor identifies a shared credential rather than a person, and Docker log retention is operational rather than an append-only database audit ledger. |
