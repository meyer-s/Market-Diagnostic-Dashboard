import { useMemo } from "react";
import { useApi } from "../../hooks/useApi";

interface BreadthBucket {
  label: string;
  advancing: number;
  declining: number;
  advancing_pct: number;
  declining_pct: number;
  volume_advancing: number;
  volume_declining: number;
  volume_advancing_pct: number;
  volume_declining_pct: number;
  new_highs: number;
  new_lows: number;
  new_highs_pct: number;
  new_lows_pct: number;
  universe_size: number;
}

interface MarketInternalsResponse {
  as_of: string;
  composite: BreadthBucket;
  exchanges: {
    nasdaq: BreadthBucket;
    nyse: BreadthBucket;
  };
}

function SplitBar({
  left,
  right,
}: {
  left: number;
  right: number;
}) {
  const leftSafe = Number.isFinite(left) ? Math.max(0, Math.min(100, left)) : 50;
  const rightSafe = Number.isFinite(right) ? Math.max(0, Math.min(100, right)) : 50;
  return (
    <div className="h-3 w-full overflow-hidden rounded-sm bg-stealth-900/70 border border-stealth-700/70">
      <div className="flex h-full w-full">
        <div className="h-full bg-green-400/90" style={{ width: `${leftSafe}%` }} />
        <div className="h-full bg-red-400/90" style={{ width: `${rightSafe}%` }} />
      </div>
    </div>
  );
}

const formatLarge = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export default function AdvanceDeclineCard() {
  const { data, loading, error } = useApi<MarketInternalsResponse>("/market-internals/overview");

  const asOfLabel = useMemo(() => {
    if (!data?.as_of) return "--";
    return new Date(data.as_of).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [data?.as_of]);

  if (loading) {
    return (
      <div className="surface-card-strong p-4 sm:p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-stealth-700" />
          <div className="h-8 w-full rounded bg-stealth-800" />
          <div className="h-8 w-full rounded bg-stealth-800" />
          <div className="h-8 w-full rounded bg-stealth-800" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="surface-card-strong p-4 sm:p-5">
        <div className="text-sm text-red-400">Market internals unavailable.</div>
      </div>
    );
  }

  const composite = data.composite;
  const nasdaq = data.exchanges.nasdaq;
  const nyse = data.exchanges.nyse;

  return (
    <div className="surface-card-strong p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-stealth-500">Breadth Pulse</div>
          <h3 className="text-base font-semibold text-stealth-100 sm:text-lg">Advance / Decline + Volume</h3>
        </div>
        <div className="text-[11px] text-stealth-500">As of {asOfLabel}</div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-stealth-300">
            <span>Advancing vs Declining</span>
            <span>
              <span className="text-green-300">{composite.advancing_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{composite.declining_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={composite.advancing_pct} right={composite.declining_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{composite.advancing.toLocaleString()}</span>
            <span className="text-red-300">{composite.declining.toLocaleString()}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-stealth-300">
            <span>Volume A/D</span>
            <span>
              <span className="text-green-300">{composite.volume_advancing_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{composite.volume_declining_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={composite.volume_advancing_pct} right={composite.volume_declining_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{formatLarge(composite.volume_advancing)}</span>
            <span className="text-red-300">{formatLarge(composite.volume_declining)}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-stealth-300">
            <span>New Highs / New Lows</span>
            <span>
              <span className="text-green-300">{composite.new_highs_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{composite.new_lows_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={composite.new_highs_pct} right={composite.new_lows_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{composite.new_highs.toLocaleString()}</span>
            <span className="text-red-300">{composite.new_lows.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stealth-700/70 pt-3">
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-[10px] uppercase text-stealth-500">NASDAQ proxy</div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-green-300">A/D {nasdaq.advancing_pct.toFixed(0)}%</span>
            <span className="text-red-300">{nasdaq.declining_pct.toFixed(0)}%</span>
          </div>
          <SplitBar left={nasdaq.advancing_pct} right={nasdaq.declining_pct} />
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-[10px] uppercase text-stealth-500">NYSE proxy</div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-green-300">A/D {nyse.advancing_pct.toFixed(0)}%</span>
            <span className="text-red-300">{nyse.declining_pct.toFixed(0)}%</span>
          </div>
          <SplitBar left={nyse.advancing_pct} right={nyse.declining_pct} />
        </div>
      </div>
    </div>
  );
}
