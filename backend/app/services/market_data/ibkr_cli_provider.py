from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import dataclass
from typing import Any, Optional, Sequence

import pandas as pd

from app.services.market_data.date_utils import expiry_to_ibkr, expiry_to_iso
from app.services.market_data.provider import OptionChainFrame, OptionRight, UnderlyingQuote
from app.services.market_data.symbol_mapping import ibkr_symbol_candidates
from ibkr_cli.ib_service import (
    _capture_ib_errors,
    _quote_has_useful_prices,
    _quote_snapshot_payload,
    _suppress_ib_async_logs,
    ib_session,
)

logger = logging.getLogger(__name__)

OPTION_COLUMNS = [
    "contractSymbol",
    "strike",
    "bid",
    "ask",
    "lastPrice",
    "volume",
    "openInterest",
    "impliedVolatility",
    "lastTradeDate",
    "delta",
    "gamma",
    "theta",
    "vega",
    "ibkrConId",
    "right",
    "quoteSource",
]


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class TtlCache:
    def __init__(self) -> None:
        self._items: dict[tuple[Any, ...], _CacheEntry] = {}

    def get(self, key: tuple[Any, ...]) -> Any | None:
        item = self._items.get(key)
        if item is None:
            return None
        if item.expires_at < time.time():
            self._items.pop(key, None)
            return None
        return item.value

    def set(self, key: tuple[Any, ...], value: Any, ttl_seconds: float) -> None:
        self._items[key] = _CacheEntry(value=value, expires_at=time.time() + ttl_seconds)


