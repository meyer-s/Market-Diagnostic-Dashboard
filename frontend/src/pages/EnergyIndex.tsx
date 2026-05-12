import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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
// Section components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
      {children}
    </h2>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-stealth-700/60 bg-stealth-900/70 p-4 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Futures price table
// ---------------------------------------------------------------------------

function FuturesTable({ symbols }: { symbols: SymbolRow[] }) {
  return (
    <Card>
      <SectionTitle>Energy Futures</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stealth-700/60">
              <th className="pb-2 text-left text-xs font-medium text-stealth-400">Contract</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">Price</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">5d %</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">20d %</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">60d %</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">120d %</th>
              <th className="pb-2 text-right text-xs font-medium text-stealth-400">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stealth-800/60">
            {symbols.map((sym) => (
              <tr key={sym.code} className="hover:bg-stealth-800/30 transition-colors">
                <td className="py-2.5">
                  <div className="font-semibold text-stealth-100">{sym.code}</div>
                  <div className="text-[11px] text-stealth-400">{sym.name}</div>
                </td>
                <td className="py-2.5 text-right font-mono text-stealth-200">
                  {sym.current_price != null ? sym.current_price.toFixed(3) : "—"}
                  <span className="ml-1 text-[10px] text-stealth-500">{sym.unit}</span>
                </td>
                {(["5d", "20d", "60d", "120d"] as const).map((k) => (
                  <td key={k} className={`py-2.5 text-right font-mono ${changeTone(sym.changes[k])}`}>
                    {fmt(sym.changes[k])}%
                  </td>
                ))}
                <td className="py-2.5 text-right">{scoreBar(sym.momentum_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Group breakdown cards
// ---------------------------------------------------------------------------

function GroupCards({ groups }: { groups: GroupRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {groups.map((g) => (
        <Card key={g.group}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-stealth-400">
              {g.label}
            </span>
            <span className="text-[10px] text-stealth-500">{g.effective_weight.toFixed(0)}% wt</span>
          </div>
          <div className={`text-2xl font-bold ${biasTone(g.group_composite)}`}>
            {g.group_composite.toFixed(0)}
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px]">
            {(["5d", "20d", "60d", "120d"] as const).map((k) => (
              <div key={k} className="text-center">
                <div className="text-stealth-500 uppercase">{k}</div>
                <div className={`font-mono ${changeTone(g.changes[k])}`}>
                  {fmt(g.changes[k])}%
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {g.components.map((c) => (
              <div key={c.code} className="flex items-center justify-between text-[11px]">
                <span className="text-stealth-300">{c.code}</span>
                <span className={`font-mono ${changeTone(c.changes["20d"])}`}>
                  {fmt(c.changes["20d"])}%
                </span>
              </div>
            ))}
          </div>
        </Card>
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
    <Card>
      <SectionTitle>Energy Composite Score — Daily</SectionTitle>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis
              {...commonXAxisProps}
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5, 10)}
            />
            <YAxis {...commonYAxisProps} domain={[20, 80]} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [v.toFixed(1), "Score"]}
            />
            <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#f97316"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-4 text-[10px] text-stealth-500">
        <span>50 = neutral baseline</span>
        <span className="text-emerald-400/70">Above 60 = elevated price pressure</span>
        <span className="text-rose-400/70">Below 40 = demand/supply softness</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Retail gas / diesel prices (FRED)
// ---------------------------------------------------------------------------

function RetailPricesChart({
  prices,
}: {
  prices: EnergyPrices["fred_prices"];
}) {
  const gas = prices?.retail_gasoline ?? [];
  const diesel = prices?.retail_diesel ?? [];

  const combined = useMemo(() => {
    const map: Record<string, { date: string; gas?: number; diesel?: number }> = {};
    gas.forEach((p) => { map[p.date] = { date: p.date, gas: p.value }; });
    diesel.forEach((p) => {
      if (map[p.date]) map[p.date].diesel = p.value;
      else map[p.date] = { date: p.date, diesel: p.value };
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [gas, diesel]);

  if (!combined.length) {
    return (
      <Card>
        <SectionTitle>Retail Fuel Prices (FRED)</SectionTitle>
        <p className="text-sm text-stealth-500">Retail price data unavailable — FRED API key may not be configured.</p>
      </Card>
    );
  }

  const latest = combined[combined.length - 1];

  return (
    <Card>
      <SectionTitle>Retail Fuel Prices — Weekly (EIA via FRED)</SectionTitle>
      <div className="mb-2 flex flex-wrap gap-4 text-sm">
        {latest.gas && (
          <div>
            <span className="text-stealth-400 text-xs">Regular Gasoline </span>
            <span className="font-mono text-amber-300">${latest.gas.toFixed(3)}/gal</span>
          </div>
        )}
        {latest.diesel && (
          <div>
            <span className="text-stealth-400 text-xs">Diesel </span>
            <span className="font-mono text-sky-300">${latest.diesel.toFixed(3)}/gal</span>
          </div>
        )}
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={combined} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis
              {...commonXAxisProps}
              dataKey="date"
              tickFormatter={(d: string) => d.slice(0, 7)}
            />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(v) => `$${v.toFixed(2)}`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [`$${v.toFixed(3)}/gal`, name === "gas" ? "Regular Gas" : "Diesel"]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "gas" ? "Regular Gas" : "Diesel"} />
            <Line type="monotone" dataKey="gas" stroke="#f59e0b" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="diesel" stroke="#38bdf8" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Crude inventory chart
// ---------------------------------------------------------------------------

function InventoryChart({ data }: { data: PricePoint[] }) {
  if (!data.length) return null;
  const decimated = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);
  const last = data[data.length - 1];
  return (
    <Card>
      <SectionTitle>US Crude Oil Inventories (excl. SPR) — Weekly (EIA)</SectionTitle>
      <div className="mb-2 text-sm">
        <span className="text-stealth-400 text-xs">Latest </span>
        <span className="font-mono text-stealth-200">{last.value.toFixed(0)} M bbl</span>
        <span className="ml-2 text-[10px] text-stealth-500">{last.date}</span>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(v) => `${(v / 1000).toFixed(0)}B`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`${v.toFixed(0)} M bbl`, "Crude Stocks"]}
            />
            <Line type="monotone" dataKey="value" stroke="#64748b" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-stealth-500">
        Inventory builds are bearish for crude prices; draws support prices. Chart shows million barrels.
      </p>
    </Card>
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
  if (!data.length) {
    return (
      <Card>
        <SectionTitle>Alternatives vs Traditional Energy (Indexed to 100)</SectionTitle>
        <p className="text-sm text-stealth-500">Alt energy data unavailable.</p>
      </Card>
    );
  }

  const decimated = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 200)) === 0);
  const codes = altSymbols.map((s) => s.code).filter((c) => decimated.some((d) => c in d));

  return (
    <Card>
      <SectionTitle>Alternatives vs Traditional Energy — Indexed to 100 (Start of Period)</SectionTitle>
      <div className="mb-2 flex flex-wrap gap-3">
        {altSymbols.map((s) => (
          <div key={s.code} className="flex items-center gap-1.5 text-[11px]">
            <div
              className="h-2 w-4 rounded-sm"
              style={{ background: ALT_COLORS[s.code] ?? "#94a3b8" }}
            />
            <span className="text-stealth-300">{s.code}</span>
            <span className="text-stealth-500">{s.name.split(" ").slice(0, 2).join(" ")}</span>
          </div>
        ))}
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => (d as string).slice(0, 7)} />
            <YAxis {...commonYAxisProps} tickFormatter={(v) => `${v.toFixed(0)}`} />
            <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [`${v.toFixed(1)}`, name]}
            />
            {codes.map((code) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={ALT_COLORS[code] ?? "#94a3b8"}
                dot={false}
                strokeWidth={code === "XLE" ? 2.5 : 1.5}
                strokeDasharray={code === "XLE" ? undefined : code === "ICLN" ? undefined : "4 2"}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-stealth-500">
        XLE = traditional energy sector. ICLN = global clean energy. TAN = solar. FAN = wind.
        PHO = water infrastructure (hydro proxy). All indexed to 100 at start of selected period.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Generation mix
// ---------------------------------------------------------------------------

function GenerationMixPanel({ mix }: { mix: GenerationMix }) {
  const { latest_pct, summary, fallback_used } = mix;

  const fuels = Object.entries(latest_pct)
    .sort((a, b) => b[1] - a[1]);

  const trendData = useMemo(() => {
    const years = new Set<number>();
    for (const rows of Object.values(mix.series)) {
      rows.forEach((r) => years.add(r.year));
    }
    return Array.from(years)
      .sort()
      .map((year) => {
        const point: Record<string, number | string> = { year: String(year) };
        const total = Object.entries(mix.series).reduce((sum, [, rows]) => {
          const r = rows.find((x) => x.year === year);
          return sum + (r?.value ?? 0);
        }, 0);
        for (const [fuel, rows] of Object.entries(mix.series)) {
          const r = rows.find((x) => x.year === year);
          if (r && total > 0) {
            point[fuel] = Math.round((r.value / total) * 100 * 10) / 10;
          }
        }
        return point;
      })
      .filter((d) => Object.keys(d).length > 1);
  }, [mix.series]);

  return (
    <Card>
      <SectionTitle>US Electricity Generation Mix (Annual)</SectionTitle>
      {fallback_used && (
        <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          Using 2023 EIA Annual Energy Review estimates — live data requires FRED API key.
        </div>
      )}

      {/* Summary bar */}
      <div className="mb-4 space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-stealth-400">Fossil Fuels (Coal + Gas + Petroleum)</span>
            <span className="font-mono text-stealth-200">{summary.fossil_pct.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-stealth-800">
            <div className="h-full rounded-full bg-slate-500" style={{ width: `${summary.fossil_pct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-stealth-400">Renewables (Hydro + Wind + Solar + Geo)</span>
            <span className="font-mono text-emerald-400">{summary.renewables_pct.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-stealth-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.renewables_pct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-stealth-400">Nuclear</span>
            <span className="font-mono text-violet-400">{summary.nuclear_pct.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-stealth-800">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${summary.nuclear_pct}%` }} />
          </div>
        </div>
      </div>

      {/* Fuel breakdown */}
      <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {fuels.map(([fuel, pct]) => (
          <div
            key={fuel}
            className="flex items-center gap-2 rounded-lg border border-stealth-700/40 bg-stealth-800/50 px-2.5 py-2"
          >
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ background: FUEL_COLORS[fuel] ?? "#94a3b8" }}
            />
            <div>
              <div className="text-[10px] text-stealth-400">{FUEL_LABELS[fuel] ?? fuel}</div>
              <div className="font-mono text-xs text-stealth-100">{pct.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      {trendData.length > 1 && (
        <>
          <div className="mb-2 text-[11px] text-stealth-500 uppercase tracking-wider">
            Generation Share Trend (%)
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={CHART_MARGIN}>
                <CartesianGrid {...commonGridProps} />
                <XAxis {...commonXAxisProps} dataKey="year" />
                <YAxis {...commonYAxisProps} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, FUEL_LABELS[name] ?? name]}
                />
                {Object.keys(GENERATION_MIX_KEYS).map((fuel) => (
                  <Bar key={fuel} dataKey={fuel} stackId="a" fill={FUEL_COLORS[fuel] ?? "#94a3b8"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Gravity / storage note */}
      <div className="mt-3 rounded-lg border border-stealth-700/40 bg-stealth-800/40 px-3 py-2 text-[11px] text-stealth-400">
        <span className="font-semibold text-stealth-300">Gravity & Storage Note:</span>{" "}
        {summary.notes}
      </div>
    </Card>
  );
}

const GENERATION_MIX_KEYS: Record<string, 1> = {
  coal: 1, nat_gas: 1, nuclear: 1, petroleum: 1, hydro: 1, wind: 1, solar: 1, geothermal: 1,
};

// ---------------------------------------------------------------------------
// Key drivers panel
// ---------------------------------------------------------------------------

function KeyDriversPanel({ overview }: { overview: EnergyOverview }) {
  const wti = overview.symbols.find((s) => s.code === "CL");
  const brent = overview.symbols.find((s) => s.code === "BZ");
  const ng = overview.symbols.find((s) => s.code === "NG");
  const spread =
    wti?.current_price != null && brent?.current_price != null
      ? brent.current_price - wti.current_price
      : null;

  const drivers = [
    {
      label: "Brent-WTI Spread",
      value: spread != null ? `$${spread.toFixed(2)}/bbl` : "—",
      note: "Positive spread = global supply tighter than US. Historically $2–$5 is normal.",
      color: spread != null && spread > 5 ? "text-amber-300" : "text-stealth-200",
    },
    {
      label: "WTI 60d Momentum",
      value: wti ? `${fmt(wti.changes["60d"])}%` : "—",
      note: "60-day price change captures medium-term trend driven by demand shifts and OPEC+ decisions.",
      color: wti ? changeTone(wti.changes["60d"]) : "text-stealth-500",
    },
    {
      label: "Natural Gas 20d",
      value: ng ? `${fmt(ng.changes["20d"])}%` : "—",
      note: "Nat gas is sensitive to weather, LNG export flows, and European demand. Volatile seasonally.",
      color: ng ? changeTone(ng.changes["20d"]) : "text-stealth-500",
    },
    {
      label: "Crude Volatility (60d ann.)",
      value: wti?.volatility != null ? `${wti.volatility.toFixed(1)}%` : "—",
      note: "Annualized realized volatility. Above 35% signals elevated market uncertainty.",
      color:
        (wti?.volatility ?? 0) > 35
          ? "text-amber-300"
          : "text-stealth-200",
    },
    {
      label: "OPEC+ Context",
      value: "See WASDE / EIA STEO",
      note: "OPEC+ production cuts/extensions drive structural supply; check EIA Short-Term Energy Outlook monthly.",
      color: "text-stealth-400",
    },
    {
      label: "USD Impact",
      value: "Inverse corr. ~−0.6",
      note: "Crude oil is priced in USD. A stronger dollar typically pressures crude prices; weaker dollar supports.",
      color: "text-stealth-400",
    },
    {
      label: "Seasonal Pattern",
      value: "Q2/Q3 driving peak",
      note: "US gasoline demand peaks May–Sept (summer driving). Heating oil peaks Oct–Feb. Nat gas peaks Dec–Feb.",
      color: "text-stealth-400",
    },
    {
      label: "Refinery Utilization",
      value: "See EIA WPSR weekly",
      note: "High utilization (>92%) constrains product supply and supports crack spreads (refined vs crude margin).",
      color: "text-stealth-400",
    },
  ];

  return (
    <Card>
      <SectionTitle>Key Drivers &amp; Accelerating Factors</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {drivers.map((d) => (
          <div
            key={d.label}
            className="rounded-xl border border-stealth-700/40 bg-stealth-800/50 p-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-stealth-500">{d.label}</div>
            <div className={`mt-0.5 font-mono text-sm font-semibold ${d.color}`}>{d.value}</div>
            <div className="mt-1 text-[10px] leading-relaxed text-stealth-500">{d.note}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TIMEFRAME_OPTIONS: { key: Timeframe; label: string }[] = [
  { key: "90d", label: "90D" },
  { key: "180d", label: "180D" },
  { key: "365d", label: "1Y" },
];

export default function EnergyIndex() {
  const [timeframe, setTimeframe] = useState<Timeframe>("365d");
  const days = TIMEFRAME_DAYS[timeframe];

  const overviewApi = useApi<EnergyOverview>(`/energy/overview?days=${days}`);
  const historyApi = useApi<EnergyHistory>(`/energy/history?days=${days}`);
  const pricesApi = useApi<EnergyPrices>(`/energy/prices?days=${days}`);
  const mixApi = useApi<GenerationMix>(`/energy/mix`);

  const isLoading =
    overviewApi.loading || historyApi.loading || pricesApi.loading || mixApi.loading;

  if (isLoading && !overviewApi.data) {
    return <MarketLoading message="Loading energy market data…" />;
  }

  const overview = overviewApi.data;
  const history = historyApi.data;
  const prices = pricesApi.data;
  const mix = mixApi.data;

  if (!overview) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-stealth-400">Energy data unavailable. {overviewApi.error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Energy Markets</h1>
          <p className="mt-0.5 text-sm text-stealth-400">
            Futures, retail prices, generation mix, and renewables comparison
          </p>
        </div>
        <div className="flex items-center gap-2">
          {TIMEFRAME_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeframe(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                timeframe === key
                  ? "bg-orange-500/20 border border-orange-400/40 text-orange-300"
                  : "border border-stealth-700 text-stealth-400 hover:border-stealth-500 hover:text-stealth-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Regime bar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-stealth-700/60 bg-stealth-900/70 px-5 py-4 backdrop-blur-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stealth-500">Regime</div>
          <span
            className={`mt-1 inline-block rounded-full border px-3 py-0.5 text-xs font-semibold ${regimeBadgeStyle(overview.regime_label)}`}
          >
            {overview.regime_label}
          </span>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stealth-500">Composite Score</div>
          <div className={`mt-1 text-2xl font-bold ${biasTone(overview.composite_score)}`}>
            {overview.composite_score.toFixed(0)}
            <span className="ml-1 text-xs font-normal text-stealth-500">/ 100</span>
          </div>
        </div>
        <div className="flex-1 text-sm text-stealth-300 leading-relaxed max-w-2xl">
          {overview.summary}
        </div>
      </div>

      {/* ── Group breakdown ──────────────────────────────────────── */}
      <GroupCards groups={overview.groups} />

      {/* ── Futures table ────────────────────────────────────────── */}
      <FuturesTable symbols={overview.symbols} />

      {/* ── Composite history ────────────────────────────────────── */}
      {history && <CompositeHistoryChart history={history.composite_history} />}

      {/* ── Retail prices ────────────────────────────────────────── */}
      {prices && <RetailPricesChart prices={prices.fred_prices} />}

      {/* ── Inventory + drivers side by side ─────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {prices?.fred_prices.crude_inventory && (
          <InventoryChart data={prices.fred_prices.crude_inventory} />
        )}
        <KeyDriversPanel overview={overview} />
      </div>

      {/* ── Alternative energy comparison ────────────────────────── */}
      {history && (
        <AltEnergyChart
          data={history.alt_comparison}
          altSymbols={history.alt_symbols}
        />
      )}

      {/* ── Generation mix ───────────────────────────────────────── */}
      {mix && <GenerationMixPanel mix={mix} />}

      {/* ── Warnings ─────────────────────────────────────────────── */}
      {overview.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          {overview.warnings.join(" · ")}
        </div>
      )}

      <div className="text-[10px] text-stealth-600">
        Energy futures via Yahoo Finance · Retail prices & inventory via FRED/EIA ·
        Generation mix via EIA Annual Energy Review · Alt energy ETFs via Yahoo Finance ·
        As of {overview.as_of.slice(0, 16).replace("T", " ")} UTC
      </div>
    </div>
  );
}
