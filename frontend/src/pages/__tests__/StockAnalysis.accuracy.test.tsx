import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StockAnalysis from "../StockAnalysis";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("../../utils/apiUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/apiUtils")>("../../utils/apiUtils");
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock("../../components/widgets/TechnicalIndicators.tsx", () => ({
  TechnicalIndicators: ({ intradayHistory2h }: { intradayHistory2h?: unknown[] }) => (
    <div>{intradayHistory2h?.length ? "2H evidence" : "Daily fallback evidence"}</div>
  ),
}));

vi.mock("../../components/widgets/OptionsStructureMap", () => ({
  OptionsStructureMap: () => <div>Options structure map</div>,
}));

vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Area: Empty,
    Bar: Empty,
    Cell: Empty,
    ComposedChart: Shell,
    Line: Empty,
    ResponsiveContainer: Shell,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const projection = (horizon: string, lookbackDays: number, score: number) => ({
  ticker: "KVUE",
  name: "Kenvue Inc.",
  horizon,
  analysis_kind: "trailing_window",
  lookback_days: lookbackDays,
  score_total: score,
  score_trend: 60,
  score_relative_strength: 55,
  score_risk: 45,
  score_regime: 50,
  trailing_return_pct: 2,
  trailing_price_return_pct: 2,
  volatility: 20,
  max_drawdown: -8,
  conviction: 56,
  return_basis: "adjusted_close",
  current_price: 19.24,
  take_profit: 21,
  raw_upper_reference: 21.5,
  trade_target: 21,
  stop_loss: 17.5,
});

const candles = Array.from({ length: 80 }, (_, index) => ({
  close: 15 + index * 0.05,
  high: 15.2 + index * 0.05,
  low: 14.8 + index * 0.05,
  volume: 1_000_000 + index * 1_000,
}));

const series = (values: number[]) => ({
  series: values.map((value, index) => ({ date: `2025-${String(index + 1).padStart(2, "0")}-31`, value })),
});

const payload = {
  projections: {
    T: projection("T", 21, 58),
    "3m": projection("3m", 63, 55),
    "6m": projection("6m", 126, 48),
    "12m": projection("12m", 252, 42),
  },
  technical: {
    current_price: 19.24,
    low_52w: 17,
    high_52w: 25,
    trend: "uptrend",
    sma_50: 18.5,
    sma_200: 18,
    candles,
    rsi: { current: 58, series: [50, 52, 54, 56, 58] },
    macd: { current: 0.4, signal: 0.3, histogram: 0.1, histogram_series: [0.02, 0.04, 0.07, 0.1] },
  },
  optionality: {
    iv30: 12,
    hv30: 24,
    iv_percentile: null,
    iv30_chain_percentile: 18,
    iv30_chain_percentile_kind: "current_chain_cross_section",
    iv_percentile_kind: "retired_ambiguous_field",
    avg_edr: 32,
    observed_at: "2026-08-01T16:00:00Z",
    data_source: "yahoo",
    quality_status: "limited",
    quality_reasons: ["last-price-only quotes"],
    component_usable: { iv30: true, iv_percentile: false, iv30_chain_percentile: true, avg_edr: true, mispricing: false },
  },
  options_flow: {
    expiry: "2026-09-18",
    as_of: "2026-08-01T16:00:00Z",
    call_walls: [],
    put_walls: [],
    call_open_interest_total: 0,
    put_open_interest_total: 0,
    call_volume_total: 0,
    put_volume_total: 0,
    put_call_oi_ratio: null,
  },
  institutional_flow: {
    summary: {
      signal: "accumulation",
      confidence: 62,
      buy_cluster_level: 18.8,
      sell_cluster_level: 20.1,
      distance_to_buy_pct: -2,
      distance_to_sell_pct: 4,
      buy_notional_usd: 2_000_000,
      sell_notional_usd: 1_000_000,
      net_flow_usd: 1_000_000,
      event_count: 1,
    },
    event_history: [],
  },
  fundamentals: {
    eps: series([0.2, 0.25]),
    roe: series([8, 9]),
    free_cash_flow: series([100_000_000, 120_000_000]),
    revenue: series([1_000_000_000, 1_100_000_000]),
    market_cap: series([30_000_000_000, 32_000_000_000]),
    pe_ratio: series([20, 21]),
    revenue_yoy: series([2, 3]),
    as_of: "2026-06-30T00:00:00Z",
    snapshot: {
      eps_ttm: { value: 1.25, period_end: "2026-03-31", change_pct: 4, derived: true },
      roe_ttm: { value: 9.5, period_end: "2026-03-31", change_pct: 1, derived: true },
      free_cash_flow_ttm: { value: 480_000_000, period_end: "2026-03-31", change_pct: 5, derived: true },
      revenue_ttm: { value: 6_800_000_000, period_end: "2026-03-31", change_pct: 3, derived: true },
      pe_ratio: { value: 15.4, period_end: "2026-08-01", change_pct: -2, derived: true },
      market_cap: { value: 36_800_000_000, period_end: "2026-08-01", change_pct: 2, derived: true },
    },
  },
  price_history: [
    { date: "2026-07-31", open: 19, high: 19.4, low: 18.9, close: 19.24 },
  ],
  intraday_history_2h: [
    { timestamp: "2026-06-11T14:00:00Z", open: 18, high: 18.2, low: 17.9, close: 18.1 },
  ],
  price_metadata: {
    source: "yahoo",
    observed_at: "2026-08-01T00:00:00Z",
    stale: false,
  },
  intraday_metadata: {
    source: "yahoo",
    observed_at: "2026-06-11T14:00:00Z",
    stale: true,
  },
  as_of_date: "2026-08-01T00:00:00Z",
  computed_at: "2026-08-03T12:15:00Z",
  data_warnings: [
    { type: "stale_series", details: { interval: "2h" } },
    { type: "optionality_quality", details: { quality_status: "limited" } },
  ],
};

