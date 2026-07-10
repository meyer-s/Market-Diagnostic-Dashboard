from __future__ import annotations

from typing import Optional, Sequence

from app.api.stock_projection import (
    _cache_matches_market_data_provider,
    compute_optionality_metrics,
    compute_options_flow,
)
from app.services.market_data import factory
from app.services.market_data.provider import OptionChainFrame, OptionRight
from tests.fake_market_data import FakeProvider


class _PrimaryProvider(FakeProvider):
    name = "ibkr"

    def __init__(self) -> None:
        super().__init__()
        self.option_chain_calls: list[str] = []

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        self.option_chain_calls.append(expiry)
        if expiry == self.expiries[0]:
            raise RuntimeError("front expiry unavailable")
        return super().option_chain(symbol, expiry, right=right, strikes=strikes)


class _FallbackProvider(FakeProvider):
    name = "yahoo"

    def __init__(self) -> None:
        super().__init__()
        self.option_chain_calls: list[str] = []

    def option_chain(
        self,
        symbol: str,
        expiry: str,
        *,
        right: OptionRight = "ALL",
        strikes: Optional[Sequence[float]] = None,
    ) -> OptionChainFrame:
        self.option_chain_calls.append(expiry)
        return super().option_chain(symbol, expiry, right=right, strikes=strikes)


class _FallbackWrapper:
    name = "ibkr"

    def __init__(self) -> None:
        self.primary = _PrimaryProvider()
        self.fallback = _FallbackProvider()


def test_cache_rejects_yahoo_options_when_ibkr_is_active(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "ibkr")

    assert not _cache_matches_market_data_provider(
        {
            "options_flow": {"data_source": "yahoo_option_chain"},
            "optionality": {"data_source": "ibkr_option_chain"},
        }
    )
    assert not _cache_matches_market_data_provider(
        {
            "options_flow": None,
            "optionality": {"data_source": "yahoo_option_chain"},
        }
    )
    assert _cache_matches_market_data_provider(
        {
            "options_flow": {"data_source": "ibkr_option_chain"},
            "optionality": {"data_source": "ibkr_option_chain"},
        }
    )


def test_cache_allows_yahoo_options_when_yahoo_is_active(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "yahoo")

    assert _cache_matches_market_data_provider(
        {
            "options_flow": {"data_source": "yahoo_option_chain"},
            "optionality": {"data_source": "yahoo_option_chain"},
        }
    )


def test_provider_override_can_force_yahoo_when_global_provider_is_ibkr(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_DATA_PROVIDER", "ibkr")
    monkeypatch.setenv("MARKET_DATA_FALLBACK_PROVIDER", "yahoo")

    provider = factory.get_market_data_provider("yahoo")

    assert provider.name == "yahoo"


def test_options_flow_exhausts_primary_expiries_before_fallback() -> None:
    provider = _FallbackWrapper()

    flow = compute_options_flow(provider, "FAKE", 100.0)

    assert flow is not None
    assert flow["data_source"] == "ibkr_option_chain"
    assert flow["expiry"] == provider.primary.expiries[1]
    assert provider.primary.option_chain_calls[:2] == provider.primary.expiries[:2]
    assert provider.fallback.option_chain_calls == []


def test_optionality_metrics_exhausts_primary_expiries_before_fallback() -> None:
    provider = _FallbackWrapper()

    metrics = compute_optionality_metrics(provider, "FAKE", 100.0, 20.0)

    assert metrics["data_source"] == "ibkr_option_chain"
    assert metrics["expiries_scanned"] > 0
    assert provider.primary.expiries[1] in provider.primary.option_chain_calls
    assert provider.fallback.option_chain_calls == []


def test_fallback_provider_skips_primary_after_slow_call(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_DATA_PRIMARY_SLOW_SECONDS", "1")
    monkeypatch.setenv("MARKET_DATA_PRIMARY_COOLDOWN_SECONDS", "60")
    ticks = iter([0.0, 0.0, 2.0, 2.0, 2.1])
    monkeypatch.setattr(factory.time, "monotonic", lambda: next(ticks))

    primary = FakeProvider()
    primary.name = "ibkr"
    fallback = FakeProvider()
    fallback.name = "yahoo"
    provider = factory.FallbackMarketDataProvider(primary, fallback)

    first = provider.quote("FAKE")
    second = provider.quote("FAKE")

    assert first.source == "ibkr"
    assert second.source == "yahoo"
