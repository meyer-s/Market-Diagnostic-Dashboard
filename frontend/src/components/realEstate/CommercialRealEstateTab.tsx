import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MarketLoading from "../ui/MarketLoading";
import DataScroller from "../ui/DataScroller";
import { useApi } from "../../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
} from "../../utils/chartUtils";
import {
  buildCycleTimeTicks,
  buildSeriesWindow,
  filterToSeriesWindow,
  formatCycleTimeAxisLabel,
  formatCycleTooltipLabel,
  REAL_ESTATE_HORIZONS,
  realEstateTimestamp,
  rebaseSeriesToWindow,
  type RealEstateHorizon,
} from "../../utils/realEstateHorizon";
import {
  dataQualityEvidenceState,
  describeDataQuality,
  type DataQualityMetadata,
} from "../../utils/dataQuality";

type DataPoint = { date: string; value: number };

type CommercialGroup = {
  group: string;
  label: string;
  weight: number;
  score: number;
  components: string[];
  changes: Record<string, number | null>;
};

type CommercialSymbol = {
  ticker: string;
  name: string;
  group: string;
  current_price: number | null;
  changes: Record<string, number | null>;
  momentum_score: number;
  volatility: number | null;
};

type CommercialFactor = {
  key: string;
  label: string;
  weight: number;
  score: number;
};

type CommercialMetrics = {
  cre_price_yoy?: number | null;
  cre_loan_balance_bil?: number | null;
  cre_loan_growth_yoy?: number | null;
  cre_delinquency_rate?: number | null;
  cre_delinquency_delta_1y?: number | null;
  treasury_10y?: number | null;
  treasury_10y_delta_60d?: number | null;
  credit_spread_bps?: number | null;
  credit_spread_delta_60d_bps?: number | null;
};

type SectorSupplySeries = {
  key: string;
  label: string;
  unit: string;
  latest: number | null;
  change_yoy: number | null;
  data: DataPoint[];
};

type CommercialSectorContext = {
  group: string;
  label: string;
  coverage: string;
  supply: {
    title: string;
    note: string;
    series: SectorSupplySeries[];
  };
  demand_supply: {
    demand_label: string;
    supply_label: string;
    demand_index: DataPoint[];
    supply_index: DataPoint[];
    demand_latest: number | null;
    supply_latest: number | null;
    divergence: number | null;
    note: string;
  };
  price: {
    listed_label: string;
    listed_index: DataPoint[];
    listed_change_60d: number | null;
    property_price_label: string;
    property_price_index: DataPoint[];
    property_price_change_1y: number | null;
    rent_label: string;
    rent_index: DataPoint[];
    rent_change_1y: number | null;
    note: string;
  };
  sources: Array<{ key: string; series_id: string; label: string }>;
};

type CommercialPayload = {
  as_of: string;
  data_quality?: DataQualityMetadata;
  regime_label: string;
  pressure_score: number;
  stability_score: number;
  summary: string;
  groups: CommercialGroup[];
  symbols: CommercialSymbol[];
  factors: CommercialFactor[];
  metrics: CommercialMetrics;
  property_type_history: Array<Record<string, string | number | null>>;
  sector_context: Record<string, CommercialSectorContext>;
  macro: {
    cre_price_yoy: DataPoint[];
    cre_loans: DataPoint[];
    cre_delinquency: DataPoint[];
    treasury_10y: DataPoint[];
    credit_spread: DataPoint[];
  };
  availability: {
    available_count: number;
    total_configured: number;
  };
  warnings: string[];
};

const GROUP_COLORS: Record<string, string> = {
  office: "#fb7185",
  industrial: "#38bdf8",
  retail: "#fbbf24",
  multifamily: "#a78bfa",
  digital: "#34d399",
};

const chartTooltip = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 10,
    color: "#e2e8f0",
    fontSize: 12,
  },
  labelStyle: { color: "#94a3b8" },
};

