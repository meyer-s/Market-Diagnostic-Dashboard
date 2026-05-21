---
title: "Market Diagnostic Dashboard - Codebase Audit"
author: "Static audit prepared by GPT-5.5 Pro"
date: "2026-05-21"
geometry: margin=0.75in
fontsize: 10pt
---

# Executive summary

This report audits the public repository `meyer-s/Market-Diagnostic-Dashboard` as of May 21, 2026. The repository presents a coherent product concept: a market regime dashboard that reduces raw market data into a scan-friendly diagnostic across volatility, rates, liquidity, credit, sentiment, sector internals, alternative assets, and related market-context pages. The README describes the system as a live market intelligence tool built around a weighted indicator framework and a FastAPI/PostgreSQL backend plus React/TypeScript/Vite frontend.

The strongest parts of the system are its product framing, broad domain coverage, useful visual language, strict TypeScript settings, and pockets of careful testing around GPT action workflows, option Greeks, and agriculture logic. The dashboard has a clear philosophy: compress market context rather than expose unstructured charts. The main risk is that the implementation does not yet enforce that philosophy with enough statistical, operational, and visual guardrails.

The most important issues are high-severity:

1. The scheduler and ETL are started inside the FastAPI lifespan while the backend defaults to two Uvicorn workers. This can run duplicate scheduled jobs, duplicate startup ETL, duplicate update publishing, and duplicate writes.
2. Backend admin endpoints are unauthenticated, including endpoints that run ingestion, backfill data, clear indicator data, and refetch. The public Dashboard calls one of these endpoints directly.
3. `BOND_MARKET_STABILITY` is seeded as a high-weight, core indicator, but the ETL explicitly skips it. The repository still contains unreachable bond ETL logic and separate live bond component endpoints, creating a serious validity gap.
4. The frontend design system uses many `stealth-*` Tailwind classes that are not defined in `tailwind.config.js`. This is a direct visual-continuity defect.
5. The statistical scoring layer named `analytics_stub.py` is used in production. Its z-score function uses the latest lookback window to normalize the whole series, creating historical look-ahead bias and restating past scores from future data.
6. Database schema creation and schema patches occur at application import/startup. Alembic is installed but the application relies on runtime mutation and does not enforce uniqueness of `(indicator_id, timestamp)`, making duplicate data plausible under duplicate schedulers.
7. The system silently renormalizes composite weights over available indicators without exposing coverage, freshness, or confidence. A missing high-weight indicator can make the system look more certain than it is.
8. Deployment is closer to a development topology than a production topology: source bind mounts, Vite preview as a public frontend server, unpinned Python dependencies, permissive default CORS, and public backend port exposure.

Overall assessment:

- Conceptual coherence: B+
- Statistical validity: C
- Data accuracy safeguards: C
- Security posture: C-
- Visual continuity: C+ currently; B+ after fixing Tailwind token drift and adding visual tests
- Test maturity: C
- Production readiness: C-

These grades are not a judgment of the idea. They describe how much enforcement exists in code. The project can become substantially more reliable with a focused remediation pass: separate the scheduler, protect admin surfaces, fix indicator scoring, add canonical model specs and tests, repair the design tokens, and add CI that exercises backend, frontend, accessibility, and visual-regression gates.

# Scope and method

## Audit scope

This was a static, connector-based audit of the public repository and production shell. The audit covered:

- Backend entrypoints, configuration, database models, response helpers, scheduler, ETL runner, scoring utilities, API routers, external data clients, and representative market-context services.
- Frontend routes, global styles, Tailwind theme, navigation, dashboard page, API utilities, type definitions, and representative tests.
- Dockerfiles, Docker Compose, startup script, dependency manifests, README, and selected project documentation signals.
- Test coverage inferred from repository test files and package scripts.

The repository could not be cloned or executed inside the container because direct GitHub DNS resolution failed. Therefore, I did not run `pytest`, `pnpm build`, `pnpm test`, `pnpm lint`, Docker Compose, or browser E2E flows. All findings below are based on static file inspection via the GitHub connector and public repository page. This limitation matters: runtime errors may exist that static inspection did not surface, and some apparent risks may be mitigated by reverse-proxy or environment configuration not visible in the repository.

