---
version: 2
slug: "frontend-src-features-bls-blsreleaselens-tsx"
primary_target: "frontend/src/features/bls/BlsReleaseLens.tsx"
related_targets: ["frontend/src/routes/registry.tsx"]
---

# BLS Release Lens surface brief

- Scope and mode: Operate-mode BLS research workspace at `/bls`.
- Audience and job: an active market observer consolidating how BLS measures, report vintages, and scheduled releases change over time without confusing their dates or units.
- Primary task: understand what hiring, inflation, and labor-demand observations support, where they disagree, and what needs confirmation; enter a focused proof workspace when needed.
- Proof and content: each takeaway opens its exact values, reference months, preliminary status, source links, and next check. Revisions and schedules retain their own clocks. The independent DOL weekly receipt follows the Brief and leads Releases, with separate failure handling.
- Direction: Evidence Field progressive disclosure—Brief explains; Releases, Trends, Revisions, and Calendar prove; Methods documents. Six query-addressable tabs share one stable panel, and only the active workspace renders. The Brief preserves the `overview` URL value.
- Memorable moment: three plain-language takeaways replace the metric grid and aggregate voting label. A compact evidence preview stays visible; exact receipts expand inline and link to focused history.
- Constraints: use chronological latest months, including missing values; never backfill a latest gap with an older annual reading; require adjacent months and matching reference periods for comparisons; keep CPI annual-rate changes distinct from raw index changes and PPI; preserve chart gaps; cap relative comparison at two series and default to three years. No aggregate vote, market consensus, causal assertion, recession classification, or policy forecast is assigned.
- Unresolved: monitor upstream schedule completeness and the depth of tracked observation vintages as the persisted history grows.
