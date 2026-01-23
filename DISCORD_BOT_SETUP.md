# Discord Bot Setup Guide

## Overview
This guide helps you set up the Discord bot to handle `/sweep SPY` and `/sweep IWM` commands for options scanning.

## Prerequisites
- Discord Bot created at https://discord.com/developers/applications
- Application ID: `1432808300780458006`
- Public Key: `2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd`

## Step 1: Get Your Bot Token

1. Go to https://discord.com/developers/applications/1432808300780458006
2. Navigate to "Bot" section
3. Click "Reset Token" to reveal your bot token
4. **Copy the token immediately** (you can only see it once)

## Step 2: Configure Environment Variables

Add these to your environment or `.env` file:

```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_PUBLIC_KEY=2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd
```

On the server:
```bash
# Add to devops/env/backend.env
echo "DISCORD_BOT_TOKEN=your_bot_token_here" >> devops/env/backend.env
echo "DISCORD_PUBLIC_KEY=2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd" >> devops/env/backend.env
```

## Step 3: Configure Interaction Endpoint URL

1. Go to https://discord.com/developers/applications/1432808300780458006/information
2. Find "Interactions Endpoint URL"
3. Set it to: `https://your-server-url/discord/interactions`
   - For your server: `http://100.49.90.221:8000/discord/interactions`
4. Discord will send a PING request to verify - the endpoint handles this automatically

## Step 4: Register Slash Commands

Run the registration script:

```bash
# Set your bot token
export DISCORD_BOT_TOKEN="your_bot_token_here"

# Run registration script
python backend/register_discord_commands.py
```

This registers the `/sweep` command with Discord.

## Step 5: Invite Bot to Your Server

1. Go to https://discord.com/developers/applications/1432808300780458006/oauth2/url-generator
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Embed Links
   - Read Message History
4. Copy the generated URL and open it in browser
5. Select your server and authorize

## Step 6: Test the Bot

In your Discord server:

```
/sweep symbol:SPY
```

or

```
/sweep symbol:IWM threshold:25
```

## Command Details

### `/sweep` Command

**Parameters:**
- `symbol` (required): Choose SPY or IWM
  - `SPY`: Scans S&P 500 holdings (via IVV ETF)
  - `IWM`: Scans Russell 2000 holdings
- `threshold` (optional): IV percentile threshold (5-50, default: 30)

**What it does:**
1. Fetches ETF holdings from iShares
2. Scans up to 50 stocks for cheap options
3. Looks for options with IV percentile below threshold
4. Returns stocks where options are "cheap" relative to historical volatility

**Response includes:**
- Number of cheap options found
- Price, IV, HV, IV percentile for each
- Direction hint (bullish/bearish/neutral)
- Interactive Discord embed with colored formatting

## Architecture

### Backend Endpoints

**`POST /discord/interactions`**
- Receives Discord slash command interactions
- Verifies signature (for production security)
- Handles PING (type 1) and APPLICATION_COMMAND (type 2)
- Returns deferred response immediately
- Runs sweep in background task

**`GET /discord/health`**
- Health check for Discord integration
- Confirms public key is configured

### Background Processing

When `/sweep` is triggered:
1. Discord sends interaction → FastAPI endpoint responds with "deferred"
2. Background task starts the sweep
3. Fetches ETF holdings (SPY→IVV or IWM)
4. Scans tickers for cheap options (IV percentile < threshold)
5. Formats results as Discord embed
6. Sends followup message with results

## Files Created

```
backend/
├── app/
│   ├── api/
│   │   └── discord.py              # FastAPI endpoints for Discord
│   └── services/
│       └── discord_sweep.py        # Sweep execution logic
├── register_discord_commands.py    # Command registration script
└── docs/
    └── DISCORD_BOT_SETUP.md       # This file
```

## Troubleshooting

### Bot doesn't respond
- Check `DISCORD_BOT_TOKEN` is set correctly
- Verify interaction endpoint URL is correct
- Check backend logs: `docker compose logs backend -f`

### Commands not appearing
- Re-run `register_discord_commands.py`
- Wait a few minutes (global commands can take up to 1 hour)
- Try inviting bot to a new test server

### "Missing Access" error
- Ensure bot has correct permissions
- Re-invite bot with proper scopes

### Sweep times out
- Normal for first request (cold start)
- Subsequent requests should be faster
- Sweeps scan up to 50 tickers (takes ~1-2 minutes)

## Security Notes

### Production Recommendations
1. Enable signature verification in `discord.py` using `PyNaCl`:
   ```python
   from nacl.signing import VerifyKey
   from nacl.exceptions import BadSignatureError
   
   def verify_signature(body, signature, timestamp):
       verify_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))
       try:
           verify_key.verify(
               timestamp.encode() + body,
               bytes.fromhex(signature)
           )
           return True
       except BadSignatureError:
           return False
   ```

2. Use HTTPS for interaction endpoint (required for production)
3. Store bot token in secure secret manager
4. Rotate tokens regularly

## Example Usage

```
User: /sweep symbol:SPY threshold:25
Bot:  🔄 Starting sweep...
      
      [2 minutes later]
      
      🎯 SPY Options Sweep - 5 Cheap Options Found!
      Found 5 options below 25% IV percentile
      
      📈 AAPL
      Price: $175.50
      IV: 22.3% | HV: 28.1%
      IV Percentile: 18.2%
      Direction: BULLISH
      
      📈 MSFT
      Price: $420.15
      IV: 20.1% | HV: 25.3%
      IV Percentile: 22.5%
      Direction: NEUTRAL
      
      [... 3 more results ...]
      
      Scanned 50 tickers • Market Diagnostic Dashboard
```

## Future Enhancements

Potential improvements:
- Add `/sweep QQQ` for Nasdaq 100
- Add `/sweep SECTOR:TECH` for sector-specific scans
- Add `/watchlist` to track specific tickers
- Add `/alerts` to set up automatic notifications
- Add `/analyze SYMBOL` for detailed option chain analysis
- Support custom watchlists per user/server
