import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgricultureReportDesk from "../AgricultureReportDesk";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../utils/apiUtils", () => ({ buildApiUrl: (endpoint: string) => `/api${endpoint}` }));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    CartesianGrid: () => null,
    Legend: () => null,
    Line: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    LineChart: Shell,
    ReferenceLine: () => null,
    ResponsiveContainer: Shell,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const point = {
  release_date: "2026-08-12",
  value: 2117,
  prior_value: 2200,
  revision: -83,
  revision_z: -1.2,
  bullish_signal_z: 1.2,
  reaction_1d_pct: 1.4,
  reaction_5d_pct: 2.1,
  unit: "Million Bushels",
  market_year: "2026/27",
  projection_status: "Proj.",
  normalization: { basis: "revision", mean_revision: 0, revision_std_dev: 50, positive_means: "bullish" },
};

const payload = {
  as_of: "2026-08-13T12:00:00-04:00",
  commodity: { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F" },
  commodities: [{ symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F" }],
  selected_metric: "ending_stocks",
  years: 2,
  history_coverage: { structured_start_date: "2010-04-09", requested_start_date: "2024-08-13", observed_start_date: "2024-09-12", observed_end_date: "2026-08-12", release_count: 24, complete: true, source: "USDA WASDE as-reported CSV archive" },
  next_release: { report_id: "export_sales", report: "Export Sales", release_at: "2026-08-20T08:30:00-04:00", date: "2026-08-20", time_label: "8:30 AM ET", confidence: "recurring" },
  latest_release: point,
  reports: [
    { id: "wasde", name: "WASDE", agency: "USDA OCE", cadence: "Monthly", release_time: "12:00 ET", coverage: "chart_ready", coverage_label: "Chart ready", description: "Balance sheets.", source_url: "https://example.com/latest", archive_url: "https://example.com/archive", release_count: 24, observed_start_date: "2024-09-12", observed_end_date: "2026-08-12" },
    { id: "crop_progress", name: "Crop Progress", agency: "USDA NASS", cadence: "Weekly", release_time: "16:00 ET", coverage: "history_ready", coverage_label: "Release history", description: "Crop pace.", source_url: "https://example.com/crop", archive_url: "https://example.com/crop", release_count: 18, observed_start_date: "2026-04-06", observed_end_date: "2026-08-10" },
  ],
  report_histories: {
    crop_progress: {
      report_id: "crop_progress",
      scope_key: "ALL",
      scope_label: "All published releases",
      requested_start_date: "2024-08-13",
      observed_start_date: "2026-04-06",
      observed_end_date: "2026-08-10",
      release_count: 18,
      returned_count: 18,
      truncated: false,
      releases: [{
        release_date: "2026-08-10",
        title: "Crop Progress release",
        source_url: "https://example.com/crop/2026-08-10",
        documents: [{ label: "TXT", format: "txt", url: "https://example.com/crop.txt" }],
        metrics: [],
      }],
    },
  },
  schedule: [{ report_id: "wasde", report: "WASDE", release_at: "2026-09-11T12:00:00-04:00", date: "2026-09-11", time_label: "12:00 PM ET", confidence: "official" }],
  metrics: [{ id: "ending_stocks", label: "Ending stocks", orientation: -1, bullish_when: "lower" }],
  series: [{ id: "wasde:ending_stocks", report_id: "wasde", report: "WASDE", metric_id: "ending_stocks", label: "Ending stocks", bullish_when: "lower", unit: "Million Bushels", points: [point] }],
  price_history: [{ date: "2026-08-12", value: 410, rebased: 100, ticker: "ZC=F" }],
  takeaways: [{ tone: "positive", title: "Standardized release read", body: "Supportive revision." }, { tone: "neutral", title: "Price confirmation", body: "Price aligned." }, { tone: "neutral", title: "Interpretation boundary", body: "Association is not causation." }],
  methodology: { actuals: "Official USDA", expectations: "User-entered only" },
  warnings: [],
};

describe("AgricultureReportDesk", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
    useApiMock.mockReturnValue({ data: payload, loading: false, error: null, refetch: vi.fn() });
  });

  it("keeps the raw viewer beside standardized insights", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Agriculture Report Desk" })).toBeTruthy();
    expect(screen.getByText("Raw release viewer")).toBeTruthy();
    expect(screen.getByText("Insights pane")).toBeTruthy();
    expect(screen.getByText("Chart ready")).toBeTruthy();
    expect(screen.getByText("Association is not causation.")).toBeTruthy();
    expect(screen.getByText("WASDE · Ending stocks")).toBeTruthy();
    expect(screen.queryByText("Ending stocks expectation")).toBeNull();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByText(/24 persisted records/)).toBeTruthy();
  });

  it("renders imported release history and raw documents for non-WASDE reports", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Crop Progress/ }));
    expect(screen.getByText("Release history")).toBeTruthy();
    expect(screen.getByText("18", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Crop Progress release")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open TXT/ })).toBeTruthy();
    expect(screen.queryByText("Official raw source connected")).toBeNull();
  });

  it("saves user expectations locally", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/Expected ending stocks/i), { target: { value: "2050" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expectation" }));

    expect(window.localStorage.getItem("agriculture-report-expectations-v1")).toContain("2050");
    expect(screen.getByRole("button", { name: "Update expectation" })).toBeTruthy();
    expect(screen.getByText("Ending stocks expectation")).toBeTruthy();
  });
});
