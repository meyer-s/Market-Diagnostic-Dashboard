---
version: 2
slug: "frontend-src-features-bls-blsreleaselens-tsx"
primary_target: "frontend/src/features/bls/BlsReleaseLens.tsx"
related_targets: ["frontend/src/routes/registry.tsx"]
---

# BLS Release Lens surface brief

- Scope and mode: Operate-mode BLS research workspace at `/bls`.
- Audience and job: an active market observer consolidating how BLS measures, report vintages, and scheduled releases change over time without confusing their dates or units.
- Primary task: understand the latest labor direction within seconds, then enter a focused releases, trends, revisions, calendar, or methods workspace for proof.
- Proof and content: official BLS series IDs, source links, reference periods, published estimate sequence, scheduled Eastern timestamps, explicit transformations, coverage, missingness, and data-quality warnings.
- Direction: Evidence Field progressive disclosure—Overview explains; Releases, Trends, Revisions, and Calendar prove; Methods documents. Six query-addressable tabs share one stable panel, and only the active workspace renders.
- Memorable moment: one plain-language labor read sits beside four explicit native-unit observations and four separate small multiples, with the next scheduled event visible without reading the proof layer.
- Constraints: observation, vintage, and schedule clocks remain distinct; preserve gaps; cap relative comparison at two series and default to three years; use solid primary lines plus non-color point identity; expose the exact dashboard materiality receipt; never present its state as a BLS, recession, or policy classification; never add market consensus, causal, or price-reaction claims without a new verified contract.
- Unresolved: monitor upstream schedule completeness and the depth of tracked observation vintages as the persisted history grows.
