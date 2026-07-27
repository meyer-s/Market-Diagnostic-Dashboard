import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRightLeft,
  Check,
  ChevronDown,
  FlaskConical,
  Info,
  Link2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import MarketWeatherCanvas from "../components/marketWeather/MarketWeatherCanvas";
import MarketWeatherMethodologyReport from "../components/marketWeather/MarketWeatherMethodologyReport";
import MarketWeatherResearchLab from "../components/marketWeather/MarketWeatherResearchLab";
import MarketLoading from "../components/ui/MarketLoading";
import { useApi } from "../hooks/useApi";
import type {
  MarketWeatherComparisonBasis,
  MarketWeatherComparisonMode,
  MarketWeatherComparisonResponse,
  MarketWeatherComparisonView,
  MarketWeatherLanguageView,
  MarketWeatherMode,
  MarketWeatherResponse,
  MarketWeatherTimeframe,
  MarketWeatherTimelineLens,
} from "../types/marketWeather";
import { channelLabel, formatSigned, INSPECTOR_CHANNELS } from "../utils/marketWeather";
import { trackPairEvent } from "../utils/marketWeatherPairTelemetry";
import {
  DEFAULT_MARKET_WEATHER_CONFIG,
  marketWeatherAnalysisParams,
  marketWeatherComparisonParams,
  parseMarketWeatherQuery,
  serializeMarketWeatherQuery,
  type MarketWeatherQueryState,
  type MarketWeatherRecipeConfig,
} from "../utils/marketWeatherQuery";
import type { MarketTimelineWindow } from "../utils/marketWeatherTimeline";

const MarketWeatherComparisonLab = lazy(
  () => import("../components/marketWeather/MarketWeatherComparisonLab"),
);

const TIMEFRAMES: Array<{
  value: MarketWeatherTimeframe;
  label: string;
  defaultBars: number;
  barOptions: number[];
}> = [
  { value: "1m", label: "1 minute", defaultBars: 750, barOptions: [500, 750, 1200] },
  { value: "5m", label: "5 minutes", defaultBars: 750, barOptions: [500, 750, 1200] },
  { value: "15m", label: "15 minutes", defaultBars: 750, barOptions: [500, 750, 900] },
  { value: "30m", label: "30 minutes", defaultBars: 750, barOptions: [500, 750, 1000] },
  { value: "1h", label: "1 hour", defaultBars: 500, barOptions: [360, 500, 570] },
  { value: "2h", label: "2 hours", defaultBars: 250, barOptions: [180, 250, 280] },
  { value: "4h", label: "4 hours", defaultBars: 120, barOptions: [100, 120, 140] },
  { value: "1D", label: "1 day", defaultBars: 750, barOptions: [504, 750, 1000] },
  { value: "1W", label: "1 week", defaultBars: 520, barOptions: [260, 520, 780] },
];

const MODES: Array<{ value: MarketWeatherMode; label: string; description: string }> = [
  { value: "regime", label: "Regime Health", description: "Direction is primary; the uncalibrated display-organization score controls intensity." },
  { value: "convection", label: "Convection", description: "Adds blue boundary energy where a transition is actively organizing." },
  { value: "topographic", label: "Topographic", description: "Quantizes reflectivity into contour-like intensity bands." },
  { value: "swami", label: "Swami Classic", description: "The categorical benchmark from the original SwamiCharts concept." },
  { value: "inspector", label: "Channel Inspector", description: "Isolates one latent field so the composite can be audited." },
];

const CORE_BENCHMARKS = [
  { symbol: "SPY", label: "S&P 500 proxy", category: "Broad-cap market reference" },
  { symbol: "QQQ", label: "Nasdaq-100 proxy", category: "Growth/technology-heavy reference" },
  { symbol: "IWM", label: "Russell 2000 proxy", category: "Small-cap reference" },
  { symbol: "RSP", label: "equal-weight S&P 500", category: "Equal-weight market reference" },
  { symbol: "DXY", label: "U.S. Dollar Index", category: "Dollar-index macro reference" },
] as const;

const SECTOR_BENCHMARKS = [
  { symbol: "XLB", label: "Materials", category: "Sector reference" },
  { symbol: "XLC", label: "Communication", category: "Sector reference" },
  { symbol: "XLE", label: "Energy", category: "Sector reference" },
  { symbol: "XLF", label: "Financials", category: "Sector reference" },
  { symbol: "XLI", label: "Industrials", category: "Sector reference" },
  { symbol: "XLK", label: "Technology", category: "Sector reference" },
  { symbol: "XLP", label: "Staples", category: "Sector reference" },
  { symbol: "XLRE", label: "Real estate", category: "Sector reference" },
  { symbol: "XLU", label: "Utilities", category: "Sector reference" },
  { symbol: "XLV", label: "Health care", category: "Sector reference" },
  { symbol: "XLY", label: "Discretionary", category: "Sector reference" },
] as const;

const inputClass = "min-h-11 rounded-xl border border-stealth-600 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-400/10 sm:min-h-10";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function parseMarketTimestamp(value: string): Date {
  return new Date(value.includes("T") ? value : `${value}T00:00:00`);
}

