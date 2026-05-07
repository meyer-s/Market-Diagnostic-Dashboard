import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Bar,
  BarChart,
} from "recharts";

import MarketLoading from "../components/ui/MarketLoading";
import { useApi } from "../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonTooltipStyle,
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
  stability_contribution: number;
  correlation_to_composite: number | null;
};

type CorrelationRow = { row: string; values: Record<string, number | null> };

type AgricultureOverview = {
  as_of: string;
  regime_label: string;
  stability_score: number;
  stability_components: Record<string, number>;
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

type Timeframe = "30d" | "90d" | "180d" | "365d";
type TabKey = "overview" | "sectors" | "relationships" | "coverage";

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

function daysForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "30d") return 30;
  if (timeframe === "90d") return 90;
  if (timeframe === "180d") return 180;
  return 365;
}

export default function AgricultureIndex() {
  const { data: overview, loading, error } = useApi<AgricultureOverview>("/agriculture/overview?days=365");
  const { data: correlations } = useApi<AgricultureCorrelations>("/agriculture/correlations?days=365");
  const { data: macro } = useApi<AgricultureMacro>("/agriculture/macro?days=365");

  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const chartData = useMemo(() => overview?.composite.history ?? [], [overview]);

  const filteredHistory = useMemo(() => {
    const days = daysForTimeframe(timeframe);
    if (chartData.length <= days) return chartData;
    return chartData.slice(-days);
  }, [chartData, timeframe]);

  const stabilityComponents = useMemo(() => {
    if (!overview?.stability_components) return [];
    return Object.entries(overview.stability_components)
      .filter(([key]) => key !== "stability_score")
      .map(([key, value]) => ({
        key: key.replace(/_/g, " "),
        value,
      }));
  }, [overview]);

  const matrix60 = correlations?.correlations.group_matrix?.["60"] ?? [];
  const pair60 = correlations?.correlations.pair_insights?.["60"] ?? {};

  const groups = overview?.groups ?? [];
  const activeGroup = useMemo(() => {
    if (!groups.length) return null;
    if (selectedGroup) {
      const found = groups.find((group) => group.group === selectedGroup);
      if (found) return found;
    }
    return groups[0];
  }, [groups, selectedGroup]);

  if (loading) {
    return (
      <div className="page-shell-wide flex min-h-[60vh] items-center justify-center">
        <MarketLoading size={120} variant="pulse" label="Loading Agriculture Index..." />
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
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300 md:text-[15px]">
          A futures-based macro diagnostic for agriculture regime stability. This is not a trading signal and is designed for contextual market structure analysis.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="surface-card-strong p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Stability Score</p>
          <p className={`mt-2 text-3xl font-semibold ${getScoreTone(overview.stability_score)}`}>
            {overview.stability_score.toFixed(1)}
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-stealth-700">
            <div className={`h-2 rounded-full ${getScoreFill(overview.stability_score)}`} style={{ width: `${overview.stability_score}%` }}></div>
          </div>
          <p className="mt-1 text-xs text-stealth-400">As of {new Date(overview.as_of).toLocaleString()}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Regime</p>
          <p className={`mt-2 text-2xl font-semibold ${getRegimeTone(overview.regime_label)}`}>{overview.regime_label}</p>
          <p className="mt-1 text-xs text-stealth-400">Group coverage: {overview.availability.available_group_count} sectors</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Availability</p>
          <p className="mt-2 text-2xl font-semibold text-stealth-100">
            {overview.availability.available_symbol_count}/{overview.availability.total_configured_symbols}
          </p>
          <p className="mt-1 text-xs text-stealth-400">Symbols with sufficient history</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Composite Moves</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <p className="text-stealth-400">5d: <span className="text-stealth-200">{overview.composite.changes["5d"]?.toFixed(2) ?? "-"}%</span></p>
            <p className="text-stealth-400">20d: <span className="text-stealth-200">{overview.composite.changes["20d"]?.toFixed(2) ?? "-"}%</span></p>
            <p className="text-stealth-400">60d: <span className="text-stealth-200">{overview.composite.changes["60d"]?.toFixed(2) ?? "-"}%</span></p>
            <p className="text-stealth-400">120d: <span className="text-stealth-200">{overview.composite.changes["120d"]?.toFixed(2) ?? "-"}%</span></p>
          </div>
        </div>
      </div>

      <div className="surface-card-strong p-5">
        <p className="text-sm text-stealth-200">{overview.summary}</p>
      </div>

      <div className="surface-card p-2">
        <div className="flex flex-wrap gap-2">
          {([
            { key: "overview", label: "Overview" },
            { key: "sectors", label: "Sector Drilldown" },
            { key: "relationships", label: "Relationships" },
            { key: "coverage", label: "Coverage" },
          ] as Array<{ key: TabKey; label: string }>).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.key
                  ? "bg-stealth-700 text-stealth-100"
                  : "text-stealth-400 hover:bg-stealth-800 hover:text-stealth-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        <>
          <div className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-stealth-100">Composite History</h2>
              <div className="flex gap-2">
                {(["30d", "90d", "180d", "365d"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
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
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredHistory} margin={CHART_MARGIN}>
                  <CartesianGrid {...commonGridProps} />
                  <XAxis dataKey="date" {...commonXAxisProps} />
                  <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={commonTooltipStyle}
                    formatter={(value: number) => [formatTooltipValue(value, 2), "Index"]}
                  />
                  <ReferenceLine y={100} stroke={getFamilyColor("benchmark")} strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={getFamilyColor("materials")}
                    fill={getFamilyColor("materials", "faint")}
                    strokeWidth={2.2}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={getFamilyColor("materials")}
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="surface-card p-4 xl:col-span-2">
              <h2 className="text-base font-semibold text-stealth-100">Stability Components</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stabilityComponents} margin={CHART_MARGIN}>
                    <CartesianGrid {...commonGridProps} />
                    <XAxis dataKey="key" {...commonXAxisProps} tick={{ fill: "#9ca3af", fontSize: 10 }} interval={0} angle={-24} height={70} textAnchor="end" />
                    <YAxis {...commonYAxisProps} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={commonTooltipStyle}
                      formatter={(value: number) => [formatTooltipValue(value, 1), "Score"]}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {stabilityComponents.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={entry.key.includes("penalty") ? "#f87171" : getFamilyColor("growth")}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
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
        </>
      ) : null}

      {activeTab === "sectors" ? (
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="surface-card p-3 xl:col-span-4">
            <h2 className="text-base font-semibold text-stealth-100">Sector Heatmap Selector</h2>
            <div className="mt-3 space-y-2">
              {groups.map((group) => (
                <button
                  key={group.group}
                  onClick={() => setSelectedGroup(group.group)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    activeGroup?.group === group.group
                      ? "border-stealth-500 bg-stealth-800"
                      : "border-stealth-700 bg-stealth-900/55 hover:border-stealth-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-stealth-100">{group.label}</p>
                    <p className={`text-sm font-semibold ${getScoreTone(group.group_composite)}`}>{group.group_composite.toFixed(1)}</p>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-stealth-700">
                    <div className={`h-1.5 rounded-full ${getScoreFill(group.group_composite)}`} style={{ width: `${group.group_composite}%` }}></div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="surface-card p-4 xl:col-span-8">
            {activeGroup ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-stealth-100">{activeGroup.label} Detail Panel</h2>
                  <span className="rounded bg-stealth-800 px-2 py-1 text-xs text-stealth-300">
                    Weight {activeGroup.effective_weight.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs text-stealth-500">Composite</p>
                    <p className={`mt-1 text-2xl font-semibold ${getScoreTone(activeGroup.group_composite)}`}>{activeGroup.group_composite.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs text-stealth-500">Volatility</p>
                    <p className="mt-1 text-2xl font-semibold text-stealth-100">{activeGroup.volatility?.toFixed(2) ?? "-"}</p>
                  </div>
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs text-stealth-500">Breadth</p>
                    <p className="mt-1 text-2xl font-semibold text-stealth-100">{activeGroup.breadth_score?.toFixed(1) ?? "-"}</p>
                  </div>
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-xs text-stealth-500">Correlation to Composite</p>
                    <p className="mt-1 text-2xl font-semibold text-stealth-100">{activeGroup.correlation_to_composite?.toFixed(2) ?? "-"}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-sm font-semibold text-stealth-100">Multi-Horizon Moves</p>
                    <div className="mt-2 space-y-2 text-xs">
                      {(["5d", "20d", "60d", "120d"] as Array<keyof GroupRow["changes"]>).map((key) => {
                        const value = activeGroup.changes[key];
                        const width = value === null ? 0 : Math.min(100, Math.abs(value) * 6);
                        const color = value === null ? "bg-stealth-600" : value >= 0 ? "bg-emerald-500" : "bg-rose-500";
                        return (
                          <div key={key}>
                            <div className="mb-1 flex items-center justify-between text-stealth-300">
                              <span>{key}</span>
                              <span>{value === null ? "-" : `${value.toFixed(2)}%`}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-stealth-700">
                              <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${width}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                    <p className="text-sm font-semibold text-stealth-100">Strength Table</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs uppercase tracking-[0.14em] text-emerald-400">Strongest</p>
                        {activeGroup.strongest.map((item) => (
                          <div key={item.code} className="mb-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs">
                            <p className="text-emerald-200">{item.code}</p>
                            <p className="text-stealth-400">{item.score.toFixed(1)}</p>
                          </div>
                        ))}
                      </div>
                      <div>
                        <p className="mb-1 text-xs uppercase tracking-[0.14em] text-rose-400">Weakest</p>
                        {activeGroup.weakest.map((item) => (
                          <div key={item.code} className="mb-1 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-xs">
                            <p className="text-rose-200">{item.code}</p>
                            <p className="text-stealth-400">{item.score.toFixed(1)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "relationships" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="surface-card p-4">
            <h2 className="text-base font-semibold text-stealth-100">Rolling Correlation Matrix (60d)</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs text-stealth-300">
                <thead>
                  <tr>
                    <th className="border border-stealth-700 px-2 py-1 text-left text-stealth-400">Group</th>
                    {matrix60[0] ? Object.keys(matrix60[0].values).map((col) => (
                      <th key={col} className="border border-stealth-700 px-2 py-1 text-left text-stealth-400">{formatGroupCode(col)}</th>
                    )) : null}
                  </tr>
                </thead>
                <tbody>
                  {matrix60.map((row) => (
                    <tr key={row.row}>
                      <td className="border border-stealth-700 px-2 py-1 font-medium text-stealth-200">{formatGroupCode(row.row)}</td>
                      {Object.entries(row.values).map(([col, value]) => (
                        <td key={col} className={`border border-stealth-700 px-2 py-1 ${getCorrCellStyle(value)}`}>
                          {value === null ? "-" : value.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="surface-card p-4">
              <h2 className="text-base font-semibold text-stealth-100">Special Signals</h2>
              <div className="mt-3 space-y-3 text-sm text-stealth-300">
                <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                  <p className="font-semibold text-stealth-100">Soybean Oil vs Grains</p>
                  <p className="mt-1 text-xs text-stealth-400">Spread 20d: {correlations?.special_signals.soybean_oil_vs_grains.spread_20d ?? "-"}%</p>
                  <p className="mt-1">{correlations?.special_signals.soybean_oil_vs_grains.interpretation ?? "insufficient data"}</p>
                </div>
                <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                  <p className="font-semibold text-stealth-100">Livestock Feed Margin Pressure</p>
                  <p className="mt-1 text-xs text-stealth-400">Spread 20d: {correlations?.special_signals.livestock_feed_margin_pressure.spread_20d ?? "-"}%</p>
                  <p className="mt-1">{correlations?.special_signals.livestock_feed_margin_pressure.interpretation ?? "insufficient data"}</p>
                </div>
                <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                  <p className="font-semibold text-stealth-100">Selected Pair Correlations (60d)</p>
                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-stealth-400">
                    {Object.entries(pair60).map(([key, value]) => (
                      <p key={key}>{formatGroupCode(key)}: {value === null ? "-" : value.toFixed(2)}</p>
                    ))}
                  </div>
                </div>
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
                          20d: {item.change_20d !== undefined && item.change_20d !== null ? `${item.change_20d.toFixed(2)}%` : item.spread_20d !== undefined && item.spread_20d !== null ? `${item.spread_20d.toFixed(2)}%` : "-"}
                        </p>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "coverage" ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="surface-card p-4 xl:col-span-2">
            <h2 className="text-base font-semibold text-stealth-100">Data Coverage & Warnings</h2>
            <p className="mt-2 text-sm text-stealth-300">
              Missing symbols are skipped and group weights are redistributed automatically across available sectors.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Missing Symbols</p>
                <div className="mt-2 space-y-1 text-xs text-stealth-400">
                  {overview.availability.missing_symbols.length === 0 ? (
                    <p>None</p>
                  ) : (
                    overview.availability.missing_symbols.map((item) => (
                      <p key={item.code}>{item.code}: {item.attempted_tickers.join(", ")}</p>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">Missing Macro Series</p>
                <div className="mt-2 space-y-1 text-xs text-stealth-400">
                  {overview.availability.missing_macro_series.length === 0 ? (
                    <p>None</p>
                  ) : (
                    overview.availability.missing_macro_series.map((item) => <p key={item}>{item}</p>)
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-stealth-400">
              {overview.warnings.map((warning) => (
                <p key={warning}>- {warning}</p>
              ))}
            </div>
          </div>

          <div className="surface-card p-4">
            <h2 className="text-base font-semibold text-stealth-100">Coverage Snapshot</h2>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-stealth-400">
                  <span>Symbols Available</span>
                  <span>{overview.availability.available_symbol_count}/{overview.availability.total_configured_symbols}</span>
                </div>
                <div className="h-2 rounded-full bg-stealth-700">
                  <div
                    className="h-2 rounded-full bg-sky-500"
                    style={{ width: `${(overview.availability.available_symbol_count / Math.max(1, overview.availability.total_configured_symbols)) * 100}%` }}
                  ></div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-stealth-400">
                  <span>Groups Covered</span>
                  <span>{overview.availability.available_group_count}/6</span>
                </div>
                <div className="h-2 rounded-full bg-stealth-700">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(overview.availability.available_group_count / 6) * 100}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
