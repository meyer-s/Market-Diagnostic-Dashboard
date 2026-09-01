import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AccessibleChartFrame from "../../components/ui/AccessibleChartFrame";
import DataScroller from "../../components/ui/DataScroller";
import { formatDateTime, formatFootnotes, formatPeriod, formatSigned, formatValue, isPriceSeries, latestObservation, primaryDeltaUnit, seriesHasPrimaryData } from "./format";
import { densifyMonthlyRows } from "./monthlyRows";
import type { BlsObservation, BlsSeries } from "./types";

type NativeTrendProps = {
  series: BlsSeries[];
  selectedId: string;
  onSelect: (seriesId: string) => void;
};

type NativeChartRow = Pick<BlsObservation, "period" | "primary_value">;

export function densifyMonthlyPrimaryRows(observations: BlsObservation[]): NativeChartRow[] {
  return densifyMonthlyRows(
    observations.map((observation) => ({
      period: observation.period,
      primary_value: observation.primary_value,
    })),
    (period) => ({ period, primary_value: null }),
  );
}

export default function NativeTrend({ series, selectedId, onSelect }: NativeTrendProps) {
  const [windowYears, setWindowYears] = useState<3 | 5 | 10>(3);
  const usableSeries = series.filter(seriesHasPrimaryData);
  const selected = usableSeries.find((item) => item.series_id === selectedId) ?? usableSeries[0];
  if (!selected) {
    return (
      <section id="bls-native" className="section-anchor">
        <AccessibleChartFrame
          title="Native trend explorer"
          description="No returned series contains a primary observation, so there is no native-unit trend to draw."
          summary="Unavailable series remain listed in the response audit; refresh after source coverage recovers."
        >
          <p className="bls-empty-copy">Native trend unavailable because every returned series lacks primary values.</p>
        </AccessibleChartFrame>
      </section>
    );
  }

  const color = isPriceSeries(selected) ? "var(--field-caution)" : "var(--field-accent)";
  const rawUnit = selected.raw_unit ?? selected.unit ?? "native units";
  const latest = latestObservation(selected);
  const orderedObservations = [...selected.observations].sort((left, right) => left.period.localeCompare(right.period));
  const latestIndex = latest ? orderedObservations.findIndex((observation) => observation.period === latest.period) : -1;
  const adjacentPrior = latestIndex > 0 ? orderedObservations[latestIndex - 1] : null;
  const previous = adjacentPrior?.primary_value !== null && adjacentPrior?.primary_value !== undefined ? adjacentPrior : null;
  const primaryDelta = latest?.primary_value !== null && latest?.primary_value !== undefined
    && previous?.primary_value !== null && previous?.primary_value !== undefined
    ? latest.primary_value - previous.primary_value
    : null;
  const direction = primaryDelta === null
    ? "Direction unavailable"
    : primaryDelta > 0
      ? "Higher than the prior observation"
      : primaryDelta < 0
        ? "Lower than the prior observation"
        : "Unchanged from the prior observation";
  const allChartRows = densifyMonthlyPrimaryRows(selected.observations);
  const latestPeriod = allChartRows.at(-1)?.period;
  const cutoff = latestPeriod ? new Date(`${latestPeriod.slice(0, 10)}T00:00:00Z`) : null;
  cutoff?.setUTCFullYear(cutoff.getUTCFullYear() - windowYears);
  const cutoffPeriod = cutoff?.toISOString().slice(0, 10) ?? null;
  const chartRows = cutoffPeriod
    ? allChartRows.filter((row) => row.period >= cutoffPeriod)
    : allChartRows;

  return (
    <section id="bls-native" className="section-anchor">
      <AccessibleChartFrame
        title="Native trend explorer"
        description={`${selected.label} in its published analytical unit. Missing observations remain visible gaps rather than interpolated values.`}
        actions={(
          <div className="bls-native-actions">
            <label className="bls-select-label">
              <span>Indicator</span>
              <select value={selected.series_id} onChange={(event) => onSelect(event.target.value)}>
                {series.map((item) => {
                  const usable = seriesHasPrimaryData(item);
                  return (
                    <option key={item.series_id} value={item.series_id} disabled={!usable}>
                      {item.short_label}{usable ? "" : " — unavailable"}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        )}
        dataLabel={`${selected.short_label} observations by reference period`}
        dataContentFocusable={false}
        dataTable={(
          <DataScroller label={`${selected.short_label} native values table`}>
            <table className="bls-table bls-chart-table">
              <caption className="sr-only">{selected.short_label} native values, revisions, timestamps, and footnotes by reference period</caption>
              <thead>
                <tr>
                  <th scope="col">Reference period</th>
                  <th scope="col">Primary measure</th>
                  <th scope="col">Raw published value</th>
                  <th scope="col">Raw 1-month change</th>
                  <th scope="col">Raw 12-month change</th>
                  <th scope="col">First seen</th>
                  <th scope="col">Current raw value</th>
                  <th scope="col">Observed revision</th>
                  <th scope="col">Vintage state</th>
                  <th scope="col">Tracking timestamps</th>
                  <th scope="col">BLS footnotes</th>
                </tr>
              </thead>
              <tbody>
                {selected.observations.map((observation) => (
                  <tr key={observation.period}>
                    <th scope="row">{formatPeriod(observation.period)}</th>
                    <td>{formatValue(observation.primary_value, 3)} {observation.primary_value === null ? "" : selected.primary_unit}</td>
                    <td>{formatValue(observation.raw_value, 3)} {observation.raw_value === null ? "" : rawUnit}</td>
                    <td>{formatSigned(observation.change_1m, "", 3)} {observation.change_1m === null ? "" : selected.change_1m_unit}</td>
                    <td>{formatSigned(observation.change_12m_pct, "%", 3)}</td>
                    <td>{formatValue(observation.first_seen_value, 3)} {observation.first_seen_value === null ? "" : rawUnit}</td>
                    <td>{formatValue(observation.current_value, 3)} {observation.current_value === null ? "" : rawUnit}</td>
                    <td>{formatSigned(observation.revision_delta, "", 3)} {observation.revision_delta === null ? "" : rawUnit}</td>
                    <td>{observation.preliminary ? "Preliminary" : observation.revision_count > 0 ? `${observation.revision_count} revision${observation.revision_count === 1 ? "" : "s"}` : "Current published value"}</td>
                    <td>
                      {observation.first_seen_at ? `First ${formatDateTime(observation.first_seen_at)}` : "First-seen time unavailable"}
                      {observation.last_seen_at ? ` · Current ${formatDateTime(observation.last_seen_at)}` : ""}
                    </td>
                    <td>{formatFootnotes(observation.footnotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataScroller>
        )}
      >
        <dl className="bls-native-read" aria-label={`${selected.short_label} current observation summary`}>
          <div>
            <dt>Current observation</dt>
            <dd>{latest ? formatValue(latest.primary_value, 3) : "Unavailable"} <small>{selected.primary_unit}</small></dd>
          </div>
          <div>
            <dt>Change from adjacent prior</dt>
            <dd>{formatSigned(primaryDelta, "", 3)} <small>{primaryDelta === null ? "" : primaryDeltaUnit(selected)}</small></dd>
          </div>
          <div>
            <dt>Reference period</dt>
            <dd>{latest ? formatPeriod(latest.period) : "Unavailable"}</dd>
          </div>
        </dl>
        <details className="chart-frame-data bls-native-context">
          <summary>More context</summary>
          <div className="chart-frame-data-content">
            <p className="bls-chart-footnote">{selected.higher_means}. Direction is descriptive, not a better/worse judgment.</p>
            <dl className="bls-native-read" aria-label={`${selected.short_label} additional observation context`}>
              <div>
                <dt>Five-year position</dt>
                <dd>{latest?.relative_percentile === null || latest?.relative_percentile === undefined ? "Unavailable" : `${formatValue(latest.relative_percentile, 0)}th percentile`}</dd>
              </div>
              <div>
                <dt>Direction</dt>
                <dd>{direction}</dd>
              </div>
              <div>
                <dt>Vintage state</dt>
                <dd>{latest?.preliminary ? "Preliminary observation" : "Current published observation"}</dd>
              </div>
            </dl>
          </div>
        </details>
        <div className="bls-window-control bls-native-window" role="group" aria-label="Native trend timeframe">
          {([3, 5, 10] as const).map((years) => (
            <button key={years} type="button" aria-pressed={windowYears === years} onClick={() => setWindowYears(years)}>
              {years === 10 ? "Full history" : `${years} years`}
            </button>
          ))}
        </div>
        <div className="bls-chart bls-native-chart">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              data={chartRows}
              margin={{ top: 14, right: 14, bottom: 10, left: 0 }}
              accessibilityLayer
              aria-label={`${selected.short_label} in native units by reference period with missing values preserved as gaps`}
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
                width={52}
                domain={["auto", "auto"]}
                stroke="var(--chart-axis-line)"
                tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
              />
              <Tooltip
                labelFormatter={(label) => formatPeriod(String(label))}
                formatter={(value) => [`${formatValue(Number(value), 3)} ${selected.primary_unit}`, selected.short_label]}
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                labelStyle={{ color: "var(--chart-tooltip-label)" }}
              />
              <Line
                type="monotone"
                dataKey="primary_value"
                name={selected.short_label}
                stroke={color}
                strokeWidth={2.6}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </AccessibleChartFrame>
    </section>
  );
}
