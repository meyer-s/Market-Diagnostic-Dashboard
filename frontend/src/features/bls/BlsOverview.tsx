/*
THESIS: The Overview answers before it proves, refusing the long-scroll evidence wall as the default reading task.
OWN-WORLD: Evidence Field typography, quiet ruled rows, native-unit small multiples, and explicit text states instead of a generic metric-card grid.
STORY: Read the rule-backed state, verify four observations, scan separate trends and revisions, then orient to the next scheduled event.
FIRST VIEWPORT: A concise dashboard-rule brief leads directly into spacious headline rows; detail-workspace actions remain visible but secondary.
FORM: Operate-mode answer sheet ordered Brief → Headline observations → Small multiples → Revision strip → Next schedule.
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
  BLS_OVERVIEW_RULE_RECEIPT,
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

function revisionTone(direction: OverviewRevisionSummary["latestDirection"]): string {
  if (direction === "upward") return "bls-positive";
  if (direction === "downward") return "bls-negative";
  return "";
}

function signedTone(value: number | null): string {
  if (value === null || Math.abs(value) < 1e-9) return "";
  return value > 0 ? "bls-positive" : "bls-negative";
}

function IndicatorRow({
  indicator,
  onNavigate,
}: {
  indicator: OverviewIndicator;
  onNavigate: BlsOverviewProps["onNavigate"];
}) {
  const currentValue = indicator.current?.primary_value ?? null;
  const priorValue = indicator.prior?.primary_value ?? null;
  const trendAvailable = indicator.plottablePointCount > 0;

  return (
    <li className="grid min-w-0 gap-5 py-6 first:pt-0 last:pb-0 lg:grid-cols-[minmax(160px,0.7fr)_minmax(160px,0.65fr)_minmax(230px,0.9fr)_minmax(260px,1.25fr)] lg:items-start">
      <div className="grid gap-2">
        <h4 className="m-0 text-base font-bold text-[var(--field-text)]">{indicator.role}</h4>
        <span className="bls-status-label w-fit">{indicator.trendStateLabel}</span>
        {indicator.current?.preliminary ? <span className="text-xs font-bold text-[var(--field-caution)]">Preliminary observation</span> : null}
      </div>

      <div className="grid gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--field-text-subtle)]">Current</span>
        <strong className="text-3xl font-bold tracking-[-0.025em] text-[var(--field-text)]">
          {currentValue === null ? "Unavailable" : formatValue(currentValue, 2)}
        </strong>
        <span className="text-xs font-semibold text-[var(--field-text-muted)]">{currentValue === null ? "Primary value unavailable" : indicator.series.primary_unit}</span>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
        <div>
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Prior</dt>
          <dd className="m-0 mt-1 font-semibold text-[var(--field-text)]">{metricValue(priorValue, indicator.series.primary_unit)}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Delta</dt>
          <dd className="m-0 mt-1 font-semibold text-[var(--field-text)]">
            {indicator.delta === null ? "Unavailable" : `${formatSigned(indicator.delta, "", 3)} ${indicator.deltaUnit}`}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs font-bold text-[var(--field-text-subtle)]">Reference period</dt>
          <dd className="m-0 mt-1 font-semibold text-[var(--field-text)]">{indicator.current ? formatPeriod(indicator.current.period) : "Unavailable"}</dd>
        </div>
      </dl>

      <div className="grid gap-3">
        <p className="m-0 text-sm leading-6 text-[var(--field-text-muted)]">{indicator.trendInterpretation}</p>
        <span className="text-xs font-semibold text-[var(--field-text-subtle)]">Latest-vs-prior state: {indicator.stateLabel}</span>
        <button
          type="button"
          className="field-button field-button-secondary w-fit"
          onClick={() => onNavigate("trends", indicator.series.series_id)}
          disabled={!trendAvailable}
        >
          {trendAvailable ? `Open ${indicator.role} in Trends` : "Trend unavailable"}
        </button>
        {!trendAvailable ? <span className="text-xs font-semibold text-[var(--field-text-subtle)]">No primary observations are available for this indicator.</span> : null}
      </div>
    </li>
  );
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

function TrendFigure({ indicator }: { indicator: OverviewIndicator }) {
  const canPlot = indicator.plottablePointCount >= 8;

  return (
    <figure className="m-0 min-w-0 border-t border-[var(--field-border)] pt-5">
      <figcaption className="flex min-h-[52px] items-start justify-between gap-4">
        <div>
          <h4 className="m-0 text-base font-bold text-[var(--field-text)]">{indicator.role}</h4>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--field-text-subtle)]">
            Native unit · {indicator.series.primary_unit} · latest 24 returned months
          </p>
        </div>
        <span className="bls-status-label">{indicator.trendStateLabel}</span>
      </figcaption>

      {canPlot ? (
        <div className="mt-3 min-w-0">
          <ResponsiveContainer width="100%" height={150} minWidth={0}>
            <LineChart
              data={indicator.trendPoints}
              margin={{ top: 8, right: 8, bottom: 2, left: 8 }}
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
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--field-text-subtle)]">Compact scale follows this series’ observed range; exact values remain available below.</p>
        </div>
      ) : (
        <div className="mt-4 border-y border-[var(--field-border)] py-5 text-sm leading-6 text-[var(--field-text-muted)]">
          {indicator.plottablePointCount} finite observations are available. At least eight are required for a useful Overview trend chart.
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
  const streak = summary.streakCount > 0
    ? `${summary.streakCount} consecutive ${summary.streakDirection} revision${summary.streakCount === 1 ? "" : "s"}`
    : "No active signed streak";

  return (
    <section className="mt-10 border-t border-[var(--field-border-strong)] pt-8" aria-labelledby="bls-overview-revisions-title">
      <header className="bls-section-header">
        <div>
          <h3 id="bls-overview-revisions-title">Payroll revision read</h3>
          <p>Latest available official revision versus first estimate; first-estimate-only months are skipped.</p>
        </div>
        <span className="bls-clock-label">Revision clock · estimate vintage</span>
      </header>

      <div className="bls-clock-definitions">
        <article>
          <h4>Latest revision</h4>
          <p className={revisionTone(summary.latestDirection)}>
            <strong>{summary.latestDelta === null ? "Unavailable" : `${formatSigned(summary.latestDelta)} ${summary.unit}`}</strong>
          </p>
          <p>{summary.latestStageLabel} · {summary.latestStateLabel}{summary.latestPeriod ? ` · ${formatPeriod(summary.latestPeriod)}` : ""}</p>
        </article>
        <article>
          <h4>Net three-month revision</h4>
          <p className={signedTone(summary.netThreeMonth)}>
            <strong>{summary.netThreeMonth === null ? "Unavailable" : `${formatSigned(summary.netThreeMonth)} ${summary.unit}`}</strong>
          </p>
          <p>{summary.netThreeMonth === null ? "Requires three contiguous revised months" : "Sum of stage-aware revision deltas"}</p>
        </article>
        <article>
          <h4>Signed streak</h4>
          <p><strong>{streak}</strong></p>
          <p>Gaps, zero changes, and unavailable revisions break the streak.</p>
        </article>
      </div>

      <p className="m-0 text-xs leading-5 text-[var(--field-text-subtle)]">Sample-based estimate revisions are separate from the annual benchmark revision process.</p>
      <button type="button" className="field-button field-button-secondary mt-4" onClick={() => onNavigate("revisions")}>View revision history</button>
    </section>
  );
}

function RuleReceipt({ onNavigate }: { onNavigate: BlsOverviewProps["onNavigate"] }) {
  const labels: Record<keyof typeof BLS_OVERVIEW_RULE_RECEIPT.series, string> = {
    CES0000000001: "Payroll growth",
    LNS14000000: "Unemployment (inverted for the labor-state vote)",
    CES0500000003: "Hourly earnings (shown, excluded from the overall vote)",
    JTS000000000000000JOR: "Job openings rate",
    JTS000000000000000JOL: "Job openings level fallback",
  };

  return (
    <details className="mt-5 border-t border-[var(--field-border)] pt-2">
      <summary className="min-h-[44px] cursor-pointer py-3 text-sm font-bold text-[var(--field-accent-strong)]">Dashboard rule receipt</summary>
      <div className="grid gap-4 pb-2 text-sm leading-6 text-[var(--field-text-muted)]">
        <p className="m-0">Each eligible state compares the latest three-month mean with the prior three-month mean, requiring six contiguous finite months. Deltas are rounded to three decimals before an inclusive band comparison.</p>
        <ul className="m-0 grid gap-1 pl-5">
          {Object.entries(BLS_OVERVIEW_RULE_RECEIPT.series).map(([seriesId, rule]) => (
            <li key={seriesId}><strong className="text-[var(--field-text)]">{labels[seriesId as keyof typeof labels]}:</strong> {formatValue(rule.band, 2)} {rule.bandUnit} dashboard materiality band.</li>
          ))}
        </ul>
        <p className="m-0">The overall vote uses payroll, unemployment, and openings; it needs at least two eligible voters and excludes an anchor more than two months behind the freshest voter. These are dashboard rules, not BLS thresholds or classifications.</p>
        <button type="button" className="field-button field-button-secondary w-fit" onClick={() => onNavigate("methods")}>Open Methods &amp; sources</button>
      </div>
    </details>
  );
}

export default function BlsOverview({ data, onNavigate }: BlsOverviewProps) {
  const model = useMemo(() => buildBlsOverviewModel(data), [data]);
  const nextRelease = model.nextRelease;

  return (
    <div className="page-stack">
      <section className="bls-ledger" aria-labelledby="bls-overview-title">
        <header className="bls-section-header">
          <div>
            <p className="bls-section-kicker">Overview</p>
            <h2 id="bls-overview-title">Labor-market overview</h2>
            <p>Rule-backed direction first; detailed releases, charts, revisions, schedules, and sources remain one action away.</p>
          </div>
          <span className="bls-clock-label">Observation clock · reference periods</span>
        </header>

        <div className="grid gap-7 border-y border-[var(--field-border-strong)] py-6 md:grid-cols-[minmax(190px,0.65fr)_minmax(0,1.6fr)] md:items-start">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--field-text-subtle)]">Dashboard rule state</span>
            <strong className="mt-2 block text-3xl font-bold tracking-[-0.025em] text-[var(--field-text)]">{model.overall.label}</strong>
            {model.overall.provisional ? <span className="bls-status-label mt-2">Provisional · preliminary anchor</span> : null}
            <p className="m-0 mt-2 text-sm leading-6 text-[var(--field-text-muted)]">{model.overall.explanation}</p>
          </div>
          <div aria-labelledby="bls-overview-brief-title">
            <h3 id="bls-overview-brief-title" className="m-0 text-lg font-bold text-[var(--field-text)]">Current read</h3>
            <div className="mt-2 grid gap-1 text-base leading-7 text-[var(--field-text-muted)]">
              {model.briefLines.map((line) => <p key={line} className="m-0">{line}</p>)}
            </div>
          </div>
        </div>

        <RuleReceipt onNavigate={onNavigate} />

        <section className="mt-10" aria-labelledby="bls-overview-indicators-title">
          <header className="bls-section-header">
            <div>
              <h3 id="bls-overview-indicators-title">Headline observations</h3>
              <p>Current, prior, and delta use finite primary values in each series’ own analytical unit.</p>
            </div>
            <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("releases")}>View all releases</button>
          </header>

          {model.indicators.length > 0 ? (
            <ol className="m-0 list-none divide-y divide-[var(--field-border)] p-0">
              {model.indicators.map((indicator) => (
                <IndicatorRow key={indicator.series.series_id} indicator={indicator} onNavigate={onNavigate} />
              ))}
            </ol>
          ) : (
            <p className="m-0 text-sm leading-6 text-[var(--field-text-muted)]">No preferred labor indicator series is present in this response. No substitute inflation series is inferred.</p>
          )}
        </section>

        <section className="mt-10 border-t border-[var(--field-border-strong)] pt-8" aria-labelledby="bls-overview-trends-title">
          <header className="bls-section-header">
            <div>
              <h3 id="bls-overview-trends-title">What changed?</h3>
              <p>Separate native-unit trends keep unlike measures out of a single multi-line comparison.</p>
            </div>
            <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("trends")}>View all trends</button>
          </header>

          {model.trends.length > 0 ? (
            <div className="grid gap-x-7 gap-y-8 lg:grid-cols-2">
              {model.trends.map((indicator) => <TrendFigure key={indicator.series.series_id} indicator={indicator} />)}
            </div>
          ) : (
            <p className="m-0 text-sm leading-6 text-[var(--field-text-muted)]">No finite preferred labor observations are available for trend summaries.</p>
          )}
        </section>

        <RevisionSummary summary={model.revisions} onNavigate={onNavigate} />
      </section>

      <section className="bls-calendar" aria-labelledby="bls-overview-calendar-title">
        <header className="bls-section-header">
          <div>
            <p className="bls-section-kicker">Next</p>
            <h2 id="bls-overview-calendar-title">Next scheduled release</h2>
            <p>Schedule evidence is separate from observation and revision chronology; a calendar time does not confirm publication.</p>
          </div>
          <span className="bls-clock-label">Schedule clock · U.S. Eastern</span>
        </header>

        {nextRelease ? (
          <div>
            <div className="grid gap-5 border-y border-[var(--field-border-strong)] py-6 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.65fr)_auto] md:items-center">
              <div>
                <h3 className="m-0 text-xl font-bold text-[var(--field-text)]">{nextRelease.label}</h3>
                <p className="m-0 mt-2 max-w-[72ch] text-sm leading-6 text-[var(--field-text-muted)]">{nextRelease.description}</p>
                <span className="bls-status-label mt-3">Scheduled</span>
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
                ) : null}
                <a className="field-button field-button-secondary" href={nextRelease.entry.source_url} target="_blank" rel="noreferrer">Official schedule</a>
              </div>
            </div>

          </div>
        ) : (
          <p className="m-0 text-sm leading-6 text-[var(--field-text-muted)]">No future scheduled BLS event is available in the returned calendar.</p>
        )}

          <button type="button" className="field-button field-button-secondary mt-5" onClick={() => onNavigate("calendar")}>View full calendar and later releases</button>
      </section>
    </div>
  );
}
