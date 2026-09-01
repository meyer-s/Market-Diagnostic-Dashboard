---
version: 1
slug: "frontend-src-features-bls-blsreleaselens-tsx"
primary_target: "frontend/src/features/bls/BlsReleaseLens.tsx"
related_targets: ["frontend/src/routes/registry.tsx"]
---

# BLS Release Lens surface brief

- Scope and mode: Operate-mode BLS research workspace at `/bls`.
- Audience and job: an active market observer consolidating how BLS measures, report vintages, and scheduled releases change over time without confusing their dates or units.
- Primary task: scan the current report ledger, compare unlike measures by trailing five-year percentile, return to one series in native units, audit official payroll revisions, and orient to upcoming publication times.
- Proof and content: official BLS series IDs, source links, reference periods, published estimate sequence, scheduled Eastern timestamps, explicit transformations, coverage, missingness, and data-quality warnings.
- Direction: Evidence Field chronological spine—Now → Relative → Native → Revisions → Calendar → Audit—with a compact release ledger and next-release runway in the first viewport.
- Memorable moment: five unlike price and labor measures share one 0–100 field without losing family, line identity, native-unit access, or the warning that higher and lower are not better and worse.
- Constraints: observation, vintage, and publication clocks remain distinct; preserve gaps; cap comparison at five series; use price-gold and labor-blue with non-color line identity; never add market consensus, causal, or price-reaction claims without a new verified contract.
- Unresolved: monitor upstream schedule completeness and the depth of tracked observation vintages as the persisted history grows.
