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
  expansion: number;
  convection: number;
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
