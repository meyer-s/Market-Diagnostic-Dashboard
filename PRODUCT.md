# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Active, self-directed investors and traders who need to understand market conditions quickly, compare evidence across asset classes, and drill into the signals behind a top-level regime read.

## Product Purpose

Market Diagnostic Dashboard compresses rates, liquidity, credit, sentiment, breadth, and cross-asset internals into a single evidence-backed market-regime read. Success means a user can orient quickly, identify the signals driving the current state, and move into focused research without assembling the picture across unrelated tools.

## Positioning

The product combines a weighted diagnostic framework with transparent indicator detail and adjacent research workspaces. Its distinguishing mechanism is the connection between one composite market-state view and the underlying cross-asset evidence, rather than an isolated chart collection or an opaque score.

## Operating Context

Users arrive to scan the current regime, inspect indicator health, compare market and sector views, research individual symbols, review recaps and news, and investigate asset-class diagnostics. The interface must support quick scanning as well as deeper, evidence-led investigation across desktop and mobile web.

## Capabilities and Constraints

- The current product is a React web application backed by live API data.
- Route and navigation metadata are centralized in `frontend/src/routes/registry.tsx`.
- Core surfaces include the dashboard, indicator library and details, methodology, market and sector views, stock research, institutional flow, recaps, news, and asset-class diagnostics.
- Some research surfaces depend on live data, route parameters, or protected access and may expose loading, empty, error, or authorization states.
- Existing financial terminology, calculations, source attribution, and factual claims must be preserved unless verified evidence supports a change.
- Design and implementation work must preserve verified product behavior, financial definitions, and API truth; it must never present simulated data as current market evidence.

## Brand Commitments

- Product name: Market Diagnostic Dashboard.
- Voice: evidence-first, direct, sober, and useful under time pressure.
- The interface should feel like an operational research product rather than a promotional finance landing page.
- The implemented visual system is documented in `DESIGN.md`; new surfaces should follow its Evidence Field hierarchy unless a documented product need requires an intentional exception.

## Evidence on Hand

- The repository contains the weighted indicator implementation and `docs/indicator-specification.md`.
- Existing pages, components, data visualizations, API contracts, route tests, and Playwright checks are implementation evidence.
- The repository identifies `marketdiagnostictool.com` as the live product surface.
- No testimonials, audited performance record, or customer claims are established for design use; future work must not fabricate them.

## Product Principles

1. Lead with the market state, then reveal the evidence behind it.
2. Keep dense information scannable without hiding important uncertainty.
3. Preserve traceability from conclusions to indicators, definitions, and sources.
4. Make freshness, loading, unavailable data, and protected states unmistakable.
5. Support fast orientation and deliberate drill-down equally well.

## Accessibility & Inclusion

WCAG 2.2 Level AA is the implementation target. Automated checks, keyboard testing, responsive inspection, and assistive-technology semantics are required evidence, but no release should claim full conformance from screenshots or a single automated scanner alone.
