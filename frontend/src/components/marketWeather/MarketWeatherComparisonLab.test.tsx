import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  schema_version: "market_field_comparison_v1",
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

afterEach(cleanup);

describe("MarketWeatherComparisonLab", () => {
  it("renders relative progress before field diagnostics and keeps all 15 coordinates drillable", () => {
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

    expect(screen.getByText("Relative price and prior-only beta residual")).not.toBeNull();
    expect(screen.getByText(/current contiguous prior-only beta-residual chain/i)).not.toBeNull();
    expect(screen.getByText("Directional phase")).not.toBeNull();
    expect(screen.getByText("Higher motion")).not.toBeNull();
    expect(screen.getByText("Organization")).not.toBeNull();
    expect(screen.getByText("Propagation & carriers")).not.toBeNull();
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(10);
    expect(screen.getByText("15-coordinate differential")).not.toBeNull();
    expect(screen.getByText(/1 latest coordinate lacks bilateral support/i)).not.toBeNull();
    expect(screen.queryByText(/leads/i)).toBeNull();
  });

  it("exposes basis, subject, and coordinate selection without recomputing in the component", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Native units" }));
    fireEvent.click(screen.getByRole("button", { name: "NVDA" }));
    fireEvent.click(screen.getByRole("button", { name: /velocity/i }));
    expect(onBasisChange).toHaveBeenCalledWith("native");
    expect(onViewChange).toHaveBeenCalledWith("target");
    expect(onDimensionChange).toHaveBeenCalledWith("velocity");
    expect(screen.getByRole("group", { name: "Scope subject" })).not.toBeNull();
  });

  it("documents chronology, alignment, hashes, and zero authority in a compact disclosure", () => {
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

    fireEvent.click(screen.getByText("Definitions, chronology, and limits"));
    expect(screen.getByText("Relative index")).not.toBeNull();
    expect(screen.getByText("Native gap")).not.toBeNull();
    expect(screen.getByText("Context gap")).not.toBeNull();
    expect(screen.getByText(/zero scanner, sizing, execution, or manager-decision authority/i)).not.toBeNull();
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
    expect(screen.getByText(/Session compatibility is unknown and is not certified/i)).not.toBeNull();
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
    expect(screen.getByText(/supported signed differences should be zero/i)).not.toBeNull();
  });
});