## Evidence base

Key inspected files included:

- `README.md`
- `docker-compose.yml`
- `backend/Dockerfile`
- `backend/startup.sh`
- `backend/requirements.txt`
- `backend/seed_indicators.py`
- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/db.py`
- `backend/app/models/indicator.py`
- `backend/app/models/indicator_value.py`
- `backend/app/api/admin.py`
- `backend/app/api/actions.py`
- `backend/app/api/status.py`
- `backend/app/api/indicators.py`
- `backend/app/services/scheduler.py`
- `backend/app/services/ingestion/etl_runner.py`
- `backend/app/services/analytics_stub.py`
- `backend/app/services/schema_patches.py`
- `backend/app/services/ingestion/fred_client.py`
- `backend/app/services/ingestion/yahoo_client.py`
- `backend/app/services/energy_index.py`
- `backend/app/utils/system_scoring.py`
- `backend/app/utils/response_helpers.py`
- `backend/tests/*` representative tests
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/tailwind.config.js`
- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/components/layout/Topbar.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/types/index.ts`
- `frontend/src/utils/apiUtils.ts`
- `frontend/src/utils/__tests__/*`

# System overview

The application is organized as a FastAPI backend and a React/Vite frontend. The README states that the core is a weighted indicator framework seeded by `backend/seed_indicators.py`, tracking VIX, SPY trend, breadth, Treasury curve, unemployment, consumer health, bond market stability, liquidity, sentiment, and alternative asset stability. Around this core, the app adds indicator detail pages, system breakdown views, alternative-asset diagnostics, market maps, sector projections, stock analysis, recaps, secret options tooling, agriculture, energy, and real-estate diagnostics.

The backend starts by seeding indicator metadata and then launches a FastAPI application. The scheduler runs initial ETL, recurring ETL, AAS ingestion, crypto/metals ingestion, sector projections, agriculture cache refreshes, and scheduled market-diagnostic publishing. Data sources include FRED, Yahoo Finance, CoinGecko, DeFiLlama, COMEX-related metals data, and EIA/FRED energy sources.

The frontend central shell is `App.tsx`, with route definitions for Dashboard, Indicators, System Breakdown, Vision, Market Map, Sector Projections, Stock Analysis, Institutional Flow, Secret Options, Recap pages, Volume and Breadth tools, Alternative Assets, Agriculture, Energy, Real Estate, and AAS Breakdown.

# Findings by severity

## Critical finding 1: duplicate scheduler and ETL under multi-worker Uvicorn

**Evidence.** `backend/startup.sh` defaults `UVICORN_WORKERS` to `2`. `backend/app/main.py` starts the scheduler and creates startup tasks inside the FastAPI lifespan. `backend/app/services/scheduler.py` defines a global `AsyncIOScheduler` and schedules ETL, agriculture refresh, optional options scanning, and market-diagnostic publishing.

**Why this matters.** With multiple Uvicorn workers, each worker is a separate process. Each process will run the application lifespan and start its own scheduler. The expected consequences are duplicate scheduled ETL runs, duplicate initial ETL runs, race conditions around data writes, duplicate alert scans, duplicate update publishing attempts, inconsistent per-process caches, and possible external data API rate issues.

**Validity impact.** High. If duplicate ETL writes occur, the dashboard can report repeated records, unstable latest values, or inconsistent status histories. If duplicate scheduled publishing occurs, market recaps could be attempted multiple times. The database model lacks a uniqueness constraint on `(indicator_id, timestamp)`, so duplicate rows are structurally possible.

**Recommended fix.** Do not run recurring scheduler jobs inside each web worker. Split scheduler into a single dedicated service or gate scheduler startup behind an environment variable such as `RUN_SCHEDULER=1`. Add a database advisory lock or single-leader lock so jobs cannot overlap. Add a unique constraint on `(indicator_id, timestamp)` and convert ETL writes to upserts.

## Critical finding 2: unauthenticated admin endpoints are exposed

**Evidence.** `backend/app/api/admin.py` defines endpoints for `POST /admin/ingest/run`, `POST /admin/ingest/{code}`, `POST /admin/status/update`, `POST /admin/backfill`, and `POST /admin/clear-refetch/{code}` without an authorization dependency. `frontend/src/pages/Dashboard.tsx` calls `POST /admin/ingest/run` directly from the browser when the user clicks Refresh Data.

**Why this matters.** These endpoints can be computationally expensive, can mutate the database, and can call external data providers. A public or semi-public frontend that can trigger admin ingestion invites abuse, accidental DoS, rate-limit exhaustion, and data-integrity problems. The `clear-refetch` endpoint can delete indicator values.

**Validity impact.** High. Uncontrolled ingestion and backfill can alter the dataset and dashboard state outside scheduled methodology. It also makes it difficult to interpret the provenance of dashboard values.

**Recommended fix.** Add a fail-closed admin auth dependency requiring an `ADMIN_API_KEY` or equivalent service credential. Remove or gate the public dashboard refresh control. If manual refresh is required for operators, put it behind authenticated UI or make it enqueue a server-side job with rate limits and audit logging.

## Critical finding 3: Bond Market Stability is core but skipped

**Evidence.** `backend/seed_indicators.py` gives `BOND_MARKET_STABILITY` a weight of `2.0` and describes it as a primary fixed-income stress anchor. The README includes Bond Market Stability as a core tracked pressure point. However, `backend/app/services/ingestion/etl_runner.py` returns early for this code with status `skipped` and reason `temporarily disabled`. Later in the same file there is a large bond-composite implementation that is unreachable because of the early return. Separately, `backend/app/api/indicators.py` contains live bond component endpoints that recompute components directly from upstream sources.

**Why this matters.** A high-weight, methodologically central indicator is absent from the main ETL path. The composite scoring function then renormalizes weights over available indicators, hiding the absence unless the UI explicitly surfaces missing coverage. The presence of unreachable bond logic and separate live component logic also creates formula drift risk.

**Validity impact.** Very high. The advertised market-stability model and the actual model can diverge. The fixed-income stress anchor may not affect the system state at all, even though documentation and UI suggest it does.

**Recommended fix.** Choose one of two paths immediately:

- Re-enable Bond Market Stability with a canonical service and cached ETL, tested against fixed fixtures.
- Temporarily remove it from the composite or set weight to zero until it is reliable, while showing a conspicuous methodology note.

Then delete unreachable legacy logic or move it into a tested canonical service.

## Critical finding 4: statistical look-ahead bias in the scoring layer

**Evidence.** `backend/app/services/analytics_stub.py` defines `compute_z_scores(values, lookback=252)` by taking the final lookback window of the full array and using that mean and standard deviation to normalize every point in the series. This function is used by ETL normalization paths.

**Why this matters.** Historical values are normalized using future information. A value from 2024 can be scored using 2026 distributional information. This restates history every time new data arrives and makes historical drift analysis unreliable. It also undermines backtests, regime charts, and any statement about how the system would have behaved at a prior date.

**Validity impact.** Very high for history and backfill. Current-date scoring is less affected, but any historical score series is suspect.

**Recommended fix.** Replace the function with a true rolling or expanding z-score that uses only observations available up to each timestamp. Add tests that intentionally perturb future observations and assert that earlier z-scores do not change.

## Critical finding 5: Tailwind design-token drift breaks visual continuity

**Evidence.** `frontend/tailwind.config.js` defines `stealth` colors only at keys `700`, `750`, `800`, `850`, and `900`. Many components and global styles use classes such as `text-stealth-100`, `text-stealth-200`, `text-stealth-300`, `text-stealth-400`, `text-stealth-500`, `border-stealth-600`, and `bg-stealth-950`. These include `Topbar.tsx`, `Dashboard.tsx`, and `index.css` component classes.

**Why this matters.** Tailwind will not generate CSS for undefined utility classes. This produces silent styling gaps. Text, borders, backgrounds, hover states, and active navigation states can render incorrectly or inconsistently across pages.

**Visual impact.** Very high. The repository has a strong visual vocabulary, but the token mismatch prevents it from being reliably applied.

**Recommended fix.** Define a complete `stealth` scale from `50` to `950`, or replace all undefined utilities with existing tokens. Add a static test that scans class strings for Tailwind color tokens and fails when referenced tokens are missing.

## Critical finding 6: runtime schema mutation instead of migration discipline

**Evidence.** `backend/app/main.py` calls `Base.metadata.create_all(bind=engine)`, `ensure_aas_indicator_code(engine)`, and `ensure_signal_attribution_columns(engine)` at import/startup time. `backend/app/services/schema_patches.py` uses raw `ALTER TABLE` statements to add columns if missing. `alembic` is included in requirements, but runtime mutation still exists.

**Why this matters.** Runtime schema mutation makes deployment order ambiguous, complicates rollback, and can create races under multiple workers. It also blurs the boundary between application startup and database migration.

**Validity impact.** Medium to high. Schema drift and race conditions can corrupt or partially update production state.

**Recommended fix.** Move all schema changes into Alembic migrations. Remove `create_all` and schema patch calls from application import/startup. Add a deployment step that runs `alembic upgrade head` before the app starts.

## Critical finding 7: composite score hides data coverage and freshness

**Evidence.** `backend/app/utils/system_scoring.py` filters out missing scores and renormalizes available indicator weights to sum to one. `backend/app/api/status.py` uses this function for `/system` and `/system/history`. The response does not consistently expose missing indicators, stale indicators, coverage ratio, or confidence.

**Why this matters.** Renormalization is not inherently wrong, but it must be visible. If core high-weight indicators are absent or stale, the dashboard should say the read is lower confidence. Otherwise, a composite can appear clean and precise when the data foundation is incomplete.

**Validity impact.** High. The stated philosophy is to make the market read hard to misinterpret. Silent reweighting makes it easier to misinterpret.

**Recommended fix.** Return coverage metadata with every composite: expected indicators, available indicators, missing indicators, stale indicators, coverage ratio, core coverage ratio, weights used, and confidence label. Consider penalizing missing core indicators or refusing to classify the state when core coverage is below a threshold.

## Critical finding 8: production deployment is development-like

**Evidence.** `docker-compose.yml` bind-mounts backend and frontend source paths into containers, exposes backend `8000` on all interfaces, exposes frontend Vite preview on all interfaces, and runs the frontend with `pnpm preview`. `frontend/Dockerfile` also uses Vite preview as the container command. Vite documentation states that `vite preview` is intended for local previewing of a build and is not meant as a production server.

**Why this matters.** The current topology increases operational risk and weakens reproducibility. Vite preview is useful for local inspection but should not be the public production web server. Source bind mounts also make the image less immutable.

**Operational impact.** High. This can create deployment fragility, inconsistent builds, and avoidable exposure of backend surfaces.

**Recommended fix.** Build the frontend into static assets and serve them with Nginx, Caddy, Cloudflare Pages, or another production-grade static server. Proxy `/api` through that server. Remove source bind mounts in production compose. Expose backend only on an internal Docker network or behind a reverse proxy. Keep a separate `docker-compose.dev.yml` for live-mounted development.

# Additional findings

## Configuration and security

- `CORS_ORIGINS` defaults to `*`, and the app configures CORS with `allow_credentials=True`. This should fail closed in production. A production deployment should enumerate trusted origins.
- `Settings` defaults `DATABASE_URL` to local SQLite, while the stack is documented as PostgreSQL. A production-like app should require `DATABASE_URL` or explicitly select an environment mode.
- `Settings.Config.extra = "allow"` permits unexpected environment variables. This can be acceptable for flexibility but weakens configuration contracts.
- GPT action endpoints in `actions.py` are much better protected than admin endpoints: they require bearer keys and fail closed when keys are missing. Admin endpoints should follow the same pattern.
- Token comparisons for action keys use direct string comparison. This is usually minor in this context, but `hmac.compare_digest` is a low-cost improvement.
- There is no visible rate limiting for expensive endpoints.
- There is no visible CSRF strategy for state-changing browser-accessible routes. If credentials or cookies are later introduced, this becomes important.

## Backend architecture

- `backend/app/api/indicators.py` is too large and mixes routing, upstream fetching, numerical methods, and response construction. Several component endpoints perform live upstream data fetching. This should be moved into services with cached, testable calculation functions.
- Indicator formulas are duplicated across ETL and API component endpoints. Duplication invites drift.
- The `analytics_stub.py` filename and legacy `compute_score` / `compute_state` stubs suggest an unfinished quant layer. Production code should not depend on a module named stub.
- The FRED and Yahoo clients lack retry/backoff/circuit-breaker behavior and do not appear to store source provenance with indicator values.
- In-memory caches in services such as `energy_index.py` are per-process. With multiple workers, cache state is inconsistent.
- Some log strings contain garbled placeholders in `scheduler.py` around precious metals ingestion. This is minor technically but reduces operational clarity.

## Data model

- `IndicatorValue` has no unique constraint on `(indicator_id, timestamp)`. ETL reruns and duplicate scheduler processes can create multiple values for the same logical observation.
- There is no visible data provenance model for indicator values. At minimum, each stored value should include source, source symbol, observation timestamp, fetch timestamp, transformation version, and calculation version.
- The response shape for `/system` differs depending on whether a dynamic composite is available or fallback `SystemStatus` is used. Fallback omits fields like `green_count` and `total_count` that are returned in the dynamic path.
- Frontend `IndicatorStatus` declares numeric fields as non-null, but backend response helpers return `null` when no value exists. This is a type-contract mismatch.

## Frontend architecture

- Routes, topbar navigation, and analytics page labels are duplicated across separate structures. This invites drift.
- There is no catch-all 404 route.
- Several pages or tools appear to exist without a current route, including historical or orphaned tools such as `DebtTools`, `CryptoDiagnostic`, `PreciousMetalsDiagnostic`, and `Updates.tsx` based on search results. Some may be intentionally archived, but they should be classified.
- `apiUtils.ts` offers `apiFetch`, but `Dashboard.tsx` performs direct fetches and manual error swallowing. API access should be centralized.
- `checkApiHealth()` requests `/api/`, which may not map to a backend health route. Use `/api/health` or the actual health path.
- The manual refresh button uses a fixed one-second sleep after triggering ETL. Long-running jobs need an enqueue/status/polling model, not a fixed delay.

## Visual design and continuity

The design direction is strong: dark instrument-panel surfaces, restrained gradients, rounded cards, state colors, badges, and a coherent market-terminal tone. `index.css` defines reusable page shells, cards, hero blocks, badges, and control strips.

The main continuity problems are enforcement problems:

- Missing Tailwind tokens cause silent class failures.
- Visual primitives exist, but there is no visible component library, Storybook, or screenshot regression suite.
- Pages likely use a mix of global component classes and local ad hoc utility strings.
- Navigation dropdown interaction is hover/click based but lacks robust keyboard behavior, Escape handling, focus trapping, and outside-click closure.
- Color is heavily used to encode state; every state badge should also include text labels and accessible names.
- Stale CSS exists for `.weather-research-chart` while the weather research route redirects elsewhere.

## Documentation

- The README is clear and product-oriented, but many repository links are Windows absolute local paths such as `c:/Users/...`. These links are broken for external readers and agents.
- The README notes that the repository is public but source-available only, while the GitHub page metadata describes the project as open-source. This is a messaging inconsistency. The license section should be the authoritative language.
- The indicator methodology needs a single canonical specification. Each indicator should have a documented source, formula, direction, normalization method, freshness horizon, weight, missing-data policy, and validation test.

# Validity and accuracy evaluation

## Domain validity

The selected indicators are reasonable for a broad market-regime dashboard. Volatility, equity trend, breadth, Treasury curve, unemployment, consumer health, credit/bond stability, liquidity, analyst confidence, sentiment, sector alignment, and alternative assets form a defensible cross-asset regime framework. The inclusion of agriculture, energy, real estate, and alternative assets is compatible with the stated objective of broader market context.

The domain risk is not indicator choice; it is model enforcement. The code needs a canonical methodology layer to prevent formula drift and missing-indicator invisibility.

## Statistical validity

Current statistical validity is impaired by the look-ahead normalization issue. Historical scores should be computed with data available at the time. Using a final-window mean and standard deviation for every point invalidates historical drift, backfilled histories, and any retrospective claims about regime transitions.

The score map is also quite coarse: z-scores are clipped to a bounded 0-100 scale with simple thresholds. This is acceptable for a diagnostic dashboard if the transformation is transparent, stable, and tested. It is not acceptable if users interpret the output as an exact predictive model.

Recommended statistical controls:

- True rolling or expanding normalization.
- Per-indicator monotonicity tests.
- Fixture-based expected-score tests.
- No-future-leak tests.
- Versioned calculation metadata.
- Confidence penalties for stale or missing core signals.
- A documented distinction between descriptive diagnostics and predictive claims.

## Data accuracy

The system depends on external sources that can be delayed, rate-limited, structurally changed, or unavailable. Current clients have limited retry/caching/provenance behavior. Live upstream fetches inside API endpoints also make endpoint responses sensitive to transient provider behavior.

Data accuracy should be improved by separating ingestion from presentation:

1. Ingestion fetches external data, stores raw observations and provenance.
2. Calculation services compute canonical values from stored observations.
3. API endpoints read cached values and expose source/provenance metadata.
4. Live upstream fetching is limited to operator tools or background jobs.

## Interpretability

The product goal is interpretability. The UI and README emphasize a clean regime read. However, interpretability is currently weaker than it should be because missing data, stale data, formula versions, and coverage are not systematically exposed.

Every composite should answer:

- Which indicators were expected?
- Which were used?
- Which were missing or stale?
- Were weights renormalized?
- What is the confidence of this read?
- What changed since the prior read?

# Visual continuity evaluation

The application has a recognizable visual system. The dark gradient shell, rounded cards, badges, market-state colors, and compact typographic style create a coherent identity. However, continuity is not guaranteed because the design system is not encoded as a complete token contract.

Immediate visual fixes:

1. Complete the Tailwind `stealth` palette.
2. Add a token lint test.
3. Centralize recurring card, badge, page header, and control components.
4. Build visual regression tests across the main route set.
5. Add accessibility scans for color contrast, focus order, keyboard navigation, and state semantics.

Suggested route screenshot set:

- `/`
- `/indicators`
- `/system-breakdown`
- `/market-map`
- `/sector-projections`
- `/stock-analysis`
- `/alternative-assets`
- `/aas-breakdown`
- `/tools/recap`
- `/news`
- `/agriculture`
- `/energy`
- `/real-estate`

Suggested breakpoints:

- 375px mobile
- 768px tablet
- 1440px desktop
- 1600px wide dashboard

# Test plan

## Backend unit tests

1. `analytics_no_future_leak_test`: Changing future observations must not change earlier z-scores.
2. `analytics_monotonicity_test`: For stress indicators, increasing stress should not increase stability score.
3. `system_scoring_coverage_test`: Missing high-weight indicators must reduce coverage/confidence and be reported.
4. `indicator_value_upsert_test`: Re-ingesting the same logical observation must update or no-op, not duplicate.
5. `bond_model_fixture_test`: Bond composite output should match fixed fixture expectations.
6. `liquidity_model_fixture_test`: Liquidity proxy should match fixed fixture expectations.
7. `sentiment_model_fixture_test`: Sentiment composite should match fixed fixture expectations, including staleness weighting.
8. `admin_auth_test`: Admin endpoints return 401 without the configured key.
9. `fred_client_retry_test`: Mock 429/500/provider errors and assert backoff behavior.
10. `scheduler_lock_test`: Two scheduler instances cannot run the same job concurrently.

## Backend API tests

1. `/system` returns complete schema including coverage metadata.
2. `/system/history` uses no future leakage and includes freshness metadata.
3. `/indicators` returns nullable fields consistent with frontend types.
4. `/admin/*` rejects unauthenticated calls.
5. `/actions/*` continues to fail closed when keys are absent.
6. Component endpoints and ETL service calculations agree on canonical formulas.

## Frontend unit and component tests

1. Route registry generates `App` routes, Topbar navigation, and analytics names from one source.
2. Dashboard handles loading, null indicator values, failed fetches, and refresh-disabled states.
3. `apiUtils` builds URLs consistently and health checks the correct endpoint.
4. Topbar supports keyboard navigation and closes on Escape/outside click.
5. State badges include text and accessible labels, not color alone.
6. Token lint test fails if a class references a missing Tailwind color token.

## End-to-end tests

Use Playwright with a mocked backend or seeded test backend.

1. Every public route loads without uncaught browser errors.
2. Navigation works on desktop and mobile.
3. Dashboard displays system read, widgets, indicator cards, and error states.
4. Public users cannot trigger admin ingestion.
5. Recap pages render markdown safely and legibly.
6. Visual snapshots remain within a small threshold across key routes and breakpoints.

## Security tests

1. Admin endpoints require bearer key.
2. CORS rejects untrusted origins in production mode.
3. State-changing endpoints reject missing/invalid credentials.
4. Rate limits are enforced for expensive endpoints.
5. Secret scanning passes on repo and images.
6. Docker images run as non-root and expose only required ports.

## CI gates

Minimum CI gates:

```bash
cd backend && pytest -q
cd frontend && pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint
```

Recommended added gates:

```bash
cd backend && ruff check . && mypy app
cd frontend && pnpm playwright test
```

# Remediation roadmap

## Phase 0: prevent damage

- Protect admin endpoints.
- Disable public Dashboard refresh or gate it behind operator authentication.
- Prevent duplicate scheduler execution.
- Add uniqueness constraint for indicator values.
- Fix Tailwind token drift.

## Phase 1: restore model validity

- Re-enable or formally remove Bond Market Stability from the composite.
- Replace look-ahead normalization with rolling/expanding normalization.
- Add coverage/freshness/confidence metadata.
- Add canonical indicator specs and fixture tests.

## Phase 2: harden operations

- Move schema changes to Alembic.
- Split scheduler worker from web service.
- Pin Python dependencies.
- Replace Vite preview production serving.
- Add retry/backoff/provenance to data clients.

## Phase 3: enforce visual and product coherence

- Centralize route registry.
- Build component primitives for cards, badges, controls, and page headers.
- Add Playwright E2E and visual regression.
- Add accessibility scans.
- Remove or archive orphaned routes/tools.

# Conclusion

The Market Diagnostic Dashboard has a coherent product thesis and a useful cross-asset information architecture. Its main problems are not a lack of ambition or domain imagination. They are enforcement gaps: missing auth around mutation surfaces, scheduler duplication risk, incomplete design tokens, statistical look-ahead bias, inconsistent formula ownership, and inadequate test gates for a data-driven diagnostic system.

The highest-return intervention is a two-week hardening sprint focused on scheduler separation, admin auth, Bond Market Stability disposition, rolling normalization, composite coverage metadata, and Tailwind token repair. After that, the system should add canonical indicator fixtures and visual regression tests so the dashboard remains accurate, interpretable, and visually continuous as new market pages are added.

# References

- Repository: https://github.com/meyer-s/Market-Diagnostic-Dashboard
- Production site listed in README: https://marketdiagnostictool.com
- Vite static deployment documentation: https://vite.dev/guide/static-deploy.html