function pressureTone(score: number) {
  if (score >= 60) return "text-rose-300";
  if (score <= 40) return "text-emerald-300";
  return "text-amber-300";
}

function stabilityTone(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score <= 40) return "text-rose-400";
  return "text-amber-400";
}

function changeTone(value: number | null | undefined) {
  if (value == null) return "text-stealth-500";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-rose-300";
  return "text-stealth-300";
}

function formatChange(value: number | null | undefined, decimals = 1) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function regimeBadgeStyle(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("stress") || lower.includes("pressure")) {
    return "border-rose-400/30 bg-rose-500/10 text-rose-300";
  }
  if (lower.includes("expansion") || lower.includes("stabilization")) {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  }
  return "border-amber-400/30 bg-amber-500/10 text-amber-300";
}

function nearestValue(points: DataPoint[], date: string) {
  if (!points.length) return null;
  const target = new Date(date).getTime();
  let nearest = points[0];
  let nearestDistance = Math.abs(new Date(nearest.date).getTime() - target);
  for (const point of points.slice(1)) {
    const distance = Math.abs(new Date(point.date).getTime() - target);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest.value;
}

function mergeNamedSeries(series: Array<{ key: string; data: DataPoint[] }>): Array<{ date: string; timestamp: number } & Record<string, string | number | null>> {
  const dates = [...new Set(series.flatMap((item) => item.data.map((point) => point.date)))].sort();
  const maps = Object.fromEntries(
    series.map((item) => [item.key, Object.fromEntries(item.data.map((point) => [point.date, point.value]))]),
  );
  return dates.map((date) => {
    const row: { date: string; timestamp: number } & Record<string, string | number | null> = {
      date,
      timestamp: realEstateTimestamp(date),
    };
    series.forEach((item) => {
      row[item.key] = maps[item.key]?.[date] ?? null;
    });
    return row;
  });
}

function formatSupplyValue(series: SectorSupplySeries) {
  if (series.latest == null) return "—";
  if (series.unit.startsWith("$M")) return `$${(series.latest / 1000).toFixed(1)}B`;
  if (series.unit.startsWith("K")) return `${series.latest.toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(series.latest);
}

function formatSeriesCoverage(points: DataPoint[]) {
  if (!points.length) return "unavailable";
  const first = formatCycleTooltipLabel(points[0].date);
  const last = formatCycleTooltipLabel(points[points.length - 1].date);
  return first === last ? first : `${first}–${last}`;
}

function SectionHeader({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stealth-500">{kicker}</p>
      <h2 className="mt-1 text-lg font-semibold text-stealth-100">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-stealth-400">{detail}</p>
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
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-stealth-700 bg-stealth-900/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stealth-500">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs leading-4 text-stealth-400">{detail}</p>
    </div>
  );
}

function PropertyTypeChart({ data, groups }: { data: CommercialPayload["property_type_history"]; groups: CommercialGroup[] }) {
  if (!data.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Listed Breadth"
        title="Property-type performance"
        detail="Equal-weighted listed proxies, indexed to 100 at the start of the selected window. This separates office from logistics, retail, apartments, and digital infrastructure."
      />
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Commercial real estate property-type performance history"
            data={data}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
            <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 4" />
            <Tooltip
              {...chartTooltip}
              formatter={(value: number, name: string) => [value.toFixed(1), groups.find((group) => group.group === name)?.label ?? name]}
            />
            {groups.map((group) => (
              <Line
                key={group.group}
                type="monotone"
                dataKey={group.group}
                stroke={GROUP_COLORS[group.group] ?? "#94a3b8"}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {groups.map((group) => (
          <span key={group.group} className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1 text-xs text-stealth-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#94a3b8" }} />
            {group.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CreditCycleChart({ price, delinquency }: { price: DataPoint[]; delinquency: DataPoint[] }) {
  const data = useMemo(
    () => price.map((point) => ({
      date: point.date,
      price: point.value,
      delinquency: nearestValue(delinquency, point.date),
    })),
    [delinquency, price],
  );

  if (!data.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Credit Fundamentals"
        title="Prices versus bank delinquencies"
        detail="Broad commercial-property price growth is paired with the delinquency rate on bank CRE loans. Falling prices alongside rising delinquencies is the clearest fundamental stress combination."
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Commercial real estate prices and bank delinquency history"
            data={data}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} yAxisId="price" tickFormatter={(value: number) => `${value}%`} />
            <YAxis {...commonYAxisProps} yAxisId="delinquency" orientation="right" tickFormatter={(value: number) => `${value}%`} />
            <ReferenceLine yAxisId="price" y={0} stroke="#334155" strokeDasharray="4 4" />
            <Tooltip
              {...chartTooltip}
              formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name === "price" ? "CRE Prices YoY" : "CRE Delinquency"]}
            />
            <Line yAxisId="price" type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={2.2} dot={false} name="price" isAnimationActive={false} />
            <Line yAxisId="delinquency" type="monotone" dataKey="delinquency" stroke="#fb7185" strokeWidth={2} dot={false} name="delinquency" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LendingChart({ loans }: { loans: DataPoint[] }) {
  if (!loans.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Bank Exposure"
        title="Commercial-bank CRE loan balance"
        detail="Outstanding CRE loans at U.S. commercial banks. The balance is context for system exposure; growth by itself is not scored as healthy or unhealthy."
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Commercial-bank commercial real estate loan balance history"
            data={loans}
            margin={CHART_MARGIN}
          >
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(value: number) => `$${(value / 1000).toFixed(1)}T`} />
            <Tooltip {...chartTooltip} formatter={(value: number) => [`$${value.toFixed(1)}B`, "CRE Loans"]} />
            <Line type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={2.2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SectorSupplyCard({
  context,
  color,
  horizonYears,
}: {
  context: CommercialSectorContext;
  color: string;
  horizonYears: RealEstateHorizon;
}) {
  const seriesWindow = useMemo(
    () => buildSeriesWindow(context.supply.series.map((series) => series.data), horizonYears),
    [context.supply.series, horizonYears],
  );
  const chartSeries = useMemo(
    () => context.supply.series.map((series) => ({
      ...series,
      data: filterToSeriesWindow(series.data, seriesWindow),
    })),
    [context.supply.series, seriesWindow],
  );
  const chartData = useMemo(
    () => mergeNamedSeries(chartSeries.map((series) => ({ key: series.key, data: series.data }))),
    [chartSeries],
  );
  const cycleTicks = useMemo(() => buildCycleTimeTicks(seriesWindow, horizonYears), [seriesWindow, horizonYears]);
  const seriesColors = [color, "#a78bfa", "#94a3b8"];

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-stealth-950/20 p-3 sm:p-4">
      <SectionHeader
        kicker="Supply & Construction"
        title={context.supply.title}
        detail="Current development activity and its year-over-year direction."
      />
      <div className={`mt-4 grid gap-2 ${context.supply.series.length > 1 ? "sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3" : "grid-cols-2"}`}>
        {context.supply.series.map((series) => (
          <StatTile
            key={series.key}
            label={series.label}
            value={formatSupplyValue(series)}
            detail={`${formatChange(series.change_yoy)} year over year`}
            tone={changeTone(series.change_yoy)}
          />
        ))}
        {context.supply.series.length === 1 && (
          <StatTile
            label="One-Year Change"
            value={formatChange(context.supply.series[0]?.change_yoy)}
            detail="Change in development activity"
            tone={changeTone(context.supply.series[0]?.change_yoy)}
          />
        )}
      </div>
      {chartData.length > 0 && (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              accessibilityLayer
              aria-label={`${context.supply.title} history`}
              data={chartData}
              margin={CHART_MARGIN}
            >
              <CartesianGrid {...commonGridProps} />
              <XAxis
                {...commonXAxisProps}
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={seriesWindow ? [seriesWindow.start, seriesWindow.end] : ["dataMin", "dataMax"]}
                ticks={cycleTicks}
                interval={0}
                minTickGap={24}
                tickFormatter={(timestamp: number) => formatCycleTimeAxisLabel(timestamp, horizonYears)}
              />
              <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(value: number) => `${Math.round(value)}`} />
              <Tooltip
                {...chartTooltip}
                labelFormatter={(timestamp: number) => formatCycleTooltipLabel(timestamp)}
                formatter={(value: number, name: string) => {
                  const series = context.supply.series.find((item) => item.key === name);
                  return [series ? formatSupplyValue({ ...series, latest: value }) : value.toFixed(1), series?.label ?? name];
                }}
              />
              {context.supply.series.map((series, index) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  stroke={seriesColors[index] ?? "#94a3b8"}
                  strokeWidth={2.1}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {context.supply.series.map((series, index) => (
          <span key={series.key} className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1 text-xs text-stealth-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesColors[index] ?? "#94a3b8" }} />
            {series.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-stealth-500">{context.supply.note}</p>
    </div>
  );
}

function SectorDemandSupplyCard({
  context,
  horizonYears,
}: {
  context: CommercialSectorContext;
  horizonYears: RealEstateHorizon;
}) {
  const demand = context.demand_supply;
  const seriesWindow = useMemo(
    () => buildSeriesWindow([demand.demand_index, demand.supply_index], horizonYears),
    [demand.demand_index, demand.supply_index, horizonYears],
  );
  const demandSeries = useMemo(
    () => rebaseSeriesToWindow(demand.demand_index, seriesWindow),
    [demand.demand_index, seriesWindow],
  );
  const supplySeries = useMemo(
    () => rebaseSeriesToWindow(demand.supply_index, seriesWindow),
    [demand.supply_index, seriesWindow],
  );
  const chartData = useMemo(
    () => mergeNamedSeries([
      { key: "demand", data: demandSeries },
      { key: "supply", data: supplySeries },
    ]),
    [demandSeries, supplySeries],
  );
  const cycleTicks = useMemo(() => buildCycleTimeTicks(seriesWindow, horizonYears), [seriesWindow, horizonYears]);
  const demandLatest = demandSeries[demandSeries.length - 1]?.value ?? null;
  const supplyLatest = supplySeries[supplySeries.length - 1]?.value ?? null;
  const divergence = demandLatest != null && supplyLatest != null ? demandLatest - supplyLatest : null;

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-stealth-950/20 p-3 sm:p-4">
      <SectionHeader
        kicker="Demand vs Supply"
        title={`${context.label} operating balance`}
        detail="Public demand and development measures, each indexed to 100 at its first available observation within the selected window."
      />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <StatTile label="Demand" value={demandLatest?.toFixed(1) ?? "—"} detail="Indexed activity" tone="text-sky-300" />
        <StatTile label="Supply" value={supplyLatest?.toFixed(1) ?? "—"} detail="Indexed pipeline" tone="text-amber-300" />
        <StatTile
          label="Divergence"
          value={divergence != null ? `${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}` : "—"}
          detail="Demand less supply"
          tone={divergence == null ? "text-stealth-500" : divergence >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
      </div>
      {chartData.length > 0 && (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              accessibilityLayer
              aria-label={`${context.label} operating balance history`}
              data={chartData}
              margin={CHART_MARGIN}
            >
              <CartesianGrid {...commonGridProps} />
              <XAxis
                {...commonXAxisProps}
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={seriesWindow ? [seriesWindow.start, seriesWindow.end] : ["dataMin", "dataMax"]}
                ticks={cycleTicks}
                interval={0}
                minTickGap={24}
                tickFormatter={(timestamp: number) => formatCycleTimeAxisLabel(timestamp, horizonYears)}
              />
              <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
              <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 4" />
              <Tooltip
                {...chartTooltip}
                labelFormatter={(timestamp: number) => formatCycleTooltipLabel(timestamp)}
                formatter={(value: number, name: string) => [value.toFixed(1), name === "demand" ? demand.demand_label : demand.supply_label]}
              />
              <Line type="monotone" dataKey="demand" stroke="#38bdf8" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="supply" stroke="#f59e0b" strokeWidth={2.1} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-stealth-300">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1"><span className="h-2 w-2 rounded-full bg-sky-400" />{demand.demand_label}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{demand.supply_label}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-stealth-500">{demand.note}</p>
    </div>
  );
}

function SectorPriceCard({
  context,
  color,
  horizonYears,
}: {
  context: CommercialSectorContext;
  color: string;
  horizonYears: RealEstateHorizon;
}) {
  const price = context.price;
  const seriesWindow = useMemo(
    () => buildSeriesWindow([price.listed_index, price.property_price_index, price.rent_index], horizonYears),
    [horizonYears, price.listed_index, price.property_price_index, price.rent_index],
  );
  const listedSeries = useMemo(
    () => rebaseSeriesToWindow(price.listed_index, seriesWindow),
    [price.listed_index, seriesWindow],
  );
  const propertySeries = useMemo(
    () => rebaseSeriesToWindow(price.property_price_index, seriesWindow),
    [price.property_price_index, seriesWindow],
  );
  const rentSeries = useMemo(
    () => rebaseSeriesToWindow(price.rent_index, seriesWindow),
    [price.rent_index, seriesWindow],
  );
  const chartData = useMemo(
    () => mergeNamedSeries([
      { key: "listed", data: listedSeries },
      { key: "property", data: propertySeries },
      { key: "rent", data: rentSeries },
    ]),
    [listedSeries, propertySeries, rentSeries],
  );
  const cycleTicks = useMemo(() => buildCycleTimeTicks(seriesWindow, horizonYears), [seriesWindow, horizonYears]);
  const coverage = [
    `${price.listed_label}: ${formatSeriesCoverage(listedSeries)}`,
    `${price.property_price_label}: ${formatSeriesCoverage(propertySeries)}`,
    `${price.rent_label}: ${formatSeriesCoverage(rentSeries)}`,
  ].join(" · ");

  return (
    <div className="self-start rounded-2xl border border-stealth-700 bg-stealth-950/20 p-3 sm:p-4">
      <SectionHeader
        kicker="Price & Rent"
        title={`${context.label} pricing layers`}
        detail="Calendar-time comparison of listed pricing, property values, and rents. Each line is indexed to 100 at its first available observation within the selected window."
      />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <StatTile label="Listed 60D" value={formatChange(price.listed_change_60d)} detail="Sector basket" tone={changeTone(price.listed_change_60d)} />
        <StatTile label="Property 1Y" value={formatChange(price.property_price_change_1y)} detail="Price index" tone={changeTone(price.property_price_change_1y)} />
        <StatTile label="Rent 1Y" value={formatChange(price.rent_change_1y)} detail="Rent measure" tone={changeTone(price.rent_change_1y)} />
      </div>
      {chartData.length > 0 && (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart
              accessibilityLayer
              aria-label={`${context.label} pricing-layer history`}
              data={chartData}
              margin={CHART_MARGIN}
            >
              <CartesianGrid {...commonGridProps} />
              <XAxis
                {...commonXAxisProps}
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={seriesWindow ? [seriesWindow.start, seriesWindow.end] : ["dataMin", "dataMax"]}
                ticks={cycleTicks}
                interval={0}
                minTickGap={24}
                tickFormatter={(timestamp: number) => formatCycleTimeAxisLabel(timestamp, horizonYears)}
              />
              <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
              <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 4" />
              <Tooltip
                {...chartTooltip}
                labelFormatter={(timestamp: number) => formatCycleTooltipLabel(timestamp)}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    listed: price.listed_label,
                    property: price.property_price_label,
                    rent: price.rent_label,
                  };
                  return [value.toFixed(1), labels[name] ?? name];
                }}
              />
              <Line type="monotone" dataKey="listed" stroke={color} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="property" stroke="#94a3b8" strokeWidth={2} strokeDasharray="7 3" dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="rent" stroke="#f59e0b" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-stealth-300">
        {[
          [price.listed_label, color],
          [price.property_price_label, "#94a3b8"],
          [price.rent_label, "#f59e0b"],
        ].map(([label, swatch]) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: swatch }} />{label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-stealth-400">Coverage: {coverage}</p>
      <p className="mt-3 text-xs leading-5 text-stealth-500">{price.note}</p>
    </div>
  );
}

export default function CommercialRealEstateTab({ days }: { days: number }) {
  const [selectedSector, setSelectedSector] = useState("office");
  const [horizonYears, setHorizonYears] = useState<RealEstateHorizon>(15);
  const api = useApi<CommercialPayload>(`/real-estate/commercial?days=${days}`);

  if (api.loading && !api.data) {
    return <MarketLoading label="Loading commercial real-estate data..." />;
  }

  if (!api.data) {
    return (
      <div className="surface-card p-5 text-sm text-stealth-400">
        Commercial real-estate data unavailable. {api.error}
      </div>
    );
  }

  const data = api.data;
  const qualityState = dataQualityEvidenceState(data.data_quality);
  const provenanceMessage = describeDataQuality(
    "commercial real-estate",
    data.data_quality,
  );
  const metrics = data.metrics;
  const orderedGroups = [...data.groups].sort((left, right) => right.score - left.score);
  const loanBalance = metrics.cre_loan_balance_bil;
  const sectorContexts = data.groups
    .map((group) => data.sector_context?.[group.group])
    .filter((context): context is CommercialSectorContext => Boolean(context));
  const selectedContext = data.sector_context?.[selectedSector] ?? sectorContexts[0];

  return (
    <div className="space-y-5 md:space-y-6">
      {(qualityState === "stale" || qualityState === "partial") && (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-4"
          role="status"
          data-evidence-panel="commercial-real-estate"
          data-evidence-state={qualityState}
        >
          <h2 className="text-sm font-semibold text-amber-200">
            {qualityState === "stale"
              ? "Commercial real-estate evidence is not current"
              : "Partial commercial real-estate update"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-100">
            {provenanceMessage}
          </p>
          <button
            type="button"
            onClick={api.refetch}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-amber-600 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Refresh commercial evidence
          </button>
        </div>
      )}
      <div className="surface-card-strong p-4 md:p-5">
        <div className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Commercial Real Estate Stability</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <p className={`text-4xl font-semibold ${stabilityTone(data.stability_score)}`}>{data.stability_score.toFixed(0)}</p>
              <span className={`mb-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${regimeBadgeStyle(data.regime_label)}`}>
                {data.regime_label}
              </span>
            </div>
            <div className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700">
              <div
                className={`h-2 rounded-full ${data.stability_score >= 60 ? "bg-emerald-500" : data.stability_score <= 40 ? "bg-rose-500" : "bg-amber-500"}`}
                style={{ width: `${data.stability_score}%` }}
              />
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-stealth-300">{data.summary}</p>
            <p className="mt-3 text-xs text-stealth-500">As of {new Date(data.as_of).toLocaleString()}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="CRE Prices"
              value={metrics.cre_price_yoy != null ? formatChange(metrics.cre_price_yoy) : "—"}
              tone={changeTone(metrics.cre_price_yoy)}
              detail="Year-over-year broad property price change"
            />
            <StatTile
              label="Loan Delinquency"
              value={metrics.cre_delinquency_rate != null ? `${metrics.cre_delinquency_rate.toFixed(2)}%` : "—"}
              tone={metrics.cre_delinquency_rate != null && metrics.cre_delinquency_rate >= 3 ? "text-rose-300" : "text-amber-300"}
              detail={metrics.cre_delinquency_delta_1y != null ? `${metrics.cre_delinquency_delta_1y > 0 ? "+" : ""}${metrics.cre_delinquency_delta_1y.toFixed(2)} pp vs one year ago` : "Quarterly bank CRE delinquency rate"}
            />
            <StatTile
              label="Bank CRE Loans"
              value={loanBalance != null ? `$${(loanBalance / 1000).toFixed(2)}T` : "—"}
              tone="text-violet-300"
              detail={metrics.cre_loan_growth_yoy != null ? `${formatChange(metrics.cre_loan_growth_yoy)} year over year` : "Outstanding commercial-bank exposure"}
            />
            <StatTile
              label="Funding Backdrop"
              value={metrics.treasury_10y != null ? `${metrics.treasury_10y.toFixed(2)}% 10Y` : "—"}
              tone={metrics.treasury_10y != null && metrics.treasury_10y >= 5 ? "text-rose-300" : "text-sky-300"}
              detail={metrics.credit_spread_bps != null ? `HY OAS ${metrics.credit_spread_bps.toFixed(0)} bps` : "Treasury and credit-spread context"}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Pressure Map"
          title="What is driving the commercial read"
          detail="Higher scores mean more pressure. The top-line score combines listed property-type breadth, bank loan performance, property prices, and the funding backdrop."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.factors.map((factor) => (
            <div key={factor.key} className="surface-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-stealth-200">{factor.label}</p>
                  <p className="mt-1 text-xs text-stealth-500">{factor.weight.toFixed(0)}% of CRE pressure</p>
                </div>
                <p className={`text-xl font-semibold ${pressureTone(factor.score)}`}>{factor.score.toFixed(0)}</p>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-stealth-700">
                <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${factor.score}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Property Types"
          title="Commercial is not one market"
          detail="Each basket uses three liquid listed proxies. Office is shown beside logistics, retail, apartments, and digital infrastructure instead of being treated as the commercial market by itself."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {orderedGroups.map((group) => (
            <div key={group.group} className="surface-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="mb-2 block h-1 w-8 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#94a3b8" }} />
                  <p className="text-sm font-semibold text-stealth-100">{group.label}</p>
                </div>
                <p className={`text-lg font-semibold ${pressureTone(group.score)}`}>{group.score.toFixed(0)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-stealth-500">20D</p>
                  <p className={`mt-0.5 font-mono ${changeTone(group.changes["20d"])}`}>{formatChange(group.changes["20d"])}</p>
                </div>
                <div>
                  <p className="text-stealth-500">60D</p>
                  <p className={`mt-0.5 font-mono ${changeTone(group.changes["60d"])}`}>{formatChange(group.changes["60d"])}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-4 text-stealth-500">{group.components.join(" · ")}</p>
            </div>
          ))}
        </div>
        <PropertyTypeChart data={data.property_type_history} groups={data.groups} />
      </div>

      {selectedContext && (
        <div className="surface-card-strong p-3 sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeader
              kicker="Longer Horizon"
              title="Commercial supply, demand, and pricing context"
              detail="One window controls all three sector diagnostics. Labels distinguish direct sector data from broader public-market proxies."
            />
            <span className="rounded-full border border-stealth-700 bg-stealth-900/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-stealth-400">
              {selectedContext.coverage}
            </span>
          </div>
          <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div
              className="flex w-full max-w-full gap-1 overflow-x-auto rounded-xl border border-stealth-700 bg-stealth-900/50 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
              role="tablist"
              aria-label="Commercial property type context"
              tabIndex={0}
            >
              {sectorContexts.map((context) => {
                const active = context.group === selectedContext.group;
                return (
                  <button
                    key={context.group}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedSector(context.group)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${active ? "bg-sky-500/15 text-sky-300" : "text-stealth-400 hover:bg-stealth-800 hover:text-stealth-200"}`}
                  >
                    {context.label}
                  </button>
                );
              })}
            </div>
            <div className="control-strip justify-self-start lg:justify-self-end" role="group" aria-label="Commercial longer-horizon window">
              {REAL_ESTATE_HORIZONS.map(({ years, label }) => (
                <button
                  key={years}
                  type="button"
                  aria-pressed={horizonYears === years}
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
          <div className="mt-4 grid items-start gap-3 md:gap-4 xl:grid-cols-3">
            <SectorSupplyCard context={selectedContext} color={GROUP_COLORS[selectedContext.group] ?? "#38bdf8"} horizonYears={horizonYears} />
            <SectorDemandSupplyCard context={selectedContext} horizonYears={horizonYears} />
            <SectorPriceCard context={selectedContext} color={GROUP_COLORS[selectedContext.group] ?? "#a78bfa"} horizonYears={horizonYears} />
          </div>
          <p className="text-xs leading-5 text-stealth-500">
            {selectedContext.label} public-data series: {selectedContext.sources.map((source) => `${source.series_id} (${source.label})`).join(" · ")}
          </p>
        </div>
      )}

      <div className="space-y-3">
        <SectionHeader
          kicker="Fundamentals"
          title="Credit cycle and bank exposure"
          detail="Quarterly property prices and delinquencies provide the slower fundamental check beneath the daily listed-market signal."
        />
        <div className="grid items-start gap-3 md:gap-4 xl:grid-cols-2">
          <CreditCycleChart price={data.macro.cre_price_yoy} delinquency={data.macro.cre_delinquency} />
          <LendingChart loans={data.macro.cre_loans} />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Constituents"
          title="Listed commercial real-estate proxies"
          detail="Price action is a timely market signal, not a direct appraisal or property-level valuation. Use the table to see which names are driving each property-type basket."
        />
        <DataScroller
          label="Listed commercial real-estate proxy performance"
          className="surface-card-strong"
        >
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-stealth-700 text-xs uppercase tracking-[0.12em] text-stealth-500">
              <tr>
                <th className="px-4 py-3">Property Type</th>
                <th className="px-3 py-3">Proxy</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">20D</th>
                <th className="px-3 py-3 text-right">60D</th>
                <th className="px-3 py-3 text-right">120D</th>
                <th className="px-4 py-3 text-right">Pressure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stealth-800">
              {[...data.symbols]
                .sort((left, right) => left.group.localeCompare(right.group) || right.momentum_score - left.momentum_score)
                .map((symbol) => (
                  <tr key={symbol.ticker} className="transition-colors hover:bg-stealth-800/60">
                    <td className="px-4 py-3 text-stealth-300">{data.groups.find((group) => group.group === symbol.group)?.label ?? symbol.group}</td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-stealth-100">{symbol.ticker}</p>
                      <p className="mt-0.5 text-xs text-stealth-500">{symbol.name}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-stealth-200">{symbol.current_price != null ? `$${symbol.current_price.toFixed(2)}` : "—"}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["20d"])}`}>{formatChange(symbol.changes["20d"])}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["60d"])}`}>{formatChange(symbol.changes["60d"])}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["120d"])}`}>{formatChange(symbol.changes["120d"])}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${pressureTone(symbol.momentum_score)}`}>{symbol.momentum_score.toFixed(0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </DataScroller>
      </div>

      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          {data.warnings.join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-stealth-500">
        <p>{data.availability.available_count}/{data.availability.total_configured} listed proxies available.</p>
        <p className="max-w-4xl text-right">
          Sources: Yahoo Finance listed proxies; FRED BOGZ1FL010000386Q, CREACBM027NBOG, DRCRELEXFACBS, DGS10, and BAMLH0A0HYM2.
        </p>
      </div>
    </div>
  );
}
