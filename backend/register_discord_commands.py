#!/usr/bin/env python3
"""
Register Discord slash commands.
Run this once to register the /sweep command with Discord.
"""
import os
import sys

import requests

# Discord credentials
APPLICATION_ID = "1432808300780458006"
BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN")

if not BOT_TOKEN:
    print("ERROR: DISCORD_BOT_TOKEN environment variable not set")
    print("Set it with: export DISCORD_BOT_TOKEN='your-bot-token'")
    sys.exit(1)

# Discord API endpoint
url = f"https://discord.com/api/v10/applications/{APPLICATION_ID}/commands"

# Headers
headers = {
    "Authorization": f"Bot {BOT_TOKEN}",
    "Content-Type": "application/json",
}

universe_choices = [
    {"name": "SP500 (S&P 500)", "value": "SP500"},
    {"name": "NASDAQ100 (Nasdaq 100)", "value": "NASDAQ100"},
    {"name": "RUSSELL2000 (Russell 2000)", "value": "RUSSELL2000"},
    {"name": "SECTOR_ETFS (Major Sector ETFs)", "value": "SECTOR_ETFS"},
    {"name": "TOP_OPT_VOL_200 (Top Options Volume)", "value": "TOP_OPT_VOL_200"},
    {"name": "UPCOMING_EARNINGS_21D (Earnings Window)", "value": "UPCOMING_EARNINGS_21D"},
    {"name": "TOP_SHORT_INTEREST_100 (Short Interest)", "value": "TOP_SHORT_INTEREST_100"},
    {"name": "MAJOR_NEWS_21D (Headline News)", "value": "MAJOR_NEWS_21D"},
    # Backward-compatible aliases
    {"name": "SPY (Alias -> SP500)", "value": "SPY"},
    {"name": "IWM (Alias -> RUSSELL2000)", "value": "IWM"},
]

# Define the /sweep command
command = {
    "name": "sweep",
    "description": "Scan options for cheap IV opportunities",
    "options": [
        {
            "name": "symbol",
            "description": "Universe key to sweep",
            "type": 3,  # STRING type
            "required": True,
            "choices": universe_choices,
        },
        {
            "name": "threshold",
            "description": "IV percentile threshold (default: 30%)",
            "type": 10,  # NUMBER type
            "required": False,
            "min_value": 5.0,
            "max_value": 50.0,
        },
    ],
}

print("Registering slash command with Discord...")
print(f"Application ID: {APPLICATION_ID}")
print("Command: /sweep")

try:
    response = requests.post(url, json=command, headers=headers, timeout=10)
    response.raise_for_status()

    print("\n✅ Successfully registered /sweep command!")
    print("\nCommand details:")
    print(f"  Name: {command['name']}")
    print(f"  Description: {command['description']}")
    print(f"  Options: {len(command['options'])} parameters")
    print("\nYou can now use /sweep in your Discord server!")
    print("\nExample usage:")
    print("  /sweep symbol:SP500")
    print("  /sweep symbol:TOP_OPT_VOL_200 threshold:25")

except requests.exceptions.HTTPError as e:
    print("\n❌ Failed to register command")
    print(f"Status: {e.response.status_code}")
    print(f"Error: {e.response.text}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ Error: {e}")
    sys.exit(1)
