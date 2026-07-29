import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import IndicatorDetail from "./IndicatorDetail";

const useApiMock = vi.fn();

vi.mock("../hooks/useApi", () => ({
  useApi: (endpoint: string) => useApiMock(endpoint),
}));

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Leaf = () => null;
  return {
    Area: Leaf,
    AreaChart: Container,
    CartesianGrid: Leaf,
    Legend: Leaf,
    Line: Leaf,
    LineChart: Container,
    ReferenceLine: Leaf,
    ResponsiveContainer: Container,
    Tooltip: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
  };
});

type RouteCode =
  | "CONSUMER_HEALTH"
  | "BOND_MARKET_STABILITY"
  | "LIQUIDITY_PROXY"
  | "SENTIMENT_COMPOSITE";

const routeNames: Record<RouteCode, string> = {
  CONSUMER_HEALTH: "Consumer Health",
  BOND_MARKET_STABILITY: "Bond Market Stability",
  LIQUIDITY_PROXY: "Liquidity Proxy",
  SENTIMENT_COMPOSITE: "Sentiment Composite",
};

const consumerPartialFixture = [
  {
    date: "2026-07-01",
    pce: { value: 1, mom_pct: 0.2, as_of: "2026-07-01" },
    cpi: { value: 1, mom_pct: 0.1, as_of: "2026-07-01" },
    pi: { value: 1, mom_pct: 0.3, as_of: "2026-07-01" },
    spreads: { pce_spread: 0.1, pi_spread: 0.2, consumer_health: 0.15 },
    xly_xlp: { xly: null, xlp: null, ratio: null },
    composite: {
      raw_value: 0.15,
      normalized_value: 0.15,
      stress_score: 45,
      stability_score: 55,
    },
  },
];

const sentimentPartialFixture = [
  {
    date: "2026-07-01",
    michigan_sentiment: {
      value: 61,
      confidence_score: 52,
      weight: 1,
      contribution: 52,
    },
    composite: {
      confidence_score: 52,
      stability_score: 52,
    },
  },
];

const componentFixtures: Record<RouteCode, unknown[] | null> = {
  CONSUMER_HEALTH: consumerPartialFixture,
  BOND_MARKET_STABILITY: null,
  LIQUIDITY_PROXY: [],
  SENTIMENT_COMPOSITE: sentimentPartialFixture,
};

function apiResult(data: unknown, error: string | null = null) {
  return {
    data,
    loading: false,
    error,
    refetch: vi.fn(),
  };
}

function setFixture(code: RouteCode) {
  useApiMock.mockImplementation((endpoint: string) => {
    if (!endpoint) {
      return apiResult(null);
    }
    if (endpoint === `/indicators/${code}`) {
      return apiResult({
        code,
        name: routeNames[code],
        has_data: true,
      });
    }
    if (endpoint === `/indicators/${code}/history?days=730`) {
      return apiResult([
        {
          timestamp: "2026-07-28T12:00:00Z",
          raw_value: 1,
          score: 55,
          state: "YELLOW",
        },
      ]);
    }
    if (endpoint === `/indicators/${code}/components?days=730`) {
      return code === "BOND_MARKET_STABILITY"
        ? apiResult(null, "deterministic component fixture unavailable")
        : apiResult(componentFixtures[code]);
    }
    return apiResult(null);
  });
}

function evidenceInventory(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-evidence-panel]"))
    .map((element) => ({
      panel: element.dataset.evidencePanel ?? "",
      state: element.dataset.evidenceState ?? "",
    }))
    .sort((left, right) => left.panel.localeCompare(right.panel));
}

function renderAtWidth(code: RouteCode, width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
  setFixture(code);
  const result = render(
    <MemoryRouter>
      <IndicatorDetail forcedCode={code} />
    </MemoryRouter>,
  );
  const inventory = evidenceInventory(result.container);
  result.unmount();
  return inventory;
}

