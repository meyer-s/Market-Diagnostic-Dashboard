import { describe, expect, it } from "vitest";

import type {
  MarketWeatherComparisonCoordinate,
  MarketWeatherComparisonResponse,
} from "../../types/marketWeather";
import { buildMarketWeatherPairSummary } from "../marketWeatherPairSummary";

function coordinate(
  id: string,
  contextDifference: number | null,
  nativeDifference: number | null,
  supported = true,
): MarketWeatherComparisonCoordinate {
  return {
    id,
    label: id.replace(/_/g, " "),
    family: "pressure_state",
    latest: {
      target: 0.2,
      benchmark: 0.1,
      target_context: contextDifference === null ? null : contextDifference / 2,
      benchmark_context: contextDifference === null ? null : -contextDifference / 2,
      native_difference: nativeDifference,
      context_difference: contextDifference,
      target_supported: true,
      benchmark_supported: supported,
      pair_supported: supported,
    },
    series: [],
  };
}

const DATA: MarketWeatherComparisonResponse = {
  schema_version: "market_field_pair_v1",
  semantic_revision: "1.3",
  generated_at: "2026-07-27T15:30:00Z",
  target: {
    symbol: "ABT",
    analysis_hash: "a".repeat(64),
  },
  benchmark: {
    symbol: "RSP",
    analysis_hash: "b".repeat(64),
  },
  comparison_hash: "c".repeat(64),
  timeframe: "1D",
  overlap: {
    common_observations: 750,
    start: "2023-07-28",
    end: "2026-07-24",
    target_dropped: 0,
    benchmark_dropped: 0,
    latest_aligned_at: "2026-07-24",
    support_fraction: 1,
    session_compatibility: "unknown",
    alignment_supported: true,
    alignment_status: "supported",
    note: "Exact shared dates.",
  },
  relative_progress: {
    latest_target_close: 105.52,
    latest_benchmark_close: 214.55,
    active_return_pct: -27.17,
    beta_adjusted_return_pct: -6.76,
    beta: 0.71,
    beta_status: "available",
    lookback_bars: 60,
    gap_direction: "mixed",
  },
  coordinates: [
    coordinate("pressure", 0.1, -0.02),
    coordinate("velocity", 0.8, 0.13),
    coordinate("acceleration", -1.2, -0.24),
    coordinate("jerk", -0.9, -0.19),
    coordinate("snap", 9, 0.5, false),
  ],
  price_series: [
    {
      date: "2024-03-01",
      target_close: 101,
      benchmark_close: 201,
      relative_index: 78,
      active_return: -22,
      prior_return_beta: null,
      beta_adjusted_cumulative_return: null,
    },
    {
      date: "2024-03-04",
      target_close: 102,
      benchmark_close: 202,
      relative_index: 77,
      active_return: -23,
      prior_return_beta: 0.68,
      beta_adjusted_cumulative_return: -0.2,
    },
    {
      date: "2026-07-24",
      target_close: 105.52,
      benchmark_close: 214.55,
      relative_index: 72.83,
      active_return: -27.17,
      prior_return_beta: 0.71,
      beta_adjusted_cumulative_return: -6.76,
    },
  ],
  provenance: {
    target_analysis_hash: "a".repeat(64),
    benchmark_analysis_hash: "b".repeat(64),
    comparison_hash: "c".repeat(64),
    note: "Ordered pair.",
  },
  caveats: [],
};

