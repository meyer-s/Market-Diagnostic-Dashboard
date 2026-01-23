"""
Discord sweep execution service
Handles the actual options sweep and sends results back to Discord
"""
import asyncio
import os
from typing import List, Optional

import pandas as pd
import requests
import yfinance as yf

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.services.options_alerts import (
    _build_alert_reason,
    _compute_option_bias,
    _direction_hint,
    _format_alert_message,
    _get_current_price,
    _is_iv_data_valid,
)


DISCORD_API_BASE = "https://discord.com/api/v10"

# ETF holding URLs
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
        import io
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
        print(f"Error fetching iShares tickers: {e}")
        return []


def _normalize_symbol(symbol: str) -> str:
    """Normalize ticker symbol"""
    return symbol.replace(".", "-").upper()


def _scan_tickers_for_discord(
    tickers: List[str],
    label: str,
    threshold: float,
    max_count: int = 50
) -> List[dict]:
    """
    Scan tickers for cheap options
    Returns list of alert dictionaries
    """
    alerts = []
    scanned = 0
    
    for symbol in tickers[:max_count]:
        symbol = _normalize_symbol(symbol)
        if not symbol or symbol == "NAN":
            continue
        
        scanned += 1
        try:
            stock = yf.Ticker(symbol)
            if not stock.options:
                continue
            
            current_price = _get_current_price(stock)
            if current_price is None:
                continue
            
            history = stock.history(period="6mo")
            hv30 = compute_historical_volatility(history, 30) if history is not None else None
            metrics = compute_optionality_metrics(stock, current_price, hv30)
            iv_percentile = metrics.get("iv_percentile")
            iv30 = metrics.get("iv30")
            
            if not _is_iv_data_valid(iv30, hv30, iv_percentile):
                continue
            
            bias, votes = _compute_option_bias(iv30, hv30, iv_percentile, metrics.get("avg_edr"))
            if iv_percentile is None or iv_percentile > threshold or bias != "CHEAP":
                continue
            
            # Found a hit!
            direction, direction_reason = _direction_hint(history)
            
            alerts.append({
                "symbol": symbol,
                "price": current_price,
                "iv30": iv30,
                "hv30": hv30,
                "iv_percentile": iv_percentile,
                "bias": bias,
                "direction": direction,
                "votes": votes
            })
            
        except Exception as e:
            print(f"Error scanning {symbol}: {e}")
            continue
    
    return alerts


def _format_discord_embed(symbol: str, alerts: List[dict], threshold: float, scanned: int = 25) -> dict:
    """Format alerts as Discord embed"""
    if not alerts:
        return {
            "embeds": [{
                "title": f"📊 {symbol} Options Sweep Complete",
                "description": f"No cheap options found below {threshold}% IV percentile",
                "color": 0x6c757d,  # Gray
                "fields": [
                    {
                        "name": "Scanned",
                        "value": f"{scanned} tickers",
                        "inline": True
                    },
                    {
                        "name": "Threshold",
                        "value": f"{threshold}%",
                        "inline": True
                    }
                ],
                "footer": {"text": "Options sweep powered by Market Diagnostic Dashboard"}
            }]
        }
    
    # Build fields for each alert
    fields = []
    for alert in alerts[:10]:  # Limit to 10 to avoid Discord limits
        value_lines = [
            f"Price: ${alert['price']:.2f}",
            f"IV: {alert['iv30']:.1f}% | HV: {alert.get('hv30', 0):.1f}%",
            f"IV Percentile: {alert['iv_percentile']:.1f}%",
            f"Direction: {alert['direction']}"
        ]
        fields.append({
            "name": f"📈 {alert['symbol']}",
            "value": "\n".join(value_lines),
            "inline": True
        })
    
    # Add summary field
    if len(alerts) > 10:
        fields.append({
            "name": "➕ More Results",
            "value": f"+{len(alerts) - 10} additional cheap options found",
            "inline": False
        })
    
    # Update footer with scan info
    embed["embeds"][0]["footer"]["text"] = f"Scanned {scanned_count} tickers | Market Diagnostic Dashboard"
    
    return {
        "embeds": [{
            "title": f"🎯 {symbol} Options Sweep - {len(alerts)} Cheap Options Found!",
            "description": f"Found {len(alerts)} options below {threshold}% IV percentile",
            "color": 0x28a745,  # Green
            "fields": fields,
            "footer": {"text": f"Scanned {scanned} tickers • Market Diagnostic Dashboard"}
        }]
    }


async def execute_sweep(
    symbol: str,
    threshold: float,
    interaction_token: str,
    application_id: str
):
    """
    Execute the options sweep and post results back to Discord
    Runs asynchronously in background
    """
    bot_token = os.getenv("DISCORD_BOT_TOKEN")
    if not bot_token:
        print("ERROR: DISCORD_BOT_TOKEN not set")
        return
    
    # Determine which tickers to scan
    if symbol == "SPY":
        url = SP500_IVV_URL
        label = "S&P 500 (SPY/IVV)"
        tickers = _fetch_ishares_tickers(url)
    elif symbol == "IWM":
        url = R2K_IWM_URL
        label = "Russell 2000 (IWM)"
        tickers = _fetch_ishares_tickers(url)
    else:
        # Send error
        await _send_followup(
            application_id,
            interaction_token,
            {"content": f"❌ Unsupported symbol: {symbol}"},
            bot_token
        )
        return
    
    if not tickers:
        await _send_followup(
            application_id,
            interaction_token,
            {"content": f"❌ Failed to fetch {label} holdings"},
            bot_token
        )
        return
    
    # Run the scan (reduced to 25 to stay within 3-minute Discord timeout)
    print(f"[Discord Sweep] Starting scan of 25 {label} tickers...")
    alerts = _scan_tickers_for_discord(tickers, label, threshold, max_count=25)
    print(f"[Discord Sweep] Scan complete. Found {len(alerts)} cheap options.")
    
    # Format and send results
    response_data = _format_discord_embed(symbol, alerts, threshold, 25)
    await _send_followup(application_id, interaction_token, response_data, bot_token)


async def _send_followup(
    application_id: str,
    interaction_token: str,
    data: dict,
    bot_token: str
):
    """Send a followup message to Discord after deferred response"""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}"
    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=data, headers=headers, timeout=10)
        response.raise_for_status()
        print(f"✓ Sent followup message to Discord")
    except Exception as e:
        print(f"✗ Failed to send followup: {e}")
