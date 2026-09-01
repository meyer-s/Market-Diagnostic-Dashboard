import {
  calendarLabel,
  clockTime,
  formatDate,
  formatPeriod,
  formatSigned,
  formatValue,
  primaryDeltaUnit,
} from "./format";
import { densifyMonthlyRows, monthlyIndex } from "./monthlyRows";
import type {
  BlsCalendarEntry,
  BlsLensResponse,
  BlsObservation,
  BlsSeries,
  PayrollRevision,
} from "./types";

export type BlsOverviewTarget = "releases" | "trends" | "revisions" | "calendar" | "methods";

export type OverviewObservationState =
  | "higher"
  | "lower"
  | "unchanged"
  | "prior_unavailable"
  | "unavailable";

export type OverviewIndicator = {
  role: string;
  series: BlsSeries;
  current: BlsObservation | null;
  prior: BlsObservation | null;
  delta: number | null;
  deltaUnit: string;
  state: OverviewObservationState;
  stateLabel: string;
  interpretation: string;
  trendState: "strengthening" | "cooling" | "faster" | "slower" | "stable" | "observations_only";
  trendStateLabel: string;
  trendDelta: number | null;
  trendAnchorPeriod: string | null;
  trendProvisional: boolean;
  materialityBand: number | null;
  materialityUnit: string | null;
  trendInterpretation: string;
  trendPoints: Array<{ period: string; value: number | null }>;
  plottablePointCount: number;
};

export type OverviewOverallState = {
  state: "strengthening" | "cooling" | "mixed" | "stable" | "observations_only";
  label: string;
  eligibleVotes: number;
  strengtheningVotes: number;
  coolingVotes: number;
  stableVotes: number;
  provisional: boolean;
  explanation: string;
};

export type OverviewRevisionSummary = {
  latestPeriod: string | null;
  latestDelta: number | null;
  latestStage: "second_estimate" | "third_estimate" | null;
  latestStageLabel: "Second estimate" | "Third estimate" | "Revision stage unavailable";
  latestDirection: "upward" | "downward" | "unchanged" | "unavailable";
  latestStateLabel: string;
  netThreeMonth: number | null;
  netMonthCount: number;
  streakDirection: "upward" | "downward" | "none";
  streakCount: number;
  unit: string;
};

export type OverviewScheduledRelease = {
  entry: BlsCalendarEntry;
  label: string;
  description: string;
  calendarHref: string | null;
};

export type BlsOverviewModel = {
  briefLines: string[];
  overall: OverviewOverallState;
  indicators: OverviewIndicator[];
  trends: OverviewIndicator[];
  revisions: OverviewRevisionSummary;
  nextRelease: OverviewScheduledRelease | null;
};

type PreferredIndicator = {
  role: string;
  ids: string[];
  patterns: RegExp[];
};

type TrendRule = {
  band: number;
  bandUnit: string;
  kind: "labor_positive" | "unemployment_inverted" | "earnings_direction";
  overallVote: boolean;
};

export const BLS_OVERVIEW_RULE_RECEIPT = {
  window: {
    latestMonths: 3,
    priorMonths: 3,
    requiredContiguousMonths: 6,
  },
  overall: {
    minimumEligibleVoters: 2,
    maximumAnchorLagMonths: 2,
    deltaRoundingDecimals: 3,
    bandComparison: "inclusive",
    voterSeriesIds: [
      "CES0000000001",
      "LNS14000000",
      "JTS000000000000000JOR",
      "JTS000000000000000JOL",
    ],
    excludedSeriesIds: ["CES0500000003"],
  },
  series: {
    CES0000000001: { band: 25, bandUnit: "thousands of jobs", kind: "labor_positive", overallVote: true },
    LNS14000000: { band: 0.1, bandUnit: "percentage points", kind: "unemployment_inverted", overallVote: true },
    CES0500000003: { band: 0.1, bandUnit: "percentage points", kind: "earnings_direction", overallVote: false },
    JTS000000000000000JOR: { band: 0.1, bandUnit: "percentage points", kind: "labor_positive", overallVote: true },
    JTS000000000000000JOL: { band: 0.15, bandUnit: "millions of openings", kind: "labor_positive", overallVote: true },
  },
} as const;

