import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import MarketLoading from "../components/ui/MarketLoading";
import DataScroller from "../components/ui/DataScroller";
import SupportingContextTooltip from "../components/ui/SupportingContextTooltip";
import { useApi } from "../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
} from "../utils/chartUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = "90d" | "180d" | "365d";

type SymbolRow = {
  code: string;
  name: string;
  group: string;
  unit: string;
  ticker: string;
  current_price: number | null;
  changes: Record<string, number | null>;
  momentum_score: number;
  volatility: number | null;
};

type GroupRow = {
  group: string;
  label: string;
  effective_weight: number;
  symbol_count: number;
  group_composite: number;
  changes: Record<string, number | null>;
  volatility: number | null;
  components: SymbolRow[];
};

type EnergyOverview = {
  as_of: string;
  regime_label: string;
  composite_score: number;
  stability_score: number;
  summary: string;
  groups: GroupRow[];
  symbols: SymbolRow[];
  availability: { available_count: number; total_configured: number };
  warnings: string[];
};

type HistoryPoint = { date: string; value: number };

type EnergyHistory = {
  as_of: string;
  composite_history: HistoryPoint[];
  stability_history: HistoryPoint[];
  radar_history: Array<{
    date: string;
    CL: number;
    BZ: number;
    NG: number;
    RB: number;
    HO: number;
    spread: number;
  }>;
  alt_comparison: Array<Record<string, number | string>>;
  biofuel_comparison: Array<Record<string, number | string>>;
  alt_symbols: Array<{ code: string; name: string; group: string }>;
};

type PricePoint = { date: string; value: number };

type EnergyPrices = {
  as_of: string;
  fred_prices: {
    retail_gasoline?: PricePoint[];
    retail_diesel?: PricePoint[];
    crude_wti_spot?: PricePoint[];
    nat_gas_spot?: PricePoint[];
    crude_inventory?: PricePoint[];
  };
};

type MixFuel = { year: number; value: number }[];
type GenerationMix = {
  as_of: string;
  latest_year: number;
  source: string;
  fallback_used: boolean;
  series: Record<string, MixFuel>;
  latest_by_fuel: Record<string, number>;
  latest_pct: Record<string, number>;
  summary: {
    fossil_pct: number;
    renewables_pct: number;
    nuclear_pct: number;
    notes: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEFRAME_DAYS: Record<Timeframe, number> = { "90d": 90, "180d": 180, "365d": 365 };

function biasTone(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score <= 40) return "text-rose-400";
  return "text-amber-400";
}

function changeTone(v: number | null | undefined) {
  if (v == null) return "text-stealth-500";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-stealth-300";
}

function fmt(v: number | null | undefined, decimals = 2) {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}`;
}

function money(v: number | null | undefined, decimals = 2, suffix = "") {
  if (v == null) return "—";
  return `$${v.toFixed(decimals)}${suffix}`;
}

function latestValue(points?: PricePoint[]) {
  if (!points?.length) return null;
  return points[points.length - 1]?.value ?? null;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean;
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixHex(start: string, end: string, amount: number) {
  const left = hexToRgb(start);
  const right = hexToRgb(end);
  const clamp = Math.max(0, Math.min(1, amount));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * clamp);
  return `rgb(${mix(left.r, right.r)}, ${mix(left.g, right.g)}, ${mix(left.b, right.b)})`;
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result[index] = values[index] * multiplier + result[index - 1] * (1 - multiplier);
  }
  return result;
}

function regimeBadgeStyle(label: string) {
  if (label.includes("Tightening") || label.includes("Elevated"))
    return "border-amber-400/40 bg-amber-500/10 text-amber-300";
  if (label.includes("Softening") || label.includes("Glut"))
    return "border-rose-400/40 bg-rose-500/10 text-rose-300";
  return "border-sky-400/40 bg-sky-500/10 text-sky-300";
}

function scoreBar(score: number) {
  const color =
    score >= 60 ? "#34d399" : score <= 40 ? "#f87171" : "#fbbf24";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-stealth-800">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className={`text-xs font-mono ${biasTone(score)}`}>{score.toFixed(0)}</span>
    </div>
  );
}

// Fuel colours for generation mix chart
const FUEL_COLORS: Record<string, string> = {
  coal:       "#6b7280",
  nat_gas:    "#3b82f6",
  nuclear:    "#8b5cf6",
  hydro:      "#06b6d4",
  wind:       "#10b981",
  solar:      "#f59e0b",
  petroleum:  "#78350f",
  geothermal: "#ec4899",
};

const FUEL_LABELS: Record<string, string> = {
  coal:       "Coal",
  nat_gas:    "Natural Gas",
  nuclear:    "Nuclear",
  hydro:      "Hydro",
  wind:       "Wind",
  solar:      "Solar",
  petroleum:  "Petroleum",
  geothermal: "Geothermal",
};

const ALT_COLORS: Record<string, string> = {
  XLE:  "#f97316",
  ICLN: "#34d399",
  TAN:  "#fbbf24",
  FAN:  "#60a5fa",
  PHO:  "#22d3ee",
};

const BIOFUEL_COLORS: Record<string, string> = {
  RB: "#f59e0b",
  HO: "#fb7185",
  EH: "#34d399",
  ZL: "#60a5fa",
};

// Shared primitives matching app design system
// ---------------------------------------------------------------------------

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <p className="page-kicker mb-3">{children}</p>
);

function LabelCaps({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs uppercase tracking-[0.14em] text-stealth-500 ${className}`.trim()}>{children}</p>;
}

