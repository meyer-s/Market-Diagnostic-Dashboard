# Option decision cockpit design audit

## Audit scope

The selected-position experience in the options portfolio, using the desktop screenshot supplied in the July 15, 2026 thread. The review covers the expanded portfolio row, the right-side assessment rail, and the decision-review entry points.

## User goal and accessibility target

The primary task is to answer: “Knowing what we know today, is this exact position and size still a good use of the remaining capital?” The screen should expose the answer, its timing constraints, and the next action without forcing the user to read every supporting metric. Controls should remain keyboard reachable, clearly labeled, and usable when the rail narrows.

## Flow health

1. **Scan the portfolio — mixed.** The timeline and urgency labels make due positions discoverable, but selecting a row expands pricing, rank, window, and volatility content that is repeated in the right rail.
2. **Read the current decision — needs consolidation.** The automatic grade is visible, but the headline competes with six equal-weight axis boxes, a long explanation, guardrail setup, journal content, opportunity rank, volatility, and charts.
3. **Act on the decision — unclear.** “Confirm / override” combines two materially different intents. Revising the review window is buried inside the largest form even though it is a common, narrower action.
4. **Inspect supporting evidence — functionally complete but heavy.** The right rail preserves useful volatility and Greek evidence, but a second long scroll region makes the page feel like two dashboards placed side by side.

## Strengths

- The portfolio timeline provides a strong overview of due, overdue, and monitoring states.
- The automatic assessment separates company, security, path, contract, portfolio, and data quality.
- The no-order language is visible and the journal is append-only.
- The dark visual system, borders, and semantic warning colors are consistent with the existing dashboard.

## UX risks

- The selected position is explained in the expanded row, diagnosis strip, automatic-grade card, opportunity card, and volatility card.
- Six axes look equally important even when only one or two explain the decision.
- The primary action is ambiguous because confirmation and override share one button.
- The two clocks are important but visually subordinate to supporting evidence.
- Risk curves are always mounted in the primary decision path even when the user only needs to confirm or revise a review.

## Accessibility risks visible in the screenshot

- Several labels use 9–10px text and muted gray, which may be difficult at browser zoom or on lower-contrast displays.
- Multiple nested scroll regions can make keyboard and trackpad navigation unpredictable.
- Compact action buttons have limited target height.
- Color carries substantial urgency meaning; text labels should continue to accompany every colored state.

Screenshot evidence cannot establish keyboard order, screen-reader announcements, focus treatment, responsive reflow, or contrast ratios. Those require a rendered-browser accessibility pass.

## Implemented direction

- Promote one compact **Decision cockpit** containing verdict, target size, quality, urgency, confidence, next review, and decision deadline.
- Split actions into **Confirm grade**, **Override decision**, **Revise window**, and **Refresh grade**.
- Make confirmation a direct append-only journal action and disable it once that exact assessment is confirmed.
- Give window revision a smaller focused form that carries the existing decision forward.
- Add **Apply suggested dates** as an explicit form-fill action; never revise or save the window silently.
- Move the six grading axes, reasons, vetoes, missing inputs, guardrail setup, and immutable history into disclosures.
- Collapse opportunity rank, volatility details, quote provenance, Greeks, and visualization targets behind **Market & risk evidence**.
- Preserve all data and controls while reducing the default rail to the information needed for the next decision.

## Follow-up verification

- Compare the implementation with the supplied desktop screenshot at the same viewport.
- Check the rail at approximately 420px, tablet width, and a narrow mobile viewport.
- Verify keyboard access, visible focus, disclosure announcements, and modal focus trapping.
- Check 200% zoom and minimum contrast for muted labels.
