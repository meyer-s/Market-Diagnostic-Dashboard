"""
Discord sweep - reuses existing sweep scripts
"""
import asyncio
import os
import io
from typing import List

import pandas as pd
import requests

# Import existing sweep logic
from maintenance_scripts.options_chain_sweep import _scan_tickers


DISCORD_API_BASE = "https://discord.com/api/v10"

SP500_IVV_URL = (
    "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund"
)
R2K_IWM_URL = (
    "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
)


def _fetch_ishares_tickers(url: str) -> List[str]:
    """Fetch tickers from iShares ETF holdings CSV"""
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        
        lines = response.text.splitlines()
        header_idx = None
        for i, line in enumerate(lines):
            if line.startswith("Ticker,"):
                header_idx = i
                break
        if header_idx is None:
            return []

        frame = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])))
        tickers = frame.get("Ticker")
        if tickers is None:
            return []
        return [
            value.strip()
            for value in tickers.dropna().astype(str).tolist()
            if value.strip() and value.strip().upper() != "NAN"
        ]
    except Exception as e:
        print(f"Error fetching tickers: {e}")
        return []


async def execute_sweep(
    symbol: str,
    threshold: float,
    interaction_token: str,
    application_id: str
):
    """
    Execute sweep using existing script logic
    """
    bot_token = os.getenv("DISCORD_BOT_TOKEN")
    if not bot_token:
        print("ERROR: DISCORD_BOT_TOKEN not set")
        return
    
    # Determine which tickers to scan
    if symbol == "SPY":
        url = SP500_IVV_URL
        label = "S&P 500 (SPY/IVV)"
    elif symbol == "IWM":
        url = R2K_IWM_URL
        label = "Russell 2000 (IWM)"
    else:
        await _edit_original_response(
            application_id,
            interaction_token,
            {"content": f"❌ Unsupported symbol: {symbol}"},
            bot_token
        )
        return
    
    tickers = _fetch_ishares_tickers(url)
    if not tickers:
        await _edit_original_response(
            application_id,
            interaction_token,
            {"content": f"❌ Failed to fetch {label} holdings"},
            bot_token
        )
        return
    
    # Run the existing scan function (scans all tickers, sends webhooks)
    print(f"[Discord Sweep] Starting scan of {len(tickers)} {label} tickers...")
    hits = _scan_tickers(tickers, label, threshold, max_count=50, pause_seconds=0.2)
    print(f"[Discord Sweep] Scan complete. Found {hits} cheap options.")
    
    # Edit the original message with results
    result_text = (
        f"✅ **{symbol} Options Sweep Complete**\n\n"
        f"📊 Scanned 50 {label} tickers\n"
        f"🎯 Found **{hits}** cheap options (IV percentile < {threshold}%)\n\n"
        f"Check your Discord webhook for detailed alerts!"
    )
    await _edit_original_response(
        application_id,
        interaction_token,
        {"content": result_text},
        bot_token
    )


async def _edit_original_response(
    application_id: str,
    interaction_token: str,
    data: dict,
    bot_token: str
):
    """Edit the original interaction response"""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}/messages/@original"
    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.patch(url, json=data, headers=headers, timeout=10)
        response.raise_for_status()
        print(f"✓ Edited original response on Discord")
    except Exception as e:
        print(f"✗ Failed to edit original response: {e}")
