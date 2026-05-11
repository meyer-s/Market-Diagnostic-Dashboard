import { useMemo } from "react";

type BiasValue = "bullish" | "bearish" | "neutral" | "mixed" | string;

type SourceHealth = {
  source_name?: string;
  freshness_status?: string;
  confidence_level?: string;
  published_at?: string | null;
  last_fetched_at?: string | null;
  warnings?: string[];
  errors?: string[];
};

type ContextModule = {
  bias?: BiasValue;
  signal?: string;
  status?: string;
  confidence?: string;
  reasons?: string[];
  warnings?: string[];
  source_health?: SourceHealth;
};

type TechnicalModule = {
  bias?: BiasValue;
  confidence?: string;
  current_price?: number | null;
  change_20d?: number | null;
  change_60d?: number | null;
  change_120d?: number | null;
  warnings?: string[];
};

export type AgricultureContextData = {
  symbol: string;
  commodity: string;
  session: {
    status: string;
    current_time_et?: string;
    next_open?: string | null;
    next_close?: string | null;
    warnings?: string[];
  };
  crop_stage: {
    stage: string;
    weather_sensitivity: string;
    seasonal_pressure: string;
    stage_explanation: string;
  };
  report_calendar: {
    next_report?: {
      report: string;
      release_at: string;
      impact: string;
    } | null;
    upcoming_reports?: Array<{
      report: string;
      release_at: string;
      impact: string;
    }>;
    source_health?: SourceHealth;
  };
  weather: ContextModule;
  crop_progress: ContextModule;
  export_demand: ContextModule;
  wasde: ContextModule;
  global_supply: ContextModule;
  technical: TechnicalModule;
  context_score: {
    net_bias: BiasValue;
    confidence: string;
    confidence_score: number;
    numerical_score: number;
    component_breakdown: Record<string, number>;
    warnings?: string[];
  };
  setup_label: string;
  market_read: string;
  thesis_validation: {
    validation_status: string;
    confirmations?: string[];
    warnings?: string[];
  };
};

const SYMBOL_OPTIONS = [
  { code: "ZC", label: "Corn" },
  { code: "ZS", label: "Soybeans" },
  { code: "ZW", label: "Wheat" },
  { code: "ZM", label: "Soy Meal" },
  { code: "ZL", label: "Soy Oil" },
  { code: "ZO", label: "Oats" },
];

function formatDateTime(value?: string | null): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function properCase(value: string): string {
  const normalized = value.replace(/_/g, " ").trim();
  const smallWords = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "vs"]);
  const overrides: Record<string, string> = {
    wasde: "WASDE",
    cbot: "CBOT",
    zc: "ZC",
    zs: "ZS",
    zw: "ZW",
    zm: "ZM",
    zl: "ZL",
    zo: "ZO",
    le: "LE",
    he: "HE",
    gf: "GF",
    ke: "KE",
    mw: "MW",
    oj: "OJ",
    vix: "VIX",
    "soy meal": "Soy Meal",
    "soy oil": "Soy Oil",
  };

  const direct = overrides[normalized.toLowerCase()];
  if (direct) return direct;

  const words = normalized
    .split(" ")
    .filter(Boolean)
    .map((word, index, array) => {
      const lowered = word.toLowerCase();
      if (overrides[lowered]) {
        return overrides[lowered];
      }
      if (index > 0 && index < array.length - 1 && smallWords.has(lowered)) {
        return lowered;
      }
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    });

  return words.join(" ");
}

function biasTone(value?: BiasValue): string {
  if (value === "bullish") return "border-emerald-400/40 bg-emerald-500/12 text-emerald-200";
  if (value === "bearish") return "border-rose-400/40 bg-rose-500/12 text-rose-200";
  if (value === "mixed") return "border-amber-400/40 bg-amber-500/12 text-amber-200";
  return "border-sky-400/30 bg-sky-500/10 text-sky-200";
}

function freshnessTone(value?: string): string {
  if (value === "fresh") return "text-emerald-300";
  if (value === "aging") return "text-amber-300";
  if (value === "stale") return "text-orange-300";
  if (value === "missing") return "text-rose-300";
  return "text-stealth-300";
}

