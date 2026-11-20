export interface PriceVolumeEvent {
  date: string;
  price: number;
  volume: number;
  notional: number;
  volume_z: number;
  clv: number;
  price_change_pct: number;
  // Historical storage identifiers describe candle classifications, not orders.
  side: "buy" | "sell" | "neutral";
  strength: number;
}

export interface ActivityWeek {
  bucket: string;
  signed_turnover_usd: number;
  total_turnover_usd: number;
  positive_events: number;
  negative_events: number;
  neutral_events: number;
  observed_bars: number;
}

export interface PriceVolumeSummary {
  pressure: "positive" | "negative" | "mixed";
  positive_reference_price: number | null;
  negative_reference_price: number | null;
  change_to_positive_reference_pct: number | null;
  change_to_negative_reference_pct: number | null;
  positive_turnover_usd: number;
  negative_turnover_usd: number;
  neutral_turnover_usd: number;
  total_turnover_usd: number;
  signed_turnover_usd: number;
  pressure_balance_pct: number;
  mean_volume_z: number | null;
  latest_event_date: string | null;
  event_count: number;
}

export interface PriceVolumeSignal extends PriceVolumeSummary {
  symbol: string;
  name?: string;
  category?: string;
  status: "ok" | "insufficient_data";
  latest_price: number | null;
  latest_bar_date: string | null;
  bar_age_calendar_days: number | null;
  window_start: string;
  window_end: string;
  eligible_bars: number;
  observed_bars: number;
  volume_unit: "USD" | "shares";
  flow_timeline: ActivityWeek[];
  recent_events: PriceVolumeEvent[];
}
