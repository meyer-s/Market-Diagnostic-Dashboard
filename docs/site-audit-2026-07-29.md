# Full-site remediation audit — 2026-07-29

This is the durable closure ledger for the 34 findings in
`artifacts/site-audit/2026-07-29-full/FULL_IMPROVEMENT_BACKLOG.csv`.
It evaluates the final local production bundle on
`codex/full-site-remediation-2026-07-29`, not the pre-remediation site.

## Outcome

| Status | Count | Meaning |
|---|---:|---|
| Closed | 30 | The original defect is remediated and supported by source, automated tests, or full-height capture evidence. |
| Partial | 4 | Material remediation is present, but part of the original acceptance criteria or release proof remains. |
| Open | 0 | No original finding is wholly unaddressed. |

The four Partial findings are:

- **AUD-004:** chart names and keyboard value layers are complete, but a manual screen-reader pass and persistent alternatives for every chart are not.
- **AUD-013:** error, timeout, retry, and completeness UI is implemented, but cold/concurrent production endpoint budgets and last-known-good behavior still need post-deploy proof.
- **AUD-023:** meaningful feature extraction landed, but the largest route modules are still too large to qualify as orchestration-only modules.
- **AUD-027:** breadth quality states and invariants are implemented, but sparse/live production behavior still needs post-deploy operating proof.

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
| AUD-013 | P1 | Partial | Requests have bounded deadlines, sanitized errors, retry actions, retained prior data support, and explicit evidence-state notices. Failure/timeout fixtures are tested, and the final serialized live-proxy runs were clean. Earlier concurrent release runs still exposed transient Breadth 502, Volume/Breadth abort, and Energy timeout behavior before clean retries. | After deployment, prove documented cold and concurrent latency budgets for public credit, analyst, breadth, and Energy endpoints; verify 504/slow behavior preserves last-known data and request-age/completeness context. |
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
| AUD-024 | P2 | Closed | CI now has scheduled/manual desktop/mobile full-route and material-state gates, evidence upload, route-registry parity, explicit AAS legacy assertions, response-state tests, and failing runtime contracts. The final local gate passed 266/266 captures. | The first GitHub-hosted scheduled run and post-deploy production run remain monitoring steps, not missing implementation. Preserve read-only request blocking and registry parity. |
| AUD-025 | P2 | Closed | Recap pages now render one article H1, place current content before ancillary recent-post navigation on mobile, and expose explicit Gallery empty state. All recap captures passed the one-H1 contract. | None against the original finding. |
| AUD-026 | P2 | Closed | Shared or route-specific sticky section navigation and return paths cover the audited long research pages, including Metals, Crypto, Agriculture, System Breakdown, Dashboard, Energy, Real Estate, Stock, Vision, Map, Sector, Flow, and Weather. | Continue prioritizing first-screen summaries as individual routes evolve; total full-height content remains intentionally available. |
| AUD-027 | P2 | Partial | Volume & Breadth has bounded loading, retry/error states, exchange coverage/freshness labels, readable chart-equivalent tables, and tests that prevent unavailable placeholders from being described as usable evidence. Final serialized captures were clean. | Prove sparse/impossible production combinations suppress categorical conclusions after deployment, and monitor the market-internals endpoint against its latency/completeness budget under cold and concurrent load. |
| AUD-028 | P2 | Closed | Incidental overflow was removed and genuine horizontal data regions were labeled/focused. Final runtime evidence reports zero unfocusable scroll regions, including all recap routes. | None against the original finding; retain runtime focusability checks. |
| AUD-029 | P2 | Closed | Market Weather Pair controls only reference IDs present in the responsive DOM. Pair Overview, Field, Audit, and sheet coverage return zero Axe findings at both widths. | None against the original finding. |
| AUD-030 | P3 | Closed | Canonical identity is centralized in `productIdentity.ts` and used by metadata, shell, titles, loading states, footer, and tests. | None against the original finding. |
| AUD-031 | P3 | Closed | Loading copy is factual and task-specific; unverifiable assurances about timing or outcomes were removed. | None against the original finding. |
| AUD-032 | P3 | Closed | Backend publication validation rejects empty, generic, and filename-like informative alt text and accepts the explicit `decorative` convention. Frontend decorative images render `alt=""`; validation and rendering tests cover both paths. | None against the original finding. |
| AUD-033 | P3 | Closed | Retired decorative AAS methodology modules were removed, and remaining side accents communicate a real status/category rather than a repeated ornamental motif. | None against the original finding; new accent patterns should require documented information meaning. |
| AUD-034 | P3 | Closed | Clamped recap titles reveal their complete value on keyboard focus and touch-equivalent selection. `UpdatesList.test.tsx` covers both interactions. | None against the original finding. |
| AUD-035 | P1 | Closed | Read-scope Secret Options sessions disable scanner mutation/configuration controls, show the write-scope requirement, name the universe control, and send no POST. Write-scope tests prove the normal scanner flow remains enabled. | None against the original finding. |

## Remaining work, in priority order

1. **Production endpoint resilience — AUD-013 and AUD-027.** Deploy, then
   measure cold and concurrent latency for Energy, public-credit, analyst, and
   breadth endpoints. Verify slow/504 paths retain last-known data and visibly
   state age, completeness, and retry behavior.
2. **Manual assistive-technology validation — AUD-004.** Traverse all chart
   families with a real screen reader and keyboard. Record whether Recharts
   point values and nearby interpretation provide equivalent evidence; add
   persistent tables where they do not.
3. **Large-module decomposition — AUD-023.** Continue behavior-preserving
   extraction of Secret Options workflows and remaining Indicator Detail
   panels, followed by the other >1,000-line research modules.
4. **Release proof.** Repeat the same strict audit against the deployed
   frontend bundle and retain the generated JSON/PNGs as the production
   receipt. The local audit used the final frontend build with live production
   data, but it was not the deployed frontend asset.
5. **Credential hygiene.** Current-tree scanning found no hard-coded FRED
   credential, but historical tracked scripts contained one. Rotate or revoke
   that credential externally if this has not already been completed.

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
- Machine-readable closure ledger:
  `artifacts/site-audit/2026-07-29-final-closure/AUDIT_CLOSURE.csv`
