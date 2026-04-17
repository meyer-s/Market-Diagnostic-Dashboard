"""
Discord sweep - reuses existing sweep scripts
"""
import os
import time
import threading
from typing import Any

import requests
import httpx

# Import existing sweep logic
from maintenance_scripts.options_chain_sweep import _scan_tickers
from app.services.discord_sweep_universe import resolve_sweep_universe


DISCORD_API_BASE = "https://discord.com/api/v10"
_ACTIVE_SWEEPS: dict[str, threading.Event] = {}
_ACTIVE_SWEEPS_LOCK = threading.Lock()


def _sweep_key(channel_id: str | None) -> str:
    return channel_id or "__global__"


def request_stop_sweep(channel_id: str | None = None) -> bool:
    """Request cancellation for the active sweep in a channel, or any active sweep."""
    with _ACTIVE_SWEEPS_LOCK:
        if channel_id:
            control = _ACTIVE_SWEEPS.get(_sweep_key(channel_id))
            if control and not control.is_set():
                control.set()
                return True
            return False

        stopped = False
        for control in _ACTIVE_SWEEPS.values():
            if not control.is_set():
                control.set()
                stopped = True
        return stopped


def has_active_sweep(channel_id: str | None = None) -> bool:
    with _ACTIVE_SWEEPS_LOCK:
        if channel_id:
            control = _ACTIVE_SWEEPS.get(_sweep_key(channel_id))
            return bool(control and not control.is_set())
        return any(not control.is_set() for control in _ACTIVE_SWEEPS.values())


def _register_active_sweep(channel_id: str | None) -> threading.Event | None:
    key = _sweep_key(channel_id)
    with _ACTIVE_SWEEPS_LOCK:
        existing = _ACTIVE_SWEEPS.get(key)
        if existing and not existing.is_set():
            return None
        control = threading.Event()
        _ACTIVE_SWEEPS[key] = control
        return control


def _clear_active_sweep(channel_id: str | None, control: threading.Event) -> None:
    key = _sweep_key(channel_id)
    with _ACTIVE_SWEEPS_LOCK:
        if _ACTIVE_SWEEPS.get(key) is control:
            _ACTIVE_SWEEPS.pop(key, None)


