export type MarketWeatherMode = "regime" | "convection" | "topographic" | "swami" | "inspector";
export type MarketWeatherTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1D" | "1W";

export interface MarketWeatherPricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketWeatherSummary {
  regime: string;
  field_direction: number;
  horizon_alignment: number;
  coherence: number;
  entropy: number;
  permutation_entropy: number;
  reflectivity: number;
  convection: number;
  expansion: number;
  expansion_front: number | null;
}

export interface MarketWeatherProfileRow {
  horizon: number;
  pressure: number;
  confidence: number;
  coherence: number;
  entropy: number;
  permutation_entropy: number;
  expansion: number;
  convection: number;
}

export interface MarketWeatherDerivativePoint {
  date: string;
  pressure: number;
  velocity: number;
  acceleration: number;
  jerk: number;
  snap: number;
}

export interface MarketWeatherStrataPoint {
  date: string;
  structure: number;
  kinematics: number;
  geometry: number;
  information: number;
  propagation: number;
  cascade_bias: number;
  scaling_exponent: number;
}

export interface MarketWeatherStrataLatest {
  structure: number;
  kinematics: number;
  geometry: number;
  information: number;
  propagation: number;
  cascade_bias: number;
  scaling_exponent: number;
}

export interface MarketWeatherCarrierPoint {
  date: string;
  price_structure: number;
  realized_volatility: number;
  participation: number;
  liquidity_stress: number;
}

export type MarketWeatherCarrierLatest = Omit<MarketWeatherCarrierPoint, "date">;

export interface MarketWeatherRelationshipResult {
  id: string;
  label: string;
  hypothesis: string;
  outcome: string;
  forward_bars: number;
  sample_size: number;
  event_mean: number | null;
  baseline_mean: number | null;
  uplift: number | null;
  event_hit_rate: number | null;
  baseline_hit_rate: number | null;
  status: string;
  method: string;
}

export interface MarketWeatherResearch {
  model?: string;
  coordinate?: Record<string, string>;
  definitions: Record<string, string>;
  derivative_series: MarketWeatherDerivativePoint[];
  strata: {
    latest: MarketWeatherStrataLatest;
    series: MarketWeatherStrataPoint[];
  };
  carriers?: {
    latest: MarketWeatherCarrierLatest;
    series: MarketWeatherCarrierPoint[];
  };
  relationship_atlas: MarketWeatherRelationshipResult[];
  validation?: {
    design: string;
    calibration_bars: number;
    evaluation_bars: number;
    calibration_end: string | null;
    evaluation_start: string | null;
    forward_bars: number;
    purged: boolean;
    multiple_testing_adjusted: boolean;
  };
  notes: string[];
}

export interface MarketWeatherResponse {
  symbol: string;
  generated_at: string;
  data_source: string;
  quote: {
    price: number | null;
    source: string;
    quote_source: string | null;
    observed_at: string | null;
  };
  bar_size: string;
  timeframe: MarketWeatherTimeframe;
  requested_bars: number;
  available_bars: number;
  coverage_start: string;
  coverage_end: string;
  orientation: "horizon_by_time";
  dates: string[];
  horizons: number[];
  price: MarketWeatherPricePoint[];
  channels: Record<string, number[][]>;
  summary: MarketWeatherSummary;
  latest_profile: MarketWeatherProfileRow[];
  settings: Record<string, number>;
  research?: MarketWeatherResearch;
  methodology: {
    causal: boolean;
    description: string;
    research_status: string;
  };
}

export interface MarketWeatherCell {
  pressure: number;
  direction: number;
  structural_strength: number;
  velocity: number;
  acceleration: number;
  jerk: number;
  snap: number;
  scale_gradient: number;
  scale_curvature: number;
  mixed_derivative: number;
  cascade_velocity: number;
  propagation_strength: number;
  permutation_entropy: number;
  scaling_exponent: number;
  boundary_energy: number;
  vertical_gradient: number;
  temporal_gradient: number;
  laplacian: number;
  coherence: number;
  entropy: number;
  persistence: number;
  confidence: number;
  expansion: number;
  contraction: number;
  reflectivity: number;
  convection: number;
  swami: number;
  [key: string]: number;
}
