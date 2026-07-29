---
name: Market Diagnostic Dashboard
description: A calm, evidence-led market research instrument for fast orientation and deliberate drill-down.
colors:
  canvas: "#0e1520"
  canvas-raised: "#121c2a"
  surface: "#182333"
  surface-raised: "#1e2b3d"
  border: "#3f5068"
  border-strong: "#62758e"
  text: "#f4f7fb"
  text-muted: "#b7c3d3"
  text-subtle: "#91a4bd"
  evidence-blue: "#83bfff"
  evidence-blue-strong: "#a8d2ff"
  stable: "#69d6a3"
  caution: "#f3cb69"
  stress: "#ff8a93"
  focus: "#9fd0ff"
typography:
  display:
    fontFamily: "Segoe UI Variable Text, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Segoe UI Variable Text, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Segoe UI Variable Text, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Segoe UI Variable Text, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Segoe UI Variable Text, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.12em"
rounded:
  sm: "8px"
  md: "12px"
  field: "14px"
  card: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.evidence-blue}"
    textColor: "{colors.canvas}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
    height: "44px"
  chip:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
---

# Design System: Market Diagnostic Dashboard

## Overview

**Creative North Star: "The Evidence Field"**

Market Diagnostic Dashboard should feel like a calm research instrument: quiet enough to support concentration, structured enough to audit, and direct enough to use under time pressure. It is not a promotional finance site and it should never imply more certainty than the data supports. The interface earns trust by connecting each conclusion to its drivers, values, definitions, freshness, and provenance.

The default page spine is **Now → Drivers → Evidence → Definition → Audit**. Operational workspaces may add **Action**, but action must remain visibly governed by the user. Dense evidence is welcome when it has hierarchy; arbitrary card walls, microscopic labels, and decorative dashboard effects are not.

**Key Characteristics:**

- Midnight analytical canvas with crisp, cool surfaces.
- Current read first; methodology and raw evidence remain directly reachable.
- Asset-family color identifies data, while green, yellow, and red identify condition.
- Missingness, staleness, partial coverage, and protected state are visible product states.
- Desktop and mobile preserve the same meaning, even when their composition differs.

## Colors

The palette uses cool navy depth and restrained sea-glass blue to keep evidence legible without turning the product into a neon trading terminal.

### Primary

- **Evidence Blue:** The primary navigation, focus-adjacent, and explanatory accent. Use it for orientation and selected evidence, not as a decorative wash.
- **Clear Evidence Blue:** A brighter companion for text and small active indicators on dark surfaces.

### Secondary

- **Stable Mint:** Positive or stable condition only.
- **Caution Amber:** Incomplete, transitional, stale, or caution condition only.
- **Stress Coral:** Error, blocked, negative, or stressed condition only.

### Neutral

- **Midnight Canvas:** The application background.
- **Raised Midnight:** Controls, disclosures, and inset evidence.
- **Evidence Surface:** Default cards.
- **Raised Evidence Surface:** Current-read and high-priority cards.
- **Structural Border:** Quiet separation.
- **Strong Structural Border:** Selected, focused, or high-emphasis separation.
- **Primary Text:** Conclusions and important values.
- **Muted Text:** Persistent explanatory copy.
- **Subtle Text:** Nonessential metadata; never smaller than the label floor.

### Named Rules

**The Identity/Condition Rule.** Asset-family colors identify what a measure belongs to. Stable, caution, and stress colors communicate its condition. Do not swap those jobs.

**The Rare Accent Rule.** Evidence Blue is an orientation tool. If every card glows blue, nothing is oriented.

## Typography

**Display Font:** Segoe UI Variable Text with Aptos, Segoe UI, and system fallbacks
**Body Font:** Segoe UI Variable Text with the same fallback stack
**Label/Mono Font:** Use the body stack for labels and the platform monospace stack for financial values.

**Character:** Neutral, compact, and operational. The system favors strong weight contrast, tabular numerals, and short factual labels over novelty typography.

### Hierarchy

- **Display** (600, fluid 30–36px, 1.15): Reserved for unusually prominent product framing.
- **Headline** (600, fluid 24–30px, 1.2): One page H1 and major current-read statements.
- **Title** (700, 18px, 1.35): Card and evidence-section headings.
- **Body** (400, 15px, 1.6): Explanations, findings, and persistent interface copy; keep long copy near 72 characters per line.
- **Label** (700, 12px, tracked): Metadata, compact controls, and eyebrow labels. Twelve pixels is the absolute floor.

### Named Rules

**The Twelve-Pixel Floor.** No persistent label or annotation renders below 12px. When space is tight, shorten the label or reveal detail on demand.

**The Financial Numeral Rule.** Scores, prices, changes, dates, and quantities use tabular numerals; aligned comparisons may use monospace.

## Layout

