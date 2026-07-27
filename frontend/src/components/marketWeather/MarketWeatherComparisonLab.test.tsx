import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarketWeatherComparisonResponse } from "../../types/marketWeather";
import MarketWeatherComparisonLab from "./MarketWeatherComparisonLab";

const IDS = [
  "pressure",
  "velocity",
  "acceleration",
  "jerk",
  "snap",
  "structure",
  "kinematics",
  "geometry",
  "information",
  "propagation",
  "cascade_bias",
  "scaling_exponent",
  "volatility_carrier",
  "participation_carrier",
  "liquidity_stress_carrier",
];

const DATA: MarketWeatherComparisonResponse = {
  schema_version: "market_field_pair_v1",
  semantic_revision: "1.3",
  target: { symbol: "NVDA", analysis_hash: "a".repeat(64), latest_close: 184.25 },
  benchmark: { symbol: "QQQ", analysis_hash: "b".repeat(64), latest_close: 611.4 },
  comparison_hash: "c".repeat(64),
  timeframe: "1D",
  overlap: {
    common_observations: 120,
    start: "2026-01-02",
    end: "2026-07-24",
    target_dropped: 2,
    benchmark_dropped: 1,
    latest_aligned_at: "2026-07-24",
    support_fraction: 0.98,
    session_compatible: true,
    note: "Exact shared timestamps.",
  },
  support: {
    supported_coordinate_cells: 1764,
    total_coordinate_cells: 1800,
    support_fraction: 0.98,
    all_returned_coordinate_cells_supported: false,
    support_rule: "bilateral_full_dependency_support",
    missing_values_carried: false,
  },
  relative_progress: {
    latest_target_close: 184.25,
    latest_benchmark_close: 611.4,
    active_return_pct: 4.25,
    beta_adjusted_return_pct: 1.1,
    beta: 1.34,
    lookback_bars: 120,
    gap_direction: "widening",
  },
  coordinates: IDS.map((id, index) => ({
    id,
    label: id.replace(/_/g, " "),
    family: index < 5 ? "pressure_state" : index < 12 ? "field_transform" : "ohlcv_carrier",
    latest: {
      target: 0.4,
      benchmark: 0.2,
      target_context: 0.5,
      benchmark_context: 0.1,
      native_difference: 0.2,
      context_difference: 0.4,
      target_supported: true,
      benchmark_supported: id !== "liquidity_stress_carrier",
    },
    series: [
      {
        date: "2026-07-23",
        target: 0.2,
        benchmark: 0.1,
        target_context: 0.3,
        benchmark_context: 0.1,
        native_difference: 0.1,
        context_difference: 0.2,
        target_supported: true,
        benchmark_supported: true,
      },
      {
        date: "2026-07-24",
        target: 0.4,
        benchmark: 0.2,
        target_context: 0.5,
        benchmark_context: 0.1,
        native_difference: 0.2,
        context_difference: 0.4,
        target_supported: true,
        benchmark_supported: id !== "liquidity_stress_carrier",
      },
    ],
  })),
  price_series: [
    { date: "2026-07-23", target_close: 180, benchmark_close: 608, relative_index: 100, active_return: 0, prior_return_beta: null, beta_adjusted_cumulative_return: null },
    { date: "2026-07-24", target_close: 184.25, benchmark_close: 611.4, relative_index: 101.8, active_return: 1.8, prior_return_beta: 1.34, beta_adjusted_cumulative_return: 1.1 },
  ],
  provenance: {
    target_analysis_hash: "a".repeat(64),
    benchmark_analysis_hash: "b".repeat(64),
    comparison_hash: "c".repeat(64),
    note: "Ordered identity over two immutable component analyses.",
  },
  caveats: ["Descriptive research only."],
};

const DEFAULT_INNER_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: DEFAULT_INNER_WIDTH,
  });
});

