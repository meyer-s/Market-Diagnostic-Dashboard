import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useApi } from "../../hooks/useApi";
import { getFamilyColor } from "../../theme/metricColors";
import { CHART_NEUTRAL, commonTooltipStyle } from "../../utils/chartUtils";
import { getStateFromScore, type StabilityState } from "../../utils/stabilityConstants";
import { formatDateTime } from "../../utils/styleUtils";

interface StabilityPoint {
  date: string;
  value: number;
}

interface Availability {
  available_count: number;
  total_configured: number;
}

interface RealEstateOverview {
  as_of: string;
  regime_label: string;
  stability_score: number;
  stability_history?: StabilityPoint[];
  metrics: {
    mortgage_rate_30y?: number | null;
    credit_spread_bps?: number | null;
  };
  availability: Availability;
  data_quality?: {
    status?: string;
    stale?: boolean;
  };
}

interface AgricultureOverview {
  as_of: string;
  regime_label: string;
  stability_score: number;
  component_history?: Array<{ date: string; stability_score: number }>;
  strongest_markets: Array<{ name: string; score: number }>;
  weakest_markets: Array<{ name: string; score: number }>;
  availability: {
    available_symbol_count: number;
    total_configured_symbols: number;
  };
}

interface EnergyOverview {
  as_of: string;
  regime_label: string;
  composite_score: number;
  stability_score: number;
  stability_history?: StabilityPoint[];
  groups: Array<{ label: string; group_composite: number }>;
  availability: Availability;
}

interface SnapshotMetric {
  label: string;
  value: string;
  detail: string;
}

interface SnapshotView {
  key: "real-estate" | "agriculture" | "energy";
  label: string;
  route: string;
  regime: string;
  stabilityScore: number;
  stabilityHistory: StabilityPoint[];
  historyLabel: string;
  metrics: [SnapshotMetric, SnapshotMetric];
  coverage: string;
  complete: boolean;
  stale: boolean;
  asOf: string;
}

type SnapshotState = StabilityState | "UNKNOWN";

const STATE_PRESENTATION: Record<SnapshotState, { label: string; tone: string; badge: string }> = {
  GREEN: {
    label: "Stable",
    tone: "text-emerald-300",
    badge: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  },
  YELLOW: {
    label: "Caution",
    tone: "text-amber-300",
    badge: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  },
  RED: {
    label: "Stressed",
    tone: "text-rose-300",
    badge: "border-rose-500/35 bg-rose-500/10 text-rose-200",
  },
  UNKNOWN: {
    label: "Unavailable",
    tone: "text-stealth-300",
    badge: "border-stealth-600 bg-stealth-800/70 text-stealth-300",
  },
};

const formatValue = (value: number | null | undefined, digits = 1, suffix = "") =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";

const clampScore = (value: number) => Math.min(100, Math.max(0, value));

const HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;
const TREND_COLOR = getFamilyColor("market");
const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function StabilityTrend({ snapshot }: { snapshot: SnapshotView }) {
  const end = Date.parse(`${snapshot.asOf.slice(0, 10)}T00:00:00Z`);
  const start = end - (HISTORY_DAYS - 1) * DAY_MS;
  const points = snapshot.stabilityHistory
    .map(({ date, value }) => ({ timestamp: Date.parse(`${date}T00:00:00Z`), value }))
    .filter(({ timestamp, value }) => timestamp >= start && timestamp <= end && Number.isFinite(value) && value >= 0 && value <= 100)
    .sort((left, right) => left.timestamp - right.timestamp);
  const first = points[0];
  const last = points[points.length - 1];

  if (!first || first.timestamp === last.timestamp) {
    return (
      <p className="mt-3 flex h-28 items-center justify-center rounded-lg border border-stealth-700 text-xs text-stealth-300">
        {first ? "One historical reading available" : "Stability history unavailable"}
      </p>
    );
  }

  const description = `${snapshot.label} stability history. ${snapshot.historyLabel}. ${first.value.toFixed(1)} on ${dateLabel.format(first.timestamp)} to ${last.value.toFixed(1)} on ${dateLabel.format(last.timestamp)}. Scale 0 to 100.`;
  return (
    <div className="relative z-10 mt-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-stealth-300">
        <span>{snapshot.historyLabel}</span>
        <span className="tabular-nums">{last.value.toFixed(1)}</span>
      </div>
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={82} minWidth={0} initialDimension={{ width: 300, height: 82 }}>
          <LineChart data={points} margin={{ top: 8, right: 6, bottom: 8, left: 0 }} accessibilityLayer aria-label={description}>
            <CartesianGrid vertical={false} stroke={CHART_NEUTRAL.grid} />
            <XAxis type="number" dataKey="timestamp" domain={[start, end]} hide />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} interval={0} width={28} axisLine={false} tickLine={false}
              tick={{ fill: CHART_NEUTRAL.tick, fontSize: 11 }} />
            <Tooltip
              contentStyle={commonTooltipStyle}
              labelFormatter={(timestamp) => dateLabel.format(Number(timestamp))}
              formatter={(value) => [formatValue(Number(value)), "Stability"]}
              isAnimationActive={false}
            />
            <Line type="linear" dataKey="value" stroke={TREND_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceDot x={last.timestamp} y={last.value} r={3} fill={TREND_COLOR} stroke="none" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex justify-between pl-7 pr-1.5 text-xs text-stealth-400">
          <span>{dateLabel.format(start)}</span>
          <span>{dateLabel.format(end)}</span>
        </div>
      </div>
    </div>
  );
}

