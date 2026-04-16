# Discord

This document covers the Discord integration in one place: setup, architecture, endpoints, and operational notes.

## Scope

The current Discord integration supports slash-command driven options sweeps through the backend.

Implemented endpoints in `backend/app/api/discord.py`:

- `POST /discord/interactions`
- `GET /discord/health`

The router is included in `backend/app/main.py`.

## What The Bot Does

The bot is designed around a `/sweep` workflow that triggers the existing options scanning logic and responds asynchronously in Discord.

Current behavior:

- accepts slash-command interactions from Discord
- acknowledges quickly so it stays within Discord's response window
- runs the sweep in a background task
- posts formatted follow-up results back to Discord

## Required Configuration

Environment variables:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_SWEEP_STATUS_EVERY_TICKERS` optional, default `100`
- `DISCORD_SWEEP_STATUS_MIN_SECONDS` optional, default `60`
- `DISCORD_SWEEP_PAUSE_SECONDS` optional, overrides the scanner pause between yfinance ticker requests

The token is used for follow-up messages. The public key is used to verify Discord signatures.

Store runtime values in the backend environment file under `devops/env` or in the deployment environment you actually use.

## Discord App Setup

In the Discord developer portal:

1. Create or open the application.
2. Create the bot user.
3. Copy the public key.
4. Set the interactions endpoint URL to your deployed backend route.
5. Register the slash command.
6. Invite the bot with `bot` and `applications.commands` scopes.

The interactions endpoint must point at your deployed backend, not a local development server.

## Registering Commands

Use the registration script in `backend/register_discord_commands.py`.

Example:

```bash
export DISCORD_BOT_TOKEN="your_token_here"
python backend/register_discord_commands.py
```

If commands do not appear immediately, allow time for Discord propagation.

## Request Flow

The request path is straightforward:

1. A user runs `/sweep` in Discord.
2. Discord sends an interaction payload to `POST /discord/interactions`.
3. The backend verifies the request and returns a deferred response.
4. A background job runs the options sweep.
5. The backend posts sweep-start, periodic progress, rate-limit warning, and final follow-up messages through the Discord API.

The active sweep logic lives in `backend/app/services/discord_sweep_simple.py` and reuses `backend/maintenance_scripts/options_chain_sweep.py`.

Progress updates are emitted every `DISCORD_SWEEP_STATUS_EVERY_TICKERS` scanned symbols or after `DISCORD_SWEEP_STATUS_MIN_SECONDS`, whichever threshold is reached first. If yfinance raises repeated rate-limit-style errors, the bot posts a separate warning with the current scan count, hit count, error count, and configured pause.

## Operational Notes

Health check:

```bash
curl http://localhost:8000/discord/health
```

Typical log checks:

```bash
docker compose logs backend --tail 100
```

Watch for:

- missing bot token
- signature verification failures
- Discord API errors on follow-up messages
- upstream data fetch issues during the sweep

## Security Notes

- Keep the bot token out of committed files.
- Verify Discord signatures in production.
- Use HTTPS for the public interactions endpoint.
- Treat the Discord app configuration as deployment-specific, not repo-specific.

## Troubleshooting

If the bot does not respond:

1. Check that `DISCORD_BOT_TOKEN` is present in the backend environment.
2. Confirm the interactions URL points to the correct deployed backend.
3. Check backend logs for signature or webhook errors.
4. Re-run the command registration script if the slash command is missing.

If the backend passes health checks but follow-up messages fail:

1. Verify the bot token has not been rotated.
2. Verify the bot still has permission to post in the target server.
3. Inspect backend logs for Discord API error responses.
