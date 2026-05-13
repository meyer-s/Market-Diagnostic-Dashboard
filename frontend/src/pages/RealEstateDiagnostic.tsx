import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
} from "../utils/chartUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = "90d" | "180d" | "365d";
const TIMEFRAME_DAYS: Record<Timeframe, number> = { "90d": 90, "180d": 180, "365d": 365 };
type CycleHorizon = 1 | 5 | 15 | 30;
const BUYER_SELLER_CONTEXT_DAYS = 10950;
const BUYER_SELLER_HORIZONS: Array<{ years: CycleHorizon; label: string }> = [
  { years: 1, label: "1Y" },
  { years: 5, label: "5Y" },
  { years: 15, label: "15Y" },
  { years: 30, label: "30Y" },
];

type DataPoint = { date: string; value: number };

type ProxyRow = {
  ticker: string;
  name: string;
  group: string;
  current_price: number | null;
  changes: Record<string, number | null>;
  momentum_score: number;
  volatility: number | null;
};

type GroupCard = {
  group: string;
  label: string;
  weight: number;
  score: number;
  components: string[];
  changes: Record<string, number | null>;
};

type FactorScore = {
  key: "financing_pressure" | "listed_market_confirmation" | "demand_affordability" | "supply_balance";
  label: string;
  weight: number;
  score: number;
  evidence: string[];
};

type MetricSnapshot = {
  mortgage_rate_30y?: number | null;
  mortgage_rate_delta_26w?: number | null;
  treasury_10y?: number | null;
  treasury_10y_delta_60d?: number | null;
  credit_spread_bps?: number | null;
  credit_spread_delta_60d_bps?: number | null;
  shelter_cpi_yoy?: number | null;
  shelter_cpi_yoy_delta_6m?: number | null;
  new_home_sales?: number | null;
  new_home_sales_yoy?: number | null;
  housing_starts_6m?: number | null;
  building_permits_6m?: number | null;
  completions_6m?: number | null;
  xhb_60d?: number | null;
  vnq_60d?: number | null;
};

type RealEstateOverview = {
  as_of: string;
  composite_score: number;
  regime_label: string;
  summary: string;
  groups: GroupCard[];
  symbols: ProxyRow[];
  factors: FactorScore[];
  metrics: MetricSnapshot;
  availability: { available_count: number; total_configured: number };
  warnings: string[];
};

type RealEstateHistory = {
  as_of: string;
  composite_history: DataPoint[];
  factor_history: Array<{
    date: string;
    residential: number;
    reits: number;
    commercial: number;
    financing: number;
  }>;
};

type RealEstateTransmission = {
  as_of: string;
  mortgage_rate_30y: DataPoint[];
  treasury_10y: DataPoint[];
  indexed_xhb: DataPoint[];
  indexed_vnq: DataPoint[];
  credit_spread: DataPoint[];
};

type RealEstateContext = {
  as_of: string;
  housing_starts: DataPoint[];
  building_permits: DataPoint[];
  completions: DataPoint[];
  shelter_cpi: DataPoint[];
  rent_cpi: DataPoint[];
  housing_cpi: DataPoint[];
  median_housing_cpi: DataPoint[];
  new_home_sales: DataPoint[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pressureTone(score: number) {
  if (score >= 60) return "text-rose-400";
  if (score <= 40) return "text-emerald-400";
  return "text-amber-400";
}

function stabilityScore(pressure: number) {
  return Math.max(0, Math.min(100, 100 - pressure));
}

function stabilityTone(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score <= 40) return "text-rose-400";
  return "text-amber-400";
}

function stabilityFill(score: number) {
  if (score >= 60) return "bg-emerald-500";
  if (score <= 40) return "bg-rose-500";
  return "bg-amber-500";
}

function factorEvidence(factor: FactorScore | undefined, fallback: string) {
  return factor?.evidence?.[0] ?? fallback;
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

function compactNumber(v: number | null | undefined, decimals = 1) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: decimals,
  }).format(v);
}

function conciseSummary(args: {
  stability: number;
  topFactor?: FactorScore;
  topGroup?: GroupCard;
  mortgageRate?: number | null;
  mortgageDelta?: number | null;
}) {
  const { stability, topFactor, topGroup, mortgageRate, mortgageDelta } = args;

  const regimeLine =
    stability >= 68
      ? "Real-estate stability is firming up."
      : stability >= 58
        ? "Stability is improving, but the tape is not fully clear yet."
        : stability >= 42
          ? "The market is mixed and still fragile." 
          : "Stability remains weak and financing pressure is still controlling the read.";

  const driverLine = topFactor
    ? `${topFactor.label} is the main swing factor right now.`
    : topGroup
      ? `${topGroup.label} is the least stable segment right now.`
      : "";

  const rateLine = mortgageRate != null
    ? mortgageDelta != null && Math.abs(mortgageDelta) >= 0.1
      ? `30Y mortgage rates are ${mortgageRate.toFixed(2)}%, ${fmt(mortgageDelta, 2)} pp versus roughly six months ago.`
      : `30Y mortgage rates are holding near ${mortgageRate.toFixed(2)}%.`
    : "";

  return [regimeLine, driverLine, rateLine].filter(Boolean).join(" ");
}

function primaryReadTitle(topFactor?: FactorScore, score?: number) {
  if (!topFactor || score == null) return "Mixed stabilization";
  if (topFactor.key === "financing_pressure") return score >= 58 ? "Financing still binding" : "Rate drag easing";
  if (topFactor.key === "listed_market_confirmation") return score >= 58 ? "Listed market still fragile" : "Listed market stabilizing";
  if (topFactor.key === "demand_affordability") return score >= 58 ? "Affordability still restrictive" : "Demand footing improving";
  return score >= 58 ? "Pipeline still tight" : "Supply pressure contained";
}

function pressurePointTitle(mortgageDelta?: number | null, creditDelta?: number | null) {
  if (mortgageDelta != null && mortgageDelta >= 0.15) return "Mortgage headwind rising";
  if (mortgageDelta != null && mortgageDelta <= -0.15) return "Mortgage relief building";
  if (creditDelta != null && creditDelta >= 20) return "Credit stress widening";
  if (creditDelta != null && creditDelta <= -20) return "Credit pressure easing";
  return "Pressure point steady";
}

function leadershipTitle(high?: GroupCard, low?: GroupCard) {
  if (!high) return "Leadership unclear";
  if (!low || high.group === low.group) return `${high.label} least stable`;
  return `${high.label} least stable`;
}

function regimeBadgeStyle(label: string) {
  if (label.toLowerCase().includes("stress") || label.toLowerCase().includes("squeeze"))
    return "border-rose-400/40 bg-rose-500/10 text-rose-300";
  if (label.toLowerCase().includes("easing"))
    return "border-emerald-400/40 bg-emerald-500/10 text-emerald-300";
  if (label.toLowerCase().includes("stabilization"))
    return "border-sky-400/40 bg-sky-500/10 text-sky-300";
  return "border-amber-400/40 bg-amber-500/10 text-amber-300";
}

function scoreBar(score: number) {
  const color = score >= 60 ? "#f87171" : score <= 40 ? "#34d399" : "#fbbf24";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-stealth-800">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className={`text-xs font-mono ${pressureTone(score)}`}>{score.toFixed(0)}</span>
    </div>
  );
}

