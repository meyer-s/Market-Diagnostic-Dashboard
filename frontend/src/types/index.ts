export interface IndicatorStatus {
  code: string;
  name: string;
  weight?: number;
  raw_value: number | null;
  score: number | null;
  state: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  timestamp: string | null;
}

export interface SystemStatus {
  state: string;
  composite_score: number | null;
  red_count: number;
  yellow_count: number;
  green_count?: number;
  total_count?: number;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  coverage_ratio?: number;
  core_coverage_ratio?: number;
  missing_codes?: string[];
  stale_codes?: string[];
  weights_used?: Record<string, number>;
  expected_codes?: string[];
  included_codes?: string[];
  timestamp?: string;
}

export interface IndicatorHistoryPoint {
  timestamp: string;
  raw_value: number;
  score: number;
  state: "GREEN" | "YELLOW" | "RED";
}

export type {
  AxisBias,
  TechBias,
  OptBias,
  AxisScore,
  HolisticSummary,
  SummaryInput,
} from "./holisticSummary";
