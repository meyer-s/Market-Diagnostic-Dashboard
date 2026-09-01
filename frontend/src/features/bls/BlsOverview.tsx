/*
THESIS: The Overview answers at a glance, with four visuals carrying the evidence that prose previously repeated.
OWN-WORLD: Evidence Field typography, quiet ruled cells, native-unit small multiples, and explicit text states instead of a generic metric-card grid.
STORY: Read one rule-backed state, orient to the next scheduled event, verify four visual observations, then scan revisions.
FIRST VIEWPORT: A concise conclusion and the next release lead into a two-by-two evidence matrix; proof workspaces remain one action away.
FORM: Operate-mode answer sheet ordered State → Next release → Visual matrix → Revision strip.
*/

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import DataScroller from "../../components/ui/DataScroller";
import {
  buildBlsOverviewModel,
  type BlsOverviewTarget,
  type OverviewIndicator,
  type OverviewRevisionSummary,
} from "./blsOverviewModel";
import { clockTime, formatDate, formatPeriod, formatSigned, formatValue } from "./format";
import type { BlsLensResponse } from "./types";

export type BlsOverviewProps = {
  data: BlsLensResponse;
  onNavigate: (target: BlsOverviewTarget, seriesId?: string) => void;
};

function metricValue(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? "Unavailable" : `${formatValue(value, 2)} ${unit}`.trim();
}

function driverLine(briefLine: string): string {
  const stateSeparator = briefLine.indexOf(". ");
  return stateSeparator >= 0 ? briefLine.slice(stateSeparator + 2) : briefLine;
}

function indicatorStatusLabel(indicator: OverviewIndicator): string {
  if (indicator.current?.primary_value === null || indicator.current?.primary_value === undefined) return "Unavailable";
  if (indicator.state === "prior_unavailable") return "Prior unavailable";

  const conciseState = indicator.trendStateLabel
    .replace(/^Payroll gains /, "")
    .replace(/^Unemployment /, "")
    .replace(/^Wage growth /, "")
    .replace(/^Openings (?:level|rate) /, "");
  const label = conciseState.charAt(0).toUpperCase() + conciseState.slice(1);
  return indicator.current.preliminary || indicator.trendProvisional ? `${label} · Preliminary` : label;
}