async def execute_sweep(
    symbol: str,
    threshold: float,
    interaction_token: str,
    application_id: str,
    channel_id: str | None = None,
):
    """
    Execute sweep using existing script logic.
    """
    bot_token = os.getenv("DISCORD_BOT_TOKEN")
    if not bot_token:
        print("ERROR: DISCORD_BOT_TOKEN not set")
        return

    stop_event = _register_active_sweep(channel_id)
    if stop_event is None:
        await _send_followup_message(
            application_id=application_id,
            interaction_token=interaction_token,
            content="A sweep is already running in this channel. Use /stop before starting another.",
            bot_token=bot_token,
            channel_id=channel_id,
        )
        return

    try:
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
        status_every = int(os.getenv("DISCORD_SWEEP_STATUS_EVERY_TICKERS", "100"))
        status_min_seconds = float(os.getenv("DISCORD_SWEEP_STATUS_MIN_SECONDS", "60"))
        rate_limit_backoff_seconds = float(os.getenv("DISCORD_SWEEP_RATE_LIMIT_BACKOFF_SECONDS", "90"))
        rate_limit_backoff_multiplier = float(os.getenv("DISCORD_SWEEP_RATE_LIMIT_BACKOFF_MULTIPLIER", "2"))
        rate_limit_backoff_max_seconds = float(os.getenv("DISCORD_SWEEP_RATE_LIMIT_BACKOFF_MAX_SECONDS", "600"))
        rate_limit_max_retries = int(os.getenv("DISCORD_SWEEP_RATE_LIMIT_MAX_RETRIES", "3"))

        start_content = (
            f"Options sweep started. {label} "
            f"Tickers: {len(tickers)} Threshold: {threshold:.1f}% "
            f"Pause: {pause_seconds:.2f}s "
            f"Rate-limit backoff: {rate_limit_backoff_seconds:.0f}s"
        )
        await _send_followup_message(
            application_id=application_id,
            interaction_token=interaction_token,
            content=start_content,
            bot_token=bot_token,
            channel_id=channel_id,
        )

        progress_callback = _build_progress_callback(
            application_id=application_id,
            interaction_token=interaction_token,
            bot_token=bot_token,
            channel_id=channel_id,
            status_every=status_every,
            status_min_seconds=status_min_seconds,
            pause_seconds=pause_seconds,
        )

        # Run the existing scan function (scans all tickers, sends webhooks).
        print(f"[Discord Sweep] Starting scan of {len(tickers)} {label} tickers...")
        hits_result = _scan_tickers(
            tickers,
            label,
            threshold,
            None,
            pause_seconds=pause_seconds,
            capture_hit_symbols=True,
            progress_callback=progress_callback,
            should_stop=stop_event.is_set,
            rate_limit_backoff_seconds=rate_limit_backoff_seconds,
            rate_limit_backoff_multiplier=rate_limit_backoff_multiplier,
            rate_limit_backoff_max_seconds=rate_limit_backoff_max_seconds,
            rate_limit_max_retries=rate_limit_max_retries,
        )
        hits = 0
        hit_symbols: list[str] = []
        if isinstance(hits_result, tuple):
            hits, hit_symbols = hits_result
        else:
            hits = hits_result
        print(f"[Discord Sweep] Scan complete. Found {hits} cheap options.")

        total = len(tickers)
        details = f"\nUniverse key: {universe.key}"
        if universe.notes:
            details += "\nNotes: " + " | ".join(universe.notes[:2])
        if hit_symbols:
            preview = ", ".join(hit_symbols[:12])
            suffix = "" if len(hit_symbols) <= 12 else f" (+{len(hit_symbols) - 12} more)"
            details += f"\nHit symbols: {preview}{suffix}"

        status = "stopped" if stop_event.is_set() else "finished"
        content = f"Options sweep {status}. {label} Scanned tickers {total} Hits: {hits}{details}"
        sent = await _send_followup_message(
            application_id=application_id,
            interaction_token=interaction_token,
            content=content,
            bot_token=bot_token,
            channel_id=channel_id,
        )
        if not sent:
            await _edit_original_response(
                application_id,
                interaction_token,
                {"content": content},
                bot_token,
            )
    finally:
        _clear_active_sweep(channel_id, stop_event)


def _build_progress_callback(
    application_id: str,
    interaction_token: str,
    bot_token: str,
    channel_id: str | None,
    status_every: int,
    status_min_seconds: float,
    pause_seconds: float,
):
    started_at = time.monotonic()
    state = {
        "last_status_at": started_at,
        "last_status_scanned": 0,
        "last_rate_limit_at": 0.0,
        "last_rate_limit_count": 0,
    }

    def _callback(payload: dict[str, Any]) -> None:
        event = payload.get("event")
        scanned = int(payload.get("scanned") or 0)
        total_expected = int(payload.get("total_expected") or 0)
        hits = int(payload.get("hits") or 0)
        errors = int(payload.get("errors") or 0)
        rate_limit_errors = int(payload.get("rate_limit_errors") or 0)
        now = time.monotonic()

        if event == "rate_limit":
            should_send = (
                rate_limit_errors == 1
                or rate_limit_errors - state["last_rate_limit_count"] >= 5
                or now - state["last_rate_limit_at"] >= 120
            )
            if not should_send:
                return
            state["last_rate_limit_at"] = now
            state["last_rate_limit_count"] = rate_limit_errors
            symbol = payload.get("symbol") or "unknown"
            retry_after = float(payload.get("retry_after_seconds") or 0)
            retry_count = int(payload.get("retry_count") or 0)
            max_retries = int(payload.get("max_retries") or 0)
            action = (
                f"Waiting {retry_after:.0f}s, then retrying the same ticker "
                f"({retry_count + 1}/{max_retries})."
                if payload.get("will_retry")
                else "Retry budget exhausted for this ticker; moving on."
            )
            content = (
                "Options sweep status: Yahoo Finance may be throttling requests. "
                f"Last symbol: {symbol}. "
                f"Scanned {scanned}/{total_expected}; hits {hits}; "
                f"errors {errors}; rate-limit warnings {rate_limit_errors}. "
                f"Current pause: {pause_seconds:.2f}s. {action}"
            )
            _send_followup_message_sync(
                application_id,
                interaction_token,
                content,
                bot_token=bot_token,
                channel_id=channel_id,
            )
            return

        if event == "cancelled":
            symbol = payload.get("symbol")
            content = "Options sweep stop requested."
            if symbol:
                content += f" Last symbol: {symbol}."
            content += f" Scanned {scanned}/{total_expected}; hits {hits}; errors {errors}."
            _send_followup_message_sync(
                application_id,
                interaction_token,
                content,
                bot_token=bot_token,
                channel_id=channel_id,
            )
            return

        if event != "progress" or scanned <= 0 or status_every <= 0:
            return

        scanned_delta = scanned - state["last_status_scanned"]
        time_delta = now - state["last_status_at"]
        if scanned_delta < status_every and time_delta < status_min_seconds:
            return

        state["last_status_at"] = now
        state["last_status_scanned"] = scanned
        percent = (scanned / total_expected * 100) if total_expected else 0
        content = (
            f"Options sweep progress: {payload.get('label', 'Universe')} "
            f"{scanned}/{total_expected} ({percent:.0f}%). "
            f"Hits: {hits}. Errors: {errors}."
        )
        if rate_limit_errors:
            content += f" Yahoo/rate-limit warnings: {rate_limit_errors}."
        _send_followup_message_sync(
            application_id,
            interaction_token,
            content,
            bot_token=bot_token,
            channel_id=channel_id,
        )

    return _callback


