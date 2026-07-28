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
  window.history.replaceState({}, "", "/");
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
    expect(screen.getByRole("heading", { name: "NVDA vs QQQ" })).not.toBeNull();
    expect(screen.getByText("Relative market-path comparison")).not.toBeNull();
    expect(screen.getByText("NVDA ahead of QQQ")).not.toBeNull();
    expect(screen.getByText("After beta adjustment")).not.toBeNull();
    expect(screen.getByText("Field relationship")).not.toBeNull();
    expect(screen.getAllByText("98% field coverage · 14/15 current").length).toBeGreaterThan(0);
    expect(screen.getByText("Relative progress")).not.toBeNull();
    expect(screen.getByText("What is different now?")).not.toBeNull();
    expect(screen.getByText(/Descriptive comparison only/i)).not.toBeNull();
    expect(screen.queryByText("1,764 / 1,800")).toBeNull();
    expect(screen.queryByText("14 / 15")).toBeNull();
    expect(screen.queryByText("Relationship scopes")).toBeNull();
    expect(screen.queryByText("Identity and authority")).toBeNull();
    expect(screen.queryByText("Native units")).toBeNull();
    expect(screen.queryByText("State separation through time")).toBeNull();
    expect(screen.queryByText(/^Mixed$/i)).toBeNull();
    expect(screen.queryByText(/beta residual/i)).toBeNull();
    expect(screen.queryByText(/leads/i)).toBeNull();
  });

  it("moves focus to the destination tab when an Overview drilldown changes panels", () => {
    const onDimensionChange = vi.fn();
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={onDimensionChange}
      />,
    );

    const coverage = screen.getByRole("button", { name: /field coverage/i });
    coverage.focus();
    fireEvent.click(coverage);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Audit receipt" }));

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    const contextSection = screen.getByRole("heading", { name: "What is different now?" }).closest("section");
    expect(contextSection).not.toBeNull();
    const firstGap = within(contextSection as HTMLElement).getAllByRole("button")[0];
    firstGap.focus();
    fireEvent.click(firstGap);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Field detail" }));
    expect(onDimensionChange).toHaveBeenCalledTimes(1);
  });

  it("exposes linkable field controls, one scope at a time, and progressively discloses all 15 coordinates", () => {
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
    expect(document.querySelectorAll('svg[aria-label*="trajectory"]').length).toBe(1);
    const higherMotion = screen.getByRole("button", { name: "Higher motion" });
    expect(higherMotion.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(higherMotion);
    expect(higherMotion.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("img", { name: /Directional phase trajectory/i })).toBeNull();
    expect(screen.getByRole("img", { name: /Higher motion trajectory/i })).not.toBeNull();
    expect(screen.getAllByText(/Is pressure change accelerating/i).length).toBeGreaterThan(0);
    const coordinateHistory = screen.getAllByRole("img", { name: /Pressure comparison history/i })[0];
    coordinateHistory.focus();
    fireEvent.keyDown(coordinateHistory, { key: "Home" });
    expect(screen.getAllByText(/2026-07-23 · gap/i).length).toBeGreaterThan(0);

    const showAll = screen.getByRole("button", { name: "Show all 15 coordinates" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll("#pair-coordinate-explorer-list button[aria-pressed]").length).toBe(3);
    expect(screen.getByText("Largest own-history differences")).not.toBeNull();
    expect(screen.queryByText("Activity and liquidity")).toBeNull();
    fireEvent.click(showAll);
    expect(showAll.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll("#pair-coordinate-explorer-list button[aria-pressed]").length).toBe(15);
    expect(screen.getByText("Motion")).not.toBeNull();
    expect(screen.getByText("Field structure")).not.toBeNull();
    expect(screen.getByText("Activity and liquidity")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Direct model-scale gap" }));
    const displayedSeries = screen.getByRole("group", { name: "Displayed series" });
    fireEvent.click(within(displayedSeries).getByRole("button", { name: "NVDA" }));
    fireEvent.click(screen.getByRole("button", { name: /velocity/i }));
    expect(onBasisChange).toHaveBeenCalledWith("native");
    expect(onViewChange).toHaveBeenCalledWith("target");
    expect(onDimensionChange).toHaveBeenCalledWith("velocity");
    expect(screen.getAllByRole("group", { name: "Scope trail length" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("group", { name: "Scope scale" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(15);
    expect(screen.getByText(/Bounded signed multihorizon directional pressure/i)).not.toBeNull();
    const collapse = screen.getByRole("button", { name: "Show top 3" });
    collapse.focus();
    fireEvent.click(collapse);
    expect(collapse).toBe(document.activeElement);
    expect(document.querySelectorAll("#pair-coordinate-explorer-list button[aria-pressed]").length).toBe(3);
  });

  it("keeps a deep-linked selected coordinate inspectable before the top-three list is expanded", () => {
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="scaling_exponent"
        tab="field"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    const fieldPanel = screen.getByRole("tabpanel", { name: "Field detail" });
    expect(within(fieldPanel).getByRole("button", { name: /Inspect scaling exponent/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /scaling exponent; relative-to-own-history/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 15 coordinates" }));
    expect(screen.getByRole("button", { name: /scaling exponent; relative-to-own-history/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves chronology, hashes, nominal closes, cache detail, and zero authority into collapsed Audit groups", () => {
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
    expect(screen.getByRole("button", { name: "Export compact receipt · JSON" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Compact receipt unavailable/i)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Data alignment" }).closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByRole("heading", { name: "Field support" }).closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("NVDA aligned close")).not.toBeNull();
    fireEvent.click(screen.getByRole("heading", { name: "Identity and authority" }));
    expect(screen.getByText(/Scanner weight 0%/i)).not.toBeNull();
    fireEvent.click(screen.getByRole("heading", { name: "Methodology" }));
    expect(screen.getByText("Relative index")).not.toBeNull();
    expect(screen.getByText("Direct model-scale gap")).not.toBeNull();
    expect(screen.getByText("Relative to own history")).not.toBeNull();
    expect(screen.getByText("Generated")).not.toBeNull();
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
    expect(screen.getAllByText(/Session equivalence unverified/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Alignment unsupported")).not.toBeNull();
    expect(screen.queryByText("Exact date alignment")).toBeNull();
    expect(screen.getByText(/No nearest timestamp or carried value was substituted/i)).not.toBeNull();
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

  it("copies quick and full summaries plus an Overview-forced rerunnable link from Audit", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Copy quick summary" }));
    expect(String(writeText.mock.calls[0][0]).split(/\s+/).length).toBeLessThan(80);
    expect(String(writeText.mock.calls[0][0])).toContain("Descriptive comparison only");

    fireEvent.click(screen.getByRole("button", { name: "Copy full research summary" }));
    expect(String(writeText.mock.calls[1][0])).toContain("NVDA compared with QQQ");
    expect(String(writeText.mock.calls[1][0])).toContain("not a forecast, ranking, or trade signal");

    window.history.replaceState({}, "", "/market-weather?comparison=pair&pair_tab=audit&compare=QQQ");
    fireEvent.click(screen.getByRole("button", { name: "Copy overview link" }));
    const link = new URL(String(writeText.mock.calls[2][0]));
    expect(link.searchParams.get("pair_tab")).toBe("overview");
    expect(link.searchParams.get("comparison")).toBe("pair");

    fireEvent.click(screen.getByRole("button", { name: "Copy current page link" }));
    const currentLink = new URL(String(writeText.mock.calls[3][0]));
    expect(currentLink.searchParams.get("pair_tab")).toBe("audit");
    expect(screen.getByText(/Local chart-lane, scope-card, and coordinate-expansion toggles reset/i)).not.toBeNull();
  });

  it("fades scope trails by chronology, preserves support gaps, and uses unique SVG definitions", () => {
    const dates = Array.from({ length: 10 }, (_value, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
    const loopingValues = [-0.72, 0.66, -0.48, 0.58, -0.32, 0.44, 0.22, -0.18, 0.31, 0.12];
    const coordinates = DATA.coordinates.map((coordinate) => {
      const series = dates.map((date, index) => {
        const value = loopingValues[index];
        const supported = index !== 4;
        return {
          date,
          target: value,
          benchmark: 0,
          target_context: value,
          benchmark_context: 0,
          native_difference: value,
          context_difference: value,
          target_supported: supported,
          benchmark_supported: supported,
          pair_supported: supported,
        };
      });
      return {
        ...coordinate,
        latest: {
          ...series[series.length - 1],
          target_supported: true,
          benchmark_supported: true,
          pair_supported: true,
        },
        series,
      };
    });

    render(
      <MarketWeatherComparisonLab
        data={{ ...DATA, coordinates }}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        scopeTrail="full"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    const scope = screen.getAllByRole("img", { name: /Directional phase trajectory/i })[0] as unknown as SVGSVGElement;
    expect(scope.querySelector("linearGradient")).toBeNull();
    const segments = [...scope.querySelectorAll<SVGPathElement>('[data-scope-trail-segment="true"]')];
    expect(segments.length).toBeGreaterThan(4);
    const opacities = segments.map((segment) => Number(segment.dataset.ageOpacity));
    const sourceEnds = segments.map((segment) => Number(segment.dataset.sourceEnd));
    for (let index = 1; index < opacities.length; index += 1) {
      expect(opacities[index]).toBeGreaterThan(opacities[index - 1]);
      expect(sourceEnds[index]).toBeGreaterThan(sourceEnds[index - 1]);
    }
    expect(sourceEnds.some((value, index) => index > 0 && value - sourceEnds[index - 1] > 1)).toBe(true);

    const definitionIds = [...document.querySelectorAll<SVGElement>('svg[aria-label*="trajectory"] [id]')]
      .map((element) => element.id);
    expect(new Set(definitionIds).size).toBe(definitionIds.length);

    const directionArticle = scope.closest("article");
    expect(directionArticle?.textContent).toContain("fit-spread units more elevated");
    const visibleReading = directionArticle?.querySelector<HTMLElement>('[data-scope-reading="true"]');
    expect(visibleReading?.textContent).toContain("fit-spread units more elevated");
    expect(visibleReading?.classList.contains("sr-only")).toBe(false);
    expect(directionArticle?.textContent).not.toMatch(/\bbullish\b|\bbearish\b|\boutperform\b|\btrade signal\b/i);
    expect(
      (directionArticle?.querySelector<HTMLElement>('[data-scope-age-key="true"]')?.style.backgroundImage ?? "").toLowerCase(),
    ).toContain("#fbbf24");
  });

  it("keeps scope endpoints chronological across leading, trailing, and singleton support runs", () => {
    const dates = Array.from({ length: 5 }, (_value, index) => `2026-07-${String(index + 20).padStart(2, "0")}`);
    const withSupport = (support: boolean[]): MarketWeatherComparisonResponse => ({
      ...DATA,
      coordinates: DATA.coordinates.map((coordinate) => {
        const series = dates.map((date, index) => {
          const value = 0.1 + index * 0.05;
          return {
            date,
            target: value,
            benchmark: 0,
            target_context: value,
            benchmark_context: 0,
            native_difference: value,
            context_difference: value,
            target_supported: support[index],
            benchmark_supported: support[index],
            pair_supported: support[index],
          };
        });
        return { ...coordinate, latest: series[series.length - 1], series };
      }),
    });
    const props = {
      basis: "context" as const,
      view: "difference" as const,
      selectedDimension: "pressure",
      scopeTrail: "full" as const,
      onBasisChange: vi.fn(),
      onViewChange: vi.fn(),
      onDimensionChange: vi.fn(),
    };
    const { rerender } = render(
      <MarketWeatherComparisonLab data={withSupport([false, true, true, false, true])} {...props} />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    let scope = screen.getByRole("img", { name: /Directional phase trajectory/i }) as unknown as SVGSVGElement;
    expect(scope.textContent).toContain("FIRST SUPPORTED");
    expect(scope.textContent).toContain("NOW");
    expect(scope.querySelectorAll("path[marker-end]").length).toBe(0);

    rerender(<MarketWeatherComparisonLab data={withSupport([false, true, true, true, false])} {...props} />);
    scope = screen.getByRole("img", { name: /Directional phase trajectory/i }) as unknown as SVGSVGElement;
    expect(scope.textContent).toContain("LATEST SUPPORTED");
    expect(scope.textContent).not.toMatch(/\bNOW\b/);
    expect(scope.querySelectorAll("path[marker-end]").length).toBe(1);
  });

  it("uses a compact undistorted scope frame and readable precision for tiny values", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const tinyCoordinates = DATA.coordinates.map((coordinate) => {
      const series = coordinate.series.map((point, index) => {
        const value = (index + 1) * 2.5e-6;
        return {
          ...point,
          target: value,
          benchmark: 0,
          target_context: value,
          benchmark_context: 0,
          native_difference: value,
          context_difference: value,
        };
      });
      const latest = series[series.length - 1];
      return {
        ...coordinate,
        latest: {
          ...coordinate.latest,
          ...latest,
          target_supported: latest.target_supported !== false,
          benchmark_supported: latest.benchmark_supported !== false,
        },
        series,
      };
    });
    render(
      <MarketWeatherComparisonLab
        data={{ ...DATA, coordinates: tinyCoordinates }}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    const scope = screen.getByRole("img", { name: /Directional phase trajectory/i }) as unknown as SVGSVGElement;
    expect(scope.getAttribute("viewBox")).toBe("0 0 360 236");
    expect(scope.dataset.scopeFrame).toBe("compact");
    expect(scope.getAttribute("style")).toContain("aspect-ratio: 360 / 236");
    expect(scope.textContent).toMatch(/e-\d+/i);
  });

  it("gates pair gaps and changes on support while identifying stale series endpoints", () => {
    const dates = Array.from({ length: 6 }, (_value, index) => `2026-07-${String(index + 18).padStart(2, "0")}`);
    const coordinates = DATA.coordinates.map((coordinate) => {
      const series = dates.map((date, index) => ({
        date,
        target: 0.2 + index * 0.04,
        benchmark: 0.1 + index * 0.02,
        target_context: 0.3 + index * 0.04,
        benchmark_context: 0.1 + index * 0.02,
        native_difference: 0.1 + index * 0.02,
        context_difference: 0.2 + index * 0.02,
        target_supported: true,
        benchmark_supported: true,
        pair_supported: index !== dates.length - 1,
      }));
      return { ...coordinate, latest: series[series.length - 1], series };
    });
    render(
      <MarketWeatherComparisonLab
        data={{ ...DATA, coordinates }}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    const chart = screen.getByRole("img", { name: /pressure comparison history/i }) as unknown as SVGSVGElement;
    expect(chart.getAttribute("aria-label")).toContain("target-minus-benchmark gap —");
    expect(chart.getAttribute("aria-label")).toContain("current selected-basis value limited");
    expect(chart.getAttribute("aria-label")).toContain("bilateral pair gap is unavailable");
    const trend = chart.closest("div");
    expect(trend).not.toBeNull();
    expect(within(trend as HTMLElement).getByText("pair gap unavailable · hatched")).not.toBeNull();
    expect(within(trend as HTMLElement).getByText(/Outlined endpoints mark latest supported values: gap through 2026-07-22/i)).not.toBeNull();
    expect(chart.querySelector('[data-series-endpoint="target"]')?.getAttribute("data-endpoint-status")).toBe("current");
    expect(chart.querySelector('[data-series-endpoint="difference"]')?.getAttribute("data-endpoint-status")).toBe("latest-supported");
    const gapCard = within(trend as HTMLElement).getByText("Own-history gap").parentElement;
    expect(gapCard?.textContent).toContain("—");
    const fiveBarEvidence = within(trend as HTMLElement).getByText("Five-bar change").parentElement;
    expect(fiveBarEvidence?.textContent).toContain("—");
  });

  it("classifies only direct single-subject motion and keeps missing marker evidence unavailable", () => {
    const dataWithMissingMarker: MarketWeatherComparisonResponse = {
      ...DATA,
      coordinates: DATA.coordinates.map((coordinate) => {
        if (coordinate.id !== "liquidity_stress_carrier") return coordinate;
        return {
          ...coordinate,
          latest: { ...coordinate.latest, target_supported: false },
          series: coordinate.series.map((point, index) => (
            index === coordinate.series.length - 1 ? { ...point, target_supported: false } : point
          )),
        };
      }),
    };
    render(
      <MarketWeatherComparisonLab
        data={dataWithMissingMarker}
        basis="native"
        view="target"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Field detail" }));
    expect(screen.getAllByText(/positive pressure that is strengthening/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Propagation & carriers" }));
    const propagation = screen.getByRole("img", { name: /Propagation & carriers trajectory/i });
    expect(propagation.closest("article")?.textContent).toContain("(unavailable)");
    expect(propagation.getAttribute("aria-label")).toContain("third coordinate used for marker size —");
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
    fireEvent.keyDown(scope, { key: "Home" });
    expect(screen.getByText(/Hover, touch, or use arrow keys/i).textContent).toContain("(2026-07-23)");
    expect(screen.getAllByText("Inspected 2026-07-23").length).toBeGreaterThan(0);

    fireEvent.keyDown(scope, { key: "End" });
    expect(screen.getByText(/Hover, touch, or use arrow keys/i).textContent).toContain("(2026-07-24)");
    fireEvent.keyDown(scope, { key: "ArrowLeft" });
    expect(screen.getByText(/Hover, touch, or use arrow keys/i).textContent).toContain("(2026-07-23)");
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

    const chart = screen.getByRole("img", { name: /NVDA relative price versus QQQ/i }) as unknown as SVGSVGElement;
    Object.defineProperty(chart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 176,
        height: 176,
        left: 0,
        right: 700,
        top: 0,
        width: 700,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    chart.focus();
    fireEvent.keyDown(chart, { key: "Home" });
    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-23 · relative index") === true
      )),
    ).not.toBeNull();
    fireEvent.keyDown(chart, { key: "End" });
    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-24 · relative index") === true
      )),
    ).not.toBeNull();
    fireEvent(chart, new MouseEvent("pointermove", { bubbles: true, clientX: 180 }));

    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-23 · relative index") === true
      )),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Beta adjusted" }));
    expect(screen.getByRole("img", { name: /prior-only beta-adjusted chain/i })).not.toBeNull();
  });

  it("keeps unsupported beta rows unavailable and labels a trailing supported endpoint honestly", () => {
    render(
      <MarketWeatherComparisonLab
        data={{
          ...DATA,
          relative_progress: {
            ...DATA.relative_progress,
            beta_adjusted_return_pct: null,
          },
          price_series: [
            { date: "2026-07-22", target_close: 178, benchmark_close: 607, relative_index: 100, active_return: 0, prior_return_beta: null, beta_adjusted_cumulative_return: null },
            { date: "2026-07-23", target_close: 180, benchmark_close: 608, relative_index: 101, active_return: 1, prior_return_beta: 1.2, beta_adjusted_cumulative_return: 1.2 },
            { date: "2026-07-24", target_close: 184.25, benchmark_close: 611.4, relative_index: 102, active_return: 2, prior_return_beta: null, beta_adjusted_cumulative_return: null },
          ],
        }}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Beta adjusted" }));
    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-23 · adjusted chain") === true
        && element.textContent?.includes("+1.20%") === true
      )),
    ).not.toBeNull();
    expect(screen.getByText(/Supported through 2026-07-23 NVDA vs QQQ \+1.20% · current chain unavailable/i)).not.toBeNull();
    const chart = screen.getByRole("img", { name: /Latest supported through 2026-07-23 prior-only beta-adjusted chain/i }) as unknown as SVGSVGElement;
    Object.defineProperty(chart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 176,
        height: 176,
        left: 0,
        right: 700,
        top: 0,
        width: 700,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    fireEvent(chart, new MouseEvent("pointermove", { bubbles: true, clientX: 682 }));
    expect(
      screen.getByText((_content, element) => (
        element?.tagName === "SPAN"
        && element.textContent?.startsWith("2026-07-24 · adjusted chain") === true
        && element.textContent?.includes("—") === true
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
    const trigger = within(screen.getByRole("tabpanel", { name: "Field detail" }))
      .getByRole("button", { name: /Inspect pressure/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "pressure" })).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close coordinate detail" })).toBe(document.activeElement));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "pressure" })).toBeNull();
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });

  it("turns the mobile report into a guided research path without mounting hidden heavy charts", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const onDimensionChange = vi.fn();
    render(
      <MarketWeatherComparisonLab
        data={DATA}
        basis="context"
        view="difference"
        selectedDimension="pressure"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={onDimensionChange}
      />,
    );

    const researchRail = screen.getByRole("complementary", { name: "Research next" });
    expect(within(researchRail).getByText(/largest current field difference/i)).not.toBeNull();
    expect(screen.queryByRole("img", { name: /Pressure comparison history/i })).toBeNull();

    fireEvent.click(within(researchRail).getByRole("button", { name: /Inspect pressure/i }));
    expect(screen.getByRole("tab", { name: "Field detail" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Field detail" }));
    expect(onDimensionChange).toHaveBeenCalledWith("pressure");
    expect(screen.queryByRole("img", { name: /Pressure comparison history/i })).toBeNull();

    fireEvent.click(within(researchRail).getByRole("button", { name: /Inspect pressure/i }));
    expect(screen.getByRole("dialog", { name: "pressure" })).not.toBeNull();
    expect(screen.getByRole("img", { name: /Pressure comparison history/i })).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(researchRail).getByRole("button", { name: "Audit receipt" }));
    expect(screen.getByRole("tab", { name: "Audit receipt" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Audit receipt" }));
  });

  it("unlocks the mobile sheet if the viewport becomes desktop-sized", async () => {
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
        tab="field"
        onBasisChange={vi.fn()}
        onViewChange={vi.fn()}
        onDimensionChange={vi.fn()}
      />,
    );

    const fieldPanel = screen.getByRole("tabpanel", { name: "Field detail" });
    fireEvent.click(within(fieldPanel).getByRole("button", { name: /Inspect pressure/i }));
    expect(screen.getByRole("dialog", { name: "pressure" })).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "pressure" })).toBeNull());
    expect(document.body.style.overflow).toBe("");
    expect(fieldPanel.closest('[aria-hidden="true"]')).toBeNull();
  });
});
