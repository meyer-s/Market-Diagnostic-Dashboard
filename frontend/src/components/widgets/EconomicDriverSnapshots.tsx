import { Link } from "react-router-dom";

import { useApi } from "../../hooks/useApi";
import { getStateFromScore, type StabilityState } from "../../utils/stabilityConstants";
import { formatDateTime } from "../../utils/styleUtils";

interface Availability {
  available_count: number;
  total_configured: number;
}

interface RealEstateOverview {
  as_of: string;
  regime_label: string;
  stability_score: number;
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
  metrics: [SnapshotMetric, SnapshotMetric];
  coverage: string;
  complete: boolean;
  stale: boolean;
  asOf: string;
}

type SnapshotState = StabilityState | "UNKNOWN";

const STATE_PRESENTATION: Record<SnapshotState, { label: string; tone: string; badge: string; fill: string }> = {
  GREEN: {
    label: "Stable",
    tone: "text-emerald-300",
    badge: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
    fill: "bg-emerald-400",
  },
  YELLOW: {
    label: "Caution",
    tone: "text-amber-300",
    badge: "border-amber-500/35 bg-amber-500/10 text-amber-200",
    fill: "bg-amber-400",
  },
  RED: {
    label: "Stressed",
    tone: "text-rose-300",
    badge: "border-rose-500/35 bg-rose-500/10 text-rose-200",
    fill: "bg-rose-400",
  },
  UNKNOWN: {
    label: "Unavailable",
    tone: "text-stealth-300",
    badge: "border-stealth-600 bg-stealth-800/70 text-stealth-300",
    fill: "bg-stealth-500",
  },
};

const formatValue = (value: number | null | undefined, digits = 1, suffix = "") =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";

const clampScore = (value: number) => Math.min(100, Math.max(0, value));

function StabilityScale({ label, score }: { label: string; score: number }) {
  const boundedScore = clampScore(score);
  const state = getStateFromScore(boundedScore);
  const presentation = STATE_PRESENTATION[state];

  return (
    <div className="mt-4">
      <div className="flex items-end justify-between gap-3">
        <span className="text-xs font-medium text-stealth-400">Stability</span>
        <span className={`text-xl font-semibold tabular-nums ${presentation.tone}`}>
          {boundedScore.toFixed(1)} <span className="text-xs font-medium text-stealth-500">/ 100</span>
        </span>
      </div>
      <div
        className="relative mt-2 h-2 overflow-hidden rounded-full bg-stealth-800"
        role="meter"
        aria-label={`${label} stability`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(boundedScore.toFixed(1))}
        aria-valuetext={`${boundedScore.toFixed(1)} out of 100, ${presentation.label}`}
      >
        <div className={`h-full ${presentation.fill}`} style={{ width: `${boundedScore}%` }} />
        <span className="absolute inset-y-0 left-[40%] w-px bg-stealth-950/80" aria-hidden="true" />
        <span className="absolute inset-y-0 left-[70%] w-px bg-stealth-950/80" aria-hidden="true" />
      </div>
    </div>
  );
}

function SnapshotCell({ snapshot }: { snapshot: SnapshotView }) {
  const state = getStateFromScore(clampScore(snapshot.stabilityScore));
  const presentation = STATE_PRESENTATION[state];
  const qualityLabel = snapshot.stale
    ? "Stale snapshot"
    : snapshot.complete
      ? `Complete · ${snapshot.coverage}`
      : `Partial · ${snapshot.coverage}`;
  const qualityTone = snapshot.stale || !snapshot.complete ? "text-amber-300" : "text-stealth-400";

  return (
    <Link
      to={snapshot.route}
      className="group flex min-h-64 flex-col px-4 py-4 transition-colors hover:bg-stealth-800/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 sm:px-5"
      aria-label={`Open ${snapshot.label} diagnostic`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-stealth-100">{snapshot.label}</h4>
          <p className="mt-1 truncate text-base font-semibold text-white" title={snapshot.regime}>{snapshot.regime}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${presentation.badge}`}>
          {presentation.label}
        </span>
      </div>

      <StabilityScale label={snapshot.label} score={snapshot.stabilityScore} />

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
        <span className="shrink-0 text-sm font-semibold text-sky-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          Open →
        </span>
      </div>
    </Link>
  );
}

function SnapshotSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-64 animate-pulse px-4 py-4 sm:px-5" role="status">
      <span className="sr-only">Loading {label} snapshot</span>
      <div className="h-4 w-28 rounded bg-stealth-700" />
      <div className="mt-3 h-5 w-40 rounded bg-stealth-700" />
      <div className="mt-7 h-2 rounded-full bg-stealth-800" />
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
  const realEstateApi = useApi<RealEstateOverview>("/real-estate/overview?days=90", { timeoutMs: 50_000 });
  const agricultureApi = useApi<AgricultureOverview>("/agriculture/overview?days=90", { timeoutMs: 50_000 });
  const energyApi = useApi<EnergyOverview>("/energy/overview?days=90", { timeoutMs: 50_000 });

  const realEstate = realEstateApi.data
    ? {
        key: "real-estate",
        label: "Real estate",
        route: "/real-estate",
        regime: realEstateApi.data.regime_label,
        stabilityScore: realEstateApi.data.stability_score,
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
        <p className="text-sm text-stealth-400 sm:text-right">Live page snapshots · 90-day context</p>
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
