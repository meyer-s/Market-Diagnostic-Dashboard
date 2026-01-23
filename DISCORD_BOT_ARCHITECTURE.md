# Discord Bot Architecture & Flow

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord Server                          │
│                                                                 │
│  User types: /sweep symbol:SPY                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ HTTP POST (slash command interaction)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Port 8000)                  │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  POST /discord/interactions                            │   │
│  │  - Verify signature                                    │   │
│  │  - Handle PING (type 1) → PONG                        │   │
│  │  - Handle /sweep (type 2) → Deferred Response         │   │
│  │  - Launch background task                             │   │
│  └──────────────────┬─────────────────────────────────────┘   │
│                     │                                           │
│                     │ Background Task                           │
│                     ▼                                           │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  discord_sweep.execute_sweep()                         │   │
│  │  1. Fetch ETF holdings (IVV/IWM)                      │   │
│  │  2. Scan tickers for cheap options                    │   │
│  │  3. Format results as Discord embed                   │   │
│  │  4. Send followup message via Discord API             │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                         │
                         │ HTTP POST (followup message)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Discord API (Webhook)                       │
│                                                                 │
│  POST /webhooks/{app_id}/{interaction_token}                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Message delivered
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Discord Server                          │
│                                                                 │
│  Bot responds with embed:                                      │
│  🎯 SPY Options Sweep - 5 Cheap Options Found!                │
│  📈 AAPL - Price: $175.50, IV: 22.3%, ...                     │
│  📈 MSFT - Price: $420.15, IV: 20.1%, ...                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Step 1: User Command
```
User: /sweep symbol:SPY threshold:30
      ↓
Discord: Creates interaction payload
      ↓
{
  "type": 2,
  "data": {
    "name": "sweep",
    "options": [
      {"name": "symbol", "value": "SPY"},
      {"name": "threshold", "value": 30}
    ]
  },
  "token": "interaction-token-xyz",
  "application_id": "1432808300780458006"
}
```

### Step 2: Backend Processing
```
FastAPI receives interaction
      ↓
Verify signature (security)
      ↓
Return immediate response: {"type": 5}  // Deferred
      ↓
Launch background task:
  - Fetch IVV holdings from iShares
  - Scan 50 tickers
  - Check IV percentile < 30%
  - Filter for "CHEAP" options
  - Build results list
```

### Step 3: Options Scanning
```
For each ticker (e.g., AAPL):
  1. Get current price: $175.50
  2. Fetch 6mo history
  3. Calculate HV30: 28.1%
  4. Get option chain
  5. Calculate IV30: 22.3%
  6. Calculate IV percentile: 18.2%
  7. Compute bias: CHEAP (IV < HV)
  8. Direction hint: BULLISH
  
If IV percentile < threshold (30%):
  → Add to results
```

### Step 4: Results Delivery
```
Format Discord embed:
{
  "embeds": [{
    "title": "🎯 SPY Options Sweep - 5 Found!",
    "color": 0x28a745,
    "fields": [
      {
        "name": "📈 AAPL",
        "value": "Price: $175.50\nIV: 22.3% | HV: 28.1%\n..."
      },
      ...
    ]
  }]
}
      ↓
POST to Discord webhook
      ↓
User sees formatted results in Discord
```

## Component Details

### Backend Components

**`app/api/discord.py`** (146 lines)
- Handles Discord interactions
- Verifies signatures
- Routes commands to appropriate handlers
- Returns immediate responses (PONG, Deferred)

**`app/services/discord_sweep.py`** (261 lines)
- Executes options sweeps
- Fetches ETF holdings from iShares
- Scans tickers using existing options_alerts logic
- Formats results as Discord embeds
- Sends followup messages

**`register_discord_commands.py`** (85 lines)
- Registers `/sweep` command with Discord API
- Defines command parameters and choices
- One-time setup script

### External Services

**iShares ETF Holdings**
- IVV (S&P 500): https://www.ishares.com/.../IVV_holdings
- IWM (Russell 2000): https://www.ishares.com/.../IWM_holdings
- Returns CSV with ticker symbols
- Updated daily

**yfinance (Yahoo Finance API)**
- Historical price data (6 months)
- Option chain data
- Current prices
- No API key required (free)

**Discord API v10**
- Interactions endpoint (slash commands)
- Webhooks (followup messages)
- Requires bot token for authentication

## Configuration

### Environment Variables
```bash
# Required for sending followup messages
DISCORD_BOT_TOKEN=MTA...  # From Discord Developer Portal

# Public key for signature verification
DISCORD_PUBLIC_KEY=2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd
```

### Discord Application Settings
```
Application ID: 1432808300780458006
Interaction Endpoint URL: http://100.49.90.221:8000/discord/interactions
Bot Permissions: Send Messages, Embed Links, Read Message History
Scopes: bot, applications.commands
```

## Performance Considerations

### Timing
- Discord requires response within **3 seconds**
- Solution: Return deferred response (type 5) immediately
- Sweep runs in background (takes 1-2 minutes)
- Followup message sent when complete

### Rate Limits
- Discord: 50 slash commands per second per app
- yfinance: No official limit, but be respectful
- iShares: Daily CSV updates, cache for 24h
- Solution: Scan limited to 50 tickers per sweep

### Scaling
- Each sweep is independent
- Can handle multiple concurrent sweeps
- Background tasks don't block other requests
- Consider adding queue for heavy usage

## Security

### Signature Verification
```python
# Production should verify Ed25519 signatures
from nacl.signing import VerifyKey

public_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))
message = timestamp.encode() + body
signature = bytes.fromhex(signature_header)

try:
    public_key.verify(message, signature)
except BadSignatureError:
    raise HTTPException(401, "Invalid signature")
```

### Best Practices
- ✅ Store bot token in environment (not code)
- ✅ Use HTTPS in production (required by Discord)
- ✅ Verify interaction signatures
- ✅ Validate user inputs (symbol, threshold)
- ✅ Rate limit per user/guild
- ✅ Log all interactions for debugging

## Error Handling

### Common Errors
```python
# iShares CSV fetch fails
→ Return: "❌ Failed to fetch holdings"

# No cheap options found
→ Return: "No cheap options found below X%"

# Invalid symbol
→ Return: "❌ Symbol 'XYZ' not supported"

# Bot token not set
→ Log error, can't send followup

# Discord API error
→ Retry with exponential backoff
```

## Monitoring

### Key Metrics to Track
- Sweep completion time
- Number of tickers scanned
- Hit rate (% with cheap options)
- Discord API latency
- Error rates by type

### Logging
```python
# Log each interaction
logger.info(f"Sweep started: {symbol}, threshold={threshold}")

# Log results
logger.info(f"Sweep complete: {len(alerts)} cheap options found")

# Log errors
logger.error(f"Failed to fetch tickers: {error}")
```

## Future Enhancements

### Additional Commands
- `/analyze SYMBOL` - Deep dive on single stock
- `/watchlist add SYMBOL` - Track specific tickers
- `/alerts set SYMBOL threshold:25` - Auto-notify
- `/compare SYMBOL1 SYMBOL2` - Side-by-side comparison

### Performance Improvements
- Cache ETF holdings (24h TTL)
- Pre-compute IV percentiles daily
- Parallel ticker scanning
- Database of historical cheap options

### User Features
- Per-server configuration
- Custom watchlists
- Alert subscriptions
- Historical tracking
- Export to CSV/PDF
