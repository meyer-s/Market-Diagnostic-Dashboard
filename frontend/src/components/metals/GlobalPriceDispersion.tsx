import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Database, RefreshCw } from "lucide-react";
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

import { useApi } from "../../hooks/useApi";
import { CHART_NEUTRAL } from "../../utils/chartUtils";

/*
THESIS: Exchange direction should be visible before the evidence receipt, while unmatched venue prices remain explicitly non-comparable.
OWN-WORLD: One indexed evidence field, direct metal and range controls, named line toggles, and a compact latest-quote rail.
STORY: Choose a metal, scan exchange direction, select a venue, then open the source receipt only when needed.
FIRST VIEWPORT: The trend chart is the primary surface; current venue evidence sits beside it and source detail stays one disclosure away.
FORM: Operate-first exchange trend field. No synthetic history and no color-only state.
*/

type ComparabilityStatus = "reference" | "reference_only" | "comparable" | "adjusted" | "headline_only" | "unavailable";

interface VenueObservation {
  registry_id: string;
  venue: string;
  country: string;
  market_type: string;
  product_name: string;
  symbol: string | null;
  contract_month: string | null;
  local_price: number | null;
  currency: string;
  native_currency: string;
  native_unit: string;
  contract_size: string | null;
  fx_rate_local_per_usd: number | null;
  fx_timestamp: string | null;
  normalized_price: number | null;
  premium_pct: number | null;
  premium_type: "comparable_premium" | "headline_gap" | null;
  price_type: string | null;
  quote_timestamp: string | null;
  session_status: string;
  freshness_status: "fresh" | "delayed" | "stale" | "unknown" | "unavailable";
  quote_age_hours: number | null;
  data_delay: string;
  volume: number | null;
  open_interest: number | null;
  liquidity_tier: string;
  purity: string | null;
  delivery_location: string | null;
  tax_basis: string;
  source_name: string;
  redistribution_status: string;
  availability_status: "observed" | "unavailable";
  comparability_status: ComparabilityStatus;
  comparability_reasons: string[];
  decomposition: {
    reference_price: number | null;
    fx_conversion_pct: number | null;
    carry_adjustment_pct: number | null;
    tax_adjustment_pct: number | null;
    delivery_adjustment_pct: number | null;
    unexplained_basis_pct: number | null;
  } | null;
}

interface SourceStatus {
  provider_id: string;
  provider_name: string;
  status: "live" | "cached" | "stale_cache" | "unavailable" | string;
  fetched_at: string | null;
  source_url: string | null;
  source_tier?: string | null;
  history_scope?: string | null;
  observation_count?: number;
  coverage_start?: string;
  coverage_end?: string;
  error?: string | null;
}

interface DispersionResponse {
  as_of: string;
  metal: string;
  metal_name: string;
  canonical_currency: string;
  canonical_unit: string;
  comparison_ready: boolean;
  reference: {
    registry_id: string | null;
    label: string;
    normalized_price: number | null;
  };
  summary: {
    global_median: number | null;
    highest: { venue: string; price: number } | null;
    lowest: { venue: string; price: number } | null;
    dispersion_pct: number | null;
    registered_venues: number;
    observed_venues: number;
    comparable_venues: number;
    status_counts: {
      fresh: number;
      delayed: number;
      stale: number;
      unavailable: number;
      session_unverified: number;
    };
  };
  venues: VenueObservation[];
  sources: SourceStatus[];
  limitations: string[];
  method: {
    normalization: string;
    premium: string;
    comparability_rule: string;
    license_rule: string;
  };
}

interface HistoryPoint {
  date: string;
  quote_timestamp: string;
  normalized_price: number;
  index_value: number;
  change_pct: number;
  local_price: number;
  currency: string;
  native_unit: string;
  fx_rate_local_per_usd: number | null;
  fx_timestamp: string | null;
}

