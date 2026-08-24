import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GlobalPriceDispersion from "./GlobalPriceDispersion";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    CartesianGrid: Empty,
    Line: Empty,
    LineChart: Shell,
    ReferenceLine: Empty,
    ResponsiveContainer: Shell,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const observed = {
  registry_id: "comex_silver",
  venue: "COMEX",
  country: "United States",
  market_type: "futures",
  product_name: "COMEX Silver futures",
  symbol: "SIU26.CMX",
  contract_month: "Sep 2026",
  local_price: 35,
  currency: "USD",
  native_currency: "USD",
  native_unit: "troy oz",
  fx_rate_local_per_usd: 1,
  fx_timestamp: "2026-08-21T14:00:00Z",
  normalized_price: 35,
  premium_pct: 0,
  premium_type: "comparable_premium",
  price_type: "provider daily bar close",
  quote_timestamp: "2026-08-21T14:00:00Z",
  session_status: "unverified",
  freshness_status: "fresh",
  quote_age_hours: 1,
  data_delay: "Daily provider observation",
  volume: 1000,
  open_interest: null,
  liquidity_tier: "Core",
  purity: "Exchange specification",
  delivery_location: "COMEX approved depositories",
  tax_basis: "Exchange futures; local tax not embedded",
  source_name: "Yahoo Finance month-specific futures history",
  redistribution_status: "Third-party provider terms",
  availability_status: "observed",
  comparability_status: "reference",
  comparability_reasons: [],
  decomposition: {
    reference_price: 35,
    fx_conversion_pct: 0,
    carry_adjustment_pct: 0,
    tax_adjustment_pct: 0,
    delivery_adjustment_pct: 0,
    unexplained_basis_pct: 0,
  },
} as const;

const unavailable = (id: string, venue: string) => ({
  ...observed,
  registry_id: id,
  venue,
  country: "China",
  product_name: `${venue} Silver futures`,
  symbol: venue,
  contract_month: null,
  local_price: null,
  currency: "CNY",
  native_currency: "CNY",
  native_unit: "kg",
  fx_rate_local_per_usd: null,
  fx_timestamp: null,
  normalized_price: null,
  premium_pct: null,
  premium_type: null,
  price_type: null,
  quote_timestamp: null,
  session_status: "unavailable",
  freshness_status: "unavailable",
  quote_age_hours: null,
  data_delay: "Feed not connected",
  volume: null,
  availability_status: "unavailable",
  comparability_status: "unavailable",
  comparability_reasons: ["Official or licensed quote feed is not connected"],
  decomposition: null,
  source_name: `${venue} official source`,
  redistribution_status: "Official/licensed feed required",
} as const);

const response = {
  as_of: "2026-08-21T15:00:00Z",
  metal: "AG",
  metal_name: "Silver",
  canonical_currency: "USD",
  canonical_unit: "troy oz",
  comparison_ready: false,
  controls: {
    comparison_time_requested: "latest_available",
    comparison_time_applied: "latest_available",
    reference_requested: "auto",
    reference_resolution: "requested",
    basis_requested: "raw_converted",
    basis_applied: "raw_converted",
  },
  reference: { registry_id: "comex_silver", label: "COMEX", normalized_price: 35 },
  summary: {
    global_median: null,
    highest: null,
    lowest: null,
    dispersion_pct: null,
    registered_venues: 6,
    observed_venues: 1,
    comparable_venues: 1,
    status_counts: { fresh: 1, delayed: 0, stale: 0, unavailable: 5, session_unverified: 1 },
  },
  venues: [
    observed,
    unavailable("lbma_silver", "LBMA"),
    unavailable("mcx_silver", "MCX"),
    unavailable("ose_silver", "OSE"),
    unavailable("sge_silver", "SGE"),
    unavailable("shfe_silver", "SHFE"),
  ],
  sources: [{ provider_id: "us_reference", provider_name: "U.S. reference series", status: "live", fetched_at: "2026-08-21T15:00:00Z", source_url: null }],
  limitations: ["At least two matched observations are required"],
  method: {
    normalization: "Convert currency, then unit.",
    premium: "(normalized / reference - 1) * 100",
    comparability_rule: "Match market type, month, time, and tax basis.",
    license_rule: "Registry coverage does not imply redistribution rights.",
  },
  supported_metals: [
    { metal: "AG", name: "Silver", canonical_unit: "troy oz" },
    { metal: "AU", name: "Gold", canonical_unit: "troy oz" },
  ],
};

