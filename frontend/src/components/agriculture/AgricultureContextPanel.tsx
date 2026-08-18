import { useMemo, useState } from "react";

type BiasValue = "bullish" | "bearish" | "neutral" | "mixed" | string;

type SourceHealth = {
  source_name?: string;
  source_url?: string | null;
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
  report_url?: string | null;
  report_link?: string | null;
  forecast_url?: string | null;
  reasons?: string[];
  warnings?: string[];
  source_health?: SourceHealth;
};

type TechnicalModule = {
  bias?: BiasValue;
  confidence?: string;
  ticker?: string;
  current_price?: number | null;
  change_20d?: number | null;
  change_60d?: number | null;
  change_120d?: number | null;
  warnings?: string[];
};

export type AgricultureContextData = {
  as_of?: string;
  symbol: string;
  commodity: string;
  metadata?: {
    commodity_group?: string;
    display_name?: string;
    exchange?: string;
    related_reports?: string[];
    weather_regions?: string[];
    global_drivers?: string[];
    demand_drivers?: string[];
    supply_drivers?: string[];
  };
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
  const catalyst = getCatalystPresentation(context);
  const confidence = properCase(context.context_score.confidence);
  if (catalyst.isPast) {
    return `${context.commodity} has a ${properCase(String(context.context_score.net_bias)).toLowerCase()} bias with ${confidence.toLowerCase()} confidence. The release calendar is awaiting an update after ${catalyst.name}.`;
  }
  return `${context.commodity} has a ${properCase(String(context.context_score.net_bias)).toLowerCase()} bias with ${confidence.toLowerCase()} confidence. ${catalyst.name} is the next scheduled catalyst.`;
}

function biasTextTone(value?: BiasValue): string {
  if (value === "bullish") return "text-emerald-200";
  if (value === "bearish") return "text-rose-200";
  if (value === "mixed") return "text-amber-200";
  return "text-sky-200";
}

function getCatalystPresentation(context: AgricultureContextData): {
  heading: string;
  name: string;
  timing: string;
  isPast: boolean;
} {
  const nextReport = context.report_calendar.next_report;
  if (!nextReport?.release_at) {
    return { heading: "Catalyst calendar", name: "No near-term report", timing: "No scheduled release is available.", isPast: false };
  }

  const release = new Date(nextReport.release_at);
  const reference = new Date(context.as_of ?? context.session.current_time_et ?? Date.now());
  if (Number.isNaN(release.getTime()) || Number.isNaN(reference.getTime())) {
    return { heading: "Next catalyst", name: nextReport.report, timing: formatDateTime(nextReport.release_at), isPast: false };
  }

  const releaseDay = new Date(release.getFullYear(), release.getMonth(), release.getDate()).getTime();
  const referenceDay = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  const dayDelta = Math.round((releaseDay - referenceDay) / 86_400_000);
  const isPast = release.getTime() < reference.getTime();
  const exactTime = release.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (isPast) {
    const timing = dayDelta === -1
      ? "Occurred yesterday — update pending"
      : dayDelta === 0
        ? "Occurred earlier today — update pending"
        : `Scheduled ${release.toLocaleDateString()} — calendar refresh required`;
    return { heading: "Calendar update", name: nextReport.report, timing, isPast: true };
  }

  const timing = dayDelta === 0
    ? `Today at ${exactTime}`
    : dayDelta === 1
      ? `Tomorrow at ${exactTime}`
      : `In ${dayDelta} days · ${release.toLocaleDateString()} at ${exactTime}`;
  return { heading: "Next catalyst", name: nextReport.report, timing, isPast: false };
}

function biasLabel(value?: BiasValue): string {
  if (value === "bullish") return "Long bias";
  if (value === "bearish") return "Short bias";
  return "Neutral bias";
}

