# Full-site remediation audit — 2026-07-29

This is the durable closure ledger for the 34 findings in
`artifacts/site-audit/2026-07-29-full/FULL_IMPROVEMENT_BACKLOG.csv`.
It evaluates the corrected release deployed from
`codex/full-site-remediation-2026-07-29`, not the pre-remediation site or the
rejected flatter first pass.

## Outcome

| Status | Count | Meaning |
|---|---:|---|
| Closed | 31 | The original defect is remediated and supported by source, automated tests, or full-height production capture evidence. |
| Partial | 3 | Material remediation is present, but part of the original acceptance criteria or an intentional product-direction tradeoff remains. |
| Open | 0 | No original finding is wholly unaddressed. |

The three Partial findings are:

- **AUD-004:** chart names and keyboard value layers are complete, but a manual screen-reader pass and persistent alternatives for every chart are not.
- **AUD-023:** meaningful feature extraction landed, but the largest route modules are still too large to qualify as orchestration-only modules.
- **AUD-026:** concise first-screen summaries remain, but the initial sticky section rails were deliberately removed after hands-on review because they duplicated each page’s headings and real controls. A less intrusive mobile-only jump pattern remains a possible follow-up.

## Visual correction after hands-on review

The first remediation release improved structure, accessibility, state handling,
and performance, but its shell was flatter and its navigation heavier than the
site it replaced. The correction keeps the system work while restoring the
earlier visual character:

- the original blue/teal radial and vertical canvas gradients are restored on
  the document and application shell;
- page heroes again use the earlier layered atmospheric treatment instead of a
  flat panel with a repeated accent stripe;
- the global header is 64px high, translucent, and uses compact pill controls;
- the ornamental boxed `MD` mark is removed while the canonical product name
  remains;
- thirteen duplicate sticky or inline section rails are removed from long
  routes, while real tabs, timeframes, filters, pagination, refresh actions,
  Market Weather controls, and the Secret Options workspace switcher remain;
- mobile tool families are collapsed native disclosures, with the active family
  opened automatically, so the menu does not dump every route into the first
  viewport.

## Correction release preflight

The corrected release bundle is:

- JavaScript: `assets/index-DcjgVjzx.js`
- CSS: `assets/index-BjlRYaqq.css`

The corrected frontend suite passed 219/219 tests across 37 files. ESLint,
TypeScript, the production build, and bundle budgets passed. The backend suite
collected 450 tests: 447 passed and 3 skipped. Targeted logging, response-cache,
endpoint-resilience, and API-provenance tests passed, and the additive
response-snapshot Alembic migration passed upgrade/downgrade and PostgreSQL DDL
smoke checks.

Corrected bundle results:

- initial JavaScript: 186.28 KiB raw / 60.82 KiB gzip;
- initial CSS: 132.92 KiB raw / 23.65 KiB gzip;
- largest deferred chunk: 274.80 KiB raw / 85.84 KiB gzip;
- 20 route modules emitted as deferred chunks.

## Deployed production closure

The corrected release is live at `https://marketdiagnostictool.com` from exact
source commit `7adab50a9887021d84db8362a6add580796f541a`.

- Production JavaScript: `assets/index-Bdbx4vqA.js`
- Production CSS: `assets/index-BjlRYaqq.css`
- Database migration: `20260729_0021 (head)`
- IB Gateway: not recreated; its container ID and original start time remained
  unchanged through the frontend/backend/scheduler deployment.

The strict production audit covered every supported route, both explicitly
retired AAS routes, the complete recap archive, the desktop Tools menu, the
mobile navigation menu, protected/error paths, and the defined material
interaction states.

| Viewport | Route and legacy captures | Material-state captures | Result |
|---|---:|---:|---|
| Desktop | 102/102 | 29/29 | 131/131 accepted and full-height |
| Mobile | 102/102 | 33/33 | 135/135 accepted and full-height |
| Total | 204/204 | 62/62 | 266/266 accepted and full-height |

Across the production evidence:

- all 266 captures covered the measured full document height;
- all 204 route captures had one `main`, one H1, and a non-empty
  route-specific title;
