---
name: graphify-codebase
description: Build and query this repository's guarded local Graphify code graph. Use when Codex must trace cross-layer dependencies, estimate change blast radius, find architectural hubs or extraction seams, follow callers/importers across backend/frontend/tests, or investigate legacy AAS dependencies. Do not use for visual styling, simple route-registry lookups, localized symbol searches, or claims about runtime, database, provider, scheduler, or production state.
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

   Open the interactive local viewer when a visual map is useful:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 view
   ```

3. Prefer exact-symbol operations over broad questions:

   ```powershell
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 explain -Text compute_optionality_metrics
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 affected -Text compute_optionality_metrics -Depth 2
   .\.agents\skills\graphify-codebase\scripts\graphify.ps1 god-nodes -Top 15
   ```

   Use `query -Text "..."` only for a narrow question containing distinctive symbols. Broad natural-language traversal is noisy in this repository.

4. Verify every relationship used in the answer by opening the cited source location and checking it with `rg` or a reference search. Inspect feature flags, defaults, dynamic imports, URL strings, transaction boundaries, and runtime registration directly.

5. Report only verified relationships as facts. Label unverified graph connections as leads.

## Guardrails

- The wrapper pins `graphifyy[sql]==0.9.31` and graph state in a per-repository cache under local application data, outside the OneDrive workspace. It never modifies the project Python environment.
- Builds always use local AST-only `--code-only --no-cluster` extraction. Query logging is forcibly disabled.
- Generated graph state is local cache, not documentation. Never copy it into the repository or commit it.
- Never run `graphify install`, `graphify codex install`, hooks, watch mode, MCP, `--mode deep`, semantic document/media extraction, `save-result`, `reflect`, global graphs, or Obsidian export unless the user explicitly asks for that expansion.
- Keep reverse traversal shallow. Depth greater than 2 often walks through module imports and exaggerates impact.
- Graphify cannot prove frontend URL-to-FastAPI wiring, dynamic framework behavior, SQLAlchemy effects, scheduler execution, production health, or data correctness. Validate those through their native evidence paths.

## Maintenance

After changing the pinned Graphify version, rebuild the graph and rerun `diagnose` plus the repository benchmark questions before trusting it. The expected benchmark anchors are:

- callers/importers of `compute_optionality_metrics` and `compute_historical_volatility`;
- live versus retired AAS dependencies after the metals/crypto route split;
- the Secret Options close/restore lifecycle and append-only history effects.
