import { useMemo, useState } from "react";
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
import { useApi } from "../../hooks/useApi";
import { CHART_MARGIN } from "../../utils/chartUtils";

type TrendPeriod = 90 | 180 | 365;

interface BreadthHistoryPoint {
  date: string;
  advancing_pct: number;
  declining_pct: number;
  ad_rate: number;
  volume_advancing_pct: number;
  participation_pct: number;
}

interface BreadthBucket {
  label: string;
  source?: string;
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
  history: BreadthHistoryPoint[];
}

interface BreadthResponse {
  as_of: string;
  exchanges: {
    amex: BreadthBucket;
    nyse: BreadthBucket;
    nsdq: BreadthBucket;
  };
}

const formatLarge = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function ExchangeChart({ name, bucket }: { name: string; bucket: BreadthBucket }) {
  const chartData = useMemo(
    () =>
      (bucket.history || []).map((d) => ({
        ...d,
        label: d.date.slice(5),
      })),
    [bucket.history]
  );

  return (
    <div className="primary-card p-4 sm:p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-stealth-100">{name}</h3>
          <div className="text-xs text-stealth-400">Source: {bucket.source || "unknown"}</div>
        </div>
        <div className="text-right text-xs text-stealth-300">
          <div>A/D {bucket.advancing_pct.toFixed(0)}% / {bucket.declining_pct.toFixed(0)}%</div>
          <div>Universe {bucket.universe_size.toLocaleString()}</div>
        </div>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chartData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-tooltip-border)" />
            <XAxis dataKey="label" minTickGap={24} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#475569" }} tickLine={{ stroke: "#475569" }} />
            <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#475569" }} tickLine={{ stroke: "#475569" }} width={30} />
            <YAxis yAxisId="rate" hide orientation="right" domain={["dataMin - 2", "dataMax + 2"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8, color: "var(--chart-tooltip-label)" }}
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

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-stealth-500">Vol adv</div>
          <div className="text-green-300 font-semibold">{bucket.volume_advancing_pct.toFixed(0)}%</div>
          <div className="text-stealth-300">{formatLarge(bucket.volume_advancing)}</div>
        </div>
        <div className="rounded border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-stealth-500">New highs</div>
          <div className="text-green-300 font-semibold">{bucket.new_highs_pct.toFixed(0)}%</div>
          <div className="text-stealth-300">{bucket.new_highs.toLocaleString()}</div>
        </div>
        <div className="rounded border border-stealth-700/70 bg-stealth-900/40 p-2">
          <div className="text-stealth-500">Participation</div>
          <div className="text-violet-300 font-semibold">{bucket.participation_pct.toFixed(0)}%</div>
          <div className="text-stealth-300">active names</div>
        </div>
      </div>
    </div>
  );
}

export default function VolumeBreadthTools() {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>(90);
  const { data, loading, error } = useApi<BreadthResponse>(`/market-internals/overview?days=${trendPeriod}`);

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="page-kicker">Tools</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Volume & Breadth</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Expanded exchange-level advance/decline, participation, and volume diagnostics.</p>
        </div>
        <div className="control-strip">
          <button onClick={() => setTrendPeriod(90)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 90 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>90d</button>
          <button onClick={() => setTrendPeriod(180)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 180 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>6mo</button>
          <button onClick={() => setTrendPeriod(365)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 365 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>1yr</button>
        </div>
      </div>

      {loading && <div className="primary-card p-5 text-stealth-400">Loading breadth data...</div>}
      {error && <div className="primary-card p-5 text-red-400">Failed to load breadth data: {error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ExchangeChart name="AMEX" bucket={data.exchanges.amex} />
            <ExchangeChart name="NYSE" bucket={data.exchanges.nyse} />
            <ExchangeChart name="NSDQ" bucket={data.exchanges.nsdq} />
          </div>

          <div className="surface-card-strong p-4 sm:p-5">
            <h3 className="text-base font-semibold text-stealth-100">Methodology & Scoring</h3>
            <div className="mt-2 text-sm text-stealth-300 space-y-1">
              <p>1. Exchange universes are fetched from Nasdaq symbol-directory files and refreshed daily.</p>
              <p>2. Each exchange computes advancing vs declining names, advancing vs declining volume, and new highs vs lows each session.</p>
              <p>3. Participation % is active symbols with valid daily data over total listed symbols in the current universe.</p>
              <p>4. A/D pace is advancing minus declining and helps identify thrust or deterioration velocity.</p>
              <p>5. Data source per exchange is shown as direct breadth-symbol feed or proxy fallback when direct symbols are unavailable.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