- horizontal document overflow, unresolved literal loading states, missing
  image alt attributes, unnamed form controls, unfocusable scroll regions, and
  priority controls below 44×44 CSS pixels were zero;
- Axe violations, unexpected console errors, page errors, and request failures
  were zero;
- the deliberate rejected-auth Secret Options fixture classified its expected
  401 and aborted access request without failing the audit;
- maximum route height was 6,051px desktop and 10,099px mobile;
- maximum material-state height was 6,430px desktop and 9,831px mobile;
- no retry run was needed.

Production endpoint proof also closed the original reliability acceptance
criteria:

- Analyst Confidence returned 249 live rows with complete quality metadata in
  0.85s; two concurrent requests completed in 0.18s and 0.30s.
- Public Credit returned all four configured components with complete quality
  metadata in 1.18s; concurrent requests completed in 0.21s and 0.25s.
- Real Estate overview returned all 11 configured components in 0.15s;
  concurrent requests completed in 0.14s and 0.25s. History, transmission,
  context, and commercial evidence also completed with explicit quality
  metadata.
- Market Breadth completed within the bounded request budget and honestly
  returned `partial`, `representative=false`, and zero representative exchange
  coverage because the upstream provider returned no usable breadth symbols.
  It did not hang, claim complete evidence, or render a categorical conclusion.
- Shared last-known-good snapshots were present for Analyst Confidence, Public
  Credit, and the Real Estate surfaces. Slow/failure fixtures verify bounded
  retry and retained-evidence behavior.

## Authoritative local closure evidence

The frozen bundle was:

- JavaScript: `assets/index-CXpRbwgz.js`
- CSS: `assets/index-nV229tFg.css`
- Source mode: fresh local Vite production build with a read-only proxy to `https://marketdiagnostictool.com`

The exhaustive closure run covered every supported route, two explicitly
classified retired AAS routes, every current recap permalink, and the defined
material interaction states.

| Viewport | Route and legacy captures | Material-state captures | Result |
|---|---:|---:|---|
| Desktop | 102/102 | 29/29 | 131/131 strict-clean |
| Mobile | 102/102 | 33/33 | 135/135 strict-clean |
| Total | 204/204 | 62/62 | 266/266 strict-clean |

Across the authoritative route runs:

- every screenshot covered the measured full document height;
- every screen had one `main`, one H1, and a non-empty route-specific title;
- horizontal page overflow, blank roots, cropped captures, unresolved loading
  states, missing image alt attributes, and unnamed form controls were zero;
- Axe violations and violation nodes were zero;
- unfocusable scroll regions were zero across 61 desktop and 40 mobile
  scrollable regions;
- high-priority controls under 44×44 CSS pixels were zero;
- final console, page, and request failures were zero;
- maximum captured height was 6,145px desktop and 10,185px mobile.

The final frontend suite passed 213/213 tests across 37 files. ESLint,
TypeScript, the production build, and bundle budgets passed. The final backend
suite collected 419 tests: 417 passed and 2 skipped.

Bundle results:

- initial JavaScript: 185.97 KiB raw / 60.78 KiB gzip;
- initial CSS: 131.78 KiB raw / 23.31 KiB gzip;
- largest deferred chunk: 274.80 KiB raw / 85.84 KiB gzip;
- 20 route modules emitted as deferred chunks.

## Finding-by-finding ledger

