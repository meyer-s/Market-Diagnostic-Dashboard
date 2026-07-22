import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MarketWeatherResponse } from "../../types/marketWeather";
import MarketWeatherMethodologyReport from "./MarketWeatherMethodologyReport";

const DATA = {
  symbol: "SPY",
  generated_at: "2026-07-22T14:30:00Z",
  data_source: "yahoo",
  quote: {
    price: 640.25,
    source: "yahoo",
    quote_source: "regularMarketPrice",
    observed_at: "2026-07-22T14:29:00Z",
  },
  bar_size: "1 day",
  timeframe: "1D",
  requested_bars: 750,
  available_bars: 750,
  coverage_start: "2023-07-22",
  coverage_end: "2026-07-22",
  orientation: "horizon_by_time",
  dates: [],
  horizons: [8, 9, 10, 11],
  price: [],
  channels: {},
  summary: {},
  latest_profile: [],
  settings: {
    state_smoothing: 5,
    cross_horizon_blend: 0.32,
    renderer_time_blur: 3,
    renderer_spatial_blend: 0.42,
    motion_normalization_length: 13,
    edge_gain: 1.35,
    entropy_smoothing: 4,
    reflectivity_compression: 4,
    contour_bands: 7,
    confidence_gamma: 0.86,
  },
  methodology: {
    causal: true,
    description: "Causal trailing construction.",
    research_status: "Experimental and descriptive.",
  },
  research: {
    lexicon: {
      training_split: {
        archetype_count: 3,
        fit_bars: 266,
        calibration_bars: 132,
        evaluation_bars: 352,
        fit_mean_silhouette: 0.31,
      },
      archetypes: [],
      current: {
        distance_tail_score: 0.08,
        distance_tail_support: 48,
      },
      distance_metric: {
        outside_range_cutoff: 0.05,
      },
    },
    context: {
      version: "0.1.0",
      mode: "shadow_only",
      field_influence: "none",
      description: "Context is displayed beside the field.",
      cross_market: {
        relationships: [
          { status: "persistent" },
          { status: "unstable" },
        ],
      },
    },
  },
} as unknown as MarketWeatherResponse;

afterEach(cleanup);

describe("MarketWeatherMethodologyReport", () => {
  it("stays compact until the report is requested", () => {
    render(<MarketWeatherMethodologyReport data={DATA} />);

    const toggle = screen.getByRole("button", { name: /From Swami heatmaps to a Market Field Language/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("One field branch, one shadow-context branch")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("One field branch, one shadow-context branch")).not.toBeNull();
    expect(screen.getByText("What this exact response contains")).not.toBeNull();
    expect(screen.getAllByText("None").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Proper fit 266 bars, Calibration 132 bars, Evaluation 352 bars/i })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Shadow context: price action, optionality, and cross-market structure/i }));
    expect(screen.getByText(/2 returned · 1 meet the current persistent rule/i)).not.toBeNull();
    expect(screen.getByText("Cross-horizon blend")).not.toBeNull();
    expect(screen.getByText("0.32")).not.toBeNull();
  });

  it("lazy-mounts detailed chapters independently", () => {
    render(<MarketWeatherMethodologyReport data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: /From Swami heatmaps to a Market Field Language/i }));

    expect(screen.queryByText("Midprice and true range")).toBeNull();
    const chapter = screen.getByRole("button", { name: /Data, causality, and base field construction/i });
    expect(chapter.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(chapter);

    expect(chapter.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Midprice and true range")).not.toBeNull();
  });

  it("degrades honestly when research metadata is absent", () => {
    const withoutResearch = { ...DATA, research: undefined } as MarketWeatherResponse;
    render(<MarketWeatherMethodologyReport data={withoutResearch} />);
    fireEvent.click(screen.getByRole("button", { name: /From Swami heatmaps to a Market Field Language/i }));

    expect(screen.getByText("This response did not include a learned Form split.")).not.toBeNull();
    expect(screen.getAllByText("Not supplied").length).toBeGreaterThan(0);
    expect(screen.getByText(/realized volatility not reported/i)).not.toBeNull();
  });
});