interface HistorySeries {
  registry_id: string;
  provider_id: string;
  venue: string;
  country: string;
  market_type: string;
  product_name: string;
  symbol: string | null;
  source_name: string;
  source_status: string;
  source_tier: string | null;
  source_url: string | null;
  history_scope: string;
  canonical_currency: string;
  canonical_unit: string;
  coverage_start: string;
  coverage_end: string;
  observation_count: number;
  baseline_price: number;
  latest_price: number;
  change_pct: number;
  points: HistoryPoint[];
}

interface HistoryResponse {
  as_of: string;
  metal: string;
  metal_name: string;
  days_requested: number;
  mode: "indexed_change";
  baseline: number;
  canonical_currency: string;
  canonical_unit: string;
  series: HistorySeries[];
  summary: {
    historical_venues: number;
    registered_venues: number;
    latest_history_date: string | null;
  };
  sources: SourceStatus[];
  venues_without_history: Array<{ registry_id: string; venue: string; product_name: string }>;
  limitations: string[];
}

const METALS = [
  { metal: "AG", name: "Silver" },
  { metal: "AU", name: "Gold" },
  { metal: "PT", name: "Platinum" },
  { metal: "PD", name: "Palladium" },
  { metal: "CU", name: "Copper" },
  { metal: "AL", name: "Aluminum" },
];

const RANGES = [
  { days: 30, label: "1M" },
  { days: 90, label: "3M" },
  { days: 365, label: "1Y" },
];

const LINE_STYLES = [
  { color: "#60a5fa", dash: undefined },
  { color: "#fbbf24", dash: "8 4" },
  { color: "#34d399", dash: "3 4" },
  { color: "#f472b6", dash: "11 4 2 4" },
  { color: "#a78bfa", dash: "6 3 2 3" },
  { color: "#22d3ee", dash: "2 5" },
];

const STATUS_LABELS: Record<ComparabilityStatus, { mark: string; label: string; className: string }> = {
  reference: { mark: "●", label: "Reference", className: "text-amber-200" },
  reference_only: { mark: "○", label: "Reference only", className: "text-orange-200" },
  comparable: { mark: "●", label: "Comparable", className: "text-emerald-200" },
  adjusted: { mark: "◆", label: "Adjusted", className: "text-sky-200" },
  headline_only: { mark: "○", label: "Headline only", className: "text-orange-200" },
  unavailable: { mark: "×", label: "Unavailable", className: "text-stealth-300" },
};

