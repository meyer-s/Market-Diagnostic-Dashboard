import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AccessibleChartFrame from "../../components/ui/AccessibleChartFrame";
import DataScroller from "../../components/ui/DataScroller";
import { buildOverviewRevisionSummary, effectiveRevisionDelta } from "./blsOverviewModel";
import { formatPeriod, formatSigned, formatValue } from "./format";
import type { PayrollRevision } from "./types";

type RevisionLedgerProps = {
  revisions: PayrollRevision[];
};

type RevisionRow = PayrollRevision & { chart_total_revision: number | null };

export function secondDelta(row: PayrollRevision): number | null {
  return row.second_minus_first ?? row.revision_2_minus_1 ?? null;
}

export function thirdDelta(row: PayrollRevision): number | null {
  return row.third_minus_second ?? row.revision_3_minus_2 ?? null;
}

function normalizedRevisionStage(row: PayrollRevision): "first" | "second" | "third" | "unknown" {
  const stage = (row.revision_stage ?? row.status ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["third", "third_estimate", "final"].includes(stage) || row.third_estimate !== null && row.third_estimate !== undefined) return "third";
  if (["second", "second_preliminary", "second_estimate"].includes(stage) || row.second_estimate !== null && row.second_estimate !== undefined) return "second";
  if (["first", "first_preliminary", "first_estimate"].includes(stage) || row.first_estimate !== null && row.first_estimate !== undefined) return "first";
  return "unknown";
}

export function totalDelta(row: PayrollRevision): number | null {
  return effectiveRevisionDelta(row);
}

function revisionStatus(row: PayrollRevision): string {
  const stage = normalizedRevisionStage(row);
  if (stage === "first") return "First estimate";
  if (stage === "second") return "Second estimate";
  if (stage === "third") return "Third estimate";
  return "Estimate stage unavailable";
}

function revisionClass(value: number | null): string | undefined {
  if (value === null || Math.abs(value) < 1e-9) return undefined;
  return "bls-revision-value";
}

function revisionDirectionLabel(value: number): string {
  if (Math.abs(value) < 1e-9) return "No net revision";
  return value < 0 ? "Downward revision" : "Upward revision";
}

