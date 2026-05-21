---
title: "Market Diagnostic Dashboard - Machine-Readable Implementation Plan"
author: "Static audit prepared by GPT-5.5 Pro"
date: "2026-05-21"
format_version: "1.0"
---

# Implementation plan

```yaml
metadata:
  repository: "meyer-s/Market-Diagnostic-Dashboard"
  audit_date: "2026-05-21"
  plan_version: "1.0"
  goal: "Implement fixes and tests from the static codebase audit."
  execution_assumptions:
    - "Coding agent has repository checkout with write access."
    - "Coding agent can run backend and frontend tests locally or in CI."
    - "Do not change financial methodology silently; add tests and documentation when changing model behavior."
    - "Prefer small, reviewable commits grouped by task id."
  global_acceptance_criteria:
    - "Backend tests pass: cd backend && pytest -q"
    - "Frontend build and tests pass: cd frontend && pnpm build && pnpm test"
    - "Frontend lint passes after adding/fixing ESLint config: cd frontend && pnpm lint"
    - "No unauthenticated public endpoint can mutate production data."
    - "No duplicate scheduler jobs can run under multiple web workers."
    - "No undefined Tailwind stealth color utilities remain."
    - "Composite system status exposes data coverage and freshness metadata."
```

## Tasks

```yaml
tasks:
  - id: "SEC-001"
    title: "Protect admin endpoints"
    priority: "P0"
    severity: "critical"
    category: "security"
    files:
      modify:
        - "backend/app/core/config.py"
        - "backend/app/api/admin.py"
      create:
        - "backend/app/api/deps.py"
        - "backend/tests/test_admin_auth.py"
    implementation:
      - "Add ADMIN_API_KEY: Optional[str] = None to Settings."
      - "Create require_admin_key dependency that reads Authorization header."
      - "Dependency must fail closed: if ADMIN_API_KEY is empty, return HTTP 500 for admin calls."
      - "Require Bearer token and compare using hmac.compare_digest."
      - "Attach dependency to admin router or each admin endpoint."
      - "Do not apply this dependency to health or public read-only routes."
    tests:
      - "POST /admin/ingest/run without Authorization returns 401 when ADMIN_API_KEY is set."
      - "POST /admin/ingest/run with wrong Bearer token returns 401."
      - "POST /admin/ingest/run with correct Bearer token reaches handler."
      - "If ADMIN_API_KEY is unset, admin endpoint returns 500 and does not run ingestion."
    acceptance:
      - "Dashboard-origin unauthenticated calls cannot trigger ingestion."
      - "All admin endpoints require auth."

  - id: "SEC-002"
    title: "Remove public browser trigger for full ingestion"
    priority: "P0"
    severity: "critical"
    category: "security_frontend"
    files:
      modify:
        - "frontend/src/pages/Dashboard.tsx"
        - "frontend/src/utils/apiUtils.ts"
    implementation:
      - "Remove the public Refresh Data button, or render it only when a safe operator mode flag is set."
      - "If keeping operator refresh, call an authenticated operator endpoint through a secure server-side path, not from public unauthenticated browser state."
      - "Replace fixed one-second delay with job enqueue/status polling if manual refresh remains."
      - "Display explicit disabled or read-only state for ordinary visitors."
    tests:
      - "Dashboard renders without a public ingestion trigger by default."
      - "No unauthenticated fetch to /admin/ingest/run is made in frontend tests."
    acceptance:
      - "A public user cannot trigger /admin/ingest/run from the UI."

  - id: "OPS-001"
    title: "Split scheduler from web workers"
    priority: "P0"
    severity: "critical"
    category: "operations"
    files:
      modify:
        - "backend/app/main.py"
        - "backend/app/services/scheduler.py"
        - "backend/startup.sh"
        - "docker-compose.yml"
      create:
        - "backend/app/services/scheduler_worker.py"
        - "backend/tests/test_scheduler_singleton.py"
    implementation:
      - "Remove unconditional start_scheduler() from FastAPI lifespan."
      - "Introduce RUN_SCHEDULER env gate; web process starts scheduler only when RUN_SCHEDULER=true."
      - "Create scheduler_worker.py that starts scheduler and blocks until shutdown signal."
      - "Add a separate scheduler service in docker-compose.yml using the same backend image."
      - "Set RUN_SCHEDULER=false for backend web service and true for scheduler service."
      - "Prefer UVICORN_WORKERS configurable but do not let multiple web workers run scheduler."
      - "Add database advisory lock or lock table around scheduled_etl_job and market diagnostic publishing."
    tests:
      - "When RUN_SCHEDULER is false, FastAPI lifespan does not call start_scheduler."
      - "When two scheduler instances attempt the same ETL job, only one acquires lock."
      - "Startup ETL is not duplicated by web workers."
    acceptance:
      - "Only one process can run scheduled jobs in production."

  - id: "DB-001"
    title: "Move schema management to Alembic"
    priority: "P0"
    severity: "critical"
    category: "database"
    files:
      modify:
        - "backend/app/main.py"
        - "backend/app/services/schema_patches.py"
      create_or_modify:
        - "backend/alembic/versions/*.py"
        - "backend/alembic.ini"
    implementation:
      - "Create Alembic revisions for current schema if not present."
      - "Move ensure_aas_indicator_code and ensure_signal_attribution_columns logic into migration revisions."
      - "Remove Base.metadata.create_all(bind=engine) from app import/startup path."
      - "Deployment must run alembic upgrade head before starting services."
      - "Keep seed_indicators.py for metadata seeding only, not table creation."
    tests:
      - "Fresh database migrates from base to head."
      - "Existing database with legacy AAS indicator migrates cleanly."
      - "Application import does not mutate schema."
    acceptance:
      - "No runtime DDL occurs during app import."

  - id: "DB-002"
    title: "Add uniqueness and upsert semantics for indicator values"
    priority: "P0"
    severity: "critical"
    category: "database"
    files:
      modify:
        - "backend/app/models/indicator_value.py"
        - "backend/app/services/ingestion/etl_runner.py"
      create_or_modify:
        - "backend/alembic/versions/*.py"
        - "backend/tests/test_indicator_value_upsert.py"
    implementation:
      - "Add unique constraint or unique index on (indicator_id, timestamp)."
      - "Update ETL writes to upsert by indicator_id and timestamp."
      - "Normalize timestamp precision before upsert to prevent microsecond duplicates."
      - "Decide whether observation timestamp is date-level or datetime-level for each data source."
    tests:
      - "Running identical ingestion twice does not create duplicate IndicatorValue rows."
      - "Running duplicate scheduler jobs cannot create duplicate logical observations."
    acceptance:
      - "Duplicate logical values are impossible at database level."

  - id: "MODEL-001"
    title: "Replace look-ahead z-score normalization"
    priority: "P0"
    severity: "critical"
    category: "model_validity"
    files:
      modify:
        - "backend/app/services/analytics_stub.py"
        - "backend/app/services/ingestion/etl_runner.py"
      create:
        - "backend/tests/test_analytics_no_future_leak.py"
    implementation:
      - "Rename analytics_stub.py to analytics.py or quant.py after updating imports."
      - "Implement compute_rolling_z_scores(values, lookback=252, min_periods=30)."
      - "For index i, compute mean/std only from values[max(0, i-lookback+1):i+1]."
      - "If fewer than min_periods are available, use expanding window or return neutral z=0 according to documented policy."
      - "Ensure map_z_to_score remains bounded [0,100]."
      - "Deprecate or remove legacy compute_score and compute_state stubs."
    tests:
      - "Changing values after index k does not change z-scores at indices <= k."
      - "Scores are bounded [0,100]."
      - "Direction inversion is monotonic for stress indicators."
      - "Constant series produces neutral scores without NaN/Inf."
    acceptance:
      - "Historical scoring has no future leakage."

  - id: "MODEL-002"
    title: "Resolve Bond Market Stability status"
    priority: "P0"
    severity: "critical"
    category: "model_validity"
    files:
      modify:
        - "backend/app/services/ingestion/etl_runner.py"
        - "backend/seed_indicators.py"
        - "backend/app/api/indicators.py"
      create:
        - "backend/app/services/bond_market_stability.py"
        - "backend/tests/test_bond_market_stability.py"
    implementation_options:
      preferred:
        - "Move bond formula into bond_market_stability.py as canonical calculation service."
        - "ETL and component endpoints must call the same service."
        - "Remove early return that skips BOND_MARKET_STABILITY."
        - "Cache upstream data or compute from stored observations where possible."
        - "Add fixture tests for credit, curve, momentum, volatility, and composite output."
      fallback:
        - "Set BOND_MARKET_STABILITY weight to 0.0 or exclude it from composite until implemented."
        - "Expose a visible methodology warning that the indicator is disabled."
    tests:
      - "ETL ingests BOND_MARKET_STABILITY or it is explicitly excluded with weight 0."
      - "Component endpoint and ETL produce matching composite values for the same fixture."
      - "No unreachable bond logic remains in etl_runner.py."
    acceptance:
      - "The documented core model and runtime model agree."

  - id: "MODEL-003"
    title: "Expose composite coverage, freshness, and confidence"
    priority: "P0"
    severity: "high"
    category: "model_validity"
    files:
      modify:
        - "backend/app/utils/system_scoring.py"
        - "backend/app/api/status.py"
        - "backend/app/utils/response_helpers.py"
        - "frontend/src/types/index.ts"
        - "frontend/src/components/widgets/SystemOverviewWidget.tsx"
    implementation:
      - "Extend compute_weighted_composite to return composite_score, weights_used, coverage_ratio, missing_codes, stale_codes, and confidence."
      - "Define freshness horizon per indicator in metadata or a config table."
      - "Mark core indicators separately from secondary indicators."
      - "If core coverage is below threshold, return state UNKNOWN or LOW_CONFIDENCE instead of GREEN/YELLOW/RED."
      - "Update frontend to show coverage and stale/missing indicators."
    tests:
      - "Missing high-weight indicator lowers coverage and confidence."
      - "Stale indicator is reported."
      - "Weights used are returned and sum to 1 only among included indicators."
      - "Frontend renders low-confidence state."
    acceptance:
      - "No composite score is returned without its coverage context."

  - id: "MODEL-004"
    title: "Create canonical indicator specification"
    priority: "P1"
    severity: "high"
    category: "model_documentation"
    files:
      create:
        - "docs/indicator-specification.md"
        - "backend/app/services/indicator_specs.py"
        - "backend/tests/test_indicator_specs.py"
    implementation:
      - "For each indicator, document source, formula, direction, normalization, freshness horizon, weight, missing-data policy, and expected state thresholds."
      - "Represent specs in a typed Python structure used by seed_indicators.py."
      - "Do not let seed_indicators.py and docs diverge."
    tests:
      - "Every seeded indicator has a spec."
      - "Every spec has formula_version and freshness_horizon."
      - "Docs generation from specs succeeds if implemented."
    acceptance:
      - "A coding agent can determine exact methodology from one canonical source."

  - id: "FE-001"
    title: "Fix Tailwind stealth color scale"
    priority: "P0"
    severity: "critical"
    category: "visual"
    files:
      modify:
        - "frontend/tailwind.config.js"
      create:
        - "frontend/scripts/check-tailwind-tokens.mjs"
        - "frontend/src/utils/__tests__/tailwindTokens.test.ts"
    implementation:
      - "Add stealth color keys 50,100,200,300,400,500,600,700,750,800,850,900,950."
      - "Choose values consistent with existing dark palette."
      - "Scan src/**/*.{ts,tsx,css} for class tokens containing stealth-*."
      - "Fail if any referenced token is absent from tailwind.config.js."
      - "Run pnpm build to ensure generated CSS includes used classes."
    tests:
      - "Token checker passes."
      - "pnpm build passes."
    acceptance:
      - "No undefined stealth Tailwind utilities remain."

  - id: "FE-002"
    title: "Centralize route, navigation, and analytics registry"
    priority: "P1"
    severity: "medium"
    category: "frontend_architecture"
    files:
      modify:
        - "frontend/src/App.tsx"
        - "frontend/src/components/layout/Topbar.tsx"
      create:
        - "frontend/src/routes/registry.tsx"
        - "frontend/src/routes/__tests__/registry.test.tsx"
    implementation:
      - "Create route registry with path, label, component, navGroup, analyticsName, and visibility."
      - "Generate App routes from registry."
      - "Generate Topbar nav and Tools dropdown from registry."
      - "Generate analytics page name from registry."
      - "Add catch-all 404 route."
      - "Classify orphaned pages as routed, archived, or deleted."
    tests:
      - "Every nav item has an App route."
      - "Every route has analyticsName."
      - "Unknown route renders 404."
    acceptance:
      - "Route, nav, and analytics labels cannot drift independently."

  - id: "FE-003"
    title: "Centralize API fetching and response types"
    priority: "P1"
    severity: "medium"
    category: "frontend_architecture"
    files:
      modify:
        - "frontend/src/utils/apiUtils.ts"
        - "frontend/src/pages/Dashboard.tsx"
        - "frontend/src/types/index.ts"
    implementation:
      - "Update IndicatorStatus raw_value and score to number | null."
      - "Use apiFetch for dashboard indicators and news."
      - "Surface user-visible error states instead of swallowing errors."
      - "Fix checkApiHealth to use the actual health endpoint."
      - "Remove getLegacyApiUrl or make it delegate to getApiUrl consistently."
    tests:
      - "Dashboard handles null score/raw_value."
      - "Dashboard shows failed-load state."
      - "apiUtils health check calls correct endpoint."
    acceptance:
      - "Frontend type contracts match backend responses."

  - id: "FE-004"
    title: "Add accessibility and keyboard behavior to Topbar"
    priority: "P1"
    severity: "medium"
    category: "accessibility"
    files:
      modify:
        - "frontend/src/components/layout/Topbar.tsx"
      create:
        - "frontend/src/components/layout/Topbar.test.tsx"
    implementation:
      - "Support keyboard open/close for Tools dropdown."
      - "Close dropdown on Escape and outside click."
      - "Provide focus-visible styles."
      - "Ensure mobile menu active-state uses startsWith for nested routes."
      - "Add aria-current to active links."
    tests:
      - "Keyboard can open Tools menu and activate item."
      - "Escape closes Tools menu."
      - "Active nested tool route is marked active."
    acceptance:
      - "Navigation is usable without a mouse."

  - id: "TEST-001"
    title: "Add frontend visual regression suite"
    priority: "P1"
    severity: "high"
    category: "testing_visual"
    files:
      create:
        - "frontend/playwright.config.ts"
        - "frontend/tests/visual/routes.spec.ts"
    implementation:
      - "Install and configure Playwright."
      - "Mock backend API responses or run against seeded local backend."
      - "Screenshot main routes at 375, 768, 1440, and 1600 widths."
      - "Fail on console errors."
      - "Store baseline screenshots."
    routes:
      - "/"
      - "/indicators"
      - "/system-breakdown"
      - "/market-map"
      - "/sector-projections"
      - "/stock-analysis"
      - "/alternative-assets"
      - "/aas-breakdown"
      - "/tools/recap"
      - "/news"
      - "/agriculture"
      - "/energy"
      - "/real-estate"
    tests:
      - "Each route loads without console errors."
      - "Screenshots match baseline within threshold."
    acceptance:
      - "Visual continuity is test-enforced."

  - id: "OPS-002"
    title: "Harden production deployment"
    priority: "P1"
    severity: "high"
    category: "deployment"
    files:
      modify:
        - "docker-compose.yml"
        - "backend/Dockerfile"
        - "frontend/Dockerfile"
      create:
        - "docker-compose.dev.yml"
        - "frontend/nginx.conf"
        - "devops/env/backend.env.example"
        - "devops/env/frontend.env.example"
        - "devops/env/db.env.example"
    implementation:
      - "Separate dev bind mounts into docker-compose.dev.yml."
      - "Build frontend static assets and serve with Nginx/Caddy or equivalent."
      - "Proxy /api to backend through frontend/reverse proxy."
      - "Do not expose backend directly on 0.0.0.0 in production."
      - "Run containers as non-root users where practical."
      - "Add healthchecks."
      - "Set CORS_ORIGINS to explicit production origins."
      - "Add .env example files without secrets."
    tests:
      - "Production compose starts without source bind mounts."
      - "Frontend serves static dist."
      - "Backend is reachable only through proxy in production compose."
    acceptance:
      - "Production deployment is immutable and minimally exposed."

  - id: "OPS-003"
    title: "Pin backend dependencies"
    priority: "P1"
    severity: "medium"
    category: "reproducibility"
    files:
      modify:
        - "backend/requirements.txt"
      create_optional:
        - "backend/requirements.in"
    implementation:
      - "Use pip-tools or equivalent to generate pinned requirements."
      - "Preserve current major versions unless tests require migration."
      - "Add constraints for fastapi, sqlalchemy, pydantic, numpy, pandas, scipy, yfinance, httpx, apscheduler, psycopg2-binary."
    tests:
      - "Fresh backend install succeeds."
      - "pytest passes under pinned environment."
    acceptance:
      - "Backend environment is reproducible."

  - id: "OPS-004"
    title: "Add CI workflow"
    priority: "P1"
    severity: "high"
    category: "ci"
    files:
      create:
        - ".github/workflows/ci.yml"
    implementation:
      - "Run backend pytest."
      - "Run frontend pnpm install --frozen-lockfile, pnpm build, pnpm test, pnpm lint."
      - "Add optional ruff/mypy after configs are added."
      - "Add Playwright visual tests after TEST-001."
    tests:
      - "CI passes on clean checkout."
    acceptance:
      - "Pull requests cannot bypass build and unit-test failures."

  - id: "DATA-001"
    title: "Add robust external data clients"
    priority: "P1"
    severity: "medium"
    category: "data_accuracy"
    files:
      modify:
        - "backend/app/services/ingestion/fred_client.py"
        - "backend/app/services/ingestion/yahoo_client.py"
        - "backend/app/services/energy_index.py"
      create:
        - "backend/app/services/ingestion/retry.py"
        - "backend/tests/test_data_clients.py"
    implementation:
      - "Add retry with exponential backoff for transient HTTP errors."
      - "Add rate-limit handling for 429."
      - "Add structured error types with source, series_id/ticker, status_code, and request id if available."
      - "Centralize FRED fetching instead of duplicating requests code in services."
      - "Add source provenance to returned observations."
    tests:
      - "Mock transient HTTP 500 and assert retry."
      - "Mock 429 and assert backoff or classified rate-limit error."
      - "Malformed provider payload returns structured error."
    acceptance:
      - "Provider failures are observable and do not silently corrupt calculations."

  - id: "DOC-001"
    title: "Fix README repository links and license messaging"
    priority: "P2"
    severity: "medium"
    category: "documentation"
    files:
      modify:
        - "README.md"
    implementation:
      - "Replace Windows absolute local links with relative repository links."
      - "Clarify source-available vs open-source wording."
      - "Add a short operator note explaining scheduler/web split after OPS-001."
      - "Add docs links to indicator specification."
    tests:
      - "Markdown link checker passes for internal links."
    acceptance:
      - "External readers and coding agents can navigate docs without local-path links."
```

