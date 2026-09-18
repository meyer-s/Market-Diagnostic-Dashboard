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
  Line: () => null,
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
    {
      date: "2026-09-17",
      curve: [
        { maturity: "3M", yield: 4.12 },
        { maturity: "2Y", yield: 4.67 },
        { maturity: "5Y", yield: 4.78 },
        { maturity: "10Y", yield: 4.94 },
        { maturity: "30Y", yield: 5.29 },
      ],
    },
    {
      date: "2026-09-16",
      curve: [
        { maturity: "3M", yield: 4.14 },
        { maturity: "2Y", yield: 4.74 },
        { maturity: "5Y", yield: 4.86 },
        { maturity: "10Y", yield: 5.01 },
        { maturity: "30Y", yield: 5.35 },
      ],
    },
  ],
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
      "/indicators/BOND_MARKET_STABILITY/yield-curve?months=3",
      { timeoutMs: 30_000 },
    );
    expect(screen.getByRole("heading", { name: "Official Treasury curve" })).not.toBeNull();
    expect(screen.getByText("Current official curve")).not.toBeNull();
    expect(screen.getByText(/Latest close Sep 17, 2026/)).not.toBeNull();
    expect(screen.getByText("Positive, flat")).not.toBeNull();
    expect(screen.getByText("0.27%", { exact: false })).not.toBeNull();
    expect(screen.getAllByText("-7 bp d/d", { exact: false })).toHaveLength(2);
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
