from __future__ import annotations

from collections import OrderedDict
import inspect
import logging
import os
import threading
import time
from typing import Optional, Sequence

import pandas as pd

from app.services.market_data.ibkr_cli_provider import IbkrCliProvider
from app.services.market_data.provider import MarketDataProvider, OptionChainFrame, OptionRight, UnderlyingQuote
from app.services.market_data.yahoo_provider import YahooProvider

logger = logging.getLogger(__name__)

_PROVIDER_INSTANCE_ENV_KEYS = (
    "IBKR_PROFILE",
    "IBKR_EXCHANGE",
    "IBKR_CURRENCY",
    "IBKR_TIMEOUT_SECONDS",
    "IBKR_CHAIN_CACHE_TTL_SECONDS",
    "IBKR_QUOTE_CACHE_TTL_SECONDS",
    "IBKR_BARS_CACHE_TTL_SECONDS",
    "IBKR_PROVIDER_CACHE_MAX_ENTRIES",
    "IBKR_MAX_STRIKES_PER_EXPIRY",
    "IBKR_ALLOW_DELAYED",
    "MARKET_DATA_PRIMARY_COOLDOWN_SECONDS",
    "MARKET_DATA_PRIMARY_SLOW_SECONDS",
)
_PROVIDER_INSTANCE_CACHE_DEFAULT_MAX_ENTRIES = 8
_provider_instances: OrderedDict[tuple[object, ...], MarketDataProvider] = OrderedDict()
_provider_instances_lock = threading.RLock()


