import { describe, expect, it } from "vitest";

import {
  buildProxyEventClusters,
  percentile,
  proxyClusterHalo,
  proxyEventRadius,
  type ProxyEventInput,
  type ProxyEventPosition,
} from "../proxyEventClusters";

const event = (overrides: Partial<ProxyEventInput> = {}): ProxyEventInput => ({
  date: "2026-07-01",
  price: 100,
  volume: 1_000,
  notional: 100_000,
  volume_z: 2.4,
  side: "buy",
  strength: 1.8,
  ...overrides,
});

const resolver = (positions: Record<string, ProxyEventPosition>) =>
  (input: ProxyEventInput): ProxyEventPosition | null => positions[input.date] ?? null;

describe("proxy event clustering", () => {
  it("groups nearby bars and derives weighted relative context from event data", () => {
    const clusters = buildProxyEventClusters(
      [
        event({
          date: "2026-07-01",
          price: 100,
          volume: 99_999,
          notional: 100,
          side: "buy",
          strength: 2,
        }),
        event({
          date: "2026-07-02",
          price: 110,
          volume: 1,
          notional: 300,
          side: "sell",
          strength: 4,
        }),
      ],
      resolver({
        "2026-07-01": { x: 10, y: 50, sequence: 0 },
        "2026-07-02": { x: 20, y: 55, sequence: 1 },
      }),
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].events).toHaveLength(2);
    expect(clusters[0]).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      totalNotional: 400,
      buyNotional: 100,
      sellNotional: 300,
      neutralNotional: 0,
      weightedPrice: 107.5,
      weightedStrength: 3.5,
      centerX: 17.5,
      centerY: 53.75,
      tone: "mixed",
    });
    expect(clusters[0].events.map((item) => item.weight)).toEqual([100, 300]);
  });

  it("keeps proximity runs bounded by session gaps, total span, and vertical distance", () => {
    const inputs = [
      event({ date: "2026-07-01" }),
      event({ date: "2026-07-02" }),
      event({ date: "2026-07-03" }),
      event({ date: "2026-07-04" }),
      event({ date: "2026-07-05" }),
    ];
    const clusters = buildProxyEventClusters(
      inputs,
      resolver({
        "2026-07-01": { x: 0, y: 10, sequence: 0 },
        "2026-07-02": { x: 10, y: 12, sequence: 5 },
        "2026-07-03": { x: 20, y: 11, sequence: 10 },
        // It is near the previous event, but would extend the first run beyond
        // the maximum sequence span.
        "2026-07-04": { x: 30, y: 12, sequence: 15 },
        // It is temporally close to the fourth event but too far away in price
        // space to join its cluster.
        "2026-07-05": { x: 32, y: 50, sequence: 16 },
      }),
    );

    expect(clusters.map((cluster) => cluster.events.length)).toEqual([3, 1, 1]);
  });

  it("classifies cluster tone from notional mix rather than event count", () => {
    const buyDominant = buildProxyEventClusters(
      [
        event({ date: "2026-07-01", side: "buy", notional: 900 }),
        event({ date: "2026-07-02", side: "sell", notional: 100 }),
      ],
      resolver({
        "2026-07-01": { x: 1, y: 1, sequence: 0 },
        "2026-07-02": { x: 2, y: 2, sequence: 1 },
      }),
    );
    const neutralDominant = buildProxyEventClusters(
      [
        event({ date: "2026-07-01", side: "neutral", notional: 700 }),
        event({ date: "2026-07-02", side: "buy", notional: 300 }),
      ],
      resolver({
        "2026-07-01": { x: 1, y: 1, sequence: 0 },
        "2026-07-02": { x: 2, y: 2, sequence: 1 },
      }),
    );

    expect(buyDominant[0].tone).toBe("buy");
    expect(neutralDominant[0].tone).toBe("neutral");
  });

  it("drops unsupported inputs and falls back to price times volume when notional is unavailable", () => {
    const clusters = buildProxyEventClusters(
      [
        event({ date: "not-a-date" }),
        event({ date: "2026-07-01", price: 0 }),
        event({ date: "2026-07-02", notional: 0, price: 25, volume: 40 }),
        event({ date: "2026-07-03", notional: 0, volume: 0 }),
        event({ date: "2026-07-04" }),
        event({
          date: "2026-07-05",
          side: "unsupported" as ProxyEventInput["side"],
        }),
      ],
      resolver({
        "2026-07-01": { x: 1, y: 1, sequence: 0 },
        "2026-07-02": { x: 2, y: 2, sequence: 1 },
        "2026-07-03": { x: 3, y: 3, sequence: 2 },
        "2026-07-05": { x: 4, y: 4, sequence: 3 },
      }),
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].events).toHaveLength(1);
    expect(clusters[0].events[0]).toMatchObject({
      date: "2026-07-02",
      weight: 1_000,
    });
    expect(clusters[0].totalNotional).toBe(1_000);
  });

  it("scales child bubbles relatively and encloses only genuine multi-event clusters", () => {
    expect(proxyEventRadius(0, 100)).toBe(0);
    expect(proxyEventRadius(64, 100)).toBeCloseTo(4);
    expect(proxyEventRadius(100, 100)).toBeCloseTo(5);
    expect(proxyEventRadius(10_000, 100)).toBe(8.5);
    expect(percentile([Number.NaN, -1, 10, 20, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 40], 0.75)).toBe(30);

    const [cluster] = buildProxyEventClusters(
      [
        event({ date: "2026-07-01", notional: 64 }),
        event({ date: "2026-07-02", notional: 100 }),
      ],
      resolver({
        "2026-07-01": { x: 20, y: 30, sequence: 0 },
        "2026-07-02": { x: 30, y: 34, sequence: 1 },
      }),
    );
    const halo = proxyClusterHalo(cluster, 100);

    expect(halo).not.toBeNull();
    for (const item of cluster.events) {
      const radius = proxyEventRadius(item.weight, 100);
      expect((halo?.cx ?? 0) - (halo?.rx ?? 0)).toBeLessThanOrEqual(item.x - radius);
      expect((halo?.cx ?? 0) + (halo?.rx ?? 0)).toBeGreaterThanOrEqual(item.x + radius);
      expect((halo?.cy ?? 0) - (halo?.ry ?? 0)).toBeLessThanOrEqual(item.y - radius);
      expect((halo?.cy ?? 0) + (halo?.ry ?? 0)).toBeGreaterThanOrEqual(item.y + radius);
    }

    const [singleton] = buildProxyEventClusters(
      [event()],
      () => ({ x: 10, y: 10, sequence: 0 }),
    );
    expect(proxyClusterHalo(singleton, 100)).toBeNull();
  });
});