describe("buildMarketWeatherPairSummary", () => {
  it("builds a deterministic, non-predictive first read from the current pair response", () => {
    const summary = buildMarketWeatherPairSummary(DATA);

    expect(summary.relativeIndex).toBe(72.83);
    expect(summary.relativeProgressSentence).toBe(
      "ABT's relative index versus RSP is 72.83; 100 marks equal progress from the shared-window start, and observed relative-price progress is -27.17%.",
    );
    expect(summary.betaAdjustedSentence).toBe(
      "The current contiguous prior-only beta-adjusted return chain is -6.76%, using prior-only β 0.71; configured from up to 60 strictly prior shared returns; the visible contiguous chain begins 2024-03-04.",
    );
    expect(summary.betaChainStart).toBe("2024-03-04");
    expect(summary.betaChainStartDerived).toBe(true);
    expect(summary.summarySource).toBe("legacy_fallback");
    expect(summary.separationLabel).toBe("No clear net change");
    expect(summary.separationSentence).toContain("no clear net change");
    expect(summary.supportCaveat).toContain(
      "session compatibility has not been independently certified",
    );
    expect(summary.narrative).toContain(
      "not a forecast, ranking, or trade signal",
    );
    expect(summary.copyText).toContain("Pair calculation generated at 2026-07-27T15:30:00Z.");
    expect(summary.narrative).not.toContain("residual");
    expect(summary.narrative).not.toContain("outperform");
  });

  it("prefers authoritative server summary, chain, separation, and support fields", () => {
    const serverText = [
      "SERVER relative progress.",
      "SERVER beta-adjusted chain.",
      "SERVER separation.",
      "SERVER coordinate gaps.",
      "SERVER data support.",
    ].join(" ");
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      window: {
        requested_shared_observations: 750,
        available_exact_shared_observations: 820,
        returned_exact_shared_observations: 750,
        target_available_observations: 900,
        benchmark_available_observations: 880,
        truncated_to_requested_window: true,
        start: "2023-07-28",
        end: "2026-07-24",
      },
      support: {
        supported_coordinate_cells: 11_200,
        total_coordinate_cells: 11_250,
        support_fraction: 11_200 / 11_250,
        all_returned_coordinate_cells_supported: false,
        support_rule: "bilateral_full_dependency_support",
        missing_values_carried: false,
      },
      compatibility: {
        session: {
          status: "unknown",
          independently_certified: false,
          basis: "not_independently_available",
        },
        currency: {
          status: "unknown",
          independently_certified: false,
        },
        price_adjustment: {
          status: "provider_as_returned",
          independently_certified: false,
        },
        timestamp_alignment: {
          status: "supported",
          rule: "serialized_session_date",
          timezone_metadata_available: true,
        },
      },
      summary: {
        schema_version: "pair_summary_v1",
        title: "ABT compared with authoritative RSP",
        observed_through: "2026-07-25",
        text: serverText,
        sentences: [
          { id: "relative_progress", text: "SERVER relative progress.", section: "price_progress" },
          { id: "beta_adjusted_chain", text: "SERVER beta-adjusted chain.", section: "price_progress" },
          { id: "field_separation", text: "SERVER separation.", section: "field_detail" },
          { id: "coordinate_gaps", text: "SERVER coordinate gaps.", section: "field_detail" },
          { id: "data_support", text: "SERVER data support.", section: "audit_receipt" },
        ],
        notable_context_gaps: [
          {
            id: "pressure",
            label: "Pressure",
            family: "pressure_state",
            target_context: 0.5,
            benchmark_context: -0.5,
            context_difference: 1,
            direction: "target_higher",
            pair_supported: true,
          },
        ],
        authority: "deterministic_descriptive_only",
      },
      relative_progress: {
        ...DATA.relative_progress,
        relative_index: 72.81,
        beta_configured_lookback_returns: 60,
        beta_prior_observations: 47,
        beta_adjusted_chain_start_at: "2025-01-03",
        field_separation: {
          direction: "mixed",
          label: "No clear net change",
          latest_stretch: 1.42,
          prior_stretch: 1.39,
          change: 0.03,
          tolerance: 0.0695,
          lookback_shared_observations: 5,
          compared_families: 3,
          compared_coordinates: 15,
        },
      },
    });

    expect(summary.title).toBe("ABT compared with authoritative RSP");
    expect(summary.summarySource).toBe("server");
    expect(summary.relativeIndex).toBe(72.81);
    expect(summary.relativeProgressSentence).toBe("SERVER relative progress.");
    expect(summary.betaAdjustedSentence).toBe("SERVER beta-adjusted chain.");
    expect(summary.betaPriorObservations).toBe(47);
    expect(summary.betaChainStart).toBe("2025-01-03");
    expect(summary.betaChainStartDerived).toBe(false);
    expect(summary.notableGaps).toEqual([
      {
        id: "pressure",
        label: "Pressure",
        basis: "context",
        value: 1,
        higherSymbol: "ABT",
      },
    ]);
    expect(summary.separationLatest).toBe(1.42);
    expect(summary.separationPrevious).toBe(1.39);
    expect(summary.separationTolerance).toBe(0.0695);
    expect(summary.separationLookbackBars).toBe(5);
    expect(summary.supportedCoordinateCells).toBe(11_200);
    expect(summary.totalCoordinateCells).toBe(11_250);
    expect(summary.supportCaveat).toBe("SERVER data support.");
    expect(summary.asOf).toBe("2026-07-25");
    expect(summary.narrative).toBe(
      `${serverText} As of the latest aligned observation at 2026-07-25. This is a descriptive comparison, not a forecast, ranking, or trade signal.`,
    );
  });

  it("ranks supported own-history gaps by magnitude with recipe order as the tie break", () => {
    const summary = buildMarketWeatherPairSummary(DATA);

    expect(summary.notableGapBasis).toBe("context");
    expect(summary.notableGaps.map(({ id }) => id)).toEqual([
      "acceleration",
      "jerk",
      "velocity",
    ]);
    expect(summary.coordinateGapSentence).toContain(
      "acceleration (-1.20; RSP higher), jerk (-0.90; RSP higher), velocity (+0.80; ABT higher)",
    );
    expect(summary.coordinateGapSentence).not.toContain("snap");

    const tied = buildMarketWeatherPairSummary({
      ...DATA,
      coordinates: [
        coordinate("pressure", 0.5, 0.1),
        coordinate("velocity", -0.5, -0.1),
      ],
    });
    expect(tied.notableGaps.map(({ id }) => id)).toEqual(["pressure", "velocity"]);
  });

  it("falls back to direct model-scale gaps only when no supported context gap exists", () => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      coordinates: [
        coordinate("pressure", null, 0.2),
        coordinate("velocity", null, -0.4),
      ],
    });

    expect(summary.notableGapBasis).toBe("native");
    expect(summary.notableGaps.map(({ id }) => id)).toEqual(["velocity", "pressure"]);
    expect(summary.coordinateGapSentence).toContain("On a direct-model-scale basis");
  });

  it("keeps the current beta chain unavailable when the latest row follows a reset", () => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      relative_progress: {
        ...DATA.relative_progress,
        beta_adjusted_return_pct: null,
        beta: null,
        beta_status: "unavailable",
      },
      price_series: [
        DATA.price_series[0],
        DATA.price_series[1],
        {
          ...DATA.price_series[2],
          prior_return_beta: null,
          beta_adjusted_cumulative_return: null,
        },
      ],
    });

    expect(summary.betaAdjustedChainPct).toBeNull();
    expect(summary.betaChainStart).toBeNull();
    expect(summary.betaChainStartDerived).toBe(false);
    expect(summary.betaAdjustedSentence).toBe(
      "A current prior-only beta-adjusted return chain is unavailable in this response.",
    );
  });

  it.each([
    ["widening", "Field separation widening", "is widening"],
    ["converging", "Field separation narrowing", "is narrowing"],
    ["mixed", "No clear net change", "has no clear net change"],
    ["unavailable", "Insufficient shared support", "could not be classified"],
    ["future_status", "Insufficient shared support", "could not be classified"],
  ])("maps %s without upgrading the label into an economic claim", (value, label, phrase) => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      relative_progress: {
        ...DATA.relative_progress,
        gap_direction: value,
      },
    });
    expect(summary.separationLabel).toBe(label);
    expect(summary.separationSentence).toContain(phrase);
  });

  it("handles absent optional evidence without emitting undefined or NaN", () => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      generated_at: undefined,
      overlap: {
        ...DATA.overlap,
        latest_aligned_at: null,
        end: null,
        session_compatibility: undefined,
        session_compatible: undefined,
        support_fraction: Number.NaN,
      },
      relative_progress: {
        ...DATA.relative_progress,
        active_return_pct: null,
        beta_adjusted_return_pct: null,
        beta: null,
        lookback_bars: Number.NaN,
        gap_direction: "unavailable",
      },
      coordinates: [],
      price_series: [],
    });

    expect(summary.asOf).toBeNull();
    expect(summary.relativeIndex).toBeNull();
    expect(summary.relativeProgressSentence).toContain("unavailable");
    expect(summary.betaAdjustedSentence).toContain("unavailable");
    expect(summary.coordinateGapSentence).toContain("No finite");
    expect(summary.supportCaveat).toContain("current coordinate support is unavailable");
    expect(summary.copyText).not.toMatch(/undefined|NaN/);
  });

  it("suppresses analytical interpretation when alignment is unsupported", () => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      overlap: {
        ...DATA.overlap,
        alignment_supported: false,
        alignment_status: "unsupported",
        session_compatibility: "incompatible",
      },
    });

    expect(summary.alignmentSupported).toBe(false);
    expect(summary.separation).toBe("unavailable");
    expect(summary.relativeProgressSentence).toContain("not summarized");
    expect(summary.betaAdjustedSentence).toContain("not summarized");
    expect(summary.coordinateGapSentence).toContain("not summarized");
    expect(summary.supportCaveat).toContain("alignment is marked unsupported");
    expect(summary.supportCaveat).toContain("sessions are marked incompatible");
  });

  it("supports the early Pair v1 session-compatibility alias conservatively", () => {
    const summary = buildMarketWeatherPairSummary({
      ...DATA,
      overlap: {
        ...DATA.overlap,
        session_compatibility: undefined,
        session_compatible: true,
      },
    });

    expect(summary.sessionCompatibility).toBe("compatible");
    expect(summary.supportCaveat).toContain(
      "this summary does not independently certify exchange-session equivalence",
    );
  });
});
