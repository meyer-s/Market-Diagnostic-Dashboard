import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  FlaskConical,
  Info,
  RefreshCw,
  Search,
  SlidersHorizontal,
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

function SummaryCard({ label, value, note, tone = "text-white" }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-400">{note}</div>
    </div>
  );
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
  const endpoint = useMemo(() => buildEndpoint(applied), [applied]);
  const { data, loading, error, refetch } = useApi<MarketWeatherResponse>(endpoint);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(refetch, 60_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, refetch]);

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

  const interpretation = useMemo(() => {
    if (!data) return null;
    const rows = data.latest_profile;
    const third = Math.max(1, Math.floor(rows.length / 3));
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const short = average(rows.slice(0, third).map((row) => row.pressure));
    const long = average(rows.slice(-third).map((row) => row.pressure));
    const rotation = short - long;
    const rotationText = rotation > 0.12 ? "Short horizons are leading the field upward." : rotation < -0.12 ? "Short horizons are weakening faster than the structural field." : "Short and long horizons are broadly synchronized.";
    const organizationText = data.summary.coherence >= 0.65 && data.summary.entropy < 0.5
      ? "The move is relatively organized across adjacent horizons."
      : data.summary.entropy >= 0.6
        ? "The field is noisy; treat directional color as lower conviction."
        : "Organization is mixed and still developing.";
    return { short, long, rotation, rotationText, organizationText };
  }, [data]);

  const applyPreset = (preset: "balanced" | "tactical" | "structural") => {
    const next = preset === "tactical"
      ? { ...draft, horizonMin: 4, horizonMax: 48, horizonStep: 1, stateSmoothing: 3, rendererTimeBlur: 2 }
      : preset === "structural"
        ? { ...draft, horizonMin: 12, horizonMax: 96, horizonStep: 2, stateSmoothing: 7, rendererTimeBlur: 5 }
        : { ...draft, ...DEFAULT_CONFIG, symbol: draft.symbol, timeframe: draft.timeframe, bars: draft.bars };
    setDraft(next);
    setApplied({ ...next, symbol: next.symbol.trim().toUpperCase() || "SPY" });
  };

  const runAnalysis = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft, symbol: draft.symbol.trim().toUpperCase() || "SPY" });
  };

  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0];
  const activeTimeframe = TIMEFRAMES.find((item) => item.value === draft.timeframe) ?? TIMEFRAMES[7];

  return (
    <div className="page-shell-wide page-stack">
      <section className="page-hero">
        <div className="relative z-[1] flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">Experimental research lab</span>
              <span className="page-badge border-sky-400/20 text-sky-200"><FlaskConical className="h-3.5 w-3.5" /> Causal field model</span>
            </div>
            <h1 className="page-title">Market Weather Radar</h1>
            <p className="page-subtitle max-w-4xl">
              Explore trend direction, organization, boundary energy, and transition maturity across many time horizons at once. This prototype translates the Swami-to-Convection research into an auditable field instead of a single buy/sell score.
            </p>
          </div>
          {data ? (
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="page-badge"><Activity className="h-3.5 w-3.5 text-emerald-300" /> {data.data_source.toUpperCase()} · {data.bar_size} bars</span>
              <span className="page-badge">{data.horizons.length} horizons × {data.available_bars} observations</span>
              <span className="page-badge">Updated {formatTimestamp(data.generated_at)}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="surface-card-strong p-4 sm:p-5">
        <form onSubmit={runAnalysis} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[260px]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Ticker</span>
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
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Timeframe</span>
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
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">History</span>
              <select value={draft.bars} onChange={(event) => setDraft((current) => ({ ...current, bars: Number(event.target.value) }))} className={inputClass}>
                {activeTimeframe.barOptions.map((value) => <option key={value} value={value}>{value.toLocaleString()} bars</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => applyPreset("balanced")} className="rounded-xl border border-stealth-600 px-3 py-2 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">Balanced</button>
              <button type="button" onClick={() => applyPreset("tactical")} className="rounded-xl border border-stealth-600 px-3 py-2 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">Tactical</button>
              <button type="button" onClick={() => applyPreset("structural")} className="rounded-xl border border-stealth-600 px-3 py-2 text-xs text-slate-300 transition hover:border-sky-400/50 hover:text-white">Structural</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stealth-700 px-3 py-2 text-xs text-slate-300">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} className="accent-sky-400" />
              Refresh every minute
            </label>
            <button type="button" onClick={refetch} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-stealth-600 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400/50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-60">
              <Activity className="h-4 w-4" /> Analyze
            </button>
          </div>
        </form>

        <details className="mt-4 border-t border-white/5 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-200">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced field settings <ChevronDown className="h-3.5 w-3.5" />
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{String(label)}</span>
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
        </details>
      </section>

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
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard label="Current regime" value={data.summary.regime} note="Direction plus cross-horizon organization." tone={directionTone(data.summary.field_direction)} />
            <SummaryCard label="Field direction" value={formatSigned(data.summary.field_direction)} note="Weighted pressure; -1 bearish to +1 bullish." tone={directionTone(data.summary.field_direction)} />
            <SummaryCard label="Horizon alignment" value={formatPercent(data.summary.horizon_alignment)} note="Horizons agreeing with the field direction." />
            <SummaryCard label="Coherence / disorder" value={`${formatPercent(data.summary.coherence)} / ${formatPercent(data.summary.entropy)}`} note="Organization versus the legacy field-disagreement proxy." />
            <SummaryCard label="Expansion front" value={data.summary.expansion_front ? `${data.summary.expansion_front} bars · ${formatHorizon(data.summary.expansion_front, data.timeframe)}` : "None"} note="Longest horizon with active trend-aligned motion." tone={data.summary.expansion_front ? "text-sky-300" : "text-slate-300"} />
          </section>

          <section className="primary-card p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <span className="page-kicker">Renderer</span>
                <h2 className="mt-1 text-xl font-semibold text-white">{data.symbol} horizon field</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-400">{activeMode.description} Hover any cell to inspect its latent values. Rendering {data.horizons.length.toLocaleString()} × {data.available_bars.toLocaleString()} cells from {formatTimestamp(data.coverage_start)} to {formatTimestamp(data.coverage_end)}.</p>
              </div>
              <div className="flex flex-wrap gap-1 rounded-2xl border border-stealth-700 bg-slate-950/45 p-1.5">
                {MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMode(item.value)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium transition ${mode === item.value ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "inspector" ? (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                <span>Inspect channel</span>
                <select value={inspectorChannel} onChange={(event) => setInspectorChannel(event.target.value)} className={`${inputClass} py-1.5`}>
                  {INSPECTOR_CHANNELS.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                </select>
              </div>
            ) : null}

            <MarketWeatherCanvas data={data} mode={mode} inspectorChannel={inspectorChannel} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
              <span>Time → &nbsp; | &nbsp; Longer horizons ↑</span>
              <span>Green: bullish pressure &nbsp; Amber: transition &nbsp; Red: bearish pressure &nbsp; Blue: active boundary energy</span>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
            <div className="primary-card min-w-0 p-4 sm:p-5">
              <div className="mb-3">
                <span className="page-kicker">Price confirmation</span>
                <h2 className="mt-1 text-lg font-semibold text-white">Price versus aggregate field pressure</h2>
                <p className="mt-1 text-xs text-slate-400">{data.bar_size} bars · separate axes preserve each series’ scale. Pressure uses the same horizon-weighted aggregation as the headline field direction.</p>
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
            </div>

            <div className="primary-card p-4 sm:p-5">
              <span className="page-kicker">Current read</span>
              <h2 className="mt-1 text-lg font-semibold text-white">What the field is saying</h2>
              {interpretation ? (
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  <p>{interpretation.rotationText}</p>
                  <p>{interpretation.organizationText}</p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-xl border border-stealth-700 bg-slate-950/35 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Short pressure</div>
                      <div className={`mt-1 font-mono text-lg ${directionTone(interpretation.short)}`}>{formatSigned(interpretation.short)}</div>
                    </div>
                    <div className="rounded-xl border border-stealth-700 bg-slate-950/35 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Long pressure</div>
                      <div className={`mt-1 font-mono text-lg ${directionTone(interpretation.long)}`}>{formatSigned(interpretation.long)}</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-400/15 bg-sky-950/20 p-3 text-xs text-slate-400">
                    This is a descriptive read of the current field. The useful test is whether expansions persist and precede durable price moves—not whether one snapshot predicts the next bar.
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {data.research ? (
            <MarketWeatherResearchLab
              research={data.research}
              symbol={data.symbol}
              timeframe={data.timeframe}
              barSize={data.bar_size}
            />
          ) : null}

          <section className="primary-card overflow-hidden">
            <div className="border-b border-stealth-700 p-4 sm:p-5">
              <span className="page-kicker">Audit the latest column</span>
              <h2 className="mt-1 text-lg font-semibold text-white">Current horizon profile</h2>
              <p className="mt-1 text-xs text-slate-400">The composite remains inspectable: direction stays anchored to pressure while motion changes the uncalibrated organization score and intensity.</p>
            </div>
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-slate-500 shadow-[0_1px_0_rgba(71,85,105,0.45)]">
                  <tr>
                    <th className="px-5 py-3">Horizon</th><th className="px-4 py-3">Pressure</th><th className="px-4 py-3">Organization</th><th className="px-4 py-3">Coherence</th><th className="px-4 py-3">Disorder proxy</th><th className="px-4 py-3">Permutation entropy</th><th className="px-4 py-3">Expansion</th><th className="px-4 py-3">Convection</th>
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
                    <p>Quote observed: <span className="text-slate-200">{formatTimestamp(data.quote.observed_at)}</span></p>
                    <p>Field generated: <span className="text-slate-200">{formatTimestamp(data.generated_at)}</span></p>
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
                    <p>{data.methodology.description}</p>
                    <p>{data.methodology.research_status}</p>
                    <p>Compare symbols and market regimes before treating any visual pattern as durable evidence.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
