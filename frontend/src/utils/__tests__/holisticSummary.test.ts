import { describe, expect, it } from "vitest";
import { buildHolisticSummary, _testHelpers } from "../holisticSummary";
import type { AxisScore, SummaryInput } from "../../types/holisticSummary";

const baseInput: SummaryInput = {
  symbol: "TEST",
  asOf: "2026-01-22T00:00:00Z",
  technicals: {
    price: 110,
    ma50: 100,
    ma200: 95,
    ma50_slope: 0.3,
    ma200_slope: 0.1,
    rsi14: 60,
    rsi14_slope: 0.2,
    macd: 1.2,
    macd_signal: 0.8,
    macd_hist: 0.4,
    macd_hist_slope: 0.1,
    atr14_pct: 2.4,
    atr14_pct_slope: -0.1,
    vol_vs_20d: 1.3,
    support1: 104,
    support2: 98,
    resistance1: 118,
    resistance2: 125,
  },
  fundamentals: {
    eps_series: [1, 1.1, 1.15, 1.2, 1.3, 1.35, 1.4, 1.5],
    roe_series: [8, 9, 10, 11, 12, 13, 14, 15],
    fcf_series: [100, 120, 130, 140, 150, 170, 180, 200],
    marketcap_series: [100, 110, 115, 120, 130, 140, 150, 160],
    pe_series: [18, 17, 16, 15, 14, 13, 12, 11],
    revenue_yoy_series: [5, 6, 7, 8, 9],
  },
  options: {
    iv30: 18,
    hv30: 24,
    iv_percentile: 25,
    avg_edr: 35,
  },
};

const makeAxis = (bias: AxisScore["bias"]): AxisScore => ({
  label: "Axis",
  bias,
  score: 0,
  confidence: 50,
  facts: ["placeholder"],
});

describe("holistic summary options voting", () => {
  it("resolves tie as FAIR", () => {
    const input: SummaryInput = {
      ...baseInput,
      options: {
        iv30: 15,
        hv30: 25,
        iv_percentile: 80,
        avg_edr: 50,
      },
    };
    const summary = buildHolisticSummary(input);
    expect(summary.debug?.options.bias).toBe("FAIR");
  });

  it("returns UNKNOWN when missing data", () => {
    const input: SummaryInput = {
      ...baseInput,
      options: {
        iv30: null,
        hv30: null,
        iv_percentile: null,
        avg_edr: null,
      },
    };
    const summary = buildHolisticSummary(input);
    expect(summary.debug?.options.bias).toBe("UNKNOWN");
    expect(summary.debug?.options.confidence).toBeLessThan(40);
  });
});

describe("holistic summary regime mapping", () => {
  it("maps to Confirmed Strength", () => {
    const summary = buildHolisticSummary(baseInput);
    expect(summary.regime).toBe("Confirmed Strength");
  });

  it("maps to Quality, Waiting on Tape", () => {
    const regime = _testHelpers.resolveRegime(
      makeAxis("NEUTRAL"),
      makeAxis("POSITIVE"),
      makeAxis("FAIR")
    );
    expect(regime.key).toBe("Quality, Waiting on Tape");
  });

  it("maps to Momentum, Not Fundamental", () => {
    const regime = _testHelpers.resolveRegime(
      makeAxis("BULLISH"),
      makeAxis("NEGATIVE"),
      makeAxis("FAIR")
    );
    expect(regime.key).toBe("Momentum, Not Fundamental");
  });

  it("maps to Speculative / Overheated", () => {
    const regime = _testHelpers.resolveRegime(
      makeAxis("BULLISH"),
      makeAxis("NEUTRAL"),
      makeAxis("EXPENSIVE")
    );
    expect(regime.key).toBe("Speculative / Overheated");
  });

  it("maps to Value With Headwinds", () => {
    const regime = _testHelpers.resolveRegime(
      makeAxis("BEARISH"),
      makeAxis("POSITIVE"),
      makeAxis("CHEAP")
    );
    expect(regime.key).toBe("Value With Headwinds");
  });

  it("maps to Confirmed Weakness", () => {
    const regime = _testHelpers.resolveRegime(
      makeAxis("BEARISH"),
      makeAxis("NEGATIVE"),
      makeAxis("FAIR")
    );
    expect(regime.key).toBe("Confirmed Weakness");
  });
});

describe("holistic summary watch line", () => {
  it("prioritizes resistance + expensive options", () => {
    const input: SummaryInput = {
      ...baseInput,
      technicals: {
        ...baseInput.technicals,
        price: 100,
        resistance1: 101,
      },
      options: {
        iv30: 60,
        hv30: 20,
        iv_percentile: 80,
        avg_edr: 70,
      },
    };
    const summary = buildHolisticSummary(input);
    expect(summary.watch).toMatch(/Near resistance/);
  });
});
