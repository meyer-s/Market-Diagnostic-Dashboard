import { useMemo } from "react";
import { useApi } from "../../hooks/useApi";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_MARGIN } from "../../utils/chartUtils";

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
  history: Array<{
    date: string;
    advancing_pct: number;
    declining_pct: number;
    ad_rate: number;
  }>;
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

  const history = useMemo(() => {
    if (!data?.history?.length) return [];
    return data.history.slice(-45).map((d) => ({
      ...d,
      dateLabel: d.date.slice(5),
    }));
  }, [data?.history]);

  const adRateDelta = useMemo(() => {
    if (history.length < 2) return 0;
    return history[history.length - 1].ad_rate - history[history.length - 2].ad_rate;
  }, [history]);

  if (loading) {
    return (
      <div className="primary-card p-3 sm:p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-stealth-700" />
          <div className="h-28 w-full rounded bg-stealth-800" />
          <div className="h-8 w-full rounded bg-stealth-800" />
          <div className="h-8 w-full rounded bg-stealth-800" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="primary-card p-3 sm:p-6">
        <div className="text-sm text-red-400">Market internals unavailable.</div>
      </div>
    );
  }

  const composite = data.composite;
  const nasdaq = data.exchanges.nasdaq;
  const nyse = data.exchanges.nyse;

  return (
    <div className="primary-card p-3 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-stealth-100 whitespace-nowrap">
            Advance / Decline + Volume
          </h3>
          <div className="text-xs text-stealth-400 mt-1">Breadth participation and pace</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-stealth-500">As of {asOfLabel}</div>
          <div className={`text-xs ${adRateDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
            A/D pace {adRateDelta >= 0 ? "+" : ""}{adRateDelta.toFixed(0)}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="h-32 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={history} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="dateLabel"
                minTickGap={24}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
              />
              <YAxis
                yAxisId="pct"
                domain={[0, 100]}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
                width={30}
              />
              <YAxis yAxisId="rate" orientation="right" hide domain={["dataMin - 2", "dataMax + 2"]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#cbd5e1",
                }}
                formatter={(value: number, name: string) => {
                  if (name === "A/D pace") return [Number(value).toFixed(0), name];
                  return [`${Number(value).toFixed(1)}%`, name];
                }}
              />
              <Bar yAxisId="pct" dataKey="advancing_pct" stackId="breadth" fill="#4ade80" fillOpacity={0.9} name="Advancing" />
              <Bar yAxisId="pct" dataKey="declining_pct" stackId="breadth" fill="#f87171" fillOpacity={0.85} name="Declining" />
              <Line yAxisId="rate" type="monotone" dataKey="ad_rate" stroke="#facc15" strokeWidth={1.8} dot={false} name="A/D pace" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-3">
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
