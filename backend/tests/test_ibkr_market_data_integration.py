import os

import pytest

from app.api.stock_projection import compute_historical_volatility, compute_optionality_metrics
from app.services.market_data.ibkr_cli_provider import IbkrCliProvider

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_IBKR_INTEGRATION") != "1",
    reason="Requires running TWS/IB Gateway and market data permissions",
)


def test_ibkr_provider_quote_chain_and_metrics_smoke() -> None:
    provider = IbkrCliProvider()
    symbol = os.getenv("IBKR_INTEGRATION_SYMBOL", "SPY")

    quote = provider.quote(symbol)
    assert quote.price is not None
    assert quote.price > 0

    expiries = provider.option_expirations(symbol)
    assert expiries

    expiry = expiries[0]
    strikes = provider.option_strikes(symbol, expiry)
    near_spot = [strike for strike in strikes if abs(strike - quote.price) / quote.price < 0.03]
    chain = provider.option_chain(symbol, expiry, right="CALL", strikes=near_spot[:5])
    assert chain.source == "ibkr"

    hist = provider.daily_bars(symbol, days=365)
    hv30 = compute_historical_volatility(hist, 30)
    metrics = compute_optionality_metrics(provider, symbol, quote.price, hv30)
    assert "iv30" in metrics
    assert metrics["data_source"] == "ibkr_option_chain"
