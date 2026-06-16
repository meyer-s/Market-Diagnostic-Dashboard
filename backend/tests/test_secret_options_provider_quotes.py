from datetime import date, timedelta

from app.api.secret_options import _resolve_option_row
from tests.fake_market_data import FakeProvider


def test_resolve_option_row_finds_nearest_provider_strike() -> None:
    provider = FakeProvider()
    expiry = date.today() + timedelta(days=46)

    row = _resolve_option_row(provider, "FAKE", expiry, "call", 101.0)

    assert row is not None
    assert row["strike"] == 100.0
    assert row["right"] == "CALL"