function RevisionTable({ rows, label }: { rows: RevisionRow[]; label: string }) {
  return (
    <DataScroller label={label} className="bls-revision-scroller" hint="Scroll horizontally to inspect every estimate stage.">
      <table className="bls-table bls-revision-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Reference month</th>
            <th scope="col">First estimate</th>
            <th scope="col">Second estimate</th>
            <th scope="col">2nd − 1st</th>
            <th scope="col">Third estimate</th>
            <th scope="col">3rd − 2nd</th>
            <th scope="col">Latest − 1st</th>
            <th scope="col">Vintage status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period}>
              <th scope="row">{formatPeriod(row.period)}</th>
              <td>{formatValue(row.first_estimate)}</td>
              <td>{formatValue(row.second_estimate)}</td>
              <td className={revisionClass(secondDelta(row))}>{formatSigned(secondDelta(row))}</td>
              <td>{formatValue(row.third_estimate)}</td>
              <td className={revisionClass(thirdDelta(row))}>{formatSigned(thirdDelta(row))}</td>
              <td className={revisionClass(totalDelta(row))}>{formatSigned(totalDelta(row))}</td>
              <td>{revisionStatus(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataScroller>
  );
}

export default function RevisionLedger({ revisions }: RevisionLedgerProps) {
  const rows: RevisionRow[] = revisions
    .map((row) => ({ ...row, chart_total_revision: totalDelta(row) }))
    .sort((left, right) => left.period.localeCompare(right.period));
  const chartRows = rows.slice(-36);
  const visibleRows = [...rows].reverse().slice(0, 6);
  const summary = buildOverviewRevisionSummary(revisions);
  const latestCompleted = rows.filter((row) => row.chart_total_revision !== null).slice(-6);
  const downwardCount = latestCompleted.filter((row) => (row.chart_total_revision ?? 0) < 0).length;
  const conclusion = latestCompleted.length === 0
    ? "No completed revision comparisons are available."
    : `${downwardCount} of the last ${latestCompleted.length} completed payroll estimates were revised downward. ${summary.netThreeMonth !== null ? `The net revision across the latest three contiguous months is ${formatSigned(summary.netThreeMonth)} thousand jobs.` : "A contiguous three-month net is not available."}`;

  return (
    <section id="bls-revisions" className="section-anchor">
      <AccessibleChartFrame
        title="Payroll revisions"
        description={conclusion}
        actions={<span className="bls-clock-label">Revision clock · estimate vintage</span>}
      >
        {rows.length > 0 ? (
          <>
            <dl className="bls-revision-summary" aria-label="Recent payroll revision summary">
              <div>
                <dt>Latest</dt>
                <dd className={revisionClass(summary.latestDelta)}>{summary.latestDelta === null ? "Unavailable" : `${formatSigned(summary.latestDelta)} ${summary.unit}`}</dd>
                <dd className="bls-revision-summary-note">{summary.latestStageLabel} · {summary.latestPeriod ? formatPeriod(summary.latestPeriod) : "No completed comparison"}</dd>
              </div>
              <div>
                <dt>Net three months</dt>
                <dd className={revisionClass(summary.netThreeMonth)}>{summary.netThreeMonth === null ? "Unavailable" : `${formatSigned(summary.netThreeMonth)} ${summary.unit}`}</dd>
                {summary.netMonthCount === 3 ? null : <dd className="bls-revision-summary-note">Requires 3 contiguous completed months</dd>}
              </div>
              <div>
                <dt>Current streak</dt>
                <dd className={summary.streakCount > 0 ? "bls-revision-value" : undefined}>{summary.streakCount === 0 ? "No streak" : `${summary.streakCount} ${summary.streakDirection} revision${summary.streakCount === 1 ? "" : "s"}`}</dd>
              </div>
            </dl>
            <div className="bls-revision-direction-key" aria-label="Revision direction labels">
              <span><i data-direction="up" aria-hidden="true" /> Upward revision</span>
              <span><i data-direction="down" aria-hidden="true" /> Downward revision</span>
            </div>
            <div className="bls-chart bls-revision-chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={chartRows}
                  margin={{ top: 14, right: 14, bottom: 10, left: 0 }}
                  accessibilityLayer
                  aria-label="Official payroll total revisions by reference month centered on zero"
                >
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={formatPeriod} stroke="var(--chart-axis-line)" tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }} />
                  <YAxis width={50} stroke="var(--chart-axis-line)" tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="var(--field-text-muted)" strokeWidth={1.5} />
                  <Tooltip
                    labelFormatter={(label) => formatPeriod(String(label))}
                    formatter={(value) => [`${formatSigned(Number(value))} thousand jobs`, revisionDirectionLabel(Number(value))]}
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                    labelStyle={{ color: "var(--chart-tooltip-label)" }}
                  />
                  <Bar dataKey="chart_total_revision" name="Total revision" radius={[4, 4, 0, 0]}>
                    {chartRows.map((row) => (
                      <Cell key={row.period} fill="var(--field-accent)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="bls-revision-history">
              <summary>View estimate data</summary>
              <p className="bls-chart-footnote">Each bar is the latest available estimate minus the first estimate for the same month. The chart shows {chartRows.length} months in thousands of payroll jobs; “Unavailable” means that estimate vintage has not been published. Third estimates can still change through the annual benchmark process.</p>
              <RevisionTable rows={visibleRows} label="Latest payroll revision values" />
              {rows.length > visibleRows.length ? (
                <details className="bls-revision-history">
                  <summary>Show all {rows.length} returned revisions</summary>
                  <RevisionTable rows={[...rows].reverse()} label="Complete official payroll revision history" />
                </details>
              ) : null}
            </details>
          </>
        ) : <p className="bls-empty-copy">Official payroll revision history is not available in this response.</p>}
      </AccessibleChartFrame>
    </section>
  );
}
