export type AxisBias = "POSITIVE" | "NEUTRAL" | "NEGATIVE";
export type TechBias = "BULLISH" | "NEUTRAL" | "BEARISH";
export type OptBias = "CHEAP" | "FAIR" | "EXPENSIVE" | "UNKNOWN";

export type AxisScore = {
  label: string;
  bias: AxisBias | TechBias | OptBias;
  score: number;
  confidence: number;
  facts: string[];
  watchouts?: string[];
  debug?: Record<string, unknown>;
};

export type HolisticSummary = {
  regime: string;
  narrative: string;
  bullets: { axis: string; text: string }[];
  watch: string;
  debug?: {
    technical: AxisScore;
    fundamental: AxisScore;
    options: AxisScore;
    regime_matrix: { key: string; rationale: string[] };
  };
};

export type SummaryInput = {
  symbol: string;
  asOf: string;
  technicals: {
    price: number | null;
    ma50: number | null;
    ma200: number | null;
    ma50_slope: number | null;
    ma200_slope: number | null;
    rsi14: number | null;
    rsi14_slope: number | null;
    macd: number | null;
    macd_signal: number | null;
    macd_hist: number | null;
    macd_hist_slope: number | null;
    atr14_pct: number | null;
    atr14_pct_slope: number | null;
    vol_vs_20d: number | null;
    support1: number | null;
    support2: number | null;
    resistance1: number | null;
    resistance2: number | null;
  };
  fundamentals: {
    eps_series?: number[];
    eps_dates?: string[];
    roe_series?: number[];
    roe_dates?: string[];
    fcf_series?: number[];
    fcf_dates?: string[];
    marketcap_series?: number[];
    marketcap_dates?: string[];
    pe_series?: number[];
    pe_dates?: string[];
    revenue_yoy_series?: number[];
    revenue_yoy_dates?: string[];
  };
  options: {
    iv30: number | null;
    hv30: number | null;
    iv_percentile: number | null;
    avg_edr: number | null;
    mispricing_state?: OptBias;
  };
};