function BodyHint({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs leading-5 text-stealth-400 ${className}`.trim()}>{children}</p>;
}

function CardHeader({
  kicker,
  title,
  description,
  tooltipText,
}: {
  kicker: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  tooltipText?: string;
}) {
  return (
    <div className="space-y-1">
      <Kicker>{kicker}</Kicker>
      <div className="flex items-start gap-2">
        {tooltipText ? (
          <SupportingContextTooltip text={tooltipText}>
            <h2 className="min-w-0 break-words text-base font-semibold text-stealth-100">{title}</h2>
          </SupportingContextTooltip>
        ) : (
          <h2 className="min-w-0 break-words text-base font-semibold text-stealth-100">{title}</h2>
        )}
      </div>
      {description ? <BodyHint>{description}</BodyHint> : null}
    </div>
  );
}

function SectionHeader({
  kicker,
  title,
  tooltipText,
}: {
  kicker: string;
  title: string;
  tooltipText: string;
}) {
  return (
    <div>
      <p className="page-kicker">{kicker}</p>
      <SupportingContextTooltip text={tooltipText}>
        <h2 className="min-w-0 break-words text-lg font-semibold text-stealth-100">{title}</h2>
      </SupportingContextTooltip>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  tone = "text-stealth-100",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="surface-card-muted px-2.5 py-2">
      <LabelCaps>{label}</LabelCaps>
      <p className={`mt-0.5 text-base font-semibold ${tone}`}>{value}</p>
      {detail ? (
        <div className="mt-1 text-xs leading-5 text-stealth-300">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function LegendPill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className="page-badge gap-2 px-2 py-1 text-xs text-stealth-300"><LegendDot color={color} />{children}</span>;
}

function MetaPill({ children, tone = "text-stealth-400" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`page-badge px-2 py-1 text-xs ${tone}`}>{children}</span>;
}

function SignalTile({
  label,
  title,
  detail,
  tone = "text-stealth-100",
}: {
  label: string;
  title: React.ReactNode;
  detail: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="surface-card-muted px-3 py-2.5">
      <LabelCaps>{label}</LabelCaps>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{title}</p>
      <div className="mt-1 text-xs leading-5 text-stealth-300">
        {detail}
      </div>
    </div>
  );
}

const tip = {
  contentStyle: {
    background: "rgba(11,15,25,0.94)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    fontSize: 12,
    boxShadow: "0 10px 40px rgba(2,6,23,0.75)",
  },
};

// ---------------------------------------------------------------------------
// Futures price table
// ---------------------------------------------------------------------------

function GroupSummaryStrip({ groups }: { groups: GroupRow[] }) {
  return (
    <div className="mt-3 border-t border-stealth-800/60 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SupportingContextTooltip text="Grouped composite leadership compressed into one strip so the futures table remains the primary market-structure read.">
            <LabelCaps className="mb-0">Group Leadership</LabelCaps>
          </SupportingContextTooltip>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.group} className="surface-card-muted px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <LabelCaps className="mb-0">{group.label}</LabelCaps>
              <BodyHint>{group.effective_weight.toFixed(0)}% wt</BodyHint>
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div>
                <p className={`text-xl font-semibold ${biasTone(group.group_composite)}`}>{group.group_composite.toFixed(0)}</p>
                <BodyHint>{group.components.map((component) => component.code).join(" · ")}</BodyHint>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-right text-xs">
                <span className="text-stealth-500">20d</span>
                <span className={changeTone(group.changes["20d"])}>{fmt(group.changes["20d"])}%</span>
                <span className="text-stealth-500">120d</span>
                <span className={changeTone(group.changes["120d"])}>{fmt(group.changes["120d"])}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FuturesTable({
  symbols,
  groups,
  surfaceClassName = "surface-card",
}: {
  symbols: SymbolRow[];
  groups?: GroupRow[];
  surfaceClassName?: string;
}) {
  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <Kicker>Energy Futures</Kicker>
      <DataScroller label="Energy futures contract performance">
        <table className="w-full min-w-[560px] text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-stealth-700/50">
              <th className="pb-2 text-left text-xs font-medium text-stealth-400">Contract</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">Price</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">5d</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">20d</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">60d</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">120d</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stealth-800/40">
            {symbols.map((sym) => (
              <tr key={sym.code} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-2">
                  <span className="font-semibold text-stealth-100">{sym.code}</span>
                  <span className="ml-2 text-xs text-stealth-500">{sym.name}</span>
                </td>
                <td className="py-2 text-right font-mono text-stealth-200">
                  {sym.current_price != null ? sym.current_price.toFixed(3) : "—"}
                  <span className="ml-1 text-xs text-stealth-600">{sym.unit}</span>
                </td>
                {(["5d", "20d", "60d", "120d"] as const).map((k) => (
                  <td key={k} className={`py-2 text-right font-mono text-xs ${changeTone(sym.changes[k])}`}>
                    {fmt(sym.changes[k])}%
                  </td>
                ))}
                <td className="py-2 text-right">{scoreBar(sym.momentum_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataScroller>
      {groups?.length ? <GroupSummaryStrip groups={groups} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composite history chart
// ---------------------------------------------------------------------------

function CompositeHistoryChart({ history, surfaceClassName = "surface-card" }: { history: HistoryPoint[]; surfaceClassName?: string }) {
  if (!history.length) return null;
  const decimated = history.filter((_, i) => i % Math.max(1, Math.floor(history.length / 200)) === 0);
  const scores = decimated.map((p) => p.value);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const yMin = Math.max(0, Math.floor(minScore * 0.95));
  const yMax = Math.min(100, Math.ceil(maxScore * 1.02));
  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader kicker="Energy Stability Score" title="Stability history" tooltipText="Market stability over the selected lookback window. Higher means the complex is absorbing large moves cleanly; lower means absolute moves and volatility are destabilizing the market." />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Energy composite stability score history"
            data={decimated}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(5, 10)} />
            <YAxis {...commonYAxisProps} domain={[yMin, yMax]} />
            <Tooltip {...tip} formatter={(v: number) => [v.toFixed(1), "Stability Score"]} />
            <ReferenceLine y={50} stroke="var(--chart-tooltip-border)" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="value" stroke="#38bdf8" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Futures → Pump Spread (MACD-style: crude cost/gal vs retail with spread bars)
// ---------------------------------------------------------------------------

type SpreadPoint = {
  date: string;
  wti_gal: number;
  retail: number;
  diesel: number | null;
  spread: number;
  spread_signal: number;
  macd: number;
  macd_signal: number;
  histogram: number;
};

type PassThroughPoint = {
  date: string;
  crude: number;
  pump: number;
  crude_v: number;
  pump_v: number;
};

function SpreadMomentumTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const byKey: Record<string, number> = {};
  payload.forEach((e) => {
    if (e.dataKey && typeof e.value === "number") byKey[e.dataKey] = e.value;
  });
  const accelerating = (byKey.histogram ?? 0) >= 0;
  return (
    <div className="min-w-[200px] rounded-xl border border-stealth-700/70 bg-stealth-950/95 p-3 text-xs shadow-[0_10px_40px_rgba(2,6,23,0.75)] backdrop-blur-2xl">
      <p className="mb-2 font-semibold text-white">{label}</p>
      {byKey.spread != null && (
        <p className="text-amber-300">Refining spread: <span className="font-mono">${byKey.spread.toFixed(3)}</span></p>
      )}
      {byKey.spread_signal != null && (
        <p className="text-stealth-300">26w baseline: <span className="font-mono">${byKey.spread_signal.toFixed(3)}</span></p>
      )}
      {byKey.macd != null && (
        <p className="text-sky-300">MACD: <span className="font-mono">{fmt(byKey.macd, 3)}</span></p>
      )}
      {byKey.macd_signal != null && (
        <p className="text-orange-300">Signal: <span className="font-mono">{fmt(byKey.macd_signal, 3)}</span></p>
      )}
      {byKey.histogram != null && (
        <p className={`mt-2 border-t border-white/[0.06] pt-2 ${accelerating ? "text-rose-300" : "text-emerald-300"}`}>
          Histogram: <span className="font-mono">{fmt(byKey.histogram, 3)}</span>
          <span className="ml-1 text-stealth-500">{accelerating ? "margin pressure accelerating" : "margin pressure fading"}</span>
        </p>
      )}
    </div>
  );
}

function RetailPricesChart({
  prices,
  surfaceClassName = "surface-card",
  chartHeightClassName = "h-64",
}: {
  prices: EnergyPrices["fred_prices"];
  surfaceClassName?: string;
  chartHeightClassName?: string;
}) {
  const spotData   = prices?.crude_wti_spot  ?? [];
  const gasData    = prices?.retail_gasoline ?? [];
  const dieselData = prices?.retail_diesel   ?? [];

  const merged = useMemo((): SpreadPoint[] => {
    if (!spotData.length || !gasData.length) return [];

    const spotMap: Record<string, number> = {};
    spotData.forEach((p) => { spotMap[p.date] = p.value; });

    const dieselMap: Record<string, number> = {};
    dieselData.forEach((p) => { dieselMap[p.date] = p.value; });

    const rows = gasData.map((g) => {
      let wti = spotMap[g.date];
      if (!wti) {
        for (let d = 1; d <= 7; d++) {
          const a = new Date(g.date); a.setDate(a.getDate() + d);
          const b = new Date(g.date); b.setDate(b.getDate() - d);
          wti = spotMap[a.toISOString().slice(0, 10)] ?? spotMap[b.toISOString().slice(0, 10)];
          if (wti) break;
        }
      }
      if (!wti) return null;
      const wti_gal = wti / 42;
      const retail  = g.value;
      const diesel  = dieselMap[g.date] ?? null;
      const spread  = retail - wti_gal;
      return { date: g.date, wti_gal, retail, diesel, spread, spread_signal: 0, macd: 0, macd_signal: 0, histogram: 0 };
    }).filter(Boolean) as SpreadPoint[];

    if (rows.length < 10) return [];

    // Rolling 26-week (~6 month) mean of spread → signal line
    const W = 26;
    for (let i = 0; i < rows.length; i++) {
      const slice = rows.slice(Math.max(0, i - W + 1), i + 1);
      rows[i].spread_signal = slice.reduce((s, r) => s + r.spread, 0) / slice.length;
    }

    const spreadSeries = rows.map((row) => row.spread);
    const fast = emaSeries(spreadSeries, 12);
    const slow = emaSeries(spreadSeries, 26);
    const macdSeries = spreadSeries.map((_, index) => fast[index] - slow[index]);
    const signalSeries = emaSeries(macdSeries, 9);

    for (let i = 0; i < rows.length; i++) {
      rows[i].macd = macdSeries[i];
      rows[i].macd_signal = signalSeries[i];
      rows[i].histogram = macdSeries[i] - signalSeries[i];
    }

    return rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 150)) === 0);
  }, [spotData, gasData, dieselData]);

  const indexedPassThrough = useMemo((): PassThroughPoint[] => {
    if (!spotData.length || !gasData.length) return [];

    const spotMap: Record<string, number> = {};
    spotData.forEach((p) => { spotMap[p.date] = p.value; });

    const rows = gasData.map((g) => {
      let price = spotMap[g.date];
      if (!price) {
        for (let d = 1; d <= 4; d++) {
          const a = new Date(g.date); a.setDate(a.getDate() + d);
          const b = new Date(g.date); b.setDate(b.getDate() - d);
          price = spotMap[a.toISOString().slice(0, 10)] ?? spotMap[b.toISOString().slice(0, 10)];
          if (price) break;
        }
      }
      return price ? { date: g.date, spot: price, retail: g.value } : null;
    }).filter(Boolean) as Array<{ date: string; spot: number; retail: number }>;

    if (rows.length < 5) return [];
    const base = rows[0];
    return rows
      .filter((_, i) => i % Math.max(1, Math.floor(rows.length / 120)) === 0)
      .map((row) => ({
        date: row.date,
        crude: (row.spot / base.spot) * 100,
        pump: (row.retail / base.retail) * 100,
        crude_v: row.spot,
        pump_v: row.retail,
      }));
  }, [spotData, gasData]);

  if (!merged.length) return null;

  const latest = merged[merged.length - 1];
  const accelerating = latest.histogram >= 0;
  const momentumTone = accelerating ? "text-rose-300" : "text-emerald-300";
  const momentumLabel = accelerating ? "Margins accelerating" : "Margins easing";
  const chartHeight = chartHeightClassName === "h-64" ? "h-60" : chartHeightClassName;

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <CardHeader kicker="Futures → Pump: Refining Spread" title="Refining spread momentum" tooltipText="MACD-style view of the retail gasoline wedge versus WTI. Positive histogram means pump margin pressure is accelerating; negative means it is fading. The raw spread line stays in the background as context rather than the primary message." />
        <MetaPill tone={momentumTone}>{momentumLabel}</MetaPill>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <StatTile label="WTI / gal" value={<span className="font-mono">${latest.wti_gal.toFixed(3)}</span>} tone="text-orange-300" detail="Crude input cost" />
        <StatTile label="Regular Gas" value={<span className="font-mono">${latest.retail.toFixed(3)}</span>} tone="text-amber-300" detail="Retail pump price" />
        <StatTile label="Spread" value={<span className="font-mono">${latest.spread.toFixed(3)}</span>} tone={momentumTone} detail={`26w baseline ${money(latest.spread_signal, 3)}`} />
        <StatTile label="Histogram" value={<span className="font-mono">{fmt(latest.histogram, 3)}</span>} tone={momentumTone} detail="Margin acceleration" />
      </div>

      <div className={chartHeight}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            accessibilityLayer
            aria-label="Gasoline-to-WTI refining-spread momentum history"
            data={merged}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis yAxisId="momentum" {...commonYAxisProps} tickFormatter={(v: number) => `${v.toFixed(2)}`} />
            <YAxis yAxisId="spread" orientation="right" hide domain={["auto", "auto"]} />
            <ReferenceLine yAxisId="momentum" y={0} stroke="var(--chart-tooltip-border)" strokeDasharray="3 3" />
            <Tooltip content={<SpreadMomentumTooltip />} />
            <Bar yAxisId="momentum" dataKey="histogram" name="histogram" barSize={7} isAnimationActive={false}>
              {merged.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.histogram >= 0 ? "rgba(251,113,133,0.42)" : "rgba(52,211,153,0.42)"}
                  stroke={entry.histogram >= 0 ? "rgba(251,113,133,0.9)" : "rgba(52,211,153,0.9)"}
                />
              ))}
            </Bar>
            <Line yAxisId="momentum" type="monotone" dataKey="macd" stroke="#38bdf8" strokeWidth={2.6} dot={false} isAnimationActive={false} name="macd" />
            <Line yAxisId="momentum" type="monotone" dataKey="macd_signal" stroke="#fb923c" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} name="macd_signal" />
            <Line yAxisId="spread" type="monotone" dataKey="spread" stroke="#fbbf24" strokeOpacity={0.45} strokeWidth={1.5} dot={false} isAnimationActive={false} name="spread" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-stealth-400">
        <LegendPill color="#38bdf8">MACD</LegendPill>
        <LegendPill color="#fb923c">Signal</LegendPill>
        <LegendPill color="#fbbf24">Raw spread</LegendPill>
      </div>

      {indexedPassThrough.length > 0 && (
        <div className="mt-4 border-t border-stealth-800/60 pt-3">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <SupportingContextTooltip text="Indexed to 100 so crude can be compared against retail catch-up without spending a separate card on pass-through timing.">
                <LabelCaps className="mb-0">Pass-Through Lag</LabelCaps>
              </SupportingContextTooltip>
            </div>
            <div className="flex flex-wrap gap-2">
              <LegendPill color="#f97316">WTI Crude</LegendPill>
              <LegendPill color="#fbbf24">Retail Gasoline</LegendPill>
            </div>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                accessibilityLayer
                aria-label="Indexed retail gasoline and WTI pass-through history"
                data={indexedPassThrough}
                margin={CHART_MARGIN}
              >
                <CartesianGrid {...commonGridProps} />
                <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
                <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(v) => `${v.toFixed(0)}`} />
                <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
                <Tooltip
                  {...tip}
                  formatter={(value: number, name: string, props: { payload?: { crude_v?: number; pump_v?: number } }) => {
                    if (name === "crude") return [`$${(props.payload?.crude_v ?? value).toFixed(2)}/bbl`, "WTI Crude"];
                    return [`$${(props.payload?.pump_v ?? value).toFixed(3)}/gal`, "Retail Gas"];
                  }}
                />
                <Line type="monotone" dataKey="crude" stroke="#f97316" dot={false} strokeWidth={1.9} name="crude" />
                <Line type="monotone" dataKey="pump" stroke="#fbbf24" dot={false} strokeWidth={1.8} strokeDasharray="4 2" name="pump" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supply ↔ Price Relationship (normalized, inventory inverted)
// ---------------------------------------------------------------------------

function SupplyPriceChart({ prices }: { prices: EnergyPrices["fred_prices"] }) {
  const spotData = prices?.crude_wti_spot ?? [];
  const invData  = prices?.crude_inventory ?? [];

  const normalized = useMemo(() => {
    if (!spotData.length || !invData.length) return [];
    const spotMap: Record<string, number> = {};
    spotData.forEach((p) => { spotMap[p.date] = p.value; });

    const merged = invData.map((inv) => {
      let price = spotMap[inv.date];
      if (!price) {
        for (let d = 1; d <= 4; d++) {
          const a = new Date(inv.date); a.setDate(a.getDate() + d);
          const b = new Date(inv.date); b.setDate(b.getDate() - d);
          price = spotMap[a.toISOString().slice(0, 10)] ?? spotMap[b.toISOString().slice(0, 10)];
          if (price) break;
        }
      }
      return price ? { date: inv.date, price, inventory: inv.value } : null;
    }).filter(Boolean) as Array<{ date: string; price: number; inventory: number }>;

    if (merged.length < 5) return [];
    const prices_ = merged.map((d) => d.price);
    const invs    = merged.map((d) => d.inventory);
    const [minP, maxP] = [Math.min(...prices_), Math.max(...prices_)];
    const [minI, maxI] = [Math.min(...invs),    Math.max(...invs)];
    const rP = maxP - minP || 1;
    const rI = maxI - minI || 1;
    return merged
      .filter((_, i) => i % Math.max(1, Math.floor(merged.length / 120)) === 0)
      .map((d) => ({
        date: d.date,
        price_norm: ((d.price     - minP) / rP) * 100,
        inv_inv:    (1 - (d.inventory - minI) / rI) * 100,
        price: d.price,
        inventory: d.inventory,
      }));
  }, [spotData, invData]);

  if (!normalized.length) return null;

  return (
    <div className="surface-card self-start p-3 sm:p-4">
      <CardHeader kicker="Supply ↔ Price Relationship" title="Inventories vs WTI" tooltipText="Normalized 0–100 with inventories inverted so tightening supply climbs with price stress. Divergence between the two lines suggests supply and spot price are no longer confirming each other cleanly." />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Inverted oil inventories and WTI price history"
            data={normalized}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={[0, 100]} tickFormatter={(v) => `${v.toFixed(0)}`} />
            <Tooltip
              {...tip}
              formatter={(value: number, name: string, props: { payload?: { price?: number; inventory?: number } }) => {
                if (name === "price_norm") return [`$${(props.payload?.price ?? value).toFixed(2)}/bbl`, "WTI Spot"];
                return [`${(props.payload?.inventory ?? value).toFixed(0)} M bbl`, "Crude Stocks"];
              }}
            />
            <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="price_norm" stroke="#f97316" dot={false} strokeWidth={2} name="price_norm" />
            <Line type="monotone" dataKey="inv_inv"    stroke="#475569" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="inv_inv" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-stealth-400">
        <LegendPill color="#f97316">WTI Spot</LegendPill>
        <LegendPill color="#475569">Inventory (inverted)</LegendPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor radar (live momentum snapshot across all contracts)
// ---------------------------------------------------------------------------

function FactorRadar({
  symbols,
  history,
  surfaceClassName = "surface-card",
}: {
  symbols: SymbolRow[];
  history?: EnergyHistory["radar_history"];
  surfaceClassName?: string;
}) {
  const byCode = Object.fromEntries(symbols.map((s) => [s.code, s]));
  const wti   = byCode["CL"];
  const brent = byCode["BZ"];
  const ng    = byCode["NG"];
  const ho    = byCode["HO"];
  const rb    = byCode["RB"];

  const spreadRaw   = (brent?.current_price ?? 0) - (wti?.current_price ?? 0);
  const spreadNorm  = Math.min(100, Math.max(0, (spreadRaw / 10) * 100));

  const radar = useMemo(() => {
    const rows: Array<Record<string, string | number>> = [
      { factor: "WTI", current: wti?.momentum_score ?? 50 },
      { factor: "Brent", current: brent?.momentum_score ?? 50 },
      { factor: "Nat Gas", current: ng?.momentum_score ?? 50 },
      { factor: "RBOB", current: rb?.momentum_score ?? 50 },
      { factor: "HtgOil", current: ho?.momentum_score ?? 50 },
      { factor: "Spread", current: spreadNorm },
    ];

    const currentAverage = rows.reduce((sum, row) => sum + Number(row.current), 0) / rows.length;
    const oldestSnapshot = (history ?? []).slice(-12)[0];
    const oldestAverage = oldestSnapshot
      ? (oldestSnapshot.CL + oldestSnapshot.BZ + oldestSnapshot.NG + oldestSnapshot.RB + oldestSnapshot.HO + oldestSnapshot.spread) / 6
      : currentAverage;
    const trendDelta = currentAverage - oldestAverage;
    const trendMode = trendDelta >= 0 ? "growth" : "contraction";
    const timelineAnchor = trendMode === "growth" ? "#22c55e" : "#ef4444";
    const timelineBase = trendMode === "growth" ? "#d9f99d" : "#fecaca";
    const currentStroke = trendMode === "growth" ? "#4ade80" : "#f87171";
    const currentFill = trendMode === "growth" ? "#22c55e" : "#ef4444";

    const layers = (history ?? []).slice(-12).map((snapshot, index, arr) => {
      const key = `layer_${index}`;
      const progress = arr.length <= 1 ? 1 : index / (arr.length - 1);
      const layerAverage = (snapshot.CL + snapshot.BZ + snapshot.NG + snapshot.RB + snapshot.HO + snapshot.spread) / 6;
      const relativePosition = Math.max(0, Math.min(1, (layerAverage - Math.min(oldestAverage, currentAverage)) / (Math.abs(trendDelta) || 1)));
      rows[0][key] = snapshot.CL;
      rows[1][key] = snapshot.BZ;
      rows[2][key] = snapshot.NG;
      rows[3][key] = snapshot.RB;
      rows[4][key] = snapshot.HO;
      rows[5][key] = snapshot.spread;
      const color = mixHex(timelineBase, timelineAnchor, 0.18 + progress * 0.52 + relativePosition * 0.18);
      return {
        key,
        label: new Date(snapshot.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        color,
        strokeOpacity: 0.12 + progress * 0.34,
        fillOpacity: 0.01 + progress * 0.04,
        strokeWidth: 0.32 + progress * 1.08,
      };
    });

    return {
      rows,
      layers,
      trendMode,
      trendDelta,
      currentAverage,
      timelineBase,
      timelineAnchor,
      currentStroke,
      currentFill,
    };
  }, [history, wti, brent, ng, rb, ho, spreadNorm]);

  const radarTooltipLabel = useMemo(() => {
    const labels: Record<string, string> = { current: "Current" };
    radar.layers.forEach((layer) => {
      labels[layer.key] = layer.label;
    });
    return labels;
  }, [radar.layers]);

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader kicker="Contract Momentum Radar" title="Cross-contract momentum" tooltipText="Month-to-month shells deepen from pale to saturated green or red so the time path itself shows expansion or contraction across the full contract set." />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RadarChart
            accessibilityLayer
            aria-label="Cross-contract energy momentum by lookback window"
            data={radar.rows}
            margin={{ top: 8, right: 28, bottom: 8, left: 28 }}
          >
            <PolarGrid stroke="#1e293b" />
            <PolarAngleAxis dataKey="factor" tick={{ fill: "#64748b", fontSize: 12 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            {radar.layers.map((layer) => (
              <Radar
                key={layer.key}
                dataKey={layer.key}
                name={layer.label}
                stroke={layer.color}
                fill={layer.color}
                strokeOpacity={layer.strokeOpacity}
                fillOpacity={layer.fillOpacity}
                strokeWidth={layer.strokeWidth}
              />
            ))}
            <Radar
              dataKey="current"
              name="Current"
              stroke={radar.currentStroke}
              fill={rgba(radar.currentFill, 0.16)}
              strokeWidth={2.2}
              strokeOpacity={0.98}
              fillOpacity={1}
            />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string, props: { payload?: { factor?: string } }) => [
                `${v.toFixed(0)} / 100`,
                `${props.payload?.factor ?? "Factor"} · ${radarTooltipLabel[name] ?? name}`,
              ]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stealth-500">
        <div className="flex flex-wrap gap-2">
          {radar.layers.length > 0 && (
            <>
              <LegendPill color={radar.layers[0].color}>{radar.layers[0].label}</LegendPill>
              <LegendPill color={radar.layers[Math.floor(radar.layers.length / 2)]?.color ?? radar.layers[0].color}>Mid curve</LegendPill>
              <LegendPill color={radar.currentStroke}>Current</LegendPill>
            </>
          )}
        </div>
        <span className={radar.trendMode === "growth" ? "text-amber-300" : "text-sky-300"}>
          {radar.trendMode === "growth" ? "Expansion" : "Contraction"} {radar.trendDelta >= 0 ? "+" : ""}{radar.trendDelta.toFixed(1)} pts vs 12m ago
        </span>
        {wti && <span>Vol: <span className={changeTone(wti.volatility != null ? (wti.volatility > 35 ? 1 : -1) : 0)}>{wti.volatility?.toFixed(1) ?? "—"}%</span></span>}
        {brent && wti && <span>Spread: <span className={spreadRaw > 5 ? "text-amber-400" : "text-stealth-300"}>${spreadRaw.toFixed(2)}</span></span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alt energy comparison (indexed to 100)
// ---------------------------------------------------------------------------

function AltEnergyChart({
  data,
  altSymbols,
  compact = false,
}: {
  data: Array<Record<string, number | string>>;
  altSymbols: Array<{ code: string; name: string; group: string }>;
  compact?: boolean;
}) {
  if (!data.length) return null;

  const codes = altSymbols.map((s) => s.code).filter((code) => data.some((row) => code in row));
  const transitionCodes = codes.filter((code) => code !== "XLE");

  const chartData = useMemo(() => {
    return data
      .map((row) => {
        const point: Record<string, number | string> = { ...row };
        const transitionValues = transitionCodes
          .map((code) => row[code])
          .filter((value): value is number => typeof value === "number");

        if (transitionValues.length > 0) {
          point.transition_basket = Number((transitionValues.reduce((sum, value) => sum + value, 0) / transitionValues.length).toFixed(2));
        }

        if (typeof row.XLE === "number" && typeof point.transition_basket === "number") {
          point.rotation_spread = Number((row.XLE - point.transition_basket).toFixed(2));
        }

        return point;
      })
      .filter((row) => typeof row.XLE === "number");
  }, [data, transitionCodes]);

  const decimated = chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 200)) === 0);
  const latestPoint = chartData[chartData.length - 1] as Record<string, number | string> | undefined;
  const firstPoint = chartData[0] as Record<string, number | string> | undefined;
  const latestSpread = typeof latestPoint?.rotation_spread === "number" ? latestPoint.rotation_spread : null;
  const startingSpread = typeof firstPoint?.rotation_spread === "number" ? firstPoint.rotation_spread : null;
  const spreadDelta = latestSpread != null && startingSpread != null ? latestSpread - startingSpread : null;
  const latestBasket = typeof latestPoint?.transition_basket === "number" ? latestPoint.transition_basket : null;
  const latestXle = typeof latestPoint?.XLE === "number" ? latestPoint.XLE : null;

  const leadership = latestSpread == null
    ? { label: "Mixed leadership", tone: "text-stealth-100" }
    : latestSpread >= 8
      ? { label: "Traditional energy leading", tone: "text-orange-300" }
      : latestSpread <= -8
        ? { label: "Transition leadership", tone: "text-emerald-300" }
        : { label: "Balanced rotation", tone: "text-stealth-100" };

  const strongestTheme = latestPoint
    ? codes.reduce<{ code: string; value: number } | null>((best, code) => {
        const current = latestPoint[code];
        if (typeof current !== "number") return best;
        if (!best || current > best.value) return { code, value: current };
        return best;
      }, null)
    : null;

  return (
    <div className={`surface-card self-start p-3 sm:p-4 ${compact ? "h-full" : ""}`.trim()}>
      <div className={`flex flex-wrap items-start justify-between ${compact ? "mb-2 gap-2" : "mb-3 gap-3"}`}>
        <CardHeader kicker="Traditional vs Alternative Energy — Indexed to 100" title="Capital rotation context" tooltipText="This panel is meant to answer one question: is capital favoring traditional energy cash flows or transition-linked equities? XLE is the traditional cash-flow proxy; the transition basket is the average of ICLN, TAN, FAN, and PHO." />
        <div className="flex flex-wrap gap-3">
          {altSymbols.map((s) => (
            <LegendPill key={s.code} color={ALT_COLORS[s.code] ?? "#94a3b8"}>{s.code}</LegendPill>
          ))}
          <LegendPill color="#e2e8f0">Transition basket</LegendPill>
        </div>
      </div>

      <div className={`grid md:grid-cols-4 ${compact ? "mb-3 gap-2" : "mb-4 gap-3"}`}>
        <StatTile label="Leadership" value={leadership.label} tone={leadership.tone} detail="Who is currently attracting relative capital." />
        <StatTile label="XLE" value={latestXle != null ? latestXle.toFixed(1) : "—"} tone="text-orange-300" detail="Traditional energy index level." />
        <StatTile label="Transition Basket" value={latestBasket != null ? latestBasket.toFixed(1) : "—"} tone="text-emerald-300" detail="Average of clean and grid-adjacent ETFs." />
        <StatTile label="Rotation Spread" value={latestSpread != null ? fmt(latestSpread, 1) : "—"} tone={leadership.tone} detail={spreadDelta != null ? `${fmt(spreadDelta, 1)} pts vs start of window` : "Relative leadership spread."} />
      </div>

      <div className={compact ? "h-36" : "h-52"}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Traditional versus alternative energy capital-rotation history"
            data={decimated}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => (d as string).slice(0, 7)} />
            <YAxis {...commonYAxisProps} />
            <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip {...tip} formatter={(v: number, name: string) => [`${v.toFixed(1)}`, name]} />
            <Line
              type="monotone"
              dataKey="transition_basket"
              stroke="#e2e8f0"
              dot={false}
              strokeWidth={2.2}
              strokeDasharray="6 3"
            />
            {codes.map((code) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={ALT_COLORS[code] ?? "#94a3b8"}
                dot={false}
                strokeWidth={code === "XLE" ? 2.8 : code === strongestTheme?.code ? 2 : 1.2}
                strokeOpacity={code === "XLE" || code === strongestTheme?.code ? 1 : 0.72}
                strokeDasharray={code === "XLE" || code === strongestTheme?.code ? undefined : "4 2"}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`grid md:grid-cols-3 ${compact ? "mt-2 gap-1.5" : "mt-3 gap-2"}`}>
        <SignalTile
          label="Takeaway"
          title={leadership.label}
          tone={leadership.tone}
          detail={latestSpread == null ? "Relative leadership spread unavailable." : latestSpread >= 8 ? "Legacy energy cash-flow proxies are outpacing the transition basket." : latestSpread <= -8 ? "Transition-linked equities are leading traditional energy." : "Neither side has a decisive lead right now."}
        />
        <SignalTile
          label="Momentum"
          title={spreadDelta == null ? "Rotation drift unavailable" : spreadDelta >= 0 ? "Traditional lead widening" : "Transition catching up"}
          tone={spreadDelta == null ? "text-stealth-100" : spreadDelta >= 0 ? "text-orange-300" : "text-emerald-300"}
          detail={spreadDelta == null ? "Window-over-window spread change unavailable." : `${fmt(spreadDelta, 1)} points in XLE minus transition basket since the start of the window.`}
        />
        <SignalTile
          label="Strongest Theme"
          title={strongestTheme?.code ?? "—"}
          tone={strongestTheme?.code === "XLE" ? "text-orange-300" : "text-emerald-300"}
          detail={strongestTheme ? `${strongestTheme.value.toFixed(1)} indexed performance.` : "Theme leadership unavailable."}
        />
      </div>
    </div>
  );
}

function BiofuelsPanel({
  data,
  symbols,
  compact = false,
}: {
  data: Array<Record<string, number | string>>;
  symbols: SymbolRow[];
  compact?: boolean;
}) {
  if (!data.length) return null;

  const availableCodes = ["RB", "HO", "EH", "ZL"].filter((code) => data.some((row) => code in row));
  if (availableCodes.length < 2) return null;

  const labelByCode = Object.fromEntries(symbols.map((symbol) => [symbol.code, symbol.name]));
  const chartData = data.filter((_, index) => index % Math.max(1, Math.floor(data.length / 180)) === 0);
  const latestPoint = data[data.length - 1] as Record<string, number | string> | undefined;
  const firstPoint = data[0] as Record<string, number | string> | undefined;
  const biofuelCodes = availableCodes.filter((code) => code === "EH" || code === "ZL");
  const refinedCodes = availableCodes.filter((code) => code === "RB" || code === "HO");

  const averageForCodes = (point: Record<string, number | string> | undefined, codes: string[]) => {
    if (!point) return null;
    const values = codes
      .map((code) => point[code])
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const latestBiofuelBasket = averageForCodes(latestPoint, biofuelCodes);
  const latestRefinedBasket = averageForCodes(latestPoint, refinedCodes);
  const startingBiofuelBasket = averageForCodes(firstPoint, biofuelCodes);
  const startingRefinedBasket = averageForCodes(firstPoint, refinedCodes);
  const rotationSpread = latestBiofuelBasket != null && latestRefinedBasket != null ? latestBiofuelBasket - latestRefinedBasket : null;
  const spreadDelta = rotationSpread != null && startingBiofuelBasket != null && startingRefinedBasket != null
    ? rotationSpread - (startingBiofuelBasket - startingRefinedBasket)
    : null;

  const strongestContract = latestPoint
    ? availableCodes.reduce<{ code: string; value: number } | null>((best, code) => {
        const current = latestPoint[code];
        if (typeof current !== "number") return best;
        if (!best || current > best.value) return { code, value: current };
        return best;
      }, null)
    : null;

  const leadership = rotationSpread == null
    ? { label: "Leadership unclear", tone: "text-stealth-100" }
    : rotationSpread >= 6
      ? { label: "Biofuels leading", tone: "text-emerald-300" }
      : rotationSpread <= -6
        ? { label: "Refined products leading", tone: "text-orange-300" }
        : { label: "Balanced chain", tone: "text-stealth-100" };

  return (
    <div className={`surface-card self-start p-3 sm:p-4 ${compact ? "h-full" : ""}`.trim()}>
      <div className={`flex flex-wrap items-start justify-between ${compact ? "mb-2 gap-2" : "mb-3 gap-3"}`}>
        <CardHeader kicker="Feedstocks and Blendstocks — Indexed to 100" title="Biofuels and combustibles" tooltipText="Tracks whether biofuel-linked contracts like ethanol and soybean oil are leading or lagging the refined petroleum chain. This helps surface where incremental fuel demand is showing up first." />
        <div className="flex flex-wrap gap-2">
          {availableCodes.map((code) => (
            <LegendPill key={code} color={BIOFUEL_COLORS[code] ?? "#94a3b8"}>{code}</LegendPill>
          ))}
        </div>
      </div>

      <div className={`grid md:grid-cols-4 ${compact ? "mb-3 gap-2" : "mb-4 gap-3"}`}>
        <StatTile label="Leadership" value={leadership.label} tone={leadership.tone} detail="Relative move of biofuel-linked contracts vs refined products." />
        <StatTile label="Biofuel Basket" value={latestBiofuelBasket != null ? latestBiofuelBasket.toFixed(1) : "—"} tone="text-emerald-300" detail="Average of ethanol and soybean oil." />
        <StatTile label="Refined Basket" value={latestRefinedBasket != null ? latestRefinedBasket.toFixed(1) : "—"} tone="text-orange-300" detail="Average of RBOB and heating oil." />
        <StatTile label="Spread" value={rotationSpread != null ? fmt(rotationSpread, 1) : "—"} tone={leadership.tone} detail={spreadDelta != null ? `${fmt(spreadDelta, 1)} pts vs start of window` : "Indexed biofuel minus refined spread."} />
      </div>

      <div className={compact ? "h-36" : "h-44"}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Indexed biofuel and combustible contract history"
            data={chartData}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} />
            <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              formatter={(value: number, name: string) => [`${value.toFixed(1)}`, labelByCode[name] ?? name]}
            />
            {availableCodes.map((code) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={BIOFUEL_COLORS[code] ?? "#94a3b8"}
                dot={false}
                strokeWidth={code === strongestContract?.code ? 2.6 : 1.7}
                strokeOpacity={code === strongestContract?.code ? 1 : 0.78}
                strokeDasharray={code === "EH" || code === "ZL" ? undefined : "5 3"}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`grid md:grid-cols-3 ${compact ? "mt-2 gap-1.5" : "mt-3 gap-2"}`}>
        <SignalTile
          label="Takeaway"
          title={leadership.label}
          tone={leadership.tone}
          detail={rotationSpread == null ? "Relative biofuel leadership unavailable." : rotationSpread >= 6 ? "Biofuel-linked contracts are outrunning the petroleum refining chain." : rotationSpread <= -6 ? "Refined products are still leading the downstream complex." : "Biofuels and refined products are moving in a relatively balanced way."}
        />
        <SignalTile
          label="Momentum"
          title={spreadDelta == null ? "Drift unavailable" : spreadDelta >= 0 ? "Biofuel bid improving" : "Refined lead widening"}
          tone={spreadDelta == null ? "text-stealth-100" : spreadDelta >= 0 ? "text-emerald-300" : "text-orange-300"}
          detail={spreadDelta == null ? "Window-over-window spread change unavailable." : `${fmt(spreadDelta, 1)} points in biofuels minus refined products since the start of the window.`}
        />
        <SignalTile
          label="Strongest Contract"
          title={strongestContract ? (labelByCode[strongestContract.code] ?? strongestContract.code) : "—"}
          tone={strongestContract && (strongestContract.code === "EH" || strongestContract.code === "ZL") ? "text-emerald-300" : "text-orange-300"}
          detail={strongestContract ? `${strongestContract.value.toFixed(1)} indexed performance.` : "Leadership unavailable."}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generation mix
// ---------------------------------------------------------------------------

function GenerationMixPanel({ mix }: { mix: GenerationMix }) {
  const { latest_pct, summary, fallback_used, latest_year, source } = mix;
  const fuels = Object.entries(latest_pct).sort((a, b) => b[1] - a[1]);

  const trendData = useMemo(() => {
    const years = new Set<number>();
    for (const rows of Object.values(mix.series)) rows.forEach((r) => years.add(r.year));
    return Array.from(years).sort().map((year) => {
      const point: Record<string, number | string> = { year: String(year) };
      const total = Object.entries(mix.series).reduce((sum, [, rows]) => {
        const r = rows.find((x) => x.year === year);
        return sum + (r?.value ?? 0);
      }, 0);
      for (const [fuel, rows] of Object.entries(mix.series)) {
        const r = rows.find((x) => x.year === year);
        if (r && total > 0) point[fuel] = Math.round((r.value / total) * 1000) / 10;
      }
      return point;
    }).filter((d) => Object.keys(d).length > 1);
  }, [mix.series]);

  return (
    <div className="surface-card self-start p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <CardHeader kicker="US Electricity Generation Mix (Annual)" title={`Latest full year: ${latest_year}`} description="Authoritative EIA annual generation mix, grouped into fossil, renewable, and nuclear blocks." />
        <MetaPill tone="text-stealth-300">{source}</MetaPill>
      </div>
      {fallback_used && (
        <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          Live EIA feed unavailable — showing pinned 2023 fallback values.
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <StatTile label="Fossil" value={`${summary.fossil_pct.toFixed(1)}%`} tone="text-stealth-100" detail="Coal + gas + petroleum" />
        <StatTile label="Renewables" value={`${summary.renewables_pct.toFixed(1)}%`} tone="text-emerald-300" detail="Hydro + wind + solar + geothermal" />
        <StatTile label="Nuclear" value={`${summary.nuclear_pct.toFixed(1)}%`} tone="text-violet-300" detail="Baseload zero-carbon" />
        <StatTile label="Coverage" value={`${fuels.length} fuels`} tone="text-stealth-100" detail={`As of ${latest_year}`} />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Fossil", pct: summary.fossil_pct,     color: "bg-stealth-500",   text: "text-stealth-200" },
          { label: "Renew",  pct: summary.renewables_pct, color: "bg-emerald-600", text: "text-emerald-300" },
          { label: "Nuclear",pct: summary.nuclear_pct,    color: "bg-violet-600",  text: "text-violet-300" },
        ].map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-stealth-500">{row.label}</span>
              <span className={`font-mono ${row.text}`}>{row.pct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-stealth-800">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Fuel tiles */}
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {fuels.map(([fuel, pct]) => (
          <div key={fuel} className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-stealth-900/60 px-2.5 py-2">
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: FUEL_COLORS[fuel] ?? "#94a3b8" }} />
            <div>
              <div className="text-xs uppercase tracking-wide text-stealth-500">{FUEL_LABELS[fuel] ?? fuel}</div>
              <div className="font-mono text-xs text-stealth-100">{pct.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>

      {/* Stacked share trend */}
      {trendData.length > 1 && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              accessibilityLayer
              aria-label="United States electricity generation trend by fuel"
              data={trendData}
              margin={CHART_MARGIN}
            >
              <CartesianGrid {...commonGridProps} />
              <XAxis
                {...commonXAxisProps}
                dataKey="year"
                tickFormatter={(value: string | number) => String(value).slice(0, 4)}
              />
              <YAxis
                {...commonYAxisProps}
                tickFormatter={(value: number) => `${Number(value).toFixed(0)}%`}
                domain={[0, 100]}
              />
              <Tooltip
                {...tip}
                formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, FUEL_LABELS[name] ?? name]}
              />
              {Object.keys(GENERATION_MIX_KEYS).map((fuel) => (
                <Bar key={fuel} dataKey={fuel} stackId="a" fill={FUEL_COLORS[fuel] ?? "#94a3b8"} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex justify-end">
        {summary.notes ? (
          <SupportingContextTooltip text={summary.notes} align="end">
            <LabelCaps className="mb-0">Notes</LabelCaps>
          </SupportingContextTooltip>
        ) : null}
      </div>
    </div>
  );
}

const GENERATION_MIX_KEYS: Record<string, 1> = {
  coal: 1, nat_gas: 1, nuclear: 1, petroleum: 1, hydro: 1, wind: 1, solar: 1, geothermal: 1,
};

// ---------------------------------------------------------------------------
// Energy Methodology & Scoring Panel
// ---------------------------------------------------------------------------

function EnergyMethodologyPanel() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const ChevronIcon = ({ open }: { open: boolean }) => (
    <span className={`collapsible-icon ${open ? "collapsible-icon-open" : ""}`} aria-hidden="true">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  );

  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => {
    const open = expanded.has(id);
    return (
      <div className="border-b border-stealth-700 last:border-b-0">
        <button
          onClick={() => toggle(id)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-stealth-700/50"
          aria-expanded={open}
        >
          <span className="font-semibold text-stealth-200">{title}</span>
          <ChevronIcon open={open} />
        </button>
        <div className={`collapsible-panel ${open ? "collapsible-panel-open" : ""}`}>
          <div className="collapsible-panel-inner">
            <div className="px-4 pb-4 text-sm text-stealth-300 space-y-3">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gradient-to-br from-stealth-800 to-stealth-850 border border-stealth-700 rounded-lg">
      <button
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-4 p-4 md:p-6 text-left transition-colors hover:bg-stealth-700/40"
        aria-expanded={panelOpen}
      >
        <div>
          <h2 className="text-lg md:text-xl font-semibold text-stealth-100 mb-2">Methodology & Scoring</h2>
          <p className="text-xs text-stealth-400">
            How the energy composite is built, scored, and interpreted — groups, signals, and all data sources.
          </p>
        </div>
        <ChevronIcon open={panelOpen} />
      </button>

      <div className={`collapsible-panel ${panelOpen ? "collapsible-panel-open" : ""}`}>
        <div className="collapsible-panel-inner">
          <div className="divide-y divide-stealth-700 border-t border-stealth-700">
        <Section id="composite" title="What the Composite Measures">
          <p>
            The Energy Markets composite is a momentum-weighted score (0–100) built across all configured futures
            contracts. It answers one question: is energy-complex momentum broadly accelerating, decelerating, or
            neutral? A score above 60 is elevated (tightening or demand-driven), below 40 is soft, and near 50 is neutral.
          </p>
        </Section>

        <Section id="scoring" title="Momentum Score per Contract">
          <p>
            Each contract receives a 0–100 momentum score derived from a multi-horizon blend of percent changes:
            5-day (short-term), 20-day (medium-term), 60-day (trend), and 120-day (regime). Each horizon's
            percent change is normalized via a tanh function to produce a bounded signal, then the four signals
            are averaged into the final contract score.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
            {([["5-day", "Short-term noise"], ["20-day", "Medium-term swing"], ["60-day", "Trend"], ["120-day", "Regime"]] as const).map(([period, label]) => (
              <div key={period} className="bg-stealth-900/50 rounded p-2 text-xs">
                <div className="text-orange-300 font-semibold">{period}</div>
                <div className="text-stealth-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="groups" title="Group Weighting Structure">
          <p>
            Contracts are organized into four groups. Each group composite is the unweighted average of its member
            scores. The page composite is the weighted sum of group composites:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
            {[
              { label: "Crude", weight: "40%", color: "text-orange-300", contracts: "WTI (CL), Brent (BZ)" },
              { label: "Natural Gas", weight: "25%", color: "text-sky-300", contracts: "Henry Hub (NG)" },
              { label: "Refined", weight: "20%", color: "text-amber-300", contracts: "RBOB (RB), Heating Oil (HO)" },
              { label: "Biofuels", weight: "15%", color: "text-emerald-300", contracts: "Ethanol (EH), Soybean Oil (ZL)" },
            ].map((g) => (
              <div key={g.label} className="bg-stealth-900/50 rounded p-2 text-xs">
                <div className={`font-semibold ${g.color}`}>{g.label} — {g.weight}</div>
                <div className="text-stealth-400 mt-0.5">{g.contracts}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-stealth-400">
            Crude carries the largest weight because it sets the input cost for nearly all downstream energy products.
            Biofuels at 15% reflects their growing policy relevance as a blend component rather than a primary fuel source.
          </p>
        </Section>

        <Section id="macd" title="MACD Refining Spread">
          <p>
            The refining spread is the difference between the retail gasoline price (FRED weekly series) and WTI
            crude expressed per gallon (spot ÷ 42). This spread represents the combined refining, transport, and
            marketing margin passed through to consumers.
          </p>
          <p>
            A MACD-style momentum analysis is applied to the spread: EMA(12) minus EMA(26) gives the MACD line.
            An EMA(9) of MACD gives the signal line. The histogram is MACD minus signal.
          </p>
          <div className="bg-stealth-900/50 rounded p-2 text-xs text-stealth-400">
            Positive histogram → margin pressure is <span className="text-rose-300">accelerating</span>.
            Negative → margin pressure is <span className="text-emerald-300">easing</span>.
            The 26-week rolling mean of the raw spread serves as a drift-adjusted baseline reference.
          </div>
        </Section>

        <Section id="radar" title="Radar History — Onion-Skin Layers">
          <p>
            The contract momentum radar stacks up to 12 monthly snapshots behind the current reading.
            The oldest snapshot is palest; the most recent is most saturated. The time-path itself shows whether
            the full contract set is expanding or contracting.
          </p>
          <p>
            Radar axes: WTI, Brent, Natural Gas, RBOB, Heating Oil, and the Brent–WTI spread (normalized to 0–100).
            Green layers indicate a growth regime (current composite higher than the 12-month-ago snapshot); red
            layers indicate contraction.
          </p>
        </Section>

        <Section id="rotation" title="Capital Rotation Context">
          <p>
            XLE (energy equity) is compared against a transition basket — the equal-weight average of ICLN (clean
            energy), TAN (solar), FAN (wind), and PHO (water infrastructure). All series are indexed to 100 at the
            start of the selected window.
          </p>
          <p>
            The rotation spread (XLE minus transition basket) quantifies which side is attracting more relative
            capital. A spread above +8 favors traditional energy cash flows; below −8 favors transition-linked
            equities. The strongest individual theme (highest indexed level) is surfaced separately.
          </p>
        </Section>

        <Section id="biofuels" title="Biofuels Coverage">
          <p>
            Biofuels form a 15% weight group. Two contracts are included:
          </p>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="bg-stealth-900/50 rounded p-2 text-xs">
              <div className="text-emerald-300 font-semibold">Ethanol (EH=F)</div>
              <div className="text-stealth-400 mt-0.5">CME corn-derived ethanol futures. History is shorter (~64 trading days available at the 1Y window).</div>
            </div>
            <div className="bg-stealth-900/50 rounded p-2 text-xs">
              <div className="text-sky-300 font-semibold">Soybean Oil (ZL=F)</div>
              <div className="text-stealth-400 mt-0.5">CME soybean oil futures — a key biodiesel feedstock and renewable diesel input.</div>
            </div>
          </div>
          <p>
            The biofuels panel also shows RBOB and Heating Oil indexed to the same base, so you can read directly
            whether biofuel-linked contracts are leading or lagging the conventional refining chain.
          </p>
        </Section>

        <Section id="mix" title="Generation Mix">
          <p>
            Annual U.S. electricity generation shares are sourced from the EIA v2 API (electric-power-operational-data).
            Data is broken into coal, natural gas, nuclear, petroleum, hydro, wind, solar, and geothermal.
            Percentages are computed as each fuel's share of total annual generation for the latest complete year.
          </p>
          <p className="text-xs text-stealth-400">
            If the live EIA feed is unavailable, the panel falls back to pinned 2023 values and shows a notice.
            No FRED fallback is used for the generation mix.
          </p>
        </Section>

        <Section id="sources" title="Data Sources">
          <ul className="space-y-1.5 text-xs">
            <li><span className="text-stealth-200 font-medium">Yahoo Finance:</span> All futures (CL, BZ, NG, RB, HO, EH=F, ZL=F) and ETFs (XLE, ICLN, TAN, FAN, PHO)</li>
            <li><span className="text-stealth-200 font-medium">FRED (St. Louis Fed):</span> Retail gasoline, retail diesel, WTI spot, natural gas spot, crude oil inventories</li>
            <li><span className="text-stealth-200 font-medium">EIA v2 API:</span> Annual electric power generation by fuel type</li>
          </ul>
          <p className="text-xs text-stealth-400 mt-1">
            All scores are computed at request time from the most recent available data. Composite cache TTL is 20 minutes per timeframe window.
          </p>
        </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TIMEFRAME_OPTIONS: { key: Timeframe; label: string }[] = [
  { key: "90d",  label: "90D" },
  { key: "180d", label: "180D" },
  { key: "365d", label: "1Y" },
];

export default function EnergyIndex() {
  const [timeframe, setTimeframe] = useState<Timeframe>("365d");
  const days = TIMEFRAME_DAYS[timeframe];

  const overviewApi = useApi<EnergyOverview>(`/energy/overview?days=${days}`);
  const historyApi  = useApi<EnergyHistory>(`/energy/history?days=${days}`);
  const pricesApi   = useApi<EnergyPrices>(`/energy/prices?days=${days}`);
  const mixApi      = useApi<GenerationMix>(`/energy/mix`);

  const primaryDataPending = !overviewApi.data || !historyApi.data || !pricesApi.data;
  if ((overviewApi.loading || historyApi.loading || pricesApi.loading) && primaryDataPending) {
    return (
      <div className="page-shell-wide page-stack" aria-busy="true">
        <div>
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Energy Markets</h1>
          <p className="page-subtitle">Preparing the current futures, pricing, and supply evidence.</p>
        </div>
        <MarketLoading label="Loading energy market evidence…" />
      </div>
    );
  }

  const overview = overviewApi.data;
  const history  = historyApi.data;
  const prices   = pricesApi.data;
  const mix      = mixApi.data;

  if (!overview) {
    return (
      <div className="page-shell page-stack">
        <div>
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Energy Markets</h1>
        </div>
        <div className="surface-card border-red-800/70 p-5" role="alert">
          <h2 className="text-lg font-semibold text-red-200">Energy evidence is unavailable</h2>
          <p className="mt-2 text-sm text-red-300">{overviewApi.error}</p>
          <button
            type="button"
            onClick={overviewApi.refetch}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-red-950/50 px-4 text-sm font-semibold text-red-100 hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry energy evidence
          </button>
        </div>
      </div>
    );
  }

  const wti = overview.symbols.find((symbol) => symbol.code === "CL");
  const brent = overview.symbols.find((symbol) => symbol.code === "BZ");
  const spread = wti?.current_price != null && brent?.current_price != null
    ? brent.current_price - wti.current_price
    : null;
  const latestGas = latestValue(prices?.fred_prices.retail_gasoline);
  const latestWti = latestValue(prices?.fred_prices.crude_wti_spot);
  const latestPumpSpread = latestGas != null && latestWti != null ? latestGas - latestWti / 42 : null;
  const groupsByStrength = [...overview.groups].sort((left, right) => right.group_composite - left.group_composite);
  const strongestGroup = groupsByStrength[0];
  const spreadStress = spread != null && spread > 5;
  const pumpStress = latestPumpSpread != null && latestPumpSpread > 1.8;
  const hasRetailSpreadPanel = Boolean(prices?.fred_prices.crude_wti_spot?.length && prices?.fred_prices.retail_gasoline?.length);
  const hasCompositePanel = Boolean(history?.stability_history?.length);
  const hasRadarPanel = Boolean(overview.symbols.length);
  const primarySidePanelCount = Number(hasCompositePanel) + Number(hasRadarPanel);
  const hasSupplyPricePanel = Boolean(prices?.fred_prices.crude_wti_spot?.length && prices?.fred_prices.crude_inventory?.length);
  const partialIssues = [
    historyApi.error ? "Composite history" : null,
    pricesApi.error ? "Retail price and inventory evidence" : null,
    mixApi.error ? "Generation mix" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="page-shell-wide page-stack space-y-5 md:space-y-6">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Energy Markets</h1>
          <p className="page-subtitle">Futures composite, price relationships, biofuels, generation mix, and renewables transition</p>
        </div>
        <div className="control-strip mt-2">
          {TIMEFRAME_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={timeframe === key}
              onClick={() => setTimeframe(key)}
              className={`min-h-11 rounded-xl px-3 text-xs font-medium transition-all ${
                timeframe === key
                  ? "bg-orange-500/20 text-orange-300"
                  : "text-stealth-400 hover:text-stealth-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {partialIssues.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-4" role="status">
          <h2 className="text-sm font-semibold text-amber-200">Partial energy update</h2>
          <p className="mt-1 text-sm text-amber-100">
            The current headline is available, but {partialIssues.join(", ").toLowerCase()} {partialIssues.length === 1 ? "is" : "are"} missing.
          </p>
          <button
            type="button"
            onClick={() => {
              if (historyApi.error) historyApi.refetch();
              if (pricesApi.error) pricesApi.refetch();
              if (mixApi.error) mixApi.refetch();
            }}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-amber-600 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Retry missing evidence
          </button>
        </div>
      )}

      {/* ── Regime snapshot ───────────────────────────────────────── */}
      <section id="energy-now" aria-labelledby="energy-now-title" className="surface-card-strong scroll-mt-32 p-4 md:p-5">
        <h2 id="energy-now-title" className="sr-only">Current energy market read</h2>
        <div className="grid items-start gap-4 xl:grid-cols-[1.1fr_0.95fr]">
          <div className="space-y-4">
            <div>
            <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Energy Stability</p>
            <p className={`mt-2 text-4xl font-semibold ${biasTone(overview.stability_score)}`}>{overview.stability_score.toFixed(0)}</p>
            <div
              aria-label={`Energy stability ${overview.stability_score.toFixed(0)} out of 100`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overview.stability_score}
              className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700"
              role="progressbar"
            >
              <div className={`h-2 rounded-full ${overview.stability_score >= 60 ? "bg-emerald-500" : overview.stability_score <= 40 ? "bg-rose-500" : "bg-amber-500"}`} style={{ width: `${overview.stability_score}%` }} />
            </div>
            <p className="mt-2 text-xs text-stealth-400">Large absolute moves and high volatility pull this lower. As of {new Date(overview.as_of).toLocaleString()}</p>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-stealth-300">{overview.summary}</p>
            <div className="grid gap-2 md:grid-cols-3">
              <SignalTile
                label="Pressure Regime"
                title={overview.regime_label}
                tone={biasTone(overview.composite_score)}
                detail={strongestGroup ? `${strongestGroup.label} is carrying the directional pressure composite with a ${strongestGroup.group_composite.toFixed(0)} reading.` : "Directional price pressure is leading the page."}
              />
              <SignalTile
                label="Pressure Point"
                title={pumpStress ? "Retail margin still elevated" : "Pump pricing near trend"}
                tone={pumpStress ? "text-rose-300" : "text-emerald-300"}
                detail={latestPumpSpread != null ? `Retail gas sits ${money(latestPumpSpread, 3)} over crude-per-gallon.` : "Retail pass-through signal unavailable."}
              />
              <SignalTile
                label="Cross-Market"
                title={spreadStress ? "Brent premium signals tightness" : "Brent-WTI spread is contained"}
                tone={spreadStress ? "text-amber-300" : "text-stealth-100"}
                detail={spread != null ? `Global crude is trading ${money(spread)} over WTI.` : "Spread signal unavailable."}
              />
            </div>
          </div>

          <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <StatTile
              label="Pressure Score"
              value={<span className={`font-mono ${biasTone(overview.composite_score)}`}>{overview.composite_score.toFixed(0)}</span>}
              detail="Directional price-pressure composite"
            />
            <StatTile
              label="Regime"
              value={<span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${regimeBadgeStyle(overview.regime_label)}`}>{overview.regime_label}</span>}
              detail="Composite state"
            />
            <StatTile
              label="Availability"
              value={`${overview.availability.available_count}/${overview.availability.total_configured}`}
              detail="Configured contracts"
            />
            <StatTile
              label="Brent-WTI"
              value={<span className="font-mono">{money(spread)}</span>}
              tone={spread != null && spread > 5 ? "text-amber-300" : "text-stealth-100"}
              detail="Global vs US crude tightness"
            />
            <StatTile
              label="Pump Spread"
              value={<span className="font-mono">{money(latestPumpSpread, 3)}</span>}
              tone={latestPumpSpread != null && latestPumpSpread > 1.8 ? "text-rose-300" : "text-stealth-100"}
              detail="Retail gas minus WTI/gal"
            />
          </div>
        </div>
      </section>

      {(hasRetailSpreadPanel || primarySidePanelCount > 0) && (
        <section id="energy-evidence" aria-label="Energy market evidence" className={`scroll-mt-32 grid items-start gap-3 md:gap-4 ${hasRetailSpreadPanel && primarySidePanelCount > 0 ? "xl:grid-cols-[1.45fr_0.95fr]" : "grid-cols-1"}`}>
          {hasRetailSpreadPanel && prices ? (
            <RetailPricesChart prices={prices.fred_prices} surfaceClassName="primary-card" chartHeightClassName="h-72" />
          ) : null}
          {primarySidePanelCount > 0 ? (
            <div className="grid gap-3 md:gap-4">
              {hasCompositePanel && history ? <CompositeHistoryChart history={history.stability_history} surfaceClassName="primary-card" /> : null}
              {hasRadarPanel ? <FactorRadar symbols={overview.symbols} history={history?.radar_history} /> : null}
            </div>
          ) : null}
        </section>
      )}

      <section id="energy-structure" className="scroll-mt-32 space-y-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <SectionHeader
            kicker="Market Structure"
            title="Contract structure and leadership"
              tooltipText="Use this band to see which contracts are driving the composite and how that grouped leadership compresses across crude, natural gas, refined products, and biofuels."
          />
        </div>

        <FuturesTable symbols={overview.symbols} groups={overview.groups} surfaceClassName="surface-card-strong" />
      </section>

      {hasSupplyPricePanel && prices && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2.5">
            <SectionHeader
              kicker="Transmission"
              title="Supply confirmation"
              tooltipText="Inventory context stays separate only when it adds a non-duplicate supply read. If it stops confirming spot price, that is the signal the panel is meant to surface."
            />
          </div>

          <div className="grid items-start gap-3 md:gap-4 grid-cols-1">
            <SupplyPriceChart prices={prices.fred_prices} />
          </div>
        </div>
      )}

      <section id="energy-longer-horizon" className="scroll-mt-32 space-y-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <SectionHeader
            kicker="Longer Horizon"
            title="Capital rotation, biofuels, and power mix context"
            tooltipText="These slower-moving panels frame transition leadership, biofuel-chain leadership, and end-demand structure instead of the nearer-term pressure read shown at the top of the page."
          />
        </div>

        <div className="grid items-stretch gap-3 md:gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="grid gap-2 md:gap-3">
            {history ? (
              <AltEnergyChart
                data={history.alt_comparison}
                altSymbols={history.alt_symbols}
                compact
              />
            ) : null}
            {history ? <BiofuelsPanel data={history.biofuel_comparison} symbols={overview.symbols} compact /> : null}
          </div>
          <div>
            {mix && <GenerationMixPanel mix={mix} />}
          </div>
        </div>
      </section>

      {overview.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          {overview.warnings.join(" · ")}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <SupportingContextTooltip
          text={`Futures and biofuel-linked contracts via Yahoo Finance. Retail prices and inventory via FRED/EIA. Generation mix via ${mix?.source ?? "EIA annual data"}${mix?.latest_year ? ` (${mix.latest_year})` : ""}. ETFs via Yahoo Finance. As of ${overview.as_of.slice(0, 16).replace("T", " ")} UTC.`}
          align="end"
        >
          <LabelCaps className="mb-0">Sources</LabelCaps>
        </SupportingContextTooltip>
      </div>

      <div id="energy-methodology" className="scroll-mt-32">
        <EnergyMethodologyPanel />
      </div>

    </div>
  );
}
