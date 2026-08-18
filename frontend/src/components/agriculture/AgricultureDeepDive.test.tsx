import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgricultureDeepDive, { type AgricultureDeepDiveData, type AgricultureGroupRow } from "./AgricultureDeepDive";
import type { AgricultureContextData } from "./AgricultureContextPanel";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("../../utils/apiUtils", () => ({ apiFetch: apiFetchMock }));

function group(
  key: string,
  label: string,
  weight: number,
  score: number,
  breadth: number,
  components: AgricultureGroupRow["components"]
): AgricultureGroupRow {
  return {
    group: key,
    label,
    effective_weight: weight,
    symbol_count: components.length,
    group_composite: score,
    changes: { "5d": 1.5, "20d": score >= 50 ? 4.2 : -3.1, "60d": 2.0, "120d": 3.0 },
    volatility: 22,
    breadth_score: breadth,
    strongest: [],
    weakest: [],
    components,
    stability_contribution: 20,
    correlation_to_composite: 0.7,
  };
}

const corn = { code: "ZC", name: "Corn", score: 70, ticker: "ZC=F", changes: { "20d": 5.2 }, volatility: 21 };
const soybeans = { code: "ZS", name: "Soybeans", score: 61, ticker: "ZS=F", changes: { "20d": 1.8 }, volatility: 19 };
const cattle = { code: "LE", name: "Live Cattle", score: 34, ticker: "LE=F", changes: { "20d": -4.4 }, volatility: 28 };

const deepDiveData: AgricultureDeepDiveData = {
  as_of: "2026-08-18T15:00:00Z",
  groups: [
    group("grains_oilseeds", "Grains / Oilseeds", 45, 70.6, 62.5, [corn, soybeans]),
    group("livestock", "Livestock", 20, 34.2, 31.5, [cattle]),
  ],
  correlations: {
    group_matrix: {
      "60": [
        { row: "grains_oilseeds", values: { grains_oilseeds: 1, livestock: -0.72 } },
        { row: "livestock", values: { grains_oilseeds: -0.72, livestock: 1 } },
      ],
    },
    pair_insights: { "60": { grains_livestock: -0.72 } },
  },
  special_signals: {
    soybean_oil_vs_grains: { spread_20d: 2.4, soybean_oil_20d: 5, avg_grains_20d: 2.6, interpretation: "Biofuel proxy is firming." },
    livestock_feed_margin_pressure: { spread_20d: -3.1, grains_20d: 4.2, livestock_20d: 1.1, interpretation: "Feed costs are tightening margins." },
  },
  macro_pressure: {
    interest_rates: { name: "10Y Yield", status: "pressuring", change_20d: 2.39 },
    dollar_strength: { name: "Dollar Index", status: "supportive", change_20d: -1.2 },
    biofuel_proxy: { name: "Soybean Oil vs Grains", status: "firming", spread_20d: 2.4 },
  },
  availability: {
    missing_symbols: [],
    missing_macro_series: [],
    available_group_count: 6,
    total_configured_symbols: 25,
    available_symbol_count: 25,
  },
  warnings: ["This is a macro diagnostic and not a trading signal."],
};

function context(
  symbol = "ZC",
  setupLabel = "conflicting signals",
  netBias: AgricultureContextData["context_score"]["net_bias"] = "bullish",
  technicalBias: AgricultureContextData["technical"]["bias"] = "bearish"
): AgricultureContextData {
  return {
    as_of: "2026-08-18T15:00:00Z",
    symbol,
    commodity: symbol === "LE" ? "Live Cattle" : "Corn",
    metadata: { commodity_group: symbol === "LE" ? "livestock" : "grains_oilseeds" },
    session: { status: "open", current_time_et: "2026-08-18T11:00:00-04:00" },
    crop_stage: { stage: "grain_fill", weather_sensitivity: "medium", seasonal_pressure: "mixed", stage_explanation: "Current crop stage." },
    report_calendar: {
      next_report: { report: "Export Inspections", release_at: "2026-08-17T11:00:00-04:00", impact: "medium" },
      source_health: { freshness_status: "aging", source_url: "https://www.usda.gov/" },
    },
    weather: { bias: "bullish", reasons: ["Dry weather is supporting the current read."], forecast_url: "https://api.weather.gov/gridpoints/DMX/1,1", source_health: { freshness_status: "fresh" } },
    crop_progress: { bias: "bullish", reasons: ["Conditions weakened week over week."], report_url: "https://www.nass.usda.gov/", source_health: { freshness_status: "fresh" } },
    export_demand: { bias: "bearish", reasons: ["Shipments are below the recent pace."], source_health: { freshness_status: "fresh" } },
    wasde: { bias: "bullish", reasons: ["Ending stocks tightened."], report_link: "https://www.usda.gov/oce/commodity/wasde", source_health: { freshness_status: "fresh" } },
    global_supply: { bias: "neutral", reasons: ["Global supply is balanced."], source_health: { freshness_status: "fresh" } },
    technical: { bias: technicalBias, confidence: "medium", ticker: symbol === "LE" ? "LE=F" : "ZC=F" },
    context_score: {
      net_bias: netBias,
      confidence: "medium",
      confidence_score: 61.2,
      numerical_score: 2,
      component_breakdown: { weather: 1, crop_progress: 1, export_demand: -1, wasde: 1, global_supply: 0, technical: -1 },
      warnings: [],
    },
    setup_label: setupLabel,
    market_read: "Evidence is mixed.",
    thesis_validation: { validation_status: "warning", confirmations: ["WASDE confirms the supply read."], warnings: [] },
  };
}

