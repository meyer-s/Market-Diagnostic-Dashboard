# Debt Widget Roadmap

Implemented now:
- Debt Composite + Credit Stress (integrates debt ideas 1 and 2)
- Advance/Decline + Volume with time-series pace overlay

Proposed next debt widgets:
- Curve Regime + Drift
  - Source: `/indicators/BOND_MARKET_STABILITY/yield-curve`
  - Focus: 10Y-2Y, 10Y-3M, 30Y-5Y regime and steepening/flattening speed.

- Public vs Corporate Funding Divergence
  - Source: `/indicators/BOND_MARKET_STABILITY/muni`
  - Focus: relationship signal and divergence inputs (`public_sector_score`, `bond_market_score`, `muni_proxy_z_60d`).

- Treasury Volatility Shock
  - Source: `/indicators/BOND_MARKET_STABILITY/components`
  - Focus: treasury volatility stress vs recent percentile baseline.

- Debt Risk Traffic-Light Strip
  - Source: blend of bond stability score, curve inversion flags, and muni divergence state.
  - Focus: one-line at-a-glance debt condition for top-level dashboard context.