function nearestDate(map: Record<string, number>, date: string): number | undefined {
  if (map[date] != null) return map[date];
  for (let d = 1; d <= 7; d++) {
    const a = new Date(date); a.setDate(a.getDate() + d);
    const b = new Date(date); b.setDate(b.getDate() - d);
    const va = map[a.toISOString().slice(0, 10)];
    const vb = map[b.toISOString().slice(0, 10)];
    if (va != null) return va;
    if (vb != null) return vb;
  }
  return undefined;
}

function parseIsoDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function filterByYears<T extends { date: string }>(points: T[], years: number) {
  if (!points.length) return [];
  const end = parseIsoDate(points[points.length - 1].date);
  const cutoff = new Date(end);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return points.filter((point) => parseIsoDate(point.date) >= cutoff);
}

function decimateKeepLast<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function buildCycleTicks(points: Array<{ date: string }>, years: CycleHorizon) {
  if (!points.length) return [] as string[];
  const tickDates = points
    .map((point) => point.date)
    .filter((date) => {
      const parsed = parseIsoDate(date);
      const month = parsed.getUTCMonth();
      const year = parsed.getUTCFullYear();
      if (years === 1) return month % 3 === 0;
      if (years === 5) return month === 0;
      if (years === 15) return month === 0 && year % 3 === 0;
      return month === 0 && year % 5 === 0;
    });

  const withEdges = [points[0].date, ...tickDates, points[points.length - 1].date];
  return [...new Set(withEdges)];
}

function formatCycleAxisLabel(date: string, years: CycleHorizon) {
  const parsed = parseIsoDate(date);
  if (years === 1) {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(parsed);
  }
  return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" }).format(parsed);
}

function formatCycleTooltipLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(parseIsoDate(date));
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const tip = {
  contentStyle: {
    background: "rgba(11,15,25,0.94)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    fontSize: 12,
    boxShadow: "0 10px 40px rgba(2,6,23,0.75)",
  },
};

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <p className="page-kicker mb-3">{children}</p>
);

function HoverTooltip({ children, tip, width = "w-64" }: { children: React.ReactNode; tip: string; width?: string }) {
  return (
    <span className="group/htip relative inline-block cursor-default">
      {children}
      <span
        className={`pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden ${width} rounded-lg border border-stealth-600 bg-stealth-950/98 px-2.5 py-2 text-xs font-normal text-stealth-100 shadow-[0_14px_44px_rgba(2,6,23,0.9)] backdrop-blur-xl group-hover/htip:block`}
      >
        {tip}
      </span>
    </span>
  );
}

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
          <HoverTooltip tip={tooltipText} width="w-72">
            <h2 className="text-base font-semibold text-stealth-100">{title}</h2>
          </HoverTooltip>
        ) : (
          <h2 className="text-base font-semibold text-stealth-100">{title}</h2>
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
      <HoverTooltip tip={tooltipText} width="w-80">
        <h2 className="text-lg font-semibold text-stealth-100">{title}</h2>
      </HoverTooltip>
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
      {detail ? (
        <HoverTooltip tip={String(detail)} width="w-64">
          <LabelCaps>{label}</LabelCaps>
        </HoverTooltip>
      ) : (
        <LabelCaps>{label}</LabelCaps>
      )}
      <p className={`mt-0.5 text-base font-semibold ${tone}`}>{value}</p>
    </div>
  );
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
      <HoverTooltip tip={String(detail)} width="w-72">
        <LabelCaps>{label}</LabelCaps>
      </HoverTooltip>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{title}</p>
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function LegendPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="page-badge gap-2 px-2 py-1 text-xs text-stealth-300">
      <LegendDot color={color} />
      {children}
    </span>
  );
}