describe("StockAnalysis accuracy pass", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/stocks/KVUE/projections")) return Promise.resolve(payload);
      if (endpoint.startsWith("/news?")) {
        return Promise.resolve([
          {
            id: 1,
            symbol: "KVUE",
            title: "Older Kenvue item",
            link: "https://example.com/older",
            source: "Example",
            published_at: "2026-08-01T10:00:00Z",
          },
          {
            id: 2,
            symbol: "KVUE",
            title: "Latest Kenvue item",
            link: "https://example.com/latest",
            source: "Example",
            published_at: "2026-08-02T10:00:00Z",
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders observed evidence, canonical snapshots, and trailing-window language", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/stock-analysis?symbol=KVUE"]}>
        <StockAnalysis />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Latest Close").length).toBeGreaterThan(0));

    expect(screen.getByText(/Close Aug 1, 2026 · yahoo · computed Aug 3/i)).not.toBeNull();
    expect(screen.getByText("Daily fallback evidence")).not.toBeNull();
    expect(screen.queryByText("2H evidence")).toBeNull();
    expect(screen.getByText("Trailing Window Comparison")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "21D evidence" })).not.toBeNull();
    expect(screen.getByText("Adjusted close")).not.toBeNull();
    for (const label of ["21D", "3M", "6M", "12M"]) {
      expect(screen.getAllByRole("button", { name: label })).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole("button", { name: "12M" }));
    expect(screen.getByRole("heading", { name: "12M evidence" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "12M Component Read" })).not.toBeNull();
    expect(screen.getByText("EPS TTM")).not.toBeNull();
    expect(screen.getByText("$1.25")).not.toBeNull();
    expect(screen.getByText(/TTM through Mar 31, 2026 · price metrics at Aug 1, 2026 close/)).not.toBeNull();
    expect(screen.getAllByText("High-Volume Bar Proxy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Signed Notional").length).toBeGreaterThan(0);
    expect(screen.getByText(/Proxy strength 62\/100/)).not.toBeNull();
    expect(screen.getByText(/1 bar/)).not.toBeNull();
    expect(screen.getAllByText("Signal Quality").length).toBeGreaterThan(0);
    expect(screen.getByText("Options Pricing Context")).not.toBeNull();
    expect(screen.getByText("Unavailable")).not.toBeNull();
    expect(screen.getByText(/Latest article/)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Narrative Impulse" })).not.toBeNull();
    expect(screen.getByText(/Narrative evidence is unavailable/)).not.toBeNull();
    expect(screen.queryByText(/Data Warning:/)).toBeNull();
    expect(container.textContent).not.toMatch(
      /Current Price|Projection horizons|T\+|\bOutlook\b|Score Trends|Score Change|real-time|Uncertainty Cone|Trade Target|Stop Loss|Optionality Mispricing|Institutional Flow Focus|Net Flow Bias|Signal Coherence/
    );
    expect(container.textContent).not.toContain("Confirmed Strength");
    expect(container.textContent).not.toContain("Accumulation/Distribution");
    expect(container.textContent).not.toContain("Why?");
  });

  it("does not collapse mixed TTM reporting periods into one through-date", async () => {
    const mixedPeriodPayload = {
      ...payload,
      fundamentals: {
        ...payload.fundamentals,
        snapshot: {
          ...payload.fundamentals.snapshot,
          roe_ttm: {
            ...payload.fundamentals.snapshot.roe_ttm,
            period_end: "2025-12-31",
          },
        },
      },
    };
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/stocks/KVUE/projections")) return Promise.resolve(mixedPeriodPayload);
      if (endpoint.startsWith("/news?")) return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    render(
      <MemoryRouter initialEntries={["/stock-analysis?symbol=KVUE"]}>
        <StockAnalysis />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/TTM mixed reporting dates · price metrics at Aug 1, 2026 close/)).not.toBeNull());
    expect(screen.queryByText(/TTM through/)).toBeNull();
  });

  it("shows unavailable instead of the initial empty state for a partial projection payload", async () => {
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/stocks/KVUE/projections")) {
        return Promise.resolve({ ...payload, projections: { T: payload.projections.T } });
      }
      if (endpoint.startsWith("/news?")) return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    render(
      <MemoryRouter initialEntries={["/stock-analysis?symbol=KVUE"]}>
        <StockAnalysis />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Trailing analysis unavailable for this asset.")).not.toBeNull());
    expect(screen.queryByText("Search for a stock to get started")).toBeNull();
  });
});
