import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useApi } from "../../hooks/useApi";

interface CurvePoint {
  maturity: string;
  yield: number;
}

interface CurveEntry {
  date: string;
  curve: CurvePoint[];
}

interface YieldCurveResponse {
  curves: CurveEntry[];
}

const MATURITY_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

export default function YieldCurveCard() {
  const { data, loading, error } = useApi<YieldCurveResponse>("/indicators/BOND_MARKET_STABILITY/yield-curve?months=6");

  const latest = data?.curves?.[0];
  const previous = data?.curves?.[1];

  const chartData = useMemo(() => {
    if (!latest) return [];
    const prevMap = new Map((previous?.curve || []).map((p) => [p.maturity, p.yield]));
    const latestMap = new Map((latest.curve || []).map((p) => [p.maturity, p.yield]));

    return MATURITY_ORDER.map((maturity) => ({
      maturity,
      latest: latestMap.get(maturity) ?? null,
      previous: prevMap.get(maturity) ?? null,
    }));
  }, [latest, previous]);

  if (loading) {
    return (
      <div className="surface-card-strong p-4 sm:p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-36 rounded bg-stealth-700" />
          <div className="h-28 w-full rounded bg-stealth-800" />
          <div className="h-4 w-24 rounded bg-stealth-700" />
        </div>
      </div>
    );
  }

  if (error || !latest || !latest.curve?.length) {
    return (
      <div className="surface-card-strong p-4 sm:p-5">
        <div className="text-sm text-red-400">Yield curve unavailable.</div>
      </div>
    );
  }

  const latestMap = new Map(latest.curve.map((p) => [p.maturity, p.yield]));
  const y2 = latestMap.get("2Y") ?? null;
  const y10 = latestMap.get("10Y") ?? null;
  const y30 = latestMap.get("30Y") ?? null;
  const spread = y10 !== null && y2 !== null ? y10 - y2 : null;
  const inverted = spread !== null && spread < 0;
  const steepening = previous
    ? (() => {
        const prevMap = new Map(previous.curve.map((p) => [p.maturity, p.yield]));
        const prevY2 = prevMap.get("2Y") ?? null;
        const prevY10 = prevMap.get("10Y") ?? null;
        if (prevY2 === null || prevY10 === null || spread === null) return null;
        return spread - (prevY10 - prevY2);
      })()
    : null;

  const slopeText =
    spread === null
      ? "N/A"
      : inverted
      ? "Inverted"
      : spread < 0.5
      ? "Flat"
      : "Normal";

  const slopeColor =
    spread === null ? "text-stealth-300" : inverted ? "text-red-300" : spread < 0.5 ? "text-amber-300" : "text-green-300";

  return (
    <Link to="/indicator/BOND_MARKET_STABILITY" className="block">
      <div className="surface-card-strong p-4 sm:p-5 transition hover:border-stealth-500/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-stealth-500">Debt Monitor</div>
            <h3 className="text-base font-semibold text-stealth-100 sm:text-lg">Live Yield Curve</h3>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-stealth-500">10Y - 2Y</div>
            <div className={`text-lg font-semibold ${slopeColor}`}>
              {spread === null ? "--" : `${spread.toFixed(2)}%`}
            </div>
            <div className={`text-xs ${slopeColor}`}>{slopeText}</div>
          </div>
        </div>

        <div className="mt-3 h-36">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2f3b52" />
              <XAxis dataKey="maturity" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#475569" }} tickLine={{ stroke: "#475569" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#475569" }} tickLine={{ stroke: "#475569" }} domain={["dataMin - 0.25", "dataMax + 0.25"]} />
              <Tooltip
                formatter={(value) => (value === null ? "--" : `${Number(value).toFixed(2)}%`)}
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 8 }}
                labelStyle={{ color: "var(--chart-tooltip-label)" }}
              />
              <Line type="monotone" dataKey="previous" stroke="#64748b" strokeWidth={2} dot={false} name="Prior" />
              <Line type="monotone" dataKey="latest" stroke="#22d3ee" strokeWidth={2.5} dot={false} name="Latest" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-stealth-700/70 pt-3 text-xs">
          <div className="stat-card">
            <div className="text-stealth-500">2Y</div>
            <div className="mt-1 font-semibold text-stealth-100">{y2 === null ? "--" : `${y2.toFixed(2)}%`}</div>
          </div>
          <div className="stat-card">
            <div className="text-stealth-500">10Y</div>
            <div className="mt-1 font-semibold text-stealth-100">{y10 === null ? "--" : `${y10.toFixed(2)}%`}</div>
          </div>
          <div className="stat-card">
            <div className="text-stealth-500">30Y</div>
            <div className="mt-1 font-semibold text-stealth-100">{y30 === null ? "--" : `${y30.toFixed(2)}%`}</div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-stealth-400">
          {steepening === null
            ? "Watching curve shape changes for debt-cycle stress."
            : steepening >= 0
            ? `Curve steepened ${steepening.toFixed(2)} pts vs prior session.`
            : `Curve flattened ${Math.abs(steepening).toFixed(2)} pts vs prior session.`}
        </div>
      </div>
    </Link>
  );
}
