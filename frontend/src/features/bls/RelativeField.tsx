import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AccessibleChartFrame from "../../components/ui/AccessibleChartFrame";
import DataScroller from "../../components/ui/DataScroller";
import { formatPeriod, formatValue, isPriceSeries, seriesHasPrimaryData } from "./format";
import { densifyMonthlyRows } from "./monthlyRows";
import type { BlsSeries } from "./types";

type RelativeFieldProps = {
  series: BlsSeries[];
  selectedIds: string[];
  onToggle: (seriesId: string) => void;
};

type RelativeRow = {
  period: string;
  [seriesId: string]: string | number | null;
};

type WindowYears = 3 | 5 | 10;

const WINDOW_OPTIONS: Array<{ value: WindowYears; label: string }> = [
  { value: 3, label: "3 years" },
  { value: 5, label: "5 years" },
  { value: 10, label: "Full history" },
];

export function buildRelativeRows(series: BlsSeries[]): RelativeRow[] {
  const rows = new Map<string, RelativeRow>();
  series.forEach((item) => {
    item.observations.forEach((observation) => {
      const row = rows.get(observation.period) ?? { period: observation.period };
      row[item.series_id] = observation.relative_percentile;
      rows.set(observation.period, row);
    });
  });
  const dense = densifyMonthlyRows(
    [...rows.values()],
    (period) => ({ period }),
  );
  return dense.map((row) => {
    const completed: RelativeRow = { ...row };
    series.forEach((item) => {
      if (!(item.series_id in completed)) completed[item.series_id] = null;
    });
    return completed;
  });
}

