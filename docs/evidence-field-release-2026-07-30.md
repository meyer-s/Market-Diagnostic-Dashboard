# Evidence Field release receipt — 2026-07-30

This release retires the temporary theme selector, establishes Evidence Field
as the sole production visual system, preserves the alternate-theme study in
Git history, and records the reliability defects exposed and fixed during the
final full-site audit.

## Release decision

Evidence Field remains the production theme. Its blue/navy atmosphere, scale,
spacing, and established page compositions were retained. The desktop and
mobile theme selectors were removed, startup and provider logic now force
`data-theme="evidence"`, and the production theme color is `#0e1520`.

Midnight Ledger and Signal Observatory remain design references on
`codex/observatory-v2-2026-07-30` at `e7e145a`; they are not user-facing modes.
The redundant persistent section rails remain removed.

No speculative global corner-radius sweep was shipped. The existing shape
contract in [DESIGN.md](../DESIGN.md) remains:

- 16px for primary cards;
- 12px for nested surfaces;
- 8px for actions;
- pills only for compact state, metadata, and segmented choices;
- colored rails only when they communicate status or asset family.

The remaining opportunity is enclosure hierarchy, not a new theme: future
polish should prefer open sections and dividers for secondary evidence before
adding more nested cards or changing every radius.

## Source provenance

| Commit | Purpose |
|---|---|
| `e7e145a` | Remove redundant section rails and preserve the last alternate-theme study |
| `fa778d0a63fc5a04d8d58cc4a9e739461a893789` | Retire theme previews and lock Evidence Field |
| `1d2cb26aabba7b73e51d5be5e173afa206f2ae4d` | Bound market-breadth refreshes |
| `fa9d6a9127e9b8682d75a0a2cf8b6e54f1ed6bdc` | Make stock-flow synchronization concurrency-safe |

The release branch is
`codex/evidence-field-refinement-2026-07-30`. The deployed runtime source was
directly verified at `fa9d6a9127e9b8682d75a0a2cf8b6e54f1ed6bdc`.

## Frontend scope

- Removed the selector from the desktop top bar and mobile menu.
- Narrowed the theme provider to the single Evidence identifier.
- Made the bootstrap script overwrite the legacy preview preference with
  Evidence.
- Removed alternate-theme production CSS and theme-preview tests.
- Replaced preview coverage with an Evidence-specific release suite.
- Preserved the global reduced-motion safeguard.
- Kept AAS retired: metals and crypto remain separate supported diagnostics,
  while the two legacy AAS targets are explicitly classified as retired.

This release does not claim a new semantic card taxonomy or a redesign of every
corner. It is a conservative Evidence Field checkpoint.

## Functional hardening found by the audit

### Market breadth

The first production audit exposed a 504 from
`/api/market-internals/overview?days=365`. A stalled provider batch retained a
PostgreSQL advisory lock while another request waited.

The fix adds bounded advisory-lock waiting, a schema-complete partial response
during contention, and a process-local singleflight deadline around the
provider call. A request can no longer retain the advisory lock indefinitely.
Cold concurrent production requests subsequently returned HTTP 200 and left no
advisory lock behind. The exact desktop and mobile one-year breadth state also
passed after deployment.

### Stock projections

The next strict pass exposed a 500 from
`/api/stocks/SPY/projections?history_window=252d`. Two workers detected the same
institutional-flow event, then raced to insert it against
`uq_institutional_flow_event_symbol_date_side_price_volume`.

The fix uses dialect-native, batched
`INSERT ... ON CONFLICT (symbol, event_date, side, price, volume) DO NOTHING`.
It preserves first-write-wins behavior, retains new rows in mixed
duplicate/new batches, and prevents a harmless race from becoming an HTTP 500.
The concurrency suite passed, two simultaneous live projection requests
returned HTTP 200, and no post-deploy `UniqueViolation` or `IntegrityError`
appeared in the backend logs.

## Automated verification

| Check | Result |
|---|---:|
| Frontend lint | Passed |
| Frontend Vitest | 224 passed across 38 files |
| Production build and bundle budget | Passed |
| Focused browser release gate | 14/14 passed |
| Evidence Field Playwright suite | 3/3 passed |
| Backend suite after both reliability fixes | 456 passed, 2 skipped |
| Stock-flow focused suite | 9/9 passed |

The deployed frontend serves:

