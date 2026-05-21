import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  participation_pct: number;
  universe_size: number;
  history: Array<{
    date: string;
    advancing: number;
    declining: number;
    advancing_pct: number;
    declining_pct: number;
    ad_rate: number;
    volume_advancing: number;
    volume_declining: number;
    volume_advancing_pct: number;
    volume_declining_pct: number;
    new_highs: number;
    new_lows: number;
    new_highs_pct: number;
    new_lows_pct: number;
    participation_pct: number;
  }>;
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
    amex: BreadthBucket;
    nsdq: BreadthBucket;
    nasdaq: BreadthBucket;
    nyse: BreadthBucket;
  };
}

interface AdvanceDeclineCardProps {
  trendPeriod?: 90 | 180 | 365;
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

export default function AdvanceDeclineCard({ trendPeriod = 90 }: AdvanceDeclineCardProps) {
  const { data, loading, error } = useApi<MarketInternalsResponse>(`/market-internals/overview?days=${trendPeriod}`);
  const [selectedExchange, setSelectedExchange] = useState<"amex" | "nyse" | "nsdq">("nsdq");

  const asOfLabel = useMemo(() => {
    if (!data?.as_of) return "--";
    return new Date(data.as_of).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [data?.as_of]);

  const selectedBucket = useMemo(() => {
    if (!data) return null;
    return data.exchanges[selectedExchange] ?? null;
  }, [data, selectedExchange]);

  const history = useMemo(() => {
    if (!selectedBucket?.history?.length) return [];
    return selectedBucket.history.map((d) => ({
      ...d,
      dateLabel: d.date.slice(5),
    }));
  }, [selectedBucket]);

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
  const bucket = selectedBucket ?? data.exchanges.nsdq;
  const exchangeName = selectedExchange === "amex" ? "AMEX" : selectedExchange === "nyse" ? "NYSE" : "NSDQ";
  const exchangeSubtitle =
    selectedExchange === "amex"
      ? "American Stock Exchange"
      : selectedExchange === "nyse"
      ? "New York Stock Exchange"
      : "NASDAQ Composite";

  return (
    <div className="primary-card p-3 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-stealth-100 whitespace-nowrap">
            Advance / Decline + Volume
          </h3>
          <div className="text-xs text-stealth-400 mt-1">{exchangeName} · {exchangeSubtitle}</div>
          <div className="mt-2">
            <Link
              to="/tools/volume-breadth"
              className="inline-flex items-center rounded-full border border-stealth-700 px-2.5 py-1 text-[11px] text-stealth-300 hover:border-stealth-500 hover:text-stealth-100"
            >
              Open Full Volume/Breadth Page
            </Link>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-stealth-500">As of {asOfLabel}</div>
          <div className={`text-xs ${adRateDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
            A/D pace {adRateDelta >= 0 ? "+" : ""}{adRateDelta.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { key: "amex" as const, label: "AMEX" },
          { key: "nyse" as const, label: "NYSE" },
          { key: "nsdq" as const, label: "NSDQ" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setSelectedExchange(item.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
              selectedExchange === item.key
                ? "border-stealth-500 bg-stealth-700 text-white"
                : "border-stealth-700 text-stealth-400 hover:border-stealth-600 hover:text-stealth-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="h-40 mb-3">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
              <Line yAxisId="pct" type="monotone" dataKey="volume_advancing_pct" stroke="#22d3ee" strokeWidth={1.7} dot={false} name="Volume adv %" />
              <Line yAxisId="pct" type="monotone" dataKey="participation_pct" stroke="#a78bfa" strokeWidth={1.6} dot={false} name="Participation %" />
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
              <span className="text-green-300">{bucket.advancing_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{bucket.declining_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={bucket.advancing_pct} right={bucket.declining_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{bucket.advancing.toLocaleString()}</span>
            <span className="text-red-300">{bucket.declining.toLocaleString()}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-stealth-300">
            <span>Volume A/D</span>
            <span>
              <span className="text-green-300">{bucket.volume_advancing_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{bucket.volume_declining_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={bucket.volume_advancing_pct} right={bucket.volume_declining_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{formatLarge(bucket.volume_advancing)}</span>
            <span className="text-red-300">{formatLarge(bucket.volume_declining)}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-stealth-300">
            <span>New Highs / New Lows</span>
            <span>
              <span className="text-green-300">{bucket.new_highs_pct.toFixed(0)}%</span>
              <span className="text-stealth-500"> / </span>
              <span className="text-red-300">{bucket.new_lows_pct.toFixed(0)}%</span>
            </span>
          </div>
          <SplitBar left={bucket.new_highs_pct} right={bucket.new_lows_pct} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-green-300">{bucket.new_highs.toLocaleString()}</span>
            <span className="text-red-300">{bucket.new_lows.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stealth-700/70 pt-3">
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-[10px] uppercase text-stealth-500">Participation</div>
          <div className="mt-1 text-base font-semibold text-stealth-100">{bucket.participation_pct.toFixed(0)}%</div>
          <div className="text-[11px] text-stealth-500 mt-1">{bucket.universe_size} names tracked</div>
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-[10px] uppercase text-stealth-500">All Exchange Composite</div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-green-300">A/D {composite.advancing_pct.toFixed(0)}%</span>
            <span className="text-red-300">{composite.declining_pct.toFixed(0)}%</span>
          </div>
          <SplitBar left={composite.advancing_pct} right={composite.declining_pct} />
        </div>
      </div>
    </div>
  );
}
