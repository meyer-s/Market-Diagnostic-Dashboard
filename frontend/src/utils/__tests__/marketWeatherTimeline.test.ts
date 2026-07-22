import { describe, expect, it } from "vitest";

import type { MarketWeatherPricePoint, MarketWeatherResearch } from "../../types/marketWeather";
import {
  buildDirectionalPhaseRuns,
  buildLearnedFormRuns,
  buildMarketStateTimeline,
  focusedRatioDomain,
  sliceMarketStateTimeline,
} from "../marketWeatherTimeline";

const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];

const price: MarketWeatherPricePoint[] = dates.map((date, index) => ({
  date,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 1_000,
}));

const research = {
  derivative_series: [
    { date: dates[0], pressure: 0.2, velocity: 0.1, acceleration: 0, jerk: 0, snap: 0 },
    { date: dates[1], pressure: 0.2, velocity: -0.1, acceleration: 0, jerk: 0, snap: 0 },
    { date: dates[2], pressure: -0.2, velocity: 0.1, acceleration: 0, jerk: 0, snap: 0 },
  ],
  strata: {
    latest: { structure: 0.6, kinematics: 0.5, geometry: 0.4, information: 0.3, propagation: 0.7, cascade_bias: 0, scaling_exponent: 0.5 },
    series: dates.map((date) => ({ date, structure: 0.6, kinematics: 0.5, geometry: 0.4, information: 0.3, propagation: 0.7, cascade_bias: 0, scaling_exponent: 0.5 })),
  },
  carriers: {
    latest: { price_structure: 0.5, realized_volatility: 0.5, participation: 0.5, liquidity_stress: 0.5 },
    series: [],
    ratios: {
      latest: { realized_volatility: 1.2, participation: 0.9, liquidity_stress: 1 },
      baseline: "causal test baseline",
      series: [
        { date: "2025-12-31", realized_volatility: 9, participation: 9, liquidity_stress: 9 },
        { date: dates[0], realized_volatility: 1.1, participation: null, liquidity_stress: 1 },
        { date: dates[2], realized_volatility: 1.2, participation: 0.9, liquidity_stress: 1 },
      ],
    },
  },
  context: {
    technical: {
      series: [
        { date: dates[1], support20: 95, resistance20: 105, atr14: 2, range_position20: 60, support_distance_atr: 3, resistance_distance_atr: 2, trend_gap20_pct: 1.5, return_5bar_pct: 2.2, state: "mid_range" },
      ],
    },
  },
  lexicon: {
    evaluation_sequence: [
      { date: dates[1], state_id: "form-a", distance_tail_score: null, outside_learned_range: null },
      { date: dates[2], state_id: "form-a", calibration_distance_tail_rank: 0.04, in_extreme_calibration_distance_tail: true },
    ],
  },
} as unknown as MarketWeatherResearch;

describe("market weather timeline", () => {
  it("uses price dates as the backbone and leaves missing evidence as gaps", () => {
    const timeline = buildMarketStateTimeline(price, research);

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ volatilityRatio: 1.1, participationRatio: null, stateId: null });
    expect(timeline[1]).toMatchObject({ volatilityRatio: null, calibrationDistanceTailRank: null, stateId: "form-a" });
    expect(timeline[1]).toMatchObject({ support20: 95, resistance20: 105, rangePosition20: 60, priceActionState: "mid_range" });
    expect(timeline[0]).toMatchObject({ support20: null, resistance20: null, priceActionState: null });
    expect(timeline[2]).toMatchObject({ volatilityRatio: 1.2, calibrationDistanceTailRank: 0.04, inExtremeCalibrationTail: true });
    expect(timeline.some((point) => point.volatilityRatio === 9)).toBe(false);
  });

  it("slices by the selected window and collapses deterministic directional phases", () => {
    const timeline = buildMarketStateTimeline(price, research);
    const longTimeline = Array.from({ length: 65 }, (_, index) => ({ ...timeline[index % timeline.length], date: `point-${index}` }));

    expect(sliceMarketStateTimeline(longTimeline, 60).map((point) => point.date)).toEqual(longTimeline.slice(-60).map((point) => point.date));
    expect(sliceMarketStateTimeline(timeline, "all")).toHaveLength(3);
    expect(buildDirectionalPhaseRuns(timeline).map((run) => run.phase)).toEqual([
      "positive-strengthening",
      "positive-fading",
      "negative-fading",
    ]);
    expect(buildLearnedFormRuns(timeline).map((run) => [run.stateId, run.duration])).toEqual([
      [null, 1],
      ["form-a", 2],
    ]);
  });

  it("keeps a visible one-times baseline inside every focused ratio domain", () => {
    const timeline = buildMarketStateTimeline(price, research);
    const domain = focusedRatioDomain(timeline, "liquidityRatio");

    expect(domain[0]).toBeLessThan(1);
    expect(domain[1]).toBeGreaterThan(1);
  });

  it("builds one focused carrier domain that contains every finite ratio", () => {
    const timeline = buildMarketStateTimeline(price, research);
    const domain = focusedRatioDomain(timeline, ["volatilityRatio", "participationRatio", "liquidityRatio"]);

    expect(domain[0]).toBeLessThanOrEqual(0.9);
    expect(domain[1]).toBeGreaterThanOrEqual(1.2);
    expect(domain[0]).toBeLessThan(1);
    expect(domain[1]).toBeGreaterThan(1);
  });
});