function SnapshotCell({ snapshot }: { snapshot: SnapshotView }) {
  const score = clampScore(snapshot.stabilityScore);
  const state = getStateFromScore(score);
  const presentation = STATE_PRESENTATION[state];
  const qualityLabel = snapshot.stale
    ? "Stale snapshot"
    : snapshot.complete
      ? `Complete · ${snapshot.coverage}`
      : `Partial · ${snapshot.coverage}`;
  const qualityTone = snapshot.stale || !snapshot.complete ? "text-amber-300" : "text-stealth-400";

  return (
    <article className="group relative flex min-h-64 min-w-0 flex-col px-4 py-4 transition-colors hover:bg-stealth-800/45 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-stealth-100">{snapshot.label}</h4>
          <p className="mt-1 truncate text-base font-semibold text-white" title={snapshot.regime}>{snapshot.regime}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${presentation.badge}`}>
          {presentation.label}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="text-xs font-medium text-stealth-400">Latest stability</span>
        <span className={`text-xl font-semibold tabular-nums ${presentation.tone}`}>
          {score.toFixed(1)} <span className="text-xs font-medium text-stealth-400">/ 100</span>
        </span>
      </div>
      <StabilityTrend snapshot={snapshot} />

      <dl className="mt-4 grid grid-cols-2 divide-x divide-stealth-700 border-y border-stealth-700">
        {snapshot.metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 py-3 first:pr-3 last:pl-3">
            <dt className="text-xs text-stealth-500">{metric.label}</dt>
            <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-stealth-100" title={metric.value}>{metric.value}</dd>
            <dd className="mt-0.5 truncate text-xs text-stealth-500" title={metric.detail}>{metric.detail}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex items-end justify-between gap-4 pt-4">
        <div className="min-w-0 text-xs">
          <p className={qualityTone}>{qualityLabel}</p>
          <p className="mt-1 truncate text-stealth-500">Updated {formatDateTime(snapshot.asOf)} ET</p>
        </div>
        <Link
          to={snapshot.route}
          className="shrink-0 text-sm font-semibold text-sky-300 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-sky-400"
          aria-label={`Open ${snapshot.label} diagnostic`}
        >
          Open →
        </Link>
      </div>
    </article>
  );
}

function SnapshotSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-64 animate-pulse px-4 py-4 sm:px-5" role="status">
      <span className="sr-only">Loading {label} snapshot</span>
      <div className="h-4 w-28 rounded bg-stealth-700" />
      <div className="mt-3 h-5 w-40 rounded bg-stealth-700" />
      <div className="mt-7 h-28 rounded-lg bg-stealth-800" />
      <div className="mt-5 grid grid-cols-2 gap-4 border-y border-stealth-700 py-4">
        <div className="h-10 rounded bg-stealth-800" />
        <div className="h-10 rounded bg-stealth-800" />
      </div>
      <div className="mt-5 h-3 w-44 rounded bg-stealth-800" />
    </div>
  );
}

function SnapshotUnavailable({ label, route }: { label: string; route: string }) {
  const presentation = STATE_PRESENTATION.UNKNOWN;

  return (
    <Link
      to={route}
      className="group flex min-h-64 flex-col px-4 py-4 transition-colors hover:bg-stealth-800/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 sm:px-5"
      aria-label={`Open ${label} diagnostic`}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-stealth-100">{label}</h4>
        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${presentation.badge}`}>{presentation.label}</span>
      </div>
      <p className="mt-5 text-base font-semibold text-stealth-200">Overview feed unavailable</p>
      <p className="mt-2 text-sm leading-6 text-stealth-400">Open the full diagnostic for its latest available evidence.</p>
      <span className="mt-auto pt-5 text-sm font-semibold text-sky-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
        Open →
      </span>
    </Link>
  );
}

