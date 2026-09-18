import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EconomicDriverSnapshots from "./EconomicDriverSnapshots";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));

const realEstate = {
  as_of: "2026-09-18T14:29:03Z",
  regime_label: "Late-Cycle Squeeze",
  stability_score: 36.22,
  metrics: { mortgage_rate_30y: 6.95, credit_spread_bps: 270 },
  availability: { available_count: 11, total_configured: 11 },
  data_quality: { status: "complete", stale: false },
};

const agriculture = {
  as_of: "2026-09-18T14:29:08Z",
  regime_label: "Rotation / Mixed",
  stability_score: 48.21,
  strongest_markets: [{ name: "Oats", score: 93.73 }],
  weakest_markets: [{ name: "Feeder Cattle", score: 24.49 }],
  availability: { available_symbol_count: 22, total_configured_symbols: 25 },
};

const energy = {
  as_of: "2026-09-18T14:29:08Z",
  regime_label: "Prices Elevated",
  composite_score: 64.38,
  stability_score: 42.84,
  groups: [
    { label: "Crude Oil", group_composite: 76.08 },
    { label: "Natural Gas", group_composite: 52.15 },
  ],
  availability: { available_count: 6, total_configured: 7 },
};

const result = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  loading: false,
  error: null,
  refetch: vi.fn(),
  ...overrides,
});

describe("EconomicDriverSnapshots", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/real-estate/overview?days=90") return result(realEstate);
      if (endpoint === "/agriculture/overview?days=90") return result(agriculture);
      if (endpoint === "/energy/overview?days=90") return result(energy);
      return result(null, { error: "Unexpected endpoint" });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows source-backed regimes, stability scales, market evidence, coverage, and deep links", () => {
    render(
      <MemoryRouter>
        <EconomicDriverSnapshots />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Cross-market snapshots" })).toBeTruthy();
    expect(screen.getByText("Late-Cycle Squeeze")).toBeTruthy();
    expect(screen.getByText("Rotation / Mixed")).toBeTruthy();
    expect(screen.getByText("Prices Elevated")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Real estate stability" }).getAttribute("aria-valuenow")).toBe("36.2");
    expect(screen.getByRole("meter", { name: "Agriculture stability" }).getAttribute("aria-valuenow")).toBe("48.2");
    expect(screen.getByRole("meter", { name: "Energy stability" }).getAttribute("aria-valuenow")).toBe("42.8");
    expect(screen.getByText("6.95%")).toBeTruthy();
    expect(screen.getByText("270 bp")).toBeTruthy();
    expect(screen.getByText("Oats")).toBeTruthy();
    expect(screen.getByText("Feeder Cattle")).toBeTruthy();
    expect(screen.getByText("64.4")).toBeTruthy();
    expect(screen.getByText("Crude Oil")).toBeTruthy();
    expect(screen.getByText("Complete · 11/11 inputs")).toBeTruthy();
    expect(screen.getByText("Partial · 22/25 markets")).toBeTruthy();
    expect(screen.getByText("Partial · 6/7 contracts")).toBeTruthy();
    expect(screen.getAllByText(/Updated Sep 18, 2026/)).toHaveLength(3);
    expect(screen.queryByText(/Financing, affordability/)).toBeNull();
    expect(screen.queryByText(/Crop leadership, participation/)).toBeNull();
    expect(screen.queryByText(/Fuel-market momentum/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open Real estate diagnostic" }).getAttribute("href")).toBe("/real-estate");
    expect(screen.getByRole("link", { name: "Open Agriculture diagnostic" }).getAttribute("href")).toBe("/agriculture");
    expect(screen.getByRole("link", { name: "Open Energy diagnostic" }).getAttribute("href")).toBe("/energy");
    expect(useApiMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/real-estate/overview?days=90",
      "/agriculture/overview?days=90",
      "/energy/overview?days=90",
    ]);
  });

  it("keeps failures local while the other domain snapshots remain usable", () => {
    useApiMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/real-estate/overview?days=90") return result(realEstate);
      if (endpoint === "/agriculture/overview?days=90") return result(null, { error: "Unavailable" });
      return result(energy);
    });

    render(
      <MemoryRouter>
        <EconomicDriverSnapshots />
      </MemoryRouter>
    );

    expect(screen.getByText("Overview feed unavailable")).toBeTruthy();
    expect(screen.getByText("6.95%")).toBeTruthy();
    expect(screen.getByText("64.4")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Agriculture diagnostic" })).toBeTruthy();
  });
});
