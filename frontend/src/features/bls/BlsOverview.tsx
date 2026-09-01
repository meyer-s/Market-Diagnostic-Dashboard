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

function revisionTone(direction: OverviewRevisionSummary["latestDirection"] | OverviewRevisionSummary["streakDirection"]): string {
  if (direction === "upward") return "bls-positive";
  if (direction === "downward") return "bls-negative";
  return "";
}

function signedTone(value: number | null): string {
  if (value === null || Math.abs(value) < 1e-9) return "";
  return value > 0 ? "bls-positive" : "bls-negative";
}

function driverLine(briefLine: string): string {
  const stateSeparator = briefLine.indexOf(". ");
  return stateSeparator >= 0 ? briefLine.slice(stateSeparator + 2) : briefLine;
}

function RecentValuesTable({ indicator }: { indicator: OverviewIndicator }) {
  return (
    <DataScroller label={`${indicator.role} recent observation values`} hint="">
      <table className="w-full min-w-[320px] border-collapse text-left text-[13px] text-[var(--field-text-muted)]">
        <caption className="sr-only">{indicator.role} recent primary values by reference period</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-[var(--field-border)] px-2 py-2 text-xs font-bold text-[var(--field-text-subtle)]">Reference period</th>
            <th scope="col" className="border-b border-[var(--field-border)] px-2 py-2 text-xs font-bold text-[var(--field-text-subtle)]">Primary value</th>
          </tr>
        </thead>
        <tbody>
          {indicator.trendPoints.slice(-12).map((point) => (
            <tr key={point.period}>
              <th scope="row" className="border-b border-[var(--field-border)] px-2 py-2 font-semibold text-[var(--field-text)]">{formatPeriod(point.period)}</th>
              <td className="border-b border-[var(--field-border)] px-2 py-2">{metricValue(point.value, indicator.series.primary_unit)}</td>
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

  return (
    <figure className="m-0 min-w-0 border-t border-[var(--field-border)] py-5">
      <figcaption className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h4 className="m-0 text-base font-bold text-[var(--field-text)]">{indicator.role}</h4>
          <span className="bls-status-label">{indicator.trendStateLabel}</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
          <div>
            <strong className="block text-3xl font-bold tracking-[-0.025em] text-[var(--field-text)]">
              {currentValue === null ? "Unavailable" : formatValue(currentValue, 2)}
            </strong>
            <span className="text-xs font-semibold text-[var(--field-text-muted)]">
              {currentValue === null ? "Primary value unavailable" : indicator.series.primary_unit}
            </span>
          </div>
          <dl className="m-0 grid gap-1 text-right text-xs">
            <div>
              <dt className="sr-only">Change from prior reference period</dt>
              <dd className="m-0 font-bold text-[var(--field-text)]">
                {indicator.delta === null ? "Δ unavailable" : `Δ ${formatSigned(indicator.delta, "", 3)} ${indicator.deltaUnit}`}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Reference period</dt>
              <dd className="m-0 font-semibold text-[var(--field-text-subtle)]">
                {indicator.current ? formatPeriod(indicator.current.period) : "Period unavailable"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold text-[var(--field-text-subtle)]">{indicator.stateLabel}</span>
          {indicator.current?.preliminary || indicator.trendProvisional ? <span className="text-xs font-bold text-[var(--field-caution)]">Preliminary</span> : null}
        </div>
      </figcaption>

      {canPlot ? (
        <div className="mt-2 min-w-0">
          <ResponsiveContainer width="100%" height={128} minWidth={0}>
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
        <div className="mt-3 flex min-h-[128px] items-center border-y border-[var(--field-border)] py-4 text-sm leading-6 text-[var(--field-text-muted)]">
          Trend unavailable · {indicator.plottablePointCount} finite observation{indicator.plottablePointCount === 1 ? "" : "s"}
        </div>
      )}

      <details className="mt-3 border-t border-[var(--field-border)] pt-2">
        <summary className="min-h-[44px] cursor-pointer py-3 text-sm font-bold text-[var(--field-accent-strong)]">Recent values</summary>
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
    <section className="mt-8 border-y border-[var(--field-border-strong)] py-4" aria-labelledby="bls-overview-revisions-title">
      <div className="grid gap-4 md:grid-cols-[minmax(140px,0.65fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] md:items-center">
        <h3 id="bls-overview-revisions-title" className="m-0 text-base font-bold text-[var(--field-text)]">Payroll revisions</h3>
        <dl className="m-0">
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Latest</dt>
          <dd className={`m-0 mt-1 font-bold text-[var(--field-text)] ${revisionTone(summary.latestDirection)}`}>
            {summary.latestDelta === null ? "Unavailable" : `${formatSigned(summary.latestDelta)} ${summary.unit}`}
          </dd>
          <dd className="m-0 mt-1 text-xs font-semibold text-[var(--field-text-subtle)]">
            {summary.latestStageLabel}{summary.latestPeriod ? ` · ${formatPeriod(summary.latestPeriod)}` : ""}
          </dd>
        </dl>
        <dl className="m-0">
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Net three months</dt>
          <dd className={`m-0 mt-1 font-bold text-[var(--field-text)] ${signedTone(summary.netThreeMonth)}`}>
            {summary.netThreeMonth === null ? "Unavailable" : `${formatSigned(summary.netThreeMonth)} ${summary.unit}`}
          </dd>
        </dl>
        <dl className="m-0">
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Current streak</dt>
          <dd className={`m-0 mt-1 font-bold capitalize text-[var(--field-text)] ${revisionTone(summary.streakDirection)}`}>
            {summary.streakCount === 0 ? "No streak" : `${summary.streakCount} ${summary.streakDirection} revision${summary.streakCount === 1 ? "" : "s"}`}
          </dd>
        </dl>
        <button type="button" className="field-button field-button-secondary w-fit md:justify-self-end" onClick={() => onNavigate("revisions")}>View revision history</button>
      </div>
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

        <div className="grid gap-3 border-y border-[var(--field-border-strong)] py-5 md:grid-cols-[minmax(190px,0.55fr)_minmax(0,1.45fr)] md:items-center" aria-labelledby="bls-overview-brief-title">
          <div>
            <h3 id="bls-overview-brief-title" className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[var(--field-text-subtle)]">Current read</h3>
            <strong className="mt-1 block text-3xl font-bold tracking-[-0.025em] text-[var(--field-text)]">{model.overall.label}</strong>
            {model.overall.provisional ? <span className="bls-status-label mt-2">Provisional · preliminary anchor</span> : null}
          </div>
          <p className="m-0 max-w-[72ch] text-base leading-7 text-[var(--field-text-muted)]">{driverLine(model.briefLines[0] ?? model.overall.explanation)}</p>
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

        <section className="mt-7" aria-labelledby="bls-overview-indicators-title">
          <header className="bls-section-header">
            <h3 id="bls-overview-indicators-title">Four key measures</h3>
            <span className="bls-clock-label">Latest 24 reference months</span>
          </header>

          {model.indicators.length > 0 ? (
            <div id="bls-overview-trends-title" className="grid gap-x-8 md:grid-cols-2">
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
