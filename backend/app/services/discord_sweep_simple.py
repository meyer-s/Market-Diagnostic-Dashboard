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

    default_pause = 0.2
    if len(tickers) > 2000:
        default_pause = 0.02
    elif len(tickers) > 1000:
        default_pause = 0.05
    pause_seconds = float(os.getenv("DISCORD_SWEEP_PAUSE_SECONDS", default_pause))

    # Run the existing scan function (scans all tickers, sends webhooks).
    print(f"[Discord Sweep] Starting scan of {len(tickers)} {label} tickers...")
    hits_result = _scan_tickers(
        tickers,
        label,
        threshold,
        None,
        pause_seconds=pause_seconds,
        capture_hit_symbols=True,
    )
    if isinstance(hits_result, tuple):
        hits, hit_symbols = hits_result
    else:
        hits, hit_symbols = hits_result, []
    print(f"[Discord Sweep] Scan complete. Found {hits} cheap options.")

    total = len(tickers)
    details = f"\nUniverse key: {universe.key}"
    if universe.notes:
        details += "\nNotes: " + " | ".join(universe.notes[:2])
    if hit_symbols:
        preview = ", ".join(hit_symbols[:12])
        suffix = "" if len(hit_symbols) <= 12 else f" (+{len(hit_symbols) - 12} more)"
        details += f"\nHit symbols: {preview}{suffix}"

    content = f"Options sweep finished. {label} Scanned tickers {total} Hits: {hits}{details}"
    sent = await _send_followup_message(
        application_id=application_id,
        interaction_token=interaction_token,
        content=content,
    )
    if not sent:
        await _edit_original_response(
            application_id,
            interaction_token,
            {"content": content},
            bot_token,
        )


async def _send_followup_message(application_id: str, interaction_token: str, content: str) -> bool:
    """Send a follow-up message to the interaction (creates a new message)."""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json={"content": content})
            if response.status_code >= 400:
                snippet = response.text[:300].replace("\n", " ")
                print(
                    f"✗ Follow-up status={response.status_code} "
                    f"url={url} body={snippet}"
                )
                return False
            print(f"✓ Sent follow-up message: {content[:50]}...")
            return True
        except Exception as e:
            print(f"✗ Failed to send follow-up message: {e}")
            return False


async def _edit_original_response(
    application_id: str,
    interaction_token: str,
    data: dict,
    bot_token: str
):
    """Edit the original interaction response (kept for error handling)."""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}/messages/@original"

    try:
        # Interaction webhook edits usually work without bot auth.
        response = requests.patch(url, json=data, timeout=10)
        if response.status_code >= 400 and bot_token:
            headers = {
                "Authorization": f"Bot {bot_token}",
                "Content-Type": "application/json",
            }
            response = requests.patch(url, json=data, headers=headers, timeout=10)
        response.raise_for_status()
        print("✓ Edited original response on Discord")
    except Exception as e:
        detail = ""
        if "response" in locals():
            detail = f" status={response.status_code} body={response.text[:300]}"
        print(f"✗ Failed to edit original response: {e}{detail}")
