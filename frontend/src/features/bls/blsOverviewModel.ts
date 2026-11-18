import { calendarLabel } from "./format";
import { monthlyIndex } from "./monthlyRows";
import type { BlsCalendarEntry, BlsLensResponse, PayrollRevision } from "./types";

export type BlsOverviewTarget = "releases" | "trends" | "revisions" | "calendar" | "methods";

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
  calendarHref: string | null;
};

function finiteValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
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

function scheduledRelease(entry: BlsCalendarEntry): OverviewScheduledRelease {
  return {
    entry,
    label: calendarLabel(entry),
    calendarHref: releaseCalendarHref(entry),
  };
}

export function nextScheduledRelease(data: BlsLensResponse): OverviewScheduledRelease | null {
  const asOfTime = new Date(data.as_of).getTime();
  return [...data.release_calendar]
    .filter((entry) => new Date(entry.scheduled_at).getTime() > asOfTime)
    .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime())
    .map(scheduledRelease)[0] ?? null;
}
