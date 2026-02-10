# GPT Action Runner (Market Diagnostic)

This repo includes a narrow, bearer-token-protected endpoint intended for Custom GPT Actions so you can trigger a server-side Market Diagnostic run without exposing the internal `X-Updates-Key` (`UPDATES_PUBLISH_KEY`).

In the current architecture:

- The server fetches cached inputs, calls OpenAI, validates output, and publishes idempotently by slug.
- Chat/Actions are only a trigger/console, not the producer of a publishable payload.

## Setup

1. Generate a dedicated key for GPT Actions:

```bash
openssl rand -hex 32
```

2. Set the env var on the backend (do not commit secrets):

- `GPT_ACTION_RUN_KEY=<your-generated-hex>`
- `OPENAI_API_KEY=<server-only>`

Optional (legacy): `GPT_ACTION_PUBLISH_KEY` protects the older `/api/actions/publish_update` endpoint.

## Endpoint

- `POST /api/actions/run_market_diagnostic`
- Auth: `Authorization: Bearer <GPT_ACTION_RUN_KEY>`

The run is idempotent by `slug` (derived from `run_date_utc`):

- If the slug already exists, it returns `action="skipped"`.
- If a new post is created, it returns `action="posted"`.

## Example curl

```bash
curl -sS -X POST "https://<YOUR_DOMAIN>/api/actions/run_market_diagnostic" \
  -H "Authorization: Bearer <GPT_ACTION_RUN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "run_date_utc": "2026-02-10",
    "dry_run": false,
    "mode": "manual"
  }'
```

## OpenAPI For GPT Builder

1. Open `docs/actions/market_publisher.openapi.yaml`.
2. Replace `https://<YOUR_DOMAIN>` with your real domain.
3. In the GPT Builder UI:
   - Go to Actions
   - Add an Action
   - Paste the OpenAPI schema contents
4. Configure the Action to send the Authorization header:
   - `Authorization: Bearer {{GPT_ACTION_RUN_KEY}}`

## Security Notes

- Do not expose the internal `X-Updates-Key` / `UPDATES_PUBLISH_KEY` to Custom GPT Actions.
- Keep `GPT_ACTION_RUN_KEY` scoped to triggering runs and rotate it independently.
- `OPENAI_API_KEY` must live only on the server (never in GPT Builder secrets that could be exfiltrated).

## Fallback Behavior (Traceable)

If OpenAI generation fails and `dry_run=false`, the server will publish a deterministic fallback post instead of failing the run.

- The post will include tags: `fallback`, `openai-unavailable`.
- The `## Policy/Geo` section will include a clear marker line: `Generation fallback used (OpenAI unavailable).`
- Logs include `generation_mode=model|fallback` and `openai_error_code` when available.

## Market Diagnostic Authoring Contract

Market Diagnostic posts are validated server-side to enforce the Risk Regime structure. The contract is:

- Slug must be `market-diagnostic-YYYY-MM-DD`.
- Content must follow the required headings and section rules.
- Every bullet must end with a URL source: `(Source: https://...)`.

Template: `docs/market_diagnostic_template.md`.

## Web Search Sources

The Market Diagnostic runner now uses OpenAI web search to attach real URL sources to each datapoint. If web search fails, the fallback still emits URL sources so every datapoint has a clickable tag.
