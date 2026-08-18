import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import MarketTabs from "../components/ui/MarketTabs";
import SegmentedControl from "../components/ui/SegmentedControl";
import AgricultureDeepDive, { type AgricultureDeepDiveData } from "../components/agriculture/AgricultureDeepDive";
import { useApi } from "../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
  formatTooltipValue,
} from "../utils/chartUtils";
import { getFamilyColor } from "../theme/metricColors";

type AgricultureOverview = AgricultureDeepDiveData & {
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
  strongest_markets: Array<{ code: string; name: string; group: string; score: number }>;
  weakest_markets: Array<{ code: string; name: string; group: string; score: number }>;
  availability: AgricultureDeepDiveData["availability"] & {
    symbols: Array<{ code: string; name: string; group: string; status: string; ticker: string | null; points: number }>;
  };
};

type Timeframe = "30d" | "90d" | "180d" | "365d" | "30y";

const AGRICULTURE_TIMEFRAME_OPTIONS: Array<{ value: Timeframe; label: string }> = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "180d", label: "180d" },
  { value: "365d", label: "365d" },
  { value: "30y", label: "30y" },
];

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

function formatSnapshot(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatCompositeMove(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function daysForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "30d") return 30;
  if (timeframe === "90d") return 90;
  if (timeframe === "180d") return 180;
  if (timeframe === "30y") return 10950;
  return 365;
}

export default function AgricultureIndex() {
  const { data: overview, loading, error } = useApi<AgricultureOverview>("/agriculture/overview?days=365");
  const { data: longViewData } = useApi<LongViewData>("/agriculture/long-view");

  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

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

  const momentumLeader = [...overview.groups].sort((left, right) => right.group_composite - left.group_composite)[0];
  const momentumLaggard = [...overview.groups].sort((left, right) => left.group_composite - right.group_composite)[0];
  const narrowestBreadth = [...overview.groups]
    .filter((group) => group.breadth_score !== null)
    .sort((left, right) => (left.breadth_score ?? 100) - (right.breadth_score ?? 100))[0];

  return (
    <div className="page-shell-wide page-stack">
      <div>
        <p className="page-kicker">Tools</p>
        <h1 className="page-title">Agriculture Index</h1>
      </div>

      <section id="agriculture-now" aria-labelledby="agriculture-now-title" className="section-anchor surface-card-strong overflow-hidden p-0">
        <div className="grid grid-cols-2 gap-px bg-stealth-700/80 xl:grid-cols-[minmax(220px,1.25fr)_repeat(3,minmax(112px,.55fr))_minmax(190px,.9fr)_auto]">
          <div className="col-span-2 bg-stealth-950/45 px-4 py-3 xl:col-span-1 md:px-5">
            <p className="text-xs font-semibold text-sky-200">Today</p>
            <h2 id="agriculture-now-title" className={`mt-1 text-xl font-semibold tracking-[-0.02em] ${getRegimeTone(overview.regime_label)}`}>{overview.regime_label}</h2>
          </div>
          <dl className="contents">
            <div className="bg-stealth-950/45 px-4 py-3"><dt className="text-xs font-semibold text-stealth-400">Stability · 0–100</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${getScoreTone(overview.stability_score)}`}>{overview.stability_score.toFixed(1)}</dd></div>
            <div className="bg-stealth-950/45 px-4 py-3"><dt className="text-xs font-semibold text-stealth-400">5 days</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{formatCompositeMove(overview.composite.changes["5d"])}</dd></div>
            <div className="bg-stealth-950/45 px-4 py-3"><dt className="text-xs font-semibold text-stealth-400">20 days</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{formatCompositeMove(overview.composite.changes["20d"])}</dd></div>
            <div className="bg-stealth-950/45 px-4 py-3"><dt className="text-xs font-semibold text-stealth-400">Coverage</dt><dd className="mt-1 text-sm font-semibold text-white">{overview.availability.available_symbol_count}/{overview.availability.total_configured_symbols} contracts · {overview.availability.available_group_count}/6 sectors</dd><dd className="mt-1 text-xs text-stealth-400">{formatSnapshot(overview.as_of)}</dd></div>
          </dl>
          <div className="col-span-2 flex items-center bg-stealth-950/45 p-3 xl:col-span-1">
            <Link to="/agriculture/reports" className="field-button field-button-secondary min-h-11 w-full whitespace-nowrap xl:w-auto">Report impact</Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-stealth-700/80 px-4 py-3 text-xs text-stealth-300 md:px-5">
          {momentumLeader ? <p><span className="font-semibold text-white">Lead</span> · {momentumLeader.label} {momentumLeader.group_composite.toFixed(1)}</p> : null}
          {momentumLaggard ? <p><span className="font-semibold text-white">Weak</span> · {momentumLaggard.label} {momentumLaggard.group_composite.toFixed(1)}</p> : null}
          {narrowestBreadth ? <p><span className="font-semibold text-white">Narrow breadth</span> · {narrowestBreadth.label} {narrowestBreadth.breadth_score?.toFixed(1)}%</p> : null}
        </div>
      </section>

      <div id="agriculture-views" className="section-anchor mb-2">
        <MarketTabs<TabKey>
          label="Agriculture analysis view"
          value={activeTab}
          options={[
            { value: "overview", label: "Overview", panelId: "agriculture-panel-overview", tabId: "agriculture-tab-overview" },
            { value: "deepdive", label: "Deep Dive", panelId: "agriculture-panel-deepdive", tabId: "agriculture-tab-deepdive" },
          ]}
          onChange={setActiveTab}
          idPrefix="agriculture"
          accent="emerald"
        />
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
              <SegmentedControl
                label="Stability history window"
                value={timeframe}
                options={AGRICULTURE_TIMEFRAME_OPTIONS}
                onChange={setTimeframe}
                accent="emerald"
              />
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
          className="section-anchor"
        >
          <AgricultureDeepDive data={overview} />
        </section>
      ) : null}
    </div>
  );
}