const PREFERRED_INDICATORS: PreferredIndicator[] = [
  {
    role: "Payroll growth",
    ids: ["CES0000000001"],
    patterns: [/payroll.*change/i, /nonfarm payroll/i],
  },
  {
    role: "Unemployment",
    ids: ["LNS14000000"],
    patterns: [/unemployment rate/i],
  },
  {
    role: "Hourly earnings",
    ids: ["CES0500000003"],
    patterns: [/hourly earnings/i, /earnings.*growth/i],
  },
  {
    role: "Job openings",
    ids: ["JTS000000000000000JOR", "JTS000000000000000JOL"],
    patterns: [/job openings.*rate/i, /openings rate/i, /openings level/i],
  },
];

function finiteValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function orderedObservations(series: BlsSeries): BlsObservation[] {
  return [...series.observations].sort((left, right) => left.period.localeCompare(right.period));
}

function primaryObservations(series: BlsSeries): BlsObservation[] {
  return orderedObservations(series).filter((observation) => finiteValue(observation.primary_value));
}

function hasPrimaryValue(series: BlsSeries): boolean {
  return primaryObservations(series).length > 0;
}

function seriesText(series: BlsSeries): string {
  return `${series.key ?? ""} ${series.series_id} ${series.label} ${series.short_label}`;
}

function preferredSeries(series: BlsSeries[], definition: PreferredIndicator): BlsSeries | undefined {
  const exactMatches = definition.ids
    .map((id) => series.find((candidate) => candidate.series_id === id))
    .filter((candidate): candidate is BlsSeries => Boolean(candidate));
  const patternMatches = series.filter(
    (candidate) => definition.patterns.some((pattern) => pattern.test(seriesText(candidate))),
  );
  return exactMatches.find(hasPrimaryValue)
    ?? patternMatches.find(hasPrimaryValue)
    ?? exactMatches[0]
    ?? patternMatches[0];
}

function observationState(delta: number | null, hasCurrent: boolean, hasPrior: boolean): OverviewObservationState {
  if (!hasCurrent) return "unavailable";
  if (!hasPrior || delta === null) return "prior_unavailable";
  if (Math.abs(delta) < 1e-9) return "unchanged";
  return delta > 0 ? "higher" : "lower";
}

function observationStateLabel(state: OverviewObservationState): string {
  if (state === "higher") return "Higher than prior";
  if (state === "lower") return "Lower than prior";
  if (state === "unchanged") return "Unchanged from prior";
  if (state === "prior_unavailable") return "Prior unavailable";
  return "Current value unavailable";
}

function indicatorInterpretation(
  role: string,
  state: OverviewObservationState,
  delta: number | null,
  deltaUnit: string,
): string {
  if (state === "unavailable") return `No current primary value is available for ${role.toLowerCase()}.`;
  if (state === "prior_unavailable") return `A current ${role.toLowerCase()} value is available, but no prior observation can be compared.`;
  if (state === "unchanged") return `${role} is unchanged from the prior reference period.`;
  const magnitude = `${formatValue(Math.abs(delta ?? 0), 3)} ${deltaUnit}`.trim();
  return `${role} is ${magnitude} ${state} than the prior reference period.`;
}

function latestContiguousSix(series: BlsSeries): BlsObservation[] | null {
  const byMonth = new Map<number, BlsObservation>();
  orderedObservations(series).forEach((observation) => {
    const index = monthlyIndex(observation.period);
    if (index !== null) byMonth.set(index, observation);
  });
  const latest = [...byMonth.entries()]
    .filter(([, observation]) => finiteValue(observation.primary_value))
    .sort(([left], [right]) => left - right)
    .at(-1);
  if (!latest) return null;
  const window: BlsObservation[] = [];
  for (let index = latest[0] - 5; index <= latest[0]; index += 1) {
    const observation = byMonth.get(index);
    if (!observation || !finiteValue(observation.primary_value)) return null;
    window.push(observation);
  }
  return window;
}

function trendRule(series: BlsSeries): TrendRule | null {
  const rules = BLS_OVERVIEW_RULE_RECEIPT.series as Record<string, TrendRule | undefined>;
  return rules[series.series_id] ?? null;
}

function meanPrimary(observations: BlsObservation[]): number {
  return observations.reduce((sum, observation) => sum + (observation.primary_value ?? 0), 0) / observations.length;
}