function MetaPill({ children, tone = "text-stealth-400" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`page-badge px-2 py-1 text-xs ${tone}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Group summary strip (below proxy table)
// ---------------------------------------------------------------------------

function GroupSummaryStrip({ groups }: { groups: GroupCard[] }) {
  return (
    <div className="mt-3 border-t border-stealth-800/60 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HoverTooltip
            tip="Grouped pressure scores: higher means more stress in that segment. Financing and REIT scores confirm whether listed-market and credit channels are amplifying the residential read."
            width="w-80"
          >
            <LabelCaps className="mb-0">Segment Pressure by Group</LabelCaps>
          </HoverTooltip>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.group} className="surface-card-muted px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <HoverTooltip tip={`Members: ${group.components.join(" · ")}`} width="w-64">
                <LabelCaps className="mb-0">{group.label}</LabelCaps>
              </HoverTooltip>
              <BodyHint>{group.weight.toFixed(0)}% wt</BodyHint>
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div>
                <p className={`text-xl font-semibold ${pressureTone(group.score)}`}>{group.score.toFixed(0)}</p>
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

// ---------------------------------------------------------------------------
// Proxy table
// ---------------------------------------------------------------------------

function ProxyTable({
  symbols,
  groups,
  surfaceClassName = "surface-card",
}: {
  symbols: ProxyRow[];
  groups?: GroupCard[];
  surfaceClassName?: string;
}) {
  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <Kicker>Real Estate Proxies</Kicker>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-stealth-700/50">
              <th className="pb-2 text-left text-xs font-medium text-stealth-400">Proxy</th>
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
              <tr key={sym.ticker} className="transition-colors hover:bg-white/[0.02]">
                <td className="py-2">
                  <span className="font-semibold text-stealth-100">{sym.ticker}</span>
                  <span className="ml-2 text-xs text-stealth-500">{sym.name}</span>
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-stealth-600">{sym.group}</span>
                </td>
                <td className="py-2 text-right font-mono text-stealth-200">
                  {sym.current_price != null ? `$${sym.current_price.toFixed(2)}` : "—"}
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
      </div>
      {groups?.length ? <GroupSummaryStrip groups={groups} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composite history chart
// ---------------------------------------------------------------------------

function CompositeHistoryChart({
  history,
  surfaceClassName = "surface-card",
}: {
  history: DataPoint[];
  surfaceClassName?: string;
}) {
  if (!history.length) return null;
  const decimated = history
    .filter((_, i) => i % Math.max(1, Math.floor(history.length / 200)) === 0)
    .map((point) => ({ ...point, value: stabilityScore(point.value) }));
  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Stability Score History"
        title="Composite stability"
        tooltipText="Headline stability is displayed as 100 minus the underlying pressure score. Above 60 means the market is absorbing the financing backdrop; below 40 means stability is weak."
      />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decimated} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(5, 10)} />
            <YAxis {...commonYAxisProps} domain={[20, 80]} />
            <Tooltip {...tip} formatter={(v: number) => [v.toFixed(1), "Stability Score"]} />
            <ReferenceLine y={60} stroke="#34d399" strokeDasharray="2 4" strokeOpacity={0.45} />
            <ReferenceLine y={40} stroke="#f87171" strokeDasharray="2 4" strokeOpacity={0.45} />
            <ReferenceLine y={50} stroke="#334155" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="value" stroke="#0ea5e9" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor panel (group pressure bars)
// ---------------------------------------------------------------------------

const GROUP_COLORS: Record<string, string> = {
  residential: "#38bdf8",
  reits:       "#a78bfa",
  commercial:  "#fbbf24",
  financing:   "#fb7185",
};

function FactorPanel({
  groups,
  surfaceClassName = "surface-card",
}: {
  groups: GroupCard[];
  surfaceClassName?: string;
}) {
  if (!groups.length) return null;
  const data = groups.map((g) => ({
    name: g.label,
    score: g.score,
    group: g.group,
  }));
  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Segment Pressure"
        title="Where stability is breaking"
        tooltipText="This stays in pressure terms on purpose: higher bars show which segment is doing the most damage to the headline stability read."
      />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} />
            <YAxis {...commonYAxisProps} domain={[0, 100]} />
            <ReferenceLine y={60} stroke="#f87171" strokeDasharray="2 4" strokeOpacity={0.5} />
            <ReferenceLine y={40} stroke="#34d399" strokeDasharray="2 4" strokeOpacity={0.5} />
            <Tooltip {...tip} formatter={(v: number) => [v.toFixed(1), "Pressure"]} />
            <Bar dataKey="score" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={GROUP_COLORS[entry.group] ?? "#94a3b8"} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mortgage pressure chart (primary relationship)
// ---------------------------------------------------------------------------

function MortgagePressureChart({
  mortgageRate,
  treasury10y,
  indexedXhb,
  surfaceClassName = "surface-card",
}: {
  mortgageRate: DataPoint[];
  treasury10y: DataPoint[];
  indexedXhb: DataPoint[];
  surfaceClassName?: string;
}) {
  const treasMap = useMemo(() => Object.fromEntries(treasury10y.map((p) => [p.date, p.value])), [treasury10y]);

  const merged = useMemo(() => {
    if (!mortgageRate.length) return [];
    const xhbMap: Record<string, number> = Object.fromEntries(indexedXhb.map((p) => [p.date, p.value]));
    return mortgageRate
      .map((p) => ({
        date: p.date,
        mortgage: p.value,
        treasury: treasMap[p.date] ?? null,
        xhb: nearestDate(xhbMap, p.date) ?? null,
      }))
      .filter((_, i) => i % Math.max(1, Math.floor(mortgageRate.length / 150)) === 0);
  }, [mortgageRate, treasury10y, indexedXhb, treasMap]);

  if (!merged.length) return null;

  const latest = merged[merged.length - 1];
  const mortgageStress = latest.mortgage != null && latest.mortgage > 7;
  const xhbTrend = (() => {
    if (merged.length < 20 || latest.xhb == null) return null;
    const prev = merged[Math.max(0, merged.length - 20)].xhb;
    return prev != null ? latest.xhb - prev : null;
  })();
  const demandEroding = xhbTrend != null && xhbTrend < -5;

  const statusTone = mortgageStress && demandEroding ? "text-rose-300" : mortgageStress ? "text-amber-300" : "text-emerald-300";
  const statusLabel = mortgageStress && demandEroding ? "Demand eroding" : mortgageStress ? "Rate elevated" : "Rate contained";

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          kicker="Mortgage Pressure vs Housing Demand"
          title="Financing cost vs homebuilder proxy"
          tooltipText="30Y mortgage rate on the left axis, indexed homebuilder ETF (XHB, base=100) on the right. Divergence — rates rising while XHB falls — is the clearest signal that financing costs are overwhelming demand."
        />
        <MetaPill tone={statusTone}>{statusLabel}</MetaPill>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <StatTile
          label="30Y Mortgage"
          value={<span className="font-mono">{latest.mortgage != null ? `${latest.mortgage.toFixed(2)}%` : "—"}</span>}
          tone={mortgageStress ? "text-rose-300" : "text-emerald-300"}
          detail="Current financing rate"
        />
        <StatTile
          label="10Y Treasury"
          value={<span className="font-mono">{latest.treasury != null ? `${latest.treasury.toFixed(2)}%` : "—"}</span>}
          tone="text-stealth-100"
          detail="Risk-free rate baseline"
        />
        <StatTile
          label="XHB Indexed"
          value={<span className="font-mono">{latest.xhb != null ? latest.xhb.toFixed(1) : "—"}</span>}
          tone={xhbTrend != null ? (xhbTrend >= 0 ? "text-emerald-300" : "text-rose-300") : "text-stealth-100"}
          detail={xhbTrend != null ? `${fmt(xhbTrend, 1)} pts recent trend` : "Homebuilder demand proxy"}
        />
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis
              yAxisId="rate"
              {...commonYAxisProps}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <YAxis
              yAxisId="idx"
              orientation="right"
              {...commonYAxisProps}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ReferenceLine yAxisId="rate" y={7} stroke="#f87171" strokeDasharray="3 3" strokeOpacity={0.5} />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string) => {
                if (name === "mortgage") return [`${v.toFixed(2)}%`, "30Y Mortgage"];
                if (name === "treasury") return [`${v.toFixed(2)}%`, "10Y Treasury"];
                return [`${v.toFixed(1)}`, "XHB Indexed"];
              }}
            />
            <Line yAxisId="rate" type="monotone" dataKey="mortgage" stroke="#fb923c" strokeWidth={2.4} dot={false} name="mortgage" isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="treasury" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="treasury" isAnimationActive={false} />
            <Line yAxisId="idx"  type="monotone" dataKey="xhb"      stroke="#38bdf8" strokeWidth={2}   dot={false} name="xhb"      isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <LegendPill color="#fb923c">30Y Mortgage</LegendPill>
        <LegendPill color="#94a3b8">10Y Treasury</LegendPill>
        <LegendPill color="#38bdf8">XHB (demand proxy, right axis)</LegendPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transmission chart (rates → equities)
// ---------------------------------------------------------------------------

function TransmissionChart({
  mortgageRate,
  treasury10y,
  indexedXhb,
  indexedVnq,
  surfaceClassName = "surface-card",
}: {
  mortgageRate: DataPoint[];
  treasury10y: DataPoint[];
  indexedXhb: DataPoint[];
  indexedVnq: DataPoint[];
  surfaceClassName?: string;
}) {
  const merged = useMemo(() => {
    const spine = indexedVnq.length >= indexedXhb.length ? indexedVnq : indexedXhb;
    if (!spine.length) return [];
    const vnqMap  = Object.fromEntries(indexedVnq.map((p) => [p.date, p.value]));
    const xhbMap  = Object.fromEntries(indexedXhb.map((p) => [p.date, p.value]));
    const mortMap = Object.fromEntries(mortgageRate.map((p) => [p.date, p.value]));
    const treasMap = Object.fromEntries(treasury10y.map((p) => [p.date, p.value]));
    return spine
      .map((p) => ({
        date: p.date,
        vnq:      vnqMap[p.date]  ?? null,
        xhb:      xhbMap[p.date]  ?? null,
        mortgage: nearestDate(mortMap, p.date) ?? null,
        treasury: nearestDate(treasMap, p.date) ?? null,
      }))
      .filter((_, i) => i % Math.max(1, Math.floor(spine.length / 150)) === 0);
  }, [mortgageRate, treasury10y, indexedXhb, indexedVnq]);

  if (!merged.length) return null;

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Rates → Payments → Equities"
        title="Rate transmission to listed real estate"
        tooltipText="Indexed REIT and homebuilder ETFs (base=100, left axis) overlaid with rate series (right axis). When yields rise and listed RE falls together, the rate transmission channel is active."
      />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis yAxisId="idx"  {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(0)} />
            <YAxis yAxisId="rate" orientation="right" {...commonYAxisProps} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
            <ReferenceLine yAxisId="idx" y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string) => {
                if (name === "mortgage") return [`${v.toFixed(2)}%`, "30Y Mortgage"];
                if (name === "treasury") return [`${v.toFixed(2)}%`, "10Y Treasury"];
                if (name === "vnq") return [`${v.toFixed(1)}`, "VNQ (indexed)"];
                return [`${v.toFixed(1)}`, "XHB (indexed)"];
              }}
            />
            <Line yAxisId="idx"  type="monotone" dataKey="vnq"      stroke="#a78bfa" strokeWidth={2.4} dot={false} name="vnq"      isAnimationActive={false} />
            <Line yAxisId="idx"  type="monotone" dataKey="xhb"      stroke="#38bdf8" strokeWidth={2}   strokeDasharray="5 3" dot={false} name="xhb" isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="mortgage"  stroke="#fb923c" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="mortgage" strokeOpacity={0.75} isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="treasury"  stroke="#94a3b8" strokeWidth={1}   strokeDasharray="3 3" dot={false} name="treasury" strokeOpacity={0.6}  isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <LegendPill color="#a78bfa">VNQ (REITs)</LegendPill>
        <LegendPill color="#38bdf8">XHB (homebuilders)</LegendPill>
        <LegendPill color="#fb923c">30Y Mortgage</LegendPill>
        <LegendPill color="#94a3b8">10Y Treasury</LegendPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credit spread chart (credit → cap-rate)
// ---------------------------------------------------------------------------

function CreditSpreadChart({
  indexedVnq,
  creditSpread,
  surfaceClassName = "surface-card",
}: {
  indexedVnq: DataPoint[];
  creditSpread: DataPoint[];
  surfaceClassName?: string;
}) {
  const merged = useMemo(() => {
    if (!indexedVnq.length || !creditSpread.length) return [];
    const spreads = creditSpread.map((p) => p.value);
    const [minS, maxS] = [Math.min(...spreads), Math.max(...spreads)];
    const rangeS = maxS - minS || 1;
    const spreadMap = Object.fromEntries(creditSpread.map((p) => [p.date, p.value]));
    return indexedVnq
      .map((p) => {
        const rawSpread = nearestDate(spreadMap, p.date);
        return {
          date: p.date,
          vnq: p.value,
          spread_raw: rawSpread ?? null,
          spread_inv: rawSpread != null ? (1 - (rawSpread - minS) / rangeS) * 100 : null,
        };
      })
      .filter((_, i) => i % Math.max(1, Math.floor(indexedVnq.length / 150)) === 0);
  }, [indexedVnq, creditSpread]);

  if (!merged.length) return null;

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Credit → Cap-Rate Pressure"
        title="REIT performance vs credit backdrop"
        tooltipText="VNQ indexed to 100 vs credit spread (inverted and normalized to 0–100). When both lines decline together, credit tightening is transmitting into cap-rate pressure on listed real estate."
      />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
            <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              formatter={(value: number, name: string, props: { payload?: { spread_raw?: number | null } }) => {
                if (name === "spread_inv") return [`${props.payload?.spread_raw?.toFixed(0) ?? "—"} bps`, "Credit Spread (raw)"];
                return [`${value.toFixed(1)}`, "VNQ (indexed)"];
              }}
            />
            <Line type="monotone" dataKey="vnq"        stroke="#a78bfa" strokeWidth={2.4} dot={false} name="vnq"        isAnimationActive={false} />
            <Line type="monotone" dataKey="spread_inv" stroke="#f87171" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="spread_inv" strokeOpacity={0.7} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <LegendPill color="#a78bfa">VNQ (indexed)</LegendPill>
        <LegendPill color="#f87171">Credit Spread (inverted)</LegendPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supply context chart
// ---------------------------------------------------------------------------

function SupplyContextChart({
  starts,
  permits,
  completions,
  surfaceClassName = "surface-card",
}: {
  starts: DataPoint[];
  permits: DataPoint[];
  completions: DataPoint[];
  surfaceClassName?: string;
}) {
  const merged = useMemo(() => {
    const spine = permits.length >= starts.length ? permits : starts;
    if (!spine.length) return [];
    const startsMap = Object.fromEntries(starts.map((p) => [p.date, p.value]));
    const permMap   = Object.fromEntries(permits.map((p) => [p.date, p.value]));
    const compMap   = Object.fromEntries(completions.map((p) => [p.date, p.value]));
    return spine
      .map((p) => ({
        date: p.date,
        starts:      startsMap[p.date] ?? null,
        permits:     permMap[p.date]   ?? null,
        completions: compMap[p.date]   ?? null,
      }))
      .filter((_, i) => i % Math.max(1, Math.floor(spine.length / 150)) === 0);
  }, [starts, permits, completions]);

  if (!merged.length) return null;

  const latestStarts  = starts.length  ? starts[starts.length - 1].value   : null;
  const latestPermits = permits.length ? permits[permits.length - 1].value  : null;

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Supply and Construction"
        title="Housing starts, permits, and completions"
        tooltipText="In thousands of units. Permits lead starts; starts lead completions. A declining permit trend ahead of an elevated rate environment signals supply tightening before demand recovers."
      />
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <StatTile
          label="Housing Starts"
          value={latestStarts != null ? `${latestStarts.toFixed(0)}K` : "—"}
          tone="text-sky-300"
          detail="Thousands of units (annualized)"
        />
        <StatTile
          label="Building Permits"
          value={latestPermits != null ? `${latestPermits.toFixed(0)}K` : "—"}
          tone="text-violet-300"
          detail="Leading indicator for starts"
        />
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} />
            <Tooltip
              {...tip}
              formatter={(v: number, name: string) => [
                `${v.toFixed(0)}K`,
                name === "starts" ? "Starts" : name === "permits" ? "Permits" : "Completions",
              ]}
            />
            <Line type="monotone" dataKey="starts"      stroke="#38bdf8" strokeWidth={2.2} dot={false} name="starts"      isAnimationActive={false} />
            <Line type="monotone" dataKey="permits"     stroke="#a78bfa" strokeWidth={1.8} strokeDasharray="5 3" dot={false} name="permits" isAnimationActive={false} />
            {completions.length > 0 && (
              <Line type="monotone" dataKey="completions" stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="3 3" dot={false} name="completions" strokeOpacity={0.7} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <LegendPill color="#38bdf8">Starts</LegendPill>
        <LegendPill color="#a78bfa">Permits</LegendPill>
        {completions.length > 0 && <LegendPill color="#94a3b8">Completions</LegendPill>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buyer vs seller divergence chart
// ---------------------------------------------------------------------------

function BuyerSellerDivergenceChart({
  newHomeSales,
  permits,
  completions,
  starts,
  surfaceClassName = "surface-card",
}: {
  newHomeSales: DataPoint[];
  permits: DataPoint[];
  completions: DataPoint[];
  starts: DataPoint[];
  surfaceClassName?: string;
}) {
  const [horizonYears, setHorizonYears] = useState<CycleHorizon>(15);

  const joinedRows = useMemo(() => {
    if (!newHomeSales.length) return [];

    const permitsMap = Object.fromEntries(permits.map((point) => [point.date, point.value]));
    const completionsMap = Object.fromEntries(completions.map((point) => [point.date, point.value]));
    const startsMap = Object.fromEntries(starts.map((point) => [point.date, point.value]));

    return newHomeSales
      .map((point) => {
        const permitVal = nearestDate(permitsMap, point.date);
        const completionVal = nearestDate(completionsMap, point.date);
        const startVal = nearestDate(startsMap, point.date);
        const sellerComponents = [permitVal, completionVal, startVal].filter(
          (value): value is number => value != null,
        );
        if (!sellerComponents.length) return null;

        const sellerRaw = sellerComponents.reduce((total, value) => total + value, 0) / sellerComponents.length;
        return {
          date: point.date,
          buyers_raw: point.value,
          sellers_raw: sellerRaw,
        };
      })
      .filter((row): row is { date: string; buyers_raw: number; sellers_raw: number } => row !== null);
  }, [completions, newHomeSales, permits, starts]);

  const merged = useMemo(() => {
    const horizonRows = filterByYears(joinedRows, horizonYears);
    if (!horizonRows.length) return [];

    const buyerValues = horizonRows.map((row) => row.buyers_raw);
    const sellerValues = horizonRows.map((row) => row.sellers_raw);
    const buyerMin = Math.min(...buyerValues);
    const buyerRange = Math.max(...buyerValues) - buyerMin || 1;
    const sellerMin = Math.min(...sellerValues);
    const sellerRange = Math.max(...sellerValues) - sellerMin || 1;

    return decimateKeepLast(
      horizonRows
      .map((row) => {
        const buyersNorm = ((row.buyers_raw - buyerMin) / buyerRange) * 100;
        const sellersNorm = ((row.sellers_raw - sellerMin) / sellerRange) * 100;
        return {
          ...row,
          buyers_norm: buyersNorm,
          sellers_norm: sellersNorm,
          gap: buyersNorm - sellersNorm,
        };
      }),
      120,
    );
  }, [horizonYears, joinedRows]);

  if (!merged.length) return null;

  const latest = merged[merged.length - 1];
  const demandLead = latest.gap >= 8 ? "Buyers leading" : latest.gap <= -8 ? "Supply leading" : "Balanced";
  const cycleTicks = useMemo(() => buildCycleTicks(merged, horizonYears), [horizonYears, merged]);

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          kicker="Demand vs Supply"
          title="Home buyers vs seller supply"
          tooltipText="Buyer demand uses new home sales so the chart can span full housing cycles. Seller supply is built from permits, starts, and completions. Use the 1Y, 5Y, 15Y, and 30Y selector to compare short-term shifts against longer housing cycles."
        />
        <div className="control-strip mt-1">
          {BUYER_SELLER_HORIZONS.map(({ years, label }) => (
            <button
              key={years}
              type="button"
              onClick={() => setHorizonYears(years)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                horizonYears === years
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-stealth-400 hover:text-stealth-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <StatTile
          label="Buyer Demand"
          value={`${latest.buyers_raw.toFixed(0)}K`}
          tone="text-sky-300"
          detail="New home sales, seasonally adjusted annual rate"
        />
        <StatTile
          label="Seller Proxy"
          value={latest.sellers_raw.toFixed(0)}
          tone="text-amber-300"
          detail="Average of permits, starts, and completions"
        />
        <StatTile
          label="Divergence"
          value={`${latest.gap > 0 ? "+" : ""}${latest.gap.toFixed(0)} pts`}
          tone={latest.gap >= 0 ? "text-emerald-300" : "text-rose-300"}
          detail={demandLead}
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <MetaPill tone={latest.gap >= 0 ? "text-emerald-300" : "text-rose-300"}>{demandLead}</MetaPill>
        <BodyHint className="max-w-xl">Positive spread means buyer demand is firming faster than seller-side supply. Negative spread means supply is outrunning buyer demand. The x-axis shifts to cycle-aware year labels as you widen the horizon.</BodyHint>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis
              {...commonXAxisProps}
              dataKey="date"
              ticks={cycleTicks}
              interval={0}
              minTickGap={24}
              tickFormatter={(d: string) => formatCycleAxisLabel(d, horizonYears)}
            />
            <YAxis {...commonYAxisProps} yAxisId="norm" domain={[0, 100]} />
            <YAxis yAxisId="gap" orientation="right" hide domain={[-100, 100]} />
            <ReferenceLine yAxisId="gap" y={0} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              labelFormatter={(label: string) => formatCycleTooltipLabel(label)}
              formatter={(value: number, name: string, props: { payload?: { buyers_raw?: number; sellers_raw?: number; gap?: number } }) => {
                if (name === "gap") {
                  const gap = props.payload?.gap ?? value;
                  return [`${gap > 0 ? "+" : ""}${gap.toFixed(0)} pts`, "Divergence"];
                }
                if (name === "buyers_norm") return [`${props.payload?.buyers_raw?.toFixed(0) ?? "—"}K`, "Buyer Demand"];
                return [compactNumber(props.payload?.sellers_raw, 1), "Seller Supply Proxy"];
              }}
            />
            <Bar yAxisId="gap" dataKey="gap" name="gap" barSize={8} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {merged.map((row) => (
                <Cell key={row.date} fill={row.gap >= 0 ? "rgba(52, 211, 153, 0.35)" : "rgba(248, 113, 113, 0.35)"} />
              ))}
            </Bar>
            <Line type="monotone" yAxisId="norm" dataKey="buyers_norm" stroke="#38bdf8" strokeWidth={2.2} dot={false} name="buyers_norm" isAnimationActive={false} />
            <Line type="monotone" yAxisId="norm" dataKey="sellers_norm" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 3" dot={false} name="sellers_norm" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <LegendPill color="#38bdf8">Buyer Demand</LegendPill>
        <LegendPill color="#f59e0b">Seller Supply Proxy</LegendPill>
        <LegendPill color="#34d399">Positive Divergence</LegendPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Affordability chart
// ---------------------------------------------------------------------------

function AffordabilityChart({
  shelterCpi,
  rentCpi,
  housingCpi,
  medianHousingCpi,
  newHomeSales,
  surfaceClassName = "surface-card",
}: {
  shelterCpi: DataPoint[];
  rentCpi: DataPoint[];
  housingCpi: DataPoint[];
  medianHousingCpi: DataPoint[];
  newHomeSales: DataPoint[];
  surfaceClassName?: string;
}) {
  const inflationConfigs = useMemo(
    () => [
      { key: "rent", label: "Rent CPI (YoY)", data: rentCpi, color: "#f59e0b", dash: undefined as string | undefined, percent: true },
      { key: "housing", label: "Housing CPI (YoY)", data: housingCpi, color: "#38bdf8", dash: "5 3", percent: true },
      { key: "median", label: "Median Housing", data: medianHousingCpi, color: "#a78bfa", dash: "3 3", percent: false },
    ].filter((config) => config.data.length),
    [housingCpi, medianHousingCpi, rentCpi],
  );

  const activeConfigs = useMemo(
    () => inflationConfigs.length
      ? inflationConfigs
      : shelterCpi.length
        ? [{ key: "shelter", label: "Shelter CPI (YoY)", data: shelterCpi, color: "#fbbf24", dash: undefined as string | undefined, percent: true }]
        : [],
    [inflationConfigs, shelterCpi],
  );

  const merged = useMemo(() => {
    if (!activeConfigs.length) return [];

    const normalizedConfigs = activeConfigs.map((config) => {
      const values = config.data.map((point) => point.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      return {
        ...config,
        rawMap: Object.fromEntries(config.data.map((point) => [point.date, point.value])),
        normalize: (value: number) => ((value - min) / range) * 100,
      };
    });

    const referenceSeries = [...activeConfigs].sort((left, right) => right.data.length - left.data.length)[0]?.data ?? [];

    const appVals = newHomeSales.map((p) => p.value).filter((v) => v > 0);
    const [minA, maxA] = appVals.length ? [Math.min(...appVals), Math.max(...appVals)] : [0, 1];
    const rangeA = maxA - minA || 1;

    const appMap = Object.fromEntries(newHomeSales.map((p) => [p.date, p.value]));
    return referenceSeries
      .map((point) => {
        const row: Record<string, number | string | null> = { date: point.date };
        normalizedConfigs.forEach((config) => {
          const rawValue = nearestDate(config.rawMap, point.date);
          row[`${config.key}_raw`] = rawValue ?? null;
          row[`${config.key}_norm`] = rawValue != null ? config.normalize(rawValue) : null;
        });

        const appVal = nearestDate(appMap, point.date);
        row.apps = appVal ?? null;
        row.apps_norm = appVal != null ? ((appVal - minA) / rangeA) * 100 : null;
        return row;
      })
      .filter((_, i) => i % Math.max(1, Math.floor(referenceSeries.length / 150)) === 0);
  }, [activeConfigs, newHomeSales]);

  if (!merged.length) return null;

  const latestRent = rentCpi.length ? rentCpi[rentCpi.length - 1].value : null;
  const latestHousing = housingCpi.length ? housingCpi[housingCpi.length - 1].value : null;
  const latestMedian = medianHousingCpi.length ? medianHousingCpi[medianHousingCpi.length - 1].value : null;
  const latestShelter = shelterCpi.length ? shelterCpi[shelterCpi.length - 1].value : null;
  const latestHomeSales = newHomeSales.length ? newHomeSales[newHomeSales.length - 1].value : null;
  const rentHousingGap = latestRent != null && latestHousing != null ? latestRent - latestHousing : null;

  return (
    <div className={`${surfaceClassName} self-start p-3 sm:p-4`}>
      <CardHeader
        kicker="Price and Affordability"
        title={newHomeSales.length > 0 ? "Housing inflation layers and buyer demand" : "Housing inflation layers"}
        tooltipText={
          newHomeSales.length > 0
            ? "Rent CPI, broad housing CPI, and a median housing inflation read are normalized 0-100 to compare direction and persistence. New home sales are overlaid to show whether buyer demand is absorbing or resisting the inflation backdrop."
            : "Housing inflation lines are normalized 0-100 for directional comparison. Use this panel as context for persistence and breadth of housing inflation rather than as a standalone regime call."
        }
      />
      <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {latestRent != null && (
          <StatTile
            label="Rent CPI"
            value={`${latestRent.toFixed(1)}%`}
            tone={latestRent > 5 ? "text-rose-300" : "text-amber-300"}
            detail="Rent of primary residence"
          />
        )}
        {latestHousing != null && (
          <StatTile
            label="Housing CPI"
            value={`${latestHousing.toFixed(1)}%`}
            tone={latestHousing > 4.5 ? "text-rose-300" : "text-sky-300"}
            detail="Broader housing inflation"
          />
        )}
        {latestMedian != null && (
          <StatTile
            label="Median Housing"
            value={latestMedian.toFixed(1)}
            tone="text-violet-300"
            detail="Median housing inflation read"
          />
        )}
        {latestHomeSales != null ? (
          <StatTile
            label="Home Sales"
            value={`${latestHomeSales.toFixed(0)}K`}
            tone="text-stealth-100"
            detail="New home sales, seasonally adjusted annual rate"
          />
        ) : rentHousingGap != null ? (
          <StatTile
            label="Rent vs Housing Gap"
            value={`${rentHousingGap > 0 ? "+" : ""}${rentHousingGap.toFixed(1)} pp`}
            tone={rentHousingGap > 0 ? "text-amber-300" : "text-stealth-100"}
            detail="Rent inflation minus broad housing"
          />
        ) : latestShelter != null ? (
          <StatTile
            label="Shelter CPI"
            value={`${latestShelter.toFixed(1)}%`}
            tone={latestShelter > 5 ? "text-rose-300" : "text-stealth-100"}
            detail="Fallback shelter context"
          />
        ) : null}
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={[0, 100]} />
            <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="3 3" />
            <Tooltip
              {...tip}
              formatter={(value: number, name: string, props: { payload?: Record<string, number | null> }) => {
                if (name === "apps_norm") {
                  return [`${props.payload?.apps?.toFixed(0) ?? "—"}K`, "New Home Sales"];
                }

                const source = activeConfigs.find((config) => `${config.key}_norm` === name);
                if (!source) return [value.toFixed(1), name];

                const raw = props.payload?.[`${source.key}_raw`];
                if (raw == null) return ["—", source.label];
                if (source.percent) return [`${raw.toFixed(1)}%`, source.label];
                return [raw.toFixed(1), source.label];
              }}
            />
            {activeConfigs.map((config) => (
              <Line
                key={config.key}
                type="monotone"
                dataKey={`${config.key}_norm`}
                stroke={config.color}
                strokeWidth={config.key === "rent" ? 2.3 : 1.8}
                strokeDasharray={config.dash}
                dot={false}
                name={`${config.key}_norm`}
                isAnimationActive={false}
              />
            ))}
            {newHomeSales.length > 0 && (
              <Line type="monotone" dataKey="apps_norm" stroke="#94a3b8" strokeWidth={1.4} strokeDasharray="7 4" dot={false} name="apps_norm" isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {activeConfigs.map((config) => (
          <LegendPill key={config.key} color={config.color}>{config.label}</LegendPill>
        ))}
        {newHomeSales.length > 0 && (
          <LegendPill color="#94a3b8">New Home Sales (normalized)</LegendPill>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Methodology panel
// ---------------------------------------------------------------------------

function RealEstateMethodologyPanel() {
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
            <div className="space-y-3 px-4 pb-4 text-sm text-stealth-300">{children}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-stealth-700 bg-gradient-to-br from-stealth-800 to-stealth-850">
      <button
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-stealth-700/40 md:p-6"
        aria-expanded={panelOpen}
      >
        <div>
          <h2 className="mb-2 text-lg font-semibold text-stealth-100 md:text-xl">Methodology & Scoring</h2>
          <p className="text-xs text-stealth-400">
            How the real-estate pressure score is built from rates, listed proxies, affordability, and construction data.
          </p>
        </div>
        <ChevronIcon open={panelOpen} />
      </button>

      <div className={`collapsible-panel ${panelOpen ? "collapsible-panel-open" : ""}`}>
        <div className="collapsible-panel-inner">
          <div className="divide-y divide-stealth-700 border-t border-stealth-700">
            <Section id="composite" title="What the Composite Measures">
              <p>
                The score is a 0-100 pressure gauge. Higher scores mean financing, affordability, or listed-market
                confirmation is worsening. Lower scores mean conditions are easing or listed real-estate proxies are
                absorbing the rate backdrop.
              </p>
            </Section>

            <Section id="factors" title="Factor Weights">
              <div className="grid gap-2 text-xs md:grid-cols-4">
                {[
                  ["Financing", "35%", "Mortgage rates, Treasury drift, HY OAS"],
                  ["Listed Market", "30%", "REITs, builders, office REIT proxy, financing proxies"],
                  ["Demand", "20%", "Residential proxies, new home sales, and shelter CPI"],
                  ["Pipeline", "15%", "Starts, permits, completions"],
                ].map(([label, weight, detail]) => (
                  <div key={label} className="rounded bg-stealth-900/50 p-2">
                    <div className="font-semibold text-sky-300">{label} - {weight}</div>
                    <div className="mt-0.5 text-stealth-400">{detail}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-stealth-400">
                If a source is unavailable, the composite redistributes across available factors and the warning strip
                names the missing series instead of silently filling static values.
              </p>
            </Section>

            <Section id="proxy-scoring" title="Listed Proxy Scoring">
              <p>
                Listed proxies use 5-day, 20-day, 60-day, and 120-day percent changes. Because this page measures
                pressure, falling REIT, builder, office, bank, or MBS proxies push the score higher; rising proxies push
                it lower.
              </p>
            </Section>

            <Section id="conclusions" title="Conclusion Guardrails">
              <p>
                The summary and hero tiles compare factor scores, segment scores, and relative changes before assigning
                a regime. A residential stress statement needs a residential score versus REIT context, a rate read, or a
                builder-equity trend. A credit statement needs credit-spread or financing-proxy confirmation.
              </p>
            </Section>

            <Section id="sources" title="Data Sources">
              <ul className="space-y-1.5 text-xs">
                <li><span className="font-medium text-stealth-200">Yahoo Finance:</span> VNQ, IYR, XLRE, XHB, ITB, BXP, SLG, KRC, KRE, MBB, REM</li>
                <li><span className="font-medium text-stealth-200">FRED:</span> MORTGAGE30US, DGS10, BAMLH0A0HYM2, HOUST, PERMIT, COMPUTSA, CUSR0000SAH1, CUSR0000SEHA, CPIEHOUSE, MEDCPIM158SFRBCLE, HSN1F</li>
              </ul>
              <p className="mt-1 text-xs text-stealth-400">
                Scores are computed at request time. Composite cache TTL is 20 minutes per timeframe window.
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

export default function RealEstateDiagnostic() {
  const [timeframe, setTimeframe] = useState<Timeframe>("365d");
  const days = TIMEFRAME_DAYS[timeframe];

  const overviewApi      = useApi<RealEstateOverview>(`/real-estate/overview?days=${days}`);
  const historyApi       = useApi<RealEstateHistory>(`/real-estate/history?days=${days}`);
  const transmissionApi  = useApi<RealEstateTransmission>(`/real-estate/transmission?days=${days}`);
  const contextApi       = useApi<RealEstateContext>(`/real-estate/context`);
  const cycleContextApi  = useApi<RealEstateContext>(`/real-estate/context?days=${BUYER_SELLER_CONTEXT_DAYS}`);

  const primaryDataPending = !overviewApi.data;
  if (overviewApi.loading && primaryDataPending) {
    return <MarketLoading label="Loading real estate market data..." />;
  }

  if (!overviewApi.data) {
    return (
      <div className="page-shell">
        <p className="text-stealth-400">Real estate data unavailable. {overviewApi.error}</p>
      </div>
    );
  }

  const overview     = overviewApi.data;
  const history      = historyApi.data;
  const transmission = transmissionApi.data;
  const context      = contextApi.data;
  const cycleContext = cycleContextApi.data;

  const groupsByPressure    = [...overview.groups].sort((a, b) => b.score - a.score);
  const highestPressureGroup = groupsByPressure[0];
  const lowestPressureGroup  = groupsByPressure[groupsByPressure.length - 1];
  const factorsByPressure    = [...(overview.factors ?? [])].sort((a, b) => b.score - a.score);

  const financingGroup   = overview.groups.find((g) => g.group === "financing");
  const financingFactor   = overview.factors?.find((factor) => factor.key === "financing_pressure");

  const financingScore   = financingFactor?.score ?? financingGroup?.score;
  const financingStress  = financingScore != null && financingScore >= 60;
  const mortgageRate     = overview.metrics?.mortgage_rate_30y;
  const mortgageDelta    = overview.metrics?.mortgage_rate_delta_26w;
  const creditSpread     = overview.metrics?.credit_spread_bps;
  const creditSpreadDelta = overview.metrics?.credit_spread_delta_60d_bps;
  const topFactor = factorsByPressure[0];
  const headlineStability = stabilityScore(overview.composite_score);
  const conciseRead = conciseSummary({
    stability: headlineStability,
    topFactor,
    topGroup: highestPressureGroup,
    mortgageRate,
    mortgageDelta,
  });

  const hasCompositePanel     = Boolean(history?.composite_history?.length);
  const hasFactorPanel        = Boolean(overview.groups.length);
  const hasMortgagePressure   = Boolean(transmission?.mortgage_rate_30y?.length && transmission?.indexed_xhb?.length);
  const hasTransmission       = Boolean(transmission?.indexed_vnq?.length && transmission?.indexed_xhb?.length);
  const hasCreditPanel        = Boolean(transmission?.indexed_vnq?.length && transmission?.credit_spread?.length);
  const hasSupplyPanel        = Boolean(context?.housing_starts?.length || context?.building_permits?.length);
  const hasBuyerSeller        = Boolean(cycleContext?.new_home_sales?.length && (cycleContext?.building_permits?.length || cycleContext?.completions?.length || cycleContext?.housing_starts?.length));
  const hasAffordability      = Boolean(
    context?.shelter_cpi?.length ||
    context?.rent_cpi?.length ||
    context?.housing_cpi?.length ||
    context?.median_housing_cpi?.length
  );
  const primarySidePanelCount = Number(hasCompositePanel) + Number(hasFactorPanel);
  const longerHorizonCardCount = Number(hasSupplyPanel) + Number(hasBuyerSeller) + Number(hasAffordability);

  return (
    <div className="page-shell-wide page-stack space-y-5 md:space-y-6">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Tools</p>
          <h1 className="page-title">Real Estate Markets</h1>
          <p className="page-subtitle">Stability, financing transmission, listed proxies, and supply context</p>
        </div>
        <div className="control-strip mt-2">
          {TIMEFRAME_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeframe(key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                timeframe === key
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-stealth-400 hover:text-stealth-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hero snapshot ─────────────────────────────────────── */}
      <div className="surface-card-strong p-4 md:p-5">
        <div className="grid items-start gap-4 xl:grid-cols-[1.1fr_0.95fr]">
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Real Estate Stability</p>
              <p className={`mt-2 text-4xl font-semibold ${stabilityTone(headlineStability)}`}>
                {headlineStability.toFixed(0)}
              </p>
              <div className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700">
                <div
                  className={`h-2 rounded-full ${stabilityFill(headlineStability)}`}
                  style={{ width: `${headlineStability}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-stealth-400">
                As of {new Date(overview.as_of).toLocaleString()}
              </p>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-stealth-300">{conciseRead}</p>
            <div className="grid gap-2 md:grid-cols-3">
              <SignalTile
                label="Primary Read"
                title={primaryReadTitle(topFactor, overview.composite_score)}
                tone={topFactor ? pressureTone(topFactor.score) : "text-stealth-100"}
                detail={
                  `${factorEvidence(topFactor, highestPressureGroup ? `${highestPressureGroup.label} is the most pressured segment at ${highestPressureGroup.score.toFixed(0)}.` : "Primary read unavailable.")} ${topFactor && factorsByPressure[factorsByPressure.length - 1] ? `${topFactor.label} is ${Math.abs(topFactor.score - factorsByPressure[factorsByPressure.length - 1].score).toFixed(0)} pts above ${factorsByPressure[factorsByPressure.length - 1].label.toLowerCase()}.` : ""}`
                }
              />
              <SignalTile
                label="Pressure Point"
                title={pressurePointTitle(mortgageDelta, creditSpreadDelta)}
                tone={financingStress || (creditSpreadDelta != null && creditSpreadDelta > 0) ? "text-rose-300" : "text-emerald-300"}
                detail={
                  `${mortgageRate != null ? `30Y mortgage rate is ${mortgageRate.toFixed(2)}%` : "Mortgage rate unavailable"}${mortgageDelta != null ? `, ${fmt(mortgageDelta, 2)} pp vs about six months ago.` : "."} ${creditSpread != null ? `HY OAS is ${creditSpread.toFixed(0)} bps` : "Credit spread unavailable"}${creditSpreadDelta != null ? `, ${fmt(creditSpreadDelta, 0)} bps over 60 observations.` : "."}`
                }
              />
              <SignalTile
                label="Leadership"
                title={leadershipTitle(highestPressureGroup, lowestPressureGroup)}
                tone={highestPressureGroup ? pressureTone(highestPressureGroup.score) : "text-stealth-100"}
                detail={
                  highestPressureGroup && lowestPressureGroup
                    ? `${highestPressureGroup.label} is at ${highestPressureGroup.score.toFixed(0)} versus ${lowestPressureGroup.label} at ${lowestPressureGroup.score.toFixed(0)}.`
                    : "Segment read unavailable."
                }
              />
            </div>
          </div>

          <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <StatTile
              label="Regime"
              value={
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${regimeBadgeStyle(overview.regime_label)}`}>
                  {overview.regime_label}
                </span>
              }
              detail="Composite state"
            />
            <StatTile
              label="Availability"
              value={`${overview.availability.available_count}/${overview.availability.total_configured}`}
              detail="Configured proxies"
            />
            <StatTile
              label="30Y Mortgage"
              value={mortgageRate != null ? <span className="font-mono">{mortgageRate.toFixed(2)}%</span> : "—"}
              tone={mortgageRate != null && mortgageRate >= 7 ? "text-rose-300" : "text-stealth-100"}
              detail={mortgageDelta != null ? `${fmt(mortgageDelta, 2)} pp vs about 6 months ago` : "FRED MORTGAGE30US"}
            />
            <StatTile
              label="HY OAS"
              value={creditSpread != null ? <span className="font-mono">{creditSpread.toFixed(0)} bps</span> : "—"}
              tone={creditSpread != null && creditSpread >= 450 ? "text-rose-300" : "text-stealth-100"}
              detail={creditSpreadDelta != null ? `${fmt(creditSpreadDelta, 0)} bps over 60 observations` : "FRED BAMLH0A0HYM2"}
            />
          </div>
        </div>
      </div>

      {/* ── Primary relationship band ──────────────────────────── */}
      {(hasMortgagePressure || primarySidePanelCount > 0) && (
        <div
          className={`grid items-start gap-3 md:gap-4 ${
            hasMortgagePressure && primarySidePanelCount > 0
              ? "xl:grid-cols-[1.45fr_0.95fr]"
              : "grid-cols-1"
          }`}
        >
          {hasMortgagePressure && transmission ? (
            <MortgagePressureChart
              mortgageRate={transmission.mortgage_rate_30y}
              treasury10y={transmission.treasury_10y}
              indexedXhb={transmission.indexed_xhb}
              surfaceClassName="primary-card"
            />
          ) : null}
          {primarySidePanelCount > 0 && (
            <div className="grid gap-3 md:gap-4">
              {hasCompositePanel && history ? (
                <CompositeHistoryChart history={history.composite_history} surfaceClassName="primary-card" />
              ) : null}
              {hasFactorPanel ? (
                <FactorPanel groups={overview.groups} />
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── Market structure band ──────────────────────────────── */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <SectionHeader
            kicker="Market Structure"
            title="Proxy table and segment leadership"
            tooltipText="Listed real-estate proxies by segment. Use this band to identify where breadth and momentum are leading or lagging relative to the composite pressure score."
          />
        </div>
        <ProxyTable
          symbols={overview.symbols}
          groups={overview.groups}
          surfaceClassName="surface-card-strong"
        />
      </div>

      {/* ── Transmission band ─────────────────────────────────── */}
      {(hasTransmission || hasCreditPanel) && transmission && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2.5">
            <SectionHeader
              kicker="Transmission"
              title="Rate and credit flow-through"
              tooltipText="How changes in rates and credit spreads are flowing through to listed real-estate valuations. Divergence between rate series and equity performance is the key diagnostic signal."
            />
          </div>
          <div
            className={`grid items-start gap-3 md:gap-4 ${
              hasTransmission && hasCreditPanel ? "xl:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {hasTransmission ? (
              <TransmissionChart
                mortgageRate={transmission.mortgage_rate_30y}
                treasury10y={transmission.treasury_10y}
                indexedXhb={transmission.indexed_xhb}
                indexedVnq={transmission.indexed_vnq}
              />
            ) : null}
            {hasCreditPanel ? (
              <CreditSpreadChart
                indexedVnq={transmission.indexed_vnq}
                creditSpread={transmission.credit_spread}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* ── Longer-horizon context band ────────────────────────── */}
      {(hasSupplyPanel || hasBuyerSeller || hasAffordability) && context && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2.5">
            <SectionHeader
              kicker="Longer Horizon"
              title="Supply, construction, and affordability context"
              tooltipText="Slower-moving structural context. Supply and construction data confirm whether the price and credit picture is demand- or supply-driven. Buyer-demand divergence and housing inflation provide the structural demand overlay without replacing the listed-market read."
            />
          </div>
          <div
            className={`grid items-start gap-3 md:gap-4 ${
              longerHorizonCardCount >= 3 ? "xl:grid-cols-3" : longerHorizonCardCount === 2 ? "xl:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {hasSupplyPanel ? (
              <SupplyContextChart
                starts={context.housing_starts}
                permits={context.building_permits}
                completions={context.completions}
              />
            ) : null}
            {hasBuyerSeller && cycleContext ? (
              <BuyerSellerDivergenceChart
                newHomeSales={cycleContext.new_home_sales}
                permits={cycleContext.building_permits}
                completions={cycleContext.completions}
                starts={cycleContext.housing_starts}
              />
            ) : null}
            {hasAffordability ? (
              <AffordabilityChart
                shelterCpi={context.shelter_cpi}
                rentCpi={context.rent_cpi}
                housingCpi={context.housing_cpi}
                medianHousingCpi={context.median_housing_cpi}
                newHomeSales={context.new_home_sales}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Warnings */}
      {overview.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          {overview.warnings.join(" · ")}
        </div>
      )}

      {/* Sources footer */}
      <div className="flex items-center justify-end gap-2">
        <HoverTooltip
          tip={`Listed real-estate proxies via Yahoo Finance. Mortgage rates, Treasury yields, HY OAS, housing supply, new home sales, rent CPI, housing CPI, median housing CPI, and shelter CPI via FRED. As of ${overview.as_of.slice(0, 16).replace("T", " ")} UTC.`}
          width="w-80"
        >
          <LabelCaps className="mb-0">Sources</LabelCaps>
        </HoverTooltip>
      </div>

      <RealEstateMethodologyPanel />

    </div>
  );
}
