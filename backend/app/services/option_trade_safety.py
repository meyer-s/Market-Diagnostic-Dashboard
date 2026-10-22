"""Account eligibility is separate from scanner scores and quote quality.

The scanner has market-data connections, not a Fidelity account-funding feed.
Neither an account name, a trade date, a historical cash balance nor IBKR quote
access verifies that a Fidelity position is paid for or that a new order fits
the broker's restrictions. Withhold recommendations until that evidence exists.
"""
from __future__ import annotations


def scanner_trade_safety() -> dict[str, object]:
    return {
        "schema_version": "scanner_trade_safety_v1",
        "status": "unverified",
        "recommendation_allowed": False,
        "policy": "settled_cash_required",
        "label": "Funding not verified — research only",
        "reason": (
            "The scanner cannot verify Fidelity restrictions, payment for the held "
            "option, or settled cash available for a replacement. It withholds "
            "trade and roll recommendations."
        ),
        "required_evidence": [
            "Current restrictions for the specific brokerage account",
            "Broker confirmation that the held option is fully paid for before sale",
            "Current settled cash available for the full replacement purchase and fees",
            "Account-specific options permissions and open-order commitments",
        ],
        "funding_rule": (
            "Do not count an expected closing-sale credit, unsettled sale proceeds, "
            "a historical cash balance, or generic margin buying power as settled cash. "
            "A net-credit roll does not establish that either leg is eligible."
        ),
        "source_url": "https://www.fidelity.com/learning-center/trading-investing/trading/avoiding-cash-trading-violations",
        "broker_evidence_as_of": None,
    }