const historyResponse = {
  as_of: "2026-08-21T15:00:00Z",
  metal: "AG",
  metal_name: "Silver",
  days_requested: 90,
  mode: "composite_direction",
  baseline: 100,
  canonical_currency: "USD",
  canonical_unit: "troy oz",
  composite: {
    registry_id: "global_direction",
    label: "Silver global trend",
    coverage_start: "2026-08-20",
    coverage_end: "2026-08-21",
    observation_count: 2,
    latest_index_value: 103.0303,
    change_pct: 3.0303,
    min_contributors: 1,
    max_contributors: 1,
    official_primary_days: 1,
    fallback_days: 0,
    points: [
      { date: "2026-08-20", index_value: 100, change_pct: 0, daily_return_pct: null, contributor_count: 0, contributors: [], source_quality: "baseline" },
      {
        date: "2026-08-21",
        index_value: 103.0303,
        change_pct: 3.0303,
        daily_return_pct: 3.0303,
        contributor_count: 1,
        contributors: [
          { venue: "LBMA", registry_ids: ["lbma_silver"], return_pct: 3.0303, source_tier: "official_primary" },
        ],
        source_quality: "official_primary",
      },
    ],
  },
  series: [
    {
      registry_id: "comex_silver",
      provider_id: "us_reference",
      venue: "COMEX",
      country: "United States",
      market_type: "continuous futures proxy",
      product_name: "COMEX Silver futures",
      symbol: null,
      source_name: "Stored Yahoo daily history",
      source_status: "live",
      source_tier: "reference_only",
      source_url: null,
      history_scope: "Stored daily continuous reference history",
      canonical_currency: "USD",
      canonical_unit: "troy oz",
      coverage_start: "2026-08-20",
      coverage_end: "2026-08-21",
      observation_count: 2,
      baseline_price: 34,
      latest_price: 35,
      change_pct: 2.9412,
      alignment_date: "2026-08-20",
      alignment_index_value: 100,
      points: [
        { date: "2026-08-20", quote_timestamp: "2026-08-20T00:00:00Z", normalized_price: 34, index_value: 100, aligned_index_value: 100, change_pct: 0, daily_return_pct: null, local_price: 34, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-08-20T00:00:00Z" },
        { date: "2026-08-21", quote_timestamp: "2026-08-21T00:00:00Z", normalized_price: 35, index_value: 102.9412, aligned_index_value: 102.9412, change_pct: 2.9412, daily_return_pct: 2.9412, local_price: 35, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-08-21T00:00:00Z" },
      ],
    },
    {
      registry_id: "lbma_silver",
      provider_id: "lbma",
      venue: "LBMA",
      country: "United Kingdom",
      market_type: "benchmark",
      product_name: "LBMA Silver Price",
      symbol: "LBMA Silver Price",
      source_name: "London Bullion Market Association",
      source_status: "live",
      source_tier: "official_primary",
      source_url: "https://prices.lbma.org.uk/json/silver.json",
      history_scope: "Full published delayed benchmark history",
      canonical_currency: "USD",
      canonical_unit: "troy oz",
      coverage_start: "2026-08-20",
      coverage_end: "2026-08-21",
      observation_count: 2,
      baseline_price: 33,
      latest_price: 34,
      change_pct: 3.0303,
      alignment_date: "2026-08-20",
      alignment_index_value: 100,
      points: [
        { date: "2026-08-20", quote_timestamp: "2026-08-20T00:00:00Z", normalized_price: 33, index_value: 100, aligned_index_value: 100, change_pct: 0, daily_return_pct: null, local_price: 33, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-08-20T00:00:00Z" },
        { date: "2026-08-21", quote_timestamp: "2026-08-21T00:00:00Z", normalized_price: 34, index_value: 103.0303, aligned_index_value: 103.0303, change_pct: 3.0303, daily_return_pct: 3.0303, local_price: 34, currency: "USD", native_unit: "troy oz", fx_rate_local_per_usd: 1, fx_timestamp: "2026-08-21T00:00:00Z" },
      ],
    },
  ],
  summary: { historical_venues: 2, registered_venues: 6, latest_history_date: "2026-08-21", official_primary_venues: 1, composite_min_contributors: 1, composite_max_contributors: 1 },
  sources: [{ provider_id: "lbma", provider_name: "London Bullion Market Association", status: "live", fetched_at: "2026-08-21T15:00:00Z", source_url: "https://prices.lbma.org.uk/json/silver.json", source_tier: "official_primary", history_scope: "Full published delayed benchmark history", observation_count: 2 }],
  venues_without_history: [],
  limitations: ["Official markets lead.", "Products and closes differ."],
};

describe("GlobalPriceDispersion", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("leads with exchange history and replaces dropdowns with direct controls", () => {
    useApiMock.mockImplementation((endpoint: string) => ({
      data: endpoint.includes("/history?") ? historyResponse : response,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    render(<GlobalPriceDispersion />);

    expect(screen.getByRole("heading", { name: "Global exchange trends" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Silver global trend" })).not.toBeNull();
    expect(screen.getByText(/1 market\/day · through/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Silver" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "3M" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 2 venue paths" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Venue prices & sources").closest("details")?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Venue prices & sources"));
    expect(screen.getByRole("button", { name: /COMEX, COMEX Silver futures/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("USD 35.00 / troy oz").length).toBeGreaterThan(0);
    expect(screen.getByText(/Official markets lead/)).not.toBeNull();
    expect(screen.getByRole("button", { name: /SHFE.*Silver futures.*Unavailable/ })).not.toBeNull();
  });

  it("toggles venue lines and keeps detailed evidence in one disclosure", () => {
    useApiMock.mockImplementation((endpoint: string) => ({
      data: endpoint.includes("/history?") ? historyResponse : response,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    render(<GlobalPriceDispersion />);

    const venueToggle = screen.getByRole("button", { name: "Show 2 venue paths" });
    fireEvent.click(venueToggle);
    expect(screen.getByRole("button", { name: "Hide venue paths" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByText("Venue prices & sources"));
    fireEvent.click(screen.getByRole("button", { name: /COMEX, COMEX Silver futures/ }));
    expect(screen.getByText(/Yahoo Finance month-specific futures history/)).not.toBeNull();
    expect(screen.getByRole("region", { name: "Silver exchange trend summary table" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("London Bullion Market Association")).not.toBeNull();
  });
});