class IbkrCliProvider:
    name = "ibkr"

    def __init__(
        self,
        profile_name: str | None = None,
        exchange: str | None = None,
        currency: str | None = None,
        timeout: float | None = None,
    ) -> None:
        from ibkr_cli.config import get_profile, load_config

        config, _exists = load_config()
        selected_name, selected_profile = get_profile(config, profile_name or os.getenv("IBKR_PROFILE"))

        self.profile_name = selected_name
        self.profile = selected_profile
        self.exchange = exchange or os.getenv("IBKR_EXCHANGE", "SMART")
        self.currency = currency or os.getenv("IBKR_CURRENCY", "USD")
        self.timeout = float(timeout or os.getenv("IBKR_TIMEOUT_SECONDS", "5"))
        self.chain_ttl = float(os.getenv("IBKR_CHAIN_CACHE_TTL_SECONDS", "86400"))
        self.quote_ttl = float(os.getenv("IBKR_QUOTE_CACHE_TTL_SECONDS", "30"))
        self.bars_ttl = float(os.getenv("IBKR_BARS_CACHE_TTL_SECONDS", "300"))
        self.max_strikes = int(os.getenv("IBKR_MAX_STRIKES_PER_EXPIRY", "40"))
        self.allow_delayed = os.getenv("IBKR_ALLOW_DELAYED", "true").strip().lower() in {"1", "true", "yes"}
        self._cache = TtlCache()
        self._symbol_cache: dict[str, str] = {}

    def quote(self, symbol: str) -> UnderlyingQuote:
        normalized = symbol.upper()
        key = ("quote", normalized)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        payload = self._call_with_symbol(normalized, self._quote_snapshot_with_fallback)
        quote = UnderlyingQuote(
            symbol=normalized,
            last=_num(payload.get("last")),
            bid=_num(payload.get("bid")),
            ask=_num(payload.get("ask")),
            close=_num(payload.get("close")),
            open=_num(payload.get("open")),
            high=_num(payload.get("high")),
            low=_num(payload.get("low")),
            volume=_num(payload.get("volume")),
            source=self.name,
            quote_source=str(payload.get("quote_source")) if payload.get("quote_source") else None,
            observed_at=str(payload.get("observed_at")) if payload.get("observed_at") else None,
        )
        from app.services.market_data_capture import record_underlying_quote

        record_underlying_quote(quote, raw_payload=payload)
        self._cache.set(key, quote, self.quote_ttl)
        return quote

    def daily_bars(self, symbol: str, days: int = 365) -> pd.DataFrame:
        from ibkr_cli.ib_service import get_historical_bars

        normalized = symbol.upper()
        key = ("bars", normalized, int(days))
        cached = self._cache.get(key)
        if cached is not None:
            return cached.copy()

        def fetch(api_symbol: str) -> dict[str, Any]:
            return get_historical_bars(
                self.profile,
                symbol=api_symbol,
                exchange=self.exchange,
                currency=self.currency,
                duration=_duration_for_days(days),
                bar_size="1 day",
                what_to_show="TRADES",
                use_rth=True,
                timeout=self.timeout,
            )

        payload = self._call_with_symbol(normalized, fetch)
        rows = payload.get("rows") or []
        frame = _bars_rows_to_frame(rows).tail(days)
        from app.services.market_data_capture import record_daily_bars

        record_daily_bars(provider=self.name, symbol=normalized, frame=frame, days_requested=days)
        self._cache.set(key, frame.copy(), self.bars_ttl)
        return frame

    def option_expirations(self, symbol: str) -> list[str]:
        chain_rows = self._chain_rows(symbol)
        expirations: set[str] = set()
        for row in chain_rows:
            for exp in row.get("expirations") or []:
                expirations.add(expiry_to_iso(str(exp)))
        return sorted(expirations)

    def option_strikes(self, symbol: str, expiry: str) -> list[float]:
        normalized = symbol.upper()
        iso_expiry = expiry_to_iso(expiry)
        key = ("strikes", normalized, iso_expiry)
        cached = self._cache.get(key)
        if cached is not None:
            return list(cached)
        target = expiry_to_ibkr(expiry)
        chain_row = self._best_chain_row(normalized, target)
        strikes = sorted(
            float(s)
            for s in (chain_row.get("strikes") or [])
            if _num(s) is not None
        )
        self._cache.set(key, strikes, self.chain_ttl)
        return strikes

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        normalized = symbol.upper()
        iso_expiry = expiry_to_iso(expiry)
        ibkr_expiry = expiry_to_ibkr(expiry)
        rights = _rights_for_request(right)

        if strikes is not None:
            strike_list = sorted({float(s) for s in strikes if s is not None})
            if self.max_strikes > 0 and len(strike_list) > self.max_strikes:
                spot = self.quote(normalized).price
                strike_list = _trim_strikes_near_spot(strike_list, spot, self.max_strikes)
        else:
            strike_list = None

        cache_key = (
            "option_chain",
            normalized,
            iso_expiry,
            right,
            tuple(round(s, 6) for s in strike_list) if strike_list is not None else None,
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            return OptionChainFrame(
                symbol=cached.symbol,
                expiry=cached.expiry,
                calls=cached.calls.copy(),
                puts=cached.puts.copy(),
                source=cached.source,
                quote_source=cached.quote_source,
            )

        logger.info(
            "option_chain_fetch",
            extra={
                "provider": self.name,
                "symbol": normalized,
                "expiry": iso_expiry,
                "right": right,
                "strike_count": len(strike_list or []),
            },
        )

        rows: list[dict[str, Any]] = []

        for ibkr_right in rights:
            payload = self._call_with_symbol(
                normalized,
                lambda api_symbol, ibkr_right=ibkr_right: self._get_option_quotes_with_fallback(
                    api_symbol=api_symbol,
                    expiration=ibkr_expiry,
                    strikes=strike_list,
                    right=ibkr_right,
                ),
            )
            rows.extend(payload.get("rows") or [])

        calls, puts = _ibkr_option_rows_to_frames(rows)
        quote_sources = {
            str(value)
            for value in pd.concat([calls, puts], ignore_index=True).get("quoteSource", pd.Series(dtype=object)).dropna()
            if value
        }
        chain = OptionChainFrame(
            symbol=normalized,
            expiry=iso_expiry,
            calls=calls,
            puts=puts,
            source=self.name,
            quote_source=",".join(sorted(quote_sources)) if quote_sources else None,
        )
        from app.services.market_data_capture import record_option_chain

        record_option_chain(provider=self.name, chain=chain, right=right, strikes=strike_list)
        self._cache.set(cache_key, chain, self.quote_ttl)
        return OptionChainFrame(
            symbol=chain.symbol,
            expiry=chain.expiry,
            calls=chain.calls.copy(),
            puts=chain.puts.copy(),
            source=chain.source,
            quote_source=chain.quote_source,
        )

    def _chain_rows(self, symbol: str) -> list[dict[str, Any]]:
        from ibkr_cli.ib_service import get_option_chains

        normalized = symbol.upper()
        key = ("chains", normalized)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        def fetch(api_symbol: str) -> dict[str, Any]:
            return get_option_chains(
                self.profile,
                symbol=api_symbol,
                exchange=self.exchange,
                currency=self.currency,
                timeout=self.timeout,
            )

        payload = self._call_with_symbol(normalized, fetch)
        rows = list(payload.get("rows") or [])
        self._cache.set(key, rows, self.chain_ttl)
        return rows

    def _best_chain_row(self, symbol: str, ibkr_expiry: str) -> dict[str, Any]:
        rows = self._chain_rows(symbol)
        usable = [row for row in rows if ibkr_expiry in set(row.get("expirations") or [])]
        if not usable:
            raise RuntimeError(f"No IBKR option chain for {symbol} expiry={ibkr_expiry}")
        smart = [row for row in usable if str(row.get("exchange", "")).upper() == self.exchange.upper()]
        return (smart or usable)[0]

    def _call_with_symbol(self, symbol: str, fetcher) -> dict[str, Any]:
        normalized = symbol.upper()
        cached_symbol = self._symbol_cache.get(normalized)
        if cached_symbol:
            return fetcher(cached_symbol)

        last_exc: Exception | None = None
        for candidate in ibkr_symbol_candidates(normalized):
            try:
                payload = fetcher(candidate)
            except Exception as exc:
                last_exc = exc
                continue
            self._symbol_cache[normalized] = candidate
            return payload
        raise RuntimeError(f"IBKR request failed for {normalized}: {last_exc}") from last_exc

    def _quote_snapshot_with_fallback(self, api_symbol: str) -> dict[str, Any]:
        from ib_async import Stock

        modes = _quote_market_data_modes(self.allow_delayed)

        with ib_session(self.profile, timeout=self.timeout, readonly=True) as ib:
            contract = Stock(symbol=api_symbol.upper(), exchange=self.exchange, currency=self.currency)
            qualified = ib.qualifyContracts(contract)
            if not qualified:
                raise RuntimeError(f"Unable to qualify contract for symbol '{api_symbol}'.")

            qualified_contract = qualified[0]
            matcher = lambda current_contract: current_contract is not None and getattr(current_contract, "conId", None) == qualified_contract.conId
            last_payload: dict[str, Any] | None = None
            for mode in modes:
                with _capture_ib_errors(ib, matcher) as raw_errors:
                    with _suppress_ib_async_logs():
                        ib.reqMarketDataType(mode)
                        ticker = ib.reqTickers(qualified_contract)[0]
                last_payload = _quote_snapshot_payload(ticker, qualified_contract)
                last_payload["quote_source"] = _quote_source_for_market_data_type(mode)
                last_payload["requested_market_data_type"] = modes[0]
                last_payload["returned_market_data_type"] = mode
                last_payload["fallback_applied"] = mode != modes[0]
                last_payload["raw_error_codes"] = sorted({int(error["code"]) for error in raw_errors})
                last_payload["raw_errors"] = raw_errors
                if _quote_has_useful_prices(last_payload):
                    return last_payload

            if last_payload is not None:
                return last_payload
            raise RuntimeError(f"Unable to retrieve quote snapshot for '{api_symbol}'.")

    def _get_option_quotes_with_fallback(
        self,
        *,
        api_symbol: str,
        expiration: str,
        strikes: Optional[list[float]],
        right: str,
    ) -> dict[str, Any]:
        from ibkr_cli.ib_service import ib_session
        from ib_async import Option, Stock

        if not strikes:
            raise ValueError("IbkrCliProvider.option_chain requires an explicit strike list")

        modes = [1]
        if self.allow_delayed:
            modes.extend([2, 3, 4])

        with ib_session(self.profile, timeout=self.timeout, readonly=True) as ib:
            underlying = Stock(symbol=api_symbol.upper(), exchange=self.exchange, currency=self.currency)
            qualified_underlying = ib.qualifyContracts(underlying)
            if not qualified_underlying:
                raise RuntimeError(f"Unable to qualify contract for symbol '{api_symbol}'.")

            qualified_contract = qualified_underlying[0]
            contracts = [
                Option(api_symbol.upper(), expiration, float(strike), right, self.exchange, currency=self.currency)
                for strike in sorted(strikes)
            ]
            qualified_options = ib.qualifyContracts(*contracts)
            if not qualified_options:
                raise RuntimeError(
                    f"Unable to qualify any option contracts for '{api_symbol}' "
                    f"expiration={expiration} strikes={strikes}."
                )

            selected_rows: list[dict[str, Any]] = []
            returned_mode = modes[0]
            fallback_applied = False
            for mode in modes:
                ib.reqMarketDataType(mode)
                tickers = ib.reqTickers(*qualified_options)
                rows = [_ticker_to_option_row(ticker, mode) for ticker in tickers]
                selected_rows = rows
                returned_mode = mode
                fallback_applied = mode != modes[0]
                if any(_option_row_has_useful_quote(row) for row in rows):
                    break

            selected_rows.sort(key=lambda row: (str(row["right"]), float(row["strike"])))
            return {
                "symbol": qualified_contract.symbol,
                "local_symbol": qualified_contract.localSymbol,
                "exchange": qualified_contract.exchange,
                "primary_exchange": qualified_contract.primaryExchange,
                "currency": qualified_contract.currency,
                "sec_type": qualified_contract.secType,
                "con_id": qualified_contract.conId,
                "expiration": expiration,
                "right_filter": right,
                "strike_count": len(strikes),
                "count": len(selected_rows),
                "requested_market_data_type": modes[0],
                "returned_market_data_type": returned_mode,
                "fallback_applied": fallback_applied,
                "quote_source": _quote_source_for_market_data_type(returned_mode),
                "rows": selected_rows,
            }


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except Exception:
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def _int_or_none(value: Any) -> int | None:
    number = _num(value)
    return int(number) if number is not None else None


def _greeks_payload(greeks: object) -> Optional[dict[str, Optional[float]]]:
    if greeks is None:
        return None
    return {
        "implied_vol": _num(getattr(greeks, "impliedVol", None)),
        "delta": _num(getattr(greeks, "delta", None)),
        "gamma": _num(getattr(greeks, "gamma", None)),
        "theta": _num(getattr(greeks, "theta", None)),
        "vega": _num(getattr(greeks, "vega", None)),
        "opt_price": _num(getattr(greeks, "optPrice", None)),
        "und_price": _num(getattr(greeks, "undPrice", None)),
        "pv_dividend": _num(getattr(greeks, "pvDividend", None)),
    }


def _quote_source_for_market_data_type(mode: int) -> str:
    return {
        1: "live",
        2: "frozen",
        3: "delayed",
        4: "delayed_frozen",
    }.get(mode, f"market_data_type_{mode}")


def _quote_market_data_modes(allow_delayed: bool) -> list[int]:
    return [3, 4, 1, 2] if allow_delayed else [1, 2, 3, 4]


def _ticker_to_option_row(ticker: object, market_data_type: int) -> dict[str, Any]:
    opt = ticker.contract
    model = _greeks_payload(getattr(ticker, "modelGreeks", None))
    return {
        "symbol": opt.symbol,
        "local_symbol": opt.localSymbol,
        "con_id": opt.conId,
        "expiration": opt.lastTradeDateOrContractMonth,
        "strike": opt.strike,
        "right": opt.right,
        "exchange": opt.exchange,
        "trading_class": opt.tradingClass,
        "multiplier": opt.multiplier,
        "bid": _num(getattr(ticker, "bid", None)),
        "ask": _num(getattr(ticker, "ask", None)),
        "last": _num(getattr(ticker, "last", None)),
        "volume": _num(getattr(ticker, "volume", None)),
        "open_interest": _num(getattr(ticker, "openInterest", None)),
        "implied_vol": model["implied_vol"] if model else None,
        "delta": model["delta"] if model else None,
        "gamma": model["gamma"] if model else None,
        "theta": model["theta"] if model else None,
        "vega": model["vega"] if model else None,
        "und_price": model["und_price"] if model else None,
        "model_greeks": model,
        "market_data_type": market_data_type,
        "quote_source": _quote_source_for_market_data_type(market_data_type),
    }


def _option_row_has_useful_quote(row: dict[str, Any]) -> bool:
    for key in ("bid", "ask", "last", "implied_vol"):
        value = _num(row.get(key))
        if value is not None and value > 0:
            return True
    return False


def _rights_for_request(right: OptionRight) -> list[str]:
    normalized = right.upper()
    if normalized == "CALL":
        return ["C"]
    if normalized == "PUT":
        return ["P"]
    if normalized == "ALL":
        return ["C", "P"]
    raise ValueError(f"Unsupported option right: {right}")


def _duration_for_days(days: int) -> str:
    days = max(1, int(days))
    if days <= 30:
        return f"{days} D"
    if days <= 365:
        return "1 Y"
    years = max(1, math.ceil(days / 365))
    return f"{years} Y"


def _bars_rows_to_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    frame = pd.DataFrame(
        {
            "Open": [_num(row.get("open")) for row in rows],
            "High": [_num(row.get("high")) for row in rows],
            "Low": [_num(row.get("low")) for row in rows],
            "Close": [_num(row.get("close")) for row in rows],
            "Volume": [_num(row.get("volume")) for row in rows],
        },
        index=pd.to_datetime([row.get("date") for row in rows], errors="coerce"),
    )
    frame = frame[frame.index.notna()]
    frame = frame.dropna(subset=["Open", "High", "Low", "Close"]).sort_index()
    return frame


def _empty_option_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=OPTION_COLUMNS)


