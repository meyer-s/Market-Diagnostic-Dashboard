import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CryptoDiagnostic from "../CryptoDiagnostic";
import InstitutionalFlow from "../InstitutionalFlow";
import PreciousMetalsDiagnostic from "../PreciousMetalsDiagnostic";

const { apiFetchMock, useApiMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("../../utils/apiUtils", () => ({
  apiFetch: apiFetchMock,
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unexpected error.",
}));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Area: Empty,
    AreaChart: Shell,
    Bar: Empty,
    BarChart: Shell,
    CartesianGrid: Empty,
    Cell: Empty,
    ComposedChart: Shell,
    Legend: Empty,
    Line: Empty,
    LineChart: Shell,
    Pie: Empty,
    PieChart: Shell,
    ReferenceLine: Empty,
    ResponsiveContainer: Shell,
    Scatter: Empty,
    ScatterChart: Shell,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
    ZAxis: Empty,
  };
});

const idle = { loading: false, error: null, refetch: vi.fn() };

const metalsRegime = {
  regime: {
    gold_bias: "MONETARY_HEDGE",
    silver_bias: "INDUSTRIAL_MONETARY",
    pgm_bias: "NEUTRAL",
    paper_physical_risk: "LOW",
    overall_regime: "INFLATION_HEDGE",
  },
  cb_context: {
    global_cb_gold_pct_reserves: 14,
    net_purchases_yoy: 2,
    structural_monetary_bid: 0.6,
    em_accumulation_momentum: 0.4,
  },
  price_anchors: {
    au_dxy_ratio_zscore: 0.3,
    ag_dxy_ratio_zscore: 0.2,
    real_rate_signal: 0.5,
    monetary_hedge_strength: 0.6,
  },
  relative_value: {
    au_ag_ratio: 82,
    au_ag_ratio_zscore: 0.4,
    pt_au_ratio: 0.5,
    pt_au_ratio_zscore: -0.2,
    pd_au_ratio: 0.4,
    pd_au_ratio_zscore: -0.3,
  },
  physical_paper: {
    paper_credibility_index: 0.7,
    etf_holdings_zscore: 0.1,
    etf_holdings_change_yoy: 2,
    oi_registered_ratio: 8,
    comex_registered_inventory_change_yoy: -3,
    backwardation_severity: 0.1,
    etf_flow_divergence: 0.2,
  },
};

const cryptoOverview = {
  as_of: "2026-07-29T15:00:00Z",
  summary: {
    btc_dominance: 57,
    total_market_cap: 3_000_000_000_000,
    market_cap_change_24h: 1.2,
    advancing_assets_24h: 3,
    monitored_assets: 4,
  },
  assets: [],
  market_structure_history: [],
};

const flowRow = {
  symbol: "AAPL",
  name: "Apple",
  category: "stocks",
  status: "ok",
  signal: "accumulation",
  confidence: 82,
  latest_price: 210,
  buy_cluster_level: 205,
  sell_cluster_level: 216,
  distance_to_buy_pct: -2.4,
  distance_to_sell_pct: 2.9,
  buy_notional_usd: 15_000_000,
  sell_notional_usd: 4_000_000,
  net_flow_usd: 11_000_000,
  event_count: 1,
  flow_timeline: [],
  recent_events: [
    {
      date: "2026-07-29T14:00:00Z",
      price: 210,
      volume: 120_000,
      volume_z: 2.4,
      clv: 0.8,
      price_change_pct: 1,
      notional: 15_000_000,
      side: "buy",
      strength: 0.82,
    },
  ],
};

describe("asset and flow route polish", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    useApiMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes one metals H1, complete tab semantics, and honest support coverage", () => {
    apiFetchMock.mockResolvedValue([{ date: "2026-07-29", price: 100 }]);
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/precious-metals/regime") return { ...idle, data: metalsRegime };
      if (endpoint === "/precious-metals/correlations") {
        return { ...idle, data: { timestamp: "2026-07-29T14:00:00Z" } };
      }
      if (endpoint === "/precious-metals/projections/latest") {
        return { ...idle, data: { projections: [] } };
      }
      if (endpoint === "/precious-metals/futures-curve?contracts=4") {
        return { ...idle, data: { as_of: "2026-07-29T15:00:00Z", source: "test", contracts_requested: 4, metals: [] } };
      }
      return { ...idle, data: null };
    });

    render(<PreciousMetalsDiagnostic />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Metals Diagnostic" })).not.toBeNull();
    expect(screen.getByText(/3\/8 supporting datasets available/)).not.toBeNull();
    const overview = screen.getByRole("tab", { name: "Overview" });
    const deepDive = screen.getByRole("tab", { name: "Deep Dive" });
    expect(overview.getAttribute("aria-selected")).toBe("true");
    expect(deepDive.getAttribute("tabindex")).toBe("-1");
  });

  it("makes crypto view and range controls explicit and keyboard-readable", () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/crypto/market-overview")) return { ...idle, data: cryptoOverview };
      return { ...idle, data: null };
    });

    render(<CryptoDiagnostic />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Crypto Diagnostic" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "90D" }).getAttribute("aria-pressed")).toBe("true");
    const deepDive = screen.getByRole("tab", { name: "Deep Dive" });
    fireEvent.click(deepDive);
    expect(deepDive.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Deep Dive" })).not.toBeNull();
  });

  it("puts selected flow evidence before mobile groups and exposes provenance", () => {
    useApiMock.mockReturnValue({
      ...idle,
      data: {
        as_of: "2026-07-29T15:00:00Z",
        groups: { stocks: [flowRow], sectors: [], metals: [], crypto: [] },
        leaders: { accumulation: [flowRow], distribution: [] },
        stock_selection: { mode: "close dollar volume", symbols: ["AAPL"], count: 1 },
        method: {
          description: "Clusters unusually large volume with close-location evidence.",
          note: "Signals are observational and do not establish investor identity.",
        },
      },
    });

    render(<InstitutionalFlow />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Institutional Flow" })).not.toBeNull();
    expect(screen.getByText("1/1 signals usable")).not.toBeNull();
    const signalButton = screen.getByRole("button", { name: /AAPL, accumulation/i });
    expect(signalButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "How to read institutional flow" })).not.toBeNull();
    expect(screen.getByText(/do not establish investor identity/)).not.toBeNull();
  });
});
