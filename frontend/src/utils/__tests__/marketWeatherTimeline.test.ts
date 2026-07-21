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
  lexicon: {
    evaluation_sequence: [
      { date: dates[1], state_id: "form-a", distance_tail_score: null, outside_learned_range: null },
      { date: dates[2], state_id: "form-a", distance_tail_score: 0.04, outside_learned_range: true },
    ],
  },
} as unknown as MarketWeatherResearch;

describe("market weather timeline", () => {
  it("uses price dates as the backbone and leaves missing evidence as gaps", () => {
    const timeline = buildMarketStateTimeline(price, research);

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ volatilityRatio: 1.1, participationRatio: null, stateId: null });
    expect(timeline[1]).toMatchObject({ volatilityRatio: null, distanceTailScore: null, stateId: "form-a" });
    expect(timeline[2]).toMatchObject({ volatilityRatio: 1.2, distanceTailScore: 0.04, outsideLearnedRange: true });
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
});