function compactSummary(context: AgricultureContextData): string {
  const catalyst = context.report_calendar.next_report?.report ?? "the next report";
  return `${context.commodity} is ${properCase(String(context.context_score.net_bias))} with ${context.context_score.confidence_score} confidence points ahead of ${catalyst}. Open a driver below to see what is carrying the read.`;
}

function getModuleMeta(context: AgricultureContextData) {
  return [
    { key: "weather", label: "Weather", breakdownKey: "weather", module: context.weather },
    { key: "cropProgress", label: "Crop Progress", breakdownKey: "crop_progress", module: context.crop_progress },
    { key: "exportDemand", label: "Export Demand", breakdownKey: "export_demand", module: context.export_demand },
    { key: "wasde", label: "WASDE", breakdownKey: "wasde", module: context.wasde },
    { key: "globalSupply", label: "Global Supply", breakdownKey: "global_supply", module: context.global_supply },
    { key: "technical", label: "Technical", breakdownKey: "technical", module: context.technical },
  ] as const;
}

function contributionTone(value: number): string {
  if (value > 0) return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (value < 0) return "border-rose-400/30 bg-rose-500/10 text-rose-100";
  return "border-stealth-700 bg-stealth-900/70 text-stealth-300";
}

function validationTone(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("confirm")) return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (normalized.includes("warn")) return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return "border-sky-400/30 bg-sky-500/10 text-sky-100";
}

