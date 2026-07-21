import { describe, expect, it } from "vitest";

import type { MarketWeatherCell } from "../../types/marketWeather";
import { marketWeatherCellColor } from "../marketWeather";

const baseCell: MarketWeatherCell = {
  pressure: 0,
  direction: 0,
  structural_strength: 0.5,
  velocity: 0,
  acceleration: 0,
  jerk: 0,
  snap: 0,
  scale_gradient: 0,
  scale_curvature: 0,
  mixed_derivative: 0,
  cascade_velocity: 0,
  propagation_strength: 0,
  permutation_entropy: 0,
  scaling_exponent: 0,
  boundary_energy: 0.2,
  vertical_gradient: 0.2,
  temporal_gradient: 0.2,
  laplacian: 0.2,
  coherence: 0.7,
  entropy: 0.25,
  persistence: 0.7,
  confidence: 0.7,
  expansion: 0,
  contraction: 0,
  reflectivity: 0.5,
  convection: 0.1,
  swami: 0,
};

describe("marketWeatherCellColor", () => {
  it("keeps bullish and bearish regime cells visually distinct", () => {
    const bullish = marketWeatherCellColor({ ...baseCell, pressure: 0.7 }, "regime");
    const bearish = marketWeatherCellColor({ ...baseCell, pressure: -0.7 }, "regime");
    expect(bullish).not.toBe(bearish);
    expect(bullish).toMatch(/^rgb\(/);
    expect(bearish).toMatch(/^rgb\(/);
  });

  it("preserves the five categorical Swami bands", () => {
    const colors = [1.2, 0.5, 0, -0.5, -1.2].map((swami) =>
      marketWeatherCellColor({ ...baseCell, swami }, "swami"),
    );
    expect(new Set(colors).size).toBe(5);
  });

  it("lets the inspector isolate a non-directional channel", () => {
    const quiet = marketWeatherCellColor({ ...baseCell, entropy: 0.05 }, "inspector", "entropy");
    const noisy = marketWeatherCellColor({ ...baseCell, entropy: 0.95 }, "inspector", "entropy");
    expect(quiet).not.toBe(noisy);
  });
});
