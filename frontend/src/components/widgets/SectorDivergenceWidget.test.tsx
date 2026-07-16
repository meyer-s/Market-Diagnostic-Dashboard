import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SectorDivergenceWidget from "./SectorDivergenceWidget";

vi.mock("recharts", () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const comparison = (key: string, title: string, value: number) => ({
  key,
  title,
  positive_label: `${title} positive`,
  negative_label: `${title} negative`,
  positive_axis_label: title.split(" vs ")[0],
  negative_axis_label: title.split(" vs ")[1] ?? "Shelter",
  description: title,
  sample_count: 21,
  series: Array.from({ length: 21 }, (_, index) => ({
    as_of_date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    positive_avg: 50,
    negative_avg: 50,
    raw_spread: index === 20 ? value : 15.9,
    smoothed_spread: index === 20 ? value : 15.9,
    oscillator: index === 20 ? value : 15.9,
  })),
});

describe("SectorDivergenceWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses stabilized analytics instead of the legacy divergence surfaces", async () => {
    const onInsight = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/sectors/projections/latest")) {
        return {
          ok: true,
          json: async () => ({
            as_of_date: "2026-07-16",
            model_version: "option_b_v2",
            system_state: "YELLOW",
            quality_status: "valid",
            data_warnings: [],
          }),
        } as Response;
      }
      if (url.includes("/sectors/projections/analytics")) {
        return {
          ok: true,
          json: async () => ({
            as_of_date: "2026-07-16",
            analytics_version: "sector_stability_v4",
            leadership_band: 15,
            sectors: {
              XLF: { sector_symbol: "XLF", sector_name: "Financials", horizons: { "3m": { stable_score: 80.1, stable_rank: 1 } }, persistence: { direction: "improving" } },
              XLK: { sector_symbol: "XLK", sector_name: "Technology", horizons: { "3m": { stable_score: 75.8, stable_rank: 2 } }, persistence: { direction: "stable" } },
              XLV: { sector_symbol: "XLV", sector_name: "Health Care", horizons: { "3m": { stable_score: 70, stable_rank: 3 } }, persistence: { direction: "weakening" } },
            },
            leadership_comparisons: [
              comparison("cyclical_defensive", "Cyclical vs Defensive", -3.5),
              comparison("broad_risk_appetite", "Offense vs Shelter", -5),
              comparison("growth_reflation", "Growth vs Reflation", -2.1),
              comparison("consumer_appetite", "Discretionary vs Staples", -7.6),
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SectorDivergenceWidget onInsight={onInsight} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Balanced, leaning defensive")).toBeTruthy();
    expect(screen.getByText("-3.5")).toBeTruthy();
    expect(screen.getByText("Toward Defensive")).toBeTruthy();
    expect(screen.getByText("#1 XLF")).toBeTruthy();
    expect(screen.getByText("Shelter +5.0")).toBeTruthy();
    await waitFor(() => expect(onInsight).toHaveBeenCalled());
    expect(onInsight.mock.calls[onInsight.mock.calls.length - 1]?.[0]).toMatchObject({
      primaryDirection: "flat",
      secondaryDirection: "down",
      stance: "mixed",
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => url.includes("/sectors/summary"))).toBe(false);
    expect(urls.some((url) => url.includes("/sectors/projections/history"))).toBe(false);
    expect(urls.some((url) => url.includes("/sectors/alerts"))).toBe(false);
  });
});