function formatChartTick(value: string, timeframe: MarketWeatherTimeframe): string {
  const date = parseMarketTimestamp(value);
  return !["1D", "1W"].includes(timeframe)
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function formatHorizon(horizon: number, timeframe: MarketWeatherTimeframe): string {
  const units: Record<MarketWeatherTimeframe, [number, string]> = {
    "1m": [1, "m"], "5m": [5, "m"], "15m": [15, "m"], "30m": [30, "m"],
    "1h": [1, "h"], "2h": [2, "h"], "4h": [4, "h"], "1D": [1, "d"], "1W": [1, "wk"],
  };
  const [multiplier, unit] = units[timeframe];
  const value = horizon * multiplier;
  return `${value}${unit}`;
}

function directionTone(value: number): string {
  if (value >= 0.1) return "text-emerald-300";
  if (value <= -0.1) return "text-rose-300";
  return "text-amber-300";
}

function cacheLabel(data: MarketWeatherResponse): string | null {
  const analysisStatus = data.cache?.analysis?.status;
  const historyStatus = data.cache?.history?.status;
  if (analysisStatus === "hit") return "Analysis cache hit";
  if (analysisStatus === "wait") return "Shared calculation";
  if (historyStatus === "hit") return "Stored history";
  if (historyStatus === "refreshed") return "History refreshed";
  if (historyStatus === "stale_fallback") return "Stale history fallback";
  if (historyStatus === "cache_bypass") return "History cache bypass";
  return null;
}

function formatCacheAge(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown age";
  if (value < 60) return `${Math.round(value)}s old`;
  if (value < 3600) return `${Math.round(value / 60)}m old`;
  return `${(value / 3600).toFixed(value < 36_000 ? 1 : 0)}h old`;
}

function buildEndpoint(config: MarketWeatherRecipeConfig): string {
  return `/market-weather/analyze?${marketWeatherAnalysisParams(config).toString()}`;
}

function buildComparisonEndpoint(config: MarketWeatherRecipeConfig, benchmarkSymbol: string): string {
  return `/market-weather/compare?${marketWeatherComparisonParams(config, benchmarkSymbol).toString()}`;
}

function isDxySymbol(value: string): boolean {
  return new Set(["DXY", "^DXY", "DX-Y.NYB"]).has(value.trim().toUpperCase());
}

function normalizePairSymbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  return isDxySymbol(normalized) ? "DXY" : normalized;
}

