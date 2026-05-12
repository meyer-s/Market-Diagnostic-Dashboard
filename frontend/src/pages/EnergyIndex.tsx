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
import { useApi } from "../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
  formatTooltipValue,
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
  alt_comparison: Array<Record<string, number | string>>;
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

// ---------------------------------------------------------------------------
// Shared primitives matching app design system
// ---------------------------------------------------------------------------

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <p className="page-kicker mb-3">{children}</p>
);

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
    <div className="surface-card-muted px-3 py-2.5">
      <p className="text-xs uppercase tracking-[0.14em] text-stealth-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-stealth-400">{detail}</p> : null}
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />;
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

function FuturesTable({ symbols }: { symbols: SymbolRow[] }) {
  return (
    <div className="surface-card p-4">
      <Kicker>Energy Futures</Kicker>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stealth-700/50">
              <th className="pb-2 text-left text-[11px] font-medium text-stealth-400">Contract</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">Price</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">5d</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">20d</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">60d</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">120d</th>
              <th className="pb-2 text-right text-[11px] font-medium text-stealth-400">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stealth-800/40">
            {symbols.map((sym) => (
              <tr key={sym.code} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-2.5">
                  <span className="font-semibold text-stealth-100">{sym.code}</span>
                  <span className="ml-2 text-[11px] text-stealth-500">{sym.name}</span>
                </td>
                <td className="py-2.5 text-right font-mono text-stealth-200">
                  {sym.current_price != null ? sym.current_price.toFixed(3) : "—"}
                  <span className="ml-1 text-[10px] text-stealth-600">{sym.unit}</span>
                </td>
                {(["5d", "20d", "60d", "120d"] as const).map((k) => (
                  <td key={k} className={`py-2.5 text-right font-mono text-xs ${changeTone(sym.changes[k])}`}>
                    {fmt(sym.changes[k])}%
                  </td>
                ))}
                <td className="py-2.5 text-right">{scoreBar(sym.momentum_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group breakdown cards
// ---------------------------------------------------------------------------

function GroupCards({ groups }: { groups: GroupRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
      {groups.map((g) => (
        <div key={g.group} className="surface-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stealth-400">{g.label}</span>
            <span className="text-[10px] text-stealth-600">{g.effective_weight.toFixed(0)}% wt</span>
          </div>
          <div className={`text-3xl font-semibold ${biasTone(g.group_composite)}`}>{g.group_composite.toFixed(0)}</div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
            {(["5d", "20d", "60d", "120d"] as const).map((k) => (
              <div key={k} className="text-center">
                <div className="text-stealth-600 uppercase">{k}</div>
                <div className={`font-mono ${changeTone(g.changes[k])}`}>{fmt(g.changes[k])}%</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-stealth-800/60 pt-2">
            {g.components.map((c) => (
              <div key={c.code} className="flex items-center justify-between text-[11px]">
                <span className="text-stealth-400">{c.code}</span>
                <span className={`font-mono ${changeTone(c.changes["20d"])}`}>{fmt(c.changes["20d"])}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composite history chart
// ---------------------------------------------------------------------------

function CompositeHistoryChart({ history }: { history: HistoryPoint[] }) {
  if (!history.length) return null;
  const decimated = history.filter((_, i) => i % Math.max(1, Math.floor(history.length / 200)) === 0);
  return (
    <div className="surface-card p-4">
      <Kicker>Energy Composite Score</Kicker>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(5, 10)} />
            <YAxis {...commonYAxisProps} domain={[20, 80]} />
            <Tooltip {...tip} formatter={(v: number) => [v.toFixed(1), "Score"]} />
            <ReferenceLine y={50} stroke="#334155" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="value" stroke="#f97316" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1.5 flex gap-4 text-[10px] text-stealth-600">
        <span>50 = neutral</span>
        <span className="text-emerald-500/70">&gt;60 elevated</span>
        <span className="text-rose-500/70">&lt;40 soft</span>
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
};

function SpreadTooltip({
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
  const elevated = (byKey.spread ?? 0) > (byKey.spread_signal ?? 0);
  return (
    <div className="min-w-[200px] rounded-xl border border-stealth-700/70 bg-stealth-950/95 p-3 text-xs shadow-[0_10px_40px_rgba(2,6,23,0.75)] backdrop-blur-2xl">
      <p className="mb-2 font-semibold text-white">{label}</p>
      {byKey.wti_gal != null && (
        <p className="text-orange-300">WTI/gal: <span className="font-mono">${byKey.wti_gal.toFixed(3)}</span></p>
      )}
      {byKey.retail != null && (
        <p className="text-amber-300">Regular gas: <span className="font-mono">${byKey.retail.toFixed(3)}</span></p>
      )}
      {byKey.diesel != null && (
        <p className="text-sky-300">Diesel: <span className="font-mono">${byKey.diesel.toFixed(3)}</span></p>
      )}
      {byKey.spread != null && (
        <p className={`mt-2 border-t border-white/[0.06] pt-2 ${elevated ? "text-rose-300" : "text-emerald-300"}`}>
          Spread: <span className="font-mono">${byKey.spread.toFixed(3)}</span>
          <span className="ml-1 text-stealth-500">{elevated ? "above trend" : "below trend"}</span>
        </p>
      )}
      {byKey.spread_signal != null && (
        <p className="text-[11px] text-stealth-500">6-mo avg: ${byKey.spread_signal.toFixed(3)}</p>
      )}
    </div>
  );
}

function RetailPricesChart({ prices }: { prices: EnergyPrices["fred_prices"] }) {
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
      return { date: g.date, wti_gal, retail, diesel, spread, spread_signal: 0 };
    }).filter(Boolean) as SpreadPoint[];

    if (rows.length < 10) return [];

    // Rolling 26-week (~6 month) mean of spread → signal line
    const W = 26;
    for (let i = 0; i < rows.length; i++) {
      const slice = rows.slice(Math.max(0, i - W + 1), i + 1);
      rows[i].spread_signal = slice.reduce((s, r) => s + r.spread, 0) / slice.length;
    }

    return rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 150)) === 0);
  }, [spotData, gasData, dieselData]);

  if (!merged.length) return null;

  const latest        = merged[merged.length - 1];
  const elevated      = latest.spread > latest.spread_signal;
  const overallMean   = merged.reduce((s, r) => s + r.spread, 0) / merged.length;

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>Futures → Pump: Refining Spread</Kicker>
          <h2 className="text-base font-semibold text-stealth-100">Pump pricing vs futures cost</h2>
          <p className="mt-1 text-xs text-stealth-400">Bars show how far retail pricing sits above or below its 6-month margin baseline.</p>
        </div>
        <div className="grid min-w-[260px] grid-cols-3 gap-2 text-xs">
          <StatTile label="WTI / gal" value={<span className="font-mono">${latest.wti_gal.toFixed(3)}</span>} tone="text-orange-300" />
          <StatTile label="Regular Gas" value={<span className="font-mono">${latest.retail.toFixed(3)}</span>} tone="text-amber-300" />
          <StatTile label="Spread" value={<span className="font-mono">${latest.spread.toFixed(3)}</span>} tone={elevated ? "text-rose-300" : "text-emerald-300"} />
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            {/* Left axis — $/gal prices */}
            <YAxis yAxisId="price" {...commonYAxisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            {/* Right axis — spread */}
            <YAxis yAxisId="spread" orientation="right" {...commonYAxisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <ReferenceLine yAxisId="spread" y={overallMean} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip content={<SpreadTooltip />} />
            {/* Spread histogram bars — colored vs rolling signal */}
            <Bar yAxisId="spread" dataKey="spread" name="spread" barSize={5} isAnimationActive={false}>
              {merged.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.spread > entry.spread_signal ? "rgba(251,113,133,0.40)" : "rgba(52,211,153,0.40)"}
                  stroke={entry.spread > entry.spread_signal ? "rgba(251,113,133,0.85)" : "rgba(52,211,153,0.85)"}
                />
              ))}
            </Bar>
            {/* Rolling signal line */}
            <Line yAxisId="spread" type="monotone" dataKey="spread_signal" stroke="#475569" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} name="spread_signal" />
            {/* Price lines */}
            <Line yAxisId="price" type="monotone" dataKey="wti_gal" stroke="#f97316" strokeWidth={2.5} dot={false} isAnimationActive={false} name="wti_gal" />
            <Line yAxisId="price" type="monotone" dataKey="retail"  stroke="#fbbf24" strokeWidth={2}   dot={false} isAnimationActive={false} name="retail" />
            {dieselData.length > 0 && (
              <Line yAxisId="price" type="monotone" dataKey="diesel" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} name="diesel" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-stealth-400">
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#f97316" />WTI / gal</span>
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#fbbf24" />Regular Gas</span>
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#38bdf8" />Diesel</span>
        <span className="text-stealth-500">Red bars = retail rich to crude. Green bars = crude leading retail.</span>
      </div>
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
    <div className="surface-card p-4">
      <div className="mb-3">
        <Kicker>Supply ↔ Price Relationship</Kicker>
        <h2 className="text-base font-semibold text-stealth-100">Inventories vs WTI</h2>
        <p className="mt-1 text-xs text-stealth-400">Normalized 0–100 with inventories inverted so tightening supply climbs with price stress.</p>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={normalized} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={[0, 100]} tickFormatter={(v) => `${v.toFixed(0)}`} />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string, props: { payload: { price: number; inventory: number } }) => {
                if (name === "price_norm") return [`$${props.payload.price.toFixed(2)}/bbl`, "WTI Spot"];
                return [`${props.payload.inventory.toFixed(0)} M bbl`, "Crude Stocks"];
              }}
            />
            <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="price_norm" stroke="#f97316" dot={false} strokeWidth={2} name="price_norm" />
            <Line type="monotone" dataKey="inv_inv"    stroke="#475569" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="inv_inv" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-stealth-400">
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#f97316" />WTI Spot</span>
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#475569" />Inventory (inverted)</span>
        <span className="text-stealth-500">Divergence = supply/price stress building.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crude-to-pump pass-through (both indexed to 100)
// ---------------------------------------------------------------------------

function PriceCascadeChart({ prices }: { prices: EnergyPrices["fred_prices"] }) {
  const spotData = prices?.crude_wti_spot ?? [];
  const gasData  = prices?.retail_gasoline ?? [];

  const indexed = useMemo(() => {
    if (!spotData.length || !gasData.length) return [];
    const spotMap: Record<string, number> = {};
    spotData.forEach((p) => { spotMap[p.date] = p.value; });

    const merged = gasData.map((g) => {
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

    if (merged.length < 5) return [];
    const base = merged[0];
    return merged
      .filter((_, i) => i % Math.max(1, Math.floor(merged.length / 120)) === 0)
      .map((d) => ({
        date: d.date,
        crude: (d.spot    / base.spot)   * 100,
        pump:  (d.retail  / base.retail) * 100,
        crude_v: d.spot,
        pump_v:  d.retail,
      }));
  }, [spotData, gasData]);

  if (!indexed.length) return null;

  return (
    <div className="surface-card p-4">
      <div className="mb-3">
        <Kicker>Crude → Pump Pass-Through (indexed to 100)</Kicker>
        <h2 className="text-base font-semibold text-stealth-100">Pass-through lag</h2>
        <p className="mt-1 text-xs text-stealth-400">Indexed to the start of the window so you can see crude move first and retail catch up later.</p>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={indexed} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(v) => `${v.toFixed(0)}`} />
            <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string, props: { payload: { crude_v: number; pump_v: number } }) => {
                if (name === "crude") return [`$${props.payload.crude_v.toFixed(2)}/bbl`, "WTI Crude"];
                return [`$${props.payload.pump_v.toFixed(3)}/gal`, "Retail Gas"];
              }}
            />
            <Line type="monotone" dataKey="crude" stroke="#f97316" dot={false} strokeWidth={2} name="crude" />
            <Line type="monotone" dataKey="pump"  stroke="#fbbf24" dot={false} strokeWidth={2} strokeDasharray="4 2" name="pump" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-stealth-400">
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#f97316" />WTI Crude</span>
        <span className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1"><LegendDot color="#fbbf24" />Retail Gasoline</span>
        <span className="text-stealth-500">Wider gap = refining/tax wedge.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor radar (live momentum snapshot across all contracts)
// ---------------------------------------------------------------------------

function FactorRadar({ symbols }: { symbols: SymbolRow[] }) {
  const byCode = Object.fromEntries(symbols.map((s) => [s.code, s]));
  const wti   = byCode["CL"];
  const brent = byCode["BZ"];
  const ng    = byCode["NG"];
  const ho    = byCode["HO"];
  const rb    = byCode["RB"];

  const spreadRaw   = (brent?.current_price ?? 0) - (wti?.current_price ?? 0);
  const spreadNorm  = Math.min(100, Math.max(0, (spreadRaw / 10) * 100));

  const data = [
    { factor: "WTI",   value: wti?.momentum_score  ?? 50 },
    { factor: "Brent", value: brent?.momentum_score ?? 50 },
    { factor: "Nat Gas",value: ng?.momentum_score   ?? 50 },
    { factor: "RBOB",  value: rb?.momentum_score    ?? 50 },
    { factor: "HtgOil",value: ho?.momentum_score    ?? 50 },
    { factor: "Spread",value: spreadNorm },
  ];

  return (
    <div className="surface-card p-4">
      <div className="mb-1">
        <Kicker>Contract Momentum Radar</Kicker>
        <h2 className="text-base font-semibold text-stealth-100">Cross-contract momentum</h2>
        <p className="mt-1 text-xs text-stealth-400">One shape shows where momentum is concentrated across the energy complex.</p>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 8, right: 28, bottom: 8, left: 28 }}>
            <PolarGrid stroke="#1e293b" />
            <PolarAngleAxis dataKey="factor" tick={{ fill: "#64748b", fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="#f97316" fill="#f97316" fillOpacity={0.18} strokeWidth={2} />
            <Tooltip
              {...tip}
              formatter={(v: number, _name: string, props: { payload: { factor: string } }) => [
                `${v.toFixed(0)} / 100`,
                props.payload.factor,
              ]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-stealth-500">
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
}: {
  data: Array<Record<string, number | string>>;
  altSymbols: Array<{ code: string; name: string; group: string }>;
}) {
  if (!data.length) return null;

  const decimated = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 200)) === 0);
  const codes = altSymbols.map((s) => s.code).filter((c) => decimated.some((d) => c in d));

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>Traditional vs Alternative Energy — Indexed to 100</Kicker>
          <h2 className="text-base font-semibold text-stealth-100">Capital rotation context</h2>
          <p className="mt-1 text-xs text-stealth-400">Tracks whether capital is favoring traditional energy cash flows or transition-linked equities.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {altSymbols.map((s) => (
            <div key={s.code} className="surface-card-muted inline-flex items-center gap-2 px-2.5 py-1 text-xs text-stealth-300">
              <LegendDot color={ALT_COLORS[s.code] ?? "#94a3b8"} />
              <span>{s.code}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => (d as string).slice(0, 7)} />
            <YAxis {...commonYAxisProps} />
            <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip {...tip} formatter={(v: number, name: string) => [`${v.toFixed(1)}`, name]} />
            {codes.map((code) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={ALT_COLORS[code] ?? "#94a3b8"}
                dot={false}
                strokeWidth={code === "XLE" ? 2.5 : 1.5}
                strokeDasharray={code === "XLE" || code === "ICLN" ? undefined : "4 2"}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-stealth-500">XLE = traditional energy cash flow proxy · ICLN/TAN/FAN/PHO = transition and grid-adjacent exposures</p>
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
    <div className="surface-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>US Electricity Generation Mix (Annual)</Kicker>
          <h2 className="text-base font-semibold text-stealth-100">Latest full year: {latest_year}</h2>
          <p className="mt-1 text-xs text-stealth-400">Authoritative EIA annual generation mix, grouped into fossil, renewable, and nuclear blocks.</p>
        </div>
        <div className="surface-card-muted px-3 py-2 text-xs text-stealth-400">
          <p className="uppercase tracking-[0.14em] text-stealth-500">Source</p>
          <p className="mt-1 text-sm font-medium text-stealth-200">{source}</p>
        </div>
      </div>
      {fallback_used && (
        <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
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
          { label: "Fossil", pct: summary.fossil_pct,     color: "bg-slate-500",   text: "text-stealth-200" },
          { label: "Renew",  pct: summary.renewables_pct, color: "bg-emerald-600", text: "text-emerald-300" },
          { label: "Nuclear",pct: summary.nuclear_pct,    color: "bg-violet-600",  text: "text-violet-300" },
        ].map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex justify-between text-[11px]">
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
              <div className="text-[9px] uppercase tracking-wide text-stealth-500">{FUEL_LABELS[fuel] ?? fuel}</div>
              <div className="font-mono text-xs text-stealth-100">{pct.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>

      {/* Stacked share trend */}
      {trendData.length > 1 && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData} margin={CHART_MARGIN}>
              <CartesianGrid {...commonGridProps} />
              <XAxis {...commonXAxisProps} dataKey="year" />
              <YAxis {...commonYAxisProps} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
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
      <p className="mt-3 text-xs text-stealth-500">{summary.notes}</p>
    </div>
  );
}

const GENERATION_MIX_KEYS: Record<string, 1> = {
  coal: 1, nat_gas: 1, nuclear: 1, petroleum: 1, hydro: 1, wind: 1, solar: 1, geothermal: 1,
};

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

  if ((overviewApi.loading || historyApi.loading) && !overviewApi.data) {
    return <MarketLoading message="Loading energy market data…" />;
  }

  const overview = overviewApi.data;
  const history  = historyApi.data;
  const prices   = pricesApi.data;
  const mix      = mixApi.data;
  const wti = overview?.symbols.find((symbol) => symbol.code === "CL");
  const brent = overview?.symbols.find((symbol) => symbol.code === "BZ");
  const spread = wti?.current_price != null && brent?.current_price != null
    ? brent.current_price - wti.current_price
    : null;
  const latestGas = latestValue(prices?.fred_prices.retail_gasoline);
  const latestWti = latestValue(prices?.fred_prices.crude_wti_spot);
  const latestPumpSpread = latestGas != null && latestWti != null ? latestGas - latestWti / 42 : null;

  if (!overview) {
    return (
      <div className="page-shell">
        <p className="text-stealth-400">Energy data unavailable. {overviewApi.error}</p>
      </div>
    );
  }

  return (
    <div className="page-shell-wide page-stack">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Energy Markets</h1>
          <p className="page-subtitle">Futures composite, price relationships, generation mix, and renewables transition</p>
        </div>
        <div className="control-strip mt-2">
          {TIMEFRAME_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeframe(key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
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

      {/* ── Regime snapshot ───────────────────────────────────────── */}
      <div className="surface-card-strong p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Energy Snapshot</p>
            <p className={`mt-2 text-4xl font-semibold ${biasTone(overview.composite_score)}`}>{overview.composite_score.toFixed(0)}</p>
            <div className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700">
              <div className={`h-2 rounded-full ${overview.composite_score >= 60 ? "bg-emerald-500" : overview.composite_score <= 40 ? "bg-rose-500" : "bg-amber-500"}`} style={{ width: `${overview.composite_score}%` }} />
            </div>
            <p className="mt-2 text-xs text-stealth-400">As of {new Date(overview.as_of).toLocaleString()}</p>
          </div>

          <div className="grid min-w-[280px] flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        <p className="mt-4 max-w-4xl text-sm leading-6 text-stealth-300">{overview.summary}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <GroupCards groups={overview.groups} />
        <FuturesTable symbols={overview.symbols} />
      </div>

      {/* ── Composite history + Radar ──────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {history && <CompositeHistoryChart history={history.composite_history} />}
        <FactorRadar symbols={overview.symbols} />
      </div>

      {/* ── Supply/Price relationship + pass-through ──────────────── */}
      {prices && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SupplyPriceChart prices={prices.fred_prices} />
          <PriceCascadeChart prices={prices.fred_prices} />
        </div>
      )}

      {prices && <RetailPricesChart prices={prices.fred_prices} />}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        {history && (
          <AltEnergyChart
            data={history.alt_comparison}
            altSymbols={history.alt_symbols}
          />
        )}
        {mix && <GenerationMixPanel mix={mix} />}
      </div>

      {overview.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          {overview.warnings.join(" · ")}
        </div>
      )}

      <p className="text-[10px] text-stealth-600">
        Futures via Yahoo Finance · Retail prices &amp; inventory via FRED/EIA ·
        Generation mix via {mix?.source ?? "EIA annual data"}{mix?.latest_year ? ` (${mix.latest_year})` : ""} · ETFs via Yahoo Finance ·
        As of {overview.as_of.slice(0, 16).replace("T", " ")} UTC
      </p>

    </div>
  );
}