function indicatorTrend(
  series: BlsSeries,
): Pick<OverviewIndicator, "trendState" | "trendStateLabel" | "trendDelta" | "trendAnchorPeriod" | "trendProvisional" | "materialityBand" | "materialityUnit" | "trendInterpretation"> {
  const rule = trendRule(series);
  if (!rule) {
    return {
      trendState: "observations_only",
      trendStateLabel: "Observations only",
      trendDelta: null,
      trendAnchorPeriod: null,
      trendProvisional: false,
      materialityBand: null,
      materialityUnit: null,
      trendInterpretation: "No dashboard materiality rule is defined for this fallback series.",
    };
  }
  const window = latestContiguousSix(series);
  if (!window) {
    return {
      trendState: "observations_only",
      trendStateLabel: "Observations only",
      trendDelta: null,
      trendAnchorPeriod: null,
      trendProvisional: false,
      materialityBand: rule.band,
      materialityUnit: rule.bandUnit,
      trendInterpretation: "Six contiguous finite monthly observations are required before assigning a trend state.",
    };
  }
  const rawDelta = meanPrimary(window.slice(3)) - meanPrimary(window.slice(0, 3));
  const delta = Math.round(rawDelta * 1000) / 1000;
  const withinBand = Math.abs(delta) <= rule.band;
  const trendState: OverviewIndicator["trendState"] = withinBand
    ? "stable"
    : rule.kind === "earnings_direction"
      ? delta > 0 ? "faster" : "slower"
      : rule.kind === "unemployment_inverted"
        ? delta > 0 ? "cooling" : "strengthening"
        : delta > 0 ? "strengthening" : "cooling";
  let trendStateLabel: string;
  if (series.series_id === "CES0000000001") {
    trendStateLabel = trendState === "strengthening"
      ? "Payroll gains strengthening"
      : trendState === "cooling"
        ? "Payroll gains cooling"
        : "Payroll gains broadly stable";
  } else if (series.series_id === "LNS14000000") {
    trendStateLabel = trendState === "strengthening"
      ? "Unemployment falling"
      : trendState === "cooling"
        ? "Unemployment rising"
        : "Unemployment broadly stable";
  } else if (series.series_id === "CES0500000003") {
    trendStateLabel = trendState === "faster"
      ? "Wage growth accelerating"
      : trendState === "slower"
        ? "Wage growth decelerating"
        : "Wage growth broadly stable";
  } else {
    const subject = series.series_id === "JTS000000000000000JOL" ? "Openings level" : "Openings rate";
    trendStateLabel = trendState === "strengthening"
      ? `${subject} rising`
      : trendState === "cooling"
        ? `${subject} falling`
        : `${subject} broadly stable`;
  }
  const comparison = `${formatSigned(delta, "", 3)} ${rule.bandUnit}`;
  const threshold = `${formatValue(rule.band, 2)} ${rule.bandUnit}`;

  return {
    trendState,
    trendStateLabel,
    trendDelta: delta,
    trendAnchorPeriod: window.at(-1)?.period ?? null,
    trendProvisional: Boolean(window.at(-1)?.preliminary),
    materialityBand: rule.band,
    materialityUnit: rule.bandUnit,
    trendInterpretation: withinBand
      ? `The latest three-month mean differs from the prior three-month mean by ${comparison}, inside or at the ${threshold} dashboard materiality band.`
      : `The latest three-month mean differs from the prior three-month mean by ${comparison}, beyond the ${threshold} dashboard materiality band.`,
  };
}

function buildIndicator(role: string, series: BlsSeries): OverviewIndicator {
  const observations = orderedObservations(series);
  const current = observations.at(-1) ?? null;
  const prior = observations.at(-2) ?? null;
  const delta = current && prior && finiteValue(current.primary_value) && finiteValue(prior.primary_value)
    ? current.primary_value - prior.primary_value
    : null;
  const state = observationState(
    delta,
    Boolean(current && finiteValue(current.primary_value)),
    Boolean(prior && finiteValue(prior.primary_value)),
  );
  const deltaUnit = primaryDeltaUnit(series);
  const trend = indicatorTrend(series);
  const trendPoints = densifyMonthlyRows(
    orderedObservations(series).map((observation) => ({ period: observation.period, value: observation.primary_value })),
    (period) => ({ period, value: null }),
  ).slice(-24);

  return {
    role,
    series,
    current,
    prior,
    delta,
    deltaUnit,
    state,
    stateLabel: observationStateLabel(state),
    interpretation: indicatorInterpretation(role, state, delta, deltaUnit),
    ...trend,
    trendPoints,
    plottablePointCount: trendPoints.filter((point) => finiteValue(point.value)).length,
  };
}