describe("MarketWeatherComparisonLab", () => {
  it("leads with a concise Overview and defers the heavy field and audit panels", () => {
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Descriptive read")).not.toBeNull();
    expect(screen.getAllByText(/Relative index/).length).toBeGreaterThan(0);
    expect(screen.getByText("Relative price progress")).not.toBeNull();
    expect(screen.getByText("Field separation")).not.toBeNull();
    expect(screen.getByText("Data support")).not.toBeNull();
    expect(screen.getByText("1,764 / 1,800")).not.toBeNull();
    expect(screen.getByText("14 / 15")).not.toBeNull();
    expect(screen.getByText("No")).not.toBeNull();
    expect(screen.getByText(/100 on Jul 23, 2026/i)).not.toBeNull();
    expect(screen.getByText("Relative price and prior-only beta-adjusted path")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Self-checking compact receipt/i })).not.toBeNull();
    expect(screen.getByText(/beta-adjusted return chain/i)).not.toBeNull();
    expect(screen.queryByText("Relationship scopes")).toBeNull();
    expect(screen.queryByText("Identity & authority boundary")).toBeNull();
    expect(screen.queryByText("Native units")).toBeNull();
    expect(screen.queryByText("State separation through time")).toBeNull();
    expect(screen.queryByText(/^Mixed$/i)).toBeNull();
    expect(screen.queryByText(/beta residual/i)).toBeNull();
    expect(screen.queryByText(/leads/i)).toBeNull();
  });

  it("exposes linkable field controls, one scope at a time, and all 15 drillable coordinates", () => {
    const onBasisChange = vi.fn();
    const onViewChange = vi.fn();
    const onDimensionChange = vi.fn();
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={onBasisChange}
        onViewChange={onViewChange}
        onDimensionChange={onDimensionChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    expect(screen.getByText("Relationship scopes")).not.toBeNull();
    expect(screen.getAllByText("Directional phase").length).toBeGreaterThanOrEqual(2);
    const higherMotion = screen.getByRole("button", { name: "Higher motion" });
    expect(higherMotion.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(higherMotion);
    expect(higherMotion.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText(/Acceleration × jerk/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Direct model-scale gap" }));
    const displayedSeries = screen.getByRole("group", { name: "Displayed series" });
    fireEvent.click(within(displayedSeries).getByRole("button", { name: "NVDA" }));
    fireEvent.click(screen.getByRole("button", { name: /velocity/i }));
    expect(onBasisChange).toHaveBeenCalledWith("native");
    expect(onViewChange).toHaveBeenCalledWith("target");
    expect(onDimensionChange).toHaveBeenCalledWith("velocity");
    expect(screen.getByRole("group", { name: "Scope trail length" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Scope scale" })).not.toBeNull();
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(15);
    expect(screen.getByText("Motion")).not.toBeNull();
    expect(screen.getByText("Field")).not.toBeNull();
    expect(screen.getByText("Carrier")).not.toBeNull();
    expect(screen.getByText(/Bounded signed multihorizon directional pressure/i)).not.toBeNull();
  });

  it("moves chronology, hashes, nominal closes, cache detail, and zero authority into Audit", () => {
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Audit receipt" }));
    expect(screen.getByRole("button", { name: "Export compact receipt · JSON" }).getAttribute("title")).toContain("not digitally signed");
    expect(screen.getByText("Identity & authority boundary")).not.toBeNull();
    expect(screen.getByText("Cache / runtime")).not.toBeNull();
    expect(screen.getByText("NVDA aligned close")).not.toBeNull();
    fireEvent.click(screen.getByText("Definitions, chronology, and limits"));
    expect(screen.getByText("Relative index")).not.toBeNull();
    expect(screen.getByText("Direct model-scale gap")).not.toBeNull();
    expect(screen.getByText("Relative to own history")).not.toBeNull();
    expect(screen.getByText(/zero scanner, option-learning, veto, sizing, or execution authority/i)).not.toBeNull();
  });

  it("does not certify unknown sessions and renders unsupported alignment explicitly", () => {
    render(
      <MarketWeatherComparisonLab
        data={{
          ...DATA,
          overlap: {
            ...DATA.overlap,
            session_compatible: undefined,
            session_compatibility: "unknown",
            alignment_supported: false,
            alignment_status: "unsupported",
            note: "The requested bar anchors do not share a safe completion rule.",
          },
        }}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/cannot be aligned safely/i)).not.toBeNull();
    expect(screen.getAllByText(/Sessions not independently certified/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not summarized because the response marks this alignment unsupported/i)).not.toBeNull();
    expect(screen.queryByText("Sessions are marked compatible.")).toBeNull();
  });

  it("labels a same-analysis pair as an identity control", () => {
    render(
      <MarketWeatherComparisonLab
        data={{
          ...DATA,
          benchmark: { ...DATA.benchmark, symbol: "NVDA", analysis_hash: DATA.target.analysis_hash },
          provenance: {
            ...DATA.provenance,
            benchmark_analysis_hash: DATA.target.analysis_hash,
            identity_control: true,
          },
        }}
        basis="native"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Identity control")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Audit receipt" }));
    expect(screen.getByText(/supported signed difference should be zero/i)).not.toBeNull();
  });

  it("copies the deterministic descriptive summary from the Audit receipt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Audit receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain("NVDA compared with QQQ");
    expect(String(writeText.mock.calls[0][0])).toContain("not a forecast, ranking, or trade signal");
  });

  it("synchronizes the inspected date across visible field charts", () => {
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    const scope = screen.getAllByRole("img", { name: /Directional phase trajectory/i })[0] as unknown as SVGSVGElement;
    Object.defineProperty(scope, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 180,
        height: 180,
        left: 0,
        right: 320,
        top: 0,
        width: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    fireEvent(scope, new MouseEvent("pointermove", { bubbles: true, clientX: 24 }));

    expect(screen.getByText(/Hover or touch a chart/i).textContent).toContain("(2026-07-23)");
    expect(screen.getAllByText(/2026-07-23 · x/i).length).toBeGreaterThan(0);
  });

  it("maps the compact price-chart pointer through its mobile viewBox", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    const chart = screen.getByRole("img", { name: /Relative price index based at 100/i }) as unknown as SVGSVGElement;
    Object.defineProperty(chart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 128,
        height: 128,
        left: 0,
        right: 360,
        top: 0,
        width: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    fireEvent(chart, new MouseEvent("pointermove", { bubbles: true, clientX: 190 }));

    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-23 · Relative index") === true
      )),
    ).not.toBeNull();
  });

  it("opens selected-coordinate detail as an accessible narrow-screen bottom sheet", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    const trigger = screen.getByRole("button", { name: /Inspect pressure/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "pressure" })).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close coordinate detail" })).toBe(document.activeElement));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "pressure" })).toBeNull();
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });
});
