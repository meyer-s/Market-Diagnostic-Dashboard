import { describe, expect, it } from "vitest";
import { buildHolisticSummary, _testHelpers } from "../holisticSummary";
import { buildSummaryInputFromSnapshot } from "../summaryInput";
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
    mispricing_usable: true,
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
        mispricing_usable: true,
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
        mispricing_usable: true,
      },
    };
    const summary = buildHolisticSummary(input);
    expect(summary.debug?.options.bias).toBe("UNKNOWN");
    expect(summary.debug?.options.confidence).toBeLessThan(40);
  });

  it("fails closed when pricing inputs are present but unusable", () => {
    const summary = buildHolisticSummary({
      ...baseInput,
      options: {
        iv30: 12,
        hv30: 30,
        iv_percentile: 10,
        avg_edr: 20,
        mispricing_usable: false,
        quality_status: "unusable",
      },
    });

    expect(summary.debug?.options.bias).toBe("UNKNOWN");
    expect(summary.debug?.options.confidence).toBe(0);
    expect(summary.regime).not.toBe("Confirmed Strength");
    expect(summary.narrative).toContain("Options evidence is insufficient");
  });

  it("does not infer an IV-versus-realized relationship from other cheap-pricing inputs", () => {
    const summary = buildHolisticSummary({
      ...baseInput,
      options: {
        iv30: 30,
        hv30: 20,
        iv_percentile: 10,
        avg_edr: 20,
        mispricing_usable: true,
      },
    });

    expect(summary.debug?.options.bias).toBe("CHEAP");
    expect(summary.narrative).toContain("available pricing inputs lean lower");
    expect(summary.narrative).not.toContain("implied volatility is below realized");
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
        mispricing_usable: true,
      },
    };
    const summary = buildHolisticSummary(input);
    expect(summary.watch).toMatch(/Near resistance/);
    expect(summary.narrative).not.toContain(summary.watch);
  });
});

describe("holistic summary evidence wording", () => {
  it("describes neutral axes without assigning supportive trends", () => {
    const summary = buildHolisticSummary({
      ...baseInput,
      technicals: {
        ...baseInput.technicals,
        price: null,
        ma50: null,
        ma200: null,
        ma50_slope: null,
        ma200_slope: null,
        rsi14: null,
        rsi14_slope: null,
        macd: null,
        macd_signal: null,
        macd_hist: null,
        macd_hist_slope: null,
        atr14_pct: null,
        atr14_pct_slope: null,
        vol_vs_20d: null,
      },
      fundamentals: {},
    });

    expect(summary.debug?.technical.bias).toBe("NEUTRAL");
    expect(summary.debug?.fundamental.bias).toBe("NEUTRAL");
    expect(summary.narrative).toContain("Fundamentals read neutral. Technicals are neutral.");
    expect(summary.narrative).not.toMatch(/holding up|supportive/);
  });

  it("keeps an unavailable source timestamp unknown", () => {
    const input = buildSummaryInputFromSnapshot({
      symbol: "TEST",
      technicalData: {
        candles: [{ close: 10, high: 11, low: 9, volume: 100 }],
        current_price: 10,
      },
    });

    expect(input?.asOf).toBeNull();
  });

  it("does not reinterpret a current-chain percentile as historical IV richness", () => {
    const input = buildSummaryInputFromSnapshot({
      symbol: "TEST",
      technicalData: {
        candles: [{ close: 10, high: 11, low: 9, volume: 100 }],
        current_price: 10,
      },
      optionalityMetrics: {
        iv30: 20,
        hv30: 20,
        iv_percentile: 5,
        iv_percentile_kind: "current_chain_cross_section",
        avg_edr: 50,
        mispricing_usable: true,
      },
    });

    expect(input?.options.iv_percentile).toBeNull();
    expect(buildHolisticSummary(input as SummaryInput).debug?.options.bias).toBe("FAIR");
  });

  it("computes trend slopes on the API's EMA basis", () => {
    const closes = Array.from({ length: 220 }, (_, index) =>
      index < 205 ? 100 : 100 + (index - 204) ** 2
    );
    const expectedEmaSlope = (span: number) => {
      const alpha = 2 / (span + 1);
      let ema = closes[0];
      const series = closes.map((value, index) => {
        if (index > 0) ema = value * alpha + ema * (1 - alpha);
        return ema;
      }).slice(span - 1);
      return (series[series.length - 1] - series[series.length - 11]) / 10;
    };

    const input = buildSummaryInputFromSnapshot({
      symbol: "TEST",
      technicalData: {
        candles: closes.map((close) => ({ close, high: close + 1, low: close - 1, volume: 100 })),
        current_price: closes[closes.length - 1],
        sma_50: 110,
        sma_200: 105,
      },
    });

    expect(input?.technicals.ma50_slope).toBeCloseTo(expectedEmaSlope(50), 10);
    expect(input?.technicals.ma200_slope).toBeCloseTo(expectedEmaSlope(200), 10);
  });

  it("describes a declining FCF series as falling", () => {
    const summary = buildHolisticSummary({
      ...baseInput,
      fundamentals: { fcf_series: [500, 450, 400, 350, 300] },
    });

    expect(summary.debug?.fundamental.facts).toContain("FCF YoY -40.0% with falling momentum.");
    expect(summary.debug?.fundamental.facts.join(" ")).not.toContain("flat momentum");
  });

  it("does not fabricate growth from a zero comparison baseline", () => {
    const summary = buildHolisticSummary({
      ...baseInput,
      fundamentals: { eps_series: [0, 1, 2, 3, 4] },
    });
    const epsStats = summary.debug?.fundamental.debug?.eps as { yoy: number | null };
    const rules = summary.debug?.fundamental.debug?.rules as string[];

    expect(epsStats.yoy).toBeNull();
    expect(rules).not.toContain("eps_improving");
    expect(summary.debug?.fundamental.bias).toBe("NEUTRAL");
  });
});
