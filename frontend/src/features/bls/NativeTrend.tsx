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
import { formatDateTime, formatFootnotes, formatPeriod, formatSigned, formatValue, isPriceSeries, latestObservation, seriesHasPrimaryData } from "./format";
import type { BlsObservation, BlsSeries } from "./types";

type NativeTrendProps = {
  series: BlsSeries[];
  selectedId: string;
  onSelect: (seriesId: string) => void;
};

type NativeChartRow = Pick<BlsObservation, "period" | "primary_value">;

export function densifyMonthlyPrimaryRows(observations: BlsObservation[]): NativeChartRow[] {
  const valuesByMonth = new Map<number, NativeChartRow>();
  observations.forEach((observation) => {
    const match = /^(\d{4})-(\d{2})/.exec(observation.period);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    valuesByMonth.set(year * 12 + month - 1, {
      period: observation.period,
      primary_value: observation.primary_value,
    });
  });
  const monthIndexes = [...valuesByMonth.keys()].sort((left, right) => left - right);
  if (monthIndexes.length === 0) {
    return observations
      .map(({ period, primary_value }) => ({ period, primary_value }))
      .sort((left, right) => left.period.localeCompare(right.period));
  }
  const rows: NativeChartRow[] = [];
  for (let monthIndex = monthIndexes[0]; monthIndex <= monthIndexes[monthIndexes.length - 1]; monthIndex += 1) {
    const existing = valuesByMonth.get(monthIndex);
    if (existing) {
      rows.push(existing);
      continue;
    }
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12 + 1;
    rows.push({ period: `${year}-${String(month).padStart(2, "0")}-01`, primary_value: null });
  }
  return rows;
}

export default function NativeTrend({ series, selectedId, onSelect }: NativeTrendProps) {
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
  const chartRows = densifyMonthlyPrimaryRows(selected.observations);

  return (
    <section id="bls-native" className="section-anchor">
      <AccessibleChartFrame
        title="Native trend explorer"
        description={`${selected.label} in its published analytical unit. Missing observations remain visible gaps rather than interpolated values.`}
        summary={`${selected.higher_means}. That direction is descriptive; it is not a better/worse judgment.`}
        actions={(
          <label className="bls-select-label">
            <span>Series</span>
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
        )}
        dataLabel={`${selected.short_label} observations by reference period`}
        dataTable={(
          <DataScroller label={`${selected.short_label} native values table`}>
            <table className="bls-table bls-chart-table">
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
                    <td>{formatValue(observation.primary_value)} {observation.primary_value === null ? "" : selected.primary_unit}</td>
                    <td>{formatValue(observation.raw_value)} {observation.raw_value === null ? "" : rawUnit}</td>
                    <td>{formatSigned(observation.change_1m)} {observation.change_1m === null ? "" : selected.change_1m_unit}</td>
                    <td>{formatSigned(observation.change_12m_pct, "%")}</td>
                    <td>{formatValue(observation.first_seen_value)} {observation.first_seen_value === null ? "" : rawUnit}</td>
                    <td>{formatValue(observation.current_value)} {observation.current_value === null ? "" : rawUnit}</td>
                    <td>{formatSigned(observation.revision_delta)} {observation.revision_delta === null ? "" : rawUnit}</td>
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
        <div className="bls-native-read">
          <span>Latest reference period</span>
          <strong>{latest ? formatPeriod(latest.period) : "Unavailable"}</strong>
          <b>{latest ? formatValue(latest.primary_value) : "Unavailable"} <small>{selected.primary_unit}</small></b>
          <em>{latest?.preliminary ? "Preliminary observation" : "Current published observation"}</em>
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
                formatter={(value) => [`${formatValue(Number(value))} ${selected.primary_unit}`, selected.short_label]}
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