function selectIndicators(series: BlsSeries[]): Array<{ role: string; series: BlsSeries }> {
  const selected: Array<{ role: string; series: BlsSeries }> = [];
  const used = new Set<string>();

  PREFERRED_INDICATORS.forEach((definition) => {
    const match = preferredSeries(series, definition);
    if (!match || used.has(match.series_id)) return;
    selected.push({ role: definition.role, series: match });
    used.add(match.series_id);
  });

  return selected.slice(0, 4);
}

function buildOverallState(indicators: OverviewIndicator[]): OverviewOverallState {
  const ruleEligible = indicators.filter((indicator) => {
    const rule = trendRule(indicator.series);
    return Boolean(rule?.overallVote) && indicator.trendState !== "observations_only";
  });
  const freshestAnchor = ruleEligible
    .map((indicator) => indicator.trendAnchorPeriod ? monthlyIndex(indicator.trendAnchorPeriod) : null)
    .filter((index): index is number => index !== null)
    .sort((left, right) => left - right)
    .at(-1) ?? null;
  const eligible = freshestAnchor === null
    ? []
    : ruleEligible.filter((indicator) => {
      const anchor = indicator.trendAnchorPeriod ? monthlyIndex(indicator.trendAnchorPeriod) : null;
      return anchor !== null && freshestAnchor - anchor <= BLS_OVERVIEW_RULE_RECEIPT.overall.maximumAnchorLagMonths;
    });
  const strengtheningVotes = eligible.filter((indicator) => indicator.trendState === "strengthening").length;
  const coolingVotes = eligible.filter((indicator) => indicator.trendState === "cooling").length;
  const stableVotes = eligible.filter((indicator) => indicator.trendState === "stable").length;
  const provisional = eligible.some((indicator) => indicator.trendProvisional);
  let state: OverviewOverallState["state"];

  if (eligible.length < 2) state = "observations_only";
  else if (strengtheningVotes > 0 && coolingVotes > 0) state = "mixed";
  else if (strengtheningVotes >= 2) state = "strengthening";
  else if (coolingVotes >= 2) state = "cooling";
  else state = "stable";

  const label = state === "observations_only"
    ? "Observations only"
    : state[0].toUpperCase() + state.slice(1);
  const explanation = state === "observations_only"
    ? "At least two headline voters need six contiguous finite months and an anchor no more than two months behind the freshest eligible voter before the dashboard assigns an overall state."
    : `${provisional ? "Provisional because an eligible anchor observation is preliminary. " : ""}${eligible.length} eligible headline voters within the two-month anchor window: ${strengtheningVotes} strengthening, ${coolingVotes} cooling, and ${stableVotes} stable.`;

  return {
    state,
    label,
    eligibleVotes: eligible.length,
    strengtheningVotes,
    coolingVotes,
    stableVotes,
    provisional,
    explanation,
  };
}

function revisionStage(row: PayrollRevision): "first_estimate" | "second_estimate" | "third_estimate" | null {
  const stage = (row.revision_stage ?? row.status ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["first", "first_preliminary", "first_estimate"].includes(stage)) return "first_estimate";
  if (["second", "second_preliminary", "second_estimate"].includes(stage)) return "second_estimate";
  if (["third", "third_estimate", "final"].includes(stage)) return "third_estimate";
  if (finiteValue(row.third_estimate)) return "third_estimate";
  if (finiteValue(row.second_estimate)) return "second_estimate";
  if (finiteValue(row.first_estimate)) return "first_estimate";
  return null;
}

