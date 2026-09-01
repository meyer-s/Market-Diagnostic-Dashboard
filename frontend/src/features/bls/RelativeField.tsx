import { useMemo } from "react";
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
import { formatPeriod, formatValue, lineStyleForSeries, seriesHasPrimaryData } from "./format";
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

function relativeRows(series: BlsSeries[]): RelativeRow[] {
  const rows = new Map<string, RelativeRow>();
  series.forEach((item) => {
    item.observations.forEach((observation) => {
      const row = rows.get(observation.period) ?? { period: observation.period };
      row[item.series_id] = observation.relative_percentile;
      rows.set(observation.period, row);
    });
  });
  return [...rows.values()].sort((left, right) => left.period.localeCompare(right.period));
}

export default function RelativeField({ series, selectedIds, onToggle }: RelativeFieldProps) {
  const selectedSeries = useMemo(
    () => selectedIds
      .map((id) => series.find((item) => item.series_id === id))
      .filter((item): item is BlsSeries => Boolean(item) && seriesHasPrimaryData(item as BlsSeries)),
    [selectedIds, series],
  );
  const stylesById = useMemo(
    () => new Map(series.map((item, index) => (
      [item.series_id, lineStyleForSeries(item, index)] as const
    ))),
    [series],
  );
  const rows = useMemo(() => relativeRows(selectedSeries), [selectedSeries]);
  const endpoints = useMemo(() => selectedSeries.map((item) => {
    const endpoint = [...item.observations]
      .reverse()
      .find((observation) => observation.relative_percentile !== null);
    return { item, period: endpoint?.period ?? null };
  }), [selectedSeries]);
  const latestPeriod = endpoints
    .map(({ period }) => period)
    .filter((period): period is string => Boolean(period))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? null;
  const endpointsVary = new Set(endpoints.map(({ period }) => period).filter(Boolean)).size > 1;

  return (
    <section id="bls-relative" className="section-anchor">
      <AccessibleChartFrame
        title="Relative Field"
        description="A common 0–100 position for unlike measures. Each point is that series' trailing five-year percentile; 50 is its own recent midpoint."
        summary="Higher and lower describe relative position, not better and worse. Price measures use gold; labor measures use blue. Line pattern and labeled selectors carry identity beyond color."
        actions={(
          <span className="bls-clock-label">Observation clock · reference period</span>
        )}
        dataLabel="Relative percentile values by reference period"
        dataTable={(
          <DataScroller label="Relative percentile values table" hint="Scroll horizontally to inspect every selected series.">
            <table className="bls-table bls-chart-table">
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
                      <td key={item.series_id}>{formatValue(row[item.series_id] as number | null, 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataScroller>
        )}
        className="bls-relative-frame"
      >
        <div className="bls-series-selector" role="group" aria-label="Relative Field series; choose up to five">
          {series.map((item, index) => {
            const selected = selectedIds.includes(item.series_id);
            const usable = seriesHasPrimaryData(item);
            const style = stylesById.get(item.series_id) ?? lineStyleForSeries(item, index);
            const atLimit = !selected && selectedIds.length >= 5;
            return (
              <button
                key={item.series_id}
                type="button"
                className="bls-series-toggle"
                aria-pressed={usable && selected}
                data-unavailable={usable ? undefined : "true"}
                disabled={!usable || atLimit}
                onClick={() => onToggle(item.series_id)}
                title={!usable ? "No primary observations are available for this series." : atLimit ? "Deselect a series before adding another." : undefined}
              >
                <svg
                  className="bls-line-key"
                  aria-hidden="true"
                  viewBox="0 0 30 8"
                  focusable="false"
                >
                  <line
                    x1="1"
                    x2="29"
                    y1="4"
                    y2="4"
                    stroke={style.color}
                    strokeDasharray={style.dash}
                    strokeOpacity={style.opacity}
                    strokeWidth="3"
                  />
                </svg>
                <span>{item.short_label}</span>
                <small>{!usable ? "Unavailable" : selected ? "Shown" : "Available"}</small>
              </button>
            );
          })}
          <p className="bls-selector-limit" aria-live="polite">{selectedIds.length} of 5 series shown</p>
        </div>

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
                <ReferenceLine y={50} stroke="var(--field-border-strong)" strokeDasharray="4 4" />
                <Tooltip
                  labelFormatter={(label) => formatPeriod(String(label))}
                  formatter={(value, name) => [`${formatValue(Number(value), 0)}th percentile`, String(name)]}
                  contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                  labelStyle={{ color: "var(--chart-tooltip-label)" }}
                />
                {selectedSeries.map((item) => {
                  const style = stylesById.get(item.series_id) ?? lineStyleForSeries(item, 0);
                  return (
                    <Line
                      key={item.series_id}
                      type="monotone"
                      dataKey={item.series_id}
                      name={item.short_label}
                      stroke={style.color}
                      strokeDasharray={style.dash}
                      strokeOpacity={style.opacity}
                      strokeWidth={2.4}
                      dot={false}
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
          <div className="bls-endpoint-ledger" role="group" aria-label="Selected series coverage endpoints">
            <span>Selected series endpoints</span>
            <dl>
              {endpoints.map(({ item, period }) => (
                <div key={item.series_id}>
                  <dt>{item.short_label}</dt>
                  <dd>{period ? formatPeriod(period) : "Percentile unavailable"}</dd>
                </div>
              ))}
            </dl>
            {endpointsVary ? <p>Reference-period endpoints differ; the ledger identifies each series’ last plotted point.</p> : null}
          </div>
        ) : null}
        {latestPeriod ? <p className="bls-chart-footnote">Latest period among selected series: {formatPeriod(latestPeriod)}.</p> : null}
      </AccessibleChartFrame>
    </section>
  );
}