function RecentValuesTable({ indicator }: { indicator: OverviewIndicator }) {
  return (
    <DataScroller label={`${indicator.role} recent observation values`} hint="">
      <table className="bls-overview-values-table">
        <caption className="sr-only">{indicator.role} recent primary values by reference period</caption>
        <thead>
          <tr>
            <th scope="col">Reference period</th>
            <th scope="col">Primary value</th>
          </tr>
        </thead>
        <tbody>
          {indicator.trendPoints.slice(-12).map((point) => (
            <tr key={point.period}>
              <th scope="row">{formatPeriod(point.period)}</th>
              <td>{metricValue(point.value, indicator.series.primary_unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataScroller>
  );
}

function IndicatorFigure({ indicator }: { indicator: OverviewIndicator }) {
  const canPlot = indicator.plottablePointCount >= 8;
  const currentValue = indicator.current?.primary_value ?? null;
  const headingId = `bls-overview-indicator-${indicator.series.series_id}`;

  return (
    <figure className="bls-overview-metric" aria-labelledby={headingId}>
      <figcaption className="bls-overview-metric-caption">
        <div className="bls-overview-metric-title">
          <h4 id={headingId}>{indicator.role}</h4>
          <span className="bls-status-label">{indicatorStatusLabel(indicator)}</span>
        </div>

        <div className="bls-overview-metric-reading">
          <div className="bls-overview-primary-value">
            <strong>{currentValue === null ? "—" : formatValue(currentValue, 2)}</strong>
            {currentValue === null ? null : <span>{indicator.series.primary_unit}</span>}
          </div>
          <dl className="bls-overview-metric-meta">
            <div>
              <dt className="sr-only">Change from prior reference period</dt>
              <dd>
                <strong>{indicator.delta === null ? "—" : formatSigned(indicator.delta, "", 3)}</strong>
                {indicator.delta === null ? null : <span>{indicator.deltaUnit}</span>}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Reference period</dt>
              <dd>{indicator.current ? formatPeriod(indicator.current.period) : "—"}</dd>
            </div>
          </dl>
        </div>
      </figcaption>

      {canPlot ? (
        <div className="bls-overview-metric-chart">
          <ResponsiveContainer width="100%" height={120} minWidth={0}>
            <LineChart
              data={indicator.trendPoints}
              margin={{ top: 8, right: 4, bottom: 2, left: 4 }}
              accessibilityLayer
              aria-label={`${indicator.role} native-unit trend across the latest returned reference periods`}
            >
              <XAxis
                dataKey="period"
                tickFormatter={formatPeriod}
                interval="preserveStartEnd"
                minTickGap={70}
                axisLine={{ stroke: "var(--chart-axis-line)" }}
                tickLine={false}
                tick={{ fill: "var(--chart-axis-tick)", fontSize: 12 }}
              />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                labelFormatter={(label) => formatPeriod(String(label))}
                formatter={(value) => [`${formatValue(Number(value), 2)} ${indicator.series.primary_unit}`, indicator.role]}
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                labelStyle={{ color: "var(--chart-tooltip-label)" }}
              />
              <Line
                type="linear"
                dataKey="value"
                name={indicator.role}
                stroke="var(--field-accent)"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bls-overview-trend-empty">
          Trend unavailable · {indicator.plottablePointCount} finite observation{indicator.plottablePointCount === 1 ? "" : "s"}
        </div>
      )}

      <details className="bls-overview-values-disclosure">
        <summary>Recent values</summary>
        <RecentValuesTable indicator={indicator} />
      </details>
    </figure>
  );
}

function RevisionSummary({
  summary,
  onNavigate,
}: {
  summary: OverviewRevisionSummary;
  onNavigate: BlsOverviewProps["onNavigate"];
}) {
  return (
    <section className="bls-overview-revisions" aria-labelledby="bls-overview-revisions-title">
      <header>
        <h3 id="bls-overview-revisions-title">Payroll revisions</h3>
        <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("revisions")}>View revision history</button>
      </header>
      <dl className="bls-overview-revision-ledger">
        <div>
          <dt>Latest</dt>
          <dd className={summary.latestDelta !== null && Math.abs(summary.latestDelta) >= 1e-9 ? "bls-revision-value" : undefined}>
            {summary.latestDelta === null ? "Unavailable" : `${formatSigned(summary.latestDelta)} ${summary.unit}`}
          </dd>
          <dd className="bls-overview-revision-note">
            {summary.latestStageLabel}{summary.latestPeriod ? ` · ${formatPeriod(summary.latestPeriod)}` : ""}
          </dd>
        </div>
        <div>
          <dt>Net three months</dt>
          <dd className={summary.netThreeMonth !== null && Math.abs(summary.netThreeMonth) >= 1e-9 ? "bls-revision-value" : undefined}>
            {summary.netThreeMonth === null ? "Unavailable" : `${formatSigned(summary.netThreeMonth)} ${summary.unit}`}
          </dd>
        </div>
        <div>
          <dt>Current streak</dt>
          <dd className={summary.streakCount > 0 ? "bls-revision-value" : undefined}>
            {summary.streakCount === 0 ? "No streak" : `${summary.streakCount} ${summary.streakDirection} revision${summary.streakCount === 1 ? "" : "s"}`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default function BlsOverview({ data, onNavigate }: BlsOverviewProps) {
  const model = useMemo(() => buildBlsOverviewModel(data), [data]);
  const nextRelease = model.nextRelease;

  return (
    <div className="page-stack">
      <section className="bls-ledger" aria-labelledby="bls-overview-title">
        <header className="bls-section-header">
          <h2 id="bls-overview-title">Labor-market overview</h2>
          <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("methods")}>How calculated</button>
        </header>

        <div className="bls-overview-current" aria-labelledby="bls-overview-brief-title">
          <div>
            <h3 id="bls-overview-brief-title" className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[var(--field-text-subtle)]">Current read</h3>
            <strong className="mt-1 block text-3xl font-bold tracking-[-0.025em] text-[var(--field-text)]">{model.overall.label}</strong>
            {model.overall.provisional ? <span className="bls-status-label mt-2">Provisional · preliminary anchor</span> : null}
          </div>
          <p className="bls-overview-answer">{driverLine(model.briefLines[0] ?? model.overall.explanation)}</p>
        </div>

        <section className="mt-5 border-b border-[var(--field-border-strong)] pb-5" aria-labelledby="bls-overview-calendar-title">
          {nextRelease ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(180px,0.65fr)_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="bls-overview-calendar-title" className="m-0 text-base font-bold text-[var(--field-text-subtle)]">Next release</h3>
                  <span className="bls-status-label">Scheduled</span>
                </div>
                <p className="m-0 mt-1 text-xl font-bold text-[var(--field-text)]">{nextRelease.label}</p>
              </div>
              <time dateTime={nextRelease.entry.scheduled_at} className="grid gap-1 text-[var(--field-text)]">
                <strong className="text-lg">{formatDate(nextRelease.entry.scheduled_at)}</strong>
                <span className="text-sm font-semibold text-[var(--field-text-muted)]">{clockTime(nextRelease.entry)}</span>
              </time>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {nextRelease.calendarHref ? (
                  <a
                    className="field-button field-button-primary"
                    href={nextRelease.calendarHref}
                    download={`bls-${nextRelease.entry.report_id}.ics`}
                  >
                    Add to calendar
                  </a>
                ) : <span className="text-xs font-semibold text-[var(--field-text-subtle)]">Calendar file unavailable</span>}
                <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("calendar")}>Full calendar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 id="bls-overview-calendar-title" className="m-0 text-base font-bold text-[var(--field-text-subtle)]">Next release</h3>
                <p className="m-0 mt-1 text-sm font-semibold text-[var(--field-text-muted)]">No future scheduled event is available.</p>
              </div>
              <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("calendar")}>Full calendar</button>
            </div>
          )}
        </section>

        <section className="bls-overview-evidence" aria-labelledby="bls-overview-indicators-title">
          <header className="bls-section-header">
            <h3 id="bls-overview-indicators-title">Four key measures</h3>
            <span className="bls-overview-window">Latest 24 reference months</span>
          </header>

          {model.indicators.length > 0 ? (
            <div id="bls-overview-trends-title" className="bls-overview-matrix">
              {model.indicators.map((indicator) => (
                <IndicatorFigure key={indicator.series.series_id} indicator={indicator} />
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm leading-6 text-[var(--field-text-muted)]">No preferred labor indicator series is present in this response. No substitute inflation series is inferred.</p>
          )}
        </section>

        <RevisionSummary summary={model.revisions} onNavigate={onNavigate} />
      </section>
    </div>
  );
}
