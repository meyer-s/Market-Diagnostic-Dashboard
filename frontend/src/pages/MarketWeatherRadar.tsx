import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ChevronDown,
  FlaskConical,
  Info,
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
import type { MarketWeatherMode, MarketWeatherResponse, MarketWeatherTimeframe } from "../types/marketWeather";
import { channelLabel, formatSigned, INSPECTOR_CHANNELS } from "../utils/marketWeather";

interface RadarConfig {
  symbol: string;
  timeframe: MarketWeatherTimeframe;
  bars: number;
  horizonMin: number;
  horizonMax: number;
  horizonStep: number;
  stateSmoothing: number;
  crossHorizonBlend: number;
  rendererTimeBlur: number;
  rendererSpatialBlend: number;
  edgeGain: number;
  reflectivityCompression: number;
  contourBands: number;
}

const DEFAULT_CONFIG: RadarConfig = {
  symbol: "SPY",
  timeframe: "1D",
  bars: 750,
  horizonMin: 8,
  horizonMax: 64,
  horizonStep: 1,
  stateSmoothing: 5,
  crossHorizonBlend: 0.32,
  rendererTimeBlur: 3,
  rendererSpatialBlend: 0.42,
  edgeGain: 1.35,
  reflectivityCompression: 4,
  contourBands: 7,
};

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
  { value: "regime", label: "Regime Health", description: "Direction is primary; the uncalibrated organization score controls intensity." },
  { value: "convection", label: "Convection", description: "Adds blue boundary energy where a transition is actively organizing." },
  { value: "topographic", label: "Topographic", description: "Quantizes reflectivity into contour-like intensity bands." },
  { value: "swami", label: "Swami Classic", description: "The categorical benchmark from the original SwamiCharts concept." },
  { value: "inspector", label: "Channel Inspector", description: "Isolates one latent field so the composite can be audited." },
];

const inputClass = "rounded-xl border border-stealth-600 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-400/10";

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

function buildEndpoint(config: RadarConfig): string {
  const params = new URLSearchParams({
    symbol: config.symbol,
    timeframe: config.timeframe,
    bars: String(config.bars),
    horizon_min: String(config.horizonMin),
    horizon_max: String(config.horizonMax),
    horizon_step: String(config.horizonStep),
    state_smoothing: String(config.stateSmoothing),
    cross_horizon_blend: String(config.crossHorizonBlend),
    renderer_time_blur: String(config.rendererTimeBlur),
    renderer_spatial_blend: String(config.rendererSpatialBlend),
    edge_gain: String(config.edgeGain),
    reflectivity_compression: String(config.reflectivityCompression),
    contour_bands: String(config.contourBands),
  });
  return `/market-weather/analyze?${params.toString()}`;
}

