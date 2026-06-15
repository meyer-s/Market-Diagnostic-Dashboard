import type { MetricFamily } from "../theme/metricColors";

export type RelatedSignal = {
  label: string;
  reason: string;
};

export type DashboardCardDetails = {
  context: string;
  why: string;
  methodology: string;
  related: RelatedSignal[];
};

export const dashboardCardDetails: Record<
  "overall" | "system" | "dow" | "sector" | "aas",
  DashboardCardDetails
> = {
  overall: {
    context: "System, trend, sectors, alternatives",
    why: "Keeps the dashboard aligned on one read.",
    methodology: "Combines system state, trend alignment, sector leadership, and alt stability.",
    related: [
      { label: "System Overview", reason: "Composite anchor for stability read" },
      { label: "Dow Theory", reason: "Confirms trend agreement across transports" },
      { label: "Sector Divergence", reason: "Shows leadership between defense and growth" },
      { label: "Metals and Crypto", reason: "Risk appetite cross-check for confirmation" },
    ],
  },
  system: {
    context: "Volatility, rates, liquidity, sentiment",
    why: "Anchors the regime read for all cards.",
    methodology: "Weighted composite of stability scores across core indicators.",
    related: [
      { label: "Dow Theory", reason: "Trend confirmation from price leadership" },
      { label: "Sector Divergence", reason: "Leadership check on regime alignment" },
      { label: "Metals and Crypto", reason: "Cross-check for risk appetite shifts" },
    ],
  },
  dow: {
    context: "Classic vs modern trend signals",
    why: "Agreement strengthens trend confirmation across cycles.",
    methodology: "Compares industrial, transport, and utility momentum proxies.",
    related: [
      { label: "System Overview", reason: "Composite confirmation for trend context" },
      { label: "Sector Divergence", reason: "Leadership check on sector participation" },
      { label: "Metals and Crypto", reason: "Risk appetite cross-check for confirmation" },
    ],
  },
  sector: {
    context: "Defensive vs cyclical leadership",
    why: "Leadership shifts confirm regime alignment risk.",
    methodology: "Uses 3-month sector score gaps for rotation.",
    related: [
      { label: "System Overview", reason: "Baseline for regime confirmation read" },
      { label: "Dow Theory", reason: "Participation check across transports data" },
      { label: "Metals and Crypto", reason: "Risk appetite cross-check for confirmation" },
    ],
  },
  aas: {
    context: "Metals vs crypto pressure mix",
    why: "Metals and crypto reveal confidence in fiat risk.",
    methodology: "Composite of metals and crypto stability contributions.",
    related: [
      { label: "System Overview", reason: "Composite anchor for risk regime" },
      { label: "Liquidity Proxy", reason: "Shared liquidity driver for risk" },
      { label: "Sector Divergence", reason: "Leadership confirms defensive rotation signals" },
    ],
  },
};

