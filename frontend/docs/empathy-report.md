# Empathy Report Audit - Market Stability Diagnostic
Date: 2026-01-19
Scope: Dashboard UX (Progressive Commitment)

Legend
- Questions: 1) Changed? 2) Certain? 3) Look closer? 4) Where in system?
- Action: KEEP / REMOVE / DEMOTE (hover/click) / MERGE
- Load: Low / Med / High

Global rule:
REST must remain interpretable in under 3 seconds per section.
If a user cannot understand the signal without hovering or clicking, the REST layer has failed.

## Global Header
Block: Dashboard title + subtitle
- Questions: 4
- Action: KEEP, REDUCE copy
- REST copy proposal:
  - Signal: Market diagnostic overview
  - Context: Volatility, rates, liquidity, sentiment
- Hover: none
- Click: none
- Load: Low

Block: News badge
- Questions: 1, 3
- Action: KEEP
- REST copy proposal: keep count only (no extra sentence)
- Hover: "Recent headlines available"
- Click: nav to news page (optional)
- Load: Low

Block: Refresh + time range
- Questions: 1
- Action: KEEP
- REST copy proposal: keep
- Hover: "Fetch latest indicator data"
- Click: refresh / range change
- Load: Low

## Overall Summary Strip
Block: Overall summary card
- Questions: 1, 4
- Action: KEEP, REDUCE to Signal Sentence
- REST copy proposal:
  - Signal: Tailwinds lead / Caution leads / Signals split
  - Context: 4-signal composite, trend vs recent
- Hover: "Confidence: {High|Medium|Low} - (trend clarity)"
- Click: inline expansion with "Why it matters" + "Related Signals"
- Load: Med (currently High)

Sub-block: Mini signal chips
- Questions: 4
- Action: MERGE into compact chips
- REST copy proposal: label + direction only (no sentences)
- Hover: one-line clarification per chip
- Click: scroll to card or expand related detail
- Load: Med

## System Overview Card
- Questions: 1, 4
- Action: KEEP, DEMOTE paragraph to click
- REST Signal Sentence:
  - Signal: System health {improving|softening|steady}
  - Context: Composite of volatility, rates, liquidity, sentiment
- Hover: "Confidence: {High|Medium|Low} - (trend {clear|mixed|noisy})"
- Click: navigate to /system-breakdown
- Load: Med (currently High)

## Dow Theory Trends Card
- Questions: 1, 4
- Action: KEEP, DEMOTE explanation to click
- REST Signal Sentence:
  - Signal: Alignment {aligned|mixed|split}
  - Context: Classic vs modern trend signals
- Hover: "Confidence: {High|Medium|Low} - (spread {tightening|steady|widening})"
- Click: inline expansion (Theory Details)
- Load: Med

## Sector Divergence Card
- Questions: 1, 4
- Action: KEEP, DEMOTE market interpretation to click
- REST Signal Sentence:
  - Signal: {Growth lead|Defense lead|Balanced rotation}
  - Context: Defensive vs cyclical leadership
- Hover: "Confidence: {High|Medium|Low} - (gap {widening|steady|narrowing})"
- Click: inline expansion or nav to /sector-projections
- Load: Med

## Alternative Asset Stability Card
- Questions: 1, 4
- Action: KEEP, DEMOTE long conclusion to click
- REST Signal Sentence:
  - Signal: Alt stability {improving|slipping|steady}
  - Context: Metals vs crypto pressure balance
- Hover: "Confidence: {High|Medium|Low} - (leader {metals|crypto})"
- Click: navigate to /alternative-assets
- Load: Med

## Indicator Cards Grid
- Questions: 1, 4
- Action: KEEP, REDUCE per-card text
- REST Signal Sentence:
  - Signal: {indicator state + trend}
  - Context: {indicator family / system bucket}
- Hover: "Confidence: {expected lag|stale|current}"
- Click: navigate to indicator detail page
- Load: Med (currently High)

## Indicators Section Header
- Questions: 4
- Action: KEEP, shorten
- REST copy proposal: "Indicators"
- Hover: none
- Click: none
- Load: Low

Notes
- Any paragraph-length explanation moves to click (inline expansion or detail page).
- Hover clarification must be single-line, neutral gray, and keyboard-focusable.
- Uncertainty cues: dotted underline on low confidence + optional "±" when near thresholds.
- Related Signals appear only on click, never on hover, and never exceed one level of depth (no chains-of-chains).

FOCUS state definition:
FOCUS is a temporary clarification state triggered by hover (desktop), focus (keyboard), or first tap (touch).
FOCUS must never navigate, expand, or permanently alter layout.

Mobile rule:
No information may exist exclusively in hover without an equivalent focus or first-tap behavior on touch devices.

Success criteria:
	•	Dashboard can be skimmed without hovering and still be intelligible
	•	Hover adds clarity, not new concepts
	•	Click reveals explanation, not surprise
	•	No section requires reading more than 2 lines at rest
  - EVERYTHING IS MODULAR AND REUSABLE!!! This app will be built on and built on, it needs to be consistent. 