## Suggested commit order

```yaml
commit_order:
  - ["SEC-001", "SEC-002"]
  - ["OPS-001"]
  - ["DB-001", "DB-002"]
  - ["MODEL-001", "MODEL-002", "MODEL-003"]
  - ["FE-001"]
  - ["FE-002", "FE-003", "FE-004"]
  - ["TEST-001", "OPS-004"]
  - ["OPS-002", "OPS-003", "DATA-001", "DOC-001"]
```

## Required verification commands

```yaml
verification_commands:
  backend_unit:
    command: "cd backend && pytest -q"
    required: true
  frontend_install:
    command: "cd frontend && pnpm install --frozen-lockfile"
    required: true
  frontend_build:
    command: "cd frontend && pnpm build"
    required: true
  frontend_unit:
    command: "cd frontend && pnpm test"
    required: true
  frontend_lint:
    command: "cd frontend && pnpm lint"
    required: true
  visual_regression:
    command: "cd frontend && pnpm playwright test"
    required_after_task: "TEST-001"
  docker_smoke:
    command: "docker compose up --build"
    required_after_task: "OPS-002"
```

## Definition of done

```yaml
definition_of_done:
  security:
    - "No unauthenticated write/admin endpoints."
    - "CORS origins are explicit in production."
  operations:
    - "Scheduler is single-instance and separated from web workers."
    - "Production frontend is not served by vite preview."
  model_validity:
    - "Historical scores use no future information."
    - "Bond Market Stability is either active and tested or explicitly excluded."
    - "Composite responses expose coverage, freshness, and confidence."
  visual:
    - "All Tailwind utilities referenced by source files are defined."
    - "Visual snapshots pass for main routes and breakpoints."
  testing:
    - "CI enforces backend, frontend, lint, and key model-validity tests."
  documentation:
    - "README links are relative and license wording is consistent."
    - "Indicator methodology is documented in one canonical spec."
```