export default function EconomicDriverSnapshots() {
  const realEstateApi = useApi<RealEstateOverview>("/real-estate/overview?days=365&prefer_cached=true&include_stability_history=true", { timeoutMs: 20_000 });
  const agricultureApi = useApi<AgricultureOverview>("/agriculture/overview?days=90", { timeoutMs: 50_000 });
  const energyApi = useApi<EnergyOverview>("/energy/overview?days=90&include_stability_history=true", { timeoutMs: 50_000 });

  const realEstate = realEstateApi.data
    ? {
        key: "real-estate",
        label: "Real estate",
        route: "/real-estate",
        regime: realEstateApi.data.regime_label,
        stabilityScore: realEstateApi.data.stability_score,
        stabilityHistory: realEstateApi.data.stability_history ?? [],
        historyLabel: "Listed-proxy stability",
        metrics: [
          { label: "30Y mortgage", value: formatValue(realEstateApi.data.metrics.mortgage_rate_30y, 2, "%"), detail: "Financing cost" },
          { label: "Credit spread", value: formatValue(realEstateApi.data.metrics.credit_spread_bps, 0, " bp"), detail: "High-yield OAS" },
        ],
        coverage: `${realEstateApi.data.availability.available_count}/${realEstateApi.data.availability.total_configured} inputs`,
        complete:
          realEstateApi.data.data_quality?.status === "complete"
          && realEstateApi.data.availability.available_count === realEstateApi.data.availability.total_configured,
        stale: Boolean(realEstateApi.data.data_quality?.stale),
        asOf: realEstateApi.data.as_of,
      } satisfies SnapshotView
    : null;

  const agriculture = agricultureApi.data
    ? {
        key: "agriculture",
        label: "Agriculture",
        route: "/agriculture",
        regime: agricultureApi.data.regime_label,
        stabilityScore: agricultureApi.data.stability_score,
        stabilityHistory: (agricultureApi.data.component_history ?? []).map(({ date, stability_score }) => ({ date, value: stability_score })),
        historyLabel: "Modeled stability history",
        metrics: [
          {
            label: "Leading market",
            value: agricultureApi.data.strongest_markets[0]?.name ?? "—",
            detail: agricultureApi.data.strongest_markets[0]
              ? `${agricultureApi.data.strongest_markets[0].score.toFixed(1)} momentum`
              : "Unavailable",
          },
          {
            label: "Lagging market",
            value: agricultureApi.data.weakest_markets[0]?.name ?? "—",
            detail: agricultureApi.data.weakest_markets[0]
              ? `${agricultureApi.data.weakest_markets[0].score.toFixed(1)} momentum`
              : "Unavailable",
          },
        ],
        coverage: `${agricultureApi.data.availability.available_symbol_count}/${agricultureApi.data.availability.total_configured_symbols} markets`,
        complete:
          agricultureApi.data.availability.available_symbol_count
          === agricultureApi.data.availability.total_configured_symbols,
        stale: false,
        asOf: agricultureApi.data.as_of,
      } satisfies SnapshotView
    : null;

  const leadingEnergyGroup = energyApi.data
    ? [...energyApi.data.groups].sort((left, right) => right.group_composite - left.group_composite)[0]
    : undefined;
  const energy = energyApi.data
    ? {
        key: "energy",
        label: "Energy",
        route: "/energy",
        regime: energyApi.data.regime_label,
        stabilityScore: energyApi.data.stability_score,
        stabilityHistory: energyApi.data.stability_history ?? [],
        historyLabel: "Stability history",
        metrics: [
          { label: "Momentum", value: energyApi.data.composite_score.toFixed(1), detail: "Complex · 0–100" },
          {
            label: "Leading group",
            value: leadingEnergyGroup?.label ?? "—",
            detail: leadingEnergyGroup ? `${leadingEnergyGroup.group_composite.toFixed(1)} momentum` : "Unavailable",
          },
        ],
        coverage: `${energyApi.data.availability.available_count}/${energyApi.data.availability.total_configured} contracts`,
        complete: energyApi.data.availability.available_count === energyApi.data.availability.total_configured,
        stale: false,
        asOf: energyApi.data.as_of,
      } satisfies SnapshotView
    : null;

  const snapshots = [
    { label: "Real estate", route: "/real-estate", view: realEstate, ...realEstateApi },
    { label: "Agriculture", route: "/agriculture", view: agriculture, ...agricultureApi },
    { label: "Energy", route: "/energy", view: energy, ...energyApi },
  ];
  const loading = snapshots.some((snapshot) => snapshot.loading);

  return (
    <section id="economic-driver-snapshots" aria-labelledby="economic-driver-snapshots-title">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="page-kicker">Real economy</div>
          <h3 id="economic-driver-snapshots-title" className="mt-1 text-lg font-semibold text-stealth-100 sm:text-xl">
            Cross-market snapshots
          </h3>
        </div>
        <p className="text-sm text-stealth-400 sm:text-right">{HISTORY_DAYS}-day stability trends</p>
      </div>

      <div
        className="surface-card overflow-hidden divide-y divide-stealth-700 md:grid md:grid-cols-3 md:divide-x md:divide-y-0"
        aria-busy={loading}
      >
        {snapshots.map((snapshot) =>
          snapshot.loading ? (
            <SnapshotSkeleton key={snapshot.label} label={snapshot.label} />
          ) : snapshot.error || !snapshot.view ? (
            <SnapshotUnavailable key={snapshot.label} label={snapshot.label} route={snapshot.route} />
          ) : (
            <SnapshotCell key={snapshot.view.key} snapshot={snapshot.view} />
          )
        )}
      </div>
    </section>
  );
}
