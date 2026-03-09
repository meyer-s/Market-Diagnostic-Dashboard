#!/usr/bin/env python3
"""
Register Discord slash commands.
Run this once to register the /sweep command with Discord.
"""
import os
import sys
from pathlib import Path

import requests

# Ensure local app package is importable when this script is run directly.
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.discord_sweep_universe import SUPPORTED_SWEEP_UNIVERSES, UNIVERSE_ALIASES

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

# Keep common backward-compatible aliases visible in the menu.
alias_choices = [
    {"name": f"{alias} (Alias -> {target})", "value": alias}
    for alias, target in UNIVERSE_ALIASES.items()
    if alias != target and alias in {"SPY", "IWM"}
]
universe_choices.extend(alias_choices)

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
    print("  /sweep symbol:ALL threshold:25")
    print("  /sweep symbol:TOP_OPT_VOL_200 threshold:25")

except requests.exceptions.HTTPError as e:
    print("\n❌ Failed to register command")
    print(f"Status: {e.response.status_code}")
    print(f"Error: {e.response.text}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ Error: {e}")
    sys.exit(1)