export default function MarketWeatherRadar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQueryRef = useRef<MarketWeatherQueryState | null>(null);
  if (!initialQueryRef.current) initialQueryRef.current = parseMarketWeatherQuery(searchParams);
  const initialQuery = initialQueryRef.current;
  const [draft, setDraft] = useState<MarketWeatherRecipeConfig>(initialQuery.config);
  const [applied, setApplied] = useState<MarketWeatherRecipeConfig>(initialQuery.config);
  const [comparisonMode, setComparisonMode] = useState<MarketWeatherComparisonMode>(initialQuery.comparisonMode);
  const [draftComparisonMode, setDraftComparisonMode] = useState<MarketWeatherComparisonMode>(initialQuery.comparisonMode);
  const [compareSymbol, setCompareSymbol] = useState(initialQuery.compareSymbol);
  const [draftCompareSymbol, setDraftCompareSymbol] = useState(initialQuery.compareSymbol);
  const [comparisonBasis, setComparisonBasis] = useState<MarketWeatherComparisonBasis>(initialQuery.comparisonBasis);
  const [comparisonView, setComparisonView] = useState<MarketWeatherComparisonView>(initialQuery.comparisonView);
  const [comparisonDimension, setComparisonDimension] = useState(initialQuery.comparisonDimension);
  const [pairTab, setPairTab] = useState(initialQuery.pairTab);
  const [pairScopeTrail, setPairScopeTrail] = useState(initialQuery.pairScopeTrail);
  const [pairScopeScale, setPairScopeScale] = useState(initialQuery.pairScopeScale);
  const [pairCoordinateOrder, setPairCoordinateOrder] = useState(initialQuery.pairCoordinateOrder);
  const [mode, setMode] = useState<MarketWeatherMode>(initialQuery.mode);
  const [draftMode, setDraftMode] = useState<MarketWeatherMode>(initialQuery.mode);
  const [inspectorChannel, setInspectorChannel] = useState(initialQuery.channel);
  const [draftInspectorChannel, setDraftInspectorChannel] = useState(initialQuery.channel);
  const [languageView, setLanguageView] = useState<MarketWeatherLanguageView>(initialQuery.view);
  const [timelineLens, setTimelineLens] = useState<MarketWeatherTimelineLens>(initialQuery.timelineLens);
  const [timelineWindow, setTimelineWindow] = useState<MarketTimelineWindow>(initialQuery.timelineWindow);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rawDataOpen, setRawDataOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsDialogRef = useRef<HTMLFormElement | null>(null);
  const queryStateRef = useRef<MarketWeatherQueryState>(initialQuery);
  const appliedKeyRef = useRef(marketWeatherAnalysisParams(initialQuery.config).toString());
  const shareTimerRef = useRef<number | null>(null);
  const endpoint = useMemo(
    () => comparisonMode === "single" ? buildEndpoint(applied) : "",
    [applied, comparisonMode],
  );
  const comparisonEndpoint = useMemo(
    () => comparisonMode === "pair" ? buildComparisonEndpoint(applied, compareSymbol) : "",
    [applied, compareSymbol, comparisonMode],
  );
  const singleApi = useApi<MarketWeatherResponse>(endpoint);
  const comparisonApi = useApi<MarketWeatherComparisonResponse>(
    comparisonEndpoint,
    { retainPreviousData: false },
  );
  const data = singleApi.data;
  const comparisonData = comparisonApi.data;
  const loading = comparisonMode === "pair" ? comparisonApi.loading : singleApi.loading;
  const error = comparisonMode === "pair" ? comparisonApi.error : singleApi.error;
  const refetch = comparisonMode === "pair" ? comparisonApi.refetch : singleApi.refetch;
  const pairAlignmentUnsupported = draftComparisonMode === "pair"
    && (isDxySymbol(draft.symbol) || isDxySymbol(draftCompareSymbol))
    && !(isDxySymbol(draft.symbol) && isDxySymbol(draftCompareSymbol))
    && ["1h", "2h", "4h"].includes(draft.timeframe);
  const queryString = searchParams.toString();

  useEffect(() => {
    const next = parseMarketWeatherQuery(queryString);
    queryStateRef.current = next;
    const nextAnalysisKey = marketWeatherAnalysisParams(next.config).toString();
    if (nextAnalysisKey !== appliedKeyRef.current) {
      appliedKeyRef.current = nextAnalysisKey;
      setApplied(next.config);
      setDraft(next.config);
    }
    setComparisonMode(next.comparisonMode);
    setDraftComparisonMode(next.comparisonMode);
    setCompareSymbol(next.compareSymbol);
    setDraftCompareSymbol(next.compareSymbol);
    setComparisonBasis(next.comparisonBasis);
    setComparisonView(next.comparisonView);
    setComparisonDimension(next.comparisonDimension);
    setPairTab(next.pairTab);
    setPairScopeTrail(next.pairScopeTrail);
    setPairScopeScale(next.pairScopeScale);
    setPairCoordinateOrder(next.pairCoordinateOrder);
    setMode(next.mode);
    setDraftMode(next.mode);
    setInspectorChannel(next.channel);
    setDraftInspectorChannel(next.channel);
    setLanguageView(next.view);
    setTimelineLens(next.timelineLens);
    setTimelineWindow(next.timelineWindow);
  }, [queryString]);

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(refetch, 60_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, refetch]);

  useEffect(() => {
    if (!settingsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById("root");
    document.body.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        settingsDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      appRoot?.removeAttribute("inert");
      document.removeEventListener("keydown", handleDialogKey);
    };
  }, [settingsOpen]);

  const chartData = useMemo(() => {
    if (!data || !rawDataOpen) return [];
    const weightTotal = data.horizons.reduce((sum, horizon) => sum + horizon, 0);
    return data.price.map((point, dateIndex) => ({
      date: point.date,
      close: point.close,
      field: data.channels.pressure.reduce(
        (sum, row, horizonIndex) => sum + (row[dateIndex] ?? 0) * data.horizons[horizonIndex],
        0,
      ) / weightTotal,
    }));
  }, [data, rawDataOpen]);

  const applyPreset = (preset: "balanced" | "tactical" | "structural") => {
    const next = preset === "tactical"
      ? { ...draft, horizonMin: 4, horizonMax: 48, horizonStep: 1, stateSmoothing: 3, rendererTimeBlur: 2 }
      : preset === "structural"
        ? { ...draft, horizonMin: 12, horizonMax: 96, horizonStep: 2, stateSmoothing: 7, rendererTimeBlur: 5 }
        : { ...draft, ...DEFAULT_MARKET_WEATHER_CONFIG, symbol: draft.symbol, timeframe: draft.timeframe, bars: draft.bars };
    setDraft(next);
  };

  const currentQueryState = (overrides: Partial<MarketWeatherQueryState> = {}): MarketWeatherQueryState => ({
    ...queryStateRef.current,
    ...overrides,
  });

  const commitAnalysis = (
    config: MarketWeatherRecipeConfig,
    nextMode = mode,
    nextChannel = inspectorChannel,
    nextComparisonMode = draftComparisonMode,
    nextCompareSymbol = draftCompareSymbol,
  ) => {
    const normalizedTarget = config.symbol.trim().toUpperCase() || "SPY";
    const requestedBenchmark = nextCompareSymbol.trim().toUpperCase() || (normalizedTarget === "QQQ" ? "SPY" : "QQQ");
    const normalized = parseMarketWeatherQuery(serializeMarketWeatherQuery({
      ...currentQueryState(),
      config: { ...config, symbol: normalizedTarget },
      comparisonMode: nextComparisonMode,
      compareSymbol: requestedBenchmark,
      mode: nextMode,
      channel: nextChannel,
    }));
    queryStateRef.current = normalized;
    appliedKeyRef.current = marketWeatherAnalysisParams(normalized.config).toString();
    setApplied(normalized.config);
    setDraft(normalized.config);
    setComparisonMode(normalized.comparisonMode);
    setDraftComparisonMode(normalized.comparisonMode);
    setCompareSymbol(normalized.compareSymbol);
    setDraftCompareSymbol(normalized.compareSymbol);
    setMode(normalized.mode);
    setDraftMode(normalized.mode);
    setInspectorChannel(normalized.channel);
    setDraftInspectorChannel(normalized.channel);
    setSearchParams(serializeMarketWeatherQuery(normalized), { replace: false });
  };

  const runAnalysis = (event: React.FormEvent) => {
    event.preventDefault();
    if (pairAlignmentUnsupported) return;
    commitAnalysis(draft);
  };

  const applySettings = () => {
    commitAnalysis(draft, draftMode, draftInspectorChannel, draftComparisonMode, draftCompareSymbol);
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };

  const updatePresentation = (overrides: Partial<MarketWeatherQueryState>) => {
    const next = currentQueryState(overrides);
    queryStateRef.current = next;
    if (overrides.mode) setMode(overrides.mode);
    if (overrides.comparisonMode) {
      setComparisonMode(overrides.comparisonMode);
      setDraftComparisonMode(overrides.comparisonMode);
    }
    if (overrides.compareSymbol) {
      setCompareSymbol(overrides.compareSymbol);
      setDraftCompareSymbol(overrides.compareSymbol);
    }
    if (overrides.comparisonBasis) setComparisonBasis(overrides.comparisonBasis);
    if (overrides.comparisonView) setComparisonView(overrides.comparisonView);
    if (overrides.comparisonDimension) setComparisonDimension(overrides.comparisonDimension);
    if (overrides.pairTab) setPairTab(overrides.pairTab);
    if (overrides.pairScopeTrail) setPairScopeTrail(overrides.pairScopeTrail);
    if (overrides.pairScopeScale) setPairScopeScale(overrides.pairScopeScale);
    if (overrides.pairCoordinateOrder) setPairCoordinateOrder(overrides.pairCoordinateOrder);
    if (overrides.channel) setInspectorChannel(overrides.channel);
    if (overrides.view) setLanguageView(overrides.view);
    if (overrides.timelineLens) setTimelineLens(overrides.timelineLens);
    if (overrides.timelineWindow) setTimelineWindow(overrides.timelineWindow);
    setSearchParams(serializeMarketWeatherQuery(next), { replace: true });
  };

  const copyReportLink = async () => {
    const url = new URL(window.location.href);
    url.search = serializeMarketWeatherQuery(currentQueryState()).toString();
    url.hash = "";
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("copied");
      if (comparisonMode === "pair" && comparisonData) {
        trackPairEvent(
          "pair_live_recipe_copied",
          comparisonData.comparison_hash,
          { timeframe: comparisonData.timeframe },
        );
      }
    } catch {
      setShareStatus("error");
    }
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setShareStatus("idle"), 2600);
  };

  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0];
  const activeTimeframe = TIMEFRAMES.find((item) => item.value === draft.timeframe) ?? TIMEFRAMES[7];
  const historyOptions = Array.from(new Set([...activeTimeframe.barOptions, draft.bars])).sort((left, right) => left - right);
  const normalizedDraftCompareSymbol = normalizePairSymbol(draftCompareSymbol);
  const comparatorMeta = [...CORE_BENCHMARKS, ...SECTOR_BENCHMARKS].find(
    (item) => item.symbol === normalizedDraftCompareSymbol,
  );
  const draftPairDiffersFromApplied = draftComparisonMode !== comparisonMode
    || marketWeatherAnalysisParams({
      ...draft,
      symbol: normalizePairSymbol(draft.symbol),
    }).toString() !== marketWeatherAnalysisParams({
      ...applied,
      symbol: normalizePairSymbol(applied.symbol),
    }).toString()
    || normalizedDraftCompareSymbol !== normalizePairSymbol(compareSymbol);
  const pairResultTargetSymbol = comparisonData?.target?.symbol ?? "";
  const pairResultBenchmarkSymbol = comparisonData?.benchmark?.symbol ?? "";
  const hasCurrentPairResult = Boolean(pairResultTargetSymbol && pairResultBenchmarkSymbol);
  const currentPairResultMatchesApplied = hasCurrentPairResult && (
    normalizePairSymbol(pairResultTargetSymbol) === normalizePairSymbol(applied.symbol)
    && normalizePairSymbol(pairResultBenchmarkSymbol) === normalizePairSymbol(compareSymbol)
    && comparisonData?.timeframe === applied.timeframe
  );
  const comparisonSessionStatus = comparisonData?.compatibility?.session?.status
    ?? comparisonData?.overlap?.session_compatibility
    ?? (comparisonData?.overlap?.session_compatible === true
      ? "compatible"
      : comparisonData?.overlap?.session_compatible === false ? "incompatible" : "unknown");
  const requestedHistoryShortfall = data?.history_context
    ? Math.max(0, data.history_context.requested_visible_bars - data.history_context.visible_bars)
    : 0;
  const minimumInputSatisfied = data?.history_context
    ? data.history_context.minimum_input_satisfied
      ?? data.history_context.status !== "insufficient"
    : false;
  const initializationTargetCovered = data?.history_context
    ? data.history_context.initialization_target_covered
      ?? data.history_context.warmup_complete
    : false;
  const initializationTargetBars = data?.history_context
    ? data.history_context.initialization_target_bars
      ?? data.history_context.target_warmup_bars
    : 0;
  const settingsDialog = settingsOpen ? createPortal(
    <div
      className="fixed inset-0 z-[320] flex items-end justify-center bg-slate-950/78 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget !== event.target) return;
        setSettingsOpen(false);
        window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
      }}
    >
      <form
        ref={settingsDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-settings-title"
        onSubmit={(event) => {
          event.preventDefault();
          applySettings();
        }}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-[28px] border border-stealth-600 bg-slate-900 shadow-[0_32px_120px_-24px_rgba(0,0,0,0.95)] sm:rounded-[28px]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/8 bg-slate-900/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div>
            <div className="page-kicker">One control surface</div>
            <h2 id="field-settings-title" className="mt-1 text-lg font-semibold text-white">Field settings</h2>
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setSettingsOpen(false);
              window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
            }}
            className="grid h-11 w-11 place-items-center rounded-full border border-stealth-600 text-slate-300 transition hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            aria-label="Close field settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <section>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Analysis shape</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["balanced", "tactical", "structural"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="min-h-11 rounded-xl border border-stealth-600 px-3 py-2 text-xs capitalize text-slate-300 transition hover:border-sky-400/50 hover:text-white sm:min-h-10"
                >
                  {preset}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">History</span>
              <select value={draft.bars} onChange={(event) => setDraft((current) => ({ ...current, bars: Number(event.target.value) }))} className={inputClass}>
                {historyOptions.map((value) => <option key={value} value={value}>{value.toLocaleString()} bars</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Field lens</span>
                <select value={draftMode} onChange={(event) => setDraftMode(event.target.value as MarketWeatherMode)} className={inputClass}>
                {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            {draftMode === "inspector" ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Inspector channel</span>
                <select value={draftInspectorChannel} onChange={(event) => setDraftInspectorChannel(event.target.value)} className={inputClass}>
                  {INSPECTOR_CHANNELS.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                </select>
              </label>
            ) : null}
          </section>

          <section>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Field construction</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Min horizon", "horizonMin", 4, 100, 1],
                ["Max horizon", "horizonMax", 8, 120, 1],
                ["Horizon step", "horizonStep", 1, 12, 1],
                ["State smoothing", "stateSmoothing", 1, 20, 1],
                ["Cross-horizon blend", "crossHorizonBlend", 0, 1, 0.05],
                ["Time blur", "rendererTimeBlur", 1, 20, 1],
                ["Spatial blend", "rendererSpatialBlend", 0, 1, 0.05],
                ["Edge gain", "edgeGain", 0.25, 4, 0.05],
                ["Reflectivity compression", "reflectivityCompression", 0.25, 12, 0.25],
                ["Contour bands", "contourBands", 3, 16, 1],
              ].map(([label, key, min, max, step]) => (
                <label key={String(key)} className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-400">{String(label)}</span>
                  <input
                    type="number"
                    min={Number(min)}
                    max={Number(max)}
                    step={Number(step)}
                    value={draft[key as keyof MarketWeatherRecipeConfig]}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          </section>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} className="accent-sky-400" />
            Refresh the applied field every minute
          </label>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-white/8 bg-slate-900/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <button type="button" onClick={refetch} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh current
          </button>
          <button type="submit" disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-60">
            <Activity className="h-4 w-4" /> Apply & analyze
          </button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <>
    <div className="page-shell-wide space-y-4 md:space-y-5">
      <section className="page-hero">
        <div className="relative z-[1] flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">Multi-horizon market structure</span>
              <span className="page-badge border-sky-400/20 text-sky-200"><FlaskConical className="h-3.5 w-3.5" /> Auditable field recipe</span>
            </div>
            <h1 className="page-title">Market Field Language</h1>
            <p className="page-subtitle max-w-3xl">Direction, activity, horizon agreement, disorder, and cross-horizon movement are shown as separate measurements. Request-local Forms summarize calibration-relative profiles.</p>
          </div>
          {data || (comparisonMode === "pair" && comparisonData) ? (
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              {data ? <span className="page-badge"><Activity className="h-3.5 w-3.5 text-emerald-300" /> {data.data_source.toUpperCase()} · {data.bar_size} bars</span> : null}
              {comparisonMode === "pair" && comparisonData ? <span className="page-badge"><ArrowRightLeft className="h-3.5 w-3.5 text-teal-300" /> {comparisonData.target.symbol} / {comparisonData.benchmark.symbol} · {comparisonData.timeframe}</span> : null}
              {data && cacheLabel(data) ? (
                <span
                  className="page-badge"
                  title="Identical calculations are briefly reused per server worker; OHLCV history is shared persistently across workers."
                >
                  {cacheLabel(data)}
                </span>
              ) : null}
              {data ? <span className="page-badge">{data.horizons.length} × {data.available_bars}</span> : null}
              {comparisonMode === "pair" && comparisonData ? <span className="page-badge">{comparisonData.overlap.common_observations.toLocaleString()} shared bars</span> : null}
              {data ? <span className="page-badge">{formatTimestamp(data.generated_at)}</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="surface-card-strong p-3 sm:p-4">
        <form onSubmit={runAnalysis} className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Analysis</span>
              <div className="inline-flex min-h-11 rounded-xl border border-stealth-600 bg-slate-950/60 p-1">
                {(["single", "pair"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDraftComparisonMode(option)}
                    aria-pressed={draftComparisonMode === option}
                    className={`rounded-lg px-3 text-xs font-semibold capitalize transition ${draftComparisonMode === option ? "bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/25" : "text-slate-400 hover:text-white"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[260px]">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{draftComparisonMode === "pair" ? "Target" : "Ticker"}</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={draft.symbol}
                  onChange={(event) => setDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                  className={`${inputClass} w-full pl-9 font-semibold tracking-wide`}
                  maxLength={20}
                  aria-label="Ticker symbol"
                />
              </div>
            </label>
            {draftComparisonMode === "pair" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const currentTarget = draft.symbol;
                    setDraft((current) => ({ ...current, symbol: draftCompareSymbol }));
                    setDraftCompareSymbol(currentTarget);
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stealth-600 px-3 text-slate-300 transition hover:border-teal-400/50 hover:text-white"
                  aria-label="Swap target and benchmark"
                  title="Swap target and benchmark; the sign of every difference will reverse."
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </button>
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[260px]">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Benchmark or comparison symbol</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={draftCompareSymbol}
                      onChange={(event) => setDraftCompareSymbol(event.target.value.toUpperCase())}
                      className={`${inputClass} w-full pl-9 font-semibold tracking-wide`}
                      maxLength={20}
                      aria-label="Benchmark or comparison symbol"
                    />
                  </div>
                </label>
              </>
            ) : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Timeframe</span>
              <select
                value={draft.timeframe}
                onChange={(event) => {
                  const timeframe = event.target.value as MarketWeatherTimeframe;
                  const option = TIMEFRAMES.find((item) => item.value === timeframe) ?? TIMEFRAMES[7];
                  setDraft((current) => ({ ...current, timeframe, bars: option.defaultBars }));
                }}
                className={inputClass}
              >
                {TIMEFRAMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{draftComparisonMode === "pair" ? "Shared history" : "History"}</span>
              <select value={draft.bars} onChange={(event) => setDraft((current) => ({ ...current, bars: Number(event.target.value) }))} className={inputClass}>
                {historyOptions.map((value) => <option key={value} value={value}>{value.toLocaleString()} bars</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => {
                setDraftMode(mode);
                setDraftInspectorChannel(inspectorChannel);
                setSettingsOpen(true);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <SlidersHorizontal className="h-4 w-4" /> Settings
            </button>
            <button
              type="button"
              onClick={() => void copyReportLink()}
              title="Copies the field recipe and visible controls. Current provider data is loaded when opened."
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              {shareStatus === "copied" ? <Check className="h-4 w-4 text-emerald-300" /> : <Link2 className="h-4 w-4" />}
              <span>{shareStatus === "copied" ? "Copied" : "Copy live recipe"}</span>
            </button>
            <button type="submit" disabled={loading || pairAlignmentUnsupported} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-60 sm:flex-none">
              <Activity className="h-4 w-4" /> Analyze
            </button>
          </div>
        </form>
        {draftComparisonMode === "pair" ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-stealth-700 pt-3 sm:flex-row sm:items-center">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Compare with</span>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {CORE_BENCHMARKS.map((benchmark) => (
                <button
                  key={benchmark.symbol}
                  type="button"
                  onClick={() => setDraftCompareSymbol(benchmark.symbol)}
                  aria-pressed={draftCompareSymbol === benchmark.symbol}
                  title={`${benchmark.symbol} — ${benchmark.label}`}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${draftCompareSymbol === benchmark.symbol ? "border-teal-400/45 bg-teal-400/10 text-teal-200" : "border-stealth-600 text-slate-400 hover:border-slate-400 hover:text-white"}`}
                >
                  {benchmark.symbol}
                </button>
              ))}
              <select
                value={SECTOR_BENCHMARKS.some((benchmark) => benchmark.symbol === draftCompareSymbol) ? draftCompareSymbol : ""}
                onChange={(event) => {
                  if (event.target.value) setDraftCompareSymbol(event.target.value);
                }}
                aria-label="Select Sector SPDR benchmark"
                className="min-h-8 shrink-0 rounded-full border border-stealth-600 bg-slate-950/70 px-3 text-xs text-slate-300 outline-none transition hover:border-slate-400 focus:border-teal-400"
              >
                <option value="">Sector SPDR…</option>
                {SECTOR_BENCHMARKS.map((benchmark) => (
                  <option key={benchmark.symbol} value={benchmark.symbol}>{benchmark.symbol} — {benchmark.label} sector reference</option>
                ))}
              </select>
              <span className="inline-flex min-h-8 shrink-0 items-center rounded-full border border-dashed border-stealth-600 px-3 text-[10px] text-slate-500">
                Or enter a custom comparison
              </span>
            </div>
            <span className="text-[10px] text-slate-500 sm:hidden" aria-hidden="true">Swipe →</span>
            {pairAlignmentUnsupported ? (
              <span className="text-[10px] leading-4 text-amber-300">
                DXY cannot be aligned safely at 1h, 2h, or 4h. Use 30m or shorter, daily, or weekly.
              </span>
            ) : null}
          </div>
        ) : null}
        {draftComparisonMode === "pair" ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-slate-500">
            <span>
              <span className="font-semibold text-slate-400">Next analysis comparator:</span>{" "}
              <strong className="text-slate-300">{draftCompareSymbol}</strong> · {comparatorMeta?.category ?? "Custom comparison"} · User selected · suitability not evaluated
            </span>
            {comparisonMode === "pair" && comparisonData && hasCurrentPairResult ? (
              <span className={comparisonSessionStatus === "compatible" ? "text-emerald-300" : "text-amber-300"}>
                Current result {pairResultTargetSymbol} vs {pairResultBenchmarkSymbol}: currency {comparisonData.compatibility?.currency.status ?? "unknown"} · exact {comparisonData.overlap.alignment_rule?.replace(/_/g, " ") ?? "shared-key"} overlap · sessions {comparisonSessionStatus} · {comparisonData.compatibility?.session.independently_certified ? "independently certified" : "not independently certified"}
                {draftPairDiffersFromApplied
                  ? " · Draft changes are not applied; select Analyze."
                  : !currentPairResultMatchesApplied ? " · Waiting for the requested comparison response." : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {shareStatus === "error"
              ? <span className="text-rose-300">Clipboard access failed. Allow clipboard access and try again.</span>
              : "Report links preserve the analysis recipe and visible lenses; current provider data is loaded when opened."}
          <span className="sr-only" aria-live="polite">{shareStatus === "copied" ? "Report link copied." : shareStatus === "error" ? "The report link could not be copied." : ""}</span>
        </p>
      </section>

      {comparisonMode === "pair" && comparisonData ? (
        <Suspense
          fallback={(
            <section className="surface-card-strong flex min-h-[360px] items-center justify-center p-8">
              <MarketLoading size={90} variant="scan" label="Opening the relative field workspace..." />
            </section>
          )}
        >
          <MarketWeatherComparisonLab
            data={comparisonData}
            basis={comparisonBasis}
            view={comparisonView}
            selectedDimension={comparisonDimension}
            tab={pairTab}
            scopeTrail={pairScopeTrail}
            scopeScale={pairScopeScale}
            coordinateOrder={pairCoordinateOrder}
            onBasisChange={(nextBasis) => updatePresentation({ comparisonBasis: nextBasis })}
            onViewChange={(nextView) => updatePresentation({ comparisonView: nextView })}
            onDimensionChange={(nextDimension) => updatePresentation({ comparisonDimension: nextDimension })}
            onTabChange={(nextTab) => updatePresentation({ pairTab: nextTab })}
            onScopeTrailChange={(nextTrail) => updatePresentation({ pairScopeTrail: nextTrail })}
            onScopeScaleChange={(nextScale) => updatePresentation({ pairScopeScale: nextScale })}
            onCoordinateOrderChange={(nextOrder) => updatePresentation({ pairCoordinateOrder: nextOrder })}
          />
        </Suspense>
      ) : null}

      {data ? (
        <section className="primary-card overflow-hidden p-2.5 sm:p-3" data-testid="field-surface" data-lens={mode}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="page-kicker">Horizon cloud</span>
                <h2 className="text-sm font-semibold text-white">{data.symbol} field surface</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{data.horizons.length} horizons × {data.available_bars.toLocaleString()} bars · time runs left to right · longer horizons rise</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.history_context && requestedHistoryShortfall > 0 ? (
                <span
                  className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100"
                  title={`The provider returned ${data.history_context.visible_bars} of ${data.history_context.requested_visible_bars} requested visible bars.`}
                >
                  History {data.history_context.visible_bars.toLocaleString()} / {data.history_context.requested_visible_bars.toLocaleString()}
                </span>
              ) : null}
              {data.history_context ? (
                <span
                  className={`rounded-full border px-3 py-1 text-xs ${initializationTargetCovered ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : minimumInputSatisfied ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-rose-400/30 bg-rose-400/10 text-rose-200"}`}
                  title={`Initialization coverage only: ${data.history_context.analysis_bars} calculation bars; ${data.history_context.warmup_buffer_received} hidden leading bars received; ${initializationTargetBars}-bar target. Target coverage is not a convergence guarantee. Requested visible-history coverage is reported separately.`}
                >
                  {initializationTargetCovered ? "Initialization target covered" : minimumInputSatisfied ? "Minimum input met · target not covered" : "Minimum input not met"}
                </span>
              ) : null}
              {data.cache?.history?.stale ? (
                <span
                  className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-100"
                  title={data.cache.history.provider_error ?? "The live refresh failed, so the last sufficient stored history was used."}
                >
                  Stored fallback · {formatCacheAge(data.cache.history.age_seconds)}
                </span>
              ) : null}
              <span className="rounded-full border border-stealth-600 bg-slate-950/45 px-3 py-1 text-xs text-slate-300">{activeMode.label}</span>
            </div>
          </div>
          <MarketWeatherCanvas data={data} mode={mode} inspectorChannel={inspectorChannel} compact />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400" aria-label="Field cloud color key">
            <span>Older ← time → newer</span>
            <span>Color encodes {activeMode.label.toLowerCase()} · hover for timestamp and core measurements</span>
          </div>
          {data.history_context && requestedHistoryShortfall > 0 ? (
            <p className="mx-1 mt-2 rounded-lg border border-rose-400/25 bg-rose-400/[0.08] px-3 py-2 text-xs leading-5 text-rose-100" role="status">
              Requested-history shortfall: the provider returned {data.history_context.visible_bars.toLocaleString()} of {data.history_context.requested_visible_bars.toLocaleString()} visible bars ({requestedHistoryShortfall.toLocaleString()} missing). {initializationTargetCovered ? "The initialization target is covered, but that does not make this a full requested-history response." : "The initialization target is also not covered."}
            </p>
          ) : null}
          {data.history_context && !initializationTargetCovered ? (
            <p className="mx-1 mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
              Initialization target not covered: {data.history_context.analysis_bars} calculation bars were available against a {initializationTargetBars}-bar target. The minimum input is {minimumInputSatisfied ? "satisfied" : "not satisfied"}. The field remains non-anticipative, but current levels can still depend materially on retained history; target coverage is not a convergence guarantee.
            </p>
          ) : null}
          {data.input_quality && data.input_quality.status !== "valid" ? (
            <p className="mx-1 mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
              Input quality is {data.input_quality.status}: {data.input_quality.rows_used.toLocaleString()} of {data.input_quality.rows_received.toLocaleString()} rows were used. {data.input_quality.warnings.join("; ").replace(/_/g, " ") || "Some carrier evidence is unavailable."}
            </p>
          ) : null}
        </section>
      ) : null}

      {loading && !(comparisonMode === "pair" ? comparisonData : data) ? (
        <section className="surface-card-strong flex min-h-[430px] items-center justify-center p-8">
          <MarketLoading
            size={110}
            variant="scan"
            label={comparisonMode === "pair" ? "Aligning two multi-horizon fields..." : "Building the multi-horizon weather field..."}
          />
        </section>
      ) : null}

      {loading && (comparisonMode === "pair" ? comparisonData : data) ? <p className="sr-only" role="status" aria-live="polite">Updating the applied market field.</p> : null}

      {error ? (
        <section role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-950/25 p-5 text-sm text-rose-200">
          <div className="font-semibold">{comparisonMode === "pair" ? "The relative field could not be built." : "The field could not be built."}</div>
          <div className="mt-1 text-rose-200/80">{error}</div>
        </section>
      ) : null}

      {data ? (
        <>
          {data.research ? (
            <MarketWeatherResearchLab
              research={data.research}
              price={data.price}
              symbol={data.symbol}
              timeframe={data.timeframe}
              barSize={data.bar_size}
              view={languageView}
              onViewChange={(view) => updatePresentation({ view })}
              timelineLens={timelineLens}
              onTimelineLensChange={(nextLens) => updatePresentation({ timelineLens: nextLens })}
              timelineWindow={timelineWindow}
              onTimelineWindowChange={(nextWindow) => updatePresentation({ timelineWindow: nextWindow })}
            />
          ) : null}

          <details
            open={rawDataOpen}
            onToggle={(event) => setRawDataOpen(event.currentTarget.open)}
            className="group primary-card overflow-hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-left sm:p-5">
              <div>
                <span className="page-kicker">Raw data</span>
                <h2 className="mt-1 text-base font-semibold text-white">Horizon field, outcomes, and provenance</h2>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
            </summary>

            {rawDataOpen ? <div className="space-y-6 border-t border-stealth-700 p-4 sm:p-5">
              <section>
                <div className="mb-3">
                  <span className="page-kicker">Outcome overlay</span>
                  <h3 className="mt-1 text-lg font-semibold text-white">Price versus aggregate pressure</h3>
                </div>
                <div className="h-[300px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="weatherPriceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(100,116,139,0.18)" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="date" minTickGap={64} tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(value) => formatChartTick(String(value), data.timeframe)} />
                      <YAxis yAxisId="price" tick={{ fill: "#94a3b8", fontSize: 11 }} width={54} domain={["auto", "auto"]} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
                      <YAxis yAxisId="field" orientation="right" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tick={{ fill: "#94a3b8", fontSize: 11 }} width={40} />
                      <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 12 }} labelStyle={{ color: "var(--chart-tooltip-label)" }} formatter={(value, name) => name === "close" ? [formatPrice(Number(value)), "Close"] : [formatSigned(Number(value)), "Field pressure"]} />
                      <ReferenceLine yAxisId="field" y={0} stroke="rgba(226,232,240,0.32)" strokeDasharray="4 4" />
                      <Area yAxisId="price" type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={2} fill="url(#weatherPriceFill)" dot={false} isAnimationActive={false} />
                      <Line yAxisId="field" type="monotone" dataKey="field" stroke="#f8c15c" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-stealth-700">
                <div className="border-b border-stealth-700 px-4 py-3 sm:px-5">
                  <h3 className="font-semibold text-white">Current horizon profile</h3>
                </div>
                <div className="max-h-[620px] overflow-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-slate-950 text-xs uppercase tracking-[0.12em] text-slate-400 shadow-[0_1px_0_rgba(71,85,105,0.45)]">
                      <tr>
                        <th className="px-5 py-3">Horizon</th><th className="px-4 py-3">Pressure</th><th className="px-4 py-3">Renderer composite</th><th className="px-4 py-3">Horizon agreement</th><th className="px-4 py-3">Legacy disorder</th><th className="px-4 py-3">Permutation entropy</th><th className="px-4 py-3">Expansion</th><th className="px-4 py-3">Convection</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.latest_profile.map((row) => (
                        <tr key={row.horizon} className="text-slate-300 hover:bg-white/[0.025]">
                          <td className="px-5 py-3 font-semibold text-white">{row.horizon} bars <span className="ml-1 font-normal text-slate-500">({formatHorizon(row.horizon, data.timeframe)})</span></td>
                          <td className={`px-4 py-3 font-mono ${directionTone(row.pressure)}`}>{formatSigned(row.pressure)}</td>
                          <td className="px-4 py-3 font-mono">{formatPercent(row.confidence)}</td>
                          <td className="px-4 py-3 font-mono">{formatPercent(row.coherence)}</td>
                          <td className="px-4 py-3 font-mono">{formatPercent(row.entropy)}</td>
                          <td className="px-4 py-3 font-mono text-violet-200">{formatPercent(row.permutation_entropy)}</td>
                          <td className="px-4 py-3 font-mono">{formatPercent(row.expansion)}</td>
                          <td className="px-4 py-3 font-mono text-sky-300">{formatPercent(row.convection)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="secondary-card p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                    <div>
                      <h3 className="font-semibold text-white">Data provenance</h3>
                      <div className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
                        <p>Bars: <span className="text-slate-200">{data.data_source.toUpperCase()} · {data.bar_size} · {data.available_bars}/{data.requested_bars} observations</span></p>
                        <p>Quote: <span className="text-slate-200">{formatPrice(data.quote.price)} · {data.quote.source.toUpperCase()}{data.quote.quote_source ? ` (${data.quote.quote_source})` : ""}</span></p>
                        <p>Observed: <span className="text-slate-200">{formatTimestamp(data.quote.observed_at)}</span></p>
                        <p>Generated: <span className="text-slate-200">{formatTimestamp(data.generated_at)}</span></p>
                        {data.provenance ? (
                          <>
                            <p>
                              Analysis identity:{" "}
                              <code className="text-sky-200" title={data.provenance.analysis_hash}>
                                {data.provenance.analysis_hash.slice(0, 12)}
                              </code>
                              <span className="text-slate-500"> · recipe </span>
                              <code className="text-slate-200" title={data.provenance.recipe_hash}>
                                {data.provenance.recipe_hash.slice(0, 10)}
                              </code>
                              <span className="text-slate-500"> · input </span>
                              <code className="text-slate-200" title={data.provenance.input_hash}>
                                {data.provenance.input_hash.slice(0, 10)}
                              </code>
                            </p>
                            <p className="text-slate-500">{data.provenance.note}</p>
                          </>
                        ) : null}
                        {data.history_context?.state_vector_coverage ? (
                          <p>
                            Form dependency support: <span className="text-slate-200">
                              {data.history_context.state_vector_coverage.features.filter((feature) => feature.latest_measured).length}
                              /{data.history_context.state_vector_coverage.coordinate_count} coordinates fully supported and measured now
                              {data.history_context.state_vector_coverage.all_latest_measured ? "" : " · finite startup or neutral values remain explicitly unmeasured"}
                            </span>
                          </p>
                        ) : null}
                        {data.cache?.history ? (
                          <p>
                            History origin: <span className="text-slate-200">
                              {data.cache.history.status.replace(/_/g, " ")} · {data.cache.history.returned_rows.toLocaleString()} rows · {formatCacheAge(data.cache.history.age_seconds)}
                              {data.cache.history.provider_called ? " · provider checked when computed" : " · read from storage"}
                            </span>
                          </p>
                        ) : null}
                        {data.cache?.request ? (
                          <p>
                            This request: <span className="text-slate-200">
                              history {data.cache.request.history_access.replace(/_/g, " ")}
                              {data.cache.request.provider_called ? " · provider called" : " · no provider call"}
                            </span>
                          </p>
                        ) : null}
                        {data.cache?.analysis ? (
                          <p>
                            Analysis cache: <span className="text-slate-200">
                              {data.cache.analysis.status} · {data.cache.analysis.scope.replace(/_/g, " ")} · {data.cache.analysis.ttl_seconds}s TTL · {data.cache.analysis.retained ? "retained" : "not retained"}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="secondary-card p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <div>
                      <h3 className="font-semibold text-white">Verification guardrails</h3>
                      <div className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
                        <p>{data.methodology.research_status}</p>
                        <p>Forms and Motions are learned without evaluation outcomes. Treat attached returns as hypotheses until they repeat out of sample.</p>
                        {data.provenance?.bar_completion_rule ? (
                          <p>{data.provenance.bar_completion_rule}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div> : null}
          </details>

          <MarketWeatherMethodologyReport data={data} />
        </>
      ) : null}
    </div>
    {settingsDialog}
    </>
  );
}