- JavaScript: `/assets/index-C1f_OgQ-.js`
- CSS: `/assets/index-hxq1aRPK.css`
- bootstrap: `/theme-init.js?v=20260730-evidence`

The live bytes matched the frontend container byte-for-byte. Direct inspection
found no theme selector or alternate Observatory theme implementation in the
served HTML, JavaScript, or CSS.

## Final direct-production audit

The authoritative audit loaded the deployed site at
`https://marketdiagnostictool.com`, enforced read-only production requests, and
captured every page and material interaction state at full document height.
Both Playwright suites passed in 15.0 minutes with an empty stderr stream.

| Viewport | Route captures | Material states | Total |
|---|---:|---:|---:|
| Desktop, 1440×1000 | 103 | 29 | 132 |
| Mobile, 390×844 | 103 | 33 | 136 |
| **Total** | **206** | **62** | **268** |

Each viewport's 103-route inventory contains 101 supported targets and two
classified retired AAS targets: 25 current routes, 17 indicator routes, 56
recaps, one protected route, one not-found route, one viewport navigation
state, and two retired legacy routes.

The four machine-readable reports establish:

- 268/268 captures accepted and verified at full height;
- 206/206 route records with exactly one `main` and one H1;
- 62/62 material states with exactly one H1;
- 268/268 records running the Evidence theme;
- zero document overflow;
- zero high-priority controls below 44px;
- zero Axe violations;
- zero unexpected browser console errors, page errors, or request failures;
- zero unlabeled form controls, missing image alternatives, or unfocusable
  scroll regions in the route inventory.

The tallest route was 6,032px on desktop and 9,979px on mobile. The tallest
material state was 6,342px on desktop and 9,815px on mobile. These values are
recorded to make clear that the audit did not stop at the first viewport.

## Production proof

| Service | Container | Verified state |
|---|---|---|
| Frontend | `f25aefe908b7` | healthy; unchanged by backend-only hardening |
| Backend | `ffd99e0e19be` | healthy; current release source |
| PostgreSQL | `3b89086d185d` | healthy; unchanged |
| Scheduler | `4002f0f1cf72` | running; unchanged |
| IB Gateway | `e6ff0a975347` | running; unchanged |

The remote repository tracked the release branch at `fa9d6a9`; the only remote
working-tree item was the pre-existing, preserved, untracked
`devops/env/backend.env.pre-market-field-20260726`.

Direct probes verified:

- `https://marketdiagnostictool.com/healthz` returns HTTP 200;
- canonical `https://marketdiagnostictool.com/api/health/` returns HTTP 200
  with `{"status":"ok"}`;
- SPY projections return HTTP 200 under concurrent requests;
- one-year market internals return a schema-complete HTTP 200 response;
- backend source hashes for the breadth and stock fixes match the remote tree.

## Evidence boundaries and follow-ups

The release is shippable, with these explicit non-blocking boundaries:

- Automated Axe checks do not replace a manual screen-reader and chart-values
  review.
- Breadth currently reports a truthful `partial`, non-representative state
  because Yahoo's breadth symbols are unavailable; a representative replacement
  provider remains future data work.
- A live SPY projection request currently takes roughly 11–13 seconds and
  should remain on the performance watch list.
- The slashless `/api/health` endpoint redirects incorrectly; the canonical
  `/api/health/` endpoint used for verification is healthy.
- The largest route modules still merit decomposition.
- A compact mobile jump navigator should be added only if observed use justifies
  it; another permanent navigation rail is not part of this release.

## Evidence index

The decisive counts and outcomes are embedded above because `artifacts/` is
Git-ignored. The retained local evidence is:

- `artifacts/site-audit/2026-07-30-evidence-production-final/coverage-manifest.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/material-state-manifest.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/runtime-audit-desktop.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/runtime-audit-mobile.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/material-state-audit-desktop.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/material-state-audit-mobile.json`
- `artifacts/site-audit/2026-07-30-evidence-production-final/screenshots/`
- `artifacts/site-audit/2026-07-30-evidence-production-final/state-screenshots/`
- `artifacts/site-audit/2026-07-30-evidence-final-targeted/`
- `artifacts/site-audit/2026-07-30-evidence-stock-fix/`

The broader remediation history and original backlog remain in
[Full-site remediation audit — 2026-07-29](site-audit-2026-07-29.md).