export default function MarketWeatherRadar() {
  const [draft, setDraft] = useState<RadarConfig>(DEFAULT_CONFIG);
  const [applied, setApplied] = useState<RadarConfig>(DEFAULT_CONFIG);
  const [mode, setMode] = useState<MarketWeatherMode>("regime");
  const [inspectorChannel, setInspectorChannel] = useState("pressure");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsDialogRef = useRef<HTMLFormElement | null>(null);
  const endpoint = useMemo(() => buildEndpoint(applied), [applied]);
  const { data, loading, error, refetch } = useApi<MarketWeatherResponse>(endpoint);

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
    if (!data) return [];
    const weightTotal = data.horizons.reduce((sum, horizon) => sum + horizon, 0);
    return data.price.map((point, dateIndex) => ({
      date: point.date,
      close: point.close,
      field: data.channels.pressure.reduce(
        (sum, row, horizonIndex) => sum + (row[dateIndex] ?? 0) * data.horizons[horizonIndex],
        0,
      ) / weightTotal,
    }));
  }, [data]);

  const applyPreset = (preset: "balanced" | "tactical" | "structural") => {
    const next = preset === "tactical"
      ? { ...draft, horizonMin: 4, horizonMax: 48, horizonStep: 1, stateSmoothing: 3, rendererTimeBlur: 2 }
      : preset === "structural"
        ? { ...draft, horizonMin: 12, horizonMax: 96, horizonStep: 2, stateSmoothing: 7, rendererTimeBlur: 5 }
        : { ...draft, ...DEFAULT_CONFIG, symbol: draft.symbol, timeframe: draft.timeframe, bars: draft.bars };
    setDraft(next);
  };

  const runAnalysis = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft, symbol: draft.symbol.trim().toUpperCase() || "SPY" });
  };

  const applySettings = () => {
    setApplied({ ...draft, symbol: draft.symbol.trim().toUpperCase() || "SPY" });
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };

  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0];
  const activeTimeframe = TIMEFRAMES.find((item) => item.value === draft.timeframe) ?? TIMEFRAMES[7];

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
            className="rounded-full border border-stealth-600 p-2 text-slate-300 transition hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
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
                  className="rounded-xl border border-stealth-600 px-3 py-2 text-xs capitalize text-slate-300 transition hover:border-sky-400/50 hover:text-white"
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
                {activeTimeframe.barOptions.map((value) => <option key={value} value={value}>{value.toLocaleString()} bars</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Field lens</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as MarketWeatherMode)} className={inputClass}>
                {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            {mode === "inspector" ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Inspector channel</span>
                <select value={inspectorChannel} onChange={(event) => setInspectorChannel(event.target.value)} className={inputClass}>
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
                    value={draft[key as keyof RadarConfig]}
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
          <button type="button" onClick={refetch} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh current
          </button>
          <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-60">
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
              <span className="page-badge border-sky-400/20 text-sky-200"><FlaskConical className="h-3.5 w-3.5" /> Grounded field model</span>
            </div>
            <h1 className="page-title">Market Field Language</h1>
            <p className="page-subtitle max-w-3xl">Direction, organization, disorder, and cross-horizon movement are shown in measured terms. Learned states are named from their calibration-relative profiles.</p>
          </div>
          {data ? (
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="page-badge"><Activity className="h-3.5 w-3.5 text-emerald-300" /> {data.data_source.toUpperCase()} · {data.bar_size} bars</span>
              <span className="page-badge">{data.horizons.length} × {data.available_bars}</span>
              <span className="page-badge">{formatTimestamp(data.generated_at)}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="surface-card-strong p-3 sm:p-4">
        <form onSubmit={runAnalysis} className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[260px]">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ticker</span>
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
            <span className="mb-0.5 hidden rounded-xl border border-stealth-700 bg-slate-950/35 px-3 py-2 text-xs text-slate-400 sm:inline-flex">{draft.bars.toLocaleString()} bars · {activeMode.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <SlidersHorizontal className="h-4 w-4" /> Settings
            </button>
            <button type="submit" disabled={loading} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-60 sm:flex-none">
              <Activity className="h-4 w-4" /> Analyze
            </button>
          </div>
        </form>
      </section>

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
            <span className="rounded-full border border-stealth-600 bg-slate-950/45 px-3 py-1 text-xs text-slate-300">{activeMode.label}</span>
          </div>
          <MarketWeatherCanvas data={data} mode={mode} inspectorChannel={inspectorChannel} compact />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400" aria-label="Field cloud color key">
            <span>Older ← time → newer</span>
            <span>Color encodes {activeMode.label.toLowerCase()} · hover for timestamp and core measurements</span>
          </div>
        </section>
      ) : null}

      {loading && !data ? (
        <section className="surface-card-strong flex min-h-[430px] items-center justify-center p-8">
          <MarketLoading size={110} variant="scan" label="Building the multi-horizon weather field..." />
        </section>
      ) : null}

      {error ? (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-950/25 p-5 text-sm text-rose-200">
          <div className="font-semibold">The field could not be built.</div>
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
            />
          ) : null}

          <details className="group primary-card overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-left sm:p-5">
              <div>
                <span className="page-kicker">Raw data</span>
                <h2 className="mt-1 text-base font-semibold text-white">Horizon field, outcomes, and provenance</h2>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
            </summary>

            <div className="space-y-6 border-t border-stealth-700 p-4 sm:p-5">
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
                        <th className="px-5 py-3">Horizon</th><th className="px-4 py-3">Pressure</th><th className="px-4 py-3">Display organization</th><th className="px-4 py-3">Coherence</th><th className="px-4 py-3">Legacy disorder</th><th className="px-4 py-3">Permutation entropy</th><th className="px-4 py-3">Expansion</th><th className="px-4 py-3">Convection</th>
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
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </details>

          <MarketWeatherMethodologyReport data={data} />
        </>
      ) : null}
    </div>
    {settingsDialog}
    </>
  );
}
