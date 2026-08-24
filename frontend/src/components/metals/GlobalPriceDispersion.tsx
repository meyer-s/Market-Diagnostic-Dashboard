import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
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
import { getMetricColor } from "../../theme/metricColors";
import { CHART_NEUTRAL } from "../../utils/chartUtils";

/*
THESIS: Exchange direction should be visible before the evidence receipt, while unmatched venue prices remain explicitly non-comparable.
OWN-WORLD: One continuous metal-colored trend, direct metal and range controls, optional venue paths, and a compact latest-quote rail.
STORY: Choose a metal, read the global path, reveal venue evidence when useful, then open the source receipt only when needed.
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
  aligned_index_value: number;
  change_pct: number;
  daily_return_pct: number | null;
  local_price: number;
  currency: string;
  native_unit: string;
  fx_rate_local_per_usd: number | null;
  fx_timestamp: string | null;
}

interface CompositeContributor {
  venue: string;
  registry_ids: string[];
  return_pct: number;
  source_tier: "official_primary" | "fallback";
}

interface CompositePoint {
  date: string;
  index_value: number;
  change_pct: number;
  daily_return_pct: number | null;
  contributor_count: number;
  contributors: CompositeContributor[];
  source_quality: "baseline" | "official_primary" | "fallback";
}

interface HistoryComposite {
  registry_id: "global_direction";
  label: string;
  coverage_start: string;
  coverage_end: string;
  observation_count: number;
  latest_index_value: number;
  change_pct: number;
  min_contributors: number;
  max_contributors: number;
  official_primary_days: number;
  fallback_days: number;
  points: CompositePoint[];
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
  alignment_date: string;
  alignment_index_value: number;
  points: HistoryPoint[];
}

interface HistoryResponse {
  as_of: string;
  metal: string;
  metal_name: string;
  days_requested: number;
  mode: "composite_direction";
  baseline: number;
  canonical_currency: string;
  canonical_unit: string;
  composite: HistoryComposite | null;
  series: HistorySeries[];
  summary: {
    historical_venues: number;
    registered_venues: number;
    latest_history_date: string | null;
    official_primary_venues: number;
    composite_min_contributors: number;
    composite_max_contributors: number;
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

const VENUE_DASHES = ["7 5", "2 5", "11 4 2 4", "5 3 1 3", "3 7", "9 3"];

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

function TrendTooltip({
  active,
  label,
  payload,
  seriesNames,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{
    dataKey?: string | number;
    value?: string | number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  seriesNames: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const contributorCount = Number(row.composite_contributor_count ?? 0);
  const contributors = String(row.composite_contributors ?? "");
  const sourceQuality = String(row.composite_source_quality ?? "");
  return (
    <div className="max-w-[260px] rounded-xl border border-stealth-600 bg-stealth-950/95 px-3 py-2.5 shadow-lg shadow-black/30">
      <div className="text-xs font-semibold text-white">{formatDate(label ?? null)}</div>
      <div className="mt-2 space-y-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? "");
          if (typeof item.value !== "number") return null;
          return (
            <div key={key} className="flex items-center justify-between gap-4 text-xs">
              <span className="min-w-0 truncate text-stealth-300">{seriesNames.get(key) ?? key}</span>
              <span className="font-semibold tabular-nums text-white">{item.value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      {contributorCount > 0 ? (
        <div className="mt-2 border-t border-stealth-700 pt-2 text-[11px] leading-relaxed text-stealth-400">
          {sourceQuality === "official_primary" ? "Official" : "Fallback"} · {contributorCount} {contributorCount === 1 ? "market" : "markets"}: {contributors}
        </div>
      ) : null}
    </div>
  );
}

export default function GlobalPriceDispersion() {
  const [metal, setMetal] = useState("AG");
  const [days, setDays] = useState(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVenuePaths, setShowVenuePaths] = useState(false);

  const latestEndpoint = `/precious-metals/global-price-dispersion?metal=${metal}&comparison_time=latest_available&reference=auto&basis=raw_converted`;
  const historyEndpoint = `/precious-metals/global-price-dispersion/history?metal=${metal}&days=${days}`;
  const latest = useApi<DispersionResponse>(latestEndpoint, { retainPreviousData: false });
  const history = useApi<HistoryResponse>(historyEndpoint, { retainPreviousData: false, timeoutMs: 40_000 });

  useEffect(() => {
    const availableIds = new Set([
      ...(latest.data?.venues.map((row) => row.registry_id) ?? []),
      ...(history.data?.series.map((row) => row.registry_id) ?? []),
    ]);
    if (selectedId && availableIds.has(selectedId)) return;
    setSelectedId(
      history.data?.series[0]?.registry_id
      ?? latest.data?.reference.registry_id
      ?? latest.data?.venues.find((row) => row.availability_status === "observed")?.registry_id
      ?? null,
    );
  }, [history.data, latest.data, selectedId]);

  useEffect(() => setShowVenuePaths(false), [metal, days]);

  const observedVenues = (latest.data?.venues.filter((row) => row.availability_status === "observed") ?? []).sort((left, right) => (
    Number(right.registry_id === latest.data?.reference.registry_id)
    - Number(left.registry_id === latest.data?.reference.registry_id)
  ));
  const unavailableVenues = latest.data?.venues.filter((row) => row.availability_status === "unavailable") ?? [];
  const selected = latest.data?.venues.find((row) => row.registry_id === selectedId) ?? null;
  const selectedHistory = history.data?.series.find((row) => row.registry_id === selectedId) ?? null;
  const seriesNameById = useMemo(() => new Map<string, string>(
    [
      ["global_direction", history.data?.composite?.label ?? "Global trend"] as [string, string],
      ...(history.data?.series ?? []).map((series): [string, string] => [series.registry_id, `${series.venue} · ${series.product_name}`]),
    ],
  ), [history.data?.composite?.label, history.data?.series]);

  const chartData = useMemo(() => {
    const rowByDate = new Map<string, Record<string, string | number>>();
    history.data?.composite?.points.forEach((point) => {
      const row = rowByDate.get(point.date) ?? { date: point.date };
      row.global_direction = point.index_value;
      row.composite_contributor_count = point.contributor_count;
      row.composite_contributors = point.contributors.map((item) => item.venue).join(", ");
      row.composite_source_quality = point.source_quality;
      rowByDate.set(point.date, row);
    });
    (history.data?.series ?? []).forEach((series) => {
      series.points.forEach((point) => {
        const row = rowByDate.get(point.date);
        if (!row) return;
        row[series.registry_id] = point.aligned_index_value;
      });
    });
    return Array.from(rowByDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [history.data?.composite, history.data?.series]);

  const refreshAll = () => {
    latest.refetch();
    history.refetch();
  };

  const currentMetal = METALS.find((item) => item.metal === metal)?.name ?? metal;
  const currentRange = RANGES.find((item) => item.days === days)?.label ?? `${days}D`;
  const metalColor = getMetricColor(metal);
  const venueColor = getMetricColor(metal, "muted");
  const composite = history.data?.composite ?? null;
  const contributorRange = composite
    ? composite.min_contributors === composite.max_contributors
      ? `${composite.min_contributors} ${composite.min_contributors === 1 ? "market" : "markets"}/day`
      : `${composite.min_contributors}–${composite.max_contributors} markets/day`
    : null;
  const hasAnyData = Boolean(latest.data || history.data);
  const bothFailed = Boolean(latest.error && history.error && !hasAnyData);

  return (
    <section id="global-price-dispersion" className="section-anchor surface-card-strong overflow-hidden" aria-labelledby="global-dispersion-heading">
      <div className="border-b border-stealth-700 px-4 py-4 md:px-6 md:py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="global-dispersion-heading" className="text-xl font-bold text-white md:text-2xl">Global exchange trends</h2>
            <p className="mt-1 text-sm text-stealth-300">Track how the same metal is moving across markets.</p>
          </div>

          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-stealth-600 bg-stealth-900 text-stealth-200 transition hover:border-blue-400 hover:bg-stealth-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label="Refresh exchange trends and latest quotes"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-stealth-950/65 p-1 lg:w-auto lg:flex lg:flex-wrap" role="group" aria-label="Metal">
            {METALS.map((item) => (
              <button
                key={item.metal}
                type="button"
                onClick={() => setMetal(item.metal)}
                aria-pressed={metal === item.metal}
                style={metal === item.metal ? {
                  color: getMetricColor(item.metal),
                  boxShadow: `inset 0 0 0 1px ${getMetricColor(item.metal)}80`,
                } : undefined}
                className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:px-3 sm:text-sm ${
                  metal === item.metal
                    ? "bg-stealth-800"
                    : "text-stealth-300 hover:bg-stealth-800 hover:text-white"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getMetricColor(item.metal) }} aria-hidden="true" />
                {item.name}
              </button>
            ))}
          </div>
          <div className="flex w-fit gap-1 rounded-xl bg-stealth-950/65 p-1" role="group" aria-label="Trend range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                className={`min-h-11 min-w-12 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  days === range.days
                    ? "bg-stealth-100 text-stealth-950"
                    : "text-stealth-300 hover:bg-stealth-800 hover:text-white"
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

          <div className="min-w-0 p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-lg font-semibold text-white">{currentMetal} global trend</h3>
                  {composite ? (
                    <span className={`text-sm font-semibold tabular-nums ${composite.change_pct >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                      {currentRange} {formatMove(composite.change_pct)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-stealth-400">Daily venue-return composite · base 100</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {composite ? (
                  <p className="text-right text-xs text-stealth-400">
                    {contributorRange} · through {formatDate(composite.coverage_end)}
                  </p>
                ) : null}
                {history.data?.series.length ? (
                  <button
                    type="button"
                    onClick={() => setShowVenuePaths((current) => !current)}
                    aria-pressed={showVenuePaths}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-stealth-200 transition hover:bg-stealth-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <span className="h-0.5 w-5" style={{ backgroundColor: venueColor }} aria-hidden="true" />
                    {showVenuePaths ? "Hide venue paths" : `Show ${history.data.series.length} venue paths`}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 h-[290px] sm:h-[350px] lg:h-[430px]">
                {history.loading && !history.data ? (
                  <div className="flex h-full items-center justify-center" role="status">
                    <div className="w-full max-w-lg">
                      <div className="h-1 overflow-hidden rounded-full bg-stealth-800"><div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" /></div>
                      <p className="mt-3 text-center text-sm text-stealth-300">Loading exchange history…</p>
                    </div>
                  </div>
                ) : !history.data?.composite ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-stealth-700 px-6 text-center text-sm text-stealth-300">
                    No source-backed {currentMetal.toLowerCase()} history is available for this window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      accessibilityLayer
                      aria-label={`${currentMetal} global exchange trend over ${days} days`}
                      data={chartData}
                      margin={{ top: 12, right: 18, left: -6, bottom: 0 }}
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
                      <ReferenceLine y={100} stroke="#64748b" strokeDasharray="4 5" label={{ value: "100", fill: CHART_NEUTRAL.label, fontSize: 12, position: "insideTopLeft" }} />
                      <Tooltip content={<TrendTooltip seriesNames={seriesNameById} />} />
                      {showVenuePaths ? history.data.series.map((series, index) => (
                          <Line
                            key={series.registry_id}
                            type="linear"
                            dataKey={series.registry_id}
                            name={series.registry_id}
                            stroke={venueColor}
                            strokeOpacity={selectedId === series.registry_id ? 0.75 : 0.4}
                            strokeDasharray={VENUE_DASHES[index % VENUE_DASHES.length]}
                            strokeWidth={selectedId === series.registry_id ? 2 : 1.4}
                            dot={false}
                            activeDot={{ r: 3 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                      )) : null}
                      <Line
                        type="linear"
                        dataKey="global_direction"
                        name="global_direction"
                        stroke={metalColor}
                        strokeWidth={3.5}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stealth-800 pt-3 text-xs text-stealth-400">
              <span>Official markets lead; verified fallbacks fill uncovered days.</span>
              {latest.data ? <span>{latest.data.summary.observed_venues} current quotes</span> : null}
            </div>
          </div>

          <details className="border-t border-stealth-700">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-stealth-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 md:px-6">
              <span>Venue prices &amp; sources</span>
              <span className="inline-flex items-center gap-2 text-xs font-normal text-stealth-400">
                {observedVenues.length} quotes <ChevronDown size={15} aria-hidden="true" />
              </span>
            </summary>
            <div className="border-t border-stealth-800 bg-stealth-950/30 p-4 md:p-6">
              {latest.loading && !latest.data ? (
                <div className="text-sm text-stealth-300" role="status">Loading venue prices…</div>
              ) : (
                <div className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300" role="region" aria-label={`${currentMetal} exchange trend summary table`} tabIndex={0}>
                <table className="w-full min-w-[720px] text-left text-xs">
                  <caption className="pb-3 text-left text-sm font-semibold text-white">Current normalized prices</caption>
                  <thead className="text-stealth-400">
                    <tr>{["Venue", "Product", "Latest", currentRange, "State", "Updated"].map((heading) => <th key={heading} scope="col" className="border-b border-stealth-700 px-2 py-2 font-semibold">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="text-stealth-200">
                    {(latest.data?.venues ?? []).map((row) => {
                      const rowHistory = history.data?.series.find((series) => series.registry_id === row.registry_id);
                      const status = STATUS_LABELS[row.comparability_status];
                      const isSelected = row.registry_id === selectedId;
                      return (
                        <tr key={row.registry_id} className="border-b border-stealth-800 align-top last:border-b-0">
                          <th scope="row" className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedId(row.registry_id)}
                              aria-pressed={isSelected}
                              aria-controls="selected-venue-receipt"
                              aria-label={`${row.venue}, ${row.product_name}, ${formatCanonical(row.normalized_price, latest.data!.canonical_currency, latest.data!.canonical_unit)}, ${status.label}`}
                              className={`min-h-11 rounded-lg px-2 text-left font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${isSelected ? "bg-blue-500/10 text-blue-100" : "text-white hover:bg-stealth-800"}`}
                            >
                              {row.venue}
                            </button>
                          </th>
                          <td className="px-2 py-3">{row.product_name}</td>
                          <td className="px-2 py-3 tabular-nums">{formatCanonical(row.normalized_price, latest.data!.canonical_currency, latest.data!.canonical_unit)}</td>
                          <td className="px-2 py-3 font-semibold tabular-nums">{rowHistory ? formatMove(rowHistory.change_pct) : "—"}</td>
                          <td className={`px-2 py-3 font-semibold ${status.className}`}>{status.mark} {status.label}</td>
                          <td className="px-2 py-3">{freshnessLabel(row)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {(selected || selectedHistory) && (
                <div id="selected-venue-receipt" className="mt-6 border-t border-stealth-700 pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{selected?.venue ?? selectedHistory?.venue} source receipt</h3>
                      <p className="mt-1 text-xs text-stealth-400">{selected?.product_name ?? selectedHistory?.product_name}</p>
                    </div>
                    {selectedHistory ? <span className="text-sm font-semibold tabular-nums text-stealth-100">{currentRange} {formatMove(selectedHistory.change_pct)}</span> : null}
                  </div>
                  {selected ? (
                    <dl className="mt-3 grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
                      <DetailValue label="Instrument">{selected.symbol ?? "Symbol unavailable"} · {selected.market_type}{selected.contract_month ? ` · ${selected.contract_month}` : " · month unavailable"}</DetailValue>
                      <DetailValue label="Native quote">{formatLocal(selected)}</DetailValue>
                      <DetailValue label="FX">{formatFx(selected)}</DetailValue>
                      <DetailValue label="Quote">{selected.price_type ?? "Type unavailable"} · {formatTimestamp(selected.quote_timestamp)} · {selected.data_delay}</DetailValue>
                      <DetailValue label="Basis">{selected.tax_basis} · {selected.purity ?? "purity unavailable"} · {selected.delivery_location ?? "delivery unavailable"}</DetailValue>
                      <DetailValue label="Source">{selected.source_name} · {selected.redistribution_status}</DetailValue>
                      {selectedHistory ? <DetailValue label="History">{formatDate(selectedHistory.coverage_start)} – {formatDate(selectedHistory.coverage_end)} · {selectedHistory.observation_count} observations · {selectedHistory.history_scope}</DetailValue> : null}
                    </dl>
                  ) : selectedHistory ? (
                    <dl className="mt-3 grid gap-x-6 md:grid-cols-2">
                      <DetailValue label="Coverage">{formatDate(selectedHistory.coverage_start)} – {formatDate(selectedHistory.coverage_end)} · {selectedHistory.observation_count} observations</DetailValue>
                      <DetailValue label="Source">{selectedHistory.source_name} · {selectedHistory.history_scope}</DetailValue>
                    </dl>
                  ) : null}
                  {selected?.comparability_reasons.length ? <p className="mt-3 text-xs text-orange-100">Not like-for-like: {selected.comparability_reasons.join(" · ")}</p> : null}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 border-t border-stealth-700 pt-5 lg:flex-row lg:items-start lg:justify-between">
                <p className="max-w-[72ch] text-xs leading-relaxed text-stealth-400">
                  Prices are normalized to {latest.data?.canonical_currency ?? "USD"}/{latest.data?.canonical_unit ?? "unit"}. The global line chains daily venue returns; venue paths join it at first overlap and do not imply a price spread.
                  {unavailableVenues.length ? ` ${unavailableVenues.length} registered ${unavailableVenues.length === 1 ? "venue is" : "venues are"} currently unavailable.` : ""}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Data source status">
                  {[...(history.data?.sources ?? []), ...(latest.data?.sources ?? [])]
                    .filter((source, index, all) => all.findIndex((candidate) => candidate.provider_id === source.provider_id) === index)
                    .map((source) => (
                      <span key={source.provider_id} className="inline-flex items-center gap-1.5 text-stealth-300">
                        {source.provider_name}
                        <span className={source.status === "unavailable" ? "font-semibold text-orange-200" : "font-semibold text-emerald-200"}>{source.status.replace(/_/g, " ")}</span>
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
