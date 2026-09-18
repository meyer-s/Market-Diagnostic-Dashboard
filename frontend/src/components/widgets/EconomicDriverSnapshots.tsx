import { Link } from "react-router-dom";

import type { IndicatorStatus } from "../../types";
import { formatDateTime } from "../../utils/styleUtils";

type SnapshotCode =
  | "REAL_ESTATE_STABILITY"
  | "AGRICULTURE_STABILITY"
  | "ENERGY_STABILITY";

interface Props {
  indicators: IndicatorStatus[] | null;
  loading: boolean;
}

interface SnapshotDefinition {
  code: SnapshotCode;
  label: string;
  description: string;
  route: string;
}

const SNAPSHOTS: SnapshotDefinition[] = [
  {
    code: "REAL_ESTATE_STABILITY",
    label: "Real estate",
    description: "Financing, affordability, supply, and listed-property conditions.",
    route: "/real-estate",
  },
  {
    code: "AGRICULTURE_STABILITY",
    label: "Agriculture",
    description: "Crop leadership, participation, and macro pressure across the complex.",
    route: "/agriculture",
  },
  {
    code: "ENERGY_STABILITY",
    label: "Energy",
    description: "Fuel-market momentum, volatility, and supply-demand balance.",
    route: "/energy",
  },
];

const STATE_PRESENTATION: Record<IndicatorStatus["state"], { label: string; tone: string; badge: string }> = {
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

function SnapshotCell({ definition, indicator }: { definition: SnapshotDefinition; indicator?: IndicatorStatus }) {
  const state = indicator?.state ?? "UNKNOWN";
  const presentation = STATE_PRESENTATION[state];
  const hasScore = typeof indicator?.score === "number";

  return (
    <Link
      to={definition.route}
      className="group flex min-h-44 flex-col gap-3 px-4 py-4 transition-colors hover:bg-stealth-800/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 sm:px-5"
      aria-label={`Open ${definition.label} diagnostic`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-stealth-100">{definition.label}</h4>
          <p className="mt-1 text-xs leading-5 text-stealth-400">{definition.description}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${presentation.badge}`}>
          {presentation.label}
        </span>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-stealth-500">Stability · 0–100</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${presentation.tone}`}>
            {hasScore ? indicator.score!.toFixed(1) : "—"}
          </p>
        </div>
        <span className="text-sm font-semibold text-sky-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          Open →
        </span>
      </div>

      <p className="text-xs text-stealth-500">
        {indicator?.timestamp ? `Cached ${formatDateTime(indicator.timestamp)} ET` : "No current snapshot timestamp"}
      </p>
    </Link>
  );
}

export default function EconomicDriverSnapshots({ indicators, loading }: Props) {
  const byCode = new Map((indicators ?? []).map((indicator) => [indicator.code, indicator]));

  return (
    <section id="economic-driver-snapshots" aria-labelledby="economic-driver-snapshots-title">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="page-kicker">Real economy snapshots</div>
          <h3 id="economic-driver-snapshots-title" className="mt-1 text-lg font-semibold text-stealth-100 sm:text-xl">
            Rate-sensitive transmission
          </h3>
        </div>
        <p className="max-w-xl text-sm leading-6 text-stealth-300 sm:text-right">
          Cached stability reads from each full diagnostic. Higher scores mean the market is absorbing pressure more cleanly.
        </p>
      </div>

      <div
        className="surface-card overflow-hidden divide-y divide-stealth-700 md:grid md:grid-cols-3 md:divide-x md:divide-y-0"
        aria-busy={loading}
      >
        {loading
          ? SNAPSHOTS.map((definition) => (
              <div key={definition.code} className="min-h-44 animate-pulse px-4 py-4 sm:px-5" role="status">
                <span className="sr-only">Loading {definition.label} snapshot</span>
                <div className="h-4 w-28 rounded bg-stealth-700" />
                <div className="mt-3 h-3 w-full rounded bg-stealth-800" />
                <div className="mt-2 h-3 w-3/4 rounded bg-stealth-800" />
                <div className="mt-8 h-8 w-20 rounded bg-stealth-700" />
                <div className="mt-3 h-3 w-36 rounded bg-stealth-800" />
              </div>
            ))
          : SNAPSHOTS.map((definition) => (
              <SnapshotCell
                key={definition.code}
                definition={definition}
                indicator={byCode.get(definition.code)}
              />
            ))}
      </div>
    </section>
  );
}
