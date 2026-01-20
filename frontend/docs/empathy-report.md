# Empathy Report — Market Stability Diagnostic
Date: 2026-01-19

This document defines the interpretive philosophy, interaction model, and reduction rationale
behind the Market Stability Diagnostic dashboard.

It exists to preserve intent, protect coherence, and prevent drift.
It is not an implementation spec — it is a system self-explanation.

────────────────────────────────────────────────────────────
CORE PHILOSOPHY
────────────────────────────────────────────────────────────

The dashboard is a diagnostic lens, not an advisory tool.

Every UI element must answer at least ONE of the following questions
at its current interaction level:

1) Has something changed?
2) Is this certain or uncertain?
3) Should I look closer?
4) Where am I in the system?

If an element does not answer one of these, it does not belong at that level.

Empathy is expressed structurally:
- by respecting attention
- by avoiding over-explanation
- by rewarding curiosity only after intent is shown

────────────────────────────────────────────────────────────
PROGRESSIVE COMMITMENT MODEL
────────────────────────────────────────────────────────────

The system uses Progressive Commitment rather than modes or overlays.

REST → FOCUS → CLICK

There is no Inspect Mode and no special lens.
The interface explains itself by how it behaves.

--------------------------------
REST
--------------------------------
REST is the default, always-visible state.

Purpose:
- Orientation
- Fast scanning
- System awareness

REST must be intelligible without interaction.

At REST, a user should understand:
- where they are in the system
- whether something has changed

REST rules:
- Maximum 2 lines of text
- No paragraphs
- No methodology
- No explicit relationships
- No caveats longer than a clause

REST uses the Signal Sentence pattern:

Signal: <short factual statement>
Context: <where this sits in the system>

--------------------------------
FOCUS
--------------------------------
FOCUS is a temporary clarification state.

FOCUS answers ambiguity, not curiosity.

FOCUS is triggered by:
- hover (desktop)
- keyboard focus
- first tap (mobile)

FOCUS rules:
- One short line only, unless grammar and understanding will be hindered.
- Inline (no modal, no drawer)
- Never navigates
- Disappears shortly after when attention moves away

FOCUS answers exactly ONE question:
- Is this certain or uncertain?
OR
- Should I look closer?

Examples:
- Confidence: Medium — signals diverging
- Near regime boundary (±)
- Data freshness: lagging

FOCUS is a semantic state, not a visual flourish.

--------------------------------
CLICK
--------------------------------
CLICK represents explicit curiosity.

CLICK answers:
- Why this matters
- What it connects to
- How it is constructed

CLICK behavior:
- Inline expansion OR
- Navigation to a detail page

CLICK is the only place where:
- methodology
- relationships
- deeper explanation
appear.

────────────────────────────────────────────────────────────
MOBILE PARITY
────────────────────────────────────────────────────────────

Hover is not a requirement.

FOCUS is shared across devices:
- Desktop: hover OR keyboard focus
- Mobile: first tap
- Keyboard: Tab focus

No information may exist exclusively on hover.
Mobile users must receive the same meaning, not a reduced experience.

────────────────────────────────────────────────────────────
COLOR AS SEMANTIC LANGUAGE
────────────────────────────────────────────────────────────

Color communicates identity and condition, not decoration.

Two color layers exist:

1) Metric family color (identity)
2) State color (condition)

These must never be mixed.

--------------------------------
Metric Families
--------------------------------
Every metric belongs to exactly one family
(e.g. rates, liquidity, volatility, metals, credit, crypto).

A family has one consistent base color across the entire site.

Example:
- Metals = muted gold (identity, always)
- Volatility = muted indigo
- Liquidity = muted teal

Charts do not choose colors.
They request them from a central registry.

--------------------------------
State Colors
--------------------------------
Green / Yellow / Red indicate condition only.

They may appear as:
- state pills
- small badges
- thin borders or background tints

They must NEVER be used as chart series colors
and must never replace a metric’s identity color.

────────────────────────────────────────────────────────────
RELATIONSHIPS
────────────────────────────────────────────────────────────

Relationships are powerful and therefore constrained.

Rules:
- Never shown at REST or FOCUS
- Revealed only on CLICK
- One level deep (no chains of chains)
- Maximum 4 initially

A relationship must meet at least one criterion:
- Direct contributor
- Documented lead/lag
- Shared macro driver
- Confirming or conflicting signal

Relationships are explanatory, not exploratory.

────────────────────────────────────────────────────────────
SECTION-BY-SECTION REDUCTION RATIONALE
────────────────────────────────────────────────────────────

Global Header:
- Reduced to orientation only
- No explanatory prose

Overall Summary:
- Reduced to Signal Sentence
- Confidence moved to FOCUS
- Interpretation moved to CLICK

System Overview / Theory / Sector / Alternatives:
- Paragraphs removed from REST
- Explanation demoted to CLICK
- Confidence clarified in FOCUS

Indicator Grid:
- Each card reduced to state + context
- Freshness clarified in FOCUS
- Full detail deferred to indicator pages

Across the system:
- Any paragraph-length explanation was moved deeper
- Any duplicate interpretation was merged or removed
- Load was reduced from “dense” to “inspectable”

────────────────────────────────────────────────────────────
MODULARITY & FUTURE EXPANSION
────────────────────────────────────────────────────────────

This system is designed to grow without redesign.

Rules:
- New features must conform to REST / FOCUS / CLICK
- New metrics must join an existing family or define one
- New explanation must move deeper, not widen the UI
- Special cases are avoided in favor of generalization

If a feature cannot fit cleanly into this model,
it should not be added.

────────────────────────────────────────────────────────────
WHEN IN DOUBT
────────────────────────────────────────────────────────────

When decisions are ambiguous:
- Remove content rather than add UI
- Move information deeper rather than showing it early
- Prefer neutral language over interpretation
- Prefer consistency over novelty

The system should err toward restraint.

────────────────────────────────────────────────────────────
SUCCESS CRITERIA
────────────────────────────────────────────────────────────

- The dashboard is understandable without interaction
- FOCUS clarifies rather than overwhelms
- CLICK rewards curiosity without surprise
- Mobile and desktop experiences are equivalent
- The system feels calm, not busy
