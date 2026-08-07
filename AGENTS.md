# Repository agent instructions

## Architecture graph

Use `$graphify-codebase` for work that adds, removes, renames, moves, or rewires executable code, imports, routes or APIs, jobs, models or migrations, shared utilities, or frontend/backend contracts.

- Before planning architecture-affecting work, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 status`. Build if no graph exists; update if `Fresh: no`. Treat graph output as leads and verify source, tests, and runtime behavior.
- After the final architecture-affecting state, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 sync`. This also refreshes the sanitized Vision-page snapshot at `frontend/public/_graphify/constellation.html`; include any changed snapshot with the architecture it represents. If the task creates a commit, run `sync` again after the commit so the receipt and offline constellation match the committed HEAD.
- Use `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 recent` to review the latest semantic source delta. "Recent" ignores mtimes and Git-only changes; treat added/modified flags as navigation leads and verify the actual diff before drawing conclusions.
- After removing or replacing consumers, routes, jobs, or shared utilities, run `.\.agents\skills\graphify-codebase\scripts\graphify.ps1 orphans -Category widow` and inspect any newly stranded lead. Use `orphans -Category orphan-file` or the constellation's **Hygiene** view for current ownerless files.
- The coordinating agent owns the final cache update. Subagents should not race writes to the shared local Graphify state unless that responsibility is explicitly delegated.
- Never publish or commit the raw local constellation. Only the wrapper's deterministic `--public` profile is allowed in the application; it exposes current topology and sanitized latest-delta flags while deliberately excluding semantic hashes, removed identities, local paths, Git/history metadata, rationale/concept text, and Hygiene leads.
- Never remove code only because Graphify calls it an orphan or widow. Dynamic imports, decorators, framework registration, reflection, configuration, and CLI entrypoints can hide ownership; verify the source and native runtime/test evidence first.

Skip Graphify when the entire task is documentation, comments, copy, or purely visual CSS/theme/spacing/layout work that does not change executable relationships, component or prop contracts, imports, routes, or data flow.

## Deployment

- After completing and validating requested project changes, deploy this project unless the user explicitly says not to deploy.
- Use the production SSH target `ubuntu@100.49.90.221` with the identity file `C:\TempSSH\LightsailDefaultKey-us-east-1.pem`.
- Connect with `ssh -i "C:\TempSSH\LightsailDefaultKey-us-east-1.pem" ubuntu@100.49.90.221` and follow the repository's established deployment procedure on that host.
- A read-only request such as review, diagnosis, explanation, or status does not itself create deployable changes and must not trigger a deployment.