async def _send_followup_message(
    application_id: str,
    interaction_token: str,
    content: str,
    bot_token: str | None = None,
    channel_id: str | None = None,
) -> bool:
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
                return await _send_channel_message(
                    client,
                    channel_id=channel_id,
                    bot_token=bot_token,
                    content=content,
                )
            print(f"✓ Sent follow-up message: {content[:50]}...")
            return True
        except Exception as e:
            print(f"✗ Failed to send follow-up message: {e}")
            return await _send_channel_message(
                client,
                channel_id=channel_id,
                bot_token=bot_token,
                content=content,
            )


def _send_followup_message_sync(
    application_id: str,
    interaction_token: str,
    content: str,
    bot_token: str | None = None,
    channel_id: str | None = None,
) -> bool:
    """Sync follow-up sender for scanner progress callbacks."""
    url = f"{DISCORD_API_BASE}/webhooks/{application_id}/{interaction_token}"
    try:
        response = requests.post(url, json={"content": content}, timeout=10)
        if response.status_code < 400:
            print(f"✓ Sent sweep status: {content[:50]}...")
            return True
        snippet = response.text[:300].replace("\n", " ")
        print(f"✗ Sweep status follow-up status={response.status_code} body={snippet}")
    except Exception as exc:
        print(f"✗ Failed to send sweep status follow-up: {exc}")

    return _send_channel_message_sync(
        channel_id=channel_id,
        bot_token=bot_token,
        content=content,
    )


async def _send_channel_message(
    client: httpx.AsyncClient,
    channel_id: str | None,
    bot_token: str | None,
    content: str,
) -> bool:
    """Fallback to a normal bot channel message when the interaction webhook fails."""
    if not channel_id or not bot_token:
        return False
    url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
    headers = {"Authorization": f"Bot {bot_token}"}
    try:
        response = await client.post(url, json={"content": content}, headers=headers)
        if response.status_code >= 400:
            snippet = response.text[:300].replace("\n", " ")
            print(f"✗ Channel message status={response.status_code} body={snippet}")
            return False
        print(f"✓ Sent channel fallback message: {content[:50]}...")
        return True
    except Exception as exc:
        print(f"✗ Failed to send channel fallback message: {exc}")
        return False


def _send_channel_message_sync(
    channel_id: str | None,
    bot_token: str | None,
    content: str,
) -> bool:
    """Sync fallback to a normal bot channel message."""
    if not channel_id or not bot_token:
        return False
    url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
    headers = {"Authorization": f"Bot {bot_token}"}
    try:
        response = requests.post(url, json={"content": content}, headers=headers, timeout=10)
        if response.status_code >= 400:
            snippet = response.text[:300].replace("\n", " ")
            print(f"✗ Channel status message status={response.status_code} body={snippet}")
            return False
        print(f"✓ Sent channel status message: {content[:50]}...")
        return True
    except Exception as exc:
        print(f"✗ Failed to send channel status message: {exc}")
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