const indicatorRelatedSignalsByFamily: Record<MetricFamily, RelatedSignal[]> = {
  system: [
    { label: "System Overview", reason: "Composite anchor for regime context" },
    { label: "Sector Divergence", reason: "Leadership check for regime alignment" },
  ],
  market: [
    { label: "System Overview", reason: "Composite anchor for market context" },
    { label: "Dow Theory", reason: "Trend confirmation across transports data" },
  ],
  equity: [
    { label: "Dow Theory", reason: "Price leadership across industrials and transports" },
    { label: "Sector Divergence", reason: "Leadership alignment across cyclical sectors" },
  ],
  volatility: [
    { label: "System Overview", reason: "Volatility feeds composite stability read" },
    { label: "Analyst Confidence", reason: "Shared volatility driver for sentiment" },
  ],
  rates: [
    { label: "Bond Market Stability", reason: "Rates stability drives credit signals" },
    { label: "Liquidity Proxy", reason: "Policy shifts affect liquidity conditions" },
  ],
  liquidity: [
    { label: "System Overview", reason: "Liquidity anchors broad risk conditions" },
    { label: "Metals and Crypto", reason: "Liquidity cycles drive metals and crypto demand" },
  ],
  growth: [
    { label: "Consumer Health", reason: "Growth signals rely on consumer demand" },
    { label: "System Overview", reason: "Growth feeds composite stability read" },
  ],
  sentiment: [
    { label: "System Overview", reason: "Sentiment shifts confirm regime changes" },
    { label: "Metals and Crypto", reason: "Risk appetite cross-check for confidence" },
  ],
  credit: [
    { label: "Bond Market Stability", reason: "Credit spreads signal funding stress" },
    { label: "System Overview", reason: "Credit conditions drive composite risk" },
  ],
  inflation: [
    { label: "Consumer Health", reason: "Inflation shapes real income trends" },
    { label: "Rates", reason: "Policy rates react to inflation" },
  ],
  energy: [
    { label: "Sector Divergence", reason: "Sector leadership reflects macro shifts" },
    { label: "System Overview", reason: "Energy cycles influence growth and prices" },
  ],
  financials: [
    { label: "Bond Market Stability", reason: "Credit stress hits financial balance sheets" },
    { label: "Sector Divergence", reason: "Financials lead cyclicals in recoveries" },
  ],
  tech: [
    { label: "Sector Divergence", reason: "Tech leadership signals growth appetite" },
    { label: "Dow Theory", reason: "Tech momentum reflects broader trend" },
  ],
  consumer: [
    { label: "Consumer Health", reason: "Spending power drives consumer demand" },
    { label: "Sector Divergence", reason: "Consumer sector leads cyclical rotations" },
  ],
  industrials: [
    { label: "Dow Theory", reason: "Industrial leadership anchors trend signals" },
    { label: "Sector Divergence", reason: "Cyclicals confirm broader macro appetite" },
  ],
  materials: [
    { label: "Sector Divergence", reason: "Materials lead in expansion cycles" },
    { label: "Growth", reason: "Demand cycles influence materials pricing" },
  ],
  utilities: [
    { label: "Dow Theory", reason: "Defensive utilities signal risk-off posture" },
    { label: "Sector Divergence", reason: "Defensive leadership marks cautionary regimes" },
  ],
  healthcare: [
    { label: "Sector Divergence", reason: "Defensive leadership signals cautionary regimes" },
    { label: "System Overview", reason: "Defensives align with regime shifts" },
  ],
  realestate: [
    { label: "Rates", reason: "Rates shifts drive real estate demand" },
    { label: "Credit", reason: "Financing conditions affect property risk" },
  ],
  communications: [
    { label: "Sector Divergence", reason: "Growth leadership tracks risk appetite" },
    { label: "Market Map", reason: "Leadership shows broader sector rotation" },
  ],
  crypto: [
    { label: "Crypto", reason: "Crypto drives metals/crypto stability signal" },
    { label: "Liquidity Proxy", reason: "Liquidity cycles influence crypto demand" },
  ],
  metals: [
    { label: "Metals", reason: "Metals drive metals/crypto stability signal" },
    { label: "Inflation", reason: "Metals hedge rising inflation expectations" },
  ],
  gold: [
    { label: "Metals", reason: "Gold stabilizes metals/crypto stability read" },
    { label: "Inflation", reason: "Gold tracks long-term inflation expectations" },
  ],
  silver: [
    { label: "Metals", reason: "Silver moves with metals cycle" },
    { label: "Growth", reason: "Industrial demand links silver to growth" },
  ],
  platinum: [
    { label: "Metals", reason: "Platinum tracks broader metals cycle" },
    { label: "Growth", reason: "Industrial demand links platinum to growth" },
  ],
  palladium: [
    { label: "Metals", reason: "Palladium tracks broader metals cycle" },
    { label: "Growth", reason: "Industrial demand links palladium to growth" },
  ],
  copper: [
    { label: "Materials", reason: "Copper tracks industrial demand and construction cycles" },
    { label: "Growth", reason: "Copper demand confirms growth-sensitive activity" },
  ],
  aluminum: [
    { label: "Materials", reason: "Aluminum follows industrial and manufacturing demand" },
    { label: "Growth", reason: "Activity cycles influence base-metal demand" },
  ],
  benchmark: [
    { label: "System Overview", reason: "Benchmark anchors interpretation of signals" },
    { label: "Market Map", reason: "Benchmarks contextualize sector move magnitude" },
  ],
  neutral: [
    { label: "System Overview", reason: "Neutral anchors interpretation of signals" },
    { label: "Market Map", reason: "Benchmarks contextualize sector move magnitude" },
  ],
};

export const getIndicatorRelatedSignals = (
  indicatorKey: string,
  family: MetricFamily
): RelatedSignal[] => {
  if (indicatorKey === "ANALYST_ANXIETY" || indicatorKey === "ANALYST_CONFIDENCE") {
    return [
      { label: "Volatility", reason: "Volatility shifts drive confidence swings" },
      { label: "Credit Spreads", reason: "Credit stress confirms institutional caution" },
      { label: "System Overview", reason: "Composite confirmation of sentiment shifts" },
    ];
  }

  if (indicatorKey === "BOND_MARKET_STABILITY") {
    return [
      { label: "Rates", reason: "Rates stability drives bond conditions" },
      { label: "Credit", reason: "Credit spreads confirm funding stress" },
      { label: "System Overview", reason: "Bond stress leads composite shifts" },
    ];
  }

  if (indicatorKey === "LIQUIDITY_PROXY") {
    return [
      { label: "Metals and Crypto", reason: "Liquidity cycles drive metals and crypto demand" },
      { label: "Equity", reason: "Liquidity conditions influence risk assets" },
      { label: "System Overview", reason: "Liquidity shifts move composite regime" },
    ];
  }

  if (indicatorKey === "CONSUMER_HEALTH") {
    return [
      { label: "Growth", reason: "Consumer demand anchors growth cycle" },
      { label: "Inflation", reason: "Inflation erodes real purchasing power" },
      { label: "System Overview", reason: "Consumer health feeds composite stability" },
    ];
  }

  return indicatorRelatedSignalsByFamily[family] ?? [];
};
