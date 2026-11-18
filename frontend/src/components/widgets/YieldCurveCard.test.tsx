import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import YieldCurveCard from "./YieldCurveCard";


const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div aria-label={String(props["aria-label"] ?? "yield curve")} data-points={JSON.stringify(props.data)}>{children}</div>
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
  afterEach(cleanup);

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

  it("overlays each dated series independently and leaves unpublished maturities empty", () => {
    const corporate = {
      period_label: "Aug 2026 month-end",
      source: { name: "U.S. Treasury HQM", url: "https://home.treasury.gov/hqm" },
      data_quality: { stale: false, partial: false },
      curve: [{ maturity: "2Y", yield: 4.75 }, { maturity: "10Y", yield: 5.63 }],
      history: [{ period_label: "Jul 2026 month-end", curve: [{ maturity: "2Y", yield: 4.59 }] }],
    };
    const municipal = {
      period_label: "Nov 18, 2026 · 01:00 PM EST",
      source: { name: "MBIS national tax-exempt benchmark", url: "https://mbis.com/benchmark-curves" },
      data_quality: { stale: false, partial: false },
      curve: Array.from({ length: 30 }, (_, index) => ({ maturity: `${index + 1}Y`, yield: 3 + (index + 1) / 100 })),
      history: [{ period_label: "Nov 17, 2026 · 06:00 PM EST", curve: [{ maturity: "2Y", yield: 3.12 }] }],
      methodology: { name: "MBIS benchmark methodology", url: "https://www.msrb.org/sites/default/files/MBIS-Yield-Curve-Methodology.pdf" },
    };
    const infrastructure = {
      period_label: "Sep 17, 2026",
      state: "estimate",
      source: { name: "EPA WIFIA methodology", url: "https://www.epa.gov/wifia" },
      data_quality: { stale: false, partial: false },
      curve: [{ maturity: "2Y", yield: 4.41 }, { maturity: "20Y", yield: 5.28 }],
    };
    useApiMock.mockImplementation((path: string) => ({
      data: path.endsWith("/corporate") ? corporate : path.endsWith("/municipal")
        ? municipal : path.endsWith("/infrastructure") ? infrastructure : path ? payload : null,
      loading: false, error: null, refetch: vi.fn(),
    }));

    render(<MemoryRouter><YieldCurveCard /></MemoryRouter>);
    const controls = within(screen.getByRole("group", { name: "Compare lending curves" }));
    const corporateToggle = controls.getByRole("button", { name: "Corporate bonds", pressed: false });
    const municipalToggle = controls.getByRole("button", { name: "Muni bonds", pressed: false });
    const infrastructureToggle = controls.getByRole("button", { name: "Infrastructure loans", pressed: false });
    expect(screen.getAllByTestId("curve-series")).toHaveLength(11);
    expect(useApiMock.mock.calls.every(([path]) => !/corporate|municipal|infrastructure/.test(path))).toBe(true);

    fireEvent.click(corporateToggle);
    fireEvent.click(municipalToggle);
    fireEvent.click(infrastructureToggle);
    const chart = screen.getByLabelText(/Onion-skinned Treasury yield curves.*HQM corporate.*MBIS tax-exempt benchmark.*EPA WIFIA/);
    expect(screen.getAllByTestId("curve-series")).toHaveLength(16);
    expect(screen.getByText("corporate_history_1:HQM corporate · Jul 2026 month-end")).toBeTruthy();
    expect(JSON.parse(chart.getAttribute("data-points") ?? "[]")).toContainEqual(
      expect.objectContaining({ maturity: "2Y", corporate: 4.75, corporate_history_1: 4.59, municipal: 3.02, municipal_history_1: 3.12, infrastructure: 4.41 }),
    );
    expect(JSON.parse(chart.getAttribute("data-points") ?? "[]")).toContainEqual(
      expect.objectContaining({ maturity: "25Y", municipal: 3.25 }),
    );
    expect(screen.getByRole("link", { name: "MBIS national tax-exempt benchmark" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "MBIS benchmark methodology" })).toBeTruthy();
    expect(screen.getByText("HQM corporate history")).toBeTruthy();
    fireEvent.click(corporateToggle);
    expect(screen.getAllByTestId("curve-series")).toHaveLength(14);
    expect(municipalToggle.getAttribute("aria-pressed")).toBe("true");
    expect(infrastructureToggle.getAttribute("aria-pressed")).toBe("true");
  });
});
