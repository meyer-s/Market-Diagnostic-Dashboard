# Discord Bot Quick Start

## ✅ Status: Backend Ready!

Your Discord bot backend is **deployed and running** at:
- **Health Endpoint**: http://100.49.90.221:8000/discord/health ✅
- **Interactions Endpoint**: http://100.49.90.221:8000/discord/interactions

## 🔐 Next Steps to Complete Setup

### 1. Get Your Bot Token

You need to retrieve the bot token from Discord:

1. Go to https://discord.com/developers/applications/1432808300780458006/bot
2. Click "Reset Token" (under Bot section)
3. Copy the token immediately (shown only once!)

### 2. Add Bot Token to Server

SSH into your server and add the token:

```bash
ssh -i "path/to/key.pem" ubuntu@100.49.90.221

# Add the bot token to environment
cd Market-Diagnostic-Dashboard
echo 'DISCORD_BOT_TOKEN=YOUR_TOKEN_HERE' >> devops/env/backend.env

# Restart backend to load the token
docker compose restart backend
```

### 3. Set Interaction Endpoint URL in Discord

1. Go to https://discord.com/developers/applications/1432808300780458006/information
2. Find "Interactions Endpoint URL" field
3. Enter: `http://100.49.90.221:8000/discord/interactions`
4. Click "Save Changes"
5. Discord will send a PING to verify (should succeed ✅)

### 4. Register the /sweep Command

On your local machine or server:

```bash
# Set your bot token
export DISCORD_BOT_TOKEN="your_token_here"

# Run registration script
cd Market-Diagnostic-Dashboard
python3 backend/register_discord_commands.py
```

You should see:
```
✅ Successfully registered /sweep command!
```

### 5. Invite Bot to Your Server

1. Go to https://discord.com/developers/applications/1432808300780458006/oauth2/url-generator
2. Check these scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Check these permissions:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Read Message History
4. Copy the generated URL at bottom
5. Open URL in browser and select your server
6. Click "Authorize"

### 6. Test the Bot!

In your Discord server, type:

```
/sweep symbol:SPY
```

or

```
/sweep symbol:IWM threshold:25
```

## 📊 What the Bot Does

- **`/sweep SPY`**: Scans S&P 500 stocks (via IVV holdings) for cheap options
- **`/sweep IWM`**: Scans Russell 2000 stocks for cheap options
- **`threshold`**: Optional IV percentile threshold (5-50%, default 30%)

The bot will:
1. Acknowledge your command immediately
2. Scan up to 50 stocks in the background (takes 1-2 minutes)
3. Return results showing stocks with "cheap" options
4. Display price, IV, HV, IV percentile, and direction for each hit

## 🔍 Example Output

```
🎯 SPY Options Sweep - 5 Cheap Options Found!
Found 5 options below 30% IV percentile

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

... 3 more results ...

Scanned 50 tickers • Market Diagnostic Dashboard
```

## 🐛 Troubleshooting

### Bot doesn't respond
- Check bot token is set: `docker compose exec backend printenv | grep DISCORD`
- Check logs: `docker compose logs backend -f`
- Verify interaction URL is correct in Discord dashboard

### /sweep command not showing
- Re-run `register_discord_commands.py`
- Wait 5-10 minutes (commands can take time to propagate)
- Try in a private DM with the bot
- Global commands can take up to 1 hour

### "This interaction failed"
- Check backend logs for errors
- Ensure DISCORD_BOT_TOKEN is set correctly
- Verify the interaction endpoint URL is accessible

## 📝 Files Overview

```
backend/
├── app/
│   ├── api/
│   │   └── discord.py                 # FastAPI endpoint for Discord
│   └── services/
│       └── discord_sweep.py           # Sweep execution logic
├── register_discord_commands.py       # Register /sweep command
├── test_discord_bot.py                # Local testing script
└── devops/
    └── env/
        └── backend.env                # Add DISCORD_BOT_TOKEN here
```

## 🚀 Ready to Go!

Once you complete steps 1-6 above, your bot will be fully operational!

Need help? Check the full documentation in `DISCORD_BOT_SETUP.md`
