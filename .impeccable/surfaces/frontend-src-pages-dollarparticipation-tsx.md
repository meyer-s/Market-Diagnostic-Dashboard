---
version: 1
slug: "frontend-src-pages-dollarparticipation-tsx"
primary_target: "frontend/src/pages/DollarParticipation.tsx"
related_targets: ["frontend/src/routes/registry.tsx","backend/app/api/dollar_participation.py","backend/app/services/dollar_participation.py"]
---

## Scope and mode

New `/dollar-participation` research surface. Operate mode.

## Audience and job

An active, self-directed investor needs to see whether DXY movement is accompanied by unusual bullish or bearish product activity, then judge whether the relationship persisted without mistaking volume for positioning.

## Task, proof, and constraints

Lead with the current relationship and a synchronized DXY/activity history. Keep UUP and UDN scores separate, preserve source dates, expose the normalization and matched-instrument rationale, and state unsupported inferences beside the evidence. No prediction, positioning claim, or color-only meaning.

## Direction and memorable moment

Extend Evidence Field with a participation field: white indexed DXY trace over blue bullish and coral bearish above-baseline activity, followed by dated episodes and an instrument audit. The memorable moment is seeing a price move continue while the opposing product's activity becomes unusual.

## Unresolved decisions

Historical AUM turnover is unavailable; do not relabel self-normalized activity as fund-size-adjusted flow.