function setupSourceLabel(context: AgricultureContextData): string {
  const setup = context.setup_label.toLowerCase();
  if (setup.includes("aligned")) return "Technical + fundamental aligned";
  if (setup.includes("fundamental-only")) return "Fundamentals only";
  if (setup.includes("technical-only")) return "Technicals only";
  if (setup.includes("conflict")) return "Technical / fundamental conflict";
  return "Mixed evidence";
}

function actionStateLabel(context: AgricultureContextData): string {
  if (context.session.status !== "open") return "Market closed";
  const setup = context.setup_label.toLowerCase();
  if (setup.includes("wait for report")) return "Wait for report";
  if (setup.includes("avoid")) return "Avoid";
  if (setup.includes("conflict")) return "Resolve conflict";
  return "Watch setup";
}

function isHttpUrl(value?: string | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function buildPriceUrl(ticker?: string | null): string | null {
  if (!ticker) return null;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}

function getNextReportSource(context: AgricultureContextData): { label: string; url: string } | null {
  const reportName = context.report_calendar.next_report?.report;
  if (reportName === "Crop Progress" && isHttpUrl(context.crop_progress.report_url)) {
    return { label: "USDA Crop Progress report", url: context.crop_progress.report_url };
  }
  if (reportName === "WASDE" && isHttpUrl(context.wasde.report_link)) {
    return { label: "USDA WASDE report", url: context.wasde.report_link };
  }
  if (reportName === "Export Inspections" && isHttpUrl(context.export_demand.source_health?.source_url)) {
    return { label: "USDA Export Inspections", url: context.export_demand.source_health.source_url };
  }
  if (reportName === "Export Sales" && isHttpUrl(context.report_calendar.source_health?.source_url)) {
    return { label: "USDA Export Sales", url: context.report_calendar.source_health.source_url };
  }
  if (isHttpUrl(context.crop_progress.report_url)) {
    return { label: "USDA crop report", url: context.crop_progress.report_url };
  }
  if (isHttpUrl(context.wasde.report_link)) {
    return { label: "USDA WASDE report", url: context.wasde.report_link };
  }
  if (isHttpUrl(context.report_calendar.source_health?.source_url)) {
    return { label: "Official report calendar", url: context.report_calendar.source_health.source_url };
  }
  return null;
}

function getSourceLinks(context: AgricultureContextData): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];

  const priceUrl = buildPriceUrl(context.technical.ticker);
  if (priceUrl) {
    links.push({ label: "Futures price on Yahoo Finance", url: priceUrl });
  }

  const weatherUrl = context.weather.forecast_url ?? context.weather.source_health?.source_url;
  if (isHttpUrl(weatherUrl)) {
    links.push({
      label: "National Weather Service",
      url: weatherUrl.includes("api.weather.gov") ? "https://www.weather.gov/" : weatherUrl,
    });
  }

  const nextReport = getNextReportSource(context);
  if (nextReport) {
    links.push(nextReport);
  }

  return links.filter((link, index) => links.findIndex((candidate) => candidate.url === link.url) === index);
}

