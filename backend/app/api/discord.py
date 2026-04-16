"""
Discord Bot Integration for Options Sweeps.
Handles slash command interactions for /sweep universes.
"""
import os
from typing import Optional

import asyncio
import threading
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

from app.services.discord_sweep_simple import execute_sweep
from app.services.discord_sweep_universe import (
    SUPPORTED_SWEEP_UNIVERSES,
    canonical_universe_key,
)

router = APIRouter(prefix="/discord", tags=["Discord"])

# Discord credentials from environment
DISCORD_PUBLIC_KEY = os.getenv(
    "DISCORD_PUBLIC_KEY",
    "2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd",
)


class DiscordInteraction(BaseModel):
    """Discord interaction payload."""

    type: int
    data: Optional[dict] = None
    guild_id: Optional[str] = None
    channel_id: Optional[str] = None
    member: Optional[dict] = None
    user: Optional[dict] = None
    token: str
    id: str
    application_id: str


def verify_discord_signature(body: bytes, signature: str, timestamp: str) -> bool:
    """Verify Discord interaction signature using Ed25519."""
    try:
        verify_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))
        verify_key.verify(timestamp.encode() + body, bytes.fromhex(signature))
        return True
    except (BadSignatureError, ValueError):
        return False


@router.post("/interactions")
async def discord_interactions(request: Request):
    """
    Handle Discord slash command interactions.

    Discord sends:
    - Type 1: PING (respond with PONG)
    - Type 2: APPLICATION_COMMAND (slash command)
    """
    body = await request.body()

    # Verify Ed25519 signature
    signature = request.headers.get("X-Signature-Ed25519")
    timestamp = request.headers.get("X-Signature-Timestamp")

    if not signature or not timestamp:
        raise HTTPException(status_code=401, detail="Missing signature headers")

    if not verify_discord_signature(body, signature, timestamp):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        interaction = DiscordInteraction.parse_raw(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {str(e)}")

    # Type 1: PING - Discord uses this to verify the endpoint
    if interaction.type == 1:
        return {"type": 1}  # PONG

    # Type 2: APPLICATION_COMMAND - Handle slash commands
    if interaction.type == 2:
        command_name = interaction.data.get("name") if interaction.data else None

        if command_name == "sweep":
            options = interaction.data.get("options", [])
            symbol = None
            threshold = 30.0  # Default threshold

            for option in options:
                if option.get("name") == "symbol":
                    symbol = str(option.get("value", "")).upper()
                elif option.get("name") == "threshold":
                    threshold = float(option.get("value", 30.0))

            if not symbol:
                supported = ", ".join(SUPPORTED_SWEEP_UNIVERSES.keys())
                return {
                    "type": 4,
                    "data": {
                        "content": f"❌ Please provide a universe key. Supported: {supported}",
                        "flags": 64,
                    },
                }

            canonical = canonical_universe_key(symbol)
            if not canonical:
                supported = ", ".join(SUPPORTED_SWEEP_UNIVERSES.keys())
                return {
                    "type": 4,
                    "data": {
                        "content": f"❌ Universe '{symbol}' not supported. Use: {supported}",
                        "flags": 64,
                    },
                }

            label = SUPPORTED_SWEEP_UNIVERSES.get(canonical, canonical)
            response = {
                "type": 4,
                "data": {
                    "content": f"Scanning {label} ({canonical})..."
                },
            }

            # Start the sweep in a dedicated background thread so the
            # interaction response is returned immediately and any
            # long-running work runs independently.
            def _start_sweep_thread(sym, thr, token, app_id, channel_id):
                def _runner():
                    try:
                        asyncio.run(execute_sweep(sym, thr, token, app_id, channel_id))
                    except Exception as e:
                        print(f"[Discord Sweep] Background exception: {e}")

                t = threading.Thread(target=_runner, daemon=True)
                t.start()

            _start_sweep_thread(
                canonical,
                threshold,
                interaction.token,
                interaction.application_id,
                interaction.channel_id,
            )
            return response

        return {
            "type": 4,
            "data": {
                "content": f"❓ Unknown command: {command_name}",
                "flags": 64,
            },
        }

    raise HTTPException(status_code=400, detail="Unknown interaction type")


@router.get("/health")
async def discord_health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "discord_bot",
        "public_key_configured": bool(DISCORD_PUBLIC_KEY),
    }