| ID | Sev. | Status | Implementation and evidence | Exact remaining work |
|---|---:|---|---|---|
| AUD-002 | P1 | Closed | `RouteErrorBoundary.tsx` and `RouteExperience.tsx` preserve shell navigation and expose recovery actions. `RouteExperience.test.tsx` injects a render failure and verifies containment. | None against the original acceptance criteria; retain the injected-failure regression test. |
| AUD-003 | P1 | Closed | Muted semantic tokens were raised, a 12px floor was applied to former 8–11px utility text, and all 266 final captures returned zero Axe findings. | Automated contrast is not a WCAG certification; retain manual review for canvas/chart colors and unusual content combinations. |
| AUD-004 | P1 | Partial | The AST contract inventories 71 rendered Recharts roots: 70 decision-bearing roots have unique contextual names and enabled keyboard value layers; one path-specific decorative chart is hidden and has its layer disabled. Twelve roots also expose persistent table/disclosure alternatives. | Complete a documented NVDA, JAWS, or VoiceOver keyboard traversal. Add persistent equivalent-value tables or disclosures for the remaining 58 roots if non-interactive equivalence is required. |
| AUD-005 | P1 | Closed | Mouse-only evidence was moved to native buttons/links or keyboard/touch-accessible controls. Market Map exposes a jump to a 419-row equivalent table. Route and targeted audits show zero keyboard/accessibility contract failures. | None against the original finding; keep keyboard and touch regression coverage. |
| AUD-006 | P1 | Closed | Secret Options dialogs use the shared `Dialog` primitive with naming, initial focus, trap, Escape close, inert background, and focus return. `SecretOptions.dialog.test.tsx` and mobile material captures cover the lifecycle. | None against the original finding. |
| AUD-007 | P1 | Closed | Shared `FormField` semantics and route fixes name controls and associate errors. The authoritative route audit found 31 form controls per viewport and zero unnamed controls. | None against the original finding. |
| AUD-008 | P1 | Closed | Stateful controls use explicit tab, pressed, selected, or current semantics through shared primitives and route-specific fixes. `primitives.test.tsx` and asset-flow route tests cover state announcements. | None against the original finding. |
| AUD-009 | P1 | Closed | `RouteExperience`, `PageHeader`, skip navigation, route focus management, and registry metadata now provide one H1, one main landmark, and a specific title on every final capture. | None against the original finding. |
| AUD-010 | P1 | Closed | Topbar desktop/mobile disclosures expose controlled/expanded state, Escape handling, active-route semantics, and trigger-focus return. `Topbar.test.tsx` covers the keyboard lifecycle. | None against the original finding. |
| AUD-011 | P1 | Closed | System Breakdown’s historical heatmap is contained in a labeled focusable data scroller. Final mobile document overflow and unfocusable scrollers are both zero. | None against the original finding. |
| AUD-012 | P1 | Closed | Agriculture’s correlation matrix is contained in a labeled focusable region with bounded width. The 9,093px deep-dive capture remained exactly 390px wide. | None against the original finding. |
| AUD-013 | P1 | Closed | Requests have bounded deadlines, sanitized errors, retry actions, shared last-known-good snapshots, single-flight refresh coordination, and explicit evidence-state notices. Failure/timeout fixtures verify retained evidence and no indefinite loader. Production route/state audits were clean, and direct warm/concurrent probes for Analyst, Public Credit, Breadth, and Real Estate completed within the service budgets with explicit quality metadata. | None against the original acceptance criteria. Continue monitoring upstream latency and snapshot age as an operating concern. |
| AUD-014 | P1 | Closed | A six-state evidence classifier covers loading, complete, partial, stale, empty, and error. Deterministic 1440px/390px semantic inventories cover Consumer Health, Bond core, Liquidity, and Sentiment. Recap Gallery has explicit populated and empty reader/dialog contracts. | The acceptance contract is semantic DOM parity, not pixel-level visual parity. Add Playwright fixture screenshots if pixel parity becomes a release requirement; public/yield Bond panels are classified but not separately viewport-fixtured. |
| AUD-015 | P1 | Closed | Route modules are lazy, heavy libraries are deferred, and `check-bundle-budget.mjs` is a build/CI gate. The final initial bundle is 60.78 KiB gzip with 20 deferred route modules. | None against the original finding; review budgets deliberately when adding routes or visualization libraries. |
| AUD-016 | P1 | Closed | Market News uses bounded pagination, count/sort controls, compact results, and URL-persisted filters. `SitePolishRoutes.test.tsx` covers loading and URL recovery. | None against the original finding. |
| AUD-017 | P1 | Closed | Shared `DataScroller` and route fixes provide focus, region naming, and overflow containment. Authoritative audits found zero unfocusable scrollers at either viewport. | None against the original finding. |
| AUD-018 | P2 | Closed | Shared response states and the 404 route provide alert/status semantics plus retry, Dashboard, Metals, Crypto, Back, or related-route recovery actions as appropriate. | None against the original finding. |
| AUD-019 | P2 | Closed | The runtime audit now fails high-priority controls below 44×44px. All 204 final route/legacy captures reported zero priority targets under 44px. | The gate intentionally scopes primary, high-frequency, destructive, topbar, section-nav, and explicitly marked controls. Keep documented spacing exceptions for lower-priority inline links. |
| AUD-020 | P2 | Closed | Visible score formatting is centralized and `scorePrecision.test.ts` rejects direct rendering of numeric score fields. Final captures no longer expose raw floating-point tails. | None against the original finding. |
| AUD-021 | P2 | Closed | Semantic surface/text/border/status tokens replaced supported raw gray/slate utilities; obsolete AAS presentation modules were deleted. Remaining hard-coded colors are chart identity/status values rather than unintended theme islands. | Continue migrating chart colors only when it improves semantic governance; do not erase deliberate series identity. |
| AUD-022 | P2 | Closed | Reduced-motion CSS now removes decorative/spatial movement while preserving understandable progress and state-change feedback. | None against the original finding; retain OS-level reduced-motion smoke checks. |
| AUD-023 | P2 | Partial | Shared UI primitives were extracted. Secret Options domain types, presentation, and telemetry moved under `features/secretOptions`; Treasury and municipal panels moved under `features/indicatorDetail`. Full tests remained green. | `SecretOptions.tsx` is still 7,912 physical lines and `IndicatorDetail.tsx` is 2,865. Continue extracting stateful workflow slices, dialogs, forms, and indicator panels until route files are orchestration-only. Other >1,000-line research modules remain. |
| AUD-024 | P2 | Closed | CI now has scheduled/manual desktop/mobile full-route and material-state gates, evidence upload, route-registry parity, explicit AAS legacy assertions, response-state tests, and failing runtime contracts. Both the final local gate and deployed production gate passed 266/266 captures. | The first GitHub-hosted scheduled run remains a monitoring step, not missing implementation. Preserve read-only request blocking and registry parity. |
| AUD-025 | P2 | Closed | Recap pages now render one article H1, place current content before ancillary recent-post navigation on mobile, and expose explicit Gallery empty state. All recap captures passed the one-H1 contract. | None against the original finding. |
| AUD-026 | P2 | Partial | Current-state summaries remain early, every major section keeps a named heading/deep-link target, and genuine page tabs and controls remain. The first implementation added thirteen sticky or inline anchor rails; hands-on review found them visually redundant, so they were removed in the correction. | If long mobile journeys still need direct jumping after production use, add one compact mobile-only section disclosure or bottom-sheet navigator rather than restoring persistent duplicate rails. |
| AUD-027 | P2 | Closed | Volume & Breadth has bounded loading, retry/error states, exchange coverage/freshness labels, readable chart-equivalent tables, and invariant tests. Production returned an explicit partial, non-representative response with zero representative exchange coverage when Yahoo supplied no usable breadth symbols; the UI suppressed categorical conclusions and both viewport audits completed without a loader or runtime failure. | None against the original quality-UX finding. Restoring representative breadth evidence still depends on upstream data availability or a future replacement provider. |
| AUD-028 | P2 | Closed | Incidental overflow was removed and genuine horizontal data regions were labeled/focused. Final runtime evidence reports zero unfocusable scroll regions, including all recap routes. | None against the original finding; retain runtime focusability checks. |
| AUD-029 | P2 | Closed | Market Weather Pair controls only reference IDs present in the responsive DOM. Pair Overview, Field, Audit, and sheet coverage return zero Axe findings at both widths. | None against the original finding. |
| AUD-030 | P3 | Closed | Canonical identity is centralized in `productIdentity.ts` and used by metadata, shell, titles, loading states, footer, and tests. | None against the original finding. |
| AUD-031 | P3 | Closed | Loading copy is factual and task-specific; unverifiable assurances about timing or outcomes were removed. | None against the original finding. |
| AUD-032 | P3 | Closed | Backend publication validation rejects empty, generic, and filename-like informative alt text and accepts the explicit `decorative` convention. Frontend decorative images render `alt=""`; validation and rendering tests cover both paths. | None against the original finding. |
| AUD-033 | P3 | Closed | Retired decorative AAS methodology modules were removed, and remaining side accents communicate a real status/category rather than a repeated ornamental motif. | None against the original finding; new accent patterns should require documented information meaning. |
| AUD-034 | P3 | Closed | Clamped recap titles reveal their complete value on keyboard focus and touch-equivalent selection. `UpdatesList.test.tsx` covers both interactions. | None against the original finding. |
| AUD-035 | P1 | Closed | Read-scope Secret Options sessions disable scanner mutation/configuration controls, show the write-scope requirement, name the universe control, and send no POST. Write-scope tests prove the normal scanner flow remains enabled. | None against the original finding. |

