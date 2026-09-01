import type {
  BlsCalendarEntry,
  BlsDataQuality,
  BlsObservation,
  BlsReport,
  BlsSeries,
  SeriesLineStyle,
} from "./types";

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

export function formatPeriod(period: string): string {
  const date = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? period : monthFormatter.format(date);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatValue(value: number | null | undefined, maximumFractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(1, maximumFractionDigits),
  }).format(value);
}

export function formatSigned(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatValue(value)}${suffix}`;
}

export function reportId(report: BlsReport): string {
  return report.report_id ?? report.id ?? "unknown-report";
}

export function reportLabel(report: BlsReport): string {
  return report.label ?? report.name ?? reportId(report);
}

export function calendarLabel(entry: BlsCalendarEntry): string {
  return entry.report ?? entry.title ?? entry.report_id;
}

export function seriesCoverageStart(series: BlsSeries): string | null {
  return series.coverage_start ?? series.coverage?.start ?? series.observations[0]?.period ?? null;
}

export function seriesCoverageEnd(series: BlsSeries): string | null {
  return series.coverage_end ?? series.coverage?.end ?? series.observations[series.observations.length - 1]?.period ?? null;
}

export function latestObservation(series: BlsSeries): BlsObservation | null {
  if (series.latest?.primary_value !== null && series.latest?.primary_value !== undefined) {
    return series.latest;
  }
  for (let index = series.observations.length - 1; index >= 0; index -= 1) {
    if (series.observations[index].primary_value !== null) return series.observations[index];
  }
  return series.latest ?? series.observations[series.observations.length - 1] ?? null;
}

export function seriesHasPrimaryData(series: BlsSeries): boolean {
  return series.observations.some(
    (observation) => observation.primary_value !== null && Number.isFinite(observation.primary_value),
  );
}

export function dataQualityStatus(dataQuality: BlsDataQuality): string {
  return typeof dataQuality === "string" ? dataQuality : dataQuality.status;
}

export function dataQualityMessage(dataQuality: BlsDataQuality): string | null {
  return typeof dataQuality === "string" ? null : dataQuality.message ?? null;
}

export function isPriceSeries(series: BlsSeries): boolean {
  return /price|inflation|cpi|ppi/i.test(`${series.family} ${series.label} ${series.report_id}`);
}

export function lineStyleForSeries(series: BlsSeries, index: number): SeriesLineStyle {
  const styleIndex = Math.max(0, index);
  const dashPatterns = [
    undefined,
    "10 4",
    "3 4",
    "14 4 3 4",
    "2 3",
    "16 4 2 4 2 4",
    "7 3 2 3",
    "1 4",
    "12 3 5 3",
  ];
  return {
    color: isPriceSeries(series) ? "var(--field-caution)" : "var(--field-accent)",
    dash: dashPatterns[styleIndex % dashPatterns.length],
    opacity: 1,
  };
}

export function formatFootnotes(footnotes: BlsObservation["footnotes"]): string {
  if (!footnotes || footnotes.length === 0) return "None";
  if (typeof footnotes === "string") return footnotes;
  return footnotes
    .map((footnote) => typeof footnote === "string" ? footnote : `${footnote.code}: ${footnote.text}`)
    .join(" · ");
}

function matches(series: BlsSeries, patterns: RegExp[]): boolean {
  const value = `${series.key ?? ""} ${series.series_id} ${series.label} ${series.short_label}`;
  return patterns.some((pattern) => pattern.test(value));
}

export function defaultSeriesIds(series: BlsSeries[], limit = 5): string[] {
  const availableSeries = series.filter(seriesHasPrimaryData);
  const chosen: string[] = [];
  const groups: RegExp[][] = [
    [/headline\s*cpi/i, /cpi.*all items/i, /consumer price.*all items/i],
    [/core\s*cpi/i, /less food and energy/i],
    [/payroll.*change/i, /nonfarm payroll/i, /CES0000000001/i],
    [/unemployment rate/i, /LNS14000000/i],
    [/openings rate/i, /job openings.*rate/i],
  ];

  groups.forEach((patterns) => {
    const match = availableSeries.find(
      (candidate) => !chosen.includes(candidate.series_id) && matches(candidate, patterns),
    );
    if (match) chosen.push(match.series_id);
  });

  for (const candidate of availableSeries) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(candidate.series_id)) chosen.push(candidate.series_id);
  }
  return chosen.slice(0, limit);
}

export function clockTime(entry: BlsCalendarEntry): string {
  if (entry.time_label) return entry.time_label;
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(entry.scheduled_at));
  return formatted;
}
