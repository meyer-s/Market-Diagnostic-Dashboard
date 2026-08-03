# Repository agent instructions

## Architecture graph

Use `$graphify-codebase` for work that adds, removes, renames, moves, or rewires executable code, imports, routes or APIs, jobs, models or migrations, shared utilities, or frontend/backend contracts.

- Before planning architecture-affecting work, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 status`. Build if no graph exists; update if `Fresh: no`. Treat graph output as leads and verify source, tests, and runtime behavior.
- After the final architecture-affecting state, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 sync`. This also refreshes the sanitized Vision-page snapshot at `frontend/public/_graphify/constellation.html`; include any changed snapshot with the architecture it represents. If the task creates a commit, run `sync` again after the commit so the receipt and offline constellation match the committed HEAD.
- After removing or replacing consumers, routes, jobs, or shared utilities, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 orphans -Category widow` and inspect any newly stranded lead. Use `orphans -Category orphan-file` or the constellation's **Hygiene** view for current ownerless files.
- The coordinating agent owns the final cache update. Subagents should not race writes to the shared local Graphify state unless that responsibility is explicitly delegated.
- Never publish or commit the raw local constellation. Only the wrapper's deterministic `--public` profile is allowed in the application; it deliberately excludes local paths, Git/history metadata, rationale/concept text, and Hygiene leads.
- Never remove code only because Graphify calls it an orphan or widow. Dynamic imports, decorators, framework registration, reflection, configuration, and CLI entrypoints can hide ownership; verify the source and native runtime/test evidence first.

Skip Graphify when the entire task is documentation, comments, copy, or purely visual CSS/theme/spacing/layout work that does not change executable relationships, component or prop contracts, imports, routes, or data flow.