## Remaining work, in priority order

1. **Manual assistive-technology validation — AUD-004.** Traverse all chart
   families with a real screen reader and keyboard. Record whether Recharts
   point values and nearby interpretation provide equivalent evidence; add
   persistent tables where they do not.
2. **Large-module decomposition — AUD-023.** Continue behavior-preserving
   extraction of Secret Options workflows and remaining Indicator Detail
   panels, followed by the other >1,000-line research modules.
3. **Optional mobile section jumping — AUD-026.** Keep the duplicate rails
   removed. If production use shows a real navigation problem on the longest
   pages, add one compact mobile-only section disclosure or bottom sheet rather
   than persistent repeated headings.
4. **Breadth provider coverage.** The production contract is now bounded and
   truthful, but Yahoo returned no usable breadth-symbol data during closure.
   Monitor the provider and evaluate a more representative exchange-universe
   source if this persists.
5. **Credential hygiene.** Current-tree scanning found no hard-coded FRED
   credential. Production dependency logging now suppresses routine HTTP-client
   request lines and redacts credential-like query parameters, after a live log
   check found that the configured FRED key had been included in request URLs.
   Rotate or revoke that key externally; it also appeared in historical tracked
   scripts before the current-tree cleanup.

## Evidence boundaries

- Zero automated Axe findings does **not** establish complete WCAG 2.2
  conformance. Manual keyboard, screen-reader, zoom/reflow, and cognitive review
  remain necessary.
