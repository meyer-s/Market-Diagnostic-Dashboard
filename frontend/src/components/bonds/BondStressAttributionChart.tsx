import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_MARGIN } from "../../utils/chartUtils";

export interface BondStressAttributionPoint {
  date: string;
  credit_spread_stress?: {
    contribution?: number;
  };
  yield_curve_stress?: {
    contribution?: number;
  };
  rates_momentum_stress?: {
    contribution?: number;
  };
  treasury_volatility_stress?: {
    contribution?: number;
  };
}

type BondStressAttributionChartProps = {
  data: BondStressAttributionPoint[];
  height?: number | `${number}%`;
  labelFormatter?: (date: string) => string;
};

export default function BondStressAttributionChart({
  data,
  height = "100%",
  labelFormatter = (date) => date.slice(5),
}: BondStressAttributionChartProps) {
  const chartData = data.map((point) => ({
    date: point.date,
    label: labelFormatter(point.date),
    credit: Number(point.credit_spread_stress?.contribution ?? 0),
    curve: Number(point.yield_curve_stress?.contribution ?? 0),
    momentum: Number(point.rates_momentum_stress?.contribution ?? 0),
    vol: Number(point.treasury_volatility_stress?.contribution ?? 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
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
          formatter={(value, name) => [Number(value).toFixed(2), String(name)]}
        />
        <Bar dataKey="credit" stackId="stress" fill="#f97316" fillOpacity={0.9} name="Credit spreads" />
        <Bar dataKey="curve" stackId="stress" fill="#38bdf8" fillOpacity={0.85} name="Yield curve" />
        <Bar dataKey="momentum" stackId="stress" fill="#a78bfa" fillOpacity={0.85} name="Rates momentum" />
        <Bar dataKey="vol" stackId="stress" fill="#facc15" fillOpacity={0.85} name="Treasury vol" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
