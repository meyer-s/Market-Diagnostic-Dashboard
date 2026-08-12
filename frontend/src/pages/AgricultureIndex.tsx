import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import MarketLoading from "../components/ui/MarketLoading";
import { useApi } from "../hooks/useApi";
import { CompactContextDigest, type AgricultureContextData } from "../components/agriculture/AgricultureContextPanel";
import { ContractSignalBadge, ContractSignalLegend } from "../components/agriculture/ContractSignalBadge";
import { apiFetch } from "../utils/apiUtils";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
  formatTooltipValue,
} from "../utils/chartUtils";
import { getFamilyColor } from "../theme/metricColors";

type GroupRow = {
  group: string;
  label: string;
  effective_weight: number;
  symbol_count: number;
  group_composite: number;
  changes: Record<string, number | null>;
  volatility: number | null;
  breadth_score: number | null;
  strongest: Array<{ code: string; name: string; score: number; ticker: string | null }>;
  weakest: Array<{ code: string; name: string; score: number; ticker: string | null }>;
  components: Array<{
    code: string;
    name: string;
    score: number;
    ticker: string | null;
    changes: Record<string, number | null>;
    volatility: number | null;
  }>;
  stability_contribution: number;
  correlation_to_composite: number | null;
};

type CorrelationRow = { row: string; values: Record<string, number | null> };

type AgricultureOverview = {
  as_of: string;
  regime_label: string;
  stability_score: number;
  stability_components: Record<string, number>;
  component_history?: Array<{
    date: string;
    trend_agreement: number;
    volatility_stability: number;
    correlation_stability: number;
    breadth: number;
    momentum_consistency: number;
    divergence_penalty: number;
    stability_score: number;
  }>;
  summary: string;
  composite: {
    group_weights: Record<string, number>;
    changes: Record<string, number | null>;
    history: Array<{ date: string; value: number }>;
    volatility: number | null;
  };
  groups: GroupRow[];
  strongest_markets: Array<{ code: string; name: string; group: string; score: number }>;
  weakest_markets: Array<{ code: string; name: string; group: string; score: number }>;
  availability: {
    symbols: Array<{ code: string; name: string; group: string; status: string; ticker: string | null; points: number }>;
    missing_symbols: Array<{ code: string; name: string; group: string; attempted_tickers: string[] }>;
    missing_macro_series: string[];
    available_group_count: number;
    total_configured_symbols: number;
    available_symbol_count: number;
  };
  warnings: string[];
};

type AgricultureCorrelations = {
  as_of: string;
  correlations: {
    group_matrix: Record<string, CorrelationRow[]>;
    pair_insights: Record<string, Record<string, number | null>>;
  };
  special_signals: {
    soybean_oil_vs_grains: {
      spread_20d: number | null;
      soybean_oil_20d: number | null;
      avg_grains_20d: number | null;
      interpretation: string;
    };
    livestock_feed_margin_pressure: {
      spread_20d: number | null;
      grains_20d: number | null;
      livestock_20d: number | null;
      interpretation: string;
    };
  };
};

type AgricultureMacro = {
  as_of: string;
  macro_pressure: Record<string, { name: string; status: string; change_20d?: number | null; spread_20d?: number | null }>;
  special_signals: AgricultureCorrelations["special_signals"];
  availability: { missing_macro_series: string[] };
};

type Timeframe = "30d" | "90d" | "180d" | "365d" | "30y";

const BACKGROUND_CONTEXT_PREFETCH_CONCURRENCY = 2;

type LongViewPoint = { date: string; stability_score: number; composite_value: number };
type LongViewData = { history: LongViewPoint[] };
type TabKey = "overview" | "deepdive";

type StabilityPoint = {
  date: string;
  trend_agreement: number;
  volatility_stability: number;
  correlation_stability: number;
  breadth: number;
  momentum_consistency: number;
  divergence_penalty: number;
  stability_score: number;
};

type MacdPoint = {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
  breadth_centered: number | null;
  trend_centered: number | null;
};

type IndicatorContextEntry = {
  data: AgricultureContextData | null;
  error: string | null;
  loading: boolean;
};

const USDA_WASDE_URL = "https://www.usda.gov/oce/commodity/wasde";
const USDA_CROP_PROGRESS_URL = "https://www.nass.usda.gov/Charts_and_Maps/Crop_Progress_&_Condition/index.php";
const NOAA_WEATHER_URL = "https://api.weather.gov/";

const GROUP_COMPONENT_ORDER: Record<string, string[]> = {
  grains_oilseeds: ["ZC", "ZS", "ZW", "ZM", "ZL", "ZO", "KE", "MW", "ZR"],
  livestock: ["LE", "GF", "HE"],
  dairy: ["DC", "DAIRY_CLASS_IV"],
  softs: ["KC", "CC", "SB", "CT", "OJ", "RS"],
  lumber: ["LBR", "SYP"],
  fertilizer_inputs: ["FERT_N", "FERT_P", "FERT_K"],
};

const STABILITY_COMPONENT_META: Record<
  "trend_agreement" | "volatility_stability" | "correlation_stability" | "breadth" | "momentum_consistency" | "divergence_penalty",
  { label: string; description: string }
> = {
  trend_agreement: {
    label: "Trend",
    description: "How consistently sectors move in the same direction as the composite trend.",
  },
  volatility_stability: {
    label: "Volatility",
    description: "A calmer market (lower realized volatility) scores higher.",
  },
  correlation_stability: {
    label: "Correlation",
    description: "Stable inter-sector relationships with lower dispersion score higher.",
  },
  breadth: {
    label: "Breadth",
    description: "Share of components participating positively in the prevailing move.",
  },
  momentum_consistency: {
    label: "Momentum",
    description: "Agreement of 5d/20d/60d/120d directional momentum across symbols.",
  },
  divergence_penalty: {
    label: "Divergence Penalty",
    description: "Penalty for sharp cross-sector disagreement; lower is better.",
  },
};

