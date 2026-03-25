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
    return "border-emerald-400/35 bg-[radial-gradient(circle_at_center,rgba(10,18,28,0.96)_72%,rgba(74,222,128,0.22)_100%)] text-emerald-50 shadow-[0_0_0_1px_rgba(74,222,128,0.08),0_0_18px_rgba(74,222,128,0.14)]";
  }
  if (signal === "distribution") {
    return "border-rose-400/35 bg-[radial-gradient(circle_at_center,rgba(10,18,28,0.96)_72%,rgba(251,113,133,0.22)_100%)] text-rose-50 shadow-[0_0_0_1px_rgba(251,113,133,0.08),0_0_18px_rgba(251,113,133,0.14)]";
  }
  return "border-slate-400/30 bg-[radial-gradient(circle_at_center,rgba(10,18,28,0.96)_74%,rgba(148,163,184,0.18)_100%)] text-slate-100 shadow-[0_0_0_1px_rgba(148,163,184,0.06),0_0_14px_rgba(148,163,184,0.12)]";
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
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${getSignalClasses(signal)}`}>
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
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CenteredFlowBar({ value, scale }: { value: number | null; scale: number }) {
  const numericValue = value ?? 0;
  const magnitude = scale > 0 ? Math.max(5, Math.min(50, (Math.abs(numericValue) / scale) * 50)) : 0;
  const toneClass = numericValue > 0 ? "bg-emerald-400/85" : numericValue < 0 ? "bg-rose-400/85" : "bg-slate-400/60";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-stealth-500">
        <span>Distribution</span>
        <span>Zero</span>
        <span>Accumulation</span>
      </div>
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
    </div>
  );
}

function TimelineCluster({ timeline }: { timeline: FlowTimelineBucket[] }) {
  const recentTimeline = timeline.slice(-6);
  const scale = Math.max(1, ...recentTimeline.map((bucket) => Math.abs(bucket.net_flow_usd)));
  const accumulationBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd > 0).length;
  const distributionBuckets = recentTimeline.filter((bucket) => bucket.net_flow_usd < 0).length;
  const positiveStreak = longestDirectionalStreak(recentTimeline, "positive");
  const negativeStreak = longestDirectionalStreak(recentTimeline, "negative");
  const dominantCluster = positiveStreak > negativeStreak ? "Accumulation clustering" : negativeStreak > positiveStreak ? "Distribution clustering" : "Mixed clustering";

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Flow Over Time</div>
          <div className="mt-1 text-xs text-stealth-300">{dominantCluster} across the latest weekly buckets.</div>
        </div>
        <div className="flex gap-2 text-xs">
          <GroupBadge label="Up Weeks" value={accumulationBuckets} tone="buy" />
          <GroupBadge label="Down Weeks" value={distributionBuckets} tone="sell" />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {recentTimeline.map((bucket) => {
          return (
            <div key={bucket.bucket} className="rounded-xl border border-stealth-800 bg-stealth-900/55 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-stealth-500">
                <span>{formatBucket(bucket.bucket)}</span>
                <span>{bucket.buy_events + bucket.sell_events + bucket.neutral_events} events</span>
              </div>
              <div className="mt-2">
                <CenteredFlowBar value={bucket.net_flow_usd} scale={scale} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/65 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Net</div>
                  <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(bucket.net_flow_usd)}</div>
                </div>
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/65 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Total</div>
                  <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(bucket.total_notional_usd)}</div>
                </div>
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/65 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Buy/Sell</div>
                  <div className="mt-1 font-semibold text-stealth-100">{bucket.buy_events}/{bucket.sell_events}</div>
                </div>
                <div className="rounded-lg border border-stealth-800 bg-stealth-950/65 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-stealth-500">Neutral</div>
                  <div className="mt-1 font-semibold text-stealth-100">{bucket.neutral_events}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stealth-300 sm:grid-cols-4">
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Longest Up Streak</div>
          <div className="mt-1 font-semibold text-emerald-300">{positiveStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Longest Down Streak</div>
          <div className="mt-1 font-semibold text-rose-300">{negativeStreak}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Total Flow</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.net_flow_usd, 0))}</div>
        </div>
        <div className="rounded-xl border border-stealth-700 bg-stealth-900/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Tracked Activity</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCompactCurrency(recentTimeline.reduce((sum, bucket) => sum + bucket.total_notional_usd, 0))}</div>
        </div>
      </div>
    </div>
  );
}

function BubbleCluster({ rows, selectedSymbol, onSelect }: { rows: FlowSignal[]; selectedSymbol: string | null; onSelect: (symbol: string) => void }) {
  const scale = Math.max(1, ...rows.map((row) => totalNotional(row)));

  return (
    <div className="rounded-[24px] border border-stealth-700 bg-[radial-gradient(circle_at_top,rgba(46,67,96,0.34),rgba(10,15,26,0.95)_68%)] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Signal Constellation</div>
          <div className="mt-1 text-xs text-stealth-300">Bubble size tracks traded activity. Click a bubble to focus the detail card.</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-stealth-400">
          <span className="rounded-full border border-emerald-700/40 bg-emerald-950/25 px-2 py-1 text-emerald-300">Accumulation</span>
          <span className="rounded-full border border-rose-700/40 bg-rose-950/25 px-2 py-1 text-rose-300">Distribution</span>
          <span className="rounded-full border border-stealth-600 bg-stealth-900/70 px-2 py-1 text-stealth-300">Normal</span>
        </div>
      </div>

      <div className="rounded-[20px] border border-stealth-800 bg-[radial-gradient(circle_at_center,rgba(23,37,59,0.38),rgba(2,6,23,0.96)_70%)] p-3">
        <div className="flex flex-wrap items-center justify-center gap-2.5 md:gap-3">
        {rows.map((row) => {
          const size = 78 + Math.min(34, (Math.sqrt(totalNotional(row) / scale) || 0) * 34);
          const isSelected = row.symbol === selectedSymbol;

          return (
            <button
              key={`${row.category}-${row.symbol}`}
              type="button"
              onClick={() => onSelect(row.symbol)}
              className={`flex shrink-0 flex-col items-center justify-center rounded-full px-2 text-center transition duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-sky-400/70 ${getBubbleSurface(row.signal)} ${isSelected ? "ring-2 ring-white/80" : "ring-0"}`}
              style={{ width: `${size}px`, height: `${size}px` }}
            >
              <span className="max-w-full text-center text-[13px] font-semibold leading-tight tracking-wide md:text-sm">{row.symbol}</span>
              <span className="mt-1 text-[9px] uppercase tracking-[0.16em] text-white/70 md:text-[10px]">{row.confidence.toFixed(0)} conf</span>
              <span className="mt-1 max-w-full text-[10px] font-medium leading-tight md:text-[11px]">{formatCompactCurrency(totalNotional(row))}</span>
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

  return (
    <article className="rounded-[24px] border border-stealth-700 bg-[linear-gradient(180deg,rgba(19,27,40,0.98),rgba(9,14,24,0.98))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.28)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-stealth-500">Focused Signal</div>
          <div className="mt-1.5 text-xl font-semibold text-stealth-100">{row.symbol}</div>
          <div className="mt-1 text-xs text-stealth-400">{row.name} · {groupTitle}</div>
        </div>
        <SignalPill signal={row.signal} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl border border-stealth-700 bg-stealth-900/60 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Current Price</div>
          <div className="mt-1 font-semibold text-stealth-100">{formatCurrency(row.latest_price)}</div>
        </div>
        <div className="rounded-2xl border border-stealth-700 bg-stealth-900/60 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Confidence</div>
          <div className="mt-1 font-semibold text-stealth-100">{row.confidence.toFixed(1)}</div>
        </div>
        <div className="rounded-2xl border border-stealth-700 bg-stealth-900/60 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Buy Cluster</div>
          <div className="mt-1 font-semibold text-emerald-300">{formatCurrency(row.buy_cluster_level)}</div>
        </div>
        <div className="rounded-2xl border border-stealth-700 bg-stealth-900/60 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">Sell Cluster</div>
          <div className="mt-1 font-semibold text-rose-300">{formatCurrency(row.sell_cluster_level)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Net Flow Bias</div>
            <div className={`mt-1 text-base font-semibold ${flowTone}`}>{formatCompactCurrency(row.net_flow_usd)}</div>
          </div>
          <div className="text-right text-xs text-stealth-400">Events {row.event_count ?? row.recent_events.length}</div>
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

      <div className="mt-4 rounded-2xl border border-stealth-700 bg-stealth-950/45 p-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-stealth-500">Latest Triggered Bars</div>
        <div className="mt-2 space-y-2">
          {row.recent_events.slice(0, 4).map((event) => (
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
  groupKey,
  title,
  rows,
  selectedSymbol,
  onSelectSymbol,
}: {
  groupKey: string;
  title: string;
  rows: FlowSignal[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
}) {
  const accumulationCount = rows.filter((row) => row.signal === "accumulation").length;
  const distributionCount = rows.filter((row) => row.signal === "distribution").length;

  return (
    <section className="rounded-[24px] border border-stealth-700 bg-[radial-gradient(circle_at_top,rgba(31,49,73,0.34),rgba(12,17,27,0.98)_60%)] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-4 text-left">
        <div>
          <h2 className="text-lg font-semibold text-stealth-100">{title}</h2>
          <p className="mt-1 text-xs text-stealth-400">
            Bubble field groups the whole {groupKey} universe by activity and bias.
          </p>
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

  return (
    <section className={`rounded-3xl border p-4 sm:p-5 ${sectionClass}`}>
      <h2 className={`text-lg font-semibold ${textClass}`}>{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-stealth-300">No strong signals yet.</p>}
        {items.map((item, index) => (
          <div key={`${title}-${item.symbol}`} className="flex items-center justify-between rounded-xl bg-stealth-900/50 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-stealth-500">#{index + 1}</div>
              <div className="mt-1 font-semibold text-stealth-100">{item.symbol}</div>
            </div>
            <div className="text-right">
              <div className={`font-semibold ${textClass}`}>{formatCompactCurrency(item.net_flow_usd)}</div>
              <div className="text-xs text-stealth-400">confidence {item.confidence.toFixed(1)}</div>
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

  const { data, loading, error } = useApi<FlowOverviewResponse>(endpoint);

  const groups = data?.groups ?? {};
  const allRows = Object.values(groups).flat();
  const totalAccumulations = allRows.filter((row) => row.signal === "accumulation").length;
  const totalDistributions = allRows.filter((row) => row.signal === "distribution").length;
  const totalSignals = allRows.length;
  const orderedGroupKeys: GroupKey[] = ["sectors", "metals", "crypto", "stocks"];

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
    <div className="mx-auto max-w-7xl p-3 text-stealth-100 sm:p-4">
      <div className="mb-4 rounded-[24px] border border-stealth-700 bg-[radial-gradient(circle_at_top_left,rgba(58,94,138,0.32),rgba(13,18,29,0.98)_55%)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-stealth-400">Institutional Flow</div>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Clustered Volume Dashboard</h1>
            <p className="mt-1.5 max-w-2xl text-xs text-stealth-300 sm:text-sm">
              Bubble constellations surface where clustered accumulation and distribution are concentrating across sectors, metals, crypto, and stocks.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <GroupBadge label="Signals" value={totalSignals} />
            <GroupBadge label="Accumulations" value={totalAccumulations} tone="buy" />
            <GroupBadge label="Distributions" value={totalDistributions} tone="sell" />
          </div>
        </div>

        {!!data?.stock_selection?.symbols?.length && (
          <div className="mt-4 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
            <div className="text-[10px] uppercase tracking-[0.22em] text-stealth-500">Auto-selected stock basket</div>
            <div className="mt-1.5 text-xs text-stealth-200 sm:text-sm">
              Top {data.stock_selection.count} stocks by close dollar volume: <span className="font-semibold text-stealth-100">{data.stock_selection.symbols.join(", ")}</span>
            </div>
          </div>
        )}
      </div>

      {loading && <MarketLoading label="Scanning for clustered institutional flow..." />}
      {error && <div className="rounded-lg border border-rose-700/50 bg-rose-900/20 p-3 text-rose-200">{error}</div>}

      {data && (
        <>
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <LeadersPanel title="Top Accumulation" items={data.leaders.accumulation} tone="buy" />
            <LeadersPanel title="Top Distribution" items={data.leaders.distribution} tone="sell" />
          </div>

          <div className="mb-4 rounded-2xl border border-stealth-700 bg-stealth-850/50 p-3 text-xs text-stealth-300">
            <p><strong>Method:</strong> {data.method.description}</p>
            <p className="mt-1"><strong>Important:</strong> {data.method.note}</p>
            <p className="mt-1">As of {new Date(data.as_of).toLocaleString()}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.78fr)] xl:items-start">
            <div className="grid gap-3">
              <GroupSection
                groupKey="sectors"
                title="Sectors"
                rows={groups.sectors ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "sectors" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "sectors", symbol })}
              />
              <GroupSection
                groupKey="metals"
                title="Precious Metals"
                rows={groups.metals ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "metals" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "metals", symbol })}
              />
              <GroupSection
                groupKey="crypto"
                title="Crypto"
                rows={groups.crypto ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "crypto" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "crypto", symbol })}
              />
              <GroupSection
                groupKey="stocks"
                title="Stocks"
                rows={groups.stocks ?? []}
                selectedSymbol={resolvedSelection?.groupKey === "stocks" ? resolvedSelection.row.symbol : null}
                onSelectSymbol={(symbol) => setActiveSelection({ groupKey: "stocks", symbol })}
              />
            </div>

            <div className="xl:sticky xl:top-4">
              {resolvedSelection?.row ? (
                <FlowFocusCard
                  row={resolvedSelection.row}
                  groupScale={detailScale}
                  groupTitle={formatGroupTitle(resolvedSelection.groupKey)}
                />
              ) : (
                <div className="rounded-[28px] border border-stealth-700 bg-[linear-gradient(180deg,rgba(19,27,40,0.98),rgba(9,14,24,0.98))] p-6 text-sm text-stealth-300">
                  Select a bubble on the left to inspect its flow detail.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