describe("AgricultureDeepDive", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint.includes("LE")) return Promise.resolve(context("LE", "technical-only setup", "neutral", "bearish"));
      if (endpoint.includes("ZS")) return Promise.resolve(context("ZS", "fundamental-only setup", "bearish", "neutral"));
      return Promise.resolve(context("ZC", "aligned long setup", "bullish", "bullish"));
    });
  });

  it("prioritizes one ranked sector and one contract thesis", async () => {
    render(<AgricultureDeepDive data={deepDiveData} />);

    expect(screen.getByRole("heading", { name: "Sector mix" })).toBeTruthy();
    expect(screen.getByText("By weight · score / 20d")).toBeTruthy();
    expect(screen.getAllByText("Strong", { exact: false }).length).toBeGreaterThan(0);
    const selectedSector = screen.getByRole("button", { name: /Grains \/ Oilseeds/i });
    expect(selectedSector.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Grains / Oilseeds" })).toBeTruthy();
    const selectedContract = screen.getByRole("button", { name: /Corn/i });
    expect(selectedContract.getAttribute("aria-pressed")).toBe("true");
    expect(selectedContract.textContent).toContain("✓");

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenCalledWith("/agriculture/context?symbol=ZC");
    expect(apiFetchMock).toHaveBeenCalledWith("/agriculture/context?symbol=ZS");
    expect(within(selectedContract).getByText("A↑")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Soybeans/i })).getByText("F↓")).toBeTruthy();
    expect(await screen.findByText("Bias")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Confidence")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
    expect(screen.getByText("Occurred yesterday — update pending")).toBeTruthy();
  });

  it("loads a different thesis only when the user selects it", async () => {
    render(<AgricultureDeepDive data={deepDiveData} />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: /Livestock/i }));
    expect(screen.getByRole("heading", { name: "Livestock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Livestock/i }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/agriculture/context?symbol=LE"));
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    expect(within(screen.getByRole("button", { name: /Live Cattle/i })).getByText("T↓")).toBeTruthy();
  });

  it("keeps secondary evidence collapsed and explains correlations before the matrix", () => {
    render(<AgricultureDeepDive data={deepDiveData} />);

    const relationshipsSummary = screen.getByText("Relationships", { selector: "span.block" }).closest("summary");
    const relationships = relationshipsSummary?.closest("details") as HTMLDetailsElement;
    expect(relationships.open).toBe(false);

    fireEvent.click(relationshipsSummary!);
    expect(relationships.open).toBe(true);
    expect(within(relationships).getByRole("heading", { name: "Strongest relationships" })).toBeTruthy();
    expect(within(relationships).getByText(/Neither direction is inherently good or bad/)).toBeTruthy();
    expect(within(relationships).getByRole("table", { name: /Pairwise 60-day correlations/ })).toBeTruthy();
  });

  it("degrades safely while an older backend response lacks consolidated evidence", () => {
    const legacySnapshot = { ...deepDiveData, correlations: undefined, macro_pressure: undefined, special_signals: undefined };
    render(<AgricultureDeepDive data={legacySnapshot} />);

    expect(screen.getByRole("heading", { name: "Sector mix" })).toBeTruthy();
    expect(screen.getByText("Relationship history is not available.")).toBeTruthy();
    expect(screen.getAllByText("Macro evidence is unavailable in this snapshot.").length).toBeGreaterThan(0);
  });

  it("opens driver explanations inline and replaces raw weather APIs with a human source", async () => {
    render(<AgricultureDeepDive data={deepDiveData} />);
    const driver = await screen.findByRole("button", { name: /Weather · supportive/i });

    fireEvent.click(driver);
    expect(driver.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Dry weather is supporting the current read.")).toBeTruthy();

    const weatherLink = screen.getByRole("link", { name: /National Weather Service.*opens in a new tab/i });
    expect(weatherLink.getAttribute("href")).toBe("https://www.weather.gov/");
    expect(document.querySelector('a[href^="https://api.weather.gov"]')).toBeNull();
  });
});