const MACD_META: Record<"macd" | "signal" | "histogram" | "breadth_centered" | "trend_centered", { label: string; description: string }> = {
  macd: {
    label: "MACD",
    description: "Short-term stability momentum minus longer-term stability trend.",
  },
  signal: {
    label: "Signal",
    description: "Smoothed MACD line used to spot regime-quality momentum crossovers.",
  },
  histogram: {
    label: "Histogram",
    description: "Gap between MACD and signal; positive bars mean stability is improving.",
  },
  breadth_centered: {
    label: "Breadth vs 50",
    description: "Breadth shifted around zero so positive values mean wider participation.",
  },
  trend_centered: {
    label: "Trend vs 50",
    description: "Trend agreement shifted around zero so positive values mean better internal alignment.",
  },
};

function calculateEma(values: number[], period: number): number[] {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    ema.push((values[index] - ema[index - 1]) * multiplier + ema[index - 1]);
  }
  return ema;
}

function smoothSeries<T extends Record<string, unknown>>(rows: T[], keys: string[], window = 7): T[] {
  if (!rows.length || window <= 1) return rows;

  return rows.map((row, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = rows.slice(start, index + 1);
    const next: Record<string, unknown> = { ...row };

    for (const key of keys) {
      const values = slice
        .map((item) => {
          const value = item[key];
          return typeof value === "number" ? value : null;
        })
        .filter((value): value is number => value !== null);

      if (values.length) {
        next[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
      }
    }

    return next as T;
  });
}

function StabilityTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="max-w-xs rounded-xl border border-stealth-200/25 bg-stealth-950/45 p-3 text-xs shadow-[0_10px_40px_rgba(2,6,23,0.75)] backdrop-blur-2xl">
      <p className="font-semibold text-white">{label}</p>
      <div className="mt-2 space-y-2">
        {payload.map((entry) => {
          const key = entry.dataKey as keyof typeof STABILITY_COMPONENT_META;
          const meta = STABILITY_COMPONENT_META[key];
          if (!meta || typeof entry.value !== "number") return null;
          return (
            <div key={String(entry.dataKey)}>
              <p className="font-medium" style={{ color: entry.color ?? "var(--chart-tooltip-label)" }}>
                {meta.label}: {formatTooltipValue(entry.value, 1)}
              </p>
              <p className="text-xs leading-5 text-stealth-200">{meta.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MacdTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="max-w-xs rounded-xl border border-stealth-200/25 bg-stealth-950/45 p-3 text-xs shadow-[0_10px_40px_rgba(2,6,23,0.75)] backdrop-blur-2xl">
      <p className="font-semibold text-white">{label}</p>
      <div className="mt-2 space-y-2">
        {payload.map((entry) => {
          const key = entry.dataKey as keyof typeof MACD_META;
          const meta = MACD_META[key];
          if (!meta || typeof entry.value !== "number") return null;
          return (
            <div key={String(entry.dataKey)}>
              <p className="font-medium" style={{ color: entry.color ?? "var(--chart-tooltip-label)" }}>
                {meta.label}: {formatTooltipValue(entry.value, 2)}
              </p>
              <p className="text-xs leading-5 text-stealth-200">{meta.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getRegimeTone(regime: string): string {
  if (regime.includes("Stable Expansion")) return "text-emerald-300";
  if (regime.includes("Unstable Expansion")) return "text-amber-300";
  if (regime.includes("Stable Contraction")) return "text-orange-300";
  if (regime.includes("Shock Risk") || regime.includes("Unstable Contraction")) return "text-rose-300";
  return "text-sky-300";
}

function getScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-300";
  if (score >= 55) return "text-amber-300";
  return "text-rose-300";
}

function getScoreFill(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 55) return "bg-amber-500";
  return "bg-rose-500";
}

function getCorrCellStyle(value: number | null): string {
  if (value === null) return "bg-stealth-900/40 text-stealth-500";
  if (value >= 0.6) return "bg-emerald-500/20 text-emerald-300";
  if (value >= 0.3) return "bg-emerald-500/10 text-emerald-200";
  if (value <= -0.6) return "bg-rose-500/20 text-rose-300";
  if (value <= -0.3) return "bg-rose-500/10 text-rose-200";
  return "bg-stealth-800/70 text-stealth-300";
}

function formatGroupCode(group: string): string {
  return group.replace(/_/g, " ");
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
    syp: "SYP",
    "soy meal": "Soy Meal",
    "soy oil": "Soy Oil",
  };
  const direct = overrides[normalized.toLowerCase()];
  if (direct) return direct;
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word, index, array) => {
      const lowered = word.toLowerCase();
      if (overrides[lowered]) return overrides[lowered];
      if (index > 0 && index < array.length - 1 && smallWords.has(lowered)) {
        return lowered;
      }
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function sortGroupComponents(group: GroupRow): GroupRow["components"] {
  const preferredOrder = GROUP_COMPONENT_ORDER[group.group] ?? [];
  const orderMap = new Map(preferredOrder.map((code, index) => [code, index]));
  return [...group.components].sort((left, right) => {
    const leftIndex = orderMap.get(left.code) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderMap.get(right.code) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return right.score - left.score;
  });
}

function daysForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "30d") return 30;
  if (timeframe === "90d") return 90;
  if (timeframe === "180d") return 180;
  if (timeframe === "30y") return 10950;
  return 365;
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fallbackBiasLabel(score: number): { label: string; tone: string } {
  if (score >= 65) return { label: "Bullish", tone: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" };
  if (score <= 35) return { label: "Bearish", tone: "border-rose-400/30 bg-rose-500/10 text-rose-100" };
  return { label: "Balanced", tone: "border-sky-400/30 bg-sky-500/10 text-sky-100" };
}

function dominantMove(component: GroupRow["components"][number]): { label: string; value: number | null } {
  const candidates = (["5d", "20d", "60d", "120d"] as const)
    .map((key) => ({ label: key, value: component.changes[key] }))
    .filter((item): item is { label: "5d" | "20d" | "60d" | "120d"; value: number } => item.value !== null);

  return candidates.sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0] ?? { label: "20d", value: null };
}

function volatilityLabel(value: number | null): string {
  if (value === null || value === undefined) return "Unknown";
  if (value >= 35) return "High";
  if (value >= 20) return "Moderate";
  return "Calm";
}

function breadthLabel(value: number | null): string {
  if (value === null || value === undefined) return "Unclear";
  if (value >= 65) return "Broad support";
  if (value >= 45) return "Mixed support";
  return "Thin support";
}

function isHttpUrl(value?: string | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function buildFallbackSourceLinks(group: GroupRow, component: GroupRow["components"][number]): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (isHttpUrl(component.ticker ? `https://finance.yahoo.com/quote/${encodeURIComponent(component.ticker)}` : null)) {
    links.push({ label: "Current Price", url: `https://finance.yahoo.com/quote/${encodeURIComponent(component.ticker!)}` });
  }

  links.push({
    label: group.group === "grains_oilseeds" ? "Crop Reports" : "USDA Reports",
    url: group.group === "grains_oilseeds" ? USDA_CROP_PROGRESS_URL : USDA_WASDE_URL,
  });
  links.push({ label: "Weather Conditions", url: NOAA_WEATHER_URL });
  return links;
}

function formatFallbackError(error?: string | null): string | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized.includes("http error") || normalized.includes("unsupported agriculture symbol") || normalized.includes("404")) {
    return "Official context is unavailable for this indicator right now.";
  }
  return error;
}

function IndicatorFallbackDigest({
  group,
  component,
  error,
}: {
  group: GroupRow;
  component: GroupRow["components"][number];
  error?: string | null;
}) {
  const bias = fallbackBiasLabel(component.score);
  const move = dominantMove(component);
  const sourceLinks = buildFallbackSourceLinks(group, component);
  const friendlyError = formatFallbackError(error);

  return (
    <div className="rounded-2xl border border-white/8 bg-stealth-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${bias.tone}`}>{bias.label}</div>
          <p className="mt-3 text-sm leading-6 text-stealth-100">
            {properCase(component.name)} is leaning {bias.label.toLowerCase()} inside {group.label}, driven by {move.label} momentum at {formatSignedPercent(move.value)} with {volatilityLabel(component.volatility).toLowerCase()} volatility.
          </p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-stealth-950/40 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-400">Context Feed</p>
          <p className="mt-1 text-sm font-semibold text-white">Using local market structure</p>
          <p className="mt-1 text-xs text-stealth-400">Official context is not available for this indicator yet.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-400">Why Now</p>
          <p className="mt-1 text-sm font-semibold text-white">{move.label} momentum</p>
          <p className="mt-1 text-xs text-stealth-400">{formatSignedPercent(move.value)}</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-400">Risk State</p>
          <p className="mt-1 text-sm font-semibold text-white">{volatilityLabel(component.volatility)}</p>
          <p className="mt-1 text-xs text-stealth-400">{breadthLabel(group.breadth_score)}</p>
        </div>
        <div className="rounded-2xl bg-stealth-900/65 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-stealth-400">Market Fit</p>
          <p className="mt-1 text-sm font-semibold text-white">{group.label}</p>
          <p className="mt-1 text-xs text-stealth-400">vs composite {group.correlation_to_composite?.toFixed(2) ?? "—"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {sourceLinks.map((link) => (
          <a
            key={`${link.label}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-100 transition hover:border-sky-300/60 hover:bg-sky-400/15"
          >
            {link.label}
          </a>
        ))}
      </div>

      {friendlyError ? <p className="mt-4 text-xs text-stealth-300">{friendlyError}</p> : null}
    </div>
  );
}

export default function AgricultureIndex() {
  const [selectedIndicatorsByGroup, setSelectedIndicatorsByGroup] = useState<Record<string, string>>({});
  const [indicatorContexts, setIndicatorContexts] = useState<Record<string, IndicatorContextEntry>>({});
  const backgroundQueuedSymbolsRef = useRef<Set<string>>(new Set());
  const inFlightSymbolsRef = useRef<Set<string>>(new Set());
  const indicatorContextsRef = useRef<Record<string, IndicatorContextEntry>>({});
  const isMountedRef = useRef(true);
  const { data: overview, loading, error } = useApi<AgricultureOverview>("/agriculture/overview?days=365");
  const { data: correlations } = useApi<AgricultureCorrelations>("/agriculture/correlations?days=365");
  const { data: macro } = useApi<AgricultureMacro>("/agriculture/macro?days=365");
  const { data: longViewData } = useApi<LongViewData>("/agriculture/long-view");

  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const matrix60 = correlations?.correlations.group_matrix?.["60"] ?? [];
  const pair60 = correlations?.correlations.pair_insights?.["60"] ?? {};
  const groups = overview?.groups ?? [];

  const allComponentCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const group of groups) {
      for (const component of sortGroupComponents(group)) {
        codes.add(component.code);
      }
    }
    return [...codes];
  }, [groups]);

  const selectedComponentsByGroup = useMemo(() => {
    const result: Record<string, GroupRow["components"][number] | undefined> = {};
    for (const group of groups) {
      const sorted = sortGroupComponents(group);
      const selectedCode = selectedIndicatorsByGroup[group.group] ?? sorted[0]?.code;
      result[group.group] = sorted.find((item) => item.code === selectedCode) ?? sorted[0];
    }
    return result;
  }, [groups, selectedIndicatorsByGroup]);

  const primaryComponentCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const component of Object.values(selectedComponentsByGroup)) {
      if (component?.code) {
        codes.add(component.code);
      }
    }
    return [...codes];
  }, [selectedComponentsByGroup]);

  const secondaryComponentCodes = useMemo(
    () => allComponentCodes.filter((code) => !primaryComponentCodes.includes(code)),
    [allComponentCodes, primaryComponentCodes]
  );

  useEffect(() => {
    indicatorContextsRef.current = indicatorContexts;
  }, [indicatorContexts]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSelectedIndicatorsByGroup((current) => {
      const next = { ...current };
      let changed = false;

      for (const group of groups) {
        const sorted = sortGroupComponents(group);
        if (!sorted.length) continue;
        const validCodes = new Set(sorted.map((component) => component.code));
        if (!next[group.group] || !validCodes.has(next[group.group])) {
          next[group.group] = sorted[0].code;
          changed = true;
        }
      }

      for (const groupKey of Object.keys(next)) {
        if (!groups.some((group) => group.group === groupKey)) {
          delete next[groupKey];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [groups]);

  useEffect(() => {
    if (!primaryComponentCodes.length) return;

    const missingSymbols = primaryComponentCodes.filter(
      (code) => !indicatorContexts[code] && !inFlightSymbolsRef.current.has(code)
    );
    if (!missingSymbols.length) return;

    setIndicatorContexts((current) => {
      const next = { ...current };
      let changed = false;
      for (const symbol of missingSymbols) {
        if (!next[symbol]) {
          next[symbol] = { data: null, error: null, loading: true };
          changed = true;
        }
      }
      return changed ? next : current;
    });

    for (const symbol of missingSymbols) {
      inFlightSymbolsRef.current.add(symbol);

      void apiFetch<AgricultureContextData>(`/agriculture/context?symbol=${encodeURIComponent(symbol)}`)
        .then((data) => {
          if (!isMountedRef.current) return;
          setIndicatorContexts((current) => ({
            ...current,
            [symbol]: { data, error: null, loading: false },
          }));
        })
        .catch((fetchError) => {
          if (!isMountedRef.current) return;
          setIndicatorContexts((current) => ({
            ...current,
            [symbol]: {
              data: null,
              error: fetchError instanceof Error ? fetchError.message : "Failed to load context",
              loading: false,
            },
          }));
        })
        .finally(() => {
          inFlightSymbolsRef.current.delete(symbol);
        });
    }
  }, [indicatorContexts, primaryComponentCodes]);

  useEffect(() => {
    if (!secondaryComponentCodes.length) return;
    if (!primaryComponentCodes.length) return;

    const primaryReady = primaryComponentCodes.every((code) => {
      const entry = indicatorContexts[code];
      return entry && !entry.loading;
    });
    if (!primaryReady) return;

    const pendingSymbols = secondaryComponentCodes.filter(
      (code) => !indicatorContexts[code] && !backgroundQueuedSymbolsRef.current.has(code)
    );
    if (!pendingSymbols.length) return;

    for (const symbol of pendingSymbols) {
      backgroundQueuedSymbolsRef.current.add(symbol);
    }

    const runBackgroundPrefetch = async () => {
      const fetchSymbol = async (symbol: string) => {
        if (!isMountedRef.current) return;
        if (indicatorContextsRef.current[symbol] || inFlightSymbolsRef.current.has(symbol)) {
          return;
        }

        inFlightSymbolsRef.current.add(symbol);

        setIndicatorContexts((current) => {
          if (current[symbol]) return current;
          return {
            ...current,
            [symbol]: { data: null, error: null, loading: true },
          };
        });

        try {
          const data = await apiFetch<AgricultureContextData>(`/agriculture/context?symbol=${encodeURIComponent(symbol)}`);
          if (!isMountedRef.current) return;
          setIndicatorContexts((current) => ({
            ...current,
            [symbol]: { data, error: null, loading: false },
          }));
        } catch (fetchError) {
          if (!isMountedRef.current) return;
          setIndicatorContexts((current) => ({
            ...current,
            [symbol]: {
              data: null,
              error: fetchError instanceof Error ? fetchError.message : "Failed to load context",
              loading: false,
            },
          }));
        } finally {
          inFlightSymbolsRef.current.delete(symbol);
        }
      };

      let nextIndex = 0;
      const workerCount = Math.min(BACKGROUND_CONTEXT_PREFETCH_CONCURRENCY, pendingSymbols.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (nextIndex < pendingSymbols.length) {
            const symbol = pendingSymbols[nextIndex];
            nextIndex += 1;
            await fetchSymbol(symbol);
          }
        })
      );
    };

    void runBackgroundPrefetch();
  }, [indicatorContexts, primaryComponentCodes, secondaryComponentCodes]);

  const componentHistory = useMemo(() => {
    const rows = overview?.component_history ?? [];
    const days = daysForTimeframe(timeframe);
    if (rows.length <= days) return rows;
    return rows.slice(-days);
  }, [overview, timeframe]);

  const smoothedComponentHistory = useMemo(
    () =>
      smoothSeries<StabilityPoint>(
        componentHistory,
        [
          "trend_agreement",
          "volatility_stability",
          "correlation_stability",
          "breadth",
          "momentum_consistency",
          "divergence_penalty",
        ],
        10
      ),
    [componentHistory]
  );

  const macdHistory = useMemo(() => {
    if (!smoothedComponentHistory.length) return [] as MacdPoint[];

    // Use stability_score as MACD input — it has real regime variation (0-100).
    // The composite level hugs near 100 so EMA(12)-EMA(26) stays ~0.
    const stabilityValues = smoothedComponentHistory.map((point) => point.stability_score);
    const fastEma = calculateEma(stabilityValues, 12);
    const slowEma = calculateEma(stabilityValues, 26);
    const macdValues = stabilityValues.map((_, index) => fastEma[index] - slowEma[index]);
    const signalValues = calculateEma(macdValues, 9);

    return smoothedComponentHistory.map((point, index) => {
      const macd = macdValues[index];
      const signal = signalValues[index];
      return {
        date: point.date,
        macd,
        signal,
        histogram: macd - signal,
        breadth_centered: point.breadth - 50,
        trend_centered: point.trend_agreement - 50,
      };
    });
  }, [smoothedComponentHistory]);

  const longViewMacdHistory = useMemo((): MacdPoint[] => {
    const pts = longViewData?.history ?? [];
    if (!pts.length) return [];
    const vals = pts.map((p) => p.stability_score);
    const fast = calculateEma(vals, 12);
    const slow = calculateEma(vals, 26);
    const macdVals = vals.map((_, i) => fast[i] - slow[i]);
    const signalVals = calculateEma(macdVals, 9);
    return pts.map((p, i) => ({
      date: p.date,
      macd: macdVals[i],
      signal: signalVals[i],
      histogram: macdVals[i] - signalVals[i],
      breadth_centered: null,
      trend_centered: null,
    }));
  }, [longViewData]);

  const activeMacdData = timeframe === "30y" ? longViewMacdHistory : macdHistory;
  const activeStabilityData: Array<{ date: string; stability_score: number }> =
    timeframe === "30y" ? (longViewData?.history ?? []) : smoothedComponentHistory;

  if (loading) {
    return (
      <div className="page-shell-wide page-stack">
        <header>
          <span className="page-kicker">Tools</span>
          <h1 className="page-title">Agriculture Index</h1>
          <p className="page-subtitle">Loading futures-based agriculture diagnostics.</p>
        </header>
        <div className="flex min-h-[50vh] items-center justify-center">
          <MarketLoading size={120} variant="pulse" label="Loading Agriculture Index..." />
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="page-shell-wide page-stack">
        <div className="surface-card-strong p-6">
          <h1 className="text-2xl font-semibold text-stealth-100">Agriculture Index</h1>
          <p className="mt-3 text-sm text-rose-300">
            Failed to load agriculture diagnostics. The module is defensive to missing symbols, but the backend response was unavailable.
          </p>
          {error ? <p className="mt-2 text-xs text-stealth-400">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-wide page-stack">
      <div>
        <span className="page-kicker">Tools</span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Agriculture Index</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-stealth-300 md:text-[15px]">
          A futures-based macro diagnostic for agriculture regime stability. This is not a trading signal and is designed for contextual market structure analysis.
        </p>
      </div>

      <div id="agriculture-now" className="section-anchor surface-card-strong p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Stability Snapshot</p>
            <p className={`mt-2 text-4xl font-semibold ${getScoreTone(overview.stability_score)}`}>{overview.stability_score.toFixed(1)}</p>
            <div className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700">
              <div className={`h-2 rounded-full ${getScoreFill(overview.stability_score)}`} style={{ width: `${overview.stability_score}%` }}></div>
            </div>
            <p className="mt-2 text-xs text-stealth-400">As of {new Date(overview.as_of).toLocaleString()}</p>
          </div>
          <div className="w-full min-w-0 rounded-lg border border-stealth-700 bg-stealth-900/50 px-3 py-2 sm:w-auto sm:min-w-[220px]">
            <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Regime</p>
            <p className={`mt-1 text-xl font-semibold ${getRegimeTone(overview.regime_label)}`}>{overview.regime_label}</p>
            <p className="mt-1 text-xs text-stealth-400">Coverage: {overview.availability.available_group_count} sectors</p>
          </div>
          <div className="w-full min-w-0 rounded-lg border border-stealth-700 bg-stealth-900/50 px-3 py-2 sm:w-auto sm:min-w-[220px]">
            <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Availability</p>
            <p className="mt-1 text-xl font-semibold text-stealth-100">
              {overview.availability.available_symbol_count}/{overview.availability.total_configured_symbols}
            </p>
            <p className="mt-1 text-xs text-stealth-400">Symbols with sufficient history</p>
          </div>
          <div className="w-full min-w-0 rounded-lg border border-stealth-700 bg-stealth-900/50 px-3 py-2 sm:w-auto sm:min-w-[240px]">
            <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Composite Moves</p>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <p className="text-stealth-400">5d: <span className="text-stealth-200">{overview.composite.changes["5d"]?.toFixed(2) ?? "—"}%</span></p>
              <p className="text-stealth-400">20d: <span className="text-stealth-200">{overview.composite.changes["20d"]?.toFixed(2) ?? "—"}%</span></p>
              <p className="text-stealth-400">60d: <span className="text-stealth-200">{overview.composite.changes["60d"]?.toFixed(2) ?? "—"}%</span></p>
              <p className="text-stealth-400">120d: <span className="text-stealth-200">{overview.composite.changes["120d"]?.toFixed(2) ?? "—"}%</span></p>
            </div>
          </div>
        </div>
      </div>

      <div id="agriculture-summary" className="section-anchor surface-card-strong p-5">
        <p className="text-sm text-stealth-200">{overview.summary}</p>
      </div>

      <div
        id="agriculture-views"
        className="section-anchor mb-2 flex gap-2 border-b border-stealth-700"
        role="tablist"
        aria-label="Agriculture analysis view"
      >
        {([
          { key: "overview", label: "Overview" },
          { key: "deepdive", label: "Deep Dive" },
        ] as Array<{ key: TabKey; label: string }>).map((tab) => (
          <button
            key={tab.key}
            id={`agriculture-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`agriculture-panel-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`min-h-11 border-b-2 px-3 font-semibold transition ${
              activeTab === tab.key
                ? "border-emerald-500 text-emerald-300"
                : "border-transparent text-stealth-400 hover:text-stealth-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <section
          id="agriculture-panel-overview"
          role="tabpanel"
          aria-labelledby="agriculture-tab-overview"
          className="section-anchor space-y-6 md:space-y-8"
        >
          <div className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-stealth-100">Stability Momentum (MACD-style)</h2>
                <p className="mt-1 text-xs text-stealth-400">
                  {timeframe === "30y"
                    ? "Monthly data — 30-year lookback. EMA(12,26,9) on monthly stability."
                    : "Regime quality momentum centered around zero — positive histogram means stability is improving. Breadth and trend overlaid for context."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Stability history window">
                {(["30d", "90d", "180d", "365d", "30y"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    aria-pressed={timeframe === tf}
                    onClick={() => setTimeframe(tf)}
                    className={`min-h-11 rounded-md px-3 text-xs font-medium ${
                      timeframe === tf
                        ? "bg-stealth-700 text-stealth-100"
                        : "bg-stealth-900 text-stealth-400 hover:text-stealth-200"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart
                  accessibilityLayer
                  aria-label="Agriculture stability momentum and signal history"
                  data={activeMacdData}
                  margin={CHART_MARGIN}
                >
                  <CartesianGrid {...commonGridProps} />
                  <XAxis dataKey="date" {...commonXAxisProps} />
                  {/* Left axis: MACD/histogram scale */}
                  <YAxis yAxisId="left" {...commonYAxisProps} />
                  {/* Right axis: breadth/trend scale (hidden — just prevents them from squashing the left axis) */}
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip content={<MacdTooltip />} />
                  <Legend
                    verticalAlign="top"
                    height={30}
                    formatter={(value: string) => {
                      const key = value as keyof typeof MACD_META;
                      return MACD_META[key]?.label ?? value;
                    }}
                  />
                  <ReferenceLine yAxisId="left" y={0} stroke={getFamilyColor("benchmark")} strokeDasharray="3 3" />
                  <Bar yAxisId="left" dataKey="histogram" name="histogram" barSize={10}>
                    {macdHistory.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.histogram >= 0 ? "rgba(52,211,153,0.45)" : "rgba(251,113,133,0.45)"}
                        stroke={entry.histogram >= 0 ? "rgba(52,211,153,0.9)" : "rgba(251,113,133,0.9)"}
                      />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="macd"
                    name="macd"
                    stroke="#38bdf8"
                    strokeWidth={2.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="signal"
                    name="signal"
                    stroke="#fb923c"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {timeframe !== "30y" && (
                    <>
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="breadth_centered"
                        name="breadth_centered"
                        stroke={getFamilyColor("liquidity")}
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="trend_centered"
                        name="trend_centered"
                        stroke={getFamilyColor("growth")}
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                        dot={false}
                        strokeDasharray="4 3"
                        isAnimationActive={false}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="surface-card p-4">
            <h2 className="text-base font-semibold text-stealth-100">Stability Score</h2>
            <div className="mt-4 h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart
                  accessibilityLayer
                  aria-label="Agriculture composite stability score history"
                  data={activeStabilityData}
                  margin={CHART_MARGIN}
                >
                  <CartesianGrid {...commonGridProps} />
                  <XAxis dataKey="date" {...commonXAxisProps} />
                  <YAxis {...commonYAxisProps} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0.5rem", fontSize: "0.75rem" }}
                    formatter={(value: number) => [value.toFixed(1), "Stability"]}
                  />
                  <ReferenceLine y={70} stroke="#34d399" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <ReferenceLine y={55} stroke="#fbbf24" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <Line type="monotone" dataKey="stability_score" stroke="#38bdf8" strokeWidth={2.4} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="surface-card p-4 xl:col-span-2">
              <h2 className="text-base font-semibold text-stealth-100">Stability Components (History)</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart
                    accessibilityLayer
                    aria-label="Agriculture stability component history"
                    data={smoothedComponentHistory}
                    margin={CHART_MARGIN}
                  >
                    <CartesianGrid {...commonGridProps} />
                    <XAxis dataKey="date" {...commonXAxisProps} />
                    <YAxis {...commonYAxisProps} domain={[0, 100]} />
                    <Tooltip content={<StabilityTooltip />} />
                    <Legend
                      verticalAlign="top"
                      height={30}
                      formatter={(value: string) => {
                        const key = value as keyof typeof STABILITY_COMPONENT_META;
                        return STABILITY_COMPONENT_META[key]?.label ?? value;
                      }}
                    />
                    <Line type="monotone" dataKey="trend_agreement" name="trend_agreement" stroke={getFamilyColor("growth")} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="volatility_stability" name="volatility_stability" stroke={getFamilyColor("volatility")} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="correlation_stability" name="correlation_stability" stroke={getFamilyColor("equity")} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="breadth" name="breadth" stroke={getFamilyColor("liquidity")} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="momentum_consistency" name="momentum_consistency" stroke={getFamilyColor("tech")} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="divergence_penalty" name="divergence_penalty" stroke="#f87171" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-stealth-400">
                <span>Trend</span>
                <span>Volatility</span>
                <span>Correlation</span>
                <span>Breadth</span>
                <span>Momentum</span>
                <span className="text-rose-300">Divergence Penalty</span>
              </div>
            </div>

            <div className="surface-card p-4">
              <h2 className="text-base font-semibold text-stealth-100">Leaders & Laggards</h2>
              <div className="mt-3 space-y-2">
                {overview.strongest_markets.slice(0, 3).map((row) => (
                  <div key={`lead-${row.code}`} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                    <p className="text-sm font-medium text-emerald-200">{row.code}</p>
                    <p className="text-xs text-stealth-400">{row.name}</p>
                    <p className="text-sm font-semibold text-emerald-300">{row.score.toFixed(1)}</p>
                  </div>
                ))}
                {overview.weakest_markets.slice(0, 3).map((row) => (
                  <div key={`lag-${row.code}`} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                    <p className="text-sm font-medium text-rose-200">{row.code}</p>
                    <p className="text-xs text-stealth-400">{row.name}</p>
                    <p className="text-sm font-semibold text-rose-300">{row.score.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "deepdive" ? (
        <section
          id="agriculture-panel-deepdive"
          role="tabpanel"
          aria-labelledby="agriculture-tab-deepdive"
          className="section-anchor space-y-6 md:space-y-8"
        >
          <div id="agriculture-sectors" className="section-anchor">
            <h2 className="text-base font-semibold text-stealth-100">Sector Analysis</h2>
            <ContractSignalLegend />
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => (
                <div key={group.group} className="surface-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stealth-100">{group.label}</h3>
                    <span className="shrink-0 rounded bg-stealth-800 px-2 py-0.5 text-xs text-stealth-400">
                      {group.effective_weight.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <p className={`text-2xl font-semibold ${getScoreTone(group.group_composite)}`}>
                      {group.group_composite.toFixed(1)}
                    </p>
                    <div className="flex-1">
                      <div className="h-1.5 w-full rounded-full bg-stealth-700">
                        <div
                          className={`h-1.5 rounded-full ${getScoreFill(group.group_composite)}`}
                          style={{ width: `${group.group_composite}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1 text-xs">
                    {(["5d", "20d", "60d", "120d"] as const).map((k) => {
                      const v = group.changes[k];
                      return (
                        <div key={k} className="rounded bg-stealth-900/55 px-1 py-1.5 text-center">
                          <p className="text-stealth-500">{k}</p>
                          <p className={v === null ? "text-stealth-500" : v >= 0 ? "text-emerald-300" : "text-rose-300"}>
                            {v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1 text-xs">
                    <div className="rounded bg-stealth-900/40 px-2 py-1">
                      <p className="text-stealth-500">Vol</p>
                      <p className="text-stealth-200">{group.volatility?.toFixed(1) ?? "—"}</p>
                    </div>
                    <div className="rounded bg-stealth-900/40 px-2 py-1">
                      <p className="text-stealth-500">Breadth</p>
                      <p className="text-stealth-200">{group.breadth_score?.toFixed(1) ?? "—"}</p>
                    </div>
                    <div className="rounded bg-stealth-900/40 px-2 py-1">
                      <p className="text-stealth-500">vs Comp</p>
                      <p className="text-stealth-200">{group.correlation_to_composite?.toFixed(2) ?? "—"}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label={`Select ${group.label} component`}
                    >
                      {sortGroupComponents(group).map((component) => {
                        const selected = selectedIndicatorsByGroup[group.group] === component.code;
                        const indicatorEntry = indicatorContexts[component.code];
                        return (
                          <button
                            key={component.code}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setSelectedIndicatorsByGroup((current) => ({ ...current, [group.group]: component.code }))}
                            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-stealth-950 ${
                              selected
                                ? "border-sky-300 bg-sky-400/10 text-white"
                                : "border-stealth-700 bg-stealth-900/60 text-stealth-300 hover:border-stealth-500 hover:text-white"
                            }`}
                          >
                            <span aria-hidden="true">{component.code}</span>
                            <ContractSignalBadge
                              symbol={component.code}
                              context={indicatorEntry?.data}
                              loading={!indicatorEntry || indicatorEntry.loading}
                              error={indicatorEntry?.error}
                            />
                          </button>
                        );
                      })}
                    </div>

                    {selectedComponentsByGroup[group.group] ? (
                      <div className="mt-4 rounded-2xl border border-white/8 bg-stealth-900/45 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{properCase(selectedComponentsByGroup[group.group]!.name)}</p>
                            <p className="mt-1 text-xs text-stealth-400">{selectedComponentsByGroup[group.group]!.code}{selectedComponentsByGroup[group.group]!.ticker ? ` • ${selectedComponentsByGroup[group.group]!.ticker}` : ""}</p>
                          </div>
                          <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getScoreTone(selectedComponentsByGroup[group.group]!.score)}`}>
                            {selectedComponentsByGroup[group.group]!.score.toFixed(1)}
                          </div>
                        </div>
                        <div className="mt-4">
                          {indicatorContexts[selectedComponentsByGroup[group.group]!.code]?.data ? (
                            <CompactContextDigest context={indicatorContexts[selectedComponentsByGroup[group.group]!.code]!.data!} variant="indicator" />
                          ) : indicatorContexts[selectedComponentsByGroup[group.group]!.code]?.loading ? (
                            <div className="rounded-2xl border border-white/8 bg-stealth-950/60 px-4 py-5 text-sm text-stealth-300">
                              Loading live context for {selectedComponentsByGroup[group.group]!.code}...
                            </div>
                          ) : (
                            <IndicatorFallbackDigest
                              group={group}
                              component={selectedComponentsByGroup[group.group]!}
                              error={indicatorContexts[selectedComponentsByGroup[group.group]!.code]?.error}
                            />
                          )}
                        </div>
                        <p className="mt-4 text-xs leading-5 text-stealth-400">
                          Detailed datapoints remain available in the broader diagnostics, but this view stays focused on the current read and catalyst.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div id="agriculture-correlations" className="section-anchor grid gap-4 xl:grid-cols-2">
            <div className="surface-card min-w-0 max-w-full overflow-hidden p-4">
              <h2 id="agriculture-correlation-heading" className="text-base font-semibold text-stealth-100">Rolling Correlation Matrix (60d)</h2>
              <p id="agriculture-correlation-description" className="mt-1 text-xs leading-5 text-stealth-300">
                Pairwise 60-day group correlations. Scroll horizontally on narrow screens.
              </p>
              <div
                className="mt-3 max-w-full overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pulse-400"
                role="region"
                aria-labelledby="agriculture-correlation-heading"
                aria-describedby="agriculture-correlation-description"
                tabIndex={0}
              >
                <table className="w-max min-w-[640px] border-collapse text-xs text-stealth-300">
                  <thead>
                    <tr>
                      <th scope="col" className="border border-stealth-700 px-2 py-2 text-left text-stealth-300">Group</th>
                      {matrix60[0] ? Object.keys(matrix60[0].values).map((col) => (
                        <th scope="col" key={col} className="border border-stealth-700 px-2 py-2 text-left text-stealth-300">{formatGroupCode(col)}</th>
                      )) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix60.map((row) => (
                      <tr key={row.row}>
                        <th scope="row" className="border border-stealth-700 px-2 py-2 font-medium text-stealth-200">{formatGroupCode(row.row)}</th>
                        {Object.entries(row.values).map(([col, value]) => (
                          <td key={col} className={`border border-stealth-700 px-2 py-2 ${getCorrCellStyle(value)}`}>
                            {value === null ? "—" : value.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div id="agriculture-signals" className="section-anchor space-y-4">
              <div className="surface-card p-4">
                <h2 className="text-base font-semibold text-stealth-100">Special Signals</h2>
                <div className="mt-3 space-y-3 text-sm text-stealth-300">
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="font-semibold text-stealth-100">Soybean Oil vs Grains</p>
                    <p className="mt-1 text-xs text-stealth-400">
                      Spread 20d: {correlations?.special_signals.soybean_oil_vs_grains.spread_20d ?? "—"}%
                    </p>
                    <p className="mt-1">{correlations?.special_signals.soybean_oil_vs_grains.interpretation ?? "insufficient data"}</p>
                  </div>
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="font-semibold text-stealth-100">Livestock Feed Margin Pressure</p>
                    <p className="mt-1 text-xs text-stealth-400">
                      Spread 20d: {correlations?.special_signals.livestock_feed_margin_pressure.spread_20d ?? "—"}%
                    </p>
                    <p className="mt-1">{correlations?.special_signals.livestock_feed_margin_pressure.interpretation ?? "insufficient data"}</p>
                  </div>
                  {Object.keys(pair60).length > 0 ? (
                    <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                      <p className="font-semibold text-stealth-100">Pair Correlations (60d)</p>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-stealth-400">
                        {Object.entries(pair60).map(([key, value]) => (
                          <p key={key}>{formatGroupCode(key)}: {value === null ? "—" : value.toFixed(2)}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="surface-card p-4">
                <h2 className="text-base font-semibold text-stealth-100">Macro Pressure</h2>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {macro?.macro_pressure
                    ? Object.entries(macro.macro_pressure).map(([key, item]) => (
                        <div key={key} className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                          <p className="text-sm font-semibold text-stealth-100">{item.name}</p>
                          <p className="mt-1 text-xs text-stealth-400">{item.status}</p>
                          <p className="mt-1 text-xs text-stealth-500">
                            20d:{" "}
                            {item.change_20d !== undefined && item.change_20d !== null
                              ? `${item.change_20d.toFixed(2)}%`
                              : item.spread_20d !== undefined && item.spread_20d !== null
                              ? `${item.spread_20d.toFixed(2)}%`
                              : "—"}
                          </p>
                        </div>
                      ))
                    : null}
                </div>
              </div>
            </div>
          </div>

          <div id="agriculture-coverage" className="section-anchor surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-stealth-100">Data Coverage</h2>
              <div className="flex gap-4 text-xs text-stealth-400">
                <span>Symbols: {overview.availability.available_symbol_count}/{overview.availability.total_configured_symbols}</span>
                <span>Groups: {overview.availability.available_group_count}/6</span>
                {overview.availability.missing_symbols.length > 0 ? (
                  <span className="text-amber-400">{overview.availability.missing_symbols.length} missing</span>
                ) : null}
              </div>
            </div>
            {(overview.availability.missing_symbols.length > 0 || overview.availability.missing_macro_series.length > 0) ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {overview.availability.missing_symbols.length > 0 ? (
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Missing Symbols</p>
                    <div className="mt-2 space-y-1 text-xs text-stealth-400">
                      {overview.availability.missing_symbols.map((item) => (
                        <p key={item.code}>{item.code}: {item.attempted_tickers.join(", ")}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {overview.availability.missing_macro_series.length > 0 ? (
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Missing Macro</p>
                    <div className="mt-2 space-y-1 text-xs text-stealth-400">
                      {overview.availability.missing_macro_series.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 space-y-1 text-xs text-stealth-400">
              {overview.warnings.map((warning) => (
                <p key={warning}>— {warning}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
