import { Link } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../../hooks/useApi";
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

export default function DebtCompositeCreditWidget() {
  const { data, loading, error } = useApi<BondComponentPoint[]>("/indicators/BOND_MARKET_STABILITY/components?days=180");

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

  const chartData = recent.map((point) => ({
    date: point.date,
    label: point.date.slice(5),
    credit: Number(point.credit_spread_stress?.contribution ?? 0),
    curve: Number(point.yield_curve_stress?.contribution ?? 0),
    momentum: Number(point.rates_momentum_stress?.contribution ?? 0),
    vol: Number(point.treasury_volatility_stress?.contribution ?? 0),
  }));

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

  return (
    <Link to="/indicator/BOND_MARKET_STABILITY" className="block">
      <div className="primary-card primary-card-hover p-3 sm:p-6 cursor-pointer">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-stealth-100 whitespace-nowrap">
              Debt Composite + Credit Stress
            </h3>
            <div className="text-xs text-stealth-400 mt-1">Weighted stress mix with HY/IG quality spread</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-stealth-500">Stability</div>
            <div className={`text-lg font-semibold ${stabilityTone}`}>{stability.toFixed(1)}</div>
            <div className={`text-xs ${stabilityDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
              {stabilityDelta >= 0 ? "+" : ""}{stabilityDelta.toFixed(1)} d/d
            </div>
          </div>
        </div>

        <div className="h-32 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="label"
                minTickGap={24}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={{ stroke: "#475569" }}
                tickLine={{ stroke: "#475569" }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#cbd5e1",
                }}
                formatter={(value: number) => [Number(value).toFixed(2), "Contribution"]}
              />
              <Bar dataKey="credit" stackId="stress" fill="#f97316" fillOpacity={0.9} name="Credit" />
              <Bar dataKey="curve" stackId="stress" fill="#38bdf8" fillOpacity={0.85} name="Yield Curve" />
              <Bar dataKey="momentum" stackId="stress" fill="#a78bfa" fillOpacity={0.85} name="Rates Momentum" />
              <Bar dataKey="vol" stackId="stress" fill="#facc15" fillOpacity={0.85} name="Treasury Vol" />
            </ComposedChart>
          </ResponsiveContainer>
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
      </div>
    </Link>
  );
}
