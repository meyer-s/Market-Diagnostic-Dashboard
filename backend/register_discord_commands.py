#!/usr/bin/env python3
"""
Register Discord slash commands.
Run this whenever slash command definitions change.
"""
import os
import sys
from pathlib import Path

import requests

# Ensure local app package is importable when this script is run directly.
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.discord_sweep_universe import SUPPORTED_SWEEP_UNIVERSES

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
    {"name": f"{key} ({label})", "value": key}
    for key, label in SUPPORTED_SWEEP_UNIVERSES.items()
]

commands = [
    {
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
    },
    {
        "name": "stop",
        "description": "Stop the active options sweep in this channel",
    },
]

print("Registering slash commands with Discord...")
print(f"Application ID: {APPLICATION_ID}")
print("Commands: " + ", ".join(f"/{command['name']}" for command in commands))

try:
    response = requests.put(url, json=commands, headers=headers, timeout=10)
    response.raise_for_status()
    registered = response.json()

    print("\n✅ Successfully registered Discord commands!")
    print("\nCommand details:")
    for command in registered:
        print(f"  /{command.get('name')}: {command.get('description')}")
    print("\nYou can now use /sweep and /stop in your Discord server!")
    print("\nExample usage:")
    print("  /sweep symbol:SP500")
    print("  /sweep symbol:ALL threshold:25")
    print("  /sweep symbol:TOP_OPT_VOL_200 threshold:25")
    print("  /stop")

except requests.exceptions.HTTPError as e:
    print("\n❌ Failed to register command")
    print(f"Status: {e.response.status_code}")
    print(f"Error: {e.response.text}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ Error: {e}")
    sys.exit(1)
