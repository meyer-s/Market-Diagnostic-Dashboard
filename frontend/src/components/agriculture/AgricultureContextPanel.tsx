import { useEffect, useMemo, useState } from "react";

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

function formatChange(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function properCase(value: string): string {
  const normalized = value.replace(/_/g, " ").trim();
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

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => overrides[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
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
    { key: "weather", label: "Weather", module: context.weather },
    { key: "cropProgress", label: "Crop Progress", module: context.crop_progress },
    { key: "exportDemand", label: "Export Demand", module: context.export_demand },
    { key: "wasde", label: "WASDE", module: context.wasde },
    { key: "globalSupply", label: "Global Supply", module: context.global_supply },
    { key: "technical", label: "Technical", module: context.technical },
  ] as const;
}

function DriverPanel({
  label,
  module,
}: {
  label: string;
  module: ContextModule | TechnicalModule;
}) {
  const source = "source_health" in module ? module.source_health : undefined;
  const badgeText = ("signal" in module ? module.signal : undefined) ?? ("status" in module ? module.status : undefined) ?? module.bias ?? "neutral";

  return (
    <div className="rounded-3xl border border-white/8 bg-stealth-950/45 p-5 shadow-[0_16px_50px_rgba(2,6,23,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${biasTone(module.bias)}`}>
            {properCase(String(badgeText))}
          </div>
        </div>
        <div className="text-right text-xs text-stealth-400">
          <p className={freshnessTone(source?.freshness_status)}>{properCase(source?.freshness_status ?? "unknown")}</p>
          <p>{properCase(module.confidence ?? source?.confidence_level ?? "low")}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-stealth-100">
        {("reasons" in module ? module.reasons?.[0] : undefined) ?? "This module is neutral right now. Open the deeper panels below to inspect the structure in more detail."}
      </p>

      {"current_price" in module ? (
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-2xl bg-stealth-900/65 px-3 py-2">
            <p className="text-stealth-500">20d</p>
            <p className="mt-1 text-stealth-100">{formatChange(module.change_20d)}</p>
          </div>
          <div className="rounded-2xl bg-stealth-900/65 px-3 py-2">
            <p className="text-stealth-500">60d</p>
            <p className="mt-1 text-stealth-100">{formatChange(module.change_60d)}</p>
          </div>
          <div className="rounded-2xl bg-stealth-900/65 px-3 py-2">
            <p className="text-stealth-500">120d</p>
            <p className="mt-1 text-stealth-100">{formatChange(module.change_120d)}</p>
          </div>
          <div className="rounded-2xl bg-stealth-900/65 px-3 py-2">
            <p className="text-stealth-500">Price</p>
            <p className="mt-1 text-stealth-100">{module.current_price?.toFixed(2) ?? "—"}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-stealth-300">
        {source?.source_name ? <span className="rounded-full bg-stealth-900/70 px-3 py-1">{source.source_name}</span> : null}
        {source?.published_at ? <span className="rounded-full bg-stealth-900/70 px-3 py-1">Updated {formatDateTime(source.published_at)}</span> : null}
      </div>

      {module.warnings?.[0] ? <p className="mt-4 text-xs text-amber-200">{module.warnings[0]}</p> : null}
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
  const modules = useMemo(() => (context ? getModuleMeta(context) : []), [context]);
  const [activeDriver, setActiveDriver] = useState<string>("weather");

  useEffect(() => {
    if (modules[0]) {
      setActiveDriver(modules[0].key);
    }
  }, [symbol, modules]);

  const activeModule = modules.find((entry) => entry.key === activeDriver) ?? modules[0];

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

      {!loading && !error && context ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.95fr]">
            <div className="rounded-3xl border border-white/8 bg-stealth-950/42 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold tracking-[0.12em] text-stealth-400">{properCase(context.commodity)}</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{properCase(context.setup_label)}</p>
                  <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${biasTone(context.context_score.net_bias)}`}>
                    {properCase(String(context.context_score.net_bias))}
                  </div>
                </div>
                <div className="grid min-w-[220px] gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                    <p className="text-xs text-stealth-500">Confidence</p>
                    <p className="mt-2 text-4xl font-semibold text-white">{context.context_score.confidence_score}</p>
                    <p className="mt-1 text-xs text-stealth-400">{properCase(context.context_score.confidence)} conviction</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                    <p className="text-xs text-stealth-500">Next catalyst</p>
                    <p className="mt-2 text-lg font-semibold text-white">{context.report_calendar.next_report?.report ?? "No near-term report"}</p>
                    <p className="mt-1 text-xs text-stealth-400">{formatDateTime(context.report_calendar.next_report?.release_at)}</p>
                  </div>
                </div>
              </div>

              <p className="mt-5 max-w-3xl text-sm leading-6 text-stealth-100">{compactSummary(context)}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
                  <p className="text-xs text-stealth-500">Session</p>
                  <p className="mt-1 text-sm font-semibold text-white">{properCase(context.session.status)}</p>
                  <p className="mt-1 text-xs text-stealth-400">Closes {formatDateTime(context.session.next_close)}</p>
                </div>
                <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
                  <p className="text-xs text-stealth-500">Crop stage</p>
                  <p className="mt-1 text-sm font-semibold text-white">{properCase(context.crop_stage.stage)}</p>
                  <p className="mt-1 text-xs text-stealth-400">{properCase(context.crop_stage.weather_sensitivity)} sensitivity</p>
                </div>
                <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
                  <p className="text-xs text-stealth-500">Validation</p>
                  <p className="mt-1 text-sm font-semibold text-white">{properCase(context.thesis_validation.validation_status)}</p>
                  <p className="mt-1 text-xs text-stealth-400">{context.thesis_validation.confirmations?.length ?? 0} confirmations</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/8 bg-stealth-950/42 p-5">
              <p className="text-sm font-semibold text-white">Driver tabs</p>
              <p className="mt-2 text-sm leading-6 text-stealth-300">Pick one driver to inspect the signal without reading a wall of text.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {modules.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setActiveDriver(entry.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      activeDriver === entry.key
                        ? "border-emerald-300 bg-emerald-300/12 text-emerald-100"
                        : "border-stealth-700 bg-stealth-900/60 text-stealth-300 hover:border-stealth-500 hover:text-white"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {activeModule ? <div className="mt-4"><DriverPanel label={activeModule.label} module={activeModule.module} /></div> : null}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/8 bg-stealth-950/42 p-4">
              <p className="text-sm font-semibold text-white">Score Breakdown</p>
              <div className="mt-4 space-y-3">
                {Object.entries(context.context_score.component_breakdown).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between text-xs text-stealth-300">
                      <span>{properCase(key)}</span>
                      <span>{value > 0 ? "+1" : value < 0 ? "-1" : "0"}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-stealth-800">
                      <div
                        className={`h-2 rounded-full ${value > 0 ? "bg-emerald-400" : value < 0 ? "bg-rose-400" : "bg-stealth-600"}`}
                        style={{ width: `${Math.abs(value) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-stealth-950/42 p-4">
              <p className="text-sm font-semibold text-white">Thesis Validation</p>
              <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${biasTone(context.thesis_validation.validation_status.includes("confirm") ? "bullish" : "mixed")}`}>
                {properCase(context.thesis_validation.validation_status)}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-emerald-400">Confirmed</p>
                  <div className="mt-2 space-y-2">
                    {(context.thesis_validation.confirmations?.slice(0, 3) ?? []).map((item) => (
                      <div key={item} className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                        {item}
                      </div>
                    ))}
                    {!context.thesis_validation.confirmations?.length ? <p className="text-xs text-stealth-500">No strong confirmations yet.</p> : null}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-amber-400">Warnings</p>
                  <div className="mt-2 space-y-2">
                    {(context.thesis_validation.warnings?.slice(0, 3) ?? []).map((item) => (
                      <div key={item} className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        {item}
                      </div>
                    ))}
                    {!context.thesis_validation.warnings?.length ? <p className="text-xs text-stealth-500">No immediate validation warnings.</p> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}