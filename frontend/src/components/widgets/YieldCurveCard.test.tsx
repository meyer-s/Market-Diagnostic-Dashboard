import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import YieldCurveCard from "./YieldCurveCard";


const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div aria-label={String(props["aria-label"] ?? "yield curve")}>{children}</div>
  ),
  CartesianGrid: () => null,
  Line: ({ dataKey, name }: { dataKey?: string; name?: string }) => (
    <span data-testid="curve-series">{`${dataKey}:${name}`}</span>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const payload = {
  as_of: "2026-09-17",
  fetched_at: "2026-09-18T13:00:00Z",
  source: {
    name: "U.S. Department of the Treasury",
    url: "https://home.treasury.gov/curve",
    frequency: "Business days, official close",
  },
  data_quality: {
    status: "complete" as const,
    stale: false,
    maturities_received: 13,
    maturities_expected: 13,
  },
  curves: [
    ["2026-09-17", 0],
    ["2026-09-16", 0.07],
    ["2026-09-15", 0.1],
    ["2026-09-14", 0.13],
    ["2026-09-11", 0.16],
    ["2026-08-31", 0.2],
    ["2026-07-31", 0.25],
    ["2026-06-30", 0.3],
    ["2026-05-29", 0.35],
    ["2026-04-30", 0.4],
  ].map(([date, shift]) => ({
    date: String(date),
    curve: [
      { maturity: "3M", yield: 4.12 + Number(shift) },
      { maturity: "2Y", yield: 4.67 + Number(shift) },
      { maturity: "5Y", yield: 4.78 + Number(shift) },
      { maturity: "10Y", yield: 4.94 + Number(shift) },
      { maturity: "30Y", yield: 5.29 + Number(shift) },
    ],
  })),
};

describe("YieldCurveCard", () => {
  beforeEach(() => {
    useApiMock.mockReset();
  });

  it("renders current curve, shape, benchmarks, provenance, and detail route", () => {
    useApiMock.mockReturnValue({
      data: payload,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <YieldCurveCard />
      </MemoryRouter>,
    );

    expect(useApiMock).toHaveBeenCalledWith(
      "/indicators/BOND_MARKET_STABILITY/yield-curve?months=12",
      { timeoutMs: 50_000 },
    );
    expect(screen.getByRole("heading", { name: "Official Treasury curve" })).not.toBeNull();
    expect(screen.getByText("Current official curve")).not.toBeNull();
    expect(screen.getByText(/Latest close Sep 17, 2026/)).not.toBeNull();
    expect(screen.getByText("Positive, flat")).not.toBeNull();
    expect(screen.getByText("0.27%", { exact: false })).not.toBeNull();
    expect(screen.getAllByText("-7 bp d/d", { exact: false })).toHaveLength(3);
    expect(screen.getByText(/onion skin: 5 sessions, 5 monthly checkpoints, 10-session mean/i)).not.toBeNull();
    expect(screen.getAllByTestId("curve-series")).toHaveLength(11);
    expect(screen.getByText("daily_0:Latest · Sep 17, 2026")).not.toBeNull();
    expect(screen.getByText("monthly_0:Aug 31, 2026")).not.toBeNull();
    expect(screen.getByText("moving_average:10-session mean")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Source: U.S. Department of the Treasury/i }).getAttribute("href"))
      .toBe("https://home.treasury.gov/curve");
    expect(screen.getByRole("link", { name: "Open bond evidence" }).getAttribute("href"))
      .toBe("/bond_health_stability");
  });

  it("labels a reused snapshot explicitly", () => {
    useApiMock.mockReturnValue({
      data: {
        ...payload,
        data_quality: { ...payload.data_quality, status: "stale", stale: true },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <YieldCurveCard />
      </MemoryRouter>,
    );

    expect(screen.getByText("Last known official curve")).not.toBeNull();
    expect(screen.getByText(/Live refresh failed; values are the last known official close/i)).not.toBeNull();
  });

  it("offers a focused retry when the curve is unavailable", () => {
    const refetch = vi.fn();
    useApiMock.mockReturnValue({ data: null, loading: false, error: "Unavailable", refetch });

    render(
      <MemoryRouter>
        <YieldCurveCard />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry Treasury curve" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
