import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgricultureIndex from "../AgricultureIndex";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../components/agriculture/AgricultureDeepDive", () => ({
  default: ({ data }: { data: { as_of: string } }) => <div data-testid="deep-dive">Deep Dive snapshot {data.as_of}</div>,
}));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Bar: Empty,
    Cell: Empty,
    ComposedChart: Shell,
    Legend: Empty,
    Line: Empty,
    LineChart: Shell,
    CartesianGrid: Empty,
    ReferenceLine: Empty,
    ResponsiveContainer: Shell,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const overview = {
  as_of: "2026-08-18T15:00:00Z",
  regime_label: "Stable Expansion",
  stability_score: 68.4,
  stability_components: {},
  component_history: [],
  summary: "Agriculture is stable, but leadership remains concentrated.",
  composite: { group_weights: {}, changes: { "5d": 1.2, "20d": 3.4 }, history: [], volatility: 1.1 },
  groups: [
    {
      group: "grains_oilseeds",
      label: "Grains / Oilseeds",
      effective_weight: 45,
      symbol_count: 1,
      group_composite: 72,
      changes: { "20d": 4 },
      volatility: 20,
      breadth_score: 65,
      strongest: [],
      weakest: [],
      components: [{ code: "ZC", name: "Corn", score: 72, ticker: "ZC=F", changes: { "20d": 4 }, volatility: 20 }],
      stability_contribution: 30,
      correlation_to_composite: 0.8,
    },
    {
      group: "livestock",
      label: "Livestock",
      effective_weight: 20,
      symbol_count: 1,
      group_composite: 32,
      changes: { "20d": -3 },
      volatility: 25,
      breadth_score: 30,
      strongest: [],
      weakest: [],
      components: [{ code: "LE", name: "Live Cattle", score: 32, ticker: "LE=F", changes: { "20d": -3 }, volatility: 25 }],
      stability_contribution: 6,
      correlation_to_composite: 0.4,
    },
  ],
  strongest_markets: [],
  weakest_markets: [],
  correlations: { group_matrix: { "60": [] }, pair_insights: { "60": {} } },
  macro_pressure: {},
  special_signals: {
    soybean_oil_vs_grains: { spread_20d: null, soybean_oil_20d: null, avg_grains_20d: null, interpretation: "Unavailable" },
    livestock_feed_margin_pressure: { spread_20d: null, grains_20d: null, livestock_20d: null, interpretation: "Unavailable" },
  },
  availability: {
    symbols: [],
    missing_symbols: [],
    missing_macro_series: [],
    available_group_count: 6,
    total_configured_symbols: 25,
    available_symbol_count: 25,
  },
  warnings: [],
};

describe("AgricultureIndex Deep Dive composition", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/agriculture/overview?days=365") return { data: overview, loading: false, error: null, refetch: vi.fn() };
      if (endpoint === "/agriculture/long-view") return { data: { history: [] }, loading: false, error: null, refetch: vi.fn() };
      throw new Error(`Unexpected split-snapshot request: ${endpoint}`);
    });
  });

  it("uses one shared agriculture snapshot and gives Report Desk an outcome label", () => {
    render(<MemoryRouter><AgricultureIndex /></MemoryRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "Agriculture Index" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Stable Expansion" })).toBeTruthy();
    expect(screen.getByText("Shared market snapshot")).toBeTruthy();
    expect(screen.getByText("What matters now")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Analyze report impact" }).getAttribute("href")).toBe("/agriculture/reports");
    expect(useApiMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/agriculture/overview?days=365",
      "/agriculture/long-view",
    ]);
  });

  it("passes that same snapshot into the distilled Deep Dive", () => {
    render(<MemoryRouter><AgricultureIndex /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Deep Dive" }));

    expect(screen.getByTestId("deep-dive").textContent).toContain("2026-08-18T15:00:00Z");
  });
});
