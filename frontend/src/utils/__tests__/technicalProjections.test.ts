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
});
