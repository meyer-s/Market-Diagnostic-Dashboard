import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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

export default function AgricultureIndex() {
  const { data: overview, loading, error } = useApi<AgricultureOverview>("/agriculture/overview?days=365");
  const { data: correlations } = useApi<AgricultureCorrelations>("/agriculture/correlations?days=365");
  const { data: macro } = useApi<AgricultureMacro>("/agriculture/macro?days=365");

  const chartData = useMemo(() => overview?.composite.history ?? [], [overview]);
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Stability Score</p>
          <p className={`mt-2 text-3xl font-semibold ${getScoreTone(overview.stability_score)}`}>
            {overview.stability_score.toFixed(1)}
          </p>
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
      </div>

      <div className="surface-card-strong p-5">
        <p className="text-sm text-stealth-200">{overview.summary}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="surface-card p-4 xl:col-span-2">
          <h2 className="text-base font-semibold text-stealth-100">Composite History</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={CHART_MARGIN}>
                <CartesianGrid {...commonGridProps} />
                <XAxis dataKey="date" {...commonXAxisProps} />
                <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={commonTooltipStyle}
                  formatter={(value: number) => [formatTooltipValue(value, 2), "Index"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={getFamilyColor("materials")}
                  strokeWidth={2.2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-4">
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
      </div>

      <div className="surface-card p-4">
        <h2 className="text-base font-semibold text-stealth-100">Sector Panels</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {overview.groups.map((group) => (
            <div key={group.group} className="rounded-xl border border-stealth-700 bg-stealth-900/55 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-stealth-100">{group.label}</p>
                <span className="text-xs text-stealth-400">{group.effective_weight.toFixed(1)}%</span>
              </div>
              <p className={`mt-1 text-lg font-semibold ${getScoreTone(group.group_composite)}`}>{group.group_composite.toFixed(1)}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-stealth-300">
                <p>5d: {group.changes["5d"]?.toFixed(2) ?? "-"}%</p>
                <p>20d: {group.changes["20d"]?.toFixed(2) ?? "-"}%</p>
                <p>60d: {group.changes["60d"]?.toFixed(2) ?? "-"}%</p>
                <p>120d: {group.changes["120d"]?.toFixed(2) ?? "-"}%</p>
              </div>
              <p className="mt-2 text-xs text-stealth-400">Symbols: {group.symbol_count} | Breadth: {group.breadth_score?.toFixed(1) ?? "-"}</p>
              <p className="mt-1 text-xs text-stealth-400">Top: {group.strongest.map((s) => s.code).join(", ") || "n/a"}</p>
              <p className="text-xs text-stealth-500">Weak: {group.weakest.map((s) => s.code).join(", ") || "n/a"}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="surface-card p-4">
          <h2 className="text-base font-semibold text-stealth-100">Rolling Correlation Matrix (60d)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs text-stealth-300">
              <thead>
                <tr>
                  <th className="border border-stealth-700 px-2 py-1 text-left text-stealth-400">Group</th>
                  {matrix60[0] ? Object.keys(matrix60[0].values).map((col) => (
                    <th key={col} className="border border-stealth-700 px-2 py-1 text-left text-stealth-400">{col}</th>
                  )) : null}
                </tr>
              </thead>
              <tbody>
                {matrix60.map((row) => (
                  <tr key={row.row}>
                    <td className="border border-stealth-700 px-2 py-1 font-medium text-stealth-200">{row.row}</td>
                    {Object.entries(row.values).map(([col, value]) => (
                      <td key={col} className="border border-stealth-700 px-2 py-1">
                        {value === null ? "-" : value.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
                  <p key={key}>{key.replace(/_/g, " ")}: {value === null ? "-" : value.toFixed(2)}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="surface-card p-4">
        <h2 className="text-base font-semibold text-stealth-100">Macro Pressure</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {macro?.macro_pressure ? Object.entries(macro.macro_pressure).map(([key, item]) => (
            <div key={key} className="rounded-lg border border-stealth-700 bg-stealth-900/55 p-3">
              <p className="text-sm font-semibold text-stealth-100">{item.name}</p>
              <p className="mt-1 text-xs text-stealth-400">{item.status}</p>
              <p className="mt-1 text-xs text-stealth-500">
                20d: {item.change_20d !== undefined && item.change_20d !== null ? `${item.change_20d.toFixed(2)}%` : item.spread_20d !== undefined && item.spread_20d !== null ? `${item.spread_20d.toFixed(2)}%` : "-"}
              </p>
            </div>
          )) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="surface-card p-4">
          <h2 className="text-base font-semibold text-stealth-100">Strongest Markets</h2>
          <div className="mt-3 space-y-2">
            {overview.strongest_markets.map((row) => (
              <div key={row.code} className="flex items-center justify-between rounded-lg border border-stealth-700 bg-stealth-900/55 px-3 py-2">
                <p className="text-sm text-stealth-200">{row.code} <span className="text-xs text-stealth-500">{row.name}</span></p>
                <p className="text-sm font-semibold text-emerald-300">{row.score.toFixed(1)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card p-4">
          <h2 className="text-base font-semibold text-stealth-100">Weakest Markets</h2>
          <div className="mt-3 space-y-2">
            {overview.weakest_markets.map((row) => (
              <div key={row.code} className="flex items-center justify-between rounded-lg border border-stealth-700 bg-stealth-900/55 px-3 py-2">
                <p className="text-sm text-stealth-200">{row.code} <span className="text-xs text-stealth-500">{row.name}</span></p>
                <p className="text-sm font-semibold text-rose-300">{row.score.toFixed(1)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface-card p-4">
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
    </div>
  );
}