export function CompactContextDigest({
  context,
  variant = "panel",
}: {
  context: AgricultureContextData;
  variant?: "panel" | "indicator";
}) {
  const dense = variant === "indicator";
  const modules = getModuleMeta(context);
  const warning = context.thesis_validation.warnings?.[0] ?? context.context_score.warnings?.[0] ?? context.session.warnings?.[0];
  const rankedDrivers = modules
    .map((entry) => ({
      label: entry.label,
      contribution: context.context_score.component_breakdown[entry.breakdownKey] ?? 0,
      bias: entry.module.bias,
    }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const leadingDrivers = rankedDrivers.filter((entry) => entry.contribution !== 0).slice(0, dense ? 2 : 3);

  if (dense) {
    return (
      <div className="rounded-2xl border border-white/8 bg-stealth-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-white">{properCase(context.setup_label)}</p>
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${biasTone(context.context_score.net_bias)}`}>
                {properCase(String(context.context_score.net_bias))}
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-stealth-200">{compactSummary(context)}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Next Catalyst</p>
            <p className="mt-1 text-sm font-semibold text-white">{context.report_calendar.next_report?.report ?? "No near-term report"}</p>
            <p className="mt-1 text-xs text-stealth-400">{formatDateTime(context.report_calendar.next_report?.release_at)}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Why Now</p>
            <p className="mt-1 text-sm font-semibold text-white">{leadingDrivers.map((entry) => entry.label).join(" + ") || "Balanced inputs"}</p>
            <p className="mt-1 text-xs text-stealth-400">{properCase(context.context_score.confidence)} conviction</p>
          </div>
          <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Validation</p>
            <p className="mt-1 text-sm font-semibold text-white">{properCase(context.thesis_validation.validation_status)}</p>
            <p className="mt-1 text-xs text-stealth-400">{context.thesis_validation.confirmations?.[0] ?? "No strong confirmation yet."}</p>
          </div>
          <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Market State</p>
            <p className="mt-1 text-sm font-semibold text-white">{properCase(context.crop_stage.stage)}</p>
            <p className="mt-1 text-xs text-stealth-400">Session {properCase(context.session.status).toLowerCase()}</p>
          </div>
        </div>

        {leadingDrivers.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {leadingDrivers.map((entry) => (
              <span key={entry.label} className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${contributionTone(entry.contribution)}`}>
                {entry.label} {entry.contribution > 0 ? "+1" : "-1"}
              </span>
            ))}
          </div>
        ) : null}

        {warning ? <p className="mt-4 text-xs text-amber-200">{warning}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/8 bg-stealth-950/42 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[0] flex-1">
          <p className="text-sm font-semibold tracking-[0.12em] text-stealth-400">{properCase(context.commodity)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-3xl font-semibold text-white">{properCase(context.setup_label)}</p>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${biasTone(context.context_score.net_bias)}`}>
              {properCase(String(context.context_score.net_bias))}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-stealth-100">{compactSummary(context)}</p>
        </div>

        <div className="grid min-w-[220px] gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Confidence</p>
            <p className="mt-2 text-4xl font-semibold text-white">{context.context_score.confidence_score}</p>
            <p className="mt-1 text-xs text-stealth-400">{properCase(context.context_score.confidence)} conviction</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Next Catalyst</p>
            <p className="mt-1 text-sm font-semibold text-white">{context.report_calendar.next_report?.report ?? "No near-term report"}</p>
            <p className="mt-1 text-xs text-stealth-400">{formatDateTime(context.report_calendar.next_report?.release_at)}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Session</p>
          <p className="mt-1 text-sm font-semibold text-white">{properCase(context.session.status)}</p>
          <p className="mt-1 text-xs text-stealth-400">{formatDateTime(context.session.next_close)}</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Crop Stage</p>
          <p className="mt-1 text-sm font-semibold text-white">{properCase(context.crop_stage.stage)}</p>
          <p className="mt-1 text-xs text-stealth-400">{properCase(context.crop_stage.weather_sensitivity)} sensitivity</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Validation</p>
          <div className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${validationTone(context.thesis_validation.validation_status)}`}>
            {properCase(context.thesis_validation.validation_status)}
          </div>
          <p className="mt-2 text-xs text-stealth-400">{context.thesis_validation.confirmations?.length ?? 0} confirmations</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-stealth-500">Primary Driver</p>
          <p className="mt-1 text-sm font-semibold text-white">{modules.slice().sort((left, right) => (context.context_score.component_breakdown[right.breakdownKey] ?? 0) - (context.context_score.component_breakdown[left.breakdownKey] ?? 0))[0]?.label ?? "Balanced"}</p>
          <p className="mt-1 text-xs text-stealth-400">{properCase(context.context_score.confidence)} support</p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((entry) => {
          const badgeText = ("signal" in entry.module ? entry.module.signal : undefined) ?? ("status" in entry.module ? entry.module.status : undefined) ?? entry.module.bias ?? "neutral";
          const contribution = context.context_score.component_breakdown[entry.breakdownKey] ?? 0;
          const source = "source_health" in entry.module ? entry.module.source_health : undefined;
          return (
            <div key={entry.key} className={`rounded-2xl border px-3 py-3 ${contributionTone(contribution)}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-white">{entry.label}</p>
                  <p className="mt-1 text-[11px] text-stealth-300">{properCase(String(badgeText))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-white">{contribution > 0 ? "+1" : contribution < 0 ? "-1" : "0"}</p>
                  <p className={`text-[11px] ${freshnessTone(source?.freshness_status)}`}>{properCase(source?.freshness_status ?? entry.module.confidence ?? "mixed")}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {warning ? <p className="mt-4 text-xs text-amber-200">{warning}</p> : null}
    </div>
  );
}

export default function AgricultureContextPanel({
  context,
  loading,
  error,
  symbol,
  onSymbolChange,
}: {
  context: AgricultureContextData | null;
  loading: boolean;
  error: string | null;
  symbol: string;
  onSymbolChange: (symbolCode: string) => void;
}) {
  const activeContext = useMemo(() => context, [context]);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-5 shadow-[0_20px_80px_rgba(2,6,23,0.42)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <span className="text-xs tracking-[0.18em] text-emerald-300/80">Agriculture Context</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live thesis and catalyst panel</h2>
          <p className="mt-2 text-sm leading-6 text-stealth-200">
            A compact read built for scanning first, with the detail behind each driver one tab away.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SYMBOL_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => onSymbolChange(option.code)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.08em] transition ${
                symbol === option.code
                  ? "border-emerald-300 bg-emerald-300/12 text-emerald-100"
                  : "border-stealth-700 bg-stealth-900/60 text-stealth-300 hover:border-stealth-500 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-white/8 bg-stealth-950/35 px-5 py-10 text-sm text-stealth-300">
          Loading live agriculture context for {symbol}...
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
          Failed to load the agriculture context feed. {error}
        </div>
      ) : null}

      {!loading && !error && activeContext ? <div className="mt-6"><CompactContextDigest context={activeContext} /></div> : null}
    </section>
  );
}