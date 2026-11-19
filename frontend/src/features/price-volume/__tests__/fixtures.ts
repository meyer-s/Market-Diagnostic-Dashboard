import type { PriceVolumeSignal } from "../types";

export const activitySignal: PriceVolumeSignal = {
  symbol: "NVDA", name: "NVIDIA", category: "stocks", status: "ok",
  pressure: "positive", latest_price: 150.96, latest_bar_date: "2026-11-18",
  bar_age_calendar_days: 1, window_start: "2026-07-23", window_end: "2026-11-19",
  observed_bars: 85, eligible_bars: 85, event_count: 2,
  positive_reference_price: 227.98, negative_reference_price: 182.4256,
  change_to_positive_reference_pct: 51.02, change_to_negative_reference_pct: 20.84,
  positive_turnover_usd: 2_000_000, negative_turnover_usd: 1_000_000,
  neutral_turnover_usd: 0, total_turnover_usd: 3_000_000, signed_turnover_usd: 1_000_000,
  pressure_balance_pct: 33.33, mean_volume_z: 2.85, latest_event_date: "2026-11-12", volume_unit: "shares",
  flow_timeline: [
    { bucket: "2026-11-09", signed_turnover_usd: 1_000_000, total_turnover_usd: 3_000_000, positive_events: 1, negative_events: 1, neutral_events: 0, observed_bars: 5 },
    { bucket: "2026-11-16", signed_turnover_usd: 0, total_turnover_usd: 0, positive_events: 0, negative_events: 0, neutral_events: 0, observed_bars: 3 },
  ],
  recent_events: [{ date: "2026-11-12", price: 227.98, volume: 100000, notional: 2_000_000, volume_z: 3.2, clv: 0.9, price_change_pct: 1, side: "buy", strength: 2.88 }],
};

export const activityOverview = {
  as_of: "2026-11-19T13:08:15.708159+00:00",
  groups: { stocks: [activitySignal], sectors: [], metals: [], crypto: [] },
  leaders: { positive: [activitySignal], negative: [] },
  stock_selection: { mode: "auto_top_close_volume", symbols: ["NVDA"], count: 1, candidate_count: 30, note: "Selected from a fixed basket, not a market-wide ranking." },
  method: { name: "daily_price_volume_v2", description: "Volume outliers versus the prior 20 bars.", note: "These measures do not establish investor identity or institutional net flows.", source: "Yahoo Finance", turnover_units: "Crypto volume is USD turnover.", bar_timing: "Daily bars may include an unfinished session.", window_start: "2026-07-23", window_end: "2026-11-19", thresholds: { lookback_calendar_days: 120 } },
};
