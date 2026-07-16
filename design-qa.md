# Options mobile workflow design QA

- Source truth: the July 15, 2026 mobile screenshot and written mobile information-architecture review supplied in the conversation.
- Implementation: dedicated responsive presentation in `frontend/src/pages/SecretOptions.tsx`; the desktop workflow is preserved and no longer mounts on narrow viewports.
- Target states: position list with inline decision detail, scanner workspace, and portfolio insights.
- Visual capture: unavailable in this run. The source screenshot is not exposed as a local image and the Product Design workflow requires approval before using the Playwright CLI directly.

## Implemented comparison

The source showed the desktop dashboard compressed into a long phone page. The new narrow-screen workflow renders one task at a time:

- A sticky Positions / Scanner / Insights switcher replaces the stacked desktop sections.
- Positions use dedicated cards with the timeline at full card width; the desktop identity, stats, rank, and volatility columns do not mount on mobile.
- Needs attention is expanded first. Calm monitoring positions are collapsible, while active filters expand their matching results.
- Summary counts are actionable filters. Add stays primary; refresh and P/L history move into an overflow menu. Position maintenance lives inside each position detail.
- A card tap expands a compact decision panel directly below that card; a second tap collapses it. The selected symbol remains stored in `?position=SYMBOL` for refresh and browser navigation without locking document scrolling.
- The inline detail prioritizes the recommendation, review/deadline clocks, four market fields, and decision actions. Grade rationale and journal context stay collapsed until requested; Edit and Close sit with the other position-specific actions.
- Scanner history, hits, repeated evidence, and earnings are mutually exclusive subviews. Active-run progress remains sticky.
- Optionality clusters move to Insights and initially show four rows.
- The global footer and low-value route metadata are removed from the narrow workflow.

## Performance and responsive checks

- The mobile and desktop presentations are conditionally mounted from a media-query state; hidden desktop tables, scanner results, inspector charts, and cluster cards do not remain in the mobile DOM.
- The desktop presentation still mounts at the existing `xl` breakpoint and retains its two-column layout.
- Primary mobile controls use 44–48px minimum heights, cards use 12px padding, metadata remains at 12px, and status text is explicit.
- Lint, TypeScript production build, and all 26 frontend tests pass.
- The existing Vite bundle-size warning remains; this change avoids duplicate responsive rendering but does not introduce route-level code splitting.

## Remaining visual evidence gap

- [P1] Same-viewport visual comparison remains blocked.
  - Needed evidence: authenticated captures at 360px and 390px for the collapsed list, one expanded position, Scanner/Hits, and Insights states, plus a desktop regression capture.
  - Verify: no horizontal overflow; rail marker/bracket contrast; inline-detail spacing; sticky switcher and progress offsets; menu placement; focus and pressed states.
  - Reason: no approved browser capture was available, so code inspection and automated build checks cannot establish pixel-level fidelity.

final result: blocked
