---
version: 1
slug: "frontend-src-pages-preciousmetalsdiagnostic-tsx"
primary_target: "frontend/src/pages/PreciousMetalsDiagnostic.tsx"
related_targets: ["frontend/src/components/metals/GlobalPriceDispersion.tsx"]
---

# Metals Diagnostic surface brief

- Scope and mode: Operate-mode metals diagnostic at `PreciousMetalsDiagnostic.tsx`, including the global price-dispersion module and venue evidence details.
- Audience and job: An active market observer comparing the same metal across venues who needs to know whether a visible gap is like-for-like before acting on it.
- Primary task: Scan normalized prices, select a venue, verify instrument identity and freshness, then inspect why the gap remains.
- Proof and content: Current registered instruments, canonical units, quote timestamps, reference identity, comparability rules, source access state, and explicit unknown basis components. Registry coverage must never imply a connected or redistributable quote feed.
- Direction: Evidence rail. A ranked horizontal measurement field carries the first read; reference, mark shape, and freshness text do the explanatory work before prose. Detailed metadata unfolds beside or beneath the selected row.
- Memorable moment: A price dot can only become a comparable premium after the matching fields are present; otherwise the same row visibly remains a hollow headline gap.
- Constraints: Preserve the established Evidence Field dark visual system, accessible non-color labels, compact mobile list, no invented observations, and no arbitrage language for unmatched gaps.
- Unresolved: Which official or licensed SHFE, SGE, LME, MCX, OSE, and LBMA feeds may be redistributed in production; which tax, carry, and delivery adjustments can be sourced reliably enough to enable adjusted comparisons and premium history.