- The material-state audit is read-only. Expected authentication fixture
  failures are classified explicitly and are not counted as unexpected runtime
  failures.
- AUD-014 proves deterministic semantic parity in tests; it does not claim
  pixel-identical desktop/mobile composition.
- AUD-019 proves the product’s declared high-priority 44px target contract. It
  does not claim every low-priority inline link or chart label is 44px.

## Evidence index

- Baseline report:
  `artifacts/site-audit/2026-07-29-full/FULL_AUDIT_REPORT.md`
- Baseline backlog:
  `artifacts/site-audit/2026-07-29-full/FULL_IMPROVEMENT_BACKLOG.csv`
- Desktop closure:
  `artifacts/site-audit/2026-07-29-release-local-desktop-closure/runtime-audit-desktop.json`
- Desktop material states:
  `artifacts/site-audit/2026-07-29-release-local-desktop-closure/material-state-audit-desktop.json`
- Mobile closure:
  `artifacts/site-audit/2026-07-29-release-local-mobile-full-retry/runtime-audit-mobile.json`
- Mobile material states:
  `artifacts/site-audit/2026-07-29-release-local-mobile-closure/material-state-audit-mobile.json`
- Production desktop routes:
  `artifacts/site-audit/2026-07-29-final-production-corrected-desktop/runtime-audit-desktop.json`
- Production desktop material states:
  `artifacts/site-audit/2026-07-29-final-production-corrected-desktop/material-state-audit-desktop.json`
- Production mobile routes:
  `artifacts/site-audit/2026-07-29-final-production-corrected-mobile/runtime-audit-mobile.json`
- Production mobile material states:
  `artifacts/site-audit/2026-07-29-final-production-corrected-mobile/material-state-audit-mobile.json`
- Machine-readable closure ledger:
  `artifacts/site-audit/2026-07-29-final-closure/AUDIT_CLOSURE.csv`
