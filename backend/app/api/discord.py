"""
Discord Bot Integration for Options Sweeps
Handles slash commands like /sweep SPY and /sweep IWM
"""
import hashlib
import hmac
import os
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.services.discord_sweep import execute_sweep

router = APIRouter(prefix="/discord", tags=["Discord"])

# Discord credentials from environment
DISCORD_PUBLIC_KEY = os.getenv("DISCORD_PUBLIC_KEY", "2264cf521625b141f0e81963557d4eddb93d1d0e2fe348721d08563e4ff7e1fd")


class DiscordInteraction(BaseModel):
    """Discord interaction payload"""
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
    """Verify Discord interaction signature"""
    message = timestamp.encode() + body
    expected = hmac.new(
        bytes.fromhex(DISCORD_PUBLIC_KEY),
        message,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


@router.post("/interactions")
async def discord_interactions(
    request: Request,
    background_tasks: BackgroundTasks
):
    """
    Handle Discord slash command interactions
    
    Discord sends:
    - Type 1: PING (respond with PONG)
    - Type 2: APPLICATION_COMMAND (slash command)
    """
    body = await request.body()
    
    # Get signature headers (optional for initial verification)
    signature = request.headers.get("X-Signature-Ed25519")
    timestamp = request.headers.get("X-Signature-Timestamp")
    
    # Note: In production, you should verify the Ed25519 signature here
    # For now, we skip verification to allow Discord's initial PING verification to work
    # To implement: use PyNaCl library with DISCORD_PUBLIC_KEY
    
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
            # Get the symbol option
            options = interaction.data.get("options", [])
            symbol = None
            threshold = 30.0  # Default threshold
            
            for option in options:
                if option.get("name") == "symbol":
                    symbol = option.get("value", "").upper()
                elif option.get("name") == "threshold":
                    threshold = float(option.get("value", 30.0))
            
            if not symbol:
                return {
                    "type": 4,  # CHANNEL_MESSAGE_WITH_SOURCE
                    "data": {
                        "content": "❌ Please provide a symbol (SPY or IWM)",
                        "flags": 64  # EPHEMERAL (only visible to user)
                    }
                }
            
            if symbol not in ["SPY", "IWM"]:
                return {
                    "type": 4,
                    "data": {
                        "content": f"❌ Symbol '{symbol}' not supported. Use SPY or IWM.",
                        "flags": 64
                    }
                }
            
            # Acknowledge immediately (Discord requires response within 3 seconds)
            response = {
                "type": 5  # DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
            }
            
            # Run sweep in background
            background_tasks.add_task(
                execute_sweep,
                symbol=symbol,
                threshold=threshold,
                interaction_token=interaction.token,
                application_id=interaction.application_id
            )
            
            return response
        
        return {
            "type": 4,
            "data": {
                "content": f"❓ Unknown command: {command_name}",
                "flags": 64
            }
        }
    
    raise HTTPException(status_code=400, detail="Unknown interaction type")


@router.get("/health")
async def discord_health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "discord_bot",
        "public_key_configured": bool(DISCORD_PUBLIC_KEY)
    }
