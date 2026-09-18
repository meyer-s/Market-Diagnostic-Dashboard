import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import EconomicDriverSnapshots from "./EconomicDriverSnapshots";
import type { IndicatorStatus } from "../../types";

const INDICATORS: IndicatorStatus[] = [
  {
    code: "REAL_ESTATE_STABILITY",
    name: "Real Estate Stability",
    raw_value: 37.53,
    score: 37.53,
    state: "RED",
    timestamp: "2026-09-18T12:03:01",
  },
  {
    code: "AGRICULTURE_STABILITY",
    name: "Agriculture Stability",
    raw_value: 42.96,
    score: 42.96,
    state: "YELLOW",
    timestamp: "2026-09-18T12:03:01",
  },
  {
    code: "ENERGY_STABILITY",
    name: "Energy Stability",
    raw_value: 75.75,
    score: 75.75,
    state: "GREEN",
    timestamp: "2026-09-18T12:02:23",
  },
];

describe("EconomicDriverSnapshots", () => {
  it("shows explicit state, score, freshness, and deep links for each physical-economy driver", () => {
    render(
      <MemoryRouter>
        <EconomicDriverSnapshots indicators={INDICATORS} loading={false} />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Rate-sensitive transmission" })).toBeTruthy();
    expect(screen.getByText("37.5")).toBeTruthy();
    expect(screen.getByText("43.0")).toBeTruthy();
    expect(screen.getByText("75.8")).toBeTruthy();
    expect(screen.getByText("Stressed")).toBeTruthy();
    expect(screen.getByText("Caution")).toBeTruthy();
    expect(screen.getByText("Stable")).toBeTruthy();
    expect(screen.getAllByText(/Cached Sep 18, 2026/)).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Open Real estate diagnostic" }).getAttribute("href")).toBe("/real-estate");
    expect(screen.getByRole("link", { name: "Open Agriculture diagnostic" }).getAttribute("href")).toBe("/agriculture");
    expect(screen.getByRole("link", { name: "Open Energy diagnostic" }).getAttribute("href")).toBe("/energy");
  });

  it("keeps a truthful unavailable state when a snapshot is missing", () => {
    render(
      <MemoryRouter>
        <EconomicDriverSnapshots indicators={[]} loading={false} />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.getAllByText("No current snapshot timestamp")).toHaveLength(3);
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
