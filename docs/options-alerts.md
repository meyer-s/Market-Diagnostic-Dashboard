# Options Alerting

This system scans option-chain data and notifies you when a ticker's implied volatility looks cheap.

## Enable alerts

Set these in `devops/env/backend.env`:

- `OPTIONS_ALERTS_ENABLED=true`
- `OPTIONS_ALERT_DISCORD_WEBHOOK=<discord webhook URL>`
- `OPTIONS_ALERT_WEBHOOK_URL=<generic webhook URL>`

If both webhook URLs are empty, alerts are stored but not delivered.

## Watchlist API

Add or update a watch:

```bash
curl -sS -X POST http://127.0.0.1:8000/options-alerts/watchlist \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","iv_percentile_max":20,"cooldown_minutes":1440,"active":true}'
```

List watches:

```bash
curl -sS http://127.0.0.1:8000/options-alerts/watchlist
```

Delete a watch:

```bash
curl -sS -X DELETE http://127.0.0.1:8000/options-alerts/watchlist/1
```

Run a scan manually:

```bash
curl -sS -X POST http://127.0.0.1:8000/options-alerts/run
```

Recent events:

```bash
curl -sS http://127.0.0.1:8000/options-alerts/events?limit=20
```

## Trigger logic

An alert triggers when:

- `iv_percentile` is at or below `iv_percentile_max`
- the watch is active
- the cooldown window has passed since the last alert

Metrics are sourced from Yahoo Finance option chains via `yfinance`.
