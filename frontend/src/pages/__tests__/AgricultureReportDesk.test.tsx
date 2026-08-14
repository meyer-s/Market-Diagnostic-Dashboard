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
    Bar: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    BarChart: Shell,
    CartesianGrid: () => null,
    ComposedChart: Shell,
    Legend: () => null,
    Line: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    LineChart: Shell,
    ReferenceLine: () => null,
    ResponsiveContainer: Shell,
    Scatter: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    ScatterChart: Shell,
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
  commodity: { symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F", price_unit: "cents per bushel" },
  commodities: [{ symbol: "ZC", name: "Corn", usda: "Corn", ticker: "ZC=F", price_unit: "cents per bushel" }],
  selected_metric: "ending_stocks",
  years: 2,
  history_coverage: { structured_start_date: "2010-04-09", requested_start_date: "2024-08-13", observed_start_date: "2024-09-12", observed_end_date: "2026-08-12", release_count: 24, complete: true, source: "USDA WASDE as-reported CSV archive" },
  next_release: { report_id: "export_sales", report: "Export Sales", release_at: "2026-08-20T08:30:00-04:00", date: "2026-08-20", time_label: "8:30 AM ET", confidence: "recurring" },
  latest_release: point,
  reports: [
    { id: "wasde", name: "WASDE", agency: "USDA OCE", cadence: "Monthly", release_time: "12:00 ET", coverage: "chart_ready", coverage_label: "Chart ready", description: "Balance sheets.", source_url: "https://example.com/latest", archive_url: "https://example.com/archive", release_count: 24, observed_start_date: "2024-09-12", observed_end_date: "2026-08-12" },
    { id: "crop_progress", name: "Crop Progress", agency: "USDA NASS", cadence: "Weekly", release_time: "16:00 ET", coverage: "chart_ready", coverage_label: "Chart + history", description: "Crop pace.", source_url: "https://example.com/crop", archive_url: "https://example.com/crop", release_count: 18, observed_start_date: "2026-04-06", observed_end_date: "2026-08-10" },
    { id: "cot", name: "Commitments of Traders", agency: "CFTC", cadence: "Weekly", release_time: "15:30 ET", coverage: "history_ready", coverage_label: "Position history", description: "Positioning.", source_url: "https://example.com/cot", archive_url: "https://example.com/cot", release_count: 100, observed_start_date: "2024-08-13", observed_end_date: "2026-08-17" },
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
      analysis: {
        chart_kind: "progress_benchmark",
        title: "Field progress and condition",
        subtitle: "Current reading against USDA's own benchmarks",
        primary_metric_id: "condition_good_excellent",
        latest_release_date: "2026-08-10",
        latest_value: 61,
        previous_value: 60,
        four_report_average: 59,
        unit: "Percent",
        headline: "Good + excellent: 61.0 percent",
        body: "USDA reports 61% good or excellent, unchanged week over week and 11 points above last year.",
        comparison_basis: "USDA current, prior-week, and prior-year benchmarks",
      },
      releases: [{
        release_date: "2026-08-10",
        title: "Crop Progress release",
        source_url: "https://example.com/crop/2026-08-10",
        documents: [{ label: "TXT", format: "txt", url: "https://example.com/crop.txt" }],
        metrics: [
          { id: "condition_good_excellent", label: "Good + excellent", value: 61, unit: "Percent", previous_week: 61, previous_year: 50, chart_group: "condition" },
          { id: "progress_dough", label: "Dough", value: 74, unit: "Percent", previous_week: 62, previous_year: 69, five_year_average: 68, chart_group: "progress" },
        ],
      }],
    },
    cot: {
      report_id: "cot",
      scope_key: "ZC",
      scope_label: "Corn",
      requested_start_date: "2024-08-13",
      observed_start_date: "2024-08-13",
      observed_end_date: "2026-08-17",
      release_count: 100,
      returned_count: 100,
      truncated: false,
      releases: [
        { release_date: "2026-08-17", title: "Latest COT record", source_url: "https://example.com/cot/latest", documents: [{ label: "CFTC data", format: "dataset", url: "https://example.com/cot" }], metrics: [] },
        { release_date: "2026-08-10", title: "Older COT record", source_url: "https://example.com/cot/older", documents: [{ label: "CFTC data", format: "dataset", url: "https://example.com/cot" }], metrics: [] },
      ],
    },
  },
  schedule: [{ report_id: "wasde", report: "WASDE", release_at: "2026-09-11T12:00:00-04:00", date: "2026-09-11", time_label: "12:00 PM ET", confidence: "official" }],
  metrics: [{ id: "ending_stocks", label: "Ending stocks", orientation: -1, bullish_when: "lower" }],
  series: [{ id: "wasde:ending_stocks", report_id: "wasde", report: "WASDE", metric_id: "ending_stocks", label: "Ending stocks", bullish_when: "lower", unit: "Million Bushels", points: [point] }],
  price_history: [{ date: "2026-08-12", value: 410, rebased: 100, ticker: "ZC=F" }],
  impact_model: {
    as_of: "2026-08-13",
    price_unit: "cents per bushel",
    horizon_sessions: 5,
    aggregate: { direction: "Price-supportive", current_price: 410, projected_5d_pct: 1.25, projected_5d_price: 415.125, lower_5d_price: 402, upper_5d_price: 428, uncertainty_5d_pct: 3.1, contributors_included: 2 },
    reports: [
      { report_id: "wasde", report: "WASDE", channel: "Balance sheet", latest_release_date: "2026-08-12", price_event_date: "2026-08-12", signal_z: 1.2, signal_basis: "Average standardized WASDE revisions", latest_reaction_1d_pct: 1.4, latest_reaction_5d_pct: 2.1, historical_1d: { sample_size: 12, correlation: 0.32, slope: 0.8, alignment_rate: 0.67, residual_pct: 1.5 }, historical_5d: { sample_size: 12, correlation: 0.4, slope: 1.1, alignment_rate: 0.67, residual_pct: 2.6 }, model_5d_pct: 1.32, contribution_5d_pct: 0.8, confidence: "Moderate", reliability: 0.4, freshness: 1, model_weight: 0.6, observations: Array.from({ length: 12 }, (_, index) => ({ release_date: `2025-${String(index + 1).padStart(2, "0")}-12`, price_event_date: `2025-${String(index + 1).padStart(2, "0")}-12`, raw_signal: index % 2 ? 1 : -1, signal_z: index % 2 ? 1 : -1, signal_basis: "Average standardized WASDE revisions", reaction_1d_pct: index % 2 ? 0.5 : -0.4, reaction_5d_pct: index % 2 ? 1.2 : -0.8 })) },
      { report_id: "crop_progress", report: "Crop Progress", channel: "Supply", latest_release_date: "2026-08-10", price_event_date: "2026-08-10", signal_z: 0.7, signal_basis: "Crop condition versus year ago", latest_reaction_1d_pct: 0.4, latest_reaction_5d_pct: null, historical_1d: { sample_size: 18, correlation: 0.22, slope: 0.4, alignment_rate: 0.56, residual_pct: 1.4 }, historical_5d: { sample_size: 18, correlation: 0.25, slope: 0.7, alignment_rate: 0.61, residual_pct: 2.2 }, model_5d_pct: 0.49, contribution_5d_pct: 0.45, confidence: "Moderate", reliability: 0.3, freshness: 0.9, model_weight: 0.4, observations: [] },
      { report_id: "cot", report: "Commitments of Traders", channel: "Positioning", latest_release_date: "2026-08-17", price_event_date: "2026-08-20", signal_z: null, signal_basis: null, latest_reaction_1d_pct: null, latest_reaction_5d_pct: null, historical_1d: { sample_size: 0, correlation: null, slope: null, alignment_rate: null, residual_pct: null }, historical_5d: { sample_size: 0, correlation: null, slope: null, alignment_rate: null, residual_pct: null }, model_5d_pct: null, contribution_5d_pct: null, confidence: "Insufficient", reliability: 0, freshness: 0, model_weight: 0, observations: [] },
    ],
    relationships: [{ source_report_id: "crop_progress", target_report_id: "wasde", source_report: "Crop Progress", target_report: "WASDE", kind: "leads", status: "Confirming", description: "Crop Progress leads WASDE; their latest signals confirm." }],
    methodology: { signal: "Positive means supportive.", reaction: "Uses publication session.", scenario: "Historical association, not a causal forecast.", uncertainty: "Residual variation." },
  },
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

  it("summarizes the whole agriculture picture beside the selected report", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Agriculture Report Desk" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Combined report-price association" })).toBeTruthy();
    expect(screen.getByText("Association-implied marker")).toBeTruthy();
    expect(screen.getByText(/Association-based scenario, not a forecast/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Report price contributions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Report pressure vs. five-session futures return" })).toBeTruthy();
    expect(screen.getByText("View plotted release values")).toBeTruthy();
    expect(screen.getByText(/n=12/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Market brief" }));
    expect(screen.getByRole("heading", { name: "The whole picture" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Report feed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Balance sheet/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Supply & fields/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Demand/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Positioning/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add futures" })).toBeTruthy();
    expect(screen.getByText("Evidence & sources")).toBeTruthy();
    expect(screen.getByText("Expectation journal")).toBeTruthy();
    expect(screen.getByText("Chart ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /WASDE.*revision/ })).toBeTruthy();
  });

  it("renders imported release history and raw documents for non-WASDE reports", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Market brief" }));
    fireEvent.click(screen.getByRole("button", { name: /Crop Progress/ }));
    expect(screen.getByText("Chart + history")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Crop Progress.*61%/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Crop Progress release/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open TXT/ })).toBeTruthy();
    expect(screen.getAllByText(/11 pts vs last year/).length).toBeGreaterThan(0);
    expect(screen.getByText(/11 points above last year/)).toBeTruthy();
    expect(screen.getByText("5Y avg / prior year")).toBeTruthy();
    expect(screen.getByText("Evidence & sources")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Expectation, result, and price response" })).toBeNull();
  });

  it("opens the latest record when switching between families with overlapping dates", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Market brief" }));
    fireEvent.click(screen.getByRole("button", { name: /Crop Progress/ }));
    expect(screen.getByLabelText("Release date")).toHaveProperty("value", "2026-08-10");
    fireEvent.click(screen.getByRole("button", { name: /Commitments of Traders/ }));

    expect(screen.getByLabelText("Release date")).toHaveProperty("value", "2026-08-17");
    expect(screen.getByRole("option", { name: /Latest COT record/ })).toBeTruthy();
  });

  it("saves user expectations locally", () => {
    render(<MemoryRouter><AgricultureReportDesk /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Market brief" }));
    fireEvent.change(screen.getByLabelText(/Expected ending stocks/i), { target: { value: "2050" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expectation" }));

    expect(window.localStorage.getItem("agriculture-report-expectations-v1")).toContain("2050");
    expect(screen.getByRole("button", { name: "Update expectation" })).toBeTruthy();
    expect(screen.getAllByText(/Your expectation/).length).toBeGreaterThan(0);
  });
});