function formatTimestamp(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function formatDate(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function priceDigits(unit: string): number {
  if (unit === "lb") return 4;
  if (unit === "metric tonne") return 0;
  return 2;
}

function formatCanonical(value: number | null, currency: string, unit: string): string {
  if (value == null) return "Not available";
  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: priceDigits(unit),
    maximumFractionDigits: priceDigits(unit),
  })} / ${unit}`;
}

function formatLocal(row: VenueObservation): string {
  if (row.local_price == null) return "Not connected";
  return `${row.currency} ${row.local_price.toLocaleString("en-US", { maximumFractionDigits: 4 })} / ${row.native_unit}`;
}

function formatGap(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMove(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function freshnessLabel(row: VenueObservation): string {
  if (row.availability_status === "unavailable") return "No quote";
  if (row.quote_age_hours == null) return "Age unknown";
  const age = row.quote_age_hours < 48
    ? `${Math.max(1, Math.round(row.quote_age_hours))}h`
    : `${Math.round(row.quote_age_hours / 24)}d`;
  return `${row.freshness_status} · ${age}`;
}

function formatFx(row: VenueObservation): string {
  if (row.fx_rate_local_per_usd == null) return "FX not connected";
  return `${row.fx_rate_local_per_usd.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${row.currency}/USD · ${formatTimestamp(row.fx_timestamp)}`;
}

function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-stealth-800 py-2.5 last:border-b-0">
      <dt className="text-xs text-stealth-400">{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-stealth-100">{children}</dd>
    </div>
  );
}

export default function GlobalPriceDispersion() {
  const [metal, setMetal] = useState("AG");
  const [days, setDays] = useState(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const latestEndpoint = `/precious-metals/global-price-dispersion?metal=${metal}&comparison_time=latest_available&reference=auto&basis=raw_converted`;
  const historyEndpoint = `/precious-metals/global-price-dispersion/history?metal=${metal}&days=${days}`;
  const latest = useApi<DispersionResponse>(latestEndpoint, { retainPreviousData: false });
  const history = useApi<HistoryResponse>(historyEndpoint, { retainPreviousData: false });

  useEffect(() => {
    const availableIds = new Set([
      ...(latest.data?.venues.map((row) => row.registry_id) ?? []),
      ...(history.data?.series.map((row) => row.registry_id) ?? []),
    ]);
    if (selectedId && availableIds.has(selectedId)) return;
    setSelectedId(
      history.data?.series[0]?.registry_id
      ?? latest.data?.venues.find((row) => row.availability_status === "observed")?.registry_id
      ?? null,
    );
  }, [history.data, latest.data, selectedId]);

  useEffect(() => {
    setHiddenSeries(new Set());
  }, [history.data?.as_of, history.data?.metal, days]);

  const observedVenues = latest.data?.venues.filter((row) => row.availability_status === "observed") ?? [];
  const unavailableVenues = latest.data?.venues.filter((row) => row.availability_status === "unavailable") ?? [];
  const selected = latest.data?.venues.find((row) => row.registry_id === selectedId) ?? null;
  const selectedHistory = history.data?.series.find((row) => row.registry_id === selectedId) ?? null;
  const visibleSeries = history.data?.series.filter((row) => !hiddenSeries.has(row.registry_id)) ?? [];

  const lineStyleById = useMemo(() => new Map(
    (history.data?.series ?? []).map((series, index) => [series.registry_id, LINE_STYLES[index % LINE_STYLES.length]]),
  ), [history.data?.series]);

  const seriesNameById = useMemo(() => new Map(
    (history.data?.series ?? []).map((series) => [series.registry_id, `${series.venue} · ${series.product_name}`]),
  ), [history.data?.series]);

  const chartData = useMemo(() => {
    const rowByDate = new Map<string, Record<string, string | number>>();
    (history.data?.series ?? []).forEach((series) => {
      series.points.forEach((point) => {
        const row = rowByDate.get(point.date) ?? { date: point.date };
        row[series.registry_id] = point.index_value;
        rowByDate.set(point.date, row);
      });
    });
    return Array.from(rowByDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [history.data?.series]);

  const refreshAll = () => {
    latest.refetch();
    history.refetch();
  };

  const toggleSeries = (registryId: string) => {
    setSelectedId(registryId);
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(registryId)) next.delete(registryId);
      else next.add(registryId);
      return next;
    });
  };

  const currentMetal = METALS.find((item) => item.metal === metal)?.name ?? metal;
  const hasAnyData = Boolean(latest.data || history.data);
  const bothFailed = Boolean(latest.error && history.error && !hasAnyData);

  return (
    <section id="global-price-dispersion" className="section-anchor surface-card-strong overflow-hidden" aria-labelledby="global-dispersion-heading">
      <div className="border-b border-stealth-700 px-4 py-4 md:px-5 md:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="global-dispersion-heading" className="text-xl font-bold text-white md:text-2xl">Global exchange trends</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-stealth-600 bg-stealth-900 px-2.5 py-1 text-xs font-semibold text-stealth-200">
                <Database size={13} aria-hidden="true" />
                {history.data?.summary.historical_venues ?? 0} histories · {latest.data?.summary.observed_venues ?? 0} latest
              </span>
            </div>
            <p className="mt-1 max-w-[68ch] text-sm text-stealth-300">
              Indexed exchange direction with the latest normalized quote beside it. Each line starts at 100; gaps are not arbitrage signals.
            </p>
          </div>

          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-stealth-600 bg-stealth-900 px-3 text-sm font-semibold text-stealth-100 transition hover:border-blue-400 hover:bg-stealth-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label="Refresh exchange trends and latest quotes"
          >
            <RefreshCw size={15} aria-hidden="true" /> <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full flex-nowrap gap-1.5 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0" role="group" aria-label="Metal">
            {METALS.map((item) => (
              <button
                key={item.metal}
                type="button"
                onClick={() => setMetal(item.metal)}
                aria-pressed={metal === item.metal}
                className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  metal === item.metal
                    ? "bg-blue-500/15 text-blue-100 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.42)]"
                    : "text-stealth-300 hover:bg-stealth-800 hover:text-white"
                }`}
              >
                {item.name} <span className="text-xs opacity-70">{item.metal}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5" role="group" aria-label="Trend range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                className={`min-h-11 min-w-12 rounded-xl px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  days === range.days
                    ? "bg-stealth-100 text-stealth-950"
                    : "border border-stealth-700 text-stealth-300 hover:border-stealth-500 hover:text-white"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {bothFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-8 md:px-5" role="alert">
          <div className="flex items-start gap-3 text-red-100">
            <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
            <div>
              <div className="font-semibold">Exchange data could not load</div>
              <div className="mt-1 text-sm text-red-200">{history.error || latest.error}</div>
            </div>
          </div>
          <button type="button" onClick={refreshAll} className="min-h-11 rounded-xl border border-red-400/60 px-4 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200">Try again</button>
        </div>
      ) : (
        <>
          {(history.error || latest.error) && (
            <div className="flex items-center gap-2 border-b border-amber-700/40 bg-amber-950/20 px-4 py-2.5 text-sm text-amber-100 md:px-5" role="status">
              <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
              {history.error ? "History is unavailable; latest venue quotes remain below." : "Latest quotes are unavailable; source-backed history remains visible."}
            </div>
          )}

          <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 border-b border-stealth-700 p-4 md:p-5 xl:border-b-0 xl:border-r">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{currentMetal} · indexed move</h3>
                  <p className="mt-1 text-xs text-stealth-400">100 = each venue’s first available close in this window</p>
                </div>
                <span className="text-xs text-stealth-400">Through {formatDate(history.data?.summary.latest_history_date ?? null)}</span>
              </div>

              {history.data?.series.length ? (
                <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={`${currentMetal} histories shown on chart`}>
                  {history.data.series.map((series) => {
                    const style = lineStyleById.get(series.registry_id) ?? LINE_STYLES[0];
                    const shown = !hiddenSeries.has(series.registry_id);
                    return (
                      <button
                        key={series.registry_id}
                        type="button"
                        onClick={() => toggleSeries(series.registry_id)}
                        aria-pressed={shown}
                        aria-label={`${shown ? "Hide" : "Show"} ${series.venue} ${series.product_name}`}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                          shown ? "border-stealth-500 bg-stealth-900 text-white" : "border-stealth-800 text-stealth-400"
                        }`}
                      >
                        <span className="h-0.5 w-5" style={{ backgroundColor: shown ? style.color : "#64748b" }} aria-hidden="true" />
                        <span>{series.venue}</span>
                        <span className="font-normal text-stealth-400">{series.observation_count} obs</span>
                        <span className={series.change_pct >= 0 ? "text-emerald-200" : "text-rose-200"}>{formatMove(series.change_pct)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-4 h-[330px] md:h-[390px]">
                {history.loading && !history.data ? (
                  <div className="flex h-full items-center justify-center" role="status">
                    <div className="w-full max-w-lg">
                      <div className="h-1 overflow-hidden rounded-full bg-stealth-800"><div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" /></div>
                      <p className="mt-3 text-center text-sm text-stealth-300">Loading exchange history…</p>
                    </div>
                  </div>
                ) : !history.data?.series.length ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-stealth-700 px-6 text-center text-sm text-stealth-300">
                    No source-backed {currentMetal.toLowerCase()} history is available for this window. Latest quotes still appear beside the chart.
                  </div>
                ) : visibleSeries.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-stealth-700 px-6 text-center text-sm text-stealth-300">
                    Turn on a venue above to draw its history.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      accessibilityLayer
                      aria-label={`${currentMetal} exchange histories indexed to 100 over ${days} days`}
                      data={chartData}
                      margin={{ top: 8, right: 12, left: -6, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 5" stroke={CHART_NEUTRAL.grid} vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke={CHART_NEUTRAL.axis}
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                        minTickGap={28}
                        tickFormatter={(value) => {
                          const parsed = new Date(`${String(value)}T12:00:00Z`);
                          return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
                        }}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        stroke={CHART_NEUTRAL.axis}
                        tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                        tickFormatter={(value) => Number(value).toFixed(0)}
                        width={44}
                      />
                      <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 5" label={{ value: "Start 100", fill: CHART_NEUTRAL.label, fontSize: 12, position: "insideTopLeft" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: CHART_NEUTRAL.tooltipBg,
                          border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`,
                          borderRadius: "0.75rem",
                          color: CHART_NEUTRAL.text,
                        }}
                        labelFormatter={(value) => formatDate(String(value))}
                        formatter={(value, name) => [Number(value).toFixed(2), seriesNameById.get(String(name)) ?? String(name)]}
                      />
                      {visibleSeries.map((series) => {
                        const style = lineStyleById.get(series.registry_id) ?? LINE_STYLES[0];
                        return (
                          <Line
                            key={series.registry_id}
                            type="monotone"
                            dataKey={series.registry_id}
                            name={series.registry_id}
                            stroke={style.color}
                            strokeDasharray={style.dash}
                            strokeWidth={selectedId === series.registry_id ? 3 : 2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              <p className="mt-3 max-w-[72ch] text-xs leading-relaxed text-stealth-400">
                Compare direction, not absolute prices. Products, closes, calendars, tax, delivery, and available windows can differ.
              </p>
            </div>

            <aside className="bg-stealth-950/30 p-4 md:p-5" aria-labelledby="latest-venue-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 id="latest-venue-heading" className="font-semibold text-white">Latest quotes</h3>
                  <p className="mt-1 text-xs text-stealth-400">Normalized to {latest.data?.canonical_currency ?? "USD"}/{latest.data?.canonical_unit ?? "unit"}</p>
                </div>
                {latest.data ? <span className="text-xs text-stealth-400">{observedVenues.length}/{latest.data.summary.registered_venues} live</span> : null}
              </div>

              {latest.loading && !latest.data ? (
                <div className="mt-5 text-sm text-stealth-300" role="status">Loading latest venue quotes…</div>
              ) : observedVenues.length ? (
                <div className="mt-4 space-y-1" role="group" aria-label={`${currentMetal} latest venue quotes`}>
                  {observedVenues.map((row) => {
                    const status = STATUS_LABELS[row.comparability_status];
                    const isSelected = row.registry_id === selectedId;
                    return (
                      <button
                        key={row.registry_id}
                        type="button"
                        onClick={() => setSelectedId(row.registry_id)}
                        aria-pressed={isSelected}
                        aria-controls="selected-venue-receipt"
                        className={`grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                          isSelected ? "bg-blue-500/10 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.4)]" : "hover:bg-stealth-800/65"
                        }`}
                        aria-label={`${row.venue}, ${row.product_name}, ${formatCanonical(row.normalized_price, latest.data!.canonical_currency, latest.data!.canonical_unit)}, ${status.label}`}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-semibold text-white">
                            {row.venue}
                            <span className={`text-xs ${status.className}`}><span aria-hidden="true">{status.mark}</span> {status.label}</span>
                          </span>
                          <span className="mt-1 block truncate text-xs text-stealth-400">{row.product_name}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-semibold text-stealth-100">{formatCanonical(row.normalized_price, latest.data!.canonical_currency, latest.data!.canonical_unit)}</span>
                          <span className="mt-1 block text-xs text-stealth-400">{formatGap(row.premium_pct)} · {freshnessLabel(row)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-4 text-sm text-stealth-300">No current venue quote is available.</p>
              )}

              {(selected || selectedHistory) && (
                <div id="selected-venue-receipt" className="mt-4 border-t border-stealth-700 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-stealth-400">Selected venue</p>
                      <h4 className="mt-1 font-semibold text-white">{selected?.venue ?? selectedHistory?.venue} · {selected?.product_name ?? selectedHistory?.product_name}</h4>
                    </div>
                    {selectedHistory ? (
                      <span className={selectedHistory.change_pct >= 0 ? "text-sm font-semibold text-emerald-200" : "text-sm font-semibold text-rose-200"}>
                        {formatMove(selectedHistory.change_pct)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div><span className="text-stealth-400">Latest</span><div className="mt-0.5 font-semibold text-stealth-100">{selected && latest.data ? formatCanonical(selected.normalized_price, latest.data.canonical_currency, latest.data.canonical_unit) : "n/a"}</div></div>
                    <div><span className="text-stealth-400">Updated</span><div className="mt-0.5 font-semibold text-stealth-100">{selected?.quote_timestamp ? formatTimestamp(selected.quote_timestamp) : formatDate(selectedHistory?.coverage_end ?? null)}</div></div>
                  </div>
                  {selected?.comparability_reasons.length ? (
                    <p className="mt-3 text-xs leading-relaxed text-orange-100">Not like-for-like: {selected.comparability_reasons.join(" · ")}</p>
                  ) : null}

                  <details className="mt-3 border-t border-stealth-800 pt-2">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stealth-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                      Full receipt <ChevronDown size={15} aria-hidden="true" />
                    </summary>
                    {selected ? (
                      <dl>
                        <DetailValue label="Instrument">{selected.symbol ?? "Symbol unavailable"} · {selected.market_type}{selected.contract_month ? ` · ${selected.contract_month}` : " · month unavailable"}</DetailValue>
                        <DetailValue label="Native quote">{formatLocal(selected)}</DetailValue>
                        <DetailValue label="FX">{formatFx(selected)}</DetailValue>
                        <DetailValue label="Quote">{selected.price_type ?? "Type unavailable"} · {formatTimestamp(selected.quote_timestamp)} · {selected.data_delay}</DetailValue>
                        <DetailValue label="Basis">{selected.tax_basis} · {selected.purity ?? "purity unavailable"} · {selected.delivery_location ?? "delivery unavailable"}</DetailValue>
                        <DetailValue label="Source">{selected.source_name} · {selected.redistribution_status}</DetailValue>
                      </dl>
                    ) : selectedHistory ? (
                      <dl>
                        <DetailValue label="Coverage">{formatDate(selectedHistory.coverage_start)} – {formatDate(selectedHistory.coverage_end)} · {selectedHistory.observation_count} observations</DetailValue>
                        <DetailValue label="Source">{selectedHistory.source_name} · {selectedHistory.history_scope}</DetailValue>
                      </dl>
                    ) : null}
                  </details>
                </div>
              )}
            </aside>
          </div>

          <details className="border-t border-stealth-700">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-stealth-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 md:px-5">
              Data, sources & method <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="border-t border-stealth-800">
              <div className="overflow-x-auto p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 md:p-5" role="region" aria-label={`${currentMetal} exchange trend summary table`} tabIndex={0}>
                <table className="w-full min-w-[760px] text-left text-xs">
                  <caption className="pb-3 text-left text-stealth-300">Source-backed series shown on the indexed chart.</caption>
                  <thead className="text-stealth-400">
                    <tr>{["Venue", "Product", "Window", "Observations", "Start", "Latest", "Move", "Source"].map((heading) => <th key={heading} scope="col" className="border-b border-stealth-700 px-2 py-2 font-semibold">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="text-stealth-200">
                    {(history.data?.series ?? []).map((series) => (
                      <tr key={series.registry_id} className="border-b border-stealth-800 align-top last:border-b-0">
                        <th scope="row" className="px-2 py-3 font-semibold text-white">{series.venue}</th>
                        <td className="px-2 py-3">{series.product_name}</td>
                        <td className="px-2 py-3">{formatDate(series.coverage_start)} – {formatDate(series.coverage_end)}</td>
                        <td className="px-2 py-3">{series.observation_count}</td>
                        <td className="px-2 py-3">{formatCanonical(series.baseline_price, series.canonical_currency, series.canonical_unit)}</td>
                        <td className="px-2 py-3">{formatCanonical(series.latest_price, series.canonical_currency, series.canonical_unit)}</td>
                        <td className="px-2 py-3 font-semibold">{formatMove(series.change_pct)}</td>
                        <td className="px-2 py-3">{series.source_name}<div className="mt-1 text-stealth-400">{series.history_scope}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-5 border-t border-stealth-800 bg-stealth-950/40 px-4 py-4 md:grid-cols-2 md:px-5">
                <div>
                  <h3 className="text-sm font-semibold text-white">Latest venue coverage</h3>
                  <p className="mt-1 text-xs text-stealth-400">{unavailableVenues.length} registered venues currently lack a usable quote. They are not drawn as history.</p>
                  <div className="mt-3 overflow-x-auto" role="region" aria-label={`${currentMetal} latest venue coverage table`} tabIndex={0}>
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead className="text-stealth-400"><tr><th className="border-b border-stealth-700 px-2 py-2">Venue</th><th className="border-b border-stealth-700 px-2 py-2">Product</th><th className="border-b border-stealth-700 px-2 py-2">State</th><th className="border-b border-stealth-700 px-2 py-2">Latest</th></tr></thead>
                      <tbody>{(latest.data?.venues ?? []).map((row) => (
                        <tr key={row.registry_id} className="border-b border-stealth-800 last:border-b-0">
                          <th scope="row" className="px-2 py-2 font-semibold text-white">{row.venue}</th>
                          <td className="px-2 py-2 text-stealth-200">{row.product_name}</td>
                          <td className={`px-2 py-2 font-semibold ${STATUS_LABELS[row.comparability_status].className}`}>{STATUS_LABELS[row.comparability_status].label}</td>
                          <td className="px-2 py-2 text-stealth-200">{latest.data ? formatCanonical(row.normalized_price, latest.data.canonical_currency, latest.data.canonical_unit) : "n/a"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-white">How this is built</h3>
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-stealth-300">
                    {(history.data?.limitations ?? [
                      "Each series starts at 100 at its first source-backed observation.",
                      "Different products and closes are not absolute price comparisons.",
                    ]).map((item) => <li key={item}>• {item}</li>)}
                    {latest.data ? <li>• {latest.data.method.normalization}</li> : null}
                  </ul>
                  <div className="mt-4 space-y-2">
                    {[...(history.data?.sources ?? []), ...(latest.data?.sources ?? [])]
                      .filter((source, index, all) => all.findIndex((candidate) => candidate.provider_id === source.provider_id && candidate.history_scope === source.history_scope) === index)
                      .map((source) => (
                        <div key={`${source.provider_id}:${source.history_scope ?? "latest"}`} className="flex items-start justify-between gap-3 border-t border-stealth-800 pt-2 text-xs">
                          <span className="text-stealth-200">{source.provider_name}<span className="mt-0.5 block text-stealth-400">{source.history_scope ?? "Latest observation"}</span></span>
                          <span className={source.status === "unavailable" ? "font-semibold text-orange-200" : "font-semibold text-emerald-200"}>{source.status.replace(/_/g, " ")}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
