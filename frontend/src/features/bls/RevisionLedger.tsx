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
import { formatPeriod, formatSigned, formatValue } from "./format";
import type { PayrollRevision } from "./types";

type RevisionLedgerProps = {
  revisions: PayrollRevision[];
};

function secondDelta(row: PayrollRevision): number | null {
  return row.second_minus_first ?? row.revision_2_minus_1 ?? null;
}

function thirdDelta(row: PayrollRevision): number | null {
  return row.third_minus_second ?? row.revision_3_minus_2 ?? null;
}

function totalDelta(row: PayrollRevision): number | null {
  return row.total_revision ?? row.revision_3_minus_1 ?? secondDelta(row);
}

function revisionStatus(row: PayrollRevision): string {
  const stage = (row.revision_stage ?? row.status ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["first", "first_preliminary", "first_estimate"].includes(stage)) return "First estimate";
  if (["second", "second_preliminary", "second_estimate"].includes(stage)) return "Second estimate";
  if (["third", "third_estimate", "final"].includes(stage)) return "Third estimate";
  return "Estimate stage unavailable";
}

function revisionClass(value: number | null): string | undefined {
  if (value === null) return undefined;
  return value < 0 ? "bls-negative" : "bls-positive";
}

export default function RevisionLedger({ revisions }: RevisionLedgerProps) {
  const rows = revisions.map((row) => ({ ...row, chart_total_revision: totalDelta(row) }));
  const chartRows = rows.slice(-36);

  return (
    <section id="bls-revisions" className="section-anchor">
      <AccessibleChartFrame
        title="Official payroll revision ledger"
        description="The initial payroll estimate is followed through its official second and third estimates. Bars show the latest available estimate minus the first estimate, in thousands of jobs."
        summary="Positive blue bars are upward revisions; negative gold bars are downward revisions. The chart shows the latest 36 reference months; the exact table retains the full returned history."
        actions={<span className="bls-clock-label">Revision clock · estimate vintage</span>}
      >
        {rows.length > 0 ? (
          <>
            <div className="bls-chart bls-revision-chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={chartRows}
                  margin={{ top: 14, right: 14, bottom: 10, left: 0 }}
                  accessibilityLayer
                  aria-label="Official payroll total revisions by reference month centered on zero"
                >
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tickFormatter={formatPeriod}
                    stroke="var(--chart-axis-line)"
                    tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
                  />
                  <YAxis
                    width={50}
                    stroke="var(--chart-axis-line)"
                    tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
                  />
                  <ReferenceLine y={0} stroke="var(--field-text-muted)" strokeWidth={1.5} />
                  <Tooltip
                    labelFormatter={(label) => formatPeriod(String(label))}
                    formatter={(value) => [`${formatSigned(Number(value))} thousand jobs`, "Total revision"]}
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                    labelStyle={{ color: "var(--chart-tooltip-label)" }}
                  />
                  <Bar dataKey="chart_total_revision" name="Total revision" radius={[4, 4, 0, 0]}>
                    {chartRows.map((row) => (
                      <Cell
                        key={row.period}
                        fill={(row.chart_total_revision ?? 0) >= 0 ? "var(--field-accent)" : "var(--field-caution)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DataScroller
              label="Exact official payroll revision values"
              className="bls-revision-scroller"
              hint="Scroll horizontally or vertically to inspect the complete returned revision history."
            >
              <table className="bls-table bls-revision-table">
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
            <p className="bls-chart-footnote">Chart window: latest {chartRows.length} reference months. The table preserves all {rows.length} returned months. Values are thousands of payroll jobs; “Unavailable” means that estimate vintage has not been published. These sample-based revisions exclude the separate annual benchmark revision process.</p>
          </>
        ) : <p className="bls-empty-copy">Official payroll revision history is not available in this response.</p>}
      </AccessibleChartFrame>
    </section>
  );
}
