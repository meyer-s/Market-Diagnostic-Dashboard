import { Link } from "react-router-dom";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../../hooks/useApi";
import BondStressAttributionChart from "../bonds/BondStressAttributionChart";
import { CHART_MARGIN } from "../../utils/chartUtils";

interface BondComponentPoint {
  date: string;
  credit_spread_stress: {
    hy_oas: number;
    ig_oas: number;
    contribution: number;
    stress_score: number;
  };
  yield_curve_stress: {
    contribution: number;
  };
  rates_momentum_stress: {
    contribution: number;
  };
  treasury_volatility_stress: {
    contribution: number;
  };
  composite: {
    stress_score: number;
    stability_score: number;
  };
}

interface YieldCurvePoint {
  maturity: string;
  yield: number;
}

interface YieldCurveEntry {
  date: string;
  curve: YieldCurvePoint[];
}

interface YieldCurveResponse {
  curves: YieldCurveEntry[];
}

interface DebtCompositeCreditWidgetProps {
  trendPeriod?: 90 | 180 | 365;
}

const MATURITY_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

const toMonths = (trendPeriod: 90 | 180 | 365) => {
  if (trendPeriod === 365) return 12;
  if (trendPeriod === 180) return 6;
  return 3;
};

export default function DebtCompositeCreditWidget({ trendPeriod = 90 }: DebtCompositeCreditWidgetProps) {
  const { data, loading, error } = useApi<BondComponentPoint[]>(`/indicators/BOND_MARKET_STABILITY/components?days=${trendPeriod}`);
  const yieldMonths = toMonths(trendPeriod);
  const { data: yieldData } = useApi<YieldCurveResponse>(`/indicators/BOND_MARKET_STABILITY/yield-curve?months=${yieldMonths}`);

  const latestCurve = yieldData?.curves?.[0];
  const priorCurves = yieldData?.curves?.slice(1, 4) ?? [];

  const yieldChartData = latestCurve
    ? (() => {
        const latestMap = new Map(latestCurve.curve.map((p) => [p.maturity, p.yield]));
        const priorMaps = priorCurves.map((entry) => new Map(entry.curve.map((p) => [p.maturity, p.yield])));

        return MATURITY_ORDER.map((maturity) => ({
          maturity,
          latest: latestMap.get(maturity) ?? null,
          prior_1: priorMaps[0]?.get(maturity) ?? null,
          prior_2: priorMaps[1]?.get(maturity) ?? null,
          prior_3: priorMaps[2]?.get(maturity) ?? null,
        }));
      })()
    : [];

  const spread10y2y = latestCurve
    ? (() => {
        const map = new Map(latestCurve.curve.map((p) => [p.maturity, p.yield]));
        const y2 = map.get("2Y");
        const y10 = map.get("10Y");
        if (y2 === undefined || y10 === undefined) return null;
        return y10 - y2;
      })()
    : null;

  if (loading) {
    return (
      <div className="primary-card p-3 sm:p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-stealth-700" />
          <div className="h-28 w-full rounded bg-stealth-800" />
          <div className="h-12 w-full rounded bg-stealth-800" />
        </div>
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="primary-card p-3 sm:p-6">
        <div className="text-sm text-red-400">Debt composite data unavailable.</div>
      </div>
    );
  }

  const recent = data.slice(-45);
  const latest = recent[recent.length - 1];
  const prior = recent.length > 1 ? recent[recent.length - 2] : latest;

  const hy = Number(latest.credit_spread_stress?.hy_oas ?? 0);
  const ig = Number(latest.credit_spread_stress?.ig_oas ?? 0);
  const spreadGap = hy - ig;
  const spreadGapPrior = Number(prior.credit_spread_stress?.hy_oas ?? 0) - Number(prior.credit_spread_stress?.ig_oas ?? 0);
  const spreadGapDelta = spreadGap - spreadGapPrior;

  const stability = Number(latest.composite?.stability_score ?? 0);
  const stabilityPrior = Number(prior.composite?.stability_score ?? 0);
  const stabilityDelta = stability - stabilityPrior;

  const stabilityTone =
    stability >= 65 ? "text-green-300" : stability >= 45 ? "text-yellow-300" : "text-red-300";

  const curveInsight =
    spread10y2y === null
      ? "Curve signal unavailable."
      : spread10y2y < 0
      ? `Curve remains inverted (${spread10y2y.toFixed(2)}% 10Y-2Y).`
      : spread10y2y < 0.5
      ? `Curve is flat (${spread10y2y.toFixed(2)}% 10Y-2Y).`
      : `Curve is normal (${spread10y2y.toFixed(2)}% 10Y-2Y).`;

  const stressDrivers = (() => {
    const c = Number(latest.credit_spread_stress?.contribution ?? 0);
    const y = Number(latest.yield_curve_stress?.contribution ?? 0);
    const m = Number(latest.rates_momentum_stress?.contribution ?? 0);
    const v = Number(latest.treasury_volatility_stress?.contribution ?? 0);
    const pairs = [
      { label: "Credit spreads", value: c },
      { label: "Yield curve", value: y },
      { label: "Rates momentum", value: m },
      { label: "Treasury volatility", value: v },
    ].sort((a, b) => b.value - a.value);
    return `${pairs[0].label} is the largest stress driver, followed by ${pairs[1].label}.`;
  })();

  return (
    <Link to="/bond_health_stability" className="block">
      <div className="primary-card primary-card-hover p-3 sm:p-6 cursor-pointer">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-stealth-100 whitespace-nowrap">
              Debt Composite + Credit Stress
            </h3>
            <div className="text-xs text-stealth-400 mt-1">Labeled stress mix + live onionskinned yield curve</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-stealth-500">Stability</div>
            <div className={`text-lg font-semibold ${stabilityTone}`}>{stability.toFixed(1)}</div>
            <div className={`text-xs ${stabilityDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
              {stabilityDelta >= 0 ? "+" : ""}{stabilityDelta.toFixed(1)} d/d
            </div>
          </div>
        </div>

        {yieldChartData.length > 0 && (
          <div className="h-28 mb-3 border-b border-stealth-700/70 pb-3">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={yieldChartData} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="maturity"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={{ stroke: "#475569" }}
                  tickLine={{ stroke: "#475569" }}
                />
                <YAxis hide domain={["dataMin - 0.2", "dataMax + 0.2"]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#cbd5e1",
                  }}
                  formatter={(value) =>
                    value === null ? "--" : `${Number(value).toFixed(2)}%`
                  }
                />
                <Line type="monotone" dataKey="prior_3" stroke="#64748b" strokeOpacity={0.28} strokeWidth={1.2} dot={false} name="Prior 3" />
                <Line type="monotone" dataKey="prior_2" stroke="#94a3b8" strokeOpacity={0.36} strokeWidth={1.3} dot={false} name="Prior 2" />
                <Line type="monotone" dataKey="prior_1" stroke="#cbd5e1" strokeOpacity={0.45} strokeWidth={1.4} dot={false} name="Prior 1" />
                <Line type="monotone" dataKey="latest" stroke="#22d3ee" strokeWidth={2.2} dot={false} name="Latest" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="h-32 mb-3">
          <BondStressAttributionChart data={recent} />
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded border border-stealth-700/70 bg-stealth-900/40 px-2 py-1 text-stealth-300"><span className="h-2 w-2 rounded-full bg-orange-500" />Credit spreads</span>
          <span className="inline-flex items-center gap-1 rounded border border-stealth-700/70 bg-stealth-900/40 px-2 py-1 text-stealth-300"><span className="h-2 w-2 rounded-full bg-sky-400" />Yield curve</span>
          <span className="inline-flex items-center gap-1 rounded border border-stealth-700/70 bg-stealth-900/40 px-2 py-1 text-stealth-300"><span className="h-2 w-2 rounded-full bg-violet-400" />Rates momentum</span>
          <span className="inline-flex items-center gap-1 rounded border border-stealth-700/70 bg-stealth-900/40 px-2 py-1 text-stealth-300"><span className="h-2 w-2 rounded-full bg-amber-400" />Treasury vol</span>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-stealth-700/70 pt-3 text-xs">
          <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
            <div className="text-stealth-500">HY OAS</div>
            <div className="mt-1 font-semibold text-stealth-100">{hy.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
            <div className="text-stealth-500">IG OAS</div>
            <div className="mt-1 font-semibold text-stealth-100">{ig.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 p-2">
            <div className="text-stealth-500">HY-IG Gap</div>
            <div className="mt-1 font-semibold text-stealth-100">{spreadGap.toFixed(2)}</div>
          </div>
        </div>

        <div className={`mt-2 text-[11px] ${spreadGapDelta <= 0 ? "text-green-300" : "text-red-300"}`}>
          Credit quality stress {spreadGapDelta <= 0 ? "eased" : "widened"} by {Math.abs(spreadGapDelta).toFixed(2)} vs prior session.
        </div>
        <div className="mt-1 text-[11px] text-stealth-300">{curveInsight}</div>
        <div className="mt-1 text-[11px] text-stealth-300">{stressDrivers}</div>
      </div>
    </Link>
  );
}