export function effectiveRevisionDelta(row: PayrollRevision): number | null {
  const stage = revisionStage(row);
  if (stage === "first_estimate") return null;
  if (stage === "third_estimate") {
    if (finiteValue(row.revision_3_minus_1)) return row.revision_3_minus_1;
    if (finiteValue(row.total_revision)) return row.total_revision;
    if (finiteValue(row.third_estimate) && finiteValue(row.first_estimate)) {
      return row.third_estimate - row.first_estimate;
    }
    return null;
  }
  if (stage === "second_estimate") {
    if (finiteValue(row.revision_2_minus_1)) return row.revision_2_minus_1;
    if (finiteValue(row.second_minus_first)) return row.second_minus_first;
    if (finiteValue(row.second_estimate) && finiteValue(row.first_estimate)) {
      return row.second_estimate - row.first_estimate;
    }
    return null;
  }
  if (finiteValue(row.latest_estimate) && finiteValue(row.first_estimate)) {
    return row.latest_estimate - row.first_estimate;
  }
  if (finiteValue(row.third_estimate) && finiteValue(row.first_estimate)) {
    return row.third_estimate - row.first_estimate;
  }
  if (finiteValue(row.second_estimate) && finiteValue(row.first_estimate)) {
    return row.second_estimate - row.first_estimate;
  }
  return row.revision_3_minus_1
    ?? row.total_revision
    ?? row.revision_2_minus_1
    ?? row.second_minus_first
    ?? null;
}

function revisionDirection(value: number | null): OverviewRevisionSummary["latestDirection"] {
  if (value === null) return "unavailable";
  if (Math.abs(value) < 1e-9) return "unchanged";
  return value > 0 ? "upward" : "downward";
}

export function buildOverviewRevisionSummary(revisions: PayrollRevision[]): OverviewRevisionSummary {
  const rows = [...revisions].sort((left, right) => left.period.localeCompare(right.period));
  let latestIndex = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!finiteValue(effectiveRevisionDelta(rows[index]))) continue;
    latestIndex = index;
    break;
  }
  const latest = latestIndex >= 0 ? rows[latestIndex] : null;
  const latestDelta = latest ? effectiveRevisionDelta(latest) : null;
  const selectedStage = latest ? revisionStage(latest) : null;
  const latestStage = selectedStage === "second_estimate" || selectedStage === "third_estimate"
    ? selectedStage
    : null;
  const latestDirection = revisionDirection(latestDelta);
  const latestThreeRows = latestIndex >= 2 ? rows.slice(latestIndex - 2, latestIndex + 1) : [];
  const latestThreeDeltas = latestThreeRows.map(effectiveRevisionDelta);
  const latestThreeIndexes = latestThreeRows.map((row) => monthlyIndex(row.period));
  const contiguousThree = latestThreeRows.length === 3
    && latestThreeDeltas.every(finiteValue)
    && latestThreeIndexes.every((index): index is number => index !== null)
    && latestThreeIndexes[1] - latestThreeIndexes[0] === 1
    && latestThreeIndexes[2] - latestThreeIndexes[1] === 1;
  const netThreeMonth = contiguousThree
    ? (latestThreeDeltas as number[]).reduce((sum, value) => sum + value, 0)
    : null;
  let streakCount = 0;
  let streakDirection: OverviewRevisionSummary["streakDirection"] = "none";

  if (latestDirection === "upward" || latestDirection === "downward") {
    streakDirection = latestDirection;
    for (let index = latestIndex; index >= 0; index -= 1) {
      if (revisionDirection(effectiveRevisionDelta(rows[index])) !== latestDirection) break;
      if (index < latestIndex) {
        const currentMonth = monthlyIndex(rows[index + 1].period);
        const priorMonth = monthlyIndex(rows[index].period);
        if (currentMonth === null || priorMonth === null || currentMonth - priorMonth !== 1) break;
      }
      streakCount += 1;
    }
  }

  return {
    latestPeriod: latest?.period ?? null,
    latestDelta,
    latestStage,
    latestStageLabel: latestStage === "second_estimate"
      ? "Second estimate"
      : latestStage === "third_estimate"
        ? "Third estimate"
        : "Revision stage unavailable",
    latestDirection,
    latestStateLabel: latestDirection === "unavailable"
      ? "Revision unavailable"
      : latestDirection === "unchanged"
        ? "No net revision"
        : `${latestDirection === "upward" ? "Upward" : "Downward"} revision`,
    netThreeMonth,
    netMonthCount: contiguousThree ? 3 : 0,
    streakDirection,
    streakCount,
    unit: "thousands of jobs",
  };
}