describe("IndicatorDetail deterministic evidence parity", () => {
  afterEach(() => {
    cleanup();
    useApiMock.mockReset();
  });

  it.each([
    [
      "CONSUMER_HEALTH",
      [
        { panel: "consumer-health-components", state: "partial" },
        { panel: "consumer-xly-xlp", state: "empty" },
        { panel: "indicator-route", state: "partial" },
      ],
    ],
    [
      "BOND_MARKET_STABILITY",
      [
        { panel: "bond-core-components", state: "error" },
        { panel: "indicator-route", state: "partial" },
      ],
    ],
    [
      "LIQUIDITY_PROXY",
      [
        { panel: "indicator-route", state: "partial" },
        { panel: "liquidity-components", state: "empty" },
      ],
    ],
    [
      "SENTIMENT_COMPOSITE",
      [
        { panel: "indicator-route", state: "partial" },
        { panel: "sentiment-capex-orders", state: "empty" },
        { panel: "sentiment-components", state: "partial" },
        { panel: "sentiment-consumer-confidence", state: "complete" },
        { panel: "sentiment-new-orders", state: "empty" },
        { panel: "sentiment-nfib-confidence", state: "empty" },
      ],
    ],
  ] as const)(
    "keeps the %s named subpanel contract identical at desktop and mobile",
    (code, expected) => {
      const desktop = renderAtWidth(code, 1440);
      const mobile = renderAtWidth(code, 390);

      expect(desktop).toEqual(expected);
      expect(mobile).toEqual(expected);
      expect(mobile).toEqual(desktop);
    },
  );

  it("includes Analyst Confidence component failure in the route evidence state", () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (!endpoint) return apiResult(null);
      if (endpoint === "/indicators/ANALYST_ANXIETY") {
        return apiResult({
          code: "ANALYST_ANXIETY",
          name: "Analyst Anxiety",
          has_data: true,
        });
      }
      if (endpoint === "/indicators/ANALYST_ANXIETY/history?days=730") {
        return apiResult([
          {
            timestamp: "2026-07-28T12:00:00Z",
            raw_value: 1,
            score: 55,
            state: "YELLOW",
          },
        ]);
      }
      if (endpoint === "/indicators/ANALYST_ANXIETY/components?days=730") {
        return apiResult(null, "component service unavailable");
      }
      return apiResult(null);
    });

    const { container } = render(
      <MemoryRouter>
        <IndicatorDetail forcedCode="ANALYST_CONFIDENCE" />
      </MemoryRouter>,
    );

    expect(evidenceInventory(container)).toEqual([
      { panel: "analyst-confidence-components", state: "error" },
      { panel: "indicator-route", state: "partial" },
    ]);
  });

  it("labels a cached Analyst Confidence component response as stale", () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (!endpoint) return apiResult(null);
      if (endpoint === "/indicators/ANALYST_ANXIETY") {
        return apiResult({
          code: "ANALYST_ANXIETY",
          name: "Analyst Anxiety",
          has_data: true,
        });
      }
      if (endpoint === "/indicators/ANALYST_ANXIETY/history?days=730") {
        return apiResult([
          {
            timestamp: "2026-07-28T12:00:00Z",
            raw_value: 1,
            score: 55,
            state: "YELLOW",
          },
        ]);
      }
      if (endpoint === "/indicators/ANALYST_ANXIETY/components?days=730") {
        return apiResult([
          {
            date: "2026-07-28",
            data_quality: {
              status: "stale",
              stale: true,
              reason: "analyst_component_refresh_failed",
              snapshot_cached_at: "2026-07-28T15:00:00Z",
              snapshot_age_seconds: 20_000,
            },
            vix: {
              value: 18,
              stress_score: 40,
              stability_score: 60,
              weight: 0.4,
              contribution: 16,
            },
            hy_oas: {
              value: 3,
              stress_score: 35,
              stability_score: 65,
              weight: 0.4,
              contribution: 14,
            },
            composite: { stress_score: 38, stability_score: 62 },
          },
        ]);
      }
      return apiResult(null);
    });

    const { container } = render(
      <MemoryRouter>
        <IndicatorDetail forcedCode="ANALYST_CONFIDENCE" />
      </MemoryRouter>,
    );

    expect(evidenceInventory(container)).toEqual([
      { panel: "analyst-confidence-components", state: "stale" },
      { panel: "indicator-route", state: "stale" },
    ]);
    expect(
      screen.getByText(/Showing last-known-good analyst-confidence component history/),
    ).not.toBeNull();
    expect(screen.getByText(/5.6 hours old/)).not.toBeNull();
  });

  it("carries public-credit snapshot provenance into the route and panel state", () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (!endpoint) return apiResult(null);
      if (endpoint === "/indicators/BOND_MARKET_STABILITY") {
        return apiResult({
          code: "BOND_MARKET_STABILITY",
          name: "Bond Market Stability",
          has_data: true,
        });
      }
      if (endpoint === "/indicators/BOND_MARKET_STABILITY/history?days=730") {
        return apiResult([
          {
            timestamp: "2026-07-28T12:00:00Z",
            raw_value: 1,
            score: 55,
            state: "YELLOW",
          },
        ]);
      }
      if (endpoint === "/indicators/BOND_MARKET_STABILITY/components?days=730") {
        return apiResult([]);
      }
      if (endpoint === "/indicators/BOND_MARKET_STABILITY/muni?days=730") {
        return apiResult({
          as_of: "2026-07-28",
          data_quality: {
            status: "stale",
            stale: true,
            reason: "public_credit_refresh_failed",
            snapshot_cached_at: "2026-07-28T14:00:00Z",
            snapshot_age_seconds: 30_000,
          },
          series: [
            {
              key: "MUNI_LONG_SPREAD",
              label: "Municipal spread",
              history: [
                {
                  date: "2026-07-28",
                  value: 1,
                  stability_score: 55,
                },
              ],
            },
          ],
          composite: {
            score: 55,
            state: "YELLOW",
            coverage_live: 1,
            coverage_total: 1,
            missing_keys: [],
            weights_used: {},
          },
          curve: { status: "available", history: [] },
        });
      }
      return apiResult(null);
    });

    const { container } = render(
      <MemoryRouter>
        <IndicatorDetail forcedCode="BOND_MARKET_STABILITY" />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Public-sector credit & funding stress",
      }),
    );

    expect(
      container.querySelector('[data-evidence-panel="indicator-route"]')?.getAttribute(
        "data-evidence-state",
      ),
    ).toBe("stale");
    expect(
      container.querySelector('[data-evidence-panel="bond-public-credit"]')?.getAttribute(
        "data-evidence-state",
      ),
    ).toBe("stale");
    expect(screen.getByText("Stale snapshot")).not.toBeNull();
    expect(
      screen.getByText(/Showing last-known-good public-sector credit/),
    ).not.toBeNull();
  });
});
