import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GlobalPriceDispersion from "./GlobalPriceDispersion";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));

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

describe("GlobalPriceDispersion", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("leads with explicit coverage, units, reference, and comparison readiness", () => {
    useApiMock.mockReturnValue({ data: response, loading: false, error: null, refetch: vi.fn() });
    render(<GlobalPriceDispersion />);

    expect(screen.getByRole("heading", { name: "Global Price Dispersion" })).not.toBeNull();
    expect(screen.getByText("1 connected observation · comparison not ready")).not.toBeNull();
    expect(screen.getByText("1 observed / 6 registered")).not.toBeNull();
    expect(screen.getAllByText("USD 35.00 per troy oz").length).toBeGreaterThan(0);
    expect(screen.getByText(/Coverage is not comparison-ready/)).not.toBeNull();
    expect(screen.getAllByText("Reference 0.00%").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /SHFE.*Silver futures/ })).toBeNull();
  });

  it("progressively reveals registered venues and their licensing receipt", () => {
    useApiMock.mockReturnValue({ data: response, loading: false, error: null, refetch: vi.fn() });
    render(<GlobalPriceDispersion />);

    fireEvent.click(screen.getByRole("button", { name: "Show all 6 registered venues" }));
    fireEvent.click(screen.getByRole("button", { name: /SHFE.*Silver futures/ }));

    expect(screen.getByRole("heading", { name: "SHFE · SHFE Silver futures" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.getByText("Official or licensed quote feed is not connected")).not.toBeNull();
    expect(screen.getAllByText(/Official\/licensed feed required/).length).toBeGreaterThan(0);
    expect(screen.getByText("Table reading mode and methodology")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Scrollable Silver venue comparison table" }).getAttribute("tabindex")).toBe("0");
  });
});
