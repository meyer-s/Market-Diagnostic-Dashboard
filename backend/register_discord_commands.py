#!/usr/bin/env python3
"""
Register Discord slash commands
Run this once to register the /sweep command with Discord
"""
import os
import requests
import sys

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
    "Content-Type": "application/json"
}

# Define the /sweep command
command = {
    "name": "sweep",
    "description": "Scan options for cheap IV opportunities",
    "options": [
        {
            "name": "symbol",
            "description": "ETF symbol to sweep (SPY or IWM)",
            "type": 3,  # STRING type
            "required": True,
            "choices": [
                {
                    "name": "SPY (S&P 500)",
                    "value": "SPY"
                },
                {
                    "name": "IWM (Russell 2000)",
                    "value": "IWM"
                }
            ]
        },
        {
            "name": "threshold",
            "description": "IV percentile threshold (default: 30%)",
            "type": 10,  # NUMBER type
            "required": False,
            "min_value": 5.0,
            "max_value": 50.0
        }
    ]
}

print(f"Registering slash command with Discord...")
print(f"Application ID: {APPLICATION_ID}")
print(f"Command: /sweep")

try:
    response = requests.post(url, json=command, headers=headers, timeout=10)
    response.raise_for_status()
    
    print(f"\n✅ Successfully registered /sweep command!")
    print(f"\nCommand details:")
    print(f"  Name: {command['name']}")
    print(f"  Description: {command['description']}")
    print(f"  Options: {len(command['options'])} parameters")
    print(f"\nYou can now use /sweep in your Discord server!")
    print(f"\nExample usage:")
    print(f"  /sweep symbol:SPY")
    print(f"  /sweep symbol:IWM threshold:25")
    
except requests.exceptions.HTTPError as e:
    print(f"\n❌ Failed to register command")
    print(f"Status: {e.response.status_code}")
    print(f"Error: {e.response.text}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ Error: {e}")
    sys.exit(1)
