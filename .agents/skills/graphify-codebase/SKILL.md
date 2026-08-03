---
name: graphify-codebase
description: Build, update, and query this repository's guarded local Graphify code graph and ownership-hygiene history. Use when Codex must trace cross-layer dependencies, estimate change blast radius, find architectural hubs or extraction seams, follow callers/importers, or inspect orphan, detached, test-only, unresolved, or recently stranded code leads. Do not use for visual styling, simple route-registry lookups, localized symbol searches, or claims about runtime, database, provider, scheduler, or production state.
---

# Graphify Codebase

Use Graphify as an architectural hypothesis tool. Treat direct source reads, `rg`, tests, and live runtime evidence as authoritative.

## Workflow

1. Run the wrapper from the repository root:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 status
   ```

2. If no graph exists, build it. If status reports `Fresh: no`, update it:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 build
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 update
   ```

   Open the self-contained local Architecture Constellation when a visual map is useful:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 view
   ```

   The sphere shows a balanced, stable sample of nodes for orientation; search reaches the full graph. Radius has three semantic shells: high inbound reuse is nearer the center, cross-file reused code is in the middle, and local code or entrypoints are nearer the surface. Only shell membership has meaning; deterministic offsets within a shell are visual packing. Double, single, or absent keylines repeat those three bands when perspective compresses distance. Node size still reflects total extracted degree, so a large entrypoint can remain prominent without being mistaken for reusable code. Select a node to inspect the inbound file/layer evidence, then switch to **Neighborhood** for a bounded one-hop dependency view and use the DOM relationship ledger as the precise, keyboard-accessible reading layer. Color denotes repository scope and shape is a heuristic symbol-kind cue. Containment edges are withheld from the visual layer, unresolved targets are labeled explicitly, and suspicious cross-language symbol matches are suppressed.

   Use the same radial evidence without opening the viewer:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 scope -Text compute_optionality_metrics
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 scope -Top 15
   ```

   Radial scope is an AST-derived inbound-reuse lead: it scores distinct inbound production files with a small architecture-layer diversity bonus and deliberately ignores outbound fan-out. It is not a claim about business importance, runtime criticality, or proven change impact. Generic-name bindings can be false positives, so use radius to decide where to trace first, then verify the named source and relationships directly.

   Switch the viewer to **Hygiene** to triage ownership leads without adding warning encodings to the sphere. The default ledger shows historical widows, detached files, and non-root files with no extracted inbound owner. Lower-confidence no-caller, test-only, unresolved-binding, and likely-root reference groups are opt-in filters. Use the terminal report when exact evidence is easier to review there:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 orphans
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 orphans -Category detached -Top 30
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 orphans -Category widow
   ```

   A widow is historical: the stable node had at least one extracted inbound production relationship in the prior changed graph and has none now. The wrapper preserves that prior graph locally only when extraction output changes. With no baseline, the viewer says `Current snapshot only`; it never invents historical loss. An orphan is a current static ownership lead and is not proof of dead code.

3. Prefer exact-symbol operations over broad questions:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 explain -Text compute_optionality_metrics
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 affected -Text compute_optionality_metrics -Depth 2
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 god-nodes -Top 15
   ```

   Use `query -Text "..."` only for a narrow question containing distinctive symbols. Broad natural-language traversal is noisy in this repository.

4. Verify every relationship used in the answer by opening the cited source location and checking it with `rg` or a reference search. Inspect feature flags, defaults, dynamic imports, URL strings, transaction boundaries, and runtime registration directly.

5. Report only verified relationships as facts. Label unverified graph connections as leads.

6. After architecture-affecting edits, run the one-step final synchronizer. Run it again after committing so the receipt matches the committed HEAD:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 sync
   ```

   `sync` also refreshes the deterministic, sanitized public constellation at
   `frontend/public/_graphify/constellation.html` for the Vision page. Include a
   changed snapshot in the same commit as the architecture it represents.

## Guardrails

- The wrapper pins `graphifyy[sql]==0.9.31` and graph state in a per-repository cache under local application data, outside the OneDrive workspace. It never modifies the project Python environment.
- Builds always use local AST-only `--code-only --no-cluster` extraction. Query logging is forcibly disabled.
- Generated graph state is local cache, not documentation. Never copy it into the repository or commit it.
- The local history retains one prior changed graph and receipt for widow comparison. It is not a Git substitute and must remain outside the repository.
- The full generated constellation beside the graph cache is local-only. It includes machine-local history and ownership-hygiene leads and must never be copied into the repository or deployed.
- The only deployable exception is the wrapper's explicit `--public` export at `frontend/public/_graphify/constellation.html`. That profile is deterministic, code-only, current-snapshot-only, and removes repository roots, timestamps, Git heads, rationale/concept text, and hygiene data. Never replace it with the raw local viewer.
- Public export source paths must remain canonical repository-relative paths. The builder fails closed on absolute, URL-like, control-character, empty-segment, or traversal paths and refuses a raw local output inside the repository.
- Never run `graphify install`, `graphify codex install`, hooks, watch mode, MCP, `--mode deep`, semantic document/media extraction, `save-result`, `reflect`, global graphs, or Obsidian export unless the user explicitly asks for that expansion.
- Keep reverse traversal shallow. Depth greater than 2 often walks through module imports and exaggerates impact.
- Graphify cannot prove frontend URL-to-FastAPI wiring, dynamic framework behavior, SQLAlchemy effects, scheduler execution, production health, or data correctness. Validate those through their native evidence paths.

## Maintenance

After changing the pinned Graphify version, rebuild the graph and rerun `diagnose` plus the repository benchmark questions before trusting it. The expected benchmark anchors are:

- callers/importers of `compute_optionality_metrics` and `compute_historical_volatility`;
- live versus retired AAS dependencies after the metals/crypto route split;
- the Secret Options close/restore lifecycle and append-only history effects.
