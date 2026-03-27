/**
 * Stock Analysis Page
 * 
 * Single stock lookup and analysis with multi-horizon outlook.
 * Allows users to search for any stock and view transparent scoring across time horizons.
 * 
 * Features:
 * - Stock ticker search and lookup
 * - Multi-horizon analysis: 3-month, 6-month, and 12-month outlooks
 * - Interactive chart with uncertainty cones
 * - Detailed scoring breakdown with conviction metrics
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
import { OptionalityMispricingWidget } from "../components/widgets/OptionalityMispricingWidget";
import MarketLoading from "../components/ui/MarketLoading";
import "../index.css";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { getFamilyColor } from "../theme/metricColors";
import { apiFetch, buildApiUrl } from "../utils/apiUtils";
import { buildHolisticSummary } from "../utils/holisticSummary";
import { buildSummaryInputFromSnapshot } from "../utils/summaryInput";
import InfoTooltip from "../components/ui/InfoTooltip";

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
  stop_loss: number;
}

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
}

interface OptionalityMetrics {
  iv30: number | null;
  hv30: number | null;
  iv_percentile: number | null;
  avg_edr: number | null;
}

interface FundamentalPoint {
  date: string;
  value: number;
}

interface FundamentalSeries {
  series: FundamentalPoint[];
  derived?: boolean;
}

interface FundamentalsPayload {
  eps: FundamentalSeries;
  roe: FundamentalSeries;
  free_cash_flow: FundamentalSeries;
  market_cap: FundamentalSeries;
  pe_ratio: FundamentalSeries;
  revenue?: FundamentalSeries;
  revenue_yoy?: FundamentalSeries;
  eps_annual?: FundamentalSeries;
  roe_annual?: FundamentalSeries;
  free_cash_flow_annual?: FundamentalSeries;
  market_cap_annual?: FundamentalSeries;
  pe_ratio_annual?: FundamentalSeries;
  revenue_annual?: FundamentalSeries;
  revenue_yoy_annual?: FundamentalSeries;
}

interface PriceHistoryPoint {
  date: string;
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

function getConfidenceStrokeClass(signal: "accumulation" | "distribution" | "neutral"): string {
  if (signal === "accumulation") return "stroke-emerald-300/75 drop-shadow-[0_0_5px_rgba(74,222,128,0.2)]";
  if (signal === "distribution") return "stroke-rose-300/75 drop-shadow-[0_0_5px_rgba(251,113,133,0.2)]";
  return "stroke-slate-300/70 drop-shadow-[0_0_4px_rgba(148,163,184,0.16)]";
}

function ConfidenceArc({ confidence, signal }: { confidence: number; signal: "accumulation" | "distribution" | "neutral" }) {
  const normalizedConfidence = Math.max(0, Math.min(100, confidence));
  const strokeWidth = 10;
  const radius = 50 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedConfidence / 100);

  return (
    <div className="inline-flex items-center h-4 w-4" aria-label={`Confidence ${normalizedConfidence.toFixed(0)} out of 100`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="fill-none stroke-white/8" strokeWidth={strokeWidth} />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className={`fill-none ${getConfidenceStrokeClass(signal)}`}
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
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CenteredFlowBar({ value, scale }: { value: number | null; scale: number }) {
  const numericValue = value ?? 0;
  const magnitude = scale > 0 ? Math.max(5, Math.min(50, (Math.abs(numericValue) / scale) * 50)) : 0;
  const toneClass = numericValue > 0 ? "bg-emerald-400/85" : numericValue < 0 ? "bg-rose-400/85" : "bg-slate-400/60";

  return (
    <div className="relative h-3 overflow-hidden rounded-full border border-stealth-700 bg-stealth-950/90">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-stealth-400/80" />
      {numericValue === 0 ? (
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/80" />
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
  return new Date(bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const glowClass = direction === "positive" ? "bg-emerald-400/25" : direction === "negative" ? "bg-rose-400/25" : "bg-slate-400/20";
  const bodyClass = direction === "positive" ? "bg-emerald-300/90" : direction === "negative" ? "bg-rose-300/90" : "bg-slate-300/75";

  return (
    <div className="relative h-6 overflow-hidden rounded-full border border-stealth-800 bg-stealth-950/90">
      <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-stealth-500/80" />
      <div className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full ${straddleClass}`} style={{ left: `${50 - totalReach}%`, width: `${totalReach * 2}%` }} />
      {direction === "neutral" ? (
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/80 shadow-[0_0_12px_rgba(148,163,184,0.25)]" />
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
  const accumulationBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd > 0).length;
  const distributionBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd < 0).length;
  const positiveStreak = longestDirectionalStreak(recentTimeline, "positive");
  const negativeStreak = longestDirectionalStreak(recentTimeline, "negative");
  const maxVolume = Math.max(1, ...recentTimeline.map((bucket) => bucket.total_notional_usd));
  const dominantCluster = positiveStreak > negativeStreak ? "Accumulation trend" : negativeStreak > positiveStreak ? "Distribution trend" : "Mixed trend";

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Flow Over Time</div>
          <div className="mt-1 text-xs text-stealth-300">{dominantCluster} across the latest weekly buckets.</div>
        </div>
        <div className="flex gap-2 text-xs">
          <GroupBadge label="Up" value={accumulationBuckets} tone="buy" />
          <GroupBadge label="Down" value={distributionBuckets} tone="sell" />
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {recentTimeline.map((bucket) => {
          const certainty = bucket.total_notional_usd / maxVolume;
          return (
            <div key={bucket.bucket} className="grid grid-cols-[54px_minmax(0,1fr)_88px] items-center gap-2 rounded-xl border border-stealth-800 bg-stealth-900/55 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">{formatBucket(bucket.bucket)}</div>
              <TrendZoneBar value={bucket.net_flow_usd} scale={scale} certainty={certainty} />
              <div className="text-right">
                <div className="text-[11px] font-semibold text-stealth-100">{formatCompactCurrency(bucket.net_flow_usd)}</div>
                <div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-stealth-500">{bucket.buy_events + bucket.sell_events + bucket.neutral_events} events</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2 text-xs text-stealth-300">
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-[0.16em] text-stealth-500">Up Streak</div>
          <div className="mt-1 font-semibold text-emerald-300">{positiveStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-[0.16em] text-stealth-500">Down Streak</div>
          <div className="mt-1 font-semibold text-rose-300">{negativeStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-[0.16em] text-stealth-500">Net</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.net_flow_usd, 0))}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-[0.16em] text-stealth-500">Volume</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.total_notional_usd, 0))}</div>
        </div>
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
    const day = eventDate.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(eventDate);
    monday.setDate(eventDate.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
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

function FlowFocusCard({ flow, events, ticker, currentPrice }: { flow: InstitutionalFlowPayload; events: InstitutionalFlowEvent[]; ticker: string; currentPrice: number | null }) {
  const summary = flow.summary;
  const signal = summary.signal;
  const toneClasses = getSignalClasses(signal);
  const signalLabel = signal === "accumulation" ? "Accumulation" : signal === "distribution" ? "Distribution" : "Neutral";
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
    <div className="space-y-3 rounded-2xl border border-stealth-700 bg-gradient-to-br from-stealth-900/95 via-stealth-900/85 to-stealth-950/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Institutional Flow Focus</div>
          <div className="mt-1 text-sm font-semibold text-stealth-100">{ticker} regime</div>
        </div>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${toneClasses}`}>
          {signalLabel}
        </span>
      </div>

      <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Net Flow Bias</div>
            <div className={`mt-1 text-base font-semibold ${summary.net_flow_usd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {formatCompactCurrency(summary.net_flow_usd)}
            </div>
          </div>
          <div className="text-right text-xs text-stealth-400">
            <div className="flex justify-end">
              <ConfidenceArc confidence={confidencePercent} signal={signal} />
            </div>
            <div className="mt-0.5">Events {summary.event_count}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 text-[10px] uppercase tracking-[0.16em] text-stealth-500">
          <div>
            <div>Sell Cluster</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-rose-300">{formatFlowCurrency(summary.sell_cluster_level)}</div>
          </div>
          <div className="text-center">
            <div>Current</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-stealth-100">{formatFlowCurrency(currentPrice)}</div>
          </div>
          <div className="text-right">
            <div>Buy Cluster</div>
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
                  className={`absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border ${currentIsInsideCluster ? "border-white/70 shadow-[0_0_0_1px_rgba(241,245,249,0.14),0_0_16px_rgba(226,232,240,0.24)]" : "border-white/55 shadow-[0_0_0_1px_rgba(226,232,240,0.1),0_0_14px_rgba(226,232,240,0.18)]"} bg-slate-100/90`}
                  style={currentMarkerStyle}
                />
              </>
            )}
          </div>
        </div>

        <div className="mt-3">
          <CenteredFlowBar value={summary.net_flow_usd} scale={directionalDenominator} />
        </div>
        <div className="mt-2 text-right text-[10px] uppercase tracking-[0.16em] text-stealth-500">
          {formatFlowPercent(normalizedSignal)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <GroupBadge label="Net Flow" value={formatCompactCurrency(summary.net_flow_usd)} tone={summary.net_flow_usd >= 0 ? "buy" : "sell"} />
        <GroupBadge label="Notional" value={formatCompactCurrency(summary.buy_notional_usd + summary.sell_notional_usd)} />
        <GroupBadge label="Events" value={summary.event_count} />
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/70 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Confidence</div>
          <div className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-stealth-100">
            <ConfidenceArc confidence={confidencePercent} signal={signal} />
            <span>{formatFlowPercent(summary.confidence)}</span>
          </div>
        </div>
      </div>

      {timeline.length > 0 ? <TimelineCluster timeline={timeline} /> : null}

    </div>
  );
}

export default function StockAnalysis() {
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
  const [historicalScore, setHistoricalScore] = useState<number | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [dataWarnings, setDataWarnings] = useState<DataWarning[]>([]);
  const [institutionalFlow, setInstitutionalFlow] = useState<InstitutionalFlowPayload | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectionUnavailable, setProjectionUnavailable] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState<"T" | "3m" | "6m" | "12m">("12m");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [showSummaryDebug, setShowSummaryDebug] = useState(false);
  const [fundView, setFundView] = useState<"1Y" | "5Y">("1Y");

  const runSearch = useCallback(async (rawTicker: string) => {
    const normalizedTicker = rawTicker.trim().toUpperCase();
    if (!normalizedTicker) return;

    setTicker(normalizedTicker);
    setSearchTicker(normalizedTicker);
    setLoading(true);
    setError(null);
    setProjectionUnavailable(false);

    const fetchTimestamp = new Date().toISOString();
    let projectionsPayload: {
      projections?: Record<string, StockProjection>;
      historical?: { score_3m_ago?: number };
      technical?: TechnicalData;
      options_flow?: OptionsFlowData;
      optionality?: OptionalityMetrics;
      institutional_flow?: InstitutionalFlowPayload;
      price_history?: PriceHistoryPoint[];
      fundamentals?: FundamentalsPayload;
      analyst_target?: number;
      analyst_count?: number;
      data_warnings?: DataWarning[];
      as_of_date?: string;
      created_at?: string;
    } | null = null;

    try {
      const response = await fetch(buildApiUrl(`/stocks/${normalizedTicker}/projections`));
      if (response.status === 404) {
        setProjectionUnavailable(true);
      } else if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      } else {
        projectionsPayload = await response.json();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch stock data");
    }

    if (projectionsPayload) {
      setProjections(projectionsPayload.projections ?? {});
      setHistoricalScore(projectionsPayload.historical?.score_3m_ago ?? null);
      setTechnicalData(projectionsPayload.technical || null);
      setOptionsFlow(projectionsPayload.options_flow || null);
      setOptionalityMetrics(projectionsPayload.optionality || null);
      setInstitutionalFlow(projectionsPayload.institutional_flow || null);
      setPriceHistory(projectionsPayload.price_history || []);
      setFundamentals(projectionsPayload.fundamentals || null);
      setAnalystTarget(projectionsPayload.analyst_target ?? null);
      setAnalystCount(projectionsPayload.analyst_count ?? null);
      setDataWarnings(projectionsPayload.data_warnings || []);
      setLastUpdated(fetchTimestamp);
      setDataAsOf(projectionsPayload.as_of_date || projectionsPayload.created_at || null);
    } else {
      setProjections({});
      setHistoricalScore(null);
      setTechnicalData(null);
      setOptionsFlow(null);
      setOptionalityMetrics(null);
      setInstitutionalFlow(null);
      setPriceHistory([]);
      setFundamentals(null);
      setAnalystTarget(null);
      setAnalystCount(null);
      setDataWarnings([]);
      setLastUpdated(null);
      setDataAsOf(null);
    }

    // Fetch news filtered by ticker (server-side to avoid missing relevant articles)
    const tickerNews = await apiFetch<NewsArticle[]>(
      `/news?hours=720&limit=50&symbol=${normalizedTicker}`
    ).catch(() => null); // Last 30 days
    if (tickerNews) {
      setNews(tickerNews.slice(0, 10)); // Show top 10 articles
      if (!projectionsPayload) {
        setLastUpdated(fetchTimestamp);
      }
    } else {
      setNews([]);
    }

    setLoading(false);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSearch(ticker);
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
    void runSearch(symbolFromQuery);
  }, [location.hash, searchParams, symbolFromPath, runSearch]);

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

  const isSelectedHorizon = (h: "T" | "3m" | "6m" | "12m") => selectedHorizon === h;

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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  const formatStrikeDistance = (strike: number | null | undefined, price: number) => {
    if (strike === null || strike === undefined || !Number.isFinite(strike) || !Number.isFinite(price) || price <= 0) {
      return "n/a";
    }
    const pct = ((strike - price) / price) * 100;
    return `${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? "above" : "below"}`;
  };

  const formatDateLabel = (date: string) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

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

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Single Name Lens</span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Stock Analysis</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Analyze individual stocks across multiple time horizons with quantified confidence levels.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="page-badge">Projection horizons T, 3M, 6M, 12M</span>
          {searchTicker && <span className="page-badge">Tracking {searchTicker}</span>}
        </div>
      </div>
      
      {/* Stock Search */}
      <div className="surface-card-strong p-4 sm:p-6">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g., AAPL, MSFT, TSLA"
            className="flex-1 rounded-2xl border border-stealth-700 bg-stealth-950/85 px-4 py-3 text-sm text-white placeholder-stealth-500 transition focus:border-sky-500 focus:outline-none sm:py-2 sm:text-base"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="whitespace-nowrap rounded-full bg-white px-6 py-3 font-semibold text-stealth-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-stealth-700 disabled:text-stealth-400"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </form>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-2xl border border-red-700 bg-red-900/20 p-4">
          <p className="text-red-300">{error}</p>
          <p className="text-sm text-red-400 mt-2">
            Please check the ticker symbol and try again. The stock must have sufficient historical data available.
          </p>
        </div>
      )}

      {projectionUnavailable && !error && (
        <div className="rounded-2xl border border-yellow-700/50 bg-yellow-900/20 p-4">
          <p className="text-yellow-200">Projections unavailable for this asset.</p>
        </div>
      )}

      {/* Results */}
      {chartData && (
        <>
          {/* Fundamentals Summary */}
          {projections["T"] && (
            <div className="surface-card-strong p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl font-bold">{chartData.ticker}</h2>
                    {lastUpdated && (
                      <span className="rounded-full bg-stealth-950/90 px-2 py-0.5 text-[10px] text-stealth-500">
                        Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <p className="text-stealth-400">{chartData.name}</p>
                  {dataAsOf && (
                    <p className="text-xs text-stealth-500 mt-1">
                      Market data as of {new Date(dataAsOf).toLocaleString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-stealth-400">Current Price</p>
                  <p className="text-2xl font-bold text-blue-400">${projections["T"].current_price.toFixed(2)}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="52-week low and high range">52W Range</p>
                  <p className="font-semibold">
                    {technicalData?.low_52w !== undefined && technicalData?.high_52w !== undefined
                      ? `$${Number(technicalData.low_52w).toFixed(2)} - $${Number(technicalData.high_52w).toFixed(2)}`
                      : "n/a"}
                  </p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="Price momentum and moving averages">Trend</p>
                  <p
                    className={`font-semibold capitalize ${
                      technicalData?.trend === "uptrend"
                        ? "text-green-400"
                        : technicalData?.trend === "downtrend"
                          ? "text-red-400"
                          : "text-stealth-200"
                    }`}
                  >
                    {technicalData?.trend ?? "n/a"}
                  </p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="Confidence level in the composite projection (0-100)">Conviction</p>
                  <p className="font-semibold text-purple-300">{Math.round(projections["T"].conviction)}%</p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="Upper reference band derived from volatility">Upper Reference</p>
                  <p className="font-semibold text-green-400">${projections["T"].take_profit.toFixed(2)}</p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="Lower reference band derived from volatility">Lower Reference</p>
                  <p className="font-semibold text-red-400">
                    ${Math.max(0, projections["T"].stop_loss).toFixed(2)}
                  </p>
                </div>
                <div className="surface-card-muted p-3">
                  <p className="text-stealth-400 mb-1" title="Volatility and max drawdown">Risk</p>
                  <p className="font-semibold text-stealth-100">
                    Vol {projections["T"].volatility.toFixed(1)}% / DD {projections["T"].max_drawdown.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Price Analysis & Conviction Grid */}
          {projections[selectedHorizon] && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <PriceAnalysisChart
                currentPrice={projections[selectedHorizon].current_price}
                takeProfit={projections[selectedHorizon].take_profit}
                stopLoss={projections[selectedHorizon].stop_loss}
                trailingReturn={projections[selectedHorizon].trailing_return_pct}
                horizon={selectedHorizon.toUpperCase()}
                analystTarget={analystTarget}
                analystCount={analystCount}
                priceHistory={priceHistory}
                flowEvents={institutionalFlow?.event_history ?? []}
              />
              <ConvictionSnapshot
                conviction={projections[selectedHorizon].conviction}
                score={projections[selectedHorizon].score_total}
                volatility={projections[selectedHorizon].volatility}
                horizon={selectedHorizon.toUpperCase()}
              />
            </div>
          )}

          {/* Technical Indicators */}
          {projections["T"] && (
            <TechnicalIndicators
              technicalData={technicalData ?? undefined}
              optionsFlow={optionsFlow}
              optionalityMetrics={optionalityMetrics}
              flowEvents={institutionalFlow?.event_history ?? []}
              hideOptionsContext={true}
            />
          )}

          {projections["T"] && (
            <div className="grid grid-cols-1 gap-4 mb-6 xl:grid-cols-2">
              <div className="surface-card-strong p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-semibold text-stealth-100">Optionality and Structure</h3>
                    <p className="mt-1 text-xs text-stealth-400">Consolidated options mispricing with resistance and support context.</p>
                  </div>
                  <span className="rounded-full border border-stealth-700 bg-stealth-900/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stealth-300">{searchTicker}</span>
                </div>

                <div className="mt-3">
                  <OptionalityMispricingWidget
                    metrics={optionalityMetrics}
                  />
                </div>

                <div className="mt-3 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-stealth-500">Support and Resistance</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-stealth-700 bg-stealth-900/65 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Support</div>
                      <div className="mt-1 text-sm font-semibold text-emerald-300">{formatFlowCurrency(optionsFlow?.put_walls?.[0]?.strike ?? null)}</div>
                    </div>
                    <div className="rounded-xl border border-stealth-700 bg-stealth-900/65 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Current</div>
                      <div className="mt-1 text-sm font-semibold text-stealth-100">{formatFlowCurrency(projections["T"].current_price)}</div>
                    </div>
                    <div className="rounded-xl border border-stealth-700 bg-stealth-900/65 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Resistance</div>
                      <div className="mt-1 text-sm font-semibold text-rose-300">{formatFlowCurrency(optionsFlow?.call_walls?.[0]?.strike ?? null)}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-stealth-400">
                    Trend context: <span className="font-semibold text-stealth-200">{technicalData?.trend ?? "unknown"}</span> • RSI <span className="font-semibold text-stealth-200">{technicalData?.rsi?.current !== undefined ? technicalData.rsi.current.toFixed(1) : "-"}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-stealth-700 bg-stealth-900/65 p-2.5">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-stealth-500">Call Walls (Resistance)</div>
                      <div className="space-y-1.5 text-[11px]">
                        {(() => {
                          const callWalls = optionsFlow?.call_walls?.slice(0, 4) ?? [];
                          const maxCallOi = Math.max(1, ...callWalls.map((wall) => wall.open_interest));
                          if (!callWalls.length) {
                            return <div className="text-stealth-400">No call wall data.</div>;
                          }
                          return callWalls.map((wall) => (
                            <div key={`call-wall-${wall.strike}`} className="rounded-lg border border-stealth-800 bg-stealth-950/60 px-2 py-1.5">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="font-semibold text-rose-300">{formatFlowCurrency(wall.strike)}</span>
                                <span className="text-stealth-300">OI {formatCompact(wall.open_interest, 1)}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-stealth-800">
                                <div className="h-1.5 rounded-full bg-rose-400/85" style={{ width: `${(wall.open_interest / maxCallOi) * 100}%` }} />
                              </div>
                              <div className="mt-1 text-[10px] text-stealth-400">{formatStrikeDistance(wall.strike, projections["T"].current_price)}</div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    <div className="rounded-xl border border-stealth-700 bg-stealth-900/65 p-2.5">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-stealth-500">Put Walls (Support)</div>
                      <div className="space-y-1.5 text-[11px]">
                        {(() => {
                          const putWalls = optionsFlow?.put_walls?.slice(0, 4) ?? [];
                          const maxPutOi = Math.max(1, ...putWalls.map((wall) => wall.open_interest));
                          if (!putWalls.length) {
                            return <div className="text-stealth-400">No put wall data.</div>;
                          }
                          return putWalls.map((wall) => (
                            <div key={`put-wall-${wall.strike}`} className="rounded-lg border border-stealth-800 bg-stealth-950/60 px-2 py-1.5">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="font-semibold text-emerald-300">{formatFlowCurrency(wall.strike)}</span>
                                <span className="text-stealth-300">OI {formatCompact(wall.open_interest, 1)}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-stealth-800">
                                <div className="h-1.5 rounded-full bg-emerald-400/85" style={{ width: `${(wall.open_interest / maxPutOi) * 100}%` }} />
                              </div>
                              <div className="mt-1 text-[10px] text-stealth-400">{formatStrikeDistance(wall.strike, projections["T"].current_price)}</div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {institutionalFlow ? (
                <FlowFocusCard
                  flow={institutionalFlow}
                  events={institutionalFlow.event_history ?? []}
                  ticker={searchTicker}
                  currentPrice={projections["T"]?.current_price ?? null}
                />
              ) : (
                <div className="surface-card-strong p-4 sm:p-5">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-stealth-500">Institutional Flow Focus</div>
                  <div className="mt-2 rounded-xl border border-dashed border-stealth-700 bg-stealth-900/35 px-3 py-2 text-xs text-stealth-400">
                    Institutional flow events are not available for this symbol.
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

            // Latest values + QoQ deltas
            const latest = (series: FundamentalPoint[]) =>
              series.length > 0 ? series[series.length - 1].value : null;
            const qoqDelta = (series: FundamentalPoint[]) => {
              if (series.length < 2) return null;
              const cur = series[series.length - 1].value;
              const prev = series[series.length - 2].value;
              if (prev === 0) return null;
              return ((cur - prev) / Math.abs(prev)) * 100;
            };

            const snapMetrics = [
              { label: "EPS", value: latest(epsSeries), fmt: (v: number) => formatDollars(v, 2), delta: qoqDelta(epsSeries), color: getFamilyColor("equity") },
              { label: "ROE", value: latest(roeSeries), fmt: (v: number) => formatPercent(v, 1), delta: qoqDelta(roeSeries), color: getFamilyColor("growth") },
              { label: "FCF", value: latest(fcfSeries), fmt: (v: number) => `$${formatCompact(v, 1)}`, delta: qoqDelta(fcfSeries), color: getFamilyColor("liquidity") },
              { label: "Rev", value: latest(revSeries), fmt: (v: number) => `$${formatCompact(v, 1)}`, delta: qoqDelta(revSeries), color: getFamilyColor("equity") },
              { label: "P/E", value: latest(peSeries), fmt: (v: number) => v.toFixed(1), delta: qoqDelta(peSeries), color: getFamilyColor("sentiment") },
              { label: "MCap", value: latest(mcapSeries), fmt: (v: number) => `$${formatCompact(v, 1)}`, delta: qoqDelta(mcapSeries), color: getFamilyColor("financials") },
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
              background: "#111827",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: "12px",
            };

            return (
              <div className="surface-card-strong p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base sm:text-lg font-semibold">Fundamental Analysis</h3>
                  <div className="flex items-center gap-1 rounded-full border border-stealth-700 bg-stealth-900/60 p-0.5">
                    {(["1Y", "5Y"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setFundView(v)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${fundView === v ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"}`}
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
                      <div className="text-[10px] uppercase tracking-wider text-stealth-500 mb-1">{m.label}</div>
                      <div className="text-sm font-semibold" style={{ color: m.color }}>
                        {m.value !== null ? m.fmt(m.value) : "—"}
                      </div>
                      {m.delta !== null && (
                        <div className={`text-[10px] mt-0.5 ${m.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {m.delta >= 0 ? "▲" : "▼"} {Math.abs(m.delta).toFixed(1)}% {isAnnual ? "YoY" : "QoQ"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="text-[11px] text-stealth-500 mb-4">
                  Source: Yahoo Finance filings via yfinance. Cadence: {isAnnual ? "annual" : "quarterly"}.
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
                        <div className="flex items-center gap-3 text-[10px] text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("equity"), opacity: 0.35 }} /> Rev</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("growth") }} /> EPS</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={revEpsData}>
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatDollars(v, 0)} tick={{ fill: getFamilyColor("growth"), fontSize: 10 }} tickLine={false} axisLine={false} />
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
                        <div className="flex items-center gap-3 text-[10px] text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("growth") }} /> ROE</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("liquidity"), opacity: 0.35 }} /> FCF</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={roeFcfData}>
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: getFamilyColor("growth"), fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
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
                        <div className="flex items-center gap-3 text-[10px] text-stealth-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: getFamilyColor("sentiment") }} /> P/E</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: getFamilyColor("financials"), opacity: 0.2 }} /> MCap</span>
                        </div>
                      </div>
                      <div className="h-44" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={peMcapData}>
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tickFormatter={(v) => v.toFixed(0)} tick={{ fill: getFamilyColor("sentiment"), fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatCompact(v, 0)} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
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
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={yoySeries}>
                            <XAxis dataKey="date" tickFormatter={(v) => formatDateLabel(String(v))} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }} tickLine={false} axisLine={false} />
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
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Holistic Summary */}
          {holisticSummary && (
            <div className="surface-card-strong p-4 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base sm:text-lg font-semibold">Holistic Summary</h3>
                <span className="text-[10px] sm:text-xs text-stealth-200 bg-stealth-900/70 border border-stealth-700 px-2 py-1 rounded-full">
                  {holisticSummary.regime}
                </span>
              </div>
              <p className="text-sm text-stealth-200 leading-relaxed mb-4">
                {holisticSummary.narrative}
              </p>
              <div className="space-y-2 text-sm text-stealth-400">
                {holisticSummary.bullets.map((bullet) => (
                  <div key={bullet.axis}>
                    <span className="text-stealth-500">{bullet.axis}:</span> {bullet.text}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-sm text-stealth-400">
                <span className="text-stealth-500">Watch:</span> {holisticSummary.watch}
              </div>
              {holisticSummary.debug && (
                <button
                  type="button"
                  onClick={() => setShowSummaryDebug((prev) => !prev)}
                  className="mt-3 text-xs text-blue-300 hover:text-blue-200 transition"
                >
                  {showSummaryDebug ? "Hide debug" : "Show debug"}
                </button>
              )}
              {showSummaryDebug && holisticSummary.debug && (
                <div className="mt-3 secondary-card p-3 text-xs text-stealth-400 space-y-2">
                  {[
                    holisticSummary.debug.technical,
                    holisticSummary.debug.fundamental,
                    holisticSummary.debug.options,
                  ].map((axis) => (
                    <div key={axis.label}>
                      <span className="text-stealth-500">{axis.label}:</span>{" "}
                      {axis.bias} · score {axis.score} · confidence {axis.confidence} · rules{" "}
                      {Array.isArray(axis.debug?.rules) ? axis.debug?.rules.join(", ") : "n/a"}
                    </div>
                  ))}
                  <div>
                    <span className="text-stealth-500">Regime:</span>{" "}
                    {holisticSummary.debug.regime_matrix.key} ·{" "}
                    {holisticSummary.debug.regime_matrix.rationale.join("; ")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Chart */}
          <div className="surface-card-strong p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold mb-4">Score Trends</h3>
            <div className="secondary-card p-2 sm:p-4 mb-2">
              <div className="w-full" style={{ aspectRatio: '3 / 1', maxHeight: '240px' }}>
                <svg width="100%" height="100%" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet">
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <g key={y}>
                    <line x1="50" y1={260 - (y * 2.4)} x2="960" y2={260 - (y * 2.4)} stroke={CHART_NEUTRAL.grid} strokeWidth="1" strokeDasharray="4 4" />
                    <text x="40" y={264 - (y * 2.4)} fill={CHART_NEUTRAL.tick} fontSize="10" textAnchor="end">{y}</text>
                  </g>
                ))}
                
                {/* X-axis labels - simplified */}
                <text x="150" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">-3M</text>
                <text x="375" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">T</text>
                <text x="575" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">3M</text>
                <text x="750" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">6M</text>
                <text x="925" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">12M</text>
                
                {(() => {
                  const color = getFamilyColor("equity");
                  
                  // Calculate points - -3M is shown only when history exists
                  const hasHistory = historicalScore !== null;
                  const histScore = historicalScore ?? null;
                  
                  const xHist = 150;   // -3M
                  const yHist = hasHistory ? 260 - ((histScore as number) * 2.4) : 0;
                  const x0 = 375;      // Now (T)
                  const y0 = 260 - (chartData.scores["T"] * 2.4);
                  const x1 = 575;      // +3M
                  const y1 = 260 - (chartData.scores["3m"] * 2.4);
                  const x2 = 750;      // +6M
                  const y2 = 260 - (chartData.scores["6m"] * 2.4);
                  const x3 = 925;      // +12M
                  const y3 = 260 - (chartData.scores["12m"] * 2.4);
                  
                  // Calculate uncertainty cone (only for future projections starting from T)
                  const initialSigma = 2;
                  const sigma3m = 3;
                  const sigma6m = Math.abs(chartData.scores["6m"] - chartData.scores["3m"]) * 0.3 + 6;
                  const sigma12m = Math.abs(chartData.scores["12m"] - chartData.scores["6m"]) * 0.4 + 10;
                  
                  const upper0 = y0 - (initialSigma * 2.4);
                  const lower0 = y0 + (initialSigma * 2.4);
                  const upper1 = y1 - (sigma3m * 2.4);
                  const lower1 = y1 + (sigma3m * 2.4);
                  const upper2 = y2 - (sigma6m * 2.4);
                  const lower2 = y2 + (sigma6m * 2.4);
                  const upper3 = y3 - (sigma12m * 2.4);
                  const lower3 = y3 + (sigma12m * 2.4);
                  
                  // Historical path (solid, no cone, -3M to T)
                  const historicalPath = hasHistory
                    ? `
                      M ${xHist} ${yHist}
                      Q ${(xHist + x0) / 2} ${(yHist + y0) / 2}, ${x0} ${y0}
                    `
                    : null;
                  
                  // Future path - full (from T through all horizons)
                  // Path from T to 6M (solid, normal opacity)
                  const pathToSixMonth = `
                    M ${x0} ${y0}
                    L ${x1} ${y1}
                    Q ${(x1 + x2) / 2} ${(y1 + y2) / 2}, ${x2} ${y2}
                  `;
                  
                  // Path from 6M to 12M (fading segment)
                  const pathSixToTwelve = `
                    M ${x2} ${y2}
                    Q ${(x2 + x3) / 2} ${(y2 + y3) / 2}, ${x3} ${y3}
                  `;
                  
                  const conePathUpper = `
                    M ${x0} ${upper0}
                    L ${x1} ${upper1}
                    Q ${(x1 + x2) / 2} ${(upper1 + upper2) / 2}, ${x2} ${upper2}
                    Q ${(x2 + x3) / 2} ${(upper2 + upper3) / 2}, ${x3} ${upper3}
                  `;
                  
                  const conePathLower = `
                    M ${x0} ${lower0}
                    L ${x1} ${lower1}
                    Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x2} ${lower2}
                    Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x3} ${lower3}
                  `;
                  
                  return (
                    <g>
                      <defs>
                        <linearGradient id="stockGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={color} stopOpacity="0.02" />
                          <stop offset="40%" stopColor={color} stopOpacity="0.08" />
                          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
                        </linearGradient>
                        <linearGradient id="lineFadeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
                        </linearGradient>
                      </defs>
                      
                      {/* Historical line (solid, brighter, -3M to T) */}
                      {historicalPath && (
                        <path 
                          d={historicalPath} 
                          stroke={color} 
                          strokeWidth="3" 
                          fill="none" 
                          opacity={0.9}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                      
                      {/* Uncertainty cone */}
                      <path
                        d={`${conePathUpper} L ${x3} ${lower3} Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x2} ${lower2} Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x1} ${lower1} L ${x0} ${lower0} Z`}
                        fill="url(#stockGradient)"
                        opacity={0.5}
                      />
                      
                      {/* Cone boundaries */}
                      <path 
                        d={conePathUpper}
                        stroke={color}
                        strokeWidth="1"
                        fill="none"
                        opacity={0.3}
                        strokeDasharray="3 3"
                      />
                      <path 
                        d={conePathLower}
                        stroke={color}
                        strokeWidth="1"
                        fill="none"
                        opacity={0.3}
                        strokeDasharray="3 3"
                      />
                      
                      {/* Future projection line T to 6M (normal opacity) */}
                      <path 
                        d={pathToSixMonth} 
                        stroke={color} 
                        strokeWidth="3.5" 
                        fill="none" 
                        opacity={0.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Future projection line 6M to 12M (fading into cone) */}
                      <path 
                        d={pathSixToTwelve} 
                        stroke="url(#lineFadeGradient)" 
                        strokeWidth="3.5" 
                        fill="none" 
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Vertical "Now" line */}
                      <line 
                        x1={x0} 
                        y1={20} 
                        x2={x0} 
                        y2={280} 
                        stroke={getFamilyColor("benchmark")} 
                        strokeWidth="2" 
                        strokeDasharray="5 5"
                        opacity={0.5}
                      />
                      
                      {/* Points - 5 data points */}
                      {hasHistory && (
                        <circle cx={xHist} cy={yHist} r="4" fill={color} opacity={0.7} />
                      )}
                      <circle cx={x0} cy={y0} r="6" fill={color} opacity={0.9} stroke={getFamilyColor("benchmark")} strokeWidth="2" />
                      <circle cx={x1} cy={y1} r="5" fill={color} opacity={0.8} />
                      <circle cx={x2} cy={y2} r="5" fill={color} opacity={0.6} />
                      <circle cx={x3} cy={y3} r="5" fill={color} opacity={0.3} />
                    </g>
                  );
                })()}
              </svg>
              </div>
            </div>
          </div>

          {/* Score Breakdown Tables - Conditional based on selected horizon */}
          <div className="space-y-6">
            {selectedHorizon === "T" && projections["3m"] && (
              <div className="surface-card-strong p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Current Position</h3>
                  
                  {/* Horizon Selector */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedHorizon("T")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("T")
                          ? "bg-stealth-700 text-white"
                          : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                      }`}
                    >
                      Now
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("3m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("3m")
                          ? "bg-stealth-700 text-white"
                          : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                      }`}
                    >
                      T+3M
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("6m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("6m")
                          ? "bg-stealth-700 text-white"
                          : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                      }`}
                    >
                      T+6M
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("12m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("12m")
                          ? "bg-stealth-700 text-white"
                          : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                      }`}
                    >
                      T+12M
                    </button>
                  </div>
                </div>
                <div className="text-stealth-400 text-xs sm:text-sm">
                  Current score reflects real-time positioning. Select a future horizon to view the outlook.
                </div>
              </div>
            )}
            
            {selectedHorizon !== "T" && (() => {
              const projection = projections[selectedHorizon];
              if (!projection) return null;

              return (
                <div key={selectedHorizon} className="surface-card-strong p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{selectedHorizon.toUpperCase()} Outlook</h3>
                    
                    {/* Horizon Selector */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedHorizon("T")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("T")
                            ? "bg-stealth-700 text-white"
                            : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                        }`}
                      >
                        Now
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("3m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("3m")
                            ? "bg-stealth-700 text-white"
                            : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                        }`}
                      >
                        T+3M
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("6m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("6m")
                            ? "bg-stealth-700 text-white"
                            : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                        }`}
                      >
                        T+6M
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("12m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("12m")
                            ? "bg-stealth-700 text-white"
                            : "bg-stealth-800 text-slate-300 hover:bg-stealth-700"
                        }`}
                      >
                        T+12M
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
                    <div className="secondary-card p-4">
                      <div className="text-xs sm:text-sm text-stealth-400 mb-1">Total Score</div>
                      <div className="text-2xl sm:text-3xl font-bold text-blue-400">{Math.round(projection.score_total)}</div>
                    </div>
                    <div className="secondary-card p-4">
                      <div className="text-xs sm:text-sm text-stealth-400 mb-1">Score Change</div>
                      <div className={`text-2xl sm:text-3xl font-bold ${
                        projection.score_total >= projections["3m"].score_total ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {projection.score_total >= projections["3m"].score_total ? '+' : ''}
                        {(projection.score_total - projections["3m"].score_total).toFixed(1)}
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
          </div>

          {/* Understanding the Analysis */}
          <div className="mt-6 bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 sm:p-4">
            <h3 className="text-xs sm:text-sm font-semibold text-blue-200 mb-2">Understanding the Analysis</h3>
            <div className="text-xs text-blue-200/80 space-y-1 sm:space-y-2 leading-relaxed">
              <p><strong>Score (0-100):</strong> Higher scores indicate stronger technical outlook.</p>
              <p><strong>Score Change:</strong> Shows whether the outlook is improving (+) or deteriorating (-) over time.</p>
              <p><strong>Uncertainty Cone:</strong> Tighter cones = higher confidence. Wider cones = greater uncertainty.</p>
              <p><strong>Conviction:</strong> Confidence level in the analysis (0-100). Based on signal alignment, volatility, and score strength.</p>
              <p><strong>Reference Bands:</strong> Upper and lower bands derived from volatility-adjusted returns and risk metrics.</p>
            </div>
          </div>

        {dataWarnings.length > 0 && (
          <div className="mt-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-yellow-200/90 leading-relaxed">
              <strong>Data Warning:</strong> Recent analysis snapshots contain data quality flags that may reduce accuracy.
            </p>
            {dataWarnings.length > 0 && (
              <p className="mt-1 text-xs text-yellow-200/80">
                {dataWarnings.map(w => w.type.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </div>
        )}

          {/* Methodology */}
          <div className="mt-6 surface-card-strong">
            <button
              onClick={() => setMethodologyOpen(!methodologyOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-stealth-800/40 transition-colors rounded-lg"
              aria-expanded={methodologyOpen}
            >
              <h2 className="text-lg font-semibold">Methodology & Scoring Details</h2>
              <span className={`collapsible-icon ${methodologyOpen ? 'collapsible-icon-open' : ''}`} aria-hidden="true">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            <div className={`collapsible-panel ${methodologyOpen ? 'collapsible-panel-open' : ''}`}>
              <div className="collapsible-panel-inner">
                <div className="px-6 pb-6 text-sm text-stealth-200 space-y-4">
                <p>
                  Stock analysis uses the same transparent scoring methodology as sector analysis, 
                  evaluating performance across 3-month, 6-month, and 12-month lookback periods.
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
                  <h4 className="font-semibold mb-2">Conviction Metric</h4>
                  <p className="text-xs mb-2">
                    Measures confidence in the analysis (0-100) based on three factors:
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>- <strong>Component Alignment (40%):</strong> How well the scoring components agree with each other</li>
                    <li>- <strong>Volatility Factor (35%):</strong> Lower volatility = higher conviction in the analysis</li>
                    <li>- <strong>Signal Strength (25%):</strong> How far the score deviates from neutral (50 = stronger signal)</li>
                  </ul>
                </div>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Reference Bands</h4>
                  <ul className="space-y-2 text-xs">
                    <li><strong>Take Profit:</strong> Calculated from projected return with volatility and horizon adjustments. Represents upside potential.</li>
                    <li><strong>Lower Reference:</strong> Based on volatility (ATR), risk score, and time horizon. Serves as a downside context band.</li>
                    <li><strong>Range Ratio:</strong> Upper band distance divided by lower band distance. Higher values indicate wider asymmetry.</li>
                  </ul>
                </div>
                <div className="secondary-card p-4">
                  <h4 className="font-semibold mb-2">Uncertainty Cones</h4>
                  <p className="text-xs">
                    The expanding cone represents uncertainty bands. Width increases with horizon, 
                    reflecting greater dispersion. Narrower cones indicate more stable behavior.
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
            {lastUpdated && (
              <span className="text-[10px] text-stealth-500">
                Updated {getRelativeTime(lastUpdated)}
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
            <p className="text-sm">Enter any stock ticker to analyze its multi-horizon outlook</p>
          </div>
        </div>
      )}
    </div>
  );
}

