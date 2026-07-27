import type {
  MarketWeatherComparisonCoordinate,
  MarketWeatherComparisonResponse,
} from "../types/marketWeather";

export type MarketWeatherPairGapBasis = "context" | "native";
export type MarketWeatherPairSeparation =
  | "widening"
  | "narrowing"
  | "no_clear_change"
  | "unavailable";

export interface MarketWeatherPairNotableGap {
  id: string;
  label: string;
  basis: MarketWeatherPairGapBasis;
  value: number;
  higherSymbol: string | null;
}

export interface MarketWeatherPairSummary {
  title: string;
  asOf: string | null;
  relativeIndex: number | null;
  relativeProgressPct: number | null;
  betaAdjustedChainPct: number | null;
  beta: number | null;
  betaLookbackBars: number | null;
  betaPriorObservations: number | null;
  betaChainStart: string | null;
  betaChainStartDerived: boolean;
  notableGapBasis: MarketWeatherPairGapBasis | null;
  notableGaps: MarketWeatherPairNotableGap[];
  separation: MarketWeatherPairSeparation;
  separationLabel: string;
  separationLatest: number | null;
  separationPrevious: number | null;
  separationTolerance: number | null;
  separationLookbackBars: number | null;
  supportedCoordinateCount: number;
  totalCoordinateCount: number;
  supportedCoordinateCells: number | null;
  totalCoordinateCells: number | null;
  supportFraction: number | null;
  sessionCompatibility: "compatible" | "incompatible" | "unknown";
  sessionCompatibilityIndependentlyCertified: boolean;
  alignmentSupported: boolean;
  summarySource: "server" | "legacy_fallback";
  relativeProgressSentence: string;
  betaAdjustedSentence: string;
  coordinateGapSentence: string;
  separationSentence: string;
  supportCaveat: string;
  methodologyBoundary: string;
  narrative: string;
  copyText: string;
}

const METHODOLOGY_BOUNDARY =
  "This is a descriptive comparison, not a forecast, ranking, or trade signal.";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedSymbol(value: string | null | undefined, fallback: string): string {
  const symbol = value?.trim();
  return symbol || fallback;
}

function formatValue(value: number, digits = 2): string {
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return rounded.toFixed(digits);
}

