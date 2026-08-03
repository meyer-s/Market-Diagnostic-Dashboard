/**
 * Stock Analysis Page
 * 
 * Single stock lookup and analysis across trailing windows.
 * Allows users to search for any stock and compare transparent lookback scores.
 * 
 * Features:
 * - Stock ticker search and lookup
 * - Multi-window analysis: 21-day, 3-month, 6-month, and 12-month lookbacks
 * - Interactive trailing-score profile
 * - Detailed scoring breakdown with composite signal-quality metrics
 * - Price analysis with volatility-based reference bands
 * - Comparison against SPY benchmark
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ComposedChart,
  Bar,
  Area,
  Cell,
} from "recharts";
import { PriceAnalysisChart } from "../components/widgets/PriceAnalysisChart";
import { ConvictionSnapshot } from "../components/widgets/ConvictionSnapshot";
import { TechnicalIndicators, type TechnicalData } from "../components/widgets/TechnicalIndicators.tsx";
import {
  OptionalityMispricingWidget,
  type OptionalityMetrics,
} from "../components/widgets/OptionalityMispricingWidget";
import { OptionsStructureMap } from "../components/widgets/OptionsStructureMap";
import MarketLoading from "../components/ui/MarketLoading";
import "../index.css";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { getFamilyColor } from "../theme/metricColors";
import { ApiError, apiFetch, getErrorMessage } from "../utils/apiUtils";
import { buildHolisticSummary } from "../utils/holisticSummary";
import { buildSummaryInputFromSnapshot } from "../utils/summaryInput";
import InfoTooltip from "../components/ui/InfoTooltip";

type ChartDataColumn = {
  key: string;
  label: string;
  format?: (value: string | number | null | undefined) => string;
};

function ChartDataDisclosure({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Array<Record<string, string | number | null | undefined>>;
  columns: ChartDataColumn[];
}) {
  return (
    <details className="mt-3 border-t border-stealth-700 pt-2 text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-2 font-semibold text-stealth-300 hover:bg-stealth-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        View {title.toLowerCase()} data
      </summary>
      <div
        className="max-w-full overflow-x-auto rounded-lg border border-stealth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        role="region"
        aria-label={`${title} values`}
        tabIndex={0}
      >
        <table className="w-full min-w-[26rem] text-left">
          <caption className="sr-only">{title} chart values</caption>
          <thead className="bg-stealth-900 text-stealth-300">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 font-semibold">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${String(row.date ?? rowIndex)}-${rowIndex}`} className="border-t border-stealth-800">
                {columns.map((column) => {
                  const value = row[column.key];
                  return (
                    <td key={column.key} className="px-3 py-2 font-mono tabular-nums text-stealth-200">
                      {column.format ? column.format(value) : value ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface StockProjection {
  ticker: string;
  name: string;
  horizon: string;
  score_total: number;
  score_trend: number;
  score_relative_strength: number;
  score_risk: number;
  score_regime: number;
  trailing_return_pct: number;
  volatility: number;
  max_drawdown: number;
  conviction: number;
  current_price: number;
  take_profit: number;
  raw_upper_reference?: number;
  valuation_adjusted_target?: number;
  trade_target?: number;
  speculative_extension?: number | null;
  sanity_flags?: Array<{
    type: string;
    severity?: string;
    message?: string;
    threshold?: number;
    value?: number;
  }>;
  implied_market_cap?: {
    current?: number | null;
    raw_upper_reference?: number | null;
    valuation_adjusted_target?: number | null;
    trade_target?: number | null;
    speculative_extension?: number | null;
  };
  target_regime?: string;
  stop_loss: number;
  analysis_kind?: "trailing_window" | string;
  lookback_days?: number;
  trailing_price_return_pct?: number;
  return_basis?: "adjusted_close" | "raw_close_fallback" | string;
}

type ProjectionHorizon = "T" | "3m" | "6m" | "12m";

const HORIZON_OPTIONS: ReadonlyArray<{ value: ProjectionHorizon; label: string }> = [
  { value: "T", label: "21D" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
];

const HORIZON_LABELS: Record<ProjectionHorizon, string> = {
  T: "21D",
  "3m": "3M",
  "6m": "6M",
  "12m": "12M",
};

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

interface DataWarning {
  type: string;
  details?: Record<string, unknown>;
}

// TechnicalData is imported from TechnicalIndicators

interface OptionsWall {
  strike: number;
  open_interest: number;
  volume: number;
}

interface OptionsFlowData {
  expiry: string;
  as_of: string;
  call_walls: OptionsWall[];
  put_walls: OptionsWall[];
  call_open_interest_total: number;
  put_open_interest_total: number;
  call_volume_total: number;
  put_volume_total: number;
  put_call_oi_ratio: number | null;
  observed_at?: string | null;
  data_source?: string | null;
  quote_source?: string | null;
}

interface FundamentalPoint {
  date: string;
  value: number;
}

interface FundamentalSeries {
  series: FundamentalPoint[];
  derived?: boolean;
}

interface FundamentalSnapshotMetric {
  value: number | null;
  period_end?: string | null;
  change_pct?: number | null;
  derived?: boolean;
}

interface FundamentalSnapshot {
  eps_ttm?: FundamentalSnapshotMetric;
  revenue_ttm?: FundamentalSnapshotMetric;
  free_cash_flow_ttm?: FundamentalSnapshotMetric;
  roe_ttm?: FundamentalSnapshotMetric;
  pe_ratio?: FundamentalSnapshotMetric;
  market_cap?: FundamentalSnapshotMetric;
}

interface FundamentalsPayload {
  eps?: FundamentalSeries;
  roe?: FundamentalSeries;
  free_cash_flow?: FundamentalSeries;
  market_cap?: FundamentalSeries;
  pe_ratio?: FundamentalSeries;
  revenue?: FundamentalSeries;
  revenue_yoy?: FundamentalSeries;
  eps_annual?: FundamentalSeries;
  roe_annual?: FundamentalSeries;
  free_cash_flow_annual?: FundamentalSeries;
  market_cap_annual?: FundamentalSeries;
  pe_ratio_annual?: FundamentalSeries;
  revenue_annual?: FundamentalSeries;
  revenue_yoy_annual?: FundamentalSeries;
  as_of?: string | null;
  retrieved_at?: string | null;
  snapshot?: FundamentalSnapshot;
}

interface ObservationMetadata {
  source?: string | null;
  observed_at?: string | null;
  retrieved_at?: string | null;
  cache_updated_at?: string | null;
  cache_age_seconds?: number | null;
  observation_age_seconds?: number | null;
  stale?: boolean;
  refresh_attempted?: boolean;
  refresh_succeeded?: boolean;
  refresh_error?: string | null;
  adjusted_close_coverage_pct?: number | null;
}

interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

type HistoryWindow = "252d" | "1y" | "5y" | "max";
interface IntradayHistoryPoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface InstitutionalFlowEvent {
  date: string;
  price: number;
  volume: number;
  notional: number;
  volume_z: number;
  clv: number;
  price_change_pct: number;
  side: "buy" | "sell" | "neutral";
  strength: number;
}

interface InstitutionalFlowPayload {
  summary: {
    signal: "accumulation" | "distribution" | "neutral";
    confidence: number;
    buy_cluster_level: number | null;
    sell_cluster_level: number | null;
    distance_to_buy_pct: number | null;
    distance_to_sell_pct: number | null;
    buy_notional_usd: number;
    sell_notional_usd: number;
    net_flow_usd: number;
    event_count: number;
  };
  event_history: InstitutionalFlowEvent[];
}

interface FlowTimelineBucket {
  bucket: string;
  buy_notional_usd: number;
  sell_notional_usd: number;
  neutral_notional_usd: number;
  net_flow_usd: number;
  total_notional_usd: number;
  buy_events: number;
  sell_events: number;
  neutral_events: number;
}

function formatFlowCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 0 : 2,
  }).format(value);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatFlowPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getSignalClasses(signal: "accumulation" | "distribution" | "neutral"): string {
  if (signal === "accumulation") return "border-emerald-700/50 bg-emerald-950/35 text-emerald-300";
  if (signal === "distribution") return "border-rose-700/50 bg-rose-950/35 text-rose-300";
  return "border-stealth-600 bg-stealth-800/80 text-stealth-300";
}

function getSignalStrengthStrokeClass(signal: "accumulation" | "distribution" | "neutral"): string {
  if (signal === "accumulation") return "stroke-emerald-300/75 drop-shadow-[0_0_5px_rgba(74,222,128,0.2)]";
  if (signal === "distribution") return "stroke-rose-300/75 drop-shadow-[0_0_5px_rgba(251,113,133,0.2)]";
  return "stroke-stealth-300/70 drop-shadow-[0_0_4px_rgba(148,163,184,0.16)]";
}

function SignalStrengthArc({ strength, signal }: { strength: number; signal: "accumulation" | "distribution" | "neutral" }) {
  const normalizedStrength = Math.max(0, Math.min(100, strength));
  const strokeWidth = 10;
  const radius = 50 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedStrength / 100);

  return (
    <div
      className="inline-flex h-4 w-4 items-center"
      role="img"
      aria-label={`Signal strength ${normalizedStrength.toFixed(0)} out of 100`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="fill-none stroke-white/8" strokeWidth={strokeWidth} />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className={`fill-none ${getSignalStrengthStrokeClass(signal)}`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </div>
  );
}

function GroupBadge({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "buy" | "sell" }) {
  const toneClass =
    tone === "buy"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : tone === "sell"
      ? "border-rose-700/40 bg-rose-950/30 text-rose-300"
      : "border-stealth-700 bg-stealth-900/70 text-stealth-200";

  return (
    <div className={`rounded-xl border px-2.5 py-1.5 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CenteredFlowBar({ value, scale }: { value: number | null; scale: number }) {
  const numericValue = value ?? 0;
  const magnitude = scale > 0 ? Math.max(5, Math.min(50, (Math.abs(numericValue) / scale) * 50)) : 0;
  const toneClass = numericValue > 0 ? "bg-emerald-400/85" : numericValue < 0 ? "bg-rose-400/85" : "bg-stealth-400/60";

  return (
    <div className="relative h-3 overflow-hidden rounded-full border border-stealth-700 bg-stealth-950/90">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-stealth-400/80" />
      {numericValue === 0 ? (
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stealth-300/80" />
      ) : (
        <div
          className={`absolute inset-y-0 ${toneClass}`}
          style={numericValue > 0 ? { left: "50%", width: `${magnitude}%` } : { right: "50%", width: `${magnitude}%` }}
        />
      )}
    </div>
  );
}

function longestDirectionalStreak(timeline: FlowTimelineBucket[], direction: "positive" | "negative"): number {
  let longest = 0;
  let current = 0;

  timeline.forEach((bucket) => {
    const matches = direction === "positive" ? bucket.net_flow_usd > 0 : bucket.net_flow_usd < 0;
    if (matches) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  });

  return longest;
}

function formatBucket(bucket: string): string {
  return new Date(bucket).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function TrendZoneBar({ value, scale, certainty }: { value: number | null; scale: number; certainty: number }) {
  const numericValue = value ?? 0;
  const direction = numericValue > 0 ? "positive" : numericValue < 0 ? "negative" : "neutral";
  const baseReach = scale > 0 ? Math.max(6, Math.min(50, (Math.abs(numericValue) / scale) * 50)) : 0;
  const totalReach = Math.max(8, Math.min(50, certainty * 50));
  const certaintyReach = Math.max(baseReach, Math.min(50, baseReach * (0.7 + certainty * 0.45)));
  const counterReach = direction === "neutral" ? totalReach : Math.max(5, Math.min(totalReach, totalReach * 0.42));
  const straddleClass =
    direction === "positive"
      ? "bg-[linear-gradient(90deg,rgba(148,163,184,0.12),rgba(110,231,183,0.16),rgba(110,231,183,0.12))]"
      : direction === "negative"
      ? "bg-[linear-gradient(90deg,rgba(251,113,133,0.12),rgba(251,113,133,0.16),rgba(148,163,184,0.12))]"
      : "bg-[linear-gradient(90deg,rgba(148,163,184,0.12),rgba(148,163,184,0.18),rgba(148,163,184,0.12))]";
  const glowClass = direction === "positive" ? "bg-emerald-400/25" : direction === "negative" ? "bg-rose-400/25" : "bg-stealth-400/20";
  const bodyClass = direction === "positive" ? "bg-emerald-300/90" : direction === "negative" ? "bg-rose-300/90" : "bg-stealth-300/75";

  return (
    <div className="relative h-6 overflow-hidden rounded-full border border-stealth-800 bg-stealth-950/90">
      <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-stealth-500/80" />
      <div className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full ${straddleClass}`} style={{ left: `${50 - totalReach}%`, width: `${totalReach * 2}%` }} />
      {direction === "neutral" ? (
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stealth-300/80 shadow-[0_0_12px_rgba(148,163,184,0.25)]" />
      ) : (
        <>
          <div className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${direction === "positive" ? "bg-emerald-200/28" : "bg-rose-200/28"}`} style={direction === "positive" ? { right: "50%", width: `${counterReach}%` } : { left: "50%", width: `${counterReach}%` }} />
          <div className={`absolute top-1/2 h-4 -translate-y-1/2 rounded-full ${glowClass}`} style={direction === "positive" ? { left: "50%", width: `${certaintyReach}%` } : { right: "50%", width: `${certaintyReach}%` }} />
          <div className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${bodyClass}`} style={direction === "positive" ? { left: "50%", width: `${baseReach}%` } : { right: "50%", width: `${baseReach}%` }} />
        </>
      )}
    </div>
  );
}

function TimelineCluster({ timeline }: { timeline: FlowTimelineBucket[] }) {
  const recentTimeline = timeline.slice(-4);
  const scale = Math.max(1, ...recentTimeline.map((bucket) => Math.abs(bucket.net_flow_usd)));
  const positiveBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd > 0).length;
  const negativeBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd < 0).length;
  const positiveStreak = longestDirectionalStreak(recentTimeline, "positive");
  const negativeStreak = longestDirectionalStreak(recentTimeline, "negative");
  const maxVolume = Math.max(1, ...recentTimeline.map((bucket) => bucket.total_notional_usd));
  const dominantCluster = positiveStreak > negativeStreak
    ? "Positive-bar streak"
    : negativeStreak > positiveStreak
      ? "Negative-bar streak"
      : "Mixed proxy";

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">Proxy Over Time</div>
          <div className="mt-1 text-xs text-stealth-300">{dominantCluster} across the latest weekly buckets.</div>
        </div>
        <div className="flex gap-2 text-xs">
          <GroupBadge label="Positive" value={positiveBuckets} tone="buy" />
          <GroupBadge label="Negative" value={negativeBuckets} tone="sell" />
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {recentTimeline.map((bucket) => {
          const certainty = bucket.total_notional_usd / maxVolume;
          const barCount = bucket.buy_events + bucket.sell_events + bucket.neutral_events;
          return (
            <div key={bucket.bucket} className="grid grid-cols-[54px_minmax(0,1fr)_88px] items-center gap-2 rounded-xl border border-stealth-800 bg-stealth-900/55 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">{formatBucket(bucket.bucket)}</div>
              <TrendZoneBar value={bucket.net_flow_usd} scale={scale} certainty={certainty} />
              <div className="text-right">
                <div className="text-xs font-semibold text-stealth-100">{formatCompactCurrency(bucket.net_flow_usd)}</div>
                <div className="mt-0.5 text-xs uppercase tracking-[0.16em] text-stealth-500">
                  {barCount} {barCount === 1 ? "bar" : "bars"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildFlowTimeline(events: InstitutionalFlowEvent[]): FlowTimelineBucket[] {
  if (!events.length) return [];
  const buckets = new Map<string, FlowTimelineBucket>();

  events.forEach((event) => {
    const eventDate = new Date(event.date);
    if (Number.isNaN(eventDate.getTime())) return;
    const day = eventDate.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(eventDate);
    monday.setUTCDate(eventDate.getUTCDate() + mondayOffset);
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket: key,
        buy_notional_usd: 0,
        sell_notional_usd: 0,
        neutral_notional_usd: 0,
        net_flow_usd: 0,
        total_notional_usd: 0,
        buy_events: 0,
        sell_events: 0,
        neutral_events: 0,
      });
    }

    const target = buckets.get(key)!;
    const notional = Number.isFinite(event.notional) ? Math.abs(event.notional) : 0;
    if (event.side === "buy") {
      target.buy_notional_usd += notional;
      target.buy_events += 1;
      target.net_flow_usd += notional;
    } else if (event.side === "sell") {
      target.sell_notional_usd += notional;
      target.sell_events += 1;
      target.net_flow_usd -= notional;
    } else {
      target.neutral_notional_usd += notional;
      target.neutral_events += 1;
    }
    target.total_notional_usd += notional;
  });

  return Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function FlowFocusCard({
  flow,
  events,
  ticker,
  currentPrice,
  closeLabel,
}: {
  flow: InstitutionalFlowPayload;
  events: InstitutionalFlowEvent[];
  ticker: string;
  currentPrice: number | null;
  closeLabel: string;
}) {
  const summary = flow.summary;
  const signal = summary.signal;
  const toneClasses = getSignalClasses(signal);
  const signalLabel = signal === "accumulation"
    ? "Positive-bar proxy"
    : signal === "distribution"
      ? "Negative-bar proxy"
      : "Mixed proxy";
  const confidencePercent = Math.max(0, Math.min(100, summary.confidence));
  const directionalDenominator = Math.max(Math.abs(summary.buy_notional_usd), Math.abs(summary.sell_notional_usd), 1);
  const normalizedSignal = Math.max(-100, Math.min(100, (summary.net_flow_usd / directionalDenominator) * 100));
  const clusterLow = summary.sell_cluster_level ?? currentPrice ?? summary.buy_cluster_level ?? 0;
  const clusterHigh = summary.buy_cluster_level ?? currentPrice ?? summary.sell_cluster_level ?? 0;
  const clusterRange = Math.max(0.0001, clusterHigh - clusterLow);
  const currentPosition = currentPrice !== null
    ? Math.max(0, Math.min(100, ((currentPrice - clusterLow) / clusterRange) * 100))
    : 50;
  const currentIsInsideCluster = currentPrice !== null && currentPrice >= clusterLow && currentPrice <= clusterHigh;
  const currentInsetPx = 18;
  const currentMarkerStyle = { left: `clamp(${currentInsetPx}px, ${currentPosition}%, calc(100% - ${currentInsetPx}px))` };
  const timeline = buildFlowTimeline(events);

  return (
    <div className="surface-card-strong space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">High-Volume Bar Proxy</div>
          <div className="mt-1 text-sm font-semibold text-stealth-100">{ticker} proxy read</div>
        </div>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${toneClasses}`}>
          {signalLabel}
        </span>
      </div>

      <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">Signed Notional</div>
            <div className={`mt-1 text-base font-semibold ${summary.net_flow_usd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {formatCompactCurrency(summary.net_flow_usd)}
            </div>
          </div>
          <div className="text-right text-xs text-stealth-400">
            <div className="flex justify-end">
              <SignalStrengthArc strength={confidencePercent} signal={signal} />
            </div>
            <div className="mt-0.5">Proxy strength {Math.round(confidencePercent)}/100</div>
            <div>
              {summary.event_count} {summary.event_count === 1 ? "bar" : "bars"} · {formatCompactCurrency(summary.buy_notional_usd + summary.sell_notional_usd)} flagged
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 text-xs uppercase tracking-[0.16em] text-stealth-500">
          <div>
            <div>Negative-Bar Cluster</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-rose-300">{formatFlowCurrency(summary.sell_cluster_level)}</div>
          </div>
          <div className="text-center">
            <div>{closeLabel}</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-stealth-100">{formatFlowCurrency(currentPrice)}</div>
          </div>
          <div className="text-right">
            <div>Positive-Bar Cluster</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-emerald-300">{formatFlowCurrency(summary.buy_cluster_level)}</div>
          </div>
        </div>

        <div className="mt-2 relative">
          <div className="relative h-8 overflow-hidden rounded-full border border-stealth-700 bg-stealth-950/90">
            <div className="absolute inset-y-0 left-0 w-[26%] bg-[radial-gradient(circle_at_left_center,rgba(251,113,133,0.35)_0%,rgba(251,113,133,0.18)_28%,rgba(251,113,133,0.06)_48%,rgba(251,113,133,0)_75%)]" />
            <div className="absolute inset-y-0 right-0 w-[26%] bg-[radial-gradient(circle_at_right_center,rgba(110,231,183,0.35)_0%,rgba(110,231,183,0.18)_28%,rgba(110,231,183,0.06)_48%,rgba(110,231,183,0)_75%)]" />
            <div className="absolute inset-y-[7px] left-5 right-5 rounded-full bg-[linear-gradient(90deg,rgba(251,113,133,0.04),rgba(148,163,184,0.05)_50%,rgba(110,231,183,0.04))]" />
            <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-stealth-500/65" />
            {currentPrice !== null && (
              <>
                <div
                  className={`absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full ${currentIsInsideCluster ? "bg-[radial-gradient(circle,rgba(226,232,240,0.22)_0%,rgba(226,232,240,0.07)_46%,rgba(226,232,240,0)_74%)]" : "bg-[radial-gradient(circle,rgba(226,232,240,0.16)_0%,rgba(226,232,240,0.05)_44%,rgba(226,232,240,0)_74%)]"}`}
                  style={currentMarkerStyle}
                />
                <div
                  className={`absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border ${currentIsInsideCluster ? "border-white/70 shadow-[0_0_0_1px_rgba(241,245,249,0.14),0_0_16px_rgba(226,232,240,0.24)]" : "border-white/55 shadow-[0_0_0_1px_rgba(226,232,240,0.1),0_0_14px_rgba(226,232,240,0.18)]"} bg-stealth-100/90`}
                  style={currentMarkerStyle}
                />
              </>
            )}
          </div>
        </div>

        <div className="mt-3">
          <CenteredFlowBar value={summary.net_flow_usd} scale={directionalDenominator} />
        </div>
        <div className="mt-2 text-right text-xs uppercase tracking-[0.16em] text-stealth-500">
          {formatFlowPercent(normalizedSignal)}
        </div>
      </div>

      {timeline.length > 0 ? <TimelineCluster timeline={timeline} /> : null}

    </div>
  );
}

export default function StockAnalysis() {
  const PROJECTION_CACHE_TTL_MS = 5 * 60 * 1000;
  const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;

  type ProjectionsPayload = {
    projections?: Record<string, StockProjection>;
    historical?: { score_3m_ago?: number; cutoff_date?: string | null };
    technical?: TechnicalData;
    options_flow?: OptionsFlowData;
    optionality?: OptionalityMetrics;
    institutional_flow?: InstitutionalFlowPayload;
    price_history?: PriceHistoryPoint[];
    intraday_history_2h?: IntradayHistoryPoint[];
    price_history_window?: HistoryWindow;
    fundamentals?: FundamentalsPayload;
    analyst_target?: number;
    analyst_count?: number;
    data_warnings?: DataWarning[];
    as_of_date?: string;
    created_at?: string;
    computed_at?: string;
    price_metadata?: ObservationMetadata;
    intraday_metadata?: ObservationMetadata;
  };

  const projectionCacheRef = useRef<Map<string, { payload: ProjectionsPayload; fetchedAt: number }>>(new Map());
  const newsCacheRef = useRef<Map<string, { data: NewsArticle[]; fetchedAt: number }>>(new Map());

  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { symbol: symbolFromPath } = useParams<{ symbol?: string }>();
  const autoLoadedSymbolRef = useRef<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [searchTicker, setSearchTicker] = useState("");
  const [projections, setProjections] = useState<Record<string, StockProjection>>({});
  const [technicalData, setTechnicalData] = useState<TechnicalData | null>(null);
  const [optionsFlow, setOptionsFlow] = useState<OptionsFlowData | null>(null);
  const [optionalityMetrics, setOptionalityMetrics] = useState<OptionalityMetrics | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsPayload | null>(null);
  const [analystTarget, setAnalystTarget] = useState<number | null>(null);
  const [analystCount, setAnalystCount] = useState<number | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [dataWarnings, setDataWarnings] = useState<DataWarning[]>([]);
  const [institutionalFlow, setInstitutionalFlow] = useState<InstitutionalFlowPayload | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [intradayHistory2h, setIntradayHistory2h] = useState<IntradayHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectionUnavailable, setProjectionUnavailable] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState<ProjectionHorizon>("T");
  const [analysisComputedAt, setAnalysisComputedAt] = useState<string | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [priceMetadata, setPriceMetadata] = useState<ObservationMetadata | null>(null);
  const [fundView, setFundView] = useState<"1Y" | "5Y">("1Y");
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>("252d");

  const applyProjectionsPayload = useCallback((payload: ProjectionsPayload | null) => {
    if (payload) {
      setProjections(payload.projections ?? {});
      setTechnicalData(payload.technical || null);
      setOptionsFlow(payload.options_flow || null);
      setOptionalityMetrics(payload.optionality || null);
      setInstitutionalFlow(payload.institutional_flow || null);
      setPriceHistory(payload.price_history || []);
      setIntradayHistory2h(payload.intraday_metadata?.stale ? [] : payload.intraday_history_2h || []);
      setFundamentals(payload.fundamentals || null);
      setAnalystTarget(payload.analyst_target ?? null);
      setAnalystCount(payload.analyst_count ?? null);
      setDataWarnings(payload.data_warnings || []);
      setAnalysisComputedAt(payload.computed_at || payload.created_at || null);
      setDataAsOf(payload.price_metadata?.observed_at || payload.as_of_date || null);
      setPriceMetadata(payload.price_metadata || null);
      return;
    }

    setProjections({});
    setTechnicalData(null);
    setOptionsFlow(null);
    setOptionalityMetrics(null);
    setInstitutionalFlow(null);
    setPriceHistory([]);
    setIntradayHistory2h([]);
    setFundamentals(null);
    setAnalystTarget(null);
    setAnalystCount(null);
    setDataWarnings([]);
    setAnalysisComputedAt(null);
    setDataAsOf(null);
    setPriceMetadata(null);
  }, []);

  const runSearch = useCallback(async (
    rawTicker: string,
    window: HistoryWindow,
    options: { includeNews?: boolean } = {}
  ) => {
    const includeNews = options.includeNews ?? true;
    const normalizedTicker = rawTicker.trim().toUpperCase();
    if (!normalizedTicker) return;

    setTicker(normalizedTicker);
    setSearchTicker(normalizedTicker);
    setLoading(true);
    setError(null);
    setProjectionUnavailable(false);

    let projectionsPayload: ProjectionsPayload | null = null;
    const cacheKey = `${normalizedTicker}:${window}`;
    const now = Date.now();
    const cachedProjection = projectionCacheRef.current.get(cacheKey);
    if (cachedProjection && now - cachedProjection.fetchedAt < PROJECTION_CACHE_TTL_MS) {
      projectionsPayload = cachedProjection.payload;
    }

    if (!projectionsPayload) {
      try {
        const parsedPayload = await apiFetch<ProjectionsPayload>(
          `/stocks/${normalizedTicker}/projections?history_window=${window}`,
          { timeoutMs: 30_000 },
        );
        projectionsPayload = parsedPayload;
        projectionCacheRef.current.set(cacheKey, {
          payload: parsedPayload,
          fetchedAt: now,
        });
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 404) {
          setProjectionUnavailable(true);
        } else {
          setError(getErrorMessage(err));
        }
      }
    }

    if (projectionsPayload) {
      const hasAllRequiredWindows = (["T", "3m", "6m", "12m"] as const).every(
        (horizon) => Boolean(projectionsPayload?.projections?.[horizon])
      );
      setProjectionUnavailable(!hasAllRequiredWindows);
    }

    applyProjectionsPayload(projectionsPayload);

    // Fetch news filtered by ticker (server-side to avoid missing relevant articles)
    if (includeNews) {
      const cachedNews = newsCacheRef.current.get(normalizedTicker);
      if (cachedNews && now - cachedNews.fetchedAt < NEWS_CACHE_TTL_MS) {
        setNews(cachedNews.data);
      } else {
        const tickerNews = await apiFetch<NewsArticle[]>(
          `/news?hours=720&limit=12&symbol=${normalizedTicker}`
        ).catch(() => null); // Last 30 days
        if (tickerNews) {
          const sliced = tickerNews.slice(0, 6);
          setNews(sliced);
          newsCacheRef.current.set(normalizedTicker, { data: sliced, fetchedAt: now });
        } else {
          setNews([]);
        }
      }
    }

    setLoading(false);
  }, [applyProjectionsPayload]);

  useEffect(() => {
    if (!searchTicker) return;
    void runSearch(searchTicker, historyWindow, { includeNews: false });
  }, [historyWindow, searchTicker, runSearch]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSearch(ticker, historyWindow, { includeNews: true });
  };

  useEffect(() => {
    const symbolFromHash = (() => {
      const rawHash = (location.hash || "").replace(/^#/, "");
      if (!rawHash) return "";

      const hashQuery = rawHash.includes("?")
        ? rawHash.split("?").slice(1).join("?")
        : rawHash.includes("=")
          ? rawHash
          : "";
      if (!hashQuery) return "";

      const hashParams = new URLSearchParams(hashQuery);
      return hashParams.get("symbol") || hashParams.get("ticker") || "";
    })();

    const symbolFromQuery = (
      searchParams.get("symbol") ||
      searchParams.get("ticker") ||
      symbolFromPath ||
      symbolFromHash ||
      ""
    )
      .trim()
      .toUpperCase();

    if (!symbolFromQuery) return;
    if (autoLoadedSymbolRef.current === symbolFromQuery) return;

    autoLoadedSymbolRef.current = symbolFromQuery;
    void runSearch(symbolFromQuery, historyWindow, { includeNews: true });
  }, [location.hash, searchParams, symbolFromPath, runSearch, historyWindow]);

  // Prepare data for line chart
  const getChartData = () => {
    const tScore = projections["T"]?.score_total;
    const score3m = projections["3m"]?.score_total;
    const score6m = projections["6m"]?.score_total;
    const score12m = projections["12m"]?.score_total;

    if (
      tScore === undefined ||
      score3m === undefined ||
      score6m === undefined ||
      score12m === undefined
    ) {
      return null;
    }

    return {
      ticker: searchTicker,
      name: projections["3m"].name,
      scores: {
        "T": tScore,
        "3m": score3m,
        "6m": score6m,
        "12m": score12m,
      },
    };
  };

  const chartData = getChartData();

  const horizonLabel = (h: ProjectionHorizon) => HORIZON_LABELS[h];

  const formatObservedDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  const formatComputedTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Format relative time for timestamps
  const getRelativeTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "1d ago";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatCompact = (value: number, digits = 1) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: digits,
    }).format(value);

  const formatDollars = (value: number, digits = 2) =>
    `$${value.toFixed(digits)}`;

  const formatPercent = (value: number, digits = 1) =>
    `${value.toFixed(digits)}%`;

  const formatDateLabel = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

  const summaryInput = useMemo(
    () =>
      technicalData
        ? buildSummaryInputFromSnapshot({
            symbol: searchTicker,
            technicalData,
            fundamentals,
            optionalityMetrics,
            asOf: dataAsOf,
          })
        : null,
    [searchTicker, technicalData, fundamentals, optionalityMetrics, dataAsOf]
  );
  const holisticSummary = useMemo(
    () => (summaryInput ? buildHolisticSummary(summaryInput) : null),
    [summaryInput]
  );
  const latestNewsPublishedAt = useMemo(() => {
    const latestTimestamp = news.reduce((latest, article) => {
      const timestamp = new Date(article.published_at).getTime();
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
    return latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : null;
  }, [news]);
  const visibleDataWarnings = useMemo(
    () => dataWarnings.filter((warning) => {
      if (warning.type === "optionality_quality" || warning.type === "upstream_options_unavailable") return false;
      const interval = warning.details?.interval;
      return !(
        (warning.type === "stale_series" || warning.type === "cache_refresh_failed")
        && interval === "2h"
      );
    }),
    [dataWarnings]
  );

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Single Name Lens</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Stock Analysis</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Compare trailing stock evidence across four lookback windows with quantified signal quality.</p>
        {searchTicker && <div className="mt-4"><span className="page-badge">Tracking {searchTicker}</span></div>}
      </div>
      
      {/* Stock Search */}
      <div className="surface-card-strong p-4 sm:p-6">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="stock-symbol" className="block text-sm font-semibold text-stealth-200">
              Stock symbol
            </label>
            <input
              id="stock-symbol"
              name="symbol"
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g., AAPL, MSFT, TSLA"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 min-h-11 w-full rounded-xl border border-stealth-700 bg-stealth-950/85 px-4 text-base text-white placeholder-stealth-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="min-h-11 whitespace-nowrap rounded-xl bg-white px-6 font-semibold text-stealth-900 transition hover:bg-stealth-100 disabled:cursor-not-allowed disabled:bg-stealth-700 disabled:text-stealth-300"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </form>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-2xl border border-red-700 bg-red-900/20 p-4" role="alert">
          <p className="text-red-300">{error}</p>
          <p className="text-sm text-red-400 mt-2">
            Please check the ticker symbol and try again. The stock must have sufficient historical data available.
          </p>
        </div>
      )}

      {projectionUnavailable && !error && (
        <div className="rounded-2xl border border-yellow-700/50 bg-yellow-900/20 p-4">
          <p className="text-yellow-200">Trailing analysis unavailable for this asset.</p>
        </div>
      )}

      {/* Results */}
      {chartData && (
        <>
          {/* Fundamentals Summary */}
          {projections["T"] && (
            <section id="stock-current-read" aria-label="Current stock read" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
              {(() => {
                const projectionNow = projections["T"];
                const closeLabel = priceMetadata?.stale ? "Last Available Close" : "Latest Close";
                const sourceLabel = priceMetadata?.source?.replace(/_/g, " ");
                const provenanceLabel = [
                  dataAsOf ? `Close ${formatObservedDate(dataAsOf)}` : null,
                  sourceLabel,
                  analysisComputedAt ? `computed ${formatComputedTime(analysisComputedAt)}` : null,
                ].filter(Boolean).join(" · ");

                return (
                  <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold">{chartData.ticker}</h2>
                    {provenanceLabel && (
                      <span className="rounded-full bg-stealth-950/90 px-2 py-0.5 text-xs capitalize text-stealth-500">
                        {provenanceLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-stealth-400">{chartData.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-stealth-400">{closeLabel}</p>
                  <p className="text-2xl font-bold text-blue-400">${projectionNow.current_price.toFixed(2)}</p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-stealth-800 bg-stealth-800 text-xs sm:grid-cols-3">
                <div className="bg-stealth-950/70 px-3 py-2.5">
                  <dt className="text-stealth-400" title="52-week low and high range">52W Range</dt>
                  <dd className="mt-0.5 font-semibold text-stealth-100">
                    {technicalData?.low_52w !== undefined && technicalData?.high_52w !== undefined
                      ? `$${Number(technicalData.low_52w).toFixed(2)} - $${Number(technicalData.high_52w).toFixed(2)}`
                      : "n/a"}
                  </dd>
                </div>
                <div className="bg-stealth-950/70 px-3 py-2.5">
                  <dt className="text-stealth-400" title="Price momentum and exponential moving averages">Trend</dt>
                  <dd
                    className={`font-semibold capitalize ${
                      technicalData?.trend === "uptrend"
                        ? "text-green-400"
                        : technicalData?.trend === "downtrend"
                          ? "text-red-400"
                          : "text-stealth-200"
                    }`}
                  >
                    {technicalData?.trend ?? "n/a"}
                  </dd>
                </div>
                <div className="bg-stealth-950/70 px-3 py-2.5">
                  <dt className="text-stealth-400">Return basis</dt>
                  <dd className={`mt-0.5 font-semibold ${projectionNow.return_basis === "raw_close_fallback" ? "text-amber-300" : "text-stealth-100"}`}>
                    {projectionNow.return_basis === "adjusted_close"
                      ? "Adjusted close"
                      : projectionNow.return_basis === "raw_close_fallback"
                        ? "Raw-close fallback"
                        : "Unavailable"}
                  </dd>
                </div>
              </dl>
                  </>
                );
              })()}
            </section>
          )}

          {/* Price analysis and signal-quality grid */}
          {projections[selectedHorizon] && (
            <section id="stock-price-evidence" aria-label="Price evidence and signal quality" className="scroll-mt-32">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-stealth-100">{horizonLabel(selectedHorizon)} evidence</h2>
                  <p className="mt-0.5 text-xs text-stealth-400">
                    {projections[selectedHorizon].lookback_days ?? "—"} completed trading sessions
                  </p>
                </div>
                <div
                  className="inline-flex w-fit items-center gap-1 rounded-xl border border-stealth-700 bg-stealth-900/70 p-1"
                  role="group"
                  aria-label="Trailing analysis window"
                >
                  {HORIZON_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selectedHorizon === option.value}
                      onClick={() => setSelectedHorizon(option.value)}
                      className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors ${
                        selectedHorizon === option.value
                          ? "bg-stealth-700 text-white"
                          : "text-stealth-300 hover:bg-stealth-800 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {(() => {
                const selectedProjection = projections[selectedHorizon];
                const upperReference = selectedProjection.trade_target ?? selectedProjection.take_profit;

                return (
              <PriceAnalysisChart
                latestClose={selectedProjection.current_price}
                closeLabel={priceMetadata?.stale ? "Last Available Close" : "Latest Close"}
                upperReference={upperReference}
                rawUpperReference={selectedProjection.raw_upper_reference ?? selectedProjection.take_profit}
                lowerReference={selectedProjection.stop_loss}
                trailingReturn={selectedProjection.trailing_price_return_pct ?? selectedProjection.trailing_return_pct}
                horizon={horizonLabel(selectedHorizon)}
                analystTarget={analystTarget}
                analystCount={analystCount}
                targetRegime={selectedProjection.target_regime}
                sanityFlags={selectedProjection.sanity_flags}
              />
                );
              })()}
              <ConvictionSnapshot
                signalQuality={projections[selectedHorizon].conviction}
                score={projections[selectedHorizon].score_total}
                volatility={projections[selectedHorizon].volatility}
                horizon={horizonLabel(selectedHorizon)}
              />
              </div>
            </section>
          )}

          {/* Technical Indicators */}
          {projections["T"] && (
            <TechnicalIndicators
              technicalData={technicalData ?? undefined}
              optionsFlow={optionsFlow}
              optionalityMetrics={optionalityMetrics}
              flowEvents={institutionalFlow?.event_history ?? []}
              priceHistory={priceHistory}
              intradayHistory2h={intradayHistory2h}
              historyWindow={historyWindow}
              onHistoryWindowChange={setHistoryWindow}
              hideOptionsContext={true}
              closeLabel={priceMetadata?.stale ? "Last Available Close" : "Latest Close"}
            />
          )}

          {projections["T"] && (
            <div className="grid grid-cols-1 gap-4 mb-6 xl:grid-cols-2">
              <div className="surface-card-strong p-4 sm:p-5">
                <div>
                  <h3 className="text-sm sm:text-base font-semibold text-stealth-100">Options and Structure</h3>
                  <p className="mt-1 text-xs capitalize text-stealth-400">
                    {[
                      optionsFlow?.expiry ? `expiry ${formatObservedDate(optionsFlow.expiry)}` : null,
                      optionsFlow?.quote_source || optionsFlow?.data_source,
                      optionsFlow?.observed_at || optionsFlow?.as_of
                        ? `observed ${formatObservedDate(optionsFlow.observed_at || optionsFlow.as_of)}`
                        : null,
                    ].filter(Boolean).join(" · ") || "Options chain unavailable"}
                  </p>
                </div>

                <div className="mt-3">
                  <OptionsStructureMap
                    currentPrice={projections["T"].current_price}
                    priceLabel={priceMetadata?.stale ? "Last available close" : "Latest close"}
                    callWalls={optionsFlow?.call_walls ?? []}
                    putWalls={optionsFlow?.put_walls ?? []}
                    sma50={technicalData?.sma_50 ?? null}
                    sma200={technicalData?.sma_200 ?? null}
                    putCallRatio={optionsFlow?.put_call_oi_ratio ?? null}
                    label={searchTicker}
                  />
                </div>

                <div className="mt-3">
                  <OptionalityMispricingWidget
                    metrics={optionalityMetrics}
                  />
                </div>
              </div>

              {institutionalFlow ? (
                <FlowFocusCard
                  flow={institutionalFlow}
                  events={institutionalFlow.event_history ?? []}
                  ticker={searchTicker}
                  currentPrice={projections["T"]?.current_price ?? null}
                  closeLabel={priceMetadata?.stale ? "Last Available Close" : "Latest Close"}
                />
              ) : (
                <div className="surface-card-strong p-4 sm:p-5">
                  <div className="text-xs uppercase tracking-[0.2em] text-stealth-500">High-Volume Bar Proxy</div>
                  <div className="mt-2 rounded-xl border border-dashed border-stealth-700 bg-stealth-900/35 px-3 py-2 text-xs text-stealth-400">
                    High-volume proxy events are unavailable for this symbol.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fundamental Analysis — consolidated */}
          {fundamentals && (() => {
            const isAnnual = fundView === "5Y";
            const epsSeries = (isAnnual ? fundamentals.eps_annual?.series : fundamentals.eps?.series) || [];
            const roeSeries = (isAnnual ? fundamentals.roe_annual?.series : fundamentals.roe?.series) || [];
            const fcfSeries = (isAnnual ? fundamentals.free_cash_flow_annual?.series : fundamentals.free_cash_flow?.series) || [];
            const revSeries = (isAnnual ? fundamentals.revenue_annual?.series : fundamentals.revenue?.series) || [];
            const mcapSeries = (isAnnual ? fundamentals.market_cap_annual?.series : fundamentals.market_cap?.series) || [];
            const peSeries = (isAnnual ? fundamentals.pe_ratio_annual?.series : fundamentals.pe_ratio?.series) || [];
            const yoySeries = (isAnnual ? fundamentals.revenue_yoy_annual?.series : fundamentals.revenue_yoy?.series) || [];

            // Canonical TTM/current snapshot with a cautious legacy fallback.
            const latest = (series: FundamentalPoint[]) =>
              series.length > 0 ? series[series.length - 1].value : null;
            const qoqDelta = (series: FundamentalPoint[]) => {
              if (series.length < 2) return null;
              const cur = series[series.length - 1].value;
              const prev = series[series.length - 2].value;
              if (prev === 0) return null;
              return ((cur - prev) / Math.abs(prev)) * 100;
            };

            const snapshot = fundamentals.snapshot;
            const snapshotValue = (metric: FundamentalSnapshotMetric | undefined, fallback: FundamentalPoint[]) =>
              metric ? metric.value : latest(fallback);
            const snapshotDelta = (metric: FundamentalSnapshotMetric | undefined, fallback: FundamentalPoint[]) =>
              metric ? metric.change_pct ?? null : qoqDelta(fallback);
            const ttmPeriodEnds = Array.from(new Set([
              snapshot?.eps_ttm?.period_end,
              snapshot?.roe_ttm?.period_end,
              snapshot?.free_cash_flow_ttm?.period_end,
              snapshot?.revenue_ttm?.period_end,
            ].filter((periodEnd): periodEnd is string => Boolean(periodEnd))));
            const snapshotPeriodLabel = ttmPeriodEnds.length === 1
              ? `TTM through ${formatObservedDate(ttmPeriodEnds[0])}`
              : ttmPeriodEnds.length > 1
                ? "TTM mixed reporting dates"
                : `Latest ${isAnnual ? "annual" : "quarterly"} values`;
            const priceMetricPeriodEnds = Array.from(new Set([
              snapshot?.pe_ratio?.period_end,
              snapshot?.market_cap?.period_end,
            ].filter((periodEnd): periodEnd is string => Boolean(periodEnd))));
            const hasSnapshotPriceMetrics = Boolean(snapshot?.pe_ratio || snapshot?.market_cap);
            const priceMetricPeriodLabel = !hasSnapshotPriceMetrics
              ? null
              : priceMetricPeriodEnds.length === 1
                ? `price metrics at ${formatObservedDate(priceMetricPeriodEnds[0])} close`
                : priceMetricPeriodEnds.length > 1
                  ? "price metrics at mixed close dates"
                  : dataAsOf
                    ? `price metrics at ${formatObservedDate(dataAsOf)} close`
                    : "price metrics at latest available close";
            const snapMetrics = [
              {
                label: snapshot?.eps_ttm ? "EPS TTM" : "EPS",
                value: snapshotValue(snapshot?.eps_ttm, epsSeries),
                fmt: (value: number) => formatDollars(value, 2),
                delta: snapshotDelta(snapshot?.eps_ttm, epsSeries),
                deltaLabel: snapshot?.eps_ttm ? "vs prior TTM" : isAnnual ? "YoY" : "QoQ",
              },
              {
                label: snapshot?.roe_ttm ? "ROE TTM" : "ROE",
                value: snapshotValue(snapshot?.roe_ttm, roeSeries),
                fmt: (value: number) => formatPercent(value, 1),
                delta: snapshotDelta(snapshot?.roe_ttm, roeSeries),
                deltaLabel: snapshot?.roe_ttm ? "vs prior TTM" : isAnnual ? "YoY" : "QoQ",
              },
              {
                label: snapshot?.free_cash_flow_ttm ? "FCF TTM" : "FCF",
                value: snapshotValue(snapshot?.free_cash_flow_ttm, fcfSeries),
                fmt: (value: number) => `$${formatCompact(value, 1)}`,
                delta: snapshotDelta(snapshot?.free_cash_flow_ttm, fcfSeries),
                deltaLabel: snapshot?.free_cash_flow_ttm ? "vs prior TTM" : isAnnual ? "YoY" : "QoQ",
              },
              {
                label: snapshot?.revenue_ttm ? "Rev TTM" : "Rev",
                value: snapshotValue(snapshot?.revenue_ttm, revSeries),
                fmt: (value: number) => `$${formatCompact(value, 1)}`,
                delta: snapshotDelta(snapshot?.revenue_ttm, revSeries),
                deltaLabel: snapshot?.revenue_ttm ? "vs prior TTM" : isAnnual ? "YoY" : "QoQ",
              },
              {
                label: snapshot?.pe_ratio ? "P/E TTM" : "P/E",
                value: snapshotValue(snapshot?.pe_ratio, peSeries),
                fmt: (value: number) => value.toFixed(1),
                delta: snapshotDelta(snapshot?.pe_ratio, peSeries),
                deltaLabel: snapshot?.pe_ratio ? "vs prior period" : isAnnual ? "YoY" : "QoQ",
              },
              {
                label: "MCap",
                value: snapshotValue(snapshot?.market_cap, mcapSeries),
                fmt: (value: number) => `$${formatCompact(value, 1)}`,
                delta: snapshotDelta(snapshot?.market_cap, mcapSeries),
                deltaLabel: snapshot?.market_cap ? "vs prior period" : isAnnual ? "YoY" : "QoQ",
              },
            ];

            // Merge series by date for dual-axis charts
            const mergeSeries = (
              a: FundamentalPoint[],
              aKey: string,
              b: FundamentalPoint[],
              bKey: string
            ) => {
              const map = new Map<string, Record<string, number | string>>();
              for (const p of a) {
                map.set(p.date, { date: p.date, [aKey]: p.value });
              }
              for (const p of b) {
                const existing = map.get(p.date) || { date: p.date };
                existing[bKey] = p.value;
                map.set(p.date, existing);
              }
              return Array.from(map.values()).sort(
                (x, y) => new Date(x.date as string).getTime() - new Date(y.date as string).getTime()
              );
            };

            const revEpsData = mergeSeries(revSeries, "revenue", epsSeries, "eps");
            const roeFcfData = mergeSeries(roeSeries, "roe", fcfSeries, "fcf");
            const peMcapData = mergeSeries(peSeries, "pe", mcapSeries, "mcap");

            const tooltipStyle = {
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--chart-tooltip-border)",
              borderRadius: "8px",
              fontSize: "12px",
            };

            return (
              <section id="stock-fundamentals" className="surface-card-strong scroll-mt-32 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base sm:text-lg font-semibold">Fundamental Analysis</h3>
                  <div className="flex items-center gap-1 rounded-full border border-stealth-700 bg-stealth-900/60 p-0.5">
                    {(["1Y", "5Y"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={fundView === v}
                        onClick={() => setFundView(v)}
                        className={`min-h-11 rounded-full px-3 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${fundView === v ? "bg-stealth-700 text-white" : "text-stealth-300 hover:text-white"}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Snapshot Strip ── */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
                  {snapMetrics.map((m) => (
                    <div key={m.label} className="secondary-card px-3 py-2 text-center">
                      <div className="mb-1 text-xs uppercase tracking-wider text-stealth-400">{m.label}</div>
                      <div className="text-sm font-semibold text-stealth-100">
                        {m.value !== null ? m.fmt(m.value) : "—"}
                      </div>
                      {m.delta !== null && (
                        <div className={`mt-0.5 text-xs ${m.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {m.delta >= 0 ? "▲" : "▼"} {Math.abs(m.delta).toFixed(1)}% {m.deltaLabel}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mb-4 text-xs text-stealth-400">
                  {[snapshotPeriodLabel, priceMetricPeriodLabel, "Yahoo Finance via yfinance"].filter(Boolean).join(" · ")}
                </div>

                {/* ── Dual-Axis Charts ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Revenue & Earnings */}
                  {revEpsData.length > 0 && (
                    <div className="secondary-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 text-sm font-semibold text-stealth-100">
                          <span>Revenue &amp; Earnings</span>
                          <InfoTooltip id="fund-rev-eps" text="Revenue bars (left axis) overlaid with EPS line (right axis) to show top-line growth alongside per-share profitability." />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("equity"), opacity: 0.35 }} /> Rev</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("growth") }} /> EPS</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <ComposedChart
                            accessibilityLayer
                            aria-label={`${searchTicker} revenue and earnings history`}
                            data={revEpsData}
                          >
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatDollars(v, 0)} tick={{ fill: getFamilyColor("growth"), fontSize: 12 }} tickLine={false} axisLine={false} />
                            <Tooltip
                              formatter={(value: number, name: string) =>
                                name === "revenue" ? [`$${formatCompact(value, 2)}`, "Revenue"] : [formatDollars(value, 2), "EPS"]
                              }
                              labelFormatter={(l) => `${isAnnual ? "FY" : "Q"} ${formatDateLabel(String(l))}`}
                              contentStyle={tooltipStyle}
                            />
                            <Bar yAxisId="left" dataKey="revenue" fill={getFamilyColor("equity")} fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="eps" stroke={getFamilyColor("growth")} strokeWidth={2} dot={{ r: 2.5 }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <ChartDataDisclosure
                        title="Revenue and earnings"
                        rows={revEpsData}
                        columns={[
                          { key: "date", label: "Period", format: (value) => formatDateLabel(String(value ?? "")) },
                          { key: "revenue", label: "Revenue", format: (value) => typeof value === "number" ? `$${formatCompact(value, 2)}` : "—" },
                          { key: "eps", label: "EPS", format: (value) => typeof value === "number" ? formatDollars(value, 2) : "—" },
                        ]}
                      />
                    </div>
                  )}

                  {/* Profitability — ROE & FCF */}
                  {roeFcfData.length > 0 && (
                    <div className="secondary-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 text-sm font-semibold text-stealth-100">
                          <span>Profitability</span>
                          <InfoTooltip id="fund-roe-fcf" text="ROE line (left axis, %) and FCF bars (right axis, $) show how efficiently equity is deployed and how much cash the business generates." />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("growth") }} /> ROE</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("liquidity"), opacity: 0.35 }} /> FCF</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <ComposedChart
                            accessibilityLayer
                            aria-label={`${searchTicker} return on equity and free-cash-flow history`}
                            data={roeFcfData}
                          >
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: getFamilyColor("growth"), fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <Tooltip
                              formatter={(value: number, name: string) =>
                                name === "roe" ? [formatPercent(value, 1), "ROE"] : [`$${formatCompact(value, 2)}`, "FCF"]
                              }
                              labelFormatter={(l) => `${isAnnual ? "FY" : "Q"} ${formatDateLabel(String(l))}`}
                              contentStyle={tooltipStyle}
                            />
                            <Line yAxisId="left" type="monotone" dataKey="roe" stroke={getFamilyColor("growth")} strokeWidth={2} dot={{ r: 2.5 }} />
                            <Bar yAxisId="right" dataKey="fcf" fill={getFamilyColor("liquidity")} fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <ChartDataDisclosure
                        title="Profitability"
                        rows={roeFcfData}
                        columns={[
                          { key: "date", label: "Period", format: (value) => formatDateLabel(String(value ?? "")) },
                          { key: "roe", label: "ROE", format: (value) => typeof value === "number" ? formatPercent(value, 1) : "—" },
                          { key: "fcf", label: "Free cash flow", format: (value) => typeof value === "number" ? `$${formatCompact(value, 2)}` : "—" },
                        ]}
                      />
                    </div>
                  )}

                  {/* Valuation — P/E & Market Cap */}
                  {peMcapData.length > 0 && (
                    <div className="secondary-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 text-sm font-semibold text-stealth-100">
                          <span>Valuation &amp; Scale</span>
                          <InfoTooltip id="fund-pe-mcap" text="P/E ratio (left axis) over market cap area (right axis) shows how valuation multiples move against total company size." />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("sentiment") }} /> P/E</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("financials"), opacity: 0.2 }} /> MCap</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <ComposedChart
                            accessibilityLayer
                            aria-label={`${searchTicker} price-to-earnings ratio and market-capitalization history`}
                            data={peMcapData}
                          >
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => v.toFixed(0)} tick={{ fill: getFamilyColor("sentiment"), fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <Tooltip
                              formatter={(value: number, name: string) =>
                                name === "pe" ? [value.toFixed(1), "P/E"] : [`$${formatCompact(value, 2)}`, "Market Cap"]
                              }
                              labelFormatter={(l) => `${isAnnual ? "FY" : "Q"} ${formatDateLabel(String(l))}`}
                              contentStyle={tooltipStyle}
                            />
                            <Area yAxisId="right" type="monotone" dataKey="mcap" fill={getFamilyColor("financials")} fillOpacity={0.12} stroke={getFamilyColor("financials")} strokeOpacity={0.3} strokeWidth={1} />
                            <Line yAxisId="left" type="monotone" dataKey="pe" stroke={getFamilyColor("sentiment")} strokeWidth={2} dot={{ r: 2.5 }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <ChartDataDisclosure
                        title="Valuation and scale"
                        rows={peMcapData}
                        columns={[
                          { key: "date", label: "Period", format: (value) => formatDateLabel(String(value ?? "")) },
                          { key: "pe", label: "P/E", format: (value) => typeof value === "number" ? value.toFixed(1) : "—" },
                          { key: "mcap", label: "Market cap", format: (value) => typeof value === "number" ? `$${formatCompact(value, 2)}` : "—" },
                        ]}
                      />
                    </div>
                  )}

                  {/* Revenue YoY Growth */}
                  {yoySeries.length > 0 && (
                    <div className="secondary-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 text-sm font-semibold text-stealth-100">
                          <span>Revenue Growth (YoY)</span>
                          <InfoTooltip id="fund-yoy" text="Year-over-year revenue growth comparing each quarter to the same quarter one year prior. Green bars indicate growth, red bars indicate contraction." />
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <ComposedChart
                            accessibilityLayer
                            aria-label={`${searchTicker} year-over-year revenue growth history`}
                            data={yoySeries}
                          >
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
                            <Tooltip
                              formatter={(value: number) => [formatPercent(value, 1), "YoY Growth"]}
                              labelFormatter={(l) => `${isAnnual ? "FY" : "Q"} ${formatDateLabel(String(l))}`}
                              contentStyle={tooltipStyle}
                            />
                            <Bar
                              dataKey="value"
                              radius={[3, 3, 0, 0]}
                            >
                              {yoySeries.map((entry, idx) => (
                                <Cell key={idx} fill={entry.value >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.65} />
                              ))}
                            </Bar>
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <ChartDataDisclosure
                        title="Revenue growth"
                        rows={yoySeries.map((point) => ({ date: point.date, value: point.value }))}
                        columns={[
                          { key: "date", label: "Period", format: (value) => formatDateLabel(String(value ?? "")) },
                          { key: "value", label: "Year-over-year growth", format: (value) => typeof value === "number" ? formatPercent(value, 1) : "—" },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* Holistic Summary */}
          {holisticSummary && (
            <div className="surface-card-strong p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-semibold">Holistic Summary</h3>
                <span className="text-xs sm:text-xs text-stealth-200 bg-stealth-900/70 border border-stealth-700 px-2 py-1 rounded-full">
                  {holisticSummary.regime}
                </span>
              </div>
              <div className="grid overflow-hidden rounded-xl border border-stealth-800 bg-stealth-800 sm:grid-cols-3 sm:gap-px">
                {holisticSummary.bullets.map((bullet) => (
                  <div key={bullet.axis} className="border-b border-stealth-800 bg-stealth-950/65 px-3 py-2.5 last:border-b-0 sm:border-b-0">
                    <div className="text-xs font-semibold text-stealth-300">{bullet.axis}</div>
                    <div className="mt-1 text-xs leading-5 text-stealth-400">{bullet.text}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2 text-sm text-stealth-300">
                <span className="shrink-0 font-semibold text-stealth-500">Watch</span>
                <span>{holisticSummary.watch}</span>
              </div>
            </div>
          )}

          {/* Independent trailing-window comparison */}
          <div className="surface-card-strong p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold sm:text-lg">Trailing Window Comparison</h3>
              <span className="text-xs text-stealth-500">Independent lookbacks · 0–100</span>
            </div>
            <div
              className="relative grid h-48 grid-cols-4 items-end gap-3 border-b border-stealth-700 px-3 pt-5 sm:gap-6 sm:px-8"
              role="img"
              aria-label={`Trailing scores: 21 days ${Math.round(chartData.scores.T)}, 3 months ${Math.round(chartData.scores["3m"])}, 6 months ${Math.round(chartData.scores["6m"])}, 12 months ${Math.round(chartData.scores["12m"])}`}
            >
              <div className="pointer-events-none absolute inset-x-3 bottom-1/2 border-t border-dashed border-stealth-700 sm:inset-x-8" aria-hidden="true" />
              {HORIZON_OPTIONS.map((option) => {
                const score = Math.max(0, Math.min(100, chartData.scores[option.value]));
                const active = selectedHorizon === option.value;
                return (
                  <div key={option.value} className="relative z-10 flex h-full flex-col items-center justify-end gap-1.5">
                    <span className={`text-sm font-semibold tabular-nums ${active ? "text-white" : "text-stealth-300"}`}>
                      {Math.round(score)}
                    </span>
                    <div className="flex h-32 w-full max-w-16 items-end rounded-t-lg bg-stealth-950/70">
                      <div
                        className={`w-full rounded-t-lg transition-[height] ${active ? "bg-sky-400" : "bg-sky-700/65"}`}
                        style={{ height: `${score}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${active ? "text-sky-300" : "text-stealth-500"}`}>{option.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Score breakdown tables by trailing lookback */}
          <section id="stock-outlook" aria-label="Trailing window analysis" className="scroll-mt-32 space-y-6">
            {selectedHorizon !== "T" && (() => {
              const projection = projections[selectedHorizon];
              if (!projection) return null;

              return (
                <div key={selectedHorizon} className="surface-card-strong p-6">
                  <h3 className="mb-4 text-lg font-semibold">{horizonLabel(selectedHorizon)} Component Read</h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
                    <div className="secondary-card p-4">
                      <div className="text-xs sm:text-sm text-stealth-400 mb-1">Total Score</div>
                      <div className="text-2xl sm:text-3xl font-bold text-blue-400">{Math.round(projection.score_total)}</div>
                    </div>
                    <div className="secondary-card p-4">
                      <div className="text-xs sm:text-sm text-stealth-400 mb-1">vs 21D</div>
                      <div className={`text-2xl sm:text-3xl font-bold ${
                        projection.score_total >= projections["T"].score_total ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {projection.score_total >= projections["T"].score_total ? '+' : ''}
                        {(projection.score_total - projections["T"].score_total).toFixed(1)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-stealth-400 w-24 sm:w-32 truncate">Trend (45%)</span>
                      <div className="flex-1 bg-stealth-800 rounded h-3">
                        <div 
                          className="bg-yellow-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_trend}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_trend)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-stealth-400 w-24 sm:w-32 truncate">Rel. Strength (30%)</span>
                      <div className="flex-1 bg-stealth-800 rounded h-3">
                        <div 
                          className="bg-lime-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_relative_strength}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_relative_strength)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-stealth-400 w-24 sm:w-32 truncate">Risk (20%)</span>
                      <div className="flex-1 bg-stealth-800 rounded h-3">
                        <div 
                          className="bg-red-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_risk}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_risk)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-stealth-400 w-24 sm:w-32 truncate">Regime (5%)</span>
                      <div className="flex-1 bg-stealth-800 rounded h-3">
                        <div 
                          className="bg-indigo-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_regime}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_regime)}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-stealth-700 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
                    <div>
                      <span className="text-stealth-400">Volatility:</span>
                      <span className="ml-2 font-semibold">{projection.volatility.toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-stealth-400">Max Drawdown:</span>
                      <span className="ml-2 font-semibold text-red-400">{projection.max_drawdown.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

        {visibleDataWarnings.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-2 gap-y-1 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-xs text-yellow-200/90">
            <strong>Data quality</strong>
            <span>{visibleDataWarnings.map((warning) => warning.type.replace(/_/g, " ")).join(" · ")}</span>
          </div>
        )}

          {/* Methodology */}
          <div id="stock-methodology" className="mt-6 scroll-mt-32 surface-card-strong">
            <button
              type="button"
              onClick={() => setMethodologyOpen(!methodologyOpen)}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-6 py-4 transition-colors hover:bg-stealth-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              aria-expanded={methodologyOpen}
              aria-controls="stock-methodology-content"
            >
              <h2 className="text-lg font-semibold">Methodology & Scoring Details</h2>
              <span className={`collapsible-icon ${methodologyOpen ? 'collapsible-icon-open' : ''}`} aria-hidden="true">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            <div id="stock-methodology-content" className={`collapsible-panel ${methodologyOpen ? 'collapsible-panel-open' : ''}`}>
              <div className="collapsible-panel-inner">
                <div className="px-6 pb-6 text-sm text-stealth-200 space-y-4">
                <p>
                  Stock analysis uses the same transparent scoring methodology as sector analysis, 
                  evaluating performance across 21-day, 3-month, 6-month, and 12-month lookback periods.
                </p>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Scoring Components</h4>
                  <ul className="space-y-2 text-xs">
                    <li><strong>Trend (45%):</strong> Price momentum and technical positioning relative to moving averages</li>
                    <li><strong>Relative Strength (30%):</strong> Outperformance vs SPY benchmark</li>
                    <li><strong>Risk (20%):</strong> Volatility and drawdown analysis (inverted scoring)</li>
                    <li><strong>Regime (5%):</strong> Context-aware adjustments based on market environment</li>
                  </ul>
                </div>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Signal Quality</h4>
                  <p className="text-xs mb-2">
                    Composite quality measure (0-100) based on three factors:
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>- <strong>Component Alignment (40%):</strong> How well the scoring components agree with each other</li>
                    <li>- <strong>Volatility Factor (35%):</strong> Lower realized volatility increases the composite</li>
                    <li>- <strong>Signal Strength (25%):</strong> How far the score deviates from neutral (farther from 50 = stronger direction)</li>
                  </ul>
                </div>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Reference Bands</h4>
                  <ul className="space-y-2 text-xs">
                      <li><strong>Raw Upper Reference:</strong> Calculated from trailing return with volatility and lookback adjustments.</li>
                      <li><strong>Upper Reference:</strong> Context band after valuation and market-cap checks; it is not a recommendation.</li>
                      <li><strong>Technical Extension:</strong> Raw upper band shown separately when it exceeds the checked upper reference.</li>
                    <li><strong>Lower Reference:</strong> Based on a realized-volatility proxy, risk score, and lookback length. Serves as a downside context band.</li>
                    <li><strong>Range Ratio:</strong> Upper band distance divided by lower band distance. Higher values indicate wider asymmetry.</li>
                  </ul>
                </div>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Trailing Windows</h4>
                  <p className="text-xs">
                    The 21D, 3M, 6M, and 12M scores are separate historical lookbacks. The profile compares sensitivity to window length.
                  </p>
                </div>
              </div>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
            <p className="text-xs text-yellow-200/90 leading-relaxed">
              <strong>Disclaimer:</strong> These analysis signals are theoretical models for educational and informational purposes only. 
              They are not financial advice, investment recommendations, or guarantees of future performance. 
              Past performance does not indicate future results. Always conduct your own research and consult with a qualified 
              financial advisor before making investment decisions.
            </p>
          </div>
        </>
      )}

      {loading && (
        <div className="surface-card-strong p-12 flex justify-center">
          <MarketLoading size={110} variant="scan" label="Analyzing stock..." />
        </div>
      )}

      {/* Recent News */}
      {news.length > 0 && (
        <div className="mt-6 surface-card-strong p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base sm:text-lg font-semibold">Recent News for {searchTicker}</h2>
            {latestNewsPublishedAt && (
              <span className="text-xs text-stealth-500">
                Latest article {getRelativeTime(latestNewsPublishedAt)}
              </span>
            )}
          </div>
          <div className="space-y-2 sm:space-y-3">
            {news.map((article) => (
              <a
                key={article.id}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block secondary-card secondary-card-hover p-3 sm:p-4 min-h-20 sm:min-h-24 hover:border-blue-500/50"
              >
                <h3 className="text-xs sm:text-sm font-semibold text-blue-400 mb-2 line-clamp-2">
                  {article.title}
                </h3>
                <div className="flex items-center justify-between text-xs text-stealth-400 gap-2">
                  <span className="font-medium truncate">{article.source}</span>
                  <span className="whitespace-nowrap">
                    {getRelativeTime(article.published_at)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!chartData && !loading && !error && !projectionUnavailable && (
        <div className="surface-card-strong p-12 text-center">
          <div className="text-stealth-400 mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-lg font-semibold mb-2">Search for a stock to get started</p>
            <p className="text-sm">Enter any stock ticker to compare its trailing-window evidence</p>
          </div>
        </div>
      )}
    </div>
  );
}

