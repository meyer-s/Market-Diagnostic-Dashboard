"""
Discord sweep - reuses existing sweep scripts
"""
import os

import requests
import httpx

# Import existing sweep logic
from maintenance_scripts.options_chain_sweep import _scan_tickers
from app.services.discord_sweep_universe import resolve_sweep_universe


DISCORD_API_BASE = "https://discord.com/api/v10"


async def execute_sweep(
    symbol: str,
    threshold: float,
    interaction_token: str,
    application_id: str
):
    """
    Execute sweep using existing script logic.
    """
    bot_token = os.getenv("DISCORD_BOT_TOKEN")
    if not bot_token:
        print("ERROR: DISCORD_BOT_TOKEN not set")
        return

    try:
        universe = resolve_sweep_universe(symbol)
    except ValueError:
        await _edit_original_response(
            application_id,
            interaction_token,
            {"content": f"❌ Unsupported symbol: {symbol}"},
            bot_token,
        )
        return

    tickers = universe.tickers
    label = universe.label
    if not tickers:
        notes = "\n".join(f"- {note}" for note in universe.notes[:3])
        extra = f"\nDetails:\n{notes}" if notes else ""
        await _edit_original_response(
            application_id,
            interaction_token,
            {"content": f"❌ Failed to fetch tickers for {label}.{extra}"},
            bot_token,
        )
        return

    # Run the existing scan function (scans all tickers, sends webhooks).
    print(f"[Discord Sweep] Starting scan of {len(tickers)} {label} tickers...")
    hits = _scan_tickers(tickers, label, threshold, None, pause_seconds=0.2)
    print(f"[Discord Sweep] Scan complete. Found {hits} cheap options.")

    total = len(tickers)
    details = f"\nUniverse key: {universe.key}"
    if universe.notes:
        details += "\nNotes: " + " | ".join(universe.notes[:2])

    await _send_followup_message(
        application_id=application_id,
        interaction_token=interaction_token,
        content=(
            f"Options sweep finished. {label} Scanned tickers {total} Hits: {hits}{details}"
        ),
    )


async def _send_followup_message(application_id: str, interaction_token: str, content: str):
    """Send a follow-up message to the interaction (creates a new message)."""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json={"content": content})
            response.raise_for_status()
            print(f"✓ Sent follow-up message: {content[:50]}...")
        except Exception as e:
            print(f"✗ Failed to send follow-up message: {e}")


async def _edit_original_response(
    application_id: str,
    interaction_token: str,
    data: dict,
    bot_token: str
):
    """Edit the original interaction response (kept for error handling)."""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}/messages/@original"
    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.patch(url, json=data, headers=headers, timeout=10)
        response.raise_for_status()
        print("✓ Edited original response on Discord")
    except Exception as e:
        print(f"✗ Failed to edit original response: {e}")
