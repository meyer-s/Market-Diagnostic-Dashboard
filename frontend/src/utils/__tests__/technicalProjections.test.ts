import { describe, expect, it } from "vitest";

import { buildTechnicalProjections, type ProjectionHistoryPoint } from "../technicalProjections";

const makeHistory = (ramp: number): ProjectionHistoryPoint[] => {
  const start = new Date("2025-01-01T00:00:00Z");

  return Array.from({ length: 240 }, (_, index) => {
    const pointDate = new Date(start);
    pointDate.setUTCDate(start.getUTCDate() + index);

    let price = 100 + index * 0.35;
    if (index >= 220) {
      price += (index - 219) * ramp;
    }

    return {
      date: pointDate.toISOString().slice(0, 10),
      price,
    };
  });
};

describe("buildTechnicalProjections", () => {
  it("produces distinct scores for similar but non-identical assets", () => {
    const projections = buildTechnicalProjections([
      {
        symbol: "BTC",
        name: "Bitcoin",
        current_price: null,
        history: makeHistory(0.55),
      },
      {
        symbol: "ETH",
        name: "Ethereum",
        current_price: null,
        history: makeHistory(0.30),
      },
    ]);

    expect(projections).toHaveLength(2);
    expect(projections[0].score_total).not.toBe(projections[1].score_total);
    expect(projections[0].rank).toBe(1);
    expect(projections[1].rank).toBe(2);
  });

  it("skips assets with missing history instead of throwing", () => {
    const projections = buildTechnicalProjections([
      {
        symbol: "BTC",
        name: "Bitcoin",
        current_price: 90000,
      },
    ]);

    expect(projections).toEqual([]);
  });

  it("requires 200 distinct daily observations rather than awarding missing SMA200 points", () => {
    const history = makeHistory(0.3).slice(-199);
    expect(buildTechnicalProjections([{ current_price: 200, history }])).toEqual([]);
    expect(buildTechnicalProjections([{ current_price: 200, history: [...history, history[0]] }])).toEqual([]);
  });

  it("keeps the technical bar basis separate from a newer quote", () => {
    const history = makeHistory(0.3);
    const [projection] = buildTechnicalProjections([{ current_price: 90000, history }]);
    expect(projection.current_price).toBe(history.at(-1)?.price);
    expect(projection.quote_price).toBe(90000);
    expect(projection.analysis_as_of).toBe(history.at(-1)?.date);
    expect(projection.observation_count).toBe(240);
    const [barOnly] = buildTechnicalProjections([{ current_price: null, history }]);
    expect(projection.technicals).toEqual(barOnly.technicals);
    expect(projection.score_total).toBe(barOnly.score_total);
    expect(projection.levels).toEqual(barOnly.levels);
  });

  it("uses Wilder smoothing after the initial seed rather than a last-14 simple average", () => {
    const history = makeHistory(0).map((point, index) => ({...point, price: 100 + index}));
    // Two final 14-unit losses after a long run of unit gains. Wilder's first
    // loss updates (gain, loss) to (13/14,1); the next gives (169/196,27/14).
    history[238].price = history[237].price - 14;
    history[239].price = history[238].price - 14;
    const [projection] = buildTechnicalProjections([{ current_price: null, history }]);
    expect(projection.technicals.rsi).toBeCloseTo(100 * 169 / 547, 10);
    expect(projection.rsi_method).toBe("wilder_14");
  });

  it("handles flat, rising and falling RSI endpoints without NaN", () => {
    for (const [direction, expected] of [[0, 50], [1, 100], [-1, 0]]) {
      const history = makeHistory(0).map((point, index) => ({...point, price: 500 + direction * index}));
      const [projection] = buildTechnicalProjections([{current_price:null, history}]);
      expect(projection.technicals.rsi).toBe(expected);
      expect(Number.isFinite(projection.score_total)).toBe(true);
    }
  });

  it("deduplicates UTC sessions by latest observation and sorts before calculation", () => {
    const history = makeHistory(0.3);
    const [baseline] = buildTechnicalProjections([{ current_price: null, history }]);
    const duplicate = { date: `${history[100].date}T12:00:00Z`, price: history[100].price };
    const [projection] = buildTechnicalProjections([{ current_price: null, history: [duplicate, ...[...history].reverse()] }]);
    expect(projection.technicals).toEqual(baseline.technicals);
    expect(projection.observation_count).toBe(240);
  });

  it("does not bridge missing or invalid daily prices into day-labelled returns", () => {
    const history = makeHistory(0.3);
    expect(buildTechnicalProjections([{ current_price: null, history: history.filter((_, index) => index !== 220) }])).toEqual([]);
    for (const price of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = history.map((point, index) => index === 220 ? {...point, price} : point);
      expect(buildTechnicalProjections([{ current_price: null, history: invalid }])).toEqual([]);
    }
  });

  it("ignores impossible dates and rejects their contribution to coverage", () => {
    const history = makeHistory(0.3).slice(-199);
    expect(buildTechnicalProjections([{ current_price: null, history: [...history, {date: "2025-02-31", price: 100}, {date: "invalid", price: 100}] }])).toEqual([]);
  });

  it("uses the sample deviation of daily returns annualized for 365-day crypto markets", () => {
    const history = makeHistory(0).map((point, index) => ({...point, price: index % 2 === 0 ? 100 : 110}));
    const [projection] = buildTechnicalProjections([{ current_price: null, history }]);
    // Fifteen +10% returns and fifteen -1/11 returns in the trailing 30 days.
    const mean = (0.1 - 1 / 11) / 2;
    const deviation = Math.sqrt((15 * (0.1 - mean) ** 2 + 15 * (-1 / 11 - mean) ** 2) / 29);
    expect(projection.technicals.volatility_30d).toBeCloseTo(deviation * Math.sqrt(365) * 100, 10);
    expect(projection.annualization_days).toBe(365);
  });

  it("gives equal displayed scores equal competition ranks and relative tiers", () => {
    const history = makeHistory(0.3);
    const projections = buildTechnicalProjections(["BTC", "ETH", "SOL", "XRP"].map(symbol => ({symbol, current_price: null, history})));
    expect(projections.map(item => item.rank)).toEqual([1, 1, 1, 1]);
    expect(projections.map(item => item.relativeClassification)).toEqual(["Neutral", "Neutral", "Neutral", "Neutral"]);
    const distinct = buildTechnicalProjections([
      {symbol:"A", current_price:null, history},
      {symbol:"B", current_price:null, history},
      {symbol:"C", current_price:null, history:makeHistory(0.55)},
    ]);
    const equalPair = distinct.filter(item => item.symbol !== "C");
    expect(equalPair[0].rank).toBe(equalPair[1].rank);
    expect(equalPair[0].relativeClassification).toBe(equalPair[1].relativeClassification);
  });
});