function SourceLinks({
  links,
  dense = false,
}: {
  links: Array<{ label: string; url: string }>;
  dense?: boolean;
}) {
  if (!links.length) return null;

  if (dense) {
    return (
      <details className="group mt-4 border-t border-stealth-700/80">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-semibold text-stealth-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
          <span>Sources · {links.length}</span>
          <span className="transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <div className="flex flex-wrap gap-2 pb-1">
          {links.map((link) => (
            <a
              key={`${link.label}-${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center rounded-lg border border-stealth-600 bg-stealth-900/70 px-3 text-xs font-semibold text-sky-100 transition hover:border-sky-300/60 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              {link.label}<span aria-hidden="true"> ↗</span><span className="sr-only">, opens in a new tab</span>
            </a>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="mt-5 border-t border-stealth-700/80 pt-4">
      <p className="text-xs font-semibold text-stealth-300">Supporting sources</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={`${link.label}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center rounded-lg border border-stealth-600 bg-stealth-900/70 px-3 text-xs font-semibold text-sky-100 transition hover:border-sky-300/60 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            {link.label}<span aria-hidden="true"> ↗</span><span className="sr-only">, opens in a new tab</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function getModuleMeta(context: AgricultureContextData) {
  const group = context.metadata?.commodity_group ?? "grains_oilseeds";

  const LABELS: Record<string, { cropProgress: string; exportDemand: string; wasde: string; globalSupply: string }> = {
    livestock: { cropProgress: "Production Cycle", exportDemand: "Cutout / Demand", wasde: "Supply Balance", globalSupply: "Feed Cost Proxy" },
    dairy: { cropProgress: "Dairy Prices", exportDemand: "Dairy Prices", wasde: "Supply Balance", globalSupply: "Global Dairy Cycle" },
    softs: { cropProgress: "Crop Conditions", exportDemand: "World Production", wasde: "WASDE / Balance", globalSupply: "Global Supply" },
    lumber: { cropProgress: "Building Permits", exportDemand: "Housing Starts", wasde: "Supply Balance", globalSupply: "Construction Cycle" },
    fertilizer_inputs: { cropProgress: "Demand Signal", exportDemand: "Planting Demand", wasde: "Input Costs", globalSupply: "Global Trade" },
    grains_oilseeds: { cropProgress: "Crop Progress", exportDemand: "Export Demand", wasde: "WASDE", globalSupply: "Global Supply" },
  };

  const labels = LABELS[group] ?? LABELS["grains_oilseeds"];

  return [
    { key: "weather", label: "Weather", breakdownKey: "weather", module: context.weather },
    { key: "cropProgress", label: labels.cropProgress, breakdownKey: "crop_progress", module: context.crop_progress },
    { key: "exportDemand", label: labels.exportDemand, breakdownKey: "export_demand", module: context.export_demand },
    { key: "wasde", label: labels.wasde, breakdownKey: "wasde", module: context.wasde },
    { key: "globalSupply", label: labels.globalSupply, breakdownKey: "global_supply", module: context.global_supply },
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
  const [activeDriver, setActiveDriver] = useState<string | null>(null);
  const dense = variant === "indicator";
  const modules = getModuleMeta(context);
  const warning = context.thesis_validation.warnings?.[0] ?? context.context_score.warnings?.[0] ?? context.session.warnings?.[0];
  const sourceLinks = getSourceLinks(context);
  const rankedDrivers = modules
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      contribution: context.context_score.component_breakdown[entry.breakdownKey] ?? 0,
      bias: entry.module.bias,
      explanation: "reasons" in entry.module && entry.module.reasons?.[0]
        ? entry.module.reasons[0]
        : `${entry.label} is ${properCase(String(entry.module.bias ?? "neutral")).toLowerCase()} in the current model.`,
      freshness: "source_health" in entry.module ? entry.module.source_health?.freshness_status : entry.module.confidence,
    }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const leadingDrivers = rankedDrivers.filter((entry) => entry.contribution !== 0).slice(0, dense ? 2 : 3);
  const catalyst = getCatalystPresentation(context);
  const selectedDriver = rankedDrivers.find((entry) => entry.key === activeDriver);

  if (dense) {
    return (
      <div>
        <dl className="grid grid-cols-2 border-y border-stealth-700/80 xl:grid-cols-4">
          <div className="border-b border-stealth-700/80 py-2.5 pr-3 xl:border-b-0"><dt className="text-xs font-semibold text-stealth-400">Bias</dt><dd className={`mt-1 text-sm font-semibold ${biasTextTone(context.context_score.net_bias)}`}>{biasLabel(context.context_score.net_bias)}</dd></div>
          <div className="border-b border-l border-stealth-700/80 py-2.5 pl-3 xl:border-b-0 xl:px-4"><dt className="text-xs font-semibold text-stealth-400">Source</dt><dd className="mt-1 text-sm font-semibold text-white">{setupSourceLabel(context)}</dd></div>
          <div className="py-2.5 pr-3 xl:border-l xl:border-stealth-700/80 xl:px-4"><dt className="text-xs font-semibold text-stealth-400">Confidence</dt><dd className="mt-1 text-sm font-semibold text-white">{properCase(context.context_score.confidence)} · <span className="tabular-nums">{context.context_score.confidence_score.toFixed(1)}</span></dd></div>
          <div className="border-l border-stealth-700/80 py-2.5 pl-3 xl:px-4"><dt className="text-xs font-semibold text-stealth-400">Action</dt><dd className="mt-1 text-sm font-semibold text-white">{actionStateLabel(context)}</dd></div>
        </dl>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,.75fr)]">
          <div>
            <p className="text-xs font-semibold text-stealth-300">Drivers</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {leadingDrivers.length ? leadingDrivers.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  aria-expanded={activeDriver === entry.key}
                  aria-controls="agriculture-driver-explanation"
                  onClick={() => setActiveDriver((current) => current === entry.key ? null : entry.key)}
                  className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${contributionTone(entry.contribution)}`}
                >
                  {entry.label} · {entry.contribution > 0 ? "supportive" : "restrictive"}
                </button>
              )) : <p className="text-sm text-stealth-300">No driver has a material directional contribution.</p>}
            </div>
            {selectedDriver ? (
              <div id="agriculture-driver-explanation" className="mt-3 border-l border-sky-300/50 pl-3 text-sm leading-6 text-stealth-200">
                <p>{selectedDriver.explanation}</p>
                <p className={`mt-1 text-xs ${freshnessTone(selectedDriver.freshness)}`}>Source state: {properCase(selectedDriver.freshness ?? "unknown")}</p>
              </div>
            ) : null}
          </div>
          <div className="border-t border-stealth-700/80 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <p className="text-xs font-semibold text-stealth-400">{catalyst.heading}</p>
            <p className="mt-1 text-sm font-semibold text-white">{catalyst.name}</p>
            <p className={`mt-1 text-xs ${catalyst.isPast ? "text-amber-200" : "text-stealth-300"}`}>{catalyst.timing}</p>
          </div>
        </div>

        <SourceLinks links={sourceLinks} dense />

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
          <div className="rounded-2xl border border-white/8 bg-stealth-950/40 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Confidence</p>
            <p className="mt-2 text-4xl font-semibold text-white">{context.context_score.confidence_score.toFixed(1)}</p>
            <p className="mt-1 text-xs text-stealth-400">{properCase(context.context_score.confidence)} conviction</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-stealth-950/40 p-3">
            <p className="text-xs font-semibold text-stealth-400">{catalyst.heading}</p>
            <p className="mt-1 text-sm font-semibold text-white">{catalyst.name}</p>
            <p className={`mt-1 text-xs ${catalyst.isPast ? "text-amber-200" : "text-stealth-400"}`}>{catalyst.timing}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Session</p>
          <p className="mt-1 text-sm font-semibold text-white">{properCase(context.session.status)}</p>
          <p className="mt-1 text-xs text-stealth-400">{formatDateTime(context.session.next_close)}</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Crop Stage</p>
          <p className="mt-1 text-sm font-semibold text-white">{properCase(context.crop_stage.stage)}</p>
          <p className="mt-1 text-xs text-stealth-400">{properCase(context.crop_stage.weather_sensitivity)} sensitivity</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Validation</p>
          <div className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${validationTone(context.thesis_validation.validation_status)}`}>
            {properCase(context.thesis_validation.validation_status)}
          </div>
          <p className="mt-2 text-xs text-stealth-400">{context.thesis_validation.confirmations?.length ?? 0} confirmations</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-500">Primary Driver</p>
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
                  <p className="mt-1 text-xs text-stealth-300">{properCase(String(badgeText))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-white">{contribution > 0 ? "+1" : contribution < 0 ? "-1" : "0"}</p>
                  <p className={`text-xs ${freshnessTone(source?.freshness_status)}`}>{properCase(source?.freshness_status ?? entry.module.confidence ?? "mixed")}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <SourceLinks links={sourceLinks} />

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