function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function releaseCalendarHref(entry: BlsCalendarEntry): string | null {
  const start = new Date(entry.scheduled_at);
  if (Number.isNaN(start.getTime())) return null;
  const label = calendarLabel(entry);
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Market Diagnostic Dashboard//BLS Release Lens//EN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(`${entry.report_id}-${icsTimestamp(start)}@market-diagnostic-dashboard`)}`,
    `DTSTAMP:${icsTimestamp(start)}`,
    `DTSTART:${icsTimestamp(start)}`,
    `SUMMARY:${escapeIcs(`BLS: ${label}`)}`,
    `DESCRIPTION:${escapeIcs(`Scheduled BLS event. Calendar timing does not confirm an observation release. Official schedule: ${entry.source_url}`)}`,
    `URL:${escapeIcs(entry.source_url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(calendar)}`;
}

function scheduledRelease(data: BlsLensResponse, entry: BlsCalendarEntry): OverviewScheduledRelease {
  const report = data.reports.find((candidate) => (candidate.report_id ?? candidate.id) === entry.report_id);
  return {
    entry,
    label: calendarLabel(entry),
    description: report?.description ?? "The returned report metadata does not specify which measures this schedule covers.",
    calendarHref: releaseCalendarHref(entry),
  };
}

function observationBrief(overall: OverviewOverallState, indicators: OverviewIndicator[]): string {
  const ruleLabel = `${overall.label}${overall.provisional ? " (provisional)" : ""}`;
  const comparable = indicators.filter((indicator) => (
    indicator.state === "higher" || indicator.state === "lower" || indicator.state === "unchanged"
  ));
  if (comparable.length === 0) {
    return `Dashboard rule state: ${ruleLabel}. Current headline observations do not contain enough prior-period evidence for a directional comparison.`;
  }
  const clauses = comparable.slice(0, 2).map((indicator) => {
    if (indicator.state === "unchanged") return `${indicator.role} is unchanged from its prior observation`;
    return `${indicator.role} is ${indicator.state} than its prior observation`;
  });
  return `Dashboard rule state: ${ruleLabel}. ${clauses.join("; ")}.`;
}

function revisionBrief(revisions: OverviewRevisionSummary): string {
  if (revisions.latestDelta === null) {
    return "A newest-estimate payroll revision is not available in this response.";
  }
  const latestPeriod = revisions.latestPeriod ? ` for ${formatPeriod(revisions.latestPeriod)}` : "";
  const net = revisions.netThreeMonth === null
    ? "the newest three-month net is unavailable because three contiguous revised reference months are required"
    : `the net across ${revisions.netMonthCount} newest reference months is ${formatSigned(revisions.netThreeMonth)} ${revisions.unit}`;
  const direction = revisions.latestDirection === "upward" || revisions.latestDirection === "downward"
    ? `a ${revisions.latestDirection} revision of ${formatValue(Math.abs(revisions.latestDelta))} ${revisions.unit}`
    : `no net revision (${formatSigned(revisions.latestDelta)} ${revisions.unit})`;
  return `The latest payroll ${revisions.latestStageLabel.toLowerCase()} change is ${direction}${latestPeriod}; ${net}.`;
}

function scheduleBrief(nextRelease: OverviewScheduledRelease | null): string {
  if (!nextRelease) {
    return "No future scheduled BLS event is available in the returned calendar.";
  }
  return `The next scheduled event is ${nextRelease.label} on ${formatDate(nextRelease.entry.scheduled_at)} at ${clockTime(nextRelease.entry)}; schedule timing does not confirm an observation release.`;
}

export function buildBlsOverviewModel(data: BlsLensResponse): BlsOverviewModel {
  const indicators = selectIndicators(data.series).map(({ role, series }) => buildIndicator(role, series));
  const overall = buildOverallState(indicators);
  const revisions = buildOverviewRevisionSummary(data.payroll_revisions);
  const asOfTime = new Date(data.as_of).getTime();
  const upcoming = [...data.release_calendar]
    .filter((entry) => new Date(entry.scheduled_at).getTime() > asOfTime)
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at))
    .slice(0, 1)
    .map((entry) => scheduledRelease(data, entry));
  const nextRelease = upcoming[0] ?? null;

  return {
    briefLines: [
      observationBrief(overall, indicators),
      revisionBrief(revisions),
      scheduleBrief(nextRelease),
    ],
    overall,
    indicators,
    trends: indicators.slice(0, 4),
    revisions,
    nextRelease,
  };
}
