import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi";
import MarketLoading from "../components/ui/MarketLoading";

interface FlowEvent {
  date: string;
  price: number;
  volume: number;
  volume_z: number;
  clv: number;
  price_change_pct: number;
  notional: number;
  side: "buy" | "sell" | "neutral";
  strength: number;
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

interface FlowSignal {
  symbol: string;
  name: string;
  category: string;
  status: "ok" | "insufficient_data";
  signal: "accumulation" | "distribution" | "neutral";
  confidence: number;
  latest_price: number | null;
  buy_cluster_level: number | null;
  sell_cluster_level: number | null;
  distance_to_buy_pct?: number | null;
  distance_to_sell_pct?: number | null;
  buy_notional_usd?: number;
  sell_notional_usd?: number;
  net_flow_usd: number | null;
  event_count?: number;
  flow_timeline?: FlowTimelineBucket[];
  recent_events: FlowEvent[];
}

interface FlowOverviewResponse {
  as_of: string;
  groups: Record<string, FlowSignal[]>;
  leaders: {
    accumulation: FlowSignal[];
    distribution: FlowSignal[];
  };
  stock_selection?: {
    mode: string;
    symbols: string[];
    count: number;
  };
  method: {
    description: string;
    note: string;
  };
}

type GroupTone = "default" | "buy" | "sell";
type GroupKey = "sectors" | "metals" | "crypto" | "stocks";
type ActiveSelection = { groupKey: GroupKey; symbol: string };

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 0 : 2,
  }).format(value);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBucket(bucket: string): string {
  return new Date(bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Timestamp unavailable";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function formatGroupTitle(groupKey: GroupKey): string {
  if (groupKey === "sectors") {
    return "Sectors";
  }
  if (groupKey === "metals") {
    return "Precious Metals";
  }
  if (groupKey === "crypto") {
    return "Crypto";
  }
  return "Stocks";
}

function formatSignalSymbol(symbol: string, category?: string): string {
  if (category === "crypto" && symbol.endsWith("-USD")) {
    return symbol.slice(0, -4);
  }
  return symbol;
}

function getSignalClasses(signal: FlowSignal["signal"]): string {
  if (signal === "accumulation") {
    return "border-emerald-700/50 bg-emerald-950/35 text-emerald-300";
  }
  if (signal === "distribution") {
    return "border-rose-700/50 bg-rose-950/35 text-rose-300";
  }
  return "border-stealth-600 bg-stealth-800/80 text-stealth-300";
}

function getBubbleSurface(signal: FlowSignal["signal"]): string {
  if (signal === "accumulation") {
    return "border-emerald-400/80 bg-stealth-950 text-emerald-50";
  }
  if (signal === "distribution") {
    return "border-rose-400/80 bg-stealth-950 text-rose-50";
  }
  return "border-stealth-400/70 bg-stealth-950 text-stealth-100";
}

function getConfidenceStrokeClass(signal: FlowSignal["signal"]): string {
  if (signal === "accumulation") {
    return "stroke-emerald-300/80";
  }
  if (signal === "distribution") {
    return "stroke-rose-300/80";
  }
  return "stroke-stealth-300/75";
}

function ConfidenceArc({
  confidence,
  signal,
  sizeClass = "h-4 w-4",
  strokeWidth = 8,
}: {
  confidence: number;
  signal: FlowSignal["signal"];
  sizeClass?: string;
  strokeWidth?: number;
}) {
  const normalizedConfidence = Math.max(0, Math.min(100, confidence));
  const radius = 50 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedConfidence / 100);

  return (
    <div
      className={`inline-flex items-center ${sizeClass}`}
      role="img"
      aria-label={`Confidence ${normalizedConfidence.toFixed(0)} out of 100`}
    >
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

function BubbleConfidenceArc({ confidence, signal }: { confidence: number; signal: FlowSignal["signal"] }) {
  return (
    <div className="pointer-events-none absolute inset-[5px] opacity-90">
      <ConfidenceArc confidence={confidence} signal={signal} sizeClass="h-full w-full" strokeWidth={4.5} />
    </div>
  );
}

function totalNotional(row: FlowSignal): number {
  if (row.flow_timeline?.length) {
    return row.flow_timeline.reduce((sum, bucket) => sum + bucket.total_notional_usd, 0);
  }
  return (row.buy_notional_usd ?? 0) + (row.sell_notional_usd ?? 0);
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

function SignalPill({ signal }: { signal: FlowSignal["signal"] }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${getSignalClasses(signal)}`}>
      {signal}
    </span>
  );
}

function GroupBadge({ label, value, tone = "default" }: { label: string; value: string | number; tone?: GroupTone }) {
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

function TrendZoneBar({
  value,
  scale,
  certainty,
}: {
  value: number | null;
  scale: number;
  certainty: number;
}) {
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
  const glowClass =
    direction === "positive"
      ? "bg-emerald-400/25"
      : direction === "negative"
        ? "bg-rose-400/25"
        : "bg-stealth-400/20";
  const bodyClass =
    direction === "positive"
      ? "bg-emerald-300/90"
      : direction === "negative"
        ? "bg-rose-300/90"
        : "bg-stealth-300/75";

  return (
    <div className="relative h-6 overflow-hidden rounded-full border border-stealth-800 bg-stealth-950/90">
      <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-stealth-500/80" />
      <div
        className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full ${straddleClass}`}
        style={{ left: `${50 - totalReach}%`, width: `${totalReach * 2}%` }}
      />
      {direction === "neutral" ? (
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stealth-300/90" />
      ) : (
        <>
          <div
            className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${direction === "positive" ? "bg-emerald-200/28" : "bg-rose-200/28"}`}
            style={direction === "positive" ? { right: "50%", width: `${counterReach}%` } : { left: "50%", width: `${counterReach}%` }}
          />
          <div
            className={`absolute top-1/2 h-4 -translate-y-1/2 rounded-full ${glowClass}`}
            style={direction === "positive" ? { left: "50%", width: `${certaintyReach}%` } : { right: "50%", width: `${certaintyReach}%` }}
          />
          <div
            className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${bodyClass}`}
            style={direction === "positive" ? { left: "50%", width: `${baseReach}%` } : { right: "50%", width: `${baseReach}%` }}
          />
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
          <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">Flow Over Time</div>
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
              <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">{formatBucket(bucket.bucket)}</div>
              <TrendZoneBar value={bucket.net_flow_usd} scale={scale} certainty={certainty} />
              <div className="text-right">
                <div className="text-xs font-semibold text-stealth-100">{formatCompactCurrency(bucket.net_flow_usd)}</div>
                <div className="mt-0.5 text-xs uppercase tracking-[0.16em] text-stealth-500">{bucket.buy_events + bucket.sell_events + bucket.neutral_events} events</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2 text-xs text-stealth-300">
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">Up Streak</div>
          <div className="mt-1 font-semibold text-emerald-300">{positiveStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">Down Streak</div>
          <div className="mt-1 font-semibold text-rose-300">{negativeStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">Net</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.net_flow_usd, 0))}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-2.5 py-2">
          <div className="text-xs uppercase tracking-[0.16em] text-stealth-500">Volume</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.total_notional_usd, 0))}</div>
        </div>
      </div>
    </div>
  );
}

function BubbleCluster({ rows, selectedSymbol, onSelect }: { rows: FlowSignal[]; selectedSymbol: string | null; onSelect: (symbol: string) => void }) {
  const scale = Math.max(1, ...rows.map((row) => totalNotional(row)));

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stealth-700 bg-stealth-950/40 p-5 text-sm text-stealth-300" role="status">
        No symbols in this group have enough flow evidence for the current window.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-900 p-3">
      <div className="rounded-xl border border-stealth-800 bg-stealth-950 p-3">
        <div className="flex flex-wrap items-center justify-center gap-2.5 md:gap-3">
        {rows.map((row) => {
          const size = 78 + Math.min(34, (Math.sqrt(totalNotional(row) / scale) || 0) * 34);
          const isSelected = row.symbol === selectedSymbol;

          return (
            <button
              key={`${row.category}-${row.symbol}`}
              type="button"
              onClick={() => onSelect(row.symbol)}
              aria-pressed={isSelected}
              aria-label={`${formatSignalSymbol(row.symbol, row.category)}, ${row.signal}, ${row.confidence.toFixed(0)} percent confidence, ${formatCompactCurrency(totalNotional(row))} total notional`}
              className={`relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-full border-2 px-2 text-center transition duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-sky-400/70 ${getBubbleSurface(row.signal)} ${isSelected ? "ring-2 ring-white/80" : "ring-0"}`}
              style={{ width: `${size}px`, height: `${size}px` }}
            >
              <BubbleConfidenceArc confidence={row.confidence} signal={row.signal} />
              <span className="max-w-full text-center text-[13px] font-semibold leading-tight tracking-wide md:text-sm">{formatSignalSymbol(row.symbol, row.category)}</span>
              <span className="mt-1 max-w-full text-xs font-medium leading-tight">{formatCompactCurrency(totalNotional(row))}</span>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function FlowFocusCard({ row, groupScale, groupTitle }: { row: FlowSignal; groupScale: number; groupTitle: string }) {
  const timeline = row.flow_timeline ?? [];
  const flowTone = (row.net_flow_usd ?? 0) > 0 ? "text-emerald-300" : (row.net_flow_usd ?? 0) < 0 ? "text-rose-300" : "text-stealth-300";
  const clusterLow = row.sell_cluster_level ?? row.latest_price ?? row.buy_cluster_level ?? 0;
  const clusterHigh = row.buy_cluster_level ?? row.latest_price ?? row.sell_cluster_level ?? 0;
  const clusterRange = Math.max(0.0001, clusterHigh - clusterLow);
  const currentPosition = row.latest_price !== null
    ? Math.max(0, Math.min(100, ((row.latest_price - clusterLow) / clusterRange) * 100))
    : 50;
  const currentIsInsideCluster = row.latest_price !== null && row.latest_price >= clusterLow && row.latest_price <= clusterHigh;
  const currentInsetPx = 18;
  const currentMarkerStyle = { left: `clamp(${currentInsetPx}px, ${currentPosition}%, calc(100% - ${currentInsetPx}px))` };

  return (
    <article className="surface-card p-4" aria-labelledby="flow-focus-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Now</p>
          <h3 id="flow-focus-heading" className="mt-1 text-xl font-semibold text-stealth-100">{formatSignalSymbol(row.symbol, row.category)}</h3>
          <div className="mt-1 text-xs text-stealth-400">{row.name} · {groupTitle}</div>
        </div>
        <SignalPill signal={row.signal} />
      </div>

      <div className="mt-4 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">Net Flow Bias</div>
            <div className={`mt-1 text-base font-semibold ${flowTone}`}>{formatCompactCurrency(row.net_flow_usd)}</div>
          </div>
          <div className="text-right text-xs text-stealth-400">
            <div className="flex justify-end">
              <ConfidenceArc confidence={row.confidence} signal={row.signal} sizeClass="h-4 w-4" strokeWidth={10} />
            </div>
            <div className="mt-0.5">Events {row.event_count ?? row.recent_events.length}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 text-xs uppercase tracking-[0.16em] text-stealth-500">
          <div>
            <div>Sell Cluster</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-rose-300">{formatCurrency(row.sell_cluster_level)}</div>
          </div>
          <div className="text-center">
            <div>Current</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-stealth-100">{formatCurrency(row.latest_price)}</div>
          </div>
          <div className="text-right">
            <div>Buy Cluster</div>
            <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-emerald-300">{formatCurrency(row.buy_cluster_level)}</div>
          </div>
        </div>
        <div className="mt-2 relative">
          <div className="relative h-8 overflow-hidden rounded-full border border-stealth-700 bg-stealth-950/90">
            <div className="absolute inset-y-0 left-0 w-[26%] bg-[radial-gradient(circle_at_left_center,rgba(251,113,133,0.35)_0%,rgba(251,113,133,0.18)_28%,rgba(251,113,133,0.06)_48%,rgba(251,113,133,0)_75%)]" />
            <div className="absolute inset-y-0 right-0 w-[26%] bg-[radial-gradient(circle_at_right_center,rgba(110,231,183,0.35)_0%,rgba(110,231,183,0.18)_28%,rgba(110,231,183,0.06)_48%,rgba(110,231,183,0)_75%)]" />
            <div className="absolute inset-y-[7px] left-5 right-5 rounded-full bg-[linear-gradient(90deg,rgba(251,113,133,0.04),rgba(148,163,184,0.05)_50%,rgba(110,231,183,0.04))]" />
            <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-stealth-500/65" />
            {row.latest_price !== null && (
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
          <CenteredFlowBar value={row.net_flow_usd} scale={groupScale} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <GroupBadge label="To Buy" value={formatPercent(row.distance_to_buy_pct)} tone="buy" />
        <GroupBadge label="To Sell" value={formatPercent(row.distance_to_sell_pct)} tone="sell" />
      </div>

      {timeline.length > 0 && <div className="mt-4"><TimelineCluster timeline={timeline} /></div>}

      <div className="mt-3 rounded-2xl border border-stealth-700 bg-stealth-950/45 p-2.5">
        <div className="text-xs uppercase tracking-[0.2em] text-stealth-500">Latest Triggers</div>
        <div className="mt-2 space-y-1.5">
          {row.recent_events.slice(0, 2).map((event) => (
            <div key={`${row.symbol}-${event.date}-${event.side}-${event.price}`} className="flex items-center justify-between rounded-xl border border-stealth-800 bg-stealth-900/60 px-3 py-2 text-xs">
              <div>
                <div className="font-medium text-stealth-100">{new Date(event.date).toLocaleDateString()}</div>
                <div className="mt-0.5 text-stealth-400">z {event.volume_z.toFixed(2)} | CLV {event.clv.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className={`font-semibold ${event.side === "buy" ? "text-emerald-300" : event.side === "sell" ? "text-rose-300" : "text-stealth-200"}`}>
                  {event.side.toUpperCase()}
                </div>
                <div className="mt-0.5 text-stealth-300">{formatCompactCurrency(event.notional)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function GroupSection({
  title,
  rows,
  selectedSymbol,
  onSelectSymbol,
}: {
  title: string;
  rows: FlowSignal[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
}) {
  const accumulationCount = rows.filter((row) => row.signal === "accumulation").length;
  const distributionCount = rows.filter((row) => row.signal === "distribution").length;
  const headingId = `flow-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className="surface-card p-3 sm:p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-4 text-left">
        <div>
          <h3 id={headingId} className="text-lg font-semibold text-stealth-100">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <GroupBadge label="Accumulations" value={accumulationCount} tone="buy" />
          <GroupBadge label="Distributions" value={distributionCount} tone="sell" />
        </div>
      </div>

      <div className="mt-3">
        <BubbleCluster rows={rows} selectedSymbol={selectedSymbol} onSelect={onSelectSymbol} />
      </div>
    </section>
  );
}

function LeadersPanel({ title, items, tone }: { title: string; items: FlowSignal[]; tone: "buy" | "sell" }) {
  const sectionClass = tone === "buy" ? "border-emerald-700/40 bg-emerald-950/20" : "border-rose-700/40 bg-rose-950/20";
  const textClass = tone === "buy" ? "text-emerald-300" : "text-rose-300";
  const compactItems = items.slice(0, 4);

  return (
    <section className={`rounded-2xl border p-3 ${sectionClass}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-sm font-semibold ${textClass}`}>{title}</h3>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {compactItems.length === 0 && <p className="text-sm text-stealth-300">No strong signals yet.</p>}
        {compactItems.map((item, index) => (
          <div key={`${title}-${item.symbol}`} className="rounded-xl bg-stealth-900/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-stealth-500">#{index + 1}</div>
                <div className="mt-0.5 font-semibold text-stealth-100">{formatSignalSymbol(item.symbol, item.category)}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-semibold ${textClass}`}>{formatCompactCurrency(item.net_flow_usd)}</div>
                <div className="mt-1 flex justify-end">
                  <ConfidenceArc confidence={item.confidence} signal={item.signal} sizeClass="h-4 w-4" strokeWidth={10} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function InstitutionalFlow() {
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ lookback_days: "120" });
    return `/flow-signals/overview?${params.toString()}`;
  }, []);

  const { data, loading, error, refetch } = useApi<FlowOverviewResponse>(endpoint);

  const groups = data?.groups ?? {};
  const allRows = Object.values(groups).flat();
  const totalAccumulations = allRows.filter((row) => row.signal === "accumulation").length;
  const totalDistributions = allRows.filter((row) => row.signal === "distribution").length;
  const totalSignals = allRows.length;
  const usableSignals = allRows.filter((row) => row.status === "ok").length;
  const orderedGroupKeys: GroupKey[] = ["stocks", "sectors", "metals", "crypto"];

  const resolvedSelection = useMemo(() => {
    const preferredGroup = activeSelection?.groupKey;
    const preferredSymbol = activeSelection?.symbol;

    if (preferredGroup && preferredSymbol) {
      const rows = groups[preferredGroup] ?? [];
      const activeRow = rows.find((row) => row.symbol === preferredSymbol);
      if (activeRow) {
        return { groupKey: preferredGroup, row: activeRow };
      }
    }

    for (const groupKey of orderedGroupKeys) {
      const rows = groups[groupKey] ?? [];
      const strongest = [...rows].sort((left, right) => right.confidence - left.confidence)[0];
      if (strongest) {
        return { groupKey, row: strongest };
      }
    }

    return null;
  }, [activeSelection, groups]);

  const detailScale = Math.max(1, ...allRows.map((row) => Math.abs(row.net_flow_usd ?? 0)));

  return (
    <div className="page-shell-wide text-stealth-100">
      <section className="page-hero mb-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="page-kicker">Evidence workspace</p>
            <h1 className="page-title">Institutional Flow</h1>
            <p className="page-subtitle">
              Clustered-volume evidence for accumulation and distribution across stocks, sectors, metals, and crypto.
              Select any symbol to inspect the confidence, price clusters, timeline, and triggering events behind the signal.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <GroupBadge label="Signals" value={totalSignals} />
            <GroupBadge label="Accumulations" value={totalAccumulations} tone="buy" />
            <GroupBadge label="Distributions" value={totalDistributions} tone="sell" />
          </div>
        </div>

        {!!data?.stock_selection?.symbols?.length && (
          <div className="mt-3 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-2.5">
            <div className="text-xs uppercase tracking-[0.22em] text-stealth-500">Auto-selected stock basket</div>
            <div className="mt-1 text-xs text-stealth-200">
              Top {data.stock_selection.count} stocks by close dollar volume: <span className="font-semibold text-stealth-100">{data.stock_selection.symbols.join(", ")}</span>
            </div>
          </div>
        )}
        <div className="page-meta">
          <span className="page-badge">As of {formatTimestamp(data?.as_of)}</span>
          <span className="page-badge">{usableSignals}/{totalSignals || 0} signals usable</span>
          <span className="page-badge">120-day evidence window</span>
        </div>
        <nav className="mt-4" aria-label="Institutional flow sections">
          <ul className="flex flex-wrap gap-2 text-sm">
            {[
              ["#flow-now", "Current read"],
              ["#flow-groups", "Evidence groups"],
              ["#flow-method", "Definition & provenance"],
            ].map(([href, label]) => (
              <li key={href}>
                <a className="inline-flex min-h-11 items-center rounded-xl border border-stealth-700 bg-stealth-950/30 px-3 text-stealth-200 hover:border-blue-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      {loading && !data && (
        <div aria-live="polite">
          <MarketLoading label="Scanning for clustered institutional flow..." />
        </div>
      )}
      {loading && data && (
        <div className="mb-4 text-sm text-stealth-300" role="status" aria-live="polite">
          Refreshing flow evidence…
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-700/60 bg-rose-900/20 p-4 text-rose-100" role="alert">
          <p className="font-semibold">{data ? "The latest refresh failed" : "Institutional flow could not load"}</p>
          <p className="mt-1 text-sm text-rose-200">
            {error}{data ? " Previously loaded evidence remains visible below." : ""}
          </p>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 min-h-11 rounded-xl border border-rose-400/60 px-4 py-2 text-sm font-semibold hover:bg-rose-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
          >
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <section id="flow-now" className="mb-4" aria-labelledby="flow-drivers-heading">
            <div className="mb-3">
              <p className="page-kicker">Drivers</p>
              <h2 id="flow-drivers-heading" className="mt-1 text-xl font-semibold text-white">Directional leaders</h2>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <LeadersPanel title="Top Accumulation" items={data.leaders.accumulation} tone="buy" />
              <LeadersPanel title="Top Distribution" items={data.leaders.distribution} tone="sell" />
            </div>
          </section>

          <section id="flow-groups" aria-labelledby="flow-evidence-heading">
            <div className="mb-3">
              <p className="page-kicker">Evidence</p>
              <h2 id="flow-evidence-heading" className="mt-1 text-xl font-semibold text-white">Signal groups and selected detail</h2>
              <p className="mt-1 max-w-3xl text-sm text-stealth-300">Bubble size encodes total clustered notional; the confidence arc and selected detail expose the supporting evidence.</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.78fr)] xl:items-start">
            <div className="order-2 grid gap-3 xl:order-1">
              <GroupSection
                title="Stocks"
                rows={groups.stocks ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "stocks" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "stocks", symbol })}
              />
              <GroupSection
                title="Sectors"
                rows={groups.sectors ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "sectors" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "sectors", symbol })}
              />
              <GroupSection
                title="Precious Metals"
                rows={groups.metals ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "metals" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "metals", symbol })}
              />
              <GroupSection
                title="Crypto"
                rows={groups.crypto ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "crypto" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "crypto", symbol })}
              />
            </div>

            <div className="order-1 xl:order-2 xl:sticky xl:top-4">
              {resolvedSelection?.row ? (
                <FlowFocusCard
                  row={resolvedSelection.row}
                  groupScale={detailScale}
                  groupTitle={formatGroupTitle(resolvedSelection.groupKey)}
                />
              ) : (
                <div className="surface-card p-6 text-sm text-stealth-300">
                  No active signal.
                </div>
              )}
            </div>
          </div>
          </section>

          <section id="flow-method" className="mt-6 surface-card p-4 md:p-5" aria-labelledby="flow-method-heading">
            <p className="page-kicker">Definition & provenance</p>
            <h2 id="flow-method-heading" className="mt-1 text-xl font-semibold text-white">How to read institutional flow</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-stealth-200">{data.method.description}</p>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-stealth-300">{data.method.note}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="surface-card-muted p-3">
                <dt className="text-xs text-stealth-400">Observation time</dt>
                <dd className="mt-1 font-semibold text-stealth-100">{formatTimestamp(data.as_of)}</dd>
              </div>
              <div className="surface-card-muted p-3">
                <dt className="text-xs text-stealth-400">Usable coverage</dt>
                <dd className="mt-1 font-semibold text-stealth-100">{usableSignals} of {totalSignals} signals</dd>
              </div>
              <div className="surface-card-muted p-3">
                <dt className="text-xs text-stealth-400">Selection mode</dt>
                <dd className="mt-1 font-semibold text-stealth-100">{data.stock_selection?.mode ?? "API-defined universe"}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      {!loading && !error && !data && (
        <div className="surface-card p-5 text-sm text-stealth-300" role="status">
          No institutional-flow observation is available for the current window.
        </div>
      )}
    </div>
  );
}