def _ibkr_option_rows_to_frames(rows: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.DataFrame]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        raw_right = str(row.get("right") or "").upper()
        side = "CALL" if raw_right in {"C", "CALL"} else "PUT" if raw_right in {"P", "PUT"} else None
        if side is None:
            continue
        normalized.append(
            {
                "contractSymbol": row.get("local_symbol"),
                "strike": _num(row.get("strike")),
                "bid": _num(row.get("bid")),
                "ask": _num(row.get("ask")),
                "lastPrice": _num(row.get("last")),
                "volume": _int_or_none(row.get("volume")),
                "openInterest": _int_or_none(row.get("open_interest")),
                "impliedVolatility": _num(row.get("implied_vol")),
                "lastTradeDate": None,
                "delta": _num(row.get("delta")),
                "gamma": _num(row.get("gamma")),
                "theta": _num(row.get("theta")),
                "vega": _num(row.get("vega")),
                "ibkrConId": row.get("con_id"),
                "right": side,
                "quoteSource": row.get("quote_source"),
            }
        )

    frame = pd.DataFrame(normalized, columns=OPTION_COLUMNS)
    if frame.empty:
        empty = _empty_option_frame()
        return empty.copy(), empty.copy()
    frame = frame.dropna(subset=["strike"]).sort_values(["right", "strike"])
    calls = frame[frame["right"] == "CALL"].copy()
    puts = frame[frame["right"] == "PUT"].copy()
    return calls, puts


def _trim_strikes_near_spot(strikes: list[float], spot: float | None, max_count: int) -> list[float]:
    if max_count <= 0 or len(strikes) <= max_count:
        return strikes
    if spot is None or spot <= 0:
        mid = len(strikes) // 2
        half = max_count // 2
        return strikes[max(0, mid - half): mid + half + 1]
    return sorted(sorted(strikes), key=lambda s: abs(s - spot))[:max_count]
