import { buildOverviewRevisionSummary, nextScheduledRelease } from "./blsOverviewModel";
import { formatPeriod, formatSigned, formatValue } from "./format";
import { monthlyIndex } from "./monthlyRows";
import type { BlsLensResponse, BlsObservation, BlsSeries } from "./types";

export type BriefReading = {
  id: string;
  label: string;
  period: string | null;
  value: number | null;
  delta: number | null;
  display: string;
  comparison: string;
  preliminary: boolean;
  source: string | null;
  series: BlsSeries | null;
};

export type BriefFinding = {
  id: string;
  topic: string;
  title: string;
  interpretation: string;
  qualification: string | null;
  preview: string;
  readings: BriefReading[];
  watch: string;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const usable = (point?: BlsObservation | null) => Boolean(point && point.available !== false && finite(point.primary_value));

// The chronological latest month owns the receipt, even when its primary value
// is missing. An older finite observation must never impersonate a new release.
export function briefReading(data: BlsLensResponse, id: string, label: string): BriefReading {
  const series = data.series.find((item) => item.series_id === id) ?? null;
  const points = [...(series?.observations ?? [])].sort((a, b) => a.period.localeCompare(b.period));
  if (series?.latest && (!points.length || series.latest.period > points[points.length - 1].period)) points.push(series.latest);
  const current = points.at(-1) ?? null;
  const prior = points.at(-2) ?? null;
  const currentMonth = current ? monthlyIndex(current.period) : null;
  const priorMonth = prior ? monthlyIndex(prior.period) : null;
  const adjacent = currentMonth !== null && priorMonth !== null && currentMonth - priorMonth === 1;
  const value = usable(current) ? current!.primary_value : null;
  const delta = value !== null && usable(prior) && adjacent ? value - prior!.primary_value! : null;
  const payroll = id === "CES0000000001";
  const percent = /%|percent/i.test(series?.primary_unit ?? "");
  const display = value === null ? "Unavailable" : payroll
    ? `${formatSigned(value * 1000, "", 0)} jobs`
    : `${formatValue(value, 2)}${percent ? "%" : ` ${series?.primary_unit ?? ""}`}`;
  return {
    id, label, period: current?.period ?? null, value, delta, display,
    comparison: delta === null ? "Prior-month comparison unavailable" : payroll
      ? `${formatSigned(delta * 1000, "", 0)} jobs vs prior month`
      : `${formatSigned(delta, "", 3)} ${percent ? "percentage points" : series?.primary_unit ?? ""} vs prior month`,
    preliminary: Boolean(current?.preliminary), source: series?.source_url ?? null, series,
  };
}

function contiguousMean(reading: BriefReading, months: number): number | null {
  const points = [...(reading.series?.observations ?? [])].sort((a, b) => a.period.localeCompare(b.period)).slice(-months);
  if (points.length !== months || points.at(-1)?.period !== reading.period || !points.every(usable)) return null;
  const indexes = points.map((point) => monthlyIndex(point.period));
  if (indexes.some((index, i) => index === null || (i > 0 && index - indexes[i - 1]! !== 1))) return null;
  return points.reduce((sum, point) => sum + point.primary_value!, 0) / months;
}

const preview = (reading: BriefReading) => `${reading.display}${reading.period ? ` · ${formatPeriod(reading.period)}` : ""}`;
const moved = (delta: number | null) => delta === null ? null : Math.abs(delta) < 1e-8 ? "unchanged" : delta > 0 ? "rising" : "falling";
const sameMonth = (...readings: BriefReading[]) => readings.every((reading) => reading.period !== null && reading.period === readings[0].period);

function missingAnnualBase(reading: BriefReading): boolean {
  if (reading.value !== null || !reading.period) return false;
  const month = monthlyIndex(reading.period);
  const current = reading.series?.observations.find((point) => point.period === reading.period);
  const yearEarlier = reading.series?.observations.find((point) => monthlyIndex(point.period) === (month ?? 0) - 12);
  return finite(current?.raw_value) && !finite(yearEarlier?.raw_value);
}

export function buildBlsBrief(data: BlsLensResponse) {
  const payroll = briefReading(data, "CES0000000001", "Payroll change");
  const unemployment = briefReading(data, "LNS14000000", "Unemployment");
  const wages = briefReading(data, "CES0500000003", "Hourly earnings growth");
  const cpi = briefReading(data, "CUUR0000SA0", "Headline CPI, year over year");
  const core = briefReading(data, "CUUR0000SA0L1E", "Core CPI, year over year");
  const ppi = briefReading(data, "WPUFD4", "Final-demand PPI, year over year");
  const openings = briefReading(data, "JTS000000000000000JOR", "Job openings rate");
  const quits = briefReading(data, "JTS000000000000000QUR", "Quits rate");
  const payrollMean = contiguousMean(payroll, 3);
  const alignedLabor = payroll.value !== null && unemployment.value !== null && sameMonth(payroll, unemployment);

  let hiringTitle = "The latest hiring picture is incomplete.";
  let hiringRead = "A payroll gain and an unemployment rate describe different surveys. Both current readings are needed to compare their directions.";
  if (payroll.value !== null) {
    if (payroll.value < 0) {
      hiringTitle = "Payrolls contracted in the latest month.";
      hiringRead = "Employers reported fewer jobs on net. A fall in payrolls is direct evidence of weaker employment in that month; its persistence needs subsequent releases.";
    } else if (payroll.value === 0) {
      hiringTitle = "Payroll employment was unchanged.";
      hiringRead = "Employers reported no net job growth in the latest month. This is a level change, not a count of people entering or leaving unemployment.";
    } else if (alignedLabor && unemployment.delta !== null && unemployment.delta > 1e-8) {
      hiringTitle = "Jobs grew while unemployment rose.";
      hiringRead = "Payroll jobs grew, but unemployment rose. Participation and employment in the household survey are needed to explain the disagreement.";
    } else if (alignedLabor && unemployment.delta !== null && unemployment.delta < -1e-8) {
      hiringTitle = "Job gains and lower unemployment point the same way.";
      hiringRead = "Both headline surveys improved this month. That supports a firmer employment read; one release does not establish a lasting turn.";
    } else {
      hiringTitle = "Employers are still adding jobs.";
      hiringRead = "Payroll employment increased. The pace of job creation, rather than the positive sign alone, determines whether hiring is gaining or losing momentum.";
    }
  }
  const laborQualification = !alignedLabor
    ? "The payroll and unemployment receipts are missing or cover different months; a combined monthly conclusion is unavailable."
    : payrollMean !== null
      ? `The latest three months averaged ${formatValue(payrollMean * 1000, 0)} jobs per month.`
      : "A three-month payroll average needs three consecutive available months.";

  const consumerComplete = cpi.value !== null && core.value !== null && sameMonth(cpi, core);
  let inflationTitle = "The annual consumer-inflation comparison has a gap.";
  let inflationRead = missingAnnualBase(cpi) || missingAnnualBase(core)
    ? "A current price index is present, but its year-earlier comparison is missing from this history. A current annual inflation rate cannot be calculated from those inputs."
    : "Latest headline and core annual rates cannot both be compared. The gap prevents a current annual-inflation conclusion; older readings are not substituted.";
  if (consumerComplete) {
    const headlineDirection = moved(cpi.delta);
    const coreDirection = moved(core.delta);
    if (headlineDirection === "falling" && coreDirection === "falling") {
      inflationTitle = "Annual consumer inflation eased in both measures.";
      inflationRead = "Headline and core annual inflation slowed together. Prices can still be rising: slower inflation means a slower pace of increase, not necessarily lower prices.";
    } else if (headlineDirection === "rising" && coreDirection === "rising") {
      inflationTitle = "Annual consumer inflation picked up in both measures.";
      inflationRead = "Annual inflation accelerated even after excluding food and energy. These annual rates do not isolate the latest month's price impulse.";
    } else if (headlineDirection === null || coreDirection === null) {
      inflationTitle = "Annual inflation is available; its direction is less clear.";
      inflationRead = "The current annual rates are reported, but an adjacent comparison is missing. A rise or fall cannot be inferred by skipping the gap.";
    } else if (headlineDirection === "unchanged" && coreDirection === "unchanged") {
      inflationTitle = "Annual consumer inflation held steady.";
      inflationRead = "Headline and core annual rates were unchanged from the prior month. That describes the pace of inflation, not an unchanged price level.";
    } else {
      inflationTitle = "Headline and core inflation are not moving together.";
      inflationRead = "The broader index and the measure excluding food and energy give different signals. Keep those differences visible before describing inflation as uniformly easing or accelerating.";
    }
  }
  const inflationQualification = ppi.value !== null
    ? `PPI: ${ppi.display}, ${moved(ppi.delta) ?? "prior comparison unavailable"}. It measures producer prices and cannot substitute for CPI or predict its next move.`
    : "Producer-price evidence is unavailable; it is not inferred from consumer prices.";

  const demandAligned = openings.value !== null && quits.value !== null && sameMonth(openings, quits);
  const openingDirection = moved(openings.delta);
  const quitDirection = moved(quits.delta);
  let demandTitle = "Labor demand needs more confirmation.";
  let demandRead = "Vacancies are not completed hires, and quits measure voluntary departures. Missing or differently dated readings prevent a combined conclusion.";
  if (demandAligned && openingDirection !== null && quitDirection !== null) {
    if (openingDirection === "rising" && quitDirection === "rising") {
      demandTitle = "Openings and quits both increased.";
      demandRead = "More vacancies and a higher quits rate suggest firmer demand and worker mobility. Openings are unfilled positions, not completed hires.";
    } else if (openingDirection === "falling" && quitDirection === "falling") {
      demandTitle = "Vacancies and voluntary departures both declined.";
      demandRead = "Employers reported less unfilled demand and workers quit less often. Together they are consistent with a less active labor market, without identifying the cause.";
    } else if (openingDirection === "unchanged" && quitDirection === "unchanged") {
      demandTitle = "Vacancies and worker mobility held steady.";
      demandRead = "The openings and quits rates were unchanged. These two measures show no new monthly shift in unfilled demand or voluntary departures.";
    } else {
      demandTitle = "Vacancies and worker mobility give a mixed read.";
      demandRead = "The openings and quits rates do not give a common monthly direction. A vacancy measure alone is insufficient to describe the whole labor market as strengthening or cooling.";
    }
  }
  const payrollMonth = payroll.period ? monthlyIndex(payroll.period) : null;
  const openingsMonth = openings.period ? monthlyIndex(openings.period) : null;
  const demandQualification = payrollMonth !== null && openingsMonth !== null && payrollMonth > openingsMonth
    ? `JOLTS describes ${formatPeriod(openings.period!)}; payrolls describe ${formatPeriod(payroll.period!)}. These are different reference months.`
    : !demandAligned ? "Openings and quits are missing or do not share a reference month." : null;

  const findings: BriefFinding[] = [
    { id: "hiring", topic: "Hiring", title: hiringTitle, interpretation: hiringRead, qualification: laborQualification, preview: preview(payroll), readings: [payroll, unemployment, wages], watch: "Check the next payroll estimate and earlier-month revisions before treating a monthly improvement as a lasting turn." },
    { id: "inflation", topic: "Inflation", title: inflationTitle, interpretation: inflationRead, qualification: inflationQualification, preview: consumerComplete ? preview(cpi) : `CPI annual comparison unavailable${cpi.period ? ` · ${formatPeriod(cpi.period)}` : ""}`, readings: [cpi, core, ppi], watch: "Look for agreement between headline and core CPI; separate annual base effects from seasonally adjusted monthly momentum." },
    { id: "demand", topic: "Labor demand", title: demandTitle, interpretation: demandRead, qualification: demandQualification, preview: preview(openings), readings: [openings, quits], watch: "Check whether newer JOLTS observations and subsequent hiring confirm the same direction." },
  ];
  const readings = findings.flatMap((finding) => finding.readings);
  const limits = [
    "Interpretation is derived from the returned observations. It is not an official BLS classification, a recession signal, or a policy forecast.",
    "Monthly comparisons require adjacent available months. Annual CPI/PPI rates are not monthly seasonally adjusted inflation rates.",
    "A source check is not a new release. Reference months, scheduled dates, and revisions are separate clocks.",
  ];
  return { findings, nextRelease: nextScheduledRelease(data), revisions: buildOverviewRevisionSummary(data.payroll_revisions), preliminary: readings.some((reading) => reading.preliminary), missing: readings.some((reading) => reading.value === null), limits };
}