function formatSignedValue(value: number, digits = 2): string {
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

function formatSignedPercent(value: number): string {
  return `${formatSignedValue(value, 2)}%`;
}

function latestPricePoint(data: MarketWeatherComparisonResponse) {
  const series = data.price_series ?? [];
  return series.length ? series[series.length - 1] : null;
}

function resolveRelativeProgress(data: MarketWeatherComparisonResponse): {
  relativeIndex: number | null;
  relativeProgressPct: number | null;
} {
  const latest = latestPricePoint(data);
  const reportedProgress = data.relative_progress?.active_return_pct;
  const topLevelIndex = data.relative_progress?.relative_index;
  const reportedIndex = finite(topLevelIndex) ? topLevelIndex : latest?.relative_index;
  const relativeProgressPct = finite(reportedProgress)
    ? reportedProgress
    : finite(reportedIndex) ? reportedIndex - 100 : null;
  const relativeIndex = finite(reportedIndex)
    ? reportedIndex
    : finite(relativeProgressPct) ? 100 + relativeProgressPct : null;
  return { relativeIndex, relativeProgressPct };
}

function resolveBeta(data: MarketWeatherComparisonResponse): number | null {
  const reported = data.relative_progress?.beta;
  if (finite(reported)) return reported;
  const latest = latestPricePoint(data)?.prior_return_beta;
  return finite(latest) ? latest : null;
}

function resolveBetaChainStart(data: MarketWeatherComparisonResponse): {
  value: string | null;
  derived: boolean;
} {
  const authoritative = data.relative_progress?.beta_adjusted_chain_start_at;
  if (typeof authoritative === "string" && authoritative.trim()) {
    return { value: authoritative, derived: false };
  }
  if (authoritative === null) {
    return { value: null, derived: false };
  }

  const series = data.price_series ?? [];
  if (!series.length || !finite(series[series.length - 1].beta_adjusted_cumulative_return)) {
    return { value: null, derived: false };
  }

  let startIndex = series.length - 1;
  while (
    startIndex > 0
    && finite(series[startIndex - 1].beta_adjusted_cumulative_return)
  ) {
    startIndex -= 1;
  }
  return {
    value: series[startIndex].date || null,
    derived: Boolean(series[startIndex].date),
  };
}

function pairSupported(coordinate: MarketWeatherComparisonCoordinate): boolean {
  return coordinate.latest.target_supported
    && coordinate.latest.benchmark_supported
    && coordinate.latest.pair_supported !== false;
}

function coordinateLabel(coordinate: MarketWeatherComparisonCoordinate): string {
  const label = coordinate.label?.trim();
  if (label) return label;
  return coordinate.id.replace(/_/g, " ");
}

function gapValue(
  coordinate: MarketWeatherComparisonCoordinate,
  basis: MarketWeatherPairGapBasis,
): number | null {
  const value = basis === "context"
    ? coordinate.latest.context_difference
    : coordinate.latest.native_difference;
  return finite(value) ? value : null;
}

function collectNotableGaps(
  data: MarketWeatherComparisonResponse,
  targetSymbol: string,
  benchmarkSymbol: string,
  limit: number,
): {
  basis: MarketWeatherPairGapBasis | null;
  gaps: MarketWeatherPairNotableGap[];
} {
  const serverGaps = data.summary?.notable_context_gaps;
  if (Array.isArray(serverGaps) && serverGaps.length) {
    const gaps = serverGaps
      .filter((gap) => gap.pair_supported && finite(gap.context_difference))
      .slice(0, Math.max(0, limit))
      .map((gap) => ({
        id: gap.id,
        label: gap.label?.trim() || gap.id.replace(/_/g, " "),
        basis: "context" as const,
        value: gap.context_difference,
        higherSymbol: gap.direction === "target_higher"
          ? targetSymbol
          : gap.direction === "benchmark_higher" ? benchmarkSymbol : null,
      }));
    if (gaps.length) return { basis: "context", gaps };
  }

  const coordinates = data.coordinates ?? [];
  const supported = coordinates
    .map((coordinate, index) => ({ coordinate, index }))
    .filter(({ coordinate }) => pairSupported(coordinate));

  const context = supported.filter(({ coordinate }) => (
    finite(coordinate.latest.context_difference)
  ));
  const basis: MarketWeatherPairGapBasis | null = context.length
    ? "context"
    : supported.some(({ coordinate }) => finite(coordinate.latest.native_difference))
      ? "native"
      : null;
  if (!basis) return { basis: null, gaps: [] };

  const gaps = supported
    .map(({ coordinate, index }) => ({
      coordinate,
      index,
      value: gapValue(coordinate, basis),
    }))
    .filter((item): item is {
      coordinate: MarketWeatherComparisonCoordinate;
      index: number;
      value: number;
    } => finite(item.value))
    .sort((left, right) => (
      Math.abs(right.value) - Math.abs(left.value) || left.index - right.index
    ))
    .slice(0, Math.max(0, limit))
    .map(({ coordinate, value }) => ({
      id: coordinate.id,
      label: coordinateLabel(coordinate),
      basis,
      value,
      higherSymbol: value > 0 ? targetSymbol : value < 0 ? benchmarkSymbol : null,
    }));

  return { basis, gaps };
}

function resolveSeparation(
  value: string | null | undefined,
  data: MarketWeatherComparisonResponse,
): {
  status: MarketWeatherPairSeparation;
  label: string;
  sentence: string;
  latest: number | null;
  previous: number | null;
  tolerance: number | null;
  lookback: number | null;
} {
  const exact = data.relative_progress?.field_separation;
  const latest = finite(exact?.latest_stretch) ? exact.latest_stretch : null;
  const previous = finite(exact?.prior_stretch) ? exact.prior_stretch : null;
  const tolerance = finite(exact?.tolerance) ? exact.tolerance : null;
  const lookback = finite(exact?.lookback_shared_observations)
    ? Math.max(0, Math.trunc(exact.lookback_shared_observations))
    : null;
  const values = latest !== null && previous !== null && tolerance !== null
    ? `: ${formatValue(latest)} now versus ${formatValue(previous)} ${lookback ?? 5} shared bars earlier (classification tolerance ${formatValue(tolerance)})`
    : "";
  if (value === "widening") {
    return {
      status: "widening",
      label: "Field separation widening",
      sentence: values
        ? `Field separation widening${values}.`
        : "Own-history-relative field separation is widening versus five shared bars earlier.",
      latest,
      previous,
      tolerance,
      lookback,
    };
  }
  if (value === "converging") {
    return {
      status: "narrowing",
      label: "Field separation narrowing",
      sentence: values
        ? `Field separation narrowing${values}.`
        : "Own-history-relative field separation is narrowing versus five shared bars earlier.",
      latest,
      previous,
      tolerance,
      lookback,
    };
  }
  if (value === "mixed") {
    return {
      status: "no_clear_change",
      label: "No clear net change",
      sentence: values
        ? `No clear net change${values}.`
        : "Own-history-relative field separation has no clear net change versus five shared bars earlier.",
      latest,
      previous,
      tolerance,
      lookback,
    };
  }
  return {
    status: "unavailable",
    label: "Insufficient shared support",
    sentence: "Own-history-relative field separation could not be classified from the shared support.",
    latest,
    previous,
    tolerance,
    lookback,
  };
}

function resolveSessionCompatibility(
  data: MarketWeatherComparisonResponse,
): "compatible" | "incompatible" | "unknown" {
  const contract = data.compatibility?.session.status;
  if (contract === "compatible" || contract === "incompatible" || contract === "unknown") {
    return contract;
  }
  const explicit = data.overlap?.session_compatibility;
  if (explicit === "compatible" || explicit === "incompatible" || explicit === "unknown") {
    return explicit;
  }
  if (data.overlap?.session_compatible === true) return "compatible";
  if (data.overlap?.session_compatible === false) return "incompatible";
  return "unknown";
}

function formatCoordinateGapSentence(
  basis: MarketWeatherPairGapBasis | null,
  gaps: MarketWeatherPairNotableGap[],
  targetSymbol: string,
  benchmarkSymbol: string,
): string {
  if (!basis || !gaps.length) {
    return "No finite, bilaterally supported current coordinate gaps are available.";
  }

  const basisLabel = basis === "context"
    ? "relative-to-own-history"
    : "direct-model-scale";
  const rendered = gaps.map((gap) => {
    const direction = gap.higherSymbol
      ? `${gap.higherSymbol} higher`
      : `${targetSymbol} and ${benchmarkSymbol} equal`;
    return `${gap.label} (${formatSignedValue(gap.value)}; ${direction})`;
  });
  return `On a ${basisLabel} basis, the largest current supported coordinate gaps are ${rendered.join(", ")}. Higher means more of the measured coordinate, not better expected performance.`;
}

function formatSupportCaveat(
  data: MarketWeatherComparisonResponse,
  supportedCoordinateCount: number,
  totalCoordinateCount: number,
  sessionCompatibility: "compatible" | "incompatible" | "unknown",
  alignmentSupported: boolean,
): string {
  const clauses: string[] = [];
  if (!alignmentSupported) {
    clauses.push("alignment is marked unsupported, so the pair relationship should not be interpreted");
  }

  if (totalCoordinateCount > 0) {
    clauses.push(
      supportedCoordinateCount === totalCoordinateCount
        ? `all ${totalCoordinateCount} coordinates have bilateral current support`
        : `${supportedCoordinateCount} of ${totalCoordinateCount} coordinates have bilateral current support`,
    );
  } else {
    clauses.push("current coordinate support is unavailable");
  }

  const observations = data.window?.returned_exact_shared_observations
    ?? data.overlap?.common_observations;
  const supportFraction = data.support?.support_fraction
    ?? data.overlap?.support_fraction;
  if (finite(observations)) {
    const support = finite(supportFraction)
      ? ` with ${formatValue(Math.max(0, Math.min(1, supportFraction)) * 100, 0)}% shared support`
      : "";
    clauses.push(`the response reports ${Math.max(0, Math.trunc(observations)).toLocaleString("en-US")} shared ${data.timeframe} bars${support}`);
  }

  if (sessionCompatibility === "compatible") {
    clauses.push("sessions are marked compatible by the response contract, but this summary does not independently certify exchange-session equivalence");
  } else if (sessionCompatibility === "incompatible") {
    clauses.push("sessions are marked incompatible");
  } else {
    clauses.push("session compatibility has not been independently certified");
  }

  return `Data note: ${clauses.join("; ")}.`;
}

function serverSentence(
  data: MarketWeatherComparisonResponse,
  id: string,
): string | null {
  const sentence = data.summary?.sentences?.find((row) => row.id === id)?.text?.trim();
  return sentence || null;
}

export function buildMarketWeatherPairSummary(
  data: MarketWeatherComparisonResponse,
  notableGapLimit = 3,
): MarketWeatherPairSummary {
  const targetSymbol = normalizedSymbol(data.target?.symbol, "Target");
  const benchmarkSymbol = normalizedSymbol(data.benchmark?.symbol, "Benchmark");
  const serverTitle = data.summary?.title?.trim();
  const title = serverTitle || `${targetSymbol} compared with ${benchmarkSymbol}`;
  const alignmentSupported = data.overlap?.alignment_supported !== false
    && data.overlap?.alignment_status !== "unsupported"
    && data.compatibility?.timestamp_alignment.status !== "unsupported";
  const { relativeIndex, relativeProgressPct } = resolveRelativeProgress(data);
  const latest = latestPricePoint(data);
  const betaAdjustedChainPct = finite(data.relative_progress?.beta_adjusted_return_pct)
    ? data.relative_progress.beta_adjusted_return_pct
    : finite(latest?.beta_adjusted_cumulative_return)
      ? latest.beta_adjusted_cumulative_return
      : null;
  const beta = resolveBeta(data);
  const lookback = data.relative_progress?.beta_configured_lookback_returns
    ?? data.relative_progress?.lookback_bars;
  const betaLookbackBars = finite(lookback) && lookback > 0
    ? Math.trunc(lookback)
    : null;
  const priorObservations = data.relative_progress?.beta_prior_observations;
  const betaPriorObservations = finite(priorObservations) && priorObservations >= 0
    ? Math.trunc(priorObservations)
    : null;
  const chainStart = betaAdjustedChainPct === null
    ? { value: null, derived: false }
    : resolveBetaChainStart(data);
  const betaChainStart = chainStart.value;
  const notable = collectNotableGaps(
    data,
    targetSymbol,
    benchmarkSymbol,
    notableGapLimit,
  );
  const separation = resolveSeparation(
    data.relative_progress?.field_separation?.direction
      ?? data.relative_progress?.gap_direction,
    data,
  );
  const coordinates = data.coordinates ?? [];
  const supportedCoordinateCount = coordinates.filter(pairSupported).length;
  const sessionCompatibility = resolveSessionCompatibility(data);

  const fallbackRelativeProgressSentence = !alignmentSupported
    ? "Relative-price progress is not summarized because the response marks this alignment unsupported."
    : relativeIndex !== null && relativeProgressPct !== null
      ? `${targetSymbol}'s relative index versus ${benchmarkSymbol} is ${formatValue(relativeIndex)}; 100 marks equal progress from the shared-window start, and observed relative-price progress is ${formatSignedPercent(relativeProgressPct)}.`
      : relativeIndex !== null
        ? `${targetSymbol}'s relative index versus ${benchmarkSymbol} is ${formatValue(relativeIndex)}; 100 marks equal progress from the shared-window start.`
        : relativeProgressPct !== null
          ? `${targetSymbol}'s observed relative-price progress versus ${benchmarkSymbol} is ${formatSignedPercent(relativeProgressPct)} from the shared-window start.`
          : "Relative-price progress is unavailable in this response.";
  const relativeProgressSentence = alignmentSupported
    ? serverSentence(data, "relative_progress") ?? fallbackRelativeProgressSentence
    : fallbackRelativeProgressSentence;

  const betaDetails = [
    beta !== null ? `using prior-only β ${formatValue(beta)}` : "with the current beta estimate unavailable",
    betaPriorObservations !== null
      ? `estimated from ${betaPriorObservations} strictly prior shared returns`
      : betaLookbackBars !== null
      ? `configured from up to ${betaLookbackBars} strictly prior shared returns`
      : null,
    betaChainStart ? `the visible contiguous chain begins ${betaChainStart}` : null,
  ].filter((value): value is string => Boolean(value));
  const fallbackBetaAdjustedSentence = !alignmentSupported
    ? "The beta-adjusted chain is not summarized while alignment is unsupported."
    : betaAdjustedChainPct !== null
      ? `The current contiguous prior-only beta-adjusted return chain is ${formatSignedPercent(betaAdjustedChainPct)}, ${betaDetails.join("; ")}.`
      : "A current prior-only beta-adjusted return chain is unavailable in this response.";
  const betaAdjustedSentence = alignmentSupported
    ? serverSentence(data, "beta_adjusted_chain") ?? fallbackBetaAdjustedSentence
    : fallbackBetaAdjustedSentence;

  const fallbackCoordinateGapSentence = alignmentSupported
    ? formatCoordinateGapSentence(
      notable.basis,
      notable.gaps,
      targetSymbol,
      benchmarkSymbol,
    )
    : "Current coordinate gaps are not summarized while alignment is unsupported.";
  const coordinateGapSentence = alignmentSupported
    ? serverSentence(data, "coordinate_gaps") ?? fallbackCoordinateGapSentence
    : fallbackCoordinateGapSentence;
  const fallbackSeparationSentence = alignmentSupported
    ? separation.sentence
    : "Own-history-relative field separation is unavailable while alignment is unsupported.";
  const separationSentence = alignmentSupported
    ? serverSentence(data, "field_separation") ?? fallbackSeparationSentence
    : fallbackSeparationSentence;
  const fallbackSupportCaveat = formatSupportCaveat(
    data,
    supportedCoordinateCount,
    coordinates.length,
    sessionCompatibility,
    alignmentSupported,
  );
  const supportCaveat = alignmentSupported
    ? serverSentence(data, "data_support") ?? fallbackSupportCaveat
    : fallbackSupportCaveat;
  const asOf = data.summary?.observed_through
    ?? data.overlap?.latest_aligned_at
    ?? data.overlap?.end
    ?? null;
  const asOfSentence = asOf ? `As of the latest aligned observation at ${asOf}.` : null;
  const fallbackNarrative = [
    relativeProgressSentence,
    betaAdjustedSentence,
    coordinateGapSentence,
    separationSentence,
    supportCaveat,
  ].filter((value): value is string => Boolean(value)).join(" ");
  const serverNarrative = alignmentSupported ? data.summary?.text?.trim() : null;
  const summarySource = serverNarrative ? "server" : "legacy_fallback";
  const narrativeBody = serverNarrative || fallbackNarrative;
  const narrative = `${narrativeBody} ${asOfSentence ?? ""} ${METHODOLOGY_BOUNDARY}`
    .replace(/\s+/g, " ")
    .trim();
  const copyText = [
    title,
    narrative,
    data.generated_at ? `Pair calculation generated at ${data.generated_at}.` : null,
  ].filter((value): value is string => Boolean(value)).join("\n\n");

  return {
    title,
    asOf,
    relativeIndex,
    relativeProgressPct,
    betaAdjustedChainPct,
    beta,
    betaLookbackBars,
    betaPriorObservations,
    betaChainStart,
    betaChainStartDerived: chainStart.derived,
    notableGapBasis: notable.basis,
    notableGaps: notable.gaps,
    separation: alignmentSupported ? separation.status : "unavailable",
    separationLabel: alignmentSupported
      ? separation.label
      : "Insufficient shared support",
    separationLatest: separation.latest,
    separationPrevious: separation.previous,
    separationTolerance: separation.tolerance,
    separationLookbackBars: separation.lookback,
    supportedCoordinateCount,
    totalCoordinateCount: coordinates.length,
    supportedCoordinateCells: finite(data.support?.supported_coordinate_cells)
      ? data.support.supported_coordinate_cells
      : null,
    totalCoordinateCells: finite(data.support?.total_coordinate_cells)
      ? data.support.total_coordinate_cells
      : null,
    supportFraction: finite(data.support?.support_fraction)
      ? data.support.support_fraction
      : finite(data.overlap?.support_fraction) ? data.overlap.support_fraction : null,
    sessionCompatibility,
    sessionCompatibilityIndependentlyCertified:
      data.compatibility?.session.independently_certified
      ?? data.overlap?.session_compatibility_independently_certified
      ?? false,
    alignmentSupported,
    summarySource,
    relativeProgressSentence,
    betaAdjustedSentence,
    coordinateGapSentence,
    separationSentence,
    supportCaveat,
    methodologyBoundary: METHODOLOGY_BOUNDARY,
    narrative,
    copyText,
  };
}
