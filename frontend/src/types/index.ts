export interface IndicatorStatus {
  code: string;
  name: string;
  raw_value: number;
  score: number;
  state: "GREEN" | "YELLOW" | "RED";
  timestamp: string;
}

export interface SystemStatus {
  state: string;
  composite_score: number;
  red_count: number;
  yellow_count: number;
  timestamp?: string;
}

export interface IndicatorHistoryPoint {
  timestamp: string;
  raw_value: number;
  score: number;
  state: "GREEN" | "YELLOW" | "RED";
}