export default function RelativeField({ series, selectedIds, onToggle }: RelativeFieldProps) {
  const [windowYears, setWindowYears] = useState<WindowYears>(3);
  const selectedSeries = useMemo(
    () => selectedIds
      .map((id) => series.find((item) => item.series_id === id))
      .filter((item): item is BlsSeries => Boolean(item) && seriesHasPrimaryData(item as BlsSeries)),
    [selectedIds, series],
  );
  const allRows = useMemo(() => buildRelativeRows(selectedSeries), [selectedSeries]);
  const rows = useMemo(() => {
    const latest = allRows.at(-1)?.period;
    if (!latest) return allRows;
    const cutoff = new Date(`${latest.slice(0, 10)}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - windowYears);
    const cutoffPeriod = cutoff.toISOString().slice(0, 10);
    return allRows.filter((row) => row.period >= cutoffPeriod);
  }, [allRows, windowYears]);
  const endpoints = useMemo(() => selectedSeries.map((item) => {
    const visiblePeriods = new Set(rows.map((row) => row.period));
    const visible = item.observations
      .filter((observation) => visiblePeriods.has(observation.period))
      .sort((left, right) => left.period.localeCompare(right.period));
    let endpointIndex = -1;
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      if (visible[index].relative_percentile === null) continue;
      endpointIndex = index;
      break;
    }
    const endpoint = endpointIndex >= 0 ? visible[endpointIndex] : undefined;
    const prior = endpointIndex > 0 ? visible[endpointIndex - 1] : undefined;
    return {
      item,
      period: endpoint?.period ?? null,
      percentile: endpoint?.relative_percentile ?? null,
      move: endpoint?.relative_percentile !== null && endpoint?.relative_percentile !== undefined
        && prior?.relative_percentile !== null && prior?.relative_percentile !== undefined
        ? endpoint.relative_percentile - prior.relative_percentile
        : null,
    };
  }), [rows, selectedSeries]);
  const endpointsVary = new Set(endpoints.map(({ period }) => period).filter(Boolean)).size > 1;

  return (
    <section id="bls-relative" className="section-anchor">
      <AccessibleChartFrame
        title="Relative comparison"
        description="Each measure is ranked against its own trailing five-year history: 0 = low, 50 = midpoint, and 100 = high—not better or worse."
        actions={(
          <span className="bls-clock-label">Observation clock · reference period</span>
        )}
        dataLabel="Relative percentile values by reference period"
        dataContentFocusable={false}
        dataTable={(
          <DataScroller label="Relative percentile values table" hint="Scroll horizontally to inspect both selected series.">
            <table className="bls-table bls-chart-table">
              <caption className="sr-only">Selected BLS measures by relative percentile and reference period</caption>
              <thead>
                <tr>
                  <th scope="col">Reference period</th>
                  {selectedSeries.map((item) => <th scope="col" key={item.series_id}>{item.short_label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.period}>
                    <th scope="row">{formatPeriod(row.period)}</th>
                    {selectedSeries.map((item) => (
                      <td key={item.series_id}>{formatValue(row[item.series_id] as number | null, 1)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataScroller>
        )}
        className="bls-relative-frame"
      >
        <div className="bls-trend-toolbar">
          <div className="bls-window-control" role="group" aria-label="Relative comparison timeframe">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={windowYears === option.value}
                onClick={() => setWindowYears(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <details className="bls-compare-disclosure">
          <summary>Compare indicators · {selectedIds.length} of 2 selected</summary>
          <div className="bls-series-selector" role="group" aria-label="Relative comparison series; choose up to two">
            {series.map((item) => {
              const selected = selectedIds.includes(item.series_id);
              const usable = seriesHasPrimaryData(item);
              const atLimit = !selected && selectedIds.length >= 2;
              const selectedIndex = selectedIds.indexOf(item.series_id);
              return (
                <button
                  key={item.series_id}
                  type="button"
                  className="bls-series-toggle"
                  aria-pressed={usable && selected}
                  data-unavailable={usable ? undefined : "true"}
                  disabled={!usable || atLimit}
                  onClick={() => onToggle(item.series_id)}
                  title={!usable ? "No primary observations are available for this series." : atLimit ? "Deselect an indicator before adding another." : undefined}
                >
                  <span className="bls-selector-name">
                    <i data-marker={selectedIndex === 1 ? "hollow" : "line"} aria-hidden="true" />
                    {item.short_label}
                  </span>
                  <small>{!usable ? "Unavailable" : selected ? selectedIndex === 1 ? "Shown · hollow points" : "Shown · solid line" : "Available"}</small>
                </button>
              );
            })}
            <p className="bls-selector-limit" aria-live="polite">{selectedIds.length} of 2 indicators shown</p>
          </div>
        </details>

        {rows.length > 0 ? (
          <div className="bls-chart bls-relative-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                data={rows}
                margin={{ top: 14, right: 12, bottom: 10, left: 0 }}
                accessibilityLayer
                aria-label="Selected BLS measures by trailing five-year relative percentile and reference period"
              >
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="period"
                  tickFormatter={formatPeriod}
                  minTickGap={40}
                  stroke="var(--chart-axis-line)"
                  tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  width={34}
                  stroke="var(--chart-axis-line)"
                  tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
                />
                <ReferenceLine y={0} stroke="var(--field-border-strong)" />
                <ReferenceLine y={50} stroke="var(--field-text-subtle)" strokeDasharray="4 4" />
                <Tooltip
                  labelFormatter={(label) => formatPeriod(String(label))}
                  formatter={(value, name) => [`${formatValue(Number(value), 1)}th percentile`, String(name)]}
                  contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                  labelStyle={{ color: "var(--chart-tooltip-label)" }}
                />
                {selectedSeries.map((item, index) => {
                  const color = isPriceSeries(item)
                    ? "var(--field-caution)"
                    : index === 0 ? "var(--field-accent)" : "var(--field-accent-strong)";
                  return (
                    <Line
                      key={item.series_id}
                      type="monotone"
                      dataKey={item.series_id}
                      name={item.short_label}
                      stroke={color}
                      strokeWidth={index === 0 ? 2.8 : 2.2}
                      dot={index === 0 ? false : { r: 2.2, fill: "var(--field-surface)", stroke: color, strokeWidth: 1.4 }}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="bls-empty-copy">Select at least one series to draw the relative field.</p>}
        {endpoints.length > 0 ? (
          <div className="bls-endpoint-ledger" role="group" aria-label="Direct labels for selected series endpoints">
            <span>Latest points</span>
            <dl>
              {endpoints.map(({ item, period, percentile, move }) => (
                <div key={item.series_id}>
                  <dt>{item.short_label}</dt>
                  <dd>
                    {percentile === null ? "Percentile unavailable" : `${formatValue(percentile, 1)}th percentile`}
                    {period ? ` · ${formatPeriod(period)}` : ""}
                    {move === null ? "" : ` · ${move > 0 ? "+" : ""}${formatValue(move, 1)} points`}
                  </dd>
                </div>
              ))}
            </dl>
            {endpointsVary ? <p>Reference-period endpoints differ; the ledger identifies each series’ last plotted point.</p> : null}
          </div>
        ) : null}
      </AccessibleChartFrame>
    </section>
  );
}
