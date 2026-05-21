# Indicator specification

This document mirrors the canonical indicator registry in [`backend/app/services/indicator_specs.py`](../backend/app/services/indicator_specs.py). Seed metadata, freshness horizons, core-coverage logic, and composite weighting should stay aligned with that file.

| Code | Source | Category | Direction | Weight | Freshness horizon | Core | Formula version | Summary |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| `VIX` | Yahoo `^VIX` | volatility | higher stress = worse | 1.0 | 2 days | yes | `v1` | Rolling z-score of VIX closes mapped to stability. |
| `SPY` | Yahoo `SPY` | equity | higher trend gap = better | 1.3 | 2 days | yes | `v2` | Price vs 50 EMA gap normalized into trend stability. |
| `BREADTH_HEALTH` | Derived `BREADTH_COMPOSITE` | equity | broader participation = better | 1.8 | 2 days | yes | `v2` | RSP/SPY breadth blend with sector participation and return breadth. |
| `T10Y2Y` | FRED `T10Y2Y` | rates | steeper curve = better | 1.0 | 3 days | yes | `v1` | Treasury curve slope normalized to stability. |
| `UNRATE` | FRED `UNRATE` | employment | higher unemployment change = worse | 1.2 | 40 days | yes | `v2` | Six-month unemployment change, not absolute level. |
| `CONSUMER_HEALTH` | Derived `CONSUMER_COMPOSITE` | consumer | stronger consumer spread = better | 1.4 | 40 days | yes | `v2` | Real spending and income spread blended with XLY/XLP divergence. |
| `BOND_MARKET_STABILITY` | Derived `BOND_COMPOSITE` | bonds | more bond stress = worse | 2.0 | 3 days | yes | `v2` | Canonical bond composite across credit, curve, momentum, and volatility. |
| `LIQUIDITY_PROXY` | Derived `LIQUIDITY_COMPOSITE` | liquidity | more liquidity = better | 1.8 | 8 days | yes | `v1` | M2, Fed balance sheet, and reverse repo composite. |
| `ANALYST_ANXIETY` | Derived `ANALYST_ANXIETY_COMPOSITE` | sentiment | more confidence = better | 1.9 | 3 days | yes | `v1` | VIX, MOVE, spreads, and ERP proxy blended into a confidence score. |
| `SENTIMENT_COMPOSITE` | Derived `SENTIMENT_COMPOSITE` | sentiment | stronger sentiment = better | 1.8 | 40 days | yes | `v1` | Consumer and corporate sentiment composite. |
| `SECTOR_REGIME_ALIGNMENT` | Derived `SECTOR_REGIME_ALIGNMENT` | equity | better alignment = better | 0.8 | 7 days | no | `v1` | Sector leadership alignment versus the prevailing system state. |
| `AAS` | Derived `AAS_COMPOSITE` | alternative_assets | stronger stability = better | 2.0 | 3 days | yes | `v1` | Alternative-asset stability across metals and crypto signals. |
| `AGRICULTURE_STABILITY` | Derived `AGRICULTURE_OVERVIEW` | market_page | stronger stability = better | 0.6 | 3 days | no | `v1` | Cached agriculture market-context stability surface. |
| `ENERGY_STABILITY` | Derived `ENERGY_OVERVIEW` | market_page | stronger stability = better | 0.8 | 3 days | no | `v1` | Cached energy market-context stability surface. |
| `REAL_ESTATE_STABILITY` | Derived `REAL_ESTATE_OVERVIEW` | market_page | stronger stability = better | 1.0 | 4 days | no | `v1` | Cached real-estate stability surface. |

## Shared conventions

- **Direction** comes from the spec `direction` field in the backend registry.
- **Freshness horizon** drives stale-indicator reporting and composite confidence.
- **Core coverage** is calculated only from rows where `is_core=True`.
- **Missing-data policy** is currently `exclude_from_composite` for all listed indicators.

Update the Python registry first if methodology changes, then refresh this document to keep the docs and runtime model aligned.
