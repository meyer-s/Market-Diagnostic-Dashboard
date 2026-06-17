from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from tests.fake_market_data import FakeProvider


def test_compute_optionality_metrics_from_provider_frames() -> None:
    provider = FakeProvider()
    hist = provider.daily_bars("FAKE", days=365)
    hv30 = compute_historical_volatility(hist, 30)

    metrics = compute_optionality_metrics(provider, "FAKE", 100.0, hv30)

    assert metrics["iv30"] == 35.0
    assert metrics["avg_edr"] is not None
    assert metrics["iv_percentile"] is not None
    assert metrics["data_source"] == "fake_option_chain"
    assert metrics["price_source_counts"]["mid"] > 0


def test_compute_optionality_metrics_returns_structured_error_on_provider_exception() -> None:
    class FailingProvider(FakeProvider):
        name = "failing"

        def option_expirations(self, symbol: str) -> list[str]:
            raise RuntimeError("not connected")

    metrics = compute_optionality_metrics(FailingProvider(), "FAKE", 100.0, 20.0)

    assert metrics["iv30"] is None
    assert metrics["avg_edr"] is None
    assert metrics["error"] == "not connected"
    assert metrics["data_source"] == "failing_option_chain"


def test_compute_optionality_metrics_can_limit_expiries_for_sweeps() -> None:
    class CountingProvider(FakeProvider):
        def __init__(self) -> None:
            super().__init__()
            self.option_chain_calls = 0

        def option_chain(self, *args, **kwargs):
            self.option_chain_calls += 1
            return super().option_chain(*args, **kwargs)

    provider = CountingProvider()

    metrics = compute_optionality_metrics(
        provider,
        "FAKE",
        100.0,
        20.0,
        max_expiries=1,
        strike_thresholds=[0.08],
    )

    assert metrics["iv30"] == 35.0
    assert metrics["expiries_scanned"] == 1
    assert provider.option_chain_calls == 1
    assert metrics["quote_source"] == "fake"