Pages use bounded shells: a standard research width, a narrow reading width, and a wide analytical workspace. Section rhythm is 24px on small screens and 32px from tablet upward. Primary page padding begins at 12–16px on mobile and grows to 24–32px.

Long pages lead with a compact current read and offer a horizontally scrollable in-page section navigator. Mobile is a semantic re-composition, not merely the desktop grid stacked vertically: Now and Action come first, wide evidence gets a named focusable scroller, secondary detail may use disclosures, and modal actions remain reachable.

**The One-H1 Rule.** Every route and material state has one page H1, followed by logical section headings.

**The Evidence Spine Rule.** Preserve Now → Drivers → Evidence → Definition → Audit unless a shorter page genuinely needs fewer steps.

## Elevation & Depth

Depth is primarily tonal and structural. Cards use adjacent navy surfaces, borders, and a small ambient shadow. Strong shadows are reserved for floating navigation, dialogs, and interactive hover/focus state; glass blur and glow are never the default material.

### Shadow Vocabulary

- **Field Ambient:** A low, broad shadow beneath primary surfaces; it separates without making cards float.
- **Interactive Lift:** A one-pixel rise and restrained blue outline for genuinely clickable cards.
- **Dialog Elevation:** A deeper shadow that establishes modal priority over an inert backdrop.

### Named Rules

**The Flat-by-Default Rule.** A surface is structurally separated at rest. Elevation increases only because state or layering requires it.

## Shapes

The form language is gently curved and crisp. Inputs use the field radius, secondary surfaces use medium corners, and primary cards use 16px corners. Pills are reserved for compact state, metadata, and segmented selections—not for every button. Thin borders define structure; colored side rails are meaningful status or family markers, never repeated decoration.

## Components

### Buttons

- **Shape:** Compact 8px corners for actions; pills only for true segmented choices.
- **Primary:** Evidence Blue with dark text, at least 44px high.
- **Hover / Focus:** Tonal shift plus an unmistakable focus ring; avoid spatial movement for ordinary controls.
- **Secondary / Ghost:** Raised Midnight or transparent background with a structural border and Primary Text.
- **Disabled:** Visibly muted, programmatically disabled, and accompanied by an explanation when authorization or data state is the reason.

### Chips

- **Style:** Quiet raised canvas, thin border, label typography.
- **State:** Selection needs shape/border/text in addition to color and exposes `aria-pressed`, `aria-selected`, or `aria-current`.

### Cards / Containers

- **Corner Style:** Gently rounded primary surfaces (16px); tighter nested surfaces (12px).
- **Background:** Evidence Surface by default and Raised Evidence Surface for the current read.
- **Shadow Strategy:** Ambient only; interactive lift only when the full card is actually actionable.
- **Border:** One-pixel Structural Border.
- **Internal Padding:** 16px on compact/mobile cards, 20–24px on standard research cards.

### Inputs / Fields

- **Style:** Persistent label, Raised Midnight fill, Strong Structural Border, 14px corners, and a 44px minimum height.
- **Focus:** Focus Blue ring and border shift.
- **Error / Disabled:** Error copy is programmatically associated; focus moves to the first invalid field. Disabled controls remain readable and explain why they cannot be used.

### Navigation

The top bar is a solid midnight instrument rail. Active routes use a raised surface and strong border in addition to text color. Desktop disclosures support arrow keys and Escape; mobile navigation constrains focus, closes on route selection, and returns focus to its trigger. Long analytical routes use a sticky section rail below the product navigation.

### Evidence Chart

A decision-bearing chart has a visible title, a concise interpretation, keyboard-readable chart behavior, and an equivalent values disclosure or table. Tooltips work on focus and touch as well as hover. The chart never carries a conclusion that is absent from text or values.

### Page State

Loading, partial, stale, empty, protected, and error states keep the app shell visible. They name the affected evidence, retain last-known-good data when safe, and offer the next valid action. Raw upstream HTML, stack traces, and unsupported timing promises are never user-facing.

## Do's and Don'ts

### Do:

- **Do** lead with the present market read and name the evidence that supports it.
- **Do** show source, timestamp, coverage, missingness, and freshness near the evidence they qualify.
- **Do** preserve a 44px mobile target for primary controls and a 12px absolute type floor.
- **Do** make real scrollers labeled and keyboard-focusable, with visible overflow affordance.
- **Do** keep human judgment editable in protected or operational workflows.

### Don't:

- **Don't** use microscopic labels, raw floating-point output, pure black layers, or decorative gradients as a substitute for hierarchy.
- **Don't** communicate selection, condition, or chart meaning through color or hover alone.
- **Don't** stack every desktop card into an unprioritized mobile wall.
- **Don't** invent certainty, forecasts, performance claims, sources, or data that the backend does not establish.
- **Don't** restore a combined AAS research surface; legacy deep links may only guide users to the supported metals and crypto diagnostics.
