export interface MuniSeriesPoint {
  date: string;
  value: number | null;
  stability_score: number | null;
  z_score?: number | null;
}

export interface MuniSeries {
  key: string;
  name?: string;
  label: string;
  source?: string;
  unit?: string;
  is_proxy?: boolean;
  is_live?: boolean;
  as_of?: string | null;
  value?: number | null;
  stability_score?: number | null;
  notes?: string;
  latest?: MuniSeriesPoint | null;
  trend?: string;
  history?: MuniSeriesPoint[];
  stress_cues?: {
    stress_level?: "normal" | "stress" | "severe";
    [key: string]: string | number | boolean | null | undefined;
  };
}

export interface MuniCurvePoint {
  date: string;
  yields?: Record<string, number | null>;
  level?: number | null;
  slope?: number | null;
  score?: number | null;
}

export interface MuniCurve {
  label?: string;
  source?: string;
  notes?: string;
  latest?: MuniCurvePoint | null;
  trend?: string;
  history?: MuniCurvePoint[];
  status?: string;
  reason?: string;
}

export interface YieldCurvePoint {
  maturity: string;
  yield: number;
}

export interface YieldCurveDateEntry {
  date: string;
  curve: YieldCurvePoint[];
}

export interface YieldCurveResponse {
  month: string;
  months_requested?: number;
  curves: YieldCurveDateEntry[];
}

export interface MuniSubsystemResponse {
  as_of?: string;
  series: MuniSeries[];
  composite?: {
    score: number | null;
    state: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
    as_of?: string;
    coverage_live: number;
    coverage_total: number;
    missing_keys: string[];
    weights_used: Record<string, number>;
    near_threshold?: "GREEN" | "RED" | null;
  };
  composite_history?: Array<{
    date: string;
    stability_score: number | null;
  }>;
  relationship_signal?: {
    name: string;
    state: "GREEN" | "YELLOW" | "RED";
    message?: string | null;
    inputs?: {
      public_sector_score?: number | null;
      bond_market_score?: number | null;
      muni_spread_z_60d?: number | null;
    };
  };
  curve?: MuniCurve | null;
}