class FallbackMarketDataProvider:
    def __init__(self, primary: MarketDataProvider, fallback: MarketDataProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = getattr(primary, "name", "primary")
        self._primary_disabled_until: dict[str, float] = {}
        self._primary_cooldown_seconds = float(os.getenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60"))
        self._primary_slow_seconds = float(os.getenv("MARKET_DATA_PRIMARY_SLOW_SECONDS", "5"))
        self._state_lock = threading.Lock()
        self._source_local = threading.local()

    def _primary_available(self, method: str) -> bool:
        with self._state_lock:
            return time.monotonic() >= self._primary_disabled_until.get(method, 0.0)

    def _disable_primary(self, method: str, reason: str, exc: Exception | None = None) -> None:
        if self._primary_cooldown_seconds <= 0:
            return
        with self._state_lock:
            self._primary_disabled_until[method] = time.monotonic() + self._primary_cooldown_seconds
        primary_name = getattr(self.primary, "name", "primary")
        fallback_name = getattr(self.fallback, "name", "fallback")
        logger.warning(
            "market_data_primary_disabled primary=%s fallback=%s method=%s reason=%s cooldown_seconds=%s error=%s",
            primary_name,
            fallback_name,
            method,
            reason,
            self._primary_cooldown_seconds,
            str(exc) if exc else None,
            extra={
                "primary": primary_name,
                "fallback": fallback_name,
                "method": method,
                "reason": reason,
                "cooldown_seconds": self._primary_cooldown_seconds,
                "error": str(exc) if exc else None,
            },
        )

    def _call(self, method: str, *args, **kwargs):
        if not self._primary_available(method):
            result = _invoke_provider_method(self.fallback, method, *args, **kwargs)
            self._set_source(method, getattr(self.fallback, "name", "fallback"))
            return result

        started = time.monotonic()
        try:
            result = _invoke_provider_method(self.primary, method, *args, **kwargs)
        except Exception as exc:
            self._disable_primary(method, "exception", exc)
            result = _invoke_provider_method(self.fallback, method, *args, **kwargs)
            self._set_source(method, getattr(self.fallback, "name", "fallback"))
            return result

        elapsed = time.monotonic() - started
        if self._primary_slow_seconds > 0 and elapsed > self._primary_slow_seconds:
            self._disable_primary(method, f"slow_{elapsed:.2f}s")
        self._set_source(method, getattr(self.primary, "name", "primary"))
        return result

    def _set_source(self, method: str, source: str) -> None:
        sources = getattr(self._source_local, "sources", None)
        if sources is None:
            sources = {}
            self._source_local.sources = sources
        sources[method] = source

    def source_for(self, method: str) -> str:
        """Return the provider that actually served the most recent method call."""
        sources = getattr(self._source_local, "sources", {})
        return sources.get(method, self.name)

    def quote(self, symbol: str) -> UnderlyingQuote:
        return self._call("quote", symbol)

    def daily_bars(
        self,
        symbol: str,
        days: int = 365,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        kwargs = {"days": days}
        if force_refresh:
            kwargs["force_refresh"] = True
        return self._call("daily_bars", symbol, **kwargs)

    def historical_bars(
        self,
        symbol: str,
        timeframe: str,
        bars: int = 500,
        *,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        kwargs = {"bars": bars}
        if force_refresh:
            kwargs["force_refresh"] = True
        return self._call("historical_bars", symbol, timeframe, **kwargs)

    def option_expirations(self, symbol: str) -> list[str]:
        return self._call("option_expirations", symbol)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        return self._call("option_strikes", symbol, expiry)

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        return self._call("option_chain", symbol, expiry, right=right, strikes=strikes)


def get_market_data_provider(provider_override: Optional[str] = None) -> MarketDataProvider:
    provider = (provider_override or os.getenv("MARKET_DATA_PROVIDER", "yahoo")).strip().lower()
    if provider not in {"ibkr", "yahoo"}:
        raise ValueError(f"Unsupported MARKET_DATA_PROVIDER={provider!r}")

    cache_key = _provider_instance_cache_key(provider)
    max_entries = _provider_instance_cache_max_entries()
    if max_entries <= 0:
        return _build_market_data_provider(provider)

    with _provider_instances_lock:
        cached = _provider_instances.get(cache_key)
        if cached is not None:
            _provider_instances.move_to_end(cache_key)
            return cached

        instance = _build_market_data_provider(provider)
        _provider_instances[cache_key] = instance
        _provider_instances.move_to_end(cache_key)
        while len(_provider_instances) > max_entries:
            _provider_instances.popitem(last=False)
        return instance


def reset_market_data_provider_cache() -> None:
    """Discard per-worker provider instances, primarily for tests and config reloads."""
    with _provider_instances_lock:
        _provider_instances.clear()


def _provider_instance_cache_key(provider: str) -> tuple[object, ...]:
    if provider == "yahoo":
        return (provider, id(YahooProvider))
    fallback = os.getenv("MARKET_DATA_FALLBACK_PROVIDER", "").strip().lower()
    environment = tuple((name, os.getenv(name)) for name in _PROVIDER_INSTANCE_ENV_KEYS)
    return (provider, fallback, environment, id(IbkrCliProvider), id(YahooProvider))


def _provider_instance_cache_max_entries() -> int:
    raw_value = os.getenv(
        "MARKET_DATA_PROVIDER_INSTANCE_CACHE_MAX_ENTRIES",
        str(_PROVIDER_INSTANCE_CACHE_DEFAULT_MAX_ENTRIES),
    )
    try:
        return max(0, int(raw_value))
    except (TypeError, ValueError):
        logger.warning(
            "invalid MARKET_DATA_PROVIDER_INSTANCE_CACHE_MAX_ENTRIES=%r; using %s",
            raw_value,
            _PROVIDER_INSTANCE_CACHE_DEFAULT_MAX_ENTRIES,
        )
        return _PROVIDER_INSTANCE_CACHE_DEFAULT_MAX_ENTRIES


def _build_market_data_provider(provider: str) -> MarketDataProvider:
    if provider == "ibkr":
        primary: MarketDataProvider = IbkrCliProvider()
        fallback = os.getenv("MARKET_DATA_FALLBACK_PROVIDER", "").strip().lower()
        if fallback == "yahoo":
            return FallbackMarketDataProvider(primary, YahooProvider())
        return primary
    if provider == "yahoo":
        return YahooProvider()
    raise ValueError(f"Unsupported MARKET_DATA_PROVIDER={provider!r}")


def _invoke_provider_method(provider: object, method: str, *args, **kwargs):
    fetcher = getattr(provider, method)
    if "force_refresh" in kwargs and not _accepts_keyword(fetcher, "force_refresh"):
        kwargs = dict(kwargs)
        kwargs.pop("force_refresh", None)
    return fetcher(*args, **kwargs)


def _accepts_keyword(callable_value: object, keyword: str) -> bool:
    try:
        parameters = inspect.signature(callable_value).parameters
    except (TypeError, ValueError):
        return False
    parameter = parameters.get(keyword)
    if parameter is not None and parameter.kind is not inspect.Parameter.POSITIONAL_ONLY:
        return True
    return any(
        value.kind is inspect.Parameter.VAR_KEYWORD
        for value in parameters.values()
    